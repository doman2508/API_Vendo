const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const VENDO_API_URL = (process.env.VENDO_API_URL || "").trim();
const VENDO_API_LOGIN = (process.env.VENDO_API_LOGIN || "").trim();
const VENDO_API_PASSWORD = process.env.VENDO_API_PASSWORD || "";

function requireServerConfig() {
    const missing = [];
    if (!VENDO_API_URL) missing.push("VENDO_API_URL");
    if (!VENDO_API_LOGIN) missing.push("VENDO_API_LOGIN");
    if (!VENDO_API_PASSWORD) missing.push("VENDO_API_PASSWORD");
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

async function resolveKkwRecordsByNumbers(connection, accessToken, numbers) {
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
    if (missing.length) {
        throw new Error(`Nie znaleziono KKW o numerze: ${missing.join(", ")}`);
    }

    return numbers.map((number) => byNumber.get(number));
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
        const connection = {
            baseUrl: VENDO_API_URL,
            apiLogin: VENDO_API_LOGIN,
            apiPassword: VENDO_API_PASSWORD,
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
        const connection = {
            baseUrl: VENDO_API_URL,
            apiLogin: VENDO_API_LOGIN,
            apiPassword: VENDO_API_PASSWORD,
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
        const connection = {
            baseUrl: VENDO_API_URL,
            apiLogin: VENDO_API_LOGIN,
            apiPassword: VENDO_API_PASSWORD,
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
        const connection = {
            baseUrl: VENDO_API_URL,
            apiLogin: VENDO_API_LOGIN,
            apiPassword: VENDO_API_PASSWORD,
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
        const connection = {
            baseUrl: VENDO_API_URL,
            apiLogin: VENDO_API_LOGIN,
            apiPassword: VENDO_API_PASSWORD,
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
        const connection = {
            baseUrl: VENDO_API_URL,
            apiLogin: VENDO_API_LOGIN,
            apiPassword: VENDO_API_PASSWORD,
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

async function handleApiProductLocations(req, res) {
    try {
        const missing = requireServerConfig();
        if (missing.length) {
            return sendJson(res, 500, {
                error: `Brakuje konfiguracji serwera: ${missing.join(", ")}.`,
            });
        }

        const body = await readJsonBody(req);
        const connection = {
            baseUrl: VENDO_API_URL,
            apiLogin: VENDO_API_LOGIN,
            apiPassword: VENDO_API_PASSWORD,
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
        const connection = {
            baseUrl: VENDO_API_URL,
            apiLogin: VENDO_API_LOGIN,
            apiPassword: VENDO_API_PASSWORD,
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

function handleStatic(req, res) {
    const requestPath = req.url === "/" ? "/index.html" : req.url;
    const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(PUBLIC_DIR, safePath);

    if (!filePath.startsWith(PUBLIC_DIR)) {
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
