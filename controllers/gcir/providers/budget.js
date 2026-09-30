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

const MONTH_LABEL = [
  "", "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
];

// ====== CONSTANTES ======
const TICKET_STATES = Object.freeze({
    PENDIENTE_CT: "Pendiente CT",
    ENVIADO_MG: "Enviado a MG",
    RQ_GENERADO: "RQ Generado",
    OBSERVADO: "Observado",
    CANCELADO: "Cancelado"
});

const PAY_STATES = Object.freeze({
    INTENCION_PAGO: "Intención de Pago",
    PAGO_ENVIADO_MG: "Pago Enviado a MG",
    PAGO_GENERADO: "Pago Generado",
    CANCELADO: "Cancelado",
    INTENCION_PAGO_H2: "Intención de Pago - Hito 2",
    PAGO_ENVIADO_MG_H2: "Pago Enviado a MG - Hito 2",
    PAGO_GENERADO_H2: "Pago Generado - Hito 2",
    CERRADO: "Cerrado"
})

const SETTLEMENT_STATES = Object.freeze({
    PENDIENTE: "Pendiente",
    OBSERVADO: "Observado",
    APROBADO: "Aprobado",
    CANCELADO: "Cancelado"
})

const DELIVERABLE_STATES = Object.freeze({
    PENDIENTE: "Pendiente",
    OBSERVADO: "Observado",
    APROBADO_SF: "Aprobado SF",
    CANCELADO: "Cancelado",
    CORRECION: "Correción",
    EN_PROCESO: "En Proceso",
    APROBADO_RQ: "Aprobado RQ",
})

// ====== HELPERS ======
function normalizeState(state) {
    const s = String(state ?? "").trim();
    if (s === "Cancelada") return TICKET_STATES.CANCELADO; // alias si llega así
    return s;
}

function parsePayloadFromReq(req) {
    // soporta multipart con payload JSON y JSON puro
    if (req.body?.payload) {
        try {
            return JSON.parse(req.body.payload);
        } catch (e) {
            throw new Error("payload inválido (JSON parse error)");
        }
    }
    return req.body ?? {};
}

function buildComment(payload) {
    const text = String(payload?.comment?.text ?? "").trim();
    if (!text) return null;

    return {
        text,
        type: String(payload?.comment?.type ?? "").trim(),
        author: {
            name: String(payload?.comment?.author?.name ?? "SYSTEM").trim(),
            email: String(payload?.comment?.author?.email ?? "").trim(),
        },
        clientAt: payload?.comment?.clientAt ? new Date(payload.comment.clientAt) : null,
        createdAt: new Date(),
    };
}

function ensureTransition(currentState, expectedFrom, targetState, allowAnyFrom = false) {
    if (!allowAnyFrom && currentState !== expectedFrom) {
        const err = new Error(`Transición no permitida. Estado actual "${currentState}" (esperado "${expectedFrom}")`);
        err.statusCode = 400;
        throw err;
    }

    if (currentState === targetState) {
        const err = new Error(`El ticket ya se encuentra en estado "${targetState}"`);
        err.statusCode = 400;
        throw err;
    }
}

async function replaceSitesBatch({
    provSites,
    ticket,
    sites,
    nextState,
    nextJira,
    nextRq,
}) {
    const oldBatch = ticket.active_batch_id;
    const newBatch = makeBatchId();

    const docs = (Array.isArray(sites) ? sites : []).map((input) => {
        const llave =
        input.id_proyecto && input.linea_inversion
            ? `${input.id_proyecto}${extractNumericPrefix(input.linea_inversion)}`
            : "";

        return {
            ...input,
            ticket_id: ticket._id,
            batch_id: newBatch,
            llave,
            estado: nextState,
            ticket_jira: nextJira ?? "",
            rq: nextRq ?? "",
            comentarios: input.comentarios ?? "",
            fecha_creacion: new Date(),
            fecha_actualizacion: new Date(),
            fecha_registro: input.fecha_registro ? parseExcelOrISO(input.fecha_registro) : null,
            fecha_inicio_servicio: input.fecha_inicio_servicio ? parseExcelOrISO(input.fecha_inicio_servicio) : null,
            fecha_fin_servicio: input.fecha_fin_servicio ? parseExcelOrISO(input.fecha_fin_servicio) : null,
        };
    });

    if (docs.length) {
        await provSites.collection.insertMany(docs, { ordered: false });
    }

    ticket.active_batch_id = newBatch;
    ticket.sites_count = docs.length;
    ticket.total_cotizacion = docs.reduce((acc, cur) => acc + toNumber(cur.total_cotizacion), 0);

    if (oldBatch) {
        await provSites.deleteMany({ ticket_id: ticket._id, batch_id: oldBatch });
    }

    return { newBatch, oldBatch, docsCount: docs.length };
}

async function propagateToSites({
    provSites,
    ticket,
    state,
    ticket_jira,
    rq,
    fecha_rq_sendmg
}) {
    const siteSet = {};

    if (state !== undefined) siteSet.estado = state;
    if (ticket_jira !== undefined) siteSet.ticket_jira = ticket_jira;
    if (rq !== undefined) siteSet.rq = rq;
    if (fecha_rq_sendmg !== undefined) siteSet.fecha_rq_sendmg = fecha_rq_sendmg;

    if (!Object.keys(siteSet).length) return { matchedCount: 0, modifiedCount: 0 };

    siteSet.fecha_actualizacion = new Date();

    const filter = ticket.active_batch_id
        ? { ticket_id: ticket._id, batch_id: ticket.active_batch_id }
        : { ticket_id: ticket._id };

    const result = await provSites.updateMany(filter, { $set: siteSet });
    return result;
}

function saveUploadedFileInTicket(ticket, reqFile) {
    if (!reqFile) return;

    ticket.file = {
        originalName: reqFile.originalname,
        filename: reqFile.filename,
        mimetype: reqFile.mimetype,
        size: reqFile.size,
        uploadedAt: new Date(),
        path: reqFile.path,
    };
}

function getStatusStyle(status) {
    const s = String(status || "").trim();

    const styles = {
        "Pendiente CT": { bg: "#FEF3C7", color: "#92400E" }, // amber
        "Enviado a MG": { bg: "#DBEAFE", color: "#1D4ED8" }, // blue
        "RQ Generado": { bg: "#DCFCE7", color: "#166534" },  // green
        "Observado":   { bg: "#FEE2E2", color: "#991B1B" },  // red
        "Cancelado":   { bg: "#F3F4F6", color: "#374151" },  // gray
    };

    return styles[s] || { bg: "#E5E7EB", color: "#374151" };
}

// EMAIL
async function notifyTicketStateChangeSafe({
    ticket,
    prevState,
    nextState,
    payload,
    actor,
}) {
    try {

        const statusStyle = getStatusStyle(nextState);

        console.log("[MAIL] Ticket state changed", {
            ticketId: String(ticket._id),
            prevState,
            nextState,
            jira: ticket.ticket_jira ?? null,
            rq: ticket.rq ?? null,
            actor: actor ?? null,
        });

        console.log("TICKET", ticket);
        console.log("Payload", payload);

        await sendEmail(
            'normal',
            '"Workflow GCIR" <planner.notifier@entel.net.pe>',
            // to_workers,
            // ['ntt_sccopacondo@externo.entel.pe'],
            ticket.requester_email,
            // [],
            ['caroline.carrasco.ent@viaexperis2.pe', 'cesar.guzman@entel.pe', 'ntt_sccopacondo@externo.entel.pe'],
            // cc_expiration_letter,
            `WF - Actualización Ticket ${ticket.ticket_code}`,
            generateTicketStateChangedHtml({
                recipientName: ticket.requester,
                ticketCode: ticket.ticket_code,
                title: "Cambio de estado de ticket",
                message: `El ticket fue actualizado de "${prevState}" a "${nextState}".`,
                prevStatus: prevState,
                nextStatus: nextState,
                nextStatusBg: statusStyle.bg,
                nextStatusColor: statusStyle.color,
                comment: payload.comment.text || "", 
                changedBy: payload.comment.author.name || "",
                changedAt: new Date().toLocaleString("es-PE"),
                ticketJira: ticket.ticket_jira || "",
                rq: ticket.rq || ""
            }),
            []
        );

        return { sent: true, error: null };
    } catch (err) {
        console.error("Error enviando correo:", err);
        return { sent: false, error: String(err.message ?? err) };
    }
}

async function executeStateTransition({
    req,
    res,
    rules,
}) {
    try {
        const { provTickets, provSites } = await db();
        const { ticketId } = req.params;

        const payload = parsePayloadFromReq(req);
        const patch = payload.patch ?? {};

        // console.log("PATCH", patch)

        const comment = buildComment(payload);

        const ticket = await provTickets.findById(ticketId);
        if (!ticket) {
            return res.status(404).json({ result: "NOK", msg: "Ticket no existe" });
        }

        const currentState = normalizeState(ticket.state ?? TICKET_STATES.PENDIENTE_CT);
        const targetState = normalizeState(rules.toState);

        ensureTransition(currentState, rules.fromState, targetState, Boolean(rules.allowAnyFrom));

        // campos entrantes
        const incomingTicketJira = patch.ticket_jira;
        const incomingRq = patch.rq;

        const nextTicketJira = incomingTicketJira !== undefined ? incomingTicketJira : (ticket.ticket_jira ?? "");
        const nextRq = incomingRq !== undefined ? incomingRq : (ticket.rq ?? "");

        // Validaciones específicas
        if (typeof rules.validate === "function") {
            await rules.validate({
                req,
                payload,
                patch,
                ticket,
                currentState,
                targetState,
                nextTicketJira,
                nextRq,
            });
            }

            // replaceSites
            const replaceSites = Boolean(payload.replaceSites) || Boolean(req.file);
            const sites = Array.isArray(payload.sites) ? payload.sites : [];

            if (replaceSites && !rules.allowReplaceSites) {
            return res.status(400).json({
                result: "NOK",
                msg: "Este cambio de estado no permite reemplazar sites/archivo",
            });
            }

            // 1) Reemplazo de sites
            let batchInfo = null;
            if (replaceSites) {
            batchInfo = await replaceSitesBatch({
                provSites,
                ticket,
                sites,
                nextState: targetState,
                nextJira: nextTicketJira,
                nextRq: nextRq,
            });
        }

        // 2) Save File
        saveUploadedFileInTicket(ticket, req.file);

        // 3) Save changes
        const now = new Date();

        ticket.state = targetState;
        ticket.date_update = now;
        ticket.fecha_actualizacion = now;

        // campos opcionales por transición
        if (rules.allowTicketJira && incomingTicketJira !== undefined) {
            ticket.ticket_jira = incomingTicketJira;
        }
        if (rules.allowRq && incomingRq !== undefined) {
            ticket.rq = incomingRq;
        }

        // campos adicionales
        if (Array.isArray(rules.allowedExtraPatchFields)) {
            for (const k of rules.allowedExtraPatchFields) {
                if (patch[k] !== undefined) ticket[k] = patch[k];
            }
        }

        if (ticket.date_request) {
            ticket.date_request = parseExcelOrISO(ticket.date_request);
        }

        // Comentarios
        if (comment) {
            ticket.comments = ticket.comments ?? [];
            ticket.comments.push(comment);
        }

        await ticket.save();

        const propagatePayload = {
            provSites,
            ticket,
            ticket_jira: rules.propagateTicketJira
                ? (rules.allowTicketJira ? ticket.ticket_jira : undefined)
                : undefined,
            rq: rules.propagateRq
                ? (rules.allowRq ? ticket.rq : undefined)
                : undefined,
            fecha_rq_sendmg: targetState === "Enviado a MG"
                ? new Date()
                : undefined,
        }

        if (patch.updateSites === true) {
            propagatePayload.state = targetState
        }

        const sitePropagation = await propagateToSites(propagatePayload)

        // 5) Correo
        const mailStatus = await notifyTicketStateChangeSafe({
            ticket,
            prevState: currentState,
            nextState: targetState,
            payload,
            actor: payload?.comment?.author ?? null,
        });

        return res.json({
            result: "OK",
            content: {
                ticket_id: ticket._id,
                prev_state: currentState,
                state: ticket.state,
                active_batch_id: ticket.active_batch_id ?? null,
                sites_count: ticket.sites_count ?? 0,
                total_cotizacion: ticket.total_cotizacion ?? 0,
                ticket_jira: ticket.ticket_jira ?? null,
                rq: ticket.rq ?? null,
                file: ticket.file ?? null,
                batch_info: batchInfo,
                sites_update: {
                matchedCount: sitePropagation?.matchedCount ?? 0,
                modifiedCount: sitePropagation?.modifiedCount ?? 0,
                },
            },
            notification: mailStatus
        });
    } catch (e) {
            console.error(e);
            return res.status(e.statusCode || 500).json({
            result: "ERROR",
            msg: String(e.message ?? e),
        });
    }
}


// POST rápido: crear ticket + cargar archivo + insertar sites 
function makeBatchId() {
    return `${new Date().toISOString()}-${Math.random().toString(36).substr(2, 9)}`
}

const UPLOAD_ROOT = path.resolve(process.cwd(), "resources", "solicitudes_rq");
const UPLOAD_CR = path.resolve(process.cwd(), "resources", "solicitudes_cr");
const UPLOAD_SUSTENTOS = path.resolve(process.cwd(), "resources", "solicitudes_sustentos");
const UPLOAD_DELIVERABLES = path.resolve(process.cwd(), "resources", "deliverables");
const UPLOAD_SETTLEMENTS = path.resolve(process.cwd(), "resources", "settlements");

const ensureDir = (dir) => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); };


async function nextTicketCode(prefix, digits = 5) {

    const { provCounters } = await db();
    const pfx = String(prefix).trim().toUpperCase();

    const doc = await provCounters.findOneAndUpdate(
        { _id: pfx },
        { $inc: { seq: 1 } },
        { upsert: true, new: true }
    ).lean();

    const n = doc.seq
    const num = String(n).padStart(digits, "0");

    return `${pfx}-${num}`;

}


const SLUG = s => (s || "sin-pm")
  .toString().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");

function extractNumericPrefix(str) {
    if (typeof str !== "string") return "";
    const m = str.trim().match(/^\d+(?:-\d+)*(?=-[^\d]|$)/);
    return m ? m[0] : "";
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function excelSerialToDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;
  return new Date(Date.UTC(1899, 11, 30) + n * MS_PER_DAY); // 00:00:00Z
}

function parseExcelOrISO(v) {
  if (v == null || v === "") return null;

  // "46036" o 46036 (Excel serial)
  if (typeof v === "number" || (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()))) {
    return excelSerialToDate(v);
  }

  // Si ya viene ISO (ej: "2026-02-09T05:34:51.218Z")
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}


function toNumber(v) {

    console.log("TO NUMBER:", v)

    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;

    let s = String(v).trim();
    if (!s) return 0;

    // quitar símbolos y espacios (S/, $, etc.)
    s = s.replace(/[^\d.,-]/g, "");

    // Si tiene . y , decide decimal por el ÚLTIMO separador
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");

    if (lastDot !== -1 && lastComma !== -1) {
        if (lastDot > lastComma) {
        // 1,234.56 -> decimal '.'
        s = s.replace(/,/g, "");
        } else {
        // 1.234,56 -> decimal ','
        s = s.replace(/\./g, "").replace(/,/g, ".");
        }
    } else if (lastComma !== -1 && lastDot === -1) {
        // 1234,56 -> decimal ','
        s = s.replace(/,/g, ".");
    } else {
        // 1234.56 o 1234 -> ok
    }

    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
}



const KEY_MAP = {
    "CAPEX/OPEX": "capex_opex",
    "Tipo": "tipo",
    "Código_Proyecto": "project_code",
    "Nombre_Proyecto": "project_name",
    "Inversión/SubRubro": "investment_line",
    "Gerencia": "gerencia",
    "Jefatura_Final": "jefatura",
    "Unidad_Funcional": "unidad_funcional",
    "PM_ACTUAL": "pm_actual",
    "Requisitor": "requisitor",
    "Estado_Ptto": "estado_ptto",
    "SOLPE_ORIGINAL": "solpe_original",
    "SOLPE": "solpe",
    "Importe_OC": "importe_oc",
    "Importe_AC": "importe_ac",
    "Importe_Facturado": "importe_facturado",
    "Importe_RQ": "importe_rq",
    "Provisión_Real": "provision_real",
    "Declaración_No_Uso": "declaracion_no_uso",
    "Categoría": "categoria",
    "Llave2": "llave2",
    "Exceso/Por_comprometer": "exceso_por_comprometer",
    "Ptto_Disponible": "ptto_disponible",
    "Gerencia_Sponsor_Final": "gerencia_sponsor_final",
    "Trimestre": "trimestre",
    "Trimestre_Real": "trimestre_real",
    "Avance_Proyecto": "avance_proy"
}

const KEY_ENTRIES = Object.entries(KEY_MAP);
const API_TO_DB = Object.fromEntries(
    KEY_ENTRIES.map(([dbKey, apiKey]) => [apiKey, dbKey])
);

// const getDbField = (apiKey) => API_TO_DB[apiKey] ?? apiKey;

// renombra en sitio (rápido)
// function normalizeInPlace(obj) {
//   for (const [from, to] of KEY_ENTRIES) {
//     if (Object.prototype.hasOwnProperty.call(obj, from)) {
//       obj[to] = obj[from];
//       delete obj[from];
//     }
//   }
//   return obj;
// }


const KEY_RQ = {
    "RQ": "rq",
    "Nro OC": "nro_oc",
    "Estado OC": "estado_oc",
    "Fecha Emisión RQ": "fecha_emision_rq",
    "Fecha Aprobación RQ": "fecha_aprobacion_rq",
    "Fecha Emisión OC": "fecha_emision_oc",
    "Fecha Aprobación OC": "fecha_aprobacion_oc",
    "Fecha Inicio de Proyecto": "fecha_inicio_proyecto",
    "Fecha de Fin de Proyecto": "fecha_fin_proyecto",
    "Tipo": "tipo",
    "Código Proyecto": "codigo_proyecto",
    "Nombre Proyecto": "nombre_proyecto",
    "Inversión/SubRubro": "inversion_subrubro",
    "Categoría": "categoria",
    "Acuerdo": "acuerdo",
    "Proveedor": "proveedor",
    "Requisitor": "requisitor",
    "PM ACTUAL": "pm_actual",
    "Gerencia Requisitor": "gerencia_requisitor",
    "Gerencia Sponsor": "gerencia_sponsor",
    "Gerencia Sponsor Final": "gerencia_sponsor_final",
    "Importe OC": "importe_oc",
    "Importe AC": "importe_ac",
    "Importe Facturado": "importe_facturado",
    "Importe RQ": "importe_rq",
    "CR 2026": "cr_2026",
    "CR menores 2026": "cr_menores_2026",
    "Llave": "llave",
    "Provisión Real": "provision_real",
    "Ahorro Real": "ahorro_real",
    "Declaración No Uso": "declaracion_no_uso",
    "Jefatura Final": "jefatura_final",
    "Unidad Funcional": "unidad_funcional",
    "Gerencia": "gerencia",
    "Comentarios": "comentarios",
    "Estado Ptto": "estado_ptto",
    "Trimestre": "trimestre",
    "Trimestre_Real": "trimestre_real",
    "Avance_Proyecto": "avance_proy",
}

const KEY_RQ_ENTRIES = Object.entries(KEY_RQ);

const API_TO_DB_RQ = Object.fromEntries(
  KEY_RQ_ENTRIES.map(([dbKey, apiKey]) => [apiKey, dbKey])
);

const projectStage = Object.fromEntries(
  KEY_RQ_ENTRIES.map(([dbKey, apiKey]) => [
    apiKey,
    { $getField: { field: dbKey, input: "$$ROOT" } }
  ])
);

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



projectStage._id = 0;

managerRouter.route('/get-projects')
    .get(async (req, res) => {
        const { provProjects }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            const mongoQuery = {}

            mongoQuery[API_TO_DB["capex_opex"] ?? "CAPEX"] = "CAPEX"

            const res = await provProjects
                .find(mongoQuery)
                .lean();

            // const normalizeWithMap = obj =>
            //     Object.fromEntries(
            //         Object.entries(obj).map(([k, v]) => [KEY_MAP[k] ?? k, v])
            //     );

            const normalizeInPlace = (obj) => {
                for (const [from, to] of KEY_ENTRIES) {
                    if (Object.prototype.hasOwnProperty.call(obj, from)) {
                    obj[to] = obj[from];
                    delete obj[from];
                    }
                }
                return obj;
            };

            // const payload = res.map(p => normalizeWithMap(p));
            const payload = res.map(p => normalizeInPlace(p));
            
            response.content = payload
            response.result = 'OK';

        } catch (e) {

            console.log(e);
            return res.status(500).json({ result: "ERROR" });
        }

        res.json(response);
    });



// GET UNIQUE PAs FILTERS
managerRouter.get("/get-projects-filter-options", async (req, res) => {
    try {
        const { provProjects } = await db();

        const getDbField = (apiKey) => API_TO_DB[apiKey] ?? apiKey;

        const cleanDistinct = async (apiKey, q = {}) => {
            const dbField = getDbField(apiKey);

            const values = await provProjects.distinct(dbField, {
                ...q,
                [dbField]: {
                    $nin: [null, ""],
                },
            });

            return [...new Set(
                values
                    .filter((value) => value != null && value !== "")
                    .map((value) => String(value).trim())
                    .filter(Boolean)
            )].sort((a, b) => a.localeCompare(b));
        };

        const [
            tipo,
            jefatura,
            unidad_funcional,
            pm_actual,
            requisitor,
            categoria
        ] = await Promise.all([
            cleanDistinct("tipo"),
            cleanDistinct("jefatura"),
            cleanDistinct("unidad_funcional"),
            cleanDistinct("pm_actual"), 
            cleanDistinct("requisitor"),
            cleanDistinct("categoria")
        ]);

        return res.json({
            result: "OK",
            content: {
                tipo,
                jefatura,
                unidad_funcional,
                pm_actual,
                requisitor,
                categoria
            },
        });
    } catch (e) {
        console.error("Error get-projects-filter-options:", e);
        return res.status(500).json({
            result: "ERROR",
            message: "Error al obtener opciones de filtros",
        });
    }
});

managerRouter.route('/get-projects-q')
    .get(async (req, res) => {
        let response = { result: 'NOK' };

        try {
            const { provProjects, provSites } = await db();

            const {
                tipo,
                jefatura,
                pm,
                requisitor,
                categoria,
                search = "",
                page = 1,
                limit = 10,
                sortBy = "ticket_code",
                sortDirection = "desc"
            } = req.query;

            const currentPage = Math.max(parseInt(page, 10) || 1, 1);
            const perPage = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 5000);
            const skip = (currentPage - 1) * perPage;

            // Campos permitidos para ordenar
            const allowedSortFields = new Set([
                "tipo"
            ]);

            const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "ticket_code";
            const safeSortDirection = String(sortDirection).toLowerCase() === "asc" ? -1 : 1;

            // Query base de sites
            const q = {};   

            if(tipo) q[API_TO_DB.tipo] = tipo;
            if(jefatura) q[API_TO_DB.jefatura] = jefatura;
            if(pm) q[API_TO_DB.pm_actual] = pm;
            if(requisitor) q[API_TO_DB.requisitor] = requisitor;
            if(categoria) q[API_TO_DB.categoria] = categoria;
            q[API_TO_DB.capex_opex] = "CAPEX";

            // Búsqueda
            if (String(search).trim()) {
                const rx = new RegExp(escapeRegex(String(search).trim()), "i");

                q.$or = [
                    { [API_TO_DB.project_code]: rx },
                    { [API_TO_DB.project_name]: rx },
                    { [API_TO_DB.investment_line]: rx },
                    { [API_TO_DB.pm_actual]: rx },
                    { [API_TO_DB.requisitor]: rx },
                ];
            }

            // Traer solo los campos necesarios (y las fechas para calcular maxDate)
            // Total + página actual de sites
            const [totalResults, projects] = await Promise.all([
                provProjects.countDocuments(q),
                provProjects
                    .find(q)
                    .sort({
                        [safeSortBy]: safeSortDirection,
                        _id: -1,
                    })
                    .skip(skip)
                    .limit(perPage)
                    .lean(),
            ]);

            // Si no hay projects, responder vacío
            if (!projects.length) {
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


            const PROJECT_KEY_DB =
                KEY_ENTRIES.find(([, apiKey]) => apiKey === "llave2")?.[0] ??
                "llave2";

            /*
            * Solo extrae las llaves de los proyectos de la página actual.
            */
            const projectKeys = [
                ...new Set(
                    projects
                        .map((project) => project[PROJECT_KEY_DB])
                        .filter(
                            (key) =>
                                key !== undefined &&
                                key !== null &&
                                String(key).trim() !== ""
                        )
                ),
            ];

            let solicitadoByKey = new Map();

            if (projectKeys.length) {
                const solicitadoRows = await provSites.aggregate([
                    {
                        $match: {
                            llave_proyecto: {
                                $in: projectKeys,
                            },
                            estado: {
                                $in: [
                                    "Pendiente CT",
                                    "Enviado a MG",
                                    "Observado",
                                ],
                            },
                        },
                    },

                    {
                        $addFields: {
                            __cot: {
                                $let: {
                                    vars: {
                                        value: "$total_cotizacion",
                                    },
                                    in: {
                                        $convert: {
                                            input: {
                                                $cond: [
                                                    {
                                                        $eq: [
                                                            {
                                                                $type: "$$value",
                                                            },
                                                            "string",
                                                        ],
                                                    },
                                                    {
                                                        $replaceAll: {
                                                            input: {
                                                                $replaceAll: {
                                                                    input: "$$value",
                                                                    find: ",",
                                                                    replacement: "",
                                                                },
                                                            },
                                                            find: " ",
                                                            replacement: "",
                                                        },
                                                    },
                                                    "$$value",
                                                ],
                                            },
                                            to: "double",
                                            onError: 0,
                                            onNull: 0,
                                        },
                                    },
                                },
                            },
                        },
                    },

                    {
                        $group: {
                            _id: "$llave_proyecto",
                            importe_solicitado: {
                                $sum: "$__cot",
                            },
                        },
                    },
                ]);

                solicitadoByKey = new Map(
                    solicitadoRows.map((row) => [
                        row._id,
                        row.importe_solicitado,
                    ])
                );
            }

            /*
            * add each project
            */
            for (const project of projects) {
                const llave = project[PROJECT_KEY_DB];

                project.solicitado =
                    solicitadoByKey.get(llave) ?? 0;
            }


            const normalizeInPlace = (obj) => {
                for (const [from, to] of KEY_ENTRIES) {
                    if (Object.prototype.hasOwnProperty.call(obj, from)) {
                    obj[to] = obj[from];
                    delete obj[from];
                    }
                }
                return obj;
            };

            // const payload = res.map(p => normalizeWithMap(p));
            const payload = projects.map(p => normalizeInPlace(p));

            return res.json({
                result: "OK",
                content: {
                    items: payload,
                    totalResults,
                    totalPages: Math.ceil(totalResults / perPage),
                    currentPage
                },
            });

        
        } catch (e) {
            console.error(e);
            return res.status(500).json({ result: "ERROR" });
        }

    });


// GET PROJECTS BY LLAVE
managerRouter.route('/get-projects-llave')
    .get(async (req, res) => {
        const { provProjects }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            const mongoQuery = {}

            mongoQuery[API_TO_DB["capex_opex"] ?? "CAPEX"] = "CAPEX"

            const res = await provProjects
                .find(mongoQuery)
                .select("Llave2 SOLPE Importe_OC")
                .lean();

            const normalizeInPlace = (obj) => {
                for (const [from, to] of KEY_ENTRIES) {
                    if (Object.prototype.hasOwnProperty.call(obj, from)) {
                    obj[to] = obj[from];
                    delete obj[from];
                    }
                }
                return obj;
            };

            // const payload = res.map(p => normalizeWithMap(p));
            const payload = res.map(p => normalizeInPlace(p));
            
            response.content = payload
            response.result = 'OK';

        } catch (e) {

            console.log(e);
            return res.status(500).json({ result: "ERROR" });
        }

        res.json(response);
    });



managerRouter.get("/get-projects-test", async (req, res) => {
    try {
        const { provProjects } = await db();

        const {
            categoria,
            pm,          // alias que usarás
            jefatura,
            gerencia,    // usa "gerencia" (según tu KEY_MAP)
            tipo,        // usa "tipo" (según tu KEY_MAP)

            after,
            limit = 100,
            exclude,
        } = req.query;

        const mongoQuery = {};

        // Mapea API -> DB key (si no existe en API_TO_DB, cae al mismo nombre)
        if (categoria) mongoQuery[API_TO_DB["categoria"] ?? "categoria"] = categoria;

        // pm (query) -> pm_actual (API) -> DB key
        if (pm) mongoQuery[API_TO_DB["pm_actual"] ?? "pm_actual"] = pm;

        if (jefatura) mongoQuery[API_TO_DB["jefatura"] ?? "jefatura"] = jefatura;
        if (gerencia) mongoQuery[API_TO_DB["gerencia"] ?? "gerencia"] = gerencia;
        if (tipo) mongoQuery[API_TO_DB["tipo"] ?? "tipo"] = tipo;

        if (after) mongoQuery._id = { $lt: after };

        // Excluir campos pesados sin listar todos los buenos
        const projection = {};
        if (exclude) {
        for (const f of String(exclude).split(",").map(s => s.trim()).filter(Boolean)) {
            projection[f] = 0;
        }
        }

        const lim = Math.min(parseInt(limit, 10) || 100, 1000);

        const docs = await provProjects
        .find(mongoQuery, projection)
        .sort({ _id: -1 })
        .limit(lim)
        .lean();

        // Normaliza salida DB -> API
        const normalizeInPlace = (obj) => {
        for (const [from, to] of KEY_ENTRIES) {
            if (Object.prototype.hasOwnProperty.call(obj, from)) {
            obj[to] = obj[from];
            delete obj[from];
            }
        }
        return obj;
        };

        const items = docs.map(normalizeInPlace);

        return res.json({
        result: "OK",
        content: {
            items,
            nextCursor: items.length ? items[items.length - 1]._id : null,
        },
        });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ result: "ERROR" });
    }
});




managerRouter.get("/get-projects-api-unique", async (req, res) => {
  const { provProjects } = await db();

  let response = { result: "NOK", content: [] };

  // Campos tal cual están en Mongo (ojo con acentos y /)
  const FIELD_CODE = "Código_Proyecto";
  const FIELD_NAME = "Nombre_Proyecto";

  const DEFAULT_FILTER = {
    // "CAPEX/OPEX": "CAPEX",
    Gerencia: "GERENCIA DE CONSTRUCCION E INFRAESTRUCTURA DE RED",
  };

  try {
    const data = await provProjects
      .aggregate([
        {
          $match: {
            ...DEFAULT_FILTER,
            [FIELD_CODE]: { $ne: null, $ne: "" },
            [FIELD_NAME]: { $ne: null, $ne: "" },
          },
        },

        // ÚNICO por Código_Proyecto
        {
          $group: {
            _id: `$${FIELD_CODE}`,
            [FIELD_NAME]: { $first: `$${FIELD_NAME}` },
          },
        },

        {
          $project: {
            _id: 0,
            [FIELD_CODE]: "$_id",
            [FIELD_NAME]: 1,
          },
        },

        { $sort: { [FIELD_NAME]: 1 } },
      ])
      .exec();

    response.content = data;
    response.result = "OK";
  } catch (e) {
    console.log(e);
  }

  return res.json(response);
});



managerRouter.route('/rq-agrupado')
    .get(async (req, res) => {
        
        const { provRQ_agrupado } = await db()
        let response = { result: 'NOK' }, body = req.body;
        let payload = []

        try {

            const mongoQuery = {}

            // Project Code NOT STARTWITH with OPEX
    
            // mongoQuery[API_TO_DB["project_code"] ?? "CAPEX"] = "CAPEX"

            const match = {};
            match[API_TO_DB_RQ["codigo_proyecto"] ?? "Código Proyecto"] = { $not: /^OPEX/i };

            const pipeline = [
                { $match: match },
                { $project: projectStage },
            ];


            // const rows = await provRQ_agrupado.aggregate([{ $project: projectStage }]).exec();
            const rows = await provRQ_agrupado
                .aggregate(pipeline)
                .allowDiskUse(true)
                .exec();

            response.content = rows;
            response.result = 'OK';

        } catch (e) {
            console.log(e);
            return res.status(500).json({ result: "ERROR" });
        }

        res.json(response);
    });


// GET UNIQUE PAs FILTERS
managerRouter.get("/get-rqs-filter-options", async (req, res) => {
    try {
        const { provRQ_agrupado } = await db();

        const getDbField = (apiKey) => API_TO_DB_RQ[apiKey] ?? apiKey;

        const cleanDistinct = async (apiKey, q = {}) => {
            const dbField = getDbField(apiKey);

            const values = await provRQ_agrupado.distinct(dbField, {
                ...q,
                [dbField]: {
                    $nin: [null, ""],
                },
            });

            return [...new Set(
                values
                    .filter((value) => value != null && value !== "")
                    .map((value) => String(value).trim())
                    .filter(Boolean)
            )].sort((a, b) => a.localeCompare(b));
        };

        const [
            estado_oc,
            tipo,
            categoria,
            proveedor,
            pm_actual,
            requisitor,
            jefatura_final,
            gerencia
        ] = await Promise.all([
            cleanDistinct("estado_oc"),
            cleanDistinct("tipo"),
            cleanDistinct("categoria"), 
            cleanDistinct("proveedor"),
            cleanDistinct("pm_actual"),
            cleanDistinct("requisitor"),
            cleanDistinct("jefatura_final"),
            cleanDistinct("gerencia")
        ]);

        return res.json({
            result: "OK",
            content: {
                estado_oc,
                tipo,
                categoria,
                proveedor,
                pm_actual,
                requisitor,
                jefatura_final,
                gerencia
            },
        });
    } catch (e) {
        console.error("Error get-rqs-filter-options:", e);
        return res.status(500).json({
            result: "ERROR",
            message: "Error al obtener opciones de filtros",
        });
    }
});

managerRouter.route('/rq-agrupado-q')
    .get(async (req, res) => {
        let response = { result: 'NOK' };

        try {
            const { provRQ_agrupado } = await db();

            const {
                estado_oc,
                tipo,
                categoria,
                proveedor,
                pm_actual,
                requisitor,
                jefatura,
                gerencia,
                search = "",
                page = 1,
                limit = 10,
                sortBy = "ticket_code",
                sortDirection = "desc"
            } = req.query;

            const currentPage = Math.max(parseInt(page, 10) || 1, 1);
            const perPage = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 30000);
            const skip = (currentPage - 1) * perPage;

            // Campos permitidos para ordenar
            const allowedSortFields = new Set([
                "tipo"
            ]);

            const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "ticket_code";
            const safeSortDirection = String(sortDirection).toLowerCase() === "asc" ? -1 : 1;

            // Query base de sites
            const q = {};   

            if(estado_oc) q[API_TO_DB_RQ.estado_oc] = estado_oc;
            if(tipo) q[API_TO_DB_RQ.tipo] = tipo;
            if(categoria) q[API_TO_DB_RQ.categoria] = categoria;
            if(proveedor) q[API_TO_DB_RQ.requisitor] = proveedor;
            if(pm_actual) q[API_TO_DB_RQ.pm_actual] = pm_actual;
            if(requisitor) q[API_TO_DB_RQ.requisitor] = requisitor;
            if(jefatura) q[API_TO_DB_RQ.jefatura_final] = jefatura;
            if(gerencia) q[API_TO_DB_RQ.gerencia] = gerencia;
            API_TO_DB_RQ["codigo_proyecto"] = { $not: /^OPEX/i };

            // Búsqueda
            if (String(search).trim()) {
                const rx = new RegExp(escapeRegex(String(search).trim()), "i");

                q.$or = [
                    { [API_TO_DB_RQ.codigo_proyecto]: rx },
                    { [API_TO_DB_RQ.nombre_proyecto]: rx },
                    { [API_TO_DB_RQ.inversion_subrubro]: rx },
                    { [API_TO_DB_RQ.rq]: rx },
                    { [API_TO_DB_RQ.nro_oc]: rx },
                    { [API_TO_DB_RQ.acuerdo]: rx },
                ];
            }

            // Traer solo los campos necesarios (y las fechas para calcular maxDate)
            // Total + página actual de sites
            const [totalResults, rqs] = await Promise.all([
                provRQ_agrupado.countDocuments(q),
                provRQ_agrupado
                    .find(q)
                    .sort({
                        [safeSortBy]: safeSortDirection,
                        _id: -1,
                    })
                    .skip(skip)
                    .limit(perPage)
                    .lean(),
            ]);

            // Si no hay sites, responder vacío
            if (!rqs.length) {
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

            const normalizeInPlace = (obj) => {
                for (const [from, to] of KEY_RQ_ENTRIES) {
                    if (Object.prototype.hasOwnProperty.call(obj, from)) {
                    obj[to] = obj[from];
                    delete obj[from];
                    }
                }
                return obj;
            };

            // const payload = res.map(p => normalizeWithMap(p));
            const payload = rqs.map(p => normalizeInPlace(p));

            return res.json({
                result: "OK",
                content: {
                    items: payload,
                    totalResults,
                    totalPages: Math.ceil(totalResults / perPage),
                    currentPage
                },
            });

        
        } catch (e) {
            console.error(e);
            return res.status(500).json({ result: "ERROR" });
        }

    });


managerRouter.route('/rq-agrupado-proveedores')
    .get(async (req, res) => {
        
        const { provRQ_agrupado } = await db()
        let response = { result: 'NOK' }, body = req.body;
        let payload = []

        try {

            const mongoQuery = {}

            const match = {};
            // match[API_TO_DB_RQ["codigo_proyecto"] ?? "Código Proyecto"] = { $not: /^OPEX/i };
            match[API_TO_DB_RQ["gerencia"] ?? "Gerencia"] = "GERENCIA DE CONSTRUCCION E INFRAESTRUCTURA DE RED";

            const pipeline = [
                { $match: match },
                { $project: projectStage },
            ];


            // const rows = await provRQ_agrupado.aggregate([{ $project: projectStage }]).exec();
            const rows = await provRQ_agrupado
                .aggregate(pipeline)
                .allowDiskUse(true)
                .exec();

            response.content = rows;
            response.result = 'OK';

        } catch (e) {
            console.log(e);
            return res.status(500).json({ result: "ERROR" });
        }

        res.json(response);
    });


managerRouter.route('/rq-provisiones')
    .get(async (req, res) => {
        
        const { provRQ_agrupado } = await db()
        let response = { result: 'NOK' }, body = req.body;
        let payload = []

        try {

            // const rows = await provRQ_provisiones.aggregate([{ $project: projectStage }]).exec();
            // get rows with Provisión Real !== 0
            const rows = await provRQ_agrupado.aggregate([{ $match: { "Provisión Real": { $ne: 0 } } }, { $project: projectStage }]).exec();

            response.content = rows;
            response.result = 'OK';

        } catch (e) {
            console.log(e);
        }

        res.json(response);
    });



managerRouter.route('/rq-asignacion-proveedor')
    .get(async (req, res) => {
        
        const { provRQ_agrupado } = await db()
        let response = { result: 'NOK' }, body = req.body;
        let payload = []

        try {

            // const rows = await provRQ_provisiones.aggregate([{ $project: projectStage }]).exec();
            // get rows with Provisión Real !== 0
            const rows = await provRQ_agrupado.aggregate([{ $match: { "Provisión Real": { $ne: 0 } } }, { $project: projectStage }]).exec();

            response.content = rows;
            response.result = 'OK';

        } catch (e) {
            console.log(e);
        }

        res.json(response);
    });

// managerRouter.route('/cr-individual')
//     .get(async (req, res) => {
        
//         const { provCR_individual } = await db()
//         let response = { result: 'NOK' }, body = req.body;
//         let payload = []

//         try {

//             console.log("======================= INIT ========================")

//             const rows = await provCR_individual.aggregate([{ $project: projectCRtStage }]).exec();
           
//             console.log("======================= FIN ========================")
//             // console.log(rows)

//             response.content = rows;
//             response.result = 'OK';

//         } catch (e) {
//             console.log(e);
//         }

//         res.json(response);
//     });



managerRouter.route('/cr-individual')
    .get(async (req, res) => {
        const { provCR_individual } = await db();
        const response = { result: 'NOK' };

        try {

            const match = {
                "Código Proyecto": { $not: /^OPEX/i },
            };

            // 2) Pipeline: filtra -> pagina -> renombra
            const pipeline = [
                { $match: match },
                // { $sort: { _id: -1 } },
                // { $limit: lim },
                { $project: projectStageCR },
            ];
   
            
            // const docs = await provCR_individual
            //     .find({}, projection)
            //     .lean()
            //     .exec();

            const rows = await provCR_individual
                .aggregate(pipeline)
                .allowDiskUse(true)
                .exec();

            // const rows = docs.map(doc => {
            //     const out = {};
            //     for (const [oldK, newK] of entriesCR) {
            //     out[newK] = doc[oldK];
            //     }
            //     return out;
            // });

            response.content = rows;
            response.result = 'OK';
        } catch (e) {
            console.error(e);
            return res.status(500).json({ result: "ERROR" });
        }

        res.json(response);
    });


// GET UNIQUE PAs FILTERS
managerRouter.get("/get-crs-filter-options", async (req, res) => {
    try {
        const { provCR_individual } = await db();

        const getDbField = (apiKey) => API_TO_DB_CR[apiKey] ?? apiKey;

        const cleanDistinct = async (apiKey, q = {}) => {
            const dbField = getDbField(apiKey);

            const values = await provCR_individual.distinct(dbField, {
                ...q,
                [dbField]: {
                    $nin: [null, ""],
                },
            });

            return [...new Set(
                values
                    .filter((value) => value != null && value !== "")
                    .map((value) => String(value).trim())
                    .filter(Boolean)
            )].sort((a, b) => a.localeCompare(b));
        };

        const [
            estado_oc,
            proveedor,
            pm_actual,
            requisitor
        ] = await Promise.all([
            cleanDistinct("estado_oc"),
            cleanDistinct("proveedor"),
            cleanDistinct("pm_actual"), 
            cleanDistinct("requisitor")
        ]);

        return res.json({
            result: "OK",
            content: {
                estado_oc,
                proveedor,
                pm_actual,
                requisitor
            },
        });
    } catch (e) {
        console.error("Error get-crs-filter-options:", e);
        return res.status(500).json({
            result: "ERROR",
            message: "Error al obtener opciones de filtros",
        });
    }
});

managerRouter.route('/cr-individual-q')
    .get(async (req, res) => {
        let response = { result: 'NOK' };

        try {
            const { provCR_individual } = await db();

            const {
                estado_oc,
                proveedor,
                pm_actual,
                requisitor,
                search = "",
                page = 1,
                limit = 10,
                sortBy = "ticket_code",
                sortDirection = "desc"
            } = req.query;

            const currentPage = Math.max(parseInt(page, 10) || 1, 1);
            const perPage = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50000);
            const skip = (currentPage - 1) * perPage;

            // Campos permitidos para ordenar
            const allowedSortFields = new Set([
                "tipo"
            ]);

            const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "ticket_code";
            const safeSortDirection = String(sortDirection).toLowerCase() === "asc" ? -1 : 1;

            // Query base de sites
            const q = {};   

            if(estado_oc) q[API_TO_DB_CR.estado_oc] = estado_oc;
            if(proveedor) q[API_TO_DB_CR.requisitor] = proveedor;
            if(pm_actual) q[API_TO_DB_CR.categoria] = pm_actual;
            if(requisitor) q[API_TO_DB_CR.categoria] = requisitor;
            API_TO_DB_CR["codigo_proyecto"] = { $not: /^OPEX/i };

            // Búsqueda
            if (String(search).trim()) {
                const rx = new RegExp(escapeRegex(String(search).trim()), "i");

                q.$or = [
                    { [API_TO_DB_CR.codigo_proyecto]: rx },
                    { [API_TO_DB_CR.nombre_proyecto]: rx },
                    { [API_TO_DB_CR.inversion_subrubro]: rx },
                    { [API_TO_DB_CR.rq]: rx },
                    { [API_TO_DB_CR.nro_oc]: rx },
                    { [API_TO_DB_CR.acuerdo]: rx },
                    { [API_TO_DB_CR.codigo_recepcion]: rx },
                ];
            }

            // Traer solo los campos necesarios (y las fechas para calcular maxDate)
            // Total + página actual de sites
            const [totalResults, crs] = await Promise.all([
                provCR_individual.countDocuments(q),
                provCR_individual
                    .find(q)
                    .sort({
                        [safeSortBy]: safeSortDirection,
                        _id: -1,
                    })
                    .skip(skip)
                    .limit(perPage)
                    .lean(),
            ]);

            // Si no hay sites, responder vacío
            if (!crs.length) {
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

            const normalizeInPlace = (obj) => {
                for (const [from, to] of entriesCR) {
                    if (Object.prototype.hasOwnProperty.call(obj, from)) {
                    obj[to] = obj[from];
                    delete obj[from];
                    }
                }
                return obj;
            };

            // const payload = res.map(p => normalizeWithMap(p));
            const payload = crs.map(p => normalizeInPlace(p));

            return res.json({
                result: "OK",
                content: {
                    items: payload,
                    totalResults,
                    totalPages: Math.ceil(totalResults / perPage),
                    currentPage
                },
            });

        
        } catch (e) {
            console.error(e);
            return res.status(500).json({ result: "ERROR" });
        }

    });


managerRouter.route('/cr-detalles-line-oc')
    .get(async (req, res) => {
        const { provCR_individual } = await db();
        const { oc } = req.query

        // console.log("req", req.query)
        // console.log("oc", oc)

        const response = { result: 'NOK' };

        try {

            let ocList = [];

            // if (Array.isArray(oc)) {
            //     ocList = oc.map(x => String(x).trim()).filter(Boolean);
            // } else if (typeof oc === "string") {
            //     ocList = oc.split(",").map(x => x.trim()).filter(Boolean);
            // }

            if (Array.isArray(oc)) {
                ocList = oc
                    .map(x => String(x).trim())
                    .filter(x => x !== "")
                    .map(x => Number(x))
                    .filter(Number.isFinite);
            } else if (typeof oc === "string") {
                ocList = oc
                    .split(",")
                    .map(x => x.trim())
                    .filter(x => x !== "")
                    .map(x => Number(x))
                    .filter(Number.isFinite);
            }

            // console.log("ocList", ocList)

            // const match = {
            //     "Código Proyecto": { $not: /^OPEX/i },
            //     "Nro OC": { $in: oc ?? [] }
            // };

            const match = {
                "Código Proyecto": { $not: /^OPEX/i },
                ...(ocList.length > 0 && { "Nro OC": { $in: ocList } })
            };

            // console.log("match", match)

            // 2) Pipeline:
            const pipeline = [
                { $match: match },
                { $project: projectStageCR },
            ];

            const rows = await provCR_individual
                .aggregate(pipeline)
                .allowDiskUse(true)
                .exec();

            // console.log("rows", rows)

            response.content = rows;
            response.result = 'OK';
        } catch (e) {
            console.error(e);
            return res.status(500).json({ result: "ERROR" });
        }

        res.json(response);
    });




managerRouter.route('/lista-proyectos')
    .get(async (req, res) => {

        const { provInvestment_lines }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await provInvestment_lines.find();
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/pm-tree')
    .get(async (req, res) => {
        const { provLine_monthly_ledger } = await db()
        const { provInvestment_lines } = await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            // 1) Solo dos parámetros
            const useFcstActual = String(req.query.FCST_Actual || "false").toLowerCase() === "true";
            const FCST_mes = parseInt(req.query.FCST_mes, 10);
            if (!FCST_mes || FCST_mes < 1 || FCST_mes > 12) {
                return res.status(400).json({ error: "FCST_mes debe estar entre 1 y 12" });
            }

            // 2) Agregación: comprometido y actas acumulados hasta FCST_mes (cualquier año)

            const pipeline = [
                { $match: { month: { $lte: FCST_mes }, metric: { $in: ["comprometido","acta"] } } },
                { $group: {
                    _id: { line_id: "$line_id", metric: "$metric" },
                    amount: { $sum: "$amount" }
                }},
                { $group: {
                    _id: "$_id.line_id",
                    comprometido: { $sum: { $cond: [{ $eq: ["$_id.metric","comprometido"] }, "$amount", 0] } },
                    actas:        { $sum: { $cond: [{ $eq: ["$_id.metric","acta"] }, "$amount", 0] } }
                }},
                { $lookup: {
                    from: "investment_lines",    // nombre de la colección, no el modelo
                    localField: "_id",
                    foreignField: "_id",
                    as: "line"
                }},
                { $unwind: "$line" },
                { $project: {
                    _id: 0,
                    line_id: "$_id",
                    comprometido: 1,
                    actas: 1,
                    pm_name: "$line.pm_name",
                    project_id: "$line.project_id",
                    project_name: "$line.project_name",
                    line_ref: "$line.line_ref",
                    line_name: "$line.name",
                    fcst_actual: "$line.fcst_actual",
                    fcst_a_mes: "$line.fcst_a_mes"
                }}
            ];

            const rows = await provLine_monthly_ledger.aggregate(pipeline).exec();

            // 3) Transformación al DTO solicitado con campos dinámicos
            const fcstKey = `fcst${MONTH_LABEL[FCST_mes]}`;        // p.ej. "fcstAgosto"
            const pendKey = `pendMeta${MONTH_LABEL[FCST_mes]}`;    // p.ej. "pendMetaAgosto"

            const byPM = new Map(); // pmSlug -> { id, nombre, projects: Map(project_id -> { ... }) }

            const num = v => (typeof v === "number" && !Number.isNaN(v)) ? v : 0;

            for (const r of rows) {
                const pmNombre = r.pm_name || "PM SIN NOMBRE";
                const pmId = SLUG(pmNombre);

                const pmNode = byPM.get(pmId) || { id: pmId, nombre: pmNombre, projects: new Map() };
                byPM.set(pmId, pmNode);

                const projId = r.project_id;
                const projNombre = r.project_name || "SIN PROYECTO";
                const projNode = pmNode.projects.get(projId) || { id: projId, nombre: projNombre, lines: [] };
                pmNode.projects.set(projId, projNode);

                // elegir FCST según parámetro
                const fcstToUse = useFcstActual
                ? num(r.fcst_actual)
                : (r.fcst_a_mes && r.fcst_a_mes.month && r.fcst_a_mes.month <= FCST_mes
                    ? num(r.fcst_a_mes.value) : 0);

                const lineNombre = `${r.line_ref ? r.line_ref + "-" : ""}${r.line_name || ""}`.trim();

                projNode.lines.push({
                    id: r.line_id,
                    nombre: lineNombre,
                    [fcstKey]: fcstToUse,
                    comprometido: num(r.comprometido),
                    actas: num(r.actas),
                    [pendKey]: Math.max(0, fcstToUse - num(r.actas))
                });
            }

            // 4) Materializar y ordenar
            const payload = [...byPM.values()].map(pm => ({
                id: pm.id,
                nombre: pm.nombre,
                projects: [...pm.projects.values()].map(p => ({
                id: p.id,
                nombre: p.nombre,
                lines: p.lines.sort((a,b) => a.nombre.localeCompare(b.nombre))
                }))
            }))
            .sort((a,b) => a.nombre.localeCompare(b.nombre));

            response.content = payload;
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    }); 

managerRouter.route('/save-data')
    .post(async (req, res) => {
        const { provSst }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await provSst.create(body);
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/load-to-db')
    .post(async (req, res) => {

        const { provSst }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {
            await provSst.remove();

            let path = body.path;

            let workbook = XLSX.readFile(path,{ type: 'string', raw:true, sheetStubs: true });
            let doc = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

            response.result = 'OK';
            response.content = doc;

            for (let provider of doc){
                await provSst.create(provider);
            }

        }catch (e) {
            console.log(e);
        }

        res.json(response);
    });


// GET TICKETS
managerRouter.get("/get-tickets", async (req, res) => {
    try {
        const { provTickets } = await db();
        const { state, requester, requester_email, ticket_code, after, limit } = req.query;
        const q = {};
        if (state) q.state = state;
        if (requester) q.requester = requester;
        if (requester_email) q.requester_email = requester_email;
        if (ticket_code) q.ticket_code = ticket_code;
        if (after) q._id = { $lt: after };
        const items = await provTickets.find(q)
            .sort({ _id: -1 })
            .limit(Math.min(parseInt(limit, 10) || 5000, 10000))
            .select("ticket_code ticket_name requester requester_email state sites_count total_cotizacion ticket_jira rq date_request date_update file sustentos active_batch_id comments createdAt updatedAt")
            .lean();
        res.json({
            result: "OK",
            content: {
                items,
                nextCursor: items.length ? items[items.length - 1]._id : null,
            },
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ result: "ERROR" });
    }
});


// GET UNIQUE TICKETSS FILTERS
managerRouter.get("/get-tickets-filter-options", async (req, res) => {
    try {
        const { provTickets } = await db();

        const cleanDistinct = async (field, q = {}) => {
            const values = await provTickets.distinct(field, {
                ...q,
                [field]: {
                    $nin: [null, ""],
                },
            });

            return values
                .filter((value) => value != null && value !== "")
                .map((value) => String(value).trim())
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b));
        };

        const [
            ticket_code,
            ticket_name,
            requester,
            requester_email,
            state,
            ticket_jira
        ] = await Promise.all([
            cleanDistinct("ticket_code"),
            cleanDistinct("ticket_name"),
            cleanDistinct("requester"),
            cleanDistinct("requester_email"),
            cleanDistinct("state"),
            cleanDistinct("ticket_jira"),
        ]);

        return res.json({
            result: "OK",
            content: {
                ticket_code: ticket_code,
                ticket_name: ticket_name,
                requester: requester,
                requester_email: requester_email,
                state: state,
                ticket_jira: ticket_jira,
            },
        });
    } catch (e) {
        console.error("Error get-ticetks-filter-options:", e);
        return res.status(500).json({
            result: "ERROR",
            message: "Error al obtener opciones de filtros",
        });
    }
});

// GET TICKETS
managerRouter.get("/get-tickets-q", async(req, res) => {
    try {

        const { provTickets } = await db()

        const {
            ticket_code,
            state,
            requester,
            requester_email,
            ticket_jira,
            search = "",
            page = 1,
            limit = 10,
            sortBy = "ticket_code",
            sortDirection = "desc"
        } = req.query;

        // Paginación
        const currentPage = Math.max(parseInt(page, 10) || 1, 1);
        const perPage = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 5000);
        const skip = (currentPage - 1) * perPage;

        // Campos permitidos para ordenar
        const allowedSortFields = new Set([
            "ticket_code",
            "ticket_name",
            "requester",
            "sites_count",
            "total_cotizacion",
            "state",
            "ticket_jira",
            "createdAt"
        ]);

        const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "ticket_code";
        const safeSortDirection = String(sortDirection).toLowerCase() === "asc" ? -1 : 1;

        // Query base de sites
        const q = {};
        
        if (state) q.state = state;
        if (requester) q.requester = requester;
        if (requester_email) q.requester_email = requester_email;
        if (ticket_code) q.ticket_code = ticket_code;
        if (ticket_jira) q.ticket_jira = ticket_jira;

        // Búsqueda
        if (String(search).trim()) {
            const rx = new RegExp(escapeRegex(String(search).trim()), "i");

            q.$or = [
                { ticket_code: rx },
                { ticket_name: rx },
                { ticket_jira: rx },
                { requester: rx },
            ];
        }

        const ticketProjection = {
            ticket_code: 1,
            ticket_name: 1,
            requester: 1,
            requester_email: 1,
            sites_count: 1,
            total_cotizacion: 1,
            state: 1,
            ticket_jira: 1,
            createdAt: 1,
            updatedAt: 1,
            file: 1,
            sustentos: 1,
            _id: 1,
            comments: 1
        };

        // Total + página actual de sites
        const [totalResults, ticket] = await Promise.all([
            provTickets.countDocuments(q),
            provTickets
                .find(q, ticketProjection)
                .sort({
                    [safeSortBy]: safeSortDirection,
                    _id: -1,
                })
                .skip(skip)
                .limit(perPage)
                .lean(),
        ]);

        // Si no hay sites, responder vacío
        if (!ticket.length) {
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

        return res.json({
            result: "OK",
            content: {
                items: ticket,
                totalResults,
                totalPages: Math.ceil(totalResults / perPage),
                currentPage
            },
        });


    } catch (e) {

        console.error(e);
        return res.status(500).json({ result: "ERROR" });
    }
})



// GET SITES
managerRouter.get("/get-sites", async (req, res) => {
    try {
    const { provSites } = await db();
    const {
        ticket_id,
        ticket_code,
        estado,
        proveedor,
        requester,
        requester_email,
        llave,
        id_proyecto,
        jefatura,
        after,
        limit,
    } = req.query;

    const q = {};

    if (ticket_id) q.ticket_id = ticket_id;
    if (ticket_code) q.ticket_code = ticket_code; // si lo tienes en sites
    if (estado) q.estado = estado;
    if (proveedor) q.proveedor = proveedor;
    if (requester) q.requester = requester;
    if (requester_email) q.requester_email = requester_email;
    if (llave) q.llave = llave;
    if (id_proyecto) q.id_proyecto = id_proyecto;
    if (jefatura) q.jefatura = jefatura;
    if (after) q._id = { $lt: after };

    const pipeline = [
        { $match: q },
        { $sort: { _id: -1 } },
        { $limit: Math.min(parseInt(limit, 10) || 10000, 10000) },
        { $project: {
            ticket_id: 1,
            nro: 1,
            identificador: 1,
            sitio: 1,
            actividad: 1,
            solucion: 1,
            proveedor: 1,
            sustento: 1,
            acuerdo_compras: 1,
            coordinador: 1,
            moneda: 1,
            cantidad: 1,
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
            ticket_code: 1,
            batch_id: 1,
            llave: 1,
            estado: 1,
            ticket_jira: 1,
            fecha_creacion: 1,
            requester: 1,
            requester_email: 1,
            rq: 1,
            comentarios: 1,
            createdAt: 1,
            updatedAt: 1
        } },
    ]

    // const items = await provSites.find(q)
    //     .sort({ _id: -1 })
    //     .limit(Math.min(parseInt(limit, 10) || 10000, 10000))
    //     .select("ticket_id nro identificador sitio actividad solucion proveedor sustento acuerdo_compras coordinador moneda cantidad precio_unitario total_cotizacion fecha_registro fecha_inicio_servicio fecha_fin_servicio descripcion_adicional id_proyecto nombre_proyecto linea_inversion articulo jefatura ticket_code batch_id llave estado ticket_jira fecha_creacion requester requester_email rq comentarios createdAt updatedAt")
    //     .lean();

    const items = await provSites.aggregate(pipeline)
        .allowDiskUse(true) 
        .exec();

    res.json({
        result: "OK",
        content: {
            items,
            nextCursor: items.length ? items[items.length - 1]._id : null,
        },
    });
    } catch (e) {
        console.error(e);
        res.status(500).json({ result: "ERROR" });
    }
});


// GET OC SITES
function escapeRegex(text = "") {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// GET UNIQUE OC SITES FILTERS
managerRouter.get("/get-oc-sites-filter-options", async (req, res) => {
    try {
        const { provSites } = await db();

        const cleanDistinct = async (field, q = {}) => {
            const values = await provSites.distinct(field, {
                ...q,
                [field]: {
                    $nin: [null, ""],
                },
            });

            return values
                .filter((value) => value != null && value !== "")
                .map((value) => String(value).trim())
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b));
        };

        const [
            jefaturas,
            unidad_funcionales,
            coordinadores,
            proyectos,
            nombresProyecto,
            lineasInversion,
            proveedores,
            estados,
            tickets,
            requesters,
            acuerdo_compras,
        ] = await Promise.all([
            cleanDistinct("jefatura"),
            cleanDistinct("unidad_funcional"),
            cleanDistinct("coordinador"),
            cleanDistinct("id_proyecto"),
            cleanDistinct("nombre_proyecto"),
            cleanDistinct("linea_inversion"),
            cleanDistinct("proveedor"),
            cleanDistinct("estado"),
            cleanDistinct("ticket_code"),
            cleanDistinct("requester"),
            cleanDistinct("acuerdo_compras"),
        ]);

        return res.json({
            result: "OK",
            content: {
                jefatura: jefaturas,
                unidad_funcional: unidad_funcionales,
                coordinador: coordinadores,
                id_proyecto: proyectos,
                nombre_proyecto: nombresProyecto,
                linea_inversion: lineasInversion,
                proveedor: proveedores,
                estado: estados,
                ticket_code: tickets,
                requester: requesters,
                acuerdo_compras: acuerdo_compras,
            },
        });
    } catch (e) {
        console.error("Error get-oc-sites-filter-options:", e);
        return res.status(500).json({
            result: "ERROR",
            message: "Error al obtener opciones de filtros",
        });
    }
});

const NOT_VALID_STATE_SETTLEMENT = ["NA"]

// GET OC SITES
managerRouter.get("/get-oc-sites", async (req, res) => {
    try {
        const { provSites, provCR_individual } = await db();

        const {
            identificador,
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
            is_payment_2,
            status_deliverable,
            status_settlement,
            exclude_status_settlement,
            coordinador,
            requester,
            requester_email,
            assigned_to_email,
            search = "",
            page = 1,
            limit = 10,
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
        if (identificador) q.identificador = identificador;
        if (acuerdo_compras) q.acuerdo_compras = acuerdo_compras;
        if (proveedor) q.proveedor = proveedor;
        if (estado) q.estado = estado;
        if (is_payment === "true") {
            q.is_payment = true;
        }

        if (is_payment_2 === "true") {
            q.is_payment_2 = true;
        }

        if (is_payment === "false") {
            q.is_payment = { $ne: true };
        }

        if (is_payment_2 === "false") {
            q.is_payment_2 = { $ne: true };
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

        // Remove where rq !== ""
        // q.rq = { $ne: "" }

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
            estado_oc: 1,

            comentarios: 1,

            // new pagos
            is_payment: 1,
            is_payment_2: 1,
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

        // 5. Buscar después de adjuntar OC
        if (rx) {
            items = items.filter((item) => {
                return (
                    rx.test(String(item.sitio ?? "")) ||
                    rx.test(String(item.identificador ?? "")) ||
                    rx.test(String(item.nombre_proyecto ?? "")) ||
                    rx.test(String(item.id_proyecto ?? "")) ||
                    rx.test(String(item.linea_inversion ?? "")) ||
                    rx.test(String(item.proveedor ?? "")) ||
                    rx.test(String(item.ticket_code ?? "")) ||
                    rx.test(String(item.ticket_jira ?? "")) ||
                    rx.test(String(item.rq ?? "")) ||
                    rx.test(String(item.oc ?? ""))
                );
            });
        }

        // 6. Total después del search
        const totalResults = items.length;
        const totalPages = Math.ceil(totalResults / perPage);

        // 7. Paginar recién al final
        const paginatedItems = items.slice(skip, skip + perPage);

        return res.json({
            result: "OK",
            content: {
                items: paginatedItems,
                totalResults,
                totalPages,
                currentPage,
            },
        });

    } catch (e) {
        console.error(e);
        return res.status(500).json({ result: "ERROR" });
    }
});


const DAY_MS = 1000 * 60 * 60 * 24;

function addDaysUTC(input, days) {
    const date = new Date(input);
    date.setUTCDate(date.getUTCDate() + days);
    return date;
}

function getMonthInfoFromWeek(weekStart) {
    // El jueves representa mejor el mes predominante de la semana ISO
    const referenceDate = addDaysUTC(weekStart, 3);

    const monthKey = [
        referenceDate.getUTCFullYear(),
        String(referenceDate.getUTCMonth() + 1).padStart(2, "0"),
    ].join("-");

    const monthLabel = new Intl.DateTimeFormat("es-PE", {
        month: "short",
        timeZone: "UTC",
    })
        .format(referenceDate)
        .replace(".", "")
        .replace(/^./, (letter) => letter.toUpperCase());

    return {
        monthKey,
        monthLabel,
        monthNumber: referenceDate.getUTCMonth() + 1,
        monthYear: referenceDate.getUTCFullYear(),
    };
}

function parseDateSafe(value) {
    if (!value) return null;

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    const text = String(value).trim();
    if (!text) return null;

    // DD/MM/YYYY o DD-MM-YYYY
    const match = text.match(
        /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
    );

    if (match) {
        const [
            ,
            day,
            month,
            year,
            hour = "0",
            minute = "0",
            second = "0",
        ] = match;

        const date = new Date(Date.UTC(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hour),
            Number(minute),
            Number(second)
        ));

        return Number.isNaN(date.getTime()) ? null : date;
    }

    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
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

function startOfDayUTC(date) {
    return Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
    );
}

function differenceInCalendarDays(startDate, endDate) {
    return Math.floor(
        (startOfDayUTC(endDate) - startOfDayUTC(startDate)) / DAY_MS
    );
}

function startOfISOWeekUTC(input) {
    const date = new Date(Date.UTC(
        input.getUTCFullYear(),
        input.getUTCMonth(),
        input.getUTCDate()
    ));

    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1); // lunes
    date.setUTCHours(0, 0, 0, 0);

    return date;
}

function addWeeksUTC(input, weeks) {
    const date = new Date(input);
    date.setUTCDate(date.getUTCDate() + weeks * 7);
    return date;
}

function getISOWeekInfo(input) {
    const date = new Date(Date.UTC(
        input.getUTCFullYear(),
        input.getUTCMonth(),
        input.getUTCDate()
    ));

    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);

    const isoYear = date.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 1));

    const isoWeek = Math.ceil((((date - yearStart) / DAY_MS) + 1) / 7);

    return { year: isoYear, week: isoWeek };
}

function getWeekKey(date) {
    return startOfISOWeekUTC(date).toISOString().slice(0, 10);
}

function round1(value) {
    return Math.round(value * 10) / 10;
}

function toMM(value) {
    return value / 1_000_000;
}

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

    const avgWeeklyRQ =
        weekly.reduce((acc, row) => acc + row.rqAmount, 0) / weeks;

    const avgWeeklyOC =
        weekly.reduce((acc, row) => acc + row.ocAmount, 0) / weeks;

    const avgWeeklyPayment =
        weekly.reduce((acc, row) => acc + row.paymentAmount, 0) / weeks;

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

function buildOcAging(items) {
    const buckets = [
        {
            key: "0_10",
            label: "0 - 10 días",
            min: 0,
            max: 10,
            amount: 0,
            count: 0,
        },
        {
            key: "11_15",
            label: "11 - 15 días",
            min: 11,
            max: 15,
            amount: 0,
            count: 0,
        },
        {
            key: "16_20",
            label: "16 - 20 días",
            min: 16,
            max: 20,
            amount: 0,
            count: 0,
        },
        {
            key: "over_21",
            label: "+ 21 días",
            min: 21,
            max: Infinity,
            amount: 0,
            count: 0,
        },
    ];

    const pending = {
        count: 0,
        amount: 0,
    };

    const invalid = {
        missingCreationDate: 0,
        ocBeforeCreation: 0,
        invalidAmount: 0,
    };

    for (const item of items) {
        const creationDate = parseDateSafe(item.fecha_creacion);
        const ocDate = parseDateSafe(item.fecha_oc);
        const amount = toNumberSafe(item.total_cotizacion);

        if (!creationDate) {
            invalid.missingCreationDate += 1;
            continue;
        }

        /*
         * Sin fecha OC no entra en los rangos completados.
         * Se reporta separadamente como pendiente.
         */
        if (!ocDate) {
            pending.count += 1;
            pending.amount += amount;
            continue;
        }

        const elapsedDays = differenceInCalendarDays(
            creationDate,
            ocDate
        );

        if (elapsedDays < 0) {
            invalid.ocBeforeCreation += 1;
            continue;
        }

        if (amount <= 0) {
            invalid.invalidAmount += 1;
        }

        const bucket = buckets.find(
            (range) =>
                elapsedDays >= range.min &&
                elapsedDays <= range.max
        );

        if (!bucket) continue;

        bucket.amount += amount;
        bucket.count += 1;
    }

    const totalAmount = buckets.reduce(
        (sum, bucket) => sum + bucket.amount,
        0
    );

    const totalCount = buckets.reduce(
        (sum, bucket) => sum + bucket.count,
        0
    );

    return {
        ranges: buckets.map((bucket) => ({
            key: bucket.key,
            label: bucket.label,
            minDays: bucket.min,
            maxDays:
                Number.isFinite(bucket.max)
                    ? bucket.max
                    : null,

            amount: round1(bucket.amount),
            amountMM: round1(bucket.amount / 1_000_000),

            count: bucket.count,

            percentage:
                totalAmount > 0
                    ? round1((bucket.amount / totalAmount) * 100)
                    : 0,
        })),

        totals: {
            amount: round1(totalAmount),
            amountMM: round1(totalAmount / 1_000_000),
            count: totalCount,
        },

        pending: {
            count: pending.count,
            amount: round1(pending.amount),
            amountMM: round1(pending.amount / 1_000_000),
        },

        invalid,
    };
}


// GET OC SITES
managerRouter.get("/get-oc-sites-weekly-velocity", async (req, res) => {
    try {
        const { provSites, provCR_individual } = await db();

        const {
            identificador,
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
            is_payment_2,
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
        if (identificador) q.identificador = identificador;
        if (acuerdo_compras) q.acuerdo_compras = acuerdo_compras;
        if (proveedor) q.proveedor = proveedor;
        if (estado) q.estado = estado;
        if (is_payment === "true") {
            q.is_payment = true;
        }

        if (is_payment_2 === "true") {
            q.is_payment_2 = true;
        }

        if (is_payment === "false") {
            q.is_payment = { $ne: true };
        }

        if (is_payment_2 === "false") {
            q.is_payment_2 = { $ne: true };
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

        // Remove where rq !== ""
        // q.rq = { $ne: "" }

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
            is_payment_2: 1,
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

        const weeklyAmountTrend = buildWeeklyAmountTrend(items, {
            weeks: 7,
            includeCurrentWeek: true,
        });

        const ocAging = buildOcAging(items);

        // Paginación después del cálculo
        const totalResults = items.length;
        const totalPages = Math.ceil(totalResults / perPage);

        const paginatedItems = items.slice(
            skip,
            skip + perPage
        );

        return res.json({
            result: "OK",
            content: {
                totalResults,
                weeklyAmountTrend,
                ocAging
            },
        });

    } catch (e) {
        console.error(e);
        return res.status(500).json({ result: "ERROR" });
    }
});


// TEST
// GET OC SITES
managerRouter.get("/get-oc-sites-test", async (req, res) => {
    try {
        const { provSites, provCR_individual } = await db();

        const {
            identificador,
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
            is_payment_2,
            status_deliverable,
            status_settlement,
            exclude_status_settlement,
            coordinador,
            requester,
            requester_email,
            assigned_to_email,
            search = "",
            page = 1,
            limit = 10,
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
        if (identificador) q.identificador = identificador;
        if (acuerdo_compras) q.acuerdo_compras = acuerdo_compras;
        if (proveedor) q.proveedor = proveedor;
        if (estado) q.estado = estado;
        if (is_payment === "true") {
            q.is_payment = true;
        }

        if (is_payment_2 === "true") {
            q.is_payment_2 = true;
        }

        if (is_payment === "false") {
            q.is_payment = { $ne: true };
        }

        if (is_payment_2 === "false") {
            q.is_payment_2 = { $ne: true };
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

        // Remove where rq !== ""
        // q.rq = { $ne: "" }

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
            estado_oc: 1,

            comentarios: 1,

            // new pagos
            is_payment: 1,
            is_payment_2: 1,
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

        let items = attachRQLineaOC(sites, crs);

        // 5. Buscar después de adjuntar OC
        if (rx) {
            items = items.filter((item) => {
                return (
                    rx.test(String(item.sitio ?? "")) ||
                    rx.test(String(item.identificador ?? "")) ||
                    rx.test(String(item.nombre_proyecto ?? "")) ||
                    rx.test(String(item.id_proyecto ?? "")) ||
                    rx.test(String(item.linea_inversion ?? "")) ||
                    rx.test(String(item.proveedor ?? "")) ||
                    rx.test(String(item.ticket_code ?? "")) ||
                    rx.test(String(item.ticket_jira ?? "")) ||
                    rx.test(String(item.rq ?? "")) ||
                    rx.test(String(item.oc ?? ""))
                );
            });
        }

        // 6. Total después del search
        const totalResults = items.length;
        const totalPages = Math.ceil(totalResults / perPage);

        // 7. Paginar recién al final
        const paginatedItems = items.slice(skip, skip + perPage);

        return res.json({
            result: "OK",
            content: {
                items: paginatedItems,
                totalResults,
                totalPages,
                currentPage,
            },
        });

    } catch (e) {
        console.error(e);
        return res.status(500).json({ result: "ERROR" });
    }
});



// Download Ticket File
managerRouter.get("/download-ticket-file", async (req, res) => {
    try {
        const { provTickets } = await db();
        const { ticket_code, name } = req.query;

        console.log("name", name)

        if (!ticket_code) {
            return res.status(400).json({ result: "NOK", msg: "ticket_code es requerido" });
        }

        // Buscar por ticket_code (no por _id)
        const ticket = await provTickets
            .findOne({ ticket_code })
            .select("file ticket_code sustentos")
            .lean();

        if (!ticket) {
            return res.status(404).json({ result: "NOK", msg: "Ticket no encontrado" });
        }

        // const file = ticket.file;

        let list = []

        if (ticket.sustentos) {
            list.push(...ticket.sustentos)
        }

        if (ticket.file) {
            list.push(ticket.file)
        }

        // const list = ticket.sustentos || ticket.file || [];

        console.log("LIST", list)

        const file = list.find(f => f.originalName === name);

        console.log("FILE", file)

        if (!file || !file.path) {
            return res.status(404).json({ result: "NOK", msg: "Archivo no encontrado" });
        }

        const filePath = path.resolve(file.path);

        // Validar existencia física
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ result: "NOK", msg: "Archivo no existe en disco" });
        }

        // (Opcional pero recomendado) restringir descargas a carpeta permitida
        const allowedBase = path.resolve("/data/html/planner_app_gcir/resources");
        if (!filePath.startsWith(allowedBase)) {
            return res.status(403).json({ result: "NOK", msg: "Ruta no permitida" });
        }

        // Nombre a mostrar al descargar (preferir original)
        const downloadName = file.originalName || file.filename || path.basename(filePath);

        // Opcional: setear mimetype explícitamente
        if (file.mimetype) {
            res.setHeader("Content-Type", file.mimetype);
        }

        // Descarga real del archivo (NO enviar la ruta como texto)
        return res.download(filePath, downloadName, (err) => {
            if (err) {
                console.error("Error en descarga:", err);
                if (!res.headersSent) {
                return res.status(500).json({ result: "ERROR", msg: "No se pudo descargar el archivo" });
                }
            }
        });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ result: "ERROR", msg: String(e.message ?? e) });
    }
});

// managerRouter.get("/download-ticket-file", async (req, res) => {
//     try {
//         const { provTickets } = await db();
//         const { ticket_code, filename, type = "file" } = req.query;

//         if (!ticket_code) {
//             return res.status(400).json({ result: "NOK", msg: "ticket_code es requerido" });
//         }

//         const ticket = await provTickets
//             .findOne({ ticket_code })
//             .select("file sustentos ticket_code")
//             .lean();

//         if (!ticket) {
//             return res.status(404).json({ result: "NOK", msg: "Ticket no encontrado" });
//         }

//         let selectedFile = null;

//         // Archivo principal
//         if (type === "file") {
//             selectedFile = ticket.file || null;
//         }

//         // Archivo dentro del array sustentos
//         if (type === "sustento") {
//             if (!filename) {
//                 return res.status(400).json({
//                     result: "NOK",
//                     msg: "filename es requerido para descargar un sustento"
//                 });
//             }

//             selectedFile = (ticket.sustentos || []).find(f => f.filename === filename) || null;
//         }

//         if (!selectedFile || !selectedFile.path) {
//             return res.status(404).json({ result: "NOK", msg: "Archivo no encontrado" });
//         }

//         const filePath = path.resolve(selectedFile.path);

//         if (!fs.existsSync(filePath)) {
//             return res.status(404).json({ result: "NOK", msg: "Archivo no existe en disco" });
//         }

//         const allowedBase = path.resolve("/data/html/planner_app_gcir/resources");
//         if (!filePath.startsWith(allowedBase)) {
//             return res.status(403).json({ result: "NOK", msg: "Ruta no permitida" });
//         }

//         const downloadName =
//             selectedFile.originalName ||
//             selectedFile.filename ||
//             path.basename(filePath);

//         if (selectedFile.mimetype) {
//             res.setHeader("Content-Type", selectedFile.mimetype);
//         }

//         return res.download(filePath, downloadName, (err) => {
//             if (err) {
//                 console.error("Error en descarga:", err);
//                 if (!res.headersSent) {
//                     return res.status(500).json({
//                         result: "ERROR",
//                         msg: "No se pudo descargar el archivo"
//                     });
//                 }
//             }
//         });
//     } catch (e) {
//         console.error(e);
//         return res.status(500).json({ result: "ERROR", msg: String(e.message ?? e) });
//     }
// });



managerRouter.post("/insert-tickets",
    // uploadTicketExcel.single("file"), // el archivo viene en req.file (opcional)
    uploadTicketExcel.fields([
        { name: "file", maxCount: 1 },
        { name: "fileSustentos", maxCount: 30 }
    ]),
    async (req, res) => {
        try {
            const { provTickets, provSites } = await db();
            // 1) parsear JSON strings (multipart)
            const ticketData = req.body.ticketData ? JSON.parse(req.body.ticketData) : {};
            const parsedSites = req.body.parsedSites ? JSON.parse(req.body.parsedSites) : [];

            // 2) generar código y batch
            const prefix = "SRQ";
            const ticket_code = await nextTicketCode(prefix, 5);
            const batchId = makeBatchId();
            // 3) crear ticket
            const t = await provTickets.create({
                ...ticketData,
                ticket_code,
                state: ticketData.state ?? "Pendiente CT",
                import_status: "PROCESSING",
                active_batch_id: batchId,
                sites_count: 0,
                total_cotizacion: 0,
                ticket_jira: "",
                rq: "",
                date_request: new Date(),
                date_update: new Date(),
            });
            // 4) mover archivo (si vino) a carpeta del ticket
            let fileMeta = null;

            const mainFile = req.files?.file?.[0] || null

            if (mainFile) {
                const dir = path.join(UPLOAD_ROOT, String(t.ticket_code));

                ensureDir(dir);
                const finalPath = path.join(dir, mainFile.filename);
                fs.renameSync(mainFile.path, finalPath); // mueve de tmp → tickets/<id>/
                fileMeta = {
                    originalName: mainFile.originalname,
                    filename: mainFile.filename,
                    mimetype: mainFile.mimetype,
                    size: mainFile.size,
                    uploadedAt: new Date(),
                    path: finalPath
                };
                await provTickets.updateOne(
                    { _id: t._id },
                    { $set: { file: fileMeta } }
                );
            }

            let fileMetaSustentos = [];

            const sustentosFiles = req.files?.fileSustentos || []

            if (sustentosFiles.length > 0) {
                const dir = path.join(UPLOAD_SUSTENTOS, String(t.ticket_code));

                // fileSustentos is ARRAY ALL ITEMS has fileMetaSustentos

                ensureDir(dir);
                // const finalPath = path.join(dir, sustentosFiles.filename);
                // fs.renameSync(sustentosFiles.path, finalPath); // mueve de tmp → tickets/<id>/
                
                for (let i = 0; i < sustentosFiles.length; i++) {
                    const file = sustentosFiles[i];
                    const finalPath = path.join(dir, file.filename);
                    fs.renameSync(file.path, finalPath); // mueve de tmp → tickets/<id>/
                    fileMetaSustentos.push({
                        originalName: file.originalname,
                        filename: file.filename,
                        mimetype: file.mimetype,
                        size: file.size,
                        uploadedAt: new Date(),
                        path: finalPath
                    });
                }

                console.log("FILE META SUSTENTOS", fileMetaSustentos);

                await provTickets.updateOne(
                    { _id: t._id },
                    { $set: { sustentos: fileMetaSustentos } }
                );

                // fs.renameSync(req.fileSustentos.path, finalPath); // mueve de tmp → tickets/<id>/
                // fileMetaSustentos = {
                //     originalName: req.fileSustentos.originalname,
                //     filename: req.fileSustentos.filename,
                //     mimetype: req.fileSustentos.mimetype,
                //     size: req.fileSustentos.size,
                //     uploadedAt: new Date(),
                //     path: finalPath
                // };
                // await provTickets.updateOne(
                //     { _id: t._id },
                //     { $set: { sustentos: fileMetaSustentos } }
                // );
            }

            // 5) normalizar e insertar sites (con ticket_id + batch_id)
            const docs = (Array.isArray(parsedSites) ? parsedSites : []).map((input) => {
                const llave = (input.id_proyecto && input.linea_inversion)
                    ? `${input.id_proyecto}${extractNumericPrefix(input.linea_inversion)}`
                    : "";

                return {
                    ...input,
                    ticket_id: t._id,
                    batch_id: batchId,
                    // ticket_code: t.ticket_code,
                    ticket_code: ticket_code, 
                    llave,
                    estado: input.estado ?? "Pendiente CT",
                    comentarios: input.comentarios ?? "",
                    ticket_jira: "",
                    rq: "",
                    requester: t.requester,
                    requester_email: t.requester_email,
                    fecha_creacion: new Date(),
                    fecha_registro: input.fecha_registro ? parseExcelOrISO(input.fecha_registro) : null,
                    fecha_inicio_servicio: input.fecha_inicio_servicio ? parseExcelOrISO(input.fecha_inicio_servicio) : null,
                    fecha_fin_servicio: input.fecha_fin_servicio ? parseExcelOrISO(input.fecha_fin_servicio) : null,
                };
            });

            const inserted = docs.length
                ? await provSites.collection.insertMany(docs, { ordered: false })
                : { insertedCount: 0 };

            // Q Sitios
            const set = new Set(docs.map(d => d.identificador))
            const insertedCount = set.size;

            // Monto Total
            const totalCotizacion = docs.reduce((acc, cur) => acc + toNumber(cur.total_cotizacion), 0);
            
            // 6) finalizar ticket
            await provTickets.updateOne(
                { _id: t._id },
                {
                    $set: { import_status: "READY", import_error: "", date_update: new Date() },
                    $inc: { sites_count: insertedCount, total_cotizacion: totalCotizacion },
                }
                );
                res.json({
                result: "OK",
                content: {
                    ticket_id: t._id,
                    ticket_code,
                    sites_inserted: insertedCount,
                    total_cotizacion: totalCotizacion,
                    file: fileMeta,
                    batch_id: batchId,
                },
            });

            // SEND EMAIL
            await sendEmail(
                'normal',
                '"Workflow GCIR" <planner.notifier@entel.net.pe>',
                // to_workers,
                ticketData.requester_email,
                // ['ntt_sccopacondo@externo.entel.pe'],
                // [],
                ['caroline.carrasco.ent@viaexperis2.pe', 'cesar.guzman@entel.pe', 'ntt_sccopacondo@externo.entel.pe'],
                // cc_expiration_letter,
                `Solicitud Ticket RQ ${ticket_code}`,
                generateTicketCreatedHtml({
                    recipientName: ticketData.requester,
                    ticketCode: ticket_code
                }),
                [
                    // {
                    //     filename: `${filename}.xlsb`,
                    //     path: xlsbPath,
                    //     cid: 'footer' //same cid value as in the html img src
                    // }
                ]
            );

        } catch (e) {
            console.error(e);
            res.status(500).json({ result: "ERROR", msg: String(e.message ?? e) });
        }
    }
);


// ==========================================================
// ENDPOINT 1: Pendiente CT -> Enviado a MG
// Requiere ticket_jira, comentarios opcionales, fecha_actualizacion
// ==========================================================
managerRouter.patch(
    "/tickets/:ticketId/state/send-mg",
    uploadTicketExcel.single("file"), // se admite, pero no se usa replaceSites aquí
    async (req, res) => {
        return executeStateTransition({
            req,
            res,
            rules: {
                fromState: TICKET_STATES.PENDIENTE_CT,
                toState: TICKET_STATES.ENVIADO_MG,
                allowAnyFrom: false,
                allowReplaceSites: false,
                allowTicketJira: true,
                allowRq: false,
                propagateTicketJira: true,
                propagateRq: false,
                validate: async ({ nextTicketJira }) => {
                    if (!String(nextTicketJira ?? "").trim()) {
                        const err = new Error("ticket_jira es obligatorio para pasar a 'Enviado a MG'");
                        err.statusCode = 400;
                        throw err;
                    }
                },
            },
        });
    }
);

// ==========================================================
// ENDPOINT 2: Pendiente CT -> Observado
// Comentarios de observación, fecha_actualizacion
// ==========================================================
managerRouter.patch(
    "/tickets/:ticketId/state/observe",
    uploadTicketExcel.single("file"),
    async (req, res) => {
        return executeStateTransition({
            req,
            res,
            rules: {
                fromState: TICKET_STATES.PENDIENTE_CT,
                toState: TICKET_STATES.OBSERVADO,
                allowAnyFrom: false,
                allowReplaceSites: false,
                allowTicketJira: false,
                allowRq: false,
                propagateTicketJira: false,
                propagateRq: false,
                validate: async ({ payload }) => {
                // Si quieres volver obligatorio el comentario:
                // const txt = String(payload?.comment?.text ?? "").trim();
                // if (!txt) {
                //   const err = new Error("Comentario de observación es obligatorio");
                //   err.statusCode = 400;
                //   throw err;
                // }
                },
            },
        });
    }
);

// ==========================================================
// ENDPOINT 3: Observado -> Pendiente CT (robusto)
// Puede reemplazar sites, actualizar archivo, active_batch_id, sites_count, total_cotizacion, borrar old-batch
// ==========================================================
managerRouter.patch(
    "/tickets/:ticketId/state/return-pending",
    uploadTicketExcel.single("file"),
    async (req, res) => {
        return executeStateTransition({
        req,
        res,
        rules: {
            fromState: TICKET_STATES.OBSERVADO,
            toState: TICKET_STATES.PENDIENTE_CT,
            allowAnyFrom: false,
            allowReplaceSites: true, // ← endpoint robusto
            allowTicketJira: false,   // si quieres permitir mantener/actualizar jira
            allowRq: false,          // normalmente aquí no aplica rq
            propagateTicketJira: true,
            propagateRq: false,
            validate: async ({ payload, req }) => {
            // Si deseas exigir recarga al volver de Observado a Pendiente:
            // const replaceSites = Boolean(payload.replaceSites) || Boolean(req.file);
            // if (!replaceSites) {
            //   const err = new Error("Debe recargar archivo/sites para volver a Pendiente CT");
            //   err.statusCode = 400;
            //   throw err;
            // }
            },
        },
        });
    }
);

// ==========================================================
// ENDPOINT 4: Enviado a MG -> RQ Generada
// Requiere rq, propaga a tickets/sites, comentarios
// ==========================================================
managerRouter.patch(
    "/tickets/:ticketId/state/rq-generated",
    uploadTicketExcel.single("file"),
    async (req, res) => {
        return executeStateTransition({
        req,
        res,
        rules: {
            fromState: TICKET_STATES.ENVIADO_MG,
            toState: TICKET_STATES.RQ_GENERADO,
            allowAnyFrom: false,
            allowReplaceSites: false,
            allowTicketJira: false, // normalmente ya quedó antes
            allowRq: false,
            propagateTicketJira: false,
            propagateRq: false,
            validate: async ({ nextRq }) => {
            // if (!String(nextRq ?? "").trim()) {
            //     const err = new Error("rq es obligatorio para pasar a 'RQ Generada'");
            //     err.statusCode = 400;
            //     throw err;
            // }
            },
        },
        });
    }
);

// ==========================================================
// ENDPOINT 5: Cualquier estado -> Cancelado
// Comentarios + fecha_actualizacion
// ==========================================================
managerRouter.patch(
    "/tickets/:ticketId/state/cancel",
    uploadTicketExcel.single("file"),
    async (req, res) => {
        return executeStateTransition({
        req,
        res,
        rules: {
            fromState: null,
            toState: TICKET_STATES.CANCELADO,
            allowAnyFrom: true,      // ← cualquier estado
            allowReplaceSites: false,
            allowTicketJira: false,
            allowRq: false,
            propagateTicketJira: false,
            propagateRq: false,
            validate: async ({ currentState }) => {
            if (currentState === TICKET_STATES.CANCELADO) {
                const err = new Error("El ticket ya está cancelado");
                err.statusCode = 400;
                throw err;
            }
            },
        },
        });
    }
);

managerRouter.patch(
    "/tickets/:ticketId/state/mg-to-observe",
    uploadTicketExcel.single("file"),
    async (req, res) => {
        return executeStateTransition({
            req,
            res,
            rules: {
                fromState: TICKET_STATES.ENVIADO_MG,
                toState: TICKET_STATES.OBSERVADO,
                allowAnyFrom: false,
                allowReplaceSites: false,
                allowTicketJira: false,
                allowRq: false,
                propagateTicketJira: false,
                propagateRq: false,
                validate: async ({ payload }) => {
                // Si quieres volver obligatorio el comentario:
                // const txt = String(payload?.comment?.text ?? "").trim();
                // if (!txt) {
                //   const err = new Error("Comentario de observación es obligatorio");
                //   err.statusCode = 400;
                //   throw err;
                // }
                },
            },
        });
    }
);


// UPDATE
managerRouter.patch(
    "/tickets/update/:ticketId",
    uploadTicketExcel.single("file"), // el archivo viene en req.file (opcional)
    async (req, res) => {
        try {
            const { provTickets, provSites } = await db();
            const { ticketId } = req.params;

            // payload puede venir en multipart o en JSON
            const payload = req.body.payload
                ? JSON.parse(req.body.payload)
                : (req.body ?? {});

            console.log("PAYLOAD", payload)

            const patch = payload.patch ?? {};
            const replaceSites = Boolean(payload.replaceSites) || Boolean(req.file);
            const sites = Array.isArray(payload.sites) ? payload.sites : [];
            // const sites = payload.sites;

            const commentText = String(payload.comment?.text ?? "").trim();
            const typeComment = String(payload.comment?.type ?? "").trim();
            const authorName = String(payload.comment?.author?.name ?? "SYSTEM").trim();
            const authorEmail = String(payload.comment?.author?.email ?? "").trim();
            const clientAt = payload.comment?.clientAt ? new Date(payload.comment.clientAt) : null;

            const ticket = await provTickets.findById(ticketId);
            if (!ticket) return res.status(404).json({ result: "NOK", msg: "Ticket no existe" });

            const nextState = patch.state ?? ticket.state ?? "Pendiente CT";
            const nextJira  = patch.ticket_jira ?? ticket.ticket_jira ?? null;

            const oldBatch = ticket.active_batch_id;

            // 1) Si pidieron reemplazar sites (porque “cambió el archivo” o porque re-cargan data)
            if (replaceSites) {
                const newBatch = makeBatchId();

                const docs = sites.map((input) => {
                    const llave = (input.id_proyecto && input.linea_inversion)
                        ? `${input.id_proyecto}${extractNumericPrefix(input.linea_inversion)}`
                        : "";

                    return {
                        ...input,
                        ticket_id: ticket._id,
                        batch_id: newBatch,
                        llave,
                        ticket_jira: "",
                        // estado: input.estado ?? "Pendiente",
                        estado: nextState,
                        ticket_jira: nextJira,
                        comentarios: input.comentarios ?? "",
                        fecha_creacion: new Date(),
                        fecha_registro: input.fecha_registro ? parseExcelOrISO(input.fecha_registro) : null,
                        fecha_inicio_servicio: input.fecha_inicio_servicio ? parseExcelOrISO(input.fecha_inicio_servicio) : null,
                        fecha_fin_servicio: input.fecha_fin_servicio ? parseExcelOrISO(input.fecha_fin_servicio) : null,
                    };
                });

                if (docs.length) {
                    await provSites.collection.insertMany(docs, { ordered: false });
                }

                ticket.active_batch_id = newBatch;
                ticket.sites_count = docs.length;
                ticket.total_cotizacion = docs.reduce((acc, cur) => acc + toNumber(cur.total_cotizacion), 0);

                // borrar batch viejo (best-effort; no rompe consistencia si falla)
                if (oldBatch) {
                    provSites.deleteMany({ ticket_id: ticket._id, batch_id: oldBatch }).catch(console.error);
                }
            }

            // 2) Si vino archivo, guardamos metadata en el ticket
            if (req.file) {
                // opcional: si quieres borrar archivo anterior
                // if (ticket.file?.path && fs.existsSync(ticket.file.path)) fs.unlinkSync(ticket.file.path);
                ticket.file = {
                    originalName: req.file.originalname,
                    filename: req.file.filename,
                    mimetype: req.file.mimetype,
                    size: req.file.size,
                    uploadedAt: new Date(),
                    // path absoluto para backend
                    path: req.file.path,
                    // url pública si activaste express.static
                    // url: `/uploads/tickets/${ticketId}/${req.file.filename}`,
                };
            }

            // 3) Patch normal del ticket (sin tocar sites si replaceSites=false)
            const allowed = ["ticket_name", "requester", "state", "date_request", "date_update", "data_files", "ticket_jira"];
            
            if (patch?.state === "Enviado a MG" && !String(patch?.ticket_jira ?? "").trim()) {
                return res.status(400).json({ result: "NOK", msg: "Ticket Jira es obligatorio para pasar a Registrado" });
            }
            
            for (const k of allowed) {
                if (patch[k] !== undefined) ticket[k] = patch[k];
            }

            if (ticket.date_request) ticket.date_request = parseExcelOrISO(ticket.date_request);
            ticket.date_update = new Date();

            // 4) Comentario opcional
            if (commentText) {
                ticket.comments = ticket.comments ?? [];
                ticket.comments.push({ 
                    text: commentText, 
                    type: typeComment,
                    author: { name: authorName, email: authorEmail },
                    clientAt,
                    createdAt: new Date() 
                });
            }

            await ticket.save();


            // ✅ Propagar cambios a sites (site.estado = ticket.state)
            const siteSet = {};
            if (patch.state !== undefined) siteSet.estado = patch.state;

            // Propagar ticket jira
            if (patch.ticket_jira !== undefined) siteSet.ticket_jira = patch.ticket_jira;

            // marca fecha (opcional)
            if (Object.keys(siteSet).length) siteSet.fecha_actualizacion = new Date();

            if (Object.keys(siteSet).length) {
                // Si solo quieres tocar el batch activo:
                const filter = ticket.active_batch_id
                    ? { ticket_id: ticket._id, batch_id: ticket.active_batch_id }
                    : { ticket_id: ticket._id };

                await provSites.updateMany(filter, { $set: siteSet });
            }


            res.json({
                result: "OK",
                content: {
                    ticket_id: ticket._id,
                    state: ticket.state,
                    active_batch_id: ticket.active_batch_id,
                    sites_count: ticket.sites_count,
                    total_cotizacion: ticket.total_cotizacion,
                    file: ticket.file ?? null,
                },
            });
        } catch (e) {
            console.error(e);
            res.status(500).json({ result: "ERROR", msg: String(e.message ?? e) });
        }
    }
);


managerRouter.patch(
    "/tickets/update/site/assign-to",
    uploadTicketExcel.any(),
    async (req, res) => {
        try {
            const { provSites } = await db();
            // const { ticketId } = req.params;
            // const payload = req.body.payload

            // console.log("req.bodyt", req.body)

            const payload = req.body.payload ? JSON.parse(req.body.payload) : [];
            // console.log("payload", payload)
            // const payload = JSON.parse(req.body.payload)
            // const { ticket_code, items } = payload
            // const { items } = req.body

            // console.log("ticketId", ticketId)

            console.log("payload", payload)

            // console.log("items", items)
            // console.log("ITEMS", items)
            // console.log("req.fileSustentos", req.files?.fileSustentos)

            if (!Array.isArray(payload)) {
                return res.status(400).json({
                    result: "NOK",
                    msg: "items debe ser un array",
                })
            }

            for (const item of payload) {

                console.log("item", item)

                await provSites.updateOne(
                    { _id: item.id },
                    {
                        $set: {
                            assigned_to: item.assign_to,
                            assigned_to_email: item.assign_to_email
                        },
                    }
                )
            }

            return res.json({
                result: "OK",
                msg: "Items actualizados correctamente",
            })

        } catch (e) {
            console.log(e)
            return res.status(500).json({
                result: "NOK",
                msg: "Error interno",
            })
        }
    }
);


managerRouter.patch(
    "/tickets/update/site/:ticketId",
    uploadTicketExcel.fields([
        { name: "fileSustentos", maxCount: 30 }
    ]),
    async (req, res) => {
        try {
            const { provTickets, provSites } = await db();
            const { ticketId } = req.params;
            // const payload = req.body.payload

            // console.log("req.bodyt", req.body)

            const payload = req.body.payload ? JSON.parse(req.body.payload) : [];
            // console.log("payload", payload)
            // const payload = JSON.parse(req.body.payload)
            const { ticket_code, items } = payload
            // const { items } = req.body

            // console.log("ticketId", ticketId)

            // console.log("payload", payload)

            // console.log("items", items)
            // console.log("ITEMS", items)

            if (!ticketId) {
                return res.status(400).json({
                    result: "NOK",
                    msg: "code es requerido",
                })
            }

            if (!Array.isArray(items)) {
                return res.status(400).json({
                    result: "NOK",
                    msg: "items debe ser un array",
                })
            }

            for (const item of items) {

                await provSites.updateOne(
                    { _id: item._id },
                    {
                        $set: {
                            identificador: item.identificador,
                            sustento: item.sustento,
                            acuerdo_compras: item.acuerdo_compras,
                            proveedor: item.proveedor,
                            cantidad: item.cantidad,
                            precio_unitario: item.precio_unitario,
                            total_cotizacion: item.total_cotizacion,
                            descripcion_adicional: item.descripcion_adicional,
                            estado: item.estado,
                            rq: item.rq,
                            comentarios: item.comentarios,
                        },
                    }
                )
            }

            let fileMetaSustentos = []
            const sustentosFiles = req.files?.fileSustentos || []

            if(sustentosFiles.length > 0) {

                const dir = path.join(UPLOAD_SUSTENTOS, String(ticketId));

                ensureDir(dir);

                for (let i = 0; i < sustentosFiles.length; i++) {
                    const file = sustentosFiles[i];
                    const finalPath = path.join(dir, file.filename);
                    fs.renameSync(file.path, finalPath); // mueve de tmp → tickets/<id>/
                    fileMetaSustentos.push({
                        originalName: file.originalname,
                        filename: file.filename,
                        mimetype: file.mimetype,
                        size: file.size,
                        uploadedAt: new Date(),
                        path: finalPath
                    });
                }

                console.log("FILE META SUSTENTOS", fileMetaSustentos);

                await provTickets.updateOne(
                    { ticket_code: ticketId },
                    { $push: { sustentos: fileMetaSustentos } }
                );
            }

            return res.json({
                result: "OK",
                msg: "Items actualizados correctamente",
            })

        } catch (e) {
            console.log(e)
            return res.status(500).json({
                result: "NOK",
                msg: "Error interno",
            })
        }
    }
);

managerRouter.get("/get-rq/oc-by-project", async (req, res) => {

    const { provRQ_agrupado } = await db()
    let response = { result: 'NOK' }, body = req.body;

    try {
        

            let { codigos, codigo_proyecto } = req.query;
            const rawCodes = codigos ?? codigo_proyecto ?? [];

            // console.log("rawCodes", rawCodes)

            let codes = [];

            if (Array.isArray(rawCodes)) {
                codes = rawCodes
                    .flatMap(item => String(item).split(","))
                    .map(item => item.trim().toUpperCase())
                    .filter(Boolean);
            } else {
                codes = String(rawCodes)
                    .split(",")
                    .map(item => item.trim().toUpperCase())
                    .filter(Boolean);
            }

            // User send many codigo_proyecto : M012, M013, M014
            // Receive this data and return rows match codigo_proyecto

            const codigoField = API_TO_DB_RQ["codigo_proyecto"] ?? "Código Proyecto";

            // console.log("codigoField", codigoField)

            const match = {};
            // match[API_TO_DB_RQ["codigo_proyecto"] ?? "Código Proyecto"] = { $not: /^OPEX/i };

            if (codes.length > 0) {
                match[codigoField] = { $in: codes };
            } else {
                // Si no envían códigos, mantiene la lógica anterior
                match[codigoField] = { $not: /^OPEX/i };
            }

            // console.log("match", match)

            const pipeline = [
                { $match: match },
                { $project: projectStage },
            ];


            // const rows = await provRQ_agrupado.aggregate([{ $project: projectStage }]).exec();
            const rows = await provRQ_agrupado
                .aggregate(pipeline)
                .allowDiskUse(true)
                .exec();

            response.content = rows;
            response.result = 'OK';


        
    } catch (e) {
        console.log(e);
        response.error = e.message;
    }

    res.json(response);
})


managerRouter.get("/get-sites/summary-by-llave", async (req, res) => {
    try {
        const { provSites } = await db();

        const pipeline = [
        // llaves válidas
        {
            $match: {
                llave: { $exists: true, $ne: "" },
                // estado: { $nin: ["RQ Generado", "Cancelado"] },
                estado: { $in: ["Pendiente CT", "Enviado a MG", "Observado"] }
            },
        },

        // normaliza total_cotizacion a número (soporta number o string, y strings con comas)
        {
            $addFields: {
            __cot: {
                $let: {
                vars: { v: "$total_cotizacion" },
                in: {
                    $convert: {
                    input: {
                        $cond: [
                        { $eq: [{ $type: "$$v" }, "string"] },
                        {
                            $replaceAll: {
                            input: {
                                $replaceAll: { input: "$$v", find: ",", replacement: "" },
                            },
                            find: " ",
                            replacement: "",
                            },
                        },
                        "$$v",
                        ],
                    },
                    to: "double",
                    onError: 0,
                    onNull: 0,
                    },
                },
                },
            },
            },
        },

        // agrupa por llave
        {
            $group: {
                _id: "$llave",
                cotizacion: { $sum: "$__cot" },
                nombre_proyecto: { $first: "$nombre_proyecto" },
                linea_inversion: { $first: "$linea_inversion" },
            },
        },

        // output
        {
            $project: {
            _id: 0,
            llave: "$_id",
            cotizacion: 1,
            nombre_proyecto: 1,
            linea_inversion: 1,
            },
        },

        { $sort: { cotizacion: -1 } },
        ];

        const rows = await provSites.aggregate(pipeline);
        return res.json({ result: "OK", content: rows });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ result: "ERROR", msg: String(e.message ?? e) });
    }
});


managerRouter.get("/get-rq/pa-by-supplier", async (req, res) => {
    try {
        const { provRQ_agrupado } = await db();

        const pipeline = [
        // llaves válidas
        {
            $match: {
                Acuerdo: { $exists: true, $ne: "" },
            },
        },

        // normaliza total_cotizacion a número (soporta number o string, y strings con comas)
        {
            $addFields: {
            __cot: {
                $let: {
                vars: { v: "$Importe RQ" },
                in: {
                    $convert: {
                    input: {
                        $cond: [
                        { $eq: [{ $type: "$$v" }, "string"] },
                        {
                            $replaceAll: {
                            input: {
                                $replaceAll: { input: "$$v", find: ",", replacement: "" },
                            },
                            find: " ",
                            replacement: "",
                            },
                        },
                        "$$v",
                        ],
                    },
                    to: "double",
                    onError: 0,
                    onNull: 0,
                    },
                },
                },
            },
            },
        },

        // agrupa por llave
        {
            $group: {
                _id: "$Acuerdo",
                importe_acuerdo: { $sum: "$__cot" },
                proveedor: { $first: "$Proveedor" }
            },
        },

        // output
        {
            $project: {
                _id: 0,
                acuerdo: "$_id",
                importe_acuerdo: 1,
                proveedor: 1
            },
        },

        { $sort: { importe_acuerdo: -1 } },
        ];

        const rows = await provRQ_agrupado.aggregate(pipeline);
        return res.json({ result: "OK", content: rows });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ result: "ERROR", msg: String(e.message ?? e) });
    }
});


managerRouter.get("/get-rq/pa-by-ticket", async (req, res) => {
    try {
        const { provSites } = await db();

        const pipeline = [
        // llaves válidas
        {
            $match: {
                acuerdo_compras: { $exists: true, $ne: "" },
                // estado: { $nin: ["RQ Generado", "Cancelado"] }
                estado: { $in: ["Pendiente CT", "Enviado a MG", "Observado"] }
            },
        },

        // normaliza total_cotizacion a número (soporta number o string, y strings con comas)
        {
            $addFields: {
            __cot: {
                $let: {
                vars: { v: "$total_cotizacion" },
                in: {
                    $convert: {
                    input: {
                        $cond: [
                        { $eq: [{ $type: "$$v" }, "string"] },
                        {
                            $replaceAll: {
                            input: {
                                $replaceAll: { input: "$$v", find: ",", replacement: "" },
                            },
                            find: " ",
                            replacement: "",
                            },
                        },
                        "$$v",
                        ],
                    },
                    to: "double",
                    onError: 0,
                    onNull: 0,
                    },
                },
                },
            },
            },
        },

        // agrupa por llave
        {
            $group: {
                _id: "$acuerdo_compras",
                importe_acuerdo: { $sum: "$__cot" },
                proveedor: { $first: "$proveedor" }
            },
        },

        // output
        {
            $project: {
                _id: 0,
                acuerdo: "$_id",
                importe_acuerdo: 1,
                proveedor: 1
            },
        },

        { $sort: { importe_acuerdo: -1 } },
        ];

        const rows = await provSites.aggregate(pipeline);
        return res.json({ result: "OK", content: rows });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ result: "ERROR", msg: String(e.message ?? e) });
    }
});


managerRouter.get("/get-site/amount-by-key", async (req, res) => {
    try {
        const { provSites } = await db();

        const pipeline = [
        // llaves válidas
        {
            $match: {
                llave_proyecto: { $exists: true, $ne: "" },
                // estado: { $nin: ["RQ Generado", "Cancelado"] }
                estado: { $in: ["Pendiente CT", "Enviado a MG", "Observado"] }
            },
        },

        // normaliza total_cotizacion a número (soporta number o string, y strings con comas)
        {
            $addFields: {
            __cot: {
                $let: {
                vars: { v: "$total_cotizacion" },
                in: {
                    $convert: {
                    input: {
                        $cond: [
                        { $eq: [{ $type: "$$v" }, "string"] },
                        {
                            $replaceAll: {
                            input: {
                                $replaceAll: { input: "$$v", find: ",", replacement: "" },
                            },
                            find: " ",
                            replacement: "",
                            },
                        },
                        "$$v",
                        ],
                    },
                    to: "double",
                    onError: 0,
                    onNull: 0,
                    },
                },
                },
            },
            },
        },

        // agrupa por llave
        {
            $group: {
                _id: "$llave_proyecto",
                importe_solicitado: { $sum: "$__cot" }
            },
        },

        // output
        {
            $project: {
                _id: 0,
                llave: "$_id",
                importe_solicitado: 1
            },
        },

        { $sort: { importe_solicitado: -1 } },
        ];

        const rows = await provSites.aggregate(pipeline);
        return res.json({ result: "OK", content: rows });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ result: "ERROR", msg: String(e.message ?? e) });
    }
});


managerRouter.get("/tickets/summary-by-requester", async (req, res) => {
    try {
    const { provTickets } = await db();
    const pipeline = [
        { $match: { requester: { $exists: true, $ne: "" } } },
        // por si total_cotizacion viene como string o null
        {
        $addFields: {
            __tot: {
            $convert: {
                input: "$total_cotizacion",
                to: "double",
                onError: 0,
                onNull: 0,
            },
            },
        },
        },
        {
        $group: {
            _id: "$requester",
            cotizacion: { $sum: "$__tot" },
            tickets_count: { $sum: 1 },
        },
        },
        {
        $project: {
            _id: 0,
            requester: "$_id",
            cotizacion: 1,
            tickets_count: 1,
        },
        },
        { $sort: { cotizacion: -1 } },
    ];
    const rows = await provTickets.aggregate(pipeline);
    res.json({ result: "OK", content: rows });
    } catch (e) {
    console.error(e);
    res.status(500).json({ result: "ERROR", msg: String(e.message ?? e) });
    }
});


managerRouter.route("/insert-opex")
    .post(async (req, res) => {

        const { provOpex } = await db()
        let response = { result: 'NOK' }

        // console.log("REQ BODY", req.body)

        const docsToInsert = []
        // const parsedSites = req.body.parsedSites ? JSON.parse(req.body.parsedSites) : [];
        const parsedSites = req.body

        console.log("PARSED SITES", parsedSites)

        for (let input of parsedSites) {

            docsToInsert.push({
                ...input
            })
        }

        console.log("DOCS TO INSERT", docsToInsert)
        
        try {
            const res = await provOpex.insertMany(docsToInsert);

            response.content = res
            response.result = 'OK';

        } catch (e) {
            console.error(e);
            response.result = 'ERROR';
        }
        res.json(response);
    });


managerRouter.get("/get-opex", async (req, res) => {
    try {
        const { provOpex } = await db()
        let response = { result: 'NOK' }, body = req.body;

        try {
            response.content = await provOpex.find({}).lean();
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    } catch (e) {
        console.error(e);
        res.status(500).json({ result: "ERROR", msg: String(e.message ?? e) });
    }
});



managerRouter.route("/insert-opex-estimacion")
    .post(async (req, res) => {

        const { provOpexEstimacion } = await db()
        let response = { result: 'NOK' }

        // console.log("REQ BODY", req.body)

        const docsToInsert = []
        // const parsedSites = req.body.parsedSites ? JSON.parse(req.body.parsedSites) : [];
        const parsedSites = req.body

        console.log("PARSED SITES", parsedSites)

        for (let input of parsedSites) {

            docsToInsert.push({
                ...input
            })
        }

        console.log("DOCS TO INSERT", docsToInsert)
        
        try {
            const res = await provOpexEstimacion.insertMany(docsToInsert);

            response.content = res
            response.result = 'OK';

        } catch (e) {
            console.error(e);
            response.result = 'ERROR';
        }
        res.json(response);
    });


managerRouter.get("/get-opex-estimacion", async (req, res) => {
    try {
        const { provOpexEstimacion } = await db()
        let response = { result: 'NOK' }, body = req.body;

        try {
            response.content = await provOpexEstimacion.find({}).lean();
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    } catch (e) {
        console.error(e);
        res.status(500).json({ result: "ERROR", msg: String(e.message ?? e) });
    }
});


const normalizeQMensuales = (qMensuales) => {
    if (!qMensuales) return {};

    if (qMensuales instanceof Map) {
        return Object.fromEntries(qMensuales);
    }

    if (typeof qMensuales.toObject === "function") {
        return qMensuales.toObject();
    }

    return qMensuales;
};


managerRouter.post("/create-q-version", async (req, res) => {

    const { provOpexEstimacion } = await db()

    console.log("req.body", req.body)

    // const { projects } = req.body
    const { projects } = req.body

    console.log("projects", projects)

    const response = { result: "NOK" };

    try {
        if (!Array.isArray(projects) || projects.length === 0) {
            response.message = "Debe enviar un arreglo de projects";
            return res.json(response);
        }

        const ids = projects.map((item) => new ObjectId(item._id));

        const currentDocs = await provOpexEstimacion
            .find({ _id: { $in: ids } })
            .select("_id q_mensuales")
            .lean();

        console.dir(currentDocs, { depth: null });

            for (const doc of currentDocs) {

                console.log("doc =>", doc);

                console.log("q_mensuales raw =>", doc?.q_mensuales);
                console.log("isMap =>", doc?.q_mensuales instanceof Map);
            }

        // const existingVersions = currentDocs.flatMap((doc) => {
        //     const keys = Object.keys(doc?.q_mensuales || {});

        //     return keys
        //         .map((key) => {
        //         const match = key.match(/^q_v(\d+)$/);
        //         return match ? Number(match[1]) : null;
        //         })
        //         .filter((v) => Number.isFinite(v));
        // });

        const existingVersions = currentDocs.flatMap((doc) => {
            const qMensuales = normalizeQMensuales(doc?.q_mensuales);
            const keys = Object.keys(qMensuales);

            return keys
                .map((key) => {
                const match = key.match(/^q_v(\d+)$/);
                return match ? Number(match[1]) : null;
                })
                .filter((v) => Number.isFinite(v));
            });

        const maxVersion = existingVersions.length > 0 ? Math.max(...existingVersions) : 0;
        const versionKey = `q_v${maxVersion + 1}`;

        console.log("existingVersions", existingVersions);
        console.log("maxVersion", maxVersion);
        console.log("versionKey", versionKey);

        // let maxVersion = 0;

        // for (const doc of currentDocs) {
        //     const keys = Object.keys(doc?.q_mensuales || {});
        //     for (const key of keys) {
        //         const match = key.match(/^q_v(\d+)$/);
        //         if (match) {
        //         const version = Number(match[1]);
        //         if (!Number.isNaN(version) && version > maxVersion) {
        //             maxVersion = version;
        //         }
        //         }
        //     }
        // }

        // const versionKey = `q_v${maxVersion + 1}`;

        const bulkOps = projects.map((item) => ({
        updateOne: {
            filter: { _id: new ObjectId(item._id) },
            update: {
            $set: {
                [`q_mensuales.${versionKey}`]: (item.q_values || []).map((q) => ({
                    header: q.header,
                    value: Number(q.value) || 0,
                })),
                updatedAt: new Date(),
            },
            },
        },
        }));

        if (bulkOps.length > 0) {
            await provOpexEstimacion.bulkWrite(bulkOps);
        }

     

        response.result = "OK";
        response.content = versionKey;
        response.message = `Versión ${versionKey} creada correctamente`;

        return res.json(response);
    } catch (error) {
        console.log(error);
        response.message = error.message || "Error interno";
        return res.json(response);
    }

});


// Si quieres evitar que editen un site “viejo” de un batch anterior:
managerRouter.patch("/sites/:siteId", async (req, res) => {
    
    const { provSites, provTickets } = await db();

    const site = await provSites.findById(req.params.siteId).lean();
    if (!site) return res.status(404).json({ result: "NOK", msg: "Site no existe" });

    const ticket = await provTickets.findById(site.ticket_id).select("active_batch_id").lean();
    
    if (!ticket || ticket.active_batch_id !== site.batch_id) {
        return res.status(409).json({ result: "NOK", msg: "Site pertenece a una versión antigua del archivo" });
    }

    const updated = await provSites.findByIdAndUpdate(site._id, 
        { $set: req.body }, 
        { new: true }
    ).lean();

    res.json({ result: "OK", content: updated });
});



// #########################################
// PAYMENTS
// ##########################################

// GET UNIQUE PAs FILTERS
managerRouter.get("/get-payments-filter-options", async (req, res) => {
    try {
        const { provPayments } = await db();

        const cleanDistinct = async (field, q = {}) => {
            const values = await provPayments.distinct(field, {
                ...q,
                [field]: {
                    $nin: [null, ""],
                },
            });

            return values
                .filter((value) => value != null && value !== "")
                .map((value) => String(value).trim())
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b));
        };

        // Obtiene valores de varios campos y los combina sin duplicados
        const cleanDistinctMultiple = async (fields, query = {}) => {
            const results = await Promise.all(
                fields.map((field) => cleanDistinct(field, query))
            );

            return [...new Set(results.flat())].sort((a, b) =>
                a.localeCompare(b, "es", { sensitivity: "base" })
            );
        };

        const [
            state,
            requester,
            statusHito
        ] = await Promise.all([
            cleanDistinct("state"),
            cleanDistinct("requester"),
            cleanDistinctMultiple([
                "hito1.label",
                "hito2.label"
            ])
        ]);

        return res.json({
            result: "OK",
            content: {
                state: state,
                requester: requester,
                status_hito: statusHito
            },
        });
    } catch (e) {
        console.error("Error get-payment-filter-options:", e);
        return res.status(500).json({
            result: "ERROR",
            message: "Error al obtener opciones de filtros",
        });
    }
});

managerRouter.get("/get-payments", async (req, res) => {

    try {

        const { provPayments } = await db()

        const {
            code,
            name,
            requester,
            requester_email,
            ticket_jira,
            state,
            currentStage,
            status_hito,
            search = "",
            page = 1,
            limit = 10,
            sortBy = "code",
            sortDirection = "desc"
        } = req.query;

        // Paginación
        const currentPage = Math.max(parseInt(page, 10) || 1, 1);
        const perPage = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 5000);
        const skip = (currentPage - 1) * perPage;

        // Campos permitidos para ordenar
        const allowedSortFields = new Set([
            "code",
            "name",
            "requester",
            "sites",
            "amount",
            "ticket_jira",
            "createdAt",
            "state",
            "currentStage"
        ]);

        const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "code";
        const safeSortDirection = String(sortDirection).toLowerCase() === "asc" ? -1 : 1;

        // Query base de sites
        const q = {};
        
        if (state) q.state = state;
        if (requester) q.requester = requester;
        if (requester_email) q.requester_email = requester_email;
        if (code) q.code = code;
        if (ticket_jira) q.ticket_jira = ticket_jira;
        if (currentStage) q.currentStage = currentStage;
        if (status_hito) {
            q.$or = [
                { "hito1.label": status_hito },
                { "hito2.label": status_hito }
            ];
        }

        // Búsqueda
        if (String(search).trim()) {
            const rx = new RegExp(escapeRegex(String(search).trim()), "i");

            q.$or = [
                { code: rx },
                { name: rx },
                { ticket_jira: rx },
                { requester: rx },
            ];
        }

        const paymentProjection = {
            code: 1,
            name: 1,
            requester: 1,
            requester_email: 1,
            sites: 1,
            amount_h1: 1,
            amount_h2: 1,
            amount_total: 1,
            ticket_jira: 1,
            createdAt: 1,
            state: 1,
            currentStage: 1,
            hito1: 1,
            hito2: 1,
            file: 1,
            file_h2: 1,
            comments: 1,
        };

        // Total + página actual de sites
        const [totalResults, payment] = await Promise.all([
            provPayments.countDocuments(q),
            provPayments
                .find(q, paymentProjection)
                .sort({
                    [safeSortBy]: safeSortDirection,
                    _id: -1,
                })
                .skip(skip)
                .limit(perPage)
                .lean(),
        ]);

        // Si no hay sites, responder vacío
        if (!payment.length) {
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

        return res.json({
            result: "OK",
            content: {
                items: payment,
                totalResults,
                totalPages: Math.ceil(totalResults / perPage),
                currentPage
            },
        });


    } catch (e) {

        console.error(e);
        return res.status(500).json({ result: "ERROR" });
    }

    // res.json(response);
});

// GET PAYMENTS_SITES
managerRouter.get("/get-payments-sites", async (req, res) => {

    try {

        const { provPaymentsSites } = await db()

        const {
            code,
            requester,
            requester_email,
            ticket_jira,
            estado,
            search = "",
            page = 1,
            limit = 10,
            sortBy = "code",
            sortDirection = "desc"
        } = req.query;

        // Paginación
        const currentPage = Math.max(parseInt(page, 10) || 1, 1);
        const perPage = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 200);
        const skip = (currentPage - 1) * perPage;

        // Campos permitidos para ordenar
        const allowedSortFields = new Set([
            "code",
            "requester",
            "total_cotizacion",
            "ticket_jira",
            "createdAt",
            "estado"
        ]);

        const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "ticket_code";
        const safeSortDirection = String(sortDirection).toLowerCase() === "asc" ? -1 : 1;

        // Query base de sites
        const q = {};
        
        if (estado) q.estado = estado;
        if (requester) q.requester = requester;
        if (requester_email) q.requester_email = requester_email;
        if (code) q.code = code;
        if (ticket_jira) q.ticket_jira = ticket_jira;

        // Búsqueda
        if (String(search).trim()) {
            const rx = new RegExp(escapeRegex(String(search).trim()), "i");

            q.$or = [
                { code: rx },
                { ticket_jira: rx },
                { requester: rx },
            ];
        }

        const paymentSitesProjection = {
            code: 1,
            llave: 1,
            identificador: 1,
            sitio: 1,
            id_proyecto: 1,
            nombre_proyecto: 1,
            linea_inversion: 1,
            actividad: 1,
            solucion: 1,
            proveedor: 1,
            sustento: 1,
            acuerdo_compras: 1,
            coordinador: 1,
            descripcion_adicional: 1,
            ticket_jira: 1,
            estado: 1,
            rq: 1,
            oc: 1,
            linea_oc: 1,
            moneda: 1,
            monto: 1,
            estado_sitio: 1,
            cantidad_h1: 1,
            total_pago_h1: 1,
            cantidad_h2: 1,
            total_pago_h2: 1,
            total_pago: 1,
            pendiente_total: 1,
            status_payment: 1,
            createdAt: 1,
            requester: 1,
            requester_email: 1,
            comentarios: 1
        };

        // Total + página actual de sites
        const [totalResults, paymentSite] = await Promise.all([
            provPaymentsSites.countDocuments(q),
            provPaymentsSites
                .find(q, paymentSitesProjection)
                .sort({
                    [safeSortBy]: safeSortDirection,
                    _id: -1,
                })
                .skip(skip)
                .limit(perPage)
                .lean(),
        ]);

        // Si no hay sites, responder vacío
        if (!paymentSite.length) {
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

        return res.json({
            result: "OK",
            content: {
                items: paymentSite,
                totalResults,
                totalPages: Math.ceil(totalResults / perPage),
                currentPage
            },
        });


    } catch (e) {

        console.error(e);
        return res.status(500).json({ result: "ERROR" });
    }

    // res.json(response);
});


// INSERT PAYMENTS
managerRouter.post("/insert-payments",
    // uploadTicketExcel.single("file"), // el archivo viene en req.file (opcional)
    uploadTicketExcel.fields([
        { name: "file", maxCount: 1 },
        { name: "file_h2", maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            const { provPayments, provPaymentsSites, provSites, provCR_individual } = await db();
            // 1) parsear JSON strings (multipart)
            const paymentData = req.body.paymentData ? JSON.parse(req.body.paymentData) : {};
            const paymentSites = req.body.paymentSites ? JSON.parse(req.body.paymentSites) : [];

            // 2) generar código y batch
            const prefix = "SCR";
            const code = await nextTicketCode(prefix, 5);
            // const batchId = makeBatchId();
            // 3) crear ticket
            const t = await provPayments.create({
                ...paymentData,
                code,
                state: paymentData.state ?? "Hito 1",
                import_status: "PROCESSING",
                // active_batch_id: batchId,
                sites: 0,
                // amount: 0,
                amount_h1: 0,
                amount_h2: 0,
                ticket_jira: "",
                date_request: new Date(),
                date_update: new Date(),
            });

            // 4) mover archivo (si vino) a carpeta del ticket
            let fileMeta = null;

            const mainFile = req.files?.file?.[0] || null
            const h2File = req.files?.file_h2?.[0] || null

            if (mainFile) {
                const dir = path.join(UPLOAD_CR, String(t.code));

                ensureDir(dir);
                const finalPath = path.join(dir, mainFile.filename);
                fs.renameSync(mainFile.path, finalPath); // mueve de tmp → tickets/<id>/
                fileMeta = {
                    originalName: mainFile.originalname,
                    filename: mainFile.filename,
                    mimetype: mainFile.mimetype,
                    size: mainFile.size,
                    uploadedAt: new Date(),
                    path: finalPath
                };
                await provPayments.updateOne(
                    { _id: t._id },
                    { $set: { file: fileMeta } }
                );
            }

            if (h2File) {
                const dir = path.join(UPLOAD_CR, String(t.code));

                ensureDir(dir);
                const finalPath = path.join(dir, h2File.filename);
                fs.renameSync(h2File.path, finalPath); // mueve de tmp → tickets/<id>/
                fileMeta = {
                    originalName: h2File.originalname,
                    filename: h2File.filename,
                    mimetype: h2File.mimetype,
                    size: h2File.size,
                    uploadedAt: new Date(),
                    path: finalPath
                };
                await provPayments.updateOne(
                    { _id: t._id },
                    { $set: { file_h2: fileMeta } }
                );
            }

            // Hito
            const hito = String(
                paymentData.hito ??
                paymentData.currentStage ??
                paymentData.state ??
                ""
            ).toLowerCase();

            const isHito2 = hito.includes("hito2") || hito.includes("hito 2");
            const isHito1 = !isHito2;

            // 5) normalizar e insertar sites
            const docs = (Array.isArray(paymentSites) ? paymentSites : []).map((input) => {
                const llave = (input.id_proyecto && input.linea_inversion)
                    ? `${input.id_proyecto}${extractNumericPrefix(input.linea_inversion)}`
                    : "";

                return {
                    ...input,
                    cr_id: t._id,

                    code: code, 
                    llave,
                    estado: input.estado ?? "Pendiente CT",
                    comentarios: input.comentarios ?? "",
                    ticket_jira: "",

                    requester: t.requester,
                    requester_email: t.requester_email,
                    cantidad_h2: input.cantidad_h2 ?? 0,
                    total_pago_h2: input.total_pago_h2 ?? 0,

                    total_pago: input.total_pago_h1 + input.total_pago_h2,
                    pendiente_total: input.monto - (input.total_pago_h1 + input.total_pago_h2),
                    status_payment: input.status_payment ?? "Abierto",

                };
            });

            const inserted = docs.length
                ? await provPaymentsSites.collection.insertMany(docs, { ordered: false })
                : { insertedCount: 0 };

            // Q Sitios
            const set = new Set(docs.map(d => d.identificador))
            const insertedCount = set.size;

            // Monto Total
            const originalAmount = docs.reduce((acc, cur) => acc + toNumber(cur.monto), 0);
            const totalAmountH1 = docs.reduce((acc, cur) => acc + toNumber(cur.total_pago_h1), 0);
            const totalAmountH2 = docs.reduce((acc, cur) => acc + toNumber(cur.total_pago_h2), 0);
            const totalAmount = totalAmountH1 + totalAmountH2;

            // 6) finalizar ticket
            if(isHito1) {
                await provPayments.updateOne(
                    { _id: t._id },
                    {
                        $set: { import_status: "READY", import_error: "", date_update: new Date() },
                        $inc: { sites: insertedCount, amount_h1: totalAmountH1, amount_h2: totalAmountH2, amount_total: totalAmount }
                    }
                );
            } else {
                await provPayments.updateOne(
                    { _id: t._id },
                    {
                        $set: { import_status: "READY", import_error: "", date_update: new Date() },
                        $inc: { sites: insertedCount, amount_h1: totalAmountH1, amount_h2: totalAmountH2, amount_total: originalAmount }
                    }
                );
            }
            
            // RQ utilizados
            const rqs = [...new Set(
                docs
                    .map((s) => s.rq)
                    .filter(Boolean)
            )];

            const ticketSite = await provSites.find({
                rq: { $in: rqs }
            }).lean();

            if (!ticketSite.length) {
                return res.status(404).json({ result: "NOK", msg: "Ticket no existe" });
            }

            const crMatch = {
                $and: [
                    // ticketSite not ARRAY
                    { "RQ": { $in: rqs } }
                ],
            };

            const crPipeline = [
                { $match: crMatch },
                { $project: projectStageCR },
            ];

            const crs = await provCR_individual.aggregate(crPipeline).exec();

            // Ticket Site tiene OC y Linea OC
            let items = attachLineaOC(ticketSite, crs);

            // Match between paymentSite and items using key "OC" and "Linea OC"
            items = items.filter((item) =>
                docs.some((ps) =>
                    item.oc === ps.oc &&
                    String(item.linea_oc) === String(ps.linea_oc)
                )
            );

            
 
            // UPDATE SITES
            const makePaymentKey = (row) => {
                return [
                    row.identificador,
                    row.oc,
                    row.linea_oc,
                ]
                    .map((v) => String(v ?? "").trim().toUpperCase())
                    .join("|");
            };

            // Mapa de paymentSites por identificador + oc + linea_oc
            const paymentSiteByKey = new Map();

            for (const ps of docs) {
                const key = makePaymentKey(ps);

                if (!key || key === "||") continue;

                paymentSiteByKey.set(key, ps);
            }

            

            // Armar updates individuales para provSites
            const bulkOps = items
                .map((item) => {
                    const key = makePaymentKey(item);
                    const paymentSite = paymentSiteByKey.get(key);

                    if (!paymentSite || !item._id) return null;

                    const cantidadH1 = toNumber(paymentSite.cantidad_h1);
                    const totalPagoH1 = toNumber(paymentSite.total_pago_h1);
                    const cantidadH2 = toNumber(paymentSite.cantidad_h2);
                    const totalPagoH2 = toNumber(paymentSite.total_pago_h2);

                    const isCompleteH1 = cantidadH1 === 100;

                    const setFields = {
                        is_payment: true,

                        estado: isHito2
                            ? "Intención de Pago - Hito 2"
                            : "Intención de Pago",

                        cantidad_pago: cantidadH1,
                        monto_pago: totalPagoH1,

                        cantidad_pago_pendiente: cantidadH2,
                        monto_pago_pendiente: totalPagoH2,

                        // date_update: new Date(),
                    };

                    if (isHito1) {
                        setFields.status_settlement = isCompleteH1 ? "NA" : "Pendiente";
                        setFields.status_deliverable = isCompleteH1 ? "NA" : "Pendiente";
                    }

                    if (isHito2) {
                        setFields.is_payment_2 = true;
                    }

                    return {
                        updateOne: {
                            filter: { _id: item._id },
                            update: {
                                $set: setFields,
                            },
                        },
                    };
                })
                .filter(Boolean);

            if (!bulkOps.length) {
                return res.status(404).json({
                    result: "NOK",
                    msg: "No hay sitios para actualizar con match identificador + oc + linea_oc",
                });
            }

            await provSites.bulkWrite(bulkOps, { ordered: false });


            // const idsToUpdate = items.map((item) => item._id).filter(Boolean);
            // if (!idsToUpdate.length) {
            //     return res.status(404).json({
            //         result: "NOK",
            //         msg: "No hay sitios para actualizar"
            //     });
            // }

            // await provSites.updateMany(
            //     { _id: { $in: idsToUpdate } },
            //     {
            //         $set: {
            //             is_payment: true,
            //             estado: "Intención de Pago",
            //             cantidad_pago: ,
            //         }
            //     }
            // );


            res.json({
                result: "OK",
                content: {
                    ticket_id: t._id,
                    code,
                    sites_inserted: insertedCount,
                    amount_h1: totalAmountH1,
                    amount_h2: totalAmountH2,
                    file: fileMeta,
                    // batch_id: batchId,
                },
            });

            // SEND EMAIL
            // await sendEmail(
            //     'normal',
            //     '"Workflow GCIR" <planner.notifier@entel.net.pe>',
            //     // to_workers,
            //     ticketData.requester_email,
            //     // ['ntt_sccopacondo@externo.entel.pe'],
            //     // [],
            //     ['caroline.carrasco.ent@viaexperis2.pe', 'cesar.guzman@entel.pe', 'ntt_sccopacondo@externo.entel.pe'],
            //     // cc_expiration_letter,
            //     `Solicitud Ticket RQ ${ticket_code}`,
            //     generateTicketCreatedHtml({
            //         recipientName: ticketData.requester,
            //         ticketCode: ticket_code
            //     }),
            //     [
            //         // {
            //         //     filename: `${filename}.xlsb`,
            //         //     path: xlsbPath,
            //         //     cid: 'footer' //same cid value as in the html img src
            //         // }
            //     ]
            // );

        } catch (e) {
            console.error(e);
            res.status(500).json({ result: "ERROR", msg: String(e.message ?? e) });
        }
    }
);

// Download CR File
managerRouter.get("/download-cr-file", async (req, res) => {
    try {
        const { provPayments } = await db();
        const { code, name } = req.query;

        console.log("name", name)

        if (!code) {
            return res.status(400).json({ result: "NOK", msg: "ticket_code es requerido" });
        }

        // Buscar por ticket_code (no por _id)
        const payment = await provPayments
            .findOne({ code })
            .select("file file_h2 code")
            .lean();

        if (!payment) {
            return res.status(404).json({ result: "NOK", msg: "Ticket no encontrado" });
        }

        // const file = ticket.file;

        let list = []

        if (payment.file_h2) {
            list.push(payment.file_h2)
        }

        if (payment.file) {
            list.push(payment.file)
        }

        const file = list.find(f => f.originalName === name);

        if (!file || !file.path) {
            return res.status(404).json({ result: "NOK", msg: "Archivo no encontrado" });
        }

        const filePath = path.resolve(file.path);

        // Validar existencia física
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ result: "NOK", msg: "Archivo no existe en disco" });
        }

        // (Opcional pero recomendado) restringir descargas a carpeta permitida
        const allowedBase = path.resolve("/data/html/planner_app_gcir/resources");
        if (!filePath.startsWith(allowedBase)) {
            return res.status(403).json({ result: "NOK", msg: "Ruta no permitida" });
        }

        // Nombre a mostrar al descargar (preferir original)
        const downloadName = file.originalName || file.filename || path.basename(filePath);

        // Opcional: setear mimetype explícitamente
        if (file.mimetype) {
            res.setHeader("Content-Type", file.mimetype);
        }

        // Descarga real del archivo (NO enviar la ruta como texto)
        return res.download(filePath, downloadName, (err) => {
            if (err) {
                console.error("Error en descarga:", err);
                if (!res.headersSent) {
                return res.status(500).json({ result: "ERROR", msg: "No se pudo descargar el archivo" });
                }
            }
        });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ result: "ERROR", msg: String(e.message ?? e) });
    }
});




async function executePayStateTransition({
    req,
    res,
    rules,
}) {
    try {
        const { provPayments, provPaymentsSites, provTickets, provSites, provCR_individual } = await db();
        const { paymentId } = req.params;

        const payload = parsePayloadFromReq(req);
        const patch = payload.patch ?? {};

        console.log("PATCH", patch)
        
        const comment = buildComment(payload);

        // Payment  --- SCR
        const ticket = await provPayments.findById(paymentId);
        if (!ticket) {
            return res.status(404).json({ result: "NOK", msg: "Ticket no existe" });
        }

        // Payment Sites --- SITIOS CON OC
        const paymentSites = await provPaymentsSites.find({ cr_id: ticket._id }).lean();
        if (!paymentSites.length) {
            return res.status(404).json({ result: "NOK", msg: "Payment Site no existe" });
        }

        // Extraer RQ únicas desde paymentSites
        const rqs = [...new Set(
            paymentSites
                .map((item) => item.rq)
                .filter(Boolean)
        )];

        if (!rqs.length) {
            return res.status(404).json({
                result: "NOK",
                msg: "Payment Site no tiene RQ válidas"
            });
        }

        // Ticket Sites --- SITIOS SIN OC
        const ticketSite = await provSites.find({
            rq: { $in: rqs }
        }).lean();

        if (!ticketSite.length) {
            return res.status(404).json({ result: "NOK", msg: "Ticket no existe" });
        }

        const crMatch = {
            $and: [
                // ticketSite not ARRAY
                { "RQ": { $in: rqs } }
            ],
        };

        const crPipeline = [
            { $match: crMatch },
            { $project: projectStageCR },
        ];

        const crs = await provCR_individual.aggregate(crPipeline).exec();

        // Ticket Site tiene OC y Linea OC
        let items = attachLineaOC(ticketSite, crs);

        

        const currentStage = ticket?.currentStage ?? "hito1";
        const currentLabel = currentStage == "hito1" ? ticket?.hito1?.label : ticket?.hito2?.label;
        const stageKey = currentStage === "hito1" ? "hito1" : "hito2";

        const currentState = normalizeState(currentLabel ?? PAY_STATES.INTENCION_PAGO);
        const targetState = normalizeState(rules.toState);

        ensureTransition(currentState, rules.fromState, targetState, Boolean(rules.allowAnyFrom));

        // campos entrantes
        const incomingTicketJira = patch.ticket_jira;
        const incomingRq = patch.rq;

        const nextTicketJira = incomingTicketJira !== undefined ? incomingTicketJira : (ticket.ticket_jira ?? "");
        const nextRq = incomingRq !== undefined ? incomingRq : (ticket.rq ?? "");

        // Validaciones específicas por endpoint
        if (typeof rules.validate === "function") {
            await rules.validate({
                req,
                payload,
                patch,
                ticket,
                currentState,
                targetState,
                nextTicketJira,
                nextRq,
            });
        }


        // Match between paymentSite and items using key "OC" and "Linea OC"
        items = items.filter((item) =>
            paymentSites.some((ps) =>
                item.oc === ps.oc &&
                String(item.linea_oc) === String(ps.linea_oc)
            )
        );

        const idsToUpdate = items.map((item) => item._id).filter(Boolean);

        if (!idsToUpdate.length) {
            return res.status(404).json({
                result: "NOK",
                msg: "No hay sitios para actualizar"
            });
        }


        await provSites.updateMany(
            { _id: { $in: idsToUpdate } },
            {
                $set: {
                    estado: targetState
                }
            }
        );

        if(currentStage === "hito1" && patch[stageKey].status === "pago_enviado") {
            await provSites.updateMany(
                { _id: { $in: idsToUpdate } },
                {
                    $set: {
                        ticket_jira_cr_1: patch.ticket_jira,
                        ...(targetState === "Pago Enviado a MG" && {
                            fecha_cr_sendmg: new Date()
                        })
                    }
                }
            );
        }

        if(currentStage === "hito2" && patch[stageKey].status === "pago_enviado_h2") {
            await provSites.updateMany(
                { _id: { $in: idsToUpdate } },
                {
                    $set: {
                        ticket_jira_cr_2: patch.ticket_jira,
                        ...(targetState === "Pago Enviado a MG - Hito 2" && {
                            fecha_cr_2_sendmg: new Date()
                        })
                    }
                }
            );
        }

        

        // 2) Guardar archivo si vino
        saveUploadedFileInTicket(ticket, req.file);

        // 3) Aplicar cambios al ticket (solo campos permitidos por endpoint)
        const now = new Date();

        // ticket.state = targetState;
        ticket[stageKey].label = targetState;
        ticket[stageKey].status = patch[stageKey].status ?? "intencion_pago";

        // ticket.date_update = now;
        // ticket.fecha_actualizacion = now; // si existe en schema

        // campos opcionales por transición
        if (rules.allowTicketJira && incomingTicketJira !== undefined) {
            ticket.ticket_jira = incomingTicketJira;
        }
        if (rules.allowRq && incomingRq !== undefined) {
            ticket.rq = incomingRq;
        }

        // campos adicionales que quieras permitir por endpoint (opcional)
        if (Array.isArray(rules.allowedExtraPatchFields)) {
            for (const k of rules.allowedExtraPatchFields) {
                if (patch[k] !== undefined) ticket[k] = patch[k];
            }
        }

        if (ticket.date_request) {
            ticket.date_request = parseExcelOrISO(ticket.date_request);
        }

        // Comentarios
        if (comment) {
            ticket.comments = ticket.comments ?? [];
            ticket.comments.push(comment);
        }

        console.log("isClose", patch.isClose)
        console.log("openHito2", patch.openHito2)
        console.log("initValidate", patch.initValidate)


        await ticket.save();

        // 5) Correo (no bloqueante lógico del negocio)
        // const mailStatus = await notifyTicketStateChangeSafe({
        //     ticket,
        //     prevState: currentState,
        //     nextState: targetState,
        //     payload,
        //     actor: payload?.comment?.author ?? null,
        // });

        return res.json({
            result: "OK",
            content: {
                ticket_id: ticket._id,
                prev_state: currentState,
                // state: ticket.state,
                // active_batch_id: ticket.active_batch_id ?? null,
                // sites_count: ticket.sites_count ?? 0,
                // total_cotizacion: ticket.total_cotizacion ?? 0,
                ticket_jira: ticket.ticket_jira ?? null,
                rq: ticket.rq ?? null,
                file: ticket.file ?? null,
                // batch_info: batchInfo,
                // sites_update: {
                //     matchedCount: sitePropagation?.matchedCount ?? 0,
                //     modifiedCount: sitePropagation?.modifiedCount ?? 0,
                // },
            },
            // notification: mailStatus,
        });
    } catch (e) {
            console.error(e);
            return res.status(e.statusCode || 500).json({
            result: "ERROR",
            msg: String(e.message ?? e),
        });
    }
}


// ==========================================================
// ENDPOINT 1: Intencion de Pago -> Enviado a MG
// Requiere ticket_jira, comentarios opcionales, fecha_actualizacion
// ==========================================================
managerRouter.patch(
    "/payments/:paymentId/state/pay-send-mg",
    uploadTicketExcel.single("file"), // se admite, pero no se usa replaceSites aquí
    async (req, res) => {
        return executePayStateTransition({
            req,
            res,
            rules: {
                fromState: PAY_STATES.INTENCION_PAGO,
                toState: PAY_STATES.PAGO_ENVIADO_MG,
                allowAnyFrom: false,
                allowReplaceSites: false,
                allowTicketJira: true,
                allowRq: false,
                propagateTicketJira: true,
                propagateRq: false,
                validate: async ({ nextTicketJira }) => {
                    if (!String(nextTicketJira ?? "").trim()) {
                        const err = new Error("ticket_jira es obligatorio para pasar a 'Enviado a MG'");
                        err.statusCode = 400;
                        throw err;
                    }
                },
            },
        });
    }
);


managerRouter.patch(
    "/payments/:paymentId/state/pay-generated",
    uploadTicketExcel.single("file"),
    async (req, res) => {
        return executePayStateTransition({
        req,
        res,
        rules: {
            fromState: PAY_STATES.PAGO_ENVIADO_MG,
            toState: PAY_STATES.PAGO_GENERADO,
            allowAnyFrom: false,
            allowReplaceSites: false,
            allowTicketJira: false, // normalmente ya quedó antes
            allowRq: false,
            propagateTicketJira: false,
            propagateRq: false,
            validate: async ({ nextRq }) => {
            // if (!String(nextRq ?? "").trim()) {
            //     const err = new Error("rq es obligatorio para pasar a 'RQ Generada'");
            //     err.statusCode = 400;
            //     throw err;
            // }
            },
        },
        });
    }
);

managerRouter.patch(
    "/payments/:paymentId/state/pay-send-mg-h2",
    uploadTicketExcel.single("file"), // se admite, pero no se usa replaceSites aquí
    async (req, res) => {
        return executePayStateTransition({
            req,
            res,
            rules: {
                fromState: PAY_STATES.INTENCION_PAGO_H2,
                toState: PAY_STATES.PAGO_ENVIADO_MG_H2,
                allowAnyFrom: false,
                allowReplaceSites: false,
                allowTicketJira: true,
                allowRq: false,
                propagateTicketJira: true,
                propagateRq: false,
                validate: async ({ nextTicketJira }) => {
                    if (!String(nextTicketJira ?? "").trim()) {
                        const err = new Error("ticket_jira es obligatorio para pasar a 'Enviado a MG - Hito 2'");
                        err.statusCode = 400;
                        throw err;
                    }
                },
            },
        });
    }
);

managerRouter.patch(
    "/payments/:paymentId/state/pay-generated-h2",
    uploadTicketExcel.single("file"),
    async (req, res) => {
        return executePayStateTransition({
        req,
        res,
        rules: {
            fromState: PAY_STATES.PAGO_ENVIADO_MG_H2,
            toState: PAY_STATES.PAGO_GENERADO_H2,
            allowAnyFrom: false,
            allowReplaceSites: false,
            allowTicketJira: false, // normalmente ya quedó antes
            allowRq: false,
            propagateTicketJira: false,
            propagateRq: false,
            validate: async ({ nextRq }) => {
            // if (!String(nextRq ?? "").trim()) {
            //     const err = new Error("rq es obligatorio para pasar a 'RQ Generada'");
            //     err.statusCode = 400;
            //     throw err;
            // }
            },
        },
        });
    }
);

managerRouter.patch(
    "/payments/:paymentId/state/validate-send-mg",
    uploadTicketExcel.single("file"),
    async (req, res) => {
        return executePayStateTransition({
        req,
        res,
        rules: {
            fromState: PAY_STATES.VALIDACION_JEFATURA,
            toState: PAY_STATES.PAGO_ENVIADO_MG,
            allowAnyFrom: false,
            allowReplaceSites: false,
            allowTicketJira: false, // normalmente ya quedó antes
            allowRq: false,
            propagateTicketJira: false,
            propagateRq: false,
            validate: async ({ nextRq }) => {
            // if (!String(nextRq ?? "").trim()) {
            //     const err = new Error("rq es obligatorio para pasar a 'RQ Generada'");
            //     err.statusCode = 400;
            //     throw err;
            // }
            },
        },
        });
    }
);


managerRouter.patch(
    "/payments/:paymentId/state/paygen-validate",
    uploadTicketExcel.single("file"),
    async (req, res) => {
        return executePayStateTransition({
        req,
        res,
        rules: {
            fromState: PAY_STATES.PAGO_GENERADO,
            toState: PAY_STATES.VALIDACION_JEFATURA,
            allowAnyFrom: false,
            allowReplaceSites: false,
            allowTicketJira: false, // normalmente ya quedó antes
            allowRq: false,
            propagateTicketJira: false,
            propagateRq: false,
            validate: async ({ nextRq }) => {
            // if (!String(nextRq ?? "").trim()) {
            //     const err = new Error("rq es obligatorio para pasar a 'RQ Generada'");
            //     err.statusCode = 400;
            //     throw err;
            // }
            },
        },
        });
    }
);


managerRouter.patch(
    "/payments/:paymentId/state/pay-cancel",
    uploadTicketExcel.single("file"),
    async (req, res) => {
        return executePayStateTransition({
        req,
        res,
        rules: {
            fromState: null,
            toState: PAY_STATES.CANCELADO,
            allowAnyFrom: true,      // ← cualquier estado
            allowReplaceSites: false,
            allowTicketJira: false,
            allowRq: false,
            propagateTicketJira: false,
            propagateRq: false,
            validate: async ({ currentState }) => {
            if (currentState === PAY_STATES.CANCELADO) {
                const err = new Error("El ticket ya está cancelado");
                err.statusCode = 400;
                throw err;
            }
            },
        },
        });
    }
);


managerRouter.patch(
    "/payments/:paymentId/state/pay-close",
    uploadTicketExcel.single("file"),
    async (req, res) => {
        return executePayStateTransition({
        req,
        res,
        rules: {
            fromState: null,
            toState: PAY_STATES.CERRADO,
            allowAnyFrom: true,      // ← cualquier estado
            allowReplaceSites: false,
            allowTicketJira: false,
            allowRq: false,
            propagateTicketJira: false,
            propagateRq: false,
            validate: async ({ currentState }) => {
            if (currentState === PAY_STATES.CLOSE) {
                const err = new Error("El ticket ya está cerrado");
                err.statusCode = 400;
                throw err;
            }
            },
        },
        });
    }
);


// UPDATE
managerRouter.patch(
    "/payments/update/site/:paymentId",
    uploadTicketExcel.fields([
        { name: "fileSustentos", maxCount: 30 }
    ]),
    async (req, res) => {
        try {
            const { provPayments, provPaymentsSites } = await db();
            const { paymentId } = req.params;
            // const payload = req.body.payload
            const payload = JSON.parse(req.body.payload)
            const { code, items } = payload
            // const { items } = req.body

            console.log("paymentId", paymentId)
            // console.log("items", items)
            console.log("ITEMS", items)
            // console.log("req.fileSustentos", req.files?.fileSustentos)

            if (!paymentId) {
                return res.status(400).json({
                    result: "NOK",
                    msg: "code es requerido",
                })
            }

            if (!Array.isArray(items)) {
                return res.status(400).json({
                    result: "NOK",
                    msg: "items debe ser un array",
                })
            }

            for (const item of items) {

                console.log("item", item)

                await provPaymentsSites.updateOne(
                    { _id: item._id },
                    {
                        $set: {
                            status_payment: item.status_payment,
                            cantidad_h1: item.cantidad_h1 || 0,
                            total_pago_h1: item.total_pago_h1 || 0,
                            cantidad_h2: item.cantidad_h2 || 0,
                            total_pago_h2: item.total_pago_h2 || 0,
                            total_pago: item.total_pago || 0,
                            pendiente_total: item.pendiente_total || 0,
                            comentarios: item.comentarios || "",
                        }
                    }
                )
            }

            const amountH1 = items.reduce((acc, cur) => acc + cur.total_pago_h1, 0);
            const amountH2 = items.reduce((acc, cur) => acc + cur.total_pago_h2, 0);

            await provPayments.updateOne(
                { code: paymentId },
                {
                    $set: { 
                        amount_h1: amountH1, 
                        amount_h2: amountH2,
                        "hito1.amount": amountH1,
                        "hito1.updatedAt": new Date(),
                        "hito2.amount": amountH2,
                        "hito2.updatedAt": new Date(),
                    }
                }
            );

            return res.json({
                result: "OK",
                msg: "Items actualizados correctamente",
            })

        } catch (e) {
            console.log(e)
            return res.status(500).json({
                result: "NOK",
                msg: "Error interno",
            })
        }
    }
);

managerRouter.get("/download-ticket-all-sustentos-file", async (req, res) => {
    // const { ticketCode } = req.params;

    try {
        const { provTickets } = await db();
        const { ticket_code, name } = req.query;

        const ticket = await provTickets.findOne(
            { ticket_code: ticket_code },
            { sustentos: 1, ticket_code: 1 }
        );

        if (!ticket || !Array.isArray(ticket.sustentos) || ticket.sustentos.length === 0) {
            return res.status(404).json({
                result: "NOK",
                message: "No hay sustentos para descargar",
            });
        }

        const zipName = `sustentos_${ticket_code}.zip`;

        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${zipName}"`
        );

        const archive = archiver("zip", {
            zlib: { level: 9 },
        });

        archive.on("error", (err) => {
            console.error("Error generando ZIP:", err);
            if (!res.headersSent) {
                res.status(500).json({
                    result: "NOK",
                    message: "Error generando ZIP",
                });
            } else {
                res.end();
            }
        });

        archive.pipe(res);

        for (const file of ticket.sustentos) {
            if (!file.path || !fs.existsSync(file.path)) {
                console.warn("Archivo no encontrado:", file.path);
                continue;
            }

            const fileNameInZip = file.originalName || file.filename || path.basename(file.path);

            archive.file(file.path, {
                name: fileNameInZip,
            });
        }

        await archive.finalize();

    } catch (error) {
        console.error("Error descargando sustentos:", error);
        res.status(500).json({
            result: "NOK",
            message: "Error descargando sustentos",
        });
    }
});


// GET UNIQUE TICKETSS FILTERS
managerRouter.get("/get-settlements-filter-options", async (req, res) => {
    try {
        const { provSettlements } = await db();

        const cleanDistinct = async (field, q = {}) => {
            const values = await provSettlements.distinct(field, {
                ...q,
                [field]: {
                    $nin: [null, ""],
                },
            });

            return values
                .filter((value) => value != null && value !== "")
                .map((value) => String(value).trim())
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b));
        };

        const [
            code,
            name,
            requester,
            requester_email,
            proveedor,
            estado,
            id_proyecto,
            nombre_proyecto,
            actividad,
            assigned_to,
        ] = await Promise.all([
            cleanDistinct("code"),
            cleanDistinct("name"),
            cleanDistinct("requester"),
            cleanDistinct("requester_email"),
            cleanDistinct("proveedor"),
            cleanDistinct("estado"),
            cleanDistinct("id_proyecto"),
            cleanDistinct("nombre_proyecto"),
            cleanDistinct("actividad"),
            cleanDistinct("assigned_to"),
        ]);

        return res.json({
            result: "OK",
            content: {
                code: code,
                name: name,
                requester: requester,
                requester_email: requester_email,
                estado: estado,
                id_proyecto: id_proyecto,
                nombre_proyecto: nombre_proyecto,
                actividad: actividad,
                assigned_to: assigned_to,
            },
        });
    } catch (e) {
        console.error("Error get-ticetks-filter-options:", e);
        return res.status(500).json({
            result: "ERROR",
            message: "Error al obtener opciones de filtros",
        });
    }
});


managerRouter.get("/get-settlements", async(req, res) => {
    try {

        const { provSettlements } = await db()

        const {
            code,
            name,
            estado,
            requester,
            requester_email,
            assigned_to,
            proveedor,
            search = "",
            page = 1,
            limit = 10,
            sortBy = "code",
            sortDirection = "desc"
        } = req.query;

        // Paginación
        const currentPage = Math.max(parseInt(page, 10) || 1, 1);
        const perPage = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 5000);
        const skip = (currentPage - 1) * perPage;

        // Campos permitidos para ordenar
        const allowedSortFields = new Set([
            "code",
            "name",
            "createdAt"
        ]);

        const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "code";
        const safeSortDirection = String(sortDirection).toLowerCase() === "asc" ? -1 : 1;

        // Query base de sites
        const q = {};
        
        if (estado) q.estado = estado;
        if (requester) q.requester = requester;
        if (requester_email) q.requester_email = requester_email;
        if (assigned_to) q.assigned_to = assigned_to;
        if (proveedor) q.proveedor = proveedor;
        if (code) q.code = code;

        // Búsqueda
        if (String(search).trim()) {
            const rx = new RegExp(escapeRegex(String(search).trim()), "i");

            q.$or = [
                { code: rx },
                { name: rx },
                { requester: rx },
                { assigned_to: rx }
            ];
        }

        const settlementProjection = {
            code: 1,
            name: 1,
            requester: 1,
            requester_email: 1,
            count: 1,
            amount: 1,
            estado: 1,
            proveedor: 1,
            assigned_to: 1,
            assigned_to_email: 1,
            createdAt: 1,
            updatedAt: 1,
            file: 1,
            _id: 1,
            comments: 1
        };

        // Total + página actual de sites
        const [totalResults, settlement] = await Promise.all([
            provSettlements.countDocuments(q),
            provSettlements
                .find(q, settlementProjection)
                .sort({
                    [safeSortBy]: safeSortDirection,
                    _id: -1,
                })
                .skip(skip)
                .limit(perPage)
                .lean(),
        ]);

        // Si no hay sites, responder vacío
        if (!settlement.length) {
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

        return res.json({
            result: "OK",
            content: {
                items: settlement,
                totalResults,
                totalPages: Math.ceil(totalResults / perPage),
                currentPage
            },
        });


    } catch (e) {

        console.error(e);
        return res.status(500).json({ result: "ERROR" });
    }
})


// GET PAYMENTS_SITES
managerRouter.get("/get-settlements-sites", async (req, res) => {

    try {

        const { provSettlementsSites } = await db()

        const {
            code,
            name,
            requester,
            requester_email,
            assigned_to,
            id_proyecto,
            nombre_proyecto,
            linea_inversion,
            actividad,
            estado,
            search = "",
            page = 1,
            limit = 10,
            sortBy = "code",
            sortDirection = "desc"
        } = req.query;

        // Paginación
        const currentPage = Math.max(parseInt(page, 10) || 1, 1);
        const perPage = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 200);
        const skip = (currentPage - 1) * perPage;

        // Campos permitidos para ordenar
        const allowedSortFields = new Set([
            "code",
            "createdAt",
            "estado"
        ]);

        const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "code";
        const safeSortDirection = String(sortDirection).toLowerCase() === "asc" ? -1 : 1;

        // Query base de sites
        const q = {};
        
        if (estado) q.estado = estado;
        if (requester) q.requester = requester;
        if (requester_email) q.requester_email = requester_email;
        if (code) q.code = code;
        if (assigned_to) q.assigned_to = assigned_to;
        if (id_proyecto) q.id_proyecto = id_proyecto;
        if (nombre_proyecto) q.nombre_proyecto = nombre_proyecto;
        if (linea_inversion) q.linea_inversion = linea_inversion;
        if (actividad) q.actividad = actividad;

        // Búsqueda
        if (String(search).trim()) {
            const rx = new RegExp(escapeRegex(String(search).trim()), "i");

            q.$or = [
                { code: rx },
                { name: rx },
                { requester: rx },
                { identificador: rx },
                { sitio: rx },
                { id_proyecto: rx },
                { nombre_proyecto: rx },
                { actividad: rx },
                { rq: rx },
                { oc: rx },
            ];
        }

        const settlementSitesProjection = {
            code: 1,
            id: 1,
            requester: 1,
            requester_email: 1,
            assigned_to: 1,
            assigned_to_email: 1,
            estado: 1,

            identificador: 1,
            sitio: 1,
            actividad: 1,
            solucion: 1,
            proveedor: 1,
            id_proyecto: 1,
            nombre_proyecto: 1,
            linea_inversion: 1,
            
            coordinador: 1,
            descripcion_adicional: 1,
            
            rq: 1,
            oc: 1,
            linea_oc: 1,
            monto_oc: 1,
            cantidad: 1,
            precio_unitario: 1,
            
            createdAt: 1,
            updatedAt: 1,
        };

        // Total + página actual de sites
        const [totalResults, settlementSite] = await Promise.all([
            provSettlementsSites.countDocuments(q),
            provSettlementsSites
                .find(q, settlementSitesProjection)
                .sort({
                    [safeSortBy]: safeSortDirection,
                    _id: -1,
                })
                .skip(skip)
                .limit(perPage)
                .lean(),
        ]);

        // Si no hay sites, responder vacío
        if (!settlementSite.length) {
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

        return res.json({
            result: "OK",
            content: {
                items: settlementSite,
                totalResults,
                totalPages: Math.ceil(totalResults / perPage),
                currentPage
            },
        });


    } catch (e) {

        console.error(e);
        return res.status(500).json({ result: "ERROR" });
    }

    // res.json(response);
});


// INSERT PAYMENTS
managerRouter.post("/insert-settlements",
    uploadTicketExcel.fields([
        { name: "file", maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            const { provSettlements, provSettlementsSites, provPayments, provPaymentsSites, provSites, provCR_individual } = await db();
            // 1) parsear JSON strings (multipart)
            const settlementData = req.body.settlementData ? JSON.parse(req.body.settlementData) : {};
            const settlementSites = req.body.settlementSites ? JSON.parse(req.body.settlementSites) : [];

            console.log("SData", settlementData)
            console.log("SSite", settlementSites)

            // 2) generar código y batch
            const prefix = "LIQ";
            const code = await nextTicketCode(prefix, 5);
            // const batchId = makeBatchId();
            // 3) crear ticket
            const t = await provSettlements.create({
                ...settlementData,
                code,
                estado: settlementData.estado ?? "Pendiente",
                import_status: "PROCESSING",
                count: 0,
                amount: 0,
                date_request: new Date(),
                date_update: new Date(),
            });

            // 4) mover archivo (si vino) a carpeta del ticket
            let fileMeta = null;

            const mainFile = req.files?.file?.[0] || null

            if (mainFile) {
                const dir = path.join(UPLOAD_CR, String(t.code));

                ensureDir(dir);
                const finalPath = path.join(dir, mainFile.filename);
                fs.renameSync(mainFile.path, finalPath); // mueve de tmp → tickets/<id>/
                fileMeta = {
                    originalName: mainFile.originalname,
                    filename: mainFile.filename,
                    mimetype: mainFile.mimetype,
                    size: mainFile.size,
                    uploadedAt: new Date(),
                    path: finalPath
                };
                await provSettlements.updateOne(
                    { _id: t._id },
                    { $set: { file: fileMeta } }
                );
            }

            // 5) normalizar e insertar sites
            const docs = (Array.isArray(settlementSites) ? settlementSites : []).map((input) => {
                const llave = (input.id_proyecto && input.linea_inversion)
                    ? `${input.id_proyecto}${extractNumericPrefix(input.linea_inversion)}`
                    : "";

                return {
                    ...input,
                    settlement_id: t._id,

                    code: code, 
                    llave,
                    estado: input.estado ?? "Pendiente",
                    comentarios: input.comentarios ?? "",
                    requester: t.requester,
                    requester_email: t.requester_email,

                    cantidad: input.cantidad ?? 0,
                    precio_unitario: input.total_pago ?? 0,

                    assigned_to: input.assigned_to ?? "",
                    assigned_to_email: input.assigned_to_email ?? ""
                };
            });

            const inserted = docs.length
                ? await provSettlementsSites.collection.insertMany(docs, { ordered: false })
                : { insertedCount: 0 };

            // Q Sitios
            const set = new Set(docs.map(d => d.identificador))
            const insertedCount = set.size;

            // Monto Total
            const amount = docs.reduce((acc, cur) => acc + toNumber(cur.total_pago), 0);

            await provSettlements.updateOne(
                { _id: t._id },
                {
                    $set: { import_status: "READY", import_error: "", date_update: new Date() },
                    $inc: { count: insertedCount, amount: amount }
                }
            );

            // RQ utilizados
            const rqs = [...new Set(
                docs
                    .map((s) => s.rq)
                    .filter(Boolean)
            )];

            const ticketSite = await provSites.find({
                rq: { $in: rqs }
            }).lean();

            if (!ticketSite.length) {
                return res.status(404).json({ result: "NOK", msg: "Ticket no existe" });
            }

            const crMatch = {
                $and: [
                    // ticketSite not ARRAY
                    { "RQ": { $in: rqs } }
                ],
            };

            const crPipeline = [
                { $match: crMatch },
                { $project: projectStageCR },
            ];

            const crs = await provCR_individual.aggregate(crPipeline).exec();

            const paymentSites = await provPaymentsSites.find({
                rq: { $in: rqs }
            }).lean()

            // const payments = await provPayments.

            // Ticket Site tiene OC y Linea OC
            let items = attachLineaOC(ticketSite, crs);

            // Match between paymentSite and items using key "OC" and "Linea OC"
            items = items.filter((item) =>
                docs.some((ps) =>
                    item.oc === ps.oc &&
                    String(item.linea_oc) === String(ps.linea_oc)
                )
            );

            // UPDATE SITES
            const makeSettlementKey = (row) => {
                return [
                    row.identificador,
                    row.oc,
                    row.linea_oc,
                ]
                    .map((v) => String(v ?? "").trim().toUpperCase())
                    .join("|");
            };

            // settlementSiteByKey
            // Mapa de settlementSites por identificador + oc + linea_oc
            const settlementSiteByKey = new Map();

            for (const ps of docs) {
                const key = makeSettlementKey(ps);

                if (!key || key === "||") continue;

                settlementSiteByKey.set(key, ps);
            }
            
            // Actualizar provSites
            const bulkOps = items
                .map((item) => {
                    const key = makeSettlementKey(item);
                    const settlementSite = settlementSiteByKey.get(key);

                    if (!settlementSite || !item._id) return null;

                    const cantidadH2 = toNumber(settlementSite.cantidad);
                    const totalPagoH2 = toNumber(settlementSite.total_pago);


                    const setFields = {
                        status_settlement: settlementData.estado,
                        cantidad_pago_pendiente: cantidadH2,
                        monto_pago_pendiente: totalPagoH2

                        // date_update: new Date(),
                    };

                    return {
                        updateOne: {
                            filter: { _id: item._id },
                            update: {
                                $set: setFields,
                            },
                        },
                    };
                })
                .filter(Boolean);

            if (!bulkOps.length) {
                return res.status(404).json({
                    result: "NOK",
                    msg: "No hay sitios para actualizar con match identificador + oc + linea_oc",
                });
            }

            await provSites.bulkWrite(bulkOps, { ordered: false });

            // let code_to_update = []
            let code_to_update = new Set();
            // Actualizar provPaymentsSite
            const bulkOpsPayment = paymentSites
                .map((payment) => {
                    const key = makeSettlementKey(payment);
                    const settlementSite2 = settlementSiteByKey.get(key);

                    if (!settlementSite2 || !payment._id) return null;

                    // code_to_update.push(payment.code)
                    code_to_update.add(payment.code);

                    const cantidadH2 = toNumber(settlementSite2.cantidad);
                    const totalPagoH2 = toNumber(settlementSite2.total_pago);


                    const setFields = {
                        cantidad_h2: cantidadH2,
                        total_pago_h2: totalPagoH2

                        // date_update: new Date(),
                    };

                    return {
                        updateOne: {
                            filter: { _id: payment._id },
                            update: {
                                $set: setFields,
                            },
                        },
                    };
                })
                .filter(Boolean);
     
            if (!bulkOpsPayment.length) {
                return res.status(404).json({
                    result: "NOK",
                    msg: "No hay sitios para actualizar con match identificador + oc + linea_oc",
                });
            }

            await provPaymentsSites.bulkWrite(bulkOpsPayment, { ordered: false });

            for(let code of code_to_update) {

                const paySite = await provPaymentsSites.find({
                    code: code
                }).lean()

                // const amountH1 = items.reduce((acc, cur) => acc + cur.total_pago_h1, 0);
                const amountH2 = paySite.reduce((acc, cur) => acc + cur.total_pago_h2, 0);

                await provPayments.updateOne(
                    { code: code },
                    {
                        $set: {
                            amount_h2: amountH2
                        }
                    }
                )

            }


            res.json({
                result: "OK",
                content: {
                    ticket_id: t._id,
                    code,
                    count: insertedCount,
                    file: fileMeta,
                    // batch_id: batchId,
                },
            });

            // SEND EMAIL
            // await sendEmail(
            //     'normal',
            //     '"Workflow GCIR" <planner.notifier@entel.net.pe>',
            //     // to_workers,
            //     ticketData.requester_email,
            //     // ['ntt_sccopacondo@externo.entel.pe'],
            //     // [],
            //     ['caroline.carrasco.ent@viaexperis2.pe', 'cesar.guzman@entel.pe', 'ntt_sccopacondo@externo.entel.pe'],
            //     // cc_expiration_letter,
            //     `Solicitud Ticket RQ ${ticket_code}`,
            //     generateTicketCreatedHtml({
            //         recipientName: ticketData.requester,
            //         ticketCode: ticket_code
            //     }),
            //     [
            //         // {
            //         //     filename: `${filename}.xlsb`,
            //         //     path: xlsbPath,
            //         //     cid: 'footer' //same cid value as in the html img src
            //         // }
            //     ]
            // );

        } catch (e) {
            console.error(e);
            res.status(500).json({ result: "ERROR", msg: String(e.message ?? e) });
        }
    }
);


async function executeSettlementStateTransition({
    req,
    res,
    rules,
}) {
    try {
        const { provSettlements, provSettlementsSites, provTickets, provSites, provCR_individual } = await db();
        const { settlementId } = req.params;

        const payload = parsePayloadFromReq(req);
        const patch = payload.patch ?? {};

        console.log("PATCH", patch)
        
        const comment = buildComment(payload);

        // Payment  --- SCR
        const ticket = await provSettlements.findById(settlementId);
        if (!ticket) {
            return res.status(404).json({ result: "NOK", msg: "Ticket no existe" });
        }

        // Payment Sites --- SITIOS CON OC
        const settlementSites = await provSettlementsSites.find({ settlement_id: ticket._id }).lean();
        if (!settlementSites.length) {
            return res.status(404).json({ result: "NOK", msg: "Settlement Site no existe" });
        }

        // Extraer RQ únicas desde settlementSites
        const rqs = [...new Set(
            settlementSites
                .map((item) => item.rq)
                .filter(Boolean)
        )];

        if (!rqs.length) {
            return res.status(404).json({
                result: "NOK",
                msg: "Payment Site no tiene RQ válidas"
            });
        }

        // Ticket Sites --- SITIOS SIN OC
        const ticketSite = await provSites.find({
            rq: { $in: rqs }
        }).lean();

        if (!ticketSite.length) {
            return res.status(404).json({ result: "NOK", msg: "Ticket no existe" });
        }

        const crMatch = {
            $and: [
                // ticketSite not ARRAY
                { "RQ": { $in: rqs } }
            ],
        };

        const crPipeline = [
            { $match: crMatch },
            { $project: projectStageCR },
        ];

        const crs = await provCR_individual.aggregate(crPipeline).exec();

        // Ticket Site tiene OC y Linea OC
        let items = attachLineaOC(ticketSite, crs);

        

        // const currentStage = ticket?.currentStage ?? "hito1";
        // const currentLabel = patch?.estado ?? "Pendiente";
        // const stageKey = currentStage === "hito1" ? "hito1" : "hito2";

        const currentState = normalizeState(ticket?.estado ?? SETTLEMENT_STATES.PENDIENTE);
        const targetState = normalizeState(rules.toState);

        ensureTransition(currentState, rules.fromState, targetState, Boolean(rules.allowAnyFrom));

        // campos entrantes
        const incomingTicketJira = patch.ticket_jira;
        const incomingRq = patch.rq;

        const nextTicketJira = incomingTicketJira !== undefined ? incomingTicketJira : (ticket.ticket_jira ?? "");
        const nextRq = incomingRq !== undefined ? incomingRq : (ticket.rq ?? "");

        // Validaciones específicas por endpoint
        if (typeof rules.validate === "function") {
            await rules.validate({
                req,
                payload,
                patch,
                ticket,
                currentState,
                targetState,
                nextTicketJira,
                nextRq,
            });
        }


        // Match between paymentSite and items using key "OC" and "Linea OC"
        items = items.filter((item) =>
            settlementSites.some((ps) =>
                item.oc === ps.oc &&
                String(item.linea_oc) === String(ps.linea_oc)
            )
        );

        const idsToUpdate = items.map((item) => item._id).filter(Boolean);

        if (!idsToUpdate.length) {
            return res.status(404).json({
                result: "NOK",
                msg: "No hay sitios para actualizar"
            });
        }


        await provSites.updateMany(
            { _id: { $in: idsToUpdate } },
            {
                $set: {
                    status_settlement: targetState
                }
            }
        );

        await provSettlementsSites.updateMany(
            { settlement_id: ticket._id },
            {
                $set: {
                    estado: targetState
                }
            }
        )


    
        // 2) Guardar archivo si vino
        saveUploadedFileInTicket(ticket, req.file);

        // 3) Aplicar cambios al ticket (solo campos permitidos por endpoint)
        const now = new Date();

    
        ticket.estado = targetState;

        // campos opcionales por transición
        if (rules.allowTicketJira && incomingTicketJira !== undefined) {
            ticket.ticket_jira = incomingTicketJira;
        }
        if (rules.allowRq && incomingRq !== undefined) {
            ticket.rq = incomingRq;
        }

        // campos adicionales que quieras permitir por endpoint (opcional)
        if (Array.isArray(rules.allowedExtraPatchFields)) {
            for (const k of rules.allowedExtraPatchFields) {
                if (patch[k] !== undefined) ticket[k] = patch[k];
            }
        }

        if (ticket.date_request) {
            ticket.date_request = parseExcelOrISO(ticket.date_request);
        }

        // Comentarios
        if (comment) {
            ticket.comments = ticket.comments ?? [];
            ticket.comments.push(comment);
        }

        await ticket.save();

        return res.json({
            result: "OK",
            content: {
                ticket_id: ticket._id,
                ticket_jira: ticket.ticket_jira ?? null,
                rq: ticket.rq ?? null,
                file: ticket.file ?? null
            },
            // notification: mailStatus,
        });
    } catch (e) {
        console.error(e);
        return res.status(e.statusCode || 500).json({
            result: "ERROR",
            msg: String(e.message ?? e),
        });
    }
}


// ==========================================================
// ENDPOINT 1: Pendiente -> Aprobado
// ==========================================================
managerRouter.patch(
    "/settlements/:settlementId/state/approved",
    uploadTicketExcel.single("file"), // se admite, pero no se usa replaceSites aquí
    async (req, res) => {
        return executeSettlementStateTransition({
            req,
            res,
            rules: {
                fromState: SETTLEMENT_STATES.PENDIENTE,
                toState: SETTLEMENT_STATES.APROBADO,
                allowAnyFrom: false,
                allowReplaceSites: false,
                allowTicketJira: false,
                allowRq: false,
                propagateTicketJira: true,
                propagateRq: false,
                validate: async ({ nextTicketJira }) => {
                    // if (!String(nextTicketJira ?? "").trim()) {
                    //     const err = new Error("ticket_jira es obligatorio para pasar a 'Enviado a MG'");
                    //     err.statusCode = 400;
                    //     throw err;
                    // }
                },
            },
        });
    }
);


managerRouter.patch(
    "/settlements/:settlementId/state/observed",
    uploadTicketExcel.single("file"),
    async (req, res) => {
        return executeSettlementStateTransition({
        req,
        res,
        rules: {
            fromState: SETTLEMENT_STATES.PENDIENTE,
            toState: SETTLEMENT_STATES.OBSERVADO,
            allowAnyFrom: false,
            allowReplaceSites: false,
            allowTicketJira: false,
            allowRq: false,
            propagateTicketJira: false,
            propagateRq: false,
            validate: async ({ nextRq }) => {
            // if (!String(nextRq ?? "").trim()) {
            //     const err = new Error("rq es obligatorio para pasar a 'RQ Generada'");
            //     err.statusCode = 400;
            //     throw err;
            // }
            },
        },
        });
    }
);

managerRouter.patch(
    "/settlements/:settlementId/state/return-pending",
    uploadTicketExcel.single("file"),
    async (req, res) => {
        return executeSettlementStateTransition({
        req,
        res,
        rules: {
            fromState: SETTLEMENT_STATES.OBSERVADO,
            toState: SETTLEMENT_STATES.PENDIENTE,
            allowAnyFrom: false,
            allowReplaceSites: false, // ← endpoint robusto
            allowTicketJira: false,   // si quieres permitir mantener/actualizar jira
            allowRq: false,          // normalmente aquí no aplica rq
            propagateTicketJira: false,
            propagateRq: false,
            validate: async ({ payload, req }) => {
            // Si deseas exigir recarga al volver de Observado a Pendiente:
            // const replaceSites = Boolean(payload.replaceSites) || Boolean(req.file);
            // if (!replaceSites) {
            //   const err = new Error("Debe recargar archivo/sites para volver a Pendiente CT");
            //   err.statusCode = 400;
            //   throw err;
            // }
            },
        },
        });
    }
);

// ==========================================================
// ENDPOINT 4: Cualquier estado -> Cancelado
// Comentarios + fecha_actualizacion
// ==========================================================
managerRouter.patch(
    "/settlements/:settlementId/state/cancel",
    uploadTicketExcel.single("file"),
    async (req, res) => {
        return executeSettlementStateTransition({
        req,
        res,
        rules: {
            fromState: null,
            toState: SETTLEMENT_STATES.CANCELADO,
            allowAnyFrom: true,      // ← cualquier estado
            allowReplaceSites: false,
            allowTicketJira: false,
            allowRq: false,
            propagateTicketJira: false,
            propagateRq: false,
            validate: async ({ currentState }) => {
            if (currentState === SETTLEMENT_STATES.CANCELADO) {
                const err = new Error("El ticket ya está cancelado");
                err.statusCode = 400;
                throw err;
            }
            },
        },
        });
    }
);


managerRouter.get("/jira/test", async (req, res) => {
    try {
        const { data } = await jiraClient.get("/myself");

        return res.json({
            result: "OK",
            content: data,
        });
    } catch (error) {
        console.error("Jira API error:", error.response?.data || error.message);

        return res.status(error.response?.status || 500).json({
            result: "ERROR",
            detail: error.response?.data || error.message,
        });
    }
});

managerRouter.get("/jira/debug", async (req, res) => {
    try {
        console.log("ENV JIRA_BASE_URL:", process.env.JIRA_BASE_URL);
        console.log("AXIOS baseURL:", jiraClient.defaults.baseURL);

        const { data } = await jiraClient.get("/myself");

        res.json({
            result: "OK",
            baseURL: jiraClient.defaults.baseURL,
            content: data,
        });
    } catch (error) {
        res.status(500).json({
            result: "ERROR",
            baseURL: jiraClient.defaults.baseURL,
            message: error.message,
            code: error.code,
            detail: error.response?.data,
        });
    }
});

managerRouter.get("/jira/issues", async (req, res) => {

    console.log("JIRA FILTER ID", process.env.JIRA_FILTER_ID)
    console.log("JIRA BASE URL", process.env.JIRA_BASE_URL)

    try {
        const {
            filterId = process.env.JIRA_FILTER_ID,
            limit = 50,
            nextPageToken,
            search = "",
            allFields = "false",
        } = req.query;

        const perPage = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 5000);

        let jql = `filter = ${filterId}`;

        if (String(search).trim()) {
            const safeSearch = String(search).replace(/"/g, '\\"');
            jql += ` AND text ~ "${safeSearch}"`;
        }

        jql += " ORDER BY created DESC";

        const fields =
            allFields === "true"
                ? ["*all"]
                : [
                    "summary",
                    "status",
                    "assignee",
                    "created",
                    "updated",
                    "issuetype",
                    "project",
                    "description",
                    "attachment",
                    "comment",
                    "customfield_14326",
                    "customfield_19764",
                    "customfield_19823",
                    "priority",
                    "reporter"
                ];

        const body = {
            jql,
            maxResults: perPage,
            fields,
            expand: "names,schema",
        };

        if (nextPageToken) {
            body.nextPageToken = nextPageToken;
        }

        const { data } = await jiraClient.post("/search/jql", body);

        return res.json({
            result: "OK",
            content: {
                items: data.issues || [],
                isLast: data.isLast,
                nextPageToken: data.nextPageToken || null,
                maxResults: perPage,
                jql,
                names: data.names,
                schema: data.schema,
            },
        });

    } catch (error) {
        console.error("Jira API error:", error.response?.data || error.message);

        return res.status(error.response?.status || 500).json({
            result: "ERROR",
            message: "Error consultando Jira",
            detail: error.response?.data || error.message,
        });
    }
});


// GET TICKETS
managerRouter.get("/get-types-deliverables", async (req, res) => {
    try {
        const { provDeliverablesTemplateTypes } = await db();
        const { code, name, active, limit } = req.query;
        const q = {};
        if (code) q.code = code;
        if (name) q.name = name;
        if (active) q.active = active;
       
        const items = await provDeliverablesTemplateTypes.find(q)
            .sort({ _id: -1 })
            .limit(Math.min(parseInt(limit, 10) || 5000, 10000))
            .select("code name description type fields")
            .lean();
        res.json({
            result: "OK",
            content: {
                items,
                nextCursor: items.length ? items[items.length - 1]._id : null,
            },
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ result: "ERROR" });
    }
});

managerRouter.get("/get-types-deliverables-fields", async (req, res) => {
    try {
        const { provDeliverablesTypesFields } = await db();
        const { code, active, limit } = req.query;
        const q = {};
        if (code) q.code = code;
        if (active) q.active = active;
       
        const items = await provDeliverablesTypesFields.find(q)
            .sort({ _id: -1 })
            .limit(Math.min(parseInt(limit, 10) || 5000, 10000))
            .select("required order value estado deliverable_id code type_code type_name field_key field_label field_type createdAt updatedAt")
            .lean();
        res.json({
            result: "OK",
            content: {
                items,
                nextCursor: items.length ? items[items.length - 1]._id : null,
            },
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ result: "ERROR" });
    }
});


managerRouter.get("/download-deliverable-file", async (req, res) => {
    try {
        const { provDeliverables } = await db();
        const { code, name } = req.query;

        console.log("name", name)

        if (!code) {
            return res.status(400).json({ result: "NOK", msg: "ticket_code es requerido" });
        }

        // Buscar por ticket_code (no por _id)
        const ticket = await provDeliverables
            .findOne({ code })
            .select("code sustentos")
            .lean();

        if (!ticket) {
            return res.status(404).json({ result: "NOK", msg: "Ticket no encontrado" });
        }

        // const file = ticket.file;

        let list = []

        if (ticket.sustentos) {
            list.push(...ticket.sustentos)
        }

        // const list = ticket.sustentos || ticket.file || [];

        console.log("LIST", list)

        const file = list.find(f => f.originalName === name);

        console.log("FILE", file)

        if (!file || !file.path) {
            return res.status(404).json({ result: "NOK", msg: "Archivo no encontrado" });
        }

        const filePath = path.resolve(file.path);

        // Validar existencia física
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ result: "NOK", msg: "Archivo no existe en disco" });
        }

        // (Opcional pero recomendado) restringir descargas a carpeta permitida
        const allowedBase = path.resolve("/data/html/planner_app_gcir/resources");
        if (!filePath.startsWith(allowedBase)) {
            return res.status(403).json({ result: "NOK", msg: "Ruta no permitida" });
        }

        // Nombre a mostrar al descargar (preferir original)
        const downloadName = file.originalName || file.filename || path.basename(filePath);

        // Opcional: setear mimetype explícitamente
        if (file.mimetype) {
            res.setHeader("Content-Type", file.mimetype);
        }

        // Descarga real del archivo (NO enviar la ruta como texto)
        return res.download(filePath, downloadName, (err) => {
            if (err) {
                console.error("Error en descarga:", err);
                if (!res.headersSent) {
                return res.status(500).json({ result: "ERROR", msg: "No se pudo descargar el archivo" });
                }
            }
        });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ result: "ERROR", msg: String(e.message ?? e) });
    }
});

// GET UNIQUE TICKETSS FILTERS
managerRouter.get("/get-deliverables-filter-options", async (req, res) => {
    try {
        const { provDeliverables } = await db();

        const cleanDistinct = async (field, q = {}) => {
            const values = await provDeliverables.distinct(field, {
                ...q,
                [field]: {
                    $nin: [null, ""],
                },
            });

            return values
                .filter((value) => value != null && value !== "")
                .map((value) => String(value).trim())
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b));
        };

        const [
            code,
            name,
            estado,
            requester,
            requester_email,
            assigned_to,
            proveedor,
            type_code,
            type_name
        ] = await Promise.all([
            cleanDistinct("code"),
            cleanDistinct("name"),
            cleanDistinct("estado"),
            cleanDistinct("requester"),
            cleanDistinct("requester_email"),
            cleanDistinct("assigned_to"),
            cleanDistinct("proveedor"),
            cleanDistinct("type_code"),
            cleanDistinct("type_name")
        ]);

        return res.json({
            result: "OK",
            content: {
                code: code,
                name: name,
                estado: estado,
                requester: requester,
                requester_email: requester_email,
                assigned_to: assigned_to,
                proveedor: proveedor,
                type_code: type_code,
                type_name: type_name,
            },
        });
    } catch (e) {
        console.error("Error get-ticetks-filter-options:", e);
        return res.status(500).json({
            result: "ERROR",
            message: "Error al obtener opciones de filtros",
        });
    }
});


managerRouter.get("/get-deliverables", async(req, res) => {
    try {

        const { provDeliverables } = await db()

        const {
            code,
            name,
            estado,
            requester,
            requester_email,
            assigned_to,
            assigned_to_email,
            proveedor,
            type_code,
            type_name,
            search = "",
            page = 1,
            limit = 10,
            sortBy = "code",
            sortDirection = "desc"
        } = req.query;

        // Paginación
        const currentPage = Math.max(parseInt(page, 10) || 1, 1);
        const perPage = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 5000);
        const skip = (currentPage - 1) * perPage;

        // Campos permitidos para ordenar
        const allowedSortFields = new Set([
            "code",
            "name",
            "createdAt"
        ]);

        const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "code";
        const safeSortDirection = String(sortDirection).toLowerCase() === "asc" ? -1 : 1;

        // Query base de sites
        const q = {};
        
        if (estado) q.estado = estado;
        if (requester) q.requester = requester;
        if (requester_email) q.requester_email = requester_email;
        if (assigned_to) q.assigned_to = assigned_to;
        if (assigned_to_email) q.assigned_to_email = assigned_to_email;
        if (proveedor) q.proveedor = proveedor;
        if (code) q.code = code;
        if (type_code) q.type_code = type_code;
        if (type_name) q.type_name = type_name;

        // Búsqueda
        if (String(search).trim()) {
            const rx = new RegExp(escapeRegex(String(search).trim()), "i");

            q.$or = [
                { code: rx },
                { name: rx },
                { identificador: rx },
                { sitio: rx },
                { id_proyecto: rx },
                { nombre_proyecto: rx },
                { rq: rx },
                { oc: rx },
                { requester: rx },
                { assigned_to: rx }
            ];
        }

        const deliverableProjection = {
            code: 1,
            name: 1,
            description: 1,
            identificador: 1,
            sitio: 1,
            actividad: 1,
            id_proyecto: 1,
            nombre_proyecto: 1,
            linea_inversion: 1,
            estado: 1,
            proveedor: 1,
            rq_pext: 1,
            rq_pint: 1,
            id_planner_ne: 1,
            id_planner_fe: 1,
            id_ticket_transferencia: 1,
            requester: 1,
            requester_email: 1,
            rq: 1,
            oc: 1,
            linea_oc: 1,
            assigned_to: 1,
            assigned_to_email: 1,
            validated_to: 1,
            validated_to_email: 1,
            validated_at: 1,
            request_type_id: 1,
            type_code: 1,
            type_name: 1,
            template_snapshot: 1,
            sustentos: 1,
            comments: 1,
            createdAt: 1,
            updatedAt: 1,
        };

        // Total + página actual de sites
        const [totalResults, deliverable] = await Promise.all([
            provDeliverables.countDocuments(q),
            provDeliverables
                .find(q, deliverableProjection)
                .sort({
                    [safeSortBy]: safeSortDirection,
                    _id: -1,
                })
                .skip(skip)
                .limit(perPage)
                .lean(),
        ]);

        // Si no hay sites, responder vacío
        if (!deliverable.length) {
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

        return res.json({
            result: "OK",
            content: {
                items: deliverable,
                totalResults,
                totalPages: Math.ceil(totalResults / perPage),
                currentPage
            },
        });


    } catch (e) {

        console.error(e);
        return res.status(500).json({ result: "ERROR" });
    }
})



// INSERT PAYMENTS
managerRouter.post("/insert-deliverables",
    uploadTicketExcel.fields([
        { name: "fileEvidencias", maxCount: 15 }
    ]),
    async (req, res) => {
        try {
            const { 
                provDeliverables, 
                provDeliverablesTemplateTypes, 
                provDeliverablesTypesFields,
                provSites, 
                provCR_individual 
            } = await db();
            // 1) parsear JSON strings (multipart)
            const deliverableData = req.body.deliverableData ? JSON.parse(req.body.deliverableData) : {};
            console.log("SData", deliverableData)

            //Get Template
            const type = await provDeliverablesTemplateTypes.findOne({
                code: String(deliverableData.type_code || "").trim(),
                active: true
            }).lean();

            if (!type) {
                return res.status(404).json({
                    result: "NOK",
                    message: "Tipo de solicitud no encontrado"
                });
            }

            // 2) generar código y batch
            const prefix = "GCIR";
            const code = await nextTicketCode(prefix, 5);
            // 3) crear ticket
            const t = await provDeliverables.create({
                ...deliverableData,
                code,
                estado: deliverableData.estado ?? "Pendiente",

                request_type_id: type._id,
                type_code: type.code,
                type_name: type.name,

                count: type.fields?.filter(f => f.active !== false).length || 0,

                template_snapshot: {
                    code: type.code,
                    name: type.name,
                    fields: type.fields
                },

                date_request: new Date(),
                date_update: new Date(),
            });

            // 4) mover archivo (si vino) a carpeta del ticket
            let fileMetaSustentos = [];
            const sustentosFiles = req.files?.fileEvidencias || []
            if (sustentosFiles.length > 0) {
                const dir = path.join(UPLOAD_DELIVERABLES, String(t.code));
                ensureDir(dir);
                for (let i = 0; i < sustentosFiles.length; i++) {
                    const file = sustentosFiles[i];
                    const finalPath = path.join(dir, file.filename);
                    fs.renameSync(file.path, finalPath); // mueve de tmp → tickets/<id>/
                    fileMetaSustentos.push({
                        originalName: file.originalname,
                        filename: file.filename,
                        mimetype: file.mimetype,
                        size: file.size,
                        uploadedAt: new Date(),
                        path: finalPath
                    });
                }
                console.log("FILE META SUSTENTOS", fileMetaSustentos);
                await provDeliverables.updateOne(
                    { _id: t._id },
                    { $set: { sustentos: fileMetaSustentos } }
                );
            }

            const fieldsToInsert = (type.fields || [])
                .filter(f => f.active !== false)
                .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
                .map(f => ({
                    deliverable_id: t._id,
                    code: t.code,

                    type_code: type.code,
                    type_name: type.name,

                    field_key: f.key,
                    field_label: f.label,
                    field_type: f.field_type,

                    options: f.options || [],
                    required: f.required || false,
                    order: f.order || 0,

                    value: null,
                    estado: "Pendiente"
                }));

            if (fieldsToInsert.length) {
                await provDeliverablesTypesFields.insertMany(fieldsToInsert);
            }

            
            const ticketSite = await provSites.find({
                rq: t.rq
            }).lean();

            if (!ticketSite.length) {
                return res.status(404).json({ result: "NOK", msg: "Ticket no existe" });
            }

            const crMatch = {
                $and: [
                    // ticketSite not ARRAY
                    { "RQ": t.rq }
                ],
            };

            const crPipeline = [
                { $match: crMatch },
                { $project: projectStageCR },
            ];

            const crs = await provCR_individual.aggregate(crPipeline).exec();
            let items = attachLineaOC(ticketSite, crs);

            // Match between paymentSite and items using key "OC" and "Linea OC"
            items = items.filter((item) => item.oc == t.oc && String(item.linea_oc) == String(t.linea_oc))

            console.log("ITEMS", items);

            // UPDATE SITES
            const makeSettlementKey = (row) => {
                return [
                    row.identificador,
                    row.oc,
                    row.linea_oc,
                ]
                    .map((v) => String(v ?? "").trim().toUpperCase())
                    .join("|");
            };

            // settlementSiteByKey
            // Mapa de settlementSites por identificador + oc + linea_oc
            const settlementSiteByKey = new Map();

            // for (const ps of docs) {
            const key = makeSettlementKey(t);

            // if (!key || key === "||") ;

            settlementSiteByKey.set(key, t);
            // }

            console.log("key", key)
            console.log("settlementSiteByKey", settlementSiteByKey)
            
            // Actualizar provSites
            const bulkOps = items
                .map((item) => {
                    const key = makeSettlementKey(item);
                    const settlementSite = settlementSiteByKey.get(key);

                    if (!settlementSite || !item._id) return null;


                    const setFields = {
                        status_deliverable: t.estado
                    };

                    return {
                        updateOne: {
                            filter: { _id: item._id },
                            update: {
                                $set: setFields,
                            },
                        },
                    };
                })
                .filter(Boolean);

            if (!bulkOps.length) {
                return res.status(404).json({
                    result: "NOK",
                    msg: "No hay sitios para actualizar con match identificador + oc + linea_oc",
                });
            }

            await provSites.bulkWrite(bulkOps, { ordered: false });


            res.json({
                result: "OK",
                content: {
                    ticket_id: t._id,
                    code
                    // batch_id: batchId,
                },
            });

            // SEND EMAIL
            // await sendEmail(
            //     'normal',
            //     '"Workflow GCIR" <planner.notifier@entel.net.pe>',
            //     // to_workers,
            //     ticketData.requester_email,
            //     // ['ntt_sccopacondo@externo.entel.pe'],
            //     // [],
            //     ['caroline.carrasco.ent@viaexperis2.pe', 'cesar.guzman@entel.pe', 'ntt_sccopacondo@externo.entel.pe'],
            //     // cc_expiration_letter,
            //     `Solicitud Ticket RQ ${ticket_code}`,
            //     generateTicketCreatedHtml({
            //         recipientName: ticketData.requester,
            //         ticketCode: ticket_code
            //     }),
            //     [
            //         // {
            //         //     filename: `${filename}.xlsb`,
            //         //     path: xlsbPath,
            //         //     cid: 'footer' //same cid value as in the html img src
            //         // }
            //     ]
            // );

        } catch (e) {
            console.error(e);
            res.status(500).json({ result: "ERROR", msg: String(e.message ?? e) });
        }
    }
);


// managerRouter.patch(
//     "/deliverables/update/information/:deliverableId",
//     uploadTicketExcel.fields([
//         { name: "fileSustentos", maxCount: 30 }
//     ]),
//     async (req, res) => {
//         try {
//             const { provDeliverables, provDeliverablesTypesFields } = await db();
//             const { deliverableId } = req.params;
//             // const payload = req.body.payload
//             const payload = JSON.parse(req.body.payload)
//             const { code, general } = payload
//             // const { items } = req.body

//             console.log("deliverableId", deliverableId)
//             console.log("ITEMS", items)
//             console.log("req.fileSustentos", req.files?.fileSustentos)

//             if (!deliverableId) {
//                 return res.status(400).json({
//                     result: "NOK",
//                     msg: "code es requerido",
//                 })
//             }

//             if (!Array.isArray(items)) {
//                 return res.status(400).json({
//                     result: "NOK",
//                     msg: "items debe ser un array",
//                 })
//             }

//             const deliverable = await provDeliverables.findById(deliverableId).lean();

//             if (!deliverable) {
//                 return res.status(404).json({
//                     result: "NOK",
//                     message: "Solicitud no encontrada"
//                 });
//             }

//             const currentFields = await provDeliverablesTypesFields
//                 .find({ deliverable_id: deliverable._id })
//                 .lean();

//             const fieldMap = new Map(
//                 currentFields.map(f => [f.field_key, f])
//             );

//             const bulkOps = fields
//                 .map(item => {
//                     const current = fieldMap.get(item.field_key);

//                     if (!current) return null;

//                     let value = item.value;

//                     if (current.field_type === "date" && value) {
//                         value = new Date(value);
//                     }

//                     if (current.field_type === "number") {
//                         value = Number(value || 0);
//                     }

//                     return {
//                         updateOne: {
//                             filter: {
//                                 deliverable_id: deliverable._id,
//                                 field_key: item.field_key
//                             },
//                             update: {
//                                 $set: {
//                                     value,
//                                     estado: "Completado",
//                                     validated_by: general.validator ?? "",
//                                     validated_by_email: general.validator_email ?? "",
//                                     validated_at: new Date()
//                                 }
//                             }
//                         }
//                     };
//                 })
//                 .filter(Boolean);

//             if (bulkOps.length) {
//                 await provDeliverablesTypesFields.bulkWrite(bulkOps);
//             }

//             // Actualizar estado por cada SAVE (REVISAR)
//             // await provRequests.updateOne(
//             //     { _id: deliverable._id },
//             //     {
//             //         $set: {
//             //             estado: "En Validación",
//             //             validator,
//             //             validator_email,
//             //             validated_at: new Date()
//             //         }
//             //     }
//             // );

//             let fileMetaSustentos = []
//             const sustentosFiles = req.files?.fileSustentos || []

//             if(sustentosFiles.length > 0) {

//                 const dir = path.join(UPLOAD_DELIVERABLES, String(deliverableId));

//                 ensureDir(dir);

//                 for (let i = 0; i < sustentosFiles.length; i++) {
//                     const file = sustentosFiles[i];
//                     const finalPath = path.join(dir, file.filename);
//                     fs.renameSync(file.path, finalPath); // mueve de tmp → tickets/<id>/
//                     fileMetaSustentos.push({
//                         originalName: file.originalname,
//                         filename: file.filename,
//                         mimetype: file.mimetype,
//                         size: file.size,
//                         uploadedAt: new Date(),
//                         path: finalPath
//                     });
//                 }

//                 console.log("FILE META SUSTENTOS", fileMetaSustentos);

//                 await provDeliverables.updateOne(
//                     { code: deliverableId },
//                     { $push: { sustentos: fileMetaSustentos } }
//                 );
//             }

//             return res.json({
//                 result: "OK",
//                 msg: "Items actualizados correctamente",
//             })

//         } catch (e) {
//             console.log(e)
//             return res.status(500).json({
//                 result: "NOK",
//                 msg: "Error interno",
//             })
//         }
//     }
// );

const toNumberOrNull = (value) => {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

const buildInValues = (value) => {
    const str = String(value ?? "").trim();
    const num = Number(str);

    const values = [str];

    if (Number.isFinite(num)) {
        values.push(num);
    }

    return [...new Set(values)];
};

managerRouter.patch(
    "/settlements/update/sites",
    uploadTicketExcel.any(),
    async (req, res) => {
        try {
            const { provSites, provCR_individual } = await db();
            // const { deliverableId } = req.params;
            // const payload = req.body.payload
            const payload = JSON.parse(req.body.payload)
            const { 
                action,
                itemsSettlement
            } = payload
            // const { items } = req.body

            console.log("action", action)
            console.log("itemsSettlement", itemsSettlement)

            if (!Array.isArray(itemsSettlement) || itemsSettlement.length === 0) {
                return res.status(400).json({
                    result: "NOK",
                    msg: "itemsSettlement es requerido y debe ser un array.",
                });
            }

            // console.log("deliverableId", deliverableId)
            // console.log("req.files", req.files?.fileLiquidaciones)

            const filesByFieldName = new Map(
                (req.files || []).map((file) => [file.fieldname, file])
            );

            // RQ utilizados
            const rqs = [...new Set(
                itemsSettlement
                    .map((s) => s.rq)
                    .filter(Boolean)
            )];

            const sites = await provSites.find({
                rq: { $in: rqs }
            }).lean();

            if (!sites.length) {
                return res.status(404).json({ result: "NOK", msg: "Ticket no existe" });
            }

            const crMatch = {
                $and: [
                    // sites not ARRAY
                    { "RQ": { $in: rqs } }
                ],
            };

            const crPipeline = [
                { $match: crMatch },
                { $project: projectStageCR },
            ];

            const crs = await provCR_individual.aggregate(crPipeline).exec();
            // const payments = await provPayments.

            // Ticket Site tiene OC y Linea OC
            let itemsCrs = attachLineaOC(sites, crs);

            // Match between paymentSite and items using key "OC" and "Linea OC"
            itemsCrs = itemsCrs.filter((item) =>
                itemsSettlement.some((ps) =>
                    item.oc === ps.oc &&
                    String(item.linea_oc) === String(ps.linea_oc)
                )
            );

            // UPDATE SITES
            const makeKey = (row) => {
                return [
                    row.identificador,
                    row.oc,
                    row.linea_oc,
                ]
                    .map((v) => String(v ?? "").trim().toUpperCase())
                    .join("|");
            };

            // settlementSiteByKey
            // Mapa de settlementSites por identificador + oc + linea_oc
            const siteByKey = new Map();

            for (const ps of itemsSettlement) {
                const key = makeKey(ps);

                if (!key || key === "||") continue;

                siteByKey.set(key, ps);
            }

            const now = new Date();
            
            let fileMeta = null;

            // Actualizar provSites
            const bulkOps = itemsCrs
                .map((item) => {
                    const key = makeKey(item);
                    const settlementSite = siteByKey.get(key);

                    if (!settlementSite || !item._id) return null;

                    const cantidadH2 = toNumber(settlementSite.cantidad);
                    const totalPagoH2 = toNumber(settlementSite.total_pago);

                    const setFields = {
                        liquidacion: toNumberOrNull(settlementSite.liquidacion),
                        status_deliverable: settlementSite.status_deliverable || null,
                        descuento: toNumberOrNull(settlementSite.descuento),
                        penalidad: toNumberOrNull(settlementSite.penalidad),
                        pendiente_pago: toNumberOrNull(settlementSite.pendiente_pago),
                        monto_final_pagado: toNumberOrNull(settlementSite.monto_final_pagado),
                        estado_oc_draw: settlementSite.estado_oc_draw || "Abierta",
                        updatedAt: now,
                    };

                    const fileField = settlementSite.sustento_file_field;
                    if (fileField && filesByFieldName.has(fileField)) {
                        const mainFile = filesByFieldName.get(fileField);
                        // mover archivo y guardar metadata en provSites
                        const dir = path.join(UPLOAD_SETTLEMENTS);
                        ensureDir(dir);
                        const finalPath = path.join(dir, mainFile.filename);
                        fs.renameSync(mainFile.path, finalPath); // mueve de tmp → tickets/<id>/
                        fileMeta = {
                            originalName: mainFile.originalname,
                            filename: mainFile.filename,
                            mimetype: mainFile.mimetype,
                            size: mainFile.size,
                            uploadedAt: new Date(),
                            path: finalPath
                        };

                        setFields.sustento_liquidacion = fileMeta
                    }

                    if (action === "GENERATE") {
                        setFields.status_settlement = "Ok";
                    }

                    return {
                        updateOne: {
                            filter: { _id: item._id },
                            update: {
                                $set: setFields,
                            },
                        },
                    };
                })
                .filter(Boolean);

            if (!bulkOps.length) {
                return res.status(404).json({
                    result: "NOK",
                    msg: "No hay sitios para actualizar con match identificador + oc + linea_oc",
                });
            }

            await provSites.bulkWrite(bulkOps, { ordered: false });

            return res.json({
                result: "OK",
                msg:
                    action === "SAVE"
                        ? "Liquidación guardada correctamente."
                        : "Liquidación generada correctamente.",
                action
            });

        } catch (e) {
            console.log(e)
            return res.status(500).json({
                result: "NOK",
                msg: "Error interno",
            })
        }
    }
);


managerRouter.patch(
    "/deliverables/update/:deliverableId",
    uploadTicketExcel.fields([
        { name: "fileEvidencias", maxCount: 30 }
    ]),
    async (req, res) => {
        try {
            const { provDeliverables, provDeliverablesTypesFields } = await db();
            const { deliverableId } = req.params;
            // const payload = req.body.payload
            const payload = JSON.parse(req.body.payload)
            const { 
                code, 
                general, 
                fields,
                assigned_to,
                assigned_to_email,
                validated_to,
                validated_to_email,
            } = payload
            // const { items } = req.body

            console.log("deliverableId", deliverableId)
            console.log("req.fileEvidencias", req.files?.fileEvidencias)

            if (!deliverableId) {
                return res.status(400).json({
                    result: "NOK",
                    msg: "code es requerido",
                })
            }

            const deliverable = await provDeliverables.find({ code: deliverableId }).lean();

            console.log("deliverable", deliverable)

            if (!deliverable) {
                return res.status(404).json({
                    result: "NOK",
                    message: "Solicitud no encontrada"
                });
            }

            const currentFields = await provDeliverablesTypesFields
                .find({ code: deliverableId })
                .lean();

            console.log("currentFields", currentFields)

            const fieldMap = new Map(
                currentFields.map(f => [f.field_key, f])
            );

            const bulkOps = fields
                .map(item => {
                    const current = fieldMap.get(item.field_key);

                    if (!current) return null;

                    let value = item.value;

                    if (current.field_type === "date" && value) {
                        value = new Date(value);
                    }

                    if (current.field_type === "number") {
                        value = Number(value || 0);
                    }

                    return {
                        updateOne: {
                            filter: {
                                code: deliverableId,
                                field_key: item.field_key
                            },
                            update: {
                                $set: {
                                    value,
                                    estado: item.estado,
                                    validated_to: validated_to,
                                    validated_to_email: validated_to_email,
                                    assigned_to: assigned_to,
                                    assigned_to_email: assigned_to_email,
                                    validated_at: new Date()
                                }
                            }
                        }
                    };
                })
                .filter(Boolean);

            if (bulkOps.length) {
                await provDeliverablesTypesFields.bulkWrite(bulkOps);
            }

            // Actualizar estado por cada SAVE (REVISAR)
            // await provRequests.updateOne(
            //     { _id: deliverable._id },
            //     {
            //         $set: {
            //             estado: "En Validación",
            //             validator,
            //             validator_email,
            //             validated_at: new Date()
            //         }
            //     }
            // );

            let fileMetaSustentos = []
            const sustentosFiles = req.files?.fileEvidencias || []

            if(sustentosFiles.length > 0) {

                const dir = path.join(UPLOAD_DELIVERABLES, String(deliverableId));

                ensureDir(dir);

                for (let i = 0; i < sustentosFiles.length; i++) {
                    const file = sustentosFiles[i];
                    const finalPath = path.join(dir, file.filename);
                    fs.renameSync(file.path, finalPath); // mueve de tmp → tickets/<id>/
                    fileMetaSustentos.push({
                        originalName: file.originalname,
                        filename: file.filename,
                        mimetype: file.mimetype,
                        size: file.size,
                        uploadedAt: new Date(),
                        path: finalPath
                    });
                }

                console.log("FILE META SUSTENTOS", fileMetaSustentos);

                await provDeliverables.updateOne(
                    { code: deliverableId },
                    { $push: { sustentos: fileMetaSustentos } }
                );
            }

            return res.json({
                result: "OK",
                msg: "Items actualizados correctamente",
            })

        } catch (e) {
            console.log(e)
            return res.status(500).json({
                result: "NOK",
                msg: "Error interno",
            })
        }
    }
);

async function executeDelivarableStateTransition({
    req,
    res,
    rules,
}) {
    try {
        const { provDeliverables, provDeliverablesTypesFields, provSites, provCR_individual } = await db();
        const { deliverableId } = req.params;

        const payload = parsePayloadFromReq(req);
        const patch = payload.patch ?? {};

        console.log("PATCH", patch)
        
        const comment = buildComment(payload);

        // Payment  --- SCR
        const ticket = await provDeliverables.findById(deliverableId);
        if (!ticket) {
            return res.status(404).json({ result: "NOK", msg: "Ticket no existe" });
        }

        // Deliverable Fields
        const deliverableFields = await provDeliverablesTypesFields.find({ deliverable_id: ticket._id }).lean();
        if (!deliverableFields.length) {
            return res.status(404).json({ result: "NOK", msg: "Fields no existe" });
        }

        const ticketSite = await provSites.find({
            rq: ticket.rq
        }).lean();

        if (!ticketSite.length) {
            return res.status(404).json({ result: "NOK", msg: "Ticket no existe" });
        }

        const crMatch = {
            $and: [
                // ticketSite not ARRAY
                { "RQ": ticket.rq }
            ],
        };

        const crPipeline = [
            { $match: crMatch },
            { $project: projectStageCR },
        ];

        const crs = await provCR_individual.aggregate(crPipeline).exec();
        let items = attachLineaOC(ticketSite, crs);

    

        // const currentStage = ticket?.currentStage ?? "hito1";
        // const currentLabel = patch?.estado ?? "Pendiente";
        // const stageKey = currentStage === "hito1" ? "hito1" : "hito2";

        const currentState = normalizeState(ticket?.estado ?? DELIVERABLE_STATES.PENDIENTE);
        const targetState = normalizeState(rules.toState);

        ensureTransition(currentState, rules.fromState, targetState, Boolean(rules.allowAnyFrom));

        // campos entrantes
        const incomingTicketJira = patch.ticket_jira;
        const incomingRq = patch.rq;

        const nextTicketJira = incomingTicketJira !== undefined ? incomingTicketJira : (ticket.ticket_jira ?? "");
        const nextRq = incomingRq !== undefined ? incomingRq : (ticket.rq ?? "");

        // Validaciones específicas por endpoint
        if (typeof rules.validate === "function") {
            await rules.validate({
                req,
                payload,
                patch,
                ticket,
                currentState,
                targetState,
                nextTicketJira,
                nextRq,
            });
        }


        // Match between paymentSite and items using key "OC" and "Linea OC"
        items = items.filter((item) => item.oc == ticket.oc && String(item.linea_oc) == String(ticket.linea_oc))

        const idsToUpdate = items.map((item) => item._id).filter(Boolean);

        if (!idsToUpdate.length) {
            return res.status(404).json({
                result: "NOK",
                msg: "No hay sitios para actualizar"
            });
        }


        await provSites.updateMany(
            { _id: { $in: idsToUpdate } },
            {
                $set: {
                    status_deliverable: targetState
                }
            }
        );

        // await provDeliverablesTypesFields.updateMany(
        //     { deliverable_id: ticket._id },
        //     {
        //         $set: {
        //             estado: targetState
        //         }
        //     }
        // )


    
        // 2) Guardar archivo si vino
        saveUploadedFileInTicket(ticket, req.file);

        // 3) Aplicar cambios al ticket (solo campos permitidos por endpoint)
        const now = new Date();

    
        ticket.estado = targetState;

        // campos opcionales por transición
        if (rules.allowTicketJira && incomingTicketJira !== undefined) {
            ticket.ticket_jira = incomingTicketJira;
        }
        if (rules.allowRq && incomingRq !== undefined) {
            ticket.rq = incomingRq;
        }

        // campos adicionales que quieras permitir por endpoint (opcional)
        if (Array.isArray(rules.allowedExtraPatchFields)) {
            for (const k of rules.allowedExtraPatchFields) {
                if (patch[k] !== undefined) ticket[k] = patch[k];
            }
        }

        if (ticket.date_request) {
            ticket.date_request = parseExcelOrISO(ticket.date_request);
        }

        // Comentarios
        if (comment) {
            ticket.comments = ticket.comments ?? [];
            ticket.comments.push(comment);
        }

        await ticket.save();

        return res.json({
            result: "OK",
            content: {
                ticket_id: ticket._id,
                ticket_jira: ticket.ticket_jira ?? null,
                rq: ticket.rq ?? null,
                file: ticket.file ?? null
            },
            // notification: mailStatus,
        });
    } catch (e) {
        console.error(e);
        return res.status(e.statusCode || 500).json({
            result: "ERROR",
            msg: String(e.message ?? e),
        });
    }
}

// ==========================================================
// ENDPOINT 1: Pendiente -> Aprobado
// ==========================================================
managerRouter.patch(
    "/deliverables/:deliverableId/state/approved",
    uploadTicketExcel.single("file"), // se admite, pero no se usa replaceSites aquí
    async (req, res) => {
        return executeDelivarableStateTransition({
            req,
            res,
            rules: {
                fromState: SETTLEMENT_STATES.PENDIENTE,
                toState: SETTLEMENT_STATES.APROBADO,
                allowAnyFrom: false,
                allowReplaceSites: false,
                allowTicketJira: false,
                allowRq: false,
                propagateTicketJira: true,
                propagateRq: false,
                validate: async ({ nextTicketJira }) => {
                    // if (!String(nextTicketJira ?? "").trim()) {
                    //     const err = new Error("ticket_jira es obligatorio para pasar a 'Enviado a MG'");
                    //     err.statusCode = 400;
                    //     throw err;
                    // }
                },
            },
        });
    }
);


managerRouter.patch(
    "/deliverables/:deliverableId/state/observed",
    uploadTicketExcel.single("file"),
    async (req, res) => {
        return executeDelivarableStateTransition({
        req,
        res,
        rules: {
            fromState: SETTLEMENT_STATES.PENDIENTE,
            toState: SETTLEMENT_STATES.OBSERVADO,
            allowAnyFrom: false,
            allowReplaceSites: false,
            allowTicketJira: false,
            allowRq: false,
            propagateTicketJira: false,
            propagateRq: false,
            validate: async ({ nextRq }) => {
            // if (!String(nextRq ?? "").trim()) {
            //     const err = new Error("rq es obligatorio para pasar a 'RQ Generada'");
            //     err.statusCode = 400;
            //     throw err;
            // }
            },
        },
        });
    }
);

managerRouter.patch(
    "/deliverables/:deliverableId/state/return-pending",
    uploadTicketExcel.single("file"),
    async (req, res) => {
        return executeDelivarableStateTransition({
        req,
        res,
        rules: {
            fromState: SETTLEMENT_STATES.OBSERVADO,
            toState: SETTLEMENT_STATES.PENDIENTE,
            allowAnyFrom: false,
            allowReplaceSites: false, // ← endpoint robusto
            allowTicketJira: false,   // si quieres permitir mantener/actualizar jira
            allowRq: false,          // normalmente aquí no aplica rq
            propagateTicketJira: false,
            propagateRq: false,
            validate: async ({ payload, req }) => {
            // Si deseas exigir recarga al volver de Observado a Pendiente:
            // const replaceSites = Boolean(payload.replaceSites) || Boolean(req.file);
            // if (!replaceSites) {
            //   const err = new Error("Debe recargar archivo/sites para volver a Pendiente CT");
            //   err.statusCode = 400;
            //   throw err;
            // }
            },
        },
        });
    }
);

// ==========================================================
// ENDPOINT 4: Cualquier estado -> Cancelado
// Comentarios + fecha_actualizacion
// ==========================================================
managerRouter.patch(
    "/deliverables/:deliverableId/state/cancel",
    uploadTicketExcel.single("file"),
    async (req, res) => {
        return executeDelivarableStateTransition({
        req,
        res,
        rules: {
            fromState: null,
            toState: SETTLEMENT_STATES.CANCELADO,
            allowAnyFrom: true,      // ← cualquier estado
            allowReplaceSites: false,
            allowTicketJira: false,
            allowRq: false,
            propagateTicketJira: false,
            propagateRq: false,
            validate: async ({ currentState }) => {
            if (currentState === SETTLEMENT_STATES.CANCELADO) {
                const err = new Error("El ticket ya está cancelado");
                err.statusCode = 400;
                throw err;
            }
            },
        },
        });
    }
);



module.exports = managerRouter;