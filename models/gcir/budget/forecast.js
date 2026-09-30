var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const forecasts = new Schema({
    "llave": {type: String },
    "codigo_proyecto": {type: String },
    "nombre_proyecto": {type: String},
    "linea_inversion": {type: String },
    "grupo": {type: String },
    "cod_line": {type: String },
    "tipo": {type: String },
    "trimestre" : {type: String },
    "unidad_funcional": {type: String },
    "gerencia": {type: String },
    "jefatura_final": {type: String },
    "forecasts": {type: Object },
    "diff_cdg": {type: Number },
    "is_closed": {type: Boolean },
    "solpe": {type: Number },
    "comrprometido": {type: Number },
    "acta": {type: Number }
});
const forecast = (conn) => conn.model('FORECASTS', forecasts, 'forecasts')

module.exports = forecast