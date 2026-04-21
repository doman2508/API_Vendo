const mesForm = document.getElementById("mes-form");
const mesSummary = document.getElementById("mes-summary");
const mesBatchesBody = document.getElementById("mes-batches-body");
const mesEventsBody = document.getElementById("mes-events-body");
const mesStatus = document.getElementById("mes-status");
const mesUpdatedAt = document.getElementById("mes-updated-at");
const mesSelectedBatch = document.getElementById("mes-selected-batch");
const mesAutoRefreshInput = document.getElementById("mes-auto-refresh");
const mesAdminPreview = document.getElementById("mes-admin-preview");
const mesAdminForm = document.getElementById("mes-admin-form");
const mesAdminStatus = document.getElementById("mes-admin-status");
const mesJumpActiveButton = document.getElementById("mes-jump-active");
const mesDeleteBatchButton = document.getElementById("mes-delete-batch");
const mesDeleteBatchWithPulsesButton = document.getElementById("mes-delete-batch-with-pulses");
const mesAssignPulsesButton = document.getElementById("mes-assign-pulses");
const mesDeletePulsesButton = document.getElementById("mes-delete-pulses");
const mesSelectedPulses = document.getElementById("mes-selected-pulses");
const mesShowUnassignedInput = document.getElementById("mes-show-unassigned");

let mesRefreshTimer = null;
let selectedBatchId = null;
let latestSummary = null;
let selectedPulseIds = new Set();

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

function formatDurationSeconds(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return "-";
    }

    const rounded = Math.max(0, Math.round(numeric));
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const seconds = rounded % 60;

    if (hours > 0) {
        return `${hours} h ${minutes} min`;
    }

    if (minutes > 0) {
        return `${minutes} min ${seconds} s`;
    }

    return `${seconds} s`;
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
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

function shouldShowUnassignedEvents() {
    return Boolean(mesShowUnassignedInput?.checked);
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

    if (batch.pcsPerPanelSource === "operator_panel" || batch.pcsPerPanelSource === "admin_panel") {
        return `${baseLabel} | panel`;
    }

    return baseLabel;
}

function setAdminFormDisabled(disabled) {
    if (!mesAdminForm) {
        return;
    }

    mesAdminForm.querySelectorAll("input, button").forEach((element) => {
        if (element.type === "hidden") {
            return;
        }

        element.disabled = disabled;
    });
}

function updateSelectedPulsesBadge() {
    if (!mesSelectedPulses) {
        return;
    }

    const count = selectedPulseIds.size;
    mesSelectedPulses.textContent = `${count} zaznaczonych`;
    const hasSelectedBatch = Boolean(mesAdminForm?.batchId?.value || selectedBatchId);
    const canAssign = count > 0 && shouldShowUnassignedEvents() && hasSelectedBatch;

    if (mesDeletePulsesButton) {
        mesDeletePulsesButton.disabled = count === 0;
    }

    if (mesAssignPulsesButton) {
        mesAssignPulsesButton.disabled = !canAssign;
    }
}

function setAdminStatus(message, type = "info") {
    if (!mesAdminStatus) {
        return;
    }

    mesAdminStatus.textContent = message;
    mesAdminStatus.className = `note mes-admin-status mes-admin-status-${type}`;
}

function scrollToAdminPanel() {
    const target = mesAdminPreview?.closest(".mes-admin-panel");
    if (!target) {
        return;
    }

    target.scrollIntoView({
        behavior: "smooth",
        block: "start",
    });
}

function populateAdminForm(batch) {
    if (!mesAdminForm) {
        return;
    }

    mesAdminForm.batchId.value = batch?.id || "";
    mesAdminForm.kkwNumber.value = batch?.kkwNumber || "";
    mesAdminForm.plannedQuantity.value = batch?.plannedQuantity ?? "";
    mesAdminForm.orderNumber.value = batch?.orderNumber || "";
    mesAdminForm.productCode.value = batch?.productCode || "";
    mesAdminForm.productName.value = batch?.productName || "";
    mesAdminForm.pcsPerPanel.value = batch?.pcsPerPanel ?? "";
    mesAdminForm.saveForProduct.checked = true;
}

function renderAdminPreview(batch, summary) {
    if (!mesAdminPreview) {
        return;
    }

    if (!batch) {
        mesAdminPreview.innerHTML = `
            <div class="mes-admin-placeholder">
                <strong>Wybierz partie z tabeli</strong>
                <span>Tutaj pojawi sie podglad administracyjny i formularz korekty danych partii MES.</span>
            </div>
        `;
        setAdminFormDisabled(true);
        populateAdminForm(null);
        setAdminStatus("Wybierz partie, aby edytowac jej dane.", "info");
        if (mesDeleteBatchButton) {
            mesDeleteBatchButton.disabled = true;
        }
        if (mesDeleteBatchWithPulsesButton) {
            mesDeleteBatchWithPulsesButton.disabled = true;
        }
        return;
    }

    const statusClass = batch.status === "active" ? "good" : "neutral";
      const infoItems = [
          ["Device", batch.deviceId || "-"],
          ["Status", batch.status === "active" ? "Aktywna" : "Zamknieta"],
          ["Start", formatDateTime(batch.startedAt)],
          ["Koniec", formatDateTime(batch.endedAt)],
          ["Zrodlo", batch.source || "-"],
          ["Rozpoczal", batch.startedBy || "-"],
          ["Zakonczyl", batch.endedBy || "-"],
          ["Ostatnie wejscie", formatDateTime(summary?.lastEntryPulse?.ts)],
          ["Ostatnie wyjscie", formatDateTime(summary?.lastExitPulse?.ts)],
      ];
      const statItems = [
          ["PCB KKW", formatPcbCount(batch.pcbCount)],
          ["Wejscia KKW", formatPanelCount(batch.inputCount)],
          ["Wyjscia KKW", formatPanelCount(batch.outputCount ?? batch.panelCount ?? batch.pulseCount)],
          ["W piecu KKW", formatPanelCount(batch.inOvenCount)],
          ["PCB partii", formatPcbCount(batch.batchPcbCount)],
          ["Wejscia partii", formatPanelCount(batch.batchInputCount)],
          ["Wyjscia partii", formatPanelCount(batch.batchOutputCount ?? batch.batchPanelCount ?? batch.batchPulseCount)],
          ["W piecu partii", formatPanelCount(batch.batchInOvenCount)],
          ["Sr. czas pieca", formatDurationSeconds(batch.batchAverageOvenTimeSeconds ?? batch.averageOvenTimeSeconds)],
          ["Plan", batch.plannedQuantity ? formatNumber(batch.plannedQuantity, " szt.") : "-"],
          ["Realizacja", batch.progressPercent === null || batch.progressPercent === undefined ? "-" : formatNumber(batch.progressPercent, "%")],
          ["PCB/panel", getPcsPerPanelLabel(batch)],
          ["Pozostalo", batch.remainingQuantity === null || batch.remainingQuantity === undefined ? "-" : formatNumber(batch.remainingQuantity, " szt.")],
      ];

    mesAdminPreview.innerHTML = `
        <article class="mes-admin-card">
            <div class="mes-admin-card-header">
                <div>
                    <p class="eyebrow">Partia #${escapeHtml(batch.id)}</p>
                    <h3>${escapeHtml(batch.kkwNumber || "Brak KKW")}</h3>
                    <p class="mes-admin-card-copy">${escapeHtml(getBatchTitle(batch))}</p>
                </div>
                <span class="phase-badge ${statusClass}">${batch.status === "active" ? "Aktywna" : "Zamknieta"}</span>
            </div>
            <div class="mes-admin-stat-grid">
                ${statItems.map(([label, value]) => `
                    <div class="mes-admin-stat-card">
                        <span>${escapeHtml(label)}</span>
                        <strong>${escapeHtml(value)}</strong>
                    </div>
                `).join("")}
            </div>
            <div class="mes-admin-info-grid">
                ${infoItems.map(([label, value]) => `
                    <div class="mes-admin-info-row">
                        <span>${escapeHtml(label)}</span>
                        <strong>${escapeHtml(value)}</strong>
                    </div>
                `).join("")}
            </div>
        </article>
    `;

    setAdminFormDisabled(false);
    if (mesDeleteBatchButton) {
        mesDeleteBatchButton.disabled = false;
    }
    if (mesDeleteBatchWithPulsesButton) {
        mesDeleteBatchWithPulsesButton.disabled = false;
    }
    populateAdminForm(batch);
    setAdminStatus(
        batch.pcsPerPanelMissing
            ? "Wybrana partia nie ma ustawionego PCB na panel. Mozesz to poprawic ponizej."
            : `Edytujesz partie ${batch.kkwNumber}.`,
        batch.pcsPerPanelMissing ? "warning" : "info"
    );
}

function renderSummary(payload) {
    const summary = payload?.summary || {};
    latestSummary = summary;
    const activeBatch = summary.activeBatch || null;
      const activeTitle = activeBatch ? `${activeBatch.kkwNumber} | ${getBatchTitle(activeBatch)}` : "Brak aktywnej partii";
      const cards = [
          ["Aktywne KKW", activeTitle],
          ["Wyszlo PCB / plan", activeBatch ? `${formatPcbCount(activeBatch.pcbCount)} / ${activeBatch.plannedQuantity ? formatNumber(activeBatch.plannedQuantity, " szt.") : "-"}` : "-"],
          ["Wejscia KKW", activeBatch ? formatPanelCount(activeBatch.inputCount) : "-"],
          ["Wyjscia KKW", activeBatch ? formatPanelCount(activeBatch.outputCount ?? activeBatch.panelCount ?? activeBatch.pulseCount) : "-"],
          ["W piecu teraz", activeBatch ? formatPanelCount(activeBatch.inOvenCount) : formatPanelCount(summary.inOvenCount)],
          ["PCB na panel", activeBatch ? getPcsPerPanelLabel(activeBatch) : "-"],
          ["Ta partia PCB", activeBatch ? formatPcbCount(activeBatch.batchPcbCount) : "-"],
          ["Ta partia wejscia", activeBatch ? formatPanelCount(activeBatch.batchInputCount) : "-"],
          ["Ta partia wyjscia", activeBatch ? formatPanelCount(activeBatch.batchOutputCount ?? activeBatch.batchPanelCount ?? activeBatch.batchPulseCount) : "-"],
          ["Sr. czas pieca", formatDurationSeconds(activeBatch?.averageOvenTimeSeconds ?? summary.averageOvenTimeSeconds)],
          ["Realizacja", activeBatch?.progressPercent === null || activeBatch?.progressPercent === undefined ? "-" : formatNumber(activeBatch.progressPercent, "%")],
          ["Status pieca", summary.status || "-"],
          ["Ostatnie wejscie", formatDateTime(summary.lastEntryPulse?.ts)],
          ["Ostatnie wyjscie", formatDateTime(summary.lastExitPulse?.ts)],
          ["Takt wyjscia", formatDurationSeconds(summary.averageExitTaktSeconds)],
          ["Dzisiaj wyjscia", formatPanelCount(summary.counts?.today || 0)],
      ];

    mesSummary.innerHTML = cards.map(([label, value]) => `
        <article class="summary-card">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
        </article>
    `).join("");
    mesSummary.classList.remove("hidden");

    if (mesJumpActiveButton) {
        mesJumpActiveButton.disabled = !activeBatch;
    }
}

function renderBatches(payload) {
    const batches = Array.isArray(payload?.batches) ? payload.batches : [];
    if (!batches.length) {
        mesBatchesBody.innerHTML = `<tr><td colspan="9">Brak partii dla wybranego filtra.</td></tr>`;
        selectedBatchId = null;
        mesSelectedBatch.textContent = "Wybierz partie";
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
                <td>
                    <button class="ghost mes-inline-danger" type="button" data-delete-batch-id="${batch.id}" data-delete-batch-kkw="${escapeHtml(batch.kkwNumber || "")}">
                        Usun
                    </button>
                </td>
            </tr>
        `;
    }).join("");

    mesBatchesBody.querySelectorAll("[data-batch-id]").forEach((row) => {
        row.addEventListener("click", () => {
            selectedBatchId = Number(row.dataset.batchId);
            void loadMesData({ keepSelectedBatch: true }).catch((error) => {
                mesStatus.textContent = error.message || "Blad pobierania MES.";
            });
            scrollToAdminPanel();
        });
    });

    mesBatchesBody.querySelectorAll("[data-delete-batch-id]").forEach((button) => {
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            const batchId = Number(button.dataset.deleteBatchId);
            const kkwNumber = String(button.dataset.deleteBatchKkw || "").trim();
            void deleteBatchById(batchId, kkwNumber).catch((error) => {
                setAdminStatus(error.message || "Nie udalo sie usunac partii MES.", "error");
            });
        });
    });

    return selected;
}

function renderEvents(payload) {
    const events = Array.isArray(payload?.events) ? payload.events : [];
    if (!events.length) {
        mesEventsBody.innerHTML = `<tr><td colspan="7">${shouldShowUnassignedEvents() ? "Brak nieprzypisanych impulsow dla wybranego device." : "Brak impulsow dla wybranej partii."}</td></tr>`;
        selectedPulseIds = new Set();
        updateSelectedPulsesBadge();
        return;
    }

    const availableIds = new Set(events.map((event) => Number(event.id)).filter((id) => Number.isInteger(id) && id > 0));
    selectedPulseIds = new Set([...selectedPulseIds].filter((id) => availableIds.has(id)));

    mesEventsBody.innerHTML = events.map((event) => `
        <tr>
            <td>
                <input
                    type="checkbox"
                    class="mes-event-checkbox"
                    data-pulse-id="${event.id}"
                    ${selectedPulseIds.has(Number(event.id)) ? "checked" : ""}
                >
            </td>
            <td>${event.id}</td>
            <td>${escapeHtml(event.deviceId || "-")}</td>
            <td>${escapeHtml(event.sensorId || "-")}</td>
            <td>${event.batchId || "-"}</td>
            <td>${formatDateTime(event.ts)}</td>
            <td><code>${escapeHtml(event.payloadJson || "-")}</code></td>
        </tr>
    `).join("");

    mesEventsBody.querySelectorAll(".mes-event-checkbox").forEach((checkbox) => {
        checkbox.addEventListener("change", () => {
            const pulseId = Number(checkbox.dataset.pulseId);
            if (!Number.isInteger(pulseId) || pulseId <= 0) {
                return;
            }

            if (checkbox.checked) {
                selectedPulseIds.add(pulseId);
            } else {
                selectedPulseIds.delete(pulseId);
            }

            updateSelectedPulsesBadge();
        });
    });

    updateSelectedPulsesBadge();
}

function isAdminFormActive() {
    const activeElement = document.activeElement;
    return Boolean(activeElement && mesAdminForm?.contains(activeElement));
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
    renderAdminPreview(selected, summary.summary || summary);
    const events = shouldShowUnassignedEvents()
        ? await fetchJson(`/api/mes/oven/events?device_id=${deviceId}&unassigned=1&limit=100`)
        : selected
            ? await fetchJson(`/api/mes/oven/events?batch_id=${encodeURIComponent(selected.id)}&limit=100`)
            : { events: [] };
    renderEvents(events);

    const now = new Date();
    mesUpdatedAt.textContent = `Aktualizacja: ${formatDateTime(now.toISOString())}`;
    if (shouldShowUnassignedEvents()) {
        mesStatus.textContent = `Pokazuje nieprzypisane impulsy dla device ${decodeURIComponent(deviceId)}.`;
    } else {
        mesStatus.textContent = selected
            ? selected.pcsPerPanelMissing
                ? `Pokazuje partie KKW ${selected.kkwNumber}. Brakuje ustawienia PCB na panel.`
                : `Pokazuje partie KKW ${selected.kkwNumber}.`
            : "Brak partii dla wybranego filtra.";
    }
}

async function saveBatchChanges() {
    if (!mesAdminForm?.batchId?.value) {
        throw new Error("Najpierw wybierz partie do edycji.");
    }

    const body = {
        batch_id: Number(mesAdminForm.batchId.value),
        kkw_number: mesAdminForm.kkwNumber.value.trim(),
        planned_quantity: mesAdminForm.plannedQuantity.value.trim(),
        order_number: mesAdminForm.orderNumber.value.trim(),
        product_code: mesAdminForm.productCode.value.trim(),
        product_name: mesAdminForm.productName.value.trim(),
        pcs_per_panel: mesAdminForm.pcsPerPanel.value.trim(),
        save_for_product: mesAdminForm.saveForProduct.checked,
        source: "admin_panel",
    };

    const response = await fetchJson("/api/mes/oven/batch/update", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    selectedBatchId = Number(response?.batch?.id || body.batch_id);
    setAdminStatus(
        response.warning
            ? `Zapisano zmiany partii. ${response.warning}`
            : "Zapisano zmiany partii MES.",
        response.warning ? "warning" : "success"
    );
    await loadMesData({ keepSelectedBatch: true });
}

async function deleteSelectedBatch() {
    if (!mesAdminForm?.batchId?.value) {
        throw new Error("Najpierw wybierz partie do usuniecia.");
    }

    const batchId = Number(mesAdminForm.batchId.value);
    const kkwNumber = mesAdminForm.kkwNumber.value.trim() || `#${batchId}`;
    await deleteBatchById(batchId, kkwNumber, { deletePulses: false });
}

async function deleteBatchById(batchId, kkwNumber = "", { deletePulses = false } = {}) {
    if (!Number.isInteger(batchId) || batchId <= 0) {
        throw new Error("Brakuje ID partii do usuniecia.");
    }

    const label = kkwNumber || `#${batchId}`;
    const confirmed = window.confirm(
        deletePulses
            ? `Usunac cale KKW ${label} razem z impulsami wszystkich jego partii? Operacja jest nieodwracalna.`
            : `Usunac cale KKW ${label}? Impulsy zostana odlaczone od wszystkich partii tego KKW, ale nie beda skasowane.`
    );
    if (!confirmed) {
        return;
    }

    const response = await fetchJson("/api/mes/oven/batch/delete", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            batch_id: batchId,
            delete_pulses: deletePulses,
        }),
    });

    selectedBatchId = null;

    selectedPulseIds = new Set();
    updateSelectedPulsesBadge();
    const deletedBatchCount = Number(response.deletedBatchCount || 0);
    const deletedBatchLabel = deletedBatchCount === 1 ? "1 rekord" : `${formatNumber(deletedBatchCount)} rekordow`;
    setAdminStatus(
        deletePulses
            ? `Usunieto KKW ${label}: ${deletedBatchLabel} oraz ${formatNumber(response.deletedPulses || 0)} impulsow.`
            : `Usunieto KKW ${label}: ${deletedBatchLabel}. Odlaczono ${formatNumber(response.detachedPulses || 0)} impulsow.`,
        "warning"
    );
    await loadMesData({ keepSelectedBatch: false });
}

async function deleteSelectedBatchAndPulses() {
    if (!mesAdminForm?.batchId?.value) {
        throw new Error("Najpierw wybierz partie do usuniecia.");
    }

    const batchId = Number(mesAdminForm.batchId.value);
    const kkwNumber = mesAdminForm.kkwNumber.value.trim() || `#${batchId}`;
    await deleteBatchById(batchId, kkwNumber, { deletePulses: true });
}

async function deleteSelectedPulses() {
    const pulseIds = [...selectedPulseIds];
    if (!pulseIds.length) {
        throw new Error("Zaznacz impulsy do usuniecia.");
    }

    const confirmed = window.confirm(`Usunac ${pulseIds.length} zaznaczonych impulsow? Operacja jest nieodwracalna.`);
    if (!confirmed) {
        return;
    }

    const response = await fetchJson("/api/mes/oven/events/delete", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            pulse_ids: pulseIds,
        }),
    });

    selectedPulseIds = new Set();
    updateSelectedPulsesBadge();
    setAdminStatus(`Usunieto ${formatNumber(response.deleted || 0)} impulsow MES.`, "warning");
    await loadMesData({ keepSelectedBatch: true });
}

async function assignSelectedPulsesToBatch() {
    const pulseIds = [...selectedPulseIds];
    if (!pulseIds.length) {
        throw new Error("Zaznacz impulsy do przypisania.");
    }

    if (!shouldShowUnassignedEvents()) {
        throw new Error("Przypisywanie dziala w widoku nieprzypisanych impulsow.");
    }

    const batchId = Number(mesAdminForm?.batchId?.value || selectedBatchId);
    if (!Number.isInteger(batchId) || batchId <= 0) {
        throw new Error("Najpierw wybierz partie, do ktorej przypisac impulsy.");
    }

    const batchLabel = mesAdminForm?.kkwNumber?.value?.trim() || `#${batchId}`;
    const confirmed = window.confirm(`Przypisac ${pulseIds.length} zaznaczonych impulsow do KKW ${batchLabel}?`);
    if (!confirmed) {
        return;
    }

    const response = await fetchJson("/api/mes/oven/events/assign", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            batch_id: batchId,
            pulse_ids: pulseIds,
        }),
    });

    selectedPulseIds = new Set();
    updateSelectedPulsesBadge();
    const skippedSuffix = response.skippedCount
        ? ` Pomieto ${formatNumber(response.skippedCount)} impulsow, ktorych nie dalo sie przypisac.`
        : "";
    setAdminStatus(
        `Przypisano ${formatNumber(response.assigned || 0)} impulsow do KKW ${batchLabel}.${skippedSuffix}`,
        response.skippedCount ? "warning" : "success"
    );
    await loadMesData({ keepSelectedBatch: true });
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
        if (isAdminFormActive()) {
            return;
        }

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

if (mesAdminForm) {
    mesAdminForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void saveBatchChanges().catch((error) => {
            setAdminStatus(error.message || "Nie udalo sie zapisac zmian partii.", "error");
        });
    });
}

if (mesDeleteBatchButton) {
    mesDeleteBatchButton.addEventListener("click", () => {
        void deleteSelectedBatch().catch((error) => {
            setAdminStatus(error.message || "Nie udalo sie usunac partii MES.", "error");
        });
    });
}

if (mesDeleteBatchWithPulsesButton) {
    mesDeleteBatchWithPulsesButton.addEventListener("click", () => {
        void deleteSelectedBatchAndPulses().catch((error) => {
            setAdminStatus(error.message || "Nie udalo sie usunac partii i impulsow MES.", "error");
        });
    });
}

if (mesDeletePulsesButton) {
    mesDeletePulsesButton.addEventListener("click", () => {
        void deleteSelectedPulses().catch((error) => {
            setAdminStatus(error.message || "Nie udalo sie usunac impulsow MES.", "error");
        });
    });
}

if (mesAssignPulsesButton) {
    mesAssignPulsesButton.addEventListener("click", () => {
        void assignSelectedPulsesToBatch().catch((error) => {
            setAdminStatus(error.message || "Nie udalo sie przypisac impulsow MES.", "error");
        });
    });
}

if (mesShowUnassignedInput) {
    mesShowUnassignedInput.addEventListener("change", () => {
        selectedPulseIds = new Set();
        updateSelectedPulsesBadge();
        void loadMesData({ keepSelectedBatch: true }).catch((error) => {
            mesStatus.textContent = error.message || "Blad pobierania MES.";
        });
    });
}

if (mesJumpActiveButton) {
    mesJumpActiveButton.addEventListener("click", () => {
        const activeBatchId = Number(latestSummary?.activeBatch?.id);
        if (!Number.isInteger(activeBatchId) || activeBatchId <= 0) {
            return;
        }

        selectedBatchId = activeBatchId;
        void loadMesData({ keepSelectedBatch: true }).catch((error) => {
            mesStatus.textContent = error.message || "Blad pobierania MES.";
        });
    });
}

if (mesAutoRefreshInput) {
    mesAutoRefreshInput.addEventListener("change", restartMesRefreshTimer);
}

setAdminFormDisabled(true);
updateSelectedPulsesBadge();
void loadMesData().catch((error) => {
    mesStatus.textContent = error.message || "Blad pobierania MES.";
});
restartMesRefreshTimer();
