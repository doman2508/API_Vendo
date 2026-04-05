/**
 * Osobna kopia logiki widoku „Koszty KKW” z public/app.js (wersja z konca pliku,
 * nadpisujaca wczesniejsze duplikaty funkcji w konsoli). Nie importuje app.js.
 */

const connectionForm = document.getElementById("connection-form");
const kkwCostsForm = document.getElementById("kkw-costs-form");
const saveConnectionButton = document.getElementById("save-connection");
const kkwCostsSubmitButton = document.getElementById("kkw-costs-submit-button");
const clearButton = document.getElementById("clear-button");
const kkwCostsStatusBadge = document.getElementById("kkw-costs-status-badge");
const kkwCostsSummary = document.getElementById("kkw-costs-summary");
const kkwCostsErrorBox = document.getElementById("kkw-costs-error-box");
const kkwCostsSummaryBody = document.getElementById("kkw-costs-summary-body");
const kkwCostsOperationsBody = document.getElementById("kkw-costs-operations-body");
const kkwCostsMaterialsBody = document.getElementById("kkw-costs-materials-body-kkw");
const kkwCostsRawOutput = document.getElementById("kkw-costs-raw-output");

const STORAGE_KEY = "vendo-api-console";
const numberFormatter = new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
});

function setStatus(target, type, text) {
    if (!target) {
        return;
    }

    target.className = `status ${type}`;
    target.textContent = text;
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

function collectKkwCostsValues() {
    return {
        kkwNumbers: kkwCostsForm.kkwNumbers.value.trim(),
    };
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
                <td colspan="6" class="empty-state">Brak operacji dla tego KKW.</td>
            </tr>
        `;
    } else {
        kkwCostsOperationsBody.innerHTML = operationLeaves.map((item) => `
            <tr>
                <td>${item.Nazwa ?? "-"}</td>
                <td>${formatStock(item?.Tech?.Ilosc)}</td>
                <td>${formatStock(item?.Post?.Ilosc)}</td>
                <td>${formatStock(item?.Tech?.Wartosc)}</td>
                <td>${formatStock(item?.Post?.Wartosc)}</td>
                <td>${Math.round(Number(item?.In?.Cena ?? item?.Tech?.Cena) || 0)}</td>
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
            <td colspan="6" class="empty-state">Jeszcze nie pobrano operacji.</td>
        </tr>
    `;
    kkwCostsMaterialsBody.innerHTML = `
        <tr>
            <td colspan="8" class="empty-state">Jeszcze nie pobrano materialow.</td>
        </tr>
    `;
    kkwCostsRawOutput.textContent = "Brak danych.";
}

function normalizeKkwOperationSection() {
    const operationsTable = kkwCostsOperationsBody?.closest("table");
    if (!operationsTable) {
        return;
    }

    const operationsSection = kkwCostsOperationsBody.closest(".table-section");
    const heading = operationsSection?.querySelector(".table-section-header h3");
    const description = operationsSection?.querySelector(".table-section-header p");
    const headRow = operationsTable.querySelector("thead tr");

    if (heading) {
        heading.textContent = "Operacje";
    }

    if (description) {
        description.textContent = "Rozbicie kosztow operacyjnych na RBH, koszt i stawke RBH z cennika operacji.";
    }

    if (headRow) {
        headRow.innerHTML = `
            <th>Nazwa operacji</th>
            <th>Rbh Norma</th>
            <th>Rbh Wyk</th>
            <th>Koszt Norma</th>
            <th>Koszt Wyk</th>
            <th>Stawka Rbh</th>
        `;
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

if (saveConnectionButton) {
    saveConnectionButton.addEventListener("click", () => {
        saveConnection();
    });
}

if (kkwCostsForm) {
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
}

if (clearButton) {
    clearButton.addEventListener("click", () => {
        connectionForm.reset();
        localStorage.removeItem(STORAGE_KEY);
        clearKkwCostsResults();
        setStatus(kkwCostsStatusBadge, "idle", "Gotowe");
    });
}

if (connectionForm) {
    loadStoredValues();
}

normalizeKkwOperationSection();
clearKkwCostsResults();
