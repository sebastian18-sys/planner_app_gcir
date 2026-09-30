var mongoose = require('mongoose');

//const db = require('../../db/pool');
//var gcirDB = db.gcirDB();

const Schema = mongoose.Schema;

const empresaModel = new Schema({
    name: String,
    dir: String,
    icon: String,
    info_date: Array
});

//module.exports = gcirDB.model('ENTERPRISE', empresaModel, 'ENTERPRISES');

const empresas = (conn) => conn.model('ENTERPRISE', empresaModel, 'ENTERPRISES')

module.exports = empresas