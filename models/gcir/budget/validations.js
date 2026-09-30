var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const validations = new Schema({
    "code": {type: String},
    "name": {type: String },
    "requester": {type: String },
    "requester_email": {type: String },

    "assigned_to": {type: String },
    "assigned_to_email": {type: String },

    "estado": {type: String },

    "comments": {type: Array, default: []},
    
}, { timestamps: true });

const validation = (conn) => conn.model('VALIDATIONS', validations, 'validations')

module.exports = validation