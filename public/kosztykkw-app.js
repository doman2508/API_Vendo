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
const docsBody = document.getElementById("docs-body");
const docsZlpInfo = document.getElementById("docs-zlp-info");

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
        renderGroup("Identyfikacja", "identity", (() => {
            const allDocs = result.DokumentyZlecenia?.Wszystkie || [];
            const zoDoc = allDocs.find((d) => d.RodzajKod === "ZO");
            const klient = zoDoc?.Klient1Nazwa || allDocs[0]?.Klient1Nazwa || "-";
            return [
                ["Numer KKW", result.KkwNumer || "-"],
                ["Produkt", productLabel || "-", true],
                ["Ilosc KKW", formatStock(result.Ilosc)],
                ["Termin", formatDate(result.TerminRealizacji)],
                ["Klient", klient],
            ];
        })()),
        renderGroup("Koszty globalne", "financial", globalCards),
        (() => {
            const allDocs = result.DokumentyZlecenia?.Wszystkie || [];
            const zoDoc = allDocs.find((d) => d.RodzajKod === "ZO");
            const fvDocs = allDocs.filter((d) => d.RodzajKod === "FV");
            const towarKod = result.TowarKod;
            let cenaSprzedazy = 0;
            let cenaZrodlo = "";
            for (const fvDoc of fvDocs) {
                if (!fvDoc?.Pozycje) continue;
                const poz = fvDoc.Pozycje.find((p) => p.Towar?.Kod === towarKod);
                if (poz) { cenaSprzedazy = Number(poz.CenaNettoWalutaDok) || 0; cenaZrodlo = "FV"; break; }
            }
            if (!cenaSprzedazy && zoDoc?.Pozycje) {
                const poz = zoDoc.Pozycje.find((p) => p.Towar?.Kod === towarKod);
                if (poz) { cenaSprzedazy = Number(poz.CenaNettoWalutaDok) || 0; cenaZrodlo = "ZO"; }
            }
            const zysk = cenaSprzedazy > 0 ? cenaSprzedazy - totalPerUnit : 0;
            const marza = cenaSprzedazy > 0 ? (zysk / cenaSprzedazy) * 100 : 0;
            const narzut = totalPerUnit > 0 ? (zysk / totalPerUnit) * 100 : 0;
            const zyskColor = zysk >= 0 ? "#2e7d32" : "#c62828";
            const niezafakturowane = cenaZrodlo === "ZO";

            const marzaStr = `${marza >= 0 ? "+" : ""}${currencyFormatter.format(marza)}%`;
            const razemHtml = cenaSprzedazy > 0
                ? `${currencyFormatter.format(totalPerUnit)}/${currencyFormatter.format(cenaSprzedazy)} (<span style="color:${zyskColor}">${marzaStr}</span>)`
                : currencyFormatter.format(totalPerUnit);

            return `<section class="summary-group summary-group-unit">
            <div class="summary-group-header">
                <h3>Koszt na sztuke</h3>
            </div>
            <div class="summary-group-grid">
                <div class="summary-card">
                    <span>RAZEM${niezafakturowane ? ' <span style="color:#c62828;font-weight:600;">NIEZAFAKTUROWANE</span>' : ''}</span>
                    <strong>${razemHtml}</strong>
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
        </section>`;
        })(),
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

function formatDate(dateStr) {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString("pl-PL");
}

function renderDocsSection(data) {
    if (!docsBody) return;
    const result = data?.Wynik || {};
    const docs = result.DokumentyZlecenia?.Wszystkie || [];

    if (docsZlpInfo) {
        const zlpNr = result.ZlecenieNumer;
        docsZlpInfo.textContent = zlpNr
            ? `ZLP: ${zlpNr} (ID: ${result.ZlecenieID}) — ${docs.length} dokumentow`
            : `Brak powiazanego zlecenia produkcyjnego.`;
    }

    if (!docs.length) {
        docsBody.innerHTML = `<tr><td colspan="8" class="empty-state">Brak dokumentow${result.ZlecenieNumer ? " dla ZLP " + result.ZlecenieNumer : ""}.</td></tr>`;
        return;
    }

    const fvDoc = docs.find((d) => d.RodzajKod === "FV");
    const fvIloscByNazwa = new Map();
    if (fvDoc?.Pozycje) {
        for (const p of fvDoc.Pozycje) {
            if (p.Nazwa && p.Ilosc) fvIloscByNazwa.set(p.Nazwa, p.Ilosc);
        }
    }

    docsBody.innerHTML = docs.map((doc, idx) => {
        const typ = doc.RodzajKod || doc.Prefix || "?";
        const numer = doc.NumerPelny || "-";
        const nrObcy = doc.NumerObcy || "-";
        const data1 = formatDate(doc.Data1);
        const klient = doc.Klient1Nazwa || "-";
        const zamkniety = doc.Zamkniety;
        const stan = zamkniety ? "Zamkniete" : "Otwarte";
        const typClass = typ === "ZO" ? "font-weight:600;color:#0066cc;" : typ === "FV" ? "font-weight:600;color:#2e7d32;" : "";

        const pozycje = Array.isArray(doc.Pozycje) ? doc.Pozycje : [];
        const hasPoz = pozycje.length > 0;

        let docNetto = Number(doc.WartoscNetto) || 0;
        let docBrutto = Number(doc.WartoscBrutto) || 0;

        const pozRows = pozycje.map((p) => {
            const nazwa = p.Nazwa || "-";
            const kod = p.Towar?.Kod || "-";
            let ilosc = p.Ilosc ?? 0;
            if (typ === "ZO" && ilosc === 0 && fvIloscByNazwa.has(p.Nazwa)) {
                ilosc = fvIloscByNazwa.get(p.Nazwa);
            }
            const cenaNetto = p.CenaNettoWalutaDok ?? p.CenaNettoWalutaPoz ?? 0;
            const wartNetto = ilosc * cenaNetto;
            if (typ === "ZO") docNetto += wartNetto;
            return `<tr><td>${kod}</td><td class="name-cell">${nazwa}</td><td>${formatStock(ilosc)}</td><td style="text-align:right;">${currencyFormatter.format(cenaNetto)}</td><td style="text-align:right;">${currencyFormatter.format(wartNetto)}</td></tr>`;
        }).join("");
        if (typ === "ZO" && docNetto > 0) docBrutto = docNetto;

        const nettoStr = currencyFormatter.format(docNetto);
        const bruttoStr = typ === "FV" ? currencyFormatter.format(docBrutto) : "";

        return `
            <tr class="doc-row" data-idx="${idx}" style="cursor:${hasPoz ? 'pointer' : 'default'};">
                <td style="${typClass}">${typ}${hasPoz ? ' ▸' : ''}</td>
                <td>${numer}</td>
                <td>${nrObcy}</td>
                <td>${data1}</td>
                <td class="name-cell">${klient}</td>
                <td style="text-align:right;">${nettoStr}</td>
                <td style="text-align:right;">${bruttoStr}</td>
                <td><span class="status ${zamkniety ? 'idle' : 'success'}">${stan}</span></td>
            </tr>
            ${hasPoz ? `<tr class="doc-pozycje hidden" data-parent="${idx}"><td colspan="8" style="padding:0;">
                <table style="width:100%;border-collapse:collapse;font-size:11px;background:#f8f9fa;">
                    <thead><tr><th style="padding:3px 8px;text-align:left;">Kod</th><th style="padding:3px 8px;text-align:left;">Nazwa</th><th style="padding:3px 8px;">Ilosc</th><th style="padding:3px 8px;text-align:right;">Cena netto</th><th style="padding:3px 8px;text-align:right;">Wartosc</th></tr></thead>
                    <tbody>${pozRows}</tbody>
                </table>
            </td></tr>` : ''}
        `;
    }).join("");

    docsBody.querySelectorAll(".doc-row").forEach((row) => {
        row.addEventListener("click", () => {
            const idx = row.dataset.idx;
            const pozRow = docsBody.querySelector(`.doc-pozycje[data-parent="${idx}"]`);
            if (!pozRow) return;
            const isHidden = pozRow.classList.toggle("hidden");
            const typCell = row.querySelector("td");
            if (typCell) {
                typCell.textContent = typCell.textContent.replace(/ [▸▾]/, '') + (isHidden ? ' ▸' : ' ▾');
            }
        });
    });
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
    if (docsBody) {
        docsBody.innerHTML = `<tr><td colspan="8" class="empty-state">Jeszcze nie pobrano dokumentow.</td></tr>`;
    }
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
            renderDocsSection(data);
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

// --- KKW browser ---
const kkwBrowseBtn = document.getElementById("kkw-browse-btn");
const kkwBrowseList = document.getElementById("kkw-browse-list");
const kkwBrowseSearch = document.getElementById("kkw-browse-search");
let kkwBrowsePage = 0;

async function loadKkwBrowser(page = 0) {
    if (!kkwBrowseList) return;
    kkwBrowseBtn.disabled = true;
    kkwBrowseBtn.textContent = "...";
    const search = kkwBrowseSearch?.value?.trim() || "";
    try {
        const data = await postJson("/api/kkw-list", { ...collectConnectionValues(), page, search });
        const records = data.Rekordy || [];
        if (!records.length && page === 0) {
            kkwBrowseList.innerHTML = '<div style="color:#999;padding:8px 0;">Brak rekordow.</div>';
            return;
        }
        const html = records.map((r) => {
            const numer = r.Numer || "-";
            const nazwa = r.TowarNazwa || r.TowarKod || "-";
            const ilosc = Number(r.IloscOczekiwana) || Number(r.IloscWykonana) || 0;
            const termin = formatDate(r.TerminZakonczeniaKKW);
            return `<div class="kkw-browse-item" data-numer="${numer}" style="padding:4px 0;border-bottom:1px solid #eee;cursor:pointer;">
                <div style="display:flex;justify-content:space-between;align-items:baseline;font-family:'Cascadia Code','Fira Code',Consolas,monospace;"><span style="font-weight:600;">${numer}</span><span style="color:#888;font-size:10px;">${formatStock(ilosc)} szt.${termin !== "-" ? " · " + termin : ""}</span></div>
                <div style="color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:10px;" title="${nazwa}">${nazwa}</div>
            </div>`;
        }).join("");

        if (page === 0) {
            kkwBrowseList.innerHTML = html;
        } else {
            kkwBrowseList.insertAdjacentHTML("beforeend", html);
        }

        if (data.WiecejStron) {
            kkwBrowseList.insertAdjacentHTML("beforeend",
                `<div id="kkw-browse-more" style="text-align:center;padding:6px;">
                    <button class="btn btn-ghost" style="padding:3px 10px;font-size:11px;">Wiecej...</button>
                </div>`);
            kkwBrowseList.querySelector("#kkw-browse-more button").addEventListener("click", () => {
                kkwBrowseList.querySelector("#kkw-browse-more").remove();
                kkwBrowsePage++;
                loadKkwBrowser(kkwBrowsePage);
            });
        }

        kkwBrowseList.querySelectorAll(".kkw-browse-item").forEach((item) => {
            item.addEventListener("click", () => {
                const numer = item.dataset.numer;
                kkwCostsForm.kkwNumbers.value = numer;
                kkwCostsForm.dispatchEvent(new Event("submit"));
            });
        });

    } catch (err) {
        kkwBrowseList.innerHTML = `<div style="color:#c62828;padding:8px 0;">${err.message}</div>`;
    } finally {
        kkwBrowseBtn.disabled = false;
        kkwBrowseBtn.textContent = "Zaladuj";
    }
}

if (kkwBrowseBtn) {
    kkwBrowseBtn.addEventListener("click", () => {
        kkwBrowsePage = 0;
        loadKkwBrowser(0);
    });
}

if (kkwBrowseSearch) {
    kkwBrowseSearch.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            kkwBrowsePage = 0;
            loadKkwBrowser(0);
        }
    });
}
