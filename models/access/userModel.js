var mongoose = require('mongoose');


const Schema = mongoose.Schema;

const userAccessModel = new Schema({
    user: { type: String },
    name: { type: String },
    email: { type: String },
    department: { type: String },
    description: { type: String },
    title: { type: String },
    scope: [{
        platform:{ type: String },
        menu: Number,
        status: Number
    }],
    requestDescription: { type: String },
    status: { type: String, default: 'PENDING'},
    superuser: {type: String,  default: ''},
    date: {
        type: Date,
        default: Date.now()
    },
    factibilidad: {type: String,  default: 'X'},
    level: {type: Number,  default: 7},
    manager: {type: String,  default: 'planner'},
    groups: [{
        id: Number,
        name: String
    }],
    groupsManager: [Number],
    deviceID: String,
    phone: String,
    mac: String
});

// module.exports = plannerTX.model('ACCESO', userAccessModel,'ACCESOS');


const acceso = (conn) => conn.model('ACCESO', userAccessModel, 'ACCESOS')
module.exports = acceso