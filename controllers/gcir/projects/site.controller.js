const express = require('express');
const db = require('../../../db');
require("dotenv").config();

const {
    escapeRegex,
    getPagination,
    getSort,
    cleanDistinct,
    buildSiteProjectKey
} = require("./_helpers");

const siteRouter = express.Router();

/* *****************************************************************************
 * Sites
 * ****************************************************************************/

// ============================================================
// FILTER OPTIONS
// ============================================================
siteRouter.get("/sites/filter-options", async(req, res) => {
    try {
        const { provWfSites } = await db();

        const [
            identificador,
            project_typology,
            project_type,
            macro_project,
            sub_project,
            site,
            tower,
            tower_type,
            macrozone,
            zone,
            cluster,
            departament,
            province,
            district,
            project_type_id,
            project_type_name,
            provider_name,
            status,
            workflow_code,
            workflow_status
        ] = await Promise.all([
            cleanDistinct(provWfSites, "identificador"),
            cleanDistinct(provWfSites, "project_typology"),
            cleanDistinct(provWfSites, "project_type"),
            cleanDistinct(provWfSites, "macro_project"),
            cleanDistinct(provWfSites, "sub_project"),
            cleanDistinct(provWfSites, "site"),
            cleanDistinct(provWfSites, "tower"),
            cleanDistinct(provWfSites, "tower_type"),
            cleanDistinct(provWfSites, "macrozone"),
            cleanDistinct(provWfSites, "zone"),
            cleanDistinct(provWfSites, "cluster"),
            cleanDistinct(provWfSites, "departament"),
            cleanDistinct(provWfSites, "province"),
            cleanDistinct(provWfSites, "district"),
            cleanDistinct(provWfSites, "project_type_id"),
            cleanDistinct(provWfSites, "project_type_name"),
            cleanDistinct(provWfSites, "provider_name"),
            cleanDistinct(provWfSites, "status"),
            cleanDistinct(provWfSites, "workflow_code"),
            cleanDistinct(provWfSites, "workflow_summary.status")
        ]);

        return res.json({
            result: "OK",
            content: {
                identificador,
                project_typology,
                project_type,
                macro_project,
                sub_project,
                site,
                tower,
                tower_type,
                macrozone,
                zone,
                cluster,
                departament,
                province,
                district,
                project_type_id,
                project_type_name,
                provider_name,
                status,
                workflow_code,
                workflow_status
            }
        });
    } catch (e) {
        console.error("GET sites/filter-options:", e);
        return res.status(500).json({
            result: "ERROR",
            message: e.message
        });
    }
});

// GET SITES
siteRouter.get("/sites", async(req, res) => {
    try {
        const { provWfSites } = await db();

        const {
            identificador,
            project_typology,
            project_type,
            macro_project,
            sub_project,
            site,
            tower,
            tower_type,
            macrozone,
            zone,
            cluster,
            departament,
            province,
            district,
            project_type_id,
            project_type_name,
            provider_name,
            status,
            workflow_code,
            workflow_status,
            search = "",
            page = 1,
            limit = 10,
            sortBy = "createdAt",
            sortDirection = "desc"
        } = req.query;

        const { currentPage, perPage, skip } = getPagination({ page, limit });
        const q = {};

        if (identificador) q.identificador = identificador;
        if (project_typology) q.project_typology = project_typology;
        if (project_type) q.project_type = project_type;
        if (macro_project) q.macro_project = macro_project;
        if (sub_project) q.sub_project = sub_project;
        if (site) q.site = site;
        if (tower) q.tower = tower;
        if (tower_type) q.tower_type = tower_type;
        if (macrozone) q.macrozone = macrozone;
        if (zone) q.zone = zone;
        if (cluster) q.cluster = cluster;
        if (departament) q.departament = departament;
        if (province) q.province = province;
        if (district) q.district = district;

        if (project_type_id) q.project_type_id = Number(project_type_id);
        if (project_type_name) q.project_type_name = project_type_name;

        if (provider_name) q.provider_name = provider_name;
        if (status) q.status = status;
        if (workflow_code) q.workflow_code = workflow_code;
        if (workflow_status) q["workflow_summary.status"] = workflow_status;

        if (String(search).trim()) {
            const rx = new RegExp(
                escapeRegex(String(search).trim()),
                "i"
            );

            q.$or = [
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
                { district: rx },
                { project_type_name: rx },
                { provider_name: rx },
                { workflow_code: rx }
            ];
        }

        const allowed = new Set([
            "identificador",
            "project_typology",
            "project_type",
            "macro_project",
            "sub_project",
            "site",
            "tower",
            "macrozone",
            "zone",
            "cluster",
            "departament",
            "province",
            "district",
            "project_type_name",
            "provider_name",
            "status",
            "workflow_code",
            "createdAt",
            "updatedAt"
        ]);

        const sort = getSort(
            sortBy,
            sortDirection,
            allowed
        );

        const [totalResults, items] = await Promise.all([
            provWfSites.countDocuments(q),
            provWfSites
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
        console.error("GET sites:", e);

        return res.status(500).json({
            result: "ERROR",
            message: e.message
        });
    }
});

// OBTENER SITE
siteRouter.get("/sites/:siteId", async(req, res) => {
    try {
        const { provWfSites } = await db();
        const site = await provWfSites.findById(req.params.siteId).lean();

        if (!site) {
            return res.status(404).json({ 
                result: "ERROR", 
                message: "Site no encontrado" 
            });
        } 

        return res.json({ result: "OK", content: site });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});


// CREAR SITE
siteRouter.post("/sites", async(req, res) => {
    try {
        const { provWfSites } = await db();

        if (!req.body.identificador) {
            return res.status(400).json({ 
                result: "ERROR", 
                message: "identificador requerido" 
            });
        } 

        if (await provWfSites.exists({ identificador: req.body.identificador })) {
            return res.status(409).json({ 
                result: "ERROR", 
                message: "Identificador ya existe" 
            });
        }
            
        const site = await provWfSites.create(req.body);

        return res.json({ result: "OK", content: site });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});

// ============================================================
// CREATE SITE MANUAL
// ============================================================
siteRouter.post("/sites", async(req, res) => {
    try {
        const { provWfSites } = await db();

        const {
            identificador,
            site,
            macro_project,
            project_type_id,
            project_type_name
        } = req.body;

        if (!identificador || !site || !macro_project || !project_type_id || !project_type_name) {
            return res.status(400).json({
                result: "ERROR",
                message: "identificador, site, macro_project, project_type_id y project_type_name son requeridos"
            });
        }

        const siteProjectKey = buildSiteProjectKey(
            site,
            macro_project
        );

        const existing = await provWfSites.findOne({
            $or: [
                { identificador },
                { site_project_key: siteProjectKey }
            ]
        }).lean();

        if (existing) {
            return res.status(409).json({
                result: "ERROR",
                message:
                    existing.identificador === identificador
                        ? "Identificador ya existe"
                        : `SITE + MACRO PROYECTO ya existe (${existing.identificador})`
            });
        }

        const created = await provWfSites.create({
            ...req.body,
            site_project_key: siteProjectKey
        });

        return res.json({
            result: "OK",
            content: created
        });
    } catch (e) {
        return res.status(500).json({
            result: "ERROR",
            message: e.message
        });
    }
});

siteRouter.patch("/sites/:siteId", async(req, res) => {
    try {
        const { provWfSites } = await db();

        const current = await provWfSites.findById(req.params.siteId);

        if (!current) {
            return res.status(404).json({
                result: "ERROR",
                message: "Site no encontrado"
            });
        }

        const nextSite =
            req.body.site !== undefined
                ? req.body.site
                : current.site;

        const nextMacroProject =
            req.body.macro_project !== undefined
                ? req.body.macro_project
                : current.macro_project;

        const siteProjectKey = buildSiteProjectKey(
            nextSite,
            nextMacroProject
        );

        const duplicate = await provWfSites.findOne({
            _id: { $ne: current._id },
            $or: [
                { site_project_key: siteProjectKey },
                ...(req.body.identificador
                    ? [{ identificador: req.body.identificador }]
                    : [])
            ]
        }).lean();

        if (duplicate) {
            return res.status(409).json({
                result: "ERROR",
                message: "Ya existe un Site con el mismo identificador o SITE + MACRO PROYECTO"
            });
        }

        const updated = await provWfSites.findByIdAndUpdate(
            req.params.siteId,
            {
                $set: {
                    ...req.body,
                    site_project_key: siteProjectKey
                }
            },
            {
                new: true,
                runValidators: true
            }
        );

        return res.json({
            result: "OK",
            content: updated
        });
    } catch (e) {
        return res.status(500).json({
            result: "ERROR",
            message: e.message
        });
    }
});

// ELIMINAR SITE SIN INSTANCIA
siteRouter.delete("/sites/:siteId", async(req, res) => {
    try {
        const {
            provWfSites,
            provWfInstances
        } = await db();

        if (
            await provWfInstances.exists({
                site_id: req.params.siteId
            })
        ) {
            return res.status(409).json({
                result: "ERROR",
                message: "El Site tiene una instancia de Workflow"
            });
        }

        const site = await provWfSites.findByIdAndDelete(
            req.params.siteId
        );

        if (!site) {
            return res.status(404).json({
                result: "ERROR",
                message: "Site no encontrado"
            });
        }

        return res.json({
            result: "OK"
        });
    } catch (e) {
        return res.status(500).json({
            result: "ERROR",
            message: e.message
        });
    }
});


module.exports = siteRouter;