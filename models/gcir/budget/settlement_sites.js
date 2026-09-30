var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const settlements_sites = new Schema({

    "settlement_id": { type: mongoose.Schema.Types.ObjectId, ref: "provSettlements", required: true, index: true },
    "code": {type: String},

    "requester": {type: String },
    "requester_email": {type: String },

    "identificador": {type: String },
    "sitio": {type: String },
    "actividad": {type: String },
    "solucion": {type: String },
    "proveedor": {type: String },
    "id_proyecto": {type: String },
    "nombre_proyecto": {type: String },
    "linea_inversion": {type: String },
    "llave": {type: String },

    "rq": {type: String },
    "oc": {type: String },
    "linea_oc": {type: Number },
    "monto_oc": {type: Number },
    "coordinador": {type: String },
    "descripcion_adicional": {type: String },

    "cantidad": {type: Number, default: 0},
    "precio_unitario": {type: Number, default: 0},

    "assigned_to": { type: String },
    "assigned_to_email": { type: String },

    "estado": {type: String },
    
}, { timestamps: true });

const settlements_site = (conn) => conn.model('SETTLEMENTS_SITES', settlements_sites, 'settlements_sites')

module.exports = settlements_site