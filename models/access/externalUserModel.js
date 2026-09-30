var mongoose = require('mongoose');


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
    date: Number,
    quota: {date:Number,consumed:Number,total:Number},
    attempts: [{_id:false,ip:String,mac:String,resource:String,date:Number}],
    machineID: String,
    hostname: String,
    nics: [{_id:false,key:String,mac:String}],
    ip: String,
    status: String,
    scope: [{
        platform:{ type: String },
        menu: Number,
        status: Number
    }]
});

// module.exports = planner.model("EXTUSER", usuarioSchema, 'EXTUSERS');


const extuser = (conn) => conn.model('EXTUSER', usuarioSchema, 'EXTUSERS')
module.exports = extuser