var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const usuarioSchema = new Schema({
    usuario: String,
    nombre: String,
    email: String,
    gerencia: String,
    cargo: String,
    tipo: String,
    permisos: String,
    menu:[Schema.Types.Mixed]
});

// module.exports = mongoose.model('USUARIO', usuarioSchema,'USUARIOS');

const usuarios = (conn) => conn.model('USUARIO', usuarioSchema, 'USUARIOS')
module.exports = usuarios