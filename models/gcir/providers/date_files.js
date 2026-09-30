var mongoose = require('mongoose');
//const db = require('../../../db/pool');
//var gcir = db.gcir();

const Schema = mongoose.Schema;

const date_files = new Schema({
    name_file: {type: String },
    specification: {type: String },
    type_file: {type: String },
    date_file: {type: Array },
    week: {type: String }
});
const date_file = (conn) => conn.model('DATE_FILES', date_files, 'date_files')

module.exports = date_file
//module.exports = gcir.model('DATE_FILES', date_files, 'date_files');