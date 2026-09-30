function escapeRegex(value = "") {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getPagination(query) {
    const currentPage = Math.max(
        parseInt(query.page, 10) || 1,
        1
    );

    const perPage = Math.min(
        Math.max(
            parseInt(query.limit, 10) || 10,
            1
        ),
        5000
    );

    const skip = (currentPage - 1) * perPage;

    return {
        currentPage,
        perPage,
        skip
    };
}

function getSort(
    sortBy,
    sortDirection,
    allowedSortFields,
    defaultField = "createdAt"
) {
    const safeSortBy = allowedSortFields.has(sortBy)
        ? sortBy
        : defaultField;

    const safeSortDirection =
        String(sortDirection).toLowerCase() === "asc"
            ? 1
            : -1;

    return {
        [safeSortBy]: safeSortDirection,
        _id: -1
    };
}

async function cleanDistinct(model, field, q = {}) {
    const values = await model.distinct(field, {
        ...q,
        [field]: {
            $nin: [null, ""]
        }
    });

    return values
        .filter(v => v !== null && v !== undefined && v !== "")
        .map(v => typeof v === "string" ? v.trim() : v)
        .filter(v => v !== "")
        .sort((a, b) =>
            String(a).localeCompare(String(b))
        );
}

function generateKey(prefix = "KEY") {
    return `${prefix}_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 7)
        .toUpperCase()}`;
}

function normalizeBusinessKey(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, " ");
}

function buildSiteProjectKey(site, macroProject) {
    return [
        normalizeBusinessKey(site),
        normalizeBusinessKey(macroProject)
    ].join("::");
}


function mapSiteMetadata(site = {}) {
    return {
        identificador: site.identificador || "",
        site_project_key: site.site_project_key || "",
        project_typology: site.project_typology || "",
        project_type: site.project_type || "",
        macro_project: site.macro_project || "",
        sub_project: site.sub_project || "",
        id_solpe: site.id_solpe || "",
        solpe_project: site.solpe_project || "",
        node_site: site.node_site || "",
        site: site.site || "",
        tower: site.tower || "",
        tower_type: site.tower_type || "",
        plan_backup: site.plan_backup || "",
        q_fcst: site.q_fcst || "",
        macrozone: site.macrozone || "",
        zone: site.zone || "",
        cluster: site.cluster || "",
        departament: site.departament || "",
        province: site.province || "",
        district: site.district || "",
        lat: site.lat ?? null,
        long: site.long ?? null,
        project_type_id: site.project_type_id ?? null,
        project_type_name: site.project_type_name || "",
        provider_id: site.provider_id ?? null,
        provider_name: site.provider_name || ""
    };
}

function parseColumnFilters(value) {
    if (!value) return {};

    try {
        const parsed =
            typeof value === "string"
                ? JSON.parse(value)
                : value;

        return parsed &&
            typeof parsed === "object"
            ? parsed
            : {};
    } catch {
        return {};
    }
}


module.exports = {
    escapeRegex,
    getPagination,
    getSort,
    cleanDistinct,
    generateKey,
    normalizeBusinessKey,
    buildSiteProjectKey,
    mapSiteMetadata,
    parseColumnFilters
};