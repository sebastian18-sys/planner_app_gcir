var mongoose = require('mongoose');

//const db = require('../../../db/pool');
//var gcirDB = db.gcirDB();

const Schema = mongoose.Schema;

const areaModel = new Schema({
    provider: { type: String },
    firstName: { type: String },
    lastName: String,
    email: String,
    department: { type: String },
    description: { type: String },
    title: { type: String },
    enterprise: String,
    status: { type: String, default: 'PENDING'},
    scope: [{
        id: Number,
        status: Number,
        action: String,
        route: String
    }],
    level: {type: Number,  default: 7},
    requestDescription: String,
    superuser: {type: String,  default: 'admin'},
    date: Number,
    phone: String
});

//module.exports = gcirDB.model('USERS', userModel, 'USERS');

const areas = (conn) => conn.model('USERS', areaModel, 'USERS')

module.exports = areas