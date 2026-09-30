var mongoose = require('mongoose');
//const db = require('../../../db/pool');
//var gcir = db.gcir();

const Schema = mongoose.Schema;

const sst = new Schema({
    provider: {type: String },
    accident_rate: {type: String },
    auditory: {type: String }

});
const sstx  = (conn) => conn.model('SST', sst, 'sst')

module.exports = sstx
//module.exports = gcir.model('SST', sst, 'sst');