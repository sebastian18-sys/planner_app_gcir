const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const fieldSchema = new Schema({
    field_key: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, enum: [
        "TEXT",
        "TEXTAREA",
        "NUMBER",
        "DATE",
        "DATETIME",
        "SELECT",
        "MULTISELECT",
        "CHECKBOX",
        "FILE"
    ], required: true },
    required: { type: Boolean, default: false },
    editable: { type: Boolean, default: true },
    default_value: { type: Schema.Types.Mixed, default: null },
    options: { type: [String], default: [] },
    show_in_next_task: {
        type: Boolean,
        default: false
    },
    system_binding: {
        type: String,
        enum: [
            "NONE",
            "TASK_RESPONSIBLE_FORECAST"
        ],
        default: "NONE"
    }
}, { _id: false });


const optionListSchema = new Schema({
    enabled: { type: Boolean, default: false },
    label: { type: String, default: "Issue" },
    options: { type: [String], default: [] }
}, { _id: false });

const transitionSchema = new Schema({
    transition_type: { type: String, enum: [
        "STATE",
        "OPEN_SUBTASK",
        "WAIT_VALIDATION",
        "REOPEN_SUBTASK",
        "CLOSE_SUBTASK",
        "CLOSE_RELATED_SUBTASK",
        "CLOSE_AND_OPEN_SUBTASK",
        "CLOSE_TASK",
        "STANDBY",
        "CLOSE_CURRENT_AND_SELECT_SUBTASKS"
    ], default: "STATE" },
    target_subtask_key: { type: String, default: null },
    target_subtask_keys: { type: [String], default: [] },
    set_non_blocking_subtask_keys: { type: [String], default: [] },
    target_state_key: { type: String, default: null },
    requires_comment: { type: Boolean, default: false }
}, { _id: false });

const stateSchema = new Schema({
    state_key: { type: String, required: true },
    label: { type: String, required: true },
    action_label: { type: String, default: null },
    order: { type: Number, default: 0 },
    transition: { type: transitionSchema, default: () => ({}) },
    option_list: { type: optionListSchema, default: () => ({}) }
}, { _id: false });

const assignmentSchema = new Schema({
    mode: { type: String, enum: [
        "FIXED_USERS",
        "DYNAMIC_PROVIDER",
        "UNASSIGNED"
    ], default: "UNASSIGNED" },
    user_ids: { type: [String], default: [] },
    responsibles: [{
        type: {
            type: String,
            enum: ["USER", "GROUP"],
            required: true
        },

        id: {
            type: String,
            required: true
        }
    }],
    provider_source_field: { type: String, default: null }
}, { _id: false });


const slaSchema = new Schema({
    days: {
        type: Number,
        min: 0,
        default: 0
    },
    business_days: {
        type: Boolean,
        default: true
    }
}, { _id: false });


const subtaskSchema = new Schema({
    subtask_key: { type: String, required: true },
    name: { type: String, required: true },
    order: { type: Number, default: 0 },
    blocking: { type: Boolean, default: true },
    start_policy: { type: String, enum: [
        "ON_TRANSITION",
        "ON_TASK_START",
        "AFTER_BLOCKING"
    ], default: "ON_TRANSITION" },

    sla: {
        type: slaSchema,
        default: () => ({
            days: 0,
            business_days: true
        })
    },

    assignment: { type: assignmentSchema, default: () => ({}) },
    states: { type: [stateSchema], default: [] },
    fields: { type: [fieldSchema], default: [] }
}, { _id: false });

const wf_tasks = new Schema({
    task_code: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    sla_days: { type: Number, default: 0 },
    // business_days: { type: Boolean, default: false },
    subtasks: { type: [subtaskSchema], default: [] },
    status: { type: String, enum: ["ACTIVE","INACTIVE"], default: "ACTIVE", index: true }
}, { timestamps: true });


/*
 * =====================================================
 * SLA GENERAL DE TASK
 * =====================================================
 *
 * Cada vez que se guarda una TASK se recalcula.
 */
wf_tasks.pre(
    "save",
    function(next) {
        this.sla_days =
            (this.subtasks || [])
                .filter(
                    subtask =>
                        subtask.blocking !== false
                )
                .reduce(
                    (total, subtask) =>
                        total +
                        Math.max(
                            0,
                            Number(
                                subtask.sla?.days ||
                                0
                            )
                        ),
                    0
                );
        next();
    }
);


wf_tasks.index({ name: 1 });
wf_tasks.index({ "subtasks.subtask_key": 1 });

const wf_task = (conn) => conn.model("WF_TASKS", wf_tasks, "wf_tasks");

module.exports = wf_task;