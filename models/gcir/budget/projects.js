var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const projects = new Schema({
    "CAPEX/OPEX": {type: String },
    "Tipo": {type: String },
    "Código_Proyecto": {type: String },
    "Nombre_Proyecto": {type: String},
    "Inversión/SubRubro": {type: String },
    "Gerencia": {type: String },
    "Jefatura_Final": {type: String },
    "Unidad_Funcional": {type: String },
    "PM_ACTUAL": {type: String },
    "Requisitor": {type: String },
    "Estado_Ptto": {type: String },
    "SOLPE_ORIGINAL": {type: Number },
    "SOLPE": {type: Number },
    "Importe_OC": {type: Number },
    "Importe_AC": {type: Number },
    "Importe_Facturado": {type: Number },
    "Importe_RQ": {type: Number },
    "Provisión_Real": {type: Number },
    "Declaración_No_Uso": {type: Number },
    "Categoría": {type: String },
    "Llave2": {type: String },
    "amounts": {type: Object },
    "forecasts": {type: Object },
    "exceso_por_comprometer": {type: Number },
    "ptto_disponible": {type: Number },
    "gerencia_sponsor_final": {type: String },
    "Trimestre" : {type: String },
    "Trimestre_Real" : {type: String },
    "Avance_Proyecto" : {type: String }
});
const project = (conn) => conn.model('PROJECTS', projects, 'projects')

module.exports = project