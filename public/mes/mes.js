const mesForm = document.getElementById("mes-form");
const mesSummary = document.getElementById("mes-summary");
const mesBatchesBody = document.getElementById("mes-batches-body");
const mesEventsBody = document.getElementById("mes-events-body");
const mesStatus = document.getElementById("mes-status");
const mesUpdatedAt = document.getElementById("mes-updated-at");
const mesSelectedBatch = document.getElementById("mes-selected-batch");
const mesAutoRefreshInput = document.getElementById("mes-auto-refresh");

let mesRefreshTimer = null;
let selectedBatchId = null;

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

function formatPanelCount(value) {
    return value === null || value === undefined
        ? "-"
        : formatNumber(value, " paneli");
}

function formatPcbCount(value) {
    return value === null || value === undefined
        ? "-"
        : formatNumber(value, " szt.");
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
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

async function fetchJson(url) {
    const response = await fetch(url);
    const rawText = await response.text();
    let data = null;

    if (rawText) {
        try {
            data = JSON.parse(rawText);
        } catch (_error) {
            data = null;
        }
    }

    if (!response.ok) {
        throw new Error(
            data?.error
            || rawText
            || `Nie udalo sie pobrac danych MES (HTTP ${response.status}).`
        );
    }

    if (!data) {
        throw new Error("Serwer MES zwrocil nieprawidlowy format odpowiedzi.");
    }

    return data;
}

function getDeviceId() {
    return String(mesForm?.deviceId?.value || "reflow_1").trim() || "reflow_1";
}

function getKkwNumber() {
    return String(mesForm?.kkwNumber?.value || "").trim();
}

function getBatchTitle(batch) {
    if (!batch) {
        return "-";
    }

    const product = [batch.productCode, batch.productName].filter(Boolean).join(" - ");
    return product || batch.kkwNumber || "-";
}

function getPcsPerPanelLabel(batch) {
    if (!batch?.pcsPerPanel) {
        return "Brak ustawienia";
    }

    const baseLabel = `${formatNumber(batch.pcsPerPanel)} PCB`;
    if (batch.pcsPerPanelSource === "product_setting") {
        return `${baseLabel} | produkt`;
    }

    if (batch.pcsPerPanelSource === "operator_panel") {
        return `${baseLabel} | operator`;
    }

    return baseLabel;
}

function renderSummary(payload) {
    const summary = payload?.summary || {};
    const activeBatch = summary.activeBatch || null;
    const activeTitle = activeBatch ? `${activeBatch.kkwNumber} | ${getBatchTitle(activeBatch)}` : "Brak aktywnej partii";
    const cards = [
        ["Aktywne KKW", activeTitle],
        ["Wykonano PCB / plan", activeBatch ? `${formatPcbCount(activeBatch.pcbCount)} / ${activeBatch.plannedQuantity ? formatNumber(activeBatch.plannedQuantity, " szt.") : "-"}` : "-"],
        ["Wykonano paneli KKW", activeBatch ? formatPanelCount(activeBatch.panelCount ?? activeBatch.pulseCount) : "-"],
        ["PCB na panel", activeBatch ? getPcsPerPanelLabel(activeBatch) : "-"],
        ["Ta partia PCB", activeBatch ? formatPcbCount(activeBatch.batchPcbCount) : "-"],
        ["Ta partia panele", activeBatch ? formatPanelCount(activeBatch.batchPanelCount ?? activeBatch.batchPulseCount) : "-"],
        ["Realizacja", activeBatch?.progressPercent === null || activeBatch?.progressPercent === undefined ? "-" : formatNumber(activeBatch.progressPercent, "%")],
        ["Status pieca", summary.status || "-"],
        ["Ostatni impuls", formatDateTime(summary.lastPulse?.ts)],
        ["Dzisiaj (panele)", formatPanelCount(summary.counts?.today || 0)],
    ];

    mesSummary.innerHTML = cards.map(([label, value]) => `
        <article class="summary-card">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
        </article>
    `).join("");
    mesSummary.classList.remove("hidden");
}

function renderBatches(payload) {
    const batches = Array.isArray(payload?.batches) ? payload.batches : [];
    if (!batches.length) {
        mesBatchesBody.innerHTML = `<tr><td colspan="8">Brak partii dla wybranego filtra.</td></tr>`;
        selectedBatchId = null;
        return null;
    }

    if (!selectedBatchId || !batches.some((batch) => Number(batch.id) === Number(selectedBatchId))) {
        selectedBatchId = batches[0].id;
    }

    const selected = batches.find((batch) => Number(batch.id) === Number(selectedBatchId)) || batches[0];
    selectedBatchId = selected.id;
    mesSelectedBatch.textContent = `Partia #${selected.id}`;

    mesBatchesBody.innerHTML = batches.map((batch) => {
        const isSelected = Number(batch.id) === Number(selectedBatchId);
        const planned = batch.plannedQuantity ? formatNumber(batch.plannedQuantity, " szt.") : "-";
        const status = batch.status === "active" ? "Aktywna" : "Zamknieta";
        const productMeta = [
            batch.productCode ? `Kod: ${batch.productCode}` : "",
            `PCB/panel: ${batch.pcsPerPanel ? formatNumber(batch.pcsPerPanel) : "brak"}`,
        ].filter(Boolean).join(" | ");

        return `
            <tr class="mes-batch-row ${isSelected ? "selected" : ""}" data-batch-id="${batch.id}">
                <td><strong>${escapeHtml(batch.kkwNumber)}</strong><small>#${batch.id}</small></td>
                <td>${escapeHtml(getBatchTitle(batch))}${productMeta ? `<small>${escapeHtml(productMeta)}</small>` : ""}</td>
                <td>${formatDateTime(batch.startedAt)}</td>
                <td>${formatDateTime(batch.endedAt)}</td>
                <td>${formatPanelCount(batch.batchPanelCount ?? batch.batchPulseCount)}</td>
                <td>${formatPcbCount(batch.batchPcbCount)}</td>
                <td>${formatPcbCount(batch.pcbCount)} / ${escapeHtml(planned)}</td>
                <td><span class="phase-badge ${batch.status === "active" ? "good" : "neutral"}">${status}</span></td>
            </tr>
        `;
    }).join("");

    mesBatchesBody.querySelectorAll("[data-batch-id]").forEach((row) => {
        row.addEventListener("click", () => {
            selectedBatchId = Number(row.dataset.batchId);
            void loadMesData({ keepSelectedBatch: true }).catch((error) => {
                mesStatus.textContent = error.message || "Blad pobierania MES.";
            });
        });
    });

    return selected;
}

function renderEvents(payload) {
    const events = Array.isArray(payload?.events) ? payload.events : [];
    if (!events.length) {
        mesEventsBody.innerHTML = `<tr><td colspan="6">Brak impulsow dla wybranej partii.</td></tr>`;
        return;
    }

    mesEventsBody.innerHTML = events.map((event) => `
        <tr>
            <td>${event.id}</td>
            <td>${escapeHtml(event.deviceId || "-")}</td>
            <td>${escapeHtml(event.sensorId || "-")}</td>
            <td>${event.batchId || "-"}</td>
            <td>${formatDateTime(event.ts)}</td>
            <td><code>${escapeHtml(event.payloadJson || "-")}</code></td>
        </tr>
    `).join("");
}

async function loadMesData({ keepSelectedBatch = false } = {}) {
    const deviceId = encodeURIComponent(getDeviceId());
    const kkwNumber = getKkwNumber();
    const kkwQuery = kkwNumber ? `&kkw_number=${encodeURIComponent(kkwNumber)}` : "";
    mesStatus.textContent = "Pobieranie danych...";

    if (!keepSelectedBatch) {
        selectedBatchId = null;
    }

    const [summary, batches] = await Promise.all([
        fetchJson(`/api/mes/oven/summary?device_id=${deviceId}`),
        fetchJson(`/api/mes/oven/batch/history?device_id=${deviceId}${kkwQuery}&limit=50`),
    ]);

    renderSummary(summary);
    const selected = renderBatches(batches);
    const events = selected
        ? await fetchJson(`/api/mes/oven/events?batch_id=${encodeURIComponent(selected.id)}&limit=100`)
        : { events: [] };
    renderEvents(events);

    const now = new Date();
    mesUpdatedAt.textContent = `Aktualizacja: ${formatDateTime(now.toISOString())}`;
    mesStatus.textContent = selected
        ? selected.pcsPerPanelMissing
            ? `Pokazuje partie KKW ${selected.kkwNumber}. Brakuje ustawienia PCB na panel.`
            : `Pokazuje partie KKW ${selected.kkwNumber}.`
        : "Brak partii dla wybranego filtra.";
}

function restartMesRefreshTimer() {
    if (mesRefreshTimer) {
        clearInterval(mesRefreshTimer);
        mesRefreshTimer = null;
    }

    if (!mesAutoRefreshInput?.checked) {
        return;
    }

    mesRefreshTimer = setInterval(() => {
        void loadMesData({ keepSelectedBatch: true }).catch((error) => {
            mesStatus.textContent = error.message || "Blad odswiezania MES.";
        });
    }, 5000);
}

if (mesForm) {
    mesForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void loadMesData().catch((error) => {
            mesStatus.textContent = error.message || "Blad pobierania MES.";
        });
        restartMesRefreshTimer();
    });
}

if (mesAutoRefreshInput) {
    mesAutoRefreshInput.addEventListener("change", restartMesRefreshTimer);
}

void loadMesData().catch((error) => {
    mesStatus.textContent = error.message || "Blad pobierania MES.";
});
restartMesRefreshTimer();
