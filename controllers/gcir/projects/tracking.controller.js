const express = require('express');
const db = require('../../../db');
require("dotenv").config();

const {
    escapeRegex,
    getPagination,
    getSort,
    cleanDistinct,
    mapSiteMetadata,
    parseColumnFilters
} = require("./_helpers");
const { updateTaskForecast } = require('./workflowEngine');

const trackingRouter = express.Router();


function getForecastField(source) {
    switch (
        String(
            source || "CURRENT"
        ).toUpperCase()
    ) {
        case "SLA":
            return "forecast.sla_date"

        case "RESPONSIBLE":
            return "forecast.responsible_date"

        case "PM":
            return "forecast.pm_date"

        case "CURRENT":
        default:
            return "forecast.current_date"
    }
}

function toDateKey(value) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function getTaskSummaryFilterValue(summary) {
    if (summary?.ok) return "OK";

    if (summary?.forecast_date) {
        return toDateKey(summary.forecast_date);
    }

    return "EMPTY";
}


function getForecastValue(
    forecast,
    source
) {
    switch (String(source || "CURRENT").toUpperCase()) {
        case "SLA":
            return forecast?.sla_date || null

        case "RESPONSIBLE":
            return forecast?.responsible_date || null

        case "PM":
            return forecast?.pm_date || null

        case "CURRENT":
        default:
            return forecast?.current_date || null
    }
}

function getCurrentSubtask(node) {
    const subtasks = node?.subtasks || []

    return (
        subtasks.find(
            x =>
                ["ACTIVE", "OBSERVED"].includes(x.status)
        ) ||
        subtasks.find(
            x =>
                x.status === "WAITING"
        ) ||
        null
    )
}

function normalizeForecastDate(value) {
    if (!value) return null;

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
    }

    const text = String(value).trim();

    if (!text) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const date = new Date(`${text}T00:00:00.000Z`);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
}

function sameForecastDate(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;

    const da = new Date(a);
    const db = new Date(b);

    if (
        Number.isNaN(da.getTime()) ||
        Number.isNaN(db.getTime())
    ) {
        return false;
    }

    return (
        da.getUTCFullYear() === db.getUTCFullYear() &&
        da.getUTCMonth() === db.getUTCMonth() &&
        da.getUTCDate() === db.getUTCDate()
    );
}

function refreshCurrentForecastBulk(forecast = {}) {
    if (forecast.pm_date) {
        forecast.current_date = forecast.pm_date;
        forecast.source = "PM";
        return;
    }

    if (forecast.responsible_date) {
        forecast.current_date = forecast.responsible_date;
        forecast.source = "RESPONSIBLE";
        return;
    }

    forecast.current_date = forecast.sla_date || null;
    forecast.source = "AUTO_SLA";
}

// FILTER OPTIONS
trackingRouter.get("/tracking/filter-options", async (req, res) => {
    try {
        const { provWfInstances, provWfWorkflows } = await db();
        const { workflow_code } = req.query;

        const q = {};

        if (workflow_code) q.workflow_code = workflow_code;

        const [
            workflowCodes,
            task_codes,
            task_status,
            project_types
        ] = await Promise.all([
            cleanDistinct(provWfInstances, "workflow_code"),
            cleanDistinct(provWfInstances, "nodes.task_code"),
            cleanDistinct(provWfInstances, "nodes.status"),
            cleanDistinct(provWfInstances, "project_type_id")
        ]);

        const workflows = workflowCodes.length
            ? await provWfWorkflows.find(
                {
                    code: {
                        $in: workflowCodes
                    }
                },
                {
                    code: 1,
                    name: 1
                }
            ).lean()
            : [];

        const workflowMap = new Map(
            workflows.map(item => [
                String(item.code),
                item.name || item.code
            ])
        );

        return res.json({
            result: "OK",
            content: {
                workflow_code: workflowCodes.map(code => ({
                    value: String(code),
                    label: workflowMap.get(String(code)) || String(code)
                })),
                task_code: task_codes,
                task_status,
                project_type_id: project_types
            }
        });
    } catch (e) {
        console.error("GET tracking/filter-options:", e);
        return res.status(500).json({ result: "ERROR" });
    }
});

// GET ALL SITES
trackingRouter.get("/tracking", async(req, res) => {
    try {
        const { provWfInstances, provWfSites } = await db();

        const {
            workflow_code,
            task_code,
            task_status,
            instance_status,
            project_type_name,
            search = "",
            page = 1,
            limit = 20,
            sortBy = "updatedAt",
            sortDirection = "desc"
        } = req.query;

        const { currentPage, perPage, skip } = getPagination({ page, limit });

        const allowedSortFields = new Set(["identificador","workflow_code","workflow_start_date","createdAt","updatedAt"]);
        const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "updatedAt";
        const safeSortDirection = String(sortDirection).toLowerCase() === "asc" ? 1 : -1;

        const q = {};
        if (workflow_code) q.workflow_code = workflow_code;
        if (instance_status) q.status = instance_status;

        if (task_code || task_status) {
            const nodeMatch = {};
            if (task_code) nodeMatch.task_code = task_code;
            if (task_status) nodeMatch.status = task_status;
            q.nodes = { $elemMatch: nodeMatch };
        }

        if (String(search).trim()) {
            const rx = new RegExp(escapeRegex(String(search).trim()), "i");
            q.$or = [
                { identificador: rx },
                { workflow_code: rx },
                { "nodes.task_name": rx }
            ];
        }

        let siteIdsFilter = null;

        if (project_type_name) {
            const siteIds = await provWfSites.find(
                { project_type_name },
                { _id: 1 }
            ).lean();

            siteIdsFilter = siteIds.map(x => x._id);

            if (!siteIdsFilter.length) {
                return res.json({
                    result: "OK",
                    content: { items: [], totalResults: 0, totalPages: 0, currentPage }
                });
            }

            q.site_id = { $in: siteIdsFilter };
        }

        const [totalResults, instances] = await Promise.all([
            provWfInstances.countDocuments(q),
            provWfInstances.find(q)
                .sort({ [safeSortBy]: safeSortDirection, _id: -1 })
                .skip(skip)
                .limit(perPage)
                .lean()
        ]);

        const siteIds = instances.map(x => x.site_id);

        const sites = await provWfSites.find(
            { _id: { $in: siteIds } }
        ).lean();

        const siteMap = new Map(sites.map(x => [String(x._id), x]));

        const items = instances.map(instance => {
            const site = siteMap.get(String(instance.site_id));

            return {
                instance_id: instance._id,
                site_id: instance.site_id,
            
                ...mapSiteMetadata(site),

                workflow_code: instance.workflow_code,
                workflow_version: instance.workflow_version,
                status: instance.status,
                workflow_start_date: instance.workflow_start_date,
                nodes: (instance.nodes || []).map(node => ({
                    node_key: node.node_key,
                    task_code: node.task_code,
                    task_name: node.task_name,
                    status: node.status,
                    manual_opened: node.manual_opened,
                    reopen_correction: node.reopen_correction,
                    started_at: node.started_at,
                    finished_at: node.finished_at,
                    forecast: node.forecast,
                    subtasks: node.subtasks
                }))
            };
        });

        return res.json({
            result: "OK",
            content: {
                items,
                totalResults,
                totalPages: Math.ceil(totalResults / perPage),
                currentPage,
                perPage
            }
        });
    } catch (e) {
        console.error("GET tracking:", e);
        return res.status(500).json({ result: "ERROR" });
    }
});

// FLUJO
trackingRouter.get("/tracking/flow", async(req, res) => {
    try {
        const { provWfInstances, provWfVersions } = await db();

        const { workflow_code, workflow_version } = req.query;

        if (!workflow_code) {
            return res.status(400).json({
                result: "ERROR",
                message: "workflow_code requerido"
            });
        }

        const versionQuery = {
            workflow_code
        };

        if (workflow_version) {
            versionQuery.version = Number(workflow_version);
        } else {
            versionQuery.status = "PUBLISHED";
        }

        const version = await provWfVersions
            .findOne(versionQuery)
            .sort({
                version: -1
            })
            .lean();

        if (!version) {
            return res.status(404).json({
                result: "ERROR",
                message: "Workflow no encontrado"
            });
        }

        const instanceMatch = {
            workflow_code,
            workflow_version: version.version
        };

        const [rows, totalSites] = await Promise.all([
            provWfInstances.aggregate([
                {
                    $match: instanceMatch
                },
                {
                    $unwind: "$nodes"
                },
                {
                    $match: {
                        "nodes.task_code": {
                            $nin: [ null, "" ]
                        }
                    }
                },
                {
                    $group: {
                        _id: {
                            task_code: "$nodes.task_code",
                            status: "$nodes.status"
                        },
                        count: {
                            $sum: 1
                        }
                    }
                }
            ]),

            provWfInstances.countDocuments(instanceMatch)
        ]);

        const counts = {};

        rows.forEach(row => {
            const taskCode = row._id.task_code;
            const status = row._id.status;

            if (!counts[taskCode]) {
                counts[taskCode] = {};
            }
            counts[taskCode][status] = row.count;
        });

        return res.json({
            result: "OK",
            content: {
                workflow: {
                    version_id: version._id,
                    version: version.version,
                    nodes: version.nodes || [],
                    edges: version.edges || []
                },
                counts,
                total_sites: totalSites
            }
        });

    } catch (e) {
        console.error("GET tracking/flow:", e);
        return res.status(500).json({
            result: "ERROR",
            message: e.message
        });
    }
});


// FILTER OPTIONS PLAN MENSUAL
trackingRouter.get("/tracking/monthly/filter-options", async(req, res) => {
    try {
        const { provWfInstances } = await db();
        const { workflow_code } = req.query;

        const q = {};
        if (workflow_code) q.workflow_code = workflow_code;

        const workflows = await provWfInstances.distinct("workflow_code", {
            ...q,
            workflow_code: { $nin: [null, ""] }
        });

        const tasks = await provWfInstances.distinct("nodes.task_code", {
            ...q,
            "nodes.task_code": { $nin: [null, ""] }
        });

        const yearsAgg = await provWfInstances.aggregate([
            { $match: q },
            { $unwind: "$nodes" },
            { $match: { "nodes.forecast.current_date": { $ne: null } } },
            {
                $group: {
                    _id: { $year: "$nodes.forecast.current_date" }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        return res.json({
            result: "OK",
            content: {
                workflow_code: workflows.sort(),
                task_code: tasks.sort(),
                year: yearsAgg.map(x => x._id),
                month: [
                    { value: 1, label: "Enero" }, { value: 2, label: "Febrero" },
                    { value: 3, label: "Marzo" }, { value: 4, label: "Abril" },
                    { value: 5, label: "Mayo" }, { value: 6, label: "Junio" },
                    { value: 7, label: "Julio" }, { value: 8, label: "Agosto" },
                    { value: 9, label: "Setiembre" }, { value: 10, label: "Octubre" },
                    { value: 11, label: "Noviembre" }, { value: 12, label: "Diciembre" }
                ],
                forecast_source: ["CURRENT","SLA"]
            }
        });
    } catch (e) {
        console.error("GET tracking/monthly/filter-options:", e);
        return res.status(500).json({ result: "ERROR" });
    }
});

// PLAN MENSUAL
trackingRouter.get("/tracking/monthly", async(req, res) => {
    try {
        const { provWfInstances, provWfSites } = await db()

        const {
            workflow_code,
            workflow_version,
            task_code,
            year,
            month,

            forecast_source = "CURRENT",
            task_status,
            search = "",

            page = 1,
            limit = 20
        } = req.query

        if (!task_code || !year || !month) {
            return res.status(400).json({
                result: "ERROR",
                message: "task_code, year y month son requeridos"
            })
        }

        const forecastSource = String(forecast_source || "CURRENT").toUpperCase()

        const allowedSources = [
            "CURRENT",
            "SLA",
            "RESPONSIBLE",
            "PM"
        ]

        if (!allowedSources.includes(forecastSource)) {
            return res.status(400).json({
                result: "ERROR",
                message: "forecast_source inválido"
            })
        }

        const {
            currentPage,
            perPage,
            skip
        } = getPagination({ page, limit })

        // MONTH RANGE
        const start = new Date(Number(year), Number(month) - 1, 1)
        const end = new Date(Number(year), Number(month), 1)

        // FORECAST FIELD
        const forecastNodeField = getForecastField(forecastSource)
        const forecastField = `nodes.${forecastNodeField}`

        // NODE MATCH
        const nodeMatch = {
            task_code,
            [forecastNodeField]: {
                $gte: start,
                $lt: end
            }
        }

        if (task_status) {
            nodeMatch.status = task_status
        }

        // QUERY
        const q = {
            nodes: {
                $elemMatch: nodeMatch
            }
        }

        if (workflow_code) {
            q.workflow_code = workflow_code
        }

        if (workflow_version) {
            q.workflow_version = Number(workflow_version)
        }

        // SEARCH
        if (String(search).trim()) {

            const rx = new RegExp(
                escapeRegex(String(search).trim()), "i"
            )

            const siteMatches = await provWfSites.find({
                $or: [
                    { identificador: rx },
                    { project_typology: rx },
                    { project_type: rx },
                    { macro_project: rx },
                    { sub_project: rx },
                    { id_solpe: rx },
                    { solpe_project: rx },
                    { node_site: rx },
                    { site: rx },
                    { tower: rx },
                    { tower_type: rx },
                    { plan_backup: rx },
                    { q_fcst: rx },
                    { macrozone: rx },
                    { zone: rx },
                    { cluster: rx },
                    { departament: rx },
                    { province: rx },
                    { district: rx }
                ]
            }, { _id: 1 }).lean();

            const siteIds = siteMatches.map(x => x._id);

            q.$or = [
                { identificador: rx },
                { workflow_code: rx }
            ]

            if (siteIds.length) {
                q.$or.push({
                    site_id: {
                        $in: siteIds
                    }
                })
            }
        }

        const [totalResults, instances] = await Promise.all([
            provWfInstances.countDocuments(q),
            provWfInstances
                .find(q)
                .sort({
                    [forecastField]:
                        1,

                    _id:
                        1
                })
                .skip(skip)
                .limit(perPage)
                .lean()
        ])

        // SITES
        const sites = instances.length
            ? await provWfSites
                .find({
                    _id: {
                        $in: instances.map(x => x.site_id)
                    }
                })
                .lean()
            : []

        const siteMap = new Map(
            sites.map(
                x => [String(x._id), x]
            )
        )

        const items =
            instances.map(
                instance => {

                    const site = siteMap.get(String(instance.site_id))

                    const node = (instance.nodes || []).find(
                        x => x.task_code === task_code
                    )

                    const currentSubtask = getCurrentSubtask(node)

                    return {
                        instance_id: instance._id,
                        site_id: instance.site_id,
                        
                        ...mapSiteMetadata(site),

                        workflow_code: instance.workflow_code,
                        workflow_version: instance.workflow_version,
                        task_code: node?.task_code || null,
                        task_name: node?.task_name || null,
                        task_status: node?.status || null,

                        current_subtask:
                            currentSubtask
                                ? {
                                    subtask_key: currentSubtask.subtask_key,
                                    name: currentSubtask.name,
                                    status: currentSubtask.status,
                                    state: currentSubtask.state
                                }
                                : null,

                        active_subtasks:
                            (node?.subtasks || []).filter(
                                x => ["ACTIVE", "OBSERVED", "WAITING"].includes(x.status)
                            ),

                        forecast_date: getForecastValue(node?.forecast, forecastSource),
                        forecast_source: forecastSource,
                        forecast: node?.forecast || null
                    }
                }
            )

        return res.json({
            result: "OK",
            content: {
                plan: {
                    workflow_code: workflow_code || null,
                    workflow_version: workflow_version
                        ? Number(workflow_version)
                        : null,

                    task_code,
                    year: Number(year),
                    month: Number(month),
                    forecast_source: forecastSource
                },
                summary: {
                    total: totalResults
                },
                items,
                totalResults,
                totalPages: Math.ceil(totalResults / perPage),
                currentPage,
                perPage
            }
        })

    } catch (e) {
        console.error("GET tracking/monthly:", e)
        return res.status(500).json({
            result: "ERROR",
            message: e.message || "No se pudo obtener el plan mensual"
        })
    }
})


trackingRouter.get("/tracking/standby/filter-options", async(req, res) => {
    try {
        const { provWfInstances } = await db();
        const standbyQuery = {
            "nodes.subtasks.is_standby": true
        };

        const [
            workflow_codes,
            task_codes,
            subtask_keys,
            states
        ] =
            await Promise.all([
                cleanDistinct(provWfInstances, "workflow_code", standbyQuery),
                cleanDistinct(provWfInstances, "nodes.task_code", standbyQuery),
                cleanDistinct(provWfInstances, "nodes.subtasks.subtask_key", standbyQuery),
                cleanDistinct(provWfInstances, "nodes.subtasks.state", standbyQuery)
            ]);

        return res.json({
            result: "OK",
            content: {
                workflow_code: workflow_codes,
                task_code: task_codes,
                subtask_key: subtask_keys,
                state: states
            }
        });
    } catch (e) {
        console.error("GET tracking/standby/filter-options:", e);
        return res
            .status(500)
            .json({ result: "ERROR" });
    }
});


// GET SITES / SUBTASKS EN STAND BY
trackingRouter.get("/tracking/standby", async(req, res) => {
    try {
        const { provWfInstances, provWfSites } = await db();
        const {
            workflow_code,
            task_code,
            subtask_key,
            project_type_name,
            search = "",
            page = 1,
            limit = 20,
            sortBy = "standby_since",
            sortDirection = "desc"
        } = req.query;

        const {
            currentPage,
            perPage,
            skip
        } = getPagination({ page, limit });

        /*
         * Solo instancias que tengan por lo menos
         * una Subtarea marcada como Stand By.
         */
        const q = {
            nodes: {
                $elemMatch: {
                    subtasks: {
                        $elemMatch: {
                            is_standby: true
                        }
                    }
                }
            }
        };

        if (workflow_code) {
            q.workflow_code = workflow_code;
        }

        /*
         * =====================================================
         * FILTRO TASK / SUBTASK
         * =====================================================
         */
        if (task_code || subtask_key) {

            const subtaskMatch = {
                is_standby: true
            };

            if (subtask_key) {
                subtaskMatch.subtask_key = subtask_key;
            }

            const nodeMatch = {
                subtasks: {
                    $elemMatch: subtaskMatch
                }
            };

            if (task_code) {
                nodeMatch.task_code = task_code;
            }

            q.nodes = {
                $elemMatch: nodeMatch
            };
        }


        if (String(search).trim()) {
            const rx = new RegExp(escapeRegex(String(search).trim()), "i");
            q.$or = [
                { identificador: rx },
                { workflow_code: rx },
                { "nodes.task_name": rx },
                { "nodes.subtasks.name": rx }
            ];
        }

        if (project_type_name) {
            const siteIds = await provWfSites
                .find(
                    { project_type_name },
                    { _id: 1 }
                ).lean();

            const ids = siteIds.map(x => x._id);

            if (!ids.length) {
                return res.json({
                    result: "OK",
                    content: {
                        items: [],
                        totalResults: 0,
                        totalPages: 0,
                        currentPage
                    }
                });
            }

            q.site_id = {
                $in: ids
            };
        }

        const [totalResults, instances] = await Promise.all([
            provWfInstances.countDocuments(q),
            provWfInstances
                .find(q)
                .sort({
                    updatedAt:
                        String(sortDirection)
                            .toLowerCase() === "asc"
                            ? 1
                            : -1,
                    _id: -1
                })
                .skip(skip)
                .limit(perPage)
                .lean()
        ]);

        const siteIds = instances.map(x => x.site_id);

        const sites =
            await provWfSites.find({
                _id: {
                    $in: siteIds
                }
            }).lean();

        const siteMap = new Map(
            sites.map(
                x => [String(x._id), x]
            )
        );

        const items = [];

        for (const instance of instances) {
            const site = siteMap.get(String(instance.site_id));
            for (const node of instance.nodes || []) {
                if (task_code && node.task_code !== task_code) {
                    continue;
                }
                for (const subtask of node.subtasks || []) {
                    if (subtask.is_standby !== true) {
                        continue;
                    }
                    if (subtask_key && subtask.subtask_key !== subtask_key) {
                        continue;
                    }
                    items.push({
                        instance_id: instance._id,
                        site_id: instance.site_id,
                        
                        ...mapSiteMetadata(site),

                        workflow_code: instance.workflow_code,
                        workflow_version: instance.workflow_version,
                        instance_status: instance.status,
                        task_code: node.task_code,
                        task_name: node.task_name,
                        task_status: node.status,
                        subtask_key: subtask.subtask_key,
                        subtask_name: subtask.name,
                        subtask_status: subtask.status,
                        state: subtask.state,
                        standby_state_key: subtask.standby_state_key || null,
                        standby_since: subtask.standby_since || null,
                        assigned_user_ids: subtask.assigned_user_ids || [],
                        forecast: node.forecast || null
                    });
                }
            }
        }

        /*
         * Orden específico por standby_since.
         */
        items.sort(
            (a, b) => {
                const aDate = a.standby_since
                    ? new Date(a.standby_since).getTime()
                    : 0;

                const bDate = b.standby_since
                    ? new Date(b.standby_since).getTime()
                    : 0;

                return (
                    String(sortDirection)
                        .toLowerCase() === "asc"
                        ? aDate - bDate
                        : bDate - aDate
                );
            }
        );

        return res.json({
            result: "OK",
            content: {
                items,
                totalResults,
                totalPages: Math.ceil(totalResults / perPage),
                currentPage,
                perPage
            }
        });

    } catch (e) {
        console.error("GET tracking/standby:", e);
        return res
            .status(500)
            .json({
                result: "ERROR",
                message: e.message
            });
    }
});


function isTaskBlockingCompleted(node) {
    const blocking = (node?.subtasks || []).filter(subtask => subtask.blocking !== false);
    return blocking.every(subtask => subtask.status === "COMPLETED");
}

function getTaskSummary(node) {
    if (!node) return { ok: false, value: null, forecast_date: null, forecast_source: null };

    const ok = isTaskBlockingCompleted(node);
    if (ok) return { ok: true, value: "OK", forecast_date: null, forecast_source: null };

    const responsibleDate = node.forecast?.responsible_date || null;
    const pmDate = node.forecast?.pm_date || null;
    const forecastDate = responsibleDate || pmDate || null;

    return {
        ok: false,
        value: forecastDate,
        forecast_date: forecastDate,
        forecast_source: responsibleDate ? "RESPONSIBLE" : pmDate ? "PM" : null
    };
}

// RESUMEN DE SITES POR TASK
trackingRouter.get("/tracking/site-summary", async(req, res) => {
    try {
        const { provWfInstances, provWfSites } = await db();
        const {
            workflow_code,
            workflow_version,
            instance_status,
            search = "",
            column_filters = "",
            page = 1,
            limit = 20,
            sortBy = "identificador",
            sortDirection = "asc"
        } = req.query;

        if (!workflow_code) {
            return res.status(400).json({
                result: "ERROR",
                message: "workflow_code requerido"
            });
        }

        const columnFilters = parseColumnFilters(column_filters);

        const { currentPage, perPage, skip } = getPagination({ page, limit });
        const allowedSortFields = new Set(["identificador", "workflow_start_date", "createdAt", "updatedAt"]);
        const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "identificador";
        const safeSortDirection = String(sortDirection).toLowerCase() === "desc" ? -1 : 1;

        const q = { workflow_code };

        if (workflow_version) q.workflow_version = Number(workflow_version);
        if (instance_status) q.status = instance_status;

        /*
         * SEARCH
         * Busca identificador + información del site.
         */
        if (String(search).trim()) {
            const rx = new RegExp(escapeRegex(String(search).trim()), "i");

            const matchingSites = await provWfSites.find({
                $or: [
                    { identificador: rx },
                    { project_typology: rx },
                    { project_type: rx },
                    { macro_project: rx },
                    { sub_project: rx },
                    { id_solpe: rx },
                    { solpe_project: rx },
                    { node_site: rx },
                    { site: rx },
                    { tower: rx },
                    { tower_type: rx },
                    { macrozone: rx },
                    { zone: rx },
                    { cluster: rx },
                    { departament: rx },
                    { province: rx },
                    { district: rx }
                ]
            }, { _id: 1 }).lean();

            q.$or = [
                { identificador: rx },
                { site_id: { $in: matchingSites.map(site => site._id) } }
            ];
        }

        /*
         * TASK COLUMNS.
         *
         * Se obtienen del runtime de las instancias del Workflow
         * y se conserva el orden del array nodes.
         */
        const taskQuery = { workflow_code };
        if (workflow_version) taskQuery.workflow_version = Number(workflow_version);

        const taskRows = await provWfInstances.aggregate([
            { $match: taskQuery },
            { $unwind: { path: "$nodes", includeArrayIndex: "node_order" } },
            {
                $group: {
                    _id: "$nodes.task_code",
                    task_name: { $first: "$nodes.task_name" },
                    order: { $min: "$node_order" }
                }
            },
            { $sort: { order: 1 } }
        ]);

        const tasks = taskRows.map(item => ({
            task_code: item._id,
            task_name: item.task_name || item._id,
            order: item.order
        }));

        const instances = await provWfInstances
            .find(q)
            .sort({
                [safeSortBy]:
                    safeSortDirection,
                _id: 1
            })
            .lean();

        const sites = await provWfSites.find({
            _id: { $in: instances.map(instance => instance.site_id) }
        }).lean();

        const siteMap = new Map(
            sites.map(site => [String(site._id), site])
        );

        const allItems = instances.map(instance => {
            const site = siteMap.get(String(instance.site_id)) || {};

            const nodeMap = new Map((instance.nodes || [])
                .map(node => [
                    node.task_code,
                    node
                ])
            );

            const task_summary = {};
            const pending_tasks = [];

            for (const task of tasks) {
                const node = nodeMap.get(task.task_code);
                const summary = getTaskSummary(node);

                task_summary[task.task_code] = {
                    task_code: task.task_code,
                    task_name: task.task_name,
                    task_status: node?.status || "NOT_REACHED",
                    ...summary
                };

                if (!summary.ok) {
                    pending_tasks.push(task.task_name);
                }
            }

            return {
                instance_id: instance._id,
                site_id: instance.site_id,
                ...mapSiteMetadata(site),
                workflow_code: instance.workflow_code,
                workflow_version: instance.workflow_version,
                instance_status: instance.status,
                task_summary,
                pending_tasks,
                pendiente: pending_tasks.join(" + ")
            };
        });


        const columnFilterOptions = {
            tasks: {},
            pending: []
        };

        for (const task of tasks) {
            const values = new Set();
            for (const item of allItems) {

                const summary = item.task_summary?.[task.task_code];
                const value = getTaskSummaryFilterValue(summary);

                if (value) {
                    values.add(value);
                }
            }

            const taskValues = [...values];

            taskValues.sort(
                (a, b) => {

                    if (a === "OK") {
                        return -1;
                    }

                    if (b === "OK") {
                        return 1;
                    }

                    if (a === "EMPTY") {
                        return 1;
                    }

                    if (b === "EMPTY") {
                        return -1;
                    }

                    return String(a)
                        .localeCompare(
                            String(b)
                        );
                }
            );

            columnFilterOptions.tasks[task.task_code] = taskValues;
        }

        columnFilterOptions.pending = tasks.map(
            task => ({
                value: task.task_code,
                label: task.task_name
            })
        );


        let filteredItems = allItems;

        for (const [key, filter] of Object.entries(columnFilters)) {
            const values = (filter?.values || [])
                .map(String)
                .filter(Boolean);

            if (!values.length) {
                continue;
            }

  
            if (key.startsWith("TASK::")) {
                const taskCode = key.replace("TASK::", "");

                filteredItems = filteredItems.filter(
                    item => {
                        const summary = item.task_summary?.[taskCode];
                        const value = getTaskSummaryFilterValue(summary);
                        return values.includes(
                            value
                        );
                    }
                );

                continue;
            }

            if (key === "PENDIENTE") {
                const selectedTaskNames = values
                    .map(taskCode =>
                        tasks.find(task => task.task_code === taskCode)?.task_name
                    )
                    .filter(Boolean);

                filteredItems = filteredItems.filter(
                    item =>
                        selectedTaskNames.some(
                            taskName => (item.pending_tasks || []).includes(taskName)
                        )
                );
            }
        }

        const totalResults = filteredItems.length;
        const totalPages = Math.ceil(totalResults / perPage);
        const items = filteredItems.slice(skip, skip + perPage);

        return res.json({
            result: "OK",
            content: {
                tasks,
                items,
                filter_options: columnFilterOptions,
                totalResults,
                totalPages,
                currentPage,
                perPage
            }
        });
    } catch (e) {
        console.error("GET tracking/site-summary:", e);
        return res.status(500).json({
            result: "ERROR",
            message: e.message
        });
    }
});


async function buildTrackingReportConfiguration(instances, provWfTasks) {
    const taskIds = [
        ...new Set(
            instances.flatMap(instance =>
                (instance.nodes || [])
                    .map(node => node.task_id)
                    .filter(Boolean)
                    .map(String)
            )
        )
    ];

    const definitions = taskIds.length
        ? await provWfTasks.find({
            _id: { $in: taskIds }
        }).lean()
        : [];

    const definitionMap = new Map(
        definitions.map(task => [
            String(task._id),
            task
        ])
    );

    const configuration = [];
    const seenTasks = new Set();

    for (const instance of instances) {
        for (const node of instance.nodes || []) {
            if (!node.task_code || seenTasks.has(node.task_code)) continue;

            const definition = definitionMap.get(
                String(node.task_id)
            );

            if (!definition) continue;

            seenTasks.add(node.task_code);

            configuration.push({
                task_code: node.task_code,
                task_name:
                    node.task_name ||
                    definition.name ||
                    node.task_code,

                subtasks: (definition.subtasks || [])
                    .sort((a, b) => (a.order || 0) - (b.order || 0))
                    .map(subtask => ({
                        subtask_key:
                            subtask.subtask_key,

                        subtask_name:
                            subtask.name ||
                            subtask.subtask_key,

                        fields: (subtask.fields || [])
                            .sort((a, b) => (a.order || 0) - (b.order || 0))
                            .map(field => ({
                                field_key:
                                    field.field_key,

                                label:
                                    field.label ||
                                    field.field_key,

                                type:
                                    field.type ||
                                    "TEXT"
                            }))
                    }))
            });
        }
    }

    return configuration;
}

// GET FORMAT DATA UPDATE FCST PM
trackingRouter.get("/tracking/forecast-bulk/template", async(req, res) => {
    try {
        const { provWfInstances, provWfSites } = await db();
        const { workflow_code, workflow_version } = req.query;

        if (!workflow_code) {
            return res.status(400).json({
                result: "ERROR",
                message: "workflow_code requerido"
            });
        }

        const q = { workflow_code };

        if (workflow_version) {
            q.workflow_version = Number(workflow_version);
        }

        const instances = await provWfInstances
            .find(q)
            .sort({ identificador: 1, _id: 1 })
            .lean();

        const siteIds = [
            ...new Set(
                instances
                    .map(instance => instance.site_id)
                    .filter(Boolean)
                    .map(String)
            )
        ];

        const sites = siteIds.length
            ? await provWfSites.find({
                _id: { $in: siteIds }
            }).lean()
            : [];

        const siteMap = new Map(
            sites.map(site => [
                String(site._id),
                site
            ])
        );

        const taskMap = new Map();

        for (const instance of instances) {
            for (const node of instance.nodes || []) {
                if (!node.task_code) continue;

                if (!taskMap.has(node.task_code)) {
                    taskMap.set(node.task_code, {
                        task_code: node.task_code,
                        task_name: node.task_name || node.task_code
                    });
                }
            }
        }

        const tasks = [...taskMap.values()];

        const items = instances.map(instance => {
            const site = siteMap.get(String(instance.site_id)) || {};
            const nodeMap = new Map(
                (instance.nodes || []).map(node => [
                    node.task_code,
                    node
                ])
            );

            const forecasts = {};

            for (const task of tasks) {
                const node = nodeMap.get(task.task_code);

                forecasts[task.task_code] = {
                    responsible_date: node?.forecast?.responsible_date || null,
                    pm_date: node?.forecast ?.pm_date || null
                };
            }

            return {
                instance_id: String(instance._id),
                identificador: instance.identificador || site.identificador || "",
                sitio: site.site || "",
                macro_project: site.macro_project || "",
                forecasts
            };
        });

        return res.json({
            result: "OK",
            content: {
                workflow_code,
                workflow_version: workflow_version
                    ? Number(workflow_version)
                    : null,
                tasks,
                items
            }
        });

    } catch (e) {
        console.error(
            "GET tracking/forecast-bulk/template:",
            e
        );

        return res.status(500).json({
            result: "ERROR",
            message: e.message
        });
    }
});



trackingRouter.post("/tracking/forecast-bulk/import", async(req, res) => {
    try {
        const {
            workflow_code,
            user_id,
            items = []
        } = req.body;

        if (!workflow_code) {
            return res.status(400).json({
                result: "ERROR",
                message: "workflow_code requerido"
            });
        }

        if (!user_id) {
            return res.status(400).json({
                result: "ERROR",
                message: "user_id requerido"
            });
        }

        if (!Array.isArray(items) || !items.length) {
            return res.status(400).json({
                result: "ERROR",
                message: "No existen registros para importar"
            });
        }

        const { provWfInstances, provWfEvents } = await db();

        /*
         * =====================================================
         * 1. IDS ÚNICOS
         * =====================================================
         */
        const instanceIds = [
            ...new Set(
                items
                    .map(item => String(item.instance_id || ""))
                    .filter(Boolean)
            )
        ];

        /*
         * =====================================================
         * 2. CARGAR TODAS LAS INSTANCIAS EN UNA SOLA QUERY
         * =====================================================
         */
        const instances = await provWfInstances.find({
            _id: {
                $in: instanceIds
            },
            workflow_code
        }).lean();

        const instanceMap = new Map(
            instances.map(instance => [
                String(instance._id),
                instance
            ])
        );

        /*
         * =====================================================
         * 3. PREPARAR OPERACIONES
         * =====================================================
         */
        const bulkOperations = [];
        const events = [];

        const errors = [];

        let requested = 0;
        let changed = 0;
        let skipped = 0;
        let failed = 0;

        const now = new Date();

        for (const item of items) {
            const instanceId = String(item.instance_id || "");

            if (!instanceId) {
                failed++;

                errors.push({
                    instance_id: null,
                    task_code: null,
                    message: "instance_id requerido"
                });

                continue;
            }

            const instance = instanceMap.get(instanceId);

            if (!instance) {
                failed++;

                errors.push({
                    instance_id: instanceId,
                    task_code: null,
                    message: "Instancia no encontrada o no pertenece al Workflow"
                });

                continue;
            }

            const forecasts = item.forecasts && typeof item.forecasts === "object"
                ? item.forecasts
                : {};

            const setByInstance = {};

            for (const [taskCode, forecastData] of Object.entries(forecasts)) {
                /*
                 * IMPORTANTE:
                 * solamente PM_DATE.
                 */
                const rawPmDate = forecastData?.pm_date;

                /*
                 * Blanco = no modificar.
                 */
                if (
                    rawPmDate === null ||
                    rawPmDate === undefined ||
                    String(rawPmDate).trim() === ""
                ) {
                    continue;
                }

                requested++;

                const nextDate = normalizeForecastDate(rawPmDate);

                if (!nextDate) {
                    failed++;

                    errors.push({
                        instance_id: instanceId,
                        task_code: taskCode,
                        message: "Fecha FCST PM inválida"
                    });

                    continue;
                }

                const nodeIndex = (instance.nodes || [])
                    .findIndex(
                        node => node.task_code === taskCode
                    );

                if (nodeIndex < 0) {
                    failed++;

                    errors.push({
                        instance_id: instanceId,
                        task_code: taskCode,
                        message: "TASK no encontrada en la instancia"
                    });

                    continue;
                }

                const node = instance.nodes[nodeIndex];

                node.forecast = node.forecast || {};
                const previous = node.forecast.pm_date || null;

                /*
                 * =================================================
                 * SIN CAMBIO REAL
                 * =================================================
                 */
                if (sameForecastDate(previous, nextDate)) {
                    skipped++;
                    continue;
                }

                /*
                 * =================================================
                 * CAMBIO REAL
                 * =================================================
                 */
                node.forecast.pm_date = nextDate;

                refreshCurrentForecastBulk(node.forecast);

                node.forecast.revision = (
                    node.forecast.revision || 0
                ) + 1;

                node.forecast.updated_by = String(user_id);
                node.forecast.updated_at = now;

                /*
                 * Solo actualizamos el forecast del nodo.
                 */
                setByInstance[`nodes.${nodeIndex}.forecast`] = node.forecast;

                changed++;

                events.push({
                    instance_id: instance._id,
                    site_id: instance.site_id,
                    identificador: instance.identificador,
                    workflow_code: instance.workflow_code,
                    task_code: taskCode,
                    subtask_key: null,
                    event_type: "FORECAST_UPDATED",
                    from_state: null,
                    to_state: null,
                    performed_by: String(user_id),
                    comment: "Actualización masiva FCST PM",
                    data: {
                        revision: node.forecast.revision,
                        old_date: previous,
                        new_date: nextDate,
                        type: "BULK_IMPORT",
                        forecast_source: "PM",
                        reason: "Actualización masiva FCST PM"
                    },

                    event_at: now
                });
            }

            /*
             * Una sola operación por instancia,
             * aunque tenga 6 TASK modificadas.
             */
            if (Object.keys(setByInstance).length) {
                bulkOperations.push({
                    updateOne: {
                        filter: {
                            _id: instance._id,
                            workflow_code
                        },

                        update: {
                            $set: setByInstance
                        }
                    }
                });
            }
        }

        /*
         * =====================================================
         * 4. BULK UPDATE INSTANCES
         * =====================================================
         */
        if (bulkOperations.length) {
            await provWfInstances.bulkWrite(
                bulkOperations,
                { ordered: false }
            );
        }

        // EVENTS
        if (events.length) {
            await provWfEvents.insertMany(
                events,
                { ordered: false }
            );
        }

        return res.json({
            result: failed > 0
                ? "PARTIAL"
                : "OK",

            content: {
                rows: items.length,
                requested,
                changed,
                skipped,
                failed,
                updated_instances: bulkOperations.length,
                events_created: events.length,
                errors
            }
        });

    } catch (e) {
        console.error("POST tracking/forecast-bulk/import:", e);
        return res.status(500).json({
            result: "ERROR",
            message: e.message
        });
    }
});



function mapReportInstance(instance, site) {
    return {
        instance_id: instance._id,
        site_id: instance.site_id,

        identificador:
            site?.identificador ||
            instance.identificador ||
            "",

        site: site?.site || "",
        macro_project: site?.macro_project || "",
        sub_project: site?.sub_project || "",
        tower: site?.tower || "",

        tasks: (instance.nodes || [])
            .filter(node => node.task_code)
            .map(node => ({
                task_code: node.task_code,
                task_name: node.task_name,
                status: node.status,

                started_at: node.started_at || null,
                finished_at: node.finished_at || null,

                subtasks:
                    (node.subtasks || []).map(subtask => ({
                        subtask_key: subtask.subtask_key,
                        subtask_name: subtask.name,
                        status: subtask.status,
                        state: subtask.state || "",
                        started_at: subtask.opened_at || null,
                        finished_at: subtask.completed_at || null,
                        form_data: subtask.form_data || {}
                    }))
            }))
    };
}

trackingRouter.get("/tracking/report", async(req, res) => {
    try {
        const {
            provWfInstances,
            provWfSites,
            provWfTasks
        } = await db();

        const {
            workflow_code,
            workflow_version,
            instance_status,
            project_type_name,
            search = ""
        } = req.query;

        if (!workflow_code) {
            return res.status(400).json({
                result: "ERROR",
                message: "workflow_code requerido"
            });
        }

        const q = {
            workflow_code
        };

        if (workflow_version) {
            q.workflow_version =
                Number(workflow_version);
        }

        if (instance_status) {
            q.status =
                instance_status;
        }

        if (String(search).trim()) {
            const rx =
                new RegExp(
                    escapeRegex(
                        String(search).trim()
                    ),
                    "i"
                );

            q.$or = [
                { identificador: rx },
                { workflow_code: rx },
                { "nodes.task_name": rx },
                { "nodes.subtasks.name": rx }
            ];
        }

        /*
         * Filtro por metadata del Site.
         */
        if (project_type_name) {
            const matchedSites =
                await provWfSites.find(
                    { project_type_name },
                    { _id: 1 }
                ).lean();

            const ids =
                matchedSites.map(
                    site => site._id
                );

            if (!ids.length) {
                return res.json({
                    result: "OK",
                    content: {
                        workflow: {
                            workflow_code,
                            workflow_version: workflow_version
                                ? Number(workflow_version)
                                : null
                        },
                        configuration: [],
                        items: [],
                        totalResults: 0
                    }
                });
            }

            q.site_id = {
                $in: ids
            };
        }

        /*
         * SIN PAGINACIÓN:
         * es una descarga.
         */
        const instances =
            await provWfInstances
                .find(q)
                .sort({
                    identificador: 1,
                    _id: 1
                })
                .lean();

        const sites =
            instances.length
                ? await provWfSites.find({
                    _id: {
                        $in:
                            instances.map(
                                instance => instance.site_id
                            )
                    }
                }).lean()
                : [];

        const siteMap =
            new Map(
                sites.map(site => [
                    String(site._id),
                    site
                ])
            );

        const configuration =
            await buildTrackingReportConfiguration(
                instances,
                provWfTasks
            );

        const items =
            instances.map(instance =>
                mapReportInstance(
                    instance,
                    siteMap.get(
                        String(
                            instance.site_id
                        )
                    )
                )
            );

        return res.json({
            result: "OK",
            content: {
                workflow: {
                    workflow_code,
                    workflow_version: workflow_version
                        ? Number(workflow_version)
                        : null
                },
                configuration,
                items,
                totalResults: items.length
            }
        });

    } catch (error) {
        console.error(
            "GET tracking/report:",
            error
        );

        return res.status(500).json({
            result: "ERROR",
            message:
                error.message
        });
    }
});

module.exports = trackingRouter;