var mongoose = require('mongoose');

//const db = require('../../../db/pool');
//var gcirDB = db.gcir();

const Schema = mongoose.Schema;

const userModel = new Schema({
    user: { type: String },
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

//module.exports = gcirDB.model('USERS', userModel, 'users');

const users = (conn) => conn.model('USERS', userModel, 'users')

module.exports = users