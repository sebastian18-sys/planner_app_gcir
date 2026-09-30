var mongoose = require('mongoose');
//const db = require('../../../db/pool');
//var gcir = db.gcir();

//SNC: DESCARGO AFECTACIÓN DE SERVICIO/NO CONFORMIDAD

const Schema = mongoose.Schema;
let date = new Date();

const snc = new Schema({
    id_snc: {type: Number},
    name_responsable: {type: String},
    area_responsable: {type: String},
    email_responsable: {type: String},
    provider_responsable: {type: String},
    business_name: {type: String},
    job_type: {type: String},
    associated_site: {type: String},
    associated_project: {type: String},
    associated_mop: {type: String},
    observations: {type: String},
    detection_moment: {type: String},
    service_contract: {type: String},
    area_contract: {type: String},
    id_penalty: {type: String},
    breach_contract: {type: String},
    penalty_contract: {type: String},
    number_of_services: {type: Number},
    time_value: {type: Number},
    time_select: {type: String},
    penalty_percentage: {type: String},
    service_amount: {type: String},
    amount: {type: String},
    state: {type: String},
    last_date_state: {type: Date},
    data_files_entel: {type: Array},
    data_files_reference: {type: Array},
    data_files_evidence: {type: Array},
    activity_name: {type: String},
    detection_date: {type: String},
    description: {type: String},
    start_date: {type: String},
    end_date: {type: String},
    start_hour: {type: String},
    end_hour: {type: String},
    scheduled_affectation: {type: String},
    causes: {type: String},
    corrective_actions: {type: String},
    ca_date: {type: String},
    preventive_actions: {type: String},
    pa_date: {type: String},
    tracing_provider: {type: String}, //Seguimiento Proveedor
    tracing_entel: {type: String}, //Seguimiento Entel
    creation_date: {type: String},
    close_date: {type: String},
    email_providers: {type: Array},
    comments: {type: Array, default: []},
    is_attributable: {type: Boolean},
    year: {type: Number, default: date.getFullYear()},
    //Nuevos Campos
    antecedentes: {type: String},
    sites_affected: {type: String},
    description_affected: {type: String},
    affectedServices_Infra_Equip: {type: String},
    subcontrating_Company: {type: String},
    provider_position: {type: String},
    name_incident: {type: String},
    dni_incident: {type: String},
    category: {type: String},
    //Nuevos
    number_rq: {type: String},
    number_line_rq: {type: String}
});
const sncx= (conn) => conn.model('SNC', snc, 'snc')

module.exports = sncx
//module.exports = gcir.model('SNC', snc, 'snc');