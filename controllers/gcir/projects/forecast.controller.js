const express = require('express');
const db = require('../../../db');
require("dotenv").config();

const {
    escapeRegex,
    getPagination,
    getSort,
    cleanDistinct
} = require("./_helpers");

const { updateTaskForecast } = require("./workflowEngine");

const forecastRouter = express.Router();

// GET DATES
forecastRouter.get("/instances/:instanceId/forecasts", async(req, res) => {
    try {
        const { provWfInstances } = await db();

        const instance = await provWfInstances.findById(
            req.params.instanceId,
            {
                identificador: 1,
                workflow_code: 1,
                workflow_start_date: 1,
                nodes: 1,
            }
        ).lean();

        if (!instance) {
            return res.status(404).json({
                result: "ERROR",
                message: "Instancia no encontrada"
            });
        }

        return res.json({
            result: "OK",
            content: {
                instance_id: instance._id,
                identificador: instance.identificador,
                workflow_code: instance.workflow_code,
                workflow_start_date: instance.workflow_start_date,
                items: (instance.nodes || []).map(node => ({
                    task_code: node.task_code,
                    task_name: node.task_name,
                    status: node.status,
                    participants: node.participants,
                    forecast: node.forecast
                }))
            }
        });
    } catch (e) {
        console.error("GET forecasts:", e);
        return res.status(500).json({ result: "ERROR" });
    }
});

// FILTER OPTIONS
forecastRouter.get("/instances/:instanceId/forecasts/history/filter-options", async(req, res) => {
    try {
        const { provWfEvents } = await db();

        const q = {
            instance_id: req.params.instanceId,
            event_type: "FORECAST_UPDATED"
        };

        const [task_code, performed_by, forecast_type] = await Promise.all([
            cleanDistinct(provWfEvents, "task_code"),
            cleanDistinct(provWfEvents, "performed_by"),
            cleanDistinct(provWfEvents, "data.type")
        ]);

        return res.json({
            result: "OK",
            content: {
                task_code,
                performed_by,
                forecast_type
            }
        });
    } catch (e) {
        console.error("GET forecast history/filter-options:", e);
        return res.status(500).json({ result: "ERROR" });
    }
});


// HISTORIAL DE MODIFICACIONES DE FORECAST
forecastRouter.get("/instances/:instanceId/forecasts/history", async(req, res) => {
    try {
        const { provWfEvents } = await db();

        const {
            task_code,
            performed_by,
            forecast_type,
            date_from,
            date_to,
            search = "",
            page = 1,
            limit = 20
        } = req.query;

        const { currentPage, perPage, skip } = getPagination({ page, limit: 200 });

        const q = {
            instance_id: req.params.instanceId,
            event_type: "FORECAST_UPDATED"
        };

        if (task_code) q.task_code = task_code;
        if (performed_by) q.performed_by = performed_by;
        if (forecast_type) q["data.type"] = forecast_type;

        if (date_from || date_to) {
            q.event_at = {};
            if (date_from) q.event_at.$gte = new Date(date_from);
            if (date_to) q.event_at.$lte = new Date(date_to);
        }

        if (String(search).trim()) {
            const rx = new RegExp(escapeRegex(String(search).trim()), "i");
            q.$or = [
                { comment: rx },
                { task_code: rx },
                { "data.reason": rx }
            ];
        }

        const [totalResults, items] = await Promise.all([
            provWfEvents.countDocuments(q),
            provWfEvents.find(q)
                .sort({ event_at: -1, _id: -1 })
                .skip(skip)
                .limit(perPage)
                .lean()
        ]);

        return res.json({
            result: "OK",
            content: {
                items,
                totalResults,
                totalPages: Math.ceil(totalResults / perPage),
                currentPage
            }
        });
    } catch (e) {
        console.error("GET forecast history:", e);
        return res.status(500).json({ result: "ERROR" });
    }
});


// ACTUALIZAR FORECAST DE UNA TAREA
forecastRouter.patch("/instances/:instanceId/tasks/:taskCode/forecast", async(req, res) => {
    try {
        const models = await db();

        const { instanceId, taskCode } = req.params;
        const {
            forecast_date,
            forecast_source,
            type = "CHANGE",
            reason,
            user_id
        } = req.body;

        if (!user_id) {
            return res.status(400).json({
                result: "ERROR",
                message: "user_id es requerido"
            });
        }

        const result = await updateTaskForecast({
            instanceId,
            taskCode,
            forecastDate: forecast_date,
            type,
            // responisble_source,
            forecastSource: forecast_source,
            reason,
            userId: user_id,
            models
        });

        return res.json({ result: "OK", content: result });
    } catch (e) {
        return res.status(400).json({ result: "ERROR", message: e.message });
    }
});

// ACTUALIZAR FORECAST MASIVAMENTE
forecastRouter.patch("/forecasts/bulk", async(req, res) => {
    try {
        const models = await db();
        const { task_code, user_id, items = [] } = req.body;

        if (!task_code || !items.length) {
            return res.status(400).json({ 
                result: "ERROR", 
                message: "task_code e items requeridos" 
            });
        } 

        const results = [];

        for (const row of items) {
            try {
                const content = await updateTaskForecast({
                    instanceId: row.instance_id,
                    taskCode: task_code,
                    forecastDate: row.forecast_date,
                    type: row.type || "CHANGE",
                    reason: row.reason,
                    userId: user_id,
                    models
                });
                results.push({ 
                    instance_id: row.instance_id, 
                    result: "OK", content 
                });
            } catch (e) {
                results.push({ 
                    instance_id: row.instance_id, 
                    result: "ERROR", 
                    message: e.message 
                });
            }
        }

        const success = results.filter(x => x.result === "OK").length;

        return res.json({
            result: success === results.length ? "OK" : "PARTIAL",
            content: { 
                requested: results.length, 
                success, 
                failed: results.length - success, 
                items: results 
            }
        });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});


module.exports = forecastRouter;