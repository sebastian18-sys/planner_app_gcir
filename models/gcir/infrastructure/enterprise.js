var mongoose = require('mongoose');

//const db = require('../../../db/pool');
//var gcirDB = db.gcir();

const Schema = mongoose.Schema;

/**
 * name: Razón Social del Proveedor (TORRERA)
 * dir: Abreviación reconocida rápidamente por los colaboradores
 * icon: Link del icono que será mostrado en la Plataforma
 * info_date: Fechas de carga de los archivos brindandos por el Proveedor que serán cargados en la Plataforma
 * **/

const empresaModel = new Schema({
    name: String,
    dir: String,
    icon: String,
    info_date: Array
});
const empresas = (conn) => conn.model('ENTERPRISE', empresaModel, 'enterprises')

module.exports = empresas
//module.exports = gcirDB.model('ENTERPRISE', empresaModel, 'enterprises');