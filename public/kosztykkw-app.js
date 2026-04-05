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

let lastKkwData = null;
let extraCostValue = 0;

const STORAGE_KEY = "vendo-api-console";
const numberFormatter = new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
});
const currencyFormatter = new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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
    const quantity = Number(result.Ilosc) || 0;
    const extraPerUnit = extraCostValue;
    const extraGlobal = extraPerUnit * quantity;
    const productLabel = [result.TowarKod, result.TowarNazwa].filter(Boolean).join(" - ");
    const materialowkaCostValue =
        summary.MaterialowkaKosztKalkulacyjny ?? summary.MaterialowkaKosztPoRealizacji;

    const matPerUnit = Number(summary.MaterialyNaSztuke) || 0;
    const opsPerUnit = Number(summary.OperacjeWgNowychStawekNaSztuke) || 0;
    const totalPerUnit = matPerUnit + opsPerUnit + extraPerUnit;

    const matGlobal = Number(summary.MaterialyPostWartosc) || 0;
    const opsGlobal = Number(summary.OperacjeWgNowychStawek) || 0;
    const totalGlobal = matGlobal + opsGlobal + extraGlobal;

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

    const globalCards = [
        ["Koszt calkowity", currencyFormatter.format(totalGlobal)],
        ["Materialy po realizacji", currencyFormatter.format(matGlobal)],
        ["Operacje wg stawek", currencyFormatter.format(opsGlobal)],
        ["Koszt materialow z materialowki", currencyFormatter.format(Number(materialowkaCostValue) || 0)],
    ];
    if (extraGlobal > 0) {
        globalCards.push(["Koszty dodatkowe", currencyFormatter.format(extraGlobal)]);
    }

    kkwCostsSummary.innerHTML = [
        renderGroup("Identyfikacja", "identity", [
            ["Numer KKW", result.KkwNumer || "-"],
            ["Produkt", productLabel || "-", true],
            ["Ilosc KKW", formatStock(result.Ilosc)],
            ["Caly obiekt", report.Korzen?.Nazwa || result.KkwNumer || "-"],
        ]),
        renderGroup("Koszty globalne", "financial", globalCards),
        `<section class="summary-group summary-group-unit">
            <div class="summary-group-header">
                <h3>Koszt na sztuke</h3>
            </div>
            <div class="summary-group-grid">
                <div class="summary-card">
                    <span>RAZEM</span>
                    <strong>${currencyFormatter.format(totalPerUnit)}</strong>
                </div>
                <div class="summary-card">
                    <span>Materialy</span>
                    <strong>${currencyFormatter.format(matPerUnit)}</strong>
                </div>
                <div class="summary-card">
                    <span>Montaz</span>
                    <strong>${currencyFormatter.format(opsPerUnit)}</strong>
                </div>
                <div class="summary-card">
                    <span>Koszty dodatkowe</span>
                    <input id="extra-cost-input" type="number" step="0.01" min="0"
                        value="${extraCostValue || ''}"
                        placeholder="0.00"
                        style="width:100%; padding:4px 6px; border:1px solid #ddd; border-radius:6px;
                               font-size:14px; font-weight:600; font-family:inherit;
                               font-variant-numeric:tabular-nums; color:#212529;">
                </div>
            </div>
        </section>`,
    ].join("");
    kkwCostsSummary.classList.remove("hidden");

    const input = document.getElementById("extra-cost-input");
    if (input) {
        input.addEventListener("input", () => {
            extraCostValue = Number(input.value) || 0;
            if (lastKkwData) renderKkwCostsSummaryCards(lastKkwData);
        });
    }
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
                <td colspan="5" class="empty-state">Brak danych o operacjach.</td>
            </tr>
        `;
    } else {
        kkwCostsOperationsBody.innerHTML = operationLeaves.map((item) => {
            const name = item.Nazwa ?? "-";
            const jednorazowa = item.Jednorazowa || false;
            const stawka = item.StawkaNowa;
            const koszt = item.KosztWgStawki;
            return `
            <tr style="${jednorazowa ? 'opacity: 0.45; text-decoration: line-through;' : ''}">
                <td>${name}${jednorazowa ? ' (jednorazowa)' : ''}</td>
                <td>${formatStock(item?.Post?.Ilosc)}</td>
                <td>${formatStock(item?.Tech?.Ilosc)}</td>
                <td>${stawka != null ? currencyFormatter.format(stawka) : '-'}</td>
                <td>${koszt != null ? currencyFormatter.format(koszt) : '-'}</td>
            </tr>
            `;
        }).join("");
    }

    if (!materialRows.length) {
        kkwCostsMaterialsBody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">Brak materialow dla tego KKW.</td>
            </tr>
        `;
        return;
    }

    let materialsSortCol = null;
    let materialsSortAsc = true;
    const materialsTable = kkwCostsMaterialsBody.closest("table");

    function renderMaterialRows(rows) {
        kkwCostsMaterialsBody.innerHTML = rows.map((item) => {
            const ilosc = Number(item.IloscZWykonania) || 0;
            const przeniesiona = Number(item.IloscPrzeniesiona) || 0;
            const uzyto = przeniesiona - ilosc;
            const uzytoStr = uzyto > 0 ? "+" + formatStock(uzyto) : formatStock(uzyto);
            return `
                <tr>
                    <td>${item.SkladnikKod ?? "-"}</td>
                    <td class="name-cell" title="${item.SkladnikNazwa ?? ''}">${item.SkladnikNazwa ?? "-"}</td>
                    <td>${formatStock(ilosc)}</td>
                    <td>${uzytoStr}</td>
                    <td style="width:72px; text-align:right;">${currencyFormatter.format(Number(item.CenaPoRealizacji) || 0)}</td>
                    <td style="width:84px; text-align:right;">${currencyFormatter.format(Number(item.KosztPoRealizacji) || 0)}</td>
                </tr>
            `;
        }).join("");
    }

    function sortMaterials(colIndex) {
        if (materialsSortCol === colIndex) {
            materialsSortAsc = !materialsSortAsc;
        } else {
            materialsSortCol = colIndex;
            materialsSortAsc = true;
        }

        const keys = [
            (r) => (r.SkladnikKod ?? "").toLowerCase(),
            (r) => (r.SkladnikNazwa ?? "").toLowerCase(),
            (r) => Number(r.IloscZWykonania) || 0,
            (r) => (Number(r.IloscPrzeniesiona) || 0) - (Number(r.IloscZWykonania) || 0),
            (r) => Number(r.CenaPoRealizacji) || 0,
            (r) => Number(r.KosztPoRealizacji) || 0,
        ];
        const keyFn = keys[colIndex] || keys[0];
        const sorted = [...materialRows].sort((a, b) => {
            const va = keyFn(a);
            const vb = keyFn(b);
            if (va < vb) return materialsSortAsc ? -1 : 1;
            if (va > vb) return materialsSortAsc ? 1 : -1;
            return 0;
        });

        renderMaterialRows(sorted);

        const headers = materialsTable.querySelectorAll("thead th");
        headers.forEach((th, i) => {
            th.textContent = th.textContent.replace(/ [▲▼]$/, "");
            if (i === colIndex) {
                th.textContent += materialsSortAsc ? " ▲" : " ▼";
            }
        });
    }

    if (materialsTable) {
        materialsTable.querySelectorAll("thead th").forEach((th, i) => {
            th.style.cursor = "pointer";
            th.addEventListener("click", () => sortMaterials(i));
        });
    }

    renderMaterialRows(materialRows);
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
            <td colspan="5" class="empty-state">Jeszcze nie pobrano operacji.</td>
        </tr>
    `;
    kkwCostsMaterialsBody.innerHTML = `
        <tr>
            <td colspan="6" class="empty-state">Jeszcze nie pobrano materialow.</td>
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
        heading.textContent = "Operacje (wg nowych stawek)";
    }

    if (description) {
        description.textContent = "Koszty operacji przeliczone na podstawie Rbh z wykonan i aktualnych stawek.";
    }

    if (headRow) {
        headRow.innerHTML = `
            <th>Nazwa operacji</th>
            <th>Rbh</th>
            <th>Rbh (norma)</th>
            <th>Stawka</th>
            <th>Koszt wg stawki</th>
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

            lastKkwData = data;
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
        lastKkwData = null;
        extraCostValue = 0;
        clearKkwCostsResults();
        setStatus(kkwCostsStatusBadge, "idle", "Gotowe");
    });
}

if (connectionForm) {
    loadStoredValues();
}

normalizeKkwOperationSection();
clearKkwCostsResults();
