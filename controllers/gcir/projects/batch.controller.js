const express = require('express');
const db = require('../../../db');
require("dotenv").config();

const {
    escapeRegex,
    getPagination,
    getSort,
    cleanDistinct,
    normalizeBusinessKey,
    buildSiteProjectKey
} = require("./_helpers");

const { recalculateInstanceForecasts, activateTaskNode, startWorkflow, evaluateGateway, createEvent, initializeInstanceAssignments } = require("./workflowEngine");

const batchRouter = express.Router();


// NORMALIZAR TEXTO PARA IDENTIFICADOR
function normalizeIdentifier(value = "") {
    return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "");
}


// GET LAST INDEX BY IDENTIFIER
function getIdentifierCounterKey(projectTypeName, macroProject) {
    const prefix =
        normalizeIdentifier(projectTypeName)
            .substring(0, 3)
            .toUpperCase() || "SIT";

    const project =
        normalizeIdentifier(macroProject)
            .toUpperCase() || "PROYECTO";

    return `${prefix}::${project}`;
}


async function reserveIdentifierRange({
    model,
    projectTypeName,
    macroProject,
    count
}) {
    const key = getIdentifierCounterKey(
        projectTypeName,
        macroProject
    );

    const counter = await model.findOneAndUpdate(
        { _id: key },
        { $inc: { seq: count } },
        { upsert: true, new: true }
    );

    return {
        start: counter.seq - count + 1,
        end: counter.seq
    };
}


// GENERAR IDENTIFICADOR DEL SITE
function buildIdentifier(
    projectType = "SITE",
    macroProject = "Proyecto",
    index = 1
) {
    const prefix =
        normalizeIdentifier(projectType)
            .substring(0, 3)
            .toUpperCase() || "SIT";

    const project = normalizeIdentifier(macroProject) || "Proyecto";

    return `${prefix}_${project.charAt(0).toUpperCase()}${project.slice(1)}_${index}`;
}


async function assignIdentifiers({
    rows,
    projectTypeName,
    counterModel
}) {
    const groups = new Map();

    /*
     * Solo generamos ID para filas válidas.
     */
    for (const row of rows) {
        if (row.valid === false) continue;

        const macroProject =
            String(row.macro_project || "").trim();

        if (!macroProject) continue;

        const key = getIdentifierCounterKey(
            projectTypeName,
            macroProject
        );

        if (!groups.has(key)) {
            groups.set(key, {
                macroProject,
                rows: []
            });
        }

        groups.get(key).rows.push(row);
    }

    /*
     * Una operación atómica por combinación:
     * project_type_name + macro_project
     */
    for (const group of groups.values()) {
        const { start } =
            await reserveIdentifierRange({
                model: counterModel,
                projectTypeName,
                macroProject: group.macroProject,
                count: group.rows.length
            });

        group.rows.forEach((row, index) => {
            row.identificador =
                buildIdentifier(
                    projectTypeName,
                    group.macroProject,
                    start + index
                );
        });
    }

    return rows;
}

function toNullableNumber(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : null;
}



// OPCIONES DE FILTRO DE BATCH
batchRouter.get("/batches/filter-options", async(req, res) => {
    try {
        const { provWfBatchs } = await db();
        const clean = async(field) => {
            const values = await provWfBatchs.distinct(field, { [field]: { $nin: [null, ""] } });
            return values.filter(Boolean).map(String).sort();
        };
        const [status, workflow_code, project_type_name] = await Promise.all([clean("status"), clean("workflow_code"), clean("project_type_name")]);
        return res.json({ result: "OK", content: { status, workflow_code, project_type_name } });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});

// LISTAR BATCHS
batchRouter.get("/batches", async(req, res) => {
    try {
        const { provWfBatchs } = await db();
        const { 
            status, 
            workflow_code, 
            project_type_name, 
            search = "", 
            page = 1, 
            limit = 20 
        } = req.query;
        
        const { currentPage, perPage, skip } = getPagination({ page, limit });
        
        const q = {};
        
        if (status) q.status = status;
        if (workflow_code) q.workflow_code = workflow_code;
        if (project_type_name) q.project_type_name = project_type_name;
        if (search) q.$or = [
            { 
                name: new RegExp(escapeRegex(search), "i") 
            }, 
            { 
                workflow_code: new RegExp(escapeRegex(search), "i") 
            }
        ];
        
        const [totalResults, items] = await Promise.all([
            provWfBatchs.countDocuments(q),
            provWfBatchs.find(q).sort({ createdAt: -1 }).skip(skip).limit(perPage).lean()
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

// OBTENER BATCH
batchRouter.get("/batches/:batchId", async(req, res) => {
    try {
        const { provWfBatchs } = await db();
        const batch = await provWfBatchs.findById(req.params.batchId).lean();
        
        if (!batch) {
            return res.status(404).json({ 
                result: "ERROR", 
                message: "Batch no encontrado" 
            });
        } 

        return res.json({ result: "OK", content: batch });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});



async function validateSiteRows(rows, provWfSites) {
    const prepared = rows.map((row, index) => {
        const item = row.toObject
            ? row.toObject()
            : { ...row };

        item.row_number =
            item.row_number ||
            item.row ||
            index + 1;

        item.validation_errors = [];

        if (!String(item.site || "").trim()) {
            item.validation_errors.push(
                "SITE requerido"
            );
        }

        if (!String(item.macro_project || "").trim()) {
            item.validation_errors.push(
                "MACRO PROYECTO requerido"
            );
        }

        item.site_project_key = buildSiteProjectKey(
            item.site,
            item.macro_project
        );

        return item;
    });

    const seen = new Map();

    for (const row of prepared) {
        if (!row.site_project_key) {
            continue;
        }

        if (seen.has(row.site_project_key)) {
            row.validation_errors.push(
                `Duplicado en archivo. Coincide con fila ${seen.get(row.site_project_key)}`
            );
        } else {
            seen.set(
                row.site_project_key,
                row.row_number
            );
        }
    }

    const keys = [
        ...new Set(
            prepared
                .map(row => row.site_project_key)
                .filter(Boolean)
        )
    ];

    const existing = keys.length
        ? await provWfSites
            .find(
                {
                    site_project_key: {
                        $in: keys
                    }
                },
                {
                    site_project_key: 1,
                    identificador: 1
                }
            )
            .lean()
        : [];

    const existingMap = new Map(
        existing.map(site => [
            site.site_project_key,
            site.identificador
        ])
    );

    for (const row of prepared) {
        const identifier = existingMap.get(row.site_project_key);
        if (identifier) {
            row.validation_errors.push(
                `SITE + MACRO PROYECTO ya existe (${identifier})`
            );
        }

        row.valid = row.validation_errors.length === 0;
    }

    return prepared;
}


// VALIDAR CARGA Y GENERAR PREVIEW
batchRouter.post("/batches/validate", async(req, res) => {
    try {
        const {
            provWfWorkflows,
            provWfVersions,
            provWfSites
        } = await db();

        const {
            workflow_id,
            items = []
        } = req.body;

        if (
            !workflow_id ||
            !Array.isArray(items) ||
            !items.length
        ) {
            return res.status(400).json({
                result: "ERROR",
                message: "workflow_id e items son requeridos"
            });
        }

        const workflow =
            await provWfWorkflows
                .findById(workflow_id)
                .lean();

        if (!workflow) {
            return res.status(404).json({
                result: "ERROR",
                message: "Workflow no encontrado"
            });
        }

        const version =
            await provWfVersions
                .findOne({
                    workflow_id,
                    status: "PUBLISHED"
                })
                .sort({
                    version: -1
                })
                .lean();

        if (!version) {
            return res.status(400).json({
                result: "ERROR",
                message: "Workflow sin versión publicada"
            });
        }

        /*
         * Validación:
         * - requeridos
         * - duplicados dentro del archivo
         * - duplicados existentes en WF_SITES
         */
        const validated = await validateSiteRows(items, provWfSites);

        const preview =
            validated.map(item => ({
                ...item,
                /*
                 * Todavía NO reservamos identificador.
                 * Eso ocurre cuando se genera el Batch.
                 */
                identificador: null,
                validation_errors: item.errors || []
            }));

        return res.json({
            result: "OK",

            content: {
                workflow: {
                    workflow_id: workflow._id,
                    workflow_code: workflow.workflow_code || workflow.code,
                    version_id: version._id,
                    version: version.version,
                    project_type_id: workflow.project_type_id,
                    project_type_name: workflow.project_type_name
                },
                total: preview.length,
                valid: preview.filter(x => x.valid).length,

                invalid: preview.filter(x => !x.valid).length,

                items: preview
            }
        });

    } catch (e) {
        console.error("POST batches/validate:", e);
        return res.status(500).json({
            result: "ERROR",
            message: e.message
        });
    }
});

// GUARDAR BATCH PREPARADO
// batchRouter.post("/batches", async(req, res) => {
//     try {
//         const { provWfBatchs, provWfWorkflows, provWfVersions } = await db();
//         const { 
//             workflow_id, 
//             project_type, 
//             items = [], 
//             name, 
//             created_by 
//         } = req.body;
//         const workflow = await provWfWorkflows.findById(workflow_id).lean();
        
//         if (!workflow) {
//             return res.status(404).json({ 
//                 result: "ERROR", 
//                 message: "Workflow no encontrado" 
//             });
//         } 

//         const version = await provWfVersions
//             .findOne({ workflow_id, status: "PUBLISHED" })
//             .sort({ version: -1 })
//             .lean();
        
//         if (!version) {
//             return res.status(400).json({ 
//                 result: "ERROR", 
//                 message: "Workflow sin versión publicada" 
//             });
//         } 

//         const normalizedItems = items.map((x, i) => ({
//             ...x,
//             identificador: x.identificador || buildIdentifier(project_type, x.project_name || x.macroproyecto, i + 1)
//         }));

//         const batch = await provWfBatchs.create({
//             name: name || `Carga ${workflow.workflow_code} ${new Date().toISOString()}`,
//             workflow_id: workflow._id,
//             workflow_code: workflow.workflow_code,
//             workflow_version_id: version._id,
//             workflow_version: version.version,
//             project_type,
//             status: "READY",
//             items: normalizedItems,
//             created_by
//         });

//         return res.json({ result: "OK", content: batch });
//     } catch (e) {
//         return res.status(500).json({ result: "ERROR", message: e.message });
//     }
// });

batchRouter.post("/batches", async(req, res) => {
    try {
        const {
            workflow_id,
            source,
            items,
            user_id
        } = req.body;

        if (
            !workflow_id ||
            !Array.isArray(items) ||
            !items.length
        ) {
            return res.status(400).json({
                result: "ERROR",
                message: "workflow_id e items son requeridos"
            });
        }

        if (!user_id) {
            return res.status(400).json({
                result: "ERROR",
                message: "user_id es requerido"
            });
        }

        const {
            provWfBatchs,
            provWfWorkflows,
            provWfVersions,
            provWfSites,
            provWfIdentifiersCounter
        } = await db();

        const workflow = await provWfWorkflows
            .findById(workflow_id)
            .lean();

        if (!workflow) {
            return res.status(404).json({
                result: "ERROR",
                message: "Workflow no encontrado"
            });
        }

        if (workflow.status !== "PUBLISHED") {
            return res.status(409).json({
                result: "ERROR",
                message: "El Workflow debe estar publicado"
            });
        }

        const version =
            await provWfVersions
                .findOne({
                    workflow_id: workflow._id,
                    version: workflow.active_version,
                    status: "PUBLISHED"
                })
                .lean();

        if (!version) {
            return res.status(404).json({
                result: "ERROR",
                message: "No se encontró la versión activa publicada"
            });
        }

        /*
         * No confiamos únicamente en el resultado
         * anterior enviado por frontend.
         */
        let preparedItems = await validateSiteRows(items, provWfSites);

        /*
         * Reservamos correlativos solamente
         * para las filas válidas.
         */
        preparedItems =
            await assignIdentifiers({
                rows: preparedItems,
                projectTypeName: workflow.project_type_name,
                counterModel: provWfIdentifiersCounter
            });

        const batchCode =
            `BAT-${Date.now()}`;

        const batch =
            await provWfBatchs.create({
                batch_code: batchCode,
                workflow_id: workflow._id,
                workflow_version_id: version._id,
                workflow_code: workflow.workflow_code || workflow.code,
                workflow_version: version.version,
                project_type_id: workflow.project_type_id || null,
                project_type_name: workflow.project_type_name || null,
                source: source || "MANUAL",
                status: "VALIDATED",

                items:
                    preparedItems.map(
                        (item, index) => ({
                            row_number: item.row_number || index + 1,
                            identificador: item.identificador || null,
                            site_project_key: item.site_project_key,

                            project_typology: item.project_typology || "",
                            project_type: item.project_type || "",
                            macro_project: item.macro_project || "",
                            sub_project: item.sub_project || "",
                            id_solpe: item.id_solpe || "",
                            solpe_project: item.solpe_project || "",
                            node_site: item.node_site || "",
                            site: item.site || "",
                            tower: item.tower || "",
                            tower_type: item.tower_type || "",
                            plan_backup: item.plan_backup || "",
                            q_fcst: item.q_fcst || "",
                            macrozone: item.macrozone || "",
                            zone: item.zone || "",
                            cluster: item.cluster || "",
                            departament: item.departament || "",
                            province: item.province || "",
                            district: item.district || "",
                            lat: toNullableNumber(item.lat),
                            long: toNullableNumber(item.long),

                            valid: item.valid === true,
                            validation_errors:
                                item.errors ||
                                item.validation_errors ||
                                []
                        })
                    ),

                totals: {
                    received: preparedItems.length,
                    created: 0,
                    errors: preparedItems.filter(x => !x.valid).length
                },

                error_detail: [],
                created_by: Number(user_id)
            });

        return res.json({
            result: "OK",
            content: batch
        });

    } catch (e) {
        console.error("POST batch:", e);
        return res.status(500).json({
            result: "ERROR",
            message: e.message
        });
    }
});



// LANZAR BATCH Y CREAR SITES / INSTANCIAS
batchRouter.post("/batches/:batchId/launch", async(req, res) => {
    try {
        const models = await db();

        const {
            provWfBatchs,
            provWfSites,
            provWfInstances,
            provWfVersions,
            provWfTasks
        } = models;

        const resolvedAssignments = req.body.resolved_assignments || {}

        const batch = await provWfBatchs.findById(req.params.batchId);

        if (!batch) {
            return res.status(404).json({
                result: "ERROR",
                message: "Batch no encontrado"
            });
        }

        if (batch.status !== "VALIDATED") {
            return res.status(409).json({
                result: "ERROR",
                message: "Batch ya fue lanzado o no está validado"
            });
        }

        const version = await provWfVersions
            .findById(batch.workflow_version_id)
            .lean();

        if (!version) {
            return res.status(404).json({
                result: "ERROR",
                message: "Versión no encontrada"
            });
        }

        const taskNodes = (version.nodes || [])
            .filter(x => x.type === "TASK");

        const taskIds = taskNodes
            .map(x => x.task_id || x.taskId)
            .filter(Boolean);

        const taskCodes = taskNodes
            .map(x => x.task_code || x.taskCode)
            .filter(Boolean);

        const tasks = await provWfTasks.find({
            $or: [
                { _id: { $in: taskIds } },
                { task_code: { $in: taskCodes } }
            ]
        }).lean();

        const taskIdMap = new Map(
            tasks.map(x => [String(x._id), x])
        );

        const taskCodeMap = new Map(
            tasks.map(x => [x.task_code, x])
        );

        const performedBy =
            req.body.user_id !== undefined &&
            req.body.user_id !== null
                ? req.body.user_id
                : "SYSTEM";

        const results = [];
        const errors = [];

        batch.started_at = new Date();

        const validRows = (batch.items || [])
            .filter(row => row.valid !== false);

        const siteProjectKeys = validRows
            .map(row => row.site_project_key)
            .filter(Boolean);

        const existingSites = siteProjectKeys.length
            ? await provWfSites
                .find(
                    {
                        site_project_key: {
                            $in: siteProjectKeys
                        }
                    },
                    {
                        site_project_key: 1,
                        identificador: 1
                    }
                )
                .lean()
            : [];

        const existingSiteMap = new Map(
            existingSites.map(
                site => [
                    site.site_project_key,
                    site
                ]
            )
        );


        await batch.save();

        for (const row of batch.items || []) {

            if (row.valid === false) {
                errors.push({
                    row_number: row.row_number,
                    identificador: row.identificador,
                    message: "Registro inválido"
                });

                continue;
            }

            try {
                
                const existing = existingSiteMap.get(row.site_project_key);

                if (existing) {
                    errors.push({
                        row_number: row.row_number,
                        identificador: row.identificador,
                        message: `SITE + MACRO PROYECTO ya existe (${existing.identificador})`
                    });
                    continue;
                }

                const actorId = Number.isFinite(Number(req.body.user_id))
                    ? Number(req.body.user_id)
                    : undefined;

                const site = await provWfSites.create({
                    identificador: row.identificador,
                    site_project_key: row.site_project_key,

                    project_typology: row.project_typology || "",
                    project_type: row.project_type || "",
                    macro_project: row.macro_project || "",
                    sub_project: row.sub_project || "",
                    id_solpe: row.id_solpe || "",
                    solpe_project: row.solpe_project || "",
                    node_site: row.node_site || "",
                    site: row.site,
                    tower: row.tower || "",
                    tower_type: row.tower_type || "",
                    plan_backup: row.plan_backup || "",
                    q_fcst: row.q_fcst || "",
                    macrozone: row.macrozone || "",
                    zone: row.zone || "",
                    cluster: row.cluster || "",
                    departament: row.departament || "",
                    province: row.province || "",
                    district: row.district || "",
                    lat: toNullableNumber(row.lat),
                    long: toNullableNumber(row.long),
                    /*
                    * Datos oficiales del sistema / Workflow
                    */
                    project_type_id: batch.project_type_id,
                    project_type_name: batch.project_type_name,
                    /*
                    * Provider todavía puede venir vacío.
                    */
                    provider_id: row.provider_id || null,
                    provider_name: row.provider_name || "",
                    workflow_id: batch.workflow_id,
                    workflow_code: batch.workflow_code,
                    workflow_version_id: version._id,
                    workflow_version: batch.workflow_version,
                    batch_id: batch._id,
                    status: "ACTIVE",
                    created_by: actorId,
                    updated_by: actorId
                });

                const nodes = taskNodes.map(def => {

                    const taskCode = def.task_code || def.taskCode;
                    const taskId = def.task_id || def.taskId;

                    const task =
                        (
                            taskId &&
                            taskIdMap.get(String(taskId))
                        ) ||
                        taskCodeMap.get(taskCode);

                    return {
                        node_key: def.node_key || def.id,
                        task_id: task?._id || taskId || null,
                        task_code: task?.task_code || taskCode,
                        task_name: task?.name || def.label || taskCode,
                        status: "NOT_REACHED",

                        workflow_released: false,
                        released_at: null,

                        manual_opened: false,
                        reopen_correction: false,

                        participants: [],

                        started_at: null,
                        finished_at: null,

                        forecast: {
                            sla_date: null,
                            responsible_date: null,
                            pm_date: null,
                            current_date: null,
                            source: "AUTO_SLA",
                            revision: 0
                        },

                        subtasks: (task?.subtasks || []).map(st => ({
                            subtask_key: st.subtask_key,
                            name: st.name,
                            blocking: st.blocking !== false,

                            status: "PENDING",
                            state: [...(st.states || [])]
                                .sort(
                                    (a, b) =>
                                        (a.order || 0) -
                                        (b.order || 0)
                                )[0]?.state_key || null,

                            cycle: 1,
                            
                            assigned_user_ids: [],
                            assignment_pool_user_ids: [],
                            assignment_source: "TEMPLATE",
                            assignment_updated_by: null,
                            assignment_updated_at: null,

                            opened_at: null,
                            completed_at: null,
                            last_comment: null,
                            form_data: {}
                        }))
                    };
                });

                const instance = await provWfInstances.create({
                    site_id: site._id,
                    identificador: site.identificador,
                    workflow_id: batch.workflow_id,
                    workflow_version_id: version._id,
                    workflow_code: batch.workflow_code,
                    workflow_version: batch.workflow_version,
                    status: "ACTIVE",
                    workflow_start_date: req.body.start_date || new Date(),
                    nodes,
                    cancellation: { requested: false }
                });


                console.log(
                    "resolveGroupUsers:",
                    typeof models.resolveGroupUsers
                );

                console.log("=== ASSIGNMENTS ANTES DE INICIALIZAR ===")

                for (const task of tasks) {
                    for (const st of task.subtasks || []) {
                        if (st.assignment?.mode === "FIXED_USERS") {
                            console.log({
                                task_code: task.task_code,
                                subtask_key: st.subtask_key,
                                responsibles: st.assignment?.responsibles,
                                user_ids: st.assignment?.user_ids
                            })
                        }
                    }
                }


                await initializeInstanceAssignments({
                    instance,
                    tasks,
                    resolvedAssignments,
                    models
                });

                await recalculateInstanceForecasts({
                    instance,
                    version,
                    tasks,
                    startDate: instance.workflow_start_date
                });

                await startWorkflow({
                    instance,
                    version,
                    performedBy,
                    models
                });

                await createEvent({
                    instance,
                    eventType: "WORKFLOW_STARTED",
                    performedBy,
                    data: {
                        batch_id: batch._id
                    },
                    models
                });

                await instance.save();

                results.push({
                    site_id: site._id,
                    instance_id: instance._id,
                    identificador: site.identificador
                });

            } catch (rowError) {
                console.error( "Error lanzando site:", row.identificador, rowError);
                errors.push({
                    row_number: row.row_number,
                    identificador: row.identificador,
                    message: rowError.message
                });
            }
        }

        batch.status = errors.length > 0 && results.length === 0
            ? "ERROR"
            : "LAUNCHED";

        batch.completed_at = new Date();

        batch.totals = {
            received: batch.items?.length || 0,
            created: results.length,
            errors: errors.length
        };

        batch.error_detail = errors;

        await batch.save();

        return res.json({
            result: "OK",
            content: {
                batch_id: batch._id,
                launched: results.length,
                errors: errors.length,
                items: results,
                error_detail: errors
            }
        });

    } catch (e) {
        console.error("POST batch launch:", e);

        return res.status(500).json({
            result: "ERROR",
            message: e.message
        });
    }
});


// ELIMINAR BATCH NO LANZADO
batchRouter.delete("/batches/:batchId", async(req, res) => {
    try {
        const { provWfBatchs } = await db();
        const batch = await provWfBatchs.findById(req.params.batchId);
        
        if (!batch) {
            return res.status(404).json({ 
                result: "ERROR", 
                message: "Batch no encontrado" 
            });
        } 

        if (batch.status === "LAUNCHED") {
            return res.status(409).json({ 
                result: "ERROR", 
                message: "No se puede eliminar un Batch lanzado" 
            });
        } 

        await batch.deleteOne();
        return res.json({ result: "OK" });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});


module.exports = batchRouter;