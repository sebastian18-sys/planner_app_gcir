var mongoose = require('mongoose');
//const db = require('../../../db/pool');
//var calidadDB = db.providers();

const Schema = mongoose.Schema;

const profiles = new Schema({
    "PROVEEDOR": String,
    "A y A": {type: Number},
    "NODOS": {type: Number},
    "TX": {type: Number},
    "OOCC y EE": {type: Number},
    "TOTAL GENERAL": {type: Number}
});
const profile = (conn) => conn.model('PROFILES', profiles, 'PROFILES')

module.exports = profile
//module.exports = calidadDB.model('PROFILES', profiles, 'PROFILES');