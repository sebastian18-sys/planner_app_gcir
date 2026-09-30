var mongoose = require('mongoose');
//const db = require('../../../db/pool');
//var calidadDB = db.providers();

const Schema = mongoose.Schema;

const areas = new Schema({
    name: { type: String },
    color: String,
    providers: [{
        _id: false,
        id: String,
        provider: String
    }]
});
const area = (conn) => conn.model('AREA', areas, 'AREAS')

module.exports = area
//module.exports = calidadDB.model('AREA', areas, 'AREAS');