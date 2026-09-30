const express = require('express');
const db = require('../../../db');
require("dotenv").config();

const {
    escapeRegex,
    getPagination,
    getSort,
    cleanDistinct
} = require("./_helpers");

const eventRouter = express.Router();

// FILTER OPTIONS
eventRouter.get("/instances/:instanceId/events/filter-options", async(req, res) => {
    try {
        const { provWfEvents } = await db();

        const q = {
            instance_id: req.params.instanceId
        };

        const [
            task_code,
            subtask_key,
            event_type,
            performed_by
        ] = await Promise.all([
            cleanDistinct(provWfEvents, "task_code"),
            cleanDistinct(provWfEvents, "subtask_key"),
            cleanDistinct(provWfEvents, "event_type"),
            cleanDistinct(provWfEvents, "performed_by")
        ]);

        return res.json({
            result: "OK",
            content: {
                task_code,
                subtask_key,
                event_type,
                performed_by
            }
        });
    } catch (e) {
        console.error("GET events/filter-options:", e);
        return res.status(500).json({ result: "ERROR" });
    }
});

eventRouter.get("/instances/:instanceId/events", async(req, res) => {
    try {
        const { provWfEvents } = await db();

        const {
            task_code,
            subtask_key,
            event_type,
            performed_by,
            date_from,
            date_to,
            search = "",
            page = 1,
            limit = 20
        } = req.query;

        const { currentPage, perPage, skip } = getPagination({ page, limit: 200 });

        const q = {
            instance_id: req.params.instanceId
        };

        if (task_code) q.task_code = task_code;
        if (subtask_key) q.subtask_key = subtask_key;
        if (event_type) q.event_type = event_type;
        if (performed_by) q.performed_by = performed_by;

        if (date_from || date_to) {
            q.event_at = {};
            if (date_from) q.event_at.$gte = new Date(date_from);
            if (date_to) q.event_at.$lte = new Date(date_to);
        }

        if (String(search).trim()) {
            const rx = new RegExp(
                escapeRegex(String(search).trim()),
                "i"
            );

            q.$or = [
                { comment: rx },
                { task_code: rx },
                { subtask_key: rx }
            ];
        }

        const [totalResults, items] = await Promise.all([
            provWfEvents.countDocuments(q),

            provWfEvents.find(q)
                .sort({ event_at: -1, _id: -1 })
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
        console.error("GET events:", e);
        return res.status(500).json({ result: "ERROR" });
    }
});

module.exports = eventRouter;