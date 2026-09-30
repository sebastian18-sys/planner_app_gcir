var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const tickets = new Schema({
    "ticket_code": {type: String, unique: true},
    "ticket_name": {type: String },
    "requester": {type: String },
    "requester_email": {type: String },
    // "date_request": {type: Date },
    // "date_update": {type: Date },
    "state": {type: String },

    // archivo vigente (metadata)
    "file": {
        originalName: String,
        filename: String,
        path: String,
        size: Number,
        mimetype: String,
        uploadedAt: Date
    },

    "sustentos": { type: Array, default: [] },

    "sites_count": {type: Number, default: 0},
    "total_cotizacion": {type: Number, default: 0},

    "active_batch_id": { type: String, index: true }, // apunta al batch vigente
    "ticket_jira": {type: String },
    
    // new
    "rq": {type: String},
    "oc": {type: String},

    // "data_files": {type: Array, default: []},
    // "sites": {type: Array},
    "comments": {type: Array, default: []},
    
}, { timestamps: true });

const ticket = (conn) => conn.model('TICKETS', tickets, 'tickets')

module.exports = ticket