const mesForm = document.getElementById("mes-form");
const mesSummary = document.getElementById("mes-summary");
const mesBatchesBody = document.getElementById("mes-batches-body");
const mesEntriesBody = document.getElementById("mes-entries-body");
const mesEntriesTitle = document.getElementById("mes-entries-title");
const mesEntriesMeta = document.getElementById("mes-entries-meta");
const mesSelectedKkw = document.getElementById("mes-selected-kkw");
const mesEventsBody = document.getElementById("mes-events-body");
const mesEventsTitle = document.getElementById("mes-events-title");
const mesEventsCount = document.getElementById("mes-events-count");
const mesEventsScopeRawButton = document.getElementById("mes-events-scope-raw");
const mesEventsScopeAttributedButton = document.getElementById("mes-events-scope-attributed");
const mesEventsToggleDiagnosticsButton = document.getElementById("mes-events-toggle-diagnostics");
const mesStatus = document.getElementById("mes-status");
const mesUpdatedAt = document.getElementById("mes-updated-at");
const mesSelectedBatch = document.getElementById("mes-selected-batch");
const mesSelectedEntry = document.getElementById("mes-selected-entry");
const mesResetTransitsButton = document.getElementById("mes-reset-transits");
const mesRefreshButton = document.getElementById("mes-refresh");
const mesEventsRefreshButton = document.getElementById("mes-events-refresh");
const mesToggleFiltersButton = document.getElementById("mes-toggle-filters");
const mesAdvancedFilters = document.getElementById("mes-advanced-filters");
const mesDeviceIdMirror = document.querySelector('input[name="deviceIdMirror"]');
const mesAutoRefreshInput = document.getElementById("mes-auto-refresh");
const mesAdminDrawer = document.getElementById("mes-admin-drawer");
const mesAdminOverlay = document.getElementById("mes-admin-overlay");
const mesAdminPanel = mesAdminDrawer?.querySelector(".mes-admin-drawer-panel") || null;
const mesAdminCloseButton = document.getElementById("mes-admin-close");
const mesAdminTitle = document.getElementById("mes-admin-title");
const mesAdminSubtitle = document.getElementById("mes-admin-subtitle");
const mesAdminPreview = document.getElementById("mes-admin-preview");
const mesAdminForm = document.getElementById("mes-admin-form");
const mesAdminStatus = document.getElementById("mes-admin-status");
const mesJumpActiveButton = document.getElementById("mes-jump-active");
const mesDeleteBatchButton = document.getElementById("mes-delete-batch");
const mesDeleteBatchWithPulsesButton = document.getElementById("mes-delete-batch-with-pulses");
const mesAssignPulsesButton = document.getElementById("mes-assign-pulses");
const mesDeletePulsesButton = document.getElementById("mes-delete-pulses");
const mesSelectedPulses = document.getElementById("mes-selected-pulses");
const mesEventsSelectionFooter = document.getElementById("mes-events-selection-footer");
const mesEventsRange = document.getElementById("mes-events-range");
const mesShowUnassignedInput = document.getElementById("mes-show-unassigned");
const mesOpenInvestigationButton = document.getElementById("mes-open-investigation");
const mesInvestigationDrawer = document.getElementById("mes-investigation-drawer");
const mesInvestigationOverlay = document.getElementById("mes-investigation-overlay");
const mesInvestigationPanel = mesInvestigationDrawer?.querySelector(".mes-investigation-panel") || null;
const mesInvestigationTitle = document.getElementById("mes-investigation-title");
const mesInvestigationSubtitle = document.getElementById("mes-investigation-subtitle");
const mesInvestigationSummary = document.getElementById("mes-investigation-summary");
const mesInvestigationRefreshButton = document.getElementById("mes-investigation-refresh");
const mesInvestigationCloseButton = document.getElementById("mes-investigation-close");
const mesTransitsTitle = document.getElementById("mes-transits-title");
const mesTransitsMeta = document.getElementById("mes-transits-meta");
const mesTransitsBody = document.getElementById("mes-transits-body");

let mesRefreshTimer = null;
let selectedBatchId = null;
let selectedGroupKey = "";
let latestSummaryPayload = null;
let latestBatchRows = [];
let latestGroups = [];
let selectedPulseIds = new Set();
let selectedEventsScope = "attributed";
let diagnosticsMode = false;
let adminEditScope = "kkw";
let drawerOpen = false;
let drawerDismissed = false;
let investigationOpen = false;

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

function formatDistanceCm(value) {
    return value === null || value === undefined
        ? "-"
        : formatNumber(value, " cm");
}

function formatSpeedMetersPerMinute(value) {
    return value === null || value === undefined
        ? "-"
        : formatNumber(value, " m/min");
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

function getSortTimestamp(value) {
    const timestamp = Date.parse(value || "");
    return Number.isFinite(timestamp) ? timestamp : 0;
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

function getSelectedEventsScope() {
    return selectedEventsScope === "raw" ? "raw" : "attributed";
}

function updateEventsScopeControls() {
    const unassigned = shouldShowUnassignedEvents();
    const scope = getSelectedEventsScope();
    const diagnosticsVisible = diagnosticsMode && !unassigned;

    if (!diagnosticsVisible && scope === "raw") {
        selectedEventsScope = "attributed";
    }

    if (mesEventsScopeRawButton) {
        mesEventsScopeRawButton.classList.toggle("hidden", !diagnosticsVisible);
        mesEventsScopeRawButton.classList.toggle("is-active", diagnosticsVisible && scope === "raw");
        mesEventsScopeRawButton.disabled = !diagnosticsVisible;
        mesEventsScopeRawButton.setAttribute("aria-pressed", diagnosticsVisible && scope === "raw" ? "true" : "false");
    }

    if (mesEventsScopeAttributedButton) {
        mesEventsScopeAttributedButton.classList.toggle("is-active", !unassigned && getSelectedEventsScope() === "attributed");
        mesEventsScopeAttributedButton.disabled = unassigned;
        mesEventsScopeAttributedButton.setAttribute("aria-pressed", !unassigned && getSelectedEventsScope() === "attributed" ? "true" : "false");
    }

    if (mesEventsToggleDiagnosticsButton) {
        mesEventsToggleDiagnosticsButton.classList.toggle("is-active", diagnosticsVisible);
        mesEventsToggleDiagnosticsButton.disabled = unassigned;
        mesEventsToggleDiagnosticsButton.textContent = diagnosticsVisible ? "Ukryj diagnostyke" : "Diagnostyka";
        mesEventsToggleDiagnosticsButton.setAttribute("aria-pressed", diagnosticsVisible ? "true" : "false");
    }
}

function getAdminEditScope() {
    return adminEditScope === "entry" ? "entry" : "kkw";
}

function setAdminEditScope(scope = "kkw") {
    adminEditScope = scope === "entry" ? "entry" : "kkw";
}

function getBatchTitle(batch) {
    if (!batch) {
        return "-";
    }

    const product = [batch.productCode, batch.productName].filter(Boolean).join(" - ");
    return product || batch.kkwNumber || "-";
}

function getBoardSideLabel(value) {
    const side = String(value || "").trim().toLowerCase();
    if (side === "top") {
        return "Top";
    }

    if (side === "bot") {
        return "Bot";
    }

    return "Brak";
}

function getPcsPerPanelLabel(batch) {
    if (!batch?.pcsPerPanel) {
        return "Brak ustawienia";
    }

    const baseLabel = `${formatNumber(batch.pcsPerPanel)} PCB`;
    if (batch.pcsPerPanelSource === "product_setting") {
        return `${baseLabel} | produkt`;
    }

    if (batch.pcsPerPanelSource === "name_hint") {
        return `${baseLabel} | nazwa`;
    }

    if (batch.pcsPerPanelSource === "operator_panel" || batch.pcsPerPanelSource === "admin_panel") {
        return `${baseLabel} | panel`;
    }

    return baseLabel;
}

function buildKkwSummaryLine(batch) {
    if (!batch) {
        return "";
    }

    return [
        `Wejscia ${formatNumber(batch.inputCount ?? 0)}`,
        `Wyjscia ${formatNumber(batch.outputCount ?? 0)}`,
        `W piecu ${formatNumber(batch.inOvenCount ?? 0)}`,
        `PCB ${formatNumber(batch.pcbCount ?? 0)}`,
    ].join(" | ");
}

function setAdminFormDisabled(disabled) {
    if (!mesAdminForm) {
        return;
    }

    mesAdminForm.querySelectorAll("input, select, button").forEach((element) => {
        if (element.type === "hidden") {
            return;
        }

        element.disabled = disabled;
    });
}

function setAdminStatus(message, type = "info") {
    if (!mesAdminStatus) {
        return;
    }

    mesAdminStatus.textContent = message;
    mesAdminStatus.className = `note mes-admin-status mes-admin-status-${type}`;
}

function shouldPinDrawer() {
    return false;
}

function applyAdminDrawerLayout(open) {
    if (!mesAdminDrawer || !mesAdminOverlay || !mesAdminPanel) {
        return;
    }

    const inset = window.innerWidth <= 720 ? 6 : 10;
    const topOffset = window.innerWidth <= 720 ? 44 : 48;
    const maxWidth = window.innerWidth <= 720
        ? Math.max(280, window.innerWidth - 12)
        : Math.min(380, window.innerWidth - 20);

    Object.assign(mesAdminDrawer.style, {
        display: open ? "block" : "none",
        position: "fixed",
        inset: "0",
        width: "auto",
        zIndex: "9999",
        pointerEvents: open ? "auto" : "none",
        visibility: open ? "visible" : "hidden",
    });

    Object.assign(mesAdminOverlay.style, {
        display: "block",
        position: "fixed",
        inset: "0",
        background: "transparent",
        opacity: "1",
        transition: "none",
    });

    Object.assign(mesAdminPanel.style, {
        display: "grid",
        position: "fixed",
        top: `${topOffset}px`,
        right: `${inset}px`,
        bottom: `${inset}px`,
        left: "auto",
        width: `${maxWidth}px`,
        maxWidth: `calc(100vw - ${inset * 2}px)`,
        height: "auto",
        maxHeight: "none",
        overflow: "auto",
        opacity: open ? "1" : "0",
        visibility: "visible",
        transform: open ? "translateX(0)" : "translateX(calc(100% + 24px))",
        transition: "transform 180ms ease, opacity 180ms ease",
        pointerEvents: "auto",
    });
}

function openAdminDrawer() {
    if (!mesAdminDrawer || !selectedBatchId) {
        return;
    }

    drawerDismissed = false;
    drawerOpen = true;
    mesAdminDrawer.hidden = false;
    mesAdminDrawer.classList.add("open");
    mesAdminDrawer.setAttribute("aria-hidden", "false");
    applyAdminDrawerLayout(true);
}

function closeAdminDrawer({ dismissed = true } = {}) {
    if (!mesAdminDrawer) {
        return;
    }

    drawerDismissed = dismissed;
    drawerOpen = false;
    mesAdminDrawer.classList.remove("open");
    mesAdminDrawer.setAttribute("aria-hidden", "true");
    mesAdminDrawer.hidden = true;
    applyAdminDrawerLayout(false);
}

function openInvestigationDrawer() {
    if (!mesInvestigationDrawer || !selectedBatchId) {
        return;
    }

    investigationOpen = true;
    mesInvestigationDrawer.hidden = false;
    mesInvestigationDrawer.classList.add("open");
    mesInvestigationDrawer.setAttribute("aria-hidden", "false");
}

function closeInvestigationDrawer() {
    if (!mesInvestigationDrawer) {
        return;
    }

    investigationOpen = false;
    mesInvestigationDrawer.classList.remove("open");
    mesInvestigationDrawer.setAttribute("aria-hidden", "true");
    mesInvestigationDrawer.hidden = true;
}

function scrollToEntries() {
    const target = mesEntriesBody?.closest(".mes-detail-card");
    if (!target) {
        return;
    }

    target.scrollIntoView({
        behavior: "smooth",
        block: "start",
    });
}

function getGroupKey(batch) {
    return [
        String(batch?.deviceId || "").trim(),
        String(batch?.kkwNumber || "").trim(),
        String(batch?.boardSide || "").trim().toLowerCase(),
    ].join("::");
}

function getFirstFilledValue(entries, fieldName) {
    for (const entry of entries) {
        const value = String(entry?.[fieldName] || "").trim();
        if (value) {
            return value;
        }
    }

    return "";
}

function getLatestEntry(entries = []) {
    return [...entries].sort((left, right) => {
        const diff = getSortTimestamp(right?.startedAt) - getSortTimestamp(left?.startedAt);
        if (diff !== 0) {
            return diff;
        }
        return (Number(right?.id) || 0) - (Number(left?.id) || 0);
    })[0] || null;
}

function buildKkwGroups(batches = []) {
    const grouped = new Map();

    for (const batch of Array.isArray(batches) ? batches : []) {
        const key = getGroupKey(batch);
        if (!grouped.has(key)) {
            grouped.set(key, {
                key,
                entries: [],
            });
        }

        grouped.get(key).entries.push(batch);
    }

    return [...grouped.values()].map((group) => {
        const entries = [...group.entries]
            .sort((left, right) => {
                const diff = getSortTimestamp(left?.startedAt) - getSortTimestamp(right?.startedAt);
                if (diff !== 0) {
                    return diff;
                }
                return (Number(left?.id) || 0) - (Number(right?.id) || 0);
            })
            .map((entry, index) => ({
                ...entry,
                entryOrdinal: index + 1,
            }));

        const activeEntry = entries.find((entry) => entry.status === "active") || null;
        const latestEntry = getLatestEntry(entries);
        const representative = activeEntry || latestEntry || entries[entries.length - 1] || null;
        const latestActivityAt = entries.reduce((latest, entry) => {
            const candidate = entry?.endedAt || entry?.startedAt || null;
            return getSortTimestamp(candidate) > getSortTimestamp(latest) ? candidate : latest;
        }, null);

        return {
            key: group.key,
            entries,
            representative,
            latestEntry,
            activeEntry,
            activeEntryOrdinal: activeEntry ? entries.find((entry) => Number(entry.id) === Number(activeEntry.id))?.entryOrdinal || null : null,
            latestActivityAt,
            entryCount: entries.length,
            kkwNumber: representative?.kkwNumber || "",
            boardSide: representative?.boardSide || "",
            productCode: representative?.productCode || getFirstFilledValue(entries, "productCode"),
            productName: representative?.productName || getFirstFilledValue(entries, "productName"),
            plannedQuantity: representative?.plannedQuantity ?? null,
            pcbCount: representative?.pcbCount ?? null,
            remainingQuantity: representative?.remainingQuantity ?? null,
            progressPercent: representative?.progressPercent ?? null,
            status: activeEntry ? "active" : "closed",
            pcsPerPanelMissing: Boolean(representative?.pcsPerPanelMissing),
        };
    }).sort((left, right) => {
        const diff = getSortTimestamp(right?.latestActivityAt || right?.latestEntry?.startedAt)
            - getSortTimestamp(left?.latestActivityAt || left?.latestEntry?.startedAt);
        if (diff !== 0) {
            return diff;
        }

        return (Number(right?.representative?.id) || 0) - (Number(left?.representative?.id) || 0);
    });
}

function getDefaultEntryForGroup(group) {
    return group?.activeEntry || group?.latestEntry || group?.entries?.[group.entries.length - 1] || null;
}

function resolveSelection(groups = []) {
    if (!groups.length) {
        selectedGroupKey = "";
        selectedBatchId = null;
        return {
            selectedGroup: null,
            selectedBatch: null,
        };
    }

    let selectedGroup = groups.find((group) => group.entries.some((entry) => Number(entry.id) === Number(selectedBatchId))) || null;

    if (!selectedGroup && selectedGroupKey) {
        selectedGroup = groups.find((group) => group.key === selectedGroupKey) || null;
    }

    if (!selectedGroup) {
        selectedGroup = groups[0];
    }

    selectedGroupKey = selectedGroup?.key || "";
    let selectedBatch = selectedGroup.entries.find((entry) => Number(entry.id) === Number(selectedBatchId)) || null;
    if (!selectedBatch) {
        selectedBatch = getDefaultEntryForGroup(selectedGroup);
    }

    selectedBatchId = selectedBatch?.id || null;

    return {
        selectedGroup,
        selectedBatch,
    };
}

function getEntryLabel(group, batch) {
    if (!group || !batch) {
        return "-";
    }

    const selectedEntry = group.entries.find((entry) => Number(entry.id) === Number(batch.id));
    return selectedEntry ? `Wejscie #${selectedEntry.entryOrdinal}` : "-";
}

function getInvestigationSelection(selection = null) {
    const resolvedSelection = selection || resolveSelection(latestGroups);
    return {
        group: resolvedSelection.selectedGroup || null,
        batch: resolvedSelection.selectedBatch || null,
        entryLabel: resolvedSelection.selectedGroup && resolvedSelection.selectedBatch
            ? getEntryLabel(resolvedSelection.selectedGroup, resolvedSelection.selectedBatch)
            : "Wejscie",
    };
}

function classifyTransitForBatch(transit, batchId) {
    if (!transit) {
        return {
            label: "Brak danych",
            tone: "neutral",
            note: "-",
        };
    }

    if (transit.status === "reset") {
        return {
            label: "Reset",
            tone: "neutral",
            note: "Przejscie zostalo odciete resetem pieca.",
        };
    }

    if (transit.status === "manual_missing_out") {
        return {
            label: "Recznie domkniete",
            tone: "warning",
            note: "Brak sygnalu OUT; wyjscie zaliczono recznie po decyzji admina.",
        };
    }

    if (transit.pulseInId && transit.pulseOutId) {
        const reassignedOutNote = Number(transit.batchIdOut) > 0 && Number(transit.batchIdOut) !== Number(batchId)
            ? `OUT zapisany przy batch #${transit.batchIdOut}.`
            : "IN i OUT zostaly poprawnie sparowane.";
        return {
            label: "Sparowane",
            tone: "good",
            note: reassignedOutNote,
        };
    }

    if (transit.pulseInId && !transit.pulseOutId) {
        return {
            label: "Brak OUT",
            tone: "warning",
            note: "Wejscie czeka jeszcze na odpowiadajace wyjscie.",
        };
    }

    if (!transit.pulseInId && transit.pulseOutId) {
        return {
            label: "Orphan OUT",
            tone: "warning",
            note: "Wyjscie nie ma sparowanego wejscia dla tego wejscia.",
        };
    }

    return {
        label: "Nieznane",
        tone: "neutral",
        note: "Transit nie ma kompletnej pary in/out.",
    };
}

function renderInvestigationSummary(payload, selection = null) {
    if (!mesInvestigationSummary) {
        return;
    }

    const resolvedSelection = getInvestigationSelection(selection);
    const stats = payload?.stats || {};
    const batch = payload?.batch || resolvedSelection.batch || null;

    if (mesInvestigationTitle) {
        mesInvestigationTitle.textContent = batch
            ? `Sledztwo ${resolvedSelection.entryLabel}`
            : "Sledztwo wejscia";
    }

    if (mesInvestigationSubtitle) {
        mesInvestigationSubtitle.textContent = batch && resolvedSelection.group
            ? `${resolvedSelection.group.kkwNumber} / ${getBoardSideLabel(resolvedSelection.group.boardSide)} | ${getBatchTitle(batch)}`
            : "Wybierz wejscie, aby przeanalizowac pary in/out i impulsy.";
    }

    if (!batch) {
        mesInvestigationSummary.innerHTML = "";
        mesInvestigationSummary.classList.add("hidden");
        return;
    }

    const items = [
        ["Wejscie", resolvedSelection.entryLabel],
        ["Wejscia", formatPanelCount(stats.inputCount ?? batch.batchInputCount ?? 0)],
        ["Wyjscia", formatPanelCount(stats.outputCount ?? batch.batchOutputCount ?? 0)],
        ["Sparowane", formatNumber(stats.pairedCount ?? 0)],
        ["Brak OUT", formatNumber(stats.missingOutCount ?? 0)],
        ["Reczne", formatNumber(stats.manualCloseCount ?? 0)],
        ["Orphan OUT", formatNumber(stats.orphanOutCount ?? 0)],
        ["Reset", formatNumber(stats.resetCount ?? 0)],
    ];

    mesInvestigationSummary.innerHTML = items.map(([label, value]) => `
        <span class="mes-selection-pill">
            <small>${escapeHtml(label)}</small>
            <strong>${escapeHtml(value)}</strong>
        </span>
    `).join("");
    mesInvestigationSummary.classList.remove("hidden");
}

function renderTransits(payload, selection = null) {
    const resolvedSelection = getInvestigationSelection(selection);
    const batch = payload?.batch || resolvedSelection.batch || null;
    const transits = Array.isArray(payload?.transits) ? payload.transits : [];

    if (mesTransitsTitle) {
        mesTransitsTitle.textContent = batch
            ? `Pary in/out dla ${resolvedSelection.entryLabel}`
            : "Pary in/out dla wejscia";
    }

    if (mesTransitsMeta) {
        mesTransitsMeta.textContent = batch && resolvedSelection.group
            ? `${resolvedSelection.group.kkwNumber} / ${getBoardSideLabel(resolvedSelection.group.boardSide)} | ${getBatchTitle(batch)}`
            : "Wybierz wejscie, aby przeanalizowac pary in/out.";
    }

    if (!mesTransitsBody) {
        return;
    }

    if (!batch) {
        mesTransitsBody.innerHTML = `<tr><td colspan="7">Wybierz wejscie, aby zobaczyc pary in/out.</td></tr>`;
        return;
    }

    if (!payload) {
        mesTransitsBody.innerHTML = `<tr><td colspan="7">Ladowanie par in/out dla ${escapeHtml(resolvedSelection.entryLabel)}...</td></tr>`;
        return;
    }

    if (!transits.length) {
        mesTransitsBody.innerHTML = `<tr><td colspan="7">Brak transitow dla ${escapeHtml(resolvedSelection.entryLabel)}.</td></tr>`;
        return;
    }

    mesTransitsBody.innerHTML = transits.map((transit, index) => {
        const status = classifyTransitForBatch(transit, batch.id);
        const canManualClose = transit.pulseInId
            && !transit.pulseOutId
            && ["open", "reset"].includes(String(transit.status || "").trim().toLowerCase());
        return `
            <tr>
                <td><strong>${transits.length - index}</strong></td>
                <td>${formatDateTime(transit.enteredAt)}</td>
                <td>${formatDateTime(transit.exitedAt)}</td>
                <td>${formatDurationSeconds(transit.durationSeconds)}</td>
                <td><span class="phase-badge ${status.tone}">${escapeHtml(status.label)}</span></td>
                <td>${escapeHtml(status.note)}</td>
                <td>
                    ${canManualClose
                        ? `<button class="ghost mes-icon-button" type="button" data-manual-close-transit-id="${transit.id}">${transit.status === "reset" ? "Odzyskaj recznie" : "Zamknij recznie"}</button>`
                        : `<span class="mes-card-meta">-</span>`}
                </td>
            </tr>
        `;
    }).join("");

    mesTransitsBody.querySelectorAll("[data-manual-close-transit-id]").forEach((button) => {
        button.addEventListener("click", () => {
            const transitId = Number(button.dataset.manualCloseTransitId);
            void manuallyCloseSelectedTransit(transitId).catch((error) => {
                setAdminStatus(error.message || "Nie udalo sie recznie domknac brakujacego OUT.", "error");
            });
        });
    });
}

function updateSelectedPulsesBadge() {
    if (!mesSelectedPulses) {
        return;
    }

    const count = selectedPulseIds.size;
    mesSelectedPulses.textContent = `${count} zaznaczonych`;
    if (mesEventsSelectionFooter) {
        mesEventsSelectionFooter.textContent = `Zaznaczonych: ${count}`;
    }
    const hasSelectedBatch = Boolean(selectedBatchId);
    const canAssign = count > 0 && hasSelectedBatch;

    if (mesDeletePulsesButton) {
        mesDeletePulsesButton.disabled = count === 0;
    }

    if (mesAssignPulsesButton) {
        mesAssignPulsesButton.disabled = !canAssign;
        mesAssignPulsesButton.textContent = shouldShowUnassignedEvents() ? "Przypisz do wejscia" : "Przepnij do wejscia";
    }
}

function getOpenTransitCount() {
    const count = Number(latestSummaryPayload?.summary?.inOvenCount);
    return Number.isFinite(count) && count > 0 ? count : 0;
}

function formatAffectedKkwLabels(items = []) {
    const labels = Array.from(new Set(
        (Array.isArray(items) ? items : [])
            .map((item) => {
                const kkwNumber = String(item?.kkwNumber || "").trim();
                const boardSide = getBoardSideLabel(item?.boardSide);
                return kkwNumber ? `${kkwNumber} (${boardSide})` : "";
            })
            .filter(Boolean)
    ));

    return labels.join(", ");
}

function populateAdminForm(batch) {
    if (!mesAdminForm) {
        return;
    }

    mesAdminForm.batchId.value = batch?.id || "";
    mesAdminForm.kkwNumber.value = batch?.kkwNumber || "";
    mesAdminForm.plannedQuantity.value = batch?.plannedQuantity ?? "";
    mesAdminForm.boardSide.value = batch?.boardSide || "";
    mesAdminForm.orderNumber.value = batch?.orderNumber || "";
    mesAdminForm.productCode.value = batch?.productCode || "";
    mesAdminForm.productName.value = batch?.productName || "";
    mesAdminForm.pcsPerPanel.value = batch?.pcsPerPanel ?? "";
    mesAdminForm.saveForProduct.checked = true;
}

function renderAdminPreview(group, batch) {
    if (!mesAdminPreview || !mesAdminTitle || !mesAdminSubtitle) {
        return;
    }

    const scope = getAdminEditScope();

    if (!batch || !group) {
        mesAdminTitle.textContent = "Edytuj KKW";
        mesAdminSubtitle.textContent = "Wybierz KKW z tabeli, aby otworzyc edycje.";
        mesAdminPreview.innerHTML = `
            <div class="mes-admin-placeholder">
                <strong>Wybierz KKW</strong>
                <span>Tutaj pojawi sie podsumowanie KKW i formularz edycji.</span>
            </div>
        `;
        populateAdminForm(null);
        setAdminFormDisabled(true);
        setAdminStatus("Wybierz KKW, aby edytowac jego dane.", "info");
        if (mesDeleteBatchButton) {
            mesDeleteBatchButton.disabled = true;
            mesDeleteBatchButton.textContent = "Usun KKW";
        }
        if (mesDeleteBatchWithPulsesButton) {
            mesDeleteBatchWithPulsesButton.disabled = true;
            mesDeleteBatchWithPulsesButton.textContent = "Usun KKW + impulsy";
        }
        return;
    }

    if (scope === "entry") {
        mesAdminTitle.textContent = `Edytuj ${getEntryLabel(group, batch)}`;
        mesAdminSubtitle.textContent = `${batch.kkwNumber || "Brak KKW"} / ${getBoardSideLabel(batch.boardSide)} | ${getBatchTitle(batch)}`;

        const previewItems = [
            ["Wejscie", getEntryLabel(group, batch)],
            ["Status", batch.status === "active" ? "Aktywne" : "Zamkniete"],
            ["Start", formatDateTime(batch.startedAt)],
            ["Koniec", formatDateTime(batch.endedAt)],
            ["Wejscia", formatPanelCount(batch.batchInputCount)],
            ["Wyjscia", formatPanelCount(batch.batchOutputCount)],
            ["W piecu", formatPanelCount(batch.batchInOvenCount)],
            ["PCB/panel", batch.pcsPerPanel ? formatNumber(batch.pcsPerPanel) : "-"],
        ];

        mesAdminPreview.innerHTML = `
            <div class="mes-admin-preview-note">
                Zmiany ponizej obejma tylko ${escapeHtml(getEntryLabel(group, batch))} dla KKW ${escapeHtml(batch.kkwNumber || "-")}.
            </div>
            <div class="mes-admin-preview-grid">
                ${previewItems.map(([label, value]) => `
                    <div class="mes-admin-preview-card">
                        <span>${escapeHtml(label)}</span>
                        <strong>${escapeHtml(value)}</strong>
                    </div>
                `).join("")}
            </div>
        `;
    } else {
        mesAdminTitle.textContent = `${batch.kkwNumber || "Brak KKW"} / ${getBoardSideLabel(batch.boardSide)}`;
        mesAdminSubtitle.textContent = `${getBatchTitle(batch)} | ${group.entryCount} wejscia na piec`;

        const previewItems = [
            ["Wykonano", formatPcbCount(group.pcbCount)],
            ["Plan", batch.plannedQuantity ? formatNumber(batch.plannedQuantity, " szt.") : "-"],
            ["Pozostalo", batch.remainingQuantity === null || batch.remainingQuantity === undefined ? "-" : formatNumber(batch.remainingQuantity, " szt.")],
            ["Wejscia", formatNumber(group.entryCount)],
            ["Wybrane wejscie", getEntryLabel(group, batch)],
            ["Status", batch.status === "active" ? "Aktywne" : "Zamkniete"],
            ["PCB/panel", batch.pcsPerPanel ? formatNumber(batch.pcsPerPanel) : "-"],
            ["Ostatnia aktywnosc", formatDateTime(group.latestActivityAt)],
        ];

        mesAdminPreview.innerHTML = `
            <div class="mes-admin-preview-note">
                Zmiany ponizej obejma cale KKW i wszystkie jego wejscia na piec dla strony ${escapeHtml(getBoardSideLabel(batch.boardSide))}.
            </div>
            <div class="mes-admin-preview-grid">
                ${previewItems.map(([label, value]) => `
                    <div class="mes-admin-preview-card">
                        <span>${escapeHtml(label)}</span>
                        <strong>${escapeHtml(value)}</strong>
                    </div>
                `).join("")}
            </div>
        `;
    }

    populateAdminForm(batch);
    setAdminFormDisabled(false);
    if (mesDeleteBatchButton) {
        mesDeleteBatchButton.disabled = false;
        mesDeleteBatchButton.textContent = scope === "entry" ? "Usun wejscie" : "Usun KKW";
    }
    if (mesDeleteBatchWithPulsesButton) {
        mesDeleteBatchWithPulsesButton.disabled = false;
        mesDeleteBatchWithPulsesButton.textContent = scope === "entry" ? "Usun wejscie + impulsy" : "Usun KKW + impulsy";
    }
    if (scope === "entry") {
        setAdminStatus(
            batch.pcsPerPanelMissing
                ? `Edytujesz ${getEntryLabel(group, batch)}. To wejscie nie ma ustawionego PCB na panel.`
                : `Edytujesz ${getEntryLabel(group, batch)} dla KKW ${batch.kkwNumber}.`,
            batch.pcsPerPanelMissing ? "warning" : "info"
        );
    } else {
        setAdminStatus(
            batch.pcsPerPanelMissing
                ? "Wybrane KKW nie ma ustawionego PCB na panel. Popraw to tutaj, a zmiana obejmie wszystkie wejscia."
                : `Edytujesz KKW ${batch.kkwNumber}.`,
            batch.pcsPerPanelMissing ? "warning" : "info"
        );
    }
}

function updateContextBadges(selection) {
    if (mesSelectedBatch) {
        mesSelectedBatch.textContent = selection.selectedGroup
            ? `${selection.selectedGroup.kkwNumber} / ${getBoardSideLabel(selection.selectedGroup.boardSide)}`
            : "Wybierz KKW";
    }

    if (mesSelectedEntry) {
        mesSelectedEntry.textContent = shouldShowUnassignedEvents()
            ? "Impulsy do wyjasnienia"
            : selection.selectedBatch && selection.selectedGroup
                ? getEntryLabel(selection.selectedGroup, selection.selectedBatch)
                : "Wybierz wejscie";
    }
}

function renderSummary(payload) {
    const summary = payload?.summary || {};
    latestSummaryPayload = payload;
    const activeBatch = summary.activeBatch || null;
    if (mesSummary) {
        const items = [
            ["Status", summary.status || "Brak danych"],
            ["Aktywne KKW", activeBatch?.kkwNumber ? `${activeBatch.kkwNumber} / ${getBoardSideLabel(activeBatch.boardSide)}` : "-"],
            ["W piecu", formatPanelCount(summary.inOvenCount)],
            ["Wejscia dzis", formatPanelCount(summary.entryCounts?.today ?? 0)],
            ["Wyjscia dzis", formatPanelCount(summary.counts?.today ?? 0)],
            ["Sr. czas pieca", formatDurationSeconds(summary.averageOvenTimeSeconds)],
            ["Predkosc", formatSpeedMetersPerMinute(summary.averageOvenSpeedMetersPerMinute)],
        ].filter(([, value]) => value && value !== "-");

        mesSummary.innerHTML = items.map(([label, value]) => `
            <div class="mes-summary-pill">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(value)}</strong>
            </div>
        `).join("");

        mesSummary.classList.toggle("hidden", items.length === 0);
    }

    if (mesJumpActiveButton) {
        mesJumpActiveButton.disabled = !activeBatch;
    }

    if (mesResetTransitsButton) {
        mesResetTransitsButton.disabled = !(Number(summary?.inOvenCount) > 0);
    }
}

function renderBatches(groups, selection) {
    if (!mesBatchesBody) {
        return;
    }

    if (!groups.length) {
        mesBatchesBody.innerHTML = `<tr><td colspan="11">Brak KKW dla wybranego filtra.</td></tr>`;
        return;
    }

    mesBatchesBody.innerHTML = groups.map((group) => {
        const isSelectedGroup = group.key === selection.selectedGroup?.key;
        const representative = group.representative;
        const plannedLabel = representative?.plannedQuantity ? formatNumber(representative.plannedQuantity, " szt.") : "-";
        const statusLabel = group.status === "active" ? "Aktywne" : "Zamkniete";
        const productMeta = [
            group.productCode ? `Kod: ${group.productCode}` : "",
            `PCB/panel: ${representative?.pcsPerPanel ? formatNumber(representative.pcsPerPanel) : "brak"}`,
        ].filter(Boolean).join(" | ");
        const activeEntryLabel = group.activeEntryOrdinal ? `#${group.activeEntryOrdinal}` : "-";

        return `
            <tr class="mes-kkw-row ${isSelectedGroup ? "selected" : ""}" data-group-key="${escapeHtml(group.key)}">
                <td>
                    <strong>${escapeHtml(group.kkwNumber)}</strong>
                    <small>${formatNumber(group.entryCount)} wejscia</small>
                </td>
                <td>${escapeHtml(getBoardSideLabel(group.boardSide))}</td>
                <td>
                    ${escapeHtml(getBatchTitle(representative))}
                    ${productMeta ? `<small>${escapeHtml(productMeta)}</small>` : ""}
                </td>
                <td>${escapeHtml(plannedLabel)}</td>
                <td>${formatPcbCount(group.pcbCount)}</td>
                <td>${representative?.remainingQuantity === null || representative?.remainingQuantity === undefined ? "-" : formatNumber(representative.remainingQuantity, " szt.")}</td>
                <td>${formatNumber(group.entryCount)}</td>
                <td>${escapeHtml(activeEntryLabel)}</td>
                <td>${formatDateTime(group.latestActivityAt)}</td>
                <td><span class="phase-badge ${group.status === "active" ? "good" : "neutral"}">${statusLabel}</span></td>
                <td>
                    <div class="mes-row-actions">
                        <button class="ghost mes-icon-button" type="button" data-open-editor-batch-id="${representative?.id || ""}">...</button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    mesBatchesBody.querySelectorAll("[data-group-key]").forEach((row) => {
        row.addEventListener("click", () => {
            const groupKey = String(row.dataset.groupKey || "");
            void selectGroup(groupKey).catch((error) => {
                mesStatus.textContent = error.message || "Blad pobierania MES.";
            });
        });
    });

    mesBatchesBody.querySelectorAll("[data-open-editor-batch-id]").forEach((button) => {
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            const batchId = Number(button.dataset.openEditorBatchId);
            void selectBatch(batchId, { openDrawer: true, editorScope: "kkw" }).catch((error) => {
                setAdminStatus(error.message || "Nie udalo sie otworzyc edycji KKW.", "error");
            });
        });
    });
}

function renderEntries(group, selectedBatch) {
    if (!mesEntriesBody || !mesEntriesTitle || !mesEntriesMeta) {
        return;
    }

    if (!group) {
        mesEntriesTitle.textContent = "2. Wejscia na piec";
        mesEntriesMeta.textContent = "Krok 2: wybierz KKW z tabeli powyzej.";
        if (mesSelectedKkw) {
            mesSelectedKkw.innerHTML = "";
            mesSelectedKkw.classList.add("hidden");
        }
        if (mesOpenInvestigationButton) {
            mesOpenInvestigationButton.disabled = true;
        }
        mesEntriesBody.innerHTML = `<tr><td colspan="13">Wybierz KKW z tabeli powyzej.</td></tr>`;
        return;
    }

    const representative = group.representative;
    const entries = [...group.entries].sort((left, right) => {
        const diff = getSortTimestamp(right?.startedAt) - getSortTimestamp(left?.startedAt);
        if (diff !== 0) {
            return diff;
        }
        return (Number(right?.id) || 0) - (Number(left?.id) || 0);
    });

    mesEntriesTitle.textContent = `2. Wejscia dla KKW ${group.kkwNumber}`;
    mesEntriesMeta.textContent = `${getBoardSideLabel(group.boardSide)} | ${getBatchTitle(representative)} | ${formatNumber(group.entryCount)} wejscia | Krok 3: kliknij wejscie, a sledztwo otworz osobno`;

    if (mesOpenInvestigationButton) {
        mesOpenInvestigationButton.disabled = !selectedBatch;
    }

    if (mesSelectedKkw) {
        const items = [
            ["Plan", representative?.plannedQuantity ? formatNumber(representative.plannedQuantity, " szt.") : "-"],
            ["Wykonano", formatPcbCount(group.pcbCount)],
            ["Pozostalo", representative?.remainingQuantity === null || representative?.remainingQuantity === undefined ? "-" : formatNumber(representative.remainingQuantity, " szt.")],
            ["W piecu", formatPanelCount(representative?.inOvenCount)],
            ["Wybrane", selectedBatch ? getEntryLabel(group, selectedBatch) : "-"],
        ];

        mesSelectedKkw.innerHTML = items.map(([label, value]) => `
            <span class="mes-selection-pill">
                <small>${escapeHtml(label)}</small>
                <strong>${escapeHtml(value)}</strong>
            </span>
        `).join("");
        mesSelectedKkw.classList.remove("hidden");
    }

    mesEntriesBody.innerHTML = entries.map((entry) => {
        const isSelectedEntry = Number(entry.id) === Number(selectedBatch?.id);
        const entryStatusLabel = entry.status === "active" ? "Aktywne" : "Zamkniete";

        return `
            <tr class="mes-entry-row ${isSelectedEntry ? "selected" : ""}" data-entry-batch-id="${entry.id}">
                <td>
                    <strong>#${entry.entryOrdinal}</strong>
                    <small>Batch #${entry.id}</small>
                </td>
                <td>${formatDateTime(entry.startedAt)}</td>
                <td>${formatDateTime(entry.endedAt)}</td>
                <td>${formatDurationSeconds(entry.durationSeconds)}</td>
                <td>${entry.pcsPerPanel ? formatNumber(entry.pcsPerPanel) : "-"}</td>
                <td>${formatPanelCount(entry.batchInputCount)}</td>
                <td>${formatPanelCount(entry.batchOutputCount ?? entry.batchPanelCount ?? entry.batchPulseCount)}</td>
                <td>${formatPanelCount(entry.batchInOvenCount)}</td>
                <td>${formatPcbCount(entry.batchPcbCount)}</td>
                <td>${formatDurationSeconds(entry.batchAverageOvenTimeSeconds ?? entry.averageOvenTimeSeconds)}</td>
                <td>${formatSpeedMetersPerMinute(entry.batchAverageOvenSpeedMetersPerMinute ?? entry.averageOvenSpeedMetersPerMinute)}</td>
                <td><span class="phase-badge ${entry.status === "active" ? "good" : "neutral"}">${entryStatusLabel}</span></td>
                <td>
                    <div class="mes-row-actions">
                        <button class="ghost mes-icon-button" type="button" data-entry-focus="${entry.id}">...</button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    mesEntriesBody.querySelectorAll("[data-entry-batch-id]").forEach((row) => {
        row.addEventListener("click", () => {
            const batchId = Number(row.dataset.entryBatchId);
            void selectBatch(batchId).catch((error) => {
                mesStatus.textContent = error.message || "Blad pobierania MES.";
            });
        });
    });

    mesEntriesBody.querySelectorAll("[data-entry-focus]").forEach((button) => {
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            const batchId = Number(button.dataset.entryFocus);
            void selectBatch(batchId, { openDrawer: true, editorScope: "entry" }).catch((error) => {
                setAdminStatus(error.message || "Nie udalo sie otworzyc edycji wejscia.", "error");
            });
        });
    });
}

function renderEvents(payload) {
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const selection = getInvestigationSelection();
    if (mesEventsCount) {
        mesEventsCount.textContent = String(events.length);
    }
    if (mesEventsRange) {
        mesEventsRange.textContent = events.length ? `1-${events.length} z ${events.length}` : "0-0 z 0";
    }
    if (mesEventsTitle) {
        mesEventsTitle.textContent = shouldShowUnassignedEvents()
            ? "Diagnostyka: impulsy do wyjasnienia"
            : selection.batch && selection.group
                ? getSelectedEventsScope() === "attributed"
                    ? `Impulsy zliczone do ${selection.entryLabel}`
                    : `Surowe impulsy dla ${selection.entryLabel}`
                : "Impulsy dla wybranego wejscia";
    }
    if (!events.length) {
        mesEventsBody.innerHTML = `<tr><td colspan="6">${shouldShowUnassignedEvents() ? "Brak impulsow do wyjasnienia dla wybranego device." : "Brak impulsow dla wybranego wejscia w tym zakresie diagnostycznym."}</td></tr>`;
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
            <td>${formatDateTime(event.ts)}</td>
            <td>${escapeHtml(event.sensorId || "-")}</td>
            <td>${escapeHtml(event.deviceId || "-")}</td>
            <td>${event.batchId || "-"}</td>
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

function renderFromState() {
    latestGroups = buildKkwGroups(latestBatchRows);
    const selection = resolveSelection(latestGroups);
    renderBatches(latestGroups, selection);
    renderEntries(selection.selectedGroup, selection.selectedBatch);
    renderAdminPreview(selection.selectedGroup, selection.selectedBatch);
    updateContextBadges(selection);

    if (mesOpenInvestigationButton) {
        mesOpenInvestigationButton.disabled = !selection.selectedBatch;
    }

    if (!selection.selectedBatch && drawerOpen) {
        closeAdminDrawer({ dismissed: false });
    }

    if (!selection.selectedBatch && investigationOpen) {
        closeInvestigationDrawer();
    }

    return selection;
}

function updateStatusText(selection) {
    if (!selection.selectedBatch || !selection.selectedGroup) {
        mesStatus.textContent = "Brak KKW dla wybranego filtra.";
        return;
    }

    mesStatus.textContent = selection.selectedBatch.pcsPerPanelMissing
        ? `Pokazuje ${selection.selectedGroup.kkwNumber} (${getBoardSideLabel(selection.selectedGroup.boardSide)}) oraz ${getEntryLabel(selection.selectedGroup, selection.selectedBatch)}. Brakuje ustawienia PCB na panel.`
        : `Pokazuje ${selection.selectedGroup.kkwNumber} (${getBoardSideLabel(selection.selectedGroup.boardSide)}) oraz ${getEntryLabel(selection.selectedGroup, selection.selectedBatch)}.`;
}

async function refreshEvents(selection = null) {
    const resolvedSelection = selection || renderFromState();
    const deviceId = encodeURIComponent(getDeviceId());
    const scope = encodeURIComponent(getSelectedEventsScope());

    const events = shouldShowUnassignedEvents()
        ? await fetchJson(`/api/mes/oven/events?device_id=${deviceId}&unassigned=1&limit=100`)
        : resolvedSelection.selectedBatch
            ? await fetchJson(`/api/mes/oven/events?batch_id=${encodeURIComponent(resolvedSelection.selectedBatch.id)}&scope=${scope}&limit=100`)
            : { events: [] };

    updateEventsScopeControls();
    renderEvents(events);
    updateContextBadges(resolvedSelection);
    updateStatusText(resolvedSelection);
}

async function refreshInvestigation(selection = null) {
    const resolvedSelection = selection || renderFromState();
    const hasSelectedBatch = Boolean(resolvedSelection.selectedBatch?.id);

    updateEventsScopeControls();
    renderInvestigationSummary(null, resolvedSelection);
    renderTransits(null, resolvedSelection);

    if (!hasSelectedBatch) {
        renderEvents({ events: [] });
        updateContextBadges(resolvedSelection);
        updateStatusText(resolvedSelection);
        return;
    }

    const [transitsPayload, eventsPayload] = await Promise.all([
        fetchJson(`/api/mes/oven/transits?batch_id=${encodeURIComponent(resolvedSelection.selectedBatch.id)}&limit=200`),
        (async () => {
            const deviceId = encodeURIComponent(getDeviceId());
            const scope = encodeURIComponent(getSelectedEventsScope());
            if (shouldShowUnassignedEvents()) {
                return fetchJson(`/api/mes/oven/events?device_id=${deviceId}&unassigned=1&limit=100`);
            }

            return fetchJson(`/api/mes/oven/events?batch_id=${encodeURIComponent(resolvedSelection.selectedBatch.id)}&scope=${scope}&limit=100`);
        })(),
    ]);

    renderInvestigationSummary(transitsPayload, resolvedSelection);
    renderTransits(transitsPayload, resolvedSelection);
    renderEvents(eventsPayload);
    updateContextBadges(resolvedSelection);
    updateStatusText(resolvedSelection);
}

async function selectGroup(groupKey) {
    selectedGroupKey = groupKey;
    const group = latestGroups.find((item) => item.key === groupKey) || null;
    const fallbackEntry = group ? getDefaultEntryForGroup(group) : null;
    selectedBatchId = fallbackEntry?.id || null;

    const selection = renderFromState();
    if (investigationOpen) {
        await refreshInvestigation(selection);
        return;
    }

    updateStatusText(selection);
}

async function toggleGroup(groupKey) {
    await selectGroup(groupKey);
}

async function selectBatch(
    batchId,
    {
        openDrawer: shouldOpenDrawer = false,
        scrollToEvents: shouldScrollToEvents = false,
        editorScope = null,
    } = {}
) {
    selectedBatchId = Number(batchId);
    const group = latestGroups.find((item) => item.entries.some((entry) => Number(entry.id) === Number(batchId))) || null;
    if (group?.key) {
        selectedGroupKey = group.key;
    }
    if (editorScope === "entry" || editorScope === "kkw") {
        setAdminEditScope(editorScope);
    }
    const selection = renderFromState();
    if (shouldOpenDrawer) {
        openAdminDrawer();
    }

    if (investigationOpen) {
        await refreshInvestigation(selection);
    } else {
        updateStatusText(selection);
    }

    if (shouldScrollToEvents) {
        scrollToEntries();
    }
}

async function loadMesData({ keepSelectedBatch = false } = {}) {
    const deviceId = encodeURIComponent(getDeviceId());
    const kkwNumber = getKkwNumber();
    const kkwQuery = kkwNumber ? `&kkw_number=${encodeURIComponent(kkwNumber)}` : "";
    mesStatus.textContent = "Pobieranie danych...";

    if (!keepSelectedBatch) {
        selectedBatchId = null;
        selectedGroupKey = "";
    }

    const [summaryPayload, batchesPayload] = await Promise.all([
        fetchJson(`/api/mes/oven/summary?device_id=${deviceId}`),
        fetchJson(`/api/mes/oven/batch/history?device_id=${deviceId}${kkwQuery}&limit=100`),
    ]);

    latestSummaryPayload = summaryPayload;
    latestBatchRows = Array.isArray(batchesPayload?.batches) ? batchesPayload.batches : [];

    renderSummary(summaryPayload);
    const selection = renderFromState();
    if (investigationOpen) {
        await refreshInvestigation(selection);
    } else {
        updateStatusText(selection);
    }

    const now = new Date();
    mesUpdatedAt.textContent = `Aktualizacja: ${formatDateTime(now.toISOString())}`;
}

async function resetOpenTransits() {
    const openTransitCount = getOpenTransitCount();
    if (openTransitCount <= 0) {
        throw new Error("Brak otwartych przejsc do resetu.");
    }

    const confirmed = window.confirm(
        `MES widzi ${formatNumber(openTransitCount, " paneli")} jako nadal bedace w piecu. `
        + "Uzyj resetu tylko wtedy, gdy piec jest fizycznie pusty. Czy wykonac reset pieca logicznego?"
    );
    if (!confirmed) {
        return;
    }

    const response = await fetchJson("/api/mes/oven/transits/reset", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            device_id: getDeviceId(),
            reason: "admin_manual_reset",
        }),
    });

    await loadMesData({ keepSelectedBatch: true });
    const affectedLabel = formatAffectedKkwLabels(response.affectedKkws);
    const message = response.resetCount
        ? `Zresetowano ${formatNumber(response.resetCount)} otwartych przejsc.${affectedLabel ? ` Dotyczylo: ${affectedLabel}.` : ""}`
        : "Brak otwartych przejsc do resetu.";
    mesStatus.textContent = message;
    setAdminStatus(message, response.resetCount ? "warning" : "info");
}

async function saveBatchChanges() {
    if (!mesAdminForm?.batchId?.value) {
        throw new Error("Najpierw wybierz KKW do edycji.");
    }

    const scope = getAdminEditScope();
    const body = {
        batch_id: Number(mesAdminForm.batchId.value),
        kkw_number: mesAdminForm.kkwNumber.value.trim(),
        planned_quantity: mesAdminForm.plannedQuantity.value.trim(),
        board_side: mesAdminForm.boardSide.value.trim(),
        order_number: mesAdminForm.orderNumber.value.trim(),
        product_code: mesAdminForm.productCode.value.trim(),
        product_name: mesAdminForm.productName.value.trim(),
        pcs_per_panel: mesAdminForm.pcsPerPanel.value.trim(),
        save_for_product: mesAdminForm.saveForProduct.checked,
        source: "admin_panel",
        scope,
        apply_to_related: scope === "kkw",
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
            ? `${scope === "entry" ? "Zapisano zmiany wejscia." : "Zapisano zmiany KKW."} ${response.warning}`
            : scope === "entry" ? "Zapisano zmiany wejscia." : "Zapisano zmiany KKW.",
        response.warning ? "warning" : "success"
    );
    await loadMesData({ keepSelectedBatch: true });
    openAdminDrawer();
}

async function deleteSelectedBatch() {
    if (!mesAdminForm?.batchId?.value) {
        throw new Error("Najpierw wybierz KKW do usuniecia.");
    }

    const batchId = Number(mesAdminForm.batchId.value);
    const scope = getAdminEditScope();
    const label = scope === "entry"
        ? getSelectedEntryDeleteLabel(batchId)
        : `${mesAdminForm.kkwNumber.value.trim() || `#${batchId}`} (${getBoardSideLabel(mesAdminForm.boardSide.value)})`;
    await deleteBatchById(batchId, label, { deletePulses: false, scope });
}

function getSelectedEntryDeleteLabel(batchId) {
    const selection = resolveSelection(latestGroups);
    if (selection.selectedBatch && selection.selectedGroup && Number(selection.selectedBatch.id) === Number(batchId)) {
        return `${getEntryLabel(selection.selectedGroup, selection.selectedBatch)} / ${selection.selectedGroup.kkwNumber} (${getBoardSideLabel(selection.selectedGroup.boardSide)})`;
    }

    return `Wejscie #${batchId}`;
}

async function deleteBatchById(batchId, kkwNumber = "", { deletePulses = false, scope = "kkw" } = {}) {
    if (!Number.isInteger(batchId) || batchId <= 0) {
        throw new Error("Brakuje ID KKW do usuniecia.");
    }

    const label = kkwNumber || `#${batchId}`;
    const normalizedScope = scope === "entry" ? "entry" : "kkw";
    const confirmed = window.confirm(
        normalizedScope === "entry"
            ? (
                deletePulses
                    ? `Usunac ${label} razem z jego impulsami? Operacja jest nieodwracalna.`
                    : `Usunac ${label}? Impulsy zostana odlaczone od tego wejscia, ale nie beda skasowane.`
            )
            : (
                deletePulses
                    ? `Usunac cale KKW ${label} razem z impulsami wszystkich jego wejsc? Operacja jest nieodwracalna.`
                    : `Usunac cale KKW ${label}? Impulsy zostana odlaczone od wszystkich wejsc tego KKW, ale nie beda skasowane.`
            )
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
            scope: normalizedScope,
        }),
    });

    selectedBatchId = null;
    selectedGroupKey = "";
    selectedPulseIds = new Set();
    updateSelectedPulsesBadge();
    closeAdminDrawer();

    const deletedBatchCount = Number(response.deletedBatchCount || 0);
    const deletedBatchLabel = deletedBatchCount === 1 ? "1 wejscie" : `${formatNumber(deletedBatchCount)} wejsc`;
    setAdminStatus(
        normalizedScope === "entry"
            ? (
                deletePulses
                    ? `Usunieto ${label} oraz ${formatNumber(response.deletedPulses || 0)} impulsow.`
                    : `Usunieto ${label}. Odlaczono ${formatNumber(response.detachedPulses || 0)} impulsow.`
            )
            : (
                deletePulses
                    ? `Usunieto KKW ${label}: ${deletedBatchLabel} oraz ${formatNumber(response.deletedPulses || 0)} impulsow.`
                    : `Usunieto KKW ${label}: ${deletedBatchLabel}. Odlaczono ${formatNumber(response.detachedPulses || 0)} impulsow.`
            ),
        "warning"
    );
    await loadMesData({ keepSelectedBatch: false });
}

async function deleteSelectedBatchAndPulses() {
    if (!mesAdminForm?.batchId?.value) {
        throw new Error("Najpierw wybierz KKW do usuniecia.");
    }

    const batchId = Number(mesAdminForm.batchId.value);
    const scope = getAdminEditScope();
    const label = scope === "entry"
        ? getSelectedEntryDeleteLabel(batchId)
        : `${mesAdminForm.kkwNumber.value.trim() || `#${batchId}`} (${getBoardSideLabel(mesAdminForm.boardSide.value)})`;
    await deleteBatchById(batchId, label, { deletePulses: true, scope });
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

async function manuallyCloseSelectedTransit(transitId) {
    if (!Number.isInteger(Number(transitId)) || Number(transitId) <= 0) {
        throw new Error("Brakuje ID przejscia do recznego domkniecia.");
    }

    const selection = getInvestigationSelection();
    const entryLabel = selection.group && selection.batch
        ? `${selection.entryLabel} / ${selection.group.kkwNumber}`
        : `przejscie #${transitId}`;
    const confirmed = window.confirm(
        `Domknac recznie brakujacy OUT dla ${entryLabel}? `
        + "Ta operacja zaliczy panel jako wyjscie, ale pozostawi slad o utracie sygnalu."
    );
    if (!confirmed) {
        return;
    }

    await fetchJson("/api/mes/oven/transits/manual-close", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            transit_id: transitId,
            reason: "missing_out_manual",
        }),
    });

    setAdminStatus(`Recznie domknieto brakujacy OUT dla ${entryLabel}.`, "warning");
    await loadMesData({ keepSelectedBatch: true });
}

async function assignSelectedPulsesToBatch() {
    const pulseIds = [...selectedPulseIds];
    if (!pulseIds.length) {
        throw new Error("Zaznacz impulsy do przypisania.");
    }

    const batchId = Number(mesAdminForm?.batchId?.value || selectedBatchId);
    if (!Number.isInteger(batchId) || batchId <= 0) {
        throw new Error("Najpierw wybierz wejscie, do ktorego przypisac impulsy.");
    }

    const selection = resolveSelection(latestGroups);
    const entryLabel = selection.selectedGroup && selection.selectedBatch
        ? `${getEntryLabel(selection.selectedGroup, selection.selectedBatch)} / ${selection.selectedGroup.kkwNumber}`
        : `Wejscie #${batchId}`;
    const isUnassignedMode = shouldShowUnassignedEvents();
    const confirmed = window.confirm(
        isUnassignedMode
            ? `Przypisac ${pulseIds.length} zaznaczonych impulsow do ${entryLabel}?`
            : `Przepiac ${pulseIds.length} zaznaczonych impulsow do ${entryLabel}?`
    );
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
            force_reassign: true,
        }),
    });

    selectedPulseIds = new Set();
    updateSelectedPulsesBadge();
    const skippedSuffix = response.skippedCount
        ? ` Pomieto ${formatNumber(response.skippedCount)} impulsow, ktorych nie dalo sie przypisac.`
        : "";
    setAdminStatus(
        `${isUnassignedMode ? "Przypisano" : "Przepieto"} ${formatNumber(response.assigned || 0)} impulsow do ${entryLabel}.${skippedSuffix}`,
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
            setAdminStatus(error.message || "Nie udalo sie zapisac zmian KKW.", "error");
        });
    });
}

if (mesDeleteBatchButton) {
    mesDeleteBatchButton.addEventListener("click", () => {
        void deleteSelectedBatch().catch((error) => {
            setAdminStatus(error.message || "Nie udalo sie usunac KKW MES.", "error");
        });
    });
}

if (mesDeleteBatchWithPulsesButton) {
    mesDeleteBatchWithPulsesButton.addEventListener("click", () => {
        void deleteSelectedBatchAndPulses().catch((error) => {
            setAdminStatus(error.message || "Nie udalo sie usunac KKW i impulsow MES.", "error");
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
        if (shouldShowUnassignedEvents()) {
            diagnosticsMode = false;
            selectedEventsScope = "attributed";
        }
        updateSelectedPulsesBadge();
        updateEventsScopeControls();
        if (investigationOpen) {
            void refreshInvestigation().catch((error) => {
                mesStatus.textContent = error.message || "Blad pobierania sledztwa MES.";
            });
        }
    });
}

if (mesEventsScopeRawButton) {
    mesEventsScopeRawButton.addEventListener("click", () => {
        if (shouldShowUnassignedEvents() || !diagnosticsMode) {
            return;
        }

        selectedEventsScope = "raw";
        updateEventsScopeControls();
        if (investigationOpen) {
            void refreshInvestigation().catch((error) => {
                mesStatus.textContent = error.message || "Blad pobierania sledztwa MES.";
            });
        }
    });
}

if (mesEventsScopeAttributedButton) {
    mesEventsScopeAttributedButton.addEventListener("click", () => {
        if (shouldShowUnassignedEvents()) {
            return;
        }

        selectedEventsScope = "attributed";
        updateEventsScopeControls();
        if (investigationOpen) {
            void refreshInvestigation().catch((error) => {
                mesStatus.textContent = error.message || "Blad pobierania sledztwa MES.";
            });
        }
    });
}

if (mesEventsToggleDiagnosticsButton) {
    mesEventsToggleDiagnosticsButton.addEventListener("click", () => {
        if (shouldShowUnassignedEvents()) {
            return;
        }

        diagnosticsMode = !diagnosticsMode;
        selectedEventsScope = diagnosticsMode ? "raw" : "attributed";
        updateEventsScopeControls();
        if (investigationOpen) {
            void refreshInvestigation().catch((error) => {
                mesStatus.textContent = error.message || "Blad pobierania sledztwa MES.";
            });
        }
    });
}

if (mesJumpActiveButton) {
    mesJumpActiveButton.addEventListener("click", () => {
        const activeBatchId = Number(latestSummaryPayload?.summary?.activeBatch?.id);
        if (!Number.isInteger(activeBatchId) || activeBatchId <= 0) {
            return;
        }

        void selectBatch(activeBatchId).catch((error) => {
            mesStatus.textContent = error.message || "Blad pobierania MES.";
        });
    });
}

if (mesAutoRefreshInput) {
    mesAutoRefreshInput.addEventListener("change", restartMesRefreshTimer);
}

if (mesRefreshButton) {
    mesRefreshButton.addEventListener("click", () => {
        void loadMesData({ keepSelectedBatch: true }).catch((error) => {
            mesStatus.textContent = error.message || "Blad pobierania MES.";
        });
    });
}

if (mesResetTransitsButton) {
    mesResetTransitsButton.addEventListener("click", () => {
        void resetOpenTransits().catch((error) => {
            setAdminStatus(error.message || "Nie udalo sie zresetowac pieca logicznego.", "error");
        });
    });
}

if (mesEventsRefreshButton) {
    mesEventsRefreshButton.addEventListener("click", () => {
        void refreshInvestigation().catch((error) => {
            mesStatus.textContent = error.message || "Blad pobierania sledztwa MES.";
        });
    });
}

if (mesOpenInvestigationButton) {
    mesOpenInvestigationButton.addEventListener("click", () => {
        if (!selectedBatchId) {
            return;
        }

        openInvestigationDrawer();
        void refreshInvestigation().catch((error) => {
            mesStatus.textContent = error.message || "Blad pobierania sledztwa MES.";
        });
    });
}

if (mesInvestigationOverlay) {
    mesInvestigationOverlay.addEventListener("click", () => closeInvestigationDrawer());
}

if (mesInvestigationCloseButton) {
    mesInvestigationCloseButton.addEventListener("click", () => closeInvestigationDrawer());
}

if (mesInvestigationRefreshButton) {
    mesInvestigationRefreshButton.addEventListener("click", () => {
        void refreshInvestigation().catch((error) => {
            mesStatus.textContent = error.message || "Blad pobierania sledztwa MES.";
        });
    });
}

if (mesToggleFiltersButton && mesAdvancedFilters) {
    mesToggleFiltersButton.addEventListener("click", () => {
        mesAdvancedFilters.classList.toggle("hidden");
    });
}

if (mesDeviceIdMirror && mesForm?.elements?.deviceId) {
    mesDeviceIdMirror.addEventListener("input", () => {
        mesForm.elements.deviceId.value = mesDeviceIdMirror.value.trim() || "reflow_1";
    });
}

if (mesAdminOverlay) {
    mesAdminOverlay.addEventListener("click", () => closeAdminDrawer());
}

if (mesAdminCloseButton) {
    mesAdminCloseButton.addEventListener("click", () => closeAdminDrawer());
}

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && investigationOpen) {
        closeInvestigationDrawer();
        return;
    }

    if (event.key === "Escape" && drawerOpen) {
        closeAdminDrawer();
    }
});

window.addEventListener("resize", () => {
    if (drawerOpen) {
        applyAdminDrawerLayout(true);
        return;
    }

    applyAdminDrawerLayout(false);
});

setAdminFormDisabled(true);
if (mesAdminDrawer) {
    mesAdminDrawer.hidden = true;
    applyAdminDrawerLayout(false);
}
if (mesInvestigationDrawer) {
    mesInvestigationDrawer.hidden = true;
    mesInvestigationDrawer.setAttribute("aria-hidden", "true");
}
updateSelectedPulsesBadge();
updateEventsScopeControls();
void loadMesData().catch((error) => {
    mesStatus.textContent = error.message || "Blad pobierania MES.";
});
restartMesRefreshTimer();


