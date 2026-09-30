var mongoose = require('mongoose');

//const db = require('../../../db/pool');
//var planner = db.plannerTX();

const Schema = mongoose.Schema;

const usuarioSchema = new Schema({
    user: String,
    pass: String,
    jwt: String,
    name: String,
    email: String,
    enterprise: String,
    department: String,
    description: String,
    title: String,
    leader: Number,
    mac: String,
    host: String,
    date: Number,
    quota: {date:Number,consumed:Number,total:Number},
    attempts: [{_id:false,ip:String,mac:String,resource:String,date:Number}],
    status: String,
    scope: [{
        platform:{ type: String },
        menu: Number,
        status: Number
    }]
});

//module.exports = planner.model("EXTUSER", usuarioSchema, 'EXTUSERS');

const usuarios = (conn) => conn.model('EXTUSER', usuarioSchema, 'EXTUSERS')

module.exports = usuarios
