var mongoose = require('mongoose');
//const db = require('../../../db/pool');
//var calidadDB = db.providers();

const Schema = mongoose.Schema;

const perfil = new Schema({
    "Proveedor": { type: String },
    "A y A": String,
    "OOCC Y EE": String,
    "Ing E Imlementación Tx": String,
    "Implementacion Nodos": String,
    "Total": String,
    "Facturacion": String,
    "Participacion": String,
    "Perfil": String
});

const perfi= (conn) => conn.model('PERFILES', perfil, 'PERFIL')

module.exports = perfi
//module.exports = calidadDB.model('PERFILES', perfil, 'PERFIL');