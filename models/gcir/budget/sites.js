var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const sites = new Schema({

    "ticket_id": { type: mongoose.Schema.Types.ObjectId, ref: "provTickets", required: true, index: true },
    "batch_id": { type: String, required: true, index: true },
    "ticket_code": { type: String },

    "llave": {type: String},
    "nro": {type: String },
    "identificador": {type: String },
    "sitio": {type: String },
    "actividad": {type: String },
    "solucion": {type: String },
    "proveedor": {type: String },
    "sustento": {type: String },
    "acuerdo_compras": {type: String },
    "coordinador": {type: String },
    "moneda": {type: String },
    "cantidad": {type: Number },
    "precio_unitario": {type: Number },
    "total_cotizacion": {type: Number },
    "fecha_registro": {type: Date },
    "fecha_inicio_servicio": {type: Date },
    "fecha_fin_servicio": {type: Date },
    "descripcion_adicional": {type: String },
    "id_proyecto": {type: String },
    "nombre_proyecto": {type: String },
    "linea_inversion": {type: String },
    "articulo": {type: String },
    "estado": {type: String },
    "ticket_jira": {type: String },
    "jefatura": {type: String },
    "unidad_funcional": {type: String },

    // new
    "requester" : {type: String},
    "requester_email" : {type: String},
    "rq": {type: String},
    "oc": {type: String},
    "linea_oc": {type: String},
    "cr": {type: String},
    "importe_ac": {type: Number},
    "cr_list": {type: Array},
    "importe_ac_list": {type: Array},

    "is_settlement": {type: Boolean, default: false},
    "is_deliverable": {type: Boolean, default: false},
    // Pagos
    "is_payment": {type: Boolean, default: false},
    "is_payment_2": {type: Boolean, default: false},
    "cantidad_pago": {type: Number},
    "monto_pago": {type: Number},
    "cantidad_pago_pendiente": {type: Number},
    "monto_pago_pendiente": {type: Number},
    "status_settlement": {type: String},
    "status_deliverable": {type: String},

    "liquidacion": {type: Number},
    "descuento": {type: Number},
    "penalidad": {type: Number},
    "pendiente_pago": {type: Number},
    "monto_final_pagado": {type: Number},

    // jira cr
    "ticket_jira_cr_1": {type: String},
    "ticket_jira_cr_2": {type: String},

    // Sustento - Liquidacion final
    "sustento_liquidacion": { type: Array, default: [] },

    "estado_oc_draw": {type: String, default: "Abierta"},
    "estado_oc": {type: String },
    "assigned_to": {type: String},
    "assigned_to_email": {type: String},

    "comentarios": {type: String },
    "fecha_creacion": {type: Date, default: Date.now },

    "fecha_rq_sendmg": {type: Date},
    "fecha_cr_sendmg": {type: Date},
    "fecha_cr_2_sendmg": {type: Date}

}, { timestamps: true });
const site = (conn) => conn.model('SITES', sites, 'sites')

module.exports = site