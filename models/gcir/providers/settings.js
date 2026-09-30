var mongoose = require('mongoose');

const Schema = mongoose.Schema;

const settings = new Schema({
    general_settings: {},
    directory_settings: {},
    contracts_settings: {},
    homologations_settings: {},
    library_settings: {}
});
const setting = (conn) => conn.model('SETTINGS', settings, 'settings')

module.exports = setting