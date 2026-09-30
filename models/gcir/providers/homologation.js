var mongoose = require('mongoose');
//const db = require('../../../db/pool');
//var gcir = db.gcir();

const Schema = mongoose.Schema;

/**
 * DICCTIONARY
 * life_date: Fecha de Vigencia
 * **/

const homologation = new Schema({
    provider: {type: String},
    scope: {type: String},
    contract_issuer: {type: String},
    start_date: {type: String},
    life_date: {type: String},
    contract_duration: {type: String},
    state: {type: String},
    data_files_evidence: {type: Array},
    comments: {type: Array}
});
const homologatio = (conn) => conn.model('HOMOLOGATION', homologation, 'homologation')

module.exports = homologatio
//module.exports = gcir.model('HOMOLOGATION', homologation, 'homologation');