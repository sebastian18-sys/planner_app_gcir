var mongoose = require('mongoose');
//const db = require('../../../db/pool');
//var gcir = db.gcir();

const Schema = mongoose.Schema;

const performance = new Schema({
    area: {type: String},
    provider: {type: String},
    type_provider: {type: String},
    january: {type: String},
    february: {type: String},
    march: {type: String},
    april: {type: String},
    may: {type: String},
    june: {type: String},
    july: {type: String},
    august: {type: String},
    september: {type: String},
    october: {type: String},
    november: {type: String},
    december: {type: String},
    year: {type: String}
});
const performanc= (conn) => conn.model('PERFORMANCE', performance, 'performance')

module.exports = performanc
//module.exports = gcir.model('PERFORMANCE', performance, 'performance');