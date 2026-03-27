const connectionForm = document.getElementById("connection-form");
const productsForm = document.getElementById("products-form");
const costAnalysisForm = document.getElementById("cost-analysis-form");
const backordersForm = document.getElementById("backorders-form");
const kkwCostsForm = document.getElementById("kkw-costs-form");
const productionOrderCostsForm = document.getElementById("production-order-costs-form");
const mrpCostsForm = document.getElementById("mrp-costs-form");
const saveConnectionButton = document.getElementById("save-connection");
const submitButton = document.getElementById("submit-button");
const costSubmitButton = document.getElementById("cost-submit-button");
const backorderSubmitButton = document.getElementById("backorder-submit-button");
const kkwCostsSubmitButton = document.getElementById("kkw-costs-submit-button");
const productionOrderCostsSubmitButton = document.getElementById("production-order-costs-submit-button");
const mrpSubmitButton = document.getElementById("mrp-submit-button");
const clearButton = document.getElementById("clear-button");
const statusBadge = document.getElementById("status-badge");
const costStatusBadge = document.getElementById("cost-status-badge");
const backorderStatusBadge = document.getElementById("backorder-status-badge");
const kkwCostsStatusBadge = document.getElementById("kkw-costs-status-badge");
const productionOrderCostsStatusBadge = document.getElementById("production-order-costs-status-badge");
const mrpStatusBadge = document.getElementById("mrp-status-badge");
const summary = document.getElementById("summary");
const errorBox = document.getElementById("error-box");
const resultsBody = document.getElementById("results-body");
const rawOutput = document.getElementById("raw-output");
const batchDetails = document.getElementById("batch-details");
const costSummary = document.getElementById("cost-summary");
const costErrorBox = document.getElementById("cost-error-box");
const costResultsBody = document.getElementById("cost-results-body");
const costRawOutput = document.getElementById("cost-raw-output");
const backorderSummary = document.getElementById("backorder-summary");
const backorderErrorBox = document.getElementById("backorder-error-box");
const backorderResultsBody = document.getElementById("backorder-results-body");
const backorderRawOutput = document.getElementById("backorder-raw-output");
const kkwCostsSummary = document.getElementById("kkw-costs-summary");
const kkwCostsErrorBox = document.getElementById("kkw-costs-error-box");
const kkwCostsSummaryBody = document.getElementById("kkw-costs-summary-body");
const kkwCostsOperationsBody = document.getElementById("kkw-costs-operations-body");
const kkwCostsMaterialsBody = document.getElementById("kkw-costs-materials-body-kkw");
const kkwCostsRawOutput = document.getElementById("kkw-costs-raw-output");
const productionOrderCostsSummary = document.getElementById("production-order-costs-summary");
const productionOrderCostsErrorBox = document.getElementById("production-order-costs-error-box");
const productionOrderCostsSummaryBody = document.getElementById("production-order-costs-summary-body");
const productionOrderCostsBody = document.getElementById("production-order-costs-body");
const productionOrderCostsRawOutput = document.getElementById("production-order-costs-raw-output");
const mrpSummary = document.getElementById("mrp-summary");
const mrpErrorBox = document.getElementById("mrp-error-box");
const mrpRawOutput = document.getElementById("mrp-raw-output");
const switchButtons = document.querySelectorAll(".switch-button");
const viewPanels = document.querySelectorAll(".view-panel");

const STORAGE_KEY = "vendo-api-console";
const numberFormatter = new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
});

let lastRecords = [];
let selectedRecordIndex = -1;

function setStatus(target, type, text) {
    target.className = `status ${type}`;
    target.textContent = text;
}

function getToday() {
    return new Date().toISOString().slice(0, 10);
}

function getYearStart() {
    const now = new Date();
    return `${now.getFullYear()}-01-01`;
}

function loadStoredValues() {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        for (const [key, value] of Object.entries(stored)) {
            const field = connectionForm.elements.namedItem(key);
            if (field && typeof value === "string") {
                field.value = value;
            }
        }
    } catch {
        localStorage.removeItem(STORAGE_KEY);
    }
}

function saveConnection() {
    const values = collectConnectionValues();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
}

function collectConnectionValues() {
    return {
        vendoUserLogin: connectionForm.vendoUserLogin.value.trim(),
        vendoUserPassword: connectionForm.vendoUserPassword.value,
    };
}

function collectProductValues() {
    return {
        productCode: productsForm.productCode.value.trim(),
        pageSize: productsForm.pageSize.value,
    };
}

function collectCostValues() {
    return {
        dateFrom: costAnalysisForm.dateFrom.value,
        dateTo: costAnalysisForm.dateTo.value,
        analysisBy: costAnalysisForm.analysisBy.value,
        excludeServices: costAnalysisForm.excludeServices.checked,
        excludeCorrections: costAnalysisForm.excludeCorrections.checked,
        excludeDocuments: costAnalysisForm.excludeDocuments.checked,
        onlyClosedDocuments: costAnalysisForm.onlyClosedDocuments.checked,
        extendedMode: costAnalysisForm.extendedMode.checked,
    };
}

function collectBackorderValues() {
    return {
        dateFrom: backordersForm.dateFrom.value,
        dateTo: backordersForm.dateTo.value,
        productCode: backordersForm.productCode.value.trim(),
        warehouseCode: backordersForm.warehouseCode.value.trim(),
        direction: backordersForm.direction.value,
        pageSize: backordersForm.pageSize.value,
    };
}

function collectMrpValues() {
    return {
        kkwNumbers: mrpCostsForm.kkwNumbers.value.trim(),
        kkwElementIds: mrpCostsForm.kkwElementIds.value.trim(),
        kkwExecutionIds: mrpCostsForm.kkwExecutionIds.value.trim(),
    };
}

function collectKkwCostsValues() {
    return {
        kkwNumbers: kkwCostsForm.kkwNumbers.value.trim(),
    };
}

function collectProductionOrderCostsValues() {
    return {
        kkwNumbers: productionOrderCostsForm.kkwNumbers.value.trim(),
    };
}

function clearProductResults() {
    summary.classList.add("hidden");
    summary.innerHTML = "";
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
    resultsBody.innerHTML = `
        <tr>
            <td colspan="7" class="empty-state">Jeszcze nie wykonano zapytania.</td>
        </tr>
    `;
    rawOutput.textContent = "Brak danych.";
    batchDetails.className = "warehouse-placeholder";
    batchDetails.textContent = "Kliknij wybrany indeks, aby pobrac partie i miejsca magazynowe.";
    lastRecords = [];
    selectedRecordIndex = -1;
}

function clearCostResults() {
    costSummary.classList.add("hidden");
    costSummary.innerHTML = "";
    costErrorBox.classList.add("hidden");
    costErrorBox.textContent = "";
    costResultsBody.innerHTML = `
        <tr>
            <td colspan="8" class="empty-state">Jeszcze nie wykonano analizy kosztow.</td>
        </tr>
    `;
    costRawOutput.textContent = "Brak danych.";
}

function clearBackorderResults() {
    backorderSummary.classList.add("hidden");
    backorderSummary.innerHTML = "";
    backorderErrorBox.classList.add("hidden");
    backorderErrorBox.textContent = "";
    backorderResultsBody.innerHTML = `
        <tr>
            <td colspan="8" class="empty-state">Jeszcze nie pobrano backorderow.</td>
        </tr>
    `;
    backorderRawOutput.textContent = "Brak danych.";
}

function clearMrpResults() {
    mrpSummary.classList.add("hidden");
    mrpSummary.innerHTML = "";
    mrpErrorBox.classList.add("hidden");
    mrpErrorBox.textContent = "";
    mrpRawOutput.textContent = "Brak danych.";
}

function clearKkwCostsResults() {
    kkwCostsSummary.classList.add("hidden");
    kkwCostsSummary.innerHTML = "";
    kkwCostsErrorBox.classList.add("hidden");
    kkwCostsErrorBox.textContent = "";
    kkwCostsSummaryBody.innerHTML = `
        <tr>
            <td colspan="5" class="empty-state">Jeszcze nie pobrano raportu kosztow KKW.</td>
        </tr>
    `;
    kkwCostsDetailsBody.innerHTML = `
        <tr>
            <td colspan="7" class="empty-state">Jeszcze nie pobrano szczegolow raportu.</td>
        </tr>
    `;
    kkwCostsRawOutput.textContent = "Brak danych.";
}

function clearProductionOrderCostsResults() {
    productionOrderCostsSummary.classList.add("hidden");
    productionOrderCostsSummary.innerHTML = "";
    productionOrderCostsErrorBox.classList.add("hidden");
    productionOrderCostsErrorBox.textContent = "";
    productionOrderCostsSummaryBody.innerHTML = `
        <tr>
            <td colspan="3" class="empty-state">Jeszcze nie pobrano kosztu zlecenia.</td>
        </tr>
    `;
    productionOrderCostsBody.innerHTML = `
        <tr>
            <td colspan="14" class="empty-state">Jeszcze nie pobrano danych kosztowych zlecenia.</td>
        </tr>
    `;
    productionOrderCostsRawOutput.textContent = "Brak danych.";
}

function renderSummary(data) {
    const records = data?.Wynik?.Rekordy || [];
    const cursor = data?.Wynik?.Cursor;
    const cards = [
        ["Zwrocone rekordy", String(records.length)],
        ["Wszystkie rekordy", cursor?.LiczbaWszystkichRekordow ? String(cursor.LiczbaWszystkichRekordow) : "-"],
        ["Kursor", cursor?.Nazwa || "-"],
    ];

    summary.innerHTML = cards.map(([label, value]) => `
        <div class="summary-card">
            <span>${label}</span>
            <strong>${value}</strong>
        </div>
    `).join("");
    summary.classList.remove("hidden");
}

function renderCostSummary(data) {
    const records = data?.Wynik?.Pozycje || [];
    const totalNet = records.reduce((sum, item) => sum + (Number(item.WartoscNetto) || 0), 0);
    const totalVat = records.reduce((sum, item) => sum + (Number(item.WartoscVAT) || 0), 0);
    const cards = [
        ["Pozycji", String(records.length)],
        ["Suma netto", numberFormatter.format(totalNet)],
        ["Suma VAT", numberFormatter.format(totalVat)],
    ];

    costSummary.innerHTML = cards.map(([label, value]) => `
        <div class="summary-card">
            <span>${label}</span>
            <strong>${value}</strong>
        </div>
    `).join("");
    costSummary.classList.remove("hidden");
}

function renderBackorderSummary(data) {
    const records = data?.Wynik?.Rekordy || [];
    const cursor = data?.Wynik?.Cursor;
    const totalQty = records.reduce((sum, item) => sum + (Number(item.Ilosc) || 0), 0);
    const cards = [
        ["Backorderow", String(records.length)],
        ["Suma ilosci", numberFormatter.format(totalQty)],
        ["Wszystkie rekordy", cursor?.LiczbaWszystkichRekordow ? String(cursor.LiczbaWszystkichRekordow) : "-"],
    ];

    backorderSummary.innerHTML = cards.map(([label, value]) => `
        <div class="summary-card">
            <span>${label}</span>
            <strong>${value}</strong>
        </div>
    `).join("");
    backorderSummary.classList.remove("hidden");
}

function renderMrpSummary(data) {
    const result = data?.Wynik || {};
    const cards = [
        ["Status", result.Sukces ? "OK" : "-"],
        ["Numer KKW", (result.KkwNumer || []).length ? (result.KkwNumer || []).join(", ") : "-"],
        ["KKW ID", (result.KkwID || []).length ? (result.KkwID || []).join(", ") : "-"],
        ["Elementy KKW", (result.KkwElementID || []).length ? (result.KkwElementID || []).join(", ") : "-"],
        ["Wykonania KKW", (result.KkwWykonanieID || []).length ? (result.KkwWykonanieID || []).join(", ") : "-"],
    ];

    mrpSummary.innerHTML = cards.map(([label, value]) => `
        <div class="summary-card">
            <span>${label}</span>
            <strong>${value}</strong>
        </div>
    `).join("");
    mrpSummary.classList.remove("hidden");
}

function renderKkwCostsSummaryCards(data) {
    const result = data?.Wynik || {};
    const summary = result.Podsumowanie || {};
    const cards = [
        ["Numer KKW", result.KkwNumer || "-"],
        ["KKW ID", result.KkwID ?? "-"],
        ["Suma RBH", numberFormatter.format(Number(summary.SumaRbh) || 0)],
        ["Pozycje materiałówki", summary.LiczbaPozycjiMaterialowki ?? 0],
        ["Pozycje dokumentow", summary.LiczbaPozycjiDokumentow ?? 0],
    ];

    kkwCostsSummary.innerHTML = cards.map(([label, value]) => `
        <div class="summary-card">
            <span>${label}</span>
            <strong>${value}</strong>
        </div>
    `).join("");
    kkwCostsSummary.classList.remove("hidden");
}

function renderKkwCostsTables(data) {
    const result = data?.Wynik || {};
    const estimate = result.SzacowanieKosztow || {};
    const estimateRows = [
        ["Naglowek", estimate.Naglowek],
        ["Operacje", estimate.Operacje],
        ["Kooperacje", estimate.Kooperacje],
        ["Materialy", estimate.Materialy],
    ];

    kkwCostsSummaryBody.innerHTML = estimateRows.map(([label, item]) => `
        <tr>
            <td>${label}</td>
            <td>${formatStock(item?.Ilosc)}</td>
            <td>${formatStock(item?.Wartosc)}</td>
            <td>${formatStock(item?.Cena)}</td>
        </tr>
    `).join("");

    const labor = Array.isArray(result.Robocizna) ? result.Robocizna : [];
    if (!labor.length) {
        kkwCostsLaborBody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">Brak danych o robociznie dla tego KKW.</td>
            </tr>
        `;
    } else {
        kkwCostsLaborBody.innerHTML = labor.map((item) => `
            <tr>
                <td>${item.OperacjaLp ?? ""} ${item.OperacjaNazwa ?? ""}</td>
                <td>${[item.PracownikImie, item.PracownikNazwisko].filter(Boolean).join(" ") || "-"}</td>
                <td>${item.PracownikLogin ?? "-"}</td>
                <td>${formatDateTime(item.DataRozpoczecia)}</td>
                <td>${formatDateTime(item.DataZakonczenia)}</td>
                <td>${formatStock(item.Rbh)}</td>
            </tr>
        `).join("");
    }

    const materials = Array.isArray(result.Materialowka) ? result.Materialowka : [];
    if (!materials.length) {
        kkwCostsMaterialsBody.innerHTML = `
            <tr>
                <td colspan="10" class="empty-state">Brak danych o materialowce dla tego KKW.</td>
            </tr>
        `;
    } else {
        kkwCostsMaterialsBody.innerHTML = materials.map((item) => `
            <tr>
                <td>${item.Typ ?? "-"}</td>
                <td>${item.OperacjaLp ?? ""} ${item.OperacjaNazwa ?? ""}</td>
                <td>${item.SkladnikKod ?? "-"}</td>
                <td>${item.SkladnikNazwa ?? "-"}</td>
                <td>${item.MagazynKod ?? "-"}</td>
                <td>${item.JednostkaSkrot ?? "-"}</td>
                <td>${formatStock(item.IloscPlanowana)}</td>
                <td>${formatStock(item.IloscZWykonania)}</td>
                <td>${formatStock(item.IloscPrzeniesiona)}</td>
                <td>${formatStock(item.CenaKalkulacyjna)}</td>
            </tr>
        `).join("");
    }

    const documents = Array.isArray(result.Dokumenty) ? result.Dokumenty : [];
    if (!documents.length) {
        kkwCostsDocumentsBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">Brak powiazanych dokumentow dla tego KKW.</td>
            </tr>
        `;
    } else {
        kkwCostsDocumentsBody.innerHTML = documents.map((item) => `
            <tr>
                <td>${item.Typ ?? "-"}</td>
                <td>${item.DokumentNumer ?? "-"}</td>
                <td>${item.SkladnikKod ?? "-"}</td>
                <td>${item.SkladnikNazwa ?? "-"}</td>
                <td>${item.MagazynKod ?? "-"}</td>
                <td>${formatStock(item.Ilosc)}</td>
                <td>${item.PartiaID ?? "-"}</td>
            </tr>
        `).join("");
    }
}

function clearKkwCostsResults() {
    kkwCostsSummary.classList.add("hidden");
    kkwCostsSummary.innerHTML = "";
    kkwCostsErrorBox.classList.add("hidden");
    kkwCostsErrorBox.textContent = "";
    kkwCostsSummaryBody.innerHTML = `
        <tr>
            <td colspan="5" class="empty-state">Jeszcze nie pobrano raportu kosztow KKW.</td>
        </tr>
    `;
    kkwCostsDetailsBody.innerHTML = `
        <tr>
            <td colspan="7" class="empty-state">Jeszcze nie pobrano szczegolow raportu.</td>
        </tr>
    `;
    kkwCostsRawOutput.textContent = "Brak danych.";
}

function renderKkwCostsSummaryCards(data) {
    const result = data?.Wynik || {};
    const summary = result.Podsumowanie || {};
    const report = result.Raport || {};
    const cards = [
        ["Numer KKW", result.KkwNumer || "-"],
        ["KKW ID", result.KkwID ?? "-"],
        ["Materiały Post", numberFormatter.format(Number(summary.MaterialyPostWartosc) || 0)],
        ["Operacje Post", numberFormatter.format(Number(summary.OperacjePostWartosc) || 0)],
        ["Korzeń Post", numberFormatter.format(Number(summary.KorzenPostWartosc) || 0)],
        ["Gałęzie", summary.LiczbaGalezi ?? 0],
        ["Liście", summary.LiczbaLisci ?? 0],
        ["Korzeń", report.Korzen?.Nazwa || result.KkwNumer || "-"],
    ];

    kkwCostsSummary.innerHTML = cards.map(([label, value]) => `
        <div class="summary-card">
            <span>${label}</span>
            <strong>${value}</strong>
        </div>
    `).join("");
    kkwCostsSummary.classList.remove("hidden");
}

function renderKkwCostsTables(data) {
    const result = data?.Wynik || {};
    const report = result.Raport || {};
    const summaryRows = [
        ["Korzeń", report.Korzen],
        ["Materiały", report.Materialy],
        ["Operacje", report.Operacje],
    ];

    kkwCostsSummaryBody.innerHTML = summaryRows.map(([label, item]) => `
        <tr>
            <td>${label}</td>
            <td>${formatStock(item?.Pre?.Wartosc)}</td>
            <td>${formatStock(item?.Tech?.Wartosc)}</td>
            <td>${formatStock(item?.In?.Wartosc)}</td>
            <td>${formatStock(item?.Post?.Wartosc)}</td>
        </tr>
    `).join("");

    const details = Array.isArray(report.Liscie) ? report.Liscie : [];
    if (!details.length) {
        kkwCostsDetailsBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">Brak szczegolow raportu dla tego KKW.</td>
            </tr>
        `;
        return;
    }

    kkwCostsDetailsBody.innerHTML = details.map((item) => `
        <tr>
            <td>${item.Rodzaj ?? "-"}</td>
            <td>${item.Nazwa ?? "-"}</td>
            <td>${item.SkladnikID ?? "-"}</td>
            <td>${formatStock(item.Pre?.Wartosc)}</td>
            <td>${formatStock(item.Tech?.Wartosc)}</td>
            <td>${formatStock(item.In?.Wartosc)}</td>
            <td>${formatStock(item.Post?.Wartosc)}</td>
        </tr>
    `).join("");
}

function renderKkwCostsSummaryCards(data) {
    const result = data?.Wynik || {};
    const summary = result.Podsumowanie || {};
    const report = result.Raport || {};
    const productLabel = [result.TowarKod, result.TowarNazwa].filter(Boolean).join(" - ");
    const cards = [
        ["Numer KKW", result.KkwNumer || "-"],
        ["Produkt", productLabel || "-"],
        ["Ilosc", formatStock(result.Ilosc)],
        ["Koszt calkowity po realizacji", numberFormatter.format(Number(summary.KorzenPostWartosc) || 0)],
        ["Materialy po realizacji", numberFormatter.format(Number(summary.MaterialyPostWartosc) || 0)],
        ["Operacje po realizacji", numberFormatter.format(Number(summary.OperacjePostWartosc) || 0)],
        ["Materialowka kalkulacyjna", numberFormatter.format(Number(summary.MaterialowkaKosztKalkulacyjny) || 0)],
        ["Koszt na sztuke", numberFormatter.format(Number(summary.KosztNaSztuke) || 0)],
        ["Materialy na sztuke", numberFormatter.format(Number(summary.MaterialyNaSztuke) || 0)],
        ["Operacje na sztuke", numberFormatter.format(Number(summary.OperacjeNaSztuke) || 0)],
        ["Liczba galezi", summary.LiczbaGalezi ?? 0],
        ["Liczba lisci", summary.LiczbaLisci ?? 0],
        ["Caly obiekt", report.Korzen?.Nazwa || result.KkwNumer || "-"],
    ];

    kkwCostsSummary.innerHTML = cards.map(([label, value]) => `
        <div class="summary-card">
            <span>${label}</span>
            <strong>${value}</strong>
        </div>
    `).join("");
    kkwCostsSummary.classList.remove("hidden");
}

function renderKkwCostsSummaryCards(data) {
    const result = data?.Wynik || {};
    const summary = result.Podsumowanie || {};
    const report = result.Raport || {};
    const cards = [
        ["Numer KKW", result.KkwNumer || "-"],
        ["KKW ID", result.KkwID ?? "-"],
        ["Materialy po realizacji", numberFormatter.format(Number(summary.MaterialyPostWartosc) || 0)],
        ["Operacje po realizacji", numberFormatter.format(Number(summary.OperacjePostWartosc) || 0)],
        ["Koszt calkowity po realizacji", numberFormatter.format(Number(summary.KorzenPostWartosc) || 0)],
        ["Liczba galezi", summary.LiczbaGalezi ?? 0],
        ["Liczba lisci", summary.LiczbaLisci ?? 0],
        ["Caly obiekt", report.Korzen?.Nazwa || result.KkwNumer || "-"],
    ];

    kkwCostsSummary.innerHTML = cards.map(([label, value]) => `
        <div class="summary-card">
            <span>${label}</span>
            <strong>${value}</strong>
        </div>
    `).join("");
    kkwCostsSummary.classList.remove("hidden");
}

function renderKkwCostsTables(data) {
    const result = data?.Wynik || {};
    const report = result.Raport || {};
    const summaryRows = [
        ["Cale KKW", report.Korzen],
        ["Materialy", report.Materialy],
        ["Operacje", report.Operacje],
    ];

    kkwCostsSummaryBody.innerHTML = summaryRows.map(([label, item]) => `
        <tr>
            <td>${label}</td>
            <td>${formatStock(item?.Pre?.Wartosc)}</td>
            <td>${formatStock(item?.Tech?.Wartosc)}</td>
            <td>${formatStock(item?.In?.Wartosc)}</td>
            <td>${formatStock(item?.Post?.Wartosc)}</td>
        </tr>
    `).join("");

    const details = Array.isArray(report.Liscie) ? report.Liscie : [];
    if (!details.length) {
        kkwCostsDetailsBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">Brak szczegolow raportu dla tego KKW.</td>
            </tr>
        `;
        return;
    }

    kkwCostsDetailsBody.innerHTML = details.map((item) => `
        <tr>
            <td>${item.Rodzaj ?? "-"}</td>
            <td>${item.Nazwa ?? "-"}</td>
            <td>${item.SkladnikID ?? "-"}</td>
            <td>${formatStock(item.Pre?.Wartosc)}</td>
            <td>${formatStock(item.Tech?.Wartosc)}</td>
            <td>${formatStock(item.In?.Wartosc)}</td>
            <td>${formatStock(item.Post?.Wartosc)}</td>
        </tr>
    `).join("");
}

function renderProductionOrderCostsSummaryCards(data) {
    const result = data?.Wynik || {};
    const summary = result.Podsumowanie || {};
    const cards = [
        ["Numer KKW", result.KkwNumer || "-"],
        ["Numer zlecenia", result.ZlecenieNumer || "-"],
        ["Towar", [result.TowarKod, result.TowarNazwa].filter(Boolean).join(" - ") || "-"],
        ["Materiał realizacja", numberFormatter.format(Number(summary.MaterialRealizacja) || 0)],
        ["Praca realizacja", numberFormatter.format(Number(summary.PracaRealizacja) || 0)],
        ["RBH realizacja", numberFormatter.format(Number(summary.RbhRealizacja) || 0)],
        ["Suma realizacja", numberFormatter.format(Number(summary.SumaRealizacja) || 0)],
    ];

    productionOrderCostsSummary.innerHTML = cards.map(([label, value]) => `
        <div class="summary-card">
            <span>${label}</span>
            <strong>${value}</strong>
        </div>
    `).join("");
    productionOrderCostsSummary.classList.remove("hidden");
}

function renderProductionOrderCostsTables(data) {
    const result = data?.Wynik || {};
    const summary = result.Podsumowanie || {};
    const summaryRows = [
        ["Materiał", summary.MaterialPlan, summary.MaterialRealizacja],
        ["Praca", summary.PracaPlan, summary.PracaRealizacja],
        ["RBH", summary.RbhPlan, summary.RbhRealizacja],
        ["Kooperacja", summary.KooperacjaPlan, summary.KooperacjaRealizacja],
        ["Suma", summary.SumaPlan, summary.SumaRealizacja],
    ];

    productionOrderCostsSummaryBody.innerHTML = summaryRows.map(([label, plan, actual]) => `
        <tr>
            <td>${label}</td>
            <td>${formatStock(plan)}</td>
            <td>${formatStock(actual)}</td>
        </tr>
    `).join("");

    const records = Array.isArray(result.Pozycje) ? result.Pozycje : [];
    if (!records.length) {
        productionOrderCostsBody.innerHTML = `
            <tr>
                <td colspan="14" class="empty-state">Brak pozycji kosztowych dla tego zlecenia.</td>
            </tr>
        `;
        return;
    }

    productionOrderCostsBody.innerHTML = records.map((item) => `
        <tr>
            <td>${item.PozycjaZleceniaId ?? ""}</td>
            <td>${item.TowarKod ?? ""}</td>
            <td>${item.TowarNazwa ?? item.PozycjaZleceniaNazwa ?? ""}</td>
            <td>${formatStock(item.Ilosc)}</td>
            <td>${formatStock(item.MaterialPlan)}</td>
            <td>${formatStock(item.MaterialRealizacja)}</td>
            <td>${formatStock(item.PracaPlan)}</td>
            <td>${formatStock(item.PracaRealizacja)}</td>
            <td>${formatStock(item.RbhPlan)}</td>
            <td>${formatStock(item.RbhRealizacja)}</td>
            <td>${formatStock(item.KooperacjaPlan)}</td>
            <td>${formatStock(item.KooperacjaRealizacja)}</td>
            <td>${formatStock(item.SumaPlan)}</td>
            <td>${formatStock(item.SumaRealizacja)}</td>
        </tr>
    `).join("");
}

function formatStock(value) {
    if (value === null || value === undefined || value === "") {
        return "";
    }

    if (typeof value === "number") {
        return numberFormatter.format(value);
    }

    const parsed = Number(value);
    return Number.isNaN(parsed) ? String(value) : numberFormatter.format(parsed);
}

function renderBatchDetails(record, batchData) {
    if (!record) {
        batchDetails.className = "warehouse-placeholder";
        batchDetails.textContent = "Kliknij wybrany indeks, aby pobrac partie i miejsca magazynowe.";
        return;
    }

    const records = batchData?.Wynik?.Rekordy || [];
    if (!records.length) {
        batchDetails.className = "warehouse-placeholder";
        batchDetails.innerHTML = `
            <div class="warehouse-meta">
                <strong>${record.Kod || "-"}</strong>
                <span>${record.Nazwa || ""}</span>
            </div>
            <div>Brak rekordow partii i miejsc magazynowych dla tego towaru.</div>
        `;
        return;
    }

    batchDetails.className = "warehouse-details";
    batchDetails.innerHTML = `
        <div class="table-wrap compact">
            <table>
                <thead>
                    <tr>
                        <th>Partia ID</th>
                        <th class="place-column">Miejsce</th>
                        <th>Magazyn</th>
                        <th>Ilosc</th>
                        <th>Dostepna</th>
                        <th>Pozostala</th>
                        <th>Stan handlowy</th>
                    </tr>
                </thead>
                <tbody>
                    ${records.map((item) => `
                        <tr>
                            <td>${item.PartiaId ?? ""}</td>
                            <td class="place-column">${item.MiejsceNazwa ?? item.MiejsceId ?? "-"}</td>
                            <td>${item.MagazynKod ?? "-"}</td>
                            <td>${formatStock(item.Ilosc)}</td>
                            <td>${formatStock(item.IloscDostepna)}</td>
                            <td>${formatStock(item.IloscPozostala)}</td>
                            <td>${formatStock(item.StanHandlowy)}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

function markSelectedRow() {
    for (const row of resultsBody.querySelectorAll("tr[data-record-index]")) {
        row.classList.toggle("selected", Number(row.dataset.recordIndex) === selectedRecordIndex);
    }
}

function renderTable(data) {
    const records = data?.Wynik?.Rekordy || [];
    lastRecords = records;

    if (!records.length) {
        resultsBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">Brak wynikow dla podanego filtra.</td>
            </tr>
        `;
        return;
    }

    resultsBody.innerHTML = records.map((record, index) => `
        <tr data-record-index="${index}">
            <td>${record.ID ?? ""}</td>
            <td>${record.Kod ?? ""}</td>
            <td>${record.Nazwa ?? ""}</td>
            <td>${formatStock(record.LacznyStan)}</td>
            <td>${record.Rodzaj1 ?? ""}</td>
            <td>${record.Aktywnosc ?? ""}</td>
            <td>${record.JednostkaKod ?? ""}</td>
        </tr>
    `).join("");
}

function renderCostTable(data) {
    const records = data?.Wynik?.Pozycje || [];

    if (!records.length) {
        costResultsBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">Brak wynikow dla wybranych parametrow.</td>
            </tr>
        `;
        return;
    }

    costResultsBody.innerHTML = records.map((record) => `
        <tr>
            <td>${record.ID ?? ""}</td>
            <td>${record.Kod ?? ""}</td>
            <td>${record.Nazwa ?? ""}</td>
            <td>${formatStock(record.Ilosc)}</td>
            <td>${formatStock(record.WartoscNetto)}</td>
            <td>${formatStock(record.WartoscVAT)}</td>
            <td>${record.IloscDokumentow ?? ""}</td>
            <td>${record.IloscKlientow ?? ""}</td>
        </tr>
    `).join("");
}

function formatDateTime(value) {
    if (!value) {
        return "";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return new Intl.DateTimeFormat("pl-PL", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}

function formatBackorderDirection(value) {
    if (Number(value) === -1) {
        return "Zapotrzebowanie";
    }

    if (Number(value) === 1) {
        return "Oczekiwane";
    }

    return value ?? "";
}

function renderBackorderTable(data) {
    const records = data?.Wynik?.Rekordy || [];

    if (!records.length) {
        backorderResultsBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">Brak wynikow dla wybranych parametrow.</td>
            </tr>
        `;
        return;
    }

    backorderResultsBody.innerHTML = records.map((record) => `
        <tr>
            <td>${record.ID ?? ""}</td>
            <td>${formatDateTime(record.DataBackorderu)}</td>
            <td>${formatStock(record.Ilosc)}</td>
            <td>${formatBackorderDirection(record.Kierunek)}</td>
            <td>${record.Zrodlo ?? ""}</td>
            <td>${record.NumerDokumentu ?? ""}</td>
            <td>${record.TowarID ?? ""}</td>
            <td>${record.MagazynID ?? ""}</td>
        </tr>
    `).join("");
}

function switchView(viewName) {
    for (const button of switchButtons) {
        button.classList.toggle("active", button.dataset.view === viewName);
    }

    for (const panel of viewPanels) {
        panel.classList.toggle("active", panel.id === `${viewName}-view`);
    }
}

async function postJson(url, payload) {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || "Operacja nie powiodla sie.");
    }

    return data;
}

saveConnectionButton.addEventListener("click", () => {
    saveConnection();
});

productsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveConnection();
    clearProductResults();
    setStatus(statusBadge, "loading", "Pobieranie");
    submitButton.disabled = true;

    try {
        const data = await postJson("/api/products", {
            ...collectConnectionValues(),
            ...collectProductValues(),
        });

        rawOutput.textContent = JSON.stringify(data, null, 2);
        renderSummary(data);
        renderTable(data);
        setStatus(statusBadge, "success", "Sukces");
    } catch (error) {
        errorBox.textContent = error.message || "Wystapil nieznany blad.";
        errorBox.classList.remove("hidden");
        setStatus(statusBadge, "error", "Blad");
    } finally {
        submitButton.disabled = false;
    }
});

costAnalysisForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveConnection();
    clearCostResults();
    setStatus(costStatusBadge, "loading", "Liczenie");
    costSubmitButton.disabled = true;

    try {
        const data = await postJson("/api/cost-analysis", {
            ...collectConnectionValues(),
            ...collectCostValues(),
        });

        costRawOutput.textContent = JSON.stringify(data, null, 2);
        renderCostSummary(data);
        renderCostTable(data);
        setStatus(costStatusBadge, "success", "Sukces");
    } catch (error) {
        costErrorBox.textContent = error.message || "Wystapil nieznany blad.";
        costErrorBox.classList.remove("hidden");
        setStatus(costStatusBadge, "error", "Blad");
    } finally {
        costSubmitButton.disabled = false;
    }
});

backordersForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveConnection();
    clearBackorderResults();
    setStatus(backorderStatusBadge, "loading", "Pobieranie");
    backorderSubmitButton.disabled = true;

    try {
        const data = await postJson("/api/backorders", {
            ...collectConnectionValues(),
            ...collectBackorderValues(),
        });

        backorderRawOutput.textContent = JSON.stringify(data, null, 2);
        renderBackorderSummary(data);
        renderBackorderTable(data);
        setStatus(backorderStatusBadge, "success", "Sukces");
    } catch (error) {
        backorderErrorBox.textContent = error.message || "Wystapil nieznany blad.";
        backorderErrorBox.classList.remove("hidden");
        setStatus(backorderStatusBadge, "error", "Blad");
    } finally {
        backorderSubmitButton.disabled = false;
    }
});

mrpCostsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveConnection();
    clearMrpResults();
    setStatus(mrpStatusBadge, "loading", "Przeliczanie");
    mrpSubmitButton.disabled = true;

    try {
        const data = await postJson("/api/mrp-work-costs", {
            ...collectConnectionValues(),
            ...collectMrpValues(),
        });

        mrpRawOutput.textContent = JSON.stringify(data, null, 2);
        renderMrpSummary(data);
        setStatus(mrpStatusBadge, "success", "Sukces");
    } catch (error) {
        mrpErrorBox.textContent = error.message || "Wystapil nieznany blad.";
        mrpErrorBox.classList.remove("hidden");
        setStatus(mrpStatusBadge, "error", "Blad");
    } finally {
        mrpSubmitButton.disabled = false;
    }
});

kkwCostsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveConnection();
    clearKkwCostsResults();
    setStatus(kkwCostsStatusBadge, "loading", "Pobieranie");
    kkwCostsSubmitButton.disabled = true;

    try {
        const data = await postJson("/api/kkw-costs", {
            ...collectConnectionValues(),
            ...collectKkwCostsValues(),
        });

        kkwCostsRawOutput.textContent = JSON.stringify(data, null, 2);
        renderKkwCostsSummaryCards(data);
        renderKkwCostsTables(data);
        setStatus(kkwCostsStatusBadge, "success", "Sukces");
    } catch (error) {
        kkwCostsErrorBox.textContent = error.message || "Wystapil nieznany blad.";
        kkwCostsErrorBox.classList.remove("hidden");
        setStatus(kkwCostsStatusBadge, "error", "Blad");
    } finally {
        kkwCostsSubmitButton.disabled = false;
    }
});

productionOrderCostsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveConnection();
    clearProductionOrderCostsResults();
    setStatus(productionOrderCostsStatusBadge, "loading", "Pobieranie");
    productionOrderCostsSubmitButton.disabled = true;

    try {
        const data = await postJson("/api/production-order-costs", {
            ...collectConnectionValues(),
            ...collectProductionOrderCostsValues(),
        });

        productionOrderCostsRawOutput.textContent = JSON.stringify(data, null, 2);
        renderProductionOrderCostsSummaryCards(data);
        renderProductionOrderCostsTables(data);
        setStatus(productionOrderCostsStatusBadge, "success", "Sukces");
    } catch (error) {
        productionOrderCostsErrorBox.textContent = error.message || "Wystapil nieznany blad.";
        productionOrderCostsErrorBox.classList.remove("hidden");
        setStatus(productionOrderCostsStatusBadge, "error", "Blad");
    } finally {
        productionOrderCostsSubmitButton.disabled = false;
    }
});

clearButton.addEventListener("click", () => {
    connectionForm.reset();
    localStorage.removeItem(STORAGE_KEY);
    clearProductResults();
    clearCostResults();
    clearBackorderResults();
    clearKkwCostsResults();
    clearProductionOrderCostsResults();
    clearMrpResults();
    setStatus(statusBadge, "idle", "Gotowe");
    setStatus(costStatusBadge, "idle", "Gotowe");
    setStatus(backorderStatusBadge, "idle", "Gotowe");
    setStatus(kkwCostsStatusBadge, "idle", "Gotowe");
    setStatus(productionOrderCostsStatusBadge, "idle", "Gotowe");
    setStatus(mrpStatusBadge, "idle", "Gotowe");
});

resultsBody.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-record-index]");
    if (!row) {
        return;
    }

    const index = Number(row.dataset.recordIndex);
    selectedRecordIndex = index;
    markSelectedRow();
    const selectedRecord = lastRecords[index];
    batchDetails.className = "warehouse-placeholder";
    batchDetails.textContent = "Pobieranie partii i miejsc magazynowych...";
    postJson("/api/product-batch-states", {
        ...collectConnectionValues(),
        productCode: selectedRecord.Kod,
    }).then((data) => {
        if (selectedRecordIndex !== index) {
            return;
        }

        renderBatchDetails(selectedRecord, data);
    }).catch((error) => {
        if (selectedRecordIndex !== index) {
            return;
        }

        batchDetails.className = "warehouse-placeholder";
        batchDetails.textContent = error.message || "Nie udalo sie pobrac partii i miejsc magazynowych.";
    });
});

for (const button of switchButtons) {
    button.addEventListener("click", () => switchView(button.dataset.view));
}

function renderKkwCostsSummaryCards(data) {
    const result = data?.Wynik || {};
    const summary = result.Podsumowanie || {};
    const report = result.Raport || {};
    const productLabel = [result.TowarKod, result.TowarNazwa].filter(Boolean).join(" - ");
    const materialowkaCostValue =
        summary.MaterialowkaKosztKalkulacyjny ?? summary.MaterialowkaKosztPoRealizacji;
    const materialowkaCost =
        materialowkaCostValue === null || materialowkaCostValue === undefined
            ? "-"
            : numberFormatter.format(Number(materialowkaCostValue) || 0);

    const renderGroup = (title, tone, cards) => `
        <section class="summary-group summary-group-${tone}">
            <div class="summary-group-header">
                <h3>${title}</h3>
            </div>
            <div class="summary-group-grid">
                ${cards.map(([label, value, wide]) => `
                    <div class="summary-card${wide ? " summary-card-wide" : ""}">
                        <span>${label}</span>
                        <strong>${value}</strong>
                    </div>
                `).join("")}
            </div>
        </section>
    `;

    kkwCostsSummary.innerHTML = [
        renderGroup("Identyfikacja", "identity", [
            ["Numer KKW", result.KkwNumer || "-"],
            ["Produkt", productLabel || "-", true],
            ["Ilosc KKW", formatStock(result.Ilosc)],
            ["Caly obiekt", report.Korzen?.Nazwa || result.KkwNumer || "-"],
        ]),
        renderGroup("Koszty globalne", "financial", [
            ["Koszt calkowity", numberFormatter.format(Number(summary.KorzenPostWartosc) || 0)],
            ["Materialy po realizacji", numberFormatter.format(Number(summary.MaterialyPostWartosc) || 0)],
            ["Operacje po realizacji", numberFormatter.format(Number(summary.OperacjePostWartosc) || 0)],
            ["Koszt materialow z materialowki", materialowkaCost],
        ]),
        renderGroup("Koszt na sztuke", "unit", [
            ["Koszt na sztuke", numberFormatter.format(Number(summary.KosztNaSztuke) || 0)],
            ["Materialy na sztuke", numberFormatter.format(Number(summary.MaterialyNaSztuke) || 0)],
            ["Operacje na sztuke", numberFormatter.format(Number(summary.OperacjeNaSztuke) || 0)],
        ]),
        renderGroup("Struktura raportu", "meta", [
            ["Pozycje materialowki", summary.LiczbaPozycjiMaterialowki ?? 0],
            ["Liczba galezi", summary.LiczbaGalezi ?? 0],
            ["Liczba lisci", summary.LiczbaLisci ?? 0],
        ]),
    ].join("");
    kkwCostsSummary.classList.remove("hidden");
}

function renderKkwCostsTables(data) {
    const result = data?.Wynik || {};
    const report = result.Raport || {};
    const summary = result.Podsumowanie || {};
    const materialowkaInputValue =
        summary.MaterialowkaKosztKalkulacyjny ??
        summary.MaterialowkaKosztPoRealizacji ??
        report.Materialy?.In?.Wartosc ??
        0;

    const summaryRows = [
        ["Cale KKW", report.Korzen],
        [
            "Materialy",
            {
                ...report.Materialy,
                In: {
                    ...(report.Materialy?.In || {}),
                    Wartosc: materialowkaInputValue,
                },
            },
        ],
        ["Operacje", report.Operacje],
    ];

    kkwCostsSummaryBody.innerHTML = summaryRows.map(([label, item]) => `
        <tr>
            <td>${label}</td>
            <td>${formatStock(item?.Pre?.Wartosc)}</td>
            <td>${formatStock(item?.Tech?.Wartosc)}</td>
            <td>${formatStock(item?.In?.Wartosc)}</td>
            <td>${formatStock(item?.Post?.Wartosc)}</td>
        </tr>
    `).join("");

    const leaves = Array.isArray(report.Liscie) ? report.Liscie : [];
    const operationLeaves = leaves.filter((item) => item?.Rodzaj === "Lisc, Operacja");
    const materialRows = Array.isArray(result?.Materialowka?.Pozycje) ? result.Materialowka.Pozycje : [];

    if (!operationLeaves.length) {
        kkwCostsOperationsBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">Brak operacji dla tego KKW.</td>
            </tr>
        `;
    } else {
        kkwCostsOperationsBody.innerHTML = operationLeaves.map((item) => `
            <tr>
                <td>${item.Nazwa ?? "-"}</td>
                <td>${item.SkladnikID ?? "-"}</td>
                <td>${formatStock(item?.In?.Ilosc)}</td>
                <td>${formatStock(item?.Post?.Ilosc)}</td>
                <td>${formatStock(item?.In?.Wartosc)}</td>
                <td>${formatStock(item?.Post?.Wartosc)}</td>
                <td>${formatStock(item?.In?.Cena)}</td>
            </tr>
        `).join("");
    }

    if (!materialRows.length) {
        kkwCostsMaterialsBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">Brak materiałow dla tego KKW.</td>
            </tr>
        `;
        return;
    }

    kkwCostsMaterialsBody.innerHTML = materialRows.map((item) => `
        <tr>
            <td>${item.SkladnikKod ?? "-"}</td>
            <td>${item.SkladnikNazwa ?? "-"}</td>
            <td>${item.SkladnikID ?? "-"}</td>
            <td>${formatStock(item.IloscPlanowana)}</td>
            <td>${formatStock(item.IloscZWykonania)}</td>
            <td>${formatStock(item.IloscPrzeniesiona)}</td>
            <td>${formatStock(item.KosztPoRealizacji)}</td>
            <td>${formatStock(item.CenaPoRealizacji)}</td>
        </tr>
    `).join("");
}

function clearKkwCostsResults() {
    kkwCostsSummary.classList.add("hidden");
    kkwCostsSummary.innerHTML = "";
    kkwCostsErrorBox.classList.add("hidden");
    kkwCostsErrorBox.textContent = "";
    kkwCostsSummaryBody.innerHTML = `
        <tr>
            <td colspan="5" class="empty-state">Jeszcze nie pobrano raportu kosztow KKW.</td>
        </tr>
    `;
    kkwCostsOperationsBody.innerHTML = `
        <tr>
            <td colspan="7" class="empty-state">Jeszcze nie pobrano operacji.</td>
        </tr>
    `;
    kkwCostsMaterialsBody.innerHTML = `
        <tr>
            <td colspan="8" class="empty-state">Jeszcze nie pobrano materialow.</td>
        </tr>
    `;
    kkwCostsRawOutput.textContent = "Brak danych.";
}

loadStoredValues();

costAnalysisForm.dateFrom.value = getYearStart();
costAnalysisForm.dateTo.value = getToday();
backordersForm.dateFrom.value = getYearStart();
backordersForm.dateTo.value = getToday();
clearKkwCostsResults();
clearProductionOrderCostsResults();
clearMrpResults();
