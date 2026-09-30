const express = require('express');
const db = require('../../../db');
const path = require('path');
const fs = require('fs');
const { ObjectId } = require("mongodb");
const archiver = require("archiver");
const jiraClient = require('../../../utils/jiraClient');

const XLSX = require('xlsx');
const uploadTicketExcel = require('../../../utils/upload-file');
const { sendEmail, generateTicketCreatedHtml, generateTicketStateChangedHtml } = require('../../../utils/send-email');
const { attachLineaOC } = require('../../../utils/helper-budget');
const { attachRQLineaOC } = require('../../../utils/helper-budget-2');
require("dotenv").config();

const managerRouter = express.Router();

const KEY_CR = {
    "RQ": "rq",
    "Nro OC": "nro_oc",
    "Nro Línea OC": "nro_linea",
    "Estado OC": "estado_oc",
    "Fecha Emisión RQ": "fecha_emision_rq",
    "Fecha Aprobación RQ": "fecha_aprobacion_rq",
    "Fecha Emisión OC": "fecha_emision_oc",
    "Fecha Aprobación OC": "fecha_aprobacion_oc",
    'Descripción de RQ': 'descripcion_rq',
    "Descripción OC": "descripcion_oc",
    "Descripción Adicional": "descripcion_adicional",
    "Código Recepción": "codigo_recepcion",
    "Fecha Recepción": "fecha_recepcion",
    "Código Proyecto": "codigo_proyecto",
    "Nombre Proyecto": "nombre_proyecto",
    "Inversión/SubRubro": "inversion_subrubro",
    "PM ACTUAL": "pm_actual",
    "Gerencia Sponsor Final": "gerencia_sponsor_final",
    "Acuerdo": "acuerdo",
    "Proveedor": "proveedor",
    "Requisitor": "requisitor",
    "Gerencia Requisitor": "gerencia_requisitor",
    "Gerencia Sponsor": "gerencia_sponsor",
    "Importe OC": "importe_oc",
    "Importe AC": "importe_ac",
    "Importe Facturado": "importe_facturado",
    "Importe RQ": "importe_rq"
}

const entriesCR = Object.entries(KEY_CR);

const API_TO_DB_CR = Object.fromEntries(
    entriesCR.map(([dbKey, apiKey]) => [apiKey, dbKey])
);

// Proyección solo de los campos que te interesan
const projectStageCR = entriesCR.reduce((acc, [oldK, newK]) => {
    acc[newK] = { $getField: { field: oldK, input: "$$ROOT" } };
    return acc;
}, { _id: 0 });

// HELPERS
const DAY_MS = 1000 * 60 * 60 * 24;

function num(value) {
    if (value == null || value === "") return 0;

    if (typeof value === "number") {
        return Number.isFinite(value) ? value : 0;
    }

    const n = Number(
        String(value)
            .replace(/,/g, "")
            .trim()
    );

    return Number.isFinite(n) ? n : 0;
}

function round1(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
}

function toMM(value) {
    return round1(num(value) / 1_000_000);
}

function hasValue(value) {
    return (
        value !== null &&
        value !== undefined &&
        value !== "" &&
        value !== 0 &&
        value !== "0"
    );
}

function hasOC(item) {
    return hasValue(item.oc);
}

function hasRQ(item) {
    return hasValue(item.rq);
}

function hasCR(item) {
    return hasValue(item.cr);
}

function getCRList(item) {
    return Array.isArray(item.cr_list)
        ? item.cr_list.filter(hasValue)
        : [];
}

function parseDateSafe(value) {
    if (!value) return null;

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? null
        : date;
}

function startOfDayUTC(date) {
    return new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
    ));
}

function businessDaysDiff(fromDate, toDate, holidays = new Set()) {

    const start = startOfDayUTC(fromDate);
    const end = startOfDayUTC(toDate);

    if (end < start) return null;

    if (end.getTime() === start.getTime()) {
        return 0;
    }

    let businessDays = 0;

    const current = new Date(start);

    /*
     * No contamos el día inicial.
     * Sí contamos el día final si es hábil.
     */
    while (current < end) {

        current.setUTCDate(
            current.getUTCDate() + 1
        );

        const day = current.getUTCDay();

        const isWeekend =
            day === 0 || // domingo
            day === 6;   // sábado

        const dateKey =
            current
                .toISOString()
                .slice(0, 10);

        const isHoliday =
            holidays.has(dateKey);

        if (!isWeekend && !isHoliday) {
            businessDays += 1;
        }
    }

    return businessDays;
}

function dateDiffDays(from, to) {
    const start = parseDateSafe(from);
    const end = parseDateSafe(to);

    if (!start || !end) return null;

    const diff = Math.floor(
        (end.getTime() - start.getTime()) / DAY_MS
    );

    return diff >= 0 ? diff : null;
}

function uniqueCount(items, getKey) {
    const keys = new Set();

    for (const item of items) {
        const key = getKey(item);

        if (key) keys.add(String(key));
    }

    return keys.size;
}

function sum(items, getValue) {
    return items.reduce(
        (total, item) => total + num(getValue(item)),
        0
    );
}

function amountMetric(amount) {
    return {
        amount,
        amountMM: toMM(amount),
    };
}

// DATES
function startOfISOWeekUTC(input = new Date()) {
    const date = new Date(Date.UTC(
        input.getUTCFullYear(),
        input.getUTCMonth(),
        input.getUTCDate()
    ));

    const day = date.getUTCDay() || 7;

    date.setUTCDate(
        date.getUTCDate() - day + 1
    );

    date.setUTCHours(0, 0, 0, 0);

    return date;
}

function getWeekKey(date) {
    return startOfISOWeekUTC(date).toISOString().slice(0, 10);
}

function addWeeksUTC(date, weeks) {
    const result = new Date(date);

    result.setUTCDate(
        result.getUTCDate() + weeks * 7
    );

    return result;
}

function getISOWeekInfo(input) {
    const date = new Date(Date.UTC(
        input.getUTCFullYear(),
        input.getUTCMonth(),
        input.getUTCDate()
    ));

    const day = date.getUTCDay() || 7;

    date.setUTCDate(
        date.getUTCDate() + 4 - day
    );

    const year = date.getUTCFullYear();

    const yearStart = new Date(
        Date.UTC(year, 0, 1)
    );

    const week = Math.ceil(
        (((date - yearStart) / DAY_MS) + 1) / 7
    );

    return {
        year,
        week
    };
}

function weekDateKey(date) {
    return startOfISOWeekUTC(date)
        .toISOString()
        .slice(0, 10);
}

function toNumberSafe(value) {
    if (value == null || value === "") return 0;

    if (typeof value === "number") {
        return Number.isFinite(value) ? value : 0;
    }

    const normalized = String(value)
        .trim()
        .replace(/\s/g, "")
        .replace(/,/g, "");

    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
}

function getMonthInfoFromWeek(weekStart) {
    // Jueves de la semana ISO
    const ref = new Date(weekStart);

    ref.setUTCDate(
        ref.getUTCDate() + 3
    );

    const monthLabel = new Intl.DateTimeFormat(
        "es-PE",
        {
            month: "short",
            timeZone: "UTC"
        }
    )
        .format(ref)
        .replace(".", "")
        .replace(
            /^./,
            (c) => c.toUpperCase()
        );

    return {
        monthKey:
            `${ref.getUTCFullYear()}-${String(
                ref.getUTCMonth() + 1
            ).padStart(2, "0")}`,

        monthLabel,
        monthNumber:
            ref.getUTCMonth() + 1,

        monthYear:
            ref.getUTCFullYear()
    };
}

function createWeeklyBuckets(
    weeks = 7,
    now = new Date()
) {
    const currentWeek =
        startOfISOWeekUTC(now);

    const firstWeek =
        addWeeksUTC(
            currentWeek,
            -(weeks - 1)
        );

    const map = new Map();

    for (let i = 0; i < weeks; i++) {
        const weekStart =
            addWeeksUTC(firstWeek, i);

        const { year, week } =
            getISOWeekInfo(weekStart);

        const month =
            getMonthInfoFromWeek(weekStart);

        map.set(
            weekDateKey(weekStart),
            {
                key:
                    `${year}-W${String(week).padStart(2, "0")}`,

                weekLabel:
                    `W${String(week).padStart(2, "0")}`,

                year,
                weekNumber: week,
                weekStart,

                ...month,

                isCurrentWeek:
                    weekDateKey(weekStart) ===
                    weekDateKey(currentWeek),

                rqAmount: 0,
                ocAmount: 0,
                paymentAmount: 0,

                rqCount: 0,
                ocCount: 0,
                paymentCount: 0
            }
        );
    }

    return {
        map,
        firstWeek,
        rangeEnd:
            addWeeksUTC(currentWeek, 1)
    };
}


// ==========================
// KPIS
// ==========================

let totalOCAmount = 0
let ocSinPagoAmount = 0
let recepAmount = 0

function buildMainKPIs(items) {

    // INGRESADOS
    const ingresadosAmount = sum(items,(x) => x.total_cotizacion);

    const ingresadosCount =
        uniqueCount(
            items,
            (x) =>
                x.ticket_code && x.nro
                    ? `${x.ticket_code}|${x.nro}`
                    : null
        );

    // RQ
    const rqItems = items.filter(hasRQ);

    const rqAmount = sum(rqItems, (x) => x.total_cotizacion);

    const rqCount =
        uniqueCount(
            rqItems,
            // (x) => x.rq
            (x) =>
                x.ticket_code && x.nro
                    ? `${x.ticket_code}|${x.nro}`
                    : null
        );

    // OC
    const ocItems = items.filter(hasOC);

    const ocAmount = sum(ocItems,(x) => x.total_cotizacion);

    const ocCount =
        uniqueCount(
            ocItems,
            // (x) => x.oc
            (x) =>
                x.ticket_code && x.nro
                    ? `${x.ticket_code}|${x.nro}`
                    : null
        );

    // RECEPCIÓN
    const receptionItems =
        items.filter(
            (x) =>
                hasOC(x) &&
                x.cr_list.length > 0
        );

    const receptionAmount = sum(
        receptionItems,
        (x) => x.importe_ac
    );

    const receptionCount =
        uniqueCount(
            receptionItems,
            (x) =>
                `${x.oc}|${x.cr}`
        );

    const ocSinPagoItems =  
        items.filter(
            (x) => 
                hasOC(x) &&
                x.cr_list.length === 0
        );

    const ocSinPAmount = sum(ocSinPagoItems,(x) => x.total_cotizacion);

    totalOCAmount = ocAmount;
    ocSinPagoAmount = ocSinPAmount;
    recepAmount = receptionAmount;

    return {
        ingresados: {
            count: ingresadosCount,
            ...amountMetric(ingresadosAmount)
        },
        rq: {
            count: rqCount,
            ...amountMetric(rqAmount),
            pendingAmount:
                Math.max(
                    ingresadosAmount -
                    rqAmount,
                    0
                ),
            pendingAmountMM:
                toMM(
                    Math.max(
                        ingresadosAmount -
                        rqAmount,
                        0
                    )
                ),
            percentage:
                ingresadosAmount > 0
                    ? round1(
                        rqAmount /
                        ingresadosAmount *
                        100
                    )
                    : 0
        },
        oc: {
            count: ocCount,
            ...amountMetric(ocAmount),
            pendingAmount:
                Math.max(
                    rqAmount -
                    ocAmount,
                    0
                ),
            pendingAmountMM:
                toMM(
                    Math.max(
                        rqAmount -
                        ocAmount,
                        0
                    )
                ),
            percentage:
                rqAmount > 0
                    ? round1(
                        ocAmount /
                        rqAmount *
                        100
                    )
                    : 0
        },
        recepcion: {
            count: receptionCount,
            ...amountMetric(receptionAmount),
            pendingAmount:
                Math.max(
                    ocAmount -
                    receptionAmount,
                    0
                ),
            pendingAmountMM:
                toMM(
                    Math.max(
                        ocAmount -
                        receptionAmount,
                        0
                    )
                ),
            percentage:
                ocAmount > 0
                    ? round1(
                        receptionAmount /
                        ocAmount *
                        100
                    )
                    : 0
        }
    };
}

// ==========================
// ESTADO ACTUAL
// ==========================
function buildStateMetric(items) {
    const amount = sum(
        items,
        (x) => x.total_cotizacion
    );

    return {
        count: uniqueCount(
            items,
            (x) =>
                x.ticket_code && x.nro
                    ? `${x.ticket_code}|${x.nro}`
                    : null
        ),

        ...amountMetric(amount)
    };
}

function buildCurrentState(items) {

    // console.log("items", items.length)

    // RQ
    const pendienteCT =
        items.filter(
            (x) =>
                x.estado === "Pendiente CT"
        );

    const observado =
        items.filter(
            (x) =>
                x.estado === "Observado"
        );

    const pendienteRQ =
        items.filter(
            (x) =>
                x.estado === "Enviado a MG"
        );

    const pendienteOC =
        items.filter(
            (x) =>
                // x.estado === "RQ Generado" &&
                hasRQ(x) &&
                !hasOC(x)
        );

    // PAGO
    const paymentWorkflowStates =
        new Set([
            "Intención de Pago",
            "Intención de Pago - Hito 2",
            "Pago Enviado a MG",
            "Pago Enviado a MG - Hito 2"
        ]);

    /*
     * Pendiente recepcionar
     *
     * Hito 1:
     *   aún no tiene CR
     *
     * Hito 2:
     *   tiene exactamente 1 CR
     *   y queda monto_pago_pendiente
     */

    // RECEPCIÓN
    // const receptionItems =
    //     items.filter(
    //         (x) =>
    //             hasOC(x) &&
    //             x.cr_list.length > 0
    //     );

    // const receptionAmount = sum(
    //     receptionItems,
    //     (x) => x.importe_ac
    // );


    let pendingReceptionAmount = 0;
    let pendingHito1 = 0;
    let pendingHito2 = 0;

    for (const item of items) {

        // SIN PAGOS    //28.3
        // const ocSinPagoItems =  
        //     items.filter(
        //         (x) => 
        //             hasOC(x) &&
        //             x.cr_list.length === 0
        //     );

        // const ocSinPagoAmount = sum(ocSinPagoItems,(x) => x.total_cotizacion);

        // // OC AMOUNT    67mm
        // const ocItems = items.filter(hasOC);
        // const ocAmount = sum(ocItems,(x) => x.total_cotizacion);

        // // RECEPCION TOTAL 26.2MM
        // const receptionItems =
        //     items.filter(
        //         (x) =>
        //             hasOC(x) &&
        //             x.cr_list.length > 0
        //     );

        // const receptionAmount = sum(
        //     receptionItems,
        //     (x) => x.importe_ac
        // );


        pendingHito1 = ocSinPagoAmount; //
        pendingHito2 = (totalOCAmount - ocSinPagoAmount) - recepAmount;


        if (paymentWorkflowStates.has(item.estado)) continue;
        const crList = getCRList(item);

        // HITO 1
        if (
            // !hasCR(item) &&
            crList.length === 0 &&
            hasOC(item)
        ) {
            pendingReceptionAmount += num(item.total_cotizacion);   //29,498,405.88
            continue;
        }

        // HITO 2
        if (
            crList.length === 1 &&
            num(item.monto_pago_pendiente) > 0
        ) {
            pendingReceptionAmount += num(item.monto_pago_pendiente);   //14,192,984
        }
    }


    // Pendiente GCIR
    const pendingGCIRH1Items =
        items.filter(
            (x) =>
                x.cr_list.length === 0 &&
                (
                    x.estado === "Intención de Pago"
                )
        );

    const pendingGCIRH2Items =
        items.filter(
            (x) =>
                x.cr_list.length === 1 &&
                (
                    x.estado === "Intención de Pago - Hito 2"
                )
        );

    const pendingGCIRAmount =
        pendingGCIRH1Items.reduce(
            (total, item) => {

                if (item.estado === "Intención de Pago - Hito 2") {
                    return (total + num(item.monto_pago_pendiente));
                }

                return (
                    total + num(item.monto_pago)
                );
            },
            0
        );

    const pendingGCIRAmountH1 =
        pendingGCIRH1Items.reduce(
            (total, item) => {
                return (
                    total + num(item.monto_pago)
                );
            },
            0
        );

    const pendingGCIRAmountH2 =
        pendingGCIRH2Items.reduce(
            (total, item) => {
                return (
                    total + num(item.monto_pago_pendiente)
                );
            },
            0
        );

    // Pendiente MG
    const pendingMGH1Items =
        items.filter(
            (x) =>
                x.cr_list.length === 0 &&
                (
                    x.estado === "Pago Enviado a MG"
                )
        );

    const pendingMGH2Items =
        items.filter(
            (x) =>
                x.cr_list.length === 1 &&
                (
                    x.estado === "Pago Enviado a MG - Hito 2"
                )
        );

    const pendingMGAmount =
        pendingMGH1Items.reduce(
            (total, item) => {

                if (item.estado === "Pago Enviado a MG - Hito 2") {
                    return (
                        total + num(item.monto_pago_pendiente)
                    );
                }

                return (
                    total + num(item.monto_pago)
                );
            },
            0
        );

    const pendingMGAmountH1 =
        pendingMGH1Items.reduce(
            (total, item) => {
                return (
                    total + num(item.monto_pago)
                );
            },
            0
        );

    const pendingMGAmountH2 =
        pendingMGH2Items.reduce(
            (total, item) => {
                return (
                    total + num(item.monto_pago_pendiente)
                );
            },
            0
        );


    return {

        rq: {
            pendienteCT: buildStateMetric(pendienteCT),
            observado: buildStateMetric(observado),
            pendienteRQ: buildStateMetric(pendienteRQ),
            pendienteOC: buildStateMetric(pendienteOC)
        },

        pago: {
            pendienteRecepcionar: {
                ...amountMetric(pendingReceptionAmount),

            },
            pendienteRecepH1: {
                ...amountMetric(pendingHito1),
            },
            pendienteRecepH2: {
                ...amountMetric(pendingHito2),
            },

            pendienteGCIR: {
                count:
                    uniqueCount(
                        pendingGCIRH1Items,
                        (x) =>
                            hasOC(x)
                                ? x.oc
                                : null
                    ),
                ...amountMetric(pendingGCIRAmount)
            },

            pendienteGCIRH1: {
                count:
                    uniqueCount(
                        pendingGCIRH1Items,
                        (x) =>
                            hasOC(x)
                                ? x.oc
                                : null
                    ),
                ...amountMetric(pendingGCIRAmountH1)
            },

            pendienteGCIRH2: {
                count:
                    uniqueCount(
                        pendingGCIRH2Items,
                        (x) =>
                            hasOC(x)
                                ? x.oc
                                : null
                    ),
                ...amountMetric(pendingGCIRAmountH2)
            },

            pendienteMG: {
                count:
                    uniqueCount(
                        pendingMGH1Items,
                        (x) =>
                            hasOC(x)
                                ? x.oc
                                : null
                    ),
                ...amountMetric(pendingMGAmount)
            },

            pendienteMGH1: {
                count:
                    uniqueCount(
                        pendingMGH1Items,
                        (x) =>
                            hasOC(x)
                                ? x.oc
                                : null
                    ),
                ...amountMetric(pendingMGAmountH1)
            },

            pendienteMGH2: {
                count:
                    uniqueCount(
                        pendingMGH2Items,
                        (x) =>
                            hasOC(x)
                                ? x.oc
                                : null
                    ),
                ...amountMetric(pendingMGAmountH2)
            },
        }
    };
}

// ==========================
// LIQUIDACIONES
// ==========================
function buildSettlements(items) {

    /*
     * Universo pendiente de liquidar:
     *
     * - tiene exactamente un CR
     * - no tiene pago al 100%
     */

    const settlementBase =
        items.filter(
            (item) => {
                const crList = getCRList(item);
                return (
                    crList.length === 1 &&
                    num(item.cantidad_pago) !== 100
                    // num(item.liquidacion) <= 0
                );
            }
        );


    // Total por Pagar
    const totalToSettle = sum(settlementBase, (x) => x.monto_pago_pendiente);
    
    // Por procesar
    const liquidatedItems = settlementBase.filter((x) =>num(x.liquidacion) > 0);
    const liquidatedAmount = sum(liquidatedItems, (x) => x.monto_pago_pendiente);
    
    // Por liquidar
    const notLiquidatedItems = settlementBase.filter((x) =>num(x.liquidacion) === 0);
    const notLiquidatedAmount = sum(notLiquidatedItems, (x) => x.monto_pago_pendiente);

    // Enviado a MG
    const sendMgItems = liquidatedItems.filter((x) => x.estado === "Pago Enviado a MG - Hito 2");
    const sendMgAmount = sum(sendMgItems, (x) => x.monto_pago_pendiente);

    /*
     * Pagado:
     * segunda recepción/CR
     * y ya tiene liquidación.
     */

    const paidSettlementItems =
        items.filter(
            (item) =>
                getCRList(item).length > 1 &&
                num(item.liquidacion) > 0
        );

    const paidAmount = sum(paidSettlementItems, (x) => x.liquidacion);
    const pendingLiquidated = Math.max(totalToSettle - liquidatedAmount,0);
    const pendingPaid = Math.max(liquidatedAmount - paidAmount, 0);

    // =========================================
    // RESUMEN POR UNIDAD FUNCIONAL
    // =========================================

    const ufMap = new Map();

    function ensureUF(item) {
        const unidadFuncional =
            String(
                item.unidad_funcional ||
                "Sin Unidad Funcional"
            ).trim();

        if (!ufMap.has(unidadFuncional)) {
            ufMap.set(unidadFuncional, {
                unidad_funcional: unidadFuncional,

                totalAPagar: 0,
                pendienteLiquidar: 0,
                porProcesar: 0,
                enviadoMG: 0,
                liquidado: 0,
                pagado: 0,

                countTotalAPagar: 0,
                countPendienteLiquidar: 0,
                countPorProcesar: 0,
                countEnviadoMG: 0,
                countLiquidado: 0,
                countPagado: 0,
            });
        }

        return ufMap.get(unidadFuncional);
    }


    // =========================================
    // 1. TOTAL A PAGAR
    // settlementBase
    // monto_pago_pendiente
    // =========================================

    for (const item of settlementBase) {
        const uf = ensureUF(item);

        uf.totalAPagar +=
            num(item.monto_pago_pendiente);

        uf.countTotalAPagar += 1;
    }


    // =========================================
    // 2. PENDIENTE LIQUIDAR
    // liquidacion === 0
    // =========================================

    for (const item of notLiquidatedItems) {
        const uf = ensureUF(item);

        uf.pendienteLiquidar +=
            num(item.monto_pago_pendiente);

        uf.countPendienteLiquidar += 1;
    }


    // =========================================
    // 3. POR PROCESAR
    // liquidacion > 0
    // =========================================

    for (const item of liquidatedItems) {
        const uf = ensureUF(item);

        uf.porProcesar +=
            num(item.monto_pago_pendiente);

        /*
        * En tu lógica actual "liquidado"
        * utiliza exactamente el mismo universo.
        */
        uf.liquidado +=
            num(item.monto_pago_pendiente);

        uf.countPorProcesar += 1;
        uf.countLiquidado += 1;
    }


    // =========================================
    // 4. ENVIADO A MG
    // subset de liquidatedItems
    // =========================================

    for (const item of sendMgItems) {
        const uf = ensureUF(item);

        uf.enviadoMG +=
            num(item.monto_pago_pendiente);

        uf.countEnviadoMG += 1;
    }


    // =========================================
    // 5. PAGADO
    // Mantiene la misma lógica global
    // =========================================

    for (const item of paidSettlementItems) {
        const uf = ensureUF(item);

        uf.pagado +=
            num(item.liquidacion);

        uf.countPagado += 1;
    }


    // =========================================
    // FORMATO FINAL
    // =========================================

    const porUnidadFuncional = [...ufMap.values()]
        .map((uf) => {

            const pendingLiquidatedUF =
                Math.max(
                    uf.totalAPagar -
                    uf.liquidado,
                    0
                );

            const pendingPaidUF =
                Math.max(
                    uf.liquidado -
                    uf.pagado,
                    0
                );


            return {
                unidad_funcional: uf.unidad_funcional,

                // =========================
                // TOTAL A PAGAR
                // =========================
                totalAPagar: {
                    ...amountMetric(uf.totalAPagar),
                    count: uf.countTotalAPagar
                },


                // =========================
                // PENDIENTE LIQUIDAR
                // =========================

                pendienteLiquidar: {
                    ...amountMetric(uf.pendienteLiquidar),
                    count: uf.countPendienteLiquidar,
                    percentage:
                        uf.totalAPagar > 0
                            ? round1(
                                uf.pendienteLiquidar /
                                uf.totalAPagar *
                                100
                            )
                            : 0
                },
                // =========================
                // POR PROCESAR
                // =========================
                porProcesar: {
                    ...amountMetric(uf.porProcesar),
                    count: uf.countPorProcesar,
                    percentage:
                        uf.totalAPagar > 0
                            ? round1(
                                uf.porProcesar /
                                uf.totalAPagar *
                                100
                            )
                            : 0
                },
                // =========================
                // ENVIADO MG
                // =========================
                enviadoMG: {
                    ...amountMetric(uf.enviadoMG),
                    count: uf.countEnviadoMG,
                    percentage:
                        uf.totalAPagar > 0
                            ? round1(
                                uf.enviadoMG /
                                uf.totalAPagar *
                                100
                            )
                            : 0
                },
                // =========================
                // LIQUIDADO
                // =========================
                liquidado: {
                    ...amountMetric(uf.liquidado),
                    count: uf.countLiquidado,
                    pendingAmount: pendingLiquidatedUF,
                    pendingAmountMM: toMM(pendingLiquidatedUF),
                    percentage:
                        uf.totalAPagar > 0
                            ? round1(
                                uf.liquidado /
                                uf.totalAPagar *
                                100
                            )
                            : 0
                },
                // =========================
                // PAGADO
                // =========================
                pagado: {
                    ...amountMetric(uf.pagado),
                    count: uf.countPagado,
                    pendingAmount: pendingPaidUF,
                    pendingAmountMM: toMM(pendingPaidUF),
                    percentage:
                        uf.liquidado > 0
                            ? round1(
                                uf.pagado /
                                uf.liquidado *
                                100
                            )
                            : 0
                }
            };
        })

        // Mayor monto a pagar primero
        .sort(
            (a, b) =>
                b.totalAPagar.amount -
                a.totalAPagar.amount
        );


    return {

        totalAPagar: {
            ...amountMetric(totalToSettle)
        },

        pendienteLiquidar: {
            ...amountMetric(notLiquidatedAmount),
            percentage:
                totalToSettle > 0
                    ? round1(
                        notLiquidatedAmount /
                        totalToSettle *
                        100
                    )
                    : 0
        },

        porProcesar: {
            ...amountMetric(liquidatedAmount),
            percentage:
                totalToSettle > 0
                    ? round1(
                        liquidatedAmount /
                        totalToSettle *
                        100
                    )
                    : 0
        },

        enviadoMG: {
            ...amountMetric(sendMgAmount),
            percentage:
                totalToSettle > 0
                    ? round1(
                        sendMgAmount /
                        totalToSettle *
                        100
                    )
                    : 0
        },

        liquidado: {
            ...amountMetric(liquidatedAmount),
            pendingAmount: pendingLiquidated,
            pendingAmountMM: toMM(pendingLiquidated),
            percentage:
                totalToSettle > 0
                    ? round1(
                        liquidatedAmount /
                        totalToSettle *
                        100
                    )
                    : 0
        },

        pagado: {
            ...amountMetric(paidAmount),
            pendingAmount: pendingPaid,
            pendingAmountMM: toMM(pendingPaid),
            percentage:
                liquidatedAmount > 0
                    ? round1(
                        paidAmount /
                        liquidatedAmount *
                        100
                    )
                    : 0
        },
        // NUEVO
        porUnidadFuncional,
    };
}

// ==========================
// EVOLUCIÓN SEMAMAL
// ==========================
function buildWeeklyAmountTrend(
    items,
    {
        weeks = 7,
        includeCurrentWeek = true,
        now = new Date(),
    } = {}
) {
    const currentWeekStart = startOfISOWeekUTC(now);

    const lastWeekStart = includeCurrentWeek
        ? currentWeekStart
        : addWeeksUTC(currentWeekStart, -1);

    const firstWeekStart = addWeeksUTC(lastWeekStart, -(weeks - 1));
    const rangeEnd = addWeeksUTC(lastWeekStart, 1);

    const buckets = new Map();

    // Inicializar semanas
    for (let i = 0; i < weeks; i += 1) {
        const weekStart = addWeeksUTC(firstWeekStart, i);
        const weekKey = getWeekKey(weekStart);
        const { year, week } = getISOWeekInfo(weekStart);

        const {
            monthKey,
            monthLabel,
            monthNumber,
            monthYear,
        } = getMonthInfoFromWeek(weekStart);

        buckets.set(weekKey, {
            key: `${year}-W${String(week).padStart(2, "0")}`,
            weekLabel: `W${String(week).padStart(2, "0")}`,
            
            year,
            weekNumber: week,
            weekStart,

            monthKey,
            monthLabel,
            monthNumber,
            monthYear,

            rqAmount: 0,
            rqCount: 0,

            ocAmount: 0,
            ocCount: 0,

            paymentAmount: 0,
            paymentCount: 0,

            isCurrentWeek:
                includeCurrentWeek &&
                weekKey === getWeekKey(currentWeekStart),
        });
    }

    for (const item of items) {
        const fechaRQ = parseDateSafe(item.fecha_rq);
        const fechaOC = parseDateSafe(item.fecha_oc);
        const fechaRecepcion = parseDateSafe(item.fecha_recepcion);

        const totalCotizacion = toNumberSafe(item.total_cotizacion);
        const importeAC = toNumberSafe(item.importe_ac);

        // RQ -> usa total_cotizacion
        if (fechaRQ && fechaRQ >= firstWeekStart && fechaRQ < rangeEnd) {
            const bucket = buckets.get(getWeekKey(fechaRQ));
            if (bucket) {
                bucket.rqAmount += totalCotizacion;
                bucket.rqCount += 1;
            }
        }

        // OC -> usa total_cotizacion
        if (fechaOC && fechaOC >= firstWeekStart && fechaOC < rangeEnd) {
            const bucket = buckets.get(getWeekKey(fechaOC));
            if (bucket) {
                bucket.ocAmount += totalCotizacion;
                bucket.ocCount += 1;
            }
        }

        // Pago -> usa importe_ac
        if (
            fechaRecepcion &&
            fechaRecepcion >= firstWeekStart &&
            fechaRecepcion < rangeEnd
        ) {
            const bucket = buckets.get(getWeekKey(fechaRecepcion));
            if (bucket) {
                bucket.paymentAmount += importeAC;
                bucket.paymentCount += 1;
            }
        }
    }

    const weekly = [...buckets.values()].map((bucket) => ({
        key: bucket.key,
        weekLabel: bucket.weekLabel,
        year: bucket.year,
        weekNumber: bucket.weekNumber,
        weekStart: bucket.weekStart,
        isCurrentWeek: bucket.isCurrentWeek,

        monthKey: bucket.monthKey,
        monthLabel: bucket.monthLabel,
        monthNumber: bucket.monthNumber,
        monthYear: bucket.monthYear,

        // montos reales
        rqAmount: round1(bucket.rqAmount),
        ocAmount: round1(bucket.ocAmount),
        paymentAmount: round1(bucket.paymentAmount),

        // en MM para gráfico
        rqAmountMM: round1(toMM(bucket.rqAmount)),
        ocAmountMM: round1(toMM(bucket.ocAmount)),
        paymentAmountMM: round1(toMM(bucket.paymentAmount)),

        rqCount: bucket.rqCount,
        ocCount: bucket.ocCount,
        paymentCount: bucket.paymentCount,
    }));

    const avgWeeklyRQ = weekly.reduce((acc, row) => acc + row.rqAmount, 0) / weeks;
    const avgWeeklyOC = weekly.reduce((acc, row) => acc + row.ocAmount, 0) / weeks;
    const avgWeeklyPayment = weekly.reduce((acc, row) => acc + row.paymentAmount, 0) / weeks;

    return {
        weekly,
        summary: {
            averageWeeklyRQ: round1(avgWeeklyRQ),
            averageWeeklyRQMM: round1(toMM(avgWeeklyRQ)),

            averageWeeklyOC: round1(avgWeeklyOC),
            averageWeeklyOCMM: round1(toMM(avgWeeklyOC)),

            averageWeeklyPayment: round1(avgWeeklyPayment),
            averageWeeklyPaymentMM: round1(toMM(avgWeeklyPayment)),
        },
        metadata: {
            weeks,
            includeCurrentWeek,
            firstWeekStart,
            rangeEnd,
            generatedAt: now,
        },
    };
}

// ==========================
// Throughput semanal
// ==========================
function buildWeeklyThroughput(
    items,
    {
        weeks = 7,
        now = new Date()
    } = {}
) {

    const { map, firstWeek, rangeEnd } = createWeeklyBuckets(weeks, now);

    function inRange(date) {
        return (
            date &&
            date >= firstWeek &&
            date < rangeEnd
        );
    }

    for (const item of items) {

        // RQ
        const rqDate = parseDateSafe(item.fecha_rq);

        if (inRange(rqDate)) {

            const bucket = map.get(weekDateKey(rqDate));

            if (bucket) {
                bucket.rqAmount += num(item.total_cotizacion);
                bucket.rqCount += 1;
            }
        }

        // OC
        const ocDate = parseDateSafe(item.fecha_oc);

        if (inRange(ocDate)) {

            const bucket = map.get(weekDateKey(ocDate));

            if (bucket) {
                bucket.ocAmount += num(item.total_cotizacion);
                bucket.ocCount += 1;
            }
        }

        // PAGOS / ACTAS
        const dates = Array.isArray(item.fecha_recepcion_list)
            ? item.fecha_recepcion_list
            : [];

        const amounts = Array.isArray(item.importe_ac_list)
            ? item.importe_ac_list
            : [];

        /*
         * fecha_recepcion_list[0]
         * corresponde con
         * importe_ac_list[0]
         */

        const length = Math.min(dates.length, amounts.length);

        for (let i = 0; i < length; i++) {

            const receptionDate = parseDateSafe(dates[i]);

            if (!inRange(receptionDate)) continue;

            const bucket = map.get(weekDateKey(receptionDate));

            if (!bucket) continue;

            bucket.paymentAmount += num(amounts[i]);
            bucket.paymentCount += 1;
        }
    }


    return {
        weekly:
            [...map.values()]
                .map(
                    (row) => ({
                        key: row.key,

                        weekLabel: row.weekLabel,
                        weekNumber: row.weekNumber,
                        year: row.year,
                        monthKey: row.monthKey,
                        monthLabel: row.monthLabel,
                        monthNumber: row.monthNumber,
                        monthYear: row.monthYear,
                        isCurrentWeek: row.isCurrentWeek,
                        rqAmount: round1(row.rqAmount),
                        rqAmountMM: toMM(row.rqAmount),
                        ocAmount: round1(row.ocAmount),
                        ocAmountMM: toMM(row.ocAmount),
                        paymentAmount: round1(row.paymentAmount),
                        paymentAmountMM: toMM(row.paymentAmount),
                        rqCount: row.rqCount,
                        ocCount: row.ocCount,
                        paymentCount:row.paymentCount
                    })
                )
    };
}

// ==========================
// SLA
// ==========================
function buildDelayDistribution(
    items,
    {
        fromField,
        toField,
        ranges,
        weeks = 7,
        now = new Date()
    }
) {

    const currentWeek = startOfISOWeekUTC(now);
    const firstWeek = addWeeksUTC(currentWeek, -(weeks - 1));
    const rangeEnd = addWeeksUTC(currentWeek, 1);

    const buckets =
        ranges.map(
            (range) => ({
                ...range,
                amount: 0,
                count: 0
            })
        );

    for (const item of items) {

        const fromDate = parseDateSafe(item[fromField]);
        const toDate = parseDateSafe(item[toField]);

        if (!fromDate || !toDate) continue;

        // Solo etapas completadas
        // durante últimas 7 semanas
        if (toDate < firstWeek || toDate >= rangeEnd) continue;

        const days = businessDaysDiff(fromDate, toDate);

        if (days == null) continue;

        const bucket =
            buckets.find(
                (range) =>
                    days >= range.min &&
                    (
                        range.max == null ||
                        days <= range.max
                    )
            );

        if (!bucket) continue;

        bucket.amount += num(item.total_cotizacion);
        bucket.count += 1;
    }

    const totalAmount =
        buckets.reduce(
            (acc, range) =>
                acc + range.amount,
            0
        );

    return {
        totalAmount,
        totalAmountMM: toMM(totalAmount),
        ranges:
            buckets.map(
                (range) => ({
                    key: range.key,
                    label: range.label,
                    min: range.min,
                    max: range.max,
                    amount: round1(range.amount),
                    amountMM: toMM(range.amount),
                    percentage: totalAmount > 0
                        ? round1(range.amount / totalAmount * 100)
                        : 0
                })
            )
    };
}

function buildDelays(items) {
    return {
        envioMG:
            buildDelayDistribution(
                items,
                {
                    fromField: "fecha_creacion",
                    toField: "fecha_rq_sendmg",
                    ranges: [
                        {
                            key: "0_2",
                            label: "0 - 2 días",
                            min: 0,
                            max: 2
                        },
                        {
                            key: "3_5",
                            label: "3 - 5 días",
                            min: 3,
                            max: 5
                        },
                        {
                            key: "6_7",
                            label: "6 - 7 días",
                            min: 6,
                            max: 7
                        },
                        {
                            key: "over_7",
                            label: "+ 7 días",
                            min: 8,
                            max: null
                        }
                    ]
                }
            ),

        generacionRQ:
            buildDelayDistribution(
                items,
                {
                    fromField: "fecha_rq_sendmg",
                    toField: "fecha_rq",
                    ranges: [
                        {
                            key: "0_2",
                            label: "0 - 2 días",
                            min: 0,
                            max: 2
                        },
                        {
                            key: "3_7",
                            label: "3 - 7 días",
                            min: 3,
                            max: 7
                        },
                        {
                            key: "8_10",
                            label: "8 - 10 días",
                            min: 8,
                            max: 10
                        },
                        {
                            key: "over_10",
                            label: "+ 10 días",
                            min: 11,
                            max: null
                        }
                    ]
                }
            ),

        generacionOC:
            buildDelayDistribution(
                items,
                {
                    fromField: "fecha_rq",
                    toField: "fecha_oc",
                    ranges: [
                        {
                            key: "0_5",
                            label: "0 - 5 días",
                            min: 0,
                            max: 5
                        },
                        {
                            key: "6_10",
                            label: "6 - 10 días",
                            min: 6,
                            max: 10
                        },
                        {
                            key: "11_15",
                            label: "11 - 15 días",
                            min: 11,
                            max: 15
                        },
                        {
                            key: "over_15",
                            label: "+ 15 días",
                            min: 16,
                            max: null
                        }
                    ]
                }
            )
    };
}

const DASHBOARD_FILTERS = {
	unidad_funcional: {
		field: "unidad_funcional",
	},

	id_proyecto: {
		field: "id_proyecto",
	},

	nombre_proyecto: {
		field: "nombre_proyecto",
	},

	estado: {
		field: "estado",
	},

	proveedor: {
		field: "proveedor",
	},

	acuerdo_compras: {
		field: "acuerdo_compras",
	},

	coordinador: {
		field: "coordinador",
	},
};

function normalizeMultiParam(value) {
	if (value == null) return [];

	const values = Array.isArray(value)
		? value
		: [value];

	return values
		.flatMap((item) => String(item).split(","))
		.map((item) => item.trim())
		.filter(Boolean);
}

function buildRequirementsDashboardQuery(params, omit = null) {
	const q = {};

	for (const [param, config] of Object.entries(DASHBOARD_FILTERS)) {

		if (param === omit) continue;

		/*
		 * Estado lo manejamos aparte porque Cancelado
		 * debe excluirse siempre.
		 */
		if (param === "estado") continue;

		const values = normalizeMultiParam(
			params[param]
		);

		if (values.length) {
			q[config.field] = {
				$in: values,
			};
		}
	}


	// =============================
	// ESTADO
	// =============================

	if (omit === "estado") {

		// Aunque estemos construyendo las opciones
		// de estado, Cancelado nunca debe aparecer.
		q.estado = {
			$ne: "Cancelado",
		};

	} else {

		const estados = normalizeMultiParam(
			params.estado
		).filter(
			(value) => value !== "Cancelado"
		);

		if (estados.length) {
			q.estado = {
				$in: estados,
			};
		} else {
			q.estado = {
				$ne: "Cancelado",
			};
		}
	}

	return q;
}

managerRouter.get(
	"/get-requirements-dashboard-filter-options",
	async (req, res) => {

		try {

			const { provSites } = await db();

			const FILTER_OPTIONS = {

				unidadFuncionales: {
					param: "unidad_funcional",
					field: "unidad_funcional",
				},

				codigosProyecto: {
					param: "id_proyecto",
					field: "id_proyecto",
				},

				proyectos: {
					param: "nombre_proyecto",
					field: "nombre_proyecto",
				},

				estados: {
					param: "estado",
					field: "estado",
				},

				proveedores: {
					param: "proveedor",
					field: "proveedor",
				},

				acuerdos: {
					param: "acuerdo_compras",
					field: "acuerdo_compras",
				},

				coordinadores: {
					param: "coordinador",
					field: "coordinador",
				},
			};

			const facet = {};

			for (
				const [
					optionName,
					config
				] of Object.entries(FILTER_OPTIONS)
			) {

				/*
				 * Igual que tu antiguo:
				 *
				 * data.filter(
				 *     apply("proveedor")
				 * )
				 *
				 * Aplicamos TODOS menos
				 * el filtro que estamos calculando.
				 */
				const match =
					buildRequirementsDashboardQuery(
						req.query,
						config.param
					);


				facet[optionName] = [
					{
						$match: match,
					},

					{
						$match: {
							[config.field]: {
								$exists: true,
								$nin: [
									null,
									"",
								],
							},
						},
					},

					{
						$group: {
							_id: `$${config.field}`,
						},
					},

					{
						$sort: {
							_id: 1,
						},
					},

					// {
					// 	$project: {
					// 		_id: 0,

					// 		value: "$_id",
					// 		label: "$_id",
					// 	},
					// },
				];
			}


			const [result] =
				await provSites
					.aggregate([
						{
							$facet: facet,
						},
					])
					.exec();


            const content = {};

            for (const optionName of Object.keys(FILTER_OPTIONS)) {
                content[optionName] = (result?.[optionName] ?? [])
                    .map((item) => item._id)
                    .filter(Boolean);
            }

			return res.json({
				result: "OK",
				content,
			});

		} catch (error) {

			console.error(
				"get-requirements-dashboard-filter-options:",
				error
			);

			return res.status(500).json({
				result: "ERROR",
			});
		}
	}
);

managerRouter.get("/get-dashboard-requirements", async (req, res) => {

    try {

        const { provSites, provCR_individual } = await db();
        const {
            jefatura,
            unidad_funcional,
            id_proyecto,
            nombre_proyecto,
            linea_inversion,
            estado,
            proveedor,
            ticket_code,
            acuerdo_compras,
            is_payment,
            status_deliverable,
            status_settlement,
            exclude_status_settlement,
            coordinador,
            requester,
            requester_email,
            assigned_to_email,
            search = "",
            page = 1,
            limit = 20000,
            sortBy = "ticket_code",
            sortDirection = "desc"
        } = req.query;

        // Paginación
        const currentPage = Math.max(parseInt(page, 10) || 1, 1);
        const perPage = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 20000);
        const skip = (currentPage - 1) * perPage;

        // Campos permitidos para ordenar
        const allowedSortFields = new Set([
            "identificador",
            "sitio",
            "id_proyecto",
            "nombre_proyecto",
            "linea_inversion",
        ]);

        const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "ticket_code";
        const safeSortDirection = String(sortDirection).toLowerCase() === "asc" ? -1 : 1;

        // Query base de sites
        const q = {};

        // Filtros
        if (ticket_code) q.ticket_code = ticket_code;
        if (linea_inversion) q.linea_inversion = linea_inversion;
        if (nombre_proyecto) q.nombre_proyecto = nombre_proyecto;
        if (id_proyecto) q.id_proyecto = id_proyecto;
        if (jefatura) q.jefatura = jefatura;
        if (unidad_funcional) q.unidad_funcional = unidad_funcional;
        if (acuerdo_compras) q.acuerdo_compras = acuerdo_compras;
        if (proveedor) q.proveedor = proveedor;
        if (estado) q.estado = estado;
        if (is_payment === "true") {
            q.is_payment = true;
        }

        if (is_payment === "false") {
            q.is_payment = { $ne: true };
        }
        if (status_deliverable) q.status_deliverable = status_deliverable;
        if (status_settlement) q.status_settlement = status_settlement;

        // Exclusión SOLO cuando el front lo pida
        if (exclude_status_settlement === "true") {
            q.status_settlement = {
                $nin: ["NA", "Ok"],
            };
        }

        if (coordinador) q.coordinador = coordinador;
        if (requester) q.requester = requester;
        if (requester_email) q.requester_email = requester_email;
        if (assigned_to_email) q.assigned_to_email = assigned_to_email;

        /*
        * Regla global:
        * ningún widget considera Cancelados.
        */
        q.estado = {
            ...(q.estado || {}),
            $ne: "Cancelado"
        };

        const siteProjection = {
            ticket_id: 1,
            nro: 1,
            identificador: 1,
            sitio: 1,
            actividad: 1,
            acuerdo_compras: 1,
            solucion: 1,
            proveedor: 1,
            sustento: 1,
            coordinador: 1,
            cantidad: 1,
            moneda: 1,
            precio_unitario: 1,
            total_cotizacion: 1,
            fecha_registro: 1,
            fecha_inicio_servicio: 1,
            fecha_fin_servicio: 1,
            descripcion_adicional: 1,
            id_proyecto: 1,
            nombre_proyecto: 1,
            linea_inversion: 1,
            articulo: 1,
            jefatura: 1,
            unidad_funcional: 1,
            ticket_code: 1,
            llave: 1,
            estado: 1,
            ticket_jira: 1,
            fecha_creacion: 1,
            requester: 1,
            requester_email: 1,
            rq: 1,

            oc: 1,
            linea_oc: 1,
            cr: 1,
            importe_ac: 1,
            cr_list: 1,
            importe_ac_list: 1,
            fecha_rq: 1,
            fecha_oc: 1,
            fecha_recepcion: 1,

            comentarios: 1,

            // new pagos
            is_payment: 1,
            is_settlement: 1,
            is_deliverable: 1,
            cantidad_pago: 1,
            monto_pago: 1,
            cantidad_pago_pendiente: 1,
            monto_pago_pendiente: 1,
            status_settlement: 1,
            status_deliverable: 1,
            // jira cr
            ticket_jira_cr_1: 1,
            ticket_jira_cr_2: 1,

            //new
            liquidacion: 1,
            descuento: 1,
            penalidad: 1,
            pendiente_pago: 1,
            monto_final_pagado: 1,

            estado_oc_draw: 1,
            assigned_to: 1,
            assigned_to_email: 1,

            createdAt: 1,
            updatedAt: 1,

            fecha_rq_sendmg: 1,
            fecha_cr_sendmg: 1,
            fecha_cr_2_sendmg: 1
        };

        const rx = String(search).trim()
            ? new RegExp(escapeRegex(String(search).trim()), "i")
            : null;

        const sites = await provSites
            .find(q, siteProjection)
            .sort({
                [safeSortBy]: safeSortDirection,
                _id: -1,
            })
            .lean();

        // Si no hay sites, responder vacío
        if (!sites.length) {
            return res.json({
                result: "OK",
                content: {
                    items: [],
                    totalResults: 0,
                    totalPages: 0,
                    currentPage,
                },
            });
        }

        // Proyectos utilizados
        const projectIds = [...new Set(
            sites
                .map((s) => s.id_proyecto)
                .filter(Boolean)
        )];

        // CR
        const crMatch = {
            $and: [
                { "Código Proyecto": { $in: projectIds } },
                { "Código Proyecto": { $not: /^OPEX/i } },
            ],
        };

        // 2) Pipeline:
        const crPipeline = [
            { $match: crMatch },
            { $project: projectStageCR },
        ];

        const crs = await provCR_individual.aggregate(crPipeline).exec();

        let items = attachLineaOC(sites, crs);

        // =============================
        // DASHBOARD
        // =============================
        const [
            kpis,
            estadoActual,
            liquidaciones,
            weeklyEvolution,
            throughput,
            delays
        ] = [
            buildMainKPIs(items),
            buildCurrentState(items),
            buildSettlements(items),
            buildWeeklyAmountTrend(
                items,
                {
                    weeks: 7,
                    includeCurrentWeek: true
                }
            ),
            buildWeeklyThroughput(
                items,
                {
                    weeks: 7
                }
            ),
            buildDelays(
                items
            )
        ];

        return res.json({
            result: "OK",
            content: {
                kpis,
                estadoActual,
                liquidaciones,
                weeklyEvolution,
                throughput,
                delays,
                metadata: {
                    totalItems: items.length,
                    weeks: 7,
                    generatedAt: new Date()
                }
            }
        });

    } catch (e) {
        console.error(e);
        return res.status(500).json({
            result: "ERROR",
            message: "Error al obtener requisitos",
        });
    }

})

module.exports = managerRouter;