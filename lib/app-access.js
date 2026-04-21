const MODULE_ROUTES = {
    start: "/console",
    admin: "/admin",
    zapotrzebowanie: "/zapotrzebowanie",
    "production-dashboard": "/production-dashboard",
    mes: "/mes",
    "mes-operator": "/mes/operator",
    kosztykkw: "/kosztykkw",
    rentownosc: "/rentownosc",
    piaskownica: "/piaskownica",
};

const ALL_MODULE_IDS = Object.keys(MODULE_ROUTES);

const ROLE_MODULES = {
    planner: ["zapotrzebowanie", "kosztykkw"],
    production: ["production-dashboard", "mes", "mes-operator"],
    operator: ["mes-operator"],
    analyst: ["kosztykkw", "rentownosc"],
    integration: ["piaskownica"],
};

const PAGE_REQUIREMENTS = [
    { path: "/console", modules: ["start"] },
    { path: "/start", modules: ["start"] },
    { path: "/admin", modules: ["admin"] },
    { path: "/zapotrzebowanie", modules: ["zapotrzebowanie"] },
    { path: "/production-dashboard", modules: ["production-dashboard"] },
    { path: "/mes/operator", modules: ["mes-operator"] },
    { path: "/mes", modules: ["mes"] },
    { path: "/kosztykkw", modules: ["kosztykkw"] },
    { path: "/rentownosc", modules: ["rentownosc"] },
    { path: "/piaskownica", modules: ["piaskownica"] },
];

const API_REQUIREMENTS = [
    { prefix: "/api/admin/", modules: ["admin"] },
    { prefix: "/api/zapotrzebowanie/", modules: ["zapotrzebowanie"] },
    { prefix: "/api/mes/oven/events/delete", modules: ["mes"] },
    { prefix: "/api/mes/oven/events/assign", modules: ["mes", "mes-operator"] },
    { prefix: "/api/mes/oven/batch/update", modules: ["mes"] },
    { prefix: "/api/mes/oven/batch/delete", modules: ["mes"] },
    { prefix: "/api/mes/oven/batch/history", modules: ["mes"] },
    { prefix: "/api/mes/oven/batch/pcs-per-panel", modules: ["mes", "mes-operator"] },
    { prefix: "/api/mes/oven/batch/active", modules: ["mes", "mes-operator"] },
    { prefix: "/api/mes/oven/batch/start", modules: ["mes", "mes-operator"] },
    { prefix: "/api/mes/oven/batch/end", modules: ["mes", "mes-operator"] },
    { prefix: "/api/mes/oven/summary", modules: ["mes", "mes-operator"] },
    { prefix: "/api/mes/oven/events", modules: ["mes"] },
    { prefix: "/api/mes/oven/pulse", modules: ["mes", "mes-operator"] },
    { prefix: "/api/production-dashboard", modules: ["production-dashboard"] },
    { prefix: "/api/production-overview", modules: ["production-dashboard"] },
    { prefix: "/api/kkw-costs", modules: ["kosztykkw"] },
    { prefix: "/api/kkw-list", modules: ["kosztykkw"] },
    { prefix: "/api/production-order-costs", modules: ["kosztykkw"] },
    { prefix: "/api/rentownosc/", modules: ["rentownosc"] },
    { prefix: "/api/sandbox/", modules: ["piaskownica"] },
    { prefix: "/api/products", modules: ["piaskownica"] },
    { prefix: "/api/cost-analysis", modules: ["piaskownica"] },
    { prefix: "/api/backorders", modules: ["piaskownica"] },
    { prefix: "/api/mrp-work-costs", modules: ["piaskownica"] },
    { prefix: "/api/product-locations", modules: ["piaskownica"] },
    { prefix: "/api/product-batch-states", modules: ["piaskownica"] },
];

function normalizePathname(pathname = "/") {
    let normalized = String(pathname || "/").trim() || "/";

    if (!normalized.startsWith("/")) {
        normalized = `/${normalized}`;
    }

    if (normalized.length > 1 && normalized.endsWith("/index.html")) {
        normalized = normalized.slice(0, -"index.html".length);
    }

    if (normalized.length > 1 && normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1);
    }

    return normalized || "/";
}

function buildAllowedModuleIds(user) {
    const allowed = new Set();
    if (!user) {
        return allowed;
    }

    allowed.add("start");

    const roles = Array.isArray(user.roles) ? user.roles : [];
    if (roles.includes("admin")) {
        return new Set(ALL_MODULE_IDS);
    }

    for (const role of roles) {
        for (const moduleId of ROLE_MODULES[role] || []) {
            allowed.add(moduleId);
        }
    }

    for (const moduleId of Array.isArray(user.modules) ? user.modules : []) {
        if (moduleId !== "start" && moduleId !== "admin" && ALL_MODULE_IDS.includes(moduleId)) {
            allowed.add(moduleId);
        }
    }

    return allowed;
}

function getAllowedModuleIds(user) {
    return Array.from(buildAllowedModuleIds(user));
}

function hasModuleAccess(user, modules) {
    if (!modules) {
        return true;
    }

    const allowed = buildAllowedModuleIds(user);
    const required = Array.isArray(modules) ? modules : [modules];
    return required.some((moduleId) => allowed.has(moduleId));
}

function getPageRequirement(pathname) {
    const normalized = normalizePathname(pathname);
    return PAGE_REQUIREMENTS.find((rule) => rule.path === normalized) || null;
}

function getApiRequirement(pathname) {
    const normalized = normalizePathname(pathname);
    return API_REQUIREMENTS.find((rule) => normalized.startsWith(rule.prefix)) || null;
}

function getModulePath(moduleId) {
    return MODULE_ROUTES[moduleId] || "/console";
}

function getDefaultRouteForUser(user) {
    const allowed = buildAllowedModuleIds(user);
    const orderedModules = [
        "admin",
        "zapotrzebowanie",
        "production-dashboard",
        "mes",
        "mes-operator",
        "kosztykkw",
        "rentownosc",
        "piaskownica",
    ].filter((moduleId) => allowed.has(moduleId));

    if (orderedModules.length === 1) {
        return getModulePath(orderedModules[0]);
    }

    return getModulePath("start");
}

module.exports = {
    ALL_MODULE_IDS,
    MODULE_ROUTES,
    ROLE_MODULES,
    buildAllowedModuleIds,
    getAllowedModuleIds,
    getApiRequirement,
    getDefaultRouteForUser,
    getModulePath,
    getPageRequirement,
    hasModuleAccess,
    normalizePathname,
};
