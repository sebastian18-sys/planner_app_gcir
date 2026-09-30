var mongoose = require('mongoose');
//const db = require('../../../db/pool');
//var gcir = db.gcir();

const Schema = mongoose.Schema;

/* DICCIONARIO DE CAMPOS:
 * leadership: Nombre de jefaturas de la GCIR
 * project: Nombre de proyecto
 * investment_line: Línea de Inversión
 * solpe_number: Número de Solpe
 * investment_number: Número de Inversión
 * project_year: Año del proyecto
 * purchase_request: Solicitud de Compra (SC)
 * generation_date: Fecha de Generación de la SC
 * week_generation_date: Número de Semana de generación de SC
 * rq: TODO (Missing information)
 * approval_date_rq: Fecha de aprobación con RQ
 * purchase_order: Orden de Compra (OC)
 * shipping_date: Fecha de envío de Orden de Compra (OC)
 * week_purchase_order: Semana de Fecha de Compra (OC)
 * site: Código del Sitio
 * coordinator_name: Nombre del Coordinador Solicitante
 * agreement_number: Número de Acuerdo
 * provider: Proveedor o Contrata
 * coin: Tipo de Moneda
 * purchase_request_amount: Monto de Solicitud de Compra
 * conformity_amount: Monto de Acta de Conformidad
 * conformity_liquidation: Liquidacion de Conformidad
 * entry_system_date: Fecha de Ingreso al Sistema (C.D.G.)
 * week_pay: Semana que se hizo pago
 * record_number: Número de acta (No se considero los demás campos similares)
 * ...
 * The explanation of next fields it's on the documentation of this platform.
 */

const economy_general = new Schema({
    /*** GENERAL DATA (DATOS GENERALES) ***/
    leadership: {type: String},
    project_year: {type: Number},
    solpe_number: {type: String},
    project: {type: String},
    investment_line: {type: String},
    investment_number: {type: Number},

    /*** PURCHASE REQUEST (SOLICITUD DE COMPRA) ***/
    purchase_request: {type: String},
    generation_date: {type: String},
    week_generation_date: {type: String},
    provider: {type: String},
    agreement_number: {type: String},
    site: {type: String},
    coin: {type: String},
    purchase_request_amount: {type: Number},

    /*** RQ ***/
    rq: {type: String},
    approval_date_rq: {type: String},

    /*** PURCHASE ORDER (ORDEN DE COMPRA) ***/
    purchase_order: {type: Number},
    shipping_date: {type: String},
    week_purchase_order: {type: String},

    /*** DATA PER SITE (DATOS POR SITIO) ***/
    /*** PAYMENTS (PAGO) ***/
    certificates_of_conformity: {type: Array},
    /*
    "certificates_of_conformity" is an array that will contain the objects in the following format:
    obj = {
        conformity_amount: {type: Number},
        conformity_liquidation: {type: Number},
        entry_system_date: {type: String},
        week_pay: {type: String}
    }
    */

    /*** OTHER HELPFUL FIELDS ***/
    record_number: {type: String},
    liquidation_closing: {type: String},
    total_paid_coin: {type: Number},
    total_paid_soles: {type: Number},
    total_pending_soles: {type: Number},
    total_pending_coin: {type: Number},
    total_payed_oc: {type: Number},
    total_payed_sc: {type: Number},
    percentage_total_payed_oc: {type: Number},
    state_oc_per_line: {type: String},
    state_oc: {type: String},
    close_date_oc: {type: String},
    week_close_oc: {type: String},

    /*** SAVING (AHORRO) ***/
    saving: {type: Array},
    /*
    "saving" is an array that will contain the objects in the following format:
    obj = {
        total_saving_coin: {type: Number},
        total_saving_soles: {type: Number},
        saving_date: {type: String}
    }
    */

    oc_validation: {type: String},

    /*** FORECAST ***/
    forecast: {type: Array},
    /*
    "forecast" is an array that will contain the objects in the following format:
    obj = {
        year: {type: Number},
        month: {type: Number},
        payment: {type: Number}
    }
    */

    coordinator_name: {type: String}
});

//module.exports = gcir.model('ECONOMY_GENERAL', economy_general, 'economy_general');

const economys = (conn) => conn.model('ECONOMY_GENERAL', economy_general, 'economy_general')

module.exports = economys