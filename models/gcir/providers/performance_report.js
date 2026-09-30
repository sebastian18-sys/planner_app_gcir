var mongoose = require('mongoose');
//const db = require('../../../db/pool');
//var gcir = db.gcir();

const Schema = mongoose.Schema;

const performance_report = new Schema({
    type_enterprise: {type: String},
    business_name: {type: String},
    month: {type: String},
    evaluator: {type: String},
    qualification: {type: String},
    date: {type: String},
    process: {type: String},
    filename: {type: String},
    state: {type: String}
});
const performance_repor= (conn) => conn.model('PERFORMANCE_REPORT', performance_report, 'performance_report')

module.exports = performance_repor
//module.exports = gcir.model('PERFORMANCE_REPORT', performance_report, 'performance_report');