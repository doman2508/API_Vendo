const connectionForm = document.getElementById("connection-form");
const sandboxForm = document.getElementById("sandbox-form");
const saveConnectionButton = document.getElementById("save-connection");
const clearButton = document.getElementById("clear-button");
const submitBtn = document.getElementById("submit-btn");
const statusBadge = document.getElementById("status-badge");
const errorBox = document.getElementById("error-box");
const resultArea = document.getElementById("result-area");
const resultOutput = document.getElementById("result-output");

const STORAGE_KEY = "vendo-api-console";
const currencyFormatter = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFormatter = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 0, maximumFractionDigits: 4 });

function fmt(v) { return currencyFormatter.format(Number(v) || 0); }
function fmtQty(v) { return qtyFormatter.format(Number(v) || 0); }

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

function renderInvoices(data) {
    const records = data.Rekordy || [];
    if (!records.length) {
        resultArea.innerHTML = '<div style="color:#999;padding:16px 0;">Brak faktur w podanym okresie.</div>';
        return;
    }

    const rows = records.map((inv, idx) => {
        const pozycje = Array.isArray(inv.Pozycje) ? inv.Pozycje : [];
        const hasPoz = pozycje.length > 0;

        const pozRows = pozycje.map((p) => {
            const nazwa = p.Nazwa || p.Towar?.Kod || "-";
            const ilosc = Number(p.Ilosc) || 0;
            const cenaNetto = Number(p.CenaNettoWalutaDok) || 0;
            const wartoscNetto = ilosc * cenaNetto;
            return `<tr>
                <td class="name-cell">${nazwa}</td>
                <td style="text-align:right;">${fmtQty(ilosc)}</td>
                <td style="text-align:right;">${fmt(cenaNetto)}</td>
                <td style="text-align:right;">${fmt(wartoscNetto)}</td>
            </tr>`;
        }).join("");

        return `
            <tr class="inv-row" data-idx="${idx}" style="cursor:${hasPoz ? 'pointer' : 'default'};">
                <td style="font-weight:600;">${inv.NumerPelny || "-"}${hasPoz ? ' ▸' : ''}</td>
                <td>${inv.Klient1Nazwa || "-"}</td>
                <td style="text-align:right;">${fmt(inv.WartoscNetto)}</td>
                <td style="text-align:center;">${pozycje.length}</td>
            </tr>
            ${hasPoz ? `<tr class="inv-pozycje hidden" data-parent="${idx}">
                <td colspan="4" style="padding:0;">
                    <table style="width:100%;border-collapse:collapse;font-size:11px;background:#f8f9fa;">
                        <thead><tr>
                            <th style="padding:3px 8px;text-align:left;">Nazwa</th>
                            <th style="padding:3px 8px;text-align:right;">Ilosc</th>
                            <th style="padding:3px 8px;text-align:right;">Cena netto</th>
                            <th style="padding:3px 8px;text-align:right;">Wartosc netto</th>
                        </tr></thead>
                        <tbody>${pozRows}</tbody>
                    </table>
                </td>
            </tr>` : ''}
        `;
    }).join("");

    resultArea.innerHTML = `
        <section class="table-section">
            <div class="table-section-header">
                <p>${data.Razem} faktur za okres ${data.Miesiac}</p>
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Numer faktury</th>
                            <th>Klient</th>
                            <th style="text-align:right;">Netto</th>
                            <th style="text-align:center;">Poz.</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </section>
    `;

    resultArea.querySelectorAll(".inv-row").forEach((row) => {
        row.addEventListener("click", () => {
            const idx = row.dataset.idx;
            const pozRow = resultArea.querySelector(`.inv-pozycje[data-parent="${idx}"]`);
            if (!pozRow) return;
            const isHidden = pozRow.classList.toggle("hidden");
            const cell = row.querySelector("td");
            if (cell) cell.textContent = cell.textContent.replace(/ [▸▾]/, '') + (isHidden ? ' ▸' : ' ▾');
        });
    });
}

if (saveConnectionButton) {
    saveConnectionButton.addEventListener("click", () => saveConnection());
}

if (clearButton) {
    clearButton.addEventListener("click", () => {
        connectionForm.reset();
        localStorage.removeItem(STORAGE_KEY);
        resultArea.innerHTML = "";
        resultOutput.textContent = "Brak danych.";
        errorBox.classList.add("hidden");
        setStatus("idle", "Gotowe");
    });
}

if (sandboxForm) {
    sandboxForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        saveConnection();
        errorBox.classList.add("hidden");
        resultArea.innerHTML = '<div style="color:#999;padding:16px 0;">Pobieranie...</div>';
        resultOutput.textContent = "Pobieranie...";
        setStatus("loading", "Pobieranie");
        submitBtn.disabled = true;

        try {
            const month = sandboxForm.month.value.trim();
            const data = await postJson("/api/sandbox/invoices", {
                vendoUserLogin: connectionForm.vendoUserLogin.value.trim(),
                vendoUserPassword: connectionForm.vendoUserPassword.value,
                month,
            });
            resultOutput.textContent = JSON.stringify(data, null, 2);
            renderInvoices(data);
            setStatus("success", `Sukces — ${data.Razem ?? "?"} faktur`);
        } catch (err) {
            errorBox.textContent = err.message;
            errorBox.classList.remove("hidden");
            resultArea.innerHTML = "";
            resultOutput.textContent = "Blad.";
            setStatus("error", "Blad");
        } finally {
            submitBtn.disabled = false;
        }
    });
}

if (connectionForm) loadStoredValues();
