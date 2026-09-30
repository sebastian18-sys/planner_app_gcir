var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const settlements = new Schema({
    "code": {type: String, unique: true},
    "name": {type: String },
    "requester": {type: String },
    "requester_email": {type: String },

    "count": {type: Number, default: 0},
    "amount": {type: Number, default: 0},

    "estado": {type: String },
    "proveedor": {type: String },

    "assigned_to": { type: String },
    "assigned_to_email": { type: String },

    // archivo vigente (metadata)
    "file": {
        originalName: String,
        filename: String,
        path: String,
        size: Number,
        mimetype: String,
        uploadedAt: Date
    },

    "comments": {type: Array, default: []},
    
}, { timestamps: true });

const settlement = (conn) => conn.model('SETTLEMENTS', settlements, 'settlements')

module.exports = settlement