const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const {
    buildBomNoteKey,
    buildReportNoteKey,
    getAccessBomNotesForLiveHeader,
    getBomNotesForPlanPosition,
    getHeaderDetails: getZapotrzebowanieHeaderDetails,
    getOperationalOverview: getZapotrzebowanieOperationalOverview,
    getReportNotesMap,
    getStorageMeta: getZapotrzebowanieStorageMeta,
    importAccessSnapshot,
    upsertBomNote,
    upsertReportNote,
} = require("./lib/zapotrzebowanie-sqlite");
const {
    assignOvenPulsesToBatch,
    deleteOvenBatch,
    deleteOvenPulses,
    endOvenBatch,
    getActiveOvenBatch,
    getBatchUnassignedSuggestion,
    getMesStorageMeta,
    getOvenSummary,
    insertOvenPulse,
    listOvenBatches,
    listOvenPulses,
    resetOpenOvenTransits,
    startOvenBatch,
    updateOvenBatchDetails,
    resolveProductPcsPerPanel,
    upsertProductPcsPerPanel,
    upsertOvenBatchPcsPerPanel,
} = require("./lib/mes-sqlite");
const {
    ALL_MODULE_IDS,
    ROLE_MODULES,
    getAllowedModuleIds,
    getApiRequirement,
    getDefaultRouteForUser,
    getPageRequirement,
    hasModuleAccess,
    normalizePathname,
} = require("./lib/app-access");
const {
    createUser,
    findUserByLogin,
    getAuthUsersPath,
    getPublicUser,
    getUserById,
    listUsers,
    setUserPassword,
    updateUser,
    verifyPassword,
} = require("./lib/auth-store");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const START_LOCAL_PATH = path.join(__dirname, "start-local.ps1");
const POWERSHELL_PATH = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
const ZAPOTRZEBOWANIE_SOURCE_SCRIPT_PATH = path.join(__dirname, "scripts", "get-zapotrzebowanie-source.ps1");
const ZAPOTRZEBOWANIE_DETAIL_SCRIPT_PATH = path.join(__dirname, "scripts", "get-zapotrzebowanie-details.ps1");
const ZAPOTRZEBOWANIE_WMS_SCRIPT_PATH = path.join(__dirname, "scripts", "get-zapotrzebowanie-wms.ps1");
const ZAPOTRZEBOWANIE_ACCESS_EXPORT_SCRIPT_PATH = path.join(__dirname, "scripts", "export-zapotrzebowanie-access.ps1");
const LOCAL_CACHE_DIR = path.join(__dirname, ".cache");
const execFileAsync = promisify(execFile);

let cachedLocalServerConfig = null;
const productionOverviewCache = new Map();
const kkwOverviewContextCache = new Map();
const vendoOperationalHeadersCache = new Map();
const vendoOperationalHeaderSummaryCache = new Map();
const vendoDemandTotalsCache = new Map();
const vendoDemandDetailsCache = new Map();
const vendoZwDetailsCache = new Map();
const vendoZwDocumentDetailsCache = new Map();
const vendoTechnologyLookupCache = new Map();
const zapotrzebowanieSourceCache = new Map();
const zapotrzebowanieDetailCache = new Map();
const wmsInventoryCache = new Map();
const vendoInventoryCache = new Map();
const authSessionStore = new Map();
const AUTH_SESSION_COOKIE = "vendo_workspace_session";
const AUTH_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function getCacheEntry(cache, key, ttlMs) {
    const entry = cache.get(key);
    if (!entry) {
        return null;
    }

    if ((Date.now() - entry.createdAt) > ttlMs) {
        cache.delete(key);
        return null;
    }

    return entry.value;
}

function setCacheEntry(cache, key, value) {
    cache.set(key, {
        createdAt: Date.now(),
        value,
    });
    return value;
}

async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;

    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    });

    await Promise.all(workers);
    return results;
}

function parseStartLocalConfig() {
    if (cachedLocalServerConfig) {
        return cachedLocalServerConfig;
    }

    const defaults = {
        VENDO_API_URL: "",
        VENDO_API_LOGIN: "",
        VENDO_API_PASSWORD: "",
        VENDO_USER_LOGIN: "",
        VENDO_USER_PASSWORD: "",
        WMS_SQL_SERVER: "",
        WMS_SQL_DATABASE: "",
        WMS_SQL_USER: "",
        WMS_SQL_PASSWORD: "",
        ACCESS_BACKEND_PATH: "",
        SQLITE_DB_PATH: "",
        MES_SQLITE_DB_PATH: "",
        APP_ADMIN_LOGIN: "",
        APP_ADMIN_PASSWORD: "",
    };

    try {
        if (!fs.existsSync(START_LOCAL_PATH)) {
            cachedLocalServerConfig = defaults;
            return cachedLocalServerConfig;
        }

        const content = fs.readFileSync(START_LOCAL_PATH, "utf8");
        const config = { ...defaults };
        for (const key of Object.keys(config)) {
            const pattern = new RegExp(`\\$env:${key}\\s*=\\s*["']([^"']+)["']`, "i");
            const match = content.match(pattern);
            if (match) {
                config[key] = match[1].trim();
            }
        }

        cachedLocalServerConfig = config;
        return cachedLocalServerConfig;
    } catch {
        cachedLocalServerConfig = defaults;
        return cachedLocalServerConfig;
    }
}

function getServerConfig() {
    const localConfig = parseStartLocalConfig();

    return {
        apiUrl: (process.env.VENDO_API_URL || localConfig.VENDO_API_URL || "").trim(),
        apiLogin: (process.env.VENDO_API_LOGIN || localConfig.VENDO_API_LOGIN || "").trim(),
        apiPassword: process.env.VENDO_API_PASSWORD || localConfig.VENDO_API_PASSWORD || "",
        vendoUserLogin: (process.env.VENDO_USER_LOGIN || localConfig.VENDO_USER_LOGIN || "").trim(),
        vendoUserPassword: process.env.VENDO_USER_PASSWORD || localConfig.VENDO_USER_PASSWORD || "",
    };
}

function getZapotrzebowanieConfig() {
    const localConfig = parseStartLocalConfig();

    return {
        wmsSqlServer: (process.env.WMS_SQL_SERVER || localConfig.WMS_SQL_SERVER || "").trim(),
        wmsSqlDatabase: (process.env.WMS_SQL_DATABASE || localConfig.WMS_SQL_DATABASE || "").trim(),
        wmsSqlUser: (process.env.WMS_SQL_USER || localConfig.WMS_SQL_USER || "").trim(),
        wmsSqlPassword: process.env.WMS_SQL_PASSWORD || localConfig.WMS_SQL_PASSWORD || "",
        accessBackendPath: (process.env.ACCESS_BACKEND_PATH || localConfig.ACCESS_BACKEND_PATH || "").trim(),
    };
}

function getZapotrzebowanieStorageConfig() {
    const localConfig = parseStartLocalConfig();
    const rawDbPath = (
        process.env.SQLITE_DB_PATH
        || localConfig.SQLITE_DB_PATH
        || path.join(".data", "zapotrzebowanie.db")
    ).trim();

    return {
        dbPath: path.isAbsolute(rawDbPath)
            ? rawDbPath
            : path.resolve(__dirname, rawDbPath),
    };
}

function getMesStorageConfig() {
    const localConfig = parseStartLocalConfig();
    const rawDbPath = (
        process.env.MES_SQLITE_DB_PATH
        || localConfig.MES_SQLITE_DB_PATH
        || path.join(".data", "mes.db")
    ).trim();

    return {
        dbPath: path.isAbsolute(rawDbPath)
            ? rawDbPath
            : path.resolve(__dirname, rawDbPath),
    };
}

function requireZapotrzebowanieConfig() {
    const config = getZapotrzebowanieConfig();
    const missing = [];
    if (!config.wmsSqlServer) missing.push("WMS_SQL_SERVER");
    if (!config.wmsSqlDatabase) missing.push("WMS_SQL_DATABASE");
    if (!config.wmsSqlUser) missing.push("WMS_SQL_USER");
    if (!config.wmsSqlPassword) missing.push("WMS_SQL_PASSWORD");
    if (!config.accessBackendPath) missing.push("ACCESS_BACKEND_PATH");
    return missing;
}

function requireWmsSqlConfig() {
    const config = getZapotrzebowanieConfig();
    const missing = [];
    if (!config.wmsSqlServer) missing.push("WMS_SQL_SERVER");
    if (!config.wmsSqlDatabase) missing.push("WMS_SQL_DATABASE");
    if (!config.wmsSqlUser) missing.push("WMS_SQL_USER");
    if (!config.wmsSqlPassword) missing.push("WMS_SQL_PASSWORD");
    return missing;
}

function requireServerConfig() {
    const config = getServerConfig();
    const missing = [];
    if (!config.apiUrl) missing.push("VENDO_API_URL");
    if (!config.apiLogin) missing.push("VENDO_API_LOGIN");
    if (!config.apiPassword) missing.push("VENDO_API_PASSWORD");
    return missing;
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, payload) {
    res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(payload);
}

function getAuthConfig() {
    const localConfig = parseStartLocalConfig();

    return {
        adminLogin: (process.env.APP_ADMIN_LOGIN || localConfig.APP_ADMIN_LOGIN || "admin").trim() || "admin",
        adminPassword: process.env.APP_ADMIN_PASSWORD || localConfig.APP_ADMIN_PASSWORD || "admin",
    };
}

function parseCookies(req) {
    const cookieHeader = String(req?.headers?.cookie || "");
    const cookies = {};

    for (const part of cookieHeader.split(";")) {
        const [rawName, ...rawValueParts] = part.split("=");
        const name = String(rawName || "").trim();
        if (!name) {
            continue;
        }

        cookies[name] = decodeURIComponent(rawValueParts.join("=").trim());
    }

    return cookies;
}

function pruneExpiredAuthSessions() {
    const now = Date.now();

    for (const [sessionId, session] of authSessionStore.entries()) {
        if (!session || Number(session.expiresAt) <= now) {
            authSessionStore.delete(sessionId);
        }
    }
}

function setCookie(res, value) {
    res.setHeader("Set-Cookie", value);
}

function setAuthSessionCookie(res, sessionId, expiresAt) {
    const maxAgeSeconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
    setCookie(
        res,
        `${AUTH_SESSION_COOKIE}=${sessionId}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`
    );
}

function clearAuthSessionCookie(res) {
    setCookie(
        res,
        `${AUTH_SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
    );
}

function createAuthSession(user) {
    pruneExpiredAuthSessions();
    const sessionId = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + AUTH_SESSION_TTL_MS;

    authSessionStore.set(sessionId, {
        id: sessionId,
        userId: user.id,
        expiresAt,
    });

    return {
        id: sessionId,
        expiresAt,
    };
}

function resolveAuthContext(req) {
    pruneExpiredAuthSessions();

    const sessionId = parseCookies(req)[AUTH_SESSION_COOKIE];
    if (!sessionId) {
        return {
            session: null,
            user: null,
            publicUser: null,
            allowedModuleIds: [],
        };
    }

    const session = authSessionStore.get(sessionId);
    if (!session || Number(session.expiresAt) <= Date.now()) {
        authSessionStore.delete(sessionId);
        return {
            session: null,
            user: null,
            publicUser: null,
            allowedModuleIds: [],
        };
    }

    const user = getUserById(session.userId, getAuthConfig());
    if (!user || user.isActive === false) {
        authSessionStore.delete(sessionId);
        return {
            session: null,
            user: null,
            publicUser: null,
            allowedModuleIds: [],
        };
    }

    session.expiresAt = Date.now() + AUTH_SESSION_TTL_MS;
    authSessionStore.set(sessionId, session);

    return {
        session,
        user,
        publicUser: getPublicUser(user),
        allowedModuleIds: getAllowedModuleIds(user),
    };
}

function getLoginRedirectPath(req) {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const nextValue = `${requestUrl.pathname}${requestUrl.search}`;
    return `/login?next=${encodeURIComponent(nextValue)}`;
}

function buildSafeNextPath(rawNextPath, user) {
    const defaultPath = getDefaultRouteForUser(user);
    const nextPath = String(rawNextPath || "").trim();

    if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
        return defaultPath;
    }

    try {
        const nextUrl = new URL(nextPath, "http://localhost");
        const nextRequirement = getPageRequirement(nextUrl.pathname);

        if (normalizePathname(nextUrl.pathname) === "/login") {
            return defaultPath;
        }

        if (nextRequirement && !hasModuleAccess(user, nextRequirement.modules)) {
            return defaultPath;
        }

        return `${nextUrl.pathname}${nextUrl.search}`;
    } catch {
        return defaultPath;
    }
}

async function handleApiAuthLogin(req, res) {
    try {
        const body = await readJsonBody(req);
        const login = String(body.login || "").trim();
        const password = String(body.password || "");

        if (!login || !password) {
            return sendJson(res, 400, { error: "Podaj login i haslo." });
        }

        const user = findUserByLogin(login, getAuthConfig());
        if (!user || user.isActive === false || !verifyPassword(user, password)) {
            clearAuthSessionCookie(res);
            return sendJson(res, 401, { error: "Nieprawidlowy login lub haslo." });
        }

        const session = createAuthSession(user);
        setAuthSessionCookie(res, session.id, session.expiresAt);

        sendJson(res, 200, {
            user: getPublicUser(user),
            allowedModuleIds: getAllowedModuleIds(user),
            redirectTo: buildSafeNextPath(body.next, user),
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie zalogowac.",
        });
    }
}

function handleApiAuthMe(_req, res, authContext) {
    if (!authContext.user) {
        return sendJson(res, 401, { error: "Sesja wygasla. Zaloguj sie ponownie." });
    }

    if (authContext.session?.id) {
        setAuthSessionCookie(res, authContext.session.id, authContext.session.expiresAt);
    }

    sendJson(res, 200, {
        user: authContext.publicUser,
        allowedModuleIds: authContext.allowedModuleIds,
        defaultPath: getDefaultRouteForUser(authContext.user),
    });
}

function handleApiAuthLogout(_req, res, authContext) {
    if (authContext.session?.id) {
        authSessionStore.delete(authContext.session.id);
    }

    clearAuthSessionCookie(res);
    sendJson(res, 200, { ok: true });
}

function isPublicApiRequest(req, pathname) {
    return req.method === "POST" && pathname === "/api/mes/oven/pulse";
}

function isAdminUser(user) {
    return Boolean(user && Array.isArray(user.roles) && user.roles.includes("admin"));
}

function getAdminMeta() {
    const assignableModules = ALL_MODULE_IDS.filter((moduleId) => moduleId !== "start" && moduleId !== "admin");
    return {
        authUsersPath: getAuthUsersPath(),
        roles: ["admin", ...Object.keys(ROLE_MODULES)],
        roleModules: ROLE_MODULES,
        modules: ALL_MODULE_IDS,
        assignableModules,
    };
}

function sanitizeAdminRoles(value) {
    const allowedRoles = new Set(getAdminMeta().roles);
    return Array.isArray(value)
        ? Array.from(new Set(value.map((role) => String(role || "").trim()).filter((role) => allowedRoles.has(role))))
        : [];
}

function sanitizeAdminModules(value) {
    const allowedModules = new Set(getAdminMeta().assignableModules);
    return Array.isArray(value)
        ? Array.from(new Set(value.map((moduleId) => String(moduleId || "").trim()).filter((moduleId) => allowedModules.has(moduleId))))
        : [];
}

function buildAdminUsersPayload() {
    return {
        users: listUsers(getAuthConfig()).map((user) => getPublicUser(user)),
        meta: getAdminMeta(),
    };
}

function handleApiAdminUsers(_req, res) {
    sendJson(res, 200, buildAdminUsersPayload());
}

async function handleApiAdminUsersCreate(req, res) {
    try {
        const body = await readJsonBody(req);
        const user = createUser({
            login: body.login,
            displayName: body.displayName,
            password: body.password,
            roles: sanitizeAdminRoles(body.roles),
            modules: sanitizeAdminModules(body.modules),
            isActive: body.isActive !== false,
        }, getAuthConfig());

        sendJson(res, 201, {
            user: getPublicUser(user),
            ...buildAdminUsersPayload(),
        });
    } catch (error) {
        sendJson(res, 400, {
            error: error.message || "Nie udalo sie utworzyc uzytkownika.",
        });
    }
}

async function handleApiAdminUserUpdate(req, res, userId) {
    try {
        const body = await readJsonBody(req);
        const user = updateUser(userId, {
            login: body.login,
            displayName: body.displayName,
            roles: sanitizeAdminRoles(body.roles),
            modules: sanitizeAdminModules(body.modules),
            isActive: body.isActive !== false,
        }, getAuthConfig());

        sendJson(res, 200, {
            user: getPublicUser(user),
            ...buildAdminUsersPayload(),
        });
    } catch (error) {
        sendJson(res, 400, {
            error: error.message || "Nie udalo sie zaktualizowac uzytkownika.",
        });
    }
}

async function handleApiAdminUserResetPassword(req, res, userId) {
    try {
        const body = await readJsonBody(req);
        const user = setUserPassword(userId, body.password, getAuthConfig());

        sendJson(res, 200, {
            user: getPublicUser(user),
            message: `Haslo dla ${user.login} zostalo zmienione.`,
        });
    } catch (error) {
        sendJson(res, 400, {
            error: error.message || "Nie udalo sie zmienic hasla.",
        });
    }
}

function resolveVendoUserCredentials(body = {}) {
    const serverConfig = getServerConfig();
    const bodyLogin = String(body?.vendoUserLogin || "").trim();
    const bodyPassword = String(body?.vendoUserPassword || "");

    return {
        vendoUserLogin: bodyLogin || serverConfig.vendoUserLogin,
        vendoUserPassword: bodyPassword || serverConfig.vendoUserPassword,
    };
}

function redactSensitiveText(value) {
    return String(value || "")
        .replace(/(-SqlPassword\s+)(?:"[^"]*"|'[^']*'|\S+)/gi, "$1********")
        .replace(/(Password\s*=\s*)[^;]+/gi, "$1********")
        .replace(/(Haslo\s*:\s*)(?:"[^"]*"|'[^']*'|\S+)/gi, "$1********");
}

async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }

    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw) {
        return {};
    }

    return JSON.parse(raw);
}

async function runPowerShellJsonScript(scriptPath, parameters, { timeoutMs = 5 * 60 * 1000, maxBuffer = 12 * 1024 * 1024 } = {}) {
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath];
    for (const [key, value] of Object.entries(parameters || {})) {
        args.push(`-${key}`);
        args.push(String(value ?? ""));
    }

    let stdout = "";
    try {
        const result = await execFileAsync(POWERSHELL_PATH, args, {
            timeout: timeoutMs,
            maxBuffer,
            windowsHide: true,
        });
        stdout = result.stdout;
    } catch (error) {
        const stderr = String(error?.stderr || "").trim();
        const stdoutText = String(error?.stdout || "").trim();
        const fallback = String(error?.message || "Nieznany blad PowerShell.").trim();
        const details = stderr || stdoutText || fallback;
        throw new Error(`Skrypt ${path.basename(scriptPath)} zakonczyl sie bledem: ${redactSensitiveText(details)}`);
    }

    const trimmed = String(stdout || "").trim();
    if (!trimmed) {
        throw new Error(`Skrypt ${path.basename(scriptPath)} nie zwrocil danych.`);
    }

    try {
        return JSON.parse(trimmed);
    } catch (error) {
        throw new Error(`Nie udalo sie odczytac JSON ze skryptu ${path.basename(scriptPath)}: ${error.message}`);
    }
}

async function ensureLocalMirrorFile(remotePath) {
    const normalizedRemotePath = String(remotePath || "").trim();
    if (!normalizedRemotePath) {
        return normalizedRemotePath;
    }

    const isUncPath = normalizedRemotePath.startsWith("\\\\");
    if (!isUncPath) {
        return normalizedRemotePath;
    }

    await fs.promises.mkdir(LOCAL_CACHE_DIR, { recursive: true });
    const fileName = path.basename(normalizedRemotePath);
    const localPath = path.join(LOCAL_CACHE_DIR, fileName);
    let localStats = null;

    try {
        localStats = await fs.promises.stat(localPath);
    } catch {
        localStats = null;
    }

    let remoteStats = null;
    try {
        remoteStats = await fs.promises.stat(normalizedRemotePath);
    } catch (error) {
        if (localStats) {
            return localPath;
        }
        throw error;
    }

    const shouldRefresh = !localStats || Math.abs(localStats.mtimeMs - remoteStats.mtimeMs) > 1000;
    if (shouldRefresh) {
        try {
            await fs.promises.copyFile(normalizedRemotePath, localPath);
            await fs.promises.utimes(localPath, remoteStats.atime, remoteStats.mtime);
        } catch (error) {
            if (!localStats) {
                throw error;
            }
        }
    }

    return localPath;
}

async function vendoPost(baseUrl, apiPath, payload) {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${apiPath}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    const text = await response.text();
    let data = null;

    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = { raw: text };
    }

    if (!response.ok) {
        const message = data?.Komunikat || data?.Message || text || `HTTP ${response.status}`;
        throw new Error(message);
    }

    return data;
}

async function getAccessToken(connection) {
    const apiAuth = await vendoPost(connection.baseUrl, "/Autoryzacja/Zaloguj", {
        Model: {
            Login: connection.apiLogin,
            Haslo: connection.apiPassword,
        },
    });

    const apiToken = apiAuth?.Wynik?.Token;
    if (!apiToken) {
        throw new Error("Nie udalo sie uzyskac tokenu API.");
    }

    const userAuth = await vendoPost(connection.baseUrl, "/Autoryzacja/ZalogujUzytkownikaVendo", {
        Token: apiToken,
        Model: {
            Login: connection.vendoUserLogin,
            Haslo: connection.vendoUserPassword,
        },
    });

    const accessToken = userAuth?.Wynik?.Token;
    if (!accessToken) {
        throw new Error("Nie udalo sie uzyskac tokenu dostepowego uzytkownika Vendo.");
    }

    return accessToken;
}

async function fetchCursorTailRecords(connection, accessToken, apiPath, model, { pageSize = 200, tailPages = 2 } = {}) {
    const baseModel = {
        ...model,
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: pageSize,
        },
    };
    const firstResponse = await vendoPost(connection.baseUrl, apiPath, {
        Token: accessToken,
        Model: baseModel,
    });
    const firstRecords = Array.isArray(firstResponse?.Wynik?.Rekordy) ? firstResponse.Wynik.Rekordy : [];
    const totalCount = Number(firstResponse?.Wynik?.Cursor?.LiczbaWszystkichRekordow) || firstRecords.length;
    const cursorName = String(firstResponse?.Wynik?.Cursor?.Nazwa || "").trim();

    if (!cursorName || totalCount <= pageSize) {
        return firstRecords;
    }

    const firstOffset = Math.max(totalCount - (pageSize * Math.max(tailPages, 1)), 0);
    const offsets = [];
    for (let offset = firstOffset; offset < totalCount; offset += pageSize) {
        offsets.push(offset);
    }

    const tailOffsets = offsets.filter((offset) => offset !== 0);
    const recordMap = new Map();
    const appendRecords = (records) => {
        for (const record of records || []) {
            const key = record?.ID != null
                ? `${record.ID}`
                : JSON.stringify([
                    record?.KKWID,
                    record?.OperacjaID,
                    record?.StanowiskoID,
                    record?.DataRozpoczecia,
                ]);
            if (!recordMap.has(key)) {
                recordMap.set(key, record);
            }
        }
    };

    if (offsets.includes(0)) {
        appendRecords(firstRecords);
    }
    for (let index = 0; index < tailOffsets.length; index += 1) {
        const response = await vendoPost(connection.baseUrl, apiPath, {
            Token: accessToken,
            Model: {
                ...baseModel,
                CursorNazwa: cursorName,
                CursorCzyZamknac: index === tailOffsets.length - 1,
                Strona: {
                    Indeks: tailOffsets[index],
                    LiczbaRekordow: pageSize,
                },
            },
        });
        appendRecords(Array.isArray(response?.Wynik?.Rekordy) ? response.Wynik.Rekordy : []);
    }

    return [...recordMap.values()];
}

async function fetchAllCursorRecords(connection, accessToken, apiPath, model, { pageSize = 100, maxPages = 50 } = {}) {
    const baseModel = {
        ...model,
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: pageSize,
        },
    };

    const firstResponse = await vendoPost(connection.baseUrl, apiPath, {
        Token: accessToken,
        Model: baseModel,
    });

    const records = Array.isArray(firstResponse?.Wynik?.Rekordy) ? [...firstResponse.Wynik.Rekordy] : [];
    const totalCount = Number(firstResponse?.Wynik?.Cursor?.LiczbaWszystkichRekordow) || records.length;
    const cursorName = String(firstResponse?.Wynik?.Cursor?.Nazwa || "").trim();
    if (!cursorName || totalCount <= pageSize) {
        return records;
    }

    const offsets = [];
    for (let offset = pageSize; offset < totalCount && offsets.length < Math.max(0, maxPages - 1); offset += pageSize) {
        offsets.push(offset);
    }

    for (let index = 0; index < offsets.length; index += 1) {
        const response = await vendoPost(connection.baseUrl, apiPath, {
            Token: accessToken,
            Model: {
                ...baseModel,
                CursorNazwa: cursorName,
                CursorCzyZamknac: index === offsets.length - 1,
                Strona: {
                    Indeks: offsets[index],
                    LiczbaRekordow: pageSize,
                },
            },
        });

        const pageRecords = Array.isArray(response?.Wynik?.Rekordy) ? response.Wynik.Rekordy : [];
        records.push(...pageRecords);
    }

    return records;
}

function normalizeZapotrzebowanieRodzaj(value) {
    const normalized = String(value || "")
        .trim()
        .toUpperCase();

    if (!normalized || normalized === "PCB") {
        return "PCB";
    }

    if (normalized === "ALL" || normalized === "WSZYSTKIE") {
        return "ALL";
    }

    if (normalized.includes("FABRYKAT")) {
        return "POLFABRYKAT";
    }

    if (normalized === "POLFABRYKAT" || normalized === "PÓŁFABRYKAT") {
        return "POLFABRYKAT";
    }

    return normalized;
}

function normalizeKkwNumber(value) {
    return String(value || "")
        .trim()
        .toUpperCase();
}

function normalizeUserFieldName(value) {
    return normalizeText(value);
}

function pickUserFieldValue(record, fieldNames) {
    const items = Array.isArray(record?.PolaUzytkownika) ? record.PolaUzytkownika : [];
    if (!items.length) {
        return null;
    }

    const expectedNames = new Set((fieldNames || []).map(normalizeUserFieldName).filter(Boolean));
    for (const item of items) {
        const fieldName = normalizeUserFieldName(
            item?.NazwaWewnetrzna
            || item?.Nazwa
            || item?.NazwaZewnetrzna
            || item?.Kod
            || item?.ParametrNazwa
        );
        if (!fieldName || !expectedNames.has(fieldName)) {
            continue;
        }

        const value = String(item?.Wartosc || "").trim();
        if (value) {
            return value;
        }
    }

    return null;
}

function pickUserFieldValueById(record, fieldIds) {
    const items = Array.isArray(record?.PolaUzytkownika) ? record.PolaUzytkownika : [];
    if (!items.length) {
        return null;
    }

    const expectedIds = new Set(
        (fieldIds || [])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
    );
    if (!expectedIds.size) {
        return null;
    }

    for (const item of items) {
        const fieldId = Number(item?.ID);
        if (!expectedIds.has(fieldId)) {
            continue;
        }

        const value = String(item?.Wartosc || "").trim();
        if (value) {
            return value;
        }
    }

    return null;
}

function normalizeMaterialOwnershipValue(value) {
    const rawValue = String(value || "").trim();
    const normalized = normalizeText(rawValue);
    if (!normalized) return "";
    if (normalized === "37" || normalized === "1") return "POWIERZONE";
    if (normalized === "38" || normalized === "2") return "MSX";
    if (normalized.includes("powier")) return "POWIERZONE";
    if (normalized.includes("msx")) return "MSX";
    return rawValue.toUpperCase();
}

function getMaterialOwnershipFromRecord(record) {
    const directValue = [
        record?.tel_value156,
        record?.TEL_VALUE156,
        record?.Materialy,
        record?.["Materiały"],
    ].find((value) => String(value || "").trim());

    const userFieldValue = pickUserFieldValue(record, ["materialy", "materiały", "tel_value156"]);
    const userFieldValueById = pickUserFieldValueById(record, [384228]);
    return normalizeMaterialOwnershipValue(directValue || userFieldValue || userFieldValueById);
}

function resolveMaterialOwnershipFromRecord(record) {
    const directValue = [
        record?.pz_value156,
        record?.PZ_VALUE156,
        record?.tel_value156,
        record?.TEL_VALUE156,
        record?.Materialy,
        record?.["Materiały"],
    ].find((value) => String(value || "").trim());

    const userFieldValue = pickUserFieldValue(record, ["materialy", "materiały", "pz_value156", "tel_value156"]);
    const userFieldValueById = pickUserFieldValueById(record, [384228]);
    return normalizeMaterialOwnershipValue(directValue || userFieldValue || userFieldValueById);
}

function normalizeMaterialOwnershipFilter(value) {
    const normalized = normalizeText(value);
    if (normalized === "all" || normalized === "wszystkie") return "ALL";
    if (normalized === "powierzone") return "POWIERZONE";
    if (normalized === "msx") return "MSX";
    if (normalized === "empty" || normalized === "puste") return "EMPTY";
    return "MSX_OR_EMPTY";
}

function matchesMaterialOwnershipFilter(value, filter) {
    const normalizedValue = normalizeMaterialOwnershipValue(value);
    const normalizedFilter = normalizeMaterialOwnershipFilter(filter);

    if (normalizedFilter === "ALL") return true;
    if (normalizedFilter === "POWIERZONE") return normalizedValue === "POWIERZONE";
    if (normalizedFilter === "MSX") return normalizedValue === "MSX";
    if (normalizedFilter === "EMPTY") return !normalizedValue;
    return normalizedValue === "MSX" || !normalizedValue;
}

function isBlockedOperationalClient(value) {
    return normalizeText(value).includes("medcom");
}

function isAllowedOperationalSeries(value) {
    return normalizeText(value) === "msx";
}

function buildVendoInventoryCacheKey(connection, code, {
    includeExpected = true,
    includeZw = false,
} = {}) {
    const mode = includeExpected
        ? (includeZw ? "full+zw" : "full")
        : (includeZw ? "stock+zw" : "stock");
    return [
        connection.baseUrl,
        connection.vendoUserLogin,
        mode,
        String(code || "").trim(),
    ].join("::");
}

function isZwDocumentNumber(value) {
    const normalized = String(value || "").trim().toUpperCase();
    return normalized.endsWith("/ZW")
        || normalized.endsWith("ZW")
        || normalized.includes("/ZW/")
        || normalized.includes(" ZW");
}

function isZwDocumentRecord(record) {
    const kind = String(record?.RodzajKod || "").trim().toUpperCase();
    return kind === "ZW" || isZwDocumentNumber(record?.NumerPelny);
}

function isZwBackorderRecord(record, document = null) {
    if (!record) return false;
    return isZwDocumentRecord(document)
        || isZwDocumentNumber(record?.NumerDokumentu);
}

async function fetchVendoInventoryForCode(connection, accessToken, code, {
    includeExpected = true,
    includeZw = false,
} = {}) {
    const normalizedCode = String(code || "").trim();
    if (!normalizedCode) {
        return {
            code: "",
            productName: "",
            vendoStock: 0,
            vendoExpected: 0,
            zwQty: 0,
        };
    }

    const cacheKey = buildVendoInventoryCacheKey(connection, normalizedCode, {
        includeExpected,
        includeZw,
    });
    const cached = getCacheEntry(vendoInventoryCache, cacheKey, 20 * 60 * 1000);
    if (cached) {
        return cached;
    }

    const productResponse = await vendoPost(connection.baseUrl, "/Magazyn/Towary/Lista", {
        Token: accessToken,
        Model: buildProductsModel({ productCode: normalizedCode, pageSize: 20 }),
    });
    const productRecords = Array.isArray(productResponse?.Wynik?.Rekordy) ? productResponse.Wynik.Rekordy : [];
    const productRecord = productRecords.find((item) => String(item?.Kod || "").trim() === normalizedCode) || productRecords[0] || null;
    const productName = String(productRecord?.Nazwa || "").trim();
    const vendoStock = Number(productRecord?.LacznyStan) || 0;
    let vendoExpected = 0;
    let zwQty = 0;

    if (includeExpected || includeZw) {
        const expectedRecords = await fetchAllCursorRecords(
            connection,
            accessToken,
            "/Magazyn/Backordery/Lista",
            buildBackordersModel({
                productCode: normalizedCode,
                direction: "1",
                pageSize: 100,
            }),
            {
                pageSize: 100,
                maxPages: 20,
            }
        );
        if (includeExpected) {
            vendoExpected = expectedRecords.reduce((sum, item) => sum + (Number(item?.Ilosc) || 0), 0);
        }
        if (includeZw) {
            zwQty = expectedRecords
                .filter((item) => isZwBackorderRecord(item))
                .reduce((sum, item) => sum + (Number(item?.Ilosc) || 0), 0);
        }
    }

    return setCacheEntry(vendoInventoryCache, cacheKey, {
        code: normalizedCode,
        productName,
        vendoStock,
        vendoExpected,
        zwQty,
    });
}

async function fetchVendoInventoryMap(connection, accessToken, codes, {
    includeExpected = true,
    includeZw = false,
    concurrency = 6,
    warnings = null,
} = {}) {
    const normalizedCodes = [...new Set((codes || [])
        .map((item) => String(item || "").trim())
        .filter(Boolean))];

    if (!normalizedCodes.length) {
        return new Map();
    }

    const inventoryRows = await mapWithConcurrency(normalizedCodes, concurrency, async (code) => {
        try {
            return await fetchVendoInventoryForCode(connection, accessToken, code, {
                includeExpected,
                includeZw,
            });
        } catch (error) {
            if (Array.isArray(warnings)) {
                warnings.push(`Nie udalo sie pobrac danych Vendo dla kodu ${code}: ${error.message}`);
            }

            return {
                code,
                productName: "",
                vendoStock: 0,
                vendoExpected: 0,
                zwQty: 0,
            };
        }
    });

    return new Map(inventoryRows.map((item) => [String(item?.code || "").trim(), item]));
}

function buildProductsModel({ productCode, pageSize }) {
    const model = {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : 20,
        },
        ZwracanePola: ["ID", "Kod", "Nazwa", "LacznyStan", "JednostkaKod", "Aktywnosc", "Rodzaj1", "Stany"],
    };

    if (productCode && productCode.trim()) {
        model.FiltrUniwersalny = productCode.trim();
        model.FiltrUniwersalnyPola = ["Kod"];
    }

    return model;
}

function buildCostAnalysisModel({ dateFrom, dateTo, analysisBy, excludeDocuments, excludeCorrections, excludeServices, onlyClosedDocuments, extendedMode }) {
    return {
        AnalizaWg: Number(analysisBy) || 10000,
        BezDokumentow: Boolean(excludeDocuments),
        BezKorekt: Boolean(excludeCorrections),
        BezUslug: Boolean(excludeServices),
        DataDlaAnalizy: 0,
        DataPoczatkowa: `${dateFrom}T00:00:00`,
        DataKoncowa: `${dateTo}T23:59:59`,
        TrybAnalizyRozszerzonej: Boolean(extendedMode),
        TylkoDokumentyWPelniWydane: false,
        TylkoRozliczoneZaliczkami: false,
        TylkoZamknieteDokumenty: Boolean(onlyClosedDocuments),
        WedlugSkladnikowKompletow: false,
    };
}

function buildBackordersModel({ dateFrom, dateTo, productCode, warehouseCode, direction, pageSize }) {
    const model = {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : 20,
        },
        ZwracanePola: [
            "ID",
            "DataBackorderu",
            "DataUtworzenia",
            "TowarID",
            "MagazynID",
            "Ilosc",
            "Kierunek",
            "Zrodlo",
            "NumerDokumentu",
            "DokumentID",
            "PozycjaDokumentuID",
            "ZlecenieID",
            "PlanZleceniaID",
            "KKWID",
        ],
    };

    if (dateFrom) {
        model.DataBackoderuMinimalna = `${dateFrom}T00:00:00`;
    }

    if (dateTo) {
        model.DataBackorderuMaksymalna = `${dateTo}T23:59:59`;
    }

    if (productCode && productCode.trim()) {
        model.Towar = { Kod: productCode.trim() };
    }

    if (warehouseCode && warehouseCode.trim()) {
        model.Magazyn = { Kod: warehouseCode.trim() };
    }

    if (direction === "1" || direction === "-1") {
        model.Kierunek = Number(direction);
    }

    return model;
}

function parseIdList(value) {
    if (!value || !String(value).trim()) {
        return [];
    }

    return String(value)
        .split(/[,\s;]+/)
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item > 0);
}

function buildMrpWorkCostsModel({ kkwIds, kkwElementIds, kkwExecutionIds }) {
    const model = {};

    if (kkwIds.length) {
        model.KkwID = kkwIds;
    }

    if (kkwElementIds.length) {
        model.KkwElementID = kkwElementIds;
    }

    if (kkwExecutionIds.length) {
        model.KkwWykonanieID = kkwExecutionIds;
    }

    return model;
}

function buildKkwLookupModel({ numbers }) {
    return {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Math.max(numbers.length * 5, 20),
        },
        ZwracanePola: ["ID", "Numer"],
        FiltrUniwersalny: numbers.join(" "),
        FiltrUniwersalnyPola: ["Numer"],
    };
}

function buildKkwLookupByIdsModel({ ids, pageSize }) {
    return {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : Math.max(ids.length * 2, 20),
        },
        ID: ids,
        ZwracanePola: [
            "ID",
            "Numer",
            "IloscOczekiwana",
            "IloscPrzyjeta",
            "IloscWykonana",
            "ZlecenieID",
            "ZlecenieNumer",
            "NumerObcy",
            "PolaUzytkownika",
            "TowarKod",
            "TowarNazwa",
            "PozycjaZleceniaID",
            "PozycjaZleceniaNazwa",
            "PozycjaZleceniaPolaUzytkownika",
        ],
        ZwracanePolaParametry: [
            {
                ZwracanePole: "PolaUzytkownika",
                ParametrNazwa: "pz_value84",
                ParametrWartosc: "1",
            },
            {
                ZwracanePole: "PozycjaZleceniaPolaUzytkownika",
                ParametrNazwa: "pz_value84",
                ParametrWartosc: "1",
            },
        ],
    };
}

async function resolveKkwIdsByNumbers(connection, accessToken, numbers) {
    if (!numbers.length) {
        return [];
    }

    const response = await vendoPost(connection.baseUrl, "/Produkcja/KKW/Lista", {
        Token: accessToken,
        Model: buildKkwLookupModel({ numbers }),
    });

    const records = Array.isArray(response?.Wynik?.Rekordy) ? response.Wynik.Rekordy : [];
    const byNumber = new Map(
        records
            .filter((item) => item?.Numer && Number.isInteger(Number(item?.ID)))
            .map((item) => [String(item.Numer).trim().toUpperCase(), Number(item.ID)])
    );

    const missing = numbers.filter((number) => !byNumber.has(number));
    if (missing.length) {
        throw new Error(`Nie znaleziono KKW o numerze: ${missing.join(", ")}`);
    }

    return numbers.map((number) => byNumber.get(number));
}

async function resolveKkwRecordsByNumbers(connection, accessToken, numbers, { allowMissing = false } = {}) {
    if (!numbers.length) {
        return [];
    }

    const response = await vendoPost(connection.baseUrl, "/Produkcja/KKW/Lista", {
        Token: accessToken,
        Model: {
            Cursor: true,
            CursorCzyZamknac: true,
            Strona: {
                Indeks: 0,
                LiczbaRekordow: Math.max(numbers.length * 5, 20),
            },
            FiltrUniwersalny: numbers.join(" "),
            FiltrUniwersalnyPola: ["Numer"],
            ZwracanePola: [
                "ID",
                "Numer",
                "IloscOczekiwana",
                "IloscPrzyjeta",
                "IloscWykonana",
                "ZlecenieID",
                "ZlecenieNumer",
                "NumerObcy",
                "PolaUzytkownika",
                "TowarKod",
                "TowarNazwa",
                "PozycjaZleceniaID",
                "PozycjaZleceniaNazwa",
                "PozycjaZleceniaPolaUzytkownika",
                "TerminZakonczeniaKKW",
            ],
            ZwracanePolaParametry: [
                {
                    ZwracanePole: "PolaUzytkownika",
                    ParametrNazwa: "pz_value84",
                    ParametrWartosc: "1",
                },
                {
                    ZwracanePole: "PozycjaZleceniaPolaUzytkownika",
                    ParametrNazwa: "pz_value84",
                    ParametrWartosc: "1",
                },
            ],
        },
    });

    const records = Array.isArray(response?.Wynik?.Rekordy) ? response.Wynik.Rekordy : [];
    const byNumber = new Map(
        records
            .filter((item) => item?.Numer)
            .map((item) => [String(item.Numer).trim().toUpperCase(), item])
    );

    const missing = numbers.filter((number) => !byNumber.has(number));
    if (!allowMissing && missing.length) {
        throw new Error(`Nie znaleziono KKW o numerze: ${missing.join(", ")}`);
    }

    if (allowMissing) {
        return numbers.map((number) => byNumber.get(number)).filter(Boolean);
    }

    return numbers.map((number) => byNumber.get(number));
}

function buildProductionOrdersLookupByIdsModel({ ids, pageSize }) {
    return {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : Math.max(ids.length * 2, 20),
        },
        ZleceniaID: ids,
        ZwracanePola: [
            "ID",
            "ZlecenieNumer",
            "NumerObcy",
            "PolaUzytkownika",
        ],
        ZwracanePolaParametry: [
            {
                ZwracanePole: "PolaUzytkownika",
                ParametrNazwa: "pz_value84",
                ParametrWartosc: "1",
            },
            {
                ZwracanePole: "PolaUzytkownika",
                ParametrNazwa: "pz_value156",
                ParametrWartosc: "1",
            },
        ],
    };
}

function buildPlanningPositionsLookupByIdsModel({ ids, pageSize }) {
    return {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : Math.max(ids.length * 2, 20),
        },
        ZleceniePozycjeID: ids,
        ZwracanePola: [
            "ID",
            "ZlecenieID",
            "Opis",
            "PolaUzytkownika",
        ],
        ZwracanePolaParametry: [
            {
                ZwracanePole: "PolaUzytkownika",
                ParametrNazwa: "pz_value84",
                ParametrWartosc: "1",
            },
            {
                ZwracanePole: "PolaUzytkownika",
                ParametrNazwa: "pz_value156",
                ParametrWartosc: "1",
            },
        ],
    };
}

function buildPlanningOrdersLookupByIdsModel({ ids, pageSize }) {
    return {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : Math.max(ids.length * 2, 20),
        },
        ZleceniaID: ids,
        ZwracanePola: [
            "ID",
            "ZlecenieNumer",
            "NumerObcy",
            "PolaUzytkownika",
        ],
        ZwracanePolaParametry: [
            {
                ZwracanePole: "PolaUzytkownika",
                ParametrNazwa: "pz_value84",
                ParametrWartosc: "1",
            },
            {
                ZwracanePole: "PolaUzytkownika",
                ParametrNazwa: "pz_value156",
                ParametrWartosc: "1",
            },
        ],
    };
}

function buildVendoPlanPositionModel({ planPositionId }) {
    return {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: 20,
        },
        ZleceniePozycjeID: [Number(planPositionId)],
        ZwracanePola: [
            "ID",
            "ZlecenieID",
            "TowarID",
            "Kod",
            "Nazwa",
            "Opis",
            "Ilosc",
            "IloscNaKKW",
            "IloscWykonana",
            "StanRealizacji",
            "StrukturaProduktuID",
            "DataRealizacji",
            "PrzeniesienieDoObrobki",
            "PolaUzytkownika",
        ],
        ZwracanePolaParametry: [
            {
                ZwracanePole: "PolaUzytkownika",
                ParametrNazwa: "pz_value84",
                ParametrWartosc: "1",
            },
            {
                ZwracanePole: "PolaUzytkownika",
                ParametrNazwa: "pz_value156",
                ParametrWartosc: "1",
            },
        ],
    };
}

function buildVendoPlanPositionsOverviewModel({ search, pageSize }) {
    const model = {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : 120,
        },
        ZwracanePola: [
            "ID",
            "ZlecenieID",
            "TowarID",
            "Kod",
            "Nazwa",
            "Opis",
            "Ilosc",
            "IloscNaKKW",
            "IloscWykonana",
            "StanRealizacji",
            "StrukturaProduktuID",
            "DataRealizacji",
            "PrzeniesienieDoObrobki",
            "PolaUzytkownika",
        ],
        ZwracanePolaParametry: [
            {
                ZwracanePole: "PolaUzytkownika",
                ParametrNazwa: "pz_value84",
                ParametrWartosc: "1",
            },
        ],
    };

    const normalizedSearch = String(search || "").trim();
    if (normalizedSearch) {
        model.FiltrUniwersalny = normalizedSearch;
        model.FiltrUniwersalnyPola = ["Kod", "Nazwa", "ZlecenieNumer", "Klient1Nazwa"];
    }

    return model;
}

function buildVendoPlanningOrderModel({ orderId }) {
    return {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: 20,
        },
        ZleceniaID: [Number(orderId)],
        ZwracanePola: [
            "ID",
            "ZlecenieNumer",
            "Seria",
            "Klient1Nazwa",
            "DataUtworzenia",
            "DataTerminZakonczenia",
            "StanRealizacji",
            "ZleceniePriorytet",
            "NumerObcy",
            "PolaUzytkownika",
        ],
        ZwracanePolaParametry: [
            {
                ZwracanePole: "PolaUzytkownika",
                ParametrNazwa: "pz_value84",
                ParametrWartosc: "1",
            },
        ],
    };
}

function buildVendoPlanningOrdersOverviewModel({ orderIds, pageSize }) {
    return {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : Math.max(orderIds.length * 2, 50),
        },
        ZleceniaID: orderIds,
        ZwracanePola: [
            "ID",
            "ZlecenieNumer",
            "Seria",
            "Klient1Nazwa",
            "DataUtworzenia",
            "DataTerminZakonczenia",
            "StanRealizacji",
            "ZleceniePriorytet",
            "NumerObcy",
            "PolaUzytkownika",
        ],
        ZwracanePolaParametry: [
            {
                ZwracanePole: "PolaUzytkownika",
                ParametrNazwa: "pz_value84",
                ParametrWartosc: "1",
            },
        ],
    };
}

function buildKkwByPlanPositionModel({ planPositionId, pageSize }) {
    return {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : 50,
        },
        PozycjaZleceniaID: [Number(planPositionId)],
        ZwracanePola: [
            "ID",
            "Numer",
            "IloscOczekiwana",
            "IloscPrzyjeta",
            "IloscWykonana",
            "ZlecenieID",
            "ZlecenieNumer",
            "NumerObcy",
            "PolaUzytkownika",
            "TowarKod",
            "TowarNazwa",
            "PozycjaZleceniaID",
            "PozycjaZleceniaNazwa",
            "PozycjaZleceniaPolaUzytkownika",
            "TerminZakonczeniaKKW",
        ],
        ZwracanePolaParametry: [
            {
                ZwracanePole: "PolaUzytkownika",
                ParametrNazwa: "pz_value84",
                ParametrWartosc: "1",
            },
            {
                ZwracanePole: "PozycjaZleceniaPolaUzytkownika",
                ParametrNazwa: "pz_value84",
                ParametrWartosc: "1",
            },
        ],
    };
}

function buildKkwByPlanPositionsModel({ planPositionIds, pageSize }) {
    return {
        ...buildKkwByPlanPositionModel({
            planPositionId: planPositionIds?.[0] || 0,
            pageSize: Number.isFinite(pageSize) ? pageSize : Math.max((planPositionIds || []).length * 3, 50),
        }),
        PozycjaZleceniaID: (planPositionIds || [])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0),
    };
}

function buildTechnologyLookupModel({ productCode, pageSize }) {
    return {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : 50,
        },
        FiltrUniwersalny: String(productCode || "").trim(),
        FiltrUniwersalnyPola: ["Kod", "Nazwa", "TowarKod"],
        ZwracanePola: [
            "ID",
            "Kod",
            "Nazwa",
            "TowarID",
            "TowarKod",
            "TowarNazwa",
            "Domyslna",
            "Aktywna",
            "Zatwierdzona",
            "StrukturaProduktuID",
        ],
    };
}

function buildTechnologyMaterialsModel({ technologyId, technologyIds, pageSize }) {
    const normalizedTechnologyIds = [
        ...(Array.isArray(technologyIds) ? technologyIds : [technologyId]),
    ]
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);

    return {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : 500,
        },
        TechnologiaID: normalizedTechnologyIds,
        ZwracanePola: [
            "ID",
            "Typ",
            "SkladnikID",
            "SkladnikKod",
            "SkladnikNazwa",
            "TechnologiaID",
            "OperacjaNazwa",
            "OperacjaLp",
            "JednostkaSkrot",
            "MagazynKod",
            "IloscLicznik",
            "IloscMianownik",
            "IloscNetto",
            "CenaKalkulacyjna",
        ],
    };
}

function buildStatusDictionaryModel({ dataType }) {
    return {
        TypDanych: dataType,
    };
}

function buildObjectStatusesModel({ objectId, dataType }) {
    return {
        ObiektID: Number(objectId),
        TypDanych: dataType,
    };
}

function buildObjectStatusesHistoryModel({ objectIds, dataType, pageSize, onlyCurrent = false }) {
    return {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : Math.max((objectIds || []).length * 4, 50),
        },
        TypDanych: dataType,
        TypStatusu: "Standardowy",
        ObiektyID: (objectIds || [])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0),
        TylkoAktualne: Boolean(onlyCurrent),
    };
}

async function resolveVendoStatuses(connection, accessToken, {
    dataType,
    objectIds,
    pageSize,
    maxPages = 10,
    onlyCurrent = false,
    warnings = null,
    warningLabel = "obiektow",
} = {}) {
    const normalizedIds = [...new Set((objectIds || [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0))];

    if (!normalizedIds.length) {
        return {
            dictionary: [],
            records: [],
            byObjectId: new Map(),
        };
    }

    let dictionary = [];
    try {
        const dictionaryResponse = await vendoPost(connection.baseUrl, "/Statusy/Statusy/StatusyDlaTypuDanych", {
            Token: accessToken,
            Model: buildStatusDictionaryModel({ dataType }),
        });
        dictionary = getVendoListResult(dictionaryResponse);
    } catch (error) {
        if (Array.isArray(warnings)) {
            warnings.push(`Nie udalo sie pobrac slownika statusow Vendo dla ${warningLabel}: ${error.message}`);
        }
    }

    let records = [];
    try {
        const idChunks = [];
        const chunkSize = 50;
        for (let index = 0; index < normalizedIds.length; index += chunkSize) {
            idChunks.push(normalizedIds.slice(index, index + chunkSize));
        }

        const chunkResults = await mapWithConcurrency(idChunks, 3, async (chunkIds) => {
            const chunkPageSize = Number.isFinite(pageSize)
                ? pageSize
                : Math.max(chunkIds.length * 4, 50);

            return fetchAllCursorRecords(
                connection,
                accessToken,
                "/Statusy/Statusy/StatusyObiektu",
                buildObjectStatusesHistoryModel({
                    objectIds: chunkIds,
                    dataType,
                    pageSize: chunkPageSize,
                    onlyCurrent,
                }),
                {
                    pageSize: chunkPageSize,
                    maxPages,
                }
            );
        });

        records = chunkResults.flat();
    } catch (error) {
        if (Array.isArray(warnings)) {
            warnings.push(`Nie udalo sie pobrac statusow Vendo dla ${warningLabel}: ${error.message}`);
        }
    }

    const byObjectId = new Map();
    for (const record of records) {
        const objectId = Number(record?.ObiektID);
        if (!Number.isInteger(objectId) || objectId <= 0) continue;
        const bucket = byObjectId.get(objectId) || [];
        bucket.push(record);
        byObjectId.set(objectId, bucket);
    }

    return {
        dictionary,
        records,
        byObjectId,
    };
}

function buildDocumentsLookupByOrderIdsModel({ orderIds, pageSize }) {
    return {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : Math.max(orderIds.length * 8, 50),
        },
        ZleceniaID: orderIds,
        ZwracanePola: [
            "ID",
            "ZlecenieID",
            "ZlecenieNumer",
            "RodzajKod",
            "NumerPelny",
            "NumerObcy",
            "DataWystawienia",
            "PolaUzytkownika",
        ],
        ZwracanePolaParametry: [
            {
                ZwracanePole: "PolaUzytkownika",
                ParametrNazwa: "pz_value84",
                ParametrWartosc: "1",
            },
        ],
    };
}

function buildDocumentsLookupByIdsModel({ documentIds, pageSize, includeItems = false }) {
    return {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : Math.max(documentIds.length * 2, 20),
        },
        DokumentyID: documentIds,
        ZwracanePola: [
            "ID",
            "RodzajKod",
            "NumerPelny",
            "DataWystawienia",
            "Data1",
            "Data2",
            "Klient1Nazwa",
            "Opis",
            ...(includeItems ? ["Pozycje"] : []),
        ],
    };
}

function buildVendoZwDetailsCacheKey(connection, componentCode = "") {
    return [
        connection?.baseUrl || "",
        connection?.vendoUserLogin || "",
        "zw-detail",
        String(componentCode || "").trim().toUpperCase(),
    ].join("::");
}

function buildVendoZwDocumentDetailsCacheKey(connection, documentId) {
    return [
        connection?.baseUrl || "",
        connection?.vendoUserLogin || "",
        "zw-document-detail",
        String(Number(documentId) || 0),
    ].join("::");
}

function getForeignNumberFromRecord(record) {
    const fieldNames = [
        "pz_value84",
        "PZ_VALUE84",
        "pZ_value84",
        "nrobcy",
        "nr_obcy",
        "numerobcy",
    ];
    const userFieldForeignNumber = pickUserFieldValue(record, fieldNames);
    const positionUserFieldForeignNumber = pickUserFieldValue(
        { PolaUzytkownika: record?.PozycjaZleceniaPolaUzytkownika },
        fieldNames
    );
    const articleUserFieldForeignNumber = pickUserFieldValue(
        { PolaUzytkownika: record?.TowarPolaUzytkownika },
        fieldNames
    );

    return String(
        record?.NumerObcy
        ?? userFieldForeignNumber
        ?? positionUserFieldForeignNumber
        ?? articleUserFieldForeignNumber
        ?? record?.Pz_Value84
        ?? record?.PZ_Value84
        ?? record?.pz_value84
        ?? ""
    ).trim() || null;
}

function getPlanningPositionNote(record) {
    const note = String(
        record?.Uwagi
        ?? record?.uwagi
        ?? record?.Opis
        ?? record?.opis
        ?? record?.Komentarz
        ?? record?.komentarz
        ?? ""
    ).trim();

    if (!note || note === "0") {
        return null;
    }

    return note;
}

function getVendoRecords(response) {
    return Array.isArray(response?.Wynik?.Rekordy) ? response.Wynik.Rekordy : [];
}

function getVendoListResult(response) {
    if (Array.isArray(response?.Wynik)) return response.Wynik;
    if (Array.isArray(response?.Wynik?.Rekordy)) return response.Wynik.Rekordy;
    return [];
}

function getPositiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function getVendoBoolWeight(value) {
    const normalized = normalizeText(value);
    return value === true || value === 1 || normalized === "true" || normalized === "tak" ? 1 : 0;
}

function getVendoStatusIdentity(record) {
    const nestedStatus = record?.Status && typeof record.Status === "object" ? record.Status : null;
    return {
        id: Number(
            record?.StatusID
            ?? record?.StatusId
            ?? nestedStatus?.ID
            ?? nestedStatus?.Id
            ?? record?.Status
            ?? record?.ID
        ) || null,
        name: String(
            record?.StatusNazwa
            ?? record?.StatusName
            ?? nestedStatus?.Nazwa
            ?? nestedStatus?.Name
            ?? record?.Nazwa
            ?? ""
        ).trim(),
    };
}

function getVendoStatusScope(statusRecords, statusDictionary = []) {
    const dictionaryById = new Map(
        (statusDictionary || [])
            .map((item) => getVendoStatusIdentity(item))
            .filter((item) => item.id)
            .map((item) => [item.id, item.name])
    );
    const names = [];
    const ids = [];

    for (const record of statusRecords || []) {
        const identity = getVendoStatusIdentity(record);
        if (identity.id) ids.push(identity.id);

        const name = identity.name || dictionaryById.get(identity.id) || "";
        if (name) names.push(name);
    }

    const normalizedNames = names.map((name) => normalizeText(name));
    const hasSmd = normalizedNames.some((name) => name.includes("elementy smd") || name === "smd");
    const hasTht = normalizedNames.some((name) => name.includes("elementy tht") || name === "tht");
    const hasApp = normalizedNames.some((name) => name.includes("apka"));
    const hasDraft = normalizedNames.some((name) => name === "draft" || name.includes(" draft"));
    const includeSmd = !hasSmd;
    const includeTht = !hasTht;

    return {
        ids: [...new Set(ids)],
        names: [...new Set(names)],
        hasSmd,
        hasTht,
        hasApp,
        hasDraft,
        excludeSmd: hasSmd,
        excludeTht: hasTht,
        includeSmd,
        includeTht,
        hasDemandScope: includeSmd || includeTht,
    };
}

function isVendoPlanPositionHardClosed(position, planningOrder = null) {
    const orderQty = getPositiveNumber(position?.Ilosc);
    const doneQty = getPositiveNumber(position?.IloscWykonana);
    if (orderQty > 0 && doneQty >= orderQty) {
        return true;
    }

    const stateText = normalizeText([
        position?.StanRealizacji,
        planningOrder?.StanRealizacji,
    ].filter(Boolean).join(" "));

    return (
        stateText.includes("zrealiz")
        || stateText.includes("zamkn")
        || stateText.includes("wykon")
        || stateText.includes("anul")
    );
}

function getVendoStageFromScope(scope, isClosed) {
    if (isClosed) {
        return {
            key: "CLOSED",
            label: "Gotowe",
        };
    }

    if (scope?.includeSmd && scope?.includeTht) {
        return {
            key: "PENDING_BOTH",
            label: "Pelny BOM",
        };
    }

    if (scope?.includeSmd) {
        return {
            key: "PENDING_SMD",
            label: "Bez THT",
        };
    }

    if (scope?.includeTht) {
        return {
            key: "PENDING_THT",
            label: "Bez SMD",
        };
    }

    return {
        key: "EXCLUDED_ALL",
        label: "Bez SMD/THT",
    };
}

function filterBomItemsByVendoScope(bomItems, scope) {
    if (!scope?.hasDemandScope) {
        return [];
    }

    return (bomItems || []).filter((item) => {
        const typeName = String(item?.typeName || "").trim().toUpperCase();
        if (typeName === "THT") return scope.includeTht;
        if (typeName === "SMD") return scope.includeSmd;
        return true;
    });
}

function buildVendoOverviewSummary(headers, { generatedAt = null } = {}) {
    const clients = new Set();
    const summary = {
        totalHeaders: headers.length,
        openHeaders: 0,
        closedHeaders: 0,
        pendingSmdHeaders: 0,
        pendingThtHeaders: 0,
        fullBomHeaders: 0,
        excludedAllHeaders: 0,
        noScopeHeaders: 0,
        scopedHeaders: 0,
        packetHeaders: 0,
        totalBomItems: 0,
        openBomItems: 0,
        shortageBomItems: 0,
        shortageQty: 0,
        activeClients: 0,
        lastImportAt: generatedAt,
        sourceLabel: "Vendo",
    };

    for (const header of headers) {
        if (header.isClosed) summary.closedHeaders += 1;
        else summary.openHeaders += 1;

        if (header.statusFlags?.includeSmd) summary.pendingSmdHeaders += 1;
        if (header.statusFlags?.includeTht) summary.pendingThtHeaders += 1;
        if (header.statusFlags?.includeSmd && header.statusFlags?.includeTht) summary.fullBomHeaders += 1;
        if (!header.includeInDemand) summary.excludedAllHeaders += 1;
        if (header.statusFlags?.excludeSmd || header.statusFlags?.excludeTht) summary.scopedHeaders += 1;
        else summary.noScopeHeaders += 1;
        if (header.packetFlag) summary.packetHeaders += 1;
        if (header.clientName) clients.add(header.clientName);

        summary.totalBomItems += Number(header.bomCount) || 0;
        summary.openBomItems += Number(header.openBomCount) || 0;
        summary.shortageBomItems += Number(header.shortageBomCount) || 0;
        summary.shortageQty += Number(header.shortageQty) || 0;
    }

    summary.activeClients = clients.size;
    return summary;
}

function buildVendoOperationalHeadersCacheKey(connection, {
    search = "",
    pageSize = 100,
    maxPages = 2,
    includeClosed = false,
    includeNoScope = true,
    materialOwnershipFilter = "MSX_OR_EMPTY",
} = {}) {
    return [
        connection?.baseUrl || "",
        connection?.vendoUserLogin || "",
        normalizeText(search),
        Number(pageSize) || 100,
        Number(maxPages) || 2,
        includeClosed ? "closed" : "open",
        includeNoScope ? "scope-all" : "scope-demand",
        normalizeMaterialOwnershipFilter(materialOwnershipFilter),
    ].join("::");
}

function buildVendoDemandTotalsCacheKey(connection, {
    pageSize = 100,
    maxPages = 2,
    materialOwnershipFilter = "MSX_OR_EMPTY",
} = {}) {
    return [
        connection?.baseUrl || "",
        connection?.vendoUserLogin || "",
        "totals",
        Number(pageSize) || 100,
        Number(maxPages) || 2,
        normalizeMaterialOwnershipFilter(materialOwnershipFilter),
    ].join("::");
}

function buildVendoDemandDetailsCacheKey(connection, {
    componentCode = "",
    pageSize = 100,
    maxPages = 2,
    materialOwnershipFilter = "MSX_OR_EMPTY",
    includeVendo = true,
} = {}) {
    return [
        connection?.baseUrl || "",
        connection?.vendoUserLogin || "",
        "detail",
        String(componentCode || "").trim().toUpperCase(),
        Number(pageSize) || 100,
        Number(maxPages) || 2,
        normalizeMaterialOwnershipFilter(materialOwnershipFilter),
        includeVendo ? "vendo-stock" : "wms-only",
    ].join("::");
}

function buildVendoOperationalHeaderSummaryCacheKey(connection, {
    search = "",
    pageSize = 100,
    maxPages = 2,
    includeClosed = false,
    includeNoScope = true,
    materialOwnershipFilter = "MSX_OR_EMPTY",
    includeVendo = true,
    overviewGeneratedAt = "",
} = {}) {
    return [
        buildVendoOperationalHeadersCacheKey(connection, {
            search,
            pageSize,
            maxPages,
            includeClosed,
            includeNoScope,
            materialOwnershipFilter,
        }),
        includeVendo ? "vendo-stock" : "wms-only",
        String(overviewGeneratedAt || ""),
        "header-summary",
    ].join("::");
}

function buildVendoTechnologyLookupCacheKey(connection, position) {
    return [
        connection?.baseUrl || "",
        Number(position?.TowarID) || 0,
        String(position?.Kod || "").trim(),
    ].join("::");
}

function sortVendoOperationalHeaderContexts(left, right) {
    const leftHeader = left?.header || left || {};
    const rightHeader = right?.header || right || {};
    const leftCreatedAt = Date.parse(leftHeader.sourceCreatedAt || leftHeader.importedAt || "") || 0;
    const rightCreatedAt = Date.parse(rightHeader.sourceCreatedAt || rightHeader.importedAt || "") || 0;
    if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt;
    return (Number(leftHeader.id) || 0) - (Number(rightHeader.id) || 0);
}

function buildVendoOperationalHeaderContext({
    position,
    positionDetails,
    planningOrder,
    objectStatuses,
    currentObjectStatuses,
    statusDictionary,
    kkwRecords,
    generatedAt,
}) {
    const planPositionId = Number(position?.ID);
    const positionWithFields = positionDetails ? { ...position, ...positionDetails } : position;
    const planningOrderId = Number(position?.ZlecenieID) || null;
    const statusScope = getVendoStatusScope(objectStatuses, statusDictionary);
    const currentStatusScope = getVendoStatusScope(
        Array.isArray(currentObjectStatuses) ? currentObjectStatuses : [],
        statusDictionary
    );
    const isClosed = isVendoPlanPositionHardClosed(position, planningOrder);
    const stage = getVendoStageFromScope(statusScope, isClosed);
    const kkwNumbers = (kkwRecords || []).map((item) => String(item?.Numer || "").trim()).filter(Boolean);
    const clientName = String(planningOrder?.Klient1Nazwa || "").trim() || null;
    const planningSeries = String(planningOrder?.Seria || "").trim() || null;
    const materialOwnership = resolveMaterialOwnershipFromRecord(positionWithFields);
    const vendoNote = getPlanningPositionNote(positionWithFields);
    const operationalNote = statusScope.hasDemandScope ? "" : "SMD/THT wykluczone z zapotrzebowania";
    const headerNotes = [vendoNote, operationalNote].filter(Boolean).join(" | ") || null;

    return {
        header: {
            id: planPositionId,
            sourceSystem: "vendo",
            sourceAccessId: null,
            sourcePlanPositionId: planPositionId,
            sourcePlanOrderId: planningOrderId,
            sourceOrderId: null,
            sourceKkwId: Number(kkwRecords?.[0]?.ID) || null,
            kkwNumber: kkwNumbers.join(", ") || null,
            zlpNumber: String(planningOrder?.ZlecenieNumer || "").trim() || null,
            planningSeries,
            nrObcy: getForeignNumberFromRecord(positionWithFields) || getForeignNumberFromRecord(planningOrder),
            productIndex: String(positionWithFields?.Kod || "").trim() || null,
            productName: String(positionWithFields?.Nazwa || "").trim() || "",
            clientName,
            materialOwnership: materialOwnership || null,
            materialOwnershipLabel: materialOwnership || "PUSTE",
            orderQty: getPositiveNumber(positionWithFields?.Ilosc),
            termDate: positionWithFields?.DataRealizacji || planningOrder?.DataTerminZakonczenia || null,
            smdDone: statusScope.excludeSmd,
            thtDone: statusScope.excludeTht,
            isClosed,
            packetFlag: Boolean(positionWithFields?.PrzeniesienieDoObrobki),
            zakStatus: null,
            notes: headerNotes,
            createdBy: null,
            sourceCreatedAt: planningOrder?.DataUtworzenia || null,
            importedAt: generatedAt,
            bomCount: null,
            openBomCount: null,
            shortageBomCount: null,
            shortageQty: null,
            stageKey: stage.key,
              stageLabel: stage.label,
              statusNames: statusScope.names,
              statusFlags: {
                  smd: statusScope.excludeSmd,
                  tht: statusScope.excludeTht,
                excludeSmd: statusScope.excludeSmd,
                  excludeTht: statusScope.excludeTht,
                  includeSmd: statusScope.includeSmd,
                  includeTht: statusScope.includeTht,
                  app: statusScope.hasApp,
                draft: currentStatusScope.hasDraft,
              },
              isDraft: currentStatusScope.hasDraft,
              summaryPending: statusScope.hasDemandScope,
            hasKkw: Boolean(kkwRecords?.length),
            realizationState: String(positionWithFields?.StanRealizacji || "").trim() || null,
            orderRealizationState: String(planningOrder?.StanRealizacji || "").trim() || null,
            includeInDemand: !isClosed && statusScope.hasDemandScope,
        },
        position,
        positionWithFields,
        planningOrder,
        objectStatuses: objectStatuses || [],
        statusScope,
        kkwRecords: kkwRecords || [],
        isClosed,
        stage,
    };
}

async function getVendoOperationalHeadersContext({
    connection,
    accessToken,
    search = "",
    pageSize = 100,
    maxPages = 10,
    includeClosed = false,
    includeNoScope = true,
    materialOwnershipFilter = "MSX_OR_EMPTY",
    forceRefresh = false,
} = {}) {
    const normalizedSearch = String(search || "").trim();
    const normalizedMaterialOwnershipFilter = normalizeMaterialOwnershipFilter(materialOwnershipFilter);
    const cacheKey = buildVendoOperationalHeadersCacheKey(connection, {
        search: normalizedSearch,
        pageSize,
        maxPages,
        includeClosed,
        includeNoScope,
        materialOwnershipFilter: normalizedMaterialOwnershipFilter,
    });
    const cached = forceRefresh ? null : getCacheEntry(vendoOperationalHeadersCache, cacheKey, 60 * 1000);
    if (cached) {
        return cached;
    }

    const generatedAt = new Date().toISOString();
    const warnings = [];
    const positions = await fetchAllCursorRecords(
        connection,
        accessToken,
        "/Produkcja/ZleceniePlanistyczne/PozycjeLista",
        buildVendoPlanPositionsOverviewModel({
            search: normalizedSearch,
            pageSize,
        }),
        { pageSize, maxPages }
    );

    const planningOrderIds = [...new Set(positions
        .map((item) => Number(item?.ZlecenieID))
        .filter((value) => Number.isInteger(value) && value > 0))];
    let planningOrderById = new Map();
    if (planningOrderIds.length) {
        const planningOrders = await fetchAllCursorRecords(
            connection,
            accessToken,
            "/Produkcja/ZleceniePlanistyczne/Lista",
            buildVendoPlanningOrdersOverviewModel({
                orderIds: planningOrderIds,
                pageSize: Math.max(planningOrderIds.length * 2, 50),
            }),
            { pageSize: Math.max(planningOrderIds.length * 2, 50), maxPages: 5 }
        );
        planningOrderById = new Map(
            planningOrders
                .filter((item) => Number.isInteger(Number(item?.ID)))
                .map((item) => [Number(item.ID), item])
        );
    }

    const positionIds = positions
        .map((item) => Number(item?.ID))
        .filter((value) => Number.isInteger(value) && value > 0);

    const positionStatusesBundle = await resolveVendoStatuses(connection, accessToken, {
        dataType: "PlanZlecenia",
        objectIds: positionIds,
        pageSize: Math.max(positionIds.length * 4, 50),
        maxPages: 10,
        warnings,
        warningLabel: "pozycji ZLP",
    });
    const currentPositionStatusesBundle = await resolveVendoStatuses(connection, accessToken, {
        dataType: "PlanZlecenia",
        objectIds: positionIds,
        pageSize: Math.max(positionIds.length * 4, 50),
        maxPages: 10,
        onlyCurrent: true,
        warnings,
        warningLabel: "aktywnych statusow pozycji ZLP",
    });
    let statusDictionary = [...(positionStatusesBundle.dictionary || [])];

    let planningPositionById = new Map();
    if (positionIds.length) {
        try {
            const planningPositionRecords = await resolvePlanningPositionsByIds(
                connection,
                accessToken,
                positionIds,
                { allowMissing: true }
            );
            planningPositionById = new Map(
                planningPositionRecords
                    .filter((item) => Number.isInteger(Number(item?.ID)))
                    .map((item) => [Number(item.ID), item])
            );
        } catch (error) {
            warnings.push(`Nie udalo sie dociagnac wartosci dowolnych pozycji ZLP: ${error.message}`);
        }
    }

    const statusesByPositionId = positionStatusesBundle.byObjectId || new Map();
    const currentStatusesByPositionId = currentPositionStatusesBundle.byObjectId || new Map();

    const kkwByPositionId = new Map();
    if (positionIds.length) {
        try {
            const kkwRecords = await fetchAllCursorRecords(
                connection,
                accessToken,
                "/Produkcja/KKW/Lista",
                buildKkwByPlanPositionsModel({
                    planPositionIds: positionIds,
                    pageSize: Math.max(positionIds.length * 3, 50),
                }),
                { pageSize: Math.max(positionIds.length * 3, 50), maxPages: 10 }
            );

            for (const record of kkwRecords) {
                const positionId = Number(record?.PozycjaZleceniaID);
                if (!Number.isInteger(positionId) || positionId <= 0) continue;
                const bucket = kkwByPositionId.get(positionId) || [];
                bucket.push(record);
                kkwByPositionId.set(positionId, bucket);
            }
        } catch (error) {
            warnings.push(`Nie udalo sie pobrac KKW dla listy pozycji ZLP: ${error.message}`);
        }
    }

    const kkwIds = [...new Set(
        [...kkwByPositionId.values()]
            .flat()
            .map((item) => Number(item?.ID))
            .filter((value) => Number.isInteger(value) && value > 0)
    )];
    const kkwStatusesBundle = await resolveVendoStatuses(connection, accessToken, {
        dataType: "KKW",
        objectIds: kkwIds,
        pageSize: Math.max(kkwIds.length * 4, 50),
        maxPages: 10,
        warnings,
        warningLabel: "KKW",
    });
    const currentKkwStatusesBundle = await resolveVendoStatuses(connection, accessToken, {
        dataType: "KKW",
        objectIds: kkwIds,
        pageSize: Math.max(kkwIds.length * 4, 50),
        maxPages: 10,
        onlyCurrent: true,
        warnings,
        warningLabel: "aktywnych statusow KKW",
    });
    const statusesByKkwId = kkwStatusesBundle.byObjectId || new Map();
    const currentStatusesByKkwId = currentKkwStatusesBundle.byObjectId || new Map();
    if (Array.isArray(kkwStatusesBundle.dictionary) && kkwStatusesBundle.dictionary.length) {
        statusDictionary = [...statusDictionary, ...kkwStatusesBundle.dictionary];
    }

    const headerContexts = positions
        .map((position) => {
            const positionId = Number(position?.ID) || 0;
            const kkwRecords = kkwByPositionId.get(positionId) || [];
            const mergedStatuses = [
                ...(statusesByPositionId.get(positionId) || []),
                ...kkwRecords.flatMap((record) => statusesByKkwId.get(Number(record?.ID) || 0) || []),
            ];
            const mergedCurrentStatuses = [
                ...(currentStatusesByPositionId.get(positionId) || []),
                ...kkwRecords.flatMap((record) => currentStatusesByKkwId.get(Number(record?.ID) || 0) || []),
            ];

            return buildVendoOperationalHeaderContext({
                position,
                positionDetails: planningPositionById.get(positionId) || null,
                planningOrder: planningOrderById.get(Number(position?.ZlecenieID) || 0) || null,
                objectStatuses: mergedStatuses,
                currentObjectStatuses: mergedCurrentStatuses,
                statusDictionary,
                kkwRecords,
                generatedAt,
            });
        })
        .filter((context) => {
            const header = context?.header || {};
            if (!isAllowedOperationalSeries(header.planningSeries)) return false;
            if (isBlockedOperationalClient(header.clientName)) return false;
            if (!matchesMaterialOwnershipFilter(header.materialOwnership, normalizedMaterialOwnershipFilter)) return false;
            if (!includeClosed && header.isClosed) return false;
            if (!includeNoScope && !header.includeInDemand) return false;
            return true;
        })
        .sort(sortVendoOperationalHeaderContexts);

    const payload = {
        generatedAt,
        warnings,
        headers: headerContexts.map((item) => item.header),
        headerContexts,
        fetchedPositions: positions.length,
        returnedHeaders: headerContexts.length,
        includeClosed,
        includeNoScope,
        materialOwnershipFilter: normalizedMaterialOwnershipFilter,
        pageSize,
        maxPages,
    };

    return setCacheEntry(vendoOperationalHeadersCache, cacheKey, payload);
}

async function resolveTechnologyForPosition(connection, accessToken, position) {
    const cacheKey = buildVendoTechnologyLookupCacheKey(connection, position);
    const cached = getCacheEntry(vendoTechnologyLookupCache, cacheKey, 10 * 60 * 1000);
    if (cached !== null) {
        return cached;
    }

    const technologyResponse = await vendoPost(connection.baseUrl, "/Produkcja/Technologie/Lista", {
        Token: accessToken,
        Model: buildTechnologyLookupModel({ productCode: position?.Kod, pageSize: 50 }),
    });
    const technology = pickBestTechnologyRecord(getVendoRecords(technologyResponse), position) || null;
    return setCacheEntry(vendoTechnologyLookupCache, cacheKey, technology);
}

function groupRowsByNumericKey(rows, keyName) {
    const rowsByKey = new Map();

    for (const row of rows || []) {
        const key = Number(row?.[keyName]);
        if (!Number.isInteger(key) || key <= 0) continue;
        const bucket = rowsByKey.get(key) || [];
        bucket.push(row);
        rowsByKey.set(key, bucket);
    }

    return rowsByKey;
}

async function fetchKkwMaterialRowsByIds(connection, accessToken, kkwIds, { pageSize = 500, maxPages = 20 } = {}) {
    const normalizedKkwIds = [...new Set((kkwIds || [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0))];
    if (!normalizedKkwIds.length) {
        return [];
    }

    const resolvedPageSize = Math.max(Number(pageSize) || 500, 500);

    try {
        const rows = await fetchAllCursorRecords(
            connection,
            accessToken,
            "/Produkcja/KKW/MaterialowkaLista",
            buildKkwMaterialsModel({
                kkwIds: normalizedKkwIds,
                pageSize: resolvedPageSize,
            }),
            { pageSize: resolvedPageSize, maxPages }
        );

        const normalizedRows = rows.map((row) => ({
            ...row,
            KKWID: Number(row?.KKWID) || null,
        }));
        if (normalizedKkwIds.length > 1 && normalizedRows.some((row) => !Number(row?.KKWID))) {
            throw new Error("Brakuje KKWID w odpowiedzi zbiorczej.");
        }

        return normalizedRows;
    } catch (error) {
        if (normalizedKkwIds.length === 1) {
            throw error;
        }

        const batches = await mapWithConcurrency(normalizedKkwIds, 4, async (kkwId) => {
            const rows = await fetchAllCursorRecords(
                connection,
                accessToken,
                "/Produkcja/KKW/MaterialowkaLista",
                buildKkwMaterialsModel({
                    kkwIds: [kkwId],
                    pageSize: resolvedPageSize,
                }),
                { pageSize: resolvedPageSize, maxPages }
            );

            return rows.map((row) => ({
                ...row,
                KKWID: Number(row?.KKWID) || kkwId,
            }));
        });

        return batches.flat();
    }
}

async function fetchTechnologyMaterialRowsByIds(connection, accessToken, technologyIds, { pageSize = 500, maxPages = 20 } = {}) {
    const normalizedTechnologyIds = [...new Set((technologyIds || [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0))];
    if (!normalizedTechnologyIds.length) {
        return [];
    }

    const resolvedPageSize = Math.max(Number(pageSize) || 500, 500);

    try {
        const rows = await fetchAllCursorRecords(
            connection,
            accessToken,
            "/Produkcja/Technologie/MaterialowkaLista",
            buildTechnologyMaterialsModel({
                technologyIds: normalizedTechnologyIds,
                pageSize: resolvedPageSize,
            }),
            { pageSize: resolvedPageSize, maxPages }
        );

        const normalizedRows = rows.map((row) => ({
            ...row,
            TechnologiaID: Number(row?.TechnologiaID) || null,
        }));
        if (normalizedTechnologyIds.length > 1 && normalizedRows.some((row) => !Number(row?.TechnologiaID))) {
            throw new Error("Brakuje TechnologiaID w odpowiedzi zbiorczej.");
        }

        return normalizedRows;
    } catch (error) {
        if (normalizedTechnologyIds.length === 1) {
            throw error;
        }

        const batches = await mapWithConcurrency(normalizedTechnologyIds, 4, async (technologyId) => {
            const rows = await fetchAllCursorRecords(
                connection,
                accessToken,
                "/Produkcja/Technologie/MaterialowkaLista",
                buildTechnologyMaterialsModel({
                    technologyIds: [technologyId],
                    pageSize: resolvedPageSize,
                }),
                { pageSize: resolvedPageSize, maxPages }
            );

            return rows.map((row) => ({
                ...row,
                TechnologiaID: Number(row?.TechnologiaID) || technologyId,
            }));
        });

        return batches.flat();
    }
}

function pickBestTechnologyRecord(records, position) {
    const productCode = String(position?.Kod || "").trim();
    const productId = Number(position?.TowarID) || 0;
    const matching = [...(records || [])].filter((item) => {
        const technologyProductCode = String(item?.TowarKod || item?.Kod || "").trim();
        const technologyProductId = Number(item?.TowarID) || 0;
        return (
            (productCode && technologyProductCode === productCode)
            || (productId > 0 && technologyProductId === productId)
        );
    });

    if (!matching.length) {
        return null;
    }

    return matching
        .sort((left, right) => {
            const leftScore = (
                getVendoBoolWeight(left?.Domyslna) * 8
                + getVendoBoolWeight(left?.Aktywna) * 4
                + getVendoBoolWeight(left?.Zatwierdzona) * 2
            );
            const rightScore = (
                getVendoBoolWeight(right?.Domyslna) * 8
                + getVendoBoolWeight(right?.Aktywna) * 4
                + getVendoBoolWeight(right?.Zatwierdzona) * 2
            );

            if (rightScore !== leftScore) return rightScore - leftScore;
            return Number(right?.ID || 0) - Number(left?.ID || 0);
        })[0] || null;
}

function inferBomTypeFromMaterial(row) {
    const code = String(row?.SkladnikKod || "").trim().toUpperCase();
    const name = normalizeText(row?.SkladnikNazwa);
    const operation = normalizeText(row?.OperacjaNazwa);

    if (code.startsWith("PCB") || name.includes("pcb")) return "PCB";
    if (operation.includes("smd")) return "SMD";
    if (operation.includes("tht") || operation.includes("reczny") || operation.includes("fala")) return "THT";
    return String(row?.Typ || "").trim() || "BOM";
}

function getMaterialUnitQty(row) {
    const plannedQty = getPositiveNumber(row?.IloscPlanowana);
    if (plannedQty) return plannedQty;

    const numerator = getPositiveNumber(row?.IloscLicznik);
    const denominator = getPositiveNumber(row?.IloscMianownik);
    if (numerator && denominator) return numerator / denominator;

    return getPositiveNumber(row?.IloscNetto);
}

function normalizeVendoBomItems(materialRows, { sourceType, orderQty }) {
    return (materialRows || [])
        .filter((row) => normalizeText(row?.Typ) === "rozchod")
        .map((row) => {
            const rawQty = getMaterialUnitQty(row);
            const orderQuantity = Math.max(getPositiveNumber(orderQty), 1);
            const requiredQty = sourceType === "kkw" ? rawQty : rawQty * orderQuantity;
            const componentQty = sourceType === "kkw" ? rawQty / orderQuantity : rawQty;

            return {
                sourceType,
                sourceMaterialId: Number(row?.ID) || null,
                componentId: Number(row?.SkladnikID) || null,
                componentCode: String(row?.SkladnikKod || "").trim(),
                componentName: String(row?.SkladnikNazwa || "").trim(),
                typeName: inferBomTypeFromMaterial(row),
                operationName: String(row?.OperacjaNazwa || "").trim(),
                operationLp: row?.OperacjaLp ?? null,
                unit: String(row?.JednostkaSkrot || "").trim() || null,
                warehouseCode: String(row?.MagazynKod || "").trim() || null,
                componentQty,
                requiredQty,
                isOpen: true,
                smdDone: false,
                thtDone: false,
                note: "",
            };
        });
}

async function getVendoOperationalDemandTotals({
    connection,
    accessToken,
    materialOwnershipFilter = "MSX_OR_EMPTY",
    pageSize = 100,
    maxPages = 2,
    warnings = [],
} = {}) {
    const cacheKey = buildVendoDemandTotalsCacheKey(connection, {
        pageSize,
        maxPages,
        materialOwnershipFilter,
    });
    const cached = getCacheEntry(vendoDemandTotalsCache, cacheKey, 2 * 60 * 1000);
    if (cached) {
        return cached;
    }

    const overviewContext = await getVendoOperationalHeadersContext({
        connection,
        accessToken,
        pageSize,
        maxPages,
        includeClosed: false,
        includeNoScope: true,
        materialOwnershipFilter,
    });

    if (Array.isArray(overviewContext?.warnings) && overviewContext.warnings.length) {
        warnings.push(...overviewContext.warnings);
    }

    const activeHeaderContexts = (overviewContext?.headerContexts || [])
        .filter((context) => context?.header?.includeInDemand);
    const totalsByCode = new Map();
    if (!activeHeaderContexts.length) {
        return setCacheEntry(vendoDemandTotalsCache, cacheKey, totalsByCode);
    }

    const uniqueKkwIds = [...new Set(activeHeaderContexts
        .flatMap((context) => (context?.kkwRecords || [])
            .map((record) => Number(record?.ID))
            .filter((value) => Number.isInteger(value) && value > 0)))];
    let kkwMaterialRowsById = new Map();
    if (uniqueKkwIds.length) {
        try {
            kkwMaterialRowsById = groupRowsByNumericKey(
                await fetchKkwMaterialRowsByIds(connection, accessToken, uniqueKkwIds, {
                    pageSize: 500,
                    maxPages: 20,
                }),
                "KKWID"
            );
        } catch (error) {
            warnings.push(`Nie udalo sie pobrac materialowki KKW do totali: ${error.message}`);
        }
    }

    const technologyCandidates = new Map();
    for (const context of activeHeaderContexts) {
        const kkwIds = (context?.kkwRecords || [])
            .map((record) => Number(record?.ID))
            .filter((value) => Number.isInteger(value) && value > 0);
        const kkwRows = kkwIds.flatMap((kkwId) => kkwMaterialRowsById.get(kkwId) || []);
        const hasKkwConsumptionRows = kkwRows.some((row) => normalizeText(row?.Typ) === "rozchod");
        if (hasKkwConsumptionRows) {
            continue;
        }

        const position = context?.positionWithFields || context?.position || {};
        const technologyKey = buildVendoTechnologyLookupCacheKey(connection, position);
        if (!technologyCandidates.has(technologyKey)) {
            technologyCandidates.set(technologyKey, position);
        }
    }

    const technologyByKey = new Map();
    if (technologyCandidates.size) {
        const technologyEntries = await mapWithConcurrency(
            [...technologyCandidates.entries()],
            4,
            async ([technologyKey, position]) => {
                try {
                    return [technologyKey, await resolveTechnologyForPosition(connection, accessToken, position)];
                } catch (error) {
                    warnings.push(`Nie udalo sie znalezc technologii dla ${String(position?.Kod || position?.ID || "-")}: ${error.message}`);
                    return [technologyKey, null];
                }
            }
        );

        for (const [technologyKey, technology] of technologyEntries) {
            technologyByKey.set(technologyKey, technology);
        }
    }

    const uniqueTechnologyIds = [...new Set([...technologyByKey.values()]
        .map((technology) => Number(technology?.ID))
        .filter((value) => Number.isInteger(value) && value > 0))];
    let technologyMaterialRowsById = new Map();
    if (uniqueTechnologyIds.length) {
        try {
            technologyMaterialRowsById = groupRowsByNumericKey(
                await fetchTechnologyMaterialRowsByIds(connection, accessToken, uniqueTechnologyIds, {
                    pageSize: 500,
                    maxPages: 20,
                }),
                "TechnologiaID"
            );
        } catch (error) {
            warnings.push(`Nie udalo sie pobrac materialowki technologii do totali: ${error.message}`);
        }
    }

    for (const context of activeHeaderContexts) {
        const position = context?.positionWithFields || context?.position || {};
        const orderQty = getPositiveNumber(position?.Ilosc);
        const kkwIds = (context?.kkwRecords || [])
            .map((record) => Number(record?.ID))
            .filter((value) => Number.isInteger(value) && value > 0);
        const kkwRows = kkwIds.flatMap((kkwId) => (kkwMaterialRowsById.get(kkwId) || []).map((row) => ({
            ...row,
            KKWID: Number(row?.KKWID) || kkwId,
        })));
        const hasKkwConsumptionRows = kkwRows.some((row) => normalizeText(row?.Typ) === "rozchod");

        let sourceType = "technology";
        let materialRows = [];
        if (hasKkwConsumptionRows) {
            sourceType = "kkw";
            materialRows = kkwRows;
        } else {
            const technology = technologyByKey.get(buildVendoTechnologyLookupCacheKey(connection, position)) || null;
            materialRows = technology ? (technologyMaterialRowsById.get(Number(technology?.ID)) || []) : [];
        }

        if (!materialRows.length) {
            continue;
        }

        const bomItems = filterBomItemsByVendoScope(
            normalizeVendoBomItems(materialRows, {
                sourceType,
                orderQty,
            }),
            context?.statusScope
        );

        for (const item of bomItems) {
            const code = String(item?.componentCode || "").trim();
            if (!code) continue;
            totalsByCode.set(code, (Number(totalsByCode.get(code)) || 0) + getPositiveNumber(item?.requiredQty));
        }
    }

    return setCacheEntry(vendoDemandTotalsCache, cacheKey, totalsByCode);
}

async function getVendoOperationalComponentDetails({
    connection,
    accessToken,
    componentCode,
    materialOwnershipFilter = "MSX_OR_EMPTY",
    pageSize = 100,
    maxPages = 2,
    includeVendo = true,
    warnings = [],
    forceRefresh = false,
} = {}) {
    const normalizedComponentCode = String(componentCode || "").trim().toUpperCase();
    const cacheKey = buildVendoDemandDetailsCacheKey(connection, {
        componentCode: normalizedComponentCode,
        pageSize,
        maxPages,
        materialOwnershipFilter,
        includeVendo,
    });
    const cached = forceRefresh ? null : getCacheEntry(vendoDemandDetailsCache, cacheKey, 2 * 60 * 1000);
    if (cached) {
        if (Array.isArray(cached?.warnings) && cached.warnings.length) {
            warnings.push(...cached.warnings);
        }
        return cached;
    }

    const overviewContext = await getVendoOperationalHeadersContext({
        connection,
        accessToken,
        pageSize,
        maxPages,
        includeClosed: false,
        includeNoScope: true,
        materialOwnershipFilter,
        forceRefresh,
    });

    if (Array.isArray(overviewContext?.warnings) && overviewContext.warnings.length) {
        warnings.push(...overviewContext.warnings);
    }

    const activeHeaderContexts = (overviewContext?.headerContexts || [])
        .filter((context) => context?.header?.includeInDemand);
    if (!activeHeaderContexts.length || !normalizedComponentCode) {
        return setCacheEntry(vendoDemandDetailsCache, cacheKey, {
            componentCode: normalizedComponentCode,
            componentName: null,
            typeName: null,
            inventory: {
                wmsStock: 0,
                vendoStock: 0,
                vendoExpected: 0,
            },
            rows: [],
            warnings: [...new Set(warnings.filter(Boolean))],
        });
    }

    const uniqueKkwIds = [...new Set(activeHeaderContexts
        .flatMap((context) => (context?.kkwRecords || [])
            .map((record) => Number(record?.ID))
            .filter((value) => Number.isInteger(value) && value > 0)))];
    let kkwMaterialRowsById = new Map();
    if (uniqueKkwIds.length) {
        try {
            kkwMaterialRowsById = groupRowsByNumericKey(
                await fetchKkwMaterialRowsByIds(connection, accessToken, uniqueKkwIds, {
                    pageSize: 500,
                    maxPages: 20,
                }),
                "KKWID"
            );
        } catch (error) {
            warnings.push(`Nie udalo sie pobrac materialowki KKW do szczegolow komponentu: ${error.message}`);
        }
    }

    const technologyCandidates = new Map();
    for (const context of activeHeaderContexts) {
        const kkwIds = (context?.kkwRecords || [])
            .map((record) => Number(record?.ID))
            .filter((value) => Number.isInteger(value) && value > 0);
        const kkwRows = kkwIds.flatMap((kkwId) => kkwMaterialRowsById.get(kkwId) || []);
        const hasKkwConsumptionRows = kkwRows.some((row) => normalizeText(row?.Typ) === "rozchod");
        if (hasKkwConsumptionRows) {
            continue;
        }

        const position = context?.positionWithFields || context?.position || {};
        const technologyKey = buildVendoTechnologyLookupCacheKey(connection, position);
        if (!technologyCandidates.has(technologyKey)) {
            technologyCandidates.set(technologyKey, position);
        }
    }

    const technologyByKey = new Map();
    if (technologyCandidates.size) {
        const technologyEntries = await mapWithConcurrency(
            [...technologyCandidates.entries()],
            4,
            async ([technologyKey, position]) => {
                try {
                    return [technologyKey, await resolveTechnologyForPosition(connection, accessToken, position)];
                } catch (error) {
                    warnings.push(`Nie udalo sie znalezc technologii dla ${String(position?.Kod || position?.ID || "-")}: ${error.message}`);
                    return [technologyKey, null];
                }
            }
        );

        for (const [technologyKey, technology] of technologyEntries) {
            technologyByKey.set(technologyKey, technology);
        }
    }

    const uniqueTechnologyIds = [...new Set([...technologyByKey.values()]
        .map((technology) => Number(technology?.ID))
        .filter((value) => Number.isInteger(value) && value > 0))];
    let technologyMaterialRowsById = new Map();
    if (uniqueTechnologyIds.length) {
        try {
            technologyMaterialRowsById = groupRowsByNumericKey(
                await fetchTechnologyMaterialRowsByIds(connection, accessToken, uniqueTechnologyIds, {
                    pageSize: 500,
                    maxPages: 20,
                }),
                "TechnologiaID"
            );
        } catch (error) {
            warnings.push(`Nie udalo sie pobrac materialowki technologii do szczegolow komponentu: ${error.message}`);
        }
    }

    const rows = [];
    let resolvedComponentName = null;
    let resolvedTypeName = null;

    for (const context of activeHeaderContexts) {
        const position = context?.positionWithFields || context?.position || {};
        const orderQty = getPositiveNumber(position?.Ilosc);
        const kkwIds = (context?.kkwRecords || [])
            .map((record) => Number(record?.ID))
            .filter((value) => Number.isInteger(value) && value > 0);
        const kkwRows = kkwIds.flatMap((kkwId) => (kkwMaterialRowsById.get(kkwId) || []).map((row) => ({
            ...row,
            KKWID: Number(row?.KKWID) || kkwId,
        })));
        const hasKkwConsumptionRows = kkwRows.some((row) => normalizeText(row?.Typ) === "rozchod");

        let sourceType = "technology";
        let materialRows = [];
        if (hasKkwConsumptionRows) {
            sourceType = "kkw";
            materialRows = kkwRows;
        } else {
            const technology = technologyByKey.get(buildVendoTechnologyLookupCacheKey(connection, position)) || null;
            materialRows = technology ? (technologyMaterialRowsById.get(Number(technology?.ID)) || []) : [];
        }

        if (!materialRows.length) {
            continue;
        }

        const bomItems = filterBomItemsByVendoScope(
            normalizeVendoBomItems(materialRows, {
                sourceType,
                orderQty,
            }),
            context?.statusScope
        );

        const matchingItems = bomItems.filter((item) => String(item?.componentCode || "").trim().toUpperCase() === normalizedComponentCode);
        if (!matchingItems.length) {
            continue;
        }

        const requiredQty = matchingItems.reduce((sum, item) => sum + getPositiveNumber(item?.requiredQty), 0);
        if (requiredQty <= 0) {
            continue;
        }

        if (!resolvedComponentName) {
            resolvedComponentName = matchingItems.find((item) => String(item?.componentName || "").trim())?.componentName || null;
        }
        if (!resolvedTypeName) {
            resolvedTypeName = matchingItems.find((item) => String(item?.typeName || "").trim())?.typeName || null;
        }

        rows.push({
            headerId: Number(context?.header?.id) || null,
            planPositionId: Number(context?.header?.sourcePlanPositionId) || null,
            planningOrderId: Number(context?.header?.sourcePlanOrderId) || null,
            termDate: context?.header?.termDate || null,
            kkwNumber: context?.header?.kkwNumber || null,
            orderNumber: context?.header?.zlpNumber || null,
            foreignNumber: context?.header?.nrObcy || null,
            vendoProductCode: context?.header?.productIndex || null,
            vendoProductName: context?.header?.productName || null,
            clientName: context?.header?.clientName || null,
            orderQty: getPositiveNumber(context?.header?.orderQty),
            requiredQty,
            stageKey: context?.header?.stageKey || null,
            stageLabel: context?.header?.stageLabel || null,
            planningSeries: context?.header?.planningSeries || null,
            materialOwnershipLabel: context?.header?.materialOwnershipLabel || null,
        });
    }

    rows.sort((left, right) => {
        const leftTerm = Date.parse(String(left?.termDate || "")) || 0;
        const rightTerm = Date.parse(String(right?.termDate || "")) || 0;
        if (leftTerm !== rightTerm) {
            return leftTerm - rightTerm;
        }

        const leftKkw = String(left?.kkwNumber || "");
        const rightKkw = String(right?.kkwNumber || "");
        const kkwCompare = leftKkw.localeCompare(rightKkw, "pl");
        if (kkwCompare !== 0) {
            return kkwCompare;
        }

        return String(left?.orderNumber || "").localeCompare(String(right?.orderNumber || ""), "pl");
    });

    let wmsStock = 0;
    let vendoStock = 0;
    let vendoExpected = 0;
    const wmsMissing = requireWmsSqlConfig();
    if (wmsMissing.length) {
        warnings.push(`Brakuje konfiguracji WMS: ${[...new Set(wmsMissing)].join(", ")}.`);
    } else {
        try {
            wmsStock = getPositiveNumber((await getWmsInventoryForCodes([normalizedComponentCode])).get(normalizedComponentCode)?.wmsStock);
        } catch (error) {
            warnings.push(`Nie udalo sie pobrac stanu WMS dla ${normalizedComponentCode}: ${error.message}`);
        }
    }

    if (includeVendo) {
        try {
            const vendoInventoryByCode = await fetchVendoInventoryMap(connection, accessToken, [normalizedComponentCode], {
                includeExpected: false,
                concurrency: 1,
                warnings,
            });
            vendoStock = getPositiveNumber(vendoInventoryByCode.get(normalizedComponentCode)?.vendoStock);
            vendoExpected = getPositiveNumber(vendoInventoryByCode.get(normalizedComponentCode)?.vendoExpected);
        } catch (error) {
            warnings.push(`Nie udalo sie pobrac stanu Vendo dla ${normalizedComponentCode}: ${error.message}`);
        }
    }

    return setCacheEntry(vendoDemandDetailsCache, cacheKey, {
        componentCode: normalizedComponentCode,
        componentName: resolvedComponentName,
        typeName: resolvedTypeName,
        inventory: {
            wmsStock,
            vendoStock,
            vendoExpected,
        },
        rows,
        warnings: [...new Set(warnings.filter(Boolean))],
    });
}

async function getVendoZwDetailsForComponent({
    connection,
    accessToken,
    componentCode,
    warnings = [],
    forceRefresh = false,
} = {}) {
    const normalizedComponentCode = String(componentCode || "").trim().toUpperCase();
    const cacheKey = buildVendoZwDetailsCacheKey(connection, normalizedComponentCode);
    const cached = forceRefresh ? null : getCacheEntry(vendoZwDetailsCache, cacheKey, 2 * 60 * 1000);
    if (cached) {
        if (Array.isArray(cached?.warnings) && cached.warnings.length) {
            warnings.push(...cached.warnings);
        }
        return cached;
    }

    if (!normalizedComponentCode) {
        return setCacheEntry(vendoZwDetailsCache, cacheKey, {
            componentCode: "",
            componentName: null,
            unitCode: null,
            totalQty: 0,
            rows: [],
            warnings: [],
        });
    }

    const backorderRows = await fetchAllCursorRecords(
        connection,
        accessToken,
        "/Magazyn/Backordery/Lista",
        buildBackordersModel({
            productCode: normalizedComponentCode,
            direction: "1",
            pageSize: 100,
        }),
        {
            pageSize: 100,
            maxPages: 20,
        }
    );

    const documentIds = [...new Set(backorderRows
        .map((item) => Number(item?.DokumentID))
        .filter((value) => Number.isInteger(value) && value > 0))];

    let documentById = new Map();
    if (documentIds.length) {
        try {
            const documents = await resolveDocumentsByIds(connection, accessToken, documentIds, {
                allowMissing: true,
                includeItems: true,
            });
            documentById = new Map(
                documents
                    .filter((item) => Number.isInteger(Number(item?.ID)))
                    .map((item) => [Number(item.ID), item])
            );
        } catch (error) {
            warnings.push(`Nie udalo sie pobrac dokumentow ZW dla ${normalizedComponentCode}: ${error.message}`);
        }
    }

    const rows = backorderRows
        .filter((row) => isZwBackorderRecord(row, documentById.get(Number(row?.DokumentID))))
        .map((row) => {
            const documentId = Number(row?.DokumentID) || null;
            const document = documentById.get(documentId) || null;
            const documentItems = Array.isArray(document?.Pozycje) ? document.Pozycje : [];
            const matchedItem = documentItems.find((item) => Number(item?.ElementID) === Number(row?.PozycjaDokumentuID))
                || documentItems.find((item) => String(item?.Towar?.Kod || "").trim().toUpperCase() === normalizedComponentCode)
                || null;

            return {
                backorderId: Number(row?.ID) || null,
                documentId,
                documentKind: String(document?.RodzajKod || "").trim() || null,
                documentNumber: String(document?.NumerPelny || row?.NumerDokumentu || "").trim() || null,
                supplierName: String(document?.Klient1Nazwa || "").trim() || null,
                createdAt: row?.DataUtworzenia || document?.Data2 || null,
                expectedDate: matchedItem?.DataRealizacji || row?.DataBackorderu || document?.Data1 || null,
                date1: document?.Data1 || null,
                date2: document?.Data2 || null,
                qty: Number(row?.Ilosc) || Number(matchedItem?.Ilosc) || 0,
                qtyKg: Number(matchedItem?.IloscKg) || 0,
                qtyM3: Number(matchedItem?.IloscM3) || 0,
                unitCode: String(matchedItem?.Jednostka?.Kod || "").trim() || null,
                componentCode: String(matchedItem?.Towar?.Kod || normalizedComponentCode).trim() || normalizedComponentCode,
                componentName: String(matchedItem?.Nazwa || "").trim() || null,
                notes: String(
                    matchedItem?.Uwagi
                    ?? matchedItem?.Opis
                    ?? document?.Uwagi
                    ?? document?.Opis
                    ?? ""
                ).trim() || null,
            };
        })
        .sort((left, right) => {
            const leftExpected = Date.parse(String(left?.expectedDate || "")) || 0;
            const rightExpected = Date.parse(String(right?.expectedDate || "")) || 0;
            if (leftExpected !== rightExpected) {
                return leftExpected - rightExpected;
            }

            const leftCreated = Date.parse(String(left?.createdAt || "")) || 0;
            const rightCreated = Date.parse(String(right?.createdAt || "")) || 0;
            if (leftCreated !== rightCreated) {
                return rightCreated - leftCreated;
            }

            return String(left?.documentNumber || "").localeCompare(String(right?.documentNumber || ""), "pl");
        });

    const totalQty = rows.reduce((sum, row) => sum + (Number(row?.qty) || 0), 0);
    const componentName = rows.find((row) => String(row?.componentName || "").trim())?.componentName || null;
    const unitCode = rows.find((row) => String(row?.unitCode || "").trim())?.unitCode || null;

    return setCacheEntry(vendoZwDetailsCache, cacheKey, {
        componentCode: normalizedComponentCode,
        componentName,
        unitCode,
        totalQty,
        rows,
        warnings: [...new Set(warnings.filter(Boolean))],
    });
}

async function getVendoZwDocumentDetails({
    connection,
    accessToken,
    documentId,
    warnings = [],
    forceRefresh = false,
} = {}) {
    const normalizedDocumentId = Number(documentId);
    const cacheKey = buildVendoZwDocumentDetailsCacheKey(connection, normalizedDocumentId);
    const cached = forceRefresh ? null : getCacheEntry(vendoZwDocumentDetailsCache, cacheKey, 2 * 60 * 1000);
    if (cached) {
        if (Array.isArray(cached?.warnings) && cached.warnings.length) {
            warnings.push(...cached.warnings);
        }
        return cached;
    }

    if (!Number.isInteger(normalizedDocumentId) || normalizedDocumentId <= 0) {
        return setCacheEntry(vendoZwDocumentDetailsCache, cacheKey, {
            documentId: null,
            documentNumber: null,
            supplierName: null,
            rows: [],
            totalQty: 0,
            warnings: [],
        });
    }

    const [document] = await resolveDocumentsByIds(connection, accessToken, [normalizedDocumentId], {
        allowMissing: false,
        includeItems: true,
    });

    const rows = (Array.isArray(document?.Pozycje) ? document.Pozycje : [])
        .map((item) => ({
            itemId: Number(item?.ID) || Number(item?.ElementID) || null,
            productId: Number(item?.Towar?.ID) || null,
            productCode: String(item?.Towar?.Kod || "").trim() || null,
            productName: String(item?.Nazwa || item?.Towar?.Nazwa || "").trim() || null,
            qty: Number(item?.Ilosc) || 0,
            unitCode: String(item?.Jednostka?.Kod || "").trim() || null,
            expectedDate: item?.DataRealizacji || document?.Data1 || null,
            notes: String(item?.Uwagi ?? item?.Opis ?? "").trim() || null,
        }))
        .sort((left, right) => {
            const leftCode = String(left?.productCode || left?.productName || "");
            const rightCode = String(right?.productCode || right?.productName || "");
            return leftCode.localeCompare(rightCode, "pl");
        });

    const totalQty = rows.reduce((sum, row) => sum + (Number(row?.qty) || 0), 0);

    return setCacheEntry(vendoZwDocumentDetailsCache, cacheKey, {
        documentId: normalizedDocumentId,
        documentKind: String(document?.RodzajKod || "").trim() || null,
        documentNumber: String(document?.NumerPelny || "").trim() || null,
        supplierName: String(document?.Klient1Nazwa || "").trim() || null,
        issueDate: document?.DataWystawienia || null,
        deliveryDate: document?.Data1 || null,
        createdAt: document?.Data2 || null,
        notes: String(document?.Opis || "").trim() || null,
        rows,
        totalQty,
        warnings: [...new Set(warnings.filter(Boolean))],
    });
}

async function enrichBomItemsWithLiveInventory({
    bomItems,
    connection,
    accessToken,
    includeVendo,
    includeZw = false,
    warnings,
}) {
    const codes = [...new Set((bomItems || [])
        .map((item) => String(item?.componentCode || "").trim())
        .filter(Boolean))];
    let wmsInventoryByCode = new Map();
    let vendoInventoryByCode = new Map();

    const wmsMissing = requireWmsSqlConfig();
    if (wmsMissing.length) {
        warnings.push(`Brakuje konfiguracji WMS: ${[...new Set(wmsMissing)].join(", ")}.`);
    } else if (codes.length) {
        try {
            wmsInventoryByCode = await getWmsInventoryForCodes(codes);
        } catch (error) {
            warnings.push(`Nie udalo sie pobrac stanow WMS: ${error.message}`);
        }
    }

    if (includeVendo && codes.length) {
        vendoInventoryByCode = await fetchVendoInventoryMap(connection, accessToken, codes, {
            includeExpected: false,
            includeZw,
            concurrency: 8,
            warnings,
        });
    }

    return applyLiveInventoryToBomItems(bomItems, {
        wmsInventoryByCode,
        vendoInventoryByCode,
    });
}

function applyLiveInventoryToBomItems(bomItems, {
    wmsInventoryByCode = new Map(),
    vendoInventoryByCode = new Map(),
} = {}) {
    const availableByCode = new Map();
    return (bomItems || []).map((item) => {
        const code = String(item?.componentCode || "").trim();
        const wmsStock = getPositiveNumber(wmsInventoryByCode.get(code)?.wmsStock);
        const vendoStock = getPositiveNumber(vendoInventoryByCode.get(code)?.vendoStock);
        const vendoExpected = getPositiveNumber(vendoInventoryByCode.get(code)?.vendoExpected);
        const zwQty = getPositiveNumber(vendoInventoryByCode.get(code)?.zwQty);
        const requiredQty = getPositiveNumber(item?.requiredQty);
        const availableBefore = availableByCode.has(code)
            ? getPositiveNumber(availableByCode.get(code))
            : (wmsStock + vendoStock);
        const toOrder = Math.max(requiredQty - Math.max(availableBefore, 0), 0);
        const availableAfter = availableBefore - requiredQty;

        availableByCode.set(code, availableAfter);

        return {
            ...item,
            wmsStock,
            vendoStock,
            vendoExpected,
            zwQty,
            availableBefore,
            availableAfter,
            toOrder,
        };
    });
}

async function computeVendoOperationalHeaderSummaries({
    connection,
    accessToken,
    overviewContext,
    includeVendo = true,
    warnings = [],
    forceRefresh = false,
} = {}) {
    const cacheKey = buildVendoOperationalHeaderSummaryCacheKey(connection, {
        search: overviewContext?.search,
        pageSize: overviewContext?.pageSize,
        maxPages: overviewContext?.maxPages,
        includeClosed: overviewContext?.includeClosed,
        includeNoScope: overviewContext?.includeNoScope,
        materialOwnershipFilter: overviewContext?.materialOwnershipFilter,
        includeVendo,
        overviewGeneratedAt: overviewContext?.generatedAt,
    });
    const cached = forceRefresh ? null : getCacheEntry(vendoOperationalHeaderSummaryCache, cacheKey, 2 * 60 * 1000);
    if (cached) {
        if (Array.isArray(cached?.warnings) && Array.isArray(warnings)) {
            warnings.push(...cached.warnings);
        }
        return cached?.headers || [];
    }

    const headerContexts = Array.isArray(overviewContext?.headerContexts) ? overviewContext.headerContexts : [];
    if (!headerContexts.length) {
        return setCacheEntry(vendoOperationalHeaderSummaryCache, cacheKey, {
            headers: [],
            warnings: [],
        }).headers;
    }

    const summaryWarnings = [];
    const uniqueKkwIds = [...new Set(headerContexts
        .flatMap((context) => (context?.kkwRecords || [])
            .map((record) => Number(record?.ID))
            .filter((value) => Number.isInteger(value) && value > 0)))];
    let kkwMaterialRowsById = new Map();
    if (uniqueKkwIds.length) {
        try {
            kkwMaterialRowsById = groupRowsByNumericKey(
                await fetchKkwMaterialRowsByIds(connection, accessToken, uniqueKkwIds, {
                    pageSize: 500,
                    maxPages: 20,
                }),
                "KKWID"
            );
        } catch (error) {
            summaryWarnings.push(`Nie udalo sie pobrac materialowki KKW do podsumowania: ${error.message}`);
        }
    }

    const technologyCandidates = new Map();
    for (const context of headerContexts) {
        const kkwIds = (context?.kkwRecords || [])
            .map((record) => Number(record?.ID))
            .filter((value) => Number.isInteger(value) && value > 0);
        const kkwRows = kkwIds.flatMap((kkwId) => kkwMaterialRowsById.get(kkwId) || []);
        const hasKkwConsumptionRows = kkwRows.some((row) => normalizeText(row?.Typ) === "rozchod");
        if (hasKkwConsumptionRows) {
            continue;
        }

        const position = context?.positionWithFields || context?.position || {};
        const technologyKey = buildVendoTechnologyLookupCacheKey(connection, position);
        if (!technologyCandidates.has(technologyKey)) {
            technologyCandidates.set(technologyKey, position);
        }
    }

    const technologyByKey = new Map();
    if (technologyCandidates.size) {
        const technologyEntries = await mapWithConcurrency(
            [...technologyCandidates.entries()],
            4,
            async ([technologyKey, position]) => {
                try {
                    return [technologyKey, await resolveTechnologyForPosition(connection, accessToken, position)];
                } catch (error) {
                    summaryWarnings.push(`Nie udalo sie znalezc technologii dla ${String(position?.Kod || position?.ID || "-")}: ${error.message}`);
                    return [technologyKey, null];
                }
            }
        );

        for (const [technologyKey, technology] of technologyEntries) {
            technologyByKey.set(technologyKey, technology);
        }
    }

    const uniqueTechnologyIds = [...new Set([...technologyByKey.values()]
        .map((technology) => Number(technology?.ID))
        .filter((value) => Number.isInteger(value) && value > 0))];
    let technologyMaterialRowsById = new Map();
    if (uniqueTechnologyIds.length) {
        try {
            technologyMaterialRowsById = groupRowsByNumericKey(
                await fetchTechnologyMaterialRowsByIds(connection, accessToken, uniqueTechnologyIds, {
                    pageSize: 500,
                    maxPages: 20,
                }),
                "TechnologiaID"
            );
        } catch (error) {
            summaryWarnings.push(`Nie udalo sie pobrac materialowki technologii do podsumowania: ${error.message}`);
        }
    }

    const bomContextByHeaderId = new Map();
    const inventoryCodes = new Set();
    for (const context of headerContexts) {
        const headerId = Number(context?.header?.id);
        if (!Number.isInteger(headerId) || headerId <= 0) {
            continue;
        }

        const position = context?.positionWithFields || context?.position || {};
        const orderQty = getPositiveNumber(position?.Ilosc);
        const kkwIds = (context?.kkwRecords || [])
            .map((record) => Number(record?.ID))
            .filter((value) => Number.isInteger(value) && value > 0);
        const kkwRows = kkwIds.flatMap((kkwId) => (kkwMaterialRowsById.get(kkwId) || []).map((row) => ({
            ...row,
            KKWID: Number(row?.KKWID) || kkwId,
        })));
        const hasKkwConsumptionRows = kkwRows.some((row) => normalizeText(row?.Typ) === "rozchod");

        let sourceType = "technology";
        let materialRows = [];
        if (hasKkwConsumptionRows) {
            sourceType = "kkw";
            materialRows = kkwRows;
        } else {
            const technology = technologyByKey.get(buildVendoTechnologyLookupCacheKey(connection, position)) || null;
            materialRows = technology ? (technologyMaterialRowsById.get(Number(technology?.ID)) || []) : [];
        }

        const normalizedBomItems = normalizeVendoBomItems(materialRows, {
            sourceType,
            orderQty,
        });
        const scopedBomItems = filterBomItemsByVendoScope(normalizedBomItems, context?.statusScope);
        scopedBomItems.forEach((item) => {
            const code = String(item?.componentCode || "").trim();
            if (code) inventoryCodes.add(code);
        });

        bomContextByHeaderId.set(headerId, {
            normalizedBomItems,
            scopedBomItems,
        });
    }

    let wmsInventoryByCode = new Map();
    let vendoInventoryByCode = new Map();
    const codes = [...inventoryCodes];
    const wmsMissing = requireWmsSqlConfig();
    if (wmsMissing.length) {
        summaryWarnings.push(`Brakuje konfiguracji WMS: ${[...new Set(wmsMissing)].join(", ")}.`);
    } else if (codes.length) {
        try {
            wmsInventoryByCode = await getWmsInventoryForCodes(codes);
        } catch (error) {
            summaryWarnings.push(`Nie udalo sie pobrac stanow WMS do podsumowania: ${error.message}`);
        }
    }

    if (includeVendo && codes.length) {
        vendoInventoryByCode = await fetchVendoInventoryMap(connection, accessToken, codes, {
            includeExpected: false,
            concurrency: 8,
            warnings: summaryWarnings,
        });
    }

    const headers = headerContexts.map((context) => {
        const headerId = Number(context?.header?.id);
        const bomContext = bomContextByHeaderId.get(headerId) || {
            normalizedBomItems: [],
            scopedBomItems: [],
        };
        const bomItems = applyLiveInventoryToBomItems(bomContext.scopedBomItems, {
            wmsInventoryByCode,
            vendoInventoryByCode,
        });
        const summary = buildVendoBomSummary(bomItems, {
            totalBomItems: bomContext.normalizedBomItems.length,
            openBomItems: bomContext.scopedBomItems.length,
        });
        const effectiveScope = context?.statusScope || {
            excludeSmd: Boolean(context?.header?.statusFlags?.excludeSmd),
            excludeTht: Boolean(context?.header?.statusFlags?.excludeTht),
            includeSmd: Boolean(context?.header?.statusFlags?.includeSmd),
            includeTht: Boolean(context?.header?.statusFlags?.includeTht),
            hasDemandScope: Boolean(context?.header?.includeInDemand),
        };
        const effectiveStage = getVendoStageFromScope(effectiveScope, Boolean(context?.header?.isClosed));

        return {
            ...context.header,
            bomCount: summary.totalBomItems,
            openBomCount: summary.openBomItems,
            shortageBomCount: summary.shortageBomItems,
            shortageQty: summary.shortageQty,
            stageKey: effectiveStage?.key || context?.header?.stageKey || null,
            stageLabel: effectiveStage?.label || context?.header?.stageLabel || null,
            statusFlags: {
                ...(context?.header?.statusFlags || {}),
                smd: Boolean(effectiveScope?.excludeSmd),
                tht: Boolean(effectiveScope?.excludeTht),
                excludeSmd: Boolean(effectiveScope?.excludeSmd),
                excludeTht: Boolean(effectiveScope?.excludeTht),
                includeSmd: Boolean(effectiveScope?.includeSmd),
                includeTht: Boolean(effectiveScope?.includeTht),
                draft: Boolean(context?.header?.statusFlags?.draft),
            },
            isDraft: Boolean(context?.header?.isDraft),
            smdDone: Boolean(effectiveScope?.excludeSmd),
            thtDone: Boolean(effectiveScope?.excludeTht),
            includeInDemand: !Boolean(context?.header?.isClosed) && Boolean(effectiveScope?.hasDemandScope),
            summaryPending: false,
        };
    });

    const payload = {
        headers,
        warnings: [...new Set(summaryWarnings.filter(Boolean))],
    };
    const cachedPayload = setCacheEntry(vendoOperationalHeaderSummaryCache, cacheKey, payload);
    if (Array.isArray(cachedPayload?.warnings) && Array.isArray(warnings)) {
        warnings.push(...cachedPayload.warnings);
    }
    return cachedPayload.headers || [];
}

function buildVendoBomSummary(bomItems, { totalBomItems = null, openBomItems = null } = {}) {
    const summary = (bomItems || []).reduce((result, item) => {
        const typeName = String(item?.typeName || "").trim().toUpperCase();
        const toOrder = getPositiveNumber(item?.toOrder);

        result.totalBomItems += 1;
        if (item?.isOpen) result.openBomItems += 1;
        result.requiredQty += getPositiveNumber(item?.requiredQty);
        result.wmsStock += getPositiveNumber(item?.wmsStock);
        result.vendoStock += getPositiveNumber(item?.vendoStock);
        if (toOrder > 0) {
            result.shortageBomItems += 1;
            result.shortageQty += toOrder;
        }
        if (typeName === "PCB") result.pcbItems += 1;
        if (typeName === "SMD") result.smdItems += 1;
        if (typeName === "THT") result.thtItems += 1;

        return result;
    }, {
        totalBomItems: 0,
        openBomItems: 0,
        shortageBomItems: 0,
        shortageQty: 0,
        requiredQty: 0,
        wmsStock: 0,
        vendoStock: 0,
        pcbItems: 0,
        smdItems: 0,
        thtItems: 0,
    });

    if (Number.isFinite(totalBomItems)) {
        summary.totalBomItems = Math.max(Number(totalBomItems) || 0, 0);
    }

    if (Number.isFinite(openBomItems)) {
        summary.openBomItems = Math.max(Number(openBomItems) || 0, 0);
    }

    return summary;
}

function getDocumentForeignNumberPriority(record) {
    const kind = String(record?.RodzajKod || "").trim().toUpperCase();
    switch (kind) {
        case "ZO":
            return 0;
        case "ZD":
            return 1;
        case "OF":
            return 2;
        case "WZ":
            return 3;
        case "FV":
            return 4;
        default:
            return 10;
    }
}

function pickPreferredForeignNumberDocument(records) {
    return [...(records || [])]
        .filter((item) => getForeignNumberFromRecord(item))
        .sort((left, right) => {
            const priorityDiff = getDocumentForeignNumberPriority(left) - getDocumentForeignNumberPriority(right);
            if (priorityDiff !== 0) {
                return priorityDiff;
            }

            const leftDate = Date.parse(String(left?.DataWystawienia || "")) || 0;
            const rightDate = Date.parse(String(right?.DataWystawienia || "")) || 0;
            if (rightDate !== leftDate) {
                return rightDate - leftDate;
            }

            return Number(right?.ID || 0) - Number(left?.ID || 0);
        })[0] || null;
}

async function resolveProductionOrdersByIds(connection, accessToken, ids, { allowMissing = false } = {}) {
    if (!ids.length) {
        return [];
    }

    const response = await vendoPost(connection.baseUrl, "/Produkcja/Zlecenie/Lista", {
        Token: accessToken,
        Model: buildProductionOrdersLookupByIdsModel({
            ids,
            pageSize: Math.max(ids.length * 2, 20),
        }),
    });

    const records = Array.isArray(response?.Wynik?.Rekordy) ? response.Wynik.Rekordy : [];
    const byId = new Map(
        records
            .filter((item) => Number.isInteger(Number(item?.ID)))
            .map((item) => [Number(item.ID), item])
    );

    const missing = ids.filter((id) => !byId.has(id));
    if (!allowMissing && missing.length) {
        throw new Error(`Nie znaleziono zlecenia o ID: ${missing.join(", ")}`);
    }

    if (allowMissing) {
        return ids.map((id) => byId.get(id)).filter(Boolean);
    }

    return ids.map((id) => byId.get(id));
}

async function resolveDocumentsByOrderIds(connection, accessToken, orderIds, { allowMissing = false } = {}) {
    if (!orderIds.length) {
        return [];
    }

    const response = await vendoPost(connection.baseUrl, "/Dokumenty/Dokumenty/Lista", {
        Token: accessToken,
        Model: buildDocumentsLookupByOrderIdsModel({
            orderIds,
            pageSize: Math.max(orderIds.length * 8, 50),
        }),
    });

    const records = Array.isArray(response?.Wynik?.Rekordy) ? response.Wynik.Rekordy : [];
    if (!allowMissing) {
        const foundOrderIds = new Set(
            records
                .map((item) => Number(item?.ZlecenieID))
                .filter((value) => Number.isInteger(value) && value > 0)
        );
        const missing = orderIds.filter((id) => !foundOrderIds.has(id));
        if (missing.length) {
            throw new Error(`Nie znaleziono dokumentow dla zlecenia o ID: ${missing.join(", ")}`);
        }
    }

    return records;
}

async function resolveDocumentsByIds(connection, accessToken, ids, {
    allowMissing = false,
    includeItems = false,
} = {}) {
    if (!ids.length) {
        return [];
    }

    const response = await vendoPost(connection.baseUrl, "/Dokumenty/Dokumenty/Lista", {
        Token: accessToken,
        Model: buildDocumentsLookupByIdsModel({
            documentIds: ids,
            pageSize: Math.max(ids.length * 2, 20),
            includeItems,
        }),
    });

    const records = Array.isArray(response?.Wynik?.Rekordy) ? response.Wynik.Rekordy : [];
    const byId = new Map(
        records
            .filter((item) => Number.isInteger(Number(item?.ID)))
            .map((item) => [Number(item.ID), item])
    );

    const missing = ids.filter((id) => !byId.has(id));
    if (!allowMissing && missing.length) {
        throw new Error(`Nie znaleziono dokumentow o ID: ${missing.join(", ")}`);
    }

    if (allowMissing) {
        return ids.map((id) => byId.get(id)).filter(Boolean);
    }

    return ids.map((id) => byId.get(id));
}

async function resolvePlanningPositionsByIds(connection, accessToken, ids, { allowMissing = false } = {}) {
    if (!ids.length) {
        return [];
    }

    const response = await vendoPost(connection.baseUrl, "/Produkcja/ZleceniePlanistyczne/PozycjeLista", {
        Token: accessToken,
        Model: buildPlanningPositionsLookupByIdsModel({
            ids,
            pageSize: Math.max(ids.length * 2, 20),
        }),
    });

    const records = Array.isArray(response?.Wynik?.Rekordy) ? response.Wynik.Rekordy : [];
    const byId = new Map(
        records
            .filter((item) => Number.isInteger(Number(item?.ID)))
            .map((item) => [Number(item.ID), item])
    );

    const missing = ids.filter((id) => !byId.has(id));
    if (!allowMissing && missing.length) {
        throw new Error(`Nie znaleziono pozycji planistycznej o ID: ${missing.join(", ")}`);
    }

    if (allowMissing) {
        return ids.map((id) => byId.get(id)).filter(Boolean);
    }

    return ids.map((id) => byId.get(id));
}

async function resolvePlanningOrdersByIds(connection, accessToken, ids, { allowMissing = false } = {}) {
    if (!ids.length) {
        return [];
    }

    const response = await vendoPost(connection.baseUrl, "/Produkcja/ZleceniePlanistyczne/Lista", {
        Token: accessToken,
        Model: buildPlanningOrdersLookupByIdsModel({
            ids,
            pageSize: Math.max(ids.length * 2, 20),
        }),
    });

    const records = Array.isArray(response?.Wynik?.Rekordy) ? response.Wynik.Rekordy : [];
    const byId = new Map(
        records
            .filter((item) => Number.isInteger(Number(item?.ID)))
            .map((item) => [Number(item.ID), item])
    );

    const missing = ids.filter((id) => !byId.has(id));
    if (!allowMissing && missing.length) {
        throw new Error(`Nie znaleziono zlecenia planistycznego o ID: ${missing.join(", ")}`);
    }

    if (allowMissing) {
        return ids.map((id) => byId.get(id)).filter(Boolean);
    }

    return ids.map((id) => byId.get(id));
}

async function resolveKkwRecordsByIds(connection, accessToken, ids, { allowMissing = false } = {}) {
    if (!ids.length) {
        return [];
    }

    const response = await vendoPost(connection.baseUrl, "/Produkcja/KKW/Lista", {
        Token: accessToken,
        Model: buildKkwLookupByIdsModel({ ids, pageSize: Math.max(ids.length * 2, 20) }),
    });

    const records = Array.isArray(response?.Wynik?.Rekordy) ? response.Wynik.Rekordy : [];
    const byId = new Map(
        records
            .filter((item) => Number.isInteger(Number(item?.ID)))
            .map((item) => [Number(item.ID), item])
    );

    const missing = ids.filter((id) => !byId.has(id));
    if (!allowMissing && missing.length) {
        throw new Error(`Nie znaleziono KKW o ID: ${missing.join(", ")}`);
    }

    if (allowMissing) {
        return ids.map((id) => byId.get(id)).filter(Boolean);
    }

    return ids.map((id) => byId.get(id));
}

const STAWKI_OPERACJI = {
    "Przyjęcie na magazyn": 55,
    "Montaż automatyczny SMD-TOP": 205,
    "Montaż automatyczny SMD-BOT": 205,
    "Montaż automatyczny SMD": 205,
    "Inspekcja automatyczna AOI-TOP": 130,
    "Inspekcja automatyczna AOI-BOT": 130,
    "Inspekcja automatyczna AOI": 130,
    "Inspekcja manualna": 67,
    "Osadzanie elementów": 55,
    "Montaż ręczny": 55,
    "FALA": 84,
    "Poprawki po fali": 55,
    "Uruchamianie/testowanie": 67,
    "Kontrola finalna": 66,
    "Lakierowanie": 89,
    "Mycie (myjka ultradźwiękowa)": 55.5,
    "Pakowanie(mycie, depanelizacja)": 55,
    "Frezowanie": 66.5,
    "Poprawki AOI": 66.5,
    "Program AOI": 66.5,
    "INNE - 1": 55,
    "INNE - 2": 55,
    "INNE - 3": 55,
    "INNE - 4": 55,
    "INNE - 5": 55,
    "INNE - 6": 55,
    "Kooperacja": 55,
    "SERWIS": 64,
    "Oklejanie kaptonem": 55,
};

const OPERACJE_JEDNORAZOWE = new Set([
    "Program AOI",
]);

function getStawkaOperacji(nazwaOperacji) {
    if (!nazwaOperacji) return null;
    const name = nazwaOperacji.trim();
    if (STAWKI_OPERACJI[name] !== undefined) return STAWKI_OPERACJI[name];
    const lower = name.toLowerCase();
    for (const [key, val] of Object.entries(STAWKI_OPERACJI)) {
        if (key.toLowerCase() === lower) return val;
        if (lower.startsWith(key.toLowerCase()) || key.toLowerCase().startsWith(lower)) return val;
    }
    return null;
}

function buildKkwCostEstimateModel({ kkwId, operationsBy }) {
    return {
        ID: Number(kkwId),
        IloscOperacjiWg: operationsBy === "Rbh" ? "Rbh" : "Mh",
    };
}

function buildKkwMaterialsModel({ kkwId, kkwIds, pageSize }) {
    const normalizedKkwIds = [
        ...(Array.isArray(kkwIds) ? kkwIds : [kkwId]),
    ]
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);

    return {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : 200,
        },
        KKWID: normalizedKkwIds,
        ZwracanePola: [
            "ID",
            "KKWID",
            "Typ",
            "SkladnikID",
            "OperacjaNazwa",
            "OperacjaLp",
            "SkladnikKod",
            "SkladnikNazwa",
            "JednostkaSkrot",
            "MagazynKod",
            "KKWNumer",
            "IloscPlanowana",
            "IloscZWykonania",
            "IloscPrzeniesiona",
            "CenaKalkulacyjna",
        ],
    };
}

function buildKkwLaborModel({ kkwId, pageSize }) {
    return {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : 200,
        },
        KKWID: [Number(kkwId)],
        ZwracanePola: [
            "ID",
            "KKWID",
            "KKWNumer",
            "OperacjaNazwa",
            "OperacjaLp",
            "PracownikImie",
            "PracownikNazwisko",
            "PracownikLogin",
            "DataRozpoczecia",
            "DataZakonczenia",
            "Rbh",
        ],
    };
}

function buildKkwDocumentPositionsModel({ kkwId, pageSize }) {
    return {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : 200,
        },
        KKWID: [Number(kkwId)],
        ZwracanePola: [
            "ID",
            "KKWID",
            "KKWNumer",
            "DokumentID",
            "DokumentNumer",
            "Typ",
            "SkladnikKod",
            "SkladnikNazwa",
            "MagazynKod",
            "Ilosc",
            "PartiaID",
        ],
    };
}

function buildKkwPreTechInPostModel({ kkwId, useCalcPrices }) {
    const model = {
        KKWID: [Number(kkwId)],
    };

    if (useCalcPrices) {
        model.InWgCenyKalkulacyjnej = true;
    }

    return model;
}

function buildCzasozliczarkaListModel({ operatorName, pageSize }) {
    const model = {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : 50,
        },
        TylkoAktualne: true,
        ZwracanePola: [
            "ID",
            "PracownikID",
            "PracownikImieNazwisko",
            "DataCzasRozpoczecia",
            "DataCzasZakonczenia",
            "IloscRBH",
            "StartStop",
            "AktualnieWykonywana",
            "ZlecenieID",
            "ZlecenieNumer",
            "ZlecenieOpis",
            "ObiektPowiazanyID",
            "ObiektPowiazanyDataType",
            "ObiektPowiazanyNumer",
            "ObiektPowiazanyOpis",
            "ObiektPowiazanyKlientKod",
            "ObiektPowiazanyKlientNazwa",
            "Temat",
            "Opis",
        ],
    };

    if (operatorName && operatorName.trim()) {
        model.FiltrUniwersalny = operatorName.trim();
        model.FiltrUniwersalnyPola = ["PracownikImieNazwisko"];
    }

    return model;
}

function buildKkwOperationsModel({ kkwId, pageSize }) {
    return {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : 100,
        },
        KKWID: [Number(kkwId)],
        ZwracanePola: [
            "ID",
            "KKWID",
            "KKWNumer",
            "Nazwa",
            "Lp",
            "Wydajnosc",
            "Tpz",
            "CzasProdukcji",
            "IloscPlanowanaDobrych",
            "IloscZarejestrowanaDobrych",
            "IloscZarejestrowanaBrakowNienaprawialnych",
            "IloscZarejestrowanaBrakowNaprawialnych",
            "IloscZarejestrowanaDoWeryfikacji",
            "DomyslneStanowiskoID",
            "DomyslneStanowiskoKod",
            "DomyslneStanowiskoNazwa",
            "AktualnieWykonywane",
            "RejestracjaPracownikow",
            "RejestracjaStanowisk",
            "RejestracjaRBH",
            "RejestracjaStartStop",
            "RejestracjaTPZ",
            "Stan",
        ],
    };
}

function buildKkwStationsModel({ kkwId, operationId, pageSize }) {
    const model = {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : 100,
        },
        KKWID: [Number(kkwId)],
        ZwracanePola: [
            "ID",
            "KKWID",
            "KKWNumer",
            "OperacjaID",
            "OperacjaNazwa",
            "OperacjaLp",
            "StanowiskoID",
            "StanowiskoKod",
            "StanowiskoNazwa",
            "Tpz",
            "Czas",
            "Wydajnosc",
            "LiczbaPracownikow",
            "ZaangazowaniePracownika",
        ],
    };

    if (Number.isInteger(Number(operationId))) {
        model.OperacjaKKWID = [Number(operationId)];
    }

    return model;
}

function buildKkwExecutionsModel({ ids, kkwId, operationId, pageSize }) {
    const model = {
        Cursor: true,
        CursorCzyZamknac: false,
        Trwajace: true,
        Zakonczone: true,
        Przezbrojenia: true,
        Wykonania: true,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : 200,
        },
        ZwracanePola: [
            "ID",
            "KKWID",
            "KKWNumer",
            "OperacjaID",
            "OperacjaNazwa",
            "OperacjaLp",
            "StanowiskoID",
            "StanowiskoKod",
            "StanowiskoNazwa",
            "DataRozpoczecia",
            "DataZakonczenia",
            "Stan",
            "Rodzaj",
            "Znacznik",
            "SlownikWykonaniaID",
            "SlownikWykonaniaNazwa",
            "IloscZarejestrowanaDobrych",
        ],
    };

    const normalizedKkwId = Number(kkwId);
    if (kkwId !== null && kkwId !== undefined && Number.isInteger(normalizedKkwId) && normalizedKkwId > 0) {
        model.KKWID = [normalizedKkwId];
    }

    if (Array.isArray(ids) && ids.length) {
        model.ID = ids
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0);
    }

    return model;
}

function buildKkwWorkersModel({ ids, executionIds, kkwId, operationId, pageSize }) {
    const model = {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : 200,
        },
        ZwracanePola: [
            "ID",
            "WykonanieKKWID",
            "KKWID",
            "KKWNumer",
            "OperacjaID",
            "OperacjaNazwa",
            "OperacjaLp",
            "PracownikID",
            "PracownikImie",
            "PracownikNazwisko",
            "PracownikLogin",
            "DataRozpoczecia",
            "DataZakonczenia",
            "Rbh",
            "Stan",
        ],
    };

    const normalizedKkwId = Number(kkwId);
    if (kkwId !== null && kkwId !== undefined && Number.isInteger(normalizedKkwId) && normalizedKkwId > 0) {
        model.KKWID = [normalizedKkwId];
    }

    const normalizedOperationId = Number(operationId);
    if (operationId !== null && operationId !== undefined && Number.isInteger(normalizedOperationId) && normalizedOperationId > 0) {
        model.OperacjaKKWID = [normalizedOperationId];
    }

    if (Array.isArray(ids) && ids.length) {
        model.ID = ids
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0);
    }

    if (Array.isArray(executionIds) && executionIds.length) {
        model.WykonanieKKWID = executionIds
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0);
    }

    return model;
}

function isExecutionActive(entry) {
    return Boolean(entry) && (!entry?.DataZakonczenia || normalizeText(entry?.Stan) === "trwajace");
}

function normalizeText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
}

function parseVendoDate(value) {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return Number.isFinite(value.getTime()) ? value : null;
    }

    const raw = String(value).trim();
    if (!raw) {
        return null;
    }

    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(raw)
        ? raw.replace(" ", "T") + (raw.length === 16 ? ":00" : "")
        : raw;
    const parsed = new Date(normalized);

    return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function pickBestOperation(operations, operationName, stationCode) {
    const normalizedOperationName = normalizeText(operationName);
    const normalizedStationCode = normalizeText(stationCode);

    return operations.find((item) => normalizeText(item?.Nazwa) === normalizedOperationName)
        || operations.find((item) => normalizeText(item?.DomyslneStanowiskoKod) === normalizedStationCode && (!normalizedOperationName || normalizeText(item?.Nazwa).includes(normalizedOperationName)))
        || operations.find((item) => normalizedOperationName && normalizeText(item?.Nazwa).includes(normalizedOperationName))
        || operations.find((item) => normalizedStationCode && normalizeText(item?.DomyslneStanowiskoKod) === normalizedStationCode)
        || operations[0]
        || null;
}

function pickBestStation(stations, stationCode, operationName) {
    const normalizedStationCode = normalizeText(stationCode);
    const normalizedOperationName = normalizeText(operationName);

    return stations.find((item) => normalizeText(item?.StanowiskoKod) === normalizedStationCode && (!normalizedOperationName || normalizeText(item?.OperacjaNazwa) === normalizedOperationName))
        || stations.find((item) => normalizeText(item?.StanowiskoKod) === normalizedStationCode)
        || stations.find((item) => normalizedOperationName && normalizeText(item?.OperacjaNazwa) === normalizedOperationName)
        || stations[0]
        || null;
}

function pickBestWorker(workers, operatorName, operationName) {
    const normalizedOperatorName = normalizeText(operatorName);
    const normalizedOperationName = normalizeText(operationName);

    const filtered = workers
        .filter((item) => !item?.DataZakonczenia)
        .sort((left, right) => String(right?.DataRozpoczecia || "").localeCompare(String(left?.DataRozpoczecia || "")));

    return filtered.find((item) => normalizeText(`${item?.PracownikImie || ""} ${item?.PracownikNazwisko || ""}`) === normalizedOperatorName && (!normalizedOperationName || normalizeText(item?.OperacjaNazwa) === normalizedOperationName))
        || filtered.find((item) => normalizedOperatorName && normalizeText(`${item?.PracownikImie || ""} ${item?.PracownikNazwisko || ""}`).includes(normalizedOperatorName))
        || filtered.find((item) => normalizedOperationName && normalizeText(item?.OperacjaNazwa) === normalizedOperationName)
        || filtered[0]
        || null;
}

function pickExecutionRecords(executions, operationName, stationCode) {
    const normalizedOperationName = normalizeText(operationName);
    const normalizedStationCode = normalizeText(stationCode);
    const sorted = (executions || [])
        .slice()
        .sort((left, right) => String(right?.DataRozpoczecia || "").localeCompare(String(left?.DataRozpoczecia || "")));

    const exactMatches = sorted
        .filter((item) => {
            const operationMatches = !normalizedOperationName || normalizeText(item?.OperacjaNazwa) === normalizedOperationName;
            const stationMatches = !normalizedStationCode || normalizeText(item?.StanowiskoKod) === normalizedStationCode;
            return operationMatches && stationMatches;
        });

    if (exactMatches.length) {
        return exactMatches;
    }

    const operationOnlyMatches = sorted.filter((item) => !normalizedOperationName || normalizeText(item?.OperacjaNazwa) === normalizedOperationName);
    if (operationOnlyMatches.length) {
        return operationOnlyMatches;
    }

    const stationOnlyMatches = sorted.filter((item) => !normalizedStationCode || normalizeText(item?.StanowiskoKod) === normalizedStationCode);
    if (stationOnlyMatches.length) {
        return stationOnlyMatches;
    }

    return sorted;
}

function pickBestWorklog(entries, operatorName) {
    const normalizedOperatorName = normalizeText(operatorName);

    return entries
        .filter((item) => item?.AktualnieWykonywana)
        .sort((left, right) => String(right?.DataCzasRozpoczecia || "").localeCompare(String(left?.DataCzasRozpoczecia || "")))
        .find((item) => normalizedOperatorName && normalizeText(item?.PracownikImieNazwisko) === normalizedOperatorName)
        || entries
            .filter((item) => item?.AktualnieWykonywana)
            .sort((left, right) => String(right?.DataCzasRozpoczecia || "").localeCompare(String(left?.DataCzasRozpoczecia || "")))[0]
        || null;
}

function resolveWorklogPhase(entry, operationName) {
    const phaseHint = normalizeText([
        entry?.ObiektPowiazanyOpis,
        entry?.Temat,
        entry?.Opis,
        operationName,
    ].filter(Boolean).join(" "));

    if (phaseHint.includes("tpz") || phaseHint.includes("przyrz")) {
        return "prep";
    }

    if (phaseHint.includes("produkc") || phaseHint.includes("montaz") || phaseHint.includes("wykon")) {
        return "production";
    }

    return "unknown";
}

function calculateWorklogDurationHours(entry, now = new Date()) {
    const startedAt = parseVendoDate(entry?.DataCzasRozpoczecia);
    const endedAt = parseVendoDate(entry?.DataCzasZakonczenia) || now;

    if (!startedAt || !Number.isFinite(startedAt.getTime()) || !endedAt || !Number.isFinite(endedAt.getTime())) {
        return null;
    }

    return Math.max((endedAt.getTime() - startedAt.getTime()) / 36e5, 0);
}

function pickRelatedWorklogs(entries, { operatorName, kkwNumber, operationName }) {
    const normalizedOperatorName = normalizeText(operatorName);
    const normalizedKkwNumber = normalizeText(kkwNumber);
    const normalizedOperationName = normalizeText(operationName);

    return entries
        .filter((item) => {
            const operatorMatches = !normalizedOperatorName || normalizeText(item?.PracownikImieNazwisko) === normalizedOperatorName;
            const kkwMatches = !normalizedKkwNumber
                || normalizeText(item?.ObiektPowiazanyNumer) === normalizedKkwNumber
                || normalizeText(item?.Temat).includes(normalizedKkwNumber)
                || normalizeText(item?.Opis).includes(normalizedKkwNumber);
            const operationMatches = !normalizedOperationName
                || normalizeText(item?.ObiektPowiazanyOpis).includes(normalizedOperationName)
                || normalizeText(item?.Temat).includes(normalizedOperationName)
                || normalizeText(item?.Opis).includes(normalizedOperationName);

            return operatorMatches && (kkwMatches || operationMatches);
        })
        .sort((left, right) => String(right?.DataCzasRozpoczecia || "").localeCompare(String(left?.DataCzasRozpoczecia || "")));
}

function resolveActivePhase({ operation, worker, worklog, executionRecords, elapsedHours, plannedPrepHours, plannedWorkHours }) {
    const activeExecution = (executionRecords || []).find((item) => !item?.DataZakonczenia)
        || (executionRecords || [])[0]
        || null;
    const executionKind = normalizeText(activeExecution?.Rodzaj);

    if (executionKind === "przezbrojenie") {
        return {
            key: "prep",
            label: "Przyrzad",
            source: "Rodzaj wykonania KKW",
        };
    }

    if (executionKind === "wykonanie") {
        return {
            key: "production",
            label: "Produkcja",
            source: "Rodzaj wykonania KKW",
        };
    }

    const phaseHint = normalizeText([
        worklog?.ObiektPowiazanyOpis,
        worklog?.Temat,
        worklog?.Opis,
        worker?.Stan,
        operation?.Stan,
    ].filter(Boolean).join(" "));

    if (phaseHint.includes("tpz") || phaseHint.includes("przyrz")) {
        return {
            key: "prep",
            label: "Przyrzad",
            source: "Opis aktywnej pracy",
        };
    }

    if (phaseHint.includes("produkc") || phaseHint.includes("montaz") || phaseHint.includes("wykon")) {
        return {
            key: "production",
            label: "Produkcja",
            source: "Opis aktywnej pracy",
        };
    }

    if (plannedPrepHours > 0 && elapsedHours !== null && elapsedHours < plannedPrepHours) {
        return {
            key: "prep",
            label: "Przyrzad",
            source: "Heurystyka czasu vs TPZ",
        };
    }

    if (plannedWorkHours > 0 || elapsedHours !== null) {
        return {
            key: "production",
            label: "Produkcja",
            source: plannedPrepHours > 0 ? "Heurystyka po TPZ" : "Domyslny etap operacji",
        };
    }

    return {
        key: "unknown",
        label: "Nieustalone",
        source: "Brak danych",
    };
}

function buildProductionDashboardMetrics({ kkwRecord, operation, station, worker, worklog, worklogEntries, executionRecords }) {
    const activeExecution = (executionRecords || []).find((item) => isExecutionActive(item))
        || (executionRecords || [])[0]
        || null;
    const startedAtRaw = worker?.DataRozpoczecia || activeExecution?.DataRozpoczecia || worklog?.DataCzasRozpoczecia || null;
    const startedAt = parseVendoDate(startedAtRaw);
    const now = new Date();
    const elapsedHours = startedAt && Number.isFinite(startedAt.getTime())
        ? Math.max((now.getTime() - startedAt.getTime()) / 36e5, 0)
        : null;

    const plannedQuantity = Number(
        operation?.IloscPlanowanaDobrych
        ?? kkwRecord?.IloscOczekiwana
        ?? 0
    ) || 0;
    const completedQuantity = Number(
        operation?.IloscZarejestrowanaDobrych
        ?? kkwRecord?.IloscWykonana
        ?? 0
    ) || 0;
    const expectedRate = Number(
        station?.Wydajnosc
        ?? operation?.Wydajnosc
        ?? 0
    ) || 0;
    const rawPlannedPrepMinutes = Number(operation?.Tpz ?? station?.Tpz ?? 0) || 0;
    const rawPlannedWorkValue = Number(station?.Czas ?? operation?.CzasProdukcji ?? 0) || 0;
    const plannedPrepHours = rawPlannedPrepMinutes > 0 ? rawPlannedPrepMinutes / 60 : 0;
    const actualRate = elapsedHours && elapsedHours > 0
        ? completedQuantity / elapsedHours
        : 0;
    const remainingQuantity = Math.max(plannedQuantity - completedQuantity, 0);
    const expectedDurationHours = expectedRate > 0 && plannedQuantity > 0
        ? plannedQuantity / expectedRate
        : null;
    const remainingExpectedDurationHours = expectedRate > 0 && remainingQuantity > 0
        ? remainingQuantity / expectedRate
        : 0;
    const currentExpectedWorkHours = remainingExpectedDurationHours > 0
        ? remainingExpectedDurationHours
        : expectedDurationHours;
    const plannedTotalHours = expectedDurationHours !== null
        ? expectedDurationHours + plannedPrepHours
        : (plannedPrepHours > 0 ? plannedPrepHours : null);
    const prepElapsedHours = elapsedHours !== null
        ? Math.min(elapsedHours, plannedPrepHours)
        : null;
    const productionElapsedHours = elapsedHours !== null
        ? Math.max(elapsedHours - plannedPrepHours, 0)
        : null;
    const prepProgressPercent = plannedPrepHours > 0 && prepElapsedHours !== null
        ? (prepElapsedHours / plannedPrepHours) * 100
        : 0;
    const productionProgressPercent = currentExpectedWorkHours && currentExpectedWorkHours > 0 && productionElapsedHours !== null
        ? (productionElapsedHours / currentExpectedWorkHours) * 100
        : 0;
    const predictedFinishAt = actualRate > 0
        ? new Date(now.getTime() + (remainingQuantity / actualRate) * 36e5)
        : null;
    const progressPercent = plannedQuantity > 0
        ? (completedQuantity / plannedQuantity) * 100
        : 0;
    const efficiencyPercent = expectedRate > 0
        ? (actualRate / expectedRate) * 100
        : 0;
    const timeProgressPercent = plannedTotalHours && plannedTotalHours > 0 && elapsedHours !== null
        ? (elapsedHours / plannedTotalHours) * 100
        : 0;
    const timeRemainingHours = plannedTotalHours !== null && elapsedHours !== null
        ? plannedTotalHours - elapsedHours
        : null;
    const timeDeltaHours = plannedTotalHours !== null && elapsedHours !== null
        ? elapsedHours - plannedTotalHours
        : null;
    const activePhase = resolveActivePhase({
        operation,
        worker,
        worklog,
        executionRecords,
        elapsedHours,
        plannedPrepHours,
        plannedWorkHours: currentExpectedWorkHours,
    });
    const expectedFinishOffsetHours = activePhase?.key === "prep"
        ? plannedPrepHours + remainingExpectedDurationHours
        : remainingExpectedDurationHours;
    const expectedFinishAt = startedAt && expectedRate > 0
        ? new Date(startedAt.getTime() + expectedFinishOffsetHours * 36e5)
        : null;
    const prepExecution = (executionRecords || []).find((entry) => normalizeText(entry?.Rodzaj) === "przezbrojenie") || null;
    const productionExecution = (executionRecords || []).find((entry) => normalizeText(entry?.Rodzaj) === "wykonanie" && !entry?.DataZakonczenia)
        || (executionRecords || []).find((entry) => normalizeText(entry?.Rodzaj) === "wykonanie")
        || null;
    const relatedWorklogs = pickRelatedWorklogs(worklogEntries || [], {
        operatorName: worker ? `${worker?.PracownikImie || ""} ${worker?.PracownikNazwisko || ""}` : null,
        kkwNumber: kkwRecord?.Numer,
        operationName: operation?.Nazwa,
    });
    const prepWorklog = relatedWorklogs.find((entry) => resolveWorklogPhase(entry, operation?.Nazwa) === "prep") || null;
    const productionWorklog = relatedWorklogs.find((entry) => resolveWorklogPhase(entry, operation?.Nazwa) === "production") || null;
    const prepDurationFromExecutions = prepExecution ? calculateWorklogDurationHours({
        DataCzasRozpoczecia: prepExecution?.DataRozpoczecia,
        DataCzasZakonczenia: prepExecution?.DataZakonczenia,
    }, now) : null;
    const productionDurationFromExecutions = productionExecution ? calculateWorklogDurationHours({
        DataCzasRozpoczecia: productionExecution?.DataRozpoczecia,
        DataCzasZakonczenia: productionExecution?.DataZakonczenia,
    }, now) : null;
    const prepDurationFromLogs = prepWorklog ? calculateWorklogDurationHours(prepWorklog, now) : null;
    const productionDurationFromLogs = productionWorklog ? calculateWorklogDurationHours(productionWorklog, now) : null;
    const resolvedPrepElapsedHours = prepDurationFromExecutions !== null
        ? prepDurationFromExecutions
        : prepDurationFromLogs !== null
            ? prepDurationFromLogs
        : prepElapsedHours;
    const resolvedProductionElapsedHours = activePhase?.key === "prep"
        ? 0
        : productionDurationFromExecutions !== null
            ? productionDurationFromExecutions
            : productionDurationFromLogs !== null
                ? productionDurationFromLogs
                : productionElapsedHours;
    const resolvedPrepProgressPercent = plannedPrepHours > 0 && resolvedPrepElapsedHours !== null
        ? (resolvedPrepElapsedHours / plannedPrepHours) * 100
        : prepProgressPercent;
    const resolvedProductionProgressPercent = activePhase?.key === "prep"
        ? 0
        : currentExpectedWorkHours && currentExpectedWorkHours > 0 && resolvedProductionElapsedHours !== null
            ? (resolvedProductionElapsedHours / currentExpectedWorkHours) * 100
            : productionProgressPercent;

    let status = "Brak danych";
    let statusTone = "idle";
    if (plannedTotalHours && plannedTotalHours > 0 && elapsedHours !== null) {
        if (timeProgressPercent <= 95) {
            status = "W normie czasowej";
            statusTone = "success";
        } else if (timeProgressPercent <= 105) {
            status = "Blisko limitu czasu";
            statusTone = "loading";
        } else {
            status = "Po czasie";
            statusTone = "error";
        }
    }
    if (expectedRate > 0 && actualRate > 0) {
        if (efficiencyPercent >= 105) {
            status = "Powyzej normy";
            statusTone = "success";
        } else if (efficiencyPercent >= 85) {
            status = "W normie";
            statusTone = "loading";
        } else {
            status = "Ryzyko opoznienia";
            statusTone = "error";
        }
    }

    return {
        startedAt: startedAt ? startedAt.toISOString() : null,
        elapsedHours,
        plannedQuantity,
        completedQuantity,
        remainingQuantity,
        expectedRate,
        actualRate,
        expectedDurationHours,
        remainingExpectedDurationHours,
        currentExpectedWorkHours,
        expectedFinishAt: expectedFinishAt ? expectedFinishAt.toISOString() : null,
        predictedFinishAt: predictedFinishAt ? predictedFinishAt.toISOString() : null,
        progressPercent,
        efficiencyPercent,
        status,
        statusTone,
        plannedPrepMinutes: rawPlannedPrepMinutes,
        plannedWorkHours: currentExpectedWorkHours,
        plannedTotalHours,
        prepElapsedHours: resolvedPrepElapsedHours,
        productionElapsedHours: resolvedProductionElapsedHours,
        prepProgressPercent: resolvedPrepProgressPercent,
        productionProgressPercent: resolvedProductionProgressPercent,
        timeProgressPercent,
        timeRemainingHours,
        timeDeltaHours,
        rawPlannedWorkValue,
        activePhase,
        executionKinds: (executionRecords || []).map((entry) => entry?.Rodzaj).filter(Boolean),
    };
}

function buildProductionOrderCostModel({ orderId }) {
    return {
        ZlecenieId: [Number(orderId)],
    };
}

function buildLogisticUnitsModel({ dateFrom, dateTo, pageSize }) {
    const model = {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : 200,
        },
        ZwracanePola: [
            "JednostkaLogistycznaID",
            "Numer",
            "MiejsceMagazynoweID",
            "KodMiejscaMagazynowego",
            "PelnyNumerMiejscaMagazynowego",
            "MagazynID",
            "Zawartosc",
        ],
    };

    if (dateFrom) {
        model.DataOd = `${dateFrom}T00:00:00`;
    }

    if (dateTo) {
        model.DataDo = `${dateTo}T23:59:59`;
    }

    return model;
}

function buildVendoDictionariesModel() {
    return {
        ZwracanePola: ["MiejscaMagazynowe"],
    };
}

function buildBatchStatesModel({ productCode, pageSize }) {
    const model = {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : 100,
        },
        ZwracanePola: [
            "PartiaId",
            "TowarKod",
            "TowarNazwa",
            "DokumentId",
            "DokumentNumer",
            "MagazynKod",
            "MiejsceId",
            "Ilosc",
            "IloscDostepna",
            "IloscPozostala",
            "StanHandlowy",
            "NumerObcy",
            "RuchyId",
            "StanId",
            "TowarId",
        ],
    };

    if (productCode && productCode.trim()) {
        model.FiltrUniwersalny = productCode.trim();
        model.FiltrUniwersalnyPola = ["TowarKod"];
    }

    return model;
}

function buildHistoricalPartiesModel({ productCode, pageSize }) {
    return {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : 100,
        },
        Towar: {
            Kod: productCode.trim(),
        },
        PokazNieuzywane: true,
        PokazStanyZerowe: true,
        UkryjNieUzywane: false,
        ZwracanePola: [
            "ID",
            "Towar",
            "Stan",
            "StanHandlowy",
            "PierwszyDokumentID",
            "PierwszyDokumentNumer",
            "OstatniDokumentID",
            "OstatniDokumentNumer",
            "NumerSeryjny",
        ],
    };
}

async function getZapotrzebowanieSourceData(rodzajFilter) {
    const config = getZapotrzebowanieConfig();
    const mirroredAccessPath = await ensureLocalMirrorFile(config.accessBackendPath);
    const cacheKey = JSON.stringify({
        accessBackendPath: mirroredAccessPath,
        wmsSqlServer: config.wmsSqlServer,
        wmsSqlDatabase: config.wmsSqlDatabase,
        wmsSqlUser: config.wmsSqlUser,
        rodzajFilter,
    });

    const cached = getCacheEntry(zapotrzebowanieSourceCache, cacheKey, 15 * 60 * 1000);
    if (cached) {
        return cached;
    }

    const result = await runPowerShellJsonScript(
        ZAPOTRZEBOWANIE_SOURCE_SCRIPT_PATH,
        {
            AccessPath: mirroredAccessPath,
            SqlServer: config.wmsSqlServer,
            SqlDatabase: config.wmsSqlDatabase,
            SqlUser: config.wmsSqlUser,
            SqlPassword: config.wmsSqlPassword,
            RodzajFilter: rodzajFilter,
        },
        {
            timeoutMs: 5 * 60 * 1000,
        }
    );

    return setCacheEntry(zapotrzebowanieSourceCache, cacheKey, result);
}

function buildWmsInventoryCacheKey(config, code) {
    return [
        config.wmsSqlServer,
        config.wmsSqlDatabase,
        config.wmsSqlUser,
        String(code || "").trim(),
    ].join("::").toLowerCase();
}

async function getWmsInventoryForCodes(codes) {
    const normalizedCodes = [...new Set((codes || [])
        .map((item) => String(item || "").trim())
        .filter(Boolean))];

    if (!normalizedCodes.length) {
        return new Map();
    }

    const config = getZapotrzebowanieConfig();
    const inventoryByCode = new Map();
    const missingCodes = [];

    for (const code of normalizedCodes) {
        const cacheKey = buildWmsInventoryCacheKey(config, code);
        const cached = getCacheEntry(wmsInventoryCache, cacheKey, 10 * 60 * 1000);
        if (cached) {
            inventoryByCode.set(code, cached);
            continue;
        }

        missingCodes.push(code);
    }

    if (missingCodes.length) {
        const result = await runPowerShellJsonScript(
            ZAPOTRZEBOWANIE_WMS_SCRIPT_PATH,
            {
                SqlServer: config.wmsSqlServer,
                SqlDatabase: config.wmsSqlDatabase,
                SqlUser: config.wmsSqlUser,
                SqlPassword: config.wmsSqlPassword,
                Codes: missingCodes.join("|"),
            },
            {
                timeoutMs: 2 * 60 * 1000,
            }
        );

        const rows = Array.isArray(result?.rows) ? result.rows : [];
        const returnedByCode = new Map(
            rows.map((item) => [
                String(item?.code || "").trim(),
                {
                    code: String(item?.code || "").trim(),
                    wmsStock: Number(item?.wmsStock) || 0,
                },
            ])
        );

        for (const code of missingCodes) {
            const value = returnedByCode.get(code) || {
                code,
                wmsStock: 0,
            };
            setCacheEntry(wmsInventoryCache, buildWmsInventoryCacheKey(config, code), value);
            inventoryByCode.set(code, value);
        }
    }

    return inventoryByCode;
}

async function getZapotrzebowanieDetailData(componentCode, rodzajFilter) {
    const config = getZapotrzebowanieConfig();
    const mirroredAccessPath = await ensureLocalMirrorFile(config.accessBackendPath);
    const cacheKey = JSON.stringify({
        accessBackendPath: mirroredAccessPath,
        componentCode: String(componentCode || "").trim(),
        rodzajFilter,
    });

    const cached = getCacheEntry(zapotrzebowanieDetailCache, cacheKey, 15 * 60 * 1000);
    if (cached) {
        return cached;
    }

    const result = await runPowerShellJsonScript(
        ZAPOTRZEBOWANIE_DETAIL_SCRIPT_PATH,
        {
            AccessPath: mirroredAccessPath,
            ComponentCode: componentCode,
            Rodzaj: rodzajFilter,
        },
        {
            timeoutMs: 5 * 60 * 1000,
        }
    );

    return setCacheEntry(zapotrzebowanieDetailCache, cacheKey, result);
}

function normalizePositiveIntegerValue(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return null;
    }

    const normalized = Math.trunc(numeric);
    return normalized > 0 ? normalized : null;
}

function summarizeReportPcsPerPanelTargets(targets) {
    const normalizedTargets = Array.isArray(targets)
        ? targets.filter((target) => String(target?.productCode || "").trim())
        : [];

    if (!normalizedTargets.length) {
        return {
            pcsPerPanel: null,
            pcsPerPanelSource: null,
            pcsPerPanelUpdatedAt: null,
            pcsPerPanelUpdatedBy: null,
            pcsPerPanelMode: "none",
            pcsPerPanelProductCode: null,
            pcsPerPanelProductName: null,
            pcsPerPanelTargetCount: 0,
        };
    }

    if (normalizedTargets.length === 1) {
        const target = normalizedTargets[0];
        return {
            pcsPerPanel: normalizePositiveIntegerValue(target?.pcsPerPanel),
            pcsPerPanelSource: target?.source || null,
            pcsPerPanelUpdatedAt: target?.updatedAt || null,
            pcsPerPanelUpdatedBy: target?.updatedBy || null,
            pcsPerPanelMode: "single",
            pcsPerPanelProductCode: target?.productCode || null,
            pcsPerPanelProductName: target?.productName || null,
            pcsPerPanelTargetCount: 1,
        };
    }

    const distinctValues = [...new Set(normalizedTargets
        .map((target) => normalizePositiveIntegerValue(target?.pcsPerPanel))
        .filter(Boolean))];

    if (distinctValues.length === 1) {
        return {
            pcsPerPanel: distinctValues[0],
            pcsPerPanelSource: "multiple_consistent",
            pcsPerPanelUpdatedAt: null,
            pcsPerPanelUpdatedBy: null,
            pcsPerPanelMode: "multiple",
            pcsPerPanelProductCode: null,
            pcsPerPanelProductName: null,
            pcsPerPanelTargetCount: normalizedTargets.length,
        };
    }

    return {
        pcsPerPanel: null,
        pcsPerPanelSource: "multiple_products",
        pcsPerPanelUpdatedAt: null,
        pcsPerPanelUpdatedBy: null,
        pcsPerPanelMode: "multiple",
        pcsPerPanelProductCode: null,
        pcsPerPanelProductName: null,
        pcsPerPanelTargetCount: normalizedTargets.length,
    };
}

async function getReportPcsPerPanelContextByComponent({
    sourceRows,
    rodzajFilter,
    mesDbPath,
}) {
    const sourceComponentNameByCode = new Map((sourceRows || [])
        .filter((row) => String(row?.rodzaj || "").trim().toUpperCase() === "PCB")
        .map((row) => [
            String(row?.code || "").trim().toUpperCase(),
            String(row?.component || "").trim(),
        ]));
    const pcbCodes = [...new Set((sourceRows || [])
        .filter((row) => String(row?.rodzaj || "").trim().toUpperCase() === "PCB")
        .map((row) => String(row?.code || "").trim().toUpperCase())
        .filter(Boolean))];

    if (!pcbCodes.length) {
        return new Map();
    }

    const entries = await mapWithConcurrency(pcbCodes, 4, async (componentCode) => {
        try {
            const componentNameHint = sourceComponentNameByCode.get(componentCode) || "";
            const detailPayload = await getZapotrzebowanieDetailData(componentCode, rodzajFilter);
            const detailRows = Array.isArray(detailPayload?.rows) ? detailPayload.rows : [];
            const targetsByProductCode = new Map();

            detailRows.forEach((detailRow) => {
                const productCode = String(detailRow?.productIndex || "").trim();
                if (!productCode) {
                    return;
                }

                const normalizedProductCode = productCode.toUpperCase();
                const currentTarget = targetsByProductCode.get(normalizedProductCode) || {
                    productCode,
                    productName: String(detailRow?.productName || "").trim(),
                    requiredQty: 0,
                    orderQty: 0,
                    headerCount: 0,
                };

                currentTarget.requiredQty += Number(detailRow?.requiredQty) || 0;
                currentTarget.orderQty += Number(detailRow?.orderQty) || 0;
                currentTarget.headerCount += 1;
                if (!currentTarget.productName) {
                    currentTarget.productName = String(detailRow?.productName || "").trim();
                }

                targetsByProductCode.set(normalizedProductCode, currentTarget);
            });

            const targets = [...targetsByProductCode.values()]
                .map((target) => {
                    const pcsPerPanelSetting = resolveProductPcsPerPanel(mesDbPath, {
                        productCode: target.productCode,
                        productName: target.productName,
                        fallbackText: componentNameHint,
                    });

                    return {
                        ...target,
                        pcsPerPanel: pcsPerPanelSetting?.pcsPerPanel ?? null,
                        source: pcsPerPanelSetting?.source || null,
                        updatedAt: pcsPerPanelSetting?.updatedAt || null,
                        updatedBy: pcsPerPanelSetting?.updatedBy || null,
                    };
                })
                .sort((left, right) => {
                    const requiredDelta = (Number(right?.requiredQty) || 0) - (Number(left?.requiredQty) || 0);
                    if (requiredDelta !== 0) {
                        return requiredDelta;
                    }

                    return String(left?.productCode || "").localeCompare(String(right?.productCode || ""), "pl", {
                        numeric: true,
                        sensitivity: "base",
                    });
                });

            return [componentCode, {
                targets,
                ...summarizeReportPcsPerPanelTargets(targets),
            }];
        } catch {
            return [componentCode, {
                targets: [],
                ...summarizeReportPcsPerPanelTargets([]),
            }];
        }
    });

    return new Map(entries);
}

async function exportZapotrzebowanieAccessSnapshot(accessPath) {
    return runPowerShellJsonScript(
        ZAPOTRZEBOWANIE_ACCESS_EXPORT_SCRIPT_PATH,
        {
            AccessPath: accessPath,
        },
        {
            timeoutMs: 5 * 60 * 1000,
            maxBuffer: 64 * 1024 * 1024,
        }
    );
}

async function handleApiZapotrzebowanieStorageMeta(req, res) {
    try {
        const storageConfig = getZapotrzebowanieStorageConfig();
        sendJson(res, 200, {
            storage: getZapotrzebowanieStorageMeta(storageConfig.dbPath),
            meta: {
                generatedAt: new Date().toISOString(),
            },
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie odczytac metadanych SQLite.",
        });
    }
}

async function handleApiMesOvenPulse(req, res) {
    try {
        const body = await readJsonBody(req);
        const storageConfig = getMesStorageConfig();
        const pulse = insertOvenPulse(storageConfig.dbPath, body);

        console.log("MES oven pulse:", pulse);
        sendJson(res, 200, {
            status: "ok",
            pulse,
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie zapisac impulsu MES.",
        });
    }
}

async function handleApiMesOvenSummary(req, res) {
    try {
        const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        const deviceId = requestUrl.searchParams.get("device_id") || requestUrl.searchParams.get("deviceId") || "reflow_1";
        const storageConfig = getMesStorageConfig();
        let summary = getOvenSummary(storageConfig.dbPath, { deviceId });
        let plannedQuantityLookup = null;

        if (summary.activeBatch && (!summary.activeBatch.plannedQuantity || !summary.activeBatch.productName)) {
            try {
                plannedQuantityLookup = await resolveMesPlannedQuantityFromVendo(summary.activeBatch.kkwNumber);
                if (plannedQuantityLookup?.plannedQuantity || plannedQuantityLookup?.kkw?.productName) {
                    const updatedBatch = updateOvenBatchDetails(storageConfig.dbPath, {
                        batchId: summary.activeBatch.id,
                        plannedQuantity: plannedQuantityLookup.plannedQuantity,
                        orderNumber: plannedQuantityLookup.kkw?.orderNumber,
                        productCode: plannedQuantityLookup.kkw?.productCode,
                        productName: plannedQuantityLookup.kkw?.productName,
                    });
                    summary = {
                        ...summary,
                        activeBatch: updatedBatch || summary.activeBatch,
                    };
                }
            } catch (error) {
                plannedQuantityLookup = {
                    plannedQuantity: null,
                    warning: error.message || "Nie udalo sie pobrac planowanej ilosci z Vendo.",
                };
            }
        }

        sendJson(res, 200, {
            storage: getMesStorageMeta(storageConfig.dbPath),
            summary,
            plannedQuantityLookup,
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie odczytac podsumowania MES.",
        });
    }
}

async function handleApiMesOvenEvents(req, res) {
    try {
        const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        const deviceId = requestUrl.searchParams.get("device_id") || requestUrl.searchParams.get("deviceId") || "";
        const batchId = requestUrl.searchParams.get("batch_id") || requestUrl.searchParams.get("batchId") || "";
        const scope = requestUrl.searchParams.get("scope") || requestUrl.searchParams.get("view") || "raw";
        const rawUnassigned = requestUrl.searchParams.get("unassigned") || requestUrl.searchParams.get("unassigned_only") || "";
        const unassigned = ["1", "true", "yes", "on"].includes(String(rawUnassigned).trim().toLowerCase());
        const limit = requestUrl.searchParams.get("limit") || 50;
        const storageConfig = getMesStorageConfig();

        sendJson(res, 200, {
            storage: getMesStorageMeta(storageConfig.dbPath),
            events: listOvenPulses(storageConfig.dbPath, { deviceId, batchId, unassigned, limit, scope }),
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie odczytac impulsow MES.",
        });
    }
}

function normalizeMesKkwLookupNumber(value) {
    const raw = String(value || "").trim();
    if (!raw) {
        return "";
    }

    if (raw.includes("|")) {
        const parts = raw.split("|").map((part) => part.trim()).filter(Boolean);
        const kkwPart = parts.find((part) => /^\d+\/\d+$/.test(part));
        return normalizeKkwNumber(kkwPart || parts[parts.length - 1] || raw);
    }

    return normalizeKkwNumber(raw.replace(/^KKW[:\s-]*/i, ""));
}

function pickMesKkwPlannedQuantity(record) {
    const candidates = [
        record?.IloscOczekiwana,
        record?.IloscPlanowana,
        record?.Ilosc,
        record?.IloscNaKKW,
    ];

    for (const candidate of candidates) {
        const quantity = getPositiveNumber(candidate);
        if (quantity > 0) {
            return quantity;
        }
    }

    return null;
}

async function resolveMesPlannedQuantityFromVendo(kkwNumber) {
    const normalizedKkwNumber = normalizeMesKkwLookupNumber(kkwNumber);
    if (!normalizedKkwNumber) {
        return {
            plannedQuantity: null,
            warning: "Brakuje numeru KKW do pobrania planowanej ilosci z Vendo.",
        };
    }

    const missing = requireServerConfig();
    const serverConfig = getServerConfig();
    if (!serverConfig.vendoUserLogin) {
        missing.push("VENDO_USER_LOGIN");
    }
    if (!serverConfig.vendoUserPassword) {
        missing.push("VENDO_USER_PASSWORD");
    }
    if (missing.length) {
        return {
            plannedQuantity: null,
            warning: `Brakuje konfiguracji Vendo dla MES: ${missing.join(", ")}.`,
        };
    }

    const connection = {
        baseUrl: serverConfig.apiUrl,
        apiLogin: serverConfig.apiLogin,
        apiPassword: serverConfig.apiPassword,
        vendoUserLogin: serverConfig.vendoUserLogin,
        vendoUserPassword: serverConfig.vendoUserPassword,
    };
    const accessToken = await getAccessToken(connection);
    const records = await resolveKkwRecordsByNumbers(connection, accessToken, [normalizedKkwNumber], { allowMissing: true });
    const record = records[0] || null;

    if (!record) {
        return {
            plannedQuantity: null,
            warning: `Nie znaleziono KKW ${normalizedKkwNumber} w Vendo.`,
        };
    }

    const plannedQuantity = pickMesKkwPlannedQuantity(record);
    const kkw = {
        id: record?.ID || null,
        number: record?.Numer || normalizedKkwNumber,
        orderNumber: record?.ZlecenieNumer || null,
        productCode: record?.TowarKod || null,
        productName: record?.TowarNazwa || record?.PozycjaZleceniaNazwa || null,
    };

    if (!plannedQuantity) {
        return {
            plannedQuantity: null,
            kkw,
            warning: `KKW ${kkw.number} nie ma uzupelnionej ilosci oczekiwanej w Vendo.`,
        };
    }

    return {
        plannedQuantity,
        source: "vendo-kkw",
        kkw,
    };
}

async function handleApiMesOvenBatchStart(req, res) {
    try {
        const body = await readJsonBody(req);
        const storageConfig = getMesStorageConfig();
        const rawPlannedQuantity = body.planned_quantity || body.plannedQuantity || null;
        const rawPcsPerPanel = body.pcs_per_panel ?? body.pcsPerPanel ?? null;
        let plannedQuantity = rawPlannedQuantity;
        let plannedQuantityLookup = null;

        if (!plannedQuantity) {
            try {
                plannedQuantityLookup = await resolveMesPlannedQuantityFromVendo(body.kkw_number || body.kkwNumber || body.scan || "");
                plannedQuantity = plannedQuantityLookup.plannedQuantity;
            } catch (error) {
                plannedQuantityLookup = {
                    plannedQuantity: null,
                    warning: error.message || "Nie udalo sie pobrac planowanej ilosci z Vendo.",
                };
            }
        }

        const result = startOvenBatch(storageConfig.dbPath, {
            deviceId: body.device_id || body.deviceId || "reflow_1",
            kkwNumber: body.kkw_number || body.kkwNumber || body.scan || "",
            boardSide: body.board_side || body.boardSide || body.side || "",
            plannedQuantity,
            orderNumber: plannedQuantityLookup?.kkw?.orderNumber,
            productCode: plannedQuantityLookup?.kkw?.productCode,
            productName: plannedQuantityLookup?.kkw?.productName,
            pcsPerPanel: rawPcsPerPanel,
            pcsPerPanelSource: rawPcsPerPanel ? body.pcs_per_panel_source || body.pcsPerPanelSource || body.source || "operator" : "",
            operator: body.operator || body.operatorName || "",
            source: body.source || "scan",
        });

        sendJson(res, 200, {
            status: "ok",
            plannedQuantityLookup,
            ...result,
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie rozpoczac partii MES.",
        });
    }
}

async function handleApiMesOvenBatchEnd(req, res) {
    try {
        const body = await readJsonBody(req);
        const storageConfig = getMesStorageConfig();
        const result = endOvenBatch(storageConfig.dbPath, {
            deviceId: body.device_id || body.deviceId || "reflow_1",
            operator: body.operator || body.operatorName || "",
        });

        sendJson(res, 200, {
            status: "ok",
            ...result,
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie zakonczyc partii MES.",
        });
    }
}

async function handleApiMesOvenBatchActive(req, res) {
    try {
        const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        const deviceId = requestUrl.searchParams.get("device_id") || requestUrl.searchParams.get("deviceId") || "reflow_1";
        const storageConfig = getMesStorageConfig();

        sendJson(res, 200, {
            batch: getActiveOvenBatch(storageConfig.dbPath, {
                deviceId,
                currentSessionOnly: true,
            }),
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie odczytac aktywnej partii MES.",
        });
    }
}

async function handleApiMesOvenBatchPcsPerPanel(req, res) {
    try {
        const body = await readJsonBody(req);
        const storageConfig = getMesStorageConfig();
        const rawSaveForProduct = body.save_for_product ?? body.saveForProduct;
        const saveForProduct = rawSaveForProduct === undefined
            ? true
            : !["false", "0", "no", "off"].includes(String(rawSaveForProduct).trim().toLowerCase());
        const result = upsertOvenBatchPcsPerPanel(storageConfig.dbPath, {
            batchId: body.batch_id || body.batchId || null,
            deviceId: body.device_id || body.deviceId || "reflow_1",
            pcsPerPanel: body.pcs_per_panel ?? body.pcsPerPanel ?? null,
            operator: body.operator || body.operatorName || "",
            source: body.source || "operator_panel",
            saveForProduct,
        });

        sendJson(res, 200, {
            status: "ok",
            ...result,
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie zapisac PCB na panel.",
        });
    }
}

async function handleApiMesOvenBatchUpdate(req, res) {
    try {
        const body = await readJsonBody(req);
        const storageConfig = getMesStorageConfig();
        const rawSaveForProduct = body.save_for_product ?? body.saveForProduct;
        const rawApplyToRelated = body.apply_to_related ?? body.applyToRelated ?? body.scope === "kkw";
        const saveForProduct = rawSaveForProduct === undefined
            ? true
            : !["false", "0", "no", "off"].includes(String(rawSaveForProduct).trim().toLowerCase());
        const applyToRelated = rawApplyToRelated === undefined
            ? false
            : ["1", "true", "yes", "on"].includes(String(rawApplyToRelated).trim().toLowerCase());

        let batch = updateOvenBatchDetails(storageConfig.dbPath, {
            batchId: body.batch_id || body.batchId || null,
            kkwNumber: body.kkw_number || body.kkwNumber || "",
            boardSide: body.board_side || body.boardSide || body.side || "",
            plannedQuantity: body.planned_quantity ?? body.plannedQuantity ?? null,
            orderNumber: body.order_number || body.orderNumber || "",
            productCode: body.product_code || body.productCode || "",
            productName: body.product_name || body.productName || "",
            pcsPerPanel: body.pcs_per_panel ?? body.pcsPerPanel ?? null,
            pcsPerPanelSource: body.pcs_per_panel ? (body.pcs_per_panel_source || body.pcsPerPanelSource || "admin_panel") : "",
            applyToRelated,
        });

        let pcsPerPanelSave = null;
        if (body.pcs_per_panel ?? body.pcsPerPanel) {
            pcsPerPanelSave = upsertOvenBatchPcsPerPanel(storageConfig.dbPath, {
                batchId: batch?.id,
                deviceId: batch?.deviceId || body.device_id || body.deviceId || "reflow_1",
                pcsPerPanel: body.pcs_per_panel ?? body.pcsPerPanel ?? null,
                operator: body.operator || body.operatorName || "",
                source: body.source || "admin_panel",
                saveForProduct,
                applyToRelated,
            });
            batch = pcsPerPanelSave.batch || batch;
        }

        sendJson(res, 200, {
            status: "ok",
            batch,
            savedForProduct: pcsPerPanelSave?.savedForProduct || false,
            productSetting: pcsPerPanelSave?.productSetting || null,
            warning: pcsPerPanelSave?.warning || null,
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie zapisac zmian partii MES.",
        });
    }
}

async function handleApiMesOvenBatchDelete(req, res) {
    try {
        const body = await readJsonBody(req);
        const storageConfig = getMesStorageConfig();
        const rawDeletePulses = body.delete_pulses ?? body.deletePulses;
        const deletePulses = rawDeletePulses === undefined
            ? false
            : ["1", "true", "yes", "on"].includes(String(rawDeletePulses).trim().toLowerCase());
        const result = deleteOvenBatch(storageConfig.dbPath, {
            batchId: body.batch_id || body.batchId || null,
            deletePulses,
            scope: body.scope === "entry" ? "entry" : "kkw",
        });

        sendJson(res, 200, {
            status: "ok",
            ...result,
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie usunac partii MES.",
        });
    }
}

async function handleApiMesOvenEventsDelete(req, res) {
    try {
        const body = await readJsonBody(req);
        const storageConfig = getMesStorageConfig();
        const result = deleteOvenPulses(storageConfig.dbPath, {
            pulseIds: body.pulse_ids || body.pulseIds || body.ids || [],
        });

        sendJson(res, 200, {
            status: "ok",
            ...result,
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie usunac impulsow MES.",
        });
    }
}

async function handleApiMesOvenEventsAssign(req, res) {
    try {
        const body = await readJsonBody(req);
        const storageConfig = getMesStorageConfig();
        const rawSuggested = body.suggested_unassigned ?? body.suggestedUnassigned ?? body.useSuggestedWindow;
        const rawForceReassign = body.force_reassign ?? body.forceReassign ?? body.reassign;
        const suggestedUnassigned = rawSuggested === undefined
            ? false
            : ["1", "true", "yes", "on"].includes(String(rawSuggested).trim().toLowerCase());
        const forceReassign = rawForceReassign === undefined
            ? false
            : ["1", "true", "yes", "on"].includes(String(rawForceReassign).trim().toLowerCase());
        const result = assignOvenPulsesToBatch(storageConfig.dbPath, {
            batchId: body.batch_id || body.batchId || null,
            pulseIds: body.pulse_ids || body.pulseIds || body.ids || [],
            suggestedUnassigned,
            maxLookbackMinutes: body.max_lookback_minutes || body.maxLookbackMinutes || 30,
            forceReassign,
        });
        const suggestion = getBatchUnassignedSuggestion(storageConfig.dbPath, {
            batchId: body.batch_id || body.batchId || null,
            deviceId: body.device_id || body.deviceId || "reflow_1",
            limit: 1000,
        });

        sendJson(res, 200, {
            status: "ok",
            ...result,
            pendingAssignment: suggestion,
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie przypisac impulsow MES.",
        });
    }
}

async function handleApiMesOvenTransitsReset(req, res) {
    try {
        const body = await readJsonBody(req);
        const storageConfig = getMesStorageConfig();
        const result = resetOpenOvenTransits(storageConfig.dbPath, {
            deviceId: body.device_id || body.deviceId || "reflow_1",
            operator: body.operator || body.operatorName || "",
            reason: body.reason || body.resetReason || "manual_reset",
        });

        sendJson(res, 200, {
            status: "ok",
            ...result,
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie zresetowac otwartych przejsc pieca.",
        });
    }
}

async function handleApiMesOvenBatchHistory(req, res) {
    try {
        const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        const deviceId = requestUrl.searchParams.get("device_id") || requestUrl.searchParams.get("deviceId") || "";
        const kkwNumber = requestUrl.searchParams.get("kkw_number") || requestUrl.searchParams.get("kkwNumber") || requestUrl.searchParams.get("kkw") || "";
        const limit = requestUrl.searchParams.get("limit") || 20;
        const storageConfig = getMesStorageConfig();

        sendJson(res, 200, {
            batches: listOvenBatches(storageConfig.dbPath, { deviceId, kkwNumber, limit }),
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie odczytac historii partii MES.",
        });
    }
}

async function handleApiZapotrzebowanieStorageImport(req, res) {
    try {
        const body = await readJsonBody(req);
        const storageConfig = getZapotrzebowanieStorageConfig();
        const configuredAccessPath = String(
            body?.accessPath
            || getZapotrzebowanieConfig().accessBackendPath
            || ""
        ).trim();

        if (!configuredAccessPath) {
            return sendJson(res, 500, {
                error: "Brakuje konfiguracji serwera: ACCESS_BACKEND_PATH.",
            });
        }

        const mirroredAccessPath = await ensureLocalMirrorFile(configuredAccessPath);
        const snapshot = await exportZapotrzebowanieAccessSnapshot(mirroredAccessPath);
        const imported = importAccessSnapshot({
            dbPath: storageConfig.dbPath,
            snapshot,
        });

        sendJson(res, 200, {
            imported,
            storage: getZapotrzebowanieStorageMeta(storageConfig.dbPath),
            meta: {
                generatedAt: new Date().toISOString(),
                requestedAccessPath: configuredAccessPath,
                mirroredAccessPath,
            },
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie zaimportowac danych Access do SQLite.",
        });
    }
}

async function handleApiZapotrzebowanieOperationalOverview(req, res) {
    try {
        const storageConfig = getZapotrzebowanieStorageConfig();
        sendJson(res, 200, {
            ...getZapotrzebowanieOperationalOverview(storageConfig.dbPath),
            meta: {
                generatedAt: new Date().toISOString(),
                view: "operations",
            },
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie pobrac dashboardu operacyjnego.",
        });
    }
}

async function handleApiZapotrzebowanieVendoOverview(req, res) {
    try {
        const body = await readJsonBody(req);
        const missing = requireServerConfig();
        if (missing.length) {
            return sendJson(res, 500, {
                error: `Brakuje konfiguracji Vendo: ${[...new Set(missing)].join(", ")}.`,
            });
        }

        const vendoUserLogin = String(body?.vendoUserLogin || "").trim();
        const vendoUserPassword = String(body?.vendoUserPassword || "");
        if (!vendoUserLogin) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserLogin." });
        }
        if (!vendoUserPassword.trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserPassword." });
        }

        const pageSize = Math.min(Math.max(Number(body?.pageSize) || 100, 10), 200);
        const maxPages = Math.min(Math.max(Number(body?.maxPages) || 10, 1), 10);
          const includeClosed = body?.includeClosed === true;
          const includeNoScope = body?.includeNoScope !== false;
          const materialOwnershipFilter = normalizeMaterialOwnershipFilter(body?.materialOwnershipFilter);
          const forceRefresh = body?.forceRefresh === true;
          const serverConfig = getServerConfig();
          const connection = {
              baseUrl: serverConfig.apiUrl,
              apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin,
            vendoUserPassword,
        };
        const accessToken = await getAccessToken(connection);
          const overviewContext = await getVendoOperationalHeadersContext({
              connection,
              accessToken,
              search: body?.search,
              pageSize,
              maxPages,
              includeClosed,
              includeNoScope,
              materialOwnershipFilter,
              forceRefresh,
          });
          const warnings = [...new Set((overviewContext.warnings || []).filter(Boolean))];
          const headers = await computeVendoOperationalHeaderSummaries({
              connection,
              accessToken,
              overviewContext,
              includeVendo: body?.includeVendo !== false,
              warnings,
              forceRefresh,
          });

          sendJson(res, 200, {
              storage: {
                  dbPath: getZapotrzebowanieStorageConfig().dbPath,
                  mode: "notes-cache",
            },
            summary: buildVendoOverviewSummary(headers, { generatedAt: overviewContext.generatedAt }),
            headers,
              meta: {
                  generatedAt: overviewContext.generatedAt,
                  view: "operations",
                  source: "vendo",
                  summaryMode: "precomputed",
                  fetchedPositions: overviewContext.fetchedPositions,
                  returnedHeaders: overviewContext.returnedHeaders,
                  includeClosed: overviewContext.includeClosed,
                  includeNoScope: overviewContext.includeNoScope,
                  materialOwnershipFilter: overviewContext.materialOwnershipFilter,
                  pageSize: overviewContext.pageSize,
                  maxPages: overviewContext.maxPages,
                  warnings: [...new Set(warnings.filter(Boolean))],
              },
          });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie pobrac dashboardu z Vendo.",
        });
    }
}

async function handleApiZapotrzebowanieHeaderDetails(req, res) {
    try {
        const body = await readJsonBody(req);
        const headerId = Number(body?.headerId);

        if (!Number.isFinite(headerId) || headerId <= 0) {
            return sendJson(res, 400, {
                error: "Brakuje poprawnego pola: headerId.",
            });
        }

        const storageConfig = getZapotrzebowanieStorageConfig();
        const payload = getZapotrzebowanieHeaderDetails(storageConfig.dbPath, headerId);
        if (!payload) {
            return sendJson(res, 404, {
                error: "Nie znaleziono wybranego naglowka w SQLite.",
            });
        }

        const codes = [...new Set((payload?.bomItems || [])
            .map((item) => String(item?.componentCode || "").trim())
            .filter(Boolean))];
        const warnings = [];
        let wmsInventoryByCode = new Map();
        let vendoInventoryByCode = new Map();

        const wmsMissing = requireWmsSqlConfig();
        if (wmsMissing.length) {
            warnings.push(`Brakuje konfiguracji WMS: ${[...new Set(wmsMissing)].join(", ")}.`);
        } else if (codes.length) {
            wmsInventoryByCode = await getWmsInventoryForCodes(codes);
        }

        const serverMissing = requireServerConfig();
        const vendoUserLogin = String(body?.vendoUserLogin || "").trim();
        const vendoUserPassword = String(body?.vendoUserPassword || "");
        const includeVendo = body?.includeVendo !== false;

        if (includeVendo && codes.length) {
            if (serverMissing.length) {
                warnings.push(`Brakuje konfiguracji Vendo: ${[...new Set(serverMissing)].join(", ")}.`);
            } else if (!vendoUserLogin || !vendoUserPassword.trim()) {
                warnings.push("Brakuje zapisanego loginu lub hasla Vendo. Pokazuje stan tylko z WMS.");
            } else {
                const connection = {
                    baseUrl: getServerConfig().apiUrl,
                    apiLogin: getServerConfig().apiLogin,
                    apiPassword: getServerConfig().apiPassword,
                    vendoUserLogin,
                    vendoUserPassword,
                };
                const accessToken = await getAccessToken(connection);
                vendoInventoryByCode = await fetchVendoInventoryMap(connection, accessToken, codes, {
                    includeExpected: false,
                    concurrency: 8,
                    warnings,
                });
            }
        }

        const availableByCode = new Map();
        const bomItems = (payload?.bomItems || []).map((item) => {
            const code = String(item?.componentCode || "").trim();
            const wmsStock = Number(wmsInventoryByCode.get(code)?.wmsStock) || 0;
            const vendoStock = Number(vendoInventoryByCode.get(code)?.vendoStock) || 0;
            const vendoExpected = Number(vendoInventoryByCode.get(code)?.vendoExpected) || 0;
            const requiredQty = Number(item?.requiredQty) || 0;
            const availableBefore = availableByCode.has(code)
                ? (Number(availableByCode.get(code)) || 0)
                : (wmsStock + vendoStock);
            const toOrder = Math.max(requiredQty - Math.max(availableBefore, 0), 0);
            const availableAfter = availableBefore - requiredQty;

            availableByCode.set(code, availableAfter);

            return {
                ...item,
                wmsStock,
                vendoStock,
                vendoExpected,
                availableBefore,
                availableAfter,
                toOrder,
            };
        });

        const summary = bomItems.reduce((result, item) => {
            result.totalBomItems += 1;
            result.requiredQty += Number(item?.requiredQty) || 0;
            if (item?.isOpen) {
                result.openBomItems += 1;
            }
            if ((Number(item?.toOrder) || 0) > 0) {
                result.shortageBomItems += 1;
                result.shortageQty += Number(item?.toOrder) || 0;
            }
            if (String(item?.typeName || "").trim().toUpperCase() === "PCB") {
                result.pcbItems += 1;
            }
            if (String(item?.typeName || "").trim().toUpperCase() === "SMD") {
                result.smdItems += 1;
            }
            if (String(item?.typeName || "").trim().toUpperCase() === "THT") {
                result.thtItems += 1;
            }
            return result;
        }, {
            totalBomItems: 0,
            openBomItems: 0,
            shortageBomItems: 0,
            shortageQty: 0,
            requiredQty: 0,
            pcbItems: 0,
            smdItems: 0,
            thtItems: 0,
        });

        sendJson(res, 200, {
            ...payload,
            summary,
            bomItems,
            meta: {
                generatedAt: new Date().toISOString(),
                view: "operations-detail",
                inventoryMode: "live-wms-vendo-stock",
                warnings: [...new Set(warnings.filter(Boolean))],
            },
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie pobrac pozycji naglowka.",
        });
    }
}

async function handleApiZapotrzebowanieVendoHeaderDetails(req, res) {
    try {
        const body = await readJsonBody(req);
        const planPositionId = Number(body?.planPositionId || body?.positionId || body?.zlpPositionId);

        if (!Number.isInteger(planPositionId) || planPositionId <= 0) {
            return sendJson(res, 400, {
                error: "Brakuje poprawnego pola: planPositionId.",
            });
        }

        const missing = requireServerConfig();
        if (missing.length) {
            return sendJson(res, 500, {
                error: `Brakuje konfiguracji Vendo: ${[...new Set(missing)].join(", ")}.`,
            });
        }

        const vendoUserLogin = String(body?.vendoUserLogin || "").trim();
        const vendoUserPassword = String(body?.vendoUserPassword || "");
        if (!vendoUserLogin) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserLogin." });
        }
        if (!vendoUserPassword.trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserPassword." });
        }

        const serverConfig = getServerConfig();
        const connection = {
            baseUrl: serverConfig.apiUrl,
            apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin,
            vendoUserPassword,
        };
        const accessToken = await getAccessToken(connection);
        const warnings = [];

        const positionResponse = await vendoPost(connection.baseUrl, "/Produkcja/ZleceniePlanistyczne/PozycjeLista", {
            Token: accessToken,
            Model: buildVendoPlanPositionModel({ planPositionId }),
        });
        const position = getVendoRecords(positionResponse)
            .find((item) => Number(item?.ID) === planPositionId) || null;

        if (!position) {
            return sendJson(res, 404, {
                error: `Nie znaleziono pozycji ZLP ID ${planPositionId} w Vendo.`,
            });
        }

        const planningOrderId = Number(position?.ZlecenieID) || null;
        let planningOrder = null;
        if (planningOrderId) {
            const orderResponse = await vendoPost(connection.baseUrl, "/Produkcja/ZleceniePlanistyczne/Lista", {
                Token: accessToken,
                Model: buildVendoPlanningOrderModel({ orderId: planningOrderId }),
            });
            planningOrder = getVendoRecords(orderResponse)
                .find((item) => Number(item?.ID) === planningOrderId) || null;
        }

        const planPositionStatusesBundle = await resolveVendoStatuses(connection, accessToken, {
            dataType: "PlanZlecenia",
            objectIds: [planPositionId],
            pageSize: 20,
            maxPages: 10,
            warnings,
            warningLabel: `pozycji ZLP ${planPositionId}`,
        });
        const currentPlanPositionStatusesBundle = await resolveVendoStatuses(connection, accessToken, {
            dataType: "PlanZlecenia",
            objectIds: [planPositionId],
            pageSize: 20,
            maxPages: 10,
            onlyCurrent: true,
            warnings,
            warningLabel: `aktywnych statusow pozycji ZLP ${planPositionId}`,
        });
        let statusDictionary = [...(planPositionStatusesBundle.dictionary || [])];
        let objectStatuses = [...(planPositionStatusesBundle.records || [])];
        let currentObjectStatuses = [...(currentPlanPositionStatusesBundle.records || [])];

        const kkwRecords = await fetchAllCursorRecords(
            connection,
            accessToken,
            "/Produkcja/KKW/Lista",
            buildKkwByPlanPositionModel({ planPositionId, pageSize: 50 }),
            { pageSize: 50, maxPages: 10 }
        );

        const kkwIds = kkwRecords
            .map((item) => Number(item?.ID))
            .filter((value) => Number.isInteger(value) && value > 0);
        if (kkwIds.length) {
            const kkwStatusesBundle = await resolveVendoStatuses(connection, accessToken, {
                dataType: "KKW",
                objectIds: kkwIds,
                pageSize: Math.max(kkwIds.length * 4, 20),
                maxPages: 10,
                warnings,
                warningLabel: `KKW pozycji ZLP ${planPositionId}`,
            });
            const currentKkwStatusesBundle = await resolveVendoStatuses(connection, accessToken, {
                dataType: "KKW",
                objectIds: kkwIds,
                pageSize: Math.max(kkwIds.length * 4, 20),
                maxPages: 10,
                onlyCurrent: true,
                warnings,
                warningLabel: `aktywnych statusow KKW pozycji ZLP ${planPositionId}`,
            });
            if (Array.isArray(kkwStatusesBundle.dictionary) && kkwStatusesBundle.dictionary.length) {
                statusDictionary = [...statusDictionary, ...kkwStatusesBundle.dictionary];
            }
            if (Array.isArray(kkwStatusesBundle.records) && kkwStatusesBundle.records.length) {
                objectStatuses = [...objectStatuses, ...kkwStatusesBundle.records];
            }
            if (Array.isArray(currentKkwStatusesBundle.records) && currentKkwStatusesBundle.records.length) {
                currentObjectStatuses = [...currentObjectStatuses, ...currentKkwStatusesBundle.records];
            }
        }

        let bomSource = null;
        let materialRows = [];
        if (kkwRecords.length) {
            const kkwNumberById = new Map(
                kkwRecords
                    .filter((item) => Number.isInteger(Number(item?.ID)))
                    .map((item) => [Number(item.ID), String(item?.Numer || "").trim() || null])
            );

            const kkwMaterialRows = await fetchKkwMaterialRowsByIds(connection, accessToken, kkwIds, {
                pageSize: 500,
                maxPages: 20,
            });
            materialRows = kkwMaterialRows.map((row) => ({
                ...row,
                KKWID: Number(row?.KKWID) || null,
                KKWNumer: row?.KKWNumer || kkwNumberById.get(Number(row?.KKWID)) || null,
            }));

            const hasKkwConsumptionRows = materialRows.some((row) => normalizeText(row?.Typ) === "rozchod");
            if (hasKkwConsumptionRows) {
                bomSource = {
                    type: "kkw",
                    label: "KKW",
                    kkwIds: kkwRecords.map((item) => Number(item?.ID)).filter((value) => Number.isInteger(value) && value > 0),
                    kkwNumbers: kkwRecords.map((item) => String(item?.Numer || "").trim()).filter(Boolean),
                };
            } else if (materialRows.length) {
                warnings.push("KKW nie ma pozycji rozchodowych w materialowce, pobieram BOM z technologii.");
                materialRows = [];
            }
        }

        let technology = null;
        if (!materialRows.length) {
            technology = await resolveTechnologyForPosition(connection, accessToken, position);

            if (!technology) {
                return sendJson(res, 404, {
                    error: `Nie znaleziono technologii dla pozycji ZLP ${planPositionId} (${String(position?.Kod || "").trim()}).`,
                    meta: {
                        generatedAt: new Date().toISOString(),
                        warnings,
                    },
                });
            }

            materialRows = await fetchAllCursorRecords(
                connection,
                accessToken,
                "/Produkcja/Technologie/MaterialowkaLista",
                buildTechnologyMaterialsModel({ technologyIds: [technology.ID], pageSize: 500 }),
                { pageSize: 500, maxPages: 20 }
            );
            bomSource = {
                type: "technology",
                label: "Technologia",
                technologyId: Number(technology?.ID) || null,
                technologyCode: String(technology?.Kod || "").trim() || null,
                technologyName: String(technology?.Nazwa || "").trim() || null,
            };
        }

        const orderQty = getPositiveNumber(position?.Ilosc);
        const statusScope = getVendoStatusScope(objectStatuses, statusDictionary);
        const currentStatusScope = getVendoStatusScope(currentObjectStatuses, statusDictionary);
        const stage = getVendoStageFromScope(
            statusScope,
            isVendoPlanPositionHardClosed(position, planningOrder)
        );
        const normalizedBomItems = normalizeVendoBomItems(materialRows, {
            sourceType: bomSource?.type || "unknown",
            orderQty,
        });
        const rawBomItems = filterBomItemsByVendoScope(normalizedBomItems, statusScope);
        let bomItems = await enrichBomItemsWithLiveInventory({
            bomItems: rawBomItems,
            connection,
            accessToken,
            includeVendo: body?.includeVendo !== false,
            includeZw: true,
            warnings,
        });
        const storageConfig = getZapotrzebowanieStorageConfig();
        const productCode = String(position?.Kod || "").trim() || null;
        const noteMap = getBomNotesForPlanPosition(storageConfig.dbPath, planPositionId);
        const accessNoteMap = getAccessBomNotesForLiveHeader(storageConfig.dbPath, {
            planPositionId,
            productIndex: productCode,
            kkwNumber: bomSource?.type === "kkw" ? (bomSource.kkwNumbers || []).join(", ") : null,
            termDate: position?.DataRealizacji || planningOrder?.DataTerminZakonczenia || null,
        });
        bomItems = bomItems.map((item) => {
            const savedNote = noteMap.get(buildBomNoteKey(item?.sourceType, item?.sourceMaterialId));
            const accessNote = accessNoteMap.get(String(item?.componentCode || "").trim().toUpperCase()) || "";
            return {
                ...item,
                accessNote: accessNote || null,
                note: savedNote ? savedNote.note || "" : (accessNote || item?.note || ""),
                noteSource: savedNote ? "sqlite" : (accessNote ? "access" : null),
                noteUpdatedAt: savedNote?.updatedAt || null,
            };
        });
        try {
            const totalDemandByCode = await getVendoOperationalDemandTotals({
                connection,
                accessToken,
                materialOwnershipFilter: body?.materialOwnershipFilter || "MSX_OR_EMPTY",
                pageSize: 100,
                maxPages: 2,
                warnings,
            });
            bomItems = bomItems.map((item) => {
                const code = String(item?.componentCode || "").trim();
                return {
                    ...item,
                    totalDemandQty: code ? (Number(totalDemandByCode.get(code)) || 0) : null,
                };
            });
        } catch (error) {
            warnings.push(`Nie udalo sie policzyc totali BOM: ${error.message}`);
            bomItems = bomItems.map((item) => ({
                ...item,
                totalDemandQty: null,
            }));
        }
        const summary = buildVendoBomSummary(bomItems, {
            totalBomItems: normalizedBomItems.length,
            openBomItems: rawBomItems.length,
        });
        const selectedStatusNames = objectStatuses
            .map((item) => String(item?.Nazwa || item?.StatusNazwa || item?.Status || "").trim())
            .filter(Boolean);
        const vendoNote = getPlanningPositionNote(position);
        const operationalNote = statusScope.hasDemandScope ? "" : "SMD/THT wykluczone z zapotrzebowania";
        const headerNotes = [vendoNote, operationalNote].filter(Boolean).join(" | ") || null;

        sendJson(res, 200, {
            header: {
                source: "vendo-zlp-position",
                id: planPositionId,
                planPositionId,
                planningOrderId,
                orderNumber: String(planningOrder?.ZlecenieNumer || "").trim() || null,
                planningSeries: String(planningOrder?.Seria || "").trim() || null,
                kkwNumber: bomSource?.type === "kkw" ? (bomSource.kkwNumbers || []).join(", ") || null : null,
                foreignNumber: getForeignNumberFromRecord(position) || getForeignNumberFromRecord(planningOrder),
                productId: Number(position?.TowarID) || null,
                productIndex: productCode,
                productCode,
                productName: String(position?.Nazwa || "").trim() || null,
                clientName: String(planningOrder?.Klient1Nazwa || "").trim() || null,
                notes: headerNotes,
                materialOwnership: resolveMaterialOwnershipFromRecord(position) || null,
                materialOwnershipLabel: resolveMaterialOwnershipFromRecord(position) || "PUSTE",
                stageKey: stage.key,
                stageLabel: stage.label,
                statusFlags: {
                    smd: statusScope.excludeSmd,
                    tht: statusScope.excludeTht,
                    excludeSmd: statusScope.excludeSmd,
                    excludeTht: statusScope.excludeTht,
                    includeSmd: statusScope.includeSmd,
                    includeTht: statusScope.includeTht,
                    app: statusScope.hasApp,
                    draft: currentStatusScope.hasDraft,
                },
                isDraft: currentStatusScope.hasDraft,
                orderQty,
                quantityOnKkw: getPositiveNumber(position?.IloscNaKKW),
                quantityDone: getPositiveNumber(position?.IloscWykonana),
                realizationState: String(position?.StanRealizacji || "").trim() || null,
                orderRealizationState: String(planningOrder?.StanRealizacji || "").trim() || null,
                termDate: position?.DataRealizacji || planningOrder?.DataTerminZakonczenia || null,
                createdAt: planningOrder?.DataUtworzenia || null,
                structureProductId: Number(position?.StrukturaProduktuID) || null,
                hasKkw: Boolean(kkwRecords.length),
                isClosed: isVendoPlanPositionHardClosed(position, planningOrder),
            },
            statuses: {
                dataType: "PlanZlecenia",
                dictionary: statusDictionary,
                selected: objectStatuses,
                selectedNames: statusScope.names.length ? statusScope.names : selectedStatusNames,
                scope: statusScope,
            },
            bomSource,
            kkw: {
                records: kkwRecords,
            },
            technology,
            summary,
            bomItems,
            meta: {
                generatedAt: new Date().toISOString(),
                view: "vendo-zlp-pilot",
                warnings: [...new Set(warnings.filter(Boolean))],
                materialRows: materialRows.length,
            },
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie pobrac pilota naglowka z Vendo.",
        });
    }
}

async function handleApiZapotrzebowanieVendoComponentDetails(req, res) {
    try {
        const body = await readJsonBody(req);
        const componentCode = String(body?.code || body?.componentCode || "").trim();

        if (!componentCode) {
            return sendJson(res, 400, {
                error: "Brakuje pola: code.",
            });
        }

        const missing = requireServerConfig();
        if (missing.length) {
            return sendJson(res, 500, {
                error: `Brakuje konfiguracji Vendo: ${[...new Set(missing)].join(", ")}.`,
            });
        }

        const vendoUserLogin = String(body?.vendoUserLogin || "").trim();
        const vendoUserPassword = String(body?.vendoUserPassword || "");
        if (!vendoUserLogin) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserLogin." });
        }
        if (!vendoUserPassword.trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserPassword." });
        }

        const serverConfig = getServerConfig();
        const connection = {
            baseUrl: serverConfig.apiUrl,
            apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin,
            vendoUserPassword,
        };
        const accessToken = await getAccessToken(connection);
        const warnings = [];
        const materialOwnershipFilter = body?.materialOwnershipFilter || "MSX_OR_EMPTY";
        const payload = await getVendoOperationalComponentDetails({
            connection,
            accessToken,
            componentCode,
            materialOwnershipFilter,
            pageSize: 100,
            maxPages: 2,
            includeVendo: body?.includeVendo !== false,
            warnings,
            forceRefresh: body?.forceRefresh === true,
        });

        sendJson(res, 200, {
            ...payload,
            meta: {
                generatedAt: new Date().toISOString(),
                view: "operations-component-detail",
                source: "vendo",
                materialOwnershipFilter: normalizeMaterialOwnershipFilter(materialOwnershipFilter),
                warnings: [...new Set([...(payload?.warnings || []), ...warnings].filter(Boolean))],
            },
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie pobrac szczegolow komponentu z panelu operacyjnego.",
        });
    }
}

async function handleApiZapotrzebowanieVendoZwDetails(req, res) {
    try {
        const body = await readJsonBody(req);
        const componentCode = String(body?.code || body?.componentCode || "").trim();

        if (!componentCode) {
            return sendJson(res, 400, {
                error: "Brakuje pola: code.",
            });
        }

        const missing = requireServerConfig();
        if (missing.length) {
            return sendJson(res, 500, {
                error: `Brakuje konfiguracji Vendo: ${[...new Set(missing)].join(", ")}.`,
            });
        }

        const vendoUserLogin = String(body?.vendoUserLogin || "").trim();
        const vendoUserPassword = String(body?.vendoUserPassword || "");
        if (!vendoUserLogin) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserLogin." });
        }
        if (!vendoUserPassword.trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserPassword." });
        }

        const serverConfig = getServerConfig();
        const connection = {
            baseUrl: serverConfig.apiUrl,
            apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin,
            vendoUserPassword,
        };
        const accessToken = await getAccessToken(connection);
        const warnings = [];
        const payload = await getVendoZwDetailsForComponent({
            connection,
            accessToken,
            componentCode,
            warnings,
            forceRefresh: body?.forceRefresh === true,
        });

        sendJson(res, 200, {
            ...payload,
            meta: {
                generatedAt: new Date().toISOString(),
                view: "operations-zw-detail",
                source: "vendo",
                warnings: [...new Set([...(payload?.warnings || []), ...warnings].filter(Boolean))],
            },
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie pobrac szczegolow ZW.",
        });
    }
}

async function handleApiZapotrzebowanieVendoZwDocumentDetails(req, res) {
    try {
        const body = await readJsonBody(req);
        const documentId = Number(body?.documentId);

        if (!Number.isInteger(documentId) || documentId <= 0) {
            return sendJson(res, 400, {
                error: "Brakuje pola: documentId.",
            });
        }

        const missing = requireServerConfig();
        if (missing.length) {
            return sendJson(res, 500, {
                error: `Brakuje konfiguracji Vendo: ${[...new Set(missing)].join(", ")}.`,
            });
        }

        const vendoUserLogin = String(body?.vendoUserLogin || "").trim();
        const vendoUserPassword = String(body?.vendoUserPassword || "");
        if (!vendoUserLogin) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserLogin." });
        }
        if (!vendoUserPassword.trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserPassword." });
        }

        const serverConfig = getServerConfig();
        const connection = {
            baseUrl: serverConfig.apiUrl,
            apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin,
            vendoUserPassword,
        };
        const accessToken = await getAccessToken(connection);
        const warnings = [];
        const payload = await getVendoZwDocumentDetails({
            connection,
            accessToken,
            documentId,
            warnings,
            forceRefresh: body?.forceRefresh === true,
        });

        sendJson(res, 200, {
            ...payload,
            meta: {
                generatedAt: new Date().toISOString(),
                view: "operations-zw-document-detail",
                source: "vendo",
                warnings: [...new Set([...(payload?.warnings || []), ...warnings].filter(Boolean))],
            },
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie pobrac pozycji dokumentu ZW.",
        });
    }
}

async function handleApiZapotrzebowanieVendoBomNote(req, res) {
    try {
        const body = await readJsonBody(req);
        const storageConfig = getZapotrzebowanieStorageConfig();
        const note = upsertBomNote({
            dbPath: storageConfig.dbPath,
            planPositionId: body?.planPositionId,
            sourceType: body?.sourceType,
            sourceMaterialId: body?.sourceMaterialId,
            componentCode: body?.componentCode,
            note: body?.note,
            changedBy: String(body?.changedBy || body?.vendoUserLogin || "").trim() || null,
        });

        sendJson(res, 200, {
            note,
            meta: {
                generatedAt: new Date().toISOString(),
                storage: storageConfig.dbPath,
            },
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie zapisac uwagi zakupowca.",
        });
    }
}

async function handleApiZapotrzebowanieReportNote(req, res) {
    try {
        const body = await readJsonBody(req);
        const storageConfig = getZapotrzebowanieStorageConfig();
        const note = upsertReportNote({
            dbPath: storageConfig.dbPath,
            code: body?.code,
            rodzaj: body?.rodzaj,
            note: body?.note,
            changedBy: String(body?.changedBy || body?.vendoUserLogin || "").trim() || null,
        });

        sendJson(res, 200, {
            note,
            meta: {
                generatedAt: new Date().toISOString(),
                storage: storageConfig.dbPath,
            },
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie zapisac uwagi raportu zakupowego.",
        });
    }
}

async function handleApiZapotrzebowanieReportPcsPerPanel(req, res) {
    try {
        const body = await readJsonBody(req);
        const storageConfig = getMesStorageConfig();
        const normalizedProductCodes = [...new Set([
            body?.productCode,
            ...(Array.isArray(body?.productCodes) ? body.productCodes : []),
        ].map((item) => String(item || "").trim()).filter(Boolean))];

        if (!normalizedProductCodes.length) {
            return sendJson(res, 400, {
                error: "Brakuje productCode albo productCodes dla zapisu PCB/panel.",
            });
        }

        const settings = normalizedProductCodes.map((productCode) => upsertProductPcsPerPanel(storageConfig.dbPath, {
            productCode,
            pcsPerPanel: body?.pcsPerPanel,
            changedBy: String(body?.changedBy || body?.vendoUserLogin || "").trim() || null,
            source: body?.source || "report_panel",
        }));
        const setting = settings[0] || null;

        sendJson(res, 200, {
            setting,
            settings,
            meta: {
                generatedAt: new Date().toISOString(),
                storage: storageConfig.dbPath,
            },
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie zapisac PCB na panel dla raportu zakupowego.",
        });
    }
}

function buildZapotrzebowanieSummary(rows) {
    const orderRows = rows.filter((row) => (Number(row?.toOrder) || 0) < 0);

    return orderRows.reduce((summary, row) => {
        summary.items += 1;
        summary.requiredQty += Number(row?.requiredQty) || 0;
        summary.wmsStock += Number(row?.wmsStock) || 0;
        summary.vendoStock += Number(row?.vendoStock) || 0;
        summary.vendoExpected += Number(row?.vendoExpected) || 0;
        summary.toOrder += Number(row?.toOrder) || 0;
        return summary;
    }, {
        items: 0,
        totalItems: rows.length,
        requiredQty: 0,
        wmsStock: 0,
        vendoStock: 0,
        vendoExpected: 0,
        toOrder: 0,
    });
}

function pickPreferredReportSourceRow(currentRow, candidateRow) {
    const currentComponent = String(currentRow?.component || "").trim();
    const candidateComponent = String(candidateRow?.component || "").trim();
    if (!currentComponent && candidateComponent) {
        return candidateRow;
    }
    if (currentComponent && !candidateComponent) {
        return currentRow;
    }

    const currentRequiredQty = Number(currentRow?.requiredQty) || 0;
    const candidateRequiredQty = Number(candidateRow?.requiredQty) || 0;
    if (candidateRequiredQty !== currentRequiredQty) {
        return candidateRequiredQty > currentRequiredQty ? candidateRow : currentRow;
    }

    if (candidateComponent.length !== currentComponent.length) {
        return candidateComponent.length > currentComponent.length ? candidateRow : currentRow;
    }

    return String(candidateRow?.code || "").localeCompare(String(currentRow?.code || ""), "pl", {
        numeric: true,
        sensitivity: "base",
    }) >= 0 ? candidateRow : currentRow;
}

function collapseZapotrzebowanieSourceRows(rows) {
    const grouped = new Map();

    for (const row of rows || []) {
        const code = String(row?.code || "").trim();
        const rodzaj = String(row?.rodzaj || "").trim();
        const key = `${code.toUpperCase()}::${rodzaj.toUpperCase()}`;
        const current = grouped.get(key);

        if (!current) {
            grouped.set(key, {
                ...row,
                code,
                rodzaj,
                component: String(row?.component || "").trim(),
                requiredQty: Number(row?.requiredQty) || 0,
                wmsStock: Number(row?.wmsStock) || 0,
                status: Number(row?.status) || 0,
            });
            continue;
        }

        const preferredRow = pickPreferredReportSourceRow(current, row);
        current.requiredQty += Number(row?.requiredQty) || 0;
        current.wmsStock = Math.max(Number(current?.wmsStock) || 0, Number(row?.wmsStock) || 0);
        current.status = Math.max(Number(current?.status) || 0, Number(row?.status) || 0);
        current.component = String(preferredRow?.component || "").trim();
    }

    return [...grouped.values()];
}

async function handleApiZapotrzebowanie(req, res) {
    try {
        const body = await readJsonBody(req);
        const rodzajFilter = normalizeZapotrzebowanieRodzaj(body.rodzaj);
        const includeVendo = body.includeVendo !== false;

        const missing = [
            ...requireZapotrzebowanieConfig(),
            ...(includeVendo ? requireServerConfig() : []),
        ];
        if (missing.length) {
            return sendJson(res, 500, {
                error: `Brakuje konfiguracji serwera: ${[...new Set(missing)].join(", ")}.`,
            });
        }

        const sourceData = await getZapotrzebowanieSourceData(rodzajFilter);
        const rawSourceRows = Array.isArray(sourceData?.rows) ? sourceData.rows : [];
        const sourceRows = collapseZapotrzebowanieSourceRows(rawSourceRows);
        const storageConfig = getZapotrzebowanieStorageConfig();
        const reportNotesMap = getReportNotesMap(storageConfig.dbPath);
        const mesStorageConfig = getMesStorageConfig();
        let inventoryByCode = new Map();
        const warnings = [];

        if (includeVendo && sourceRows.length) {
            const serverConfig = getServerConfig();
            const connection = {
                baseUrl: serverConfig.apiUrl,
                apiLogin: serverConfig.apiLogin,
                apiPassword: serverConfig.apiPassword,
                vendoUserLogin: String(body.vendoUserLogin || "").trim(),
                vendoUserPassword: body.vendoUserPassword || "",
            };

            if (!connection.vendoUserLogin) {
                return sendJson(res, 400, { error: "Brakuje pola: vendoUserLogin" });
            }
            if (!String(connection.vendoUserPassword || "").trim()) {
                return sendJson(res, 400, { error: "Brakuje pola: vendoUserPassword" });
            }

            const accessToken = await getAccessToken(connection);
            const codes = [...new Set(sourceRows
                .map((item) => String(item?.code || "").trim())
                .filter(Boolean))];

            inventoryByCode = await fetchVendoInventoryMap(connection, accessToken, codes, {
                includeExpected: true,
                concurrency: 6,
                warnings,
            });
        }

        const sourceRowsForReport = sourceRows.map((item) => {
            const code = String(item?.code || "").trim();
            const inventory = inventoryByCode.get(code) || null;
            const vendoProductName = String(inventory?.productName || "").trim();
            return {
                ...item,
                component: vendoProductName || String(item?.component || "").trim(),
            };
        });

        const reportPcsPerPanelByCode = await getReportPcsPerPanelContextByComponent({
            sourceRows: sourceRowsForReport,
            rodzajFilter,
            mesDbPath: mesStorageConfig.dbPath,
        });

        const rows = sourceRowsForReport
            .map((item) => {
                const code = String(item?.code || "").trim();
                const inventory = inventoryByCode.get(code) || {
                    productName: "",
                    vendoStock: 0,
                    vendoExpected: 0,
                };
                const requiredQty = Number(item?.requiredQty) || 0;
                const wmsStock = Number(item?.wmsStock) || 0;
                const vendoStock = Number(inventory?.vendoStock) || 0;
                const vendoExpected = Number(inventory?.vendoExpected) || 0;
                const toOrder = (wmsStock + vendoStock + vendoExpected) - requiredQty;
                const normalizedRodzaj = String(item?.rodzaj || "").trim();
                const savedNote = reportNotesMap.get(buildReportNoteKey(code, normalizedRodzaj));
                const pcsPerPanelSetting = normalizedRodzaj.toUpperCase() === "PCB"
                    ? (reportPcsPerPanelByCode.get(code.toUpperCase()) || summarizeReportPcsPerPanelTargets([]))
                    : summarizeReportPcsPerPanelTargets([]);
                const vendoProductName = String(inventory?.productName || "").trim();

                return {
                    code,
                    component: vendoProductName || String(item?.component || "").trim(),
                    rodzaj: normalizedRodzaj,
                    status: Number(item?.status) || 0,
                    requiredQty,
                    wmsStock,
                    vendoStock,
                    vendoExpected,
                    toOrder,
                    pcsPerPanel: pcsPerPanelSetting?.pcsPerPanel ?? null,
                    pcsPerPanelSource: pcsPerPanelSetting?.pcsPerPanelSource || null,
                    pcsPerPanelUpdatedAt: pcsPerPanelSetting?.pcsPerPanelUpdatedAt || null,
                    pcsPerPanelUpdatedBy: pcsPerPanelSetting?.pcsPerPanelUpdatedBy || null,
                    pcsPerPanelMode: pcsPerPanelSetting?.pcsPerPanelMode || "none",
                    pcsPerPanelProductCode: pcsPerPanelSetting?.pcsPerPanelProductCode || null,
                    pcsPerPanelProductName: pcsPerPanelSetting?.pcsPerPanelProductName || null,
                    pcsPerPanelTargetCount: Number(pcsPerPanelSetting?.pcsPerPanelTargetCount) || 0,
                    pcsPerPanelTargets: Array.isArray(pcsPerPanelSetting?.targets) ? pcsPerPanelSetting.targets : [],
                    note: savedNote?.note || "",
                    noteUpdatedAt: savedNote?.updatedAt || null,
                };
            })
            .sort((left, right) => {
                const delta = (Number(left?.toOrder) || 0) - (Number(right?.toOrder) || 0);
                if (delta !== 0) {
                    return delta;
                }

                return String(left?.code || "").localeCompare(String(right?.code || ""), "pl");
            });

        sendJson(res, 200, {
            summary: buildZapotrzebowanieSummary(rows),
            rows,
            meta: {
                generatedAt: sourceData?.generatedAt || new Date().toISOString(),
                rodzajFilter,
                includeVendo,
                rawRowCount: rawSourceRows.length,
                groupedRowCount: sourceRows.length,
                warnings,
            },
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie pobrac zapotrzebowania.",
        });
    }
}

async function handleApiZapotrzebowanieDetails(req, res) {
    try {
        const body = await readJsonBody(req);
        const componentCode = String(body.code || "").trim();
        const rodzajFilter = normalizeZapotrzebowanieRodzaj(body.rodzaj);
        const warnings = [];

        if (!componentCode) {
            return sendJson(res, 400, { error: "Brakuje pola: code" });
        }

        const missing = requireZapotrzebowanieConfig();
        if (missing.length) {
            return sendJson(res, 500, {
                error: `Brakuje konfiguracji serwera: ${[...new Set(missing)].join(", ")}.`,
            });
        }

        const detailData = await getZapotrzebowanieDetailData(componentCode, rodzajFilter);
        const sourceRows = Array.isArray(detailData?.rows) ? detailData.rows : [];
        const debug = {
            accessRows: sourceRows.map((item) => ({
                headerId: Number(item?.headerId) || 0,
                planRefId: Number(item?.planRefId) || null,
                kkwNumber: String(item?.kkwNumber || "").trim(),
                productIndex: String(item?.productIndex || "").trim(),
                productName: String(item?.productName || "").trim(),
                requiredQty: Number(item?.requiredQty) || 0,
            })),
        };
        let rows = sourceRows.map((item) => ({
            headerId: Number(item?.headerId) || 0,
            planRefId: Number(item?.planRefId) || null,
            productIndex: String(item?.productIndex || "").trim(),
            productName: String(item?.productName || "").trim(),
            orderQty: Number(item?.orderQty) || 0,
            smdDone: Boolean(item?.smdDone),
            thtDone: Boolean(item?.thtDone),
            termDate: item?.termDate || null,
            clientName: String(item?.clientName || "").trim(),
            kkwNumber: String(item?.kkwNumber || "").trim(),
            component: String(item?.component || "").trim(),
            rodzaj: String(item?.rodzaj || "").trim(),
            requiredQty: Number(item?.requiredQty) || 0,
            planningOrderId: null,
            orderId: null,
            kkwId: null,
            orderNumber: null,
            foreignNumber: null,
            vendoProductCode: null,
            vendoProductName: null,
            kkwTermDate: null,
        }));

        const serverMissing = requireServerConfig();
        const vendoUserLogin = String(body.vendoUserLogin || "").trim();
        const vendoUserPassword = String(body.vendoUserPassword || "");
        const includeVendo = body.includeVendo !== false
            && !serverMissing.length
            && Boolean(vendoUserLogin)
            && Boolean(vendoUserPassword.trim());

        if (includeVendo && rows.length) {
            const serverConfig = getServerConfig();
            const connection = {
                baseUrl: serverConfig.apiUrl,
                apiLogin: serverConfig.apiLogin,
                apiPassword: serverConfig.apiPassword,
                vendoUserLogin,
                vendoUserPassword,
            };

            try {
                const accessToken = await getAccessToken(connection);
                const planRefIds = [...new Set(rows
                    .map((item) => Number(item?.planRefId))
                    .filter((value) => Number.isInteger(value) && value > 0))];

                if (planRefIds.length) {
                    debug.planRefIds = planRefIds;
                    const planningPositionRecords = await resolvePlanningPositionsByIds(connection, accessToken, planRefIds, { allowMissing: true });
                    debug.planningPositionRecords = planningPositionRecords;
                    const planningPositionMap = new Map(
                        planningPositionRecords.map((item) => [Number(item?.ID), item])
                    );
                    debug.missingPlanningPositionIds = planRefIds.filter((id) => !planningPositionMap.has(id));

                    rows = rows.map((item) => {
                        const planningPosition = planningPositionMap.get(Number(item?.planRefId)) || null;
                        return {
                            ...item,
                            planningOrderId: Number(planningPosition?.ZlecenieID) || null,
                            foreignNumber: item?.foreignNumber || getForeignNumberFromRecord(planningPosition),
                        };
                    });

                    const planningOrderIds = new Set(
                        rows
                            .map((item) => Number(item?.planningOrderId))
                            .filter((value) => Number.isInteger(value) && value > 0)
                    );

                    for (const planRefId of planRefIds) {
                        if (!planningPositionMap.has(planRefId)) {
                            planningOrderIds.add(planRefId);
                        }
                    }

                    if (planningOrderIds.size) {
                        const planningOrderRecords = await resolvePlanningOrdersByIds(connection, accessToken, [...planningOrderIds], { allowMissing: true });
                        debug.planningOrderRecords = planningOrderRecords;
                        const planningOrderMap = new Map(
                            planningOrderRecords.map((item) => [Number(item?.ID), item])
                        );
                        debug.missingPlanningOrderIds = [...planningOrderIds].filter((id) => !planningOrderMap.has(id));

                        rows = rows.map((item) => {
                            const planningPosition = planningPositionMap.get(Number(item?.planRefId)) || null;
                            const linkedPlanningOrder = planningOrderMap.get(Number(item?.planningOrderId)) || null;
                            const directPlanningOrder = planningPosition
                                ? null
                                : planningOrderMap.get(Number(item?.planRefId)) || null;
                            const planningOrder = linkedPlanningOrder || directPlanningOrder;

                            if (!planningOrder) {
                                return item;
                            }

                            return {
                                ...item,
                                planningOrderId: Number(planningOrder?.ID) || item?.planningOrderId || null,
                                orderNumber: String(planningOrder?.ZlecenieNumer || item?.orderNumber || "").trim() || null,
                                foreignNumber: item?.foreignNumber || getForeignNumberFromRecord(planningOrder),
                            };
                        });
                    }
                }

                const kkwNumbers = [...new Set(rows
                    .map((item) => normalizeKkwNumber(item?.kkwNumber))
                    .filter(Boolean))];

                if (kkwNumbers.length) {
                    debug.kkwNumbers = kkwNumbers;
                    const kkwRecords = await resolveKkwRecordsByNumbers(connection, accessToken, kkwNumbers, { allowMissing: true });
                    debug.kkwRecords = kkwRecords;
                    const kkwRecordMap = new Map(
                        kkwRecords.map((item) => [normalizeKkwNumber(item?.Numer), item])
                    );
                    debug.missingKkwNumbers = kkwNumbers.filter((number) => !kkwRecordMap.has(number));

                    rows = rows.map((item) => {
                        const kkwRecord = kkwRecordMap.get(normalizeKkwNumber(item.kkwNumber)) || null;
                        return {
                            ...item,
                            planRefId: item?.planRefId || Number(kkwRecord?.PozycjaZleceniaID) || null,
                            orderId: Number(kkwRecord?.ZlecenieID) || item?.orderId || null,
                            kkwId: Number(kkwRecord?.ID) || item?.kkwId || null,
                            orderNumber: String(kkwRecord?.ZlecenieNumer || item?.orderNumber || "").trim() || null,
                            foreignNumber: item?.foreignNumber || getForeignNumberFromRecord(kkwRecord),
                            vendoProductCode: String(kkwRecord?.TowarKod || item?.vendoProductCode || "").trim() || null,
                            vendoProductName: String(
                                kkwRecord?.TowarNazwa
                                || kkwRecord?.PozycjaZleceniaNazwa
                                || item?.vendoProductName
                                || ""
                            ).trim() || null,
                            kkwTermDate: kkwRecord?.TerminZakonczeniaKKW || item?.kkwTermDate || null,
                        };
                    });

                    const fallbackPlanRefIds = [...new Set(rows
                        .filter((item) => !item?.foreignNumber || !item?.orderNumber)
                        .map((item) => Number(item?.planRefId))
                        .filter((value) => Number.isInteger(value) && value > 0))];

                    if (fallbackPlanRefIds.length) {
                        debug.fallbackPlanRefIds = fallbackPlanRefIds;
                        const planningPositionRecords = await resolvePlanningPositionsByIds(connection, accessToken, fallbackPlanRefIds, { allowMissing: true });
                        debug.fallbackPlanningPositionRecords = planningPositionRecords;
                        const planningPositionMap = new Map(
                            planningPositionRecords.map((item) => [Number(item?.ID), item])
                        );
                        const fallbackPlanningOrderIds = new Set();

                        rows = rows.map((item) => {
                            if (item?.foreignNumber && item?.orderNumber) {
                                return item;
                            }

                            const planningPosition = planningPositionMap.get(Number(item?.planRefId)) || null;
                            const planningOrderId = item?.planningOrderId || Number(planningPosition?.ZlecenieID) || null;
                            if (Number.isInteger(planningOrderId) && planningOrderId > 0) {
                                fallbackPlanningOrderIds.add(planningOrderId);
                            } else if (!planningPosition && Number.isInteger(Number(item?.planRefId))) {
                                fallbackPlanningOrderIds.add(Number(item.planRefId));
                            }

                            return {
                                ...item,
                                planningOrderId,
                                foreignNumber: getForeignNumberFromRecord(planningPosition),
                            };
                        });

                        if (fallbackPlanningOrderIds.size) {
                            const planningOrderRecords = await resolvePlanningOrdersByIds(connection, accessToken, [...fallbackPlanningOrderIds], { allowMissing: true });
                            debug.fallbackPlanningOrderRecords = planningOrderRecords;
                            const planningOrderMap = new Map(
                                planningOrderRecords.map((item) => [Number(item?.ID), item])
                            );

                            rows = rows.map((item) => {
                                if (item?.foreignNumber && item?.orderNumber) {
                                    return item;
                                }

                                const planningOrder = planningOrderMap.get(Number(item?.planningOrderId))
                                    || planningOrderMap.get(Number(item?.planRefId))
                                    || null;

                                if (!planningOrder) {
                                    return item;
                                }

                                return {
                                    ...item,
                                    planningOrderId: Number(planningOrder?.ID) || item?.planningOrderId || null,
                                    orderNumber: String(planningOrder?.ZlecenieNumer || item?.orderNumber || "").trim() || null,
                                    foreignNumber: item?.foreignNumber || getForeignNumberFromRecord(planningOrder),
                                };
                            });
                        }
                    }

                    const orderIds = [...new Set(rows
                        .map((item) => Number(item?.orderId))
                        .filter((value) => Number.isInteger(value) && value > 0))];

                    if (orderIds.length) {
                        const orderRecords = await resolveProductionOrdersByIds(connection, accessToken, orderIds, { allowMissing: true });
                        debug.orderRecords = orderRecords;
                        const orderRecordMap = new Map(
                            orderRecords.map((item) => [Number(item?.ID), item])
                        );
                        debug.missingOrderIds = orderIds.filter((id) => !orderRecordMap.has(id));

                        rows = rows.map((item) => {
                            const orderRecord = orderRecordMap.get(Number(item?.orderId)) || null;
                            return {
                                ...item,
                                foreignNumber: item?.foreignNumber || getForeignNumberFromRecord(orderRecord),
                            };
                        });

                        const missingForeignNumberOrderIds = [...new Set(rows
                            .filter((item) => !item?.foreignNumber)
                            .map((item) => Number(item?.orderId))
                            .filter((value) => Number.isInteger(value) && value > 0))];

                        if (missingForeignNumberOrderIds.length) {
                            const orderDocuments = await resolveDocumentsByOrderIds(connection, accessToken, missingForeignNumberOrderIds, { allowMissing: true });
                            debug.orderDocuments = orderDocuments;
                            const documentsByOrderId = new Map();

                            for (const documentRecord of orderDocuments) {
                                const orderId = Number(documentRecord?.ZlecenieID);
                                if (!Number.isInteger(orderId) || orderId <= 0) {
                                    continue;
                                }

                                const bucket = documentsByOrderId.get(orderId) || [];
                                bucket.push(documentRecord);
                                documentsByOrderId.set(orderId, bucket);
                            }

                            const preferredDocumentByOrderId = new Map(
                                [...documentsByOrderId.entries()]
                                    .map(([orderId, records]) => [orderId, pickPreferredForeignNumberDocument(records)])
                                    .filter(([, record]) => Boolean(record))
                            );

                            rows = rows.map((item) => {
                                if (item?.foreignNumber) {
                                    return item;
                                }

                                const documentRecord = preferredDocumentByOrderId.get(Number(item?.orderId)) || null;
                                const foreignNumber = getForeignNumberFromRecord(documentRecord);
                                if (!foreignNumber) {
                                    return item;
                                }

                                return {
                                    ...item,
                                    foreignNumber,
                                };
                            });
                        }
                    }
                }
            } catch (error) {
                warnings.push(`Nie udalo sie wzbogacic szczegolow z Vendo: ${error.message}`);
                debug.lookupError = error.message;
            }
        }

        debug.finalRows = rows.map((item) => ({
            headerId: item.headerId,
            planRefId: item.planRefId,
            kkwNumber: item.kkwNumber,
            kkwId: item.kkwId,
            planningOrderId: item.planningOrderId,
            orderId: item.orderId,
            orderNumber: item.orderNumber,
            foreignNumber: item.foreignNumber,
            vendoProductCode: item.vendoProductCode,
        }));

        sendJson(res, 200, {
            rows,
            meta: {
                generatedAt: detailData?.generatedAt || new Date().toISOString(),
                componentCode,
                rodzajFilter,
                includeVendo,
                warnings,
                debug,
            },
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Nie udalo sie pobrac szczegolow zapotrzebowania.",
        });
    }
}

async function handleApiProducts(req, res) {
    try {
        const missing = requireServerConfig();
        if (missing.length) {
            return sendJson(res, 500, {
                error: `Brakuje konfiguracji serwera: ${missing.join(", ")}.`,
            });
        }

        const body = await readJsonBody(req);
        const serverConfig = getServerConfig();
        const connection = {
            baseUrl: serverConfig.apiUrl,
            apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin: body.vendoUserLogin,
            vendoUserPassword: body.vendoUserPassword,
        };

        if (!connection.vendoUserLogin || !String(connection.vendoUserLogin).trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserLogin" });
        }
        if (!connection.vendoUserPassword || !String(connection.vendoUserPassword).trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserPassword" });
        }

        const pageSize = Math.min(Math.max(Number(body.pageSize) || 20, 1), 100);
        const productCode = body.productCode || "";
        const accessToken = await getAccessToken(connection);
        const products = await vendoPost(connection.baseUrl, "/Magazyn/Towary/Lista", {
            Token: accessToken,
            Model: buildProductsModel({ productCode, pageSize }),
        });

        sendJson(res, 200, products);
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Wystapil blad podczas polaczenia z Vendo API.",
        });
    }
}

async function handleApiCostAnalysis(req, res) {
    try {
        const missing = requireServerConfig();
        if (missing.length) {
            return sendJson(res, 500, {
                error: `Brakuje konfiguracji serwera: ${missing.join(", ")}.`,
            });
        }

        const body = await readJsonBody(req);
        const serverConfig = getServerConfig();
        const connection = {
            baseUrl: serverConfig.apiUrl,
            apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin: body.vendoUserLogin,
            vendoUserPassword: body.vendoUserPassword,
        };

        if (!connection.vendoUserLogin || !String(connection.vendoUserLogin).trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserLogin" });
        }
        if (!connection.vendoUserPassword || !String(connection.vendoUserPassword).trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserPassword" });
        }

        if (!body.dateFrom || !body.dateTo) {
            return sendJson(res, 400, { error: "Brakuje zakresu dat dla analizy kosztow." });
        }

        const accessToken = await getAccessToken(connection);
        const analysis = await vendoPost(connection.baseUrl, "/Analizy/Analizy/AnalizaKosztow", {
            Token: accessToken,
            Model: buildCostAnalysisModel({
                dateFrom: body.dateFrom,
                dateTo: body.dateTo,
                analysisBy: body.analysisBy,
                excludeDocuments: body.excludeDocuments,
                excludeCorrections: body.excludeCorrections,
                excludeServices: body.excludeServices,
                onlyClosedDocuments: body.onlyClosedDocuments,
                extendedMode: body.extendedMode,
            }),
        });

        sendJson(res, 200, analysis);
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Wystapil blad podczas analizy kosztow.",
        });
    }
}

async function handleApiBackorders(req, res) {
    try {
        const missing = requireServerConfig();
        if (missing.length) {
            return sendJson(res, 500, {
                error: `Brakuje konfiguracji serwera: ${missing.join(", ")}.`,
            });
        }

        const body = await readJsonBody(req);
        const serverConfig = getServerConfig();
        const connection = {
            baseUrl: serverConfig.apiUrl,
            apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin: body.vendoUserLogin,
            vendoUserPassword: body.vendoUserPassword,
        };

        if (!connection.vendoUserLogin || !String(connection.vendoUserLogin).trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserLogin" });
        }
        if (!connection.vendoUserPassword || !String(connection.vendoUserPassword).trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserPassword" });
        }

        const pageSize = Math.min(Math.max(Number(body.pageSize) || 20, 1), 100);
        const accessToken = await getAccessToken(connection);
        const backorders = await vendoPost(connection.baseUrl, "/Magazyn/Backordery/Lista", {
            Token: accessToken,
            Model: buildBackordersModel({
                dateFrom: body.dateFrom,
                dateTo: body.dateTo,
                productCode: body.productCode,
                warehouseCode: body.warehouseCode,
                direction: body.direction,
                pageSize,
            }),
        });

        sendJson(res, 200, backorders);
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Wystapil blad podczas pobierania backorderow.",
        });
    }
}

async function handleApiMrpWorkCosts(req, res) {
    try {
        const missing = requireServerConfig();
        if (missing.length) {
            return sendJson(res, 500, {
                error: `Brakuje konfiguracji serwera: ${missing.join(", ")}.`,
            });
        }

        const body = await readJsonBody(req);
        const serverConfig = getServerConfig();
        const connection = {
            baseUrl: serverConfig.apiUrl,
            apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin: body.vendoUserLogin,
            vendoUserPassword: body.vendoUserPassword,
        };

        if (!connection.vendoUserLogin || !String(connection.vendoUserLogin).trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserLogin" });
        }
        if (!connection.vendoUserPassword || !String(connection.vendoUserPassword).trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserPassword" });
        }

        const kkwNumbers = String(body.kkwNumbers || body.kkwIds || "")
            .split(/[,\n;]+/)
            .map((item) => item.trim().toUpperCase())
            .filter(Boolean);
        const kkwElementIds = parseIdList(body.kkwElementIds);
        const kkwExecutionIds = parseIdList(body.kkwExecutionIds);

        if (!kkwNumbers.length && !kkwElementIds.length && !kkwExecutionIds.length) {
            return sendJson(res, 400, { error: "Podaj co najmniej jeden numer KKW, element KKW ID albo wykonanie KKW ID." });
        }

        const accessToken = await getAccessToken(connection);
        const kkwIds = await resolveKkwIdsByNumbers(connection, accessToken, kkwNumbers);
        const response = await vendoPost(connection.baseUrl, "/Produkcja/KKW/PrzeliczKosztyPracMrp", {
            Token: accessToken,
            Model: buildMrpWorkCostsModel({
                kkwIds,
                kkwElementIds,
                kkwExecutionIds,
            }),
        });

        sendJson(res, 200, {
            Wynik: {
                Sukces: true,
                KkwNumer: kkwNumbers,
                KkwID: kkwIds,
                KkwElementID: kkwElementIds,
                KkwWykonanieID: kkwExecutionIds,
            },
            ResponseStatus: response?.ResponseStatus || null,
            RawResponse: response,
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Wystapil blad podczas przeliczania kosztow prac MRP.",
        });
    }
}

async function handleApiKkwList(req, res) {
    try {
        const missing = requireServerConfig();
        if (missing.length) {
            return sendJson(res, 500, { error: `Brakuje konfiguracji serwera: ${missing.join(", ")}.` });
        }
        const body = await readJsonBody(req);
        const serverConfig = getServerConfig();
        const connection = {
            baseUrl: serverConfig.apiUrl,
            apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin: body.vendoUserLogin,
            vendoUserPassword: body.vendoUserPassword,
        };
        const accessToken = await getAccessToken(connection);
        const page = Number(body.page) || 0;
        const pageSize = 50;
        const search = String(body.search || "").trim();

        const model = {
            Cursor: true,
            CursorCzyZamknac: true,
            Strona: { Indeks: page, LiczbaRekordow: pageSize },
            ZwracanePola: [
                "ID", "Numer", "TowarNazwa", "TowarKod",
                "IloscOczekiwana", "IloscWykonana",
                "TerminZakonczeniaKKW",
                "ZlecenieNumer", "PozycjaZleceniaNazwa",
            ],
        };
        if (search) {
            model.FiltrUniwersalny = search;
            model.FiltrUniwersalnyPola = ["Numer", "TowarNazwa", "TowarKod", "PozycjaZleceniaNazwa", "ZlecenieNumer", "ZlecenieKontrahentNazwa"];
        }

        // Step 1: open cursor, get total count
        model.Cursor = true;
        model.CursorCzyZamknac = false;
        model.Strona = { Indeks: 0, LiczbaRekordow: 1 };
        const countResp = await vendoPost(connection.baseUrl, "/Produkcja/KKW/Lista", {
            Token: accessToken,
            Model: model,
        });
        const total = Number(countResp?.Wynik?.Cursor?.LiczbaWszystkichRekordow) || 0;
        const cursorName = countResp?.Wynik?.Cursor?.Nazwa || "";

        if (!cursorName || !total) {
            // Fallback: no cursor, fetch directly and sort
            const fallbackResp = await vendoPost(connection.baseUrl, "/Produkcja/KKW/Lista", {
                Token: accessToken,
                Model: { ...model, Cursor: true, CursorCzyZamknac: true, Strona: { Indeks: 0, LiczbaRekordow: 200 } },
            });
            const allRecords = Array.isArray(fallbackResp?.Wynik?.Rekordy) ? fallbackResp.Wynik.Rekordy : [];
            allRecords.sort((a, b) => (Number(b.ID) || 0) - (Number(a.ID) || 0));
            const start = page * pageSize;
            const records = allRecords.slice(start, start + pageSize);
            sendJson(res, 200, { Rekordy: records, Strona: page, LiczbaRekordow: pageSize, Razem: allRecords.length, WiecejStron: start + pageSize < allRecords.length });
            return;
        }

        // Step 2: fetch from the end using cursor offset (newest first)
        const targetOffset = Math.max(0, total - ((page + 1) * pageSize));
        const fetchSize = Math.min(pageSize, total - (page * pageSize));
        const response = await vendoPost(connection.baseUrl, "/Produkcja/KKW/Lista", {
            Token: accessToken,
            Model: {
                ...model,
                CursorNazwa: cursorName,
                CursorCzyZamknac: true,
                Strona: { Indeks: targetOffset, LiczbaRekordow: fetchSize > 0 ? fetchSize : pageSize },
            },
        });

        const records = Array.isArray(response?.Wynik?.Rekordy) ? response.Wynik.Rekordy : [];
        records.reverse();
        const hasMore = targetOffset > 0;
        sendJson(res, 200, { Rekordy: records, Strona: page, LiczbaRekordow: pageSize, Razem: total, WiecejStron: hasMore });
    } catch (err) {
        sendJson(res, err.statusCode || 500, { error: err.message });
    }
}

async function handleApiKkwCosts(req, res) {
    try {
        const missing = requireServerConfig();
        if (missing.length) {
            return sendJson(res, 500, {
                error: `Brakuje konfiguracji serwera: ${missing.join(", ")}.`,
            });
        }

        const body = await readJsonBody(req);
        const serverConfig = getServerConfig();
        const connection = {
            baseUrl: serverConfig.apiUrl,
            apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin: body.vendoUserLogin,
            vendoUserPassword: body.vendoUserPassword,
        };

        if (!connection.vendoUserLogin || !String(connection.vendoUserLogin).trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserLogin" });
        }
        if (!connection.vendoUserPassword || !String(connection.vendoUserPassword).trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserPassword" });
        }

        const kkwNumbers = String(body.kkwNumbers || "")
            .split(/[,\n;]+/)
            .map((item) => item.trim().toUpperCase())
            .filter(Boolean);

        if (!kkwNumbers.length) {
            return sendJson(res, 400, { error: "Podaj numer KKW, np. 119/25." });
        }

        const accessToken = await getAccessToken(connection);
        const [kkwRecord] = await resolveKkwRecordsByNumbers(connection, accessToken, [kkwNumbers[0]]);
        const kkwId = Number(kkwRecord?.ID);
        const kkwNumber = kkwNumbers[0];
        const materialsResponse = await vendoPost(connection.baseUrl, "/Produkcja/KKW/MaterialowkaLista", {
            Token: accessToken,
            Model: buildKkwMaterialsModel({
                kkwId,
                pageSize: 500,
            }),
        });
        const estimateResponse = await vendoPost(connection.baseUrl, "/Produkcja/KKW/SzacowanieKosztow", {
            Token: accessToken,
            Model: buildKkwCostEstimateModel({
                kkwId,
            }),
        });
        const reportResponse = await vendoPost(connection.baseUrl, "/Produkcja/KKW/RaportPreTechInPost", {
            Token: accessToken,
            Model: buildKkwPreTechInPostModel({
                kkwId,
                useCalcPrices: true,
            }),
        });
        const zleceniId = Number(kkwRecord?.ZlecenieID) || null;

        const [pracownicyResponse, zlpResponse] = await Promise.all([
        vendoPost(connection.baseUrl, "/Produkcja/KKW/PracownicyWykonanLista", {
            Token: accessToken,
            Model: {
                Cursor: true,
                CursorCzyZamknac: false,
                Strona: { Indeks: 0, LiczbaRekordow: 500 },
                KKWID: [kkwId],
                ZwracanePola: [
                    "ID", "OperacjaNazwa", "OperacjaLp",
                    "PracownikImie", "PracownikNazwisko",
                    "Rbh", "DataRozpoczecia", "DataZakonczenia",
                ],
            },
        }),
        zleceniId
            ? vendoPost(connection.baseUrl, "/Dokumenty/Dokumenty/Lista", {
                Token: accessToken,
                Model: {
                    ZleceniaID: [zleceniId],
                    Strona: { Indeks: 0, LiczbaRekordow: 50 },
                },
              })
            : Promise.resolve(null),
        ]);

        const pracownicyRecords = Array.isArray(pracownicyResponse?.Wynik?.Rekordy)
            ? pracownicyResponse.Wynik.Rekordy
            : [];

        const rbhByOperation = {};
        for (const rec of pracownicyRecords) {
            const name = rec.OperacjaNazwa || "?";
            if (!rbhByOperation[name]) {
                rbhByOperation[name] = { Rbh: 0, Stawka: getStawkaOperacji(name), Wykonania: [] };
            }
            const rbh = Number(rec.Rbh) || 0;
            rbhByOperation[name].Rbh += rbh;
            rbhByOperation[name].Wykonania.push({
                Pracownik: [rec.PracownikImie, rec.PracownikNazwisko].filter(Boolean).join(" "),
                Rbh: rbh,
                DataRozpoczecia: rec.DataRozpoczecia,
                DataZakonczenia: rec.DataZakonczenia,
            });
        }

        const kosztOperacjiWgStawek = {};
        let sumaKosztowOperacji = 0;
        for (const [name, data] of Object.entries(rbhByOperation)) {
            const stawka = data.Stawka || 0;
            const koszt = data.Rbh * stawka;
            const jednorazowa = OPERACJE_JEDNORAZOWE.has(name);
            kosztOperacjiWgStawek[name] = {
                Rbh: Math.round(data.Rbh * 10000) / 10000,
                StawkaNowa: stawka,
                KosztWgNowejStawki: Math.round(koszt * 100) / 100,
                Jednorazowa: jednorazowa,
                Wykonania: data.Wykonania,
            };
            if (!jednorazowa) {
                sumaKosztowOperacji += koszt;
            }
        }

        const materialRecords = Array.isArray(materialsResponse?.Wynik?.Rekordy) ? materialsResponse.Wynik.Rekordy : [];
        const estimate = estimateResponse?.Wynik || {};
        const elements = Array.isArray(reportResponse?.Wynik?.Elementy) ? reportResponse.Wynik.Elementy : [];
        const root = elements.find((item) => item?.Rodzaj === "Korzen") || null;
        const branches = elements.filter((item) => typeof item?.Rodzaj === "string" && item.Rodzaj.startsWith("Galaz"));
        const leaves = elements.filter((item) => typeof item?.Rodzaj === "string" && item.Rodzaj.startsWith("Lisc"));
        const operationLeaves = leaves.filter((item) => item?.Rodzaj === "Lisc, Operacja");
        for (const leaf of operationLeaves) {
            const name = leaf?.Nazwa;
            const stawka = getStawkaOperacji(name);
            const rbhWyk = Number(leaf?.Post?.Ilosc) || 0;
            leaf.StawkaNowa = stawka;
            leaf.KosztWgStawki = stawka != null ? Math.round(rbhWyk * stawka * 100) / 100 : null;
            leaf.Jednorazowa = OPERACJE_JEDNORAZOWE.has(name);
        }

        const materialLeaves = leaves.filter((item) => item?.Rodzaj === "Lisc, Material");
        const materialsBranch = branches.find((item) => item?.Rodzaj === "Galaz, Material") || null;
        const operationsBranch = branches.find((item) => item?.Rodzaj === "Galaz, Operacja") || null;
        const quantity =
            Number(kkwRecord?.IloscWykonana) ||
            Number(kkwRecord?.IloscPrzyjeta) ||
            Number(kkwRecord?.IloscOczekiwana) ||
            0;
        const hasMaterialCostField = materialRecords.some((item) => item?.CenaKalkulacyjna !== undefined && item?.CenaKalkulacyjna !== null);
        const materialCostFromMaterials = hasMaterialCostField
            ? materialRecords.reduce(
                  (sum, item) => sum + ((Number(item.IloscZWykonania) || 0) * (Number(item.CenaKalkulacyjna) || 0)),
                  0
              )
            : null;
        const materialCostFromReportLeaves = materialLeaves.reduce(
            (sum, item) => sum + (Number(item?.Post?.Wartosc) || 0),
            0
        );
        const materialCostFromEstimate = Number(estimate?.Materialy?.Wartosc);
        const materialDetailsById = new Map(
            materialLeaves
                .filter((item) => Number.isInteger(Number(item?.SkladnikID)))
                .map((item) => [Number(item.SkladnikID), item])
        );
        const totalCost = Number(root?.Post?.Wartosc) || 0;
        const operationsCost = Number(operationsBranch?.Post?.Wartosc) || 0;
        const materialsCost = Number(materialsBranch?.Post?.Wartosc) || 0;

        let allDocs = Array.isArray(zlpResponse?.Wynik?.Rekordy) ? zlpResponse.Wynik.Rekordy : [];
        let fvDocs = allDocs.filter((d) => d.RodzajKod === "FV");

        // If no FV found directly on ZLP, discover FV via Skojarzone chain:
        // Step 1: ZO → Skojarzone(Generowane) → finds WZ (and merges them)
        // Step 2: WZ → Skojarzone(Generowane) → finds FV
        if (fvDocs.length === 0) {
            try {
                const fetchSkojarzone = async (docs) => {
                    const results = await Promise.all(
                        docs.map((doc) =>
                            vendoPost(connection.baseUrl, "/Dokumenty/Dokumenty/Skojarzone", {
                                Token: accessToken,
                                Model: { DokumentID: Number(doc.ID), Generowane: true },
                            })
                        )
                    );
                    const ids = new Set();
                    for (const sr of results) {
                        for (const item of (Array.isArray(sr?.Wynik) ? sr.Wynik : [])) {
                            if (item.DataType === "Dokument" && item.ID) ids.add(Number(item.ID));
                        }
                    }
                    return ids;
                };

                const mergeNewDocs = async (discoveredIds) => {
                    const existingIds = new Set(allDocs.map((d) => Number(d.ID)));
                    const newIds = [...discoveredIds].filter((id) => !existingIds.has(id));
                    if (newIds.length === 0) return;
                    const resp = await vendoPost(connection.baseUrl, "/Dokumenty/Dokumenty/Lista", {
                        Token: accessToken,
                        Model: { DokumentyID: newIds, Strona: { Indeks: 0, LiczbaRekordow: 50 } },
                    });
                    const newDocs = Array.isArray(resp?.Wynik?.Rekordy) ? resp.Wynik.Rekordy : [];
                    allDocs = allDocs.concat(newDocs);
                };

                // Step 1: if we have WZ already, skip to step 2; otherwise discover WZ from ZO
                let wzDocs = allDocs.filter((d) => d.RodzajKod === "WZ");
                if (wzDocs.length === 0) {
                    const zoDocs0 = allDocs.filter((d) => d.RodzajKod === "ZO");
                    if (zoDocs0.length > 0) {
                        await mergeNewDocs(await fetchSkojarzone(zoDocs0));
                        wzDocs = allDocs.filter((d) => d.RodzajKod === "WZ");
                    }
                }
                // Step 2: discover FV from WZ
                if (wzDocs.length > 0) {
                    await mergeNewDocs(await fetchSkojarzone(wzDocs));
                    fvDocs = allDocs.filter((d) => d.RodzajKod === "FV");
                }
            } catch (_) { /* FV discovery is best-effort */ }
        }

        const zoDocs = allDocs.filter((d) => d.RodzajKod === "ZO");
        const otherDocs = allDocs.filter((d) => d.RodzajKod !== "ZO" && d.RodzajKod !== "FV");

        sendJson(res, 200, {
            Wynik: {
                KkwID: kkwId,
                KkwNumer: kkwNumber,
                ZlecenieID: zleceniId,
                ZlecenieNumer: kkwRecord?.ZlecenieNumer || null,
                TowarKod: kkwRecord?.TowarKod || null,
                TowarNazwa: kkwRecord?.TowarNazwa || null,
                TerminRealizacji: kkwRecord?.TerminZakonczeniaKKW || null,
                Ilosc: quantity,
                Raport: {
                    Korzen: root,
                    Galezie: branches,
                    Liscie: leaves,
                    Materialy: materialsBranch,
                    Operacje: operationsBranch,
                },
                Materialowka: {
                    LiczbaPozycji: materialRecords.length,
                    KosztKalkulacyjny: Number.isFinite(materialCostFromEstimate)
                        ? materialCostFromEstimate
                        : materialCostFromMaterials,
                    KosztPoRealizacji: materialCostFromReportLeaves,
                    Pozycje: materialRecords.map((item) => {
                        const materialDetail = materialDetailsById.get(Number(item?.SkladnikID));
                        return {
                            ID: item?.ID || null,
                            Typ: item?.Typ || null,
                            SkladnikID: item?.SkladnikID || null,
                            SkladnikKod: item?.SkladnikKod || null,
                            SkladnikNazwa: item?.SkladnikNazwa || null,
                            IloscPlanowana: Number(item?.IloscPlanowana) || 0,
                            IloscZWykonania: Number(item?.IloscZWykonania) || 0,
                            IloscPrzeniesiona: Number(item?.IloscPrzeniesiona) || 0,
                            KosztPoRealizacji: Number(materialDetail?.Post?.Wartosc) || 0,
                            CenaPoRealizacji: Number(materialDetail?.Post?.Cena) || 0,
                        };
                    }),
                },
                Podsumowanie: {
                    LiczbaElementow: elements.length,
                    LiczbaGalezi: branches.length,
                    LiczbaLisci: leaves.length,
                    MaterialyPostWartosc: materialsCost,
                    OperacjePostWartosc: operationsCost,
                    KorzenPostWartosc: totalCost,
                    MaterialowkaKosztKalkulacyjny: Number.isFinite(materialCostFromEstimate)
                        ? materialCostFromEstimate
                        : materialCostFromMaterials,
                    MaterialowkaKosztPoRealizacji: materialCostFromReportLeaves,
                    LiczbaPozycjiMaterialowki: materialRecords.length,
                    KosztNaSztuke: quantity > 0 ? totalCost / quantity : 0,
                    MaterialyNaSztuke: quantity > 0 ? materialsCost / quantity : 0,
                    OperacjeNaSztuke: quantity > 0 ? operationsCost / quantity : 0,
                    OperacjeWgNowychStawek: Math.round(sumaKosztowOperacji * 100) / 100,
                    OperacjeWgNowychStawekNaSztuke: quantity > 0
                        ? Math.round((sumaKosztowOperacji / quantity) * 100) / 100
                        : 0,
                },
                KosztyOperacjiWgStawek: kosztOperacjiWgStawek,
                SumaKosztowOperacjiWgStawek: Math.round(sumaKosztowOperacji * 100) / 100,
                SzacowanieKosztow: estimate,
                DokumentyZlecenia: {
                    ZO: zoDocs,
                    FV: fvDocs,
                    Inne: otherDocs,
                    Wszystkie: allDocs,
                },
            },
            ResponseStatus: {
                Materialowka: materialsResponse?.ResponseStatus || null,
                SzacowanieKosztow: estimateResponse?.ResponseStatus || null,
                RaportPreTechInPost: reportResponse?.ResponseStatus || null,
                ZlecenieProdukcyjne: zlpResponse?.ResponseStatus || null,
            },
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Wystapil blad podczas pobierania kosztow KKW.",
        });
    }
}

async function handleApiProductionOrderCosts(req, res) {
    try {
        const missing = requireServerConfig();
        if (missing.length) {
            return sendJson(res, 500, {
                error: `Brakuje konfiguracji serwera: ${missing.join(", ")}.`,
            });
        }

        const body = await readJsonBody(req);
        const serverConfig = getServerConfig();
        const connection = {
            baseUrl: serverConfig.apiUrl,
            apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin: body.vendoUserLogin,
            vendoUserPassword: body.vendoUserPassword,
        };

        if (!connection.vendoUserLogin || !String(connection.vendoUserLogin).trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserLogin" });
        }
        if (!connection.vendoUserPassword || !String(connection.vendoUserPassword).trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserPassword" });
        }

        const kkwNumbers = String(body.kkwNumbers || "")
            .split(/[,\n;]+/)
            .map((item) => item.trim().toUpperCase())
            .filter(Boolean);

        if (!kkwNumbers.length) {
            return sendJson(res, 400, { error: "Podaj numer KKW, np. 192/26." });
        }

        const accessToken = await getAccessToken(connection);
        const [kkwRecord] = await resolveKkwRecordsByNumbers(connection, accessToken, [kkwNumbers[0]]);

        if (!Number.isInteger(Number(kkwRecord?.ZlecenieID))) {
            return sendJson(res, 400, {
                error: `KKW ${kkwNumbers[0]} nie ma powiązanego ZlecenieID.`,
            });
        }

        const response = await vendoPost(connection.baseUrl, "/Produkcja/Zlecenie/KosztZlecenia", {
            Token: accessToken,
            Model: buildProductionOrderCostModel({
                orderId: Number(kkwRecord.ZlecenieID),
            }),
        });

        const result = response?.Wynik || {};
        const records = Array.isArray(result.Rekordy) ? result.Rekordy : [];
        const summary =
            result.Podsumowanie ||
            records.reduce(
                (acc, item) => {
                    acc.MaterialPlan += Number(item.MaterialPlan) || 0;
                    acc.MaterialRealizacja += Number(item.MaterialRealizacja) || 0;
                    acc.PracaPlan += Number(item.PracaPlan) || 0;
                    acc.PracaRealizacja += Number(item.PracaRealizacja) || 0;
                    acc.RbhPlan += Number(item.RbhPlan) || 0;
                    acc.RbhRealizacja += Number(item.RbhRealizacja) || 0;
                    acc.KooperacjaPlan += Number(item.KooperacjaPlan) || 0;
                    acc.KooperacjaRealizacja += Number(item.KooperacjaRealizacja) || 0;
                    acc.SumaPlan += Number(item.SumaPlan) || 0;
                    acc.SumaRealizacja += Number(item.SumaRealizacja) || 0;
                    return acc;
                },
                {
                    MaterialPlan: 0,
                    MaterialRealizacja: 0,
                    PracaPlan: 0,
                    PracaRealizacja: 0,
                    RbhPlan: 0,
                    RbhRealizacja: 0,
                    KooperacjaPlan: 0,
                    KooperacjaRealizacja: 0,
                    SumaPlan: 0,
                    SumaRealizacja: 0,
                }
            );

        sendJson(res, 200, {
            Wynik: {
                KkwID: Number(kkwRecord.ID) || null,
                KkwNumer: kkwRecord.Numer || kkwNumbers[0],
                ZlecenieID: Number(kkwRecord.ZlecenieID) || null,
                ZlecenieNumer: kkwRecord.ZlecenieNumer || null,
                TowarKod: kkwRecord.TowarKod || null,
                TowarNazwa: kkwRecord.TowarNazwa || null,
                Pozycje: records,
                Podsumowanie: summary,
            },
            ResponseStatus: response?.ResponseStatus || null,
            RawResponse: response,
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Wystapil blad podczas pobierania kosztu zlecenia.",
        });
    }
}

async function handleApiProductionDashboard(req, res) {
    try {
        const missing = requireServerConfig();
        if (missing.length) {
            sendJson(res, 500, {
                error: `Brakuje konfiguracji serwera: ${missing.join(", ")}`,
            });
            return;
        }

        const body = await readJsonBody(req);
        const kkwNumber = String(body.kkwNumber || "").trim();
        const operatorName = String(body.operatorName || "").trim();
        const stationCode = String(body.stationCode || "").trim();
        const operationName = String(body.operationName || "").trim();

        if (!kkwNumber) {
            sendJson(res, 400, { error: "Podaj numer KKW." });
            return;
        }

        const serverConfig = getServerConfig();
        const vendoCredentials = resolveVendoUserCredentials(body);
        const connection = {
            baseUrl: serverConfig.apiUrl,
            apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin: vendoCredentials.vendoUserLogin,
            vendoUserPassword: vendoCredentials.vendoUserPassword,
        };

        if (!connection.vendoUserLogin || !connection.vendoUserPassword) {
            sendJson(res, 400, { error: "Brakuje loginu lub hasla Vendo w konfiguracji serwera." });
            return;
        }

        const accessToken = await getAccessToken(connection);
        const [kkwRecord] = await resolveKkwRecordsByNumbers(connection, accessToken, [kkwNumber]);
        const kkwId = Number(kkwRecord?.ID);

        if (!Number.isInteger(kkwId)) {
            throw new Error(`Nie znaleziono KKW o numerze: ${kkwNumber}`);
        }

        const [worklogResponse, operationsResponse] = await Promise.all([
            vendoPost(connection.baseUrl, "/Pracownicy/Czasozliczarka/Lista", {
                Token: accessToken,
                Model: buildCzasozliczarkaListModel({ operatorName, pageSize: 50 }),
            }),
            vendoPost(connection.baseUrl, "/Produkcja/KKW/OperacjeLista", {
                Token: accessToken,
                Model: buildKkwOperationsModel({ kkwId, pageSize: 100 }),
            }),
        ]);

        const operations = Array.isArray(operationsResponse?.Wynik?.Rekordy) ? operationsResponse.Wynik.Rekordy : [];
        const operation = pickBestOperation(operations, operationName, stationCode);

        if (!operation) {
            throw new Error(`Nie znaleziono operacji dla KKW ${kkwNumber}.`);
        }

        const [stationsResponse, executionsResponse, workersResponse] = await Promise.all([
            vendoPost(connection.baseUrl, "/Produkcja/KKW/StanowiskaLista", {
                Token: accessToken,
                Model: buildKkwStationsModel({ kkwId, operationId: operation.ID, pageSize: 100 }),
            }),
            vendoPost(connection.baseUrl, "/Produkcja/KKW/WykonaniaLista", {
                Token: accessToken,
                Model: buildKkwExecutionsModel({ kkwId, operationId: operation.ID, pageSize: 200 }),
            }),
            vendoPost(connection.baseUrl, "/Produkcja/KKW/PracownicyWykonanLista", {
                Token: accessToken,
                Model: buildKkwWorkersModel({ kkwId, operationId: operation.ID, pageSize: 200 }),
            }),
        ]);

        const stationRecords = Array.isArray(stationsResponse?.Wynik?.Rekordy) ? stationsResponse.Wynik.Rekordy : [];
        const executionRecords = pickExecutionRecords(
            Array.isArray(executionsResponse?.Wynik?.Rekordy) ? executionsResponse.Wynik.Rekordy : [],
            operation?.Nazwa,
            stationCode
        );
        const workerRecords = Array.isArray(workersResponse?.Wynik?.Rekordy) ? workersResponse.Wynik.Rekordy : [];
        const worklogEntries = Array.isArray(worklogResponse?.Wynik?.Rekordy) ? worklogResponse.Wynik.Rekordy : [];

        const station = pickBestStation(stationRecords, stationCode, operation?.Nazwa);
        const worker = pickBestWorker(workerRecords, operatorName, operation?.Nazwa);
        const worklog = pickBestWorklog(worklogEntries, operatorName);
        const metrics = buildProductionDashboardMetrics({
            kkwRecord,
            operation,
            station,
            worker,
            worklog,
            worklogEntries,
            executionRecords,
        });

        sendJson(res, 200, {
            kkw: {
                id: kkwId,
                number: kkwRecord?.Numer || kkwNumber,
                orderNumber: kkwRecord?.ZlecenieNumer || null,
                productCode: kkwRecord?.TowarKod || null,
                productName: kkwRecord?.TowarNazwa || kkwRecord?.PozycjaZleceniaNazwa || null,
                plannedQuantity: Number(kkwRecord?.IloscOczekiwana || 0),
                performedQuantity: Number(kkwRecord?.IloscWykonana || 0),
            },
            operator: {
                name: worker ? [worker.PracownikImie, worker.PracownikNazwisko].filter(Boolean).join(" ") : operatorName || worklog?.PracownikImieNazwisko || null,
                login: worker?.PracownikLogin || null,
                worklogName: worklog?.PracownikImieNazwisko || null,
            },
            operation: {
                id: operation?.ID || null,
                name: operation?.Nazwa || null,
                lp: operation?.Lp || null,
                expectedRate: Number(operation?.Wydajnosc || 0),
                tpz: Number(operation?.Tpz || 0),
                productionTime: Number(operation?.CzasProdukcji || 0),
                plannedGood: Number(operation?.IloscPlanowanaDobrych || 0),
                registeredGood: Number(operation?.IloscZarejestrowanaDobrych || 0),
                registeredDefects: Number(operation?.IloscZarejestrowanaBrakowNaprawialnych || 0) + Number(operation?.IloscZarejestrowanaBrakowNienaprawialnych || 0),
                active: Boolean(operation?.AktualnieWykonywane),
            },
            station: station ? {
                id: station?.StanowiskoID || null,
                code: station?.StanowiskoKod || null,
                name: station?.StanowiskoNazwa || null,
                expectedRate: Number(station?.Wydajnosc || 0),
                tpz: Number(station?.Tpz || 0),
                productionTime: Number(station?.Czas || 0),
                workerCount: Number(station?.LiczbaPracownikow || 0),
            } : {
                code: stationCode || operation?.DomyslneStanowiskoKod || null,
                name: operation?.DomyslneStanowiskoNazwa || null,
                expectedRate: 0,
                tpz: 0,
                productionTime: 0,
                workerCount: 0,
            },
            worker,
            worklog,
            metrics,
            debug: {
                matchedOperations: operations.length,
                matchedStations: stationRecords.length,
                matchedExecutions: executionRecords.length,
                matchedWorkers: workerRecords.length,
                matchedWorklogs: worklogEntries.length,
                executionKinds: executionRecords.map((item) => item?.Rodzaj).filter(Boolean),
                executionRecords: executionRecords.map((item) => ({
                    id: item?.ID || null,
                    kind: item?.Rodzaj || null,
                    stationCode: item?.StanowiskoKod || null,
                    operationName: item?.OperacjaNazwa || null,
                    startedAt: item?.DataRozpoczecia || null,
                    endedAt: item?.DataZakonczenia || null,
                    status: item?.Stan || null,
                    marker: item?.Znacznik || null,
                })),
            },
        });
    } catch (error) {
        sendJson(res, 500, { error: error.message || "Nie udalo sie pobrac danych dashboardu produkcyjnego." });
    }
}

async function handleApiProductionOverview(req, res) {
    try {
        const missing = requireServerConfig();
        if (missing.length) {
            sendJson(res, 500, {
                error: `Brakuje konfiguracji serwera: ${missing.join(", ")}`,
            });
            return;
        }

        const body = await readJsonBody(req);
        const serverConfig = getServerConfig();
        const vendoCredentials = resolveVendoUserCredentials(body);
        const connection = {
            baseUrl: serverConfig.apiUrl,
            apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin: vendoCredentials.vendoUserLogin,
            vendoUserPassword: vendoCredentials.vendoUserPassword,
        };

        if (!connection.vendoUserLogin || !connection.vendoUserPassword) {
            sendJson(res, 400, { error: "Brakuje loginu lub hasla Vendo w konfiguracji serwera." });
            return;
        }

        const overviewCacheKey = `${connection.baseUrl}::${connection.vendoUserLogin}`.toLowerCase();
        const cachedOverview = getCacheEntry(productionOverviewCache, overviewCacheKey, 30 * 1000);
        if (cachedOverview) {
            sendJson(res, 200, cachedOverview);
            return;
        }

        const accessToken = await getAccessToken(connection);
        const worklogResponse = await vendoPost(connection.baseUrl, "/Pracownicy/Czasozliczarka/Lista", {
            Token: accessToken,
            Model: buildCzasozliczarkaListModel({ operatorName: "", pageSize: 200 }),
        });
        const worklogEntries = Array.isArray(worklogResponse?.Wynik?.Rekordy) ? worklogResponse.Wynik.Rekordy : [];
        const activeWorklogs = worklogEntries
            .filter((item) => item?.AktualnieWykonywana)
            .sort((left, right) => String(right?.DataCzasRozpoczecia || "").localeCompare(String(left?.DataCzasRozpoczecia || "")));
        const productionWorklogs = activeWorklogs.filter((item) => Number(item?.ObiektPowiazanyDataType) === 156 && Number(item?.ObiektPowiazanyID) > 0);
        const worklogWorkerIds = [...new Set(productionWorklogs
            .map((item) => Number(item?.ObiektPowiazanyID))
            .filter((id) => Number.isInteger(id) && id > 0))];

        if (!productionWorklogs.length || !worklogWorkerIds.length) {
            const emptyPayload = {
                summary: {
                    activeStations: 0,
                    activeOperators: 0,
                    activeKkws: 0,
                },
                records: [],
                debug: {
                    activeWorklogs: activeWorklogs.length,
                    productionWorklogs: productionWorklogs.length,
                    matchedWorkers: worklogWorkerIds.length,
                },
            };
            setCacheEntry(productionOverviewCache, overviewCacheKey, emptyPayload);
            return sendJson(res, 200, emptyPayload);
        }

        const workersResponse = await vendoPost(connection.baseUrl, "/Produkcja/KKW/PracownicyWykonanLista", {
            Token: accessToken,
            Model: buildKkwWorkersModel({ ids: worklogWorkerIds, kkwId: null, operationId: null, pageSize: Math.max(worklogWorkerIds.length + 20, 50) }),
        });
        const activeWorkers = (Array.isArray(workersResponse?.Wynik?.Rekordy) ? workersResponse.Wynik.Rekordy : [])
            .sort((left, right) => String(right?.DataRozpoczecia || "").localeCompare(String(left?.DataRozpoczecia || "")));
        const workerById = new Map(activeWorkers.map((item) => [Number(item?.ID), item]));
        const executionIds = [...new Set(activeWorkers
            .map((item) => Number(item?.WykonanieKKWID))
            .filter((id) => Number.isInteger(id) && id > 0))];
        const executionsResponse = executionIds.length
            ? await vendoPost(connection.baseUrl, "/Produkcja/KKW/WykonaniaLista", {
                Token: accessToken,
                Model: buildKkwExecutionsModel({ ids: executionIds, kkwId: null, operationId: null, pageSize: Math.max(executionIds.length + 20, 50) }),
            })
            : { Wynik: { Rekordy: [] } };
        const activeExecutions = (Array.isArray(executionsResponse?.Wynik?.Rekordy) ? executionsResponse.Wynik.Rekordy : [])
            .sort((left, right) => String(right?.DataRozpoczecia || "").localeCompare(String(left?.DataRozpoczecia || "")));
        const executionById = new Map(activeExecutions.map((item) => [Number(item?.ID), item]));
        const activeKkwIds = [...new Set(activeExecutions
            .map((item) => Number(item?.KKWID))
            .concat(activeWorkers.map((item) => Number(item?.KKWID)))
            .filter((id) => Number.isInteger(id) && id > 0))];

        const kkwRecords = await resolveKkwRecordsByIds(connection, accessToken, activeKkwIds, { allowMissing: true });
        const kkwRecordMap = new Map(kkwRecords.map((item) => [Number(item?.ID), item]));
        const kkwContextEntries = await mapWithConcurrency(activeKkwIds, 4, async (kkwId) => {
            if (!Number.isInteger(kkwId)) {
                return [kkwId, { operations: [], stations: [], executions: [] }];
            }

            const contextCacheKey = `${connection.baseUrl}::${kkwId}`;
            const cachedContext = getCacheEntry(kkwOverviewContextCache, contextCacheKey, 60 * 1000);
            if (cachedContext) {
                return [kkwId, cachedContext];
            }

            const [operationsResponse, stationsResponse, kkwExecutionsResponse] = await Promise.all([
                vendoPost(connection.baseUrl, "/Produkcja/KKW/OperacjeLista", {
                    Token: accessToken,
                    Model: buildKkwOperationsModel({ kkwId, pageSize: 120 }),
                }),
                vendoPost(connection.baseUrl, "/Produkcja/KKW/StanowiskaLista", {
                    Token: accessToken,
                    Model: buildKkwStationsModel({ kkwId, operationId: null, pageSize: 160 }),
                }),
                vendoPost(connection.baseUrl, "/Produkcja/KKW/WykonaniaLista", {
                    Token: accessToken,
                    Model: buildKkwExecutionsModel({ kkwId, operationId: null, pageSize: 200 }),
                }),
            ]);

            const context = {
                operations: Array.isArray(operationsResponse?.Wynik?.Rekordy) ? operationsResponse.Wynik.Rekordy : [],
                stations: Array.isArray(stationsResponse?.Wynik?.Rekordy) ? stationsResponse.Wynik.Rekordy : [],
                executions: Array.isArray(kkwExecutionsResponse?.Wynik?.Rekordy) ? kkwExecutionsResponse.Wynik.Rekordy : [],
            };

            return [kkwId, setCacheEntry(kkwOverviewContextCache, contextCacheKey, context)];
        });
        const kkwContextMap = new Map(kkwContextEntries);

        const records = productionWorklogs.map((worklog) => {
            const worker = workerById.get(Number(worklog?.ObiektPowiazanyID)) || null;
            const execution = executionById.get(Number(worker?.WykonanieKKWID)) || null;
            const kkwId = Number(worker?.KKWID || execution?.KKWID) || null;
            const kkwNumber = String(execution?.KKWNumer || worker?.KKWNumer || "").trim();
            const kkwRecord = (kkwId && kkwRecordMap.get(kkwId)) || null;
            const context = (kkwId && kkwContextMap.get(kkwId)) || { operations: [], stations: [], executions: [] };
            const operationName = execution?.OperacjaNazwa || worker?.OperacjaNazwa || String(worklog?.Temat || "");
            const stationCode = execution?.StanowiskoKod || "";
            const operation = pickBestOperation(context.operations, operationName, stationCode);
            const station = pickBestStation(context.stations, stationCode, operationName);
            const relatedExecutions = (context.executions || []).filter((item) => Number(item?.KKWID) === kkwId);
            const executionRecords = pickExecutionRecords(relatedExecutions, operationName, stationCode);
            const matchingWorkers = activeWorkers
                .filter((item) => {
                    const workerKkwMatches = Number(item?.KKWID) === kkwId;
                    const operationMatches = !operationName || normalizeText(item?.OperacjaNazwa) === normalizeText(operationName);
                    const operationIdMatches = execution?.OperacjaID && item?.OperacjaID
                        ? Number(item?.OperacjaID) === Number(execution?.OperacjaID)
                        : true;
                    return workerKkwMatches && operationMatches && operationIdMatches;
                });
            const operatorNames = [...new Set(matchingWorkers
                .map((item) => [item?.PracownikImie, item?.PracownikNazwisko].filter(Boolean).join(" ").trim())
                .filter(Boolean))];
            const metrics = buildProductionDashboardMetrics({
                kkwRecord,
                operation,
                station,
                worker: worker || matchingWorkers[0] || null,
                worklog,
                worklogEntries: productionWorklogs,
                executionRecords,
            });

            return {
                id: `${worklog?.ID || execution?.ID || `${kkwNumber}-${stationCode}`}`,
                kkw: {
                    id: Number(kkwRecord?.ID) || kkwId || null,
                    number: kkwRecord?.Numer || kkwNumber || null,
                    orderNumber: kkwRecord?.ZlecenieNumer || worklog?.ZlecenieNumer || null,
                    productCode: kkwRecord?.TowarKod || null,
                    productName: kkwRecord?.TowarNazwa || kkwRecord?.PozycjaZleceniaNazwa || null,
                },
                operator: {
                    name: worklog?.PracownikImieNazwisko || operatorNames.join(", ") || [worker?.PracownikImie, worker?.PracownikNazwisko].filter(Boolean).join(" ") || null,
                    login: worker?.PracownikLogin || null,
                    count: operatorNames.length || (worker ? 1 : 0),
                },
                operation: {
                    id: operation?.ID || execution?.OperacjaID || null,
                    name: operation?.Nazwa || operationName || null,
                    lp: operation?.Lp || execution?.OperacjaLp || null,
                },
                station: {
                    id: station?.StanowiskoID || execution?.StanowiskoID || null,
                    code: station?.StanowiskoKod || execution?.StanowiskoKod || null,
                    name: station?.StanowiskoNazwa || execution?.StanowiskoNazwa || null,
                },
                metrics,
                execution: {
                    id: execution?.ID || null,
                    kind: execution?.Rodzaj || null,
                    startedAt: execution?.DataRozpoczecia || null,
                    endedAt: execution?.DataZakonczenia || null,
                    status: execution?.Stan || null,
                },
                worklog: {
                    id: worklog?.ID || null,
                    startedAt: worklog?.DataCzasRozpoczecia || null,
                    topic: worklog?.Temat || null,
                    orderNumber: worklog?.ZlecenieNumer || null,
                },
            };
        });
        const sortedRecords = records.sort((left, right) => {
            const leftStation = String(left?.station?.code || "");
            const rightStation = String(right?.station?.code || "");
            return leftStation.localeCompare(rightStation, "pl");
        });
        const operatorSet = new Set(sortedRecords.flatMap((item) => String(item?.operator?.name || "").split(",").map((part) => part.trim()).filter(Boolean)));

        const payload = {
            summary: {
                activeStations: sortedRecords.length,
                activeOperators: operatorSet.size,
                activeKkws: new Set(sortedRecords.map((item) => item?.kkw?.number).filter(Boolean)).size,
            },
            records: sortedRecords,
            debug: {
                activeWorklogs: activeWorklogs.length,
                productionWorklogs: productionWorklogs.length,
                activeExecutions: activeExecutions.length,
                activeWorkers: activeWorkers.length,
                matchedKkws: activeKkwIds.length,
                cachedKkws: activeKkwIds.filter((kkwId) => getCacheEntry(kkwOverviewContextCache, `${connection.baseUrl}::${kkwId}`, 60 * 1000)).length,
            },
        };

        setCacheEntry(productionOverviewCache, overviewCacheKey, payload);
        sendJson(res, 200, payload);
    } catch (error) {
        sendJson(res, 500, { error: error.message || "Nie udalo sie pobrac przegladu aktywnej produkcji." });
    }
}

async function handleApiProductLocations(req, res) {
    try {
        const missing = requireServerConfig();
        if (missing.length) {
            return sendJson(res, 500, {
                error: `Brakuje konfiguracji serwera: ${missing.join(", ")}.`,
            });
        }

        const body = await readJsonBody(req);
        const serverConfig = getServerConfig();
        const connection = {
            baseUrl: serverConfig.apiUrl,
            apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin: body.vendoUserLogin,
            vendoUserPassword: body.vendoUserPassword,
        };

        if (!connection.vendoUserLogin || !String(connection.vendoUserLogin).trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserLogin" });
        }
        if (!connection.vendoUserPassword || !String(connection.vendoUserPassword).trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserPassword" });
        }

        const productId = Number(body.productId);
        if (!Number.isFinite(productId) || productId <= 0) {
            return sendJson(res, 400, { error: "Brakuje poprawnego productId." });
        }

        const pageSize = Math.min(Math.max(Number(body.pageSize) || 200, 1), 500);
        const accessToken = await getAccessToken(connection);
        const logisticUnits = await vendoPost(connection.baseUrl, "/JednostkiLogistyczne/JednostkiLogistyczne/Lista", {
            Token: accessToken,
            Model: buildLogisticUnitsModel({
                dateFrom: body.dateFrom || "2020-01-01",
                dateTo: body.dateTo || "2030-12-31",
                pageSize,
            }),
        });

        const records = Array.isArray(logisticUnits?.Wynik?.Rekordy) ? logisticUnits.Wynik.Rekordy : [];
        const matchingUnits = records
            .map((unit) => {
                const contents = Array.isArray(unit.Zawartosc) ? unit.Zawartosc : [];
                const matches = contents.filter((item) => Number(item.TowarID) === productId);
                if (!matches.length) {
                    return null;
                }

                const totalQuantity = matches.reduce((sum, item) => sum + (Number(item.Ilosc) || 0), 0);
                const totalAvailable = matches.reduce((sum, item) => sum + (Number(item.IloscDostepna) || 0), 0);

                return {
                    JednostkaLogistycznaID: unit.JednostkaLogistycznaID,
                    Numer: unit.Numer,
                    MiejsceMagazynoweID: unit.MiejsceMagazynoweID,
                    KodMiejscaMagazynowego: unit.KodMiejscaMagazynowego,
                    PelnyNumerMiejscaMagazynowego: unit.PelnyNumerMiejscaMagazynowego,
                    MagazynID: unit.MagazynID,
                    Ilosc: totalQuantity,
                    IloscDostepna: totalAvailable,
                    Zawartosc: matches,
                };
            })
            .filter(Boolean);

        sendJson(res, 200, {
            Wynik: {
                TowarID: productId,
                Rekordy: matchingUnits,
                LiczbaJednostekLogistycznych: matchingUnits.length,
            },
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Wystapil blad podczas pobierania lokalizacji towaru.",
        });
    }
}

async function handleApiProductBatchStates(req, res) {
    try {
        const missing = requireServerConfig();
        if (missing.length) {
            return sendJson(res, 500, {
                error: `Brakuje konfiguracji serwera: ${missing.join(", ")}.`,
            });
        }

        const body = await readJsonBody(req);
        const serverConfig = getServerConfig();
        const connection = {
            baseUrl: serverConfig.apiUrl,
            apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin: body.vendoUserLogin,
            vendoUserPassword: body.vendoUserPassword,
        };

        if (!connection.vendoUserLogin || !String(connection.vendoUserLogin).trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserLogin" });
        }
        if (!connection.vendoUserPassword || !String(connection.vendoUserPassword).trim()) {
            return sendJson(res, 400, { error: "Brakuje pola: vendoUserPassword" });
        }

        if (!body.productCode || !String(body.productCode).trim()) {
            return sendJson(res, 400, { error: "Brakuje poprawnego productCode." });
        }

        const pageSize = Math.min(Math.max(Number(body.pageSize) || 100, 1), 500);
        const accessToken = await getAccessToken(connection);
        const dictionariesResponse = await vendoPost(connection.baseUrl, "/Program/VendoSlowniki/Slowniki", {
            Token: accessToken,
            Model: buildVendoDictionariesModel(),
        });
        const warehousePlaces = Array.isArray(dictionariesResponse?.Wynik?.MiejscaMagazynowe)
            ? dictionariesResponse.Wynik.MiejscaMagazynowe
            : [];
        const locationNameMap = new Map();

        for (const place of warehousePlaces) {
            const placeId = place?.ID;
            if (placeId === null || placeId === undefined || placeId === "") {
                continue;
            }

            const normalizedId = String(placeId).trim();
            if (!normalizedId || locationNameMap.has(normalizedId)) {
                continue;
            }

            locationNameMap.set(
                normalizedId,
                place.NumerPelny || place.Kod || normalizedId
            );
        }

        const partiesResponse = await vendoPost(connection.baseUrl, "/Magazyn/Partie/Partie", {
            Token: accessToken,
            Model: buildHistoricalPartiesModel({
                productCode: body.productCode,
                pageSize,
            }),
        });

        const parties = Array.isArray(partiesResponse?.Wynik?.Rekordy) ? partiesResponse.Wynik.Rekordy : [];
        const limitedParties = parties.slice(0, 30);

        const details = await Promise.all(limitedParties.map(async (party) => {
            const stateResponse = await vendoPost(connection.baseUrl, "/Partie/StanyLista", {
                Token: accessToken,
                model: {
                    Cursor: true,
                    CursorCzyZamknac: false,
                    Strona: {
                        Indeks: 0,
                        LiczbaRekordow: 20,
                    },
                    PartiaId: party.ID,
                    ZwracanePola: [
                        "PartiaId",
                        "TowarKod",
                        "TowarNazwa",
                        "DokumentId",
                        "DokumentNumer",
                        "MagazynKod",
                        "MiejsceId",
                        "Ilosc",
                        "IloscDostepna",
                        "IloscPozostala",
                        "StanHandlowy",
                        "NumerObcy",
                        "RuchyId",
                        "StanId",
                        "TowarId",
                    ],
                },
            });

            const incomeResponse = await vendoPost(connection.baseUrl, "/Partie/PrzychodyLista", {
                Token: accessToken,
                model: {
                    PartiaId: party.ID,
                    DataOd: "2020-01-01T00:00:00",
                    DataDo: "2030-12-31T23:59:59",
                },
            });

            return {
                party,
                states: Array.isArray(stateResponse?.Wynik?.Rekordy) ? stateResponse.Wynik.Rekordy : [],
                incomes: Array.isArray(incomeResponse?.Wynik?.Rekordy) ? incomeResponse.Wynik.Rekordy : [],
            };
        }));

        const mergedRecords = details.flatMap(({ party, states, incomes }) => {
            if (!states.length && !incomes.length) {
                return [{
                    PartiaId: party.ID,
                    TowarKod: party?.Towar?.Kod || body.productCode,
                    TowarNazwa: party?.Towar?.Nazwa || null,
                    MiejsceId: null,
                    MiejsceNazwa: null,
                    MagazynKod: null,
                    DokumentNumer: party.OstatniDokumentNumer || party.PierwszyDokumentNumer || null,
                    Ilosc: party.Stan || 0,
                    IloscDostepna: party.Stan || 0,
                    IloscPozostala: party.Stan || 0,
                    StanHandlowy: party.StanHandlowy || 0,
                    Zrodlo: "Partia",
                }];
            }

            return states.map((state, index) => {
                const income = incomes[index] || incomes.find((item) => item.DokumentId === state.DokumentId) || null;
                return {
                    PartiaId: party.ID,
                    TowarKod: state.TowarKod || party?.Towar?.Kod || body.productCode,
                    TowarNazwa: state.TowarNazwa || party?.Towar?.Nazwa || null,
                    MiejsceId: state.MiejsceId || null,
                    MiejsceNazwa: locationNameMap.get(String(state.MiejsceId ?? "").trim()) || state.MiejsceId || null,
                    MagazynKod: state.MagazynKod || null,
                    DokumentNumer: state.DokumentNumer || income?.DokumentNr || party.OstatniDokumentNumer || null,
                    Ilosc: Number(state.Ilosc) || 0,
                    IloscDostepna: Number(state.IloscDostepna) || 0,
                    IloscPozostala: Number(state.IloscPozostala) || 0,
                    StanHandlowy: Number(state.StanHandlowy) || 0,
                    DataPrzychodu: income?.Data || null,
                    RuchyId: state.RuchyId || income?.RuchyId || null,
                    Zrodlo: "StanPartii",
                };
            });
        }).filter((item) => {
            const available = Number(item.IloscDostepna) || 0;
            const remaining = Number(item.IloscPozostala) || 0;
            const commercial = Number(item.StanHandlowy) || 0;
            const quantity = Number(item.Ilosc) || 0;

            return available > 0 || remaining > 0 || commercial > 0 || quantity > 0;
        });

        sendJson(res, 200, {
            Wynik: {
                Rekordy: mergedRecords,
                Partie: parties,
                LiczbaPartii: parties.length,
                LiczbaRekordowScalonych: mergedRecords.length,
            },
        });
    } catch (error) {
        sendJson(res, 500, {
            error: error.message || "Wystapil blad podczas pobierania partii i miejsc.",
        });
    }
}

function getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case ".html":
            return "text/html; charset=utf-8";
        case ".css":
            return "text/css; charset=utf-8";
        case ".js":
            return "application/javascript; charset=utf-8";
        case ".json":
            return "application/json; charset=utf-8";
        default:
            return "text/plain; charset=utf-8";
    }
}

function sendRedirect(res, location) {
    res.writeHead(302, { Location: location });
    res.end();
}

function resolveStaticPath(urlPath) {
    if (urlPath === "/") {
        return { redirect: "/console" };
    }

    if (urlPath === "/login") {
        return { pathname: "/login/index.html" };
    }

    if (urlPath === "/start") {
        return { redirect: "/console" };
    }

    if (urlPath === "/admin") {
        return { pathname: "/admin/index.html" };
    }

    if (urlPath === "/console") {
        return { pathname: "/console/index.html" };
    }

    if (urlPath === "/production-dashboard") {
        return { pathname: "/production-dashboard/index.html" };
    }

    if (urlPath === "/kosztykkw") {
        return { pathname: "/kosztykkw/index.html" };
    }

    if (urlPath === "/piaskownica") {
        return { pathname: "/piaskownica/index.html" };
    }

    if (urlPath === "/rentownosc") {
        return { pathname: "/rentownosc/index.html" };
    }

    if (urlPath === "/zapotrzebowanie") {
        return { pathname: "/zapotrzebowanie/index.html" };
    }

    if (urlPath === "/mes") {
        return { pathname: "/mes/index.html" };
    }

    if (urlPath === "/mes/operator") {
        return { pathname: "/mes/operator/index.html" };
    }

    if (urlPath.endsWith("/")) {
        return { pathname: `${urlPath}index.html` };
    }

    return { pathname: urlPath };
}

async function handleApiRentownoscInvoices(req, res) {
    try {
        const missing = requireServerConfig();
        if (missing.length) {
            return sendJson(res, 500, { error: `Brakuje konfiguracji serwera: ${missing.join(", ")}.` });
        }
        const body = await readJsonBody(req);
        const serverConfig = getServerConfig();
        const connection = {
            baseUrl: serverConfig.apiUrl,
            apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin: body.vendoUserLogin,
            vendoUserPassword: body.vendoUserPassword,
        };
        const accessToken = await getAccessToken(connection);

        const monthStr = String(body.month || "").trim();
        const match = monthStr.match(/^(\d{1,2})\D(\d{4})$/);
        if (!match) {
            return sendJson(res, 400, { error: "Podaj miesiac w formacie MM/RRRR, np. 03/2026." });
        }
        const month = Number(match[1]);
        const year = Number(match[2]);
        const dataOd = `${year}-${String(month).padStart(2, "0")}-01T00:00:00`;
        const lastDay = new Date(year, month, 0).getDate();
        const dataDo = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}T23:59:59`;

        // Step 1: Fetch FV invoices for the month
        const fvResponse = await vendoPost(connection.baseUrl, "/Dokumenty/Dokumenty/Lista", {
            Token: accessToken,
            Model: {
                Strona: { Indeks: 0, LiczbaRekordow: 500 },
                RodzajeID: [1],
                DataTyp: "Data1",
                DataOd: dataOd,
                DataDo: dataDo,
            },
        });
        const invoices = Array.isArray(fvResponse?.Wynik?.Rekordy) ? fvResponse.Wynik.Rekordy : [];

        // Step 2: Collect all unique SkladnikIDs (TowarID) from invoice positions
        const skladnikIdSet = new Set();
        for (const fv of invoices) {
            for (const p of (fv.Pozycje || [])) {
                const kod = p.Towar?.Kod || "";
                const id = Number(p.Towar?.ID);
                if (kod.length >= 6 && id) skladnikIdSet.add(id);
            }
        }
        const allSkladnikIds = [...skladnikIdSet];

        // Step 3: Query PozycjeDokumentowLista by SkladnikID to find KKW links for all products
        const kkwBySkladnikId = {};
        const BATCH_SIZE = 30;
        for (let i = 0; i < allSkladnikIds.length; i += BATCH_SIZE) {
            const batch = allSkladnikIds.slice(i, i + BATCH_SIZE);
            const result = await vendoPost(connection.baseUrl, "/Produkcja/KKW/PozycjeDokumentowLista", {
                Token: accessToken,
                Model: {
                    SkladnikID: batch,
                    Strona: { Indeks: 0, LiczbaRekordow: 5000 },
                    Typ: ["JawnyWyrob"],
                    ZwracanePola: ["ID", "KKWID", "KKWNumer", "SkladnikID", "SkladnikKod", "SkladnikNazwa", "Ilosc"],
                },
            }).catch(() => null);
            const recs = result?.Wynik?.Rekordy || [];
            for (const rec of recs) {
                const sid = rec.SkladnikID;
                if (!kkwBySkladnikId[sid]) kkwBySkladnikId[sid] = [];
                kkwBySkladnikId[sid].push(rec);
            }
        }

        // Step 4: For each product, pick the most recent KKW (highest KKWID)
        const latestKkwBySkladnikId = {};
        for (const [sid, recs] of Object.entries(kkwBySkladnikId)) {
            // Sort by KKWID descending — highest = most recent
            recs.sort((a, b) => b.KKWID - a.KKWID);
            latestKkwBySkladnikId[sid] = recs[0];
        }

        // Step 5: Build invoice result with KKW links
        const faktury = invoices.map(fv => {
            const pozycje = (fv.Pozycje || [])
                .filter(p => (p.Towar?.Kod || "").length >= 6)
                .map(p => {
                    const towarId = Number(p.Towar?.ID);
                    const latestKkw = latestKkwBySkladnikId[towarId];
                    const kkwLinks = latestKkw ? [{
                        KKWID: latestKkw.KKWID,
                        KKWNumer: latestKkw.KKWNumer,
                        Ilosc: latestKkw.Ilosc,
                    }] : [];
                    return {
                        Nazwa: p.Nazwa,
                        TowarKod: p.Towar?.Kod || null,
                        TowarID: p.Towar?.ID || null,
                        Ilosc: Number(p.Ilosc) || 0,
                        CenaNetto: Number(p.CenaNettoWalutaDok) || 0,
                        KkwLinks: kkwLinks,
                    };
                });

            return {
                ID: fv.ID,
                NumerPelny: fv.NumerPelny,
                Data1: fv.Data1,
                Klient1Nazwa: fv.Klient1Nazwa,
                Klient1Kod: fv.Klient1Kod,
                WartoscNetto: fv.WartoscNetto,
                WartoscBrutto: fv.WartoscBrutto,
                Pozycje: pozycje,
            };
        });

        sendJson(res, 200, {
            Miesiac: monthStr,
            DataOd: dataOd,
            DataDo: dataDo,
            Faktury: faktury,
        });
    } catch (err) {
        sendJson(res, err.statusCode || 500, { error: err.message });
    }
}

async function handleApiRentownoscKkwCosts(req, res) {
    try {
        const missing = requireServerConfig();
        if (missing.length) {
            return sendJson(res, 500, { error: `Brakuje konfiguracji serwera: ${missing.join(", ")}.` });
        }
        const body = await readJsonBody(req);
        const serverConfig = getServerConfig();
        const connection = {
            baseUrl: serverConfig.apiUrl,
            apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin: body.vendoUserLogin,
            vendoUserPassword: body.vendoUserPassword,
        };
        const accessToken = await getAccessToken(connection);

        const kkwIds = Array.isArray(body.kkwIds) ? body.kkwIds.map(Number).filter(Boolean) : [];
        if (!kkwIds.length) {
            return sendJson(res, 400, { error: "Podaj kkwIds." });
        }

        // Fetch KKW records
        const kkwRecords = await resolveKkwRecordsByIds(connection, accessToken, kkwIds, { allowMissing: true });

        // For each KKW, get report + workers for cost calculation
        const costs = {};
        const BATCH = 5;
        for (let i = 0; i < kkwRecords.length; i += BATCH) {
            const batch = kkwRecords.slice(i, i + BATCH);
            const results = await Promise.all(batch.map(async (kkw) => {
                const kkwId = Number(kkw.ID);
                try {
                    const [reportResp, workersResp] = await Promise.all([
                        vendoPost(connection.baseUrl, "/Produkcja/KKW/RaportPreTechInPost", {
                            Token: accessToken,
                            Model: buildKkwPreTechInPostModel({ kkwId, useCalcPrices: true }),
                        }),
                        vendoPost(connection.baseUrl, "/Produkcja/KKW/PracownicyWykonanLista", {
                            Token: accessToken,
                            Model: {
                                Cursor: true, CursorCzyZamknac: true,
                                Strona: { Indeks: 0, LiczbaRekordow: 500 },
                                KKWID: [kkwId],
                                ZwracanePola: ["ID", "OperacjaNazwa", "Rbh"],
                            },
                        }),
                    ]);

                    const elements = Array.isArray(reportResp?.Wynik?.Elementy) ? reportResp.Wynik.Elementy : [];
                    const materialsBranch = elements.find(e => e?.Rodzaj === "Galaz, Material");
                    const materialsCost = Number(materialsBranch?.Post?.Wartosc) || 0;

                    const quantity = Number(kkw.IloscWykonana) || Number(kkw.IloscPrzyjeta) || Number(kkw.IloscOczekiwana) || 0;

                    // Calculate operations cost using custom rates
                    const workers = Array.isArray(workersResp?.Wynik?.Rekordy) ? workersResp.Wynik.Rekordy : [];
                    let opsTotal = 0;
                    for (const w of workers) {
                        const name = w.OperacjaNazwa || "";
                        if (typeof OPERACJE_JEDNORAZOWE !== "undefined" && OPERACJE_JEDNORAZOWE.has(name)) continue;
                        const stawka = getStawkaOperacji(name);
                        opsTotal += (Number(w.Rbh) || 0) * (stawka || 0);
                    }

                    return {
                        kkwId,
                        MaterialyPostWartosc: materialsCost,
                        MaterialyNaSztuke: quantity > 0 ? materialsCost / quantity : 0,
                        OperacjeWgNowychStawek: Math.round(opsTotal * 100) / 100,
                        OperacjeWgNowychStawekNaSztuke: quantity > 0 ? Math.round((opsTotal / quantity) * 100) / 100 : 0,
                        Ilosc: quantity,
                        KkwNumer: kkw.Numer,
                    };
                } catch {
                    return { kkwId, error: true };
                }
            }));

            for (const r of results) {
                costs[r.kkwId] = r;
            }
        }

        sendJson(res, 200, { Koszty: costs });
    } catch (err) {
        sendJson(res, err.statusCode || 500, { error: err.message });
    }
}

async function handleApiSandboxInvoices(req, res) {
    try {
        const missing = requireServerConfig();
        if (missing.length) {
            return sendJson(res, 500, { error: `Brakuje konfiguracji serwera: ${missing.join(", ")}.` });
        }
        const body = await readJsonBody(req);
        const serverConfig = getServerConfig();
        const connection = {
            baseUrl: serverConfig.apiUrl,
            apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin: body.vendoUserLogin,
            vendoUserPassword: body.vendoUserPassword,
        };
        const accessToken = await getAccessToken(connection);

        const monthStr = String(body.month || "").trim();
        const match = monthStr.match(/^(\d{1,2})\D(\d{4})$/);
        if (!match) {
            return sendJson(res, 400, { error: "Podaj miesiac w formacie MM/RRRR, np. 03/2026." });
        }
        const month = Number(match[1]);
        const year = Number(match[2]);
        const dataOd = `${year}-${String(month).padStart(2, "0")}-01T00:00:00`;
        const lastDay = new Date(year, month, 0).getDate();
        const dataDo = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}T23:59:59`;

        const response = await vendoPost(connection.baseUrl, "/Dokumenty/Dokumenty/Lista", {
            Token: accessToken,
            Model: {
                Strona: { Indeks: 0, LiczbaRekordow: 500 },
                RodzajeID: [1],
                DataTyp: "Data1",
                DataOd: dataOd,
                DataDo: dataDo,
            },
        });

        const records = Array.isArray(response?.Wynik?.Rekordy) ? response.Wynik.Rekordy : [];
        sendJson(res, 200, {
            Miesiac: monthStr,
            DataOd: dataOd,
            DataDo: dataDo,
            Razem: records.length,
            Rekordy: records,
        });
    } catch (err) {
        sendJson(res, err.statusCode || 500, { error: err.message });
    }
}

function handleStatic(req, res, authContext) {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pageRequirement = getPageRequirement(requestUrl.pathname);

    if (normalizePathname(requestUrl.pathname) === "/login" && authContext?.user) {
        sendRedirect(res, buildSafeNextPath(requestUrl.searchParams.get("next"), authContext.user));
        return;
    }

    if (pageRequirement) {
        if (!authContext?.user) {
            sendRedirect(res, getLoginRedirectPath(req));
            return;
        }

        if (!hasModuleAccess(authContext.user, pageRequirement.modules)) {
            sendRedirect(res, getDefaultRouteForUser(authContext.user));
            return;
        }
    }

    const resolved = resolveStaticPath(requestUrl.pathname);
    if (resolved.redirect) {
        sendRedirect(res, resolved.redirect);
        return;
    }

    const relativePath = resolved.pathname.replace(/^[/\\]+/, "");
    const filePath = path.resolve(PUBLIC_DIR, relativePath);

    if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
        sendText(res, 403, "Forbidden");
        return;
    }

    fs.readFile(filePath, (error, file) => {
        if (error) {
            sendText(res, 404, "Not found");
            return;
        }

        res.writeHead(200, { "Content-Type": getContentType(filePath) });
        res.end(file);
    });
}

const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = normalizePathname(requestUrl.pathname);
    const authContext = resolveAuthContext(req);

    if (req.method === "POST" && pathname === "/api/auth/login") {
        await handleApiAuthLogin(req, res);
        return;
    }

    if (req.method === "POST" && pathname === "/api/auth/logout") {
        handleApiAuthLogout(req, res, authContext);
        return;
    }

    if (req.method === "GET" && pathname === "/api/auth/me") {
        handleApiAuthMe(req, res, authContext);
        return;
    }

    const apiRequirement = pathname.startsWith("/api/") && !isPublicApiRequest(req, pathname)
        ? getApiRequirement(pathname)
        : null;
    if (apiRequirement) {
        if (!authContext.user) {
            clearAuthSessionCookie(res);
            sendJson(res, 401, {
                error: "Sesja wygasla. Zaloguj sie ponownie.",
                loginUrl: getLoginRedirectPath(req),
            });
            return;
        }

        if (!hasModuleAccess(authContext.user, apiRequirement.modules)) {
            sendJson(res, 403, {
                error: "Brak dostepu do tego modulu.",
            });
            return;
        }
    }

    if (req.method === "GET" && pathname === "/api/admin/users") {
        handleApiAdminUsers(req, res);
        return;
    }

    if (req.method === "POST" && pathname === "/api/admin/users") {
        await handleApiAdminUsersCreate(req, res);
        return;
    }

    const adminUserResetMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
    if (req.method === "POST" && adminUserResetMatch) {
        await handleApiAdminUserResetPassword(req, res, decodeURIComponent(adminUserResetMatch[1]));
        return;
    }

    const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (req.method === "PATCH" && adminUserMatch) {
        await handleApiAdminUserUpdate(req, res, decodeURIComponent(adminUserMatch[1]));
        return;
    }

    if (req.method === "POST" && req.url === "/api/products") {
        await handleApiProducts(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/cost-analysis") {
        await handleApiCostAnalysis(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/backorders") {
        await handleApiBackorders(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/mrp-work-costs") {
        await handleApiMrpWorkCosts(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/kkw-costs") {
        await handleApiKkwCosts(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/kkw-list") {
        await handleApiKkwList(req, res);
        return;
    }


    if (req.method === "POST" && req.url === "/api/production-order-costs") {
        await handleApiProductionOrderCosts(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/production-dashboard") {
        await handleApiProductionDashboard(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/production-overview") {
        await handleApiProductionOverview(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/mes/oven/pulse") {
        await handleApiMesOvenPulse(req, res);
        return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/mes/oven/summary")) {
        await handleApiMesOvenSummary(req, res);
        return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/mes/oven/events")) {
        await handleApiMesOvenEvents(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/mes/oven/batch/start") {
        await handleApiMesOvenBatchStart(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/mes/oven/batch/end") {
        await handleApiMesOvenBatchEnd(req, res);
        return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/mes/oven/batch/active")) {
        await handleApiMesOvenBatchActive(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/mes/oven/batch/pcs-per-panel") {
        await handleApiMesOvenBatchPcsPerPanel(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/mes/oven/batch/update") {
        await handleApiMesOvenBatchUpdate(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/mes/oven/batch/delete") {
        await handleApiMesOvenBatchDelete(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/mes/oven/events/delete") {
        await handleApiMesOvenEventsDelete(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/mes/oven/events/assign") {
        await handleApiMesOvenEventsAssign(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/mes/oven/transits/reset") {
        await handleApiMesOvenTransitsReset(req, res);
        return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/mes/oven/batch/history")) {
        await handleApiMesOvenBatchHistory(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/product-locations") {
        await handleApiProductLocations(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/product-batch-states") {
        await handleApiProductBatchStates(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/sandbox/invoices") {
        await handleApiSandboxInvoices(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/rentownosc/invoices") {
        await handleApiRentownoscInvoices(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/rentownosc/kkw-costs") {
        await handleApiRentownoscKkwCosts(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/zapotrzebowanie/details") {
        await handleApiZapotrzebowanieDetails(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/zapotrzebowanie/storage/import-access") {
        await handleApiZapotrzebowanieStorageImport(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/zapotrzebowanie/operational/header-details") {
        await handleApiZapotrzebowanieHeaderDetails(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/zapotrzebowanie/vendo/overview") {
        await handleApiZapotrzebowanieVendoOverview(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/zapotrzebowanie/vendo/header-details") {
        await handleApiZapotrzebowanieVendoHeaderDetails(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/zapotrzebowanie/vendo/component-details") {
        await handleApiZapotrzebowanieVendoComponentDetails(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/zapotrzebowanie/vendo/zw-details") {
        await handleApiZapotrzebowanieVendoZwDetails(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/zapotrzebowanie/vendo/zw-document-details") {
        await handleApiZapotrzebowanieVendoZwDocumentDetails(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/zapotrzebowanie/vendo/bom-note") {
        await handleApiZapotrzebowanieVendoBomNote(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/zapotrzebowanie/report-note") {
        await handleApiZapotrzebowanieReportNote(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/zapotrzebowanie/report-pcs-per-panel") {
        await handleApiZapotrzebowanieReportPcsPerPanel(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/zapotrzebowanie") {
        await handleApiZapotrzebowanie(req, res);
        return;
    }

    if (req.method === "GET" && req.url === "/api/zapotrzebowanie/operational/overview") {
        await handleApiZapotrzebowanieOperationalOverview(req, res);
        return;
    }

    if (req.method === "GET" && req.url === "/api/zapotrzebowanie/storage/meta") {
        await handleApiZapotrzebowanieStorageMeta(req, res);
        return;
    }


    if (req.method === "GET") {
        handleStatic(req, res, authContext);
        return;
    }

    sendText(res, 404, "Not found");
});

server.listen(PORT, HOST, () => {
    console.log(`Frontend Vendo startuje na http://${HOST}:${PORT}`);
});
