var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const opex_estimacion = new Schema({
    "tipo": {type: String },
    "proyecto": {type: String },
    "proyecto_sitio": {type: String},
    "categoria": {type: String },
    "incidencia_actividad": { type: Number },
    "driver_actividad": { type: Number },
    "incidencia_energia": { type: Number },
    "driver_energia": { type: Number },
    "q_mensuales": { type: Object, default : {} }
}, { timestamps: true });
const opex_estimacio = (conn) => conn.model('OPEX_ESTIMACION', opex_estimacion, 'opex_estimacion')

module.exports = opex_estimacio