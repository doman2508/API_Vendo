const operatorDeviceId = "reflow_1";
const scanForm = document.getElementById("operator-scan-form");
const scanInput = document.getElementById("operator-scan-input");
const messageBox = document.getElementById("operator-message");
const activeBatchPanel = document.getElementById("operator-active-batch");
const endBatchButton = document.getElementById("operator-end-batch");
const refreshState = document.getElementById("operator-refresh-state");

let refreshTimer = null;

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

function formatDuration(seconds) {
    const numeric = Number(seconds);
    if (!Number.isFinite(numeric)) {
        return "-";
    }

    const hours = Math.floor(numeric / 3600);
    const minutes = Math.floor((numeric % 3600) / 60);
    const restSeconds = Math.floor(numeric % 60);

    if (hours > 0) {
        return `${hours}h ${String(minutes).padStart(2, "0")}m`;
    }

    return `${minutes}m ${String(restSeconds).padStart(2, "0")}s`;
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

function renderActiveBatch(summary) {
    const batch = summary?.activeBatch || null;
    const status = summary?.status || "-";

    if (!batch) {
        activeBatchPanel.innerHTML = `
            <div class="mes-empty-state">
                <span>Status pieca: ${status}</span>
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
                    </div>
                </div>
                <span class="phase-badge good">${status}</span>
            </div>
            <div class="mes-batch-grid">
                <div>
                    <span>Wykonano KKW / planowano</span>
                    <strong>${formatNumber(batch.pulseCount, " szt.")} / ${plannedQuantityLabel}</strong>
                </div>
                <div>
                    <span>Realizacja</span>
                    <strong>${progressLabel}</strong>
                </div>
                <div>
                    <span>Ta partia</span>
                    <strong>${formatNumber(batch.batchPulseCount ?? batch.pulseCount, " szt.")}</strong>
                </div>
                <div>
                    <span>Pozostalo</span>
                    <strong>${batch.remainingQuantity === null || batch.remainingQuantity === undefined ? "-" : formatNumber(batch.remainingQuantity, " szt.")}</strong>
                </div>
            </div>
        </article>
    `;
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

    if (data.closedBatch) {
        setMessage(`Zamknieto poprzednia partie ${data.closedBatch.kkwNumber} i rozpoczeto ${data.batch.kkwNumber}.${plannedQuantityLabel}${lookupWarning ? ` ${lookupWarning}` : ""}`, lookupWarning ? "warning" : "success");
    } else {
        setMessage(`Rozpoczeto partie ${data.batch.kkwNumber}.${plannedQuantityLabel}${lookupWarning ? ` ${lookupWarning}` : ""}`, lookupWarning ? "warning" : "success");
    }

    scanInput.value = "";
    scanInput.focus();
    await loadOperatorState();
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

refreshTimer = setInterval(() => {
    void loadOperatorState().catch((error) => {
        setMessage(error.message || "Blad odswiezania.", "error");
    });
}, 3000);

void loadOperatorState().catch((error) => {
    setMessage(error.message || "Blad pobierania danych.", "error");
});

scanInput?.focus();
