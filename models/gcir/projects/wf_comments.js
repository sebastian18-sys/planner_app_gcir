const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const attachmentSchema = new Schema({
    file_name: { type: String },
    original_name: { type: String },
    mime_type: {
        type: String,
        enum: [
            "image/jpeg",
            "image/png",
            "image/jpg"
        ]
    },
    size: { type: Number },
    path: { type: String }
}, {
    _id: false
})

const wf_comments = new Schema({
    instance_id: { type: Schema.Types.ObjectId, ref: "WF_INSTANCES", required: true, index: true },

    task_code: { type: String, required: true, index: true},
    task_name: { type: String, required: true, index: true},
    subtask_key: { type: String, index: true},

    site_id: { type: Schema.Types.ObjectId, ref: "WF_SITES", required: true, index: true },
    identificador: { type: String, index: true },
    user_id: { type: String, required: true, index: true },
    user_name: { type: String },
    message: { type: String, required: true },
    mentions: { type: [String], default: [] },

    attachment: { type: [attachmentSchema], default: [] }

}, { timestamps: true });

wf_comments.index({ instance_id: 1, task_code: 1,  createdAt: -1 });

const workflowComment = (conn) => conn.model("WF_COMMENTS", wf_comments, "wf_comments");

module.exports = workflowComment;