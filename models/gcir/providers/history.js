var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const history = new Schema({
    original_data: {},
    date_change: {type: String},
    user_change: {type: String},
    event_change: {type: String},
    document: {type: String}
});
const histor = (conn) => conn.model('HISTORY', history, 'history')

module.exports = histor