const express = require('express');
const db = require('../../../db');
require("dotenv").config();

const {
    escapeRegex,
    getPagination,
    getSort,
    cleanDistinct,
    mapSiteMetadata
} = require("./_helpers");

const inboxRouter = express.Router();

// FILTER OPTIONS
inboxRouter.get("/inbox/filter-options", async (req, res) => {
    try {
        const { provWfInstances } = await db();
        const { user_id } = req.query;

        const baseQuery = {
            status: { $in: ["ACTIVE","CANCEL_PENDING"] }
        };

        if (user_id) {
            baseQuery.nodes = {
                $elemMatch: {
                    participants: user_id
                }
            };
        }

        const [
            identificador,
            workflow_code,
            task_code,
            task_status,
            subtask_status
        ] = await Promise.all([
            cleanDistinct(provWfInstances, "identificador"),
            cleanDistinct(provWfInstances, "workflow_code"),
            cleanDistinct(provWfInstances, "nodes.task_code"),
            cleanDistinct(provWfInstances, "nodes.status"),
            cleanDistinct(provWfInstances, "nodes.subtasks.status")
        ]);

        return res.json({
            result: "OK",
            content: {
                identificador,
                workflow_code,
                task_code,
                task_status,
                subtask_status
            }
        });
    } catch (e) {
        console.error("GET inbox/filter-options:", e);
        return res.status(500).json({
            result: "ERROR",
            message: "Error al obtener filtros"
        });
    }
});

// LISTAR TAREAS ASIGNADAS / EN SEGUIMIENTO
inboxRouter.get("/inbox", async (req, res) => {
    try {
        const { provWfInstances, provWfSites } = await db();

        const {
            user_id,
            workflow_code,
            task_code,
            task_status,
            subtask_status,
            relation,
            search = "",
            page = 1,
            limit = 10,
            sortBy = "updatedAt",
            sortDirection = "desc"
        } = req.query;

        // console.log("INBOX", req.query)
        // console.log("USER_ID", user_id)

        const { currentPage, perPage } = getPagination({ page, limit });

        const allowedSortFields = new Set([
            "identificador",
            "workflow_code",
            "createdAt",
            "updatedAt"
        ]);

        const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "updatedAt";
        const safeSortDirection = String(sortDirection).toLowerCase() === "asc" ? 1 : -1;

        const q = {
            status: { $in: ["ACTIVE","CANCEL_PENDING"] }
        };

        if (workflow_code) q.workflow_code = workflow_code;

        const nodeMatch = {};

        if (user_id) nodeMatch.participants = user_id;
        if (task_code) nodeMatch.task_code = task_code;
        if (task_status) {
            nodeMatch.status = task_status;
        } else {
            nodeMatch.status = "ACTIVE";
        }
        
        if (subtask_status) {
            nodeMatch.subtasks = {
                $elemMatch: {
                    status: subtask_status
                }
            };
        }

        if (Object.keys(nodeMatch).length) {
            q.nodes = { $elemMatch: nodeMatch };
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

        // const [totalResults, instances] = await Promise.all([
        //     provWfInstances.countDocuments(q),
        //     provWfInstances
        //         .find(q)
        //         .sort({
        //             [safeSortBy]: safeSortDirection,
        //             _id: -1
        //         })
        //         .skip(skip)
        //         .limit(perPage)
        //         .lean()
        // ]);
        const instances = await provWfInstances
            .find(q)
            .sort({
                [safeSortBy]:
                    safeSortDirection,
                _id: -1
            })
            .lean();

        const siteIds = instances.map(x => x.site_id);

        const sites = await provWfSites.find({
            _id: { $in: siteIds }
        }).lean();

        const siteMap = new Map(
            sites.map(x => [String(x._id), x])
        );

        // BUILD INBOX
        const MY_STATUSES = [
            "ACTIVE",
            "OBSERVED"
        ];

        const RUNTIME_STATUSES = [
            "ACTIVE",
            "OBSERVED",
            "WAITING"
        ];

        const items = [];

        for (const instance of instances) {
            
            const site = siteMap.get(String(instance.site_id));

            for (const node of instance.nodes || []) {

                if (node.status !== "ACTIVE") continue;
                
                const participants = (node.participants || []).map(String);

                if(user_id && !participants.includes(user_id)) continue;

                // if (user_id && !(node.participants || []).includes(user_id)) continue;
                if (task_code && node.task_code !== task_code) continue;
                if (task_status && node.status !== task_status) continue;

                // Subtareas operativas vigentes
                let activeSubtasks =
                    (node.subtasks || [])
                        .filter(subtask =>
                            RUNTIME_STATUSES.includes(subtask.status)
                        );

                // Filtro desde UI
                if (subtask_status) {
                    activeSubtasks =
                        activeSubtasks.filter(subtask =>
                            subtask.status ===
                            subtask_status
                        );
                }

                if (!activeSubtasks.length) continue

                // Subtareas en BANDEJA
                // Solo ACTIVE / OBSERVED y asignadas al usuario.
                const mySubtasks =
                    activeSubtasks.filter(
                        subtask => {
                            const assigned = (subtask.assigned_user_ids || []).map(String);

                            return (
                                MY_STATUSES.includes(subtask.status) &&
                                assigned.includes(user_id)
                            );
                        }
                    );

                // Subtareas en SEGUIMIENTO
                // Son todas las actividades vigentes del TASK
                const myKeys = new Set(
                    mySubtasks.map(subtask => subtask.subtask_key)
                );

                const trackingSubtasks =
                    activeSubtasks.filter(
                        subtask => !myKeys.has(subtask.subtask_key)
                    );

                
                const itemRelation = mySubtasks.length > 0 ? "MY_COURT" : "TRACKING";

                if (relation && relation !== itemRelation) continue;

                items.push({

                    instance_id: instance._id,
                    site_id: instance.site_id,
                    
                    ...mapSiteMetadata(site),

                    identificador: instance.identificador || site?.identificador || "",

                    workflow_code: instance.workflow_code,
                    workflow_version: instance.workflow_version,
                    task_code: node.task_code,
                    task_name: node.task_name,
                    task_status: node.status,

                    workflow_released: node.workflow_released === true,
                    released_at: node.released_at || null,

                    relation: itemRelation,
                    my_subtasks: mySubtasks,
                    tracking_subtasks: trackingSubtasks,
                    active_subtasks: activeSubtasks,
                    my_active_count: mySubtasks.length,
                    tracking_count: trackingSubtasks.length,

                    forecast: node.forecast,
                    participants: node.participants || [],
                    created_at: instance.createdAt,
                    updated_at: instance.updatedAt
                });
            }
        }

        const totalResults = items.length;
        const totalPages = Math.ceil(totalResults / perPage);
        const skip = (currentPage - 1) * perPage;
        const paginatedItems = items.slice(skip, skip + perPage);

        return res.json({
            result: "OK",
            content: {
                items: paginatedItems,
                totalResults,
                totalPages,
                currentPage,
                perPage
            }
        });
    } catch (e) {
        console.error("GET inbox:", e);

        return res.status(500).json({
            result: "ERROR"
        });
    }
});

function normalizeUserIds(values = []) {
    return (values || []).map(x => String(x))
}

function getNodeForecastByType(node, forecastType) {
    const forecast = node.forecast || {};

    switch (String(forecastType || "").toUpperCase()) {

        case "SLA":
            return (
                forecast.sla_date ||
                null
            );

        case "RESPONSIBLE":
            return (
                forecast.responsible_date ||
                null
            );

        case "PM":
            return (
                forecast.pm_date ||
                null
            );

        default:
            return null;
    }
}

function getMonthRange(month) {
    if (!/^\d{4}-\d{2}$/.test(String(month || ""))) {
        throw new Error("El mes debe tener formato YYYY-MM")
    }

    const parts = String(month).split("-")
    const year = Number(parts[0])
    const monthNumber = Number(parts[1])

    if (!year || monthNumber < 1 || monthNumber > 12) {
        throw new Error("Mes inválido")
    }

    const start = new Date(Date.UTC(
        year,
        monthNumber - 1,
        1,
        0,
        0,
        0,
        0
    ))

    const end = new Date(Date.UTC(
        year,
        monthNumber,
        1,
        0,
        0,
        0,
        0
    ))

    return {
        start,
        end
    }
}

function refreshCurrentForecast(node) {
    const forecast = node.forecast || {};

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


inboxRouter.get("/inbox/history", async (req, res) => {
    try {
        const { provWfInstances, provWfSites } = await db()

        const {
            user_id,
            workflow_code,
            task_code,
            task_status,
            subtask_status,
            search = "",
            page = 1,
            limit = 20,
            sortBy = "updatedAt",
            sortDirection = "desc"
        } = req.query

        if (!user_id) {
            return res.status(400).json({
                result: "ERROR",
                message: "user_id es requerido"
            })
        }

        const userId = String(user_id)

        const {
            currentPage,
            perPage
        } = getPagination({ page, limit })

        const allowedSortFields = new Set([
            "identificador",
            "workflow_code",
            "createdAt",
            "updatedAt"
        ])

        const safeSortBy = allowedSortFields.has(sortBy)
            ? sortBy
            : "updatedAt"

        const safeSortDirection =
            String(sortDirection).toLowerCase() === "asc"
                ? 1
                : -1

        /*
         * No restringimos a ACTIVE.
         *
         * History puede mostrar:
         * ACTIVE
         * COMPLETED
         * CANCELLED
         * CANCEL_PENDING
         */
        const q = {}

        if (workflow_code) q.workflow_code = workflow_code

        const nodeMatch = {
            participants: userId
        }

        if (task_code) nodeMatch.task_code = task_code
        if (task_status) nodeMatch.status = task_status

        q.nodes = {
            $elemMatch: nodeMatch
        }

        if (String(search).trim()) {
            const rx = new RegExp(escapeRegex(String(search).trim()), "i")

            q.$or = [
                { identificador: rx },
                { workflow_code: rx },
                { "nodes.task_name": rx },
                { "nodes.subtasks.name": rx }
            ]
        }

        /*
         * No paginamos todavía porque una instancia
         * puede generar varias filas Site + TASK.
         */
        const instances = await provWfInstances
            .find(q)
            .lean()

        /*
         * Sites
         */
        const siteIds = [
            ...new Set(
                instances
                    .map(x => String(x.site_id || ""))
                    .filter(Boolean)
            )
        ]

        const sites = siteIds.length
            ? await provWfSites.find({
                _id: { $in: siteIds }
            }).lean()
            : []

        const siteMap = new Map(
            sites.map(site => [
                String(site._id),
                site
            ])
        )

        const items = []

        /*
         * -----------------------------------------------------
         * Construimos 1 fila = Site + TASK
         * -----------------------------------------------------
         */
        for (const instance of instances) {
            const site = siteMap.get(
                String(instance.site_id)
            )

            for (const node of instance.nodes || []) {

                if (node.type && node.type !== "TASK") continue

                const participants = normalizeUserIds(node.participants || [])

                if (!participants.includes(userId)) continue
                if (task_code && node.task_code !== task_code) continue
                if (task_status && node.status !== task_status) continue

                let subtasks = node.subtasks || []

                /*
                 * Filtro opcional por estado runtime
                 * de subtarea.
                 */
                if (subtask_status) {
                    subtasks = subtasks.filter(subtask => subtask.status === subtask_status)
                }

                if (subtask_status && !subtasks.length) continue

                /*
                 * Subtareas que pertenecieron
                 * al usuario.
                 */
                const mySubtasks =
                    subtasks.filter(subtask => {
                        const assigned =
                            normalizeUserIds(
                                subtask
                                    .assigned_user_ids ||
                                []
                            )

                        return assigned.includes(userId)
                    })

                /*
                 * Resto de subtareas del TASK.
                 */
                const myKeys = new Set(
                    mySubtasks.map(subtask => subtask.subtask_key))

                const trackingSubtasks =
                    subtasks.filter(subtask => !myKeys.has(subtask.subtask_key))

                items.push({
                    instance_id: instance._id,
                    site_id: instance.site_id,
                    
                    ...mapSiteMetadata(site),

                    identificador: instance.identificador || site?.identificador || "",

                    workflow_code: instance.workflow_code,
                    workflow_version: instance.workflow_version,
                    instance_status: instance.status,
                    task_code: node.task_code,
                    task_name: node.task_name,
                    task_status: node.status,
                    my_subtasks: mySubtasks,
                    tracking_subtasks: trackingSubtasks,
                    subtasks,
                    forecast: node.forecast,
                    participants: node.participants || [],
                    started_at: node.started_at || null,
                    completed_at:
                        node.completed_at ||
                        node.finished_at ||
                        null,
                    createdAt: instance.createdAt,
                    updatedAt: instance.updatedAt
                })
            }
        }

        /*
         * Ordenamiento sobre filas finales
         */
        items.sort((a, b) => {
            let valueA = a[safeSortBy]
            let valueB = b[safeSortBy]

            if (safeSortBy === "createdAt" || safeSortBy === "updatedAt") {
                valueA = valueA
                    ? new Date(valueA).getTime()
                    : 0

                valueB = valueB
                    ? new Date(valueB).getTime()
                    : 0
            } else {
                valueA = String(valueA || "").toLowerCase()
                valueB = String(valueB || "").toLowerCase()
            }

            if (valueA < valueB) {
                return -1 * safeSortDirection
            }

            if (valueA > valueB) {
                return 1 * safeSortDirection
            }

            return 0
        })

        /*
         * Paginación real Site + TASK
         */
        const totalResults = items.length
        const totalPages = Math.ceil(totalResults / perPage)
        const skip = (currentPage - 1) * perPage
        const paginatedItems = items.slice(skip, skip + perPage)

        return res.json({
            result: "OK",
            content: {
                items: paginatedItems,
                totalResults,
                totalPages,
                currentPage,
                perPage
            }
        })

    } catch (e) {
        console.error("GET inbox/history:", e)
        return res.status(500).json({
            result: "ERROR",
            message: e.message || "No se pudo obtener el historial"
        })
    }
})

/*
* Solo estados válidos para Plan Mensual
*/
const PLAN_TASK_STATUSES = [
    "NOT_REACHED",
    "ACTIVE",
    "COMPLETED"
]

// GET Inbox Monthly
inboxRouter.get("/inbox/monthly", async (req, res) => {
    try {
        const { provWfInstances, provWfSites } = await db()

        const {
            user_id,
            month,
            forecast_type = "RESPONSIBLE",
            workflow_code,
            task_code,
            task_status,
            search = "",
            page = 1,
            limit = 20,
            sortBy = "forecast_date",
            sortDirection = "asc"
        } = req.query

        if (!user_id) {
            return res.status(400).json({
                result: "ERROR",
                message: "user_id es requerido"
            })
        }

        if (!month) {
            return res.status(400).json({
                result: "ERROR",
                message: "month es requerido"
            })
        }

        const allowedForecastTypes = [
            "RESPONSIBLE",
            "PM",
            "SLA"
        ]

        const forecastType = String(forecast_type).toUpperCase()

        if (!allowedForecastTypes.includes(forecastType)) {
            return res.status(400).json({
                result: "ERROR",
                message: "forecast_type inválido"
            })
        }

        const userId = String(user_id)

        const { start, end } = getMonthRange(month)

        const { currentPage, perPage } = getPagination({ page, limit })

        const allowedSortFields = new Set([
            "identificador",
            "workflow_code",
            "task_name",
            "forecast_date",
            "updatedAt"
        ])

        const safeSortBy = allowedSortFields.has(sortBy)
            ? sortBy
            : "forecast_date"

        const safeSortDirection = String(sortDirection).toLowerCase() === "desc"
            ? -1
            : 1

        /*
         * -----------------------------------------------------
         * Consulta inicial
         * -----------------------------------------------------
         *
         * Incluimos activas y completadas.
         *
         * No incluimos instancias canceladas en el plan
         * mensual operativo.
         */
        const q = {
            status: {
                $in: ["ACTIVE", "CANCEL_PENDING", "COMPLETED"]
            }
        }

        if (workflow_code) q.workflow_code = workflow_code

        if (String(search).trim()) {

            const rx = new RegExp(escapeRegex(String(search).trim()), "i")

            q.$or = [
                { identificador: rx },
                { workflow_code: rx },
                { "nodes.task_name": rx },
                { "nodes.subtasks.name": rx }
            ]
        }

        /*
         * Todavía no paginamos.
         *
         * Primero debemos identificar qué TASK cae
         * en el mes solicitado.
         */
        const instances = await provWfInstances.find(q).lean()

        /*
         * Sites
         */
        const siteIds = [
            ...new Set(
                instances
                    .map(x => String(x.site_id || ""))
                    .filter(Boolean)
            )
        ]

        const sites = siteIds.length
            ? await provWfSites.find({
                _id: { $in: siteIds }
            }).lean()
            : []

        const siteMap = new Map(sites.map(site => [
                String(site._id),
                site
            ])
        )

        const items = []

        let availableCount = 0
        let waitingPreviousCount = 0
        let completedCount = 0
        let trackingCount = 0

        /*
         * -----------------------------------------------------
         * Construcción Plan Mensual
         * -----------------------------------------------------
         */
        for (const instance of instances) {
            const site = siteMap.get(String(instance.site_id))
            for (const node of instance.nodes || []) {

                if (node.type && node.type !== "TASK") {
                    continue
                }

                if (!PLAN_TASK_STATUSES.includes(node.status)) {
                    continue
                }

                if (task_code && node.task_code !== task_code) {
                    continue
                }

                if (task_status && node.status !== task_status) {
                    continue
                }

                /*
                 * Forecast según selector.
                 */
                const forecastDate = getNodeForecastByType(node, forecastType)

                if (!forecastDate) continue

                const parsedForecast = new Date(forecastDate)

                if (Number.isNaN(parsedForecast.getTime())) {
                    continue
                }

                /*
                 * Debe caer dentro del mes seleccionado.
                 *
                 * start <= fecha < end
                 */
                if (parsedForecast < start || parsedForecast >= end) {
                    continue
                }

                /*
                 * -------------------------------------------------
                 * Relación con el usuario
                 * -------------------------------------------------
                 *
                 * No dependemos solamente de participants
                 * porque una TASK futura puede estar
                 * NOT_REACHED pero tener subtareas con
                 * responsable ya configurado.
                 */
                const participants = normalizeUserIds(node.participants || [])

                const userInSubtasks =
                    (node.subtasks || [])
                        .some(subtask => {
                            const assigned = normalizeUserIds(subtask.assigned_user_ids || [])
                            return assigned.includes(userId)
                        })

                if (!participants.includes(userId) && !userInSubtasks
                ) {
                    continue
                }

                /*
                 * -------------------------------------------------
                 * Subtareas actuales
                 * -------------------------------------------------
                 */
                const runtimeSubtasks = node.subtasks || []

                const activeSubtasks =
                    runtimeSubtasks.filter(
                        subtask =>
                            [
                                "ACTIVE",
                                "OBSERVED",
                                "WAITING"
                            ].includes(
                                subtask.status
                            )
                    )

                /*
                 * Solo trabajo accionable mío.
                 */
                const mySubtasks = activeSubtasks.filter(
                        subtask => {
                            if (!["ACTIVE", "OBSERVED"].includes(subtask.status)) {
                                return false
                            }

                            const assigned = normalizeUserIds(subtask.assigned_user_ids || [])
                            return assigned.includes(userId)
                        }
                    )

                const myKeys =
                    new Set(
                        mySubtasks.map(subtask => subtask.subtask_key)
                    )

                const trackingSubtasks =
                    activeSubtasks.filter(
                        subtask => !myKeys.has(subtask.subtask_key)
                    )

                /*
                 * -------------------------------------------------
                 * Disponibilidad
                 * -------------------------------------------------
                 */
                let availability = "WAITING_PREVIOUS_TASK"

                if (node.status === "COMPLETED") {
                    availability = "COMPLETED"
                    completedCount++

                } else if (node.status === "ACTIVE" && mySubtasks.length > 0) {
                    availability = "AVAILABLE"
                    availableCount++

                } else if (node.status === "ACTIVE") {
                    availability = "TRACKING"
                    trackingCount++

                } else {
                    waitingPreviousCount++
                }

                items.push({
                    instance_id: instance._id,
                    site_id: instance.site_id,
                   
                    ...mapSiteMetadata(site),

                    identificador: instance.identificador || site?.identificador || "",

                    workflow_code: instance.workflow_code,
                    workflow_version: instance.workflow_version,
                    task_code: node.task_code,
                    task_name: node.task_name,

                    task_status: node.status,
                    forecast_type: forecastType,
                    forecast_date: forecastDate,
                    forecast: node.forecast,

                    availability,
                    my_subtasks: mySubtasks,
                    tracking_subtasks: trackingSubtasks,
                    active_subtasks: activeSubtasks,
                    my_active_count: mySubtasks.length,
                    tracking_count: trackingSubtasks.length,
                    participants: node.participants || [],
                    createdAt: instance.createdAt,
                    updatedAt: instance.updatedAt
                })
            }
        }

        /*
         * -----------------------------------------------------
         * Ordenamiento
         * -----------------------------------------------------
         */
        items.sort((a, b) => {
            let valueA = a[safeSortBy]
            let valueB = b[safeSortBy]

            if (
                safeSortBy === "forecast_date" ||
                safeSortBy === "updatedAt"
            ) {
                valueA = valueA
                    ? new Date(valueA).getTime()
                    : 0

                valueB = valueB
                    ? new Date(valueB).getTime()
                    : 0

            } else {
                valueA = String(valueA || "").toLowerCase()
                valueB = String(valueB || "").toLowerCase()
            }

            if (valueA < valueB) {
                return (-1 * safeSortDirection)
            }

            if (valueA > valueB) {
                return (1 * safeSortDirection)
            }

            return 0
        })

        /*
         * -----------------------------------------------------
         * Paginación
         * -----------------------------------------------------
         */
        const totalResults = items.length
        const totalPages = Math.ceil(totalResults / perPage)
        const skip = (currentPage - 1) * perPage
        const paginatedItems = items.slice(skip, skip + perPage)

        return res.json({
            result: "OK",

            content: {

                /*
                 * Datos del plan seleccionado.
                 */
                plan: {
                    month,
                    forecast_type: forecastType
                },

                /*
                 * KPI.
                 */
                summary: {
                    total: totalResults,
                    available: availableCount,
                    tracking: trackingCount,
                    waiting_previous_task: waitingPreviousCount,
                    completed: completedCount
                },

                items: paginatedItems,
                totalResults,
                totalPages,
                currentPage,
                perPage
            }
        })

    } catch (e) {
        console.error("GET inbox/monthly:", e)
        return res.status(500).json({
            result: "ERROR",
            message: e.message || "No se pudo obtener el plan mensual"
        })
    }
})


// Kanban
inboxRouter.get("/inbox/kanban", async(req, res) => {
    try {
        const { provWfWorkItems, provWfSites } = await db();

        const {
            user_id,
            task_code,
            workflow_code,
            search = ""
        } = req.query;

        if (!user_id) {
            return res.status(400).json({
                result: "ERROR",
                message: "user_id requerido"
            });
        }

        const q = {
            assigned_user_ids: user_id,
            status: { $in: ["OPEN","OBSERVED","WAITING"] }
        };

        if (task_code) q.task_code = task_code;
        if (workflow_code) q.workflow_code = workflow_code;

        if (String(search).trim()) {
            const rx = new RegExp(
                escapeRegex(String(search).trim()),
                "i"
            );

            q.$or = [
                { identificador: rx },
                { task_name: rx },
                { subtask_name: rx }
            ];
        }

        const workItems = await provWfWorkItems.find(q)
            .sort({ updatedAt: -1 })
            .lean();

        const sites = await provWfSites.find({
            _id: { $in: workItems.map(x => x.site_id) }
        }).lean();

        const siteMap = new Map(
            sites.map(x => [String(x._id), x])
        );

        const columnsMap = new Map();

        for (const item of workItems) {
            const key = item.subtask_key;

            if (!columnsMap.has(key)) {
                columnsMap.set(key, {
                    subtask_key: item.subtask_key,
                    subtask_name: item.subtask_name,
                    count: 0,
                    items: []
                });
            }

            const column = columnsMap.get(key);
            const site = siteMap.get(String(item.site_id));

            column.count++;

            column.items.push({
                work_item_id: item._id,
                instance_id: item.instance_id,
                site_id: item.site_id,

                ...mapSiteMetadata(site),

                identificador: item.identificador || site?.identificador || "",
                
                task_code: item.task_code,
                task_name: item.task_name,
                subtask_key: item.subtask_key,
                subtask_name: item.subtask_name,
                state: item.state,
                status: item.status
            });
        }

        return res.json({
            result: "OK",
            content: {
                columns: Array.from(columnsMap.values())
            }
        });
    } catch (e) {
        console.error("GET inbox/kanban:", e);
        return res.status(500).json({ result: "ERROR" });
    }
});


// FILTROS DE HISTORIAL DE BANDEJA
inboxRouter.get("/inbox/history/filter-options", async(req, res) => {
    try {
        const { provWfInstances } = await db();
        const { user_id } = req.query;
        const q = user_id ? { "nodes.participants": String(user_id) } : {};
        const workflow_code = await provWfInstances.distinct("workflow_code", q);
        const task_code = await provWfInstances.distinct("nodes.task_code", q);
        return res.json({ 
            result: "OK", 
            content: { 
                workflow_code: workflow_code.filter(Boolean), 
                task_code: task_code.filter(Boolean) 
            } 
        });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});


module.exports = inboxRouter;



