var mongoose = require('mongoose');

// const db = require('../../../db/pool');
// var calidadDB = db.providers();

const Schema = mongoose.Schema;

const providers = new Schema({
    RUC: String,
    "Razon Social": String,
    "Nombre Contacto": String,
    Cargo: String,
    Movil: String,
    "Correo Electronico": String
});
const provider = (conn) => conn.model('PROVIDERS', providers, 'PROVIDERS')

module.exports = provider
// module.exports = calidadDB.model('PROVIDERS', providers, 'PROVIDERS');