var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const usuarioSchema = new Schema({
    usuario: String,
    nombre: String,
    email: String,
    empresa: String,
    lider: Number,
    registro: {mac: String, date: Number},
    scope: [{
        platform:{ type: String },
        menu: Number,
        status: Number
    }]
});

// module.exports = mongoose.model('USUARIOEXTERNO', usuarioSchema,'USUARIOSEXTERNOS');


const usuario = (conn) => conn.model('USUARIOEXTERNO', usuarioSchema, 'USUARIOEXTERNO')
module.exports = usuario