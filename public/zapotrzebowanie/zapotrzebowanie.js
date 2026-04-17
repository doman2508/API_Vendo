const connectionForm = document.getElementById("connection-form");
const saveConnectionButton = document.getElementById("save-connection");
const clearButton = document.getElementById("clear-button");
const statusBadge = document.getElementById("status-badge");
const moduleMeta = document.getElementById("module-meta");
const storageMeta = document.getElementById("storage-meta");
const refreshStorageButton = document.getElementById("refresh-storage");
const viewSwitchButtons = Array.from(document.querySelectorAll("[data-view-switch]"));
const moduleViews = Array.from(document.querySelectorAll("[data-module-view]"));
const viewPanels = Array.from(document.querySelectorAll("[data-view-panel]"));

const operationsSummary = document.getElementById("operations-summary");
const operationsError = document.getElementById("operations-error");
const headersBody = document.getElementById("headers-body");
const headersCount = document.getElementById("headers-count");
const headersTableWrap = document.querySelector(".operations-table-wrap");
const headerSearchInput = document.getElementById("header-search");
const headerStatusFilter = document.getElementById("header-status-filter");
const headerPhaseFilter = document.getElementById("header-phase-filter");
const headerMaterialFilter = document.getElementById("header-material-filter");
const refreshHeadersButton = document.getElementById("refresh-headers");
const resetHeaderFiltersButton = document.getElementById("reset-header-filters");
const headersRefreshStatus = document.getElementById("headers-refresh-status");
const headerDetailSection = document.getElementById("header-detail-section");
const headerDetailTitle = document.getElementById("header-detail-title");
const headerDetailDescription = document.getElementById("header-detail-description");
const headerDetailSummary = document.getElementById("header-detail-summary");
const headerDetailError = document.getElementById("header-detail-error");
const headerDetailSearchInput = document.getElementById("header-detail-search");
const headerDetailCount = document.getElementById("header-detail-count");
const headerDetailBody = document.getElementById("header-detail-body");
const headerDetailCloseButton = document.getElementById("header-detail-close");
const headerNoteViewer = document.getElementById("header-note-viewer");
const headerNoteViewerTitle = document.getElementById("header-note-viewer-title");
const headerNoteViewerMeta = document.getElementById("header-note-viewer-meta");
const headerNoteViewerBody = document.getElementById("header-note-viewer-body");
const headerNoteViewerCloseButton = document.getElementById("header-note-viewer-close");
const vendoPilotForm = document.getElementById("vendo-pilot-form");
const vendoPilotPositionInput = document.getElementById("vendo-pilot-position-id");
const vendoPilotSubmitButton = document.getElementById("vendo-pilot-submit");
const vendoPilotSummary = document.getElementById("vendo-pilot-summary");
const vendoPilotError = document.getElementById("vendo-pilot-error");
const vendoPilotRaw = document.getElementById("vendo-pilot-raw");
const vendoPilotOutput = document.getElementById("vendo-pilot-output");

const zapotrzebowanieForm = document.getElementById("zapotrzebowanie-form");
const submitButton = document.getElementById("zapotrzebowanie-submit");
const reportSummary = document.getElementById("zapotrzebowanie-summary");
const reportErrorBox = document.getElementById("zapotrzebowanie-error");
const resultsBody = document.getElementById("zapotrzebowanie-body");
const rawOutput = document.getElementById("zapotrzebowanie-raw-output");
const resultsSearchInput = document.getElementById("results-search");
const balanceFilter = document.getElementById("balance-filter");
const resultsCount = document.getElementById("results-count");
const resetFiltersButton = document.getElementById("reset-filters");
const exportCsvButton = document.getElementById("export-csv");
const detailSection = document.getElementById("detail-section");
const detailTitle = document.getElementById("detail-title");
const detailDescription = document.getElementById("detail-description");
const detailSummary = document.getElementById("detail-summary");
const detailError = document.getElementById("detail-error");
const detailBody = document.getElementById("detail-body");
const detailCloseButton = document.getElementById("detail-close");

const STORAGE_KEY = "vendo-api-console";
const numberFormatter = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
const dateFormatter = new Intl.DateTimeFormat("pl-PL", { year: "numeric", month: "2-digit", day: "2-digit" });
const dateTimeFormatter = new Intl.DateTimeFormat("pl-PL", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const timeFormatter = new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const OPERATIONAL_AUTO_REFRESH_MS = 90 * 1000;

let activeView = "operations";
let operationalPayload = null;
let operationalDetailPayload = null;
let selectedHeaderId = null;
let selectedDetailKey = "";
let detailRequestToken = 0;
let vendoPilotPayload = null;
let lastReportPayload = null;
let lastStoragePayload = null;
let operationalRefreshPromise = null;
let operationalAutoRefreshTimer = null;
let lastOperationalRefreshAt = null;
let bomNoteSaveInFlight = false;

function formatNumber(value) {
    return numberFormatter.format(Number(value) || 0);
}

function formatOptionalNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? numberFormatter.format(number) : "-";
}

function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : dateFormatter.format(date);
}

function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : dateTimeFormatter.format(date);
}

function formatTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : timeFormatter.format(date);
}

function normalizeText(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function escapeHtml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function truncateText(value, maxLength = 28) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function setStatus(type, text) {
    if (!statusBadge) return;
    statusBadge.className = `status ${type}`;
    statusBadge.textContent = text;
}

async function getJson(url) {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Operacja nie powiodla sie.");
    return data;
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

function loadStoredValues() {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        for (const [key, value] of Object.entries(stored)) {
            const field = connectionForm?.elements.namedItem(key);
            if (field && typeof value === "string") field.value = value;
        }
    } catch {
        localStorage.removeItem(STORAGE_KEY);
    }
}

function saveConnection() {
    if (!connectionForm) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        vendoUserLogin: connectionForm.vendoUserLogin.value.trim(),
        vendoUserPassword: connectionForm.vendoUserPassword.value,
    }));
    setStatus("success", "Zapisane");
    updateOperationalRefreshStatus();
    scheduleOperationalAutoRefresh();
}

function getConnectionPayload() {
    return {
        vendoUserLogin: connectionForm?.vendoUserLogin?.value?.trim() || "",
        vendoUserPassword: connectionForm?.vendoUserPassword?.value || "",
    };
}

function buildSummaryPills(items) {
    return items.map(([label, value]) => `
        <div class="detail-summary-item">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
        </div>
    `).join("");
}

function renderCurrentModuleMeta() {
    if (!moduleMeta) return;
    if (activeView === "operations") {
        moduleMeta.textContent = JSON.stringify({
            module: "Zapotrzebowanie",
            view: "operations",
            overviewEndpoint: "/api/zapotrzebowanie/operational/overview",
            detailEndpoint: "/api/zapotrzebowanie/operational/header-details",
            pilotEndpoint: "/api/zapotrzebowanie/vendo/header-details",
            importEndpoint: "/api/zapotrzebowanie/storage/import-access",
            selectedHeaderId,
            pilotPlanPositionId: vendoPilotPayload?.header?.planPositionId || null,
            pilotBomSource: vendoPilotPayload?.bomSource?.type || null,
            loadedHeaders: operationalPayload?.headers?.length || 0,
            lastImportAt: lastStoragePayload?.meta?.last_access_import_at?.value || null,
            generatedAt: operationalPayload?.meta?.generatedAt || new Date().toISOString(),
        }, null, 2);
        return;
    }

    moduleMeta.textContent = JSON.stringify(lastReportPayload?.meta || {
        module: "Zapotrzebowanie",
        view: "report",
        endpoint: "/api/zapotrzebowanie",
        detailEndpoint: "/api/zapotrzebowanie/details",
        generatedAt: new Date().toISOString(),
    }, null, 2);
}

function renderStorageMeta(storage) {
    if (!storageMeta) return;
    lastStoragePayload = storage || null;
    storageMeta.textContent = JSON.stringify(storage ? {
        dbPath: storage.dbPath,
        counts: storage.counts,
        lastImportAt: storage.meta?.last_access_import_at?.value || null,
        sourcePath: storage.meta?.last_access_source_path?.value || null,
        skippedBomCount: storage.meta?.last_access_skipped_bom_count?.value || "0",
        recentHeaders: storage.recentHeaders || [],
    } : { status: "Brak danych snapshotu" }, null, 2);
}

function setActiveView(view) {
    activeView = view;
    viewSwitchButtons.forEach((button) => button.classList.toggle("active", button.dataset.viewSwitch === view));
    moduleViews.forEach((section) => section.classList.toggle("hidden", section.dataset.moduleView !== view));
    viewPanels.forEach((section) => section.classList.toggle("hidden", section.dataset.viewPanel !== view));
    renderCurrentModuleMeta();
    updateOperationalRefreshStatus();
    scheduleOperationalAutoRefresh();
}

function isHeaderNoteViewerOpen() {
    return Boolean(headerNoteViewer && !headerNoteViewer.classList.contains("hidden"));
}

function getOperationalAutoRefreshBlockReason() {
    if (activeView !== "operations") return "Auto: poza panelem";
    if (document.visibilityState !== "visible") return "Auto: karta ukryta";

    const connection = getConnectionPayload();
    if (!(connection.vendoUserLogin && connection.vendoUserPassword)) {
        return "Auto: brak logowania Vendo";
    }

    if (bomNoteSaveInFlight) return "Auto: zapis uwagi";
    if (isHeaderNoteViewerOpen()) return "Auto: podglad uwagi";
    if (document.activeElement?.closest(".bom-note-editor")) return "Auto: edycja uwagi";

    return "";
}

function updateOperationalRefreshStatus({ loading = false } = {}) {
    if (!headersRefreshStatus) return;

    const blockedReason = getOperationalAutoRefreshBlockReason();
    const sourceLabel = operationalPayload?.meta?.source === "vendo"
        ? "Vendo"
        : (operationalPayload?.meta?.source === "sqlite" ? "SQLite" : "");
    const parts = [];

    if (loading) {
        parts.push("Lista: odswiezam...");
    } else if (blockedReason) {
        parts.push(blockedReason);
    } else {
        parts.push(`Auto: co ${Math.round(OPERATIONAL_AUTO_REFRESH_MS / 1000)} s`);
    }

    if (lastOperationalRefreshAt) {
        parts.push(`Ost.: ${formatTime(lastOperationalRefreshAt)}`);
    }

    if (sourceLabel) {
        parts.push(sourceLabel);
    }

    headersRefreshStatus.textContent = parts.join(" | ");
}

function clearOperationalAutoRefreshTimer() {
    if (operationalAutoRefreshTimer) {
        clearTimeout(operationalAutoRefreshTimer);
        operationalAutoRefreshTimer = null;
    }
}

function scheduleOperationalAutoRefresh() {
    clearOperationalAutoRefreshTimer();

    if (activeView !== "operations") {
        updateOperationalRefreshStatus();
        return;
    }

    operationalAutoRefreshTimer = setTimeout(() => {
        void runOperationalAutoRefresh();
    }, OPERATIONAL_AUTO_REFRESH_MS);

    updateOperationalRefreshStatus();
}

async function runOperationalAutoRefresh() {
    const blockedReason = getOperationalAutoRefreshBlockReason();
    if (blockedReason || operationalRefreshPromise) {
        updateOperationalRefreshStatus();
        scheduleOperationalAutoRefresh();
        return;
    }

    try {
        await loadOperationalOverview({
            preserveSelection: true,
            silentStatus: true,
            forceRefresh: false,
        });
    } catch {
        updateOperationalRefreshStatus();
    }
}

function updateHeadersCount(visibleRows, totalRows) {
    if (headersCount) headersCount.textContent = `Widoczne: ${visibleRows} z ${totalRows}`;
}

function updateResultsCount(visibleRows, totalRows) {
    if (resultsCount) resultsCount.textContent = `Widoczne: ${visibleRows} z ${totalRows}`;
}

function setExportButtonState(isDisabled) {
    if (exportCsvButton) exportCsvButton.disabled = isDisabled;
}

function getStageTone(stageKey) {
    if (stageKey === "CLOSED") return "closed";
    if (stageKey === "PENDING_BOTH") return "pending-both";
    if (stageKey === "PENDING_SMD") return "pending-smd";
    if (stageKey === "PENDING_THT") return "pending-tht";
    if (stageKey === "EXCLUDED_ALL") return "excluded-all";
    return "ready";
}

function renderBoolBadge(value) {
    return `<span class="bool-badge ${value ? "done" : "todo"}">${value ? "Tak" : "Nie"}</span>`;
}

function renderOperationalSummary(payload) {
    const data = payload?.summary || {};
    const isLazySummary = payload?.meta?.summaryMode === "lazy-details";
    operationsSummary.innerHTML = buildSummaryPills([
        ["Naglowki otwarte", data.openHeaders ?? 0],
        ["Liczy SMD", data.pendingSmdHeaders ?? 0],
        ["Liczy THT", data.pendingThtHeaders ?? 0],
        ["Pelny BOM", data.fullBomHeaders ?? data.noScopeHeaders ?? 0],
        ["Bez SMD/THT", data.excludedAllHeaders ?? 0],
        ["Pozycje BOM", isLazySummary ? "po klik." : (data.totalBomItems ?? 0)],
        ["Otwarte BOM", isLazySummary ? "po klik." : (data.openBomItems ?? 0)],
        ["Pozycje z brakami", isLazySummary ? "po klik." : (data.shortageBomItems ?? 0)],
        ["Suma brakow", isLazySummary ? "po klik." : formatNumber(data.shortageQty)],
        ["Klienci", data.activeClients ?? 0],
    ]);
    operationsSummary.classList.remove("hidden");
}

function clearVendoPilotPanel() {
    vendoPilotPayload = null;
    if (vendoPilotSummary) {
        vendoPilotSummary.classList.add("hidden");
        vendoPilotSummary.innerHTML = "";
    }
    if (vendoPilotError) {
        vendoPilotError.classList.add("hidden");
        vendoPilotError.textContent = "";
    }
    if (vendoPilotRaw) vendoPilotRaw.classList.add("hidden");
    if (vendoPilotOutput) vendoPilotOutput.textContent = "Brak danych.";
}

function renderVendoPilotSummary(payload) {
    const header = payload?.header || {};
    const summary = payload?.summary || {};
    const source = payload?.bomSource || {};
    const warnings = Array.isArray(payload?.meta?.warnings) ? payload.meta.warnings.filter(Boolean) : [];

    if (vendoPilotSummary) {
        vendoPilotSummary.innerHTML = buildSummaryPills([
            ["ZLP", header.orderNumber || "-"],
            ["Pozycja ID", header.planPositionId || "-"],
            ["Indeks", header.productCode || header.productIndex || "-"],
            ["Materialy", header.materialOwnershipLabel || header.materialOwnership || "PUSTE"],
            ["Status", header.stageLabel || header.realizationState || "-"],
            ["BOM z", source.label || source.type || "-"],
            ["Pozycje BOM", summary.totalBomItems ?? 0],
            ["Braki", summary.shortageBomItems ?? 0],
            ["Suma To order", formatNumber(summary.shortageQty)],
            ["WMS", formatNumber(summary.wmsStock)],
            ["Vendo", formatNumber(summary.vendoStock)],
        ]);
        vendoPilotSummary.classList.remove("hidden");
    }

    if (vendoPilotError) {
        if (warnings.length) {
            vendoPilotError.textContent = warnings.join(" ");
            vendoPilotError.classList.remove("hidden");
        } else {
            vendoPilotError.classList.add("hidden");
            vendoPilotError.textContent = "";
        }
    }

    if (vendoPilotOutput) vendoPilotOutput.textContent = JSON.stringify(payload, null, 2);
    if (vendoPilotRaw) vendoPilotRaw.classList.remove("hidden");
}

async function loadVendoPilot(event) {
    event?.preventDefault();
    const planPositionId = Number(vendoPilotPositionInput?.value);
    if (!Number.isInteger(planPositionId) || planPositionId <= 0) {
        if (vendoPilotError) {
            vendoPilotError.textContent = "Podaj poprawne ID pozycji ZLP.";
            vendoPilotError.classList.remove("hidden");
        }
        return;
    }

    saveConnection();
    clearVendoPilotPanel();
    if (vendoPilotSubmitButton) vendoPilotSubmitButton.disabled = true;
    setStatus("loading", "Vendo ZLP");
    if (headerDetailSearchInput) headerDetailSearchInput.value = "";

    if (headerDetailSection) headerDetailSection.classList.remove("hidden");
    if (headerDetailTitle) headerDetailTitle.textContent = "Pilot naglowka z Vendo";
    if (headerDetailDescription) headerDetailDescription.textContent = "Ladowanie pozycji ZLP, statusow i materialowki...";
    if (headerDetailCount) headerDetailCount.textContent = "Widoczne: 0 z 0";
    if (headerDetailBody) {
        headerDetailBody.innerHTML = `
            <tr>
                <td colspan="10" class="empty-state">Ladowanie BOM z Vendo...</td>
            </tr>
        `;
    }

    try {
        const payload = await postJson("/api/zapotrzebowanie/vendo/header-details", {
            planPositionId,
            ...getConnectionPayload(),
            materialOwnershipFilter: headerMaterialFilter?.value || "MSX_OR_EMPTY",
        });

        vendoPilotPayload = payload;
        selectedHeaderId = null;
        renderVendoPilotSummary(payload);
        renderHeaderDetails(payload);
        renderOperationalHeaders();
        renderCurrentModuleMeta();
        setStatus("success", "Vendo ZLP");
    } catch (error) {
        if (vendoPilotError) {
            vendoPilotError.textContent = error.message || "Nie udalo sie pobrac pilota z Vendo.";
            vendoPilotError.classList.remove("hidden");
        }
        if (vendoPilotOutput) vendoPilotOutput.textContent = "Blad.";
        if (headerDetailError) {
            headerDetailError.textContent = error.message || "Nie udalo sie pobrac pilota z Vendo.";
            headerDetailError.classList.remove("hidden");
        }
        if (headerDetailBody) {
            headerDetailBody.innerHTML = `
                <tr>
                    <td colspan="10" class="empty-state">Brak BOM z pilota Vendo.</td>
                </tr>
            `;
        }
        renderCurrentModuleMeta();
        setStatus("error", "Vendo");
    } finally {
        if (vendoPilotSubmitButton) vendoPilotSubmitButton.disabled = false;
    }
}

function getFilteredHeaders(headers) {
    const searchTerm = normalizeText(headerSearchInput?.value);
    const statusFilter = headerStatusFilter?.value || "OPEN";
    const phaseFilter = headerPhaseFilter?.value || "ALL";

    return headers.filter((header) => {
        if (statusFilter === "OPEN" && (header.isClosed || !header.includeInDemand)) return false;
        if (statusFilter === "CLOSED" && !header.isClosed) return false;
        if (statusFilter === "SHORTAGE" && (Number(header.shortageBomCount) || 0) <= 0) return false;
        if (phaseFilter !== "ALL" && header.stageKey !== phaseFilter) return false;
        if (!searchTerm) return true;

        const searchable = normalizeText([
            header.kkwNumber,
            header.productIndex,
            header.productName,
            header.clientName,
            header.planningSeries,
            header.stageLabel,
            header.materialOwnershipLabel,
            header.notes,
        ].join(" "));
        return searchable.includes(searchTerm);
    }).sort((left, right) => {
        const leftCreatedAt = Date.parse(left.sourceCreatedAt || left.importedAt || "");
        const rightCreatedAt = Date.parse(right.sourceCreatedAt || right.importedAt || "");
        const leftHasDate = Number.isFinite(leftCreatedAt);
        const rightHasDate = Number.isFinite(rightCreatedAt);

        if (leftHasDate && rightHasDate && leftCreatedAt !== rightCreatedAt) {
            return leftCreatedAt - rightCreatedAt;
        }

        if (leftHasDate !== rightHasDate) {
            return leftHasDate ? -1 : 1;
        }

        return (Number(left.id) || 0) - (Number(right.id) || 0);
    });
}

function clearOperationalDetailPanel({ hide = true, message = "Kliknij indeks produktu w tabeli naglowkow, aby zobaczyc pozycje BOM." } = {}) {
    selectedHeaderId = hide ? null : selectedHeaderId;
    if (hide && headerDetailSearchInput) headerDetailSearchInput.value = "";
    if (headerDetailSection) headerDetailSection.classList.toggle("hidden", hide);
    if (headerDetailTitle) headerDetailTitle.textContent = "Pozycje naglowka";
    if (headerDetailDescription) headerDetailDescription.textContent = message;
    if (headerDetailSummary) {
        headerDetailSummary.classList.add("hidden");
        headerDetailSummary.innerHTML = "";
    }
    if (headerDetailError) {
        headerDetailError.classList.add("hidden");
        headerDetailError.textContent = "";
    }
    if (headerDetailBody) {
        headerDetailBody.innerHTML = `
            <tr>
                <td colspan="10" class="empty-state">${escapeHtml(message)}</td>
            </tr>
        `;
    }
    if (headerDetailCount) {
        headerDetailCount.textContent = "Widoczne: 0 z 0";
    }
    if (headerDetailCloseButton) headerDetailCloseButton.classList.toggle("hidden", hide);
}

function openHeaderNoteViewer(header) {
    const noteText = String(header?.notes || "").trim();
    if (!noteText || !headerNoteViewer) {
        return;
    }

    if (headerNoteViewerTitle) {
        headerNoteViewerTitle.textContent = `Uwagi naglowka ${header?.productIndex || header?.id || ""}`.trim();
    }
    if (headerNoteViewerMeta) {
        headerNoteViewerMeta.textContent = [
            header?.productName || "Pozycja z Vendo",
            `Seria: ${header?.planningSeries || "-"}`,
            `Klient: ${header?.clientName || "-"}`,
            `KKW: ${header?.kkwNumber || "-"}`,
        ].join(" | ");
    }
    if (headerNoteViewerBody) {
        headerNoteViewerBody.textContent = noteText;
    }

    headerNoteViewer.classList.remove("hidden");
    headerNoteViewer.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    updateOperationalRefreshStatus();
}

function closeHeaderNoteViewer() {
    if (!headerNoteViewer) {
        return;
    }

    headerNoteViewer.classList.add("hidden");
    headerNoteViewer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    updateOperationalRefreshStatus();
}

function renderHeaderNoteCell(header) {
    const noteText = String(header?.notes || "").trim();
    if (!noteText) {
        return "-";
    }

    return `
        <button
            type="button"
            class="header-note-button"
            data-header-note
            data-header-id="${escapeHtml(header.id)}"
            title="${escapeHtml(noteText)}"
        >
            ${escapeHtml(truncateText(noteText, 24))}
        </button>
    `;
}

function renderHeadersTable(rows, totalRows) {
    updateHeadersCount(rows.length, totalRows);
    if (!rows.length) {
        headersBody.innerHTML = `
            <tr>
                <td colspan="12" class="empty-state">Brak naglowkow dla wybranych filtrow lub snapshot nie zostal jeszcze zaladowany.</td>
            </tr>
        `;
        if (headersTableWrap) {
            headersTableWrap.scrollTop = 0;
        }
        return;
    }

    headersBody.innerHTML = rows.map((header) => `
        <tr>
            <td>${escapeHtml(formatDate(header.termDate))}</td>
            <td>${escapeHtml(header.kkwNumber || "-")}</td>
            <td>
                <button type="button" class="index-link${selectedHeaderId === header.id ? " active" : ""}" data-header-id="${escapeHtml(header.id)}">
                    ${escapeHtml(header.productIndex || "-")}
                </button>
            </td>
            <td>${escapeHtml(header.productName || "-")}</td>
            <td>${escapeHtml(header.clientName || "-")}</td>
            <td>${escapeHtml(formatNumber(header.orderQty))}</td>
            <td><span class="header-stage ${getStageTone(header.stageKey)}">${escapeHtml(header.stageLabel || "-")}</span></td>
            <td>${header.summaryPending ? "..." : escapeHtml(formatNumber(header.bomCount))}</td>
            <td>${header.summaryPending ? "..." : escapeHtml(formatNumber(header.openBomCount))}</td>
            <td><span class="${Number(header.shortageBomCount) > 0 ? "access-to-order-shortage" : "access-to-order-covered"}">${header.summaryPending ? "..." : escapeHtml(`${formatNumber(header.shortageBomCount)} / ${formatNumber(header.openBomCount)}`)}</span></td>
            <td class="header-note">${renderHeaderNoteCell(header)}</td>
            <td>${escapeHtml(formatDateTime(header.sourceCreatedAt || header.importedAt))}</td>
        </tr>
    `).join("");

    syncHeadersTableViewport();
}

function syncHeadersTableViewport() {
    if (!headersTableWrap) return;

    requestAnimationFrame(() => {
        const selectedTrigger = selectedHeaderId
            ? headersBody.querySelector(`[data-header-id="${String(selectedHeaderId).replace(/"/g, '\\"')}"]`)
            : null;
        const selectedRow = selectedTrigger?.closest("tr");

        if (selectedRow) {
            selectedRow.scrollIntoView({ block: "nearest" });
            return;
        }

        headersTableWrap.scrollTop = headersTableWrap.scrollHeight;
    });
}

function renderOperationalHeaders() {
    const headers = Array.isArray(operationalPayload?.headers) ? operationalPayload.headers : [];
    renderHeadersTable(getFilteredHeaders(headers), headers.length);
}

function updateHeaderSummaryFromDetails(payload) {
    if (!operationalPayload || !Array.isArray(operationalPayload.headers)) return;

    const header = payload?.header || {};
    const summary = payload?.summary || {};
    const targetId = Number(header.id || header.planPositionId);
    if (!Number.isFinite(targetId)) return;

    operationalPayload.headers = operationalPayload.headers.map((item) => {
        if (Number(item.id) !== targetId) return item;

        return {
            ...item,
            bomCount: summary.totalBomItems ?? item.bomCount ?? 0,
            openBomCount: summary.openBomItems ?? item.openBomCount ?? 0,
            shortageBomCount: summary.shortageBomItems ?? item.shortageBomCount ?? 0,
            shortageQty: summary.shortageQty ?? item.shortageQty ?? 0,
            summaryPending: false,
        };
    });
}

function resolveBomNote(item) {
    return [item.note, item.note1, item.note2, item.note3, item.addText1, item.addText2].find((entry) => String(entry || "").trim()) || "-";
}

function canEditBomNote(item) {
    const header = operationalDetailPayload?.header || vendoPilotPayload?.header || {};
    return header.source === "vendo-zlp-position"
        && Number.isInteger(Number(header.planPositionId))
        && Number.isInteger(Number(item?.sourceMaterialId))
        && Number(item.sourceMaterialId) > 0
        && String(item?.sourceType || "").trim();
}

function renderBomNoteCell(item) {
    if (!canEditBomNote(item)) {
        return escapeHtml(resolveBomNote(item));
    }

    return `
        <div class="bom-note-editor"
            data-source-type="${escapeHtml(item.sourceType)}"
            data-source-material-id="${escapeHtml(item.sourceMaterialId)}"
            data-component-code="${escapeHtml(item.componentCode || "")}">
            <input type="text" value="${escapeHtml(item.note || "")}" placeholder="Uwagi">
            <button type="button" class="btn btn-ghost save-bom-note" title="Zapisz uwage">OK</button>
        </div>
    `;
}

function renderHeaderDetailSummary(payload) {
    const header = payload?.header || {};
    const summary = payload?.summary || {};
    headerDetailSummary.innerHTML = buildSummaryPills([
        ["Etap", header.stageLabel || "-"],
        ["Pozycje BOM", summary.totalBomItems ?? 0],
        ["Otwarte", summary.openBomItems ?? 0],
        ["Braki", summary.shortageBomItems ?? 0],
        ["Suma To order", formatNumber(summary.shortageQty)],
        ["Wymagane", formatNumber(summary.requiredQty)],
        ["PCB", summary.pcbItems ?? 0],
        ["SMD / THT", `${summary.smdItems ?? 0} / ${summary.thtItems ?? 0}`],
    ]);
    headerDetailSummary.classList.remove("hidden");
}

function sortBomItemsByToOrder(items) {
    return [...(items || [])].sort((left, right) => {
        const toOrderDelta = (Number(right?.toOrder) || 0) - (Number(left?.toOrder) || 0);
        if (toOrderDelta !== 0) {
            return toOrderDelta;
        }

        const requiredDelta = (Number(right?.requiredQty) || 0) - (Number(left?.requiredQty) || 0);
        if (requiredDelta !== 0) {
            return requiredDelta;
        }

        return String(left?.componentCode || left?.componentName || "")
            .localeCompare(String(right?.componentCode || right?.componentName || ""), "pl");
    });
}

function getFilteredHeaderBomItems(items) {
    const searchTerm = normalizeText(headerDetailSearchInput?.value);
    if (!searchTerm) {
        return [...(items || [])];
    }

    return (items || []).filter((item) => {
        const searchableText = [
            item?.componentCode,
            item?.componentName,
            item?.typeName,
            item?.note,
            item?.note1,
            item?.note2,
            item?.note3,
            item?.addText1,
            item?.addText2,
        ].join(" ");

        return normalizeText(searchableText).includes(searchTerm);
    });
}

function renderHeaderDetailCount(visibleCount, totalCount) {
    if (!headerDetailCount) return;
    headerDetailCount.textContent = `Widoczne: ${visibleCount} z ${totalCount}`;
}

function renderHeaderDetailTable(items, { totalCount = items.length } = {}) {
    renderHeaderDetailCount(items.length, totalCount);

    if (!items.length) {
        const emptyMessage = totalCount > 0
            ? "Brak pozycji BOM po zastosowaniu filtra wyszukiwania."
            : "Brak pozycji BOM dla wybranego naglowka.";
        headerDetailBody.innerHTML = `
            <tr>
                <td colspan="10" class="empty-state">${emptyMessage}</td>
            </tr>
        `;
        return;
    }

    const sortedItems = sortBomItemsByToOrder(items);

    headerDetailBody.innerHTML = sortedItems.map((item) => `
        <tr>
            <td>${escapeHtml(item.componentCode || "-")}</td>
            <td>${escapeHtml(item.componentName || "-")}</td>
            <td>${escapeHtml(item.typeName || "-")}</td>
            <td>${escapeHtml(formatNumber(item.componentQty))}</td>
            <td>${escapeHtml(formatNumber(item.requiredQty))}</td>
            <td>${escapeHtml(formatOptionalNumber(item.totalDemandQty))}</td>
            <td>${escapeHtml(formatNumber(item.wmsStock))}</td>
            <td>${escapeHtml(formatNumber(item.vendoStock))}</td>
            <td class="${item.toOrder > 0 ? "access-to-order-shortage" : (item.toOrder < 0 ? "access-to-order-covered" : "access-to-order-zero")}">${escapeHtml(formatNumber(item.toOrder))}</td>
            <td class="bom-note">${renderBomNoteCell(item)}</td>
        </tr>
    `).join("");
}

function renderHeaderDetails(payload) {
    const header = payload?.header || {};
    const bomItems = Array.isArray(payload?.bomItems) ? payload.bomItems : [];
    const filteredBomItems = getFilteredHeaderBomItems(bomItems);
    const warnings = Array.isArray(payload?.meta?.warnings) ? payload.meta.warnings.filter(Boolean) : [];
    if (headerDetailSection) headerDetailSection.classList.remove("hidden");
    if (headerDetailCloseButton) headerDetailCloseButton.classList.remove("hidden");
    if (headerDetailTitle) headerDetailTitle.textContent = `Pozycje naglowka ${header.productIndex || header.id || ""}`;
    if (headerDetailDescription) {
        const parts = [
            header.productName || "Wybrany naglowek",
            `Seria: ${header.planningSeries || "-"}`,
            `Klient: ${header.clientName || "-"}`,
            `KKW: ${header.kkwNumber || "-"}`,
            `Materialy: ${header.materialOwnershipLabel || header.materialOwnership || "PUSTE"}`,
            `Termin: ${formatDate(header.termDate)}`,
            "WMS i Vendo sa liczone live, a Zap. total zbiera popyt z aktywnych naglowkow.",
        ];
        if (warnings.length) parts.push(`Uwaga: ${warnings.join(" ")}`);
        headerDetailDescription.textContent = parts.join(" | ");
    }
    if (headerDetailError) {
        headerDetailError.classList.add("hidden");
        headerDetailError.textContent = "";
    }
    renderHeaderDetailSummary(payload);
    renderHeaderDetailTable(filteredBomItems, { totalCount: bomItems.length });
}

async function loadOperationalOverview({ preserveSelection = true, silentStatus = false, forceRefresh = false } = {}) {
    if (operationalRefreshPromise) {
        return operationalRefreshPromise;
    }

    operationalRefreshPromise = (async () => {
        operationsError.classList.add("hidden");
        operationsError.textContent = "";
        const connection = getConnectionPayload();
        const canUseVendo = Boolean(connection.vendoUserLogin && connection.vendoUserPassword);
        let fallbackMessage = "";
        if (!silentStatus) {
            setStatus("loading", canUseVendo ? "Vendo" : "SQLite");
        }
        if (refreshHeadersButton) refreshHeadersButton.disabled = true;
        updateOperationalRefreshStatus({ loading: true });

        try {
            let payload = null;
            if (canUseVendo) {
                try {
                    payload = await postJson("/api/zapotrzebowanie/vendo/overview", {
                        ...connection,
                        pageSize: 100,
                        maxPages: 2,
                        includeNoScope: true,
                        materialOwnershipFilter: headerMaterialFilter?.value || "MSX_OR_EMPTY",
                        forceRefresh,
                    });
                } catch (error) {
                    fallbackMessage = `Vendo chwilowo nie zwrocilo dashboardu (${error.message}). Pokazuje snapshot SQLite.`;
                }
            }

            if (!payload) {
                payload = await getJson("/api/zapotrzebowanie/operational/overview");
                payload.meta = {
                    ...(payload.meta || {}),
                    source: "sqlite",
                };
            }

            operationalPayload = payload;
            operationalDetailPayload = null;
            lastOperationalRefreshAt = new Date().toISOString();
            renderOperationalSummary(payload);
            renderOperationalHeaders();
            if (payload.storage?.counts || payload.storage?.meta) renderStorageMeta(payload.storage);

            const hasSelection = preserveSelection && selectedHeaderId && Array.isArray(payload?.headers)
                && payload.headers.some((item) => item.id === selectedHeaderId);

            if (hasSelection) {
                await loadHeaderDetails(selectedHeaderId, { silentStatus: true });
            } else {
                clearOperationalDetailPanel({ hide: true });
            }

            renderCurrentModuleMeta();
            if (fallbackMessage) {
                operationsError.textContent = fallbackMessage;
                operationsError.classList.remove("hidden");
            }
            if (!silentStatus) {
                setStatus("success", payload?.meta?.source === "vendo" ? "Vendo" : "Dashboard");
            }
            return payload;
        } catch (error) {
            operationsSummary.classList.add("hidden");
            operationsSummary.innerHTML = "";
            operationsError.textContent = error.message || "Nie udalo sie pobrac dashboardu operacyjnego.";
            operationsError.classList.remove("hidden");
            headersBody.innerHTML = `
                <tr>
                    <td colspan="12" class="empty-state">Brak danych dashboardu operacyjnego.</td>
                </tr>
            `;
            renderCurrentModuleMeta();
            if (!silentStatus) {
                setStatus("error", "Blad");
            }
            throw error;
        } finally {
            if (refreshHeadersButton) refreshHeadersButton.disabled = false;
            operationalRefreshPromise = null;
            updateOperationalRefreshStatus();
            scheduleOperationalAutoRefresh();
        }
    })();

    return operationalRefreshPromise;
}

async function refreshStorageSnapshot() {
    if (refreshStorageButton) refreshStorageButton.disabled = true;
    setStatus("loading", "Import");

    try {
        const payload = await postJson("/api/zapotrzebowanie/storage/import-access", {});
        renderStorageMeta(payload.storage);
        await loadOperationalOverview({ preserveSelection: false });
        setStatus("success", "SQLite OK");
    } catch (error) {
        operationsError.textContent = error.message || "Nie udalo sie odswiezyc snapshotu z Accessa.";
        operationsError.classList.remove("hidden");
        setStatus("error", "Import");
    } finally {
        if (refreshStorageButton) refreshStorageButton.disabled = false;
    }
}

async function loadHeaderDetails(headerId, { silentStatus = false } = {}) {
    selectedHeaderId = Number(headerId);
    renderOperationalHeaders();
    if (!silentStatus) setStatus("loading", "Naglowek");
    if (headerDetailSearchInput) headerDetailSearchInput.value = "";

    if (headerDetailSection) headerDetailSection.classList.remove("hidden");
    if (headerDetailCloseButton) headerDetailCloseButton.classList.remove("hidden");
    if (headerDetailTitle) headerDetailTitle.textContent = "Pozycje naglowka";
    if (headerDetailDescription) headerDetailDescription.textContent = "Ladowanie pozycji BOM dla wybranego naglowka...";
    if (headerDetailCount) headerDetailCount.textContent = "Widoczne: 0 z 0";
    if (headerDetailSummary) {
        headerDetailSummary.classList.add("hidden");
        headerDetailSummary.innerHTML = "";
    }
    if (headerDetailBody) {
        headerDetailBody.innerHTML = `
            <tr>
                <td colspan="10" class="empty-state">Ladowanie pozycji BOM...</td>
            </tr>
        `;
    }

    try {
        const isVendoSource = operationalPayload?.meta?.source === "vendo";
        const payload = await postJson(
            isVendoSource
                ? "/api/zapotrzebowanie/vendo/header-details"
                : "/api/zapotrzebowanie/operational/header-details",
            {
                ...(isVendoSource ? { planPositionId: selectedHeaderId } : { headerId: selectedHeaderId }),
                ...getConnectionPayload(),
                materialOwnershipFilter: headerMaterialFilter?.value || "MSX_OR_EMPTY",
            }
        );
        operationalDetailPayload = payload;
        vendoPilotPayload = isVendoSource ? payload : null;
        updateHeaderSummaryFromDetails(payload);
        renderHeaderDetails(payload);
        renderOperationalHeaders();
        renderCurrentModuleMeta();
        if (!silentStatus) setStatus("success", isVendoSource ? "Vendo BOM" : "Naglowek");
    } catch (error) {
        if (headerDetailError) {
            headerDetailError.textContent = error.message || "Nie udalo sie pobrac pozycji naglowka.";
            headerDetailError.classList.remove("hidden");
        }
        if (headerDetailBody) {
            headerDetailBody.innerHTML = `
                <tr>
                    <td colspan="10" class="empty-state">Brak pozycji dla wybranego naglowka.</td>
                </tr>
            `;
        }
        if (!silentStatus) setStatus("error", "Naglowek");
    }
}

async function saveBomNote(trigger) {
    const editor = trigger.closest(".bom-note-editor");
    const input = editor?.querySelector("input");
    const header = operationalDetailPayload?.header || vendoPilotPayload?.header || {};
    const planPositionId = Number(header.planPositionId);
    const sourceMaterialId = Number(editor?.dataset.sourceMaterialId);
    const sourceType = String(editor?.dataset.sourceType || "").trim();
    const componentCode = String(editor?.dataset.componentCode || "").trim();

    if (!editor || !input || !Number.isInteger(planPositionId) || !sourceType || !Number.isInteger(sourceMaterialId)) {
        setStatus("error", "Uwagi");
        return;
    }

    trigger.disabled = true;
    bomNoteSaveInFlight = true;
    setStatus("loading", "Uwagi");
    updateOperationalRefreshStatus();

    try {
        const payload = await postJson("/api/zapotrzebowanie/vendo/bom-note", {
            planPositionId,
            sourceType,
            sourceMaterialId,
            componentCode,
            note: input.value,
            ...getConnectionPayload(),
        });
        const targetPayload = operationalDetailPayload || vendoPilotPayload;
        if (Array.isArray(targetPayload?.bomItems)) {
            targetPayload.bomItems = targetPayload.bomItems.map((item) => {
                if (String(item?.sourceType || "") === sourceType && Number(item?.sourceMaterialId) === sourceMaterialId) {
                    return {
                        ...item,
                        note: payload?.note?.note || "",
                        noteUpdatedAt: payload?.note?.updatedAt || null,
                    };
                }

                return item;
            });
        }
        setStatus("success", "Uwagi");
    } catch (error) {
        if (headerDetailError) {
            headerDetailError.textContent = error.message || "Nie udalo sie zapisac uwagi.";
            headerDetailError.classList.remove("hidden");
        }
        setStatus("error", "Uwagi");
    } finally {
        bomNoteSaveInFlight = false;
        trigger.disabled = false;
        updateOperationalRefreshStatus();
    }
}

async function refreshOperationalHeaders() {
    await loadOperationalOverview({
        preserveSelection: true,
        forceRefresh: true,
    });
}

async function resetHeaderFilters() {
    const shouldReload = Boolean(headerMaterialFilter && headerMaterialFilter.value !== "MSX_OR_EMPTY");
    if (headerSearchInput) headerSearchInput.value = "";
    if (headerStatusFilter) headerStatusFilter.value = "OPEN";
    if (headerPhaseFilter) headerPhaseFilter.value = "ALL";
    if (headerMaterialFilter) headerMaterialFilter.value = "MSX_OR_EMPTY";
    if (shouldReload) {
        await loadOperationalOverview({ preserveSelection: false });
        return;
    }
    renderOperationalHeaders();
}

function buildDetailKey(code, rodzaj) {
    return [String(code || "").trim(), String(rodzaj || "").trim()].join("::");
}

function clearDetailPanel({ hide = true, message = "Szczegoly pojawia sie po kliknieciu kodu komponentu." } = {}) {
    selectedDetailKey = "";
    detailRequestToken += 1;
    if (detailSection) detailSection.classList.toggle("hidden", hide);
    if (detailTitle) detailTitle.textContent = "Szczegoly komponentu";
    if (detailDescription) detailDescription.textContent = message;
    if (detailSummary) {
        detailSummary.classList.add("hidden");
        detailSummary.innerHTML = "";
    }
    if (detailError) {
        detailError.classList.add("hidden");
        detailError.textContent = "";
    }
    if (detailBody) {
        detailBody.innerHTML = `
            <tr>
                <td colspan="12" class="empty-state">${escapeHtml(message)}</td>
            </tr>
        `;
    }
    if (detailCloseButton) detailCloseButton.classList.toggle("hidden", hide);
}

function clearResults() {
    lastReportPayload = null;
    reportSummary.classList.add("hidden");
    reportSummary.innerHTML = "";
    reportErrorBox.classList.add("hidden");
    reportErrorBox.textContent = "";
    resultsBody.innerHTML = `
        <tr>
            <td colspan="9" class="empty-state">Jeszcze nie pobrano danych zapotrzebowania.</td>
        </tr>
    `;
    rawOutput.textContent = "Brak danych.";
    updateResultsCount(0, 0);
    setExportButtonState(true);
    clearDetailPanel({ hide: true });
}

function clearConnection() {
    connectionForm?.reset();
    localStorage.removeItem(STORAGE_KEY);
    clearResults();
    renderCurrentModuleMeta();
    setStatus("idle", "Gotowe");
}

function renderReportSummary(payload) {
    const meta = payload?.meta || {};
    const data = payload?.summary || {};
    reportSummary.innerHTML = buildSummaryPills([
        ["Do zamowienia", data.items ?? 0],
        ["Laczny brak", formatNumber(Math.abs(Number(data.toOrder) || 0))],
        ["Wymagane", formatNumber(data.requiredQty)],
        ["WMS zakupy", formatNumber(data.wmsStock)],
        ["Vendo stan", formatNumber(data.vendoStock)],
        ["Vendo oczekiwane", formatNumber(data.vendoExpected)],
        ["Pozycje w raporcie", data.totalItems ?? 0],
        ["Rodzaj", meta.rodzajFilter || "-"],
    ]);
    reportSummary.classList.remove("hidden");
}

function getFilteredReportRows(rows) {
    const balance = balanceFilter?.value || "ALL";
    const searchTerm = normalizeText(resultsSearchInput?.value);

    return rows.filter((row) => {
        const toOrder = Number(row.toOrder) || 0;
        if (balance === "SHORTAGE" && toOrder >= 0) return false;
        if (balance === "ZERO" && toOrder !== 0) return false;
        if (balance === "SURPLUS" && toOrder <= 0) return false;
        if (balance === "COVERED" && toOrder < 0) return false;
        if (!searchTerm) return true;

        const searchable = normalizeText([row.code, row.component, row.rodzaj].join(" "));
        return searchable.includes(searchTerm);
    });
}

function renderReportTable(rows, totalRows) {
    updateResultsCount(rows.length, totalRows);
    if (!rows.length) {
        resultsBody.innerHTML = `
            <tr>
                <td colspan="9" class="empty-state">Brak wynikow dla wybranych filtrow.</td>
            </tr>
        `;
        return;
    }

    resultsBody.innerHTML = rows.map((row) => {
        const toOrder = Number(row.toOrder) || 0;
        const toneClass = toOrder < 0 ? "to-order-shortage" : (toOrder > 0 ? "to-order-covered" : "to-order-zero");
        const detailKey = buildDetailKey(row.code, row.rodzaj);
        const isActive = detailKey === selectedDetailKey;

        return `
            <tr>
                <td>
                    <button type="button" class="index-link${isActive ? " active" : ""}" data-code="${escapeHtml(row.code ?? "")}" data-rodzaj="${escapeHtml(row.rodzaj ?? "")}">
                        ${escapeHtml(row.code ?? "")}
                    </button>
                </td>
                <td>${escapeHtml(row.component ?? "")}</td>
                <td>${escapeHtml(formatNumber(row.requiredQty))}</td>
                <td>${escapeHtml(formatNumber(row.wmsStock))}</td>
                <td>${escapeHtml(formatNumber(row.vendoStock))}</td>
                <td>${escapeHtml(formatNumber(row.vendoExpected))}</td>
                <td>${escapeHtml(row.rodzaj ?? "")}</td>
                <td>${escapeHtml(row.status ?? 0)}</td>
                <td class="to-order ${toneClass}">${escapeHtml(formatNumber(toOrder))}</td>
            </tr>
        `;
    }).join("");
}

function getOverviewRow(code, rodzaj) {
    const rows = Array.isArray(lastReportPayload?.rows) ? lastReportPayload.rows : [];
    return rows.find((row) => String(row?.code || "").trim() === String(code || "").trim() && String(row?.rodzaj || "").trim() === String(rodzaj || "").trim())
        || rows.find((row) => String(row?.code || "").trim() === String(code || "").trim())
        || null;
}

function calculateDetailRows(rows, overviewRow) {
    const availableTotal = (Number(overviewRow?.wmsStock) || 0) + (Number(overviewRow?.vendoStock) || 0) + (Number(overviewRow?.vendoExpected) || 0);
    let runningBalance = availableTotal;

    return rows.map((row) => {
        const requiredQty = Number(row?.requiredQty) || 0;
        const availableBefore = runningBalance;
        const shortageQty = Math.max(requiredQty - Math.max(availableBefore, 0), 0);
        const balanceAfter = availableBefore - requiredQty;
        runningBalance = balanceAfter;
        return { ...row, availableBefore, shortageQty, balanceAfter };
    });
}

function renderDetailSummary(rows, overviewRow) {
    const availableTotal = (Number(overviewRow?.wmsStock) || 0) + (Number(overviewRow?.vendoStock) || 0) + (Number(overviewRow?.vendoExpected) || 0);
    const totalRequired = rows.reduce((sum, row) => sum + (Number(row?.requiredQty) || 0), 0);
    const totalShortage = rows.reduce((sum, row) => sum + (Number(row?.shortageQty) || 0), 0);

    detailSummary.innerHTML = buildSummaryPills([
        ["Otwartych pozycji", rows.length],
        ["Potrzeba razem", formatNumber(totalRequired)],
        ["Dostepne lacznie", formatNumber(availableTotal)],
        ["Laczny brak", formatNumber(totalShortage)],
        ["WMS", formatNumber(overviewRow?.wmsStock)],
        ["Vendo + oczekiwane", formatNumber((Number(overviewRow?.vendoStock) || 0) + (Number(overviewRow?.vendoExpected) || 0))],
    ]);
    detailSummary.classList.remove("hidden");
}

function renderDetailTable(rows) {
    if (!rows.length) {
        detailBody.innerHTML = `
            <tr>
                <td colspan="12" class="empty-state">Brak otwartych pozycji dla wybranego komponentu.</td>
            </tr>
        `;
        return;
    }

    detailBody.innerHTML = rows.map((row) => `
        <tr>
            <td>${escapeHtml(formatDate(row.termDate || row.kkwTermDate))}</td>
            <td>${escapeHtml(row.kkwNumber || "-")}</td>
            <td>${escapeHtml(row.orderNumber || "-")}</td>
            <td>${escapeHtml(row.foreignNumber || "-")}</td>
            <td>${escapeHtml(row.vendoProductCode || row.productIndex || "-")}</td>
            <td>${escapeHtml(row.vendoProductName || row.productName || "-")}</td>
            <td>${escapeHtml(row.clientName || "-")}</td>
            <td>${escapeHtml(formatNumber(row.orderQty))}</td>
            <td>${escapeHtml(formatNumber(row.requiredQty))}</td>
            <td>${escapeHtml(formatNumber(row.availableBefore))}</td>
            <td class="detail-shortage">${escapeHtml(formatNumber(row.shortageQty))}</td>
            <td class="to-order ${row.balanceAfter < 0 ? "to-order-shortage" : (row.balanceAfter > 0 ? "to-order-covered" : "to-order-zero")}">${escapeHtml(formatNumber(row.balanceAfter))}</td>
        </tr>
    `).join("");
}

function renderComponentDetails(overviewRow, payload) {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const calculatedRows = calculateDetailRows(rows, overviewRow);
    const warnings = Array.isArray(payload?.meta?.warnings) ? payload.meta.warnings.filter(Boolean) : [];
    const hasDebugTrace = Boolean(payload?.meta?.debug);
    const availableTotal = (Number(overviewRow?.wmsStock) || 0) + (Number(overviewRow?.vendoStock) || 0) + (Number(overviewRow?.vendoExpected) || 0);

    if (detailSection) detailSection.classList.remove("hidden");
    if (detailCloseButton) detailCloseButton.classList.remove("hidden");
    if (detailTitle) detailTitle.textContent = `Szczegoly komponentu ${overviewRow?.code || ""}`;
    if (detailDescription) {
        const parts = [
            `${overviewRow?.component || "Wybrany komponent"} | rodzaj ${overviewRow?.rodzaj || "-"}.`,
            `Dostepne lacznie przed rozbiciem: ${formatNumber(availableTotal)}.`,
        ];
        if (hasDebugTrace) parts.push("Surowa odpowiedz JSON zawiera trace lookupow Vendo.");
        if (warnings.length) parts.push(`Uwaga: ${warnings.join(" ")}`);
        detailDescription.textContent = parts.join(" ");
    }
    if (detailError) {
        detailError.classList.add("hidden");
        detailError.textContent = "";
    }

    renderDetailSummary(calculatedRows, overviewRow);
    renderDetailTable(calculatedRows);
}

function renderFilteredResults() {
    if (!lastReportPayload || !Array.isArray(lastReportPayload.rows)) {
        updateResultsCount(0, 0);
        setExportButtonState(true);
        return;
    }

    const allRows = Array.isArray(lastReportPayload?.rows) ? lastReportPayload.rows : [];
    const filteredRows = getFilteredReportRows(allRows);
    renderReportTable(filteredRows, allRows.length);
    setExportButtonState(filteredRows.length === 0);
}

function escapeCsvCell(value) {
    const normalized = String(value ?? "").replace(/"/g, "\"\"");
    return /[;"\n\r]/.test(normalized) ? `"${normalized}"` : normalized;
}

function formatCsvNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? String(numeric).replace(".", ",") : "";
}

function buildCsvContent(rows) {
    const headers = ["Kod", "Komponent", "Suma wymagane", "Stan WMS", "Vendo stan", "Vendo oczekiwane", "Rodzaj", "Status", "To order"];
    const lines = rows.map((row) => ([
        row.code,
        row.component,
        formatCsvNumber(row.requiredQty),
        formatCsvNumber(row.wmsStock),
        formatCsvNumber(row.vendoStock),
        formatCsvNumber(row.vendoExpected),
        row.rodzaj,
        formatCsvNumber(row.status),
        formatCsvNumber(row.toOrder),
    ].map(escapeCsvCell).join(";")));

    return `\uFEFF${headers.join(";")}\n${lines.join("\n")}`;
}

function buildExportFileName() {
    const rodzaju = zapotrzebowanieForm?.rodzaj?.value || "ALL";
    const balance = balanceFilter?.value || "ALL";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `zapotrzebowanie-${rodzaju}-${balance}-${timestamp}.csv`;
}

function exportFilteredRows() {
    if (!lastReportPayload || !Array.isArray(lastReportPayload.rows)) return;

    const rows = getFilteredReportRows(lastReportPayload.rows);
    if (!rows.length) {
        setStatus("error", "Brak danych");
        return;
    }

    const csvContent = buildCsvContent(rows);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = buildExportFileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
    setStatus("success", "CSV gotowe");
}

function resetClientFilters() {
    if (resultsSearchInput) resultsSearchInput.value = "";
    if (balanceFilter) balanceFilter.value = "ALL";
    renderFilteredResults();
}

async function loadComponentDetails(code, rodzaj) {
    const overviewRow = getOverviewRow(code, rodzaj);
    if (!overviewRow) return;

    selectedDetailKey = buildDetailKey(overviewRow.code, overviewRow.rodzaj);
    renderFilteredResults();

    const requestToken = detailRequestToken + 1;
    detailRequestToken = requestToken;

    if (detailSection) detailSection.classList.remove("hidden");
    if (detailCloseButton) detailCloseButton.classList.remove("hidden");
    if (detailTitle) detailTitle.textContent = `Szczegoly komponentu ${overviewRow.code || ""}`;
    if (detailDescription) detailDescription.textContent = `Ladowanie rozbicia dla ${overviewRow.component || overviewRow.code || "wybranego komponentu"}...`;
    if (detailSummary) {
        detailSummary.classList.add("hidden");
        detailSummary.innerHTML = "";
    }
    if (detailError) {
        detailError.classList.add("hidden");
        detailError.textContent = "";
    }
    if (detailBody) {
        detailBody.innerHTML = `
            <tr>
                <td colspan="12" class="empty-state">Ladowanie szczegolow komponentu...</td>
            </tr>
        `;
    }

    setStatus("loading", "Szczegoly");

    try {
        const payload = await postJson("/api/zapotrzebowanie/details", {
            code: overviewRow.code,
            rodzaj: overviewRow.rodzaj,
            ...getConnectionPayload(),
        });

        if (requestToken !== detailRequestToken) return;
        rawOutput.textContent = JSON.stringify(payload, null, 2);
        renderComponentDetails(overviewRow, payload);
        renderCurrentModuleMeta();
        setStatus("success", "Szczegoly");
    } catch (error) {
        if (requestToken !== detailRequestToken) return;
        if (detailError) {
            detailError.textContent = error.message || "Nie udalo sie pobrac szczegolow komponentu.";
            detailError.classList.remove("hidden");
        }
        if (detailBody) {
            detailBody.innerHTML = `
                <tr>
                    <td colspan="12" class="empty-state">Brak szczegolow dla wybranego komponentu.</td>
                </tr>
            `;
        }
        setStatus("error", "Blad");
    }
}

if (saveConnectionButton) saveConnectionButton.addEventListener("click", saveConnection);
if (clearButton) clearButton.addEventListener("click", clearConnection);
if (refreshStorageButton) refreshStorageButton.addEventListener("click", refreshStorageSnapshot);
if (headerSearchInput) headerSearchInput.addEventListener("input", renderOperationalHeaders);
if (headerStatusFilter) headerStatusFilter.addEventListener("change", renderOperationalHeaders);
if (headerPhaseFilter) headerPhaseFilter.addEventListener("change", renderOperationalHeaders);
if (headerMaterialFilter) headerMaterialFilter.addEventListener("change", () => loadOperationalOverview({ preserveSelection: true }));
if (refreshHeadersButton) refreshHeadersButton.addEventListener("click", refreshOperationalHeaders);
if (headerDetailSearchInput) {
    headerDetailSearchInput.addEventListener("input", () => {
        if (operationalDetailPayload) {
            renderHeaderDetails(operationalDetailPayload);
            return;
        }

        if (vendoPilotPayload) {
            renderHeaderDetails(vendoPilotPayload);
        }
    });
}
if (resetHeaderFiltersButton) resetHeaderFiltersButton.addEventListener("click", resetHeaderFilters);
if (vendoPilotForm) vendoPilotForm.addEventListener("submit", loadVendoPilot);

if (headersBody) {
    headersBody.addEventListener("click", (event) => {
        const noteTrigger = event.target.closest("[data-header-note]");
        if (noteTrigger) {
            const headers = Array.isArray(operationalPayload?.headers) ? operationalPayload.headers : [];
            const headerId = Number(noteTrigger.dataset.headerId);
            const targetHeader = headers.find((item) => Number(item?.id) === headerId);
            if (targetHeader) {
                openHeaderNoteViewer(targetHeader);
            }
            return;
        }

        const trigger = event.target.closest("[data-header-id]");
        if (trigger) loadHeaderDetails(trigger.dataset.headerId);
    });
}

if (headerNoteViewerCloseButton) {
    headerNoteViewerCloseButton.addEventListener("click", closeHeaderNoteViewer);
}

if (headerNoteViewer) {
    headerNoteViewer.addEventListener("click", (event) => {
        if (event.target.closest("[data-note-viewer-close]")) {
            closeHeaderNoteViewer();
        }
    });
}

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && headerNoteViewer && !headerNoteViewer.classList.contains("hidden")) {
        closeHeaderNoteViewer();
    }
});

document.addEventListener("visibilitychange", () => {
    updateOperationalRefreshStatus();
    scheduleOperationalAutoRefresh();
});

if (headerDetailCloseButton) {
    headerDetailCloseButton.addEventListener("click", () => {
        clearOperationalDetailPanel({ hide: true });
        renderOperationalHeaders();
    });
}

if (headerDetailBody) {
    headerDetailBody.addEventListener("click", (event) => {
        const noteButton = event.target.closest(".save-bom-note");
        if (noteButton) saveBomNote(noteButton);
    });
}

viewSwitchButtons.forEach((button) => {
    button.addEventListener("click", () => setActiveView(button.dataset.viewSwitch));
});

if (balanceFilter) balanceFilter.addEventListener("change", renderFilteredResults);
if (resultsSearchInput) resultsSearchInput.addEventListener("input", renderFilteredResults);
if (resetFiltersButton) resetFiltersButton.addEventListener("click", resetClientFilters);
if (exportCsvButton) exportCsvButton.addEventListener("click", exportFilteredRows);

if (detailCloseButton) {
    detailCloseButton.addEventListener("click", () => {
        clearDetailPanel({ hide: true });
        renderFilteredResults();
    });
}

if (resultsBody) {
    resultsBody.addEventListener("click", (event) => {
        const trigger = event.target.closest(".index-link[data-code]");
        if (trigger) loadComponentDetails(trigger.dataset.code, trigger.dataset.rodzaj);
    });
}

if (zapotrzebowanieForm) {
    zapotrzebowanieForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        saveConnection();
        clearResults();
        setStatus("loading", "Liczenie");
        submitButton.disabled = true;

        try {
            const payload = await postJson("/api/zapotrzebowanie", {
                ...getConnectionPayload(),
                rodzaj: zapotrzebowanieForm.rodzaj.value,
            });

            lastReportPayload = payload;
            rawOutput.textContent = JSON.stringify(payload, null, 2);
            renderReportSummary(payload);
            renderFilteredResults();
            renderCurrentModuleMeta();
            setStatus("success", "Sukces");
        } catch (error) {
            reportErrorBox.textContent = error.message || "Nie udalo sie pobrac zapotrzebowania.";
            reportErrorBox.classList.remove("hidden");
            rawOutput.textContent = "Blad.";
            setStatus("error", "Blad");
        } finally {
            submitButton.disabled = false;
        }
    });
}

loadStoredValues();
clearVendoPilotPanel();
clearResults();
clearOperationalDetailPanel({ hide: true });
renderStorageMeta(null);
setActiveView("operations");
renderCurrentModuleMeta();
setStatus("idle", "Gotowe");
updateOperationalRefreshStatus();
loadOperationalOverview();
