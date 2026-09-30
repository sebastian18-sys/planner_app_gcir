const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const wf_events = new Schema({
    instance_id: { type: Schema.Types.ObjectId, ref: "WF_INSTANCES", required: true, index: true },
    site_id: { type: Schema.Types.ObjectId, ref: "WF_SITES", required: true, index: true },
    identificador: { type: String, index: true },
    workflow_code: { type: String, index: true },
    node_key: { type: String, default: null },
    task_code: { type: String, default: null, index: true },
    subtask_key: { type: String, default: null },
    event_type: {
        type: String,
        enum: [
            "WORKFLOW_STARTED","TASK_STARTED","TASK_COMPLETED","TASK_REOPENED", "SUBTASK_FORM_SAVED", "TASK_RELEASED",
            "SUBTASK_STARTED","SUBTASK_STATE_CHANGED","SUBTASK_MOVED","SUBTASK_OBSERVED","SUBTASK_COMPLETED",
            "FORECAST_UPDATED","ASSIGNMENT_UPDATED","CANCELLATION_REQUESTED","WORKFLOW_CANCELLED","WORKFLOW_COMPLETED"
        ],
        required: true,
        index: true
    },
    from_state: { type: String, default: null },
    to_state: { type: String, default: null },
    performed_by: { type: String, default: null, index: true },
    data: { type: Schema.Types.Mixed, default: {} },
    comment: { type: String, default: null },
    event_at: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

wf_events.index({ instance_id: 1, event_at: -1 });
wf_events.index({ instance_id: 1, event_type: 1, event_at: -1 });

const wf_event = (conn) => conn.model("WF_EVENTS", wf_events, "wf_events");

module.exports = wf_event;