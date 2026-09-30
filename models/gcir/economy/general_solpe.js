var mongoose = require('mongoose');
//const db = require('../../../db/pool');
//var gcir = db.gcir();

const Schema = mongoose.Schema;

/* DICCIONARIO DE CAMPOS:
 *
 *
 *
 *
 */

const economy_solpe = new Schema({
    item: {type: Number},
    type: {type: String},
    project_manager: {type: String},
    gcir_sponsor: {type: String},
    investment_responsable: {type: String},
    number: {type: String},
    year: {type: String},
    project: {type: String},
    investment_name: {type: String},
    concatenated: {type: String},
    investment_id: {type: Number},
    plan_amount: {type: Number},
    solpe_amount: {type: Number},
    sc_aya_pen: {type: Number},
    sc_aya_usd: {type: Number},
    sc_aya_total_pen: {type: Number},
    sc_nodos_pen: {type: Number},
    sc_nodos_usd: {type: Number},
    sc_nodos_total_pen: {type: Number},
    sc_tx_pen: {type: Number},
    sc_tx_usd: {type: Number},
    sc_tx_total_pen: {type: Number},
    sc_ooccee_pen: {type: Number},
    sc_ooccee_usd: {type: Number},
    sc_ooccee_total_pen: {type: Number},
    amount_sc_pen: {type: Number},
    amount_sc_usd: {type: Number},
    total_amount_sc_pen: {type: Number},
    pending_total_sc_pen: {type: Number},
    close_solpe: {type: Number},
    total_amount_oc: {type: Number},
    aya_record_pen: {type: Number},
    nodos_record_pen: {type: Number},
    tx_record_pen: {type: Number},
    ooccee_record_pen: {type: Number},
    total_amount_records: {type: Number},
    aya_saving: {type: Number},
    nodos_saving: {type: Number},
    tx_saving: {type: Number},
    ooccee_saving: {type: Number},
    saving_amount_pen: {type: Number},
    saving_record_amount_pen: {type: Number},
    forecast_cdg_2020: {type: Number},
    forecast_cdg_cf: {type: Number},
    forecast_january: {type: Number},
    forecast_february: {type: Number},
    forecast_march: {type: Number},
    forecast_april: {type: Number},
    forecast_may: {type: Number},
    forecast_june: {type: Number},
    forecast_july: {type: Number},
    forecast_august: {type: Number},
    forecast_september: {type: Number},
    forecast_october: {type: Number},
    forecast_november: {type: Number},
    forecast_december: {type: Number},
    total_forecast: {type: Number},
    forecast_cf_january_2021: {type: Number},
    forecast_cf_february_2022: {type: Number},
    forecast_cf_march_2023: {type: Number},
    forecast_cf_april_2024: {type: Number},
    total_forecast_cf_2021: {type: Number},
    pending_forecast_sc: {type: Number},
    pending_forecast_solpe: {type: Number},
    record_amount_january: {type: String},
    record_amount_february: {type: String},
    record_amount_march: {type: String},
    record_amount_april: {type: String},
    record_amount_may: {type: String},
    record_amount_june: {type: String},
    record_amount_july: {type: String},
    record_amount_august: {type: String},
    record_amount_september: {type: String},
    record_amount_october: {type: String},
    record_amount_november: {type: String},
    record_amount_december: {type: String},
});

//module.exports = gcir.model('ECONOMY_SOLPE', economy_solpe, 'economy_solpe');

const economy = (conn) => conn.model('ECONOMY_SOLPE', economy_solpe, 'economy_solpe')

module.exports = economy