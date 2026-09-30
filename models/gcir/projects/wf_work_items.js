const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const wf_work_items = new Schema({
    instance_id: { type: Schema.Types.ObjectId, ref: "WF_INSTANCES", required: true, index: true },
    site_id: { type: Schema.Types.ObjectId, ref: "WF_SITES", required: true, index: true },
    identificador: { type: String, required: true, index: true },
    workflow_code: { type: String, index: true },
    node_key: { type: String, required: true },
    task_code: { type: String, required: true, index: true },
    task_name: { type: String },
    subtask_key: { type: String, required: true, index: true },
    subtask_name: { type: String },
    cycle: { type: Number, default: 1 },
    blocking: { type: Boolean, default: true },
    status: { type: String, enum: ["OPEN","WAITING","OBSERVED","COMPLETED","CANCELLED"], default: "OPEN", index: true },
    state: { type: String, default: null },
    
    assigned_user_ids: { type: [String], default: [], index: true },
    assignment_pool_user_ids: { type: [String], default: [], index: true },
    assignment_source: {
        type: String,
        enum: [
            "TEMPLATE",
            "MANUAL",
            "DYNAMIC_PROVIDER"
        ],
        default: "TEMPLATE"
    },
    assignment_updated_by: { type: String, default: null, index: true },
    assignment_updated_at: { type: Date, default: null, index: true },

    last_comment: { type: String, default: null },
    last_selected_option: { type: String, default: null },
    last_action_by: { type: String, default: null },
    last_action_at: { type: Date, default: null },

    provider_id: { type: String, default: null, index: true },
    provider_name: { type: String, default: null, index: true },
    form_data: { type: Schema.Types.Mixed, default: {} },
    opened_at: { type: Date, default: Date.now },
    completed_at: { type: Date, default: null },
    completed_by: { type: String, default: null }
}, { timestamps: true });

wf_work_items.index({ assigned_user_ids: 1, status: 1 });
wf_work_items.index({ assignment_pool_user_ids: 1, status: 1 });
wf_work_items.index({ instance_id: 1, task_code: 1 });
wf_work_items.index({ instance_id: 1, subtask_key: 1, cycle: 1 });

const wf_work_item = (conn) => conn.model("WF_WORK_ITEMS", wf_work_items, "wf_work_items");

module.exports = wf_work_item;