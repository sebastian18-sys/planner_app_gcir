var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const counters = new Schema({
    
    _id: {type: String},
    seq: {type: Number, default: 0}
    
}, { timestamps: true });

const counter = (conn) => conn.model('COUNTERS', counters, 'counters')

module.exports = counter