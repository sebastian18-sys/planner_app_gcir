var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const library = new Schema({
    leadership: {type: String },
    area: {type: String },
    process: {type: String },
    document_name: {type: String },
    document_code: {type: String },
    version: {type: String },
    document_type: {type: String },
    responsible: {type: String },
    email_responsible: {type: String },
    end_date: {type: String },
    link_sharepoint: {type: String },
    permissions: {type: String},
    status: {type: Boolean},
    data_files_evidence: {type: Array, default: []},
    // New fields to validate update and delete from users external
    pendingApproval: {type: Boolean },
    eventApproval: {type: String },
    emailRequesting: {type: String },
    newData: {}
});
const librar = (conn) => conn.model('LIBRARY', library, 'library')

module.exports = librar