const express = require('express');
const db = require('../../../db');
const path = require('path');
const fs = require('fs');
const { ObjectId } = require("mongodb");
const archiver = require("archiver");
const XLSX = require('xlsx');
const uploadTicketExcel = require('../../../utils/upload-file');
require("dotenv").config();

const managerRouter = express.Router();

function escapeRegex(text = "") {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

managerRouter.get("/get-forecast-filter-options", async (req, res) => {
    try {
        const { provForecast } = await db();

        const cleanDistinct = async (field, q = {}) => {
            const values = await provForecast.distinct(field, {
                ...q,
                [field]: {
                    $nin: [null, ""],
                },
            });

            return values
                .filter((value) => value != null && value !== "")
                .map((value) => String(value).trim())
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b));
        };

        // Obtiene valores de varios campos y los combina sin duplicados
        const cleanDistinctMultiple = async (fields, query = {}) => {
            const results = await Promise.all(
                fields.map((field) => cleanDistinct(field, query))
            );

            return [...new Set(results.flat())].sort((a, b) =>
                a.localeCompare(b, "es", { sensitivity: "base" })
            );
        };

        const [
            tipo,
            codigo_proyecto,
            nombre_proyecto,
            unidad_funcional,
            grupo
        ] = await Promise.all([
            cleanDistinct("tipo"),
            cleanDistinct("codigo_proyecto"),
            cleanDistinct("nombre_proyecto"),
            cleanDistinct("unidad_funcional"),
            cleanDistinct("grupo")
        ]);

        return res.json({
            result: "OK",
            content: {
                tipo: tipo,
                codigo_proyecto: codigo_proyecto,
                nombre_proyecto: nombre_proyecto,
                unidad_funcional: unidad_funcional,
                grupo: grupo
            },
        });
    } catch (e) {
        console.error("Error get-forecast-filter-options:", e);
        return res.status(500).json({
            result: "ERROR",
            message: "Error al obtener opciones de filtros",
        });
    }
});

// GET FORECASTS
managerRouter.get("/get-forecasts", async (req, res) => {

    try {

        const { provForecast } = await db()

        const {
            codigo_proyecto,
            nombre_proyecto,
            unidad_funcional,
            grupo,
            tipo,
            search = "",
            page = 1,
            limit = 10,
            sortBy = "codigo_proyecto",
            sortDirection = "desc"
        } = req.query;

        // Paginación
        const currentPage = Math.max(parseInt(page, 10) || 1, 1);
        const perPage = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 5000);
        const skip = (currentPage - 1) * perPage;

        // Campos permitidos para ordenar
        const allowedSortFields = new Set([
            "codigo_proyecto",
            "nombre_proyecto",
            "grupo",
            "tipo",
            "linea_inversion"
        ]);

        const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "codigo_proyecto";
        const safeSortDirection = String(sortDirection).toLowerCase() === "asc" ? -1 : 1;

        // Query base de sites
        const q = {};
        
        if (tipo) q.tipo = tipo;
        if (codigo_proyecto) q.codigo_proyecto = codigo_proyecto;
        if (nombre_proyecto) q.nombre_proyecto = nombre_proyecto;
        if (unidad_funcional) q.unidad_funcional = unidad_funcional;
        if (grupo) q.grupo = grupo;

        // Búsqueda
        if (String(search).trim()) {
            const rx = new RegExp(escapeRegex(String(search).trim()), "i");

            q.$or = [
                { llave: rx },
                { codigo_proyecto: rx },
                { nombre_proyecto: rx },
                { linea_inversion: rx },
            ];
        }

        const forecastProjection = {
            llave: 1,
            codigo_proyecto: 1,
            nombre_proyecto: 1,
            linea_inversion: 1,
            grupo: 1,
            cod_line: 1,
            tipo: 1,
            trimestre: 1,
            unidad_funcional: 1,
            gerencia: 1,
            jefatura_final: 1,
            forecasts: 1,
            is_closed: 1
        };

        // Total + página actual de sites
        const [totalResults, forecast] = await Promise.all([
            provForecast.countDocuments(q),
            provForecast
                .find(q, forecastProjection)
                .sort({
                    [safeSortBy]: safeSortDirection,
                    _id: -1,
                })
                .skip(skip)
                .limit(perPage)
                .lean(),
        ]);

        // Si no hay sites, responder vacío
        if (!forecast.length) {
            return res.json({
                result: "OK",
                content: {
                    items: [],
                    totalResults: 0,
                    totalPages: 0,
                    currentPage,
                },
            });
        }

        return res.json({
            result: "OK",
            content: {
                items: forecast,
                totalResults,
                totalPages: Math.ceil(totalResults / perPage),
                currentPage
            },
        });


    } catch (e) {

        console.error(e);
        return res.status(500).json({ result: "ERROR" });
    }

});

// UPDATE PROJECTS
managerRouter.patch(
    "/forecast/update/projects",
    uploadTicketExcel.any(),
    async (req, res) => {
        try {
            const { provForecast } = await db();

            const payload = JSON.parse(req.body.payload)
            const { 
                action,
                itemsForecast
            } = payload

            console.log("action", action)
            console.log("itemsForecast", itemsForecast)

            if (!Array.isArray(itemsForecast) || itemsForecast.length === 0) {
                return res.status(400).json({
                    result: "NOK",
                    msg: "itemsForecast es requerido y debe ser un array.",
                });
            }

            // Actualizar provForecast
            const bulkOps = itemsForecast
                .map((item) => {

                    if (!item._id || !item.forecasts) {
                        return null;
                    }
      
                    const setFields = {
                        // liquidacion: toNumberOrNull(item.liquidacion),
                        // forecasts: item.forecasts,
                        "forecasts.new": item.forecasts["new"]
                    };

                    if (action === "GENERATE") {
                        setFields.is_closed = true;
                    }

                    return {
                        updateOne: {
                            filter: { _id: item._id },
                            update: {
                                $set: setFields,
                            },
                        },
                    };
                })
                .filter(Boolean);

            if (!bulkOps.length) {
                return res.status(404).json({
                    result: "NOK",
                    msg: "No hay sitios para actualizar",
                });
            }

            await provForecast.bulkWrite(bulkOps, { ordered: false });

            return res.json({
                result: "OK",
                msg:
                    action === "SAVE"
                        ? "Forecast guardada correctamente."
                        : "Forecast generada correctamente.",
                action
            });

        } catch (e) {
            console.log(e)
            return res.status(500).json({
                result: "NOK",
                msg: "Error interno",
            })
        }
    }
);


// UPDATE TEMPLATE
managerRouter.route("/insert-forecast-template")
    .post(async (req, res) => {

        let response = { result: 'NOK' }

        try {

            const { provForecast } = await db();
            const parsedSites = req.body

            if (!Array.isArray(parsedSites) || parsedSites.length === 0) {
                return res.status(400).json({
                    result: "NOK",
                    msg: "Se requiere un array con datos para insertar.",
                });
            }

            console.log("PARSED SITES", parsedSites)
            const docsToInsert = []

            for (let input of parsedSites) {
                docsToInsert.push({
                    ...input
                })
            }

            console.log("DOCS TO INSERT", docsToInsert)

            // Save history
            // Later

            // Delete all
            const deleteResult = await provForecast.deleteMany({});

            // Insert all
            const res = await provForecast.insertMany(docsToInsert);

            response.content = res
            response.result = 'OK';

        } catch (e) {
            console.error(e);
            response.result = 'ERROR';
        }
        res.json(response);
    });

module.exports = managerRouter;