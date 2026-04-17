const operatorDeviceId = "reflow_1";
const scanForm = document.getElementById("operator-scan-form");
const scanInput = document.getElementById("operator-scan-input");
const messageBox = document.getElementById("operator-message");
const activeBatchPanel = document.getElementById("operator-active-batch");
const endBatchButton = document.getElementById("operator-end-batch");
const refreshState = document.getElementById("operator-refresh-state");

let refreshTimer = null;
let currentSummary = null;

const numberFormatter = new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
});

function formatNumber(value, suffix = "") {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return "-";
    }

    return `${numberFormatter.format(numeric)}${suffix}`;
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatDateTime(value) {
    if (!value) {
        return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleString("pl-PL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

function formatPcbCount(value) {
    return value === null || value === undefined
        ? "-"
        : formatNumber(value, " szt.");
}

function formatPanelCount(value) {
    return value === null || value === undefined
        ? "-"
        : formatNumber(value, " paneli");
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || "Operacja MES nie powiodla sie.");
    }

    return data;
}

function setMessage(text, type = "info") {
    messageBox.textContent = text;
    messageBox.className = `note mes-message-${type}`;
}

function getPcsPerPanelStatus(batch) {
    if (!batch?.pcsPerPanel) {
        return "Brak ustawienia";
    }

    switch (batch.pcsPerPanelSource) {
        case "product_setting":
            return "Wczytano z produktu";
        case "operator_panel":
            return "Ustawione w panelu operatora";
        case "operator":
            return "Ustawione przez operatora";
        default:
            return "Zapisane w partii";
    }
}

function attachPcsPerPanelForm(batch) {
    const form = document.getElementById("operator-pcs-form");
    const input = document.getElementById("operator-pcs-per-panel");

    if (!form || !input || !batch) {
        return;
    }

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        void savePcsPerPanel(batch.id, input.value).catch((error) => {
            setMessage(error.message || "Nie udalo sie zapisac PCB na panel.", "error");
        });
    });
}

function renderActiveBatch(summary) {
    currentSummary = summary || null;
    const batch = summary?.activeBatch || null;
    const status = summary?.status || "-";

    if (!batch) {
        activeBatchPanel.innerHTML = `
            <div class="mes-empty-state">
                <span>Status pieca: ${escapeHtml(status)}</span>
                <strong>Brak aktywnej partii</strong>
                <small>Impulsy dalej zapisujemy jako surowe dane, ale bez przypisania do KKW.</small>
            </div>
        `;
        endBatchButton.disabled = true;
        return;
    }

    const plannedQuantityLabel = batch.plannedQuantity
        ? formatNumber(batch.plannedQuantity, " szt.")
        : "-";
    const progressLabel = batch.progressPercent === null || batch.progressPercent === undefined
        ? "-"
        : formatNumber(batch.progressPercent, "%");
    const productTitle = [batch.productCode, batch.productName].filter(Boolean).join(" - ");
    const orderLabel = batch.orderNumber ? `Zlecenie: ${batch.orderNumber}` : "";
    const pcsPerPanelLabel = batch.pcsPerPanel ? formatNumber(batch.pcsPerPanel, " PCB") : "Brak";
    const pcsStatus = getPcsPerPanelStatus(batch);
    const saveHint = batch.productCode
        ? `Wartosc zapisze sie dla tej partii i produktu ${escapeHtml(batch.productCode)}.`
        : "Brak kodu produktu. Zapiszemy wartosc tylko dla tej partii.";
    const productMeta = [batch.productCode, batch.productName].filter(Boolean).join(" | ");

    endBatchButton.disabled = false;
    activeBatchPanel.innerHTML = `
        <article class="mes-batch-card">
            <div class="mes-batch-header">
                <div>
                    <span class="eyebrow">Aktywna partia</span>
                    <h2>${escapeHtml(batch.kkwNumber)}</h2>
                    <div class="mes-batch-product">
                        ${productTitle ? `<strong>${escapeHtml(productTitle)}</strong>` : ""}
                        ${orderLabel ? `<span>${escapeHtml(orderLabel)}</span>` : ""}
                        <span>Start: ${escapeHtml(formatDateTime(batch.startedAt))}</span>
                    </div>
                </div>
                <span class="phase-badge good">${escapeHtml(status)}</span>
            </div>
            <div class="mes-operator-meta-strip">
                <span class="mes-operator-chip">${escapeHtml(productMeta || "Brak danych produktu")}</span>
                <span class="mes-operator-chip">${escapeHtml(`Plan: ${plannedQuantityLabel}`)}</span>
                <span class="mes-operator-chip">${escapeHtml(`PCB/panel: ${pcsPerPanelLabel}`)}</span>
            </div>
            <div class="mes-operator-hero-stats">
                <div class="mes-operator-hero-card">
                    <span>Wykonano PCB</span>
                    <strong>${formatPcbCount(batch.pcbCount)}</strong>
                </div>
                <div class="mes-operator-hero-card secondary">
                    <span>Wykonano paneli</span>
                    <strong>${formatPanelCount(batch.panelCount ?? batch.pulseCount)}</strong>
                </div>
            </div>
            <div class="mes-batch-grid">
                <div>
                    <span>PCB / plan</span>
                    <strong>${formatPcbCount(batch.pcbCount)} / ${escapeHtml(plannedQuantityLabel)}</strong>
                </div>
                <div>
                    <span>Realizacja</span>
                    <strong>${escapeHtml(progressLabel)}</strong>
                </div>
                <div>
                    <span>PCB na panel</span>
                    <strong>${escapeHtml(pcsPerPanelLabel)}</strong>
                    <small>${escapeHtml(pcsStatus)}</small>
                </div>
                <div>
                    <span>Pozostalo</span>
                    <strong>${batch.remainingQuantity === null || batch.remainingQuantity === undefined ? "-" : formatNumber(batch.remainingQuantity, " szt.")}</strong>
                </div>
                <div>
                    <span>Ta partia PCB</span>
                    <strong>${formatPcbCount(batch.batchPcbCount)}</strong>
                </div>
                <div>
                    <span>Ta partia panele</span>
                    <strong>${formatPanelCount(batch.batchPanelCount ?? batch.batchPulseCount)}</strong>
                </div>
                <div>
                    <span>Ostatni impuls</span>
                    <strong>${escapeHtml(formatDateTime(summary?.lastPulse?.ts))}</strong>
                </div>
            </div>
            <form id="operator-pcs-form" class="mes-pcs-form">
                <label>
                    <span>Ustaw PCB na 1 panel</span>
                    <input
                        id="operator-pcs-per-panel"
                        name="pcsPerPanel"
                        type="number"
                        min="1"
                        step="1"
                        inputmode="numeric"
                        placeholder="np. 4"
                        value="${batch.pcsPerPanel ? escapeHtml(batch.pcsPerPanel) : ""}"
                    >
                </label>
                <button type="submit">Zapisz</button>
            </form>
            <p class="note mes-inline-note">${saveHint}</p>
        </article>
    `;

    attachPcsPerPanelForm(batch);
}

async function loadOperatorState() {
    const data = await fetchJson(`/api/mes/oven/summary?device_id=${encodeURIComponent(operatorDeviceId)}`);
    renderActiveBatch(data.summary);
    refreshState.textContent = `Aktualizacja: ${formatDateTime(data.summary?.now)}`;

    if (data.plannedQuantityLookup?.warning) {
        setMessage(data.plannedQuantityLookup.warning, "warning");
    }
}

async function startBatch(scanValue) {
    const scan = String(scanValue || "").trim();
    if (!scan) {
        setMessage("Zeskanuj albo wpisz numer KKW.", "warning");
        return;
    }

    const data = await fetchJson("/api/mes/oven/batch/start", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            device_id: operatorDeviceId,
            scan,
            source: "scan",
        }),
    });

    const lookupWarning = data.plannedQuantityLookup?.warning || "";
    const plannedQuantityLabel = data.batch?.plannedQuantity
        ? ` Plan z Vendo: ${formatNumber(data.batch.plannedQuantity, " szt.")}.`
        : "";
    const pcsPerPanelLabel = data.batch?.pcsPerPanel
        ? ` PCB na panel: ${formatNumber(data.batch.pcsPerPanel)}.`
        : " Ustaw PCB na panel, aby liczyc pojedyncze sztuki.";

    if (data.closedBatch) {
        setMessage(`Zamknieto poprzednia partie ${data.closedBatch.kkwNumber} i rozpoczeto ${data.batch.kkwNumber}.${plannedQuantityLabel}${pcsPerPanelLabel}${lookupWarning ? ` ${lookupWarning}` : ""}`, lookupWarning ? "warning" : "success");
    } else {
        setMessage(`Rozpoczeto partie ${data.batch.kkwNumber}.${plannedQuantityLabel}${pcsPerPanelLabel}${lookupWarning ? ` ${lookupWarning}` : ""}`, lookupWarning ? "warning" : "success");
    }

    scanInput.value = "";
    scanInput.focus();
    await loadOperatorState();
}

async function savePcsPerPanel(batchId, value) {
    const normalizedValue = String(value || "").trim().replace(",", ".");
    const pcsPerPanel = Number(normalizedValue);

    if (!Number.isInteger(pcsPerPanel) || pcsPerPanel <= 0) {
        setMessage("PCB na panel musi byc dodatnia liczba calkowita.", "warning");
        return;
    }

    const data = await fetchJson("/api/mes/oven/batch/pcs-per-panel", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            batch_id: batchId,
            device_id: operatorDeviceId,
            pcs_per_panel: pcsPerPanel,
            save_for_product: true,
            source: "operator_panel",
        }),
    });

    const batch = data.batch || currentSummary?.activeBatch || null;
    const saveScope = data.savedForProduct && batch?.productCode
        ? `dla partii i produktu ${batch.productCode}`
        : "dla tej partii";
    const warningSuffix = data.warning ? ` ${data.warning}` : "";

    setMessage(`Zapisano ${pcsPerPanel} PCB na panel ${saveScope}.${warningSuffix}`, data.warning ? "warning" : "success");
    await loadOperatorState();
    scanInput?.focus();
}

async function endBatch() {
    const data = await fetchJson("/api/mes/oven/batch/end", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            device_id: operatorDeviceId,
        }),
    });

    if (data.closed) {
        setMessage(`Zakonczono partie ${data.batch.kkwNumber}.`, "success");
    } else {
        setMessage("Brak aktywnej partii do zakonczenia.", "warning");
    }

    scanInput.focus();
    await loadOperatorState();
}

if (scanForm) {
    scanForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void startBatch(scanInput.value).catch((error) => {
            setMessage(error.message || "Nie udalo sie rozpoczac partii.", "error");
        });
    });
}

if (endBatchButton) {
    endBatchButton.addEventListener("click", () => {
        void endBatch().catch((error) => {
            setMessage(error.message || "Nie udalo sie zakonczyc partii.", "error");
        });
    });
}

window.addEventListener("focus", () => {
    scanInput?.focus();
});

document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return;
    }

    if (target.closest("#operator-pcs-form")) {
        return;
    }

    if (target.closest("button, a, input, textarea, select, label")) {
        if (target.id !== "operator-scan-input") {
            setTimeout(() => {
                if (document.activeElement?.id !== "operator-pcs-per-panel") {
                    scanInput?.focus();
                }
            }, 0);
        }
        return;
    }

    if (document.activeElement?.id !== "operator-pcs-per-panel") {
        scanInput?.focus();
    }
});

refreshTimer = setInterval(() => {
    if (document.activeElement?.id === "operator-pcs-per-panel") {
        return;
    }

    void loadOperatorState().catch((error) => {
        setMessage(error.message || "Blad odswiezania.", "error");
    });
}, 3000);

void loadOperatorState().catch((error) => {
    setMessage(error.message || "Blad pobierania danych.", "error");
});

scanInput?.focus();
