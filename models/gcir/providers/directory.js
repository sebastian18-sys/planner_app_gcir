var mongoose = require('mongoose');

//const db = require('../../../db/pool');
//var gcir = db.gcir();

const Schema = mongoose.Schema;

const directory = new Schema({
    ruc: {type: String },
    business_name: {type: String },
    business_short: {type: String },
    user: {type: String },
    first_name: {type: String },
    last_name: {type: String },
    title: {type: String },
    phone: {type: String },
    email: {type: String },
    password: {type: String },
    passwordLastUpdated: {type: Date },
    responsible: {type: Boolean },
    // New fields to validate update and delete from users external
    pendingApproval: {type: Boolean },
    eventApproval: {type: String },
    emailRequesting: {type: String },
    newData: {},
    views: {type: String }
});

// directory.method('toJSON', function(){
//     const {password,user, ...object} =this.toObject();
//     return object
// })

const director = (conn) => conn.model('DIRECTORY', directory, 'directory')

module.exports = director
//module.exports = gcir.model('DIRECTORY', directory, 'directory');