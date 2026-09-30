var mongoose = require('mongoose');

//const db = require('../../../db/pool');
//var gcir = db.gcir();

const Schema = mongoose.Schema;

const no_compliance_contract = new Schema({
    id_penalty: {type: String },
    number_contest: {type: String },
    id_detail: {type: Array, default: []},
    service: {type: String },
    severity: {type: String },
    penalty_detail: {type: String }
});
const no_compliance_contrac = (conn) => conn.model('NO_COMPLIANCE_CONTRACT', no_compliance_contract, 'no_compliance_contract')

module.exports = no_compliance_contrac
//module.exports = gcir.model('NO_COMPLIANCE_CONTRACT', no_compliance_contract, 'no_compliance_contract');