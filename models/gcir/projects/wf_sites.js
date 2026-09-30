const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const workflowSummarySchema = new Schema(
    {
        instance_id: { type: mongoose.Schema.Types.ObjectId, index: true},
        workflow_id: { type: mongoose.Schema.Types.ObjectId },

        workflow_code: { type: String },
        workflow_name: { type: String },
        workflow_version: { type: Number },

        status: {
            type: String,
            enum: [
                "PENDING",
                "ACTIVE",
                "COMPLETED",
                "CANCEL_PENDING",
                "CANCELLED",
                "ERROR"
            ]
        },

        current_nodes: [{ type: String}],

        started_at: { type: Date },
        finished_at: { type: Date }
    },
    {
        _id: false
    }
);

const wf_sites = new Schema(
    {
        identificador: { type: String, required: true, unique: true, index: true },

        // Llave antirepetición: site + macro_project normalizados
        site_project_key: { type: String, required: true, unique: true, index: true },

        // Metadata Excel
        project_typology: { type: String, default: "" },
        project_type: { type: String, default: "" },
        macro_project: { type: String, required: true, index: true },
        sub_project: { type: String, default: "", index: true },
        id_solpe: { type: String, default: "" },
        solpe_project: { type: String, default: "" },
        node_site: { type: String, default: "" },
        site: { type: String, required: true, index: true },
        tower: { type: String, default: "" },
        tower_type: { type: String, default: "" },
        plan_backup: { type: String, default: "" },
        q_fcst: { type: String, default: "" },
        macrozone: { type: String, default: "" },
        zone: { type: String, default: "" },
        cluster: { type: String, default: "" },
        departament: { type: String, default: "" },
        province: { type: String, default: "" },
        district: { type: String, default: "" },
        lat: { type: Number, default: null },
        long: { type: Number, default: null },

        // Datos de sistema tomados del Workflow
        project_type_id: { type: Number, required: true, index: true },
        project_type_name: { type: String, index: true },

        // Provider SQL
        provider_id: { type: Number, index: true },
        provider_name: { type: String },

        // Workflow asociado
        workflow_id: { type: mongoose.Schema.Types.ObjectId, index: true },
        workflow_code: { type: String, index: true },
        workflow_version_id: { type: mongoose.Schema.Types.ObjectId, index: true },
        workflow_version: { type: Number },
        batch_id: { type: mongoose.Schema.Types.ObjectId, index: true },

        status: {
            type: String,
            enum: ["ACTIVE", "INACTIVE", "CANCELLED"],
            default: "ACTIVE",
            index: true
        },

        workflow_summary: {
            type: workflowSummarySchema,
            default: null
        },

        created_by: { type: Number },
        updated_by: { type: Number }
    },
    {
        timestamps: true
    }
);

wf_sites.index({ workflow_code: 1, status: 1 });
wf_sites.index({ macro_project: 1, site: 1 });

const wf_site = (conn) => conn.model("WF_SITES", wf_sites, "wf_sites");

module.exports = wf_site;