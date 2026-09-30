var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const payments = new Schema({
    "code": {type: String, unique: true},
    "name": {type: String },
    "requester": {type: String },
    "requester_email": {type: String },

    "sites": {type: Number, default: 0},
    "amount_h1": {type: Number, default: 0},
    "amount_h2": {type: Number, default: 0},
    "amount_total": {type: Number, default: 0},
    "ticket_jira": {type: String },
    "state": {type: String },
    "currentStage": {type: String },

    "hito1": {
        status: String,
        label: String,
        amount: Number,
        validated: Boolean,
        owner: String,
        owner_email: String,
        updatedAt: Date,
        note: String
    },

    "hito2": {
        status: String,
        label: String,
        amount: Number,
        validated: Boolean,
        owner: String,
        owner_email: String,
        updatedAt: Date,
        note: String
    },

    // archivo vigente (metadata)
    "file": {
        originalName: String,
        filename: String,
        path: String,
        size: Number,
        mimetype: String,
        uploadedAt: Date
    },

    "file_h2": {
        originalName: String,
        filename: String,
        path: String,
        size: Number,
        mimetype: String,
        uploadedAt: Date
    },

    "comments": {type: Array, default: []},
    
}, { timestamps: true });

const payment = (conn) => conn.model('PAYMENTS', payments, 'payments')

module.exports = payment