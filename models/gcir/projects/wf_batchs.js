const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const wf_batchs = new Schema(
    {
        batch_code: { type: String, required: true, unique: true, index: true },
        workflow_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        workflow_version_id: { type: mongoose.Schema.Types.ObjectId, required: true },
        workflow_code: { type: String, required: true, index: true },
        workflow_version: { type: Number, required: true },

        project_type_id: { type: Number, index: true },
        project_type_name: { type: String },

        source: { type: String },

        file_name: { type: String },

        status: {
            type: String,
            enum: [
                "DRAFT",
                "VALIDATED",
                "LAUNCHED",
                "ERROR"
            ],
            default: "DRAFT",
            index: true
        },

        items: [
            {
                row_number: Number,

                identificador: { type: String, default: null },
                site_project_key: { type: String, default: null },

                project_typology: String,
                project_type: String,
                macro_project: String,
                sub_project: String,
                id_solpe: String,
                solpe_project: String,
                node_site: String,
                site: String,
                tower: String,
                tower_type: String,
                plan_backup: String,
                q_fcst: String,
                macrozone: String,
                zone: String,
                cluster: String,
                departament: String,
                province: String,
                district: String,
                lat: Number,
                long: Number,

                provider_id: Number,
                provider_name: String,

                valid: { type: Boolean, default: false },

                validation_errors: [{
                    type: String
                }]
            }
        ],

        totals: {
            received: { type: Number, default: 0 },
            created: { type: Number, default: 0 },
            errors: { type: Number, default: 0 }
        },

        error_detail: [{
            row_number: { type: Number },
            identificador: { type: String },
            message: { type: String }
        }],

        created_by: { type: Number, required: true },
        started_at: { type: Date },
        completed_at: { type: Date }
    },
    {
        timestamps: true
    }
);

const wf_batch = (conn) =>
    conn.model(
        "WF_BATCHS",
        wf_batchs,
        "wf_batchs"
    );

module.exports = wf_batch;