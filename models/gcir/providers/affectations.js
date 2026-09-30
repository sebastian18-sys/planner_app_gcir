var mongoose = require('mongoose');

//const db = require('../../../db/pool');
//var gcir = db.gcir();

const Schema = mongoose.Schema;

/**
 * DICCTIONARY:
 * id: Identificación de la afectación que es reconocida por los colaboradores que tienen contacto con esta información (distinta a _id)
 * activity_name: Nombre de la actividad que se realiza en la afectación
 * executor: Persona encargada de ejecutar la afectación (Puede ser responsable de Entel)
 * risk: Riesgo que puede presentarse en la afectación
 * date: Fecha en la cual se realiza la afectación
 * scheduled_affectation: Hora en la cual se ha programado la afectación (Puede no tener)
 * real_affectation: Hora real en la que se realiza la afectación
 * duration_time: Duración de la afectación
 * nes_affected: NE's afectadas
 * ticket_noc: Ticket NOC
 * week: Semana en la que se realiza la afectación
 * investigation: Investigación elaborada en la afectación
 * source: Fuente de la afectación
 * classification: Clasificacion de la afectación
 * provider: Proveedor al que pertenece la afectación
 * project: Proyecto al que pertence la afectación
 * area: Area de la Gerencia al cual pertenece la afectación
 * year: Año al cual pertenece la afectación
 * **/

const affectations = new Schema({
    id: {type: String },
    activity_name: {type: String },
    executor: {type: String },
    risk: {type: String },
    date: {type: String },
    scheduled_affectation: {type: String },
    real_affectation: {type: String },
    duration_time: {type: String },
    nes_affected: {type: String },
    ticket_noc: {type: String },
    week: {type: String },
    investigation: {type: String },
    source: {type: String },
    classification: {type: String },
    provider: {type: String },
    project: {type: String },
    area: {type: String },
    year: {type: String}
});
const affectation = (conn) => conn.model('AFFECTATION', affectations, 'affectations')

module.exports = affectation
//module.exports = gcir.model('AFFECTATION', affectations, 'affectations');