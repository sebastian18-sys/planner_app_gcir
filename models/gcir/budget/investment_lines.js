var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const investment_lines = new Schema({
    actas_total: {type: Number },
    comprometido_total: {type: Number },
    fcst_a_mes: {type: Number },
    fcst_actual: {type: Number },
    gerencia: {type: String },
    jefatura: {type: String },
    line_ref: {type: String },
    name: {type: String },
    pend_fcst_a_mes: {type: Number },
    pend_fcst_actual: {type: Number },
    pm_name: {type: String },
    project_code: {type: String },
    project_id: {type: String },
    project_name: {type: String },
    requisitor: {type: String },
    solpe_total: {type: Number },
    year: {type: Number}
});
const investment_line = (conn) => conn.model('INVESTMENT_LINES', investment_lines, 'investment_lines')

module.exports = investment_line