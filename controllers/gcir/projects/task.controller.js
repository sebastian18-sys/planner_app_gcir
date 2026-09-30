const express = require('express');
const db = require('../../../db');
require("dotenv").config();

const {
    escapeRegex,
    getPagination,
    getSort,
    cleanDistinct,
    generateKey
} = require("./_helpers");

const taskRouter = express.Router();

/* *****************************************************************************
 * Tasks
 * ****************************************************************************/

function unique(values = []) {
    return [...new Set(
        values
            .filter(Boolean)
            .map(String)
    )];
}

function normalizeStateTransition({
    task,
    currentSubtaskKey,
    transition = {}
}) {
    const type = transition.transition_type || "STATE";

    const targetSubtaskKeys = unique(transition.target_subtask_keys || [])
        .filter(
            key => key !== currentSubtaskKey
        );

    const nonBlockingKeys = unique(transition.set_non_blocking_subtask_keys || [])
        .filter(
            key => key !== currentSubtaskKey
        );

    const validKeys = new Set((task.subtasks || [])
        .map(subtask => subtask.subtask_key)
    );

    if (type === "CLOSE_CURRENT_AND_SELECT_SUBTASKS") {
        if (!targetSubtaskKeys.length) {
            throw new Error(
                "Seleccionar al menos una Subtarea a cerrar"
            );
        }

        const invalidTargets = targetSubtaskKeys.filter(
            key => !validKeys.has(key)
        );

        if (invalidTargets.length) {
            throw new Error(
                `Subtareas destino inválidas: ${invalidTargets.join(", ")}`
            );
        }
    }

    const invalidNonBlocking = nonBlockingKeys.filter(
        key => !validKeys.has(key)
    );

    if (invalidNonBlocking.length) {
        throw new Error(
            `Subtareas para convertir a no bloqueante inválidas: ${invalidNonBlocking.join(", ")}`
        );
    }

    const isMultiClose = type === "CLOSE_CURRENT_AND_SELECT_SUBTASKS";

    return {
        transition_type: type,
        target_subtask_key: isMultiClose 
            ? null 
            : transition.target_subtask_key || null,
        target_subtask_keys: isMultiClose
            ? targetSubtaskKeys
            : [],
        set_non_blocking_subtask_keys: nonBlockingKeys,
        target_state_key: isMultiClose 
            ? null 
            : transition.target_state_key || null,
        requires_comment: transition.requires_comment === true
    };
}

// OPTIONS
function normalizeStateOptionList(optionList = {}) {
    const enabled = optionList.enabled === true;
    const options = unique(optionList.options || []);

    if (enabled && !options.length) {
        throw new Error("Ingresar al menos una opción");
    }

    return {
        enabled,
        label: String(optionList.label || "Issue").trim() || "Issue",
        options: enabled ? options : []
    };
}



// GET ALL TASKS
taskRouter.get("/tasks", async (req, res) => {
    try {
        const { provWfTasks } = await db();

        const {
            task_code,
            name,
            status,
            search = "",
            page = 1,
            limit = 10,
            sortBy = "createdAt",
            sortDirection = "desc"
        } = req.query;

        const { currentPage, perPage, skip } = getPagination({ page, limit });
        const q = {};

        if (task_code) q.task_code = task_code;
        if (name) q.name = name;
        if (status) q.status = status;

        if (search.trim()) {
            const rx =
                new RegExp(
                    escapeRegex(search),
                    "i"
                );

            q.$or = [
                { task_code: rx },
                { name: rx },
                { description: rx }
            ];
        }

        const allowed =
            new Set([
                "task_code",
                "name",
                "version",
                "status",
                "createdAt",
                "updatedAt"
            ]);

        const sort =
            getSort(
                sortBy,
                sortDirection,
                allowed
            );

        const [totalResults, items] = await Promise.all([
            provWfTasks.countDocuments(q),
            provWfTasks
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
        console.error(e);
        return res.status(500).json({ result: "ERROR" });
    }
});

// FILTER OPTIONS
taskRouter.get("/tasks/filter-options", async (req, res) => {
        try {
            const { provWfTasks } = await db();

            const [ task_code, name, status] = await Promise.all([
                cleanDistinct(provWfTasks, "task_code"),
                cleanDistinct(provWfTasks, "name"),
                cleanDistinct(provWfTasks, "status")
            ]);

            return res.json({
                result: "OK",
                content: {
                    task_code,
                    name,
                    status
                }
            });

        } catch (e) {
            return res.status(500).json({
                result: "ERROR"
            });
        }
    }
);

// GEST TASK BY ID
taskRouter.get("/tasks/:taskId", async (req, res) => {
        try {
            const { provWfTasks } = await db();
            const item = await provWfTasks.findById(req.params.taskId).lean();

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
            return res.status(500).json({
                result: "ERROR"
            });
        }
    }
);

// CREATE TASK
taskRouter.post("/tasks", async (req, res) => {
    try {
        const { provWfTasks } = await db();

        const { name, description = "", sla_days = 0, business_days = false } = req.body;

        const last = await provWfTasks
            .findOne()
            .sort({ createdAt: -1 })
            .lean();

        let next = 1;

        if (last?.task_code) {
            const n = last.task_code.match(/\d+/);
            next = n
                ? Number(n[0]) + 1
                : 1;
        }

        const task_code = `T-${String(next).padStart(4, "0")}`;

        const item = await provWfTasks.create({
            task_code,
            name,
            description,
            sla_days,
            business_days,
            subtasks: [],
            status: "ACTIVE"
        });

        return res.status(201).json({
            result: "OK",
            content: item
        });

    } catch (e) {
        console.error(e);

        return res.status(500).json({
            result: "ERROR"
        });
    }
});

// UPDATE TASK
taskRouter.patch("/tasks/:taskId", async (req, res) => {
        try {
            const { provWfTasks } = await db();

            const allowed = [
                "name",
                "description",
                // "sla_days",
                // "business_days",
                "status"
            ];

            const $set = {};

            allowed.forEach(field => {
                if (req.body[field] !== undefined) {
                    $set[field] = req.body[field];
                }
            });

            const item = await provWfTasks.findByIdAndUpdate(
                req.params.taskId,
                {
                    $set
                },
                {
                    new: true
                }
            );

            return res.json({
                result: "OK",
                content: item
            });

        } catch (e) {
            return res.status(500).json({
                result: "ERROR"
            });
        }
    }
);

// DELETE TASK NOT USED
taskRouter.delete("/tasks/:taskId", async(req, res) => {
    try {
        const { provWfTasks, provWfVersions } = await db();

        const task = await provWfTasks.findById(req.params.taskId).lean();
        
        if (!task) {
            return res.status(404).json({ 
                result: "ERROR", 
                message: "Tarea no encontrada" 
            });
        } 
        const used = await provWfVersions.exists({ "nodes.task_code": task.task_code });

        if (used) {
            return res.status(409).json({ 
                result: "ERROR", 
                message: "La Tarea está siendo utilizada por un Workflow" 
            });
        }

        await provWfTasks.findByIdAndDelete(req.params.taskId);

        return res.json({ result: "OK" });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});


/* *****************************************************************************
 * SUBTASKS
 * ****************************************************************************/

// SUBTASKS
taskRouter.post("/tasks/:taskId/subtasks", async (req, res) => {
        try {
            const { provWfTasks } = await db();
            const task = await provWfTasks.findById(req.params.taskId);

            if (!task) {
                return res.status(404).json({ 
                    result: "ERROR", 
                    message: "Tarea no encontrada"
                });
            }

            const key = req.body.subtask_key || generateKey(req.body.name);

            if (task.subtasks.some(x => x.subtask_key === key)) {
                return res.status(409).json({ 
                    result: "ERROR", 
                    message: "subtask_key ya existe" 
                });
            }

            task.subtasks.push({
                subtask_key: key,
                name: req.body.name,
                order: req.body.order ?? task.subtasks.length,
                blocking: req.body.blocking !== false,
                start_policy: req.body.start_policy || "ON_TRANSITION",
                assignment: req.body.assignment || { 
                    mode: "UNASSIGNED", 
                    user_ids: [], 
                    provider_source_field: null 
                },
                states: req.body.states || [],
                fields: req.body.fields || []
            });

            await task.save();

            return res.status(201).json({
                result: "OK",
                content: task.subtasks[task.subtasks.length - 1]
            });

        } catch (e) {
            console.error(e);
            return res.status(500).json({ result: "ERROR", message: e.message });
        }
    }
);

// UPDATE SUBTASK
// ACTUALIZAR SUBTAREA
taskRouter.patch("/tasks/:taskId/subtasks/:subtaskKey", async(req, res) => {
    try {
        const { provWfTasks } = await db();
        const task = await provWfTasks.findById(req.params.taskId);
        
        if (!task) {
            return res.status(404).json({ 
                result: "ERROR", 
                message: "Tarea no encontrada" 
            });
        } 

        const subtask = task.subtasks.find(x => x.subtask_key === req.params.subtaskKey);
        
        if (!subtask) {
            return res.status(404).json({ 
                result: "ERROR", 
                message: "Subtarea no encontrada" 
            });
        } 

        for (const k of ["name","order","blocking","start_policy","assignment", "sla"]) if (req.body[k] !== undefined) subtask[k] = req.body[k];
        
        // recalcula SLA ---> VALIDO EN ENDPOINT
        // task.sla_days = (task.subtasks || [])
        //     .filter(item => item.blocking !== false)
        //     .reduce(
        //         (total, item) =>
        //             total +
        //             Math.max(0, Number(item.sla?.days || 0)),
        //         0
        //     );

        task.markModified("subtasks");

        subtask.assignment = req.body.assignment

        await task.save();
        
        return res.json({ result: "OK", content: subtask });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});

// ELIMINAR SUBTAREA
taskRouter.delete("/tasks/:taskId/subtasks/:subtaskKey", async(req, res) => {
    try {
        const { provWfTasks } = await db();
        const task = await provWfTasks.findById(req.params.taskId);

        if (!task) {
            return res.status(404).json({ 
                result: "ERROR", 
                message: "Tarea no encontrada" 
            });
        } 

        task.subtasks = task.subtasks.filter(x => x.subtask_key !== req.params.subtaskKey);
        task.markModified("subtasks");
        await task.save();
        return res.json({ result: "OK" });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});

// REORDENAR SUBTAREAS
taskRouter.patch("/tasks/:taskId/subtasks-order", async(req, res) => {
    try {
        const { provWfTasks } = await db();
        const task = await provWfTasks.findById(req.params.taskId);

        if (!task) {
            return res.status(404).json({ 
                result: "ERROR", 
                message: "Tarea no encontrada" 
            });
        } 

        const order = req.body.items || [];
        
        order.forEach((x, index) => {
            const subtask = task.subtasks.find(s => s.subtask_key === x.subtask_key);
            if (subtask) subtask.order = x.order ?? index;
        });
        
        task.markModified("subtasks");
        await task.save();
        return res.json({ result: "OK", content: task.subtasks });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});

/* *****************************************************************************
 * CAMPOS
 * ****************************************************************************/

// CREAR CAMPO DE SUBTAREA
taskRouter.post("/tasks/:taskId/subtasks/:subtaskKey/fields", async(req, res) => {
    try {
        const { provWfTasks } = await db();
        const task = await provWfTasks.findById(req.params.taskId);

        if (!task) {
            return res.status(404).json({ 
                result: "ERROR", 
                message: "Tarea no encontrada" 
            });
        }

        const subtask = task.subtasks.find(x => x.subtask_key === req.params.subtaskKey);
        
        if (!subtask) {
            return res.status(404).json({ 
                result: "ERROR", 
                message: "Subtarea no encontrada" 
            });
        } 

        const fieldKey = req.body.field_key || generateKey(req.body.label);
        
        if (subtask.fields.some(x => x.field_key === fieldKey)) {
            return res.status(409).json({ 
                result: "ERROR", 
                message: "field_key ya existe" 
            });
        } 

        const systemBinding = req.body.system_binding || "NONE";
        const fieldType = req.body.type || "TEXT";

        if (
            systemBinding === "TASK_RESPONSIBLE_FORECAST" &&
            !["DATE", "DATETIME"].includes(fieldType)
        ) {
            return res.status(400).json({
                result: "ERROR",
                message: "Forecast Responsable solo puede asignarse a campos DATE o DATETIME"
            });
        }

        if (systemBinding === "TASK_RESPONSIBLE_FORECAST") {
            const alreadyExists = (task.subtasks || []).some(st =>
                (st.fields || []).some(field =>
                    field.system_binding === "TASK_RESPONSIBLE_FORECAST"
                )
            );

            if (alreadyExists) {
                return res.status(409).json({
                    result: "ERROR",
                    message: "La TASK ya tiene un campo configurado como Forecast Responsable"
                });
            }
        }

        subtask.fields.push({
            field_key: fieldKey, 
            label: req.body.label, 
            type: req.body.type || "TEXT",
            required: !!req.body.required, 
            editable: req.body.editable !== false,
            show_in_next_task: req.body.show_in_next_task || false,
            system_binding: req.body.system_binding || "NONE",
            default_value: req.body.default_value ?? null, 
            options: req.body.options || []
        });

        task.markModified("subtasks");
        await task.save();
        return res.json({ result: "OK", content: subtask.fields[subtask.fields.length - 1] });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});


// UPDATE CAMPO
taskRouter.patch("/tasks/:taskId/subtasks/:subtaskKey/fields/:fieldKey", async(req, res) => {
    try {
        const { provWfTasks } = await db();
        
        const task = await provWfTasks.findById(req.params.taskId);
        const subtask = task?.subtasks.find(x => x.subtask_key === req.params.subtaskKey);
        const field = subtask?.fields.find(x => x.field_key === req.params.fieldKey);

        if (!field) {
            return res.status(404).json({ 
                result: "ERROR", 
                message: "Campo no encontrado" 
            });
        } 

        const nextType = req.body.type ?? field.type;
        const nextSystemBinding =
            req.body.system_binding ??
            field.system_binding ??
            "NONE";

        if (
            nextSystemBinding === "TASK_RESPONSIBLE_FORECAST" &&
            !["DATE", "DATETIME"].includes(nextType)
        ) {
            return res.status(400).json({
                result: "ERROR",
                message: "Forecast Responsable solo puede asignarse a campos DATE o DATETIME"
            });
        }

        if (nextSystemBinding === "TASK_RESPONSIBLE_FORECAST") {
            const alreadyExists = (task.subtasks || []).some(st =>
                (st.fields || []).some(currentField =>
                    currentField.system_binding === "TASK_RESPONSIBLE_FORECAST" &&
                    !(
                        st.subtask_key === req.params.subtaskKey &&
                        currentField.field_key === req.params.fieldKey
                    )
                )
            );

            if (alreadyExists) {
                return res.status(409).json({
                    result: "ERROR",
                    message: "La TASK ya tiene otro campo configurado como Forecast Responsable"
                });
            }
        }

        for (const k of [
            "label",
            "type",
            "required",
            "editable",
            "default_value",
            "show_in_next_task",
            "system_binding",
            "options"
        ]) {
            if (req.body[k] !== undefined) {
                field[k] = req.body[k];
            }
        }
        task.markModified("subtasks");
        await task.save();
        return res.json({ result: "OK", content: field });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});

// DELETE CAMPO
taskRouter.delete("/tasks/:taskId/subtasks/:subtaskKey/fields/:fieldKey", async(req, res) => {
    try {
        const { provWfTasks } = await db();
        const task = await provWfTasks.findById(req.params.taskId);
        const subtask = task?.subtasks.find(x => x.subtask_key === req.params.subtaskKey);

        if (!subtask) {
            return res.status(404).json({ 
                result: "ERROR", 
                message: "Subtarea no encontrada" 
            });
        } 

        subtask.fields = subtask.fields.filter(x => x.field_key !== req.params.fieldKey);
        task.markModified("subtasks");
        await task.save();
        return res.json({ result: "OK" });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});

/* *****************************************************************************
 * ESTADOS
 * ****************************************************************************/

// CREAR ESTADO Y TRANSICIÓN
taskRouter.post("/tasks/:taskId/subtasks/:subtaskKey/states", async(req, res) => {
    try {
        const { provWfTasks } = await db();
        const task = await provWfTasks.findById(req.params.taskId);

        if (!task) {
            return res.status(404).json({
                result: "ERROR",
                message: "Tarea no encontrada"
            });
        }

        const subtask = task.subtasks.find(
            x => x.subtask_key === req.params.subtaskKey
        );

        if (!subtask) {
            return res.status(404).json({
                result: "ERROR",
                message: "Subtarea no encontrada"
            });
        }

        const stateKey = req.body.state_key || generateKey(req.body.label);

        if (subtask.states.some(x => x.state_key === stateKey)) {
            return res.status(409).json({
                result: "ERROR",
                message: "state_key ya existe"
            });
        }

        /*
         * Normaliza y valida la transición.
         *
         * Para CLOSE_CURRENT_AND_SELECT_SUBTASKS:
         * - valida que exista al menos un destino
         * - elimina duplicados
         * - evita seleccionar la actual
         * - valida que las Subtasks existan
         */
        const transition =
            normalizeStateTransition({
                task,
                currentSubtaskKey: req.params.subtaskKey,
                transition: req.body.transition || {}
            });

        subtask.states.push({
            state_key: stateKey,
            label: req.body.label,
            action_label: req.body.action_label || req.body.label,
            order: req.body.order ?? subtask.states.length,
            transition,
            option_list: normalizeStateOptionList(req.body.option_list || {})
        });

        task.markModified("subtasks");
        await task.save();

        return res.status(201).json({
            result: "OK",
            content: subtask.states[subtask.states.length - 1]
        });

    } catch (e) {
        console.error("POST state:", e);

        return res.status(400).json({
            result: "ERROR",
            message: e.message
        });
    }
});

// ACTUALIZAR ESTADO Y TRANSICIÓN
// ACTUALIZAR ESTADO Y TRANSICIÓN
taskRouter.patch("/tasks/:taskId/subtasks/:subtaskKey/states/:stateKey", async(req, res) => {
    try {
        const { provWfTasks } = await db();
        const task = await provWfTasks.findById(req.params.taskId);

        if (!task) {
            return res.status(404).json({
                result: "ERROR",
                message: "Tarea no encontrada"
            });
        }

        const subtask = task.subtasks.find(
            x =>
                x.subtask_key ===
                req.params.subtaskKey
        );

        if (!subtask) {
            return res.status(404).json({
                result: "ERROR",
                message: "Subtarea no encontrada"
            });
        }

        const state =
            subtask.states.find(
                x =>
                    x.state_key ===
                    req.params.stateKey
            );

        if (!state) {
            return res.status(404).json({
                result: "ERROR",
                message: "Estado no encontrado"
            });
        }

        /*
         * Campos generales.
         */
        if (req.body.label !== undefined) {
            state.label = req.body.label;
        }

        if (req.body.action_label !== undefined) {
            state.action_label = req.body.action_label;
        }

        if (req.body.order !== undefined) {
            state.order = req.body.order;
        }

        /*
         * Solo recalcular transición si
         * el frontend la está enviando.
         */
        if (req.body.transition !== undefined) {
            state.transition =
                normalizeStateTransition({
                    task,
                    currentSubtaskKey: req.params.subtaskKey,
                    transition: req.body.transition
                });
        }

        if (req.body.option_list !== undefined) {
            state.option_list = normalizeStateOptionList(req.body.option_list);
        }

        task.markModified("subtasks");
        await task.save();

        return res.json({
            result: "OK",
            content: state
        });

    } catch (e) {
        console.error("PATCH state:", e);
        return res.status(400).json({
            result: "ERROR",
            message: e.message
        });
    }
});

// ELIMINAR ESTADO
taskRouter.delete("/tasks/:taskId/subtasks/:subtaskKey/states/:stateKey", async(req, res) => {
    try {
        const { provWfTasks } = await db();
        const task = await provWfTasks.findById(req.params.taskId);
        const subtask = task?.subtasks.find(x => x.subtask_key === req.params.subtaskKey);

        if (!subtask) {
            return res.status(404).json({ 
                result: "ERROR", 
                message: "Subtarea no encontrada" 
            });
        } 

        subtask.states = subtask.states.filter(x => x.state_key !== req.params.stateKey);
        task.markModified("subtasks");
        await task.save();
        return res.json({ result: "OK" });
    } catch (e) {
        return res.status(500).json({ result: "ERROR", message: e.message });
    }
});

module.exports = taskRouter;