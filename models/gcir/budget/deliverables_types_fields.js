var mongoose = require("mongoose");

const Schema = mongoose.Schema;

const deliverables_types_fields = new Schema({

    "deliverable_id": {
        type: mongoose.Schema.Types.ObjectId,
        ref: "DELIVERABLES",
        required: true,
        index: true
    },

    "code": { type: String },

    "type_code": { type: String },
    "type_name": { type: String },

    // Campo de la plantilla
    "field_key": { type: String, required: true },
    "field_label": { type: String, required: true },

    "field_type": {
        type: String,
        enum: ["approval", "date", "number", "select", "multiSelect", "text"],
        required: true
    },

    // Opciones disponibles del campo
    // Para approval: ["Aprobado", "Rechazado", "N/A"]
    // Para penalidad: ["Sí", "No"]
    // Para tipo observación: varias opciones
    "options": { type: Array, default: [] },

    "required": { type: Boolean, default: false },
    "order": { type: Number, default: 0 },

    // Valor que llenará el validador después
    "value": { type: Schema.Types.Mixed, default: null },

    // Para trazabilidad
    "validated_by": { type: String },
    "validated_by_email": { type: String },
    "validated_at": { type: Date },

    "estado": {
        type: String,
        default: "Pendiente"
        // Pendiente, Completado, Observado
    },

    "comment": { type: String }

}, { timestamps: true });


const deliverables_types_field = (conn) => conn.model("DELIVERABLES_TYPES_FIELDS", deliverables_types_fields, "deliverables_types_fields");

module.exports = deliverables_types_field;