const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const subtaskRuntimeSchema = new Schema({
    subtask_key: { type: String, required: true },
    name: { type: String },
    blocking: { type: Boolean, default: true },
    status: { type: String, enum: [
        "PENDING",
        "ACTIVE",
        "WAITING",
        "OBSERVED",
        "COMPLETED",
        "CANCELLED"
    ], default: "PENDING", index: true },
    state: { type: String, default: null },
    cycle: { type: Number, default: 1 },

     // Pool permitido proveniente de la plantilla
    assignment_pool_user_ids: {
        type: [String],
        default: []
    },

    assigned_user_ids: { type: [String], default: [] },
    opened_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },

    assignment_source: {
        type: String,
        enum: ["TEMPLATE", "MANUAL", "DYNAMIC_PROVIDER"],
        default: "TEMPLATE"
    },

    assignment_updated_by: {
        type: String,
        default: null
    },

    assignment_updated_at: {
        type: Date,
        default: null
    },

    last_comment: { type: String, default: null },
    last_selected_option: { type: String, default: null },
    last_action_by: { type: String, default: null },
    last_action_at: { type: Date, default: null },

    is_standby: { type: Boolean, default: false },
    standby_since: { type: Date, default: null },
    standby_state_key: { type: String, default: null },

    form_data: { type: Schema.Types.Mixed, default: {} }
}, { _id: false });

const forecastSchema = new Schema({
    sla_date: { type: Date, default: null },

    responsible_date: { type: Date, default: null },
    pm_date: { type: Date, default: null },

    current_date: { type: Date, default: null },
    source: { type: String, enum: ["AUTO_SLA","MANUAL","PM", "RESPONSIBLE"], default: "AUTO_SLA" },
    revision: { type: Number, default: 0 },
    updated_by: { type: String, default: null },
    updated_at: { type: Date, default: null }
}, { _id: false });

const nodeRuntimeSchema = new Schema({
    node_key: { type: String, required: true },
    task_id: { type: Schema.Types.ObjectId, ref: "WF_TASKS", default: null },
    task_code: { type: String, default: null },
    task_name: { type: String, default: null },
    status: { type: String, enum: [
        "NOT_REACHED",
        "ACTIVE",
        "COMPLETED",
        "CANCELLED",
        "ERROR"
    ], default: "NOT_REACHED", index: true },
    manual_opened: { type: Boolean, default: false },
    reopen_correction: { type: Boolean, default: false },
    participants: { type: [String], default: [] },
    started_at: { type: Date, default: null },
    finished_at: { type: Date, default: null },
    forecast: { type: forecastSchema, default: () => ({}) },
    subtasks: { type: [subtaskRuntimeSchema], default: [] },
    workflow_released: { type: Boolean, default: false },
    released_at: { type: Date, default: null },
}, { _id: false });

const cancellationSchema = new Schema({
    requested: { type: Boolean, default: false },
    requested_by: { type: String, default: null },
    requested_at: { type: Date, default: null },
    reason: { type: String, default: null },
    status: { type: String, default: null },
    cancelled_at: { type: Date, default: null }
}, { _id: false });

const wf_instances = new Schema({
    site_id: { type: Schema.Types.ObjectId, ref: "WF_SITES", required: true, index: true },
    identificador: { type: String, required: true, index: true },
    workflow_id: { type: Schema.Types.ObjectId, ref: "WF_WORKFLOWS", required: true, index: true },
    workflow_version_id: { type: Schema.Types.ObjectId, ref: "WF_VERSIONS", required: true, index: true },
    workflow_code: { type: String, required: true, index: true },
    workflow_version: { type: Number, required: true },
    status: { type: String, enum: [
        "PENDING",
        "ACTIVE",
        "COMPLETED",
        "CANCEL_PENDING",
        "CANCELLED",
        "ERROR"
    ], default: "PENDING", index: true },
    workflow_start_date: { type: Date, default: Date.now },
    active_nodes: { type: [String], default: [] },
    nodes: { type: [nodeRuntimeSchema], default: [] },
    cancellation: { type: cancellationSchema, default: () => ({}) },
    started_at: { type: Date, default: null },
    finished_at: { type: Date, default: null }
}, { timestamps: true });

wf_instances.index({ workflow_code: 1, status: 1 });
wf_instances.index({ "nodes.participants": 1, "nodes.status": 1 });
wf_instances.index({ "nodes.subtasks.assigned_user_ids": 1, "nodes.subtasks.status": 1 });
wf_instances.index({ "nodes.task_code": 1, "nodes.forecast.current_date": 1 });
wf_instances.index({ "nodes.task_code": 1, "nodes.forecast.sla_date": 1 });
wf_instances.index({ "nodes.task_code": 1, "nodes.forecast.responsible_date": 1 });
wf_instances.index({ "nodes.subtasks.is_standby": 1, "nodes.status": 1 });
wf_instances.index({ "nodes.subtasks.assignment_pool_user_ids": 1 });

const wf_instance = (conn) => conn.model("WF_INSTANCES", wf_instances, "wf_instances");

module.exports = wf_instance;