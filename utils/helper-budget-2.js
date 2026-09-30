function normalize(text = "") {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function toAmount(value) {
    if (value == null || value === "") return null;

    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }

    const cleaned = String(value)
        .replace(/,/g, "")
        .replace(/\s/g, "");

    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}

function scoreCandidate(d1, d2, matchType) {
    const d2Text = normalize(d2.descripcion_adicional);

    let score = 0;

    const splitSite = d1.sitio.split("_")
    const extractSite = splitSite.length > 1 ? splitSite.slice(1,).join("_") : splitSite

    const idNorm = normalize(d1.identificador);
    const siteNorm = normalize(extractSite);
    const actividadNorm = normalize(d1.actividad);
    const solucionNorm = normalize(d1.solucion);
    const sustentoNorm = normalize(d1.sustento);

    // Prioriza el tipo de match que disparó la búsqueda
    if (matchType === "IDENTIFICADOR" && idNorm && d2Text.includes(idNorm)) {
        score += 100;
    }

    if (matchType === "SITIO" && siteNorm && d2Text.includes(siteNorm)) {
        score += 100;
    }

    // Señales adicionales para desempatar
    if (idNorm && d2Text.includes(idNorm)) score += 50;
    if (siteNorm && d2Text.includes(siteNorm)) score += 40;
    if (actividadNorm && d2Text.includes(actividadNorm)) score += 30;
    if (solucionNorm && d2Text.includes(solucionNorm)) score += 20;
    if (sustentoNorm && d2Text.includes(sustentoNorm)) score += 10;

    return score;
}

// ############################# GET FIELDS #############################
const normalizeValue = (value) => {
    return String(value ?? "").trim();
};

function getRQValue(row) {
    return String(
        row.rq ??
        row.RQ ??
        ""
    ).trim();
}

function getLineaValue(row) {
    return row.linea_oc ?? row.nro_linea ?? null;
}

function getEstadoOcValue(row) {
    return row.estado_oc ?? null;
}

function getDescripcionRQValue(row) {
    return String(
        row.descripcion_rq ??
        row.descripcionRQ ??
        row["Descripción de RQ"] ??
        ""
    ).trim();
}

function getDescripcionAdicionalValue(row) {
    return String(
        row.descripcion_adicional ??
        row.descripcionAdicional ??
        row["Descripción Adicional"] ??
        ""
    ).trim();
}

function getTicketJiraValue(row) {
    return String(
        row.ticket_jira ??
        row.ticketJira ??
        row["Ticket Jira"] ??
        ""
    ).trim();
}

function getRQKey(rq) {
    return String(rq ?? "").trim().toUpperCase();
}

const getOcValue = (row) => {
    return normalizeValue(row.nro_oc ?? row.oc);
};


const getCrValue = (row) => {
    return normalizeValue(
        row.codigo_recepcion ??
        row.cr ??
        row["Código Recepción"]
    );
};

function getFechaRecepcionValue(row) {
    return String(
        row.fecha_recepcion ??
        row.fechaRecepcion ??
        row["Fecha Recepción"] ??
        ""
    ).trim();
}

function getFechaRq(row) {
    return String(
        row.fecha_emision_rq ??
        row["Fecha Emisión Rq"] ??
        ""
    ).trim()
}

function getFechaOc(row) {
    return String(
        row.fecha_oc ??
        row["fecha_emision_oc"] ??
        ""
    ).trim()
}


// ############################# #############################


// function getSiteComparableValue(sitio) {
//     const value = String(sitio ?? "").trim();

//     if (!value) return "";

//     const splitSite = value.split("_");

//     return splitSite.length > 1
//         ? splitSite.slice(1).join("_")
//         : value;
// }


function isWeakSearchValue(value) {
    const text = String(value ?? "").trim().toLowerCase();

    if (!text) return true;

    // Muy corto
    if (text.length < 8) return true;

    // Solo números
    if (/^\d+$/.test(text)) return true;

    // Casos genéricos: R2026, V2026, 2026, A2026, etc.
    if (/^[a-z]?\d{4}$/.test(text)) return true;

    return false;
}

function getSiteSearchTerms(sitio) {
    const raw = String(sitio ?? "").trim();

    if (!raw) return [];

    const terms = [];

    // Sitio completo
    terms.push(raw);

    // Parte posterior al primer "_"
    const splitSite = raw.split("_");

    if (splitSite.length > 1) {
        terms.push(splitSite.slice(1).join("_"));
    }

    // Si viene como "site A to site B", considerar ambos extremos
    raw.split(/\s+to\s+/i).forEach((part) => {
        if (part) terms.push(part);
    });

    return [...new Set(
        terms
            .map((x) => normalize(x))
            .filter((x) => !isWeakSearchValue(x))
    )];
}


function normalizeTicket(value) {
    return String(value ?? "").trim().toUpperCase();
}

function extractTicketFromText(text) {
    const match = String(text ?? "").match(/[A-Z]+-\d+/i);
    return match ? match[0].toUpperCase() : "";
}

function resolveRQForRow(row, rowsByTicket) {
    const currentRQ = getRQValue(row);

    // 1) RQ Manual - OK
    if (currentRQ) {
        return {
            rq: currentRQ,
            rq_match_status: "RQ_MANUAL",
            rq_match_score: 100,
            rq_match_term: null,
        };
    }

    const ticket = normalizeTicket(getTicketJiraValue(row));

    if (!ticket) {
        return {
            rq: "",
            rq_match_status: "RQ_SIN_TICKET",
            rq_match_score: 0,
            rq_match_term: null,
        };
    }

    const ticketRows = rowsByTicket.get(ticket) || [];

    if (ticketRows.length === 0) {
        return {
            rq: "",
            rq_match_status: "RQ_AUTO_SIN_TICKET_EN_CR",
            rq_match_score: 0,
            rq_match_term: null,
        };
    }

    const idNorm = normalize(row.identificador);
    const siteTerms = getSiteSearchTerms(row.sitio);

    let matches = [];
    let matchMode = null;

    // 2) BÚSQUEDA POR IDENTIFICADOR
    if (!isWeakSearchValue(idNorm)) {
        matches = ticketRows
            .map((d2) => {
                const ok = d2.__desc_adicional_norm.includes(idNorm);

                if (!ok) return null;

                return {
                    row: d2,
                    rq: d2.__rq,
                    score: 180,
                    matchTerm: idNorm,
                    matchMode: "IDENTIFICADOR",
                };
            })
            .filter(Boolean);

        if (matches.length > 0) {
            matchMode = "IDENTIFICADOR";
        }
    }

    // 3) BÚSQUEDA POR SITIO
    if (matches.length === 0 && siteTerms.length > 0) {
        matches = ticketRows
            .map((d2) => {
                const matchedTerm = siteTerms.find((term) => {
                    return d2.__desc_adicional_norm.includes(term);
                });

                if (!matchedTerm) return null;

                return {
                    row: d2,
                    rq: d2.__rq,
                    score: 150,
                    matchTerm: matchedTerm,
                    matchMode: "SITIO",
                };
            })
            .filter(Boolean);

        if (matches.length > 0) {
            matchMode = "SITIO";
        }
    }

    if (matches.length === 0) {
        return {
            rq: "",
            rq_match_status: "RQ_AUTO_SIN_MATCH",
            rq_match_score: 0,
            rq_match_term: null,
        };
    }

    // 4) AGRUPAR POR RQ
    const grouped = matches.reduce((acc, item) => {
        const key = getRQKey(item.rq);

        if (!key) return acc;

        if (!acc[key]) {
            acc[key] = {
                rq: item.rq,
                count: 0,
                maxScore: 0,
                firstIdx: item.row._idx,
                matchTerm: item.matchTerm,
                matchMode: item.matchMode,
            };
        }

        acc[key].count += 1;
        acc[key].maxScore = Math.max(acc[key].maxScore, item.score);
        acc[key].firstIdx = Math.min(acc[key].firstIdx, item.row._idx);

        return acc;
    }, {});

    const ranked = Object.values(grouped).sort((a, b) => {
        // 1. Mayor score
        if (b.maxScore !== a.maxScore) return b.maxScore - a.maxScore;

        // 2. Más ocurrencias del mismo RQ
        if (b.count !== a.count) return b.count - a.count;

        // 3. Primero en data2
        return a.firstIdx - b.firstIdx;
    });

    const best = ranked[0];

    return {
        rq: best.rq,
        rq_match_status: `RQ_AUTO_TICKET_${matchMode}`,
        rq_match_score: best.maxScore,
        rq_match_term: best.matchTerm,
    };
}


function parseFechaRecepcion(value) {
    if (!value) return null;

    if (value instanceof Date && !isNaN(value)) {
        return value.getTime();
    }

    const text = String(value).trim();

    // Formato: 23062026 00:00  => DDMMYYYY HH:mm
    const compactMatch = text.match(/^(\d{2})(\d{2})(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);

    if (compactMatch) {
        const [, dd, mm, yyyy, hh = "0", min = "0"] = compactMatch;

        return new Date(
            Number(yyyy),
            Number(mm) - 1,
            Number(dd),
            Number(hh),
            Number(min)
        ).getTime();
    }

    // Formato: 23/06/2026 00:00 o 23-06-2026 00:00
    const slashMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);

    if (slashMatch) {
        const [, dd, mm, yyyy, hh = "0", min = "0"] = slashMatch;

        return new Date(
            Number(yyyy),
            Number(mm) - 1,
            Number(dd),
            Number(hh),
            Number(min)
        ).getTime();
    }

    const parsed = new Date(text).getTime();

    return isNaN(parsed) ? null : parsed;
}

function getImportesAcByChosenLine(rows, chosen) {
    const chosenOc = getOcValue(chosen);
    const chosenLinea = getLineaValue(chosen);

    if (!chosenOc || !chosenLinea) {

        const importeAc = toAmount(chosen.importe_ac);
        if (importeAc === 0) return [];

        return [
            {
                oc: getOcValue(chosen),
                linea_oc: getLineaValue(chosen),
                estado_oc: getEstadoOcValue(chosen),
                cr: chosen.codigo_recepcion ?? chosen.cr ?? null,
                importe_ac: toAmount(chosen.importe_ac),
                fecha_recepcion: getFechaRecepcionValue(chosen),
                fecha_rq: getFechaRq(chosen),
                fecha_oc: getFechaOc(chosen),
                row: chosen,
            }
        ];
    }

    return rows
        .map((row, index) => {
            return {
                row,
                index,
                importe_ac: toAmount(row.importe_ac)
            }
        })
        .filter(({ row, importe_ac }) => {
            const oc = getOcValue(row);
            const linea = getLineaValue(row);

            return (
                oc === chosenOc && 
                linea === chosenLinea &&
                importe_ac !==0
            )
        })
        .sort((a, b) => {
            const fechaA = parseFechaRecepcion(getFechaRecepcionValue(a.row));
            const fechaB = parseFechaRecepcion(getFechaRecepcionValue(b.row));

            // Si no tiene fecha, lo manda al final
            if (fechaA === null && fechaB === null) return a.index - b.index;
            if (fechaA === null) return 1;
            if (fechaB === null) return -1;

            // Orden ascendente: más antiguo primero
            return fechaA - fechaB;
        })
        .map(({ row }) => ({
            oc: getOcValue(row),
            linea_oc: getLineaValue(row),
            estado_oc: getEstadoOcValue(row),
            cr: row.codigo_recepcion ?? row.cr ?? row["Código Recepción"] ?? null,
            importe_ac: toAmount(row.importe_ac),
            fecha_recepcion: getFechaRecepcionValue(row),
            fecha_rq: getFechaRq(row),
            fecha_oc: getFechaOc(row),
            row,
        }));
}

function sumImporteAcByChosenLine(rows, chosen) {
    return getImportesAcByChosenLine(rows, chosen)
        .reduce((acc, item) => acc + item.importe_ac, 0);
}

function markUsedByChosenLine(rows, chosen, used) {
    const chosenOc = String(chosen.nro_oc ?? chosen.oc ?? "").trim();
    const chosenLinea = String(getLineaValue(chosen) ?? "").trim();

    if (!chosenOc || !chosenLinea) {
        used.add(chosen._idx);
        return;
    }

    rows.forEach((row) => {
        const oc = String(row.nro_oc ?? row.oc ?? "").trim();
        const linea = String(getLineaValue(row) ?? "").trim();

        if (oc === chosenOc && linea === chosenLinea) {
            used.add(row._idx);
        }
    });
}

function attachRQLineaOC(data1, data2) {

    const used = new Set();

    // Preparamos data2 una sola vez
    const preparedData2 = data2.map((row, idx) => {
        const descripcionRQ = getDescripcionRQValue(row);
        const descripcionAdicional = getDescripcionAdicionalValue(row);

        const rq = getRQValue(row);
        const ticketFromRQ = extractTicketFromText(descripcionRQ);

        return {
            ...row,

            _idx: idx,

            __rq: rq,
            __rq_key: getRQKey(rq),
            __ticket_jira: ticketFromRQ,

            __desc_rq_norm: normalize(descripcionRQ),
            __desc_adicional_norm: normalize(descripcionAdicional),
            __rq_match_text_norm: normalize(`${descripcionRQ} ${descripcionAdicional}`),
        };
    });

    // 2) Resolver RQ automatico sin iterar
    const rowsByTicket = preparedData2.reduce((acc, row) => {
        if (!row.__ticket_jira) return acc;

        if (!acc.has(row.__ticket_jira)) {
            acc.set(row.__ticket_jira, []);
        }

        acc.get(row.__ticket_jira).push(row);

        return acc;
    }, new Map());

    // 3) Kógica OC y Linea
    const rowsByRQ = preparedData2.reduce((acc, row) => {
        if (!row.__rq_key) return acc;

        if (!acc.has(row.__rq_key)) {
            acc.set(row.__rq_key, []);
        }

        acc.get(row.__rq_key).push(row);

        return acc;
    }, new Map());

    return data1.map((row) => {

        let chosen = null;

        // 4) Resolver RQ
        //    - Si row.rq existe, lo conserva
        //    - Si row.rq viene vacío, intenta resolverlo con ticket_jira + identificador/sitio
        const rqResolved = resolveRQForRow(row, rowsByTicket);

        const finalRQ = rqResolved.rq;
        const finalRQKey = getRQKey(finalRQ);

        const rowWithRQ = {
            ...row,
            rq: finalRQ || row.rq || "",
            rq_match_status: rqResolved.rq_match_status,
            rq_match_score: rqResolved.rq_match_score,
            rq_match_term: rqResolved.rq_match_term,
        };

        const d2Rows = rowsByRQ.get(finalRQKey) || [];
        const idNorm = normalize(rowWithRQ.identificador);
        // const splitSite = row.sitio.split("_")
        // const extractSite = splitSite.length > 1 ? splitSite.slice(1,).join("_") : splitSite
        // const siteNorm = normalize(extractSite);
        const siteTerms = getSiteSearchTerms(rowWithRQ.sitio);

        let candidates = [];
        let matchType = null;

        // 1) Buscar por IDENTIFICADOR
        // if (idNorm) {
        //     candidates = d2Rows.filter((x) => {
        //         const descNorm = normalize(x.descripcion_adicional);
        //         return descNorm.includes(idNorm);
        //     });

            

        //     if (candidates.length > 0) {
        //         matchType = "IDENTIFICADOR";
        //     }
        // }
        // 5) Buscar por IDENTIFICADOR dentro del RQ resuelto
        if (!isWeakSearchValue(idNorm)) {
            candidates = d2Rows.filter((x) => {
                return x.__desc_adicional_norm.includes(idNorm);
            });

            if (candidates.length > 0) {
                matchType = "IDENTIFICADOR";
            }
        }

        // 2) Si no encontró, buscar por SITIO
        // if (candidates.length === 0 && siteNorm) {
        //     candidates = d2Rows.filter((x) => {
        //         const descNorm = normalize(x.descripcion_adicional);
        //         return descNorm.includes(siteNorm);
        //     });

        //     if (candidates.length > 0) {
        //         matchType = "SITIO";
        //     }
        // }
        // 6) Si no encontró por IDENTIFICADOR, buscar por SITIO
        if (candidates.length === 0 && siteTerms.length > 0) {
            candidates = d2Rows.filter((x) => {
                return siteTerms.some((term) => {
                    return x.__desc_adicional_norm.includes(term);
                });
            });

            if (candidates.length > 0) {
                matchType = "SITIO";
            }
        }

        // 3) No reutilizar filas ya usadas de DATA 2
        candidates = candidates.filter((x) => !used.has(x._idx));

        // 4) Sin match
        if (candidates.length === 0) {
            return {
                ...rowWithRQ,
                linea_oc: rowWithRQ.linea_oc ? rowWithRQ.linea_oc : null,
                estado_oc: rowWithRQ.estado_oc ? rowWithRQ.estado_oc : null,
                oc: rowWithRQ.oc ? rowWithRQ.oc : null,
                cr: rowWithRQ.cr ? rowWithRQ.cr : null,
                importe_ac: rowWithRQ.importe_ac ? rowWithRQ.importe_ac : null,
                cr_list: rowWithRQ.cr_list ? rowWithRQ.cr_list : [],
                importe_ac_list: rowWithRQ.importe_ac_list ? rowWithRQ.importe_ac_list : [],
                fecha_rq: rowWithRQ.fecha_emision_rq ? rowWithRQ.fecha_emision_rq : null,
                fecha_oc: rowWithRQ.fecha_emision_oc ? rowWithRQ.fecha_emision_oc : null,
                fecha_recepcion: rowWithRQ.fecha_recepcion ? rowWithRQ.fecha_recepcion : null,

                // individuales
                // cr_list: [],
                // importe_ac_list: [],

                match_status: "SIN_MATCH",
                match_score: 0,
            };
        }

        // 5) Match único
        if (candidates.length === 1) {
            chosen = candidates[0];
        } else {
            // 6) Varias coincidencias -> desempatar por monto
            const totalCotizacion = toAmount(rowWithRQ.total_cotizacion);

            const rankedByAmount = candidates
                .map((candidate) => {
                    const importeOc = toAmount(candidate.importe_oc);
                    const diff = Math.abs(totalCotizacion - importeOc);

                    return {
                        candidate,
                        diff,
                        score: scoreCandidate(rowWithRQ, candidate, matchType),
                    };
                })
                .sort((a, b) => {
                    // 1. menor diferencia de monto
                    if (a.diff !== b.diff) return a.diff - b.diff;

                    // 2. si empata monto, usar score
                    if (b.score !== a.score) return b.score - a.score;

                    // 3. si sigue empatado, el primero del array original
                    return a.candidate._idx - b.candidate._idx;
                });

            chosen = rankedByAmount[0].candidate;
        }

        // Sumar importe_ac de todos los repetidos de la misma OC + línea
        // const importeAcSum = sumImporteAcByChosenLine(d2Rows, chosen);

        const importeAcDetails = getImportesAcByChosenLine(d2Rows, chosen);
        const importeAcSum = importeAcDetails.reduce(
            (acc, item) => acc + item.importe_ac,
            0
        );

        const crList = importeAcDetails
            .map((item) => item.cr)
            .filter(Boolean);

        const importeAcList = importeAcDetails
            .map((item) => item.importe_ac);


        // Marcar usados todos los repetidos de esa misma línea
        markUsedByChosenLine(d2Rows, chosen, used);

        return {
            ...rowWithRQ,
            linea_oc: getLineaValue(chosen),
            oc: chosen.nro_oc ?? chosen.oc ?? null,
            estado_oc: chosen.estado_oc ?? null,
            cr: chosen.codigo_recepcion ?? null,
            importe_ac: importeAcSum,

            // individuales
            cr_list: crList,
            importe_ac_list: importeAcList,
            fecha_recepcion_list: importeAcDetails.map((item) => item.fecha_recepcion),
            fecha_rq: chosen.fecha_emision_rq ?? null,
            fecha_oc: chosen.fecha_emision_oc ?? null,
            fecha_recepcion: chosen.fecha_recepcion ?? null,

            match_status: candidates.length === 1
                ? `OK_${matchType}`
                : `OK_${matchType}_MONTO`,
            match_score: scoreCandidate(rowWithRQ, chosen, matchType),
        };

    });
}

module.exports = {
    attachRQLineaOC
}