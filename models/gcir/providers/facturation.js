var mongoose = require('mongoose');
//const db = require('../../../db/pool');
//var gcir = db.gcir();

const Schema = mongoose.Schema;

const facturation = new Schema({
    provider: {type: String},
    year: {type: Number},
    aa: {type: String},
    nodes: {type: String},
    tx: {type: String},
    oocc_ee: {type: String},
    total_general: {type: String}
});
const facturatio = (conn) => conn.model('FACTURATION', facturation, 'facturation')

module.exports = facturatio
//module.exports = gcir.model('FACTURATION', facturation, 'facturation');