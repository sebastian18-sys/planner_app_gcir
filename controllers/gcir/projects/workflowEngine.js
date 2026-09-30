// controllers/projects/workflowEngine.js

/**
 * Workflow Engine
 *
 * Responsabilidades:
 *
 * - Iniciar un workflow desde START
 * - Recorrer gateways
 * - Activar TASK
 * - Crear work items
 * - Completar actividades
 * - Completar TASK
 * - Ejecutar PARALLEL
 * - Ejecutar PARALLEL_JOIN
 * - Ejecutar EXCLUSIVE / XOR
 * - Actualizar wf_instances
 * - Actualizar wf_sites
 * - Registrar wf_events
 * - Gestionar actividades NO BLOQUEANTES
 * - Gestionar CANCEL_PENDING / CANCELLED
 */
const mongoose = require("mongoose");

/* ============================================================
 * HELPERS GENERALES
 * ============================================================ */
const TASK_STATUS = {
    NOT_REACHED: "NOT_REACHED",
    ACTIVE: "ACTIVE",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
    ERROR: "ERROR"
};

const SUBTASK_STATUS = {
    PENDING: "PENDING",
    ACTIVE: "ACTIVE",
    WAITING: "WAITING",
    OBSERVED: "OBSERVED",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED"
};

const INSTANCE_STATUS = {
    PENDING: "PENDING",
    ACTIVE: "ACTIVE",
    COMPLETED: "COMPLETED",
    CANCEL_PENDING: "CANCEL_PENDING",
    CANCELLED: "CANCELLED",
    ERROR: "ERROR"
};

const TRANSITION_TYPE = {
    STATE: "STATE",
    // Legacy
    MOVE_SUBTASK: "MOVE_SUBTASK",
    // Nuevos
    OPEN_SUBTASK: "OPEN_SUBTASK",
    WAIT_VALIDATION: "WAIT_VALIDATION",
    REOPEN_SUBTASK: "REOPEN_SUBTASK",
    CLOSE_SUBTASK: "CLOSE_SUBTASK",
    CLOSE_RELATED_SUBTASK: "CLOSE_RELATED_SUBTASK",
    CLOSE_AND_OPEN_SUBTASK: "CLOSE_AND_OPEN_SUBTASK",
    CLOSE_TASK: "CLOSE_TASK",
    STANDBY: "STANDBY",
    CLOSE_CURRENT_AND_SELECT_SUBTASKS: "CLOSE_CURRENT_AND_SELECT_SUBTASKS"
};

const ASSIGNMENT_MODE = {
    FIXED_USERS: "FIXED_USERS",
    DYNAMIC_PROVIDER: "DYNAMIC_PROVIDER",
    UNASSIGNED: "UNASSIGNED"
};

// NORMALIZAR FECHA
function normalizeDate(value) {
    if (!value) return null;

    const date = value instanceof Date
        ? new Date(value)
        : new Date(value);

    return isNaN(date.getTime())
        ? null
        : date;
}

// OBTENER FECHA SIN HORA
function startOfDay(value) {
    const date = normalizeDate(value);

    if (!date) return null;

    date.setHours(0, 0, 0, 0);

    return date;
}

// SUMAR DÍAS CALENDARIO / HÁBILES
function addDays(startDate, days, businessDays = false) {
    const date = startOfDay(startDate);

    if (!date) return null;

    let remaining = Math.max(Number(days) || 0, 0);

    while (remaining > 0) {
        date.setDate(date.getDate() + 1);

        if (!businessDays) {
            remaining--;
            continue;
        }

        const day = date.getDay();

        if (day !== 0 && day !== 6) {
            remaining--;
        }
    }

    return date;
}

function addCalendarDays(date, days) {

    const result = new Date(date);
    result.setDate(result.getDate() + Number(days || 0));

    return result;
}

function addBusinessDays(date, days) {

    const result = new Date(date);
    let remaining = Number(days || 0);

    while (remaining > 0) {

        result.setDate(result.getDate() + 1);
        const day = result.getDay();
        /*
         * 0 = Domingo
         * 6 = Sábado
         */
        if (day !== 0 && day !== 6) {
            remaining--;
        }
    }

    return result;
}



// OBTENER LA FECHA MAYOR DE UNA LISTA
function maxDate(values = []) {
    const dates = values
        .map(normalizeDate)
        .filter(Boolean);

    if (!dates.length) return null;

    return new Date(
        Math.max(...dates.map(x => x.getTime()))
    );
}

function unique(values = []) {
    return [
        ...new Set(
            values
                .filter(x => x != null && x !== "")
                .map(String)
        )
    ];
}

// OBTENER CONFIGURACIÓN DE UNA TAREA
function getTaskDefinition(taskCode, tasks) {
    const task = tasks.find(
        x => x.task_code === taskCode
    );

    if (!task) {
        throw new Error(
            `No existe configuración de Tarea ${taskCode}`
        );
    }

    return task;
}

// OBTENER RUNTIME DE UNA TAREA
function getNodeRuntime(instance, taskCode) {
    const node = (instance.nodes || []).find(
        x => x.task_code === taskCode
    );

    if (!node) {
        throw new Error(
            `No existe runtime de Tarea ${taskCode}`
        );
    }

    return node;
}

// OBTENER CONFIGURACIÓN DE UNA SUBTAREA
function getSubtaskDefinition(task, subtaskKey) {
    const subtask = (task.subtasks || []).find(
        x => x.subtask_key === subtaskKey
    );

    if (!subtask) {
        throw new Error(
            `No existe configuración de Subtarea ${subtaskKey}`
        );
    }

    return subtask;
}

// OBTENER RUNTIME DE UNA SUBTAREA
function getSubtaskRuntime(node, subtaskKey) {
    const subtask = (node.subtasks || []).find(
        x => x.subtask_key === subtaskKey
    );

    if (!subtask) {
        throw new Error(
            `No existe runtime de Subtarea ${subtaskKey}`
        );
    }

    return subtask;
}

// OBTENER ESTADO INICIAL DE UNA SUBTAREA
function getInitialState(subtask) {
    const states = [...(subtask.states || [])]
        .sort((a, b) => (a.order || 0) - (b.order || 0));

    return states[0]?.state_key || null;
}

// OBTENER CONFIGURACIÓN DE UN ESTADO
function getStateDefinition(subtask, stateKeyOrLabel) {
    return (subtask.states || []).find(
        x =>
            x.state_key === stateKeyOrLabel ||
            x.label === stateKeyOrLabel
    );
}

// VALIDAR SI UNA SUBTAREA ES BLOQUEANTE
function isBlockingSubtask(subtask) {
    return subtask.blocking !== false;
}

// OBTENER ORIGEN DE UNA CONEXIÓN
function edgeSource(edge) {
    return (
        edge.from ||
        edge.source ||
        edge.source_node_key
    );
}



// OBTENER DESTINO DE UNA CONEXIÓN
function edgeTarget(edge) {
    return (
        edge.to ||
        edge.target ||
        edge.target_node_key
    );
}

// OBTENER NODO DEL GRAFO POR SU KEY
function getGraphNode(version, nodeKey) {
    return (version.nodes || []).find(x =>
        x.node_key === nodeKey ||
        x.id === nodeKey
    );
}

// OBTENER NODO TASK DEL GRAFO
function getWorkflowTaskNode(version, taskCode) {
    return (version.nodes || []).find(x =>
        x.type === "TASK" &&
        (
            x.task_code === taskCode ||
            x.taskCode === taskCode
        )
    );
}

// OBTENER CONEXIONES SALIENTES DE UN NODO
function getOutgoingEdges(version, nodeKey) {
    return (version.edges || []).filter(x => edgeSource(x) === nodeKey);
}


// OBTENER CONEXIONES ENTRANTES DE UN NODO
function getIncomingEdges(version, nodeKey) {
    return (version.edges || []).filter(x => edgeTarget(x) === nodeKey);
}


// CREAR RUNTIME DE SUBTAREAS SI LA INSTANCIA AÚN NO LO TIENE
function ensureTaskSubtasksRuntime(node, task) {
    node.subtasks = node.subtasks || [];

    for (const definition of task.subtasks || []) {
        const exists = node.subtasks.some(x =>
            x.subtask_key === definition.subtask_key
        );

        if (exists) continue;

        node.subtasks.push({
            subtask_key: definition.subtask_key,
            name: definition.name,
            blocking: definition.blocking !== false,
            status: SUBTASK_STATUS.PENDING,
            state: getInitialState(definition),
            cycle: 1,
            
            assignment_pool_user_ids: [],
            assigned_user_ids: [],
            assignment_source: "TEMPLATE",
            assignment_updated_by: null,
            assignment_updated_at: null,


            opened_at: null,
            completed_at: null,
            last_comment: null,
            form_data: {}
        });
    }

    return node.subtasks;
}


/* ============================================================
 * EVENTOS
 * ============================================================ */

async function createEvent({
    instance,
    taskCode = null,
    subtaskKey = null,
    eventType,
    performedBy = null,
    fromState = null,
    toState = null,
    comment = null,
    data = {},
    models
}) {
    const { provWfEvents } = models;

    return provWfEvents.create({
        instance_id: instance._id,
        site_id: instance.site_id,
        identificador: instance.identificador,
        workflow_code: instance.workflow_code,
        task_code: taskCode,
        subtask_key: subtaskKey,
        event_type: eventType,
        from_state: fromState,
        to_state: toState,
        performed_by: performedBy,
        comment,
        data,
        event_at: new Date()
    });
}

// SINCRONIZAR SUBTAREA CON WORK ITEM / BANDEJA
async function syncWorkItem({
    instance,
    node,
    subtask,
    status,
    performedBy = null,
    models
}) {
    const { provWfWorkItems } = models;

    const q = {
        instance_id: instance._id,
        task_code: node.task_code,
        subtask_key: subtask.subtask_key,
        cycle: subtask.cycle || 1
    };

    if ([SUBTASK_STATUS.ACTIVE, SUBTASK_STATUS.OBSERVED].includes(status)) {
        await provWfWorkItems.findOneAndUpdate(
            q,
            {
                $set: {
                    site_id: instance.site_id,
                    identificador: instance.identificador,
                    workflow_code: instance.workflow_code,
                    node_key: node.node_key,
                    task_name: node.task_name,
                    subtask_name: subtask.name,
                    blocking: subtask.blocking,
                    status: status === SUBTASK_STATUS.OBSERVED ? "OBSERVED" : "OPEN",
                    state: subtask.state,

                    assignment_pool_user_ids: subtask.assignment_pool_user_ids || [],
                    assigned_user_ids: subtask.assigned_user_ids || [],

                    assignment_source: subtask.assignment_source,
                    assignment_updated_by: subtask.assignment_updated_by,
                    assignment_updated_at: subtask.assignment_updated_at,

                    last_comment: subtask.last_comment || null,
                    last_selected_option: subtask.last_selected_option || null,
                    last_action_by: subtask.last_action_by || null,
                    last_action_at: subtask.last_action_at || null,

                    form_data: subtask.form_data || {},
                    opened_at: subtask.opened_at || new Date(),
                    completed_at: null,
                    completed_by: null
                }
            },
            { new: true, upsert: true }
        );

        return;
    }

    let workStatus = "WAITING";

    if (status === SUBTASK_STATUS.COMPLETED) workStatus = "COMPLETED";
    if (status === SUBTASK_STATUS.CANCELLED) workStatus = "CANCELLED";

    await provWfWorkItems.updateMany(
        q,
        {
            $set: {
                status: workStatus,
                state: subtask.state,
                form_data: subtask.form_data || {},
                assignment_pool_user_ids: subtask.assignment_pool_user_ids || [],
                assigned_user_ids: subtask.assigned_user_ids || [],
                assignment_source: subtask.assignment_source,
                assignment_updated_by: subtask.assignment_updated_by,
                assignment_updated_at: subtask.assignment_updated_at,

                last_comment: subtask.last_comment || null,
                last_selected_option: subtask.last_selected_option || null,
                last_action_by: subtask.last_action_by || null,
                last_action_at: subtask.last_action_at || null,

                completed_at: status === SUBTASK_STATUS.COMPLETED ? new Date() : null,
                completed_by: status === SUBTASK_STATUS.COMPLETED ? performedBy : null
            }
        }
    );
}

// OBTENER VALOR DE UN CAMPO DESDE LAS SUBTAREAS DE UNA TAREA
function getTaskFieldValue(node, fieldKey) {
    for (const subtask of node.subtasks || []) {
        if (!subtask.form_data) continue;

        if (
            subtask.form_data[fieldKey] != null &&
            subtask.form_data[fieldKey] !== ""
        ) {
            return subtask.form_data[fieldKey];
        }
    }

    return null;
}

// RESOLVER RESPONSABLES FIJOS O DINÁMICOS DE UNA SUBTAREA
// async function resolveDynamicAssignment({
//     instance,
//     node,
//     task,
//     subtask,
//     models
// }) {
//     const assignment = subtask.assignment || {};

//     if (assignment.mode === ASSIGNMENT_MODE.FIXED_USERS) {
//         return unique(assignment.user_ids || []);
//     }

//     if (assignment.mode === ASSIGNMENT_MODE.UNASSIGNED) {
//         return [];
//     }

//     if (assignment.mode !== ASSIGNMENT_MODE.DYNAMIC_PROVIDER) {
//         return [];
//     }

//     const sourceField = assignment.provider_source_field;

//     if (!sourceField) {
//         return [];
//     }

//     const providerValue = getTaskFieldValue(node, sourceField);

//     if (!providerValue) {
//         return [];
//     }

//     /*
//      * El Workflow Engine no debería consultar SQL directamente.
//      * Desde el controller/service se debe enviar una función:
//      *
//      * models.resolveProviderUsers(providerValue)
//      *
//      * La función debe resolver:
//      * proveedor -> usuarios activos del proveedor.
//      */

//     if (typeof models.resolveProviderUsers !== "function") {
//         return [];
//     }

//     const users = await models.resolveProviderUsers(providerValue);

//     return unique(users || []);
// }

// async function resolveDynamicAssignment({
//     instance,
//     node,
//     task,
//     subtask,
//     models
// }) {
//     const assignment = subtask.assignment || {};

//     const mode = assignment.mode || ASSIGNMENT_MODE.UNASSIGNED;

//     const responsibles = assignment.responsibles || [];

//     // =========================================================
//     // SIN ASIGNACIÓN
//     // =========================================================
//     if (mode === ASSIGNMENT_MODE.UNASSIGNED) {
//         return {
//             user_ids: [],
//             source: {
//                 mode,
//                 responsibles: [],
//                 provider_source_field: null,
//                 provider_value: null,
//                 resolved_user_ids: []
//             }
//         };
//     }

//     // =========================================================
//     // USUARIOS / GRUPOS FIJOS
//     // =========================================================
//     if (mode === ASSIGNMENT_MODE.FIXED_USERS) {

//         const userIds = [];
//         const groupIds = [];

//         for (const responsible of responsibles) {

//             if (
//                 responsible.type === "USER" &&
//                 responsible.id
//             ) {
//                 userIds.push(
//                     String(responsible.id)
//                 );
//             }

//             if (
//                 responsible.type === "GROUP" &&
//                 responsible.id
//             ) {
//                 groupIds.push(
//                     String(responsible.id)
//                 );
//             }
//         }

//         /*
//          * Compatibilidad temporal con estructura antigua
//          */
//         for (const userId of assignment.user_ids || []) {
//             userIds.push(
//                 String(userId)
//             );
//         }

//         /*
//          * Resolver miembros de grupos.
//          *
//          * El engine NO consulta MySQL directamente.
//          */
//         if (
//             groupIds.length &&
//             typeof models.resolveGroupUsers === "function"
//         ) {
//             const resolvedGroupUsers = await models.resolveGroupUsers(
//                 groupIds
//             );

//             userIds.push(
//                 ...(resolvedGroupUsers || [])
//             );
//         }

//         const resolvedUsers = unique(userIds);

//         return {
//             user_ids: resolvedUsers,

//             source: {
//                 mode,
//                 responsibles,
//                 provider_source_field: null,
//                 provider_value: null,
//                 resolved_user_ids: resolvedUsers
//             }
//         };
//     }

//     // =========================================================
//     // PROVEEDOR DINÁMICO
//     // =========================================================
//     if (mode === ASSIGNMENT_MODE.DYNAMIC_PROVIDER) {
//         const sourceField = assignment.provider_source_field;

//         if (!sourceField) {
//             return {
//                 user_ids: [],
//                 source: {
//                     mode,
//                     responsibles: [],
//                     provider_source_field: null,
//                     provider_value: null,
//                     resolved_user_ids: []
//                 }
//             };
//         }

//         const providerValue = getTaskFieldValue(node, sourceField);

//         if (!providerValue) {
//             return {
//                 user_ids: [],
//                 source: {
//                     mode,
//                     responsibles: [],
//                     provider_source_field: sourceField,
//                     provider_value: null,
//                     resolved_user_ids: []
//                 }
//             };
//         }

//         let resolvedUsers = [];

//         if (typeof models.resolveProviderUsers === "function") {
//             resolvedUsers = await models.resolveProviderUsers(
//                 providerValue
//             );
//         }

//         resolvedUsers = unique(resolvedUsers || []);

//         return {
//             user_ids: resolvedUsers,

//             source: {
//                 mode,
//                 responsibles: [],
//                 provider_source_field: sourceField,
//                 provider_value: providerValue,
//                 resolved_user_ids: resolvedUsers
//             }
//         };
//     }

//     return {
//         user_ids: [],
//         source: {
//             mode,
//             responsibles: [],
//             provider_source_field: null,
//             provider_value: null,
//             resolved_user_ids: []
//         }
//     };
// }


async function initializeInstanceAssignments({
    instance,
    tasks,
    resolvedAssignments = {},
    models
}) {

    const taskMap =
        new Map(
            (tasks || []).map(
                task => [
                    String(task.task_code),
                    task
                ]
            )
        );

    for (
        const node
        of instance.nodes || []
    ) {

        const task =
            taskMap.get(
                String(node.task_code)
            );

        if (!task) {
            continue;
        }

        ensureTaskSubtasksRuntime(
            node,
            task
        );

        for (const definition of task.subtasks || []) {

            const runtime = getSubtaskRuntime(node, definition.subtask_key);

            const assignmentKey = `${node.task_code}::${definition.subtask_key}`

            const preResolvedUserIds = resolvedAssignments[assignmentKey]

            let resolved

            if (
                definition.assignment?.mode === ASSIGNMENT_MODE.FIXED_USERS &&
                Array.isArray(preResolvedUserIds)
            ) {
                resolved = {
                    user_ids: unique(preResolvedUserIds.map(String)),
                    source: "TEMPLATE"
                }
            } else {
                resolved =
                    await resolveDynamicAssignment({
                        instance,
                        node,
                        task,
                        subtask: definition,
                        models
                    })
            }
    
            runtime.assignment_pool_user_ids = resolved.user_ids || [];
            runtime.assigned_user_ids = resolved.user_ids || [];
            runtime.assignment_source = resolved.source;
            runtime.assignment_updated_by = null;

            /*
             * DYNAMIC_PROVIDER puede todavía
             * no tener información suficiente.
             */
            if (
                definition.assignment?.mode !==
                    ASSIGNMENT_MODE.DYNAMIC_PROVIDER ||
                (resolved.user_ids || [])
                    .length > 0
            ) {

                runtime.assignment_updated_at =
                    new Date();
            }
        }
    }

    return instance;
}


async function resolveDynamicAssignment({
    instance,
    node,
    task,
    subtask,
    models
}) {
    const assignment = subtask.assignment || {};

    // =========================================================
    // SIN ASIGNACIÓN
    // =========================================================

    if (
        !assignment.mode ||
        assignment.mode === ASSIGNMENT_MODE.UNASSIGNED
    ) {
        return {
            user_ids: [],
            source: "TEMPLATE"
        };
    }

    // =========================================================
    // ASIGNACIÓN FIJA DESDE PLANTILLA
    // USUARIOS + GRUPOS
    // =========================================================

    if (
        assignment.mode === ASSIGNMENT_MODE.FIXED_USERS
    ) {
        const userIds = [];
        const groupIds = [];

        /*
         * Nueva estructura:
         *
         * responsibles: [
         *   { type: "USER", id: "10" },
         *   { type: "GROUP", id: "3" }
         * ]
         */

        for (
            const responsible
            of assignment.responsibles || []
        ) {

            if (
                responsible.type === "USER" &&
                responsible.id
            ) {
                userIds.push(
                    String(responsible.id)
                );
            }

            if (
                responsible.type === "GROUP" &&
                responsible.id
            ) {
                groupIds.push(
                    String(responsible.id)
                );
            }
        }

        /*
         * Compatibilidad con estructura anterior.
         *
         * Importante para NO romper workflows
         * que ya tengan user_ids.
         */

        for (const userId of assignment.user_ids || []) {
            userIds.push(
                String(userId)
            );
        }

        // Resolver miembros de grupos

        if (
            groupIds.length > 0 &&
            typeof models.resolveGroupUsers === "function"
        ) {
            const groupUsers =
                await models.resolveGroupUsers(
                    groupIds
                );

            userIds.push(
                ...(groupUsers || [])
                    .map(String)
            );
        }

        return {
            user_ids: unique(userIds),
            source: "TEMPLATE"
        };
    }

    // =========================================================
    // PROVEEDOR DINÁMICO
    // =========================================================

    if (
        assignment.mode ===
        ASSIGNMENT_MODE.DYNAMIC_PROVIDER
    ) {

        const sourceField =
            assignment.provider_source_field;

        if (!sourceField) {
            return {
                user_ids: [],
                source: "DYNAMIC_PROVIDER"
            };
        }

        const providerValue =
            getTaskFieldValue(
                node,
                sourceField
            );

        if (!providerValue) {
            return {
                user_ids: [],
                source: "DYNAMIC_PROVIDER"
            };
        }

        if (
            typeof models.resolveProviderUsers !==
            "function"
        ) {
            return {
                user_ids: [],
                source: "DYNAMIC_PROVIDER"
            };
        }

        const users =
            await models.resolveProviderUsers(
                providerValue
            );

        return {
            user_ids: unique(
                (users || []).map(String)
            ),

            source: "DYNAMIC_PROVIDER"
        };
    }

    return {
        user_ids: [],
        source: "TEMPLATE"
    };
}


// ACTIVAR SUBTAREA Y CREAR SU WORK ITEM
async function activateSubtask({
    instance,
    node,
    task,
    subtaskKey,
    performedBy = null,
    observed = false,
    comment = null,
    openedAt = null,
    models
}) {
    ensureTaskSubtasksRuntime(node, task);

    const definition = getSubtaskDefinition(task, subtaskKey);
    const runtime = getSubtaskRuntime(node, subtaskKey);
    const previousStatus = runtime.status;

    if (runtime.status === SUBTASK_STATUS.COMPLETED) {
        runtime.cycle = (runtime.cycle || 1) + 1;
    }

    runtime.status = observed
        ? SUBTASK_STATUS.OBSERVED
        : SUBTASK_STATUS.ACTIVE;

    runtime.state = getInitialState(definition);
    runtime.opened_at = openedAt || new Date();
    runtime.completed_at = null;
    runtime.last_comment = comment || null;

    // runtime.assigned_user_ids = await resolveDynamicAssignment({
    //     instance,
    //     node,
    //     task,
    //     subtask: definition,
    //     models
    // });

    const isDynamicProvider =
    definition.assignment?.mode ===
    ASSIGNMENT_MODE.DYNAMIC_PROVIDER;

    const hasPool = (runtime.assignment_pool_user_ids || []).length > 0;
    const hasAssignmentInitialization = runtime.assignment_updated_at != null;

    /*
    * =====================================================
    * RESOLVER SOLO SI TODAVÍA NO EXISTE SNAPSHOT
    * =====================================================
    *
    * FIXED_USERS:
    * normalmente ya quedó resuelto al lanzar la instancia.
    *
    * DYNAMIC_PROVIDER:
    * puede no haberse resuelto en el lanzamiento porque
    * el campo proveedor todavía no existía.
    */
    if (
        !hasAssignmentInitialization ||
        (
            isDynamicProvider &&
            !hasPool
        )
    ) {

        const resolvedAssignment =
            await resolveDynamicAssignment({
                instance,
                node,
                task,
                subtask: definition,
                models
            });

        /*
        * Solo sobrescribimos si realmente
        * tenemos una resolución válida.
        */
        if (
            !isDynamicProvider ||
            (resolvedAssignment.user_ids || []).length > 0
        ) {

            runtime.assignment_pool_user_ids = resolvedAssignment.user_ids || [];
            runtime.assigned_user_ids = resolvedAssignment.user_ids || [];
            runtime.assignment_source = resolvedAssignment.source;
            runtime.assignment_updated_by = null;
            runtime.assignment_updated_at = new Date();
        }
    }

    // runtime.assignment_source =
    // definition.assignment?.mode === "DYNAMIC_PROVIDER"
    //     ? "DYNAMIC_PROVIDER"
    //     : "TEMPLATE";    

    node.participants = unique([
        ...(node.participants || []),
        ...(runtime.assigned_user_ids || [])
    ]);

    await syncWorkItem({
        instance,
        node,
        subtask: runtime,
        status: runtime.status,
        performedBy,
        models
    });

    await createEvent({
        instance,
        taskCode: node.task_code,
        subtaskKey,
        eventType: observed ? "SUBTASK_OBSERVED" : "SUBTASK_STARTED",
        performedBy,
        fromState: previousStatus,
        toState: runtime.status,
        comment,
        data: {
            cycle: runtime.cycle,
            assigned_user_ids: runtime.assigned_user_ids,
            assignment_source: runtime.assignment_source,
            assignment_updated_by: runtime.assignment_updated_by,
            assignment_updated_at: runtime.assignment_updated_at
        },
        models
    });

    return runtime;
}

// MOVER A OTRA SUBTAREA SIN COMPLETAR LA SUBTAREA ORIGEN
async function moveSubtask({
    instance,
    node,
    task,
    sourceSubtask,
    targetSubtaskKey,
    performedBy,
    comment,
    observed = false,
    models
}) {
    sourceSubtask.status = SUBTASK_STATUS.WAITING;
    sourceSubtask.last_comment = comment || null;

    await syncWorkItem({
        instance,
        node,
        subtask: sourceSubtask,
        status: SUBTASK_STATUS.WAITING,
        performedBy,
        models
    });

    await createEvent({
        instance,
        taskCode: node.task_code,
        subtaskKey: sourceSubtask.subtask_key,
        eventType: "SUBTASK_MOVED",
        performedBy,
        fromState: sourceSubtask.state,
        toState: sourceSubtask.state,
        comment,
        data: {
            target_subtask_key: targetSubtaskKey
        },
        models
    });

    const targetRuntime = await activateSubtask({
        instance,
        node,
        task,
        subtaskKey: targetSubtaskKey,
        performedBy,
        observed,
        comment,
        models
    });

    node.status = TASK_STATUS.ACTIVE;

    return targetRuntime;
}

// COMPLETAR SUBTAREA
async function completeSubtask({
    instance,
    node,
    subtask,
    performedBy,
    models
}) {
    subtask.status = SUBTASK_STATUS.COMPLETED;
    subtask.completed_at = new Date();

    /*
     * Una Subtarea completada nunca puede
     * continuar marcada como Stand By.
     */
    subtask.is_standby = false;
    subtask.standby_since = null;
    subtask.standby_state_key = null;

    await syncWorkItem({
        instance,
        node,
        subtask,
        status: SUBTASK_STATUS.COMPLETED,
        performedBy,
        models
    });

    await createEvent({
        instance,
        taskCode: node.task_code,
        subtaskKey: subtask.subtask_key,
        eventType: "SUBTASK_COMPLETED",
        performedBy,
        toState: subtask.state,
        data: {
            cycle: subtask.cycle || 1
        },
        models
    });
}

// VALIDAR SI QUEDAN SUBTAREAS BLOQUEANTES ABIERTAS
function taskHasPendingBlockingSubtasks(task, node) {
    return (node.subtasks || []).some(
        runtime => {
            if (runtime.blocking === false) {
                return false;
            }

            return [
                SUBTASK_STATUS.PENDING,
                SUBTASK_STATUS.ACTIVE,
                SUBTASK_STATUS.WAITING,
                SUBTASK_STATUS.OBSERVED
            ].includes(
                runtime.status
            );
        }
    );
}

// VALIDAR SI TODAS LAS SUBTAREAS DE LA TASK TERMINARON
function taskHasPendingSubtasks(task, node) {
    return (task.subtasks || []).some(definition => {

        const runtime = getSubtaskRuntime(node, definition.subtask_key);

        return (
            runtime.status !==
            SUBTASK_STATUS.COMPLETED
        );
    });
}


// HELPER MAX RELEASE AT
function getTaskReleasedAt(
    task,
    node
) {

    const blockingSubtasks = (node.subtasks || []).filter(subtask => subtask.blocking !== false);

    if (!blockingSubtasks.length) {
        return (
            node.started_at ||
            new Date()
        );
    }

    const blockingDates = blockingSubtasks
        .map(subtask => subtask.completed_at)
        .filter(Boolean)
        .map(value => new Date(value));


    if (!blockingDates.length) {
        return null;
    }


    return new Date(
        Math.max(
            ...blockingDates.map(date => date.getTime())
        )
    );
}


// LIBERAR WORKFLOW CUANDO FINALIZAN LOS REQUISITOS BLOQUEANTES
async function releaseTaskWorkflow({
    instance,
    node,
    task,
    performedBy,
    version,
    models
}) {

    /*
     * el workflow solamente puede liberarse una vez.
     *
     * Después seguirán terminando Subtasks
     * no bloqueantes y evaluateTaskCompletion()
     * será llamado nuevamente.
     */
    if (node.workflow_released === true) {
        return false;
    }

    node.workflow_released = true;
    node.released_at = getTaskReleasedAt(task, node);
    // node.released_at = node.released_at || new Date();

    await createEvent({
        instance,
        taskCode: node.task_code,
        eventType: "TASK_RELEASED",
        performedBy,
        data: {
            task_status: node.status
        },
        models
    });

    /*
     * La TASK permanece ACTIVE.
     */
    await continueWorkflowFromTask({
        instance,
        node,
        version,
        performedBy,
        models
    });

    return true;
}


// ACTIVAR SIGUIENTE SUBTAREA BLOQUEANTE PENDIENTE
async function activateNextPendingSubtask({
    instance,
    node,
    task,
    performedBy,
    models
}) {
    const next = (task.subtasks || [])
        .sort(
            (a, b) =>
                (a.order || 0) -
                (b.order || 0)
        )
        .find(definition => {
            const runtime = getSubtaskRuntime(node, definition.subtask_key);
            return (
                runtime.blocking !== false &&
                runtime.status === SUBTASK_STATUS.PENDING
            );
        });

    if (!next) {
        return null;
    }

    return activateSubtask({
        instance,
        node,
        task,
        subtaskKey: next.subtask_key,
        performedBy,
        models
    });
}


function getPendingBlockingSubtasksExcept(
    task,
    node,
    currentSubtaskKey
) {
    return (node.subtasks || []).filter(runtime => {

        if (runtime.subtask_key === currentSubtaskKey) {
            return false;
        }

        if (runtime.blocking === false) {
            return false;
        }

        return [
            SUBTASK_STATUS.PENDING,
            SUBTASK_STATUS.ACTIVE,
            SUBTASK_STATUS.WAITING,
            SUBTASK_STATUS.OBSERVED
        ].includes(
            runtime.status
        );
    });
}


// VALIDAR Y COMPLETAR TAREA SI YA NO QUEDAN SUBTAREAS BLOQUEANTES
async function evaluateTaskCompletion({
    instance,
    node,
    task,
    performedBy,
    version,
    models
}) {

    /*
     * Los bloqueantes solamente determinan cuándo
     * podemos continuar al siguiente nodo.
     */
    const hasPendingBlocking = taskHasPendingBlockingSubtasks(task, node);

    if (!hasPendingBlocking && node.workflow_released !== true) {
        await releaseTaskWorkflow({
            instance,
            node,
            task,
            performedBy,
            version,
            models
        });
    }

    /*
     * La TASK solamente termina cuando TODAS
     * sus Subtasks están COMPLETED.
     */
    const hasPendingSubtasks = taskHasPendingSubtasks(task, node);

    if (hasPendingSubtasks) {
        node.status = TASK_STATUS.ACTIVE;
        node.finished_at = null;

        return {
            released: node.workflow_released === true,
            completed: false
        };
    }

    /*
     * Todas las actividades terminaron.
     */
    await completeTask({
        instance,
        node,
        task,
        performedBy,
        version,
        models
    });

    return {
        released: node.workflow_released === true,
        completed: true
    };
}


// HELFER FINISH AT
function getTaskFinishedAt(node) {
    const dates =
        (node.subtasks || [])
            .map(
                subtask => subtask.completed_at
            )
            .filter(Boolean)
            .map(
                value => new Date(value)
            );

    if (!dates.length) {
        return new Date();
    }

    return new Date(
        Math.max(
            ...dates.map(
                date => date.getTime()
            )
        )
    );
}


// COMPLETAR TASK CUANDO TODAS SUS SUBTASK TERMINARON
async function completeTask({
    instance,
    node,
    task,
    performedBy,
    version,
    models
}) {

    /*
     * Evitar eventos duplicados.
     */
    if (node.status === TASK_STATUS.COMPLETED) {
        return node;
    }

    node.status = TASK_STATUS.COMPLETED;
    // node.finished_at = new Date();
    node.finished_at = getTaskFinishedAt(node)

    /*
     * Este fallback cubre TASK donde todas las
     * actividades terminan al mismo tiempo.
     */
    if (node.workflow_released !== true) {
        await releaseTaskWorkflow({
            instance,
            node,
            task,
            performedBy,
            version,
            models
        });
    }

    await createEvent({
        instance,
        taskCode: node.task_code,
        eventType: "TASK_COMPLETED",
        performedBy,
        data: {
            workflow_released: node.workflow_released === true,
            reopen_correction: !!node.reopen_correction
        },
        models
    });

    if (node.reopen_correction) {
        node.reopen_correction = false;
        node.manual_opened = false;
    }

    return node;
}


// VALIDAR SI UNA TASK YA LIBERÓ EL WORKFLOW
function isTaskNodeReleased(
    instance,
    nodeKey
) {

    const runtime = (instance.nodes || []).find(
        x => x.node_key === nodeKey
    );

    if (!runtime) {
        return false;
    }

    /*
     * COMPLETED se conserva como fallback
     * para instancias anteriores al cambio.
     */
    return (
        runtime.workflow_released === true ||
        runtime.status === TASK_STATUS.COMPLETED
    );
}

// VALIDAR SI TODOS LOS CAMINOS ANTERIORES A UN JOIN FUERON COMPLETADOS
function canCompleteParallelJoin(instance, version, gatewayNodeKey) {
    const incoming = getIncomingEdges(version, gatewayNodeKey);

    if (!incoming.length) {
        return true;
    }

    return incoming.every(edge => {
        const sourceKey = edgeSource(edge);
        const sourceDefinition = getGraphNode(version, sourceKey);

        if (!sourceDefinition) {
            return false;
        }

        if (sourceDefinition.type === "TASK") {
            return isTaskNodeReleased(
                instance,
                sourceKey
            );
        }

        return true;
    });
}

// ACTIVAR UNA TAREA DEL WORKFLOW
async function activateTaskNode({
    instance,
    nodeDefinition,
    performedBy,
    models
}) {
    const { provWfTasks } = models;

    const node = (instance.nodes || []).find(x =>
        x.node_key === nodeDefinition.node_key ||
        x.node_key === nodeDefinition.id
    );

    if (!node) {
        throw new Error(
            `Runtime no encontrado para nodo ${nodeDefinition.node_key || nodeDefinition.id}`
        );
    }

    if (
        node.status === TASK_STATUS.ACTIVE ||
        node.status === TASK_STATUS.COMPLETED
    ) {
        return node;
    }

    const task = await provWfTasks
        .findOne({ task_code: node.task_code })
        .lean();

    if (!task) {
        throw new Error(
            `Configuración no encontrada para ${node.task_code}`
        );
    }

    ensureTaskSubtasksRuntime(node, task);

    node.status = TASK_STATUS.ACTIVE;

    const startedAt = node.started_at || new Date();
    node.started_at = startedAt

    /*
     * Normalmente el forecast SLA ya fue calculado
     * al lanzar la instancia.
     */

    if (!node.forecast?.sla_date) {
        // const baseDate =
        //     instance.workflow_start_date ||
        //     node.started_at ||
        //     new Date();

        // const slaDate = addDays(
        //     baseDate,
        //     task.sla_days,
        //     task.business_days
        // );

        const slaDate = calculateTaskSlaDate(
            node.started_at,
            task
        );


        node.forecast = node.forecast || {};
        node.forecast.sla_date = slaDate;
        node.forecast.current_date = slaDate;
        node.forecast.source = "AUTO_SLA";
        node.forecast.revision = 0;
    }

    let startCandidates = (task.subtasks || []).filter(x =>
        x.start_policy === "ON_TASK_START"
    );

    if (!startCandidates.length) {
        const firstBlocking = (task.subtasks || [])
            .filter(isBlockingSubtask)
            .sort((a, b) => (a.order || 0) - (b.order || 0))[0];

        if (firstBlocking) {
            startCandidates = [firstBlocking];
        }
    }

    for (const subtask of startCandidates) {
        await activateSubtask({
            instance,
            node,
            task,
            subtaskKey: subtask.subtask_key,
            performedBy,
            openedAt: startedAt,
            models
        });
    }

    node.participants = unique(node.participants || []);

    await createEvent({
        instance,
        taskCode: node.task_code,
        eventType: "TASK_STARTED",
        performedBy,
        data: {
            manual_opened: !!node.manual_opened
        },
        models
    });

    return node;
}


async function startWorkflow({
    instance,
    version,
    performedBy = null,
    models
}) {

    const startNode =
        (version.nodes || [])
            .find(
                node =>
                    node.type === "START"
            );

    if (!startNode) {
        throw new Error(
            "El workflow no tiene nodo START"
        );
    }

    const outgoing =
        getOutgoingEdges(
            version,
            startNode.node_key ||
            startNode.id
        );

    if (!outgoing.length) {
        throw new Error(
            "El nodo START no tiene conexión de salida"
        );
    }

    for (const edge of outgoing) {

        const target = getGraphNode(version, edgeTarget(edge));

        if (!target) {
            continue;
        }

        /*
         * START → TASK
         *
         * Conserva el funcionamiento actual.
         */
        if (target.type === "TASK") {
            await activateTaskNode({
                instance,
                nodeDefinition: target,
                performedBy,
                models
            });
            continue;
        }

        /*
         * START → GATEWAY
         *
         * NUEVO:
         * permite PARALLEL_SPLIT,
         * EXCLUSIVE, etc.
         */
        if (target.type === "GATEWAY") {
            await evaluateGateway({
                instance,
                gatewayNode: target,
                version,
                performedBy,
                models
            });
            continue;
        }

        /*
         * Workflow vacío:
         * START → END
         */
        if (target.type === "END") {
            await evaluateWorkflowCompletion({
                instance,
                performedBy,
                models
            });
        }
    }

    refreshActiveNodes(
        instance
    );

    return instance;
}



// CONTINUAR EL WORKFLOW DESDE UNA TAREA COMPLETADA
async function continueWorkflowFromTask({
    instance,
    node,
    version,
    performedBy,
    models
}) {
    if (instance.status === INSTANCE_STATUS.CANCEL_PENDING) return

    const outgoing = getOutgoingEdges(version, node.node_key);

    for (const edge of outgoing) {
        const targetKey = edgeTarget(edge);
        const targetNode = getGraphNode(version, targetKey);

        if (!targetNode) {
            continue;
        }

        if (targetNode.type === "TASK") {
            await activateTaskNode({
                instance,
                nodeDefinition: targetNode,
                performedBy,
                models
            });

            continue;
        }

        if (targetNode.type === "GATEWAY") {
            await evaluateGateway({
                instance,
                gatewayNode: targetNode,
                version,
                performedBy,
                models
            });

            continue;
        }

        if (targetNode.type === "END") {
            await evaluateWorkflowCompletion({
                instance,
                performedBy,
                models
            });
        }
    }
}

// EVALUAR CONDICIÓN SIMPLE DE UN EDGE EXCLUSIVO
function evaluateEdgeCondition(edge, instance) {
    if (edge.is_default === true) {
        return true;
    }

    /*
     * Aquí se puede ampliar posteriormente:
     *
     * edge.condition = {
     *     field: "TIPO_ESTACION",
     *     operator: "EQ",
     *     value: "Greenfield"
     * }
     */

    if (!edge.condition) {
        return false;
    }

    return false;
}

// CONTINUAR DESDE UN GATEWAY HACIA SUS NODOS DESTINO
async function continueFromGateway({
    instance,
    gatewayNode,
    version,
    performedBy,
    models
}) {
    const outgoing = getOutgoingEdges(
        version,
        gatewayNode.node_key || gatewayNode.id
    );

    for (const edge of outgoing) {
        const target = getGraphNode(
            version,
            edgeTarget(edge)
        );

        if (!target) continue;

        if (target.type === "TASK") {
            await activateTaskNode({
                instance,
                nodeDefinition: target,
                performedBy,
                models
            });

            continue;
        }

        if (target.type === "GATEWAY") {
            await evaluateGateway({
                instance,
                gatewayNode: target,
                version,
                performedBy,
                models
            });

            continue;
        }

        if (target.type === "END") {
            await evaluateWorkflowCompletion({
                instance,
                performedBy,
                models
            });
        }
    }
}

// EVALUAR GATEWAY PARALELO / EXCLUSIVO
async function evaluateGateway({
    instance,
    gatewayNode,
    version,
    performedBy,
    models
}) {
    const gatewayKey =
        gatewayNode.node_key ||
        gatewayNode.id;

    const gatewayType =
        gatewayNode.gateway_type ||
        gatewayNode.gatewayType;

    if (gatewayType === "PARALLEL_SPLIT") {
        await continueFromGateway({
            instance,
            gatewayNode,
            version,
            performedBy,
            models
        });

        return;
    }

    if (gatewayType === "PARALLEL_JOIN") {
        const canContinue = canCompleteParallelJoin(
            instance,
            version,
            gatewayKey
        );

        if (!canContinue) {
            return;
        }

        await continueFromGateway({
            instance,
            gatewayNode,
            version,
            performedBy,
            models
        });

        return;
    }

    if (gatewayType === "EXCLUSIVE") {
        const outgoing = getOutgoingEdges(
            version,
            gatewayKey
        );

        let selected = outgoing.find(edge =>
            evaluateEdgeCondition(
                edge,
                instance
            )
        );

        if (!selected) {
            selected =
                outgoing.find(x => x.is_default === true) ||
                outgoing[0];
        }

        if (!selected) {
            return;
        }

        const target = getGraphNode(version, edgeTarget(selected));

        if (!target) {
            return;
        }

        if (target.type === "TASK") {
            await activateTaskNode({
                instance,
                nodeDefinition: target,
                performedBy,
                models
            });

            return;
        }

        if (target.type === "GATEWAY") {
            await evaluateGateway({
                instance,
                gatewayNode: target,
                version,
                performedBy,
                models
            });

            return;
        }

        if (target.type === "END") {
            await evaluateWorkflowCompletion({
                instance,
                performedBy,
                models
            });
        }
    }
}


async function evaluateWorkflowCompletion({
    instance,
    performedBy,
    models
}) {

    /*
     * =====================================================
     * TASK TODAVÍA ACTIVAS
     * =====================================================
     */
    const hasActive =
        (instance.nodes || [])
            .some(
                node =>
                    node.status === TASK_STATUS.ACTIVE
            );


    /*
     * =====================================================
     * TASK TODAVÍA NO ALCANZADAS
     * =====================================================
     */
    const hasPending =
        (instance.nodes || [])
            .some(
                node =>
                    node.status === TASK_STATUS.NOT_REACHED
            );


    /*
     * =====================================================
     * SUBTASK RESIDUALES ABIERTAS
     * =====================================================
     *
     * Una TASK puede estar COMPLETED porque todas sus
     * Subtasks bloqueantes terminaron.
     *
     * Sin embargo, sus no bloqueantes pueden continuar
     * trabajando.
     */
    const hasOpenSubtasks =
        (instance.nodes || [])
            .some(
                node =>
                    (node.subtasks || [])
                        .some(
                            subtask =>
                                [
                                    SUBTASK_STATUS.ACTIVE,
                                    SUBTASK_STATUS.OBSERVED,
                                    SUBTASK_STATUS.WAITING
                                ].includes(
                                    subtask.status
                                )
                        )
            );

    /*
     * Mientras quede cualquier trabajo operativo,
     * la instancia sigue abierta.
     */
    if (hasActive || hasPending || hasOpenSubtasks) {
        return false;
    }


    if (instance.status === INSTANCE_STATUS.CANCEL_PENDING) {
        return finalizeCancellationIfNeeded({
            instance,
            performedBy,
            models
        });
    }

    instance.status = INSTANCE_STATUS.COMPLETED;
    instance.finished_at = new Date();

    await createEvent({
        instance,
        eventType: "WORKFLOW_COMPLETED",
        performedBy,
        models
    });


    return true;
}




function refreshActiveNodes(instance) {

    instance.active_nodes =
        unique(
            (instance.nodes || [])
                .filter(
                    node => node.status === TASK_STATUS.ACTIVE
                )
                .map(
                    node => node.node_key
                )
                .filter(Boolean)
        );

    return instance.active_nodes;
}


async function applySystemFieldBindings({
    instance,
    node,
    subtaskDefinition,
    formData,
    performedBy,
    models
}) {

    const field =
        (subtaskDefinition.fields || [])
            .find(
                field => field.system_binding === "TASK_RESPONSIBLE_FORECAST"
            );

    if (!field) {
        return;
    }

    /*
     * El usuario no modificó ese campo.
     */
    if (!Object.prototype
            .hasOwnProperty
            .call(formData, field.field_key)
    ) {
        return;
    }

    const raw = formData[field.field_key];
    const previous = node.forecast?.responsible_date || null;

    let next = null;

    if (raw !== null && raw !== "") {
        next = normalizeDate(raw);
        if (!next) {
            throw new Error(
                "Fecha Forecast Responsable inválida"
            );
        }
    }

    node.forecast = node.forecast || {};
    node.forecast.responsible_date = next;

    refreshCurrentForecast(node);

    node.forecast.revision = (node.forecast.revision || 0) + 1;
    node.forecast.updated_by = String(performedBy);
    node.forecast.updated_at = new Date();

    await createEvent({
        instance,
        taskCode: node.task_code,
        subtaskKey: subtaskDefinition.subtask_key,
        eventType: "FORECAST_UPDATED",
        performedBy,
        data: {
            forecast_source:"RESPONSIBLE",
            source_field_key: field.field_key,
            old_date: previous,
            new_date: next
        },
        models
    });
}


async function closeCurrentAndSelectedSubtasks({
    instance,
    node,
    task,
    currentSubtask,
    targetSubtaskKeys = [],
    targetState,
    performedBy,
    comment = null,
    models
}) {
    const uniqueTargets = unique(targetSubtaskKeys)
        .filter(key => key !== currentSubtask.subtask_key);

    /*
     * Validar primero toda la configuración.
     * Si una key no existe, no modificamos parcialmente.
     */
    for (const subtaskKey of uniqueTargets) {
        getSubtaskDefinition(task, subtaskKey);
        getSubtaskRuntime(node, subtaskKey);
    }

    /*
     * Cerrar actual.
     * Su state ya fue actualizado antes en
     * executeSubtaskTransition().
     */
    await completeSubtask({
        instance,
        node,
        subtask: currentSubtask,
        performedBy,
        models
    });

    /*
     * Cerrar seleccionadas.
     */
    for (const subtaskKey of uniqueTargets) {
        const runtime = getSubtaskRuntime(node, subtaskKey);

        if (runtime.status === SUBTASK_STATUS.COMPLETED) continue

        /*
         * Para el caso NA propagamos el mismo
         * estado de negocio a las Subtasks cerradas.
         * Ejemplo:
         * PLANIFICACION = NA
         * EJECUCION     = NA
         * SF            = NA
         */
        runtime.state = targetState;
        runtime.last_comment = comment || null;
        runtime.is_standby = false;
        runtime.standby_since = null;
        runtime.standby_state_key = null;

        await completeSubtask({
            instance,
            node,
            subtask: runtime,
            performedBy,
            models
        });
    }

    return {
        current_subtask_key: currentSubtask.subtask_key,
        closed_subtask_keys: uniqueTargets
    };
}

// HELPER MODIFICAR BLOQUEANTES
async function setSubtasksNonBlocking({
    instance,
    node,
    subtaskKeys = [],
    performedBy,
    models
}) {
    const keys = unique(subtaskKeys);

    if (!keys.length) {
        return [];
    }

    const changed = [];

    for (const subtaskKey of keys) {
        const runtime = getSubtaskRuntime(
            node,
            subtaskKey
        );

        if (runtime.blocking === false) {
            continue;
        }

        runtime.blocking = false;

        changed.push({
            subtask_key: subtaskKey,
            blocking: false
        });
    }

    if (changed.length && models.provWfWorkItems) {
        await models.provWfWorkItems.updateMany(
            {
                instance_id: instance._id,
                task_code: node.task_code,
                subtask_key: {
                    $in: changed.map(
                        item =>
                            item.subtask_key
                    )
                }
            },
            {
                $set: {
                    blocking: false
                }
            }
        );
    }

    if (changed.length) {
        await createEvent({
            instance,
            taskCode: node.task_code,
            eventType: "SUBTASK_BLOCKING_UPDATED",
            performedBy,
            data: {
                changed
            },
            models
        });
    }

    return changed;
}


// EJECUTAR CAMBIO DE ESTADO Y TRANSICIÓN DE UNA SUBTAREA
async function executeSubtaskTransition({
    instanceId,
    taskCode,
    subtaskKey,
    targetState,
    formData = {},
    comment = null,
    selectedOption = null,
    userId,
    models
}) {
    const {
        provWfInstances,
        provWfTasks,
        provWfVersions
    } = models;

    const instance = await provWfInstances.findById(instanceId);

    if (!instance) {
        throw new Error("Instancia no encontrada");
    }

    if (
        [
            INSTANCE_STATUS.CANCELLED,
            INSTANCE_STATUS.COMPLETED
        ].includes(instance.status)
    ) {
        throw new Error(
            "La instancia no permite modificaciones"
        );
    }

    const node = getNodeRuntime(instance, taskCode);

    const task = await provWfTasks
        .findOne({ task_code: taskCode })
        .lean();

    if (!task) {
        throw new Error(
            "Configuración de Tarea no encontrada"
        );
    }

    ensureTaskSubtasksRuntime(node, task);

    const subtaskDefinition = getSubtaskDefinition(task, subtaskKey);
    const subtaskRuntime = getSubtaskRuntime(node, subtaskKey);

    if (
        ![
            SUBTASK_STATUS.ACTIVE,
            SUBTASK_STATUS.OBSERVED
        ].includes(subtaskRuntime.status)
    ) {
        throw new Error(
            "La Subtarea no se encuentra activa"
        );
    }

    if (!(subtaskRuntime.assigned_user_ids || []).includes(String(userId))) {
        throw new Error(
            "El usuario no está asignado a esta Subtarea"
        );
    }

    const state = getStateDefinition(subtaskDefinition, targetState);

    if (!state) {
        throw new Error(
            `Estado ${targetState} no configurado`
        );
    }

    const transition = state.transition || {};

    if (transition.requires_comment && !String(comment || "").trim()) {
        throw new Error(
            "La transición requiere comentario"
        );
    }

    const optionList = state.option_list || {};
    const optionEnabled = optionList.enabled === true;
    const allowedOptions = optionList.options || [];

    if (optionEnabled) {
        if (!String(selectedOption || "").trim()) {
            throw new Error(`Seleccionar ${optionList.label || "una opción"}`);
        }

        if (!allowedOptions.includes(String(selectedOption))) {
            throw new Error("La opción seleccionada no está configurada para este estado");
        }
    }

    const setNonBlockingKeys = unique(transition.set_non_blocking_subtask_keys || []);


    /*
    * =====================================================
    * VALIDACIÓN PREVIA CLOSE_TASK
    * =====================================================
    *
    * CLOSE_TASK no fuerza el cierre de otras Subtareas.
    * La Subtarea que lo ejecuta debe ser la última
    * bloqueante abierta.
    */
    if (transition.transition_type === TRANSITION_TYPE.CLOSE_TASK) {

        const pendingBlocking = getPendingBlockingSubtasksExcept(
            task,
            node,
            subtaskRuntime.subtask_key
        );


        if (pendingBlocking.length) {

            const names = pendingBlocking
                .map(x => x.name || x.subtask_key)
                .join(", ");

            throw new Error(
                `No se puede cerrar la TASK. Existen Subtareas bloqueantes pendientes: ${names}`
            );
        }
    }

    subtaskRuntime.form_data = {
        ...(subtaskRuntime.form_data || {}),
        ...(formData || {})
    };

    await applySystemFieldBindings({
        instance,
        node,
        subtaskDefinition,
        formData,
        performedBy: userId,
        models
    });

    const previousState = subtaskRuntime.state;

    subtaskRuntime.state = state.state_key;
    subtaskRuntime.last_comment = comment || null;
    subtaskRuntime.last_selected_option = optionEnabled ? String(selectedOption) : null;
    subtaskRuntime.last_action_by = userId ? String(userId) : null;
    subtaskRuntime.last_action_at = new Date();
    subtaskRuntime.last_selected_option = optionEnabled
        ? String(selectedOption)
        : null;

    await createEvent({
        instance,
        taskCode,
        subtaskKey,
        eventType: "SUBTASK_STATE_CHANGED",
        performedBy: userId,
        fromState: previousState,
        toState: state.state_key,
        comment,
        data: {
            action_label: state.action_label,
            transition_type: transition.transition_type,
            target_subtask_key: transition.target_subtask_key || null,
            target_subtask_keys: transition.target_subtask_keys || [],
            set_non_blocking_subtask_keys: transition.set_non_blocking_subtask_keys || [],
            target_state_key: transition.target_state_key || null,
            selected_option: optionEnabled ? String(selectedOption) : null,
            is_standby: transition.transition_type === TRANSITION_TYPE.STANDBY,
            form_data: formData
        },
        models
    });


    if (setNonBlockingKeys.length) {
        await setSubtasksNonBlocking({
            instance,
            node,
            subtaskKeys: setNonBlockingKeys,
            performedBy: userId,
            models
        });
    }

    /*
    * =====================================================
    * EXIT STAND BY
    * =====================================================
    *
    * Si la Subtarea estaba detenida y el usuario
    * selecciona cualquier estado que NO sea STANDBY,
    * sale automáticamente de la condición Stand By.
    */

    if (
        subtaskRuntime.is_standby === true &&
        transition.transition_type !== TRANSITION_TYPE.STANDBY
    ) {
        subtaskRuntime.is_standby = false;
        subtaskRuntime.standby_since = null;
        subtaskRuntime.standby_state_key = null;
    }

    switch (transition.transition_type) {
        // Cambio de estado. Subtarea Activa
        case TRANSITION_TYPE.STATE:
            await syncWorkItem({
                instance,
                node,
                subtask: subtaskRuntime,
                status: subtaskRuntime.status,
                performedBy: userId,
                models
            });
            break;

        // Movimiento entre subtareas
        case TRANSITION_TYPE.MOVE_SUBTASK:
            if (!transition.target_subtask_key) {
                throw new Error(
                    "La transición no tiene Subtarea destino"
                );
            }

            await moveSubtask({
                instance,
                node,
                task,
                sourceSubtask: subtaskRuntime,
                targetSubtaskKey: transition.target_subtask_key,
                performedBy: userId,
                comment,
                observed: !!transition.requires_comment,
                models
            });
            break;

        // Abrir subtareas sin cerrar la actual
        case TRANSITION_TYPE.OPEN_SUBTASK: {

            if (!transition.target_subtask_key) {
                throw new Error(
                    "La transición no tiene Subtarea destino"
                );
            }

            await activateSubtask({
                instance,
                node,
                task,
                subtaskKey: transition.target_subtask_key,
                performedBy: userId,
                models
            });

            const targetRuntime = getSubtaskRuntime(node, transition.target_subtask_key);

            if (transition.target_state_key) {
                targetRuntime.state = transition.target_state_key;

                await syncWorkItem({
                    instance,
                    node,
                    subtask: targetRuntime,
                    status: targetRuntime.status,
                    performedBy: userId,
                    models
                });
            }

            // La actual sigue activa.
            await syncWorkItem({
                instance,
                node,
                subtask: subtaskRuntime,
                status: subtaskRuntime.status,
                performedBy: userId,
                models
            });

            break;
        }

        // Subtarea esperando validación
        case TRANSITION_TYPE.WAIT_VALIDATION:

            subtaskRuntime.status = SUBTASK_STATUS.WAITING;

            await syncWorkItem({
                instance,
                node,
                subtask: subtaskRuntime,
                status: SUBTASK_STATUS.WAITING,
                performedBy: userId,
                models
            });

            break;

        // Reabrir subtarea
        case TRANSITION_TYPE.REOPEN_SUBTASK: {

            if (!transition.target_subtask_key) {
                throw new Error(
                    "La transición no tiene Subtarea destino"
                );
            }

            const targetRuntime = getSubtaskRuntime(node, transition.target_subtask_key);

            targetRuntime.status = SUBTASK_STATUS.ACTIVE;
            targetRuntime.completed_at = null;
            targetRuntime.opened_at = new Date();

            targetRuntime.is_standby = false;
            targetRuntime.standby_since = null;
            targetRuntime.standby_state_key = null;

            targetRuntime.cycle = Number(targetRuntime.cycle || 1) + 1;

            if (transition.target_state_key) {
                targetRuntime.state = transition.target_state_key;
            }

            await syncWorkItem({
                instance,
                node,
                subtask: targetRuntime,
                status: SUBTASK_STATUS.ACTIVE,
                performedBy: userId,
                models
            });

            break;
        }

        case TRANSITION_TYPE.CLOSE_SUBTASK:
            await completeSubtask({
                instance,
                node,
                subtask: subtaskRuntime,
                performedBy: userId,
                models
            });

            // await activateNextPendingSubtask({
            //     instance,
            //     node,
            //     task,
            //     performedBy: userId,
            //     models
            // });
            break;

        // Cerrar otra subtarea
        case TRANSITION_TYPE.CLOSE_RELATED_SUBTASK: {

            if (!transition.target_subtask_key) {
                throw new Error(
                    "La transición no tiene Subtarea relacionada"
                );
            }

            const targetRuntime = getSubtaskRuntime(node, transition.target_subtask_key);

            /*
             * No aprobar algo no aperturado
             */
            if (targetRuntime.status === SUBTASK_STATUS.PENDING) {
                throw new Error(
                    `La Subtarea "${targetRuntime.name}" todavía no ha sido aperturada`
                );
            }

            /*
             * No aprobar si está esperando validación.
             */
            if (targetRuntime.status !== SUBTASK_STATUS.WAITING) {
                throw new Error(
                    `La Subtarea "${targetRuntime.name}" todavía no ha sido enviada a validar`
                );
            }

            if (transition.target_state_key) {
                targetRuntime.state = transition.target_state_key;
            }

            await completeSubtask({
                instance,
                node,
                subtask: targetRuntime,
                performedBy: userId,
                models
            });

            /*
             * IMPORTANTE:
             * subtaskRuntime NO se completa.
             * Gestión sigue ACTIVE.
             */
            await syncWorkItem({
                instance,
                node,
                subtask: subtaskRuntime,
                status: subtaskRuntime.status,
                performedBy: userId,
                models
            });

            break;
        }

        // Cierra subtarea y abre otra
        case TRANSITION_TYPE.CLOSE_AND_OPEN_SUBTASK: {
            if (!transition.target_subtask_key) {
                throw new Error(
                    "La transición no tiene Subtarea destino"
                );
            }

            await completeSubtask({
                instance,
                node,
                subtask: subtaskRuntime,
                performedBy: userId,
                models
            });

            await activateSubtask({
                instance,
                node,
                task,
                subtaskKey: transition.target_subtask_key,
                performedBy: userId,
                models
            });

            const targetRuntime = getSubtaskRuntime(node, transition.target_subtask_key);

            if (transition.target_state_key) {
                targetRuntime.state = transition.target_state_key;

                await syncWorkItem({
                    instance,
                    node,
                    subtask: targetRuntime,
                    status: targetRuntime.status,
                    performedBy: userId,
                    models
                });
            }

            break;
        }

        case TRANSITION_TYPE.CLOSE_TASK:

            await completeSubtask({
                instance,
                node,
                subtask: subtaskRuntime,
                performedBy: userId,
                models
            });

            break;

        case TRANSITION_TYPE.STANDBY:
            subtaskRuntime.is_standby = true;

            /*
            * Conservamos la primera fecha en la que
            * entró a Stand By.
            *
            * Si selecciona nuevamente otro estado
            * también configurado como STANDBY,
            * no reiniciamos el contador.
            */
            if (!subtaskRuntime.standby_since) {
                subtaskRuntime.standby_since =
                    new Date();
            }

            subtaskRuntime.standby_state_key = state.state_key;

            /*
            * Técnicamente permanece ACTIVE.
            *
            * No usamos status = STANDBY porque
            * Stand By es una condición adicional,
            * no un estado técnico del runtime.
            */
            subtaskRuntime.status = SUBTASK_STATUS.ACTIVE;

            await syncWorkItem({
                instance,
                node,
                subtask: subtaskRuntime,
                status: SUBTASK_STATUS.ACTIVE,
                performedBy: userId,
                models
            });

            break;

        case TRANSITION_TYPE.CLOSE_CURRENT_AND_SELECT_SUBTASKS: {
            const targets = unique(transition.target_subtask_keys || []);

            if (!targets.length) {
                throw new Error(
                    "Seleccionar al menos una Subtarea relacionada"
                );
            }

            await closeCurrentAndSelectedSubtasks({
                instance,
                node,
                task,
                currentSubtask: subtaskRuntime,
                targetSubtaskKeys: targets,
                targetState: state.state_key,
                performedBy: userId,
                comment,
                models
            });

            break;
        }

        default:
            throw new Error(
                `Tipo de transición no soportado: ${transition.transition_type}`
            );

        
    }

    const version = await provWfVersions
        .findById(instance.workflow_version_id)
        .lean();

    if (!version) {
        throw new Error(
            "Versión de Workflow no encontrada"
        );
    }

    // EVALUAR SU LA TAREA FUE COMPLETADA
    await evaluateTaskCompletion({
        instance,
        node,
        task,
        performedBy: userId,
        version,
        models
    });

    /*
    * Es posible que END ya haya sido alcanzado
    * cuando se liberó la TASK, pero todavía
    * quedaban Subtasks activas.
    *
    * Volvemos a evaluar al terminar cada actividad.
    */
    await evaluateWorkflowCompletion({
        instance,
        performedBy: userId,
        models
    });

    await finalizeCancellationIfNeeded({
        instance,
        performedBy: userId,
        models
    });

    refreshActiveNodes(
        instance
    );

    await instance.save();

    return {
        instance_id: instance._id,
        task_code: taskCode,
        task_status: node.status,
        subtask_key: subtaskKey,
        subtask_status: subtaskRuntime.status,
        subtask_state: subtaskRuntime.state,
        participants: node.participants,
        forecast: node.forecast
    };
}

// ACTUALIZAR RESPONSABLES DE UNA SUBTAREA EN EJECUCIÓN
// async function updateSubtaskAssignees({
//     instanceId,
//     taskCode,
//     subtaskKey,
//     userIds = [],
//     performedBy,
//     models
// }) {
//     const { provWfInstances } = models;

//     const instance = await provWfInstances.findById(instanceId);

//     if (!instance) {
//         throw new Error(
//             "Instancia no encontrada"
//         );
//     }

//     const node = getNodeRuntime(
//         instance,
//         taskCode
//     );

//     const subtask = getSubtaskRuntime(node, subtaskKey);

//     const previous = subtask.assigned_user_ids || [];
//     subtask.assigned_user_ids = unique(userIds);

//     subtask.assignment_source = "MANUAL";
//     subtask.assignment_updated_by = performedBy || null;
//     subtask.assignment_updated_at = new Date();

//     node.participants = unique([
//         ...(node.participants || []),
//         ...subtask.assigned_user_ids
//     ]);

//     await syncWorkItem({
//         instance,
//         node,
//         subtask,
//         status: subtask.status,
//         performedBy,
//         models
//     });

//     await createEvent({
//         instance,
//         taskCode,
//         subtaskKey,
//         eventType: "ASSIGNMENT_UPDATED",
//         performedBy,
//         data: {
//             previous_user_ids: previous,
//             assigned_user_ids: subtask.assigned_user_ids
//         },
//         models
//     });

//     await instance.save();

//     return {
//         assigned_user_ids: subtask.assigned_user_ids,
//         participants: node.participants
//     };
// }

async function updateSubtaskAssignees({
    instanceId,
    taskCode,
    subtaskKey,
    userIds = [],
    performedBy,
    models
}) {
    const { provWfInstances } = models;

    const instance = await provWfInstances.findById(instanceId);

    if (!instance) {
        throw new Error(
            "Instancia no encontrada"
        );
    }

    if ([INSTANCE_STATUS.COMPLETED, INSTANCE_STATUS.CANCELLED].includes(instance.status)) {
        throw new Error(
            "La instancia no permite reasignaciones"
        );
    }

    const node = getNodeRuntime(instance, taskCode);
    const runtime = getSubtaskRuntime(node, subtaskKey);
    const nextUserIds = unique(userIds);

    /*
     * Validar contra el pool configurado.
     */
    runtime.assignment_pool_user_ids = unique([
        ...(runtime.assignment_pool_user_ids || []),
        ...nextUserIds
    ]);

    const previousUserIds = unique(runtime.assigned_user_ids || []);

    runtime.assigned_user_ids = nextUserIds;
    runtime.assignment_source = "MANUAL";
    runtime.assignment_updated_by = performedBy
        ? String(performedBy)
        : null;

    runtime.assignment_updated_at = new Date();

    /*
     * participants es histórico.
     * No quitamos participantes anteriores.
     */
    node.participants =
        unique([
            ...(node.participants || []),
            ...nextUserIds
        ]);

    await syncWorkItem({
        instance,
        node,
        subtask: runtime,
        status: runtime.status,
        performedBy,
        models
    });

    await createEvent({
        instance,
        taskCode,
        subtaskKey,
        eventType: "ASSIGNMENT_UPDATED",
        performedBy,
        data: {
            previous_user_ids: previousUserIds,
            assigned_user_ids: nextUserIds
        },

        models
    });

    await instance.save();

    return {
        instance_id: instance._id,
        task_code: taskCode,
        subtask_key: subtaskKey,
        assignment_pool_user_ids: runtime.assignment_pool_user_ids,
        assigned_user_ids: runtime.assigned_user_ids,
        assignment_source: runtime.assignment_source,
        assignment_updated_by: runtime.assignment_updated_by,
        assignment_updated_at: runtime.assignment_updated_at
    };
}



async function updateSubtaskFormData({
    instanceId,
    taskCode,
    subtaskKey,
    formData = {},
    userId,
    models
}) {
    const { provWfInstances, provWfTasks } = models;

    const instance = await provWfInstances.findById(instanceId);

    if (!instance) {
        throw new Error(
            "Instancia no encontrada"
        );
    }

    if (
        [
            INSTANCE_STATUS.CANCELLED,
            INSTANCE_STATUS.COMPLETED
        ].includes(
            instance.status
        )
    ) {
        throw new Error(
            "La instancia no permite modificaciones"
        );
    }

    const node = getNodeRuntime(instance, taskCode);

    const task = await provWfTasks
        .findOne({
            task_code: taskCode
        })
        .lean();

    if (!task) {
        throw new Error(
            "Configuración de Tarea no encontrada"
        );
    }

    ensureTaskSubtasksRuntime(node, task);

    const subtaskDefinition = getSubtaskDefinition(task, subtaskKey);
    const subtaskRuntime = getSubtaskRuntime(node, subtaskKey);

    /*
     * Solo permitimos guardar campos
     * mientras la Subtask esté operativa.
     */
    if (
        ![
            SUBTASK_STATUS.ACTIVE,
            SUBTASK_STATUS.OBSERVED
        ].includes(
            subtaskRuntime.status
        )
    ) {
        throw new Error(
            "La Subtarea no se encuentra activa"
        );
    }

    /*
     * El usuario debe ser responsable
     * de la Subtask.
     */
    if (
        !(
            subtaskRuntime
                .assigned_user_ids ||
            []
        )
            .map(String)
            .includes(
                String(userId)
            )
    ) {
        throw new Error(
            "El usuario no está asignado a esta Subtarea"
        );
    }

    /*
     * Solo aceptamos fields definidos
     * para esta Subtask.
     */
    const fieldMap = new Map((subtaskDefinition.fields || [])
        .map(field => [
            field.field_key,
            field
        ])
    );

    const cleanFormData = {};

    for (const [fieldKey, value] of Object.entries(formData || {})) {
        const definition = fieldMap.get(fieldKey);

        if (!definition) {
            continue;
        }

        if (definition.editable === false) {
            continue;
        }

        cleanFormData[fieldKey] = value;
    }

    /*
     * Guardar form_data.
     */
    subtaskRuntime.form_data = {
        ...(subtaskRuntime.form_data || {}),
        ...cleanFormData
    };

    /*
     * Si alguno de los campos representa
     * el Forecast Responsable,
     * sincronizamos node.forecast.
     */
    for (const [fieldKey, value] of Object.entries(cleanFormData)) {
        const definition = fieldMap.get(fieldKey);

        if (definition?.system_binding !== "TASK_RESPONSIBLE_FORECAST") {
            continue;
        }

        const previous = node.forecast?.responsible_date || null;

        let next = null;

        if (value !== null && value !== "") {
            next = normalizeDate(value);

            if (!next) {
                throw new Error(
                    `Fecha inválida en ${definition.label || fieldKey}`
                );
            }
        }

        node.forecast = node.forecast || {};
        node.forecast.responsible_date = next;

        refreshCurrentForecast(node);

        node.forecast.revision = (node.forecast.revision || 0) + 1;

        node.forecast.updated_by = String(userId);
        node.forecast.updated_at = new Date();

        await createEvent({
            instance,
            taskCode,
            subtaskKey,
            eventType: "FORECAST_UPDATED",
            performedBy: userId,
            data: {
                forecast_source: "RESPONSIBLE",
                field_key: fieldKey,
                old_date: previous,
                new_date: next
            },
            models
        });
    }

    /*
     * Mantener WorkItem sincronizado.
     */
    await syncWorkItem({
        instance,
        node,
        subtask: subtaskRuntime,
        status: subtaskRuntime.status,
        performedBy: userId,
        models
    });

    instance.markModified("nodes");

    await instance.save();

    return {
        instance_id: instance._id,
        task_code: taskCode,
        subtask_key: subtaskKey,
        subtask_status: subtaskRuntime.status,
        subtask_state: subtaskRuntime.state,
        form_data: subtaskRuntime.form_data,
        forecast: node.forecast
    };
}



function refreshCurrentForecast(node) {

    node.forecast = node.forecast || {};

    /*
     * PM tiene prioridad
     */
    if (node.forecast.pm_date) {
        node.forecast.current_date = node.forecast.pm_date;
        node.forecast.source = "PM";
        return;
    }


    /*
     * Luego responsable
     */
    if (node.forecast.responsible_date) {
        node.forecast.current_date = node.forecast.responsible_date;
        node.forecast.source = "RESPONSIBLE";
        return;
    }


    /*
     * Finalmente SLA
     */
    node.forecast.current_date = node.forecast.sla_date || null;
    node.forecast.source = "AUTO_SLA";
}


// ACTUALIZAR FORECAST GLOBAL DE UNA TAREA Y REGISTRAR REVISIÓN
async function updateTaskForecast({
    instanceId,
    taskCode,
    forecastDate,
    type = "CHANGE",

    forecastSource = "MANUAL",
    canOverride = false,

    reason,
    userId,
    models
}) {
    const { provWfInstances } = models;

    if (
        !forecastDate ||
        !String(reason || "").trim()
    ) {
        throw new Error(
            "Fecha y motivo son requeridos"
        );
    }

    const instance =
        await provWfInstances.findById(
            instanceId
        );

    if (!instance) {
        throw new Error(
            "Instancia no encontrada"
        );
    }

    const node = getNodeRuntime(
        instance,
        taskCode
    );

    const allowedUsers = unique([
        ...(node.participants || []),

        ...(node.subtasks || [])
            .flatMap(
                x =>
                    x.assigned_user_ids ||
                    []
            )
    ]);

    /*
     * PM / Admin deben validarse idealmente
     * mediante middleware antes de llegar al engine.
     */

    if (!canOverride && !allowedUsers.includes(String(userId))) {
        throw new Error(
            "Usuario sin permiso para modificar forecast"
        );
    }


    /*
     * =====================================================
     * VALIDAR SOURCE
     * =====================================================
     */

    const source = String(forecastSource || "MANUAL").toUpperCase();

    const validSources = [
        "MANUAL",
        "RESPONSIBLE",
        "PM"
    ];

    if (!validSources.includes(source)) {
        throw new Error(
            "Tipo de forecast inválido"
        );
    }

    /*
     * =====================================================
     * FECHA
     * =====================================================
     */

    const next = normalizeDate(forecastDate);

    if (!next) {
        throw new Error(
            "Fecha forecast inválida"
        );
    }

    node.forecast = node.forecast || {};

    // const previous =
    //     node.forecast?.current_date ||
    //     node.forecast?.sla_date ||
    //     null;

    let previous = null;

    /*
     * =====================================================
     * RESPONSABLE
     * =====================================================
     */

    if (source === "RESPONSIBLE") {
        previous = node.forecast.responsible_date || null;
        node.forecast.responsible_date = next;
    }

    /*
     * =====================================================
     * PM
     * =====================================================
     */

    else if (source === "PM") {
        previous = node.forecast.pm_date || null;
        node.forecast.pm_date = next;
    }

    /*
     * =====================================================
     * LEGACY / MANUAL
     *
     * Mantiene exactamente el comportamiento
     * anterior para bulk.controller y
     * forecastController.
     * =====================================================
     */

    else {
        previous =
            node.forecast?.current_date ||
            node.forecast?.sla_date || null;

        node.forecast.current_date = next;
        node.forecast.source = "MANUAL";
    }


    /*
     * =====================================================
     * RECALCULAR CURRENT
     *
     * Solo para los nuevos forecasts explícitos.
     *
     * Prioridad:
     * PM > RESPONSIBLE > SLA
     * =====================================================
     */

    if (source === "RESPONSIBLE" || source === "PM") {
        refreshCurrentForecast(node);
    }

    /*
     * =====================================================
     * METADATA
     * =====================================================
     */

    node.forecast.revision = (node.forecast.revision || 0) + 1;
    node.forecast.updated_by = String(userId);
    node.forecast.updated_at = new Date();

    await createEvent({
        instance,
        taskCode,
        eventType: "FORECAST_UPDATED",
        performedBy: userId,
        comment: reason,
        data: {
            revision: node.forecast.revision,
            old_date: previous,
            new_date: next,
            type,
            forecast_source: source,
            reason
        },
        models
    });

    instance.markModified("nodes");

    await instance.save();

    return {
        task_code: taskCode,
        forecast: node.forecast
    };
}

// APERTURAR MANUALMENTE UNA TAREA QUE AÚN NO INICIÓ
async function manuallyOpenTask({
    instanceId,
    taskCode,
    userId,
    models
}) {
    const {
        provWfInstances,
        provWfVersions
    } = models;

    const instance = await provWfInstances.findById(instanceId);

    if (!instance) {
        throw new Error(
            "Instancia no encontrada"
        );
    }

    const node = getNodeRuntime(instance, taskCode);

    if (node.status !== TASK_STATUS.NOT_REACHED) {
        throw new Error(
            "Solo se puede aperturar una Tarea no iniciada"
        );
    }

    const version = await provWfVersions
        .findById(instance.workflow_version_id)
        .lean();

    if (!version) {
        throw new Error(
            "Versión de Workflow no encontrada"
        );
    }

    const nodeDefinition = getWorkflowTaskNode(version, taskCode);

    if (!nodeDefinition) {
        throw new Error(
            "Nodo del workflow no encontrado"
        );
    }

    node.manual_opened = true;

    await activateTaskNode({
        instance,
        nodeDefinition,
        performedBy: userId,
        models
    });

    await createEvent({
        instance,
        taskCode,
        eventType: "TASK_STARTED",
        performedBy: userId,
        comment: "Apertura anticipada",
        data: {
            manual_opened: true
        },
        models
    });

    refreshActiveNodes(
        instance
    );

    await instance.save();

    return {
        task_code: taskCode,
        status: node.status,
        manual_opened: true
    };
}

// REABRIR TAREA COMPLETADA SIN VOLVER A DISPARAR EL FLUJO POSTERIOR
async function reopenTask({
    instanceId,
    taskCode,
    subtaskKey,
    userId,
    reason,
    models
}) {

    const { provWfInstances, provWfTasks } = models;

    if (!String(reason || "").trim()) {
        throw new Error(
            "El motivo de reapertura es obligatorio"
        );
    }

    const instance = await provWfInstances.findById(instanceId);

    if (!instance) {
        throw new Error(
            "Instancia no encontrada"
        );
    }

    const node = getNodeRuntime(instance, taskCode);

    if (node.status !== TASK_STATUS.COMPLETED) {
        throw new Error(
            "Solo se puede reabrir una Tarea completada"
        );
    }

    const task =
        await provWfTasks.findOne({
            task_code: taskCode
        }).lean();

    if (!task) {
        throw new Error(
            "Configuración de Tarea no encontrada"
        );
    }

    ensureTaskSubtasksRuntime(node, task);

    const definition = getSubtaskDefinition(task, subtaskKey);
    const runtime = getSubtaskRuntime(node, subtaskKey);

    node.status = TASK_STATUS.ACTIVE;
    node.reopen_correction = true;
    node.manual_opened = false;
    node.finished_at = null;
    runtime.cycle = (runtime.cycle || 1) + 1;
    runtime.status = SUBTASK_STATUS.ACTIVE;
    runtime.state = getInitialState(definition);
    runtime.opened_at = new Date();
    runtime.completed_at = null;
    runtime.last_comment = reason;
    runtime.assigned_user_ids =
        await resolveDynamicAssignment({
            instance,
            node,
            task,
            subtask: definition,
            models
        });
    node.participants =
        unique([
            ...(node.participants || []),
            ...runtime.assigned_user_ids
        ]);

    await syncWorkItem({
        instance,
        node,
        subtask: runtime,
        status: SUBTASK_STATUS.ACTIVE,
        performedBy: userId,
        models
    });

    await createEvent({
        instance,
        taskCode,
        subtaskKey,
        eventType: "TASK_REOPENED",
        performedBy: userId,
        comment: reason,
        data: {
            reopen_correction: true,
            cycle: runtime.cycle
        },
        models
    });

    refreshActiveNodes(
        instance
    )

    await instance.save();

    return {
        task_code: taskCode,
        task_status: node.status,
        reopen_correction: true,
        subtask_key: subtaskKey,
        cycle: runtime.cycle
    };
}

// SOLICITAR CANCELACIÓN Y BLOQUEAR TAREAS AÚN NO INICIADAS
async function requestCancellation({
    instanceId,
    userId,
    reason,
    models
}) {
    const { provWfInstances } = models;

    if (!String(reason || "").trim()) {
        throw new Error(
            "Motivo de cancelación requerido"
        );
    }

    const instance = await provWfInstances.findById(instanceId);

    if (!instance) {
        throw new Error(
            "Instancia no encontrada"
        );
    }

    if (
        [
            INSTANCE_STATUS.CANCELLED,
            INSTANCE_STATUS.COMPLETED
        ].includes(
            instance.status
        )
    ) {
        throw new Error(
            "La instancia no puede ser cancelada"
        );
    }

    instance.status = INSTANCE_STATUS.CANCEL_PENDING;

    instance.cancellation = {
        requested: true,
        requested_by: String(userId),
        requested_at: new Date(),
        reason: String(reason).trim(),
        status: "PENDING"
    };

    for (const node of instance.nodes || []) {
        if (node.status !== TASK_STATUS.NOT_REACHED) {
            continue;
        }

        node.status = TASK_STATUS.CANCELLED;

        for (const subtask of node.subtasks || []) {
            if (subtask.status === SUBTASK_STATUS.PENDING) {
                subtask.status = SUBTASK_STATUS.CANCELLED;
            }
        }
    }

    await createEvent({
        instance,
        eventType: "CANCELLATION_REQUESTED",
        performedBy: userId,
        comment: reason,
        models
    });

    refreshActiveNodes(
        instance
    );

    await instance.save();

    return {
        instance_id: instance._id,
        status: instance.status,
        cancellation: instance.cancellation
    };
}

// FINALIZAR CANCELACIÓN CUANDO YA NO EXISTEN TAREAS ACTIVAS
async function finalizeCancellationIfNeeded({
    instance,
    performedBy,
    models
}) {
    if (instance.status !== INSTANCE_STATUS.CANCEL_PENDING ) return false

    const hasActive =
        (instance.nodes || []).some(
            x =>
                x.status ===
                TASK_STATUS.ACTIVE
        );

    if (hasActive) {
        return false;
    }

    instance.status = INSTANCE_STATUS.CANCELLED;

    instance.cancellation = instance.cancellation || {};

    instance.cancellation.status = "COMPLETED";

    instance.cancellation.cancelled_at = new Date();

    instance.finished_at = new Date();

    await createEvent({
        instance,
        eventType: "WORKFLOW_CANCELLED",
        performedBy,
        comment: instance.cancellation.reason,
        models
    });

    return true;
}

// RECALCULAR FORECAST SLA DE TODAS LAS TAREAS SEGÚN EL GRAFO
async function recalculateInstanceForecasts({
    instance,
    version,
    tasks,
    startDate
}) {
    const baseStart =
        startOfDay(
            startDate ||
            instance.workflow_start_date ||
            new Date()
        );

    if (!baseStart) {
        throw new Error(
            "Fecha de inicio inválida"
        );
    }

    instance.workflow_start_date = baseStart;

    const finishByNode = new Map();
    const pending = [...(version.nodes || [])];

    let safety = Math.max(pending.length * 10, 50);

    while (pending.length && safety-- > 0) {
        let progressed = false;

        for (let i = pending.length - 1; i >= 0; i--) {
            const definition = pending[i];

            const nodeKey = definition.node_key || definition.id;

            const incoming = getIncomingEdges(
                version,
                nodeKey
            );

            if (definition.type === "START") {
                finishByNode.set(
                    nodeKey,
                    baseStart
                );

                pending.splice(i, 1);
                progressed = true;
                continue;
            }

            const incomingDates = incoming.map(edge =>
                finishByNode.get(
                    edgeSource(edge)
                )
            );

            if (
                incoming.length &&
                incomingDates.some(
                    x => !x
                )
            ) {
                continue;
            }

            const taskStart = incomingDates.length
                ? maxDate(incomingDates)
                : baseStart;

            if (definition.type === "TASK") {
                const runtime =
                    (instance.nodes || [])
                        .find(
                            x =>
                                x.node_key ===
                                nodeKey
                        );

                if (!runtime) {
                    pending.splice(i, 1);
                    progressed = true;
                    continue;
                }

                const task = getTaskDefinition(
                    runtime.task_code,
                    tasks
                );

                // const finish = addDays(
                //     taskStart,
                //     task.sla_days,
                //     task.business_days
                // );

                const finish = calculateTaskSlaDate(
                    taskStart,
                    task
                );

                runtime.forecast = runtime.forecast || {};

                runtime.forecast.sla_date = finish;

                /*
                 * Si el usuario ya modificó el Forecast,
                 * solo se recalcula SLA y no se pisa
                 * el forecast manual.
                 */

                if (runtime.forecast.source !== "MANUAL") {
                    runtime.forecast.current_date = finish;
                    runtime.forecast.source = "AUTO_SLA";
                }

                finishByNode.set(
                    nodeKey,
                    finish
                );
            } else {
                /*
                 * START, END y Gateway no suman SLA.
                 * Heredan la fecha mayor de sus predecesores.
                 */

                finishByNode.set(
                    nodeKey,
                    taskStart
                );
            }

            pending.splice(i, 1);
            progressed = true;
        }

        if (!progressed) {
            break;
        }
    }

    if (pending.length) {
        throw new Error(
            "No fue posible calcular completamente el SLA. Revisar ciclos o conexiones del workflow."
        );
    }

    return instance;
}



function calculateTaskSlaDate(
    startDate,
    task
) {

    if (!startDate) return null

    let date = new Date(startDate);

    const blockingSubtasks =
        (task.subtasks || [])
            .filter(subtask => subtask.blocking !== false)
            .sort((a, b) =>
                Number(a.order || 0) - Number(b.order || 0)
            );

    for (const subtask of blockingSubtasks) {
        const days = Math.max(0, Number(subtask.sla?.days || 0));
        if (!days) {
            continue;
        }

        if (subtask.sla?.business_days === true) {
            date = addBusinessDays(date, days);
        } else {
            date = addCalendarDays(date, days);
        }
    }

    return date;
}



// CAMBIAR FECHA INICIAL Y RECALCULAR TODOS LOS SLA
async function changeWorkflowStartDate({
    instanceId,
    startDate,
    userId,
    models
}) {
    const {
        provWfInstances,
        provWfVersions,
        provWfTasks
    } = models;

    const instance = await provWfInstances.findById(instanceId);

    if (!instance) {
        throw new Error(
            "Instancia no encontrada"
        );
    }

    const version = await provWfVersions
        .findById(instance.workflow_version_id)
        .lean();

    if (!version) {
        throw new Error(
            "Versión de Workflow no encontrada"
        );
    }

    const taskCodes =
        unique(
            (instance.nodes || [])
                .map(x => x.task_code)
        );

    const tasks =
        await provWfTasks
            .find({ task_code: { $in: taskCodes } })
            .lean();

    const previous = instance.workflow_start_date;

    await recalculateInstanceForecasts({
        instance,
        version,
        tasks,
        startDate
    });

    await createEvent({
        instance,
        eventType: "FORECAST_UPDATED",
        performedBy: userId,
        comment: "Recalculo SLA por cambio de fecha inicial",
        data: {
            type: "WORKFLOW_START_CHANGED",
            old_date: previous,
            new_date: instance.workflow_start_date
        },
        models
    });

    await instance.save();

    return {
        workflow_start_date: instance.workflow_start_date,

        nodes:
            instance.nodes.map(
                x => ({
                    task_code:
                        x.task_code,
                    forecast:
                        x.forecast
                })
            )
    };
}


async function updateSubtaskFormData({
    instanceId,
    taskCode,
    subtaskKey,
    formData = {},
    userId,
    models
}) {

    const { provWfInstances, provWfTasks } = models;

    const instance = await provWfInstances.findById(instanceId);

    if (!instance) {
        throw new Error(
            "Instancia no encontrada"
        );
    }


    if (
        [INSTANCE_STATUS.COMPLETED, INSTANCE_STATUS.CANCELLED].includes(
            instance.status
        )
    ) {
        throw new Error(
            "La instancia ya no permite modificaciones"
        );
    }


    const node = getNodeRuntime(instance, taskCode);

    // if (node.status !== TASK_STATUS.ACTIVE) {
    //     throw new Error(
    //         "La TASK no se encuentra activa"
    //     );
    // }


    const task = await provWfTasks.findOne({ task_code: taskCode });

    if (!task) {
        throw new Error(
            "Configuración de TASK no encontrada"
        );
    }

    ensureTaskSubtasksRuntime(
        node,
        task
    );

    const subtaskDefinition = getSubtaskDefinition(task, subtaskKey);
    const subtaskRuntime = getSubtaskRuntime(node, subtaskKey);

    if (
        ![
            SUBTASK_STATUS.ACTIVE,
            SUBTASK_STATUS.OBSERVED
        ].includes(
            subtaskRuntime.status
        )
    ) {
        throw new Error(
            "La Subtarea no permite edición"
        );
    }


    /*
     * Validar responsable.
     */
    const assigned = (subtaskRuntime.assigned_user_ids || []).map(String);

    if (userId && assigned.length && !assigned.includes(String(userId))) {
        throw new Error(
            "El usuario no está asignado a esta Subtarea"
        );
    }

    /*
     * Solo aceptar campos definidos
     * y editables.
     */
    const editableFields =
        new Set(
            (subtaskDefinition.fields || [])
                .filter(field => field.editable !== false)
                .map(field => field.field_key)
        );


    const cleanFormData = {};

    for (const [key, value] of Object.entries(formData || {})) {
        if (editableFields.has(key)) {
            cleanFormData[key] = value;
        }
    }

    subtaskRuntime.form_data = {
        ...(subtaskRuntime.form_data || {}),
        ...cleanFormData
    };

    await applySystemFieldBindings({
        instance,
        node,
        subtaskDefinition,
        formData,
        performedBy: userId,
        models
    });

    await syncWorkItem({
        instance,
        node,
        subtask: subtaskRuntime,
        status: subtaskRuntime.status,
        performedBy: userId,
        models
    });

    await createEvent({
        instance,
        taskCode,
        subtaskKey,
        eventType: "SUBTASK_FORM_SAVED",
        performedBy: userId,
        data: {
            form_data: cleanFormData
        },
        models
    });


    await instance.save();

    return {
        instance_id: instance._id,
        task_code: node.task_code,
        subtask_key: subtaskRuntime.subtask_key,
        form_data: subtaskRuntime.form_data
    };
}



module.exports = {
    TASK_STATUS,
    SUBTASK_STATUS,
    INSTANCE_STATUS,
    TRANSITION_TYPE,
    ASSIGNMENT_MODE,

    normalizeDate,
    startOfDay,
    addDays,
    maxDate,
    unique,

    getTaskDefinition,
    getNodeRuntime,
    getSubtaskDefinition,
    getSubtaskRuntime,
    getInitialState,
    getStateDefinition,

    createEvent,
    syncWorkItem,

    initializeInstanceAssignments,
    resolveDynamicAssignment,
    updateSubtaskFormData,
    activateSubtask,
    moveSubtask,
    completeSubtask,

    activateTaskNode,
    startWorkflow,
    evaluateTaskCompletion,
    completeTask,
    refreshActiveNodes,

    evaluateGateway,
    continueWorkflowFromTask,
    evaluateWorkflowCompletion,

    executeSubtaskTransition,
    updateSubtaskAssignees,
    updateTaskForecast,

    manuallyOpenTask,
    reopenTask,

    requestCancellation,
    finalizeCancellationIfNeeded,

    recalculateInstanceForecasts,
    changeWorkflowStartDate
};