const express = require('express');
const db = require('../../../db');
require("dotenv").config();

const {
    escapeRegex,
    getPagination,
    getSort,
    cleanDistinct
} = require("./_helpers");

const workflowRouter = express.Router();

/* *****************************************************************************
 * Workflows
 * ****************************************************************************/

workflowRouter.get("/workflows/filter-options",
    async (req, res) => {
        try {
            const { provWfWorkflows } = await db();

            const [
                code,
                name,
                project_type_id,
                project_type_name,
                status
            ] = await Promise.all([
                cleanDistinct(provWfWorkflows, "code"),
                cleanDistinct(provWfWorkflows, "name"),
                cleanDistinct(provWfWorkflows, "project_type_id"),
                cleanDistinct(provWfWorkflows, "project_type_name"),
                cleanDistinct(provWfWorkflows, "status")
            ]);

            return res.json({
                result: "OK",
                content: {
                    code,
                    name,
                    project_type_id,
                    project_type_name,
                    status
                }
            });

        } catch (e) {
            console.error("GET workflow filters:", e);
            return res.status(500).json({
                result: "ERROR"
            });
        }
    }
);

// GET ALL WORKFLOWS
workflowRouter.get("/workflows", async (req, res) => {
    try {
        const { provWfWorkflows } = await db();

        const {
            code,
            name,
            project_type_id,
            status,
            search = "",
            page = 1,
            limit = 10,
            sortBy = "createdAt",
            sortDirection = "desc"
        } = req.query;

        const {
            currentPage,
            perPage,
            skip
        } = getPagination({ page, limit });

        const allowedSortFields = new Set([
            "code",
            "name",
            "project_type_id",
            "status",
            "active_version",
            "createdAt",
            "updatedAt"
        ]);

        const sort = getSort(
            sortBy,
            sortDirection,
            allowedSortFields,
            "createdAt"
        );

        const q = {};

        if (code) q.code = code;
        if (name) q.name = name;
        if (project_type_id) q.project_type_id = Number(project_type_id);
        if (status) q.status = status;

        if (String(search).trim()) {
            const rx = new RegExp(
                escapeRegex(search.trim()),
                "i"
            );

            q.$or = [
                { code: rx },
                { name: rx },
                { description: rx },
                { project_type_name: rx }
            ];
        }

        const [totalResults, items] = await Promise.all([
            provWfWorkflows.countDocuments(q),
            provWfWorkflows
                .find(q)
                .sort(sort)
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
        console.error("GET workflows:", e);

        return res.status(500).json({
            result: "ERROR",
            message: "Error al obtener workflows"
        });
    }
});

// DETAILS WORKFLOW
workflowRouter.get("/workflows/:workflowId", async (req, res) => {
    try {
        const { provWfWorkflows } = await db();

        const item = await provWfWorkflows
            .findById(req.params.workflowId)
            .lean();

        if (!item) {
            return res.status(404).json({
                result: "ERROR",
                message: "Workflow no encontrado"
            });
        }

        return res.json({
            result: "OK",
            content: item
        });

    } catch (e) {
        console.error("GET workflow:", e);
        return res.status(500).json({ result: "ERROR" });
    }
    }
);

// CREAR WORKFLOW
workflowRouter.post("/workflows", async (req, res) => {
        try {
            const { provWfWorkflows, provWfVersions } = await db();

            const {
                name,
                description = "",
                project_type_id,
                project_type_name,
                created_by
            } = req.body;

            if (!name || !project_type_id) {
                return res.status(400).json({
                    result: "ERROR",
                    message: "name y project_type_id son requeridos"
                });
            }

            const last = await provWfWorkflows.findOne({}, { code: 1 })
                    .sort({ createdAt: -1 })
                    .lean();

            let number = 1;

            if (last?.code) {
                const match = String(last.code).match(/\d+/);

                number = match
                    ? Number(match[0]) + 1
                    : 1;
            }

            const code = `WF-${String(number).padStart(4, "0")}`;

            const workflow = await provWfWorkflows.create({
                code,
                name,
                description,
                project_type_id: Number(project_type_id),
                project_type_name,
                status: "DRAFT",
                active_version: 1,
                created_by
            });

            const version = await provWfVersions.create({
                workflow_id: workflow._id,
                workflow_code: workflow.code,
                version: 1,
                status: "DRAFT",
                nodes: [],
                edges: [],
                created_by
            });

            return res.status(201).json({
                result: "OK",
                content: {
                    workflow,
                    version
                }
            });

        } catch (e) {
            console.error("POST workflow:", e);

            return res.status(500).json({
                result: "ERROR",
                message: "Error al crear workflow"
            });
        }
    }
);

// EDIT WORKFLOW
workflowRouter.patch("/workflows/:workflowId", async (req, res) => {
        try {
            const { provWfWorkflows } = await db();

            const allowed = [
                "name",
                "description",
                "project_type_id",
                "project_type_name",
                "updated_by"
            ];

            const $set = {};

            allowed.forEach(key => {
                if (
                    req.body[key] !== undefined
                ) {
                    $set[key] = req.body[key];
                }
            });

            const item = await provWfWorkflows.findByIdAndUpdate(
                req.params.workflowId,
                {
                    $set
                },
                {
                    new: true
                }
            );

            if (!item) {
                return res.status(404).json({
                    result: "ERROR"
                });
            }

            return res.json({
                result: "OK",
                content: item
            });

        } catch (e) {
            console.error("PATCH workflow:", e);
            return res.status(500).json({ result: "ERROR" });
        }
    }
);

// DELETE WORKFLOW WITHOUT INSTANCES
workflowRouter.delete("/workflows/:workflowId",
    async (req, res) => {
        try {
            const { provWfWorkflows, provWfVersions, provWfInstances } = await db();

            const workflow = await provWfWorkflows.findById(req.params.workflowId);

            if (!workflow) {
                return res.status(404).json({
                    result: "ERROR"
                });
            }

            const instanceExists = await provWfInstances.exists({
                workflow_id: workflow._id
            });

            if (instanceExists) {
                return res.status(409).json({
                    result: "ERROR",
                    message: "El workflow ya tiene ejecuciones. Debe archivarse."
                });
            }

            await Promise.all([
                provWfVersions.deleteMany({
                    workflow_id: workflow._id
                }),

                provWfWorkflows.deleteOne({
                    _id: workflow._id
                })
            ]);

            return res.json({ result: "OK" });

        } catch (e) {
            console.error("DELETE workflow:", e);
            return res.status(500).json({ result: "ERROR" });
        }
    }
);

/* *****************************************************************************
 * versions
 * ****************************************************************************/
// GET ALL VERSIONS
workflowRouter.get("/workflows/:workflowId/versions", async (req, res) => {
        try {
            const { provWfVersions } = await db();
            const { 
                page = 1, 
                limit = 20 
            } = req.query;
            const { currentPage, perPage, skip } = getPagination({ page, limit });
            
            const q = { workflow_id: req.params.workflowId };
            
            const [totalResults, items] = await Promise.all([
                provWfVersions.countDocuments(q),
                provWfVersions
                    .find(q)
                    .sort({ version: -1 })
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
    }
);

// OBTENER VESIÓN CON SU GRAFO
workflowRouter.get("/workflow-versions/:versionId", async (req, res) => {
    try {
        const { provWfVersions } = await db();

        const item = await provWfVersions
            .findById(req.params.versionId)
            .lean();

        if (!item) {
            return res.status(404).json({ result: "ERROR", message: "Versión no encontrada" });
        }

        return res.json({
            result: "OK",
            content: item
        });

    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});


// NUEVA VERSION DEL WORKFLOW
workflowRouter.post("/workflows/:workflowId/versions", async (req, res) => {
        try {
            const { provWfWorkflows, provWfVersions } = await db();
            
            const workflow = await provWfWorkflows.findById(req.params.workflowId).lean();
            
            if (!workflow) return res.status(404).json({ result: "ERROR", message: "Workflow no encontrado" });
            
            const last = await provWfVersions
                .findOne({ workflow_id: workflow._id })
                .sort({ version: -1 })
                .lean();

            // console.log("LAST", last)
            // console.log("WORKFLOW", workflow)
            
            const version = await provWfVersions.create({
                workflow_id: workflow._id,
                workflow_code: workflow.workflow_code,
                version: (last?.version || 0) + 1,
                status: "DRAFT",
                nodes: req.body.nodes || last?.nodes || [],
                edges: req.body.edges || last?.edges || [],
                created_by: workflow.created_by,
            });
            return res.json({ result: "OK", content: version });
        } catch (e) {
            return res.status(500).json({ result: "ERROR", message: e.message });
        }
    }
);

// NUEVA VERSION WORKFLOW - OLD
// workflowRouter.post("/workflows/:workflowId/versions", async (req, res) => {

//     try {
//         const { provWfWorkflows, provWfVersions } = await db();
        
//         const source = await provWfWorkflows.findById(req.params.workflowId).lean();
        
//         if (!source) return res.status(404).json({ result: "ERROR", message: "Workflow no encontrado" });
        
//         const sourceVersion = await provWfVersions.findOne({ workflow_id: source._id }).sort({ version: -1 }).lean();
        
//         const workflow = await provWfWorkflows.create({
//             workflow_code: req.body.workflow_code || `WF-${Date.now()}`,
//             name: req.body.name || `${source.name} - Copia`,
//             description: source.description,
//             project_type_id: source.project_type_id,
//             status: "DRAFT",
//             active_version: null,
//             created_by: req.body.created_by
//         });

//         const version = await provWfVersions.create({
//             workflow_id: workflow._id,
//             workflow_code: workflow.workflow_code,
//             version: 1,
//             status: "DRAFT",
//             nodes: sourceVersion?.nodes || [],
//             edges: sourceVersion?.edges || [],
//             created_by: req.body.created_by
//         });

//         return res.json({ 
//             result: "OK", 
//             content: { 
//                 workflow, 
//                 version 
//             } 
//         });
//     } catch (e) {
//         return res.status(500).json({ result: "ERROR", message: e.message });
//     }
// });

// DUPLICAR WORKFLOW
workflowRouter.post("/workflows/:workflowId/duplicate", async (req, res) => {

    try {
        const { provWfWorkflows, provWfVersions } = await db();
        
        const source = await provWfWorkflows.findById(req.params.workflowId).lean();
        
        if (!source) return res.status(404).json({ result: "ERROR", message: "Workflow no encontrado" });
        
        const sourceVersion = await provWfVersions.findOne({ workflow_id: source._id }).sort({ version: -1 }).lean();
        
        const workflow = await provWfWorkflows.create({
            workflow_code: req.body.workflow_code || `WF-${Date.now()}`,
            name: req.body.name || `${source.name} - Copia`,
            description: source.description,
            project_type_id: source.project_type_id,
            status: "DRAFT",
            active_version: null,
            created_by: req.body.created_by
        });

        const version = await provWfVersions.create({
            workflow_id: workflow._id,
            workflow_code: workflow.workflow_code,
            version: 1,
            status: "DRAFT",
            nodes: sourceVersion?.nodes || [],
            edges: sourceVersion?.edges || [],
            created_by: req.body.created_by
        });

        return res.json({ 
            result: "OK", 
            content: { 
                workflow, 
                version 
            } 
        });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});


// GUARDAR NODOS Y EDDGES DEL DISEÑADOR
workflowRouter.patch("/workflow-versions/:versionId/graph", async (req, res) => {
    try {
        const { provWfVersions } = await db();
        const { nodes = [], edges = [] } = req.body;

        const version = await provWfVersions.findById(req.params.versionId);

        if (!version) {
            return res.status(404).json({
                result: "ERROR"
            });
        }

        if (version.status !== "DRAFT") {
            return res.status(409).json({
                result: "ERROR",
                message:
                    "Solo se pueden editar versiones DRAFT"
            });
        }

        version.nodes = nodes;
        version.edges = edges;

        await version.save();

        return res.json({
            result: "OK",
            content: version
        });

    } catch (e) {
        console.error("PATCH graph:", e);
        return res.status(500).json({ result: "ERROR" });
    }
});

// PUBLICAR WORKFLOW
workflowRouter.patch("/workflow-versions/:versionId/publish", async(req, res) => {
    try {
        const { provWfVersions, provWfWorkflows } = await db();
        const version = await provWfVersions.findById(req.params.versionId);

        if (!version) {
            return res.status(404).json({ 
                result: "ERROR", 
                message: "Versión no encontrada" 
            });
        } 

        if (!(version.nodes || []).length) {
            return res.status(400).json({ 
                result: "ERROR", 
                message: "La versión no tiene nodos" 
            });
        } 

        await provWfVersions.updateMany(
            { 
                workflow_id: version.workflow_id, 
                status: "PUBLISHED" 
            }, 
            { $set: { 
                status: "ARCHIVED" 
            } 
        });

        version.status = "PUBLISHED";
        version.published_at = new Date();
        version.published_by = req.body.user_id;

        await version.save();

        await provWfWorkflows.findByIdAndUpdate(version.workflow_id, {
            $set: { 
                status: "PUBLISHED", 
                active_version: version.version
            }
        });

        return res.json({ result: "OK", content: version });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});

workflowRouter.patch("/workflow-versions/:versionId/archive", async(req, res) => {
    try {
        const { provWfVersions } = await db();
        const version = await provWfVersions.findByIdAndUpdate(req.params.versionId, 
            { $set: { status: "ARCHIVED" } }, 
            { new: true }
        );

        if (!version) {
            return res.status(404).json({ 
                result: "ERROR", 
                message: "Versión no encontrada" 
            });
        } 

        return res.json({ result: "OK", content: version });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});

// ELIMINAR VERSIÓN DRAFT
workflowRouter.delete("/workflow-versions/:versionId", async(req, res) => {
    try {
        const { provWfVersions, provWfInstances } = await db();
        const version = await provWfVersions.findById(req.params.versionId);
        
        if (!version) {
            return res.status(404).json({ 
                result: "ERROR", 
                message: "Versión no encontrada" 
            });
        } 

        if (version.status !== "DRAFT") {
            return res.status(409).json({ 
                result: "ERROR", 
                message: "Solo se pueden eliminar versiones DRAFT" 
            });
        }

        const used = await provWfInstances.exists({ workflow_version_id: version._id });
        
        if (used) {
            return res.status(409).json({ 
                result: "ERROR", 
                message: "La versión tiene instancias" 
            });
        } 

        await version.deleteOne();
        return res.json({ result: "OK" });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});

module.exports = workflowRouter;