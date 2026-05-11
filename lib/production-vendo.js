const fs = require("fs");
const path = require("path");
const {
    getMesStorageMeta,
    getOvenSummary,
    listOvenBatches,
    listOvenPulses,
} = require("./mes-sqlite");

const ROOT_DIR = path.resolve(__dirname, "..");
const START_LOCAL_PATH = path.join(ROOT_DIR, "start-local.ps1");

let cachedLocalConfig = null;
let cachedAccessToken = null;

function parseStartLocalConfig() {
    if (cachedLocalConfig) {
        return cachedLocalConfig;
    }

    const defaults = {
        VENDO_API_URL: "",
        VENDO_API_LOGIN: "",
        VENDO_API_PASSWORD: "",
        VENDO_USER_LOGIN: "",
        VENDO_USER_PASSWORD: "",
        MES_SQLITE_DB_PATH: "",
    };

    try {
        if (!fs.existsSync(START_LOCAL_PATH)) {
            cachedLocalConfig = defaults;
            return cachedLocalConfig;
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

        cachedLocalConfig = config;
        return cachedLocalConfig;
    } catch {
        cachedLocalConfig = defaults;
        return cachedLocalConfig;
    }
}

function getProductionConfig() {
    const localConfig = parseStartLocalConfig();
    const rawMesDbPath = (
        process.env.MES_SQLITE_DB_PATH ||
        localConfig.MES_SQLITE_DB_PATH ||
        path.join(".data", "mes.db")
    ).trim();

    return {
        apiUrl: (process.env.VENDO_API_URL || localConfig.VENDO_API_URL || "").trim(),
        apiLogin: (process.env.VENDO_API_LOGIN || localConfig.VENDO_API_LOGIN || "").trim(),
        apiPassword: process.env.VENDO_API_PASSWORD || localConfig.VENDO_API_PASSWORD || "",
        vendoUserLogin: (process.env.VENDO_USER_LOGIN || localConfig.VENDO_USER_LOGIN || "").trim(),
        vendoUserPassword: process.env.VENDO_USER_PASSWORD || localConfig.VENDO_USER_PASSWORD || "",
        mesDbPath: path.isAbsolute(rawMesDbPath)
            ? rawMesDbPath
            : path.resolve(ROOT_DIR, rawMesDbPath),
    };
}

function getConnection() {
    const config = getProductionConfig();
    return {
        baseUrl: config.apiUrl,
        apiLogin: config.apiLogin,
        apiPassword: config.apiPassword,
        vendoUserLogin: config.vendoUserLogin,
        vendoUserPassword: config.vendoUserPassword,
    };
}

function requireVendoConfig() {
    const config = getProductionConfig();
    const missing = [];
    if (!config.apiUrl) missing.push("VENDO_API_URL");
    if (!config.apiLogin) missing.push("VENDO_API_LOGIN");
    if (!config.apiPassword) missing.push("VENDO_API_PASSWORD");
    if (!config.vendoUserLogin) missing.push("VENDO_USER_LOGIN");
    if (!config.vendoUserPassword) missing.push("VENDO_USER_PASSWORD");
    if (missing.length) {
        throw new Error(`Brakuje konfiguracji Vendo dla MCP: ${missing.join(", ")}.`);
    }
}

function normalizeLimit(value, fallback = 20, max = 200) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }

    return Math.max(1, Math.min(Math.trunc(numeric), max));
}

function normalizeKkwNumber(value) {
    const raw = String(value || "").trim();
    if (!raw) {
        return "";
    }

    if (raw.includes("|")) {
        const parts = raw.split("|").map((part) => part.trim()).filter(Boolean);
        const kkwPart = parts.find((part) => /^\d+\/\d+$/.test(part));
        return kkwPart || parts[parts.length - 1] || raw;
    }

    return raw.replace(/^KKW[:\s-]*/i, "").trim().toUpperCase();
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

function round(value, digits = 2) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }

    const factor = 10 ** digits;
    return Math.round(numeric * factor) / factor;
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
    const cacheKey = [
        connection.baseUrl,
        connection.apiLogin,
        connection.vendoUserLogin,
    ].join("::").toLowerCase();

    if (cachedAccessToken?.cacheKey === cacheKey && cachedAccessToken.expiresAt > Date.now()) {
        return cachedAccessToken.token;
    }

    const apiAuth = await vendoPost(connection.baseUrl, "/Autoryzacja/Zaloguj", {
        Model: {
            Login: connection.apiLogin,
            Haslo: connection.apiPassword,
        },
    });

    const apiToken = apiAuth?.Wynik?.Token;
    if (!apiToken) {
        throw new Error("Nie udalo sie uzyskac tokenu API Vendo.");
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
        throw new Error("Nie udalo sie uzyskac tokenu uzytkownika Vendo.");
    }

    cachedAccessToken = {
        cacheKey,
        token: accessToken,
        expiresAt: Date.now() + 10 * 60 * 1000,
    };

    return accessToken;
}

async function withVendoSession(handler) {
    requireVendoConfig();
    const connection = getConnection();
    const accessToken = await getAccessToken(connection);
    return handler(connection, accessToken);
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
            "TowarKod",
            "TowarNazwa",
            "PozycjaZleceniaID",
            "PozycjaZleceniaNazwa",
            "TerminZakonczeniaKKW",
        ],
    };
}

async function resolveKkwRecordsByNumbers(connection, accessToken, numbers, { allowMissing = false } = {}) {
    const normalizedNumbers = (Array.isArray(numbers) ? numbers : [numbers])
        .map(normalizeKkwNumber)
        .filter(Boolean);

    if (!normalizedNumbers.length) {
        return [];
    }

    const response = await vendoPost(connection.baseUrl, "/Produkcja/KKW/Lista", {
        Token: accessToken,
        Model: {
            Cursor: true,
            CursorCzyZamknac: true,
            Strona: {
                Indeks: 0,
                LiczbaRekordow: Math.max(normalizedNumbers.length * 5, 20),
            },
            FiltrUniwersalny: normalizedNumbers.join(" "),
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
                "TowarKod",
                "TowarNazwa",
                "PozycjaZleceniaID",
                "PozycjaZleceniaNazwa",
                "TerminZakonczeniaKKW",
            ],
        },
    });

    const records = Array.isArray(response?.Wynik?.Rekordy) ? response.Wynik.Rekordy : [];
    const byNumber = new Map(
        records
            .filter((item) => item?.Numer)
            .map((item) => [String(item.Numer).trim().toUpperCase(), item])
    );

    const missing = normalizedNumbers.filter((number) => !byNumber.has(number));
    if (!allowMissing && missing.length) {
        throw new Error(`Nie znaleziono KKW o numerze: ${missing.join(", ")}`);
    }

    if (allowMissing) {
        return normalizedNumbers.map((number) => byNumber.get(number)).filter(Boolean);
    }

    return normalizedNumbers.map((number) => byNumber.get(number));
}

async function resolveKkwRecordsByIds(connection, accessToken, ids, { allowMissing = false } = {}) {
    const normalizedIds = (Array.isArray(ids) ? ids : [ids])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);

    if (!normalizedIds.length) {
        return [];
    }

    const response = await vendoPost(connection.baseUrl, "/Produkcja/KKW/Lista", {
        Token: accessToken,
        Model: buildKkwLookupByIdsModel({
            ids: normalizedIds,
            pageSize: Math.max(normalizedIds.length * 2, 20),
        }),
    });

    const records = Array.isArray(response?.Wynik?.Rekordy) ? response.Wynik.Rekordy : [];
    const byId = new Map(
        records
            .filter((item) => Number.isInteger(Number(item?.ID)))
            .map((item) => [Number(item.ID), item])
    );

    const missing = normalizedIds.filter((id) => !byId.has(id));
    if (!allowMissing && missing.length) {
        throw new Error(`Nie znaleziono KKW o ID: ${missing.join(", ")}`);
    }

    if (allowMissing) {
        return normalizedIds.map((id) => byId.get(id)).filter(Boolean);
    }

    return normalizedIds.map((id) => byId.get(id));
}

function buildKkwMaterialsModel({ kkwId, pageSize }) {
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
            "Stan",
        ],
    };
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
    if (Number.isInteger(normalizedKkwId) && normalizedKkwId > 0) {
        model.KKWID = [normalizedKkwId];
    }

    const normalizedOperationId = Number(operationId);
    if (Number.isInteger(normalizedOperationId) && normalizedOperationId > 0) {
        model.OperacjaKKWID = [normalizedOperationId];
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
    if (Number.isInteger(normalizedKkwId) && normalizedKkwId > 0) {
        model.KKWID = [normalizedKkwId];
    }

    const normalizedOperationId = Number(operationId);
    if (Number.isInteger(normalizedOperationId) && normalizedOperationId > 0) {
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

function buildCzasozliczarkaListModel({ operatorName, pageSize }) {
    const model = {
        Cursor: true,
        CursorCzyZamknac: false,
        Strona: {
            Indeks: 0,
            LiczbaRekordow: Number.isFinite(pageSize) ? pageSize : 200,
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

function buildKkwCostEstimateModel({ kkwId }) {
    return {
        ID: Number(kkwId),
        IloscOperacjiWg: "Mh",
    };
}

function buildKkwPreTechInPostModel({ kkwId }) {
    return {
        KKWID: [Number(kkwId)],
        InWgCenyKalkulacyjnej: true,
    };
}

function buildProductionOrderCostModel({ orderId }) {
    return {
        ZlecenieId: [Number(orderId)],
    };
}

async function listKkws({ search = "", page = 0, limit = 50 } = {}) {
    return withVendoSession(async (connection, accessToken) => {
        const pageSize = normalizeLimit(limit, 50, 100);
        const pageIndex = Math.max(0, Number(page) || 0);
        const searchText = String(search || "").trim();
        const model = {
            Cursor: true,
            CursorCzyZamknac: false,
            Strona: { Indeks: 0, LiczbaRekordow: 1 },
            ZwracanePola: [
                "ID",
                "Numer",
                "TowarNazwa",
                "TowarKod",
                "IloscOczekiwana",
                "IloscWykonana",
                "TerminZakonczeniaKKW",
                "ZlecenieNumer",
                "PozycjaZleceniaNazwa",
                "ZlecenieKontrahentNazwa",
            ],
        };

        if (searchText) {
            model.FiltrUniwersalny = searchText;
            model.FiltrUniwersalnyPola = [
                "Numer",
                "TowarNazwa",
                "TowarKod",
                "PozycjaZleceniaNazwa",
                "ZlecenieNumer",
                "ZlecenieKontrahentNazwa",
            ];
        }

        const countResponse = await vendoPost(connection.baseUrl, "/Produkcja/KKW/Lista", {
            Token: accessToken,
            Model: model,
        });
        const total = Number(countResponse?.Wynik?.Cursor?.LiczbaWszystkichRekordow) || 0;
        const cursorName = String(countResponse?.Wynik?.Cursor?.Nazwa || "");

        if (!cursorName || !total) {
            const fallbackResponse = await vendoPost(connection.baseUrl, "/Produkcja/KKW/Lista", {
                Token: accessToken,
                Model: {
                    ...model,
                    Cursor: true,
                    CursorCzyZamknac: true,
                    Strona: { Indeks: 0, LiczbaRekordow: Math.max(pageSize, 100) },
                },
            });
            const allRecords = Array.isArray(fallbackResponse?.Wynik?.Rekordy) ? fallbackResponse.Wynik.Rekordy : [];
            allRecords.sort((left, right) => (Number(right?.ID) || 0) - (Number(left?.ID) || 0));
            const start = pageIndex * pageSize;
            return {
                records: allRecords.slice(start, start + pageSize),
                page: pageIndex,
                limit: pageSize,
                total: allRecords.length,
                hasMore: start + pageSize < allRecords.length,
            };
        }

        const targetOffset = Math.max(0, total - ((pageIndex + 1) * pageSize));
        const fetchSize = Math.min(pageSize, total - (pageIndex * pageSize));
        const response = await vendoPost(connection.baseUrl, "/Produkcja/KKW/Lista", {
            Token: accessToken,
            Model: {
                ...model,
                CursorNazwa: cursorName,
                CursorCzyZamknac: true,
                Strona: {
                    Indeks: targetOffset,
                    LiczbaRekordow: fetchSize > 0 ? fetchSize : pageSize,
                },
            },
        });

        const records = Array.isArray(response?.Wynik?.Rekordy) ? response.Wynik.Rekordy : [];
        records.reverse();
        return {
            records,
            page: pageIndex,
            limit: pageSize,
            total,
            hasMore: targetOffset > 0,
        };
    });
}

function summarizeKkw({ kkwRecord, materials, estimate, reportElements, workers, operations, executions, orderCost }) {
    const root = reportElements.find((item) => item?.Rodzaj === "Korzen") || null;
    const branches = reportElements.filter((item) => typeof item?.Rodzaj === "string" && item.Rodzaj.startsWith("Galaz"));
    const leaves = reportElements.filter((item) => typeof item?.Rodzaj === "string" && item.Rodzaj.startsWith("Lisc"));
    const materialsBranch = branches.find((item) => item?.Rodzaj === "Galaz, Material") || null;
    const operationsBranch = branches.find((item) => item?.Rodzaj === "Galaz, Operacja") || null;
    const materialLeaves = leaves.filter((item) => item?.Rodzaj === "Lisc, Material");
    const operationLeaves = leaves.filter((item) => item?.Rodzaj === "Lisc, Operacja");
    const quantity =
        Number(kkwRecord?.IloscWykonana) ||
        Number(kkwRecord?.IloscPrzyjeta) ||
        Number(kkwRecord?.IloscOczekiwana) ||
        0;
    const totalCost = Number(root?.Post?.Wartosc) || 0;
    const materialsCost = Number(materialsBranch?.Post?.Wartosc) || 0;
    const operationsCost = Number(operationsBranch?.Post?.Wartosc) || 0;
    const materialCostFromRows = materials.reduce(
        (sum, item) => sum + ((Number(item?.IloscZWykonania) || 0) * (Number(item?.CenaKalkulacyjna) || 0)),
        0
    );
    const laborHours = workers.reduce((sum, item) => sum + (Number(item?.Rbh) || 0), 0);
    const activeExecutions = executions.filter((item) => !item?.DataZakonczenia || normalizeText(item?.Stan) === "trwajace");
    const progressPercent = Number(kkwRecord?.IloscOczekiwana) > 0
        ? (Number(kkwRecord?.IloscWykonana || 0) / Number(kkwRecord?.IloscOczekiwana)) * 100
        : 0;

    const operationSummary = operations.map((operation) => {
        const plannedGood = Number(operation?.IloscPlanowanaDobrych) || 0;
        const registeredGood = Number(operation?.IloscZarejestrowanaDobrych) || 0;
        const defects = (Number(operation?.IloscZarejestrowanaBrakowNaprawialnych) || 0)
            + (Number(operation?.IloscZarejestrowanaBrakowNienaprawialnych) || 0);
        return {
            id: operation?.ID || null,
            name: operation?.Nazwa || null,
            lp: operation?.Lp || null,
            stationCode: operation?.DomyslneStanowiskoKod || null,
            expectedRate: Number(operation?.Wydajnosc) || 0,
            plannedGood,
            registeredGood,
            defects,
            progressPercent: plannedGood > 0 ? round((registeredGood / plannedGood) * 100, 1) : 0,
            active: Boolean(operation?.AktualnieWykonywane),
            status: operation?.Stan || null,
        };
    });

    const risks = [];
    if (Number(kkwRecord?.IloscOczekiwana) > 0 && progressPercent < 100) {
        const due = parseVendoDate(kkwRecord?.TerminZakonczeniaKKW);
        if (due && due.getTime() < Date.now()) {
            risks.push({
                level: "high",
                type: "term",
                message: `KKW ${kkwRecord?.Numer} jest po terminie i ma wykonanie ${round(progressPercent, 1)}%.`,
            });
        }
    }

    for (const operation of operationSummary) {
        if (operation.defects > 0) {
            risks.push({
                level: "medium",
                type: "defects",
                message: `${operation.name}: zarejestrowano braki ${operation.defects}.`,
            });
        }
        if (operation.plannedGood > 0 && operation.progressPercent < 80 && operation.status && normalizeText(operation.status).includes("zakon")) {
            risks.push({
                level: "medium",
                type: "operation-progress",
                message: `${operation.name}: operacja wyglada na zakonczona, ale wykonanie to ${operation.progressPercent}%.`,
            });
        }
    }

    return {
        kkw: {
            id: Number(kkwRecord?.ID) || null,
            number: kkwRecord?.Numer || null,
            orderId: Number(kkwRecord?.ZlecenieID) || null,
            orderNumber: kkwRecord?.ZlecenieNumer || null,
            productCode: kkwRecord?.TowarKod || null,
            productName: kkwRecord?.TowarNazwa || kkwRecord?.PozycjaZleceniaNazwa || null,
            dueDate: kkwRecord?.TerminZakonczeniaKKW || null,
            plannedQuantity: Number(kkwRecord?.IloscOczekiwana) || 0,
            completedQuantity: Number(kkwRecord?.IloscWykonana) || 0,
            acceptedQuantity: Number(kkwRecord?.IloscPrzyjeta) || 0,
            progressPercent: round(progressPercent, 1),
        },
        costs: {
            totalCost: round(totalCost),
            materialsCost: round(materialsCost),
            operationsCost: round(operationsCost),
            materialCostFromRows: round(materialCostFromRows),
            estimateMaterialsCost: Number(estimate?.Materialy?.Wartosc) || null,
            unitCost: quantity > 0 ? round(totalCost / quantity) : 0,
            materialUnitCost: quantity > 0 ? round(materialsCost / quantity) : 0,
            operationUnitCost: quantity > 0 ? round(operationsCost / quantity) : 0,
            orderCostSummary: orderCost?.Podsumowanie || null,
        },
        production: {
            materialRows: materials.length,
            materialLeaves: materialLeaves.length,
            operationLeaves: operationLeaves.length,
            laborHours: round(laborHours, 4),
            workers: workers.length,
            operations: operationSummary,
            activeExecutions: activeExecutions.map((item) => ({
                id: item?.ID || null,
                operationName: item?.OperacjaNazwa || null,
                stationCode: item?.StanowiskoKod || null,
                startedAt: item?.DataRozpoczecia || null,
                kind: item?.Rodzaj || null,
                status: item?.Stan || null,
            })),
        },
        risks,
    };
}

async function getKkwDetails({ kkwNumber, includeRaw = false } = {}) {
    return withVendoSession(async (connection, accessToken) => {
        const [kkwRecord] = await resolveKkwRecordsByNumbers(connection, accessToken, [kkwNumber]);
        const kkwId = Number(kkwRecord?.ID);
        if (!Number.isInteger(kkwId)) {
            throw new Error(`Nie znaleziono ID KKW dla numeru: ${kkwNumber}`);
        }

        const [
            materialsResponse,
            estimateResponse,
            reportResponse,
            workersResponse,
            operationsResponse,
            executionsResponse,
            orderCostResponse,
        ] = await Promise.all([
            vendoPost(connection.baseUrl, "/Produkcja/KKW/MaterialowkaLista", {
                Token: accessToken,
                Model: buildKkwMaterialsModel({ kkwId, pageSize: 500 }),
            }),
            vendoPost(connection.baseUrl, "/Produkcja/KKW/SzacowanieKosztow", {
                Token: accessToken,
                Model: buildKkwCostEstimateModel({ kkwId }),
            }),
            vendoPost(connection.baseUrl, "/Produkcja/KKW/RaportPreTechInPost", {
                Token: accessToken,
                Model: buildKkwPreTechInPostModel({ kkwId }),
            }),
            vendoPost(connection.baseUrl, "/Produkcja/KKW/PracownicyWykonanLista", {
                Token: accessToken,
                Model: buildKkwWorkersModel({ kkwId, pageSize: 500 }),
            }),
            vendoPost(connection.baseUrl, "/Produkcja/KKW/OperacjeLista", {
                Token: accessToken,
                Model: buildKkwOperationsModel({ kkwId, pageSize: 200 }),
            }),
            vendoPost(connection.baseUrl, "/Produkcja/KKW/WykonaniaLista", {
                Token: accessToken,
                Model: buildKkwExecutionsModel({ kkwId, pageSize: 500 }),
            }),
            Number.isInteger(Number(kkwRecord?.ZlecenieID))
                ? vendoPost(connection.baseUrl, "/Produkcja/Zlecenie/KosztZlecenia", {
                    Token: accessToken,
                    Model: buildProductionOrderCostModel({ orderId: Number(kkwRecord.ZlecenieID) }),
                }).catch((error) => ({ error: error.message }))
                : Promise.resolve(null),
        ]);

        const materials = Array.isArray(materialsResponse?.Wynik?.Rekordy) ? materialsResponse.Wynik.Rekordy : [];
        const estimate = estimateResponse?.Wynik || {};
        const reportElements = Array.isArray(reportResponse?.Wynik?.Elementy) ? reportResponse.Wynik.Elementy : [];
        const workers = Array.isArray(workersResponse?.Wynik?.Rekordy) ? workersResponse.Wynik.Rekordy : [];
        const operations = Array.isArray(operationsResponse?.Wynik?.Rekordy) ? operationsResponse.Wynik.Rekordy : [];
        const executions = Array.isArray(executionsResponse?.Wynik?.Rekordy) ? executionsResponse.Wynik.Rekordy : [];
        const orderCost = orderCostResponse?.Wynik || null;
        const summary = summarizeKkw({
            kkwRecord,
            materials,
            estimate,
            reportElements,
            workers,
            operations,
            executions,
            orderCost,
        });

        return includeRaw
            ? {
                ...summary,
                raw: {
                    kkwRecord,
                    materials,
                    estimate,
                    reportElements,
                    workers,
                    operations,
                    executions,
                    orderCost,
                },
            }
            : summary;
    });
}

async function getProductionOverview({ operatorName = "", limit = 50, includeOperations = true } = {}) {
    return withVendoSession(async (connection, accessToken) => {
        const normalizedLimit = normalizeLimit(limit, 50, 100);
        const worklogResponse = await vendoPost(connection.baseUrl, "/Pracownicy/Czasozliczarka/Lista", {
            Token: accessToken,
            Model: buildCzasozliczarkaListModel({
                operatorName,
                pageSize: Math.max(normalizedLimit, 100),
            }),
        });

        const worklogs = Array.isArray(worklogResponse?.Wynik?.Rekordy) ? worklogResponse.Wynik.Rekordy : [];
        const activeWorklogs = worklogs
            .filter((item) => item?.AktualnieWykonywana)
            .sort((left, right) => String(right?.DataCzasRozpoczecia || "").localeCompare(String(left?.DataCzasRozpoczecia || "")));
        const productionWorklogs = activeWorklogs
            .filter((item) => Number(item?.ObiektPowiazanyDataType) === 156 && Number(item?.ObiektPowiazanyID) > 0)
            .slice(0, normalizedLimit);
        const workerIds = [...new Set(productionWorklogs
            .map((item) => Number(item?.ObiektPowiazanyID))
            .filter((id) => Number.isInteger(id) && id > 0))];

        const workersResponse = workerIds.length
            ? await vendoPost(connection.baseUrl, "/Produkcja/KKW/PracownicyWykonanLista", {
                Token: accessToken,
                Model: buildKkwWorkersModel({
                    ids: workerIds,
                    pageSize: Math.max(workerIds.length + 20, 50),
                }),
            })
            : { Wynik: { Rekordy: [] } };
        const workers = Array.isArray(workersResponse?.Wynik?.Rekordy) ? workersResponse.Wynik.Rekordy : [];
        const workerById = new Map(workers.map((item) => [Number(item?.ID), item]));
        const executionIds = [...new Set(workers
            .map((item) => Number(item?.WykonanieKKWID))
            .filter((id) => Number.isInteger(id) && id > 0))];
        const kkwIdsFromWorkers = [...new Set(workers
            .map((item) => Number(item?.KKWID))
            .filter((id) => Number.isInteger(id) && id > 0))];

        const [executionsResponse, kkwRecords] = await Promise.all([
            executionIds.length
                ? vendoPost(connection.baseUrl, "/Produkcja/KKW/WykonaniaLista", {
                    Token: accessToken,
                    Model: buildKkwExecutionsModel({
                        ids: executionIds,
                        pageSize: Math.max(executionIds.length + 20, 50),
                    }),
                })
                : Promise.resolve({ Wynik: { Rekordy: [] } }),
            resolveKkwRecordsByIds(connection, accessToken, kkwIdsFromWorkers, { allowMissing: true }),
        ]);
        const executions = Array.isArray(executionsResponse?.Wynik?.Rekordy) ? executionsResponse.Wynik.Rekordy : [];
        const executionById = new Map(executions.map((item) => [Number(item?.ID), item]));
        const kkwById = new Map(kkwRecords.map((item) => [Number(item?.ID), item]));

        const operationByKkwAndOperation = new Map();
        if (includeOperations) {
            const uniqueKkwIds = [...new Set(kkwIdsFromWorkers)].slice(0, 30);
            for (const kkwId of uniqueKkwIds) {
                const operationsResponse = await vendoPost(connection.baseUrl, "/Produkcja/KKW/OperacjeLista", {
                    Token: accessToken,
                    Model: buildKkwOperationsModel({ kkwId, pageSize: 200 }),
                }).catch(() => ({ Wynik: { Rekordy: [] } }));
                const operations = Array.isArray(operationsResponse?.Wynik?.Rekordy) ? operationsResponse.Wynik.Rekordy : [];
                for (const operation of operations) {
                    operationByKkwAndOperation.set(`${kkwId}:${Number(operation?.ID)}`, operation);
                }
            }
        }

        const records = productionWorklogs.map((worklog) => {
            const worker = workerById.get(Number(worklog?.ObiektPowiazanyID)) || null;
            const execution = executionById.get(Number(worker?.WykonanieKKWID)) || null;
            const kkwId = Number(worker?.KKWID || execution?.KKWID) || null;
            const operationId = Number(worker?.OperacjaID || execution?.OperacjaID) || null;
            const kkwRecord = kkwId ? kkwById.get(kkwId) || null : null;
            const operation = kkwId && operationId ? operationByKkwAndOperation.get(`${kkwId}:${operationId}`) || null : null;
            const startedAt = parseVendoDate(worker?.DataRozpoczecia || execution?.DataRozpoczecia || worklog?.DataCzasRozpoczecia);
            const elapsedHours = startedAt ? Math.max((Date.now() - startedAt.getTime()) / 36e5, 0) : null;
            const plannedQuantity = Number(operation?.IloscPlanowanaDobrych ?? kkwRecord?.IloscOczekiwana ?? 0) || 0;
            const completedQuantity = Number(operation?.IloscZarejestrowanaDobrych ?? kkwRecord?.IloscWykonana ?? 0) || 0;
            const expectedRate = Number(operation?.Wydajnosc) || 0;
            const actualRate = elapsedHours && elapsedHours > 0 ? completedQuantity / elapsedHours : 0;
            const efficiencyPercent = expectedRate > 0 ? (actualRate / expectedRate) * 100 : 0;
            const progressPercent = plannedQuantity > 0 ? (completedQuantity / plannedQuantity) * 100 : 0;

            let status = "Brak normy";
            let statusTone = "idle";
            if (expectedRate > 0 && actualRate > 0) {
                if (efficiencyPercent >= 105) {
                    status = "Powyzej normy";
                    statusTone = "success";
                } else if (efficiencyPercent >= 85) {
                    status = "W normie";
                    statusTone = "warning";
                } else {
                    status = "Ryzyko opoznienia";
                    statusTone = "error";
                }
            }

            return {
                id: `${worklog?.ID || worker?.ID || execution?.ID || Math.random()}`,
                kkw: {
                    id: kkwId,
                    number: kkwRecord?.Numer || worker?.KKWNumer || execution?.KKWNumer || worklog?.ObiektPowiazanyNumer || null,
                    orderNumber: kkwRecord?.ZlecenieNumer || worklog?.ZlecenieNumer || null,
                    productCode: kkwRecord?.TowarKod || null,
                    productName: kkwRecord?.TowarNazwa || kkwRecord?.PozycjaZleceniaNazwa || null,
                    plannedQuantity: Number(kkwRecord?.IloscOczekiwana) || 0,
                    completedQuantity: Number(kkwRecord?.IloscWykonana) || 0,
                },
                operator: {
                    name: worklog?.PracownikImieNazwisko
                        || [worker?.PracownikImie, worker?.PracownikNazwisko].filter(Boolean).join(" ")
                        || null,
                    login: worker?.PracownikLogin || null,
                },
                operation: {
                    id: operationId || null,
                    name: operation?.Nazwa || worker?.OperacjaNazwa || execution?.OperacjaNazwa || worklog?.ObiektPowiazanyOpis || null,
                    lp: operation?.Lp || worker?.OperacjaLp || execution?.OperacjaLp || null,
                    expectedRate,
                    plannedQuantity,
                    completedQuantity,
                },
                station: {
                    id: execution?.StanowiskoID || operation?.DomyslneStanowiskoID || null,
                    code: execution?.StanowiskoKod || operation?.DomyslneStanowiskoKod || null,
                    name: execution?.StanowiskoNazwa || operation?.DomyslneStanowiskoNazwa || null,
                },
                metrics: {
                    startedAt: startedAt ? startedAt.toISOString() : null,
                    elapsedHours: elapsedHours === null ? null : round(elapsedHours, 3),
                    progressPercent: round(progressPercent, 1),
                    expectedRate,
                    actualRate: round(actualRate, 2),
                    efficiencyPercent: round(efficiencyPercent, 1),
                    status,
                    statusTone,
                },
                execution: {
                    id: execution?.ID || null,
                    kind: execution?.Rodzaj || null,
                    status: execution?.Stan || null,
                    startedAt: execution?.DataRozpoczecia || null,
                    endedAt: execution?.DataZakonczenia || null,
                },
                worklog: {
                    id: worklog?.ID || null,
                    startedAt: worklog?.DataCzasRozpoczecia || null,
                    topic: worklog?.Temat || null,
                },
            };
        });

        const stationSet = new Set(records.map((item) => item.station.code || item.station.name).filter(Boolean));
        const operatorSet = new Set(records.map((item) => item.operator.name).filter(Boolean));
        const kkwSet = new Set(records.map((item) => item.kkw.number).filter(Boolean));

        return {
            generatedAt: new Date().toISOString(),
            summary: {
                activeWorklogs: activeWorklogs.length,
                productionWorklogs: productionWorklogs.length,
                activeStations: stationSet.size,
                activeOperators: operatorSet.size,
                activeKkws: kkwSet.size,
            },
            records,
            debug: {
                workerIds: workerIds.length,
                workers: workers.length,
                executions: executions.length,
                kkwRecords: kkwRecords.length,
            },
        };
    });
}

function getMesOverview({ deviceId = "reflow_1", eventsLimit = 50, batchesLimit = 20 } = {}) {
    const config = getProductionConfig();
    const normalizedDeviceId = String(deviceId || "reflow_1").trim() || "reflow_1";
    return {
        storage: getMesStorageMeta(config.mesDbPath),
        summary: getOvenSummary(config.mesDbPath, { deviceId: normalizedDeviceId }),
        batches: listOvenBatches(config.mesDbPath, {
            deviceId: normalizedDeviceId,
            limit: normalizeLimit(batchesLimit, 20, 200),
        }),
        events: listOvenPulses(config.mesDbPath, {
            deviceId: normalizedDeviceId,
            limit: normalizeLimit(eventsLimit, 50, 500),
        }),
    };
}

async function getProductionRiskReport({ deviceId = "reflow_1", limit = 50 } = {}) {
    const [overviewResult, mesResult] = await Promise.allSettled([
        getProductionOverview({ limit, includeOperations: true }),
        Promise.resolve(getMesOverview({ deviceId, eventsLimit: 20, batchesLimit: 20 })),
    ]);

    const overview = overviewResult.status === "fulfilled" ? overviewResult.value : null;
    const mes = mesResult.status === "fulfilled" ? mesResult.value : null;
    const risks = [];
    const opportunities = [];

    if (overviewResult.status === "rejected") {
        risks.push({
            level: "medium",
            area: "vendo",
            message: overviewResult.reason?.message || "Nie udalo sie pobrac aktywnej produkcji z Vendo.",
        });
    }

    if (mesResult.status === "rejected") {
        risks.push({
            level: "medium",
            area: "mes",
            message: mesResult.reason?.message || "Nie udalo sie pobrac danych MES.",
        });
    }

    for (const record of overview?.records || []) {
        const efficiency = Number(record?.metrics?.efficiencyPercent) || 0;
        if (record?.operation?.expectedRate && efficiency > 0 && efficiency < 85) {
            risks.push({
                level: efficiency < 60 ? "high" : "medium",
                area: "wydajnosc",
                kkw: record?.kkw?.number || null,
                station: record?.station?.code || record?.station?.name || null,
                operator: record?.operator?.name || null,
                message: `${record?.operation?.name || "Operacja"} ma wydajnosc ${round(efficiency, 1)}% normy.`,
            });
        }

        if (!record?.operation?.expectedRate) {
            opportunities.push({
                area: "normy",
                kkw: record?.kkw?.number || null,
                message: `${record?.operation?.name || "Operacja"} nie ma normy wydajnosci, analiza ryzyka jest slabsza.`,
            });
        }
    }

    const summary = mes?.summary || null;
    if (summary) {
        if (summary.secondsSinceLastPulse !== null && summary.secondsSinceLastPulse > 120) {
            risks.push({
                level: summary.secondsSinceLastPulse > 600 ? "high" : "medium",
                area: "mes-przeplyw",
                message: `Piec ${summary.deviceId} bez impulsu od ${round(summary.secondsSinceLastPulse / 60, 1)} min.`,
            });
        }

        if (Number(summary?.pendingAssignment?.count) > 0) {
            risks.push({
                level: "medium",
                area: "mes-przypisanie",
                message: `${summary.pendingAssignment.count} impulsow MES moze wymagac przypisania do partii.`,
            });
        }

        if (summary.activeBatch && summary.activeBatch.plannedQuantity && summary.activeBatch.pulseCount) {
            const progress = (Number(summary.activeBatch.kkwPulseCount || summary.activeBatch.pulseCount) / Number(summary.activeBatch.plannedQuantity)) * 100;
            if (progress > 110) {
                risks.push({
                    level: "medium",
                    area: "mes-ilosc",
                    kkw: summary.activeBatch.kkwNumber,
                    message: `MES dla KKW ${summary.activeBatch.kkwNumber} pokazuje ${round(progress, 1)}% planu.`,
                });
            }
        }
    }

    return {
        generatedAt: new Date().toISOString(),
        overviewSummary: overview?.summary || null,
        mesSummary: summary
            ? {
                deviceId: summary.deviceId,
                status: summary.status,
                activeBatch: summary.activeBatch,
                counts: summary.counts,
                entryCounts: summary.entryCounts,
                secondsSinceLastPulse: summary.secondsSinceLastPulse,
                panelsPerHourLast15m: summary.panelsPerHourLast15m,
                pcbPerHourLast15m: summary.pcbPerHourLast15m,
                averageTaktSeconds: summary.averageTaktSeconds,
                averageOvenSpeedMetersPerMinute: summary.averageOvenSpeedMetersPerMinute,
                inOvenCount: summary.inOvenCount,
            }
            : null,
        risks,
        opportunities,
    };
}

function buildLocalUrl(pathname) {
    return `http://localhost:3000${pathname}`;
}

function resultItem(id, title, url, metadata = {}) {
    return {
        id,
        title,
        url,
        metadata,
    };
}

async function searchProduction({ query = "", limit = 10 } = {}) {
    const searchText = String(query || "").trim();
    const normalizedQuery = normalizeText(searchText);
    const maxResults = normalizeLimit(limit, 10, 25);
    const results = [];
    const push = (item) => {
        if (!results.some((existing) => existing.id === item.id) && results.length < maxResults) {
            results.push(item);
        }
    };

    push(resultItem(
        "risk:production",
        "Raport ryzyk produkcji",
        buildLocalUrl("/production-dashboard"),
        { type: "risk-report" }
    ));

    if (!normalizedQuery || /(aktywn|wydajn|zagroz|zagro|problem|ryzyk|produkc|operator|stanow)/.test(normalizedQuery)) {
        push(resultItem(
            "overview:active",
            "Aktywna produkcja Vendo",
            buildLocalUrl("/production-dashboard"),
            { type: "active-production" }
        ));
    }

    if (!normalizedQuery || /(mes|piec|reflow|przeplyw|impuls|takt|posto)/.test(normalizedQuery)) {
        push(resultItem(
            "mes:summary:reflow_1",
            "MES piec reflow_1",
            buildLocalUrl("/mes"),
            { type: "mes-summary", deviceId: "reflow_1" }
        ));
    }

    const kkwNumbers = [...new Set((searchText.match(/\b\d+\/\d+\b/g) || []).map(normalizeKkwNumber))];
    for (const number of kkwNumbers) {
        push(resultItem(
            `kkw:${encodeURIComponent(number)}`,
            `KKW ${number}`,
            buildLocalUrl("/kosztykkw"),
            { type: "kkw", number }
        ));
    }

    if (searchText && results.length < maxResults) {
        try {
            const list = await listKkws({
                search: searchText,
                page: 0,
                limit: Math.max(5, maxResults - results.length),
            });
            for (const record of list.records || []) {
                const number = normalizeKkwNumber(record?.Numer);
                if (!number) {
                    continue;
                }
                push(resultItem(
                    `kkw:${encodeURIComponent(number)}`,
                    `KKW ${number} - ${record?.TowarKod || ""} ${record?.TowarNazwa || record?.PozycjaZleceniaNazwa || ""}`.trim(),
                    buildLocalUrl("/kosztykkw"),
                    {
                        type: "kkw",
                        number,
                        productCode: record?.TowarKod || null,
                        orderNumber: record?.ZlecenieNumer || null,
                        dueDate: record?.TerminZakonczeniaKKW || null,
                    }
                ));
            }
        } catch (error) {
            push(resultItem(
                "diagnostic:vendo-config",
                "Diagnostyka polaczenia Vendo dla MCP",
                buildLocalUrl("/console"),
                { type: "diagnostic", error: error.message }
            ));
        }
    }

    return { results };
}

function asPrettyJson(value) {
    return JSON.stringify(value, null, 2);
}

async function fetchProduction(id) {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) {
        throw new Error("Brakuje identyfikatora do pobrania.");
    }

    if (normalizedId === "risk:production") {
        const data = await getProductionRiskReport({});
        return {
            id: normalizedId,
            title: "Raport ryzyk produkcji",
            url: buildLocalUrl("/production-dashboard"),
            text: `Raport ryzyk produkcji\n\n${asPrettyJson(data)}`,
            metadata: { type: "risk-report", generatedAt: data.generatedAt },
        };
    }

    if (normalizedId === "overview:active") {
        const data = await getProductionOverview({});
        return {
            id: normalizedId,
            title: "Aktywna produkcja Vendo",
            url: buildLocalUrl("/production-dashboard"),
            text: `Aktywna produkcja Vendo\n\n${asPrettyJson(data)}`,
            metadata: { type: "active-production", generatedAt: data.generatedAt },
        };
    }

    if (normalizedId.startsWith("mes:summary:")) {
        const deviceId = decodeURIComponent(normalizedId.slice("mes:summary:".length)) || "reflow_1";
        const data = getMesOverview({ deviceId });
        return {
            id: normalizedId,
            title: `MES piec ${deviceId}`,
            url: buildLocalUrl("/mes"),
            text: `MES piec ${deviceId}\n\n${asPrettyJson(data)}`,
            metadata: { type: "mes-summary", deviceId },
        };
    }

    if (normalizedId.startsWith("kkw:")) {
        const number = normalizeKkwNumber(decodeURIComponent(normalizedId.slice("kkw:".length)));
        const data = await getKkwDetails({ kkwNumber: number, includeRaw: false });
        return {
            id: normalizedId,
            title: `KKW ${number}`,
            url: buildLocalUrl("/kosztykkw"),
            text: `KKW ${number}\n\n${asPrettyJson(data)}`,
            metadata: {
                type: "kkw",
                number,
                orderNumber: data?.kkw?.orderNumber || null,
                productCode: data?.kkw?.productCode || null,
            },
        };
    }

    if (normalizedId === "diagnostic:vendo-config") {
        const config = getProductionConfig();
        const missing = [];
        if (!config.apiUrl) missing.push("VENDO_API_URL");
        if (!config.apiLogin) missing.push("VENDO_API_LOGIN");
        if (!config.apiPassword) missing.push("VENDO_API_PASSWORD");
        if (!config.vendoUserLogin) missing.push("VENDO_USER_LOGIN");
        if (!config.vendoUserPassword) missing.push("VENDO_USER_PASSWORD");
        const data = {
            ok: missing.length === 0,
            missing,
            hasApiUrl: Boolean(config.apiUrl),
            hasApiLogin: Boolean(config.apiLogin),
            hasApiPassword: Boolean(config.apiPassword),
            hasVendoUserLogin: Boolean(config.vendoUserLogin),
            hasVendoUserPassword: Boolean(config.vendoUserPassword),
        };
        return {
            id: normalizedId,
            title: "Diagnostyka konfiguracji Vendo MCP",
            url: buildLocalUrl("/console"),
            text: asPrettyJson(data),
            metadata: { type: "diagnostic" },
        };
    }

    throw new Error(`Nieznany identyfikator produkcyjny: ${normalizedId}`);
}

module.exports = {
    fetchProduction,
    getKkwDetails,
    getMesOverview,
    getProductionConfig,
    getProductionOverview,
    getProductionRiskReport,
    listKkws,
    normalizeKkwNumber,
    searchProduction,
};
