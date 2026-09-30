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

function getLineaValue(row) {
    return row.linea_oc ?? row.nro_linea ?? null;
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

const normalizeValue = (value) => {
    return String(value ?? "").trim();
};

const getOcValue = (row) => {
    return normalizeValue(row.nro_oc ?? row.oc);
};

const getEstadoOcValue = (row) => {
    return normalizeValue(row.estado_oc);
};

// const getLineaValue = (row) => {
//     return normalizeValue(row.linea_oc ?? row.nro_linea);
// };

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

function attachLineaOC(data1, data2) {

    const used = new Set();

    const groupsByRQ = data2.reduce((acc, row, idx) => {
        const rq = String(row.rq ?? "").trim();

        if (!rq) return acc;

        if (!acc[rq]) acc[rq] = [];

        acc[rq].push({
            ...row,
            _idx: idx
        });

        return acc;
    }, {});


    return data1.map((row) => {

        const d2Rows = groupsByRQ[row.rq] || [];
        const idNorm = normalize(row.identificador);
        const splitSite = row.sitio.split("_")
        const extractSite = splitSite.length > 1 ? splitSite.slice(1,).join("_") : splitSite
        const siteNorm = normalize(extractSite);

        let candidates = [];
        let matchType = null;

        // if(row.rq == "RQ365917" && row.identificador == "TX_CRA2026_541") {
        //     // console.log("PRUEBA")
        //     console.log("idNorm", idNorm)
        //     console.log("d2Rows", siteNorm)
        // }

        // 1) Buscar por IDENTIFICADOR
        if (idNorm) {
            candidates = d2Rows.filter((x) => {
                const descNorm = normalize(x.descripcion_adicional);
                return descNorm.includes(idNorm);
            });

            if (candidates.length > 0) {
                matchType = "IDENTIFICADOR";
            }
        }

        // 2) Si no encontró, buscar por SITIO
        if (candidates.length === 0 && siteNorm) {
            candidates = d2Rows.filter((x) => {
                const descNorm = normalize(x.descripcion_adicional);
                return descNorm.includes(siteNorm);
            });

            if (candidates.length > 0) {
                matchType = "SITIO";
            }
        }

        // if(row.rq == "RQ365917" && row.identificador == "TX_CRA2026_541") {
        //     console.log("LENGTH", candidates.length)
        // }

        // if(row.rq == "RQ365917" && row.identificador == "TX_CRA2026_541") {
        //     console.log("USED", used)
        // }

        // 3) No reutilizar filas ya usadas de DATA 2
        // candidates = candidates.filter((x) => !used.has(x._idx));

        // if(row.rq == "RQ365917" && row.identificador == "TX_CRA2026_541") {
        //     console.log("LENGTH AFTER", candidates.length)
        // }

        // if(row.rq == "RQ365917" && row.identificador == "TX_CRA2026_541") {
        //     console.log("candidates 222", candidates)
        // }

        // 4) Sin match
        if (candidates.length === 0) {
            return {
                ...row,
                linea_oc: row.linea_oc ? row.linea_oc : null,
                oc: row.oc ? row.oc : null,
                estado_oc: row.estado_oc ? row.estado_oc : null,
                cr: row.cr ? row.cr : null,
                importe_ac: row.importe_ac ? row.importe_ac : null,
                cr_list: row.cr_list ? row.cr_list : [],
                importe_ac_list: row.importe_ac_list ? row.importe_ac_list : [],
                fecha_rq: null,
                fecha_oc: null,
                fecha_recepcion: null,

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
            const totalCotizacion = toAmount(row.total_cotizacion);

            const rankedByAmount = candidates
                .map((candidate) => {
                    const importeOc = toAmount(candidate.importe_oc);
                    const diff = Math.abs(totalCotizacion - importeOc);

                    return {
                        candidate,
                        diff,
                        score: scoreCandidate(row, candidate, matchType),
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
            (acc, item) => acc + item.importe_ac, 0
        );

        const crList = importeAcDetails
            .map((item) => item.cr)
            .filter(Boolean);

        const importeAcList = importeAcDetails
            .map((item) => item.importe_ac);


        // Marcar usados todos los repetidos de esa misma línea
        markUsedByChosenLine(d2Rows, chosen, used);

        return {
            ...row,
            linea_oc: getLineaValue(chosen),
            oc: chosen.nro_oc ?? chosen.oc ?? null,
            estado_oc: chosen.estado_oc ?? null,
            cr: chosen.codigo_recepcion ?? null,
            importe_ac: importeAcSum,

            // individuales
            cr_list: crList,
            importe_ac_list: importeAcList,
            fecha_rq: chosen.fecha_emision_rq ?? null,
            fecha_oc: chosen.fecha_emision_oc ?? null,
            fecha_recepcion: chosen.fecha_recepcion ?? null,
            fecha_recepcion_list: importeAcDetails.map((item) => item.fecha_recepcion),

            match_status: candidates.length === 1
                ? `OK_${matchType}`
                : `OK_${matchType}_MONTO`,
            match_score: scoreCandidate(row, chosen, matchType),
        };

    });
}

module.exports = {
    attachLineaOC
}