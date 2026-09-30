var mongoose = require('mongoose');

//const db = require('../../db/pool');
//var gcir = db.gcir();

const Schema = mongoose.Schema;

const gerencyWorkersCopyModel = new Schema({
    dni: String,
    last_name: String,
    first_name: String,
    day: Number,
    month: Number,
    area_name: String,
    title_name: String,
    direct_boos: String,
    email: String
});

//module.exports = gcir.model('GERENCY_WORKERS', gerencyWorkersModel, 'gerency_workers');

const gerencys_copy = (conn) => conn.model('GERENCY_WORKERS_COPY', gerencyWorkersCopyModel, 'gerency_workers_copy')

module.exports = gerencys_copy