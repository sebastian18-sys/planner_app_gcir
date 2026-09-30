var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const opex = new Schema({
    "estructura": {type: String },
    "subestructura": {type: String },
    "nombre_proyecto": {type: String},
    "codigo_proyecto": {type: String },
    "flexfield": {type: String },
    "unidad_funcional": {type: String},
    "responsable": {type: String },
    "tipo": {type: String },
    "tipo_proyecto": {type: String },
    "amounts": {type: Object }
}, { timestamps: true });
const ope = (conn) => conn.model('OPEX', opex, 'opex')

module.exports = ope