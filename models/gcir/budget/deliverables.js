var mongoose = require("mongoose");

const Schema = mongoose.Schema;

const deliverables = new Schema({

    "code": { type: String, unique: true },
    "name": { type: String },
    "description": { type: String },

    "identificador": { type: String },
    "sitio": { type: String },
    "actividad": { type: String },
    "id_proyecto": { type: String },
    "nombre_proyecto": { type: String },
    "linea_inversion": { type: String },

    "estado": { type: String },
    "proveedor": { type: String },

    "rq_pext": { type: String },
    "rq_pint": { type: String },
    "id_planner_ne": { type: String },
    "id_planner_fe": { type: String },
    "id_ticket_transferencia": { type: String },

    "requester": { type: String },
    "requester_email": { type: String },

    //pago
    "rq": {type: String },
    "oc": {type: String },
    "linea_oc": {type: Number },

    "assigned_to": { type: String },
    "assigned_to_email": { type: String },

    "validated_to": { type: String },
    "validated_to_email": { type: String },
    "validated_at": { type: Date },
    
    // Tipo seleccionado
    "request_type_id": {
        type: mongoose.Schema.Types.ObjectId,
        ref: "DELIVERABLES_TEMPLATE_TYPES",
        required: true,
        index: true
    },

    "type_code": { type: String, required: true },
    "type_name": { type: String, required: true },

    // Snapshot de la plantilla usada al momento de crear la solicitud.
    // Esto sirve para que si luego modificas la plantilla RAN,
    // las solicitudes antiguas no se rompan.
    "template_snapshot": {
        code: String,
        name: String,
        fields: Array
    },

    "sustentos": { type: Array, default: [] },
    "comments": { type: Array, default: [] }

}, { timestamps: true });

const deliverable = (conn) => conn.model("DELIVERABLES", deliverables, "deliverables");

module.exports = deliverable;