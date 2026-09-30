var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const cr_individual = new Schema({
    "RQ": {type: String },
    "Nro OC": {type: String },
    "Nro Línea OC": {type: Number },
    "Estado OC": {type: String },
    "Fecha Emisión RQ": {type: Date},
    "Fecha Aprobación RQ": {type: Date },
    "Fecha Emisión OC": {type: Date },
    "Fecha Aprobación OC": {type: Date },
    'Descripción de RQ': {type: Date },
    "Descripción OC": {type: String },
    "Descripción Adicional": {type: String },
    "Código Recepción": {type: String },
    "Fecha Recepción": {type: Date },
    "Código Proyecto": {type: String },
    "Nombre Proyecto": {type: String },
    "Inversión/SubRubro": {type: String },
    "PM ACTUAL": {type: String },
    "Gerencia Sponsor Final": {type: String },
    "Acuerdo": {type: String },
    "Proveedor": {type: String },
    "Requisitor": {type: String },
    "Gerencia Requisitor": {type: String },
    "Gerencia Sponsor": {type: String },
    "Importe OC": {type: Number },
    "Importe AC": {type: Number },
    "Importe Facturado": {type: Number },
    "Importe RQ": {type: Number }
});
const cr_individua = (conn) => conn.model('CR_INVIDIUAL', cr_individual, 'cr_individual')

module.exports = cr_individua