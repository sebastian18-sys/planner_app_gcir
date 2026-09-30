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

const { executeSubtaskTransition, updateTaskForecast, updateSubtaskFormData } = require("./workflowEngine");

const EDITABLE_WORK_ITEM_STATUS = [
    "OPEN",
    "OBSERVED"
];

const EDITABLE_SUBTASK_STATUS = [
    "ACTIVE",
    "OBSERVED"
];

const bulkRouter = express.Router();

/*
 * =========================================================
 * HELPERS
 * =========================================================
 */
function parseArrayParam(value) {
    if (!value) return [];

    if (Array.isArray(value)) {
        return value
            .flatMap(item => String(item).split(","))
            .map(item => item.trim())
            .filter(Boolean);
    }

    return String(value)
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
}


function unique(values = []) {
    return [
        ...new Set(
            values
                .filter(
                    value =>
                        value !== null &&
                        value !== undefined &&
                        value !== ""
                )
                .map(String)
        )
    ];
}


function activityKey(
    taskCode,
    subtaskKey
) {
    return `${taskCode}::${subtaskKey}`;
}


function buildWorkItemQuery({
    userId,
    workflowCode,
    taskCodes = [],
    subtaskKeys = []
}) {
    const q = {
        status: {
            $in:
                EDITABLE_WORK_ITEM_STATUS
        }
    };

    if (userId) {
        q.assigned_user_ids = String(userId);
    }

    if (workflowCode) {
        q.workflow_code = workflowCode;
    }

    if (taskCodes.length) {
        q.task_code = {
            $in: taskCodes
        };
    }

    if (subtaskKeys.length) {
        q.subtask_key = {
            $in: subtaskKeys
        };
    }

    return q;
}


function normalizeField(field = {}) {
    return {
        field_key: field.field_key,
        label: field.label || field.field_key,
        type: field.type || "TEXT",
        required: field.required === true,
        editable: field.editable !== false,
        default_value: field.default_value ?? null,
        options: field.options || [],
        show_in_next_task: field.show_in_next_task === true,
        system_binding: field.system_binding || "NONE"
    };
}


function normalizeState(state = {}) {
    return {
        state_key: state.state_key,
        label: state.label || state.state_key,
        action_label: state.action_label || state.label || state.state_key,
        transition: state.transition
            ? {
                transition_type: state.transition.transition_type || "STATE",
                target_subtask_key: state.transition.target_subtask_key || null,
                target_subtask_keys: state.transition.target_subtask_keys || [],
                set_non_blocking_subtask_keys: state.transition.set_non_blocking_subtask_keys || [],
                target_state_key: state.transition.target_state_key || null,
                requires_comment: state.transition.requires_comment === true
            }
            : null
    };
}

/*
 * Una misma task_code podría existir en más de una definición
 * si existen distintas versiones.
 *
 * Para la grilla hacemos merge por:
 *
 * task_code
 *   -> subtask_key
 *      -> field_key
 *      -> state_key
 */
async function buildConfiguration({
    provWfTasks,
    taskCodes = [],
    subtaskKeys = []
}) {
    if (!taskCodes.length) {
        return [];
    }

    const definitions =
        await provWfTasks
            .find({
                task_code: {
                    $in: taskCodes
                }
            })
            .lean();

    const subtaskFilter = new Set(subtaskKeys);

    const taskMap = new Map();

    for (const task of definitions) {
        const taskCode = task.task_code;

        if (!taskCode) {
            continue;
        }

        if (!taskMap.has(taskCode)) {
            taskMap.set(
                taskCode,
                {
                    task_code: taskCode,
                    task_name: task.name || task.task_name || taskCode,
                    subtasks: [],
                    _subtaskMap: new Map()
                }
            );
        }

        const targetTask = taskMap.get(taskCode);

        for (const subtask of task.subtasks || []) {
            if (
                subtaskKeys.length &&
                !subtaskFilter.has(
                    subtask.subtask_key
                )
            ) {
                continue;
            }

            let targetSubtask = targetTask._subtaskMap.get(subtask.subtask_key);

            if (!targetSubtask) {
                targetSubtask = {
                    subtask_key: subtask.subtask_key,
                    name: subtask.name || subtask.subtask_key,
                    blocking: subtask.blocking !== false,
                    fields: [],
                    states: [],
                    _fieldMap: new Map(),
                    _stateMap: new Map()
                };

                targetTask._subtaskMap.set(subtask.subtask_key, targetSubtask);
                targetTask.subtasks.push(targetSubtask);
            }

            /*
             * =====================================================
             * FIELDS
             * =====================================================
             */

            for (const field of subtask.fields || []) {
                if (
                    !field.field_key ||
                    targetSubtask
                        ._fieldMap
                        .has(field.field_key)
                ) {
                    continue;
                }

                const normalized = normalizeField(field);
                targetSubtask._fieldMap.set(field.field_key, normalized);
                targetSubtask.fields.push(normalized);
            }

            /*
             * la definición puede guardar states
             * o available_states.
             */
            const states =
                subtask.states ||
                subtask.available_states ||
                [];

            for (const state of states) {
                if (
                    !state.state_key ||
                    targetSubtask
                        ._stateMap
                        .has(state.state_key)
                ) {
                    continue;
                }

                const normalized = normalizeState(state);
                targetSubtask._stateMap.set(state.state_key, normalized);

                targetSubtask.states.push(normalized);
            }
        }
    }

    /*
     * Respetar primero el orden solicitado
     * desde el frontend.
     */
    const order =
        new Map(
            taskCodes.map(
                (code, index) => [
                    code,
                    index
                ]
            )
        );

    const result =
        [...taskMap.values()]
            .sort(
                (a, b) =>
                    (order.get(a.task_code) ?? 99999) -
                    (order.get(b.task_code) ?? 99999)
            )
            .map(task => {
                delete task._subtaskMap;
                task.subtasks =
                    task.subtasks.map(
                        subtask => {
                            delete subtask._fieldMap;
                            delete subtask._stateMap;
                            return subtask;
                        }
                    );
                return task;
            });

    return result;
}





// bulkRouter.get("/bulk-completion/filter-options", async(req, res) => {
//     try {
//         const { provWfWorkItems } = await db();

//         const {
//             user_id,
//             workflow_code,
//         } = req.query;

//         const q = {
//             status: {
//                 $in: EDITABLE_WORK_ITEM_STATUS
//             },
//             assigned_user_ids: String(user_id)
//         };

//         if (workflow_code) {
//             q.workflow_code = workflow_code;
//         }

//         const grouped = await provWfWorkItems
//             .aggregate([
//                 {
//                     $match: q
//                 },
//                 {
//                     $group: {
//                         _id: {
//                             workflow_code: "$workflow_code",
//                             task_code: "$task_code",
//                             task_name: "$task_name",
//                             subtask_key: "$subtask_key",
//                             subtask_name: "$subtask_name"
//                         }
//                     }
//                 },
//                 {
//                     $sort: {
//                         "_id.workflow_code": 1,
//                         "_id.task_name": 1,
//                         "_id.subtask_name": 1
//                     }
//                 }
//             ]);

//         const workflows =
//             unique(
//                 grouped.map(
//                     item => item._id.workflow_code
//                 )
//             )
//                 .sort()
//                 .map(value => ({
//                     value,
//                     label: value
//                 }));

//         const taskMap = new Map();

//         for (const item of grouped) {
//             const data = item._id;

//             if (!data.task_code || !data.subtask_key) {
//                 continue;
//             }

//             if (!taskMap.has(data.task_code)) {
//                 taskMap.set(
//                     data.task_code,
//                     {
//                         task_code: data.task_code,
//                         task_name: data.task_name || data.task_code,
//                         subtasks: []
//                     }
//                 );
//             }

//             const task = taskMap.get(data.task_code);

//             const exists =
//                 task.subtasks
//                     .some(
//                         subtask => subtask.subtask_key === data.subtask_key
//                     );

//             if (!exists) {
//                 task.subtasks.push({
//                     subtask_key: data.subtask_key,
//                     subtask_name: data.subtask_name || data.subtask_key
//                 });
//             }
//         }

//         const tasks =
//             [...taskMap.values()]
//                 .sort(
//                     (a, b) =>
//                         String(a.task_name).localeCompare(String(b.task_name))
//                 );

//         return res.json({
//             result: "OK",
//             content: {
//                 workflow_code: workflows,
//                 tasks
//             }
//         });
//     } catch (e) {
//         console.error("GET bulk-completion/filter-options:", e);
//         return res.status(500).json({ result: "ERROR", message: e.message });
//     }
// });

// bulkRouter.get("/bulk-completion/filter-options", async(req, res) => {
//     try {
//         const {
//             provWfWorkItems,
//             provWfTasks,
//             provWfVersions
//         } = await db();

//         const { user_id, workflow_code } = req.query;

//         if (!user_id) {
//             return res.status(400).json({
//                 result: "ERROR",
//                 message: "user_id requerido"
//             });
//         }

//         /*
//          * 1. WorkItems solamente determina las TASK
//          *    disponibles para el usuario.
//          */
//         const workflowItems = await provWfWorkItems.find({
//             status: {
//                 $in: EDITABLE_WORK_ITEM_STATUS
//             },
//             assigned_user_ids: String(user_id)
//         }, {
//             workflow_code: 1
//         }).lean();

//         if (workflow_code) {
//             workItemQuery.workflow_code = workflow_code;
//         }

//         const workItems = await provWfWorkItems
//             .find(
//                 workItemQuery,
//                 {
//                     workflow_code: 1,
//                     task_code: 1,
//                     task_name: 1
//                 }
//             )
//             .lean();

//         /*
//          * Workflows disponibles.
//          */
//         const workflows = [
//             ...new Set(
//                 workItems
//                     .map(item => item.workflow_code)
//                     .filter(Boolean)
//             )
//         ]
//             .sort()
//             .map(value => ({
//                 value,
//                 label: value
//             }));

//         /*
//          * TASK disponibles.
//          */
//         const taskCodes = [
//             ...new Set(
//                 workItems
//                     .map(item => item.task_code)
//                     .filter(Boolean)
//             )
//         ];

//         if (!taskCodes.length) {
//             return res.json({
//                 result: "OK",
//                 content: {
//                     workflow_code: workflows,
//                     tasks: []
//                 }
//             });
//         }

//         /*
//          * 2. Ahora obtenemos TODAS las Subtasks
//          *    definidas en cada TASK.
//          *
//          * Ya no dependemos de que exista WorkItem
//          * para que una Subtask aparezca.
//          */
//         const taskDefinitions = await provWfTasks
//             .find({
//                 task_code: {
//                     $in: taskCodes
//                 }
//             })
//             .lean();

//         const workItemTaskNames = new Map();

//         for (const item of workItems) {
//             if (
//                 item.task_code &&
//                 item.task_name
//             ) {
//                 workItemTaskNames.set(
//                     item.task_code,
//                     item.task_name
//                 );
//             }
//         }

//         const taskMap = new Map();

//         for (const definition of taskDefinitions) {
//             const taskCode = definition.task_code;

//             if (!taskCode) continue;

//             if (!taskMap.has(taskCode)) {
//                 taskMap.set(taskCode, {
//                     task_code: taskCode,
//                     task_name:
//                         workItemTaskNames.get(taskCode) ||
//                         definition.name ||
//                         definition.task_name ||
//                         taskCode,
//                     subtasks: [],
//                     _subtasks: new Set()
//                 });
//             }

//             const target = taskMap.get(taskCode);

//             for (const subtask of definition.subtasks || []) {
//                 if (
//                     !subtask.subtask_key ||
//                     target._subtasks.has(subtask.subtask_key)
//                 ) {
//                     continue;
//                 }

//                 target._subtasks.add(subtask.subtask_key);

//                 target.subtasks.push({
//                     subtask_key: subtask.subtask_key,
//                     subtask_name: subtask.name || subtask.subtask_key,
//                     blocking: subtask.blocking !== false
//                 });
//             }
//         }

//         const tasks = [
//             ...taskMap.values()
//         ]
//             .map(task => {
//                 delete task._subtasks;
//                 return task;
//             });

//         return res.json({
//             result: "OK",

//             content: {
//                 workflow_code: workflows,
//                 tasks
//             }
//         });

//     } catch (e) {
//         console.error("GET bulk-completion/filter-options:", e);

//         return res.status(500).json({
//             result: "ERROR",
//             message: e.message
//         });
//     }
// });

bulkRouter.get("/bulk-completion/filter-options", async(req, res) => {
    try {
        const {
            provWfWorkItems,
            provWfTasks,
            provWfVersions
        } = await db();

        const {
            user_id,
            workflow_code
        } = req.query;

        if (!user_id) {
            return res.status(400).json({
                result: "ERROR",
                message: "user_id requerido"
            });
        }

        /*
         * WORKFLOWS disponibles para el usuario.
         *
         * Aquí sí seguimos usando WorkItems para saber
         * en qué workflows tiene participación.
         */
        const workflowItems = await provWfWorkItems.find({
            status: {
                $in: EDITABLE_WORK_ITEM_STATUS
            },
            assigned_user_ids: String(user_id)
        }, {
            workflow_code: 1
        }).lean();

        const workflows = [
            ...new Set(
                workflowItems
                    .map(item => item.workflow_code)
                    .filter(Boolean)
            )
        ]
            .sort()
            .map(value => ({
                value,
                label: value
            }));

        /*
         * Sin Workflow seleccionado solamente devolvemos
         * workflows. Las TASK dependen del Workflow.
         */
        if (!workflow_code) {
            return res.json({
                result: "OK",
                content: {
                    workflow_code: workflows,
                    tasks: []
                }
            });
        }

        /*
         * Versión publicada actual del Workflow.
         */
        const version = await provWfVersions
            .findOne({
                workflow_code,
                status: "PUBLISHED"
            })
            .sort({
                version: -1
            })
            .lean();

        if (!version) {
            return res.status(404).json({
                result: "ERROR",
                message: "Workflow publicado no encontrado"
            });
        }

        /*
         * TODAS las TASK del Workflow.
         *
         * Ya NO depende de que exista WorkItem.
         */
        const taskNodes = (version.nodes || [])
            .filter(node => node.type === "TASK");

        const taskIds = taskNodes
            .map(node => node.task_id || node.taskId)
            .filter(Boolean);

        const taskCodes = taskNodes
            .map(node => node.task_code || node.taskCode)
            .filter(Boolean);

        const definitions = await provWfTasks.find({
            $or: [
                {
                    _id: {
                        $in: taskIds
                    }
                },
                {
                    task_code: {
                        $in: taskCodes
                    }
                }
            ]
        }).lean();

        const taskById = new Map(
            definitions.map(task => [
                String(task._id),
                task
            ])
        );

        const taskByCode = new Map(
            definitions.map(task => [
                task.task_code,
                task
            ])
        );

        /*
         * Mantener el mismo orden del grafo/version.
         */
        const tasks = taskNodes
            .map(node => {
                const taskId = node.task_id || node.taskId;
                const taskCode = node.task_code || node.taskCode;

                const definition =
                    (taskId && taskById.get(String(taskId))) ||
                    taskByCode.get(taskCode);

                if (!definition) {
                    return null;
                }

                return {
                    task_code: definition.task_code || taskCode,
                    task_name: definition.name || node.label || taskCode,
                    subtasks:
                        (definition.subtasks || [])
                            .sort(
                                (a, b) =>
                                    (a.order || 0) -
                                    (b.order || 0)
                            )
                            .map(subtask => ({
                                subtask_key: subtask.subtask_key,
                                subtask_name: subtask.name || subtask.subtask_key,
                                blocking: subtask.blocking !== false
                            }))
                };
            })
            .filter(Boolean);

        return res.json({
            result: "OK",
            content: {
                workflow_code: workflows,
                tasks
            }
        });

    } catch (e) {
        console.error(
            "GET bulk-completion/filter-options:",
            e
        );

        return res.status(500).json({
            result: "ERROR",
            message: e.message
        });
    }
});





// OBTENER GRILLA DE COMPLETADO MASIVO
bulkRouter.get("/bulk-completion", async(req, res) => {
    try {
        const {
            provWfWorkItems,
            provWfSites,
            provWfTasks,
            provWfInstances
        } = await db();

        const {
            user_id,
            workflow_code,
            search = "",
            column_filters = "",
            page = 1,
            limit = 100
        } = req.query;

        if (!user_id) {
            return res.status(400).json({
                result: "ERROR",
                message: "user_id requerido"
            });
        }

        const columnFilters = parseColumnFilters(column_filters);

        const taskCodes = parseArrayParam(req.query.task_codes);
        const subtaskKeys = parseArrayParam(req.query.subtask_keys);


        const siteFilterQuery = {};
        const runtimeConditions = [];

        for (const [key, filter] of Object.entries(columnFilters)) {
            if (!filter) continue;

            // Columnas SITE
            if (["identificador", "site", "macro_project", "tower"].includes(key)) {
                const value = String(filter.value || "").trim();
                if (!value) continue;

                const rx = new RegExp(escapeRegex(value), "i");

                if (key === "identificador") {
                    siteFilterQuery.identificador = rx;
                }

                if (key === "site") {
                    siteFilterQuery.site = rx;
                }

                if (key === "macro_project") {
                    siteFilterQuery.macro_project = rx;
                }

                if (key === "tower") {
                    siteFilterQuery.tower = rx;
                }

                continue;
            }

            // STATE::TASK::SUBTASK
            if (key.startsWith("STATE::")) {
                const [, taskCode, subtaskKey] = key.split("::");

                const values = (filter.values || [])
                    .map(String)
                    .filter(Boolean);

                if (!values.length) continue;

                runtimeConditions.push({
                    nodes: {
                        $elemMatch: {
                            task_code: taskCode,
                            subtasks: {
                                $elemMatch: {
                                    subtask_key: subtaskKey,
                                    state: {
                                        $in: values
                                    }
                                }
                            }
                        }
                    }
                });

                continue;
            }

            // FIELD::TASK::SUBTASK::FIELD_KEY
            if (key.startsWith("FIELD::")) {
                const [, taskCode, subtaskKey, fieldKey] = key.split("::");
                if (!fieldKey) continue;

                const fieldPath = `form_data.${fieldKey}`;

                let fieldCondition = null;

                if (filter.type === "VALUES" && (filter.values || []).length) {
                    fieldCondition = {
                        [fieldPath]: {
                            $in: filter.values
                        }
                    };
                }

                if (filter.type === "TEXT" && String(filter.value || "").trim()) {
                    fieldCondition = {
                        [fieldPath]: new RegExp(
                            escapeRegex(String(filter.value).trim()), "i")
                    };
                }

                if (!fieldCondition) continue;

                runtimeConditions.push({
                    nodes: {
                        $elemMatch: {
                            task_code: taskCode,
                            subtasks: {
                                $elemMatch: {
                                    subtask_key:
                                        subtaskKey,
                                    ...fieldCondition
                                }
                            }
                        }
                    }
                });
            }
        }


        const {
            currentPage,
            perPage,
            skip
        } = getPagination({ page, limit: 500 });

        /*
         * =====================================================
         * 1. SITES ELEGIBLES
         * =====================================================
         *
         * WorkItems solo determina qué INSTANCIAS/SITES
         * pertenecen a la bandeja del usuario.
         *
         * IMPORTANTE:
         * No filtrar aquí por taskCodes ni subtaskKeys.
         *
         * De esta forma una TASK futura puede visualizarse
         * aunque todavía no tenga WorkItem abierto.
         */
        const siteEligibilityQuery = buildWorkItemQuery({
            userId: user_id,
            workflowCode: workflow_code
        });

        const pageQuery = {
            ...siteEligibilityQuery,
            instance_id: {
                $nin: [null, ""]
            }
        };

        /*
         * =====================================================
         * 2. SEARCH
         * =====================================================
         */
        if (String(search).trim()) {
            const rx = new RegExp(
                escapeRegex(String(search).trim()),
                "i"
            );

            const matchedSites = await provWfSites.find({
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
            }, {
                _id: 1
            }).lean();

            const matchedSiteIds = matchedSites.map(site => site._id);

            pageQuery.$or = [
                { identificador: rx },
                { task_name: rx },
                { subtask_name: rx },
                {
                    site_id: {
                        $in: matchedSiteIds
                    }
                }
            ];
        }

        /*
        * =====================================================
        * 2.1 FILTROS POR COLUMNAS DEL SITE
        * =====================================================
        */
        if (Object.keys(siteFilterQuery).length) {
            const matchedSites = await provWfSites.find(
                siteFilterQuery,
                { _id: 1 }
            ).lean();

            const matchedSiteIds = matchedSites.map(site => site._id);

            if (pageQuery.site_id?.$in) {
                const currentIds = new Set(
                    pageQuery.site_id.$in.map(String)
                );

                pageQuery.site_id.$in = matchedSiteIds.filter(
                    id => currentIds.has(String(id))
                );
            } else {
                pageQuery.site_id = {
                    $in: matchedSiteIds
                };
            }
        }


        /*
        * =====================================================
        * 2.2 FILTROS POR COLUMNAS RUNTIME
        * STATE / FORM_DATA
        * =====================================================
        */
        if (runtimeConditions.length) {
            const matchedInstances = await provWfInstances.find(
                { $and: runtimeConditions },
                { _id: 1 }
            ).lean();

            const matchedInstanceIds = matchedInstances.map(instance => instance._id);

            pageQuery.instance_id = {
                ...(pageQuery.instance_id || {}),
                $in: matchedInstanceIds
            };
        }

        /*
         * =====================================================
         * 3. PAGINACIÓN POR INSTANCIA
         * =====================================================
         */
        const aggregation = await provWfWorkItems.aggregate([
            {
                $match: pageQuery
            },
            {
                $group: {
                    _id: "$instance_id",
                    lastUpdated: {
                        $max: "$updatedAt"
                    }
                }
            },
            {
                $sort: {
                    lastUpdated: -1, _id: 1
                }
            },
            {
                $facet: {
                    metadata: [
                        { $count: "total" }
                    ],
                    items: [
                        { $skip: skip },
                        { $limit: perPage }
                    ]
                }
            }
        ]);

        const aggregationResult = aggregation[0] || {
            metadata: [],
            items: []
        };

        const totalResults = aggregationResult.metadata?.[0]?.total || 0;
        const pageInstanceIds = aggregationResult.items.map(item => item._id);

        /*
         * =====================================================
         * 4. INSTANCIAS
         * =====================================================
         *
         * Las cargamos antes de CONFIGURATION porque si el
         * frontend no manda task_codes podemos obtener TODAS
         * las TASK existentes en el runtime del Workflow.
         */
        const instanceDocuments = pageInstanceIds.length
            ? await provWfInstances.find({
                _id: {
                    $in: pageInstanceIds
                }
            }).lean()
            : [];

        const instanceMap = new Map(
            instanceDocuments.map(instance => [
                String(instance._id),
                instance
            ])
        );

        const instances = pageInstanceIds
            .map(id => instanceMap.get(String(id)))
            .filter(Boolean);

        /*
         * =====================================================
         * 5. TASKS PARA CONFIGURATION
         * =====================================================
         *
         * Si el frontend seleccionó TASKS:
         * usamos esas.
         *
         * Si no seleccionó:
         * obtenemos TODAS las TASK que existen en las
         * instancias, incluyendo NOT_REACHED.
         */
        let taskCodesForConfiguration = taskCodes;

        if (!taskCodesForConfiguration.length) {
            taskCodesForConfiguration = unique(
                instances.flatMap(instance =>
                    (instance.nodes || [])
                        .map(node => node.task_code)
                        .filter(Boolean)
                )
            );
        }

        /*
         * =====================================================
         * 6. CONFIGURATION
         * =====================================================
         *
         * provWfTasks contiene:
         * TASK -> SUBTASK -> STATES/FIELDS
         */
        const configuration = await buildConfiguration({
            provWfTasks,
            taskCodes: taskCodesForConfiguration,
            subtaskKeys
        });

        /*
         * No hay sites en la página.
         */
        if (!pageInstanceIds.length) {
            return res.json({
                result: "OK",
                content: {
                    configuration,
                    items: [],
                    totalResults: 0,
                    totalPages: 0,
                    currentPage,
                    perPage
                }
            });
        }

        /*
         * =====================================================
         * 7. SITES
         * =====================================================
         */
        const siteIds = unique(
            instances
                .map(instance => instance.site_id)
                .filter(Boolean)
        );

        const sites = siteIds.length
            ? await provWfSites.find({
                _id: {
                    $in: siteIds
                }
            }).lean()
            : [];

        const siteMap = new Map(
            sites.map(site => [
                String(site._id),
                site
            ])
        );

        /*
         * =====================================================
         * 8. PARES CONFIGURADOS TASK::SUBTASK
         * =====================================================
         */
        const configuredPairs = new Set();

        for (const task of configuration) {
            for (const subtask of task.subtasks || []) {
                configuredPairs.add(
                    activityKey(
                        task.task_code,
                        subtask.subtask_key
                    )
                );
            }
        }

        /*
         * =====================================================
         * 9. BUILD ROWS
         * =====================================================
         *
         * 1 instancia = 1 fila.
         *
         * TODAS las TASK/SUBTASK seleccionadas pueden viajar.
         * La propiedad editable define si realmente pueden
         * modificarse.
         */
        const items = instances.map(instance => {
            const site = siteMap.get(String(instance.site_id)) || {};

            const row = {
                instance_id: String(instance._id),
                site_id: String(instance.site_id || ""),
                
                ...mapSiteMetadata(site),
                
                identificador: instance.identificador || site.identificador || "",
                workflow_code: instance.workflow_code,
                workflow_version: instance.workflow_version,
                activities: {}
            };

            /*
             * Map para buscar runtime rápidamente.
             */
            const nodeMap = new Map(
                (instance.nodes || [])
                    .filter(node => node.task_code)
                    .map(node => [
                        node.task_code,
                        node
                    ])
            );

            /*
             * Recorremos CONFIGURATION,
             * no solamente los nodes activos.
             *
             * Así también aparecen TASK futuras.
             */
            for (const taskConfig of configuration) {
                const node =
                    nodeMap.get(
                        taskConfig.task_code
                    );

                /*
                 * Si existe runtime de la TASK,
                 * recuperamos sus subtareas.
                 */
                const runtimeSubtaskMap = new Map(
                    (node?.subtasks || [])
                        .filter(subtask => subtask.subtask_key)
                        .map(subtask => [
                            subtask.subtask_key,
                            subtask
                        ])
                );

                for (const subtaskConfig of taskConfig.subtasks || []) {
                    const pair = activityKey(
                        taskConfig.task_code,
                        subtaskConfig.subtask_key
                    );

                    if (!configuredPairs.has(pair)) {
                        continue;
                    }

                    const subtask = runtimeSubtaskMap.get(subtaskConfig.subtask_key);

                    /*
                     * Si por alguna razón una instancia antigua
                     * todavía no tiene runtime de esa Subtask,
                     * igualmente mostramos la columna.
                     */
                    if (!subtask || !node) {
                        row.activities[pair] = {
                            task_code: taskConfig.task_code,
                            task_name: taskConfig.task_name || taskConfig.task_code,
                            task_status: node?.status || "NOT_REACHED",
                            workflow_released: node?.workflow_released === true,
                            subtask_key: subtaskConfig.subtask_key,
                            subtask_name: subtaskConfig.subtask_name || subtaskConfig.subtask_key,
                            subtask_status: subtask?.status || "PENDING",
                            state: subtask?.state || "",
                            cycle: subtask?.cycle || 1,
                            blocking: subtask?.blocking !== false,
                            assignment_pool_user_ids: subtask?.assignment_pool_user_ids || [],
                            assigned_user_ids: subtask?.assigned_user_ids || [],
                            opened_at: subtask?.opened_at || null,
                            completed_at: subtask?.completed_at || null,
                            editable: false,
                            form_data: {
                                ...(subtask?.form_data || {})
                            }
                        };

                        continue;
                    }

                    /*
                     * =================================================
                     * EDITABILIDAD
                     * =================================================
                     *
                     * La TASK puede mostrarse siempre.
                     * Solo se edita si:
                     *
                     * - TASK ACTIVE
                     * - SUBTASK ACTIVE / OBSERVED
                     * - usuario asignado
                     */
                    const assignedToUser =
                        (subtask.assigned_user_ids || [])
                            .map(String)
                            .includes(String(user_id));

                    const editable =
                        node.status === "ACTIVE" &&
                        ["ACTIVE", "OBSERVED"].includes(
                            subtask.status
                        ) &&
                        assignedToUser;

                    row.activities[pair] = {
                        task_code: node.task_code,
                        task_name: node.task_name || taskConfig.task_name || node.task_code,
                        task_status: node.status,
                        workflow_released: node.workflow_released === true,
                        subtask_key: subtask.subtask_key,
                        subtask_name: subtask.name || subtaskConfig.subtask_name || subtask.subtask_key,
                        subtask_status: subtask.status,
                        state: subtask.state || "",
                        cycle: subtask.cycle || 1,
                        blocking: subtask.blocking !== false,
                        assignment_pool_user_ids: subtask.assignment_pool_user_ids || [],
                        assigned_user_ids: subtask.assigned_user_ids || [],
                        opened_at: subtask.opened_at || null,
                        completed_at: subtask.completed_at || null,
                        editable,
                        form_data: {
                            ...(subtask.form_data || {})
                        }
                    };
                }
            }

            return row;
        });

        /*
         * =====================================================
         * RESPONSE
         * =====================================================
         */
        return res.json({
            result: "OK",
            content: {
                configuration,
                items,
                totalResults,
                totalPages: Math.ceil(totalResults / perPage),
                currentPage,
                perPage
            }
        });

    } catch (e) {
        console.error("GET bulk-completion:", e);

        return res.status(500).json({
            result: "ERROR",
            message: e.message
        });
    }
});


/*
 * =========================================================
 * NORMALIZAR ITEMS
 *
 * Une cambios repetidos de:
 *
 * INSTANCE + TASK + SUBTASK
 *
 * Esto es útil porque una grilla puede generar
 * varios cambios de celda sobre la misma actividad.
 * =========================================================
 */

function normalizeBulkItems(
    items = []
) {
    const map = new Map();

    for (const item of items) {
        if (
            !item?.instance_id ||
            !item?.task_code ||
            !item?.subtask_key
        ) {
            continue;
        }

        const key = [
            String(item.instance_id),
            item.task_code,
            item.subtask_key
        ].join("::");

        const current =
            map.get(key) || {
                instance_id: String(item.instance_id),
                task_code: item.task_code,
                subtask_key: item.subtask_key,
                form_data: {}
            };

        current.form_data = {
            ...current.form_data,
            ...(item.form_data || {})
        };

        /*
         * Solo agregamos state cuando viene
         * explícitamente en el payload.
         */
        if (
            Object.prototype
                .hasOwnProperty
                .call(item, "state")
        ) {
            current.state = item.state;
        }

        if (
            Object.prototype
                .hasOwnProperty
                .call(item, "comment")
        ) {
            current.comment = item.comment || null;
        }

        map.set(key, current);
    }

    return [
        ...map.values()
    ];
}


/*
 * =========================================================
 * RUNTIME ACTUAL
 * =========================================================
 */

async function getCurrentRuntime({
    instanceId,
    taskCode,
    subtaskKey,
    models
}) {
    const { provWfInstances } = models;

    const instance = await provWfInstances
        .findById(
            instanceId,
            { nodes: 1 }
        )
        .lean();

    if (!instance) {
        throw new Error(
            "Instancia no encontrada"
        );
    }

    const node = (instance.nodes || [])
        .find(
            current => current.task_code === taskCode
        );

    if (!node) {
        throw new Error(
            `TASK ${taskCode} no encontrada`
        );
    }

    const subtask = (node.subtasks || [])
        .find(
            current => current.subtask_key === subtaskKey
        );

    if (!subtask) {
        throw new Error(
            `Subtarea ${subtaskKey} no encontrada`
        );
    }

    return {
        task_status: node.status,
        subtask_status: subtask.status,
        state: subtask.state || null
    };
}



// ACTUALIZAR CAMPOS / ESTADO / FORECAST MASIVAMENTE
bulkRouter.patch("/bulk-completion", async(req, res) => {
    try {
        const models = await db();
        
        const { 
            user_id, 
            task_code, 
            subtask_key, 
            // items = [] 
        } = req.body;

        const items = normalizeBulkItems(req.body.items || []);

        if (!user_id) {
            return res
                .status(400)
                .json({
                    result: "ERROR",
                    message: "user_id requerido"
                });
        }

        if (!items.length) {
            return res
                .status(400)
                .json({
                    result: "ERROR",
                    message: "No existen cambios para guardar"
                });
        }

        /*
        * Protección para evitar requests
        * enormes desde la grilla.
        */
        if (items.length > 1000) {
            return res
                .status(400)
                .json({
                    result: "ERROR",
                    message: "Máximo 1000 actividades por operación"
                });
        }

        /*
        * =====================================================
        * AGRUPAR POR INSTANCE
        * =====================================================
        */

        const instanceGroups = new Map();

        for (const item of items) {
            const instanceId = String(item.instance_id);

            if (!instanceGroups.has(instanceId)) {
                instanceGroups.set(
                    instanceId,
                    []
                );
            }

            instanceGroups
                .get(instanceId)
                .push(item);
        }

        const results = [];

        /*
        * =====================================================
        * PROCESAR SECUENCIALMENTE
        * =====================================================
        */

        for (const [instanceId, group] of instanceGroups) {
            for (const row of group) {
                try {
                    const current = await getCurrentRuntime({
                        instanceId,
                        taskCode: row.task_code,
                        subtaskKey: row.subtask_key,
                        models
                    });

                    const hasFormData = Object.keys(
                        row.form_data || {}
                    ).length > 0;

                    const hasStateProperty = Object.prototype
                        .hasOwnProperty
                        .call(row, "state");

                    const hasStateChange =
                        hasStateProperty &&
                        !!row.state &&
                        row.state !== current.state;

                    /*
                    * =================================================
                    * CAMBIO DE ESTADO
                    * =================================================
                    */

                    if (hasStateChange) {
                        const output =
                            await executeSubtaskTransition({
                                instanceId,
                                taskCode: row.task_code,
                                subtaskKey: row.subtask_key,
                                targetState: row.state,
                                formData: row.form_data || {},
                                comment: row.comment || null,
                                userId: String(user_id),
                                models
                            });

                        results.push({
                            instance_id: instanceId,
                            task_code: row.task_code,
                            subtask_key: row.subtask_key,
                            result: "OK",
                            mode: "STATE",
                            content: output
                        });

                        continue;
                    }

                    /*
                    * =================================================
                    * SOLO FORM_DATA
                    * =================================================
                    */

                    if (hasFormData) {
                        const output = await updateSubtaskFormData({
                            instanceId,
                            taskCode: row.task_code,
                            subtaskKey: row.subtask_key,
                            formData: row.form_data,
                            userId: String(user_id),
                            models
                        });

                        results.push({
                            instance_id: instanceId,
                            task_code: row.task_code,
                            subtask_key: row.subtask_key,
                            result: "OK",
                            mode: "FORM",
                            content: output
                        });

                        continue;
                    }

                    /*
                    * =================================================
                    * NO CHANGE
                    *
                    * Puede suceder si el frontend envía un STATE
                    * igual al runtime actual.
                    * =================================================
                    */

                    results.push({
                        instance_id: instanceId,
                        task_code: row.task_code,
                        subtask_key: row.subtask_key,
                        result: "OK",
                        mode: "NO_CHANGE"
                    });

                } catch (error) {

                    console.error(
                        "BULK SUBTASK ERROR:",
                        {
                            instance_id: instanceId,
                            task_code: row.task_code,
                            subtask_key: row.subtask_key,
                            state: row.state,
                            form_data: row.form_data,
                            error: error.message
                        }
                    );

                    console.error(
                        error.stack || error
                    );

                    results.push({
                        instance_id: instanceId,
                        task_code: row.task_code,
                        subtask_key: row.subtask_key,
                        result: "ERROR",
                        message: error.message
                    });
                }
            }
        }

            
        const success = results.filter(
            item => item.result === "OK"
        ).length;

        const failed = results.length - success;

        return res.json({
            result: failed > 0
                ? "PARTIAL"
                : "OK",

            content: {
                requested: items.length,
                success,
                failed,
                items: results
            }
        });
    } catch (e) {
        console.error(
            "BULK ITEM ERROR:",
            {
                instance_id: instanceId,
                task_code: row.task_code,
                subtask_key: row.subtask_key,
                state: row.state,
                form_data: row.form_data
            }
        );

        console.error(
            error.stack || error
        );

        results.push({
            instance_id: instanceId,
            task_code: row.task_code,
            subtask_key: row.subtask_key,
            result: "ERROR",
            message: error.message
        });

        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});


module.exports = bulkRouter;