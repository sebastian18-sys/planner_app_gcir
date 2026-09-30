const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const positionSchema = new Schema(
    {
        x: { type: Number, required: true },
        y: { type: Number, required: true }
    },
    {
        _id: false
    }
);

const nodeSchema = new Schema(
    {
        node_key: { type: String, required: true },
        type: {
            type: String,
            enum: ["START", "TASK", "GATEWAY", "END"],
            required: true
        },

        label: { type: String },

        task_id: { type: mongoose.Schema.Types.ObjectId },
        task_code: { type: String },
        task_version: { type: Number },

        gateway_type: {
            type: String,
            enum: [
                "PARALLEL_SPLIT",
                "PARALLEL_JOIN",
                "EXCLUSIVE"
            ],
            required: false
        },

        join_policy: {
            type: String,
            enum: ["ALL", "ANY"]
        },

        position: { type: positionSchema, required: true }
    },
    {
        _id: false
    }
);

const conditionSchema = new Schema(
    {
        source: { type: String },
        field: { type: String },
        operator: {
            type: String,
            enum: [
                "EQ",
                "NE",
                "GT",
                "GTE",
                "LT",
                "LTE",
                "IN",
                "NOT_IN",
                "EXISTS"
            ]
        },
        value: { type: Schema.Types.Mixed }
    },
    {
        _id: false
    }
);

const edgeSchema = new Schema(
    {
        edge_key: { type: String, required: true },
        from: { type: String, required: true },
        to: { type: String, required: true },
        label: { type: String },
        priority: { type: Number, default: 0 },
        condition: { type: conditionSchema, default: null }
    },
    {
        _id: false
    }
);

const wf_versions = new Schema(
    {
        workflow_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        workflow_code: { type: String, required: true, index: true },

        version: { type: Number, required: true },
        status: {
            type: String,
            enum: ["DRAFT", "PUBLISHED", "ARCHIVED"],
            default: "DRAFT",
            index: true
        },

        nodes: { type: [nodeSchema], default: [] },
        edges: { type: [edgeSchema], default: [] },

        created_by: { type: Number },
        published_by: { type: Number },
        published_at: { type: Date }
    },
    {
        timestamps: true
    }
);

wf_versions.index(
    {
        workflow_id: 1,
        version: 1
    },
    {
        unique: true
    }
);

const wf_version = (conn) => conn.model("WF_VERSIONS", wf_versions, "wf_versions");

module.exports = wf_version;