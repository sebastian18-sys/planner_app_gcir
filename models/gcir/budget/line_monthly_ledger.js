var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const line_monthly_ledger = new Schema({
    amount: {type: Number },
    line_id: {type: String },
    metric: {type: String },
    project_id: {type: String},
    year: {type: Number}
});
const line_monthly_ledge = (conn) => conn.model('LINE_MONTHLY_LEDGER', line_monthly_ledger, 'line_monthly_ledger')

module.exports = line_monthly_ledge