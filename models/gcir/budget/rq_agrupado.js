var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const rq_agrupado = new Schema({
    "RQ": {type: String },
    "Nro OC": {type: String },
    "Estado OC": {type: String },
    "Fecha Emisión RQ": {type: Date},
    "Fecha Aprobación RQ": {type: Date },
    "Fecha Emisión OC": {type: Date },
    "Fecha Aprobación OC": {type: Date },
    "Fecha Inicio de Proyecto": {type: Date },
    "Fecha de Fin de Proyecto": {type: Date },
    "Tipo": {type: String },
    "Código Proyecto": {type: String },
    "Nombre Proyecto": {type: String },
    "Inversión/SubRubro": {type: String },
    "Categoría": {type: String },
    "Acuerdo": {type: String },
    "Proveedor": {type: String },
    "Requisitor": {type: String },
    "PM ACTUAL": {type: String },
    "Gerencia Requisitor": {type: String },
    "Gerencia Sponsor": {type: String },
    "Gerencia Sponsor Final": {type: String },
    "Importe OC": {type: Number },
    "Importe AC": {type: Number },
    "Importe Facturado": {type: Number },
    "Importe RQ": {type: Number },
    "CR 2026": {type: Number },
    "CR menores 2026": {type: Number },
    "Llave": {type: String },
    "Provisión Real": {type: Number },
    "Ahorro Real": {type: Number },
    "Declaración No Uso": {type: Number },
    "Jefatura Final": {type: String },
    "Unidad Funcional": {type: String },
    "Gerencia": {type: String },
    "Comentarios": {type: String },
    "Estado Ptto": {type: String },
    "Trimestre" : {type: String },
    "Trimestre_Real" : {type: String },
    "Avance_Proyecto" : {type: String }
});
const rq_agrupad = (conn) => conn.model('RQ_AGRUPADO', rq_agrupado, 'rq_agrupado')

module.exports = rq_agrupad