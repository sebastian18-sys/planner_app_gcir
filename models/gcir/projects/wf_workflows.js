const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const wf_workflows = new Schema(
    {
        code: { type: String, required: true, unique: true, index: true },
        name: { type: String, required: true, index: true },

        description: { type: String, default: "" },

        // ID proveniente de project_types SQL
        project_type_id: { type: Number, required: true, index: true },
        project_type_name: { type: String },

        status: {
            type: String,
            enum: ["DRAFT", "PUBLISHED", "ARCHIVED"],
            default: "DRAFT",
            index: true
        },

        active_version: { type: Number, default: 1 },

        created_by: { type: Number },
        updated_by: { type: Number }
    },
    {
        timestamps: true
    }
);

const wf_workflow = (conn) => conn.model("WF_WORKFLOWS", wf_workflows, "wf_workflows");

module.exports = wf_workflow;