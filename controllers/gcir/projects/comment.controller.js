const express = require('express');
const db = require('../../../db');
require("dotenv").config();

const {
    escapeRegex,
    getPagination,
    getSort,
    cleanDistinct
} = require("./_helpers");

const commentRouter = express.Router();

// FILTER OPTIONS
commentRouter.get("/instances/:instanceId/comments/filter-options", async(req, res) => {
    try {
        const { provWfComments } = await db();

        const q = {
            instance_id: req.params.instanceId
        };

        const [task_code, task_name, user_id, mentions] = await Promise.all([
            cleanDistinct(provWfComments, "task_code", q),
            cleanDistinct(provWfComments, "task_name", q),
            cleanDistinct(provWfComments, "user_id", q),
            cleanDistinct(provWfComments, "mentions", q)
        ]);

        return res.json({
            result: "OK",
            content: {
                task_code,
                task_name,
                user_id,
                mention_user_id: mentions,
            }
        });
    } catch (e) {
        console.error("GET comments/filter-options:", e);
        return res.status(500).json({ result: "ERROR" });
    }
});

// OBTENER CHAT DEL SITE DE MÁS NUEVO A MÁS ANTIGUO
commentRouter.get("/instances/:instanceId/comments", async(req, res) => {
    try {
        const { provWfComments } = await db();

        const {
            user_id,
            mention_user_id,
            task_code,
            task_name,
            date_from,
            date_to,
            search = "",
            page = 1,
            limit = 50
        } = req.query;

        const { currentPage, perPage, skip } = getPagination({ page, limit: 100 });

        const q = {
            instance_id: req.params.instanceId
        };

        if (user_id) q.user_id = user_id;
        if (mention_user_id) q.mentions = mention_user_id;
        if (task_code) q.task_code = task_code;
        if (task_name) q.task_name = task_name;

        if (date_from || date_to) {
            q.createdAt = {};
            if (date_from) q.createdAt.$gte = new Date(date_from);
            if (date_to) q.createdAt.$lte = new Date(date_to);
        }

        if (String(search).trim()) {
            q.message = new RegExp(
                escapeRegex(String(search).trim()),
                "i"
            );
        }

        const [totalResults, items] = await Promise.all([
            provWfComments.countDocuments(q),

            provWfComments.find(q)
                .sort({ createdAt: -1, _id: -1 })
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
        console.error("GET comments:", e);
        return res.status(500).json({ result: "ERROR" });
    }
});

// CREAR MENSAJE DE CHAT
commentRouter.post("/instances/:instanceId/comments", async(req, res) => {
    try {
        const { provWfInstances, provWfComments } = await db();

        const {
            task_code,
            subtask_key = null,
            user_id,
            user_name,
            message,
            mentions = [],
            attachment = []
        } = req.body;

        if (!task_code) {
            return res.status(400).json({
                result: "ERROR",
                message: "task_code requerido"
            });
        }

        if (!String(message || "").trim()) {
            return res.status(400).json({
                result: "ERROR",
                message: "message requerido"
            });
        }

        const instance = await provWfInstances.findById(
            req.params.instanceId
        ).lean();

        if (!instance) {
            return res.status(404).json({
                result: "ERROR",
                message: "Instancia no encontrada"
            });
        }

        const node = (instance.nodes || []).find(item => item.task_code === task_code);

        if (!node) {
            return res
                .status(400)
                .json({
                    result: "ERROR",
                    message: "La TASK no pertenece a la instancia"
                });
        }

        const participants = new Set();
        for (const node of instance.nodes || []) {
            for (const id of node.participants || []) participants.add(String(id));
            for (const st of node.subtasks || []) for (const id of st.assigned_user_ids || []) participants.add(String(id));
        }

        if (!participants.has(String(user_id))) {
            return res.status(403).json({ 
                result: "ERROR", 
                message: "El usuario no participa en el Site" 
            });
        }
            
        const validMentions = mentions.map(String).filter(id => participants.has(id));

        const comment = await provWfComments.create({
            instance_id: instance._id,
            task_code: node.task_code,
            task_name: node.task_name,
            subtask_key: subtask_key || null,
            site_id: instance.site_id,
            identificador: instance.identificador,
            user_id,
            user_name,
            message: String(message).trim(),
            mentions: validMentions,
            attachment
        });

        return res.json({
            result: "OK",
            content: comment
        });

    } catch (e) {
        console.error("POST comments:", e);
        return res.status(500).json({ result: "ERROR" });
    }
});


// commentRouter.get("/instances/:instanceId/participants", async(req, res) => {
//     try {
//         const { provWfInstances } = await db();
//         const instance = await provWfInstances.findById(req.params.instanceId, { nodes: 1 }).lean();
        
//         if (!instance) {
//             return res.status(404).json({ 
//                 result: "ERROR", 
//                 message: "Instancia no encontrada" 
//             });
//         } 

//         const ids = new Set();
        
//         for (const node of instance.nodes || []) {
//             for (const id of node.participants || []) ids.add(String(id));
//             for (const subtask of node.subtasks || []) for (const id of subtask.assigned_user_ids || []) ids.add(String(id));
//         }

//         return res.json({ 
//             result: "OK", 
//             content: { 
//                 user_ids: [...ids] 
//             } 
//         });

//     } catch (e) {
//         return res.status(500).json({ result: "ERROR", message: e.message });
//     }
// });


module.exports = commentRouter;