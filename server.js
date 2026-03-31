const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const START_LOCAL_PATH = path.join(__dirname, "start-local.ps1");

let cachedLocalServerConfig = null;
const productionOverviewCache = new Map();
const kkwOverviewContextCache = new Map();

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
    };
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
            "TowarKod",
            "TowarNazwa",
            "PozycjaZleceniaID",
            "PozycjaZleceniaNazwa",
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
            ...buildKkwLookupModel({ numbers }),
                ZwracanePola: [
                    "ID",
                    "Numer",
                    "IloscOczekiwana",
                    "IloscPrzyjeta",
                    "IloscWykonana",
                    "ZlecenieID",
                    "ZlecenieNumer",
                    "TowarKod",
                    "TowarNazwa",
                    "PozycjaZleceniaID",
                    "PozycjaZleceniaNazwa",
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

function buildKkwCostEstimateModel({ kkwId, operationsBy }) {
    return {
        ID: Number(kkwId),
        IloscOperacjiWg: operationsBy === "Rbh" ? "Rbh" : "Mh",
    };
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

function buildKkwPreTechInPostModel({ kkwId }) {
    return {
        KKWID: [Number(kkwId)],
    };
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
            }),
        });

        const materialRecords = Array.isArray(materialsResponse?.Wynik?.Rekordy) ? materialsResponse.Wynik.Rekordy : [];
        const estimate = estimateResponse?.Wynik || {};
        const elements = Array.isArray(reportResponse?.Wynik?.Elementy) ? reportResponse.Wynik.Elementy : [];
        const root = elements.find((item) => item?.Rodzaj === "Korzen") || null;
        const branches = elements.filter((item) => typeof item?.Rodzaj === "string" && item.Rodzaj.startsWith("Galaz"));
        const leaves = elements.filter((item) => typeof item?.Rodzaj === "string" && item.Rodzaj.startsWith("Lisc"));
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

        sendJson(res, 200, {
            Wynik: {
                KkwID: kkwId,
                KkwNumer: kkwNumber,
                TowarKod: kkwRecord?.TowarKod || null,
                TowarNazwa: kkwRecord?.TowarNazwa || null,
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
                },
                SzacowanieKosztow: estimate,
            },
            ResponseStatus: {
                Materialowka: materialsResponse?.ResponseStatus || null,
                SzacowanieKosztow: estimateResponse?.ResponseStatus || null,
                RaportPreTechInPost: reportResponse?.ResponseStatus || null,
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
        const connection = {
            baseUrl: serverConfig.apiUrl,
            apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin: String(body.vendoUserLogin || "").trim(),
            vendoUserPassword: body.vendoUserPassword || "",
        };

        if (!connection.vendoUserLogin || !connection.vendoUserPassword) {
            sendJson(res, 400, { error: "Podaj login i haslo Vendo." });
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
        const connection = {
            baseUrl: serverConfig.apiUrl,
            apiLogin: serverConfig.apiLogin,
            apiPassword: serverConfig.apiPassword,
            vendoUserLogin: String(body.vendoUserLogin || "").trim(),
            vendoUserPassword: body.vendoUserPassword || "",
        };

        if (!connection.vendoUserLogin || !connection.vendoUserPassword) {
            sendJson(res, 400, { error: "Podaj login i haslo Vendo." });
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

    if (urlPath === "/console") {
        return { pathname: "/console/index.html" };
    }

    if (urlPath === "/production-dashboard") {
        return { pathname: "/production-dashboard/index.html" };
    }

    if (urlPath.endsWith("/")) {
        return { pathname: `${urlPath}index.html` };
    }

    return { pathname: urlPath };
}

function handleStatic(req, res) {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
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

    if (req.method === "POST" && req.url === "/api/product-locations") {
        await handleApiProductLocations(req, res);
        return;
    }

    if (req.method === "POST" && req.url === "/api/product-batch-states") {
        await handleApiProductBatchStates(req, res);
        return;
    }

    if (req.method === "GET") {
        handleStatic(req, res);
        return;
    }

    sendText(res, 404, "Not found");
});

server.listen(PORT, HOST, () => {
    console.log(`Frontend Vendo startuje na http://${HOST}:${PORT}`);
});
