const express = require('express');
const db = require('../../../db');
require("dotenv").config();

const {
    escapeRegex,
    getPagination,
    getSort,
    cleanDistinct
} = require("./_helpers");

const { 
    requestCancellation, updateSubtaskAssignees, manuallyOpenTask, updateSubtaskFormData, 
    executeSubtaskTransition, reopenTask, changeWorkflowStartDate
} = require("./workflowEngine");

const instanceRouter = express.Router();


// FILTROS DE INSTANCIAS
instanceRouter.get("/instances/filter-options", async(req, res) => {
    try {
        const { provWfInstances } = await db();
        const clean = async(field) => {
            const values = await provWfInstances.distinct(field, { [field]: { $nin: [null, ""] } });
            return values.filter(Boolean).map(String).sort();
        };
        const [workflow_code, status, task_code, task_status, subtask_status] = await Promise.all([
            clean("workflow_code"), clean("status"), clean("nodes.task_code"), clean("nodes.status"), clean("nodes.subtasks.status")
        ]);
        return res.json({ result: "OK", content: { workflow_code, status, task_code, task_status, subtask_status } });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});

// LISTAR INSTANCIAS
instanceRouter.get("/instances", async(req, res) => {
    try {
        const { provWfInstances } = await db();
        const { 
            workflow_code, 
            status, 
            task_code, 
            task_status, 
            search = "", 
            page = 1, 
            limit = 20 
        } = req.query;

        const { currentPage, perPage, skip } = getPagination({ page, limit });

        const q = {};
        if (workflow_code) q.workflow_code = workflow_code;
        if (status) q.status = status;
        if (task_code || task_status) {
            const node = {};
            if (task_code) node.task_code = task_code;
            if (task_status) node.status = task_status;
            q.nodes = { $elemMatch: node };
        }

        if (search) {
            const rx = new RegExp(escapeRegex(search), "i");
            q.$or = [
                { identificador: rx }, 
                { workflow_code: rx }
            ];
        }

        const [totalResults, items] = await Promise.all([
            provWfInstances.countDocuments(q),
            provWfInstances
                .find(q)
                .sort({ updatedAt: -1 })
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
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});

// OBTENER INSTANCIA
instanceRouter.get("/instances/:instanceId", async(req, res) => {
    try {
        const { provWfInstances } = await db();
        const instance = await provWfInstances.findById(req.params.instanceId).lean();

        if (!instance) {
            return res.status(404).json({ 
                result: "ERROR", 
                message: "Instancia no encontrada" 
            });
        } 

        return res.json({ result: "OK", content: instance });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});



// OBTENER INFORMACIÓN + RUNTIME DEL SITE
// instanceRouter.get("/instances/:instanceId/detail", async(req, res) => {
//     try {
//         const { provWfInstances, provWfSites } = await db();
//         const instance = await provWfInstances.findById(req.params.instanceId).lean();

//         if (!instance) {
//             return res.status(404).json({ 
//                 result: "ERROR", 
//                 message: "Instancia no encontrada" 
//             });
//         } 

//         const site = await provWfSites.findById(instance.site_id).lean();
//         return res.json({ 
//             result: "OK", 
//             content: { 
//                 site, 
//                 instance 
//             } 
//         });

//     } catch (e) {
//         return res.status(500).json({ result: "ERROR", message: e.message });
//     }
// });

function getEdgeSource(edge) {

    return (
        edge.source ||
        edge.from ||
        edge.source_node_key ||
        null
    );
}


function getEdgeTarget(edge) {

    return (
        edge.target ||
        edge.to ||
        edge.target_node_key ||
        null
    );
}

function getPreviousTaskNodes(
    version,
    currentNodeKey
) {

    const nodes = version?.nodes || [];
    const edges = version?.edges || [];

    const nodeMap =
        new Map(
            nodes.map(
                node => [
                    node.node_key,
                    node
                ]
            )
        );

    const incomingMap = new Map();

    for (const edge of edges) {

        const source = getEdgeSource(edge);
        const target = getEdgeTarget(edge);

        if (!source || !target) {
            continue;
        }

        if (!incomingMap.has(target)) {
            incomingMap.set(target, []);
        }

        incomingMap.get(target).push(source);
    }

    const queue = [
        ...(incomingMap.get(currentNodeKey) || [])
    ];

    const visited = new Set();
    const previousTasks = [];
    while (queue.length) {

        const nodeKey = queue.shift();
        if (!nodeKey || visited.has(nodeKey)) {
            continue;
        }

        visited.add(nodeKey);
        const node = nodeMap.get(nodeKey);


        if (!node) {
            continue;
        }

        /*
         * Encontramos una TASK:
         * se considera predecesora inmediata
         * y NO seguimos hacia atrás desde ella.
         */
        if (node.type === "TASK") {
            previousTasks.push(node);
            continue;
        }

        /*
         * START / GATEWAY:
         * continuamos hacia atrás.
         */
        const previous = incomingMap.get(nodeKey) || [];
        queue.push(...previous);
    }

    return previousTasks;
}

function buildPreviousInformation({
    instance,
    version,
    currentNode,
    taskMapById
}) {

    if (!currentNode?.node_key) {
        return [];
    }


    const previousTaskNodes =
        getPreviousTaskNodes(
            version,
            currentNode.node_key
        );


    const information = [];


    for (
        const previousTaskNode
        of previousTaskNodes
    ) {

        /*
         * =====================================================
         * RUNTIME DEL NODO PREVIO
         * =====================================================
         *
         * Buscamos por node_key porque una misma definición
         * de TASK podría reutilizarse en más de un nodo.
         */
        const runtimeNode =
            (instance.nodes || [])
                .find(
                    node =>
                        node.node_key ===
                        (
                            previousTaskNode.node_key ||
                            previousTaskNode.id
                        )
                );


        if (!runtimeNode) {
            continue;
        }


        /*
         * =====================================================
         * DEFINICIÓN DE TASK
         * =====================================================
         */

        const taskDefinition =
            taskMapById.get(
                String(
                    runtimeNode.task_id ||
                    ""
                )
            );


        if (!taskDefinition) {
            continue;
        }


        const taskInformation = {

            task_code:
                taskDefinition.task_code,

            task_name:
                taskDefinition.name,

            subtasks: []

        };


        for (
            const subtaskDefinition
            of taskDefinition.subtasks || []
        ) {

            const exposedFields =
                (subtaskDefinition.fields || [])
                    .filter(
                        field =>
                            field.show_in_next_task ===
                            true
                    );


            if (!exposedFields.length) {
                continue;
            }


            const runtimeSubtask =
                (runtimeNode.subtasks || [])
                    .find(
                        runtime =>
                            runtime.subtask_key ===
                            subtaskDefinition.subtask_key
                    );


            const formData =
                runtimeSubtask
                    ?.form_data ||
                {};


            const fields =
                exposedFields.map(
                    field => ({

                        field_key:
                            field.field_key,

                        label:
                            field.label,

                        type:
                            field.type,

                        value:
                            formData[
                                field.field_key
                            ] ??
                            field.default_value ??
                            null

                    })
                );


            taskInformation
                .subtasks
                .push({

                    subtask_key:
                        subtaskDefinition
                            .subtask_key,

                    name:
                        subtaskDefinition.name,

                    fields

                });
        }


        if (
            taskInformation
                .subtasks
                .length
        ) {

            information.push(
                taskInformation
            );
        }
    }


    return information;
}



// OBTENER DETALLE COMPLETO DEL SITE
instanceRouter.get(
    "/instances/:instanceId/detail",
    async(req, res) => {

        try {

            const {
                provWfInstances,
                provWfSites,
                provWfTasks,
                provWfVersions
            } = await db();


            // =====================================================
            // INSTANCE
            // =====================================================

            const instance =
                await provWfInstances
                    .findById(
                        req.params.instanceId
                    )
                    .lean();

            if (!instance) {

                return res
                    .status(404)
                    .json({
                        result: "ERROR",
                        message: "Instancia no encontrada"
                    });
            }


            // =====================================================
            // SITE
            // =====================================================

            const site =
                await provWfSites
                    .findById(
                        instance.site_id
                    )
                    .lean();


            // =====================================================
            // WORKFLOW VERSION
            // =====================================================

            const version =
                await provWfVersions
                    .findById(
                        instance.workflow_version_id
                    )
                    .lean();


            // =====================================================
            // TASK DEFINITIONS
            // =====================================================

            const taskIds = [
                ...new Set(
                    (instance.nodes || [])
                        .map(
                            node =>
                                String(
                                    node.task_id || ""
                                )
                        )
                        .filter(Boolean)
                )
            ];

            const tasks =
                taskIds.length
                    ? await provWfTasks
                        .find({
                            _id: {
                                $in: taskIds
                            }
                        })
                        .lean()
                    : [];

            const taskMap =
                new Map(
                    tasks.map(task => [
                        String(task._id),
                        task
                    ])
                );


            // =====================================================
            // ENRICH RUNTIME NODES
            // =====================================================

            const enrichedNodes =
                (instance.nodes || [])
                    .map(node => {

                        const taskDefinition =
                            taskMap.get(
                                String(
                                    node.task_id || ""
                                )
                            );

                        /*
                         * Aunque no encuentre definición,
                         * devolvemos igualmente el node.
                         *
                         * information quedaría vacío.
                         */
                        if (!taskDefinition) {

                            return {
                                ...node,
                                information: []
                            };
                        }

                        const definitionSubtaskMap =
                            new Map(
                                (taskDefinition.subtasks || [])
                                    .map(subtask => [
                                        subtask.subtask_key,
                                        subtask
                                    ])
                            );


                        // =================================================
                        // SUBTASKS ENRICHED
                        // =================================================

                        const enrichedSubtasks =
                            (node.subtasks || [])
                                .map(runtimeSubtask => {

                                    const definition =
                                        definitionSubtaskMap.get(
                                            runtimeSubtask.subtask_key
                                        );

                                    if (!definition) {
                                        return runtimeSubtask;
                                    }

                                    const availableStates = (definition.states || []).map(state => ({
                                        state_key: state.state_key,
                                        label: state.label,
                                        option_list: {
                                            enabled: state.option_list?.enabled === true,
                                            label: state.option_list?.label || "Issue",
                                            options: state.option_list?.options || []
                                        },
                                        transition: {
                                            transition_type: state.transition?.transition_type || "STATE",
                                            target_subtask_key: state.transition?.target_subtask_key || null,
                                            target_subtask_keys: state.transition?.target_subtask_keys || [],
                                            set_non_blocking_subtask_keys: state.transition?.set_non_blocking_subtask_keys || [],
                                            target_state_key: state.transition?.target_state_key || null,
                                            requires_comment: state.transition?.requires_comment === true
                                        }
                                    }));

                                    return {
                                        ...runtimeSubtask,
                                        /**
                                         * definición necesaria
                                         * para pintar campos dinámicos
                                         */
                                        fields: definition.fields || [],
                                        /**
                                         * estados configurados
                                         * para la subtarea
                                         */
                                        available_states: availableStates,
                                        /**
                                         * definición adicional
                                         */
                                        assignment: definition.assignment || null,
                                        start_policy: definition.start_policy || null
                                    };
                                });

                        // =================================================
                        // INFORMATION FROM PREVIOUS TASK
                        // =================================================

                        const information = version
                            ? buildPreviousInformation({
                                instance,
                                version,
                                currentNode: node,
                                taskMapById: taskMap
                            })
                            : [];

                        return {
                            ...node,
                            subtasks: enrichedSubtasks,
                            information
                        };

                    });


            // =====================================================
            // RESPONSE
            // =====================================================

            return res.json({
                result: "OK",
                content: {
                    site,
                    instance: {
                        ...instance,
                        nodes: enrichedNodes
                    }
                }
            });

        } catch (e) {
            console.error("GET /instances/:instanceId/detail:", e);
            return res
                .status(500)
                .json({
                    result: "ERROR",
                    message: e.message || "No se pudo obtener el detalle de la instancia"
                });
        }

    }
);


// OBTENER VIAJE DEL SITE
instanceRouter.get("/instances/:instanceId/journey", async(req, res) => {
    try {
        const { provWfInstances, provWfVersions } = await db();
        const instance = await provWfInstances.findById(req.params.instanceId).lean();
        
        if (!instance) {
            return res.status(404).json({ 
                result: "ERROR", 
                message: "Instancia no encontrada" 
            });
        }

        const version = await provWfVersions.findById(instance.workflow_version_id).lean();
        
        return res.json({
            result: "OK",
            content: { 
                workflow: { 
                    nodes: version?.nodes || [], 
                    edges: version?.edges || [] 
                }, 
                runtime: instance.nodes || [] 
            }
        });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});


// OBTENER USUARIOS PARTICIPANTES DEL SITE
instanceRouter.get("/instances/:instanceId/participants", async(req, res) => {
    try {
        const { provWfInstances } = await db();
        const instance = await provWfInstances.findById(req.params.instanceId, { nodes: 1 }).lean();
        
        if (!instance) {
            return res.status(404).json({ 
                result: "ERROR", 
                message: "Instancia no encontrada" 
            });
        } 

        const ids = new Set();
        
        for (const node of instance.nodes || []) {
            for (const id of node.participants || []) ids.add(String(id));
            for (const subtask of node.subtasks || []) for (const id of subtask.assigned_user_ids || []) ids.add(String(id));
        }

        return res.json({ 
            result: "OK", 
            content: { 
                user_ids: [...ids] 
            } 
        });

    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});


// CAMBIAR ESTADO / TRANSICIÓN
instanceRouter.patch("/instances/:instanceId/tasks/:taskCode/subtasks/:subtaskKey/state", async(req, res) => {
    try {
        const models = await db();

        const result = await executeSubtaskTransition({
            instanceId: req.params.instanceId, 
            taskCode: req.params.taskCode, 
            subtaskKey: req.params.subtaskKey,
            targetState: req.body.state, 
            formData: req.body.form_data || {}, 
            comment: req.body.comment || null,
            selectedOption: req.body.selected_option || null,
            userId: req.body.user_id, 
            models
        });

        return res.json({ 
            result: "OK", 
            content: result 
        });
    } catch (e) {
        return res.status(400).json({ result: "ERROR", message: e.message });
    }
});


// ACTUALIZAR RESPONSABLES
instanceRouter.patch("/instances/:instanceId/tasks/:taskCode/subtasks/:subtaskKey/assignees", async(req, res) => {
    try {
        const models = await db();
        const result = await updateSubtaskAssignees({
            instanceId: req.params.instanceId, 
            taskCode: req.params.taskCode, 
            subtaskKey: req.params.subtaskKey,
            userIds: req.body.user_ids || [], 
            performedBy: req.body.performed_by || req.body.user_id, 
            models
        });
        return res.json({ result: "OK", content: result });
    } catch (e) {
        return res.status(400).json({ result: "ERROR", message: e.message });
    }
});


instanceRouter.patch("/instances/assignees/bulk", async(req, res) => {
    try {
        const models = await db();

        const {
            task_code,
            subtask_key,
            assignments = []
        } = req.body;

        const performedBy =
            req.body.performed_by ||
            req.body.user_id;

        if (!task_code) {
            throw new Error(
                "task_code es requerido"
            );
        }

        if (!subtask_key) {
            throw new Error(
                "subtask_key es requerido"
            );
        }

        if (
            !Array.isArray(assignments) ||
            assignments.length === 0
        ) {
            throw new Error(
                "Debe enviar assignments"
            );
        }

        const results = [];
        const errors = [];

        for (const item of assignments) {
            try {
                const result =
                    await updateSubtaskAssignees({
                        instanceId: item.instance_id,
                        taskCode: task_code,
                        subtaskKey: subtask_key,
                        userIds: item.user_ids || [],
                        performedBy,
                        models
                    });

                results.push(result);

            } catch (error) {
                errors.push({
                    instance_id: item.instance_id,
                    message: error.message
                });
            }
        }

        return res.json({
            result: errors.length
                ? "PARTIAL"
                : "OK",

            content: {
                updated: results.length,
                failed: errors.length,
                results,
                errors
            }
        });

    } catch (e) {
        return res
            .status(400)
            .json({
                result: "ERROR",
                message: e.message
            });
    }
});


// APERTURAR TAREA ANTICIPADAMENTE
instanceRouter.patch("/instances/:instanceId/tasks/:taskCode/open", async (req, res) => {
    try {
        const models = await db();

        const result = await manuallyOpenTask({
            instanceId: req.params.instanceId,
            taskCode: req.params.taskCode,
            userId: req.body.user_id,
            models
        });

        return res.json({ result: "OK", content: result });
    } catch (e) {
        return res.status(400).json({ result: "ERROR", message: e.message });
    }
});


// REABRIR TAREA EN MODO CORRECCIÓN
instanceRouter.patch("/instances/:instanceId/tasks/:taskCode/reopen", async (req, res) => {
    try {
        const models = await db();

        const result = await reopenTask({
            instanceId: req.params.instanceId,
            taskCode: req.params.taskCode,
            subtaskKey: req.body.subtask_key,
            userId: req.body.user_id,
            reason: req.body.reason,
            models
        });

        return res.json({ result: "OK", content: result });
    } catch (e) {
        console.error("PATCH reopen:", e);
        return res.status(400).json({ result: "ERROR", message: e.message });
    }
});


// CAMBIAR FECHA INICIAL Y RECALCULAR SLA
instanceRouter.patch("/instances/:instanceId/start-date", async(req, res) => {
    try {
        const models = await db();
        const result = await changeWorkflowStartDate({
            instanceId: req.params.instanceId, 
            startDate: req.body.start_date, 
            userId: req.body.user_id, models
        });
        return res.json({ result: "OK", content: result });
    } catch (e) {
        return res.status(400).json({ result: "ERROR", message: e.message });
    }
});


// SOLICITAR CANCELACIÓN
instanceRouter.patch("/instances/:instanceId/cancel", async(req, res) => {
    try {
        const models = await db();

        const result = await requestCancellation({
            instanceId: req.params.instanceId, 
            userId: req.body.user_id, 
            reason: req.body.reason, 
            models
        });

        return res.json({ result: "OK", content: result });
    } catch (e) {
        return res.status(400).json({ result: "ERROR", message: e.message });
    }
});

//ACTUALIZAR CAMPOS FORM DATA
instanceRouter.patch("/instances/:instanceId/tasks/:taskCode/subtasks/:subtaskKey/form-data", async(req, res) => {
    try {
        const models = await db();
        const result =
            await updateSubtaskFormData({
                instanceId: req.params.instanceId,
                taskCode: req.params.taskCode,
                subtaskKey: req.params.subtaskKey,
                formData: req.body.form_data || {},
                userId: req.body.user_id,
                models
            });

        return res.json({
            result: "OK",
            content: result
        });
    } catch (e) {
        return res
            .status(400)
            .json({
                result: "ERROR",
                message: e.message
            });
    }
});



module.exports = instanceRouter;
