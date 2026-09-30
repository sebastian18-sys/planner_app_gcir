var mongoose = require('mongoose');
//const db = require('../../../db/pool');
//var gcir = db.gcir();

const Schema = mongoose.Schema;

const sac_files = new Schema({
    name_file: {type: String },
    specification: {type: String },
    type_file: {type: String },
    date_file: {type: Array }
});
const sac_file= (conn) => conn.model('SAC_FILES', sac_files, 'sac_files')

module.exports = sac_file
//module.exports = gcir.model('SAC_FILES', sac_files, 'sac_files');