const connectionForm = document.getElementById("connection-form");
const mainForm = document.getElementById("main-form");
const saveConnectionButton = document.getElementById("save-connection");
const clearButton = document.getElementById("clear-button");
const submitBtn = document.getElementById("submit-btn");
const statusBadge = document.getElementById("status-badge");
const errorBox = document.getElementById("error-box");
const summaryArea = document.getElementById("summary-area");
const invoicesArea = document.getElementById("invoices-area");
const detailArea = document.getElementById("detail-area");
const clientReportArea = document.getElementById("client-report-area");
const rawOutput = document.getElementById("raw-output");

const STORAGE_KEY = "vendo-api-console";
const fmt = (v) => new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0);
const fmtQty = (v) => new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(Number(v) || 0);
const fmtPct = (v) => (v >= 0 ? "+" : "") + fmt(v) + "%";
const marginColor = (pct) => pct < 0 ? "#c62828" : pct <= 10 ? "#e6a700" : "#2e7d32";

let lastData = null;
let lastPositions = [];
let computedMargins = {};
let computedCostPerUnit = {};
let currentSort = { col: null, asc: true };
let filterText = "";

function setStatus(type, text) {
    if (!statusBadge) return;
    statusBadge.className = `status ${type}`;
    statusBadge.textContent = text;
}

function loadStoredValues() {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        for (const [key, value] of Object.entries(stored)) {
            const field = connectionForm.elements.namedItem(key);
            if (field && typeof value === "string") field.value = value;
        }
    } catch { localStorage.removeItem(STORAGE_KEY); }
}

function saveConnection() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        vendoUserLogin: connectionForm.vendoUserLogin.value.trim(),
        vendoUserPassword: connectionForm.vendoUserPassword.value,
    }));
}

function getCredentials() {
    return {
        vendoUserLogin: connectionForm.vendoUserLogin.value.trim(),
        vendoUserPassword: connectionForm.vendoUserPassword.value,
    };
}

async function postJson(url, payload) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Operacja nie powiodla sie.");
    return data;
}

function renderSummary(data) {
    const invoices = data.Faktury || [];
    const totalNetto = invoices.reduce((s, fv) => s + (Number(fv.WartoscNetto) || 0), 0);
    const withKkw = invoices.reduce((s, fv) => {
        const pozycje = fv.Pozycje || [];
        return s + pozycje.filter(p => p.KkwLinks?.length > 0).length;
    }, 0);
    const totalPoz = invoices.reduce((s, fv) => s + (fv.Pozycje?.length || 0), 0);

    summaryArea.innerHTML = `
        <section class="summary-group summary-group-identity">
            <div class="summary-group-header"><h3>Podsumowanie</h3></div>
            <div class="summary-group-grid">
                <div class="summary-card"><span>Faktury</span><strong>${invoices.length}</strong></div>
                <div class="summary-card"><span>Sprzedaz netto</span><strong>${fmt(totalNetto)}</strong></div>
                <div class="summary-card"><span>Pozycje z KKW</span><strong>${withKkw} / ${totalPoz}</strong></div>
                <div class="summary-card"><span>Okres</span><strong>${data.Miesiac}</strong></div>
            </div>
        </section>
    `;
}

function renderInvoices(data) {
    const invoices = data.Faktury || [];
    if (!invoices.length) {
        invoicesArea.innerHTML = '<div style="color:#999;padding:16px 0;">Brak faktur w podanym okresie.</div>';
        return;
    }

    // Flatten all positions (only once, on fresh data)
    if (!lastPositions.length || lastPositions[0]?.fv !== invoices[0]) {
        lastPositions = [];
        invoices.forEach((fv, fvIdx) => {
            (fv.Pozycje || []).forEach((p, pIdx) => {
                lastPositions.push({ fv, fvIdx, p, pIdx });
            });
        });
    }

    renderPositionsTable(data);
}

function getSortValue(item, col) {
    const { fv, fvIdx, p, pIdx } = item;
    const key = `${fvIdx}-${pIdx}`;
    switch (col) {
        case "faktura": return fv.NumerPelny || "";
        case "klient": return fv.Klient1Nazwa || "";
        case "kod": return p.TowarKod || "";
        case "kkw": return p.KkwLinks?.length ? p.KkwLinks[0].KKWNumer : "";
        case "marza": return computedMargins[key] ?? -Infinity;
        default: return "";
    }
}

function sortPositions(col) {
    if (currentSort.col === col) {
        currentSort.asc = !currentSort.asc;
    } else {
        currentSort.col = col;
        currentSort.asc = col === "marza" ? false : true;
    }
    renderPositionsTable(lastData);
}

function getFilteredPositions() {
    if (!filterText) return lastPositions;
    const q = filterText.toLowerCase();
    return lastPositions.filter(({ fv, p }) => {
        const klient = (fv.Klient1Nazwa || "").toLowerCase();
        const nazwa = (p.Nazwa || "").toLowerCase();
        return klient.includes(q) || nazwa.includes(q);
    });
}

function renderPositionsTable(data) {
    const invoices = data.Faktury || [];
    const filtered = getFilteredPositions();
    const sorted = [...filtered];

    if (currentSort.col) {
        const isNumeric = currentSort.col === "marza";
        sorted.sort((a, b) => {
            let va = getSortValue(a, currentSort.col);
            let vb = getSortValue(b, currentSort.col);
            if (isNumeric) {
                return currentSort.asc ? va - vb : vb - va;
            }
            va = String(va).toLowerCase();
            vb = String(vb).toLowerCase();
            return currentSort.asc ? va.localeCompare(vb, "pl") : vb.localeCompare(va, "pl");
        });
    }

    const sortIcon = (col) => {
        if (currentSort.col !== col) return ' <span style="opacity:0.3;">&#8597;</span>';
        return currentSort.asc ? ' &#9650;' : ' &#9660;';
    };
    const thSort = (col, label, style = "") =>
        `<th style="cursor:pointer;user-select:none;${style}" data-sort="${col}">${label}${sortIcon(col)}</th>`;

    const rows = sorted.map(({ fv, fvIdx, p, pIdx }) => {
        const kod = p.TowarKod || "-";
        const nazwa = p.Nazwa || "-";
        const klient = fv.Klient1Nazwa || "-";
        const ilosc = Number(p.Ilosc) || 0;
        const cenaNetto = Number(p.CenaNetto) || 0;
        const wartoscNetto = ilosc * cenaNetto;
        const hasKkw = p.KkwLinks?.length > 0;
        const kkwInfo = hasKkw
            ? p.KkwLinks.map(l => l.KKWNumer).join(", ")
            : '<span style="color:#999;">brak</span>';

        const key = `${fvIdx}-${pIdx}`;
        let marginHtml = "—";
        if (computedMargins[key] !== undefined) {
            const m = computedMargins[key];
            const color = marginColor(m);
            marginHtml = `<span style="color:${color};font-weight:600;">${fmtPct(m)}</span>`;
        }

        return `<tr class="poz-row" data-fv="${fvIdx}" data-poz="${pIdx}" style="cursor:${hasKkw ? 'pointer' : 'default'};">
            <td style="font-family:'Cascadia Code','Fira Code',Consolas,monospace;font-size:11px;">${fv.NumerPelny || "-"}</td>
            <td style="font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${klient}">${klient}</td>
            <td style="font-size:11px;">${kod}</td>
            <td class="name-cell">${nazwa}</td>
            <td style="text-align:right;">${fmtQty(ilosc)}</td>
            <td style="text-align:right;">${fmt(cenaNetto)}</td>
            <td style="text-align:right;">${fmt(wartoscNetto)}</td>
            <td style="font-size:10px;">${kkwInfo}</td>
            <td id="margin-${fvIdx}-${pIdx}" style="text-align:right;font-size:11px;">${marginHtml}</td>
        </tr>`;
    }).join("");

    invoicesArea.innerHTML = `
        <section class="table-section">
            <div class="table-section-header" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <p style="margin:0;">${filtered.length}${filtered.length !== lastPositions.length ? " / " + lastPositions.length : ""} pozycji z ${invoices.length} faktur za okres ${data.Miesiac}</p>
                <input type="text" id="filter-input" placeholder="Filtruj klient / nazwa..." value="${filterText}" style="font-size:12px;padding:4px 8px;border:1px solid #ccc;border-radius:4px;width:200px;">
                <button type="button" id="calc-all-btn" class="btn btn-primary" style="font-size:12px;padding:4px 12px;">Policz marze dla wszystkich</button>
                <button type="button" id="copy-clipboard-btn" class="btn btn-ghost" style="font-size:12px;padding:4px 12px;">Kopiuj do schowka</button>
                <span id="calc-all-progress" style="font-size:11px;color:#666;"></span>
            </div>
            <div class="table-wrap" style="max-height:calc(100vh - 380px);">
                <table>
                    <thead><tr>
                        ${thSort("faktura", "Faktura")}
                        ${thSort("klient", "Klient")}
                        ${thSort("kod", "Kod")}
                        <th>Nazwa</th>
                        <th style="text-align:right;">Ilosc</th>
                        <th style="text-align:right;">Cena netto</th>
                        <th style="text-align:right;">Wartosc</th>
                        ${thSort("kkw", "KKW")}
                        ${thSort("marza", "Marza", "text-align:right;")}
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </section>
    `;

    // Sort header click handlers
    invoicesArea.querySelectorAll("th[data-sort]").forEach(th => {
        th.addEventListener("click", () => sortPositions(th.dataset.sort));
    });

    // Filter input
    const filterInput = document.getElementById("filter-input");
    if (filterInput) {
        filterInput.addEventListener("input", (e) => {
            filterText = e.target.value.trim();
            renderPositionsTable(lastData);
            // Re-focus and restore cursor position
            const fi = document.getElementById("filter-input");
            if (fi) { fi.focus(); fi.selectionStart = fi.selectionEnd = fi.value.length; }
        });
    }

    // Click position to calculate profitability
    invoicesArea.querySelectorAll(".poz-row").forEach((row) => {
        row.addEventListener("click", async () => {
            const fvIdx = Number(row.dataset.fv);
            const pozIdx = Number(row.dataset.poz);
            const fv = lastData.Faktury[fvIdx];
            const poz = fv?.Pozycje?.[pozIdx];
            if (!poz?.KkwLinks?.length) return;
            await loadPozycjaDetail(fvIdx, pozIdx, fv, poz);
        });
    });

    // Calculate margins for all positions
    const calcAllBtn = document.getElementById("calc-all-btn");
    if (calcAllBtn) {
        calcAllBtn.addEventListener("click", () => calculateAllMargins(lastPositions));
    }

    // Copy to clipboard
    const copyBtn = document.getElementById("copy-clipboard-btn");
    if (copyBtn) {
        copyBtn.addEventListener("click", () => copyTableToClipboard(sorted));
    }
}

async function loadPozycjaDetail(fvIdx, pozIdx, fv, poz) {
    const marginCell = document.getElementById(`margin-${fvIdx}-${pozIdx}`);
    if (marginCell) marginCell.innerHTML = '<span style="color:#1565c0;">...</span>';

    try {
        const kkwIds = poz.KkwLinks.map(l => l.KKWID);
        const data = await postJson("/api/rentownosc/kkw-costs", {
            ...getCredentials(),
            kkwIds,
        });

        const costs = data.Koszty || {};
        let totalCost = 0;
        let totalQty = 0;

        const kkwDetails = poz.KkwLinks.map(link => {
            const c = costs[link.KKWID] || {};
            const matPerUnit = Number(c.MaterialyNaSztuke) || 0;
            const opsPerUnit = Number(c.OperacjeWgNowychStawekNaSztuke) || 0;
            const costPerUnit = matPerUnit + opsPerUnit;
            totalCost += costPerUnit * link.Ilosc;
            totalQty += link.Ilosc;
            return { ...link, ...c, costPerUnit, matPerUnit, opsPerUnit };
        });

        const avgCost = totalQty > 0 ? totalCost / totalQty : 0;
        const cenaNetto = Number(poz.CenaNetto) || 0;
        const zysk = cenaNetto - avgCost;
        const marza = cenaNetto > 0 ? (zysk / cenaNetto) * 100 : 0;
        const color = marginColor(marza);

        computedMargins[`${fvIdx}-${pozIdx}`] = marza;
        computedCostPerUnit[`${fvIdx}-${pozIdx}`] = avgCost;

        if (marginCell) {
            marginCell.innerHTML = `<span style="color:${color};font-weight:600;">${fmtPct(marza)}</span>`;
        }

        // Render detail panel
        const detailRows = kkwDetails.map(d => `
            <tr>
                <td style="font-weight:600;">${d.KKWNumer}</td>
                <td style="text-align:right;">${fmtQty(d.Ilosc)}</td>
                <td style="text-align:right;">${fmt(d.matPerUnit)}</td>
                <td style="text-align:right;">${fmt(d.opsPerUnit)}</td>
                <td style="text-align:right;font-weight:600;">${fmt(d.costPerUnit)}</td>
            </tr>
        `).join("");

        detailArea.innerHTML = `
            <section class="summary-group summary-group-unit" style="margin-top:12px;">
                <div class="summary-group-header"><h3>Rentownosc: ${poz.Nazwa || poz.TowarKod}</h3></div>
                <div class="summary-group-grid">
                    <div class="summary-card"><span>Cena sprzedazy</span><strong>${fmt(cenaNetto)}</strong></div>
                    <div class="summary-card"><span>Koszt wytworzenia</span><strong>${fmt(avgCost)}</strong></div>
                    <div class="summary-card"><span>Zysk na szt.</span><strong style="color:${color}">${fmt(zysk)}</strong></div>
                    <div class="summary-card"><span>Marza</span><strong style="color:${color}">${fmtPct(marza)}</strong></div>
                </div>
            </section>
            <section class="table-section" style="margin-top:8px;">
                <div class="table-section-header"><p>KKW powiazane z ta pozycja (${fv.NumerPelny})</p></div>
                <div class="table-wrap">
                    <table>
                        <thead><tr>
                            <th>KKW</th>
                            <th style="text-align:right;">Ilosc</th>
                            <th style="text-align:right;">Materialy/szt</th>
                            <th style="text-align:right;">Operacje/szt</th>
                            <th style="text-align:right;">Koszt/szt</th>
                        </tr></thead>
                        <tbody>${detailRows}</tbody>
                    </table>
                </div>
            </section>
        `;
    } catch (err) {
        if (marginCell) marginCell.innerHTML = '<span style="color:#c62828;">blad</span>';
        detailArea.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
}

function copyTableToClipboard(positions) {
    const fmtNum = (v) => String(Number(v) || 0).replace(".", ",");
    const header = ["Faktura", "Klient", "Kod", "Nazwa", "Ilosc", "Cena netto", "Wartosc", "KKW", "Marza %"].join("\t");
    const rows = positions.map(({ fv, fvIdx, p, pIdx }) => {
        const ilosc = Number(p.Ilosc) || 0;
        const cenaNetto = Number(p.CenaNetto) || 0;
        const wartoscNetto = ilosc * cenaNetto;
        const kkw = p.KkwLinks?.length ? p.KkwLinks.map(l => l.KKWNumer).join(", ") : "";
        const key = `${fvIdx}-${pIdx}`;
        const marza = computedMargins[key] !== undefined ? fmtNum(computedMargins[key].toFixed(2)) : "";
        return [
            fv.NumerPelny || "",
            fv.Klient1Nazwa || "",
            p.TowarKod || "",
            p.Nazwa || "",
            fmtNum(ilosc),
            fmtNum(cenaNetto.toFixed(2)),
            fmtNum(wartoscNetto.toFixed(2)),
            kkw,
            marza,
        ].join("\t");
    });

    const tsv = [header, ...rows].join("\n");
    navigator.clipboard.writeText(tsv).then(() => {
        const progress = document.getElementById("calc-all-progress");
        if (progress) progress.textContent = `Skopiowano ${rows.length} wierszy do schowka.`;
    }).catch(err => {
        alert("Nie udalo sie skopiowac: " + err.message);
    });
}

async function calculateAllMargins(allPositions) {
    const btn = document.getElementById("calc-all-btn");
    const progress = document.getElementById("calc-all-progress");
    if (btn) btn.disabled = true;

    // Collect all unique KKW IDs across all positions
    const allKkwIds = new Set();
    const positionsWithKkw = [];
    for (const { fv, fvIdx, p, pIdx } of allPositions) {
        if (!p.KkwLinks?.length) continue;
        positionsWithKkw.push({ fv, fvIdx, p, pIdx });
        for (const link of p.KkwLinks) allKkwIds.add(link.KKWID);
    }

    if (progress) progress.textContent = `Pobieranie kosztow dla ${allKkwIds.size} KKW...`;

    // Fetch all KKW costs in batches of 20
    const kkwIdArray = [...allKkwIds];
    const allCosts = {};
    const BATCH = 20;
    for (let i = 0; i < kkwIdArray.length; i += BATCH) {
        const batch = kkwIdArray.slice(i, i + BATCH);
        if (progress) progress.textContent = `Pobieranie kosztow... ${Math.min(i + BATCH, kkwIdArray.length)}/${kkwIdArray.length}`;
        try {
            const data = await postJson("/api/rentownosc/kkw-costs", {
                ...getCredentials(),
                kkwIds: batch,
            });
            Object.assign(allCosts, data.Koszty || {});
        } catch (err) {
            if (progress) progress.textContent = `Blad przy pobieraniu: ${err.message}`;
            if (btn) btn.disabled = false;
            return;
        }
    }

    // Calculate margins for each position
    for (const { fvIdx, p, pIdx } of positionsWithKkw) {
        let totalCost = 0;
        let totalQty = 0;
        for (const link of p.KkwLinks) {
            const c = allCosts[link.KKWID] || {};
            const matPerUnit = Number(c.MaterialyNaSztuke) || 0;
            const opsPerUnit = Number(c.OperacjeWgNowychStawekNaSztuke) || 0;
            const costPerUnit = matPerUnit + opsPerUnit;
            totalCost += costPerUnit * link.Ilosc;
            totalQty += link.Ilosc;
        }

        const avgCost = totalQty > 0 ? totalCost / totalQty : 0;
        const cenaNetto = Number(p.CenaNetto) || 0;
        const zysk = cenaNetto - avgCost;
        const marza = cenaNetto > 0 ? (zysk / cenaNetto) * 100 : 0;
        const key = `${fvIdx}-${pIdx}`;
        computedMargins[key] = marza;
        computedCostPerUnit[key] = avgCost;
    }

    // Re-render table with computed margins
    renderPositionsTable(lastData);

    // Generate client profitability report
    renderClientReport();

    // Restore progress text after re-render
    const progress2 = document.getElementById("calc-all-progress");
    if (progress2) progress2.textContent = `Gotowe — ${positionsWithKkw.length} pozycji obliczonych.`;
    const btn2 = document.getElementById("calc-all-btn");
    if (btn2) btn2.disabled = false;
}

function renderClientReport() {
    if (!clientReportArea || !lastPositions.length) return;

    // Aggregate per client — only positions with computed margins, excluding outliers
    const clients = {};
    for (const { fv, fvIdx, p, pIdx } of lastPositions) {
        const key = `${fvIdx}-${pIdx}`;
        if (computedMargins[key] === undefined) continue;
        const marza = computedMargins[key];
        // Odrzuc pozycje z marza < -10% lub > 90%
        if (marza < -110 || marza > 90) continue;

        const klient = fv.Klient1Nazwa || "(brak klienta)";
        if (!clients[klient]) clients[klient] = { przychod: 0, koszt: 0, pozycji: 0, odrzuconych: 0 };

        const ilosc = Number(p.Ilosc) || 0;
        const cenaNetto = Number(p.CenaNetto) || 0;
        const kosztJedn = computedCostPerUnit[key] || 0;

        clients[klient].przychod += ilosc * cenaNetto;
        clients[klient].koszt += ilosc * kosztJedn;
        clients[klient].pozycji++;
    }

    // Count excluded per client
    for (const { fv, fvIdx, p, pIdx } of lastPositions) {
        const key = `${fvIdx}-${pIdx}`;
        if (computedMargins[key] === undefined) continue;
        const marza = computedMargins[key];
        if (marza < -110 || marza > 90) {
            const klient = fv.Klient1Nazwa || "(brak klienta)";
            if (!clients[klient]) clients[klient] = { przychod: 0, koszt: 0, pozycji: 0, odrzuconych: 0 };
            clients[klient].odrzuconych++;
        }
    }

    // Sort by revenue descending
    const sorted = Object.entries(clients)
        .map(([nazwa, d]) => {
            const zysk = d.przychod - d.koszt;
            const marza = d.przychod > 0 ? (zysk / d.przychod) * 100 : 0;
            return { nazwa, ...d, zysk, marza };
        })
        .sort((a, b) => b.przychod - a.przychod);

    // Totals
    const totPrzychod = sorted.reduce((s, c) => s + c.przychod, 0);
    const totKoszt = sorted.reduce((s, c) => s + c.koszt, 0);
    const totZysk = totPrzychod - totKoszt;
    const totMarza = totPrzychod > 0 ? (totZysk / totPrzychod) * 100 : 0;
    const totPoz = sorted.reduce((s, c) => s + c.pozycji, 0);
    const totOdrz = sorted.reduce((s, c) => s + c.odrzuconych, 0);

    const rows = sorted.map(c => {
        const color = marginColor(c.marza);
        return `<tr>
            <td style="font-weight:500;">${c.nazwa}</td>
            <td style="text-align:right;">${c.pozycji}${c.odrzuconych ? ` <span style="color:#999;font-size:10px;">(-${c.odrzuconych})</span>` : ""}</td>
            <td style="text-align:right;">${fmt(c.przychod)}</td>
            <td style="text-align:right;">${fmt(c.koszt)}</td>
            <td style="text-align:right;color:${color};font-weight:600;">${fmt(c.zysk)}</td>
            <td style="text-align:right;color:${color};font-weight:600;">${fmtPct(c.marza)}</td>
        </tr>`;
    }).join("");

    const totColor = marginColor(totMarza);

    clientReportArea.innerHTML = `
        <details class="raw-panel" style="margin-top:12px;">
            <summary style="cursor:pointer;font-weight:600;font-size:13px;padding:8px 0;">
                Rentownosc wg klientow (${sorted.length} klientow, marza laczna: <span style="color:${totColor};">${fmtPct(totMarza)}</span>)
            </summary>
            <p style="font-size:11px;color:#666;margin:4px 0 8px;">Odrzucone pozycje z marza &lt; -110% lub &gt; 90%. Pozycji uwzglednionych: ${totPoz}${totOdrz ? `, odrzuconych: ${totOdrz}` : ""}.</p>
            <section class="table-section">
                <div class="table-wrap" style="max-height:400px;">
                    <table>
                        <thead><tr>
                            <th>Klient</th>
                            <th style="text-align:right;">Pozycji</th>
                            <th style="text-align:right;">Przychod netto</th>
                            <th style="text-align:right;">Koszt KKW</th>
                            <th style="text-align:right;">Zysk</th>
                            <th style="text-align:right;">Marza</th>
                        </tr></thead>
                        <tbody>
                            ${rows}
                            <tr style="border-top:2px solid #333;font-weight:700;">
                                <td>RAZEM</td>
                                <td style="text-align:right;">${totPoz}</td>
                                <td style="text-align:right;">${fmt(totPrzychod)}</td>
                                <td style="text-align:right;">${fmt(totKoszt)}</td>
                                <td style="text-align:right;color:${totColor};">${fmt(totZysk)}</td>
                                <td style="text-align:right;color:${totColor};">${fmtPct(totMarza)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>
        </details>
    `;
}

function clearAll() {
    summaryArea.innerHTML = "";
    invoicesArea.innerHTML = "";
    if (clientReportArea) clientReportArea.innerHTML = "";
    detailArea.innerHTML = "";
    rawOutput.textContent = "Brak danych.";
    errorBox.classList.add("hidden");
    lastData = null;
    lastPositions = [];
    computedMargins = {};
    computedCostPerUnit = {};
    currentSort = { col: null, asc: true };
    filterText = "";
}

if (saveConnectionButton) saveConnectionButton.addEventListener("click", () => saveConnection());

if (clearButton) {
    clearButton.addEventListener("click", () => {
        connectionForm.reset();
        localStorage.removeItem(STORAGE_KEY);
        clearAll();
        setStatus("idle", "Gotowe");
    });
}

if (mainForm) {
    mainForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        saveConnection();
        clearAll();
        setStatus("loading", "Pobieranie faktur...");
        submitBtn.disabled = true;

        try {
            const month = mainForm.month.value.trim();
            const data = await postJson("/api/rentownosc/invoices", {
                ...getCredentials(),
                month,
            });
            lastData = data;
            rawOutput.textContent = JSON.stringify(data, null, 2);
            renderSummary(data);
            renderInvoices(data);
            setStatus("success", `${data.Faktury?.length ?? 0} faktur — kliknij pozycje aby policzyc rentownosc`);
        } catch (err) {
            errorBox.textContent = err.message;
            errorBox.classList.remove("hidden");
            setStatus("error", "Blad");
        } finally {
            submitBtn.disabled = false;
        }
    });
}

if (connectionForm) loadStoredValues();
