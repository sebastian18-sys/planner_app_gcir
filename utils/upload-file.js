const fs = require("fs");
const path = require("path");
const multer = require("multer");

const ROOT = path.resolve(process.cwd(), "resources", "solicitudes_rq");

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // mientras no existe ticketId aún, guárdalo en tmp
        const dir = path.join(ROOT, "tmp");
        ensureDir(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || "").toLowerCase();
        const safe = (path.basename(file.originalname, ext) || "archivo")
            .replace(/[^a-zA-Z0-9-_]/g, "_")
            .slice(0, 60);
        cb(null, `${Date.now()}_${safe}${ext}`);
    },
});

const uploadTicketExcel = multer({
    storage,
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
    // fileFilter: (req, file, cb) => {
    //     const ext = path.extname(file.originalname || "").toLowerCase();
    //     if (![".xlsx", ".xls", ".xlsb"].includes(ext)) return cb(new Error("Solo .xlsx/.xls /.xlsb"));
    //     cb(null, true);
    // },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname || "").toLowerCase();

        console.log("FILE", file);

        // Input 1: archivo principal
        if (file.fieldname === "file") {
            if (![".xlsx", ".xls", ".xlsb"].includes(ext)) {
                return cb(new Error("El archivo principal solo permite .xlsx / .xls / .xlsb"));
            }
            return cb(null, true);
        }

        // Input 2: archivo h2
        if (file.fieldname === "file_h2") {
            if (![".xlsx", ".xls", ".xlsb"].includes(ext)) {
                return cb(new Error("El archivo h2 solo permite .xlsx / .xls / .xlsb"));
            }
            return cb(null, true);
        }

        // Input 3: sustentos
        if (file.fieldname === "fileSustentos") {
            if (![".xlsx", ".xls", ".xlsb", ".xlsm", ".pdf", ".zip", ".rar"].includes(ext)) {
                return cb(new Error("Los sustentos solo permiten .xlsx / .xls / .xlsb / .pdf"));
            }
            return cb(null, true);
        }

        // Input 4: evidencias
        if (file.fieldname === "fileEvidencias") {
            if (![".xlsx", ".xls", ".xlsb", ".xlsm", ".pdf", ".zip", ".rar", ".doc", ".docx", ".jpg", ".jpeg", ".png"].includes(ext)) {
                return cb(new Error("Las evidencias solo permiten"));
            }
            return cb(null, true);
        }

        // Input 5: liquidaciones
        if (file.fieldname.startsWith("sustento_")) {
            if (![".xlsx", ".xls", ".xlsb", ".xlsm", ".pdf", ".zip", ".rar", ".doc", ".docx", ".jpg", ".jpeg", ".png"].includes(ext)) {
                return cb(new Error("Los sustentos de liquidación solo permiten .xlsx / .xls / .pdf / .zip / .rar / doc / imagen"));
            }

            return cb(null, true);
        }

        return cb(new Error(`Campo de archivo no permitido: ${file.fieldname}`));
    },
});

module.exports = uploadTicketExcel