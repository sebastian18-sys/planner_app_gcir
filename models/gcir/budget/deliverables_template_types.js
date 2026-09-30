var mongoose = require("mongoose");

const Schema = mongoose.Schema;

const deliverable_type_fields = new Schema({

    "key": { type: String, required: true }, 
    "label": { type: String, required: true },

    // approval = Aprobado/Rechazado/N/A
    // date = campo fecha
    // number = cantidad/días
    // select = lista simple
    // multiSelect = lista múltiple
    "field_type": {
        type: String,
        enum: ["approval", "date", "number", "select", "multiSelect", "text"],
        required: true
    },

    "options": { type: Array, default: [] },

    "required": { type: Boolean, default: false },
    "order": { type: Number, default: 0 },
    "active": { type: Boolean, default: true }

}, { _id: false });


const deliverables_template_types = new Schema({

    "code": { type: String, unique: true },
    "name": { type: String },
    "type": { type: String },
    "fields": { type: [deliverable_type_fields], default: [] },
    "active": { type: Boolean, default: true }

}, { timestamps: true });


const deliverables_template_type = (conn) => conn.model("DELIVERABLES_TEMPLATE_TYPES", deliverables_template_types, "deliverables_template_types");

module.exports = deliverables_template_type;