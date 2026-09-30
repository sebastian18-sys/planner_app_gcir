var mongoose = require('mongoose');

//const db = require('../../../db/pool');
//var gcir = db.gcir();

const Schema = mongoose.Schema;

const contracts = new Schema({
    provider: {type: String },
    area: {type: String },
    proceso: {type: String },
    number_contest: {type: String },
    id_detail: {type: Number},
    detail: {type: String },
    type_provider: {type: String },
    number_contract: {type: String },
    start_date: {type: String },
    end_date: {type: String },
    number_addendum: {type: String },
    start_date_addendum: {type: String },
    end_date_addendum: {type: String },
    number_addendum_two: {type: String},
    start_date_addendum_two: {type: String},
    end_date_addendum_two: {type: String},
    status_contract: {type: String },
    status_addendum: {type: String },
    state: {type: String},
    letter_bail: {type: String},
    start_date_validity_cf: {type: String},
    end_date_validity_cf: {type: String},
    amount_contract: {type: String},
    // new
    pa: {type: String},
    amount_agreement: {type: Number},
    status_final: {type: String},
    // 
    data_files_evidence: {type: Array},
    comments: {type: Array}
});
const contract = (conn) => conn.model('CONTRACTS', contracts, 'contracts')

module.exports = contract
//module.exports = gcir.model('CONTRACTS', contracts, 'contracts');