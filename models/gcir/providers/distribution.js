var mongoose = require('mongoose');
//const db = require('../../../db/pool');
//var gcir = db.gcir();

const Schema = mongoose.Schema;

/**
 * DICCTIONARY
 * aa: Área de Adquisición y A..
 * nodes: Área de Nodos
 * tx: Área de TX
 * oocc_ee: OOCC y EE
 * **/

const distribution = new Schema({
    provider: {type: String},
    year: {type: Number},
    aa: {type: String},
    nodes: {type: String},
    tx: {type: String},
    oocc_ee: {type: String},
    total_general: {type: String}
});
const distributio= (conn) => conn.model('DISTRIBUTION', distribution, 'distribution')

module.exports = distributio
//module.exports = gcir.model('DISTRIBUTION', distribution, 'distribution');