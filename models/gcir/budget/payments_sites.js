var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const payments_sites = new Schema({

    "cr_id": { type: mongoose.Schema.Types.ObjectId, ref: "provPayments", required: true, index: true },
    "code": { type: String },

    "llave": {type: String},
    "identificador": {type: String },
    "sitio": {type: String },
    "id_proyecto": {type: String },
    "nombre_proyecto": {type: String },
    "linea_inversion": {type: String },
    "actividad": {type: String },
    "solucion": {type: String },
    "proveedor": {type: String },
    "sustento": {type: String },
    "acuerdo_compras": {type: String },
    "coordinador": {type: String },
    "descripcion_adicional": {type: String },
    "ticket_jira": {type: String },
    "estado": {type: String },
    "jefatura": {type: String },
    "cantidad": {type: Number },
    "monto": {type: Number },

    "rq": {type: String},
    "oc": {type: String},
    "linea_oc": {type: String},
    "cr": {type: String},
    "moneda": {type: String },
    "total_cotizacion": {type: Number },

    "estado_sitio": {type: String },

    "cantidad_h1": {type: Number },
    "total_pago_h1": {type: Number },

    "cantidad_h2": {type: Number },
    "total_pago_h2": {type: Number },

    "total_pago": {type: Number },
    "pendiente_total": {type: Number },
    "status_payment": {type: String }, //Abierto - Cerrado
    
    // new
    "requester" : {type: String},
    "requester_email" : {type: String},
    "comentarios": {type: String },

}, { timestamps: true });
const payments_site = (conn) => conn.model('PAYMENTS_SITES', payments_sites, 'payments_sites')

module.exports = payments_site