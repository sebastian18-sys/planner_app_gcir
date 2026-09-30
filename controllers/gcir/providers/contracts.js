const express = require('express');
const db=require('../../../db');
const listToSend = require('../../../utils/list-send-directory');
const { sendEmail, generateInfoHTML } = require('../../../utils/send-email');
const { dateFormat, GetActualDate } = require('../../../utils/dates');
//var CONTRACT = require('../../../models/gcir/providers/contracts');

const fs = require('fs');
const XLSX = require('xlsx');
var json2xls = require('json2xls');
const schedule = require('node-schedule');
const {join} = require("path");
const path = require('path');
//const mainPath = '/var/www/html/planner/resources/files/gcir/providers/';

const mainPath = '/data/html/gcir/resources/files/gcir/providers/';
const managerRouter = express.Router();

function updateNewLetterBailState (end_date) {
    let new_state
    const date = new Date() 
    const date_end_cf = dateFormat(end_date)
    const milisecons_month = 1000 * 60 * 60 * 24 * 30   
    
    if(!date_end_cf.getTime()) { 
        if(end_date === "NA") new_state = "NA"
        else new_state = "PENDIENTE"
    } else if(date_end_cf.getTime() <= date.getTime()) {
        new_state = 'VENCIDO';
    } else if(Math.abs(date_end_cf.getTime() - date.getTime()) <= milisecons_month) {
        new_state = 'PROXIMO A VENCER';
    } else {
        new_state = 'VIGENTE';
    }
    
    return new_state
}

function updateNewStateContracts (end_date) {
    let new_state
    const date = new Date() 
    const date_end = dateFormat(end_date)

    if(!date_end.getTime()) {
        new_state = "NA"
    } else if(date_end.getTime() <= date.getTime()) {
        new_state = 'VENCIDO'
    } else {
        new_state = 'VIGENTE'
    }

    return new_state

}

// first -> Original Data
// Second -> New Data
function filterNoExistOldData(firstArray, secondArray) {
    return firstArray.filter(obj1 => 
        !secondArray.some(obj2 => 
            (obj2.provider === obj1.provider) && 
            (obj2.number_contract.toString() === obj1.number_contract.toString()) &&
            (obj2.pa === obj1.pa)
        )
    );
}

managerRouter.route('/download')
    .get(async (req, res) => {
        const fileParam = req.query.file; // /download?file=contracts/archivo.pdf
        console.log(fileParam);
        // Sanitizar 'fileParam' según tus necesidades
        if (!fileParam || fileParam.includes('..')) {
            return res.status(400).send('Parámetro inválido');
        }

        // Construir la ruta
        // const basePath = path.join(__dirname, 'gcir/resources/files/gcir');
        basePath = "/data/html/gcir/resources/files/gcir";
        const fullPath = path.join(basePath, fileParam);

        console.log(fullPath);

        // Verificar si existe
        if (!fs.existsSync(fullPath)) {
            return res.status(404).send('Archivo no encontrado');
        }

        

        // Enviar el archivo como descarga
        res.download(fullPath, path.basename(fullPath), (err) => {
            if (err) {
            console.error('Error al descargar archivo:', err);
            return res.status(500).send('Error al descargar el archivo');
            }
        });
    })

managerRouter.route('/get-data')
    .get(async (req, res) => {

        let response = {result: 'NOK'}, body = req.body;
        const { provContracts }=await db()
        try {

            response.content = await provContracts.find().lean();
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });


managerRouter.route('/get-pa-contracts')
    .get(async (req, res) => {
        let response = { result: 'NOK' };

        try {
        const { provContracts } = await db();
        const { status_final, area, provider } = req.query;

        const q = {};   

        if(status_final) q.status_final = status_final;
        if(area) q.area = area;
        if(provider) q.provider = provider;

        // Traer solo los campos necesarios (y las fechas para calcular maxDate)
        const contracts = await provContracts
            .find(
            q,
            {
                provider: 1,
                area: 1,
                number_contest: 1,
                status_final: 1,
                pa: 1,
                amount_agreement: 1,
                end_date: 1,
                end_date_addendum: 1,
                end_date_addendum_two: 1,
                _id: 0, // quítalo si quieres devolver _id
            }
            )
            .lean();

        const now = new Date();

        const content = contracts.map((c) => {

            const d = new Date(dateFormat(c.end_date));
            const d1 = new Date(dateFormat(c.end_date_addendum));
            const d2 = new Date(dateFormat(c.end_date_addendum_two));

            const validDates = [d, d1, d2].filter(dt => !Number.isNaN(dt.getTime()));

            const maxDate = validDates.length
            ? new Date(Math.max(...validDates.map(dt => dt.getTime())))
            : null;

            let status_date = 'SIN FECHA';

            if (maxDate) {
            const maxDateOnly = new Date(maxDate);
            maxDateOnly.setHours(0, 0, 0, 0);

            const thirtyDaysBefore = new Date(maxDateOnly);
            thirtyDaysBefore.setDate(thirtyDaysBefore.getDate() - 30);

            if (now > maxDateOnly) {
                status_date = 'VENCIDO';
            } else if (now >= thirtyDaysBefore && now <= maxDateOnly) {
                status_date = 'PROXIMO A VENCER';
            } else {
                status_date = 'VIGENTE';
            }
            }

            return {
                provider: c.provider,
                area: c.area,
                number_contest: c.number_contest,
                status_final: c.status_final,
                pa: c.pa,
                amount_agreement: c.amount_agreement,
                maxDate,      // si quieres string: maxDate ? maxDate.toISOString() : null
                status_date,  // VIGENTE | PROXIMO A VENCER | VENCIDO | SIN FECHA
            };
        });

        response.content = content;
        response.result = 'OK';
        } catch (e) {
        console.log(e);
        response.error = e.message;
        }

        res.json(response);
    });

// GET UNIQUE PAs FILTERS
managerRouter.get("/get-pa-filter-options", async (req, res) => {
    try {
        const { provContracts } = await db();

        const cleanDistinct = async (field, q = {}) => {
            const values = await provContracts.distinct(field, {
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

        const [
            status_final,
            area,
            provider
        ] = await Promise.all([
            cleanDistinct("status_final"),
            cleanDistinct("area"),
            cleanDistinct("provider")
        ]);

        return res.json({
            result: "OK",
            content: {
                status_final: status_final,
                area: area,
                provider: provider
            },
        });
    } catch (e) {
        console.error("Error get-pa-filter-options:", e);
        return res.status(500).json({
            result: "ERROR",
            message: "Error al obtener opciones de filtros",
        });
    }
});

function escapeRegex(text = "") {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const n = (v) => {
    const num = Number(v);
    return Number.isFinite(num) ? num : 0;
};

const normalizeStringExpr = (field) => ({
    $trim: {
        input: {
            $convert: {
                input: field,
                to: "string",
                onError: "",
                onNull: "",
            },
        },
    },
});

const moneyToDoubleExpr = (field) => ({
    $let: {
        vars: { v: field },
        in: {
            $convert: {
                input: {
                    $cond: [
                        { $eq: [{ $type: "$$v" }, "string"] },
                        {
                            $replaceAll: {
                                input: {
                                    $replaceAll: {
                                        input: "$$v",
                                        find: ",",
                                        replacement: "",
                                    },
                                },
                                find: " ",
                                replacement: "",
                            },
                        },
                        "$$v",
                    ],
                },
                to: "double",
                onError: 0,
                onNull: 0,
            },
        },
    },
});

const buildImporteMap = (rows = []) => {
    const map = new Map();

    for (const it of rows) {
        const key = String(it.acuerdo ?? "").trim();
        if (key) {
            map.set(key, n(it.importe_acuerdo));
        }
    }

    return map;
};

const getStatusDate = (c) => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const dates = [
        c.end_date,
        c.end_date_addendum,
        c.end_date_addendum_two,
    ]
        .map((x) => {
            const d = new Date(dateFormat(x));
            return Number.isNaN(d.getTime()) ? null : d;
        })
        .filter(Boolean);

    const maxDate = dates.length
        ? new Date(Math.max(...dates.map((dt) => dt.getTime())))
        : null;

    let statusDate = "SIN FECHA";

    if (maxDate) {
        const maxDateOnly = new Date(maxDate);
        maxDateOnly.setHours(0, 0, 0, 0);

        const thirtyDaysBefore = new Date(maxDateOnly);
        thirtyDaysBefore.setDate(thirtyDaysBefore.getDate() - 30);

        if (now > maxDateOnly) {
            statusDate = "VENCIDO";
        } else if (now >= thirtyDaysBefore && now <= maxDateOnly) {
            statusDate = "PROXIMO A VENCER";
        } else {
            statusDate = "VIGENTE";
        }
    }

    return {
        maxDate,
        statusDate,
    };
};

managerRouter.get("/get-pa-contracts-q", async(req, res) => {
    try {

        const { provContracts } = await db();

        const {
            status_final,
            area,
            provider,
            search = "",
            page = 1,
            limit = 10,
            sortBy = "ticket_code",
            sortDirection = "desc"
        } = req.query;

        // Paginación
        const currentPage = Math.max(parseInt(page, 10) || 1, 1);
        const perPage = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 5000);
        const skip = (currentPage - 1) * perPage;

        // Campos permitidos para ordenar
        const allowedSortFields = new Set([
            "pa",
            "provider",
            "area",
            "number_contest",
            "amount_agreement"
        ]);

        const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "ticket_code";
        const safeSortDirection = String(sortDirection).toLowerCase() === "asc" ? -1 : 1;

        // Query base de sites
        const q = {};
        
        if (status_final) q.status_final = status_final;
        if (area) q.area = area;
        if (provider) q.provider = provider;

        // Búsqueda
        if (String(search).trim()) {
            const rx = new RegExp(escapeRegex(String(search).trim()), "i");

            q.$or = [
                { pa: rx },
                { provider: rx }
            ];
        }

        const paProjection = {
            provider: 1,
            area: 1,
            proceso: 1,
            number_contest: 1,
            status_final: 1,
            pa: 1,
            amount_agreement: 1,
            end_date: 1,
            end_date_addendum: 1,
            end_date_addendum_two: 1,
            _id: 1
        };

        // Total + página actual de sites
        const [totalResults, pa] = await Promise.all([
            provContracts.countDocuments(q),
            provContracts
                .find(q, paProjection)
                .sort({
                    [safeSortBy]: safeSortDirection,
                    _id: -1,
                })
                .skip(skip)
                .limit(perPage)
                .lean(),
        ]);

        // Si no hay sites, responder vacío
        if (!pa.length) {
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

        const now = new Date();

        const content = pa.map((c) => {

            const d = new Date(dateFormat(c.end_date));
            const d1 = new Date(dateFormat(c.end_date_addendum));
            const d2 = new Date(dateFormat(c.end_date_addendum_two));

            const validDates = [d, d1, d2].filter(dt => !Number.isNaN(dt.getTime()));

            const maxDate = validDates.length
            ? new Date(Math.max(...validDates.map(dt => dt.getTime())))
            : null;

            let status_date = 'SIN FECHA';

            if (maxDate) {
            const maxDateOnly = new Date(maxDate);
            maxDateOnly.setHours(0, 0, 0, 0);

            const thirtyDaysBefore = new Date(maxDateOnly);
            thirtyDaysBefore.setDate(thirtyDaysBefore.getDate() - 30);

            if (now > maxDateOnly) {
                status_date = 'VENCIDO';
            } else if (now >= thirtyDaysBefore && now <= maxDateOnly) {
                status_date = 'PROXIMO A VENCER';
            } else {
                status_date = 'VIGENTE';
            }
            }

            return {
                provider: c.provider,
                area: c.area,
                number_contest: c.number_contest,
                status_final: c.status_final,
                pa: c.pa,
                amount_agreement: c.amount_agreement,
                maxDate,      // si quieres string: maxDate ? maxDate.toISOString() : null
                status_date,  // VIGENTE | PROXIMO A VENCER | VENCIDO | SIN FECHA
            };
        });


        return res.json({
            result: "OK",
            content: {
                items: content,
                totalResults,
                totalPages: Math.ceil(totalResults / perPage),
                currentPage
            },
        });


    } catch (e) {

        console.error(e);
        return res.status(500).json({ result: "ERROR" });
    }

})

managerRouter.get("/get-pa-contracts-q2", async(req, res) => {

    try {

        const { provContracts, provRQ_agrupado, provSites } = await db();

        const {
            status_final,
            area,
            provider,
            search = "",
            page = 1,
            limit = 10,
            sortBy = "ticket_code",
            sortDirection = "desc",
        } = req.query;

        const currentPage = Math.max(parseInt(page, 10) || 1, 1);
        const perPage = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 5000);
        const skip = (currentPage - 1) * perPage;

        const allowedSortFields = new Set([
            "pa",
            "provider",
            "area",
            "number_contest",
            "amount_agreement",
            "status_final",
        ]);

        const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "ticket_code";

        const safeSortDirection =
            String(sortDirection).toLowerCase() === "asc" ? 1 : -1;

        const q = {};

        if (status_final) q.status_final = status_final;
        if (area) q.area = area;
        if (provider) q.provider = provider;

        if (String(search).trim()) {
            const rx = new RegExp(escapeRegex(String(search).trim()), "i");

            q.$or = [
                { pa: rx },
                { provider: rx },
                { area: rx },
                { number_contest: rx },
            ];
        }

        const paProjection = {
            provider: 1,
            area: 1,
            proceso: 1,
            number_contest: 1,
            status_final: 1,
            pa: 1,
            amount_agreement: 1,
            end_date: 1,
            end_date_addendum: 1,
            end_date_addendum_two: 1,
            _id: 1,
        };

        const [totalResults, contracts] = await Promise.all([
            provContracts.countDocuments(q),
            provContracts
                .find(q, paProjection)
                .sort({
                    [safeSortBy]: safeSortDirection,
                    _id: -1,
                })
                .skip(skip)
                .limit(perPage)
                .lean(),
        ]);

        if (!contracts.length) {
            return res.json({
                result: "OK",
                content: {
                    items: [],
                    totalResults,
                    totalPages: Math.ceil(totalResults / perPage),
                    currentPage,
                },
            });
        }

        const paKeys = [
            ...new Set(
                contracts
                    .map((c) => String(c.pa ?? "").trim())
                    .filter(Boolean)
            ),
        ];

        let rqRows = [];
        let ticketRows = [];

        if (paKeys.length) {
            const rqPipeline = [
                {
                    $match: {
                        Acuerdo: { $exists: true, $ne: "" },
                    },
                },
                {
                    $addFields: {
                        __pa: normalizeStringExpr("$Acuerdo"),
                        __cot: moneyToDoubleExpr("$Importe RQ"),
                    },
                },
                {
                    $match: {
                        __pa: { $in: paKeys },
                    },
                },
                {
                    $group: {
                        _id: "$__pa",
                        importe_acuerdo: { $sum: "$__cot" },
                        proveedor: { $first: "$Proveedor" },
                    },
                },
                {
                    $project: {
                        _id: 0,
                        acuerdo: "$_id",
                        importe_acuerdo: 1,
                        proveedor: 1,
                    },
                },
            ];

            const ticketPipeline = [
                {
                    $match: {
                        acuerdo_compras: { $exists: true, $ne: "" },
                        // estado: { $nin: ["RQ Generado", "Cancelado"] },
                        estado: { $in: ["Pendiente CT", "Enviado a MG", "Observado"] }
                    },
                },
                {
                    $addFields: {
                        __pa: normalizeStringExpr("$acuerdo_compras"),
                        __cot: moneyToDoubleExpr("$total_cotizacion"),
                    },
                },
                {
                    $match: {
                        __pa: { $in: paKeys },
                    },
                },
                {
                    $group: {
                        _id: "$__pa",
                        importe_acuerdo: { $sum: "$__cot" },
                        proveedor: { $first: "$proveedor" },
                    },
                },
                {
                    $project: {
                        _id: 0,
                        acuerdo: "$_id",
                        importe_acuerdo: 1,
                        proveedor: 1,
                    },
                },
            ];

            [rqRows, ticketRows] = await Promise.all([
                provRQ_agrupado.aggregate(rqPipeline).allowDiskUse(true).exec(),
                provSites.aggregate(ticketPipeline).allowDiskUse(true).exec(),
            ]);
        }

        const liberadoMap = buildImporteMap(rqRows);
        const solicitadoMap = buildImporteMap(ticketRows);

        const items = contracts.map((c) => {
            const pa = String(c.pa ?? "").trim();

            const { maxDate, statusDate } = getStatusDate(c);

            const habilitado = n(c.amount_agreement);
            const liberado = liberadoMap.get(pa) ?? 0;
            const solicitado = solicitadoMap.get(pa) ?? 0;

            const pendiente = habilitado - liberado;

            return {
                pa,
                proveedor: c.provider,
                area: c.area,
                concurso: c.number_contest,
                fecha_vigencia: maxDate,
                status_fecha: statusDate,
                status_final: c.status_final,
                habilitado,
                solicitado,
                liberado,
                pendiente,
            };
        });

        return res.json({
            result: "OK",
            content: {
                items,
                totalResults,
                totalPages: Math.ceil(totalResults / perPage),
                currentPage,
            },
        });

    } catch (e) {
        console.error(e);
        return res.status(500).json({
            result: "ERROR",
            msg: String(e.message ?? e),
        });
    }

})


managerRouter.route('/get-data/:id')
    .get(async (req, res) => {

        const { provContracts }=await db()
        let response = {result: 'NOK'}, body = req.body;
        
        try {
            response.content = await provContracts.findOne({ _id: req.params.id});
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    })

managerRouter.route('/save-data')
    .post(async (req, res) => {

        let response = {result: 'NOK'}, body = req.body;
        const { provContracts }=await db()
        try {

            response.content = await provContracts.create(body);
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });
    

managerRouter.route('/update-data')
    .post(async (req, res) => {

        const { provContracts }=await db()
        let response = { result: 'NOK' }, body = req.body;

        try {

            response.content = await provContracts.findByIdAndUpdate(
                { _id: body._id },
                body,
                {
                    new: true
                }
            );

            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });


managerRouter.route('/export-to-xlsx')
    .post(async (req, res) => {

        let response = {result: 'NOK'}, body = req.body;

        try {
            //body.data = await provDirectory.find()
            var data = body.data;

            var xls = json2xls(data);
            //let path =join(__dirname,'../../../../gcir/resources/files/gcir/providers/' + body.fileName + '.xls');
            let path = mainPath + body.fileName + '.xls';
            console.log(path)

            if (fs.existsSync(path)) {
                fs.unlinkSync(path);
            }

            fs.writeFileSync(path, xls, 'binary');

            response.result = 'OK';
            //response.path = '/planner/resources/files/gcir/providers/' + body.fileName + '.xls';
            response.path = '/gcir/resources/files/gcir/providers/' + body.fileName + '.xls';

        }catch (e) {

            console.log(e);
        }

        const rest = res.json(response);
        console.log(rest)
    });

managerRouter.route('/load-to-db')
    .post(async (req, res) => {

        let response = {result: 'NOK'}, body = req.body;
        const { provContracts }=await db()
        const { provHistory } = await db()

        /**
         * Guardar los datos anteriores en el histórico
         */
        let previus_data = await provContracts.find();
        await provHistory.create({
            original_data: previus_data,
            date_change: GetActualDate(),
            user_change: body.user,
            event_change: "insert-massive",
            document: "contracts"
        });

        try {
            // await provContracts.remove();

            let path = body.path;

            let workbook = XLSX.readFile(path,{ type: 'string', raw:true, sheetStubs: true });
            let doc = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

            response.result = 'OK';
            response.content = doc;

            let uniqueElements = filterNoExistOldData(previus_data, doc);

            console.log("uniqueElements: ", uniqueElements)

            // Remove old data if not found in new data
            await provContracts.deleteMany({
                _id: {$in: uniqueElements.map(s => s._id)}
            })

            for (let provider of doc){
                provider.id_detail = parseInt(provider.id_detail) || 0;
                provider.state = provider.status_contract === "FIRMADO" && (provider.status_addendum === "NA" || "FIRMADO") ? "VIGENTE" : (provider.status_contract === "NA" && provider.status_addendum === "NA") ? "NA" : "VENCIDO";
                provider.letter_bail = updateNewLetterBailState(provider.end_date_validity_cf);
                provider.number_contract = provider.number_contract.toString();
                provider.pa = provider.pa.toString();
     
                let existent_provider = await provContracts.findOneAndUpdate({
                    provider: provider.provider,
                    number_contract: provider.number_contract,
                    pa: provider.pa,
                }, provider);

                if (!existent_provider) {
                    provider.data_files_evidence = [];
                    provider.comments = [];
                    await provContracts.create(provider);
                }
            }

        }catch (e) {
            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/update-state-letter-bail')
    .get(async (req, res) => {
        const { provContracts }=await db()
        
        let rule = new schedule.RecurrenceRule();
        rule.hour = 8;
        rule.minute = 0;
        rule.second = 0;
        rule.dayOfWeek = new schedule.Range(0, 6);

        schedule.scheduleJob(rule, async function () {
            console.log('this will run everyday at 8:00am');

            let contracts = await provContracts.find();

            for (let contract of contracts) {
                let new_state_letter_bail = contract.letter_bail === "PENDIENTE DE REVISIÓN" || contract.letter_bail === "PENDIENTE" ? contract.letter_bail : updateNewLetterBailState(contract.end_date_validity_cf)
                // let new_state_contract = updateNewStateContracts(contract.end_date)
                if (new_state_letter_bail !== contract.letter_bail) {

                    //update letter bail
                    await provContracts.findByIdAndUpdate(
                        { _id: contract._id },
                        { letter_bail: new_state_letter_bail },
                        {
                            new: true
                        }
                    );
                }

                // if (new_state_contract !== contract.state) {

                //     //update contract
                //     await provContracts.findByIdAndUpdate(
                //         { _id: contract._id },
                //         { state: new_state_contract },
                //         {
                //             new: true
                //         }
                //     );
                // }
            }
        });   
        
        res.json({result:'OK'});
    })

managerRouter.route('/send-notification-state-contracts')
    .get(async (req, res) => {
        const { provContracts, provSettings }= await db()

        let rule = new schedule.RecurrenceRule();
        rule.hour = 8;
        rule.minute = 20;
        rule.second = 0;
        rule.dayOfWeek = new schedule.Range(0, 6);

        let setting = await provSettings.find();

        // Settings STANDAR VALUES
        const days_of_expiration_contract = setting[0].contracts_settings.contract_addendum[0].notification_day;
        const reminder_expiration_contract = setting[0].contracts_settings.contract_addendum[0].reminder;
        const cc_expiration_contract = setting[0].contracts_settings.contract_addendum[0].cc;

        schedule.scheduleJob(rule, async function () {
            console.log('this will run everyday at 8:20am');

            let contracts = await provContracts.find();
            let responsable = ['beatriz.montoya@entel.pe'];
            let cc = cc_expiration_contract;
            let intervalDays;

            for (let contract of contracts) {
                
                const date = new Date() 
                const date_end_cf = dateFormat(contract.end_date)
                const timeDiff = (date_end_cf.getTime() - date.getTime())
                const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24))

                let link = 'http://10.30.17.57/gcir/proveedores/contratos-estadisticas/' + contract._id;

                if(daysDiff <= days_of_expiration_contract && daysDiff >= 0){  //PROXIMO A VENCER in 4 months
                    intervalDays = reminder_expiration_contract
                    if((daysDiff % intervalDays) === 0) {   //Send notify every 30 days
                        await sendEmail(
                            'normal',
                            '"Planner Notifier" <planner.notifier@entel.net.pe>',
                            responsable,
                            cc,
                            'CONTRATO PRÓXIMO A VENCER',
                            generateInfoHTML({
                                title: "CONTRATO ADENDA",
                                message: `
                                <p>Estimado(a) <a href="mailto:beatriz.montoya@entel.pe">@beatriz.montoya@entel.pe</a>:</p>
                                    <p>El contrato del concurso: <b>${contract.number_contest}</b> correspondiente al proveedor ${contract.provider} (${contract.area}) se encuentra PROXIMO A VENCER el día ${contract.end_date}.</p>
                                    <p>Puede revisar el estado del contrato en el siguiente link:</p>
                                    <a href="${link}">${link}</a>
                                    <p>Atentamente</p>
                                `
                            })
                        );
                    }
                }
            }
        })

        res.json({result:'OK'});

    })


managerRouter.route('/send-notification-letter-bail-contracts')
    .get(async (req, res) => {
        const { provContracts, provDirectory, provSettings }= await db()

        let rule = new schedule.RecurrenceRule();
        rule.hour = 8;
        rule.minute = 5;
        rule.second = 0;
        rule.dayOfWeek = new schedule.Range(0, 6);

        schedule.scheduleJob(rule, async function () {
            console.log('this will run everyday at 8:05am');

            let contracts = await provContracts.find();
            let directory_workers = await provDirectory.find();
            let setting = await provSettings.find();

            // Settings STANDAR VALUES
            const LIST_TO_SEND = setting[0].contracts_settings.list_to_send;
            const days_of_expiration_letter = setting[0].contracts_settings.letter_bail[0].notification_day;
            const reminder_expiration_letter = setting[0].contracts_settings.letter_bail[0].reminder;
            const cc_expiration_letter = setting[0].contracts_settings.letter_bail[0].cc;
            const reminder_end_letter = setting[0].contracts_settings.letter_bail[1].reminder
            const cc_end_letter = setting[0].contracts_settings.letter_bail[1].cc;

            for (let contract of contracts) {

                let to_workers = [],
                intervalDays;

                let worker_for_company = directory_workers.filter(w => w.business_name === contract.provider) //5
                                    
                for(let worker_email of worker_for_company) {
                    if(LIST_TO_SEND.includes(worker_email.email)) {
                        to_workers.push(worker_email.email);
                    }
                }

                const date = new Date() 
                const date_end_cf = dateFormat(contract.end_date_validity_cf)
                const timeDiff = (date_end_cf.getTime() - date.getTime())
                const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24))

                let link = 'http://10.30.17.57/gcir/proveedores/contratos-estadisticas/' + contract._id;


                if(contract.letter_bail === "PROXIMO A VENCER"){
                    intervalDays = reminder_expiration_letter
                    if(daysDiff <= days_of_expiration_letter && daysDiff >= 0){  //PROXIMO A VENCER in 30 days
                        if((daysDiff % intervalDays) === 0) {   //Send notify every 7 days
                            await sendEmail(
                                'normal',
                                '"Planner Notifier" <planner.notifier@entel.net.pe>',
                                to_workers,
                                cc_expiration_letter,
                                'CARTA FIANZA PROXIMO A VENCER',
                                generateInfoHTML({
                                    title: "CARTA FIANZA",
                                    message: `
                                        <p>Estimado ${contract.provider}:</p>
                                        <p>Su CARTA FIANZA del ${contract.number_contest} se encuentra PROXIMO A VENCER el día ${contract.end_date_validity_cf}.</p>
                                        <p>Por favor, realizar las gestiones necesarias, cargar el nuevo documento vigente y datos solicitados en el siguiente link de la plataforma de proveedores de la GCIR:</p>
                                        <a href="${link}">${link}</a>
                                        <p>Atentamente, COMITE DE CALIDAD GCIR.</p>
                                    `
                                })
                            );
                        }
                        
                    }
                }
    
                if(contract.letter_bail === "VENCIDO"){
                    intervalDays = reminder_end_letter
                    if(daysDiff <= 0) {  //VENCIDO
                        if((daysDiff % intervalDays) === 0) {  //Every 2 days from state = VENCIDO
                            await sendEmail(
                                'normal',
                                '"Planner Notifier" <planner.notifier@entel.net.pe>',
                                to_workers,
                                cc_end_letter,
                                'CARTA FIANZA VENCIDA',
                                generateInfoHTML({
                                    title: "CARTA FIANZA",
                                    message: `
                                        <p>Estimado ${contract.provider}:</p>
                                        <p>Su CARTA FIANZA del ${contract.number_contest} se encuentra VENCIDA desde la fecha ${contract.end_date_validity_cf}.</p>
                                        <p>La asignación de trabajos se encuentra BLOQUEADA para su representada, hasta la regularización del documento.</p>
                                        <p>Por favor, realizar las gestiones necesarias, cargar el nuevo documento vigente y datos solicitados en el siguiente link de la plataforma de proveedores de la GCIR:</p>
                                        <a href="${link}">${link}</a>
                                        <p>Atentamente, COMITE DE CALIDAD GCIR.</p>
                                    `
                                })
                            );
                        }
                    }
                }
            }
        });   
        
        res.json({result:'OK'});
    })


module.exports = managerRouter;