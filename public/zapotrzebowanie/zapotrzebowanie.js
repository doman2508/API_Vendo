const connectionForm = document.getElementById("connection-form");
const saveConnectionButton = document.getElementById("save-connection");
const clearButton = document.getElementById("clear-button");
const vendoConnectionStatus = document.getElementById("vendo-connection-status");
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
const headerDraftFilter = document.getElementById("header-draft-filter");
const refreshHeadersButton = document.getElementById("refresh-headers");
const resetHeaderFiltersButton = document.getElementById("reset-header-filters");
const headersRefreshStatus = document.getElementById("headers-refresh-status");
const headerSelectionToolbar = document.getElementById("header-selection-toolbar");
const headerSelectionCount = document.getElementById("header-selection-count");
const headerSelectionPreviewButton = document.getElementById("header-selection-preview");
const headerSelectionPrintSmdButton = document.getElementById("header-selection-print-smd");
const headerSelectionPrintThtButton = document.getElementById("header-selection-print-tht");
const headerSelectionClearButton = document.getElementById("header-selection-clear");
const headerSortButtons = Array.from(document.querySelectorAll("[data-header-sort]"));
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
const bomComponentViewer = document.getElementById("bom-component-viewer");
const bomComponentViewerTitle = document.getElementById("bom-component-viewer-title");
const bomComponentViewerMeta = document.getElementById("bom-component-viewer-meta");
const bomComponentViewerSummary = document.getElementById("bom-component-viewer-summary");
const bomComponentViewerError = document.getElementById("bom-component-viewer-error");
const bomComponentViewerBody = document.getElementById("bom-component-viewer-body");
const bomComponentViewerCloseButton = document.getElementById("bom-component-viewer-close");
const headerPrintViewer = document.getElementById("header-print-viewer");
const headerPrintViewerTitle = document.getElementById("header-print-viewer-title");
const headerPrintViewerMeta = document.getElementById("header-print-viewer-meta");
const headerPrintViewerSummary = document.getElementById("header-print-viewer-summary");
const headerPrintViewerError = document.getElementById("header-print-viewer-error");
const headerPrintViewerHeadersBody = document.getElementById("header-print-viewer-headers-body");
const headerPrintViewerBomTitle = document.getElementById("header-print-viewer-bom-title");
const headerPrintViewerBomBody = document.getElementById("header-print-viewer-bom-body");
const headerPrintViewerPrintButton = document.getElementById("header-print-viewer-print");
const headerPrintViewerCloseButton = document.getElementById("header-print-viewer-close");
const headerPrintScopeSmdButton = document.getElementById("header-print-scope-smd");
const headerPrintScopeThtButton = document.getElementById("header-print-scope-tht");
const bomZwViewer = document.getElementById("bom-zw-viewer");
const bomZwViewerTitle = document.getElementById("bom-zw-viewer-title");
const bomZwViewerMeta = document.getElementById("bom-zw-viewer-meta");
const bomZwViewerSummary = document.getElementById("bom-zw-viewer-summary");
const bomZwViewerError = document.getElementById("bom-zw-viewer-error");
const bomZwViewerBody = document.getElementById("bom-zw-viewer-body");
const bomZwViewerCloseButton = document.getElementById("bom-zw-viewer-close");
const bomZwDocumentViewer = document.getElementById("bom-zw-document-viewer");
const bomZwDocumentViewerTitle = document.getElementById("bom-zw-document-viewer-title");
const bomZwDocumentViewerMeta = document.getElementById("bom-zw-document-viewer-meta");
const bomZwDocumentViewerSummary = document.getElementById("bom-zw-document-viewer-summary");
const bomZwDocumentViewerError = document.getElementById("bom-zw-document-viewer-error");
const bomZwDocumentViewerBody = document.getElementById("bom-zw-document-viewer-body");
const bomZwDocumentViewerCloseButton = document.getElementById("bom-zw-document-viewer-close");
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
const OPERATIONAL_AUTO_REFRESH_MS = 30 * 60 * 1000;
const NOTE_AUTOSAVE_DELAY_MS = 900;
const noteAutosaveTimers = new WeakMap();

let activeView = "operations";
let operationalPayload = null;
let operationalDetailPayload = null;
let selectedHeaderId = null;
let selectedHeaderIds = new Set();
let selectedBomRowKey = "";
let selectedDetailKey = "";
let detailRequestToken = 0;
let vendoPilotPayload = null;
let lastReportPayload = null;
let lastStoragePayload = null;
let operationalRefreshPromise = null;
let operationalAutoRefreshTimer = null;
let lastOperationalRefreshAt = null;
let bomNoteSaveInFlight = false;
let operationalBomComponentRequestToken = 0;
let headerPrintPreviewRequestToken = 0;
let headerPrintPreviewPayload = null;
let headerPrintPreviewSelectionKey = "";
let headerPrintScope = "SMD";
let operationalBomZwRequestToken = 0;
let operationalBomZwDocumentRequestToken = 0;
let operationalHeaderSort = { key: "sourceCreatedAt", direction: "asc" };

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

function compareOptionalNumbers(leftValue, rightValue) {
    const leftNumber = Number(leftValue);
    const rightNumber = Number(rightValue);
    const leftFinite = Number.isFinite(leftNumber);
    const rightFinite = Number.isFinite(rightNumber);

    if (leftFinite && rightFinite && leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
    }

    if (leftFinite !== rightFinite) {
        return leftFinite ? -1 : 1;
    }

    return 0;
}

function compareOptionalDates(leftValue, rightValue) {
    const leftDate = Date.parse(String(leftValue || ""));
    const rightDate = Date.parse(String(rightValue || ""));
    const leftFinite = Number.isFinite(leftDate);
    const rightFinite = Number.isFinite(rightDate);

    if (leftFinite && rightFinite && leftDate !== rightDate) {
        return leftDate - rightDate;
    }

    if (leftFinite !== rightFinite) {
        return leftFinite ? -1 : 1;
    }

    return 0;
}

function compareOptionalText(leftValue, rightValue) {
    const leftText = String(leftValue || "").trim();
    const rightText = String(rightValue || "").trim();

    if (leftText && rightText) {
        const delta = leftText.localeCompare(rightText, "pl", { numeric: true, sensitivity: "base" });
        if (delta !== 0) {
            return delta;
        }
    }

    if (Boolean(leftText) !== Boolean(rightText)) {
        return leftText ? -1 : 1;
    }

    return 0;
}

function compareHeadersByDefaultOrder(leftHeader, rightHeader) {
    const createdDelta = compareOptionalDates(
        leftHeader?.sourceCreatedAt || leftHeader?.importedAt,
        rightHeader?.sourceCreatedAt || rightHeader?.importedAt
    );
    if (createdDelta !== 0) {
        return createdDelta;
    }

    return (Number(leftHeader?.id) || 0) - (Number(rightHeader?.id) || 0);
}

function compareHeadersBySort(leftHeader, rightHeader) {
    const { key, direction } = operationalHeaderSort;
    let delta = 0;

    switch (key) {
    case "termDate":
        delta = compareOptionalDates(leftHeader?.termDate, rightHeader?.termDate);
        break;
    case "kkwNumber":
        delta = compareOptionalText(leftHeader?.kkwNumber, rightHeader?.kkwNumber);
        break;
    case "productIndex":
        delta = compareOptionalText(leftHeader?.productIndex, rightHeader?.productIndex);
        break;
    case "productName":
        delta = compareOptionalText(leftHeader?.productName, rightHeader?.productName);
        break;
    case "clientName":
        delta = compareOptionalText(leftHeader?.clientName, rightHeader?.clientName);
        break;
    case "orderQty":
        delta = compareOptionalNumbers(leftHeader?.orderQty, rightHeader?.orderQty);
        break;
    case "stageLabel":
        delta = compareOptionalText(leftHeader?.stageLabel, rightHeader?.stageLabel);
        break;
    case "bomCount":
        delta = compareOptionalNumbers(leftHeader?.bomCount, rightHeader?.bomCount);
        break;
    case "openBomCount":
        delta = compareOptionalNumbers(leftHeader?.openBomCount, rightHeader?.openBomCount);
        break;
    case "shortageBomCount":
        delta = compareOptionalNumbers(leftHeader?.shortageBomCount, rightHeader?.shortageBomCount);
        if (delta === 0) {
            delta = compareOptionalNumbers(leftHeader?.openBomCount, rightHeader?.openBomCount);
        }
        break;
    case "notes":
        delta = compareOptionalText(leftHeader?.notes, rightHeader?.notes);
        break;
    case "sourceCreatedAt":
        delta = compareOptionalDates(
            leftHeader?.sourceCreatedAt || leftHeader?.importedAt,
            rightHeader?.sourceCreatedAt || rightHeader?.importedAt
        );
        break;
    default:
        delta = compareHeadersByDefaultOrder(leftHeader, rightHeader);
        break;
    }

    if (direction === "desc") {
        delta *= -1;
    }

    if (delta !== 0) {
        return delta;
    }

    return compareHeadersByDefaultOrder(leftHeader, rightHeader);
}

function isDefaultHeaderSort() {
    return operationalHeaderSort.key === "sourceCreatedAt" && operationalHeaderSort.direction === "asc";
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

    updateConnectionStatusIndicator();
}

function saveConnection() {
    if (!connectionForm) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        vendoUserLogin: connectionForm.vendoUserLogin.value.trim(),
        vendoUserPassword: connectionForm.vendoUserPassword.value,
    }));
    updateConnectionStatusIndicator();
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
    if (view !== "operations") {
        closeHeaderNoteViewer();
        closeBomComponentViewer();
        closeHeaderPrintViewer();
        closeBomZwViewer();
        closeBomZwDocumentViewer();
    }
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

function isBomComponentViewerOpen() {
    return Boolean(bomComponentViewer && !bomComponentViewer.classList.contains("hidden"));
}

function isBomZwViewerOpen() {
    return Boolean(bomZwViewer && !bomZwViewer.classList.contains("hidden"));
}

function isBomZwDocumentViewerOpen() {
    return Boolean(bomZwDocumentViewer && !bomZwDocumentViewer.classList.contains("hidden"));
}

function isReportDetailViewerOpen() {
    return Boolean(detailSection && !detailSection.classList.contains("hidden"));
}

function isHeaderPrintViewerOpen() {
    return Boolean(headerPrintViewer && !headerPrintViewer.classList.contains("hidden"));
}

function syncModalOpenState() {
    const hasOpenModal = isHeaderNoteViewerOpen()
        || isBomComponentViewerOpen()
        || isHeaderPrintViewerOpen()
        || isBomZwViewerOpen()
        || isBomZwDocumentViewerOpen()
        || isReportDetailViewerOpen();
    document.body.classList.toggle("modal-open", hasOpenModal);
    updateOperationalRefreshStatus();
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
    if (isBomComponentViewerOpen()) return "Auto: modal komponentu";
    if (isHeaderPrintViewerOpen()) return "Auto: podglad wydruku";
    if (isBomZwViewerOpen()) return "Auto: modal ZW";
    if (isBomZwDocumentViewerOpen()) return "Auto: pozycje ZW";
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
        parts.push(`Auto: co ${Math.round(OPERATIONAL_AUTO_REFRESH_MS / 60000)} min`);
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
    if (activeView !== "operations") {
        setActiveView("operations");
    }
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
    closeBomComponentViewer();
    closeBomZwViewer();
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
                <td colspan="11" class="empty-state">Ladowanie BOM z Vendo...</td>
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
                    <td colspan="11" class="empty-state">Brak BOM z pilota Vendo.</td>
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
    const draftFilter = headerDraftFilter?.value || "ALL";

    return headers.filter((header) => {
        const isDraft = Boolean(header?.statusFlags?.draft);
        if (statusFilter === "OPEN" && (header.isClosed || !header.includeInDemand)) return false;
        if (statusFilter === "CLOSED" && !header.isClosed) return false;
        if (statusFilter === "SHORTAGE" && (Number(header.shortageBomCount) || 0) <= 0) return false;
        if (phaseFilter !== "ALL" && header.stageKey !== phaseFilter) return false;
        if (draftFilter === "ONLY" && !isDraft) return false;
        if (draftFilter === "HIDE" && isDraft) return false;
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
    }).sort(compareHeadersBySort);
}

function buildSelectedHeadersKey(ids) {
    return [...new Set((ids || [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0))]
        .sort((left, right) => left - right)
        .join("::");
}

function getSelectedOperationalHeaders() {
    const headers = Array.isArray(operationalPayload?.headers) ? operationalPayload.headers : [];
    return headers
        .filter((header) => selectedHeaderIds.has(Number(header?.id)))
        .sort(compareHeadersBySort);
}

function invalidateHeaderPrintPreview({ closeViewer = false } = {}) {
    headerPrintPreviewPayload = null;
    headerPrintPreviewSelectionKey = "";
    if (closeViewer) {
        closeHeaderPrintViewer();
    }
}

function syncSelectedHeaderIdsWithHeaders(headers) {
    const availableIds = new Set((headers || [])
        .map((item) => Number(item?.id))
        .filter((value) => Number.isFinite(value) && value > 0));
    const nextSelectedIds = new Set(
        [...selectedHeaderIds].filter((value) => availableIds.has(Number(value)))
    );
    const changed = buildSelectedHeadersKey([...nextSelectedIds]) !== buildSelectedHeadersKey([...selectedHeaderIds]);
    selectedHeaderIds = nextSelectedIds;
    if (changed) {
        invalidateHeaderPrintPreview({ closeViewer: true });
    }
    updateHeaderSelectionToolbar();
}

function updateHeaderSelectionToolbar() {
    const selectedCount = selectedHeaderIds.size;
    if (headerSelectionCount) {
        headerSelectionCount.textContent = `Zaznaczone: ${selectedCount}`;
    }
    if (headerSelectionToolbar) {
        headerSelectionToolbar.classList.toggle("hidden", selectedCount === 0);
    }
    if (headerSelectionPreviewButton) {
        headerSelectionPreviewButton.disabled = selectedCount === 0;
    }
    if (headerSelectionPrintSmdButton) {
        headerSelectionPrintSmdButton.disabled = selectedCount === 0;
    }
    if (headerSelectionPrintThtButton) {
        headerSelectionPrintThtButton.disabled = selectedCount === 0;
    }
    if (headerSelectionClearButton) {
        headerSelectionClearButton.disabled = selectedCount === 0;
    }
}

function normalizeHeaderPrintScope(scope) {
    return String(scope || "").trim().toUpperCase() === "THT" ? "THT" : "SMD";
}

function getHeaderPrintScopeLabel(scope) {
    return normalizeHeaderPrintScope(scope) === "THT" ? "THT" : "SMD + PCB";
}

function getHeaderPrintButtonLabel(scope) {
    return normalizeHeaderPrintScope(scope) === "THT" ? "Drukuj THT" : "Drukuj SMD";
}

function updateHeaderPrintScopeButtons() {
    const normalizedScope = normalizeHeaderPrintScope(headerPrintScope);
    if (headerPrintScopeSmdButton) {
        const isActive = normalizedScope === "SMD";
        headerPrintScopeSmdButton.classList.toggle("is-active", isActive);
        headerPrintScopeSmdButton.setAttribute("aria-pressed", isActive ? "true" : "false");
    }
    if (headerPrintScopeThtButton) {
        const isActive = normalizedScope === "THT";
        headerPrintScopeThtButton.classList.toggle("is-active", isActive);
        headerPrintScopeThtButton.setAttribute("aria-pressed", isActive ? "true" : "false");
    }
}

function setHeaderPrintScope(scope, { rerender = true } = {}) {
    const normalizedScope = normalizeHeaderPrintScope(scope);
    if (headerPrintScope === normalizedScope && !rerender) {
        return;
    }
    headerPrintScope = normalizedScope;
    updateHeaderPrintScopeButtons();
    if (rerender && headerPrintPreviewPayload && isHeaderPrintViewerOpen()) {
        renderHeaderPrintViewerContent(headerPrintPreviewPayload, headerPrintScope);
    }
}

function toggleHeaderSelection(headerId, isSelected) {
    const normalizedId = Number(headerId);
    if (!Number.isFinite(normalizedId) || normalizedId <= 0) {
        return;
    }

    if (isSelected) {
        selectedHeaderIds.add(normalizedId);
    } else {
        selectedHeaderIds.delete(normalizedId);
    }

    invalidateHeaderPrintPreview({ closeViewer: true });
    updateHeaderSelectionToolbar();
    renderOperationalHeaders();
}

function clearSelectedHeaders() {
    if (!selectedHeaderIds.size) {
        return;
    }

    selectedHeaderIds = new Set();
    invalidateHeaderPrintPreview({ closeViewer: true });
    updateHeaderSelectionToolbar();
    renderOperationalHeaders();
}

function clearOperationalDetailPanel({ hide = true, message = "Kliknij rekord w tabeli naglowkow, aby zobaczyc pozycje BOM." } = {}) {
    closeBomComponentViewer();
    closeHeaderPrintViewer();
    closeBomZwViewer();
    selectedHeaderId = hide ? null : selectedHeaderId;
    selectedBomRowKey = "";
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
                <td colspan="11" class="empty-state">${escapeHtml(message)}</td>
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
    syncModalOpenState();
}

function closeHeaderNoteViewer() {
    if (!headerNoteViewer) {
        return;
    }

    headerNoteViewer.classList.add("hidden");
    headerNoteViewer.setAttribute("aria-hidden", "true");
    syncModalOpenState();
}

function closeBomComponentViewer() {
    operationalBomComponentRequestToken += 1;
    if (!bomComponentViewer) {
        return;
    }

    bomComponentViewer.classList.add("hidden");
    bomComponentViewer.setAttribute("aria-hidden", "true");
    if (bomComponentViewerSummary) {
        bomComponentViewerSummary.classList.add("hidden");
        bomComponentViewerSummary.innerHTML = "";
    }
    if (bomComponentViewerError) {
        bomComponentViewerError.classList.add("hidden");
        bomComponentViewerError.textContent = "";
    }
    if (bomComponentViewerBody) {
        bomComponentViewerBody.innerHTML = `
            <tr>
                <td colspan="12" class="empty-state">Kliknij kod komponentu w pozycjach BOM, aby zobaczyc rozbicie.</td>
            </tr>
        `;
    }
    syncModalOpenState();
}

function closeBomZwViewer() {
    operationalBomZwRequestToken += 1;
    closeBomZwDocumentViewer();
    if (!bomZwViewer) {
        return;
    }

    bomZwViewer.classList.add("hidden");
    bomZwViewer.setAttribute("aria-hidden", "true");
    if (bomZwViewerSummary) {
        bomZwViewerSummary.classList.add("hidden");
        bomZwViewerSummary.innerHTML = "";
    }
    if (bomZwViewerError) {
        bomZwViewerError.classList.add("hidden");
        bomZwViewerError.textContent = "";
    }
    if (bomZwViewerBody) {
        bomZwViewerBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">Kliknij wartosc w kolumnie ZW, aby zobaczyc szczegoly dokumentow.</td>
            </tr>
        `;
    }
    syncModalOpenState();
}

function closeBomZwDocumentViewer() {
    operationalBomZwDocumentRequestToken += 1;
    if (!bomZwDocumentViewer) {
        return;
    }

    bomZwDocumentViewer.classList.add("hidden");
    bomZwDocumentViewer.setAttribute("aria-hidden", "true");
    if (bomZwDocumentViewerSummary) {
        bomZwDocumentViewerSummary.classList.add("hidden");
        bomZwDocumentViewerSummary.innerHTML = "";
    }
    if (bomZwDocumentViewerError) {
        bomZwDocumentViewerError.classList.add("hidden");
        bomZwDocumentViewerError.textContent = "";
    }
    if (bomZwDocumentViewerBody) {
        bomZwDocumentViewerBody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">Kliknij numer ZW, aby zobaczyc wszystkie pozycje dokumentu.</td>
            </tr>
        `;
    }
    syncModalOpenState();
}

function buildOperationalComponentOverviewRow(item, payload) {
    return {
        code: payload?.componentCode || item?.componentCode || "",
        component: payload?.componentName || item?.componentName || "",
        rodzaj: payload?.typeName || item?.typeName || "",
        wmsStock: Number(payload?.inventory?.wmsStock) || 0,
        vendoStock: Number(payload?.inventory?.vendoStock) || 0,
        vendoExpected: Number(payload?.inventory?.vendoExpected) || 0,
    };
}

function updateConnectionStatusIndicator() {
    if (!vendoConnectionStatus) return;

    const { vendoUserLogin, vendoUserPassword } = getConnectionPayload();
    const hasLogin = Boolean(vendoUserLogin);
    const hasPassword = Boolean(vendoUserPassword);

    vendoConnectionStatus.classList.remove("is-connected", "is-partial", "is-disconnected");

    if (hasLogin && hasPassword) {
        vendoConnectionStatus.classList.add("is-connected");
        vendoConnectionStatus.textContent = `Vendo: ${vendoUserLogin}`;
        return;
    }

    if (hasLogin || hasPassword) {
        vendoConnectionStatus.classList.add("is-partial");
        vendoConnectionStatus.textContent = "Vendo: uzupelnij logowanie";
        return;
    }

    vendoConnectionStatus.classList.add("is-disconnected");
    vendoConnectionStatus.textContent = "Vendo: brak logowania";
}

function updateHeaderSortButtons() {
    headerSortButtons.forEach((button) => {
        const sortKey = String(button.dataset.headerSort || "");
        const isActive = operationalHeaderSort.key === sortKey;
        const direction = isActive ? operationalHeaderSort.direction : "";
        const indicator = button.querySelector(".sort-indicator");

        button.classList.toggle("is-active", isActive);
        button.dataset.sortDirection = direction;
        button.setAttribute("aria-pressed", isActive ? "true" : "false");

        if (indicator) {
            indicator.textContent = direction === "asc" ? "▲" : direction === "desc" ? "▼" : "↕";
        }
    });
}

function setHeaderSort(sortKey) {
    const normalizedKey = String(sortKey || "").trim();
    if (!normalizedKey) {
        return;
    }

    if (operationalHeaderSort.key === normalizedKey) {
        operationalHeaderSort = {
            key: normalizedKey,
            direction: operationalHeaderSort.direction === "asc" ? "desc" : "asc",
        };
    } else {
        operationalHeaderSort = {
            key: normalizedKey,
            direction: "asc",
        };
    }

    updateHeaderSortButtons();
    renderOperationalHeaders();
}

function renderBomComponentViewerSummary(rows, overviewRow) {
    if (!bomComponentViewerSummary) return;
    const availableTotal = (Number(overviewRow?.wmsStock) || 0) + (Number(overviewRow?.vendoStock) || 0) + (Number(overviewRow?.vendoExpected) || 0);
    const totalRequired = rows.reduce((sum, row) => sum + (Number(row?.requiredQty) || 0), 0);
    const totalShortage = rows.reduce((sum, row) => sum + (Number(row?.shortageQty) || 0), 0);

    bomComponentViewerSummary.innerHTML = buildSummaryPills([
        ["Otwartych pozycji", rows.length],
        ["Potrzeba razem", formatNumber(totalRequired)],
        ["Dostepne lacznie", formatNumber(availableTotal)],
        ["Laczny brak", formatNumber(totalShortage)],
        ["WMS", formatNumber(overviewRow?.wmsStock)],
        ["Vendo", formatNumber(overviewRow?.vendoStock)],
    ]);
    bomComponentViewerSummary.classList.remove("hidden");
}

function renderBomComponentViewerTable(rows) {
    if (!bomComponentViewerBody) return;
    if (!rows.length) {
        bomComponentViewerBody.innerHTML = `
            <tr>
                <td colspan="12" class="empty-state">Brak otwartych pozycji dla wybranego komponentu.</td>
            </tr>
        `;
        return;
    }

    bomComponentViewerBody.innerHTML = rows.map((row) => `
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

function renderBomComponentViewerContent(item, payload) {
    const overviewRow = buildOperationalComponentOverviewRow(item, payload);
    const rows = calculateDetailRows(Array.isArray(payload?.rows) ? payload.rows : [], overviewRow);
    const warnings = Array.isArray(payload?.meta?.warnings) ? payload.meta.warnings.filter(Boolean) : [];

    if (bomComponentViewerTitle) {
        bomComponentViewerTitle.textContent = `Rozbicie komponentu ${overviewRow.code || ""}`.trim();
    }
    if (bomComponentViewerMeta) {
        const parts = [
            overviewRow.component || "Wybrany komponent",
            `Rodzaj: ${overviewRow.rodzaj || "-"}`,
            `Materialy: ${headerMaterialFilter?.selectedOptions?.[0]?.textContent || "MSX + puste"}`,
            "Aktywne naglowki Vendo.",
        ];
        if (warnings.length) {
            parts.push(`Uwaga: ${warnings.join(" ")}`);
        }
        bomComponentViewerMeta.textContent = parts.join(" | ");
    }
    if (bomComponentViewerError) {
        bomComponentViewerError.classList.add("hidden");
        bomComponentViewerError.textContent = "";
    }

    renderBomComponentViewerSummary(rows, overviewRow);
    renderBomComponentViewerTable(rows);
}

async function loadBomComponentViewer(item) {
    const componentCode = String(item?.componentCode || "").trim();
    if (!componentCode || !bomComponentViewer) {
        return;
    }

    const requestToken = operationalBomComponentRequestToken + 1;
    operationalBomComponentRequestToken = requestToken;
    const connection = getConnectionPayload();

    bomComponentViewer.classList.remove("hidden");
    bomComponentViewer.setAttribute("aria-hidden", "false");
    if (bomComponentViewerTitle) {
        bomComponentViewerTitle.textContent = `Rozbicie komponentu ${componentCode}`;
    }
    if (bomComponentViewerMeta) {
        bomComponentViewerMeta.textContent = `Ladowanie rozbicia dla ${item?.componentName || componentCode}...`;
    }
    if (bomComponentViewerSummary) {
        bomComponentViewerSummary.classList.add("hidden");
        bomComponentViewerSummary.innerHTML = "";
    }
    if (bomComponentViewerError) {
        bomComponentViewerError.classList.add("hidden");
        bomComponentViewerError.textContent = "";
    }
    if (bomComponentViewerBody) {
        bomComponentViewerBody.innerHTML = `
            <tr>
                <td colspan="12" class="empty-state">Ladowanie rozbicia komponentu...</td>
            </tr>
        `;
    }
    syncModalOpenState();

    if (!(connection.vendoUserLogin && connection.vendoUserPassword)) {
        if (bomComponentViewerError) {
            bomComponentViewerError.textContent = "Brakuje loginu lub hasla Vendo. Zapisz logowanie, aby otworzyc modal komponentu.";
            bomComponentViewerError.classList.remove("hidden");
        }
        if (bomComponentViewerBody) {
            bomComponentViewerBody.innerHTML = `
                <tr>
                    <td colspan="12" class="empty-state">Brakuje logowania Vendo do pobrania rozbicia komponentu.</td>
                </tr>
            `;
        }
        setStatus("error", "Vendo");
        return;
    }

    setStatus("loading", "Komponent");

    try {
        const payload = await postJson("/api/zapotrzebowanie/vendo/component-details", {
            code: componentCode,
            materialOwnershipFilter: headerMaterialFilter?.value || "MSX_OR_EMPTY",
            ...connection,
        });

        if (requestToken !== operationalBomComponentRequestToken) return;
        renderBomComponentViewerContent(item, payload);
        renderCurrentModuleMeta();
        setStatus("success", "Komponent");
    } catch (error) {
        if (requestToken !== operationalBomComponentRequestToken) return;
        if (bomComponentViewerError) {
            bomComponentViewerError.textContent = error.message || "Nie udalo sie pobrac rozbicia komponentu.";
            bomComponentViewerError.classList.remove("hidden");
        }
        if (bomComponentViewerBody) {
            bomComponentViewerBody.innerHTML = `
                <tr>
                    <td colspan="12" class="empty-state">Brak rozbicia dla wybranego komponentu.</td>
                </tr>
            `;
        }
        setStatus("error", "Komponent");
    }
}

function renderBomZwViewerSummary(payload) {
    if (!bomZwViewerSummary) return;

    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const totalQty = Number(payload?.totalQty) || rows.reduce((sum, row) => sum + (Number(row?.qty) || 0), 0);
    const uniqueSuppliers = new Set(rows.map((row) => String(row?.supplierName || "").trim()).filter(Boolean));
    const unitCode = payload?.unitCode || rows.find((row) => String(row?.unitCode || "").trim())?.unitCode || "-";

    bomZwViewerSummary.innerHTML = buildSummaryPills([
        ["Dokumenty ZW", rows.length],
        ["Suma ZW", formatNumber(totalQty)],
        ["Dostawcy", uniqueSuppliers.size],
        ["Jedn.", unitCode],
    ]);
    bomZwViewerSummary.classList.remove("hidden");
}

function renderBomZwViewerTable(rows) {
    if (!bomZwViewerBody) return;
    if (!rows.length) {
        bomZwViewerBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">Brak oczekiwanych dokumentow ZW dla wybranego indeksu.</td>
            </tr>
        `;
        return;
    }

    const sortedRows = [...rows].sort((left, right) => {
        const leftExpected = Date.parse(left?.expectedDate || left?.date1 || "");
        const rightExpected = Date.parse(right?.expectedDate || right?.date1 || "");
        if (Number.isFinite(leftExpected) && Number.isFinite(rightExpected) && leftExpected !== rightExpected) {
            return leftExpected - rightExpected;
        }

        const leftCreated = Date.parse(left?.createdAt || left?.date2 || "");
        const rightCreated = Date.parse(right?.createdAt || right?.date2 || "");
        if (Number.isFinite(leftCreated) && Number.isFinite(rightCreated) && leftCreated !== rightCreated) {
            return rightCreated - leftCreated;
        }

        return String(left?.documentNumber || "").localeCompare(String(right?.documentNumber || ""), "pl");
    });

    bomZwViewerBody.innerHTML = sortedRows.map((row) => `
        <tr>
            <td>${escapeHtml(formatDate(row.createdAt))}</td>
            <td>${escapeHtml(row.supplierName || "-")}</td>
            <td>
                ${Number(row.documentId) > 0
                    ? `
                        <button
                            type="button"
                            class="zw-link"
                            data-zw-document-id="${escapeHtml(row.documentId)}"
                            data-zw-document-number="${escapeHtml(row.documentNumber || "")}"
                            title="Pokaz wszystkie pozycje tego ZW"
                        >
                            ${escapeHtml(row.documentNumber || "-")}
                        </button>
                    `
                    : escapeHtml(row.documentNumber || "-")}
            </td>
            <td>${escapeHtml(formatOptionalNumber(row.qty))}</td>
            <td>${escapeHtml(row.unitCode || "-")}</td>
            <td>${escapeHtml(formatDate(row.expectedDate))}</td>
            <td>${escapeHtml(row.notes || "-")}</td>
            <td>${escapeHtml(formatDate(row.date1))}</td>
        </tr>
    `).join("");
}

  function renderBomZwViewerContent(item, payload) {
      const rows = Array.isArray(payload?.rows) ? payload.rows : [];
      const warnings = Array.isArray(payload?.meta?.warnings) ? payload.meta.warnings.filter(Boolean) : [];
      const componentCode = payload?.componentCode || item?.componentCode || "";
      const componentName = payload?.componentName || item?.componentName || "Wybrany indeks";
      const typeName = item?.typeName || item?.rodzaj || "-";

    if (bomZwViewerTitle) {
        bomZwViewerTitle.textContent = `Szczegoly ZW ${componentCode}`.trim();
    }
     if (bomZwViewerMeta) {
         const parts = [
             componentName,
             `Rodzaj: ${typeName}`,
             `Materialy: ${headerMaterialFilter?.selectedOptions?.[0]?.textContent || "MSX + puste"}`,
             "Oczekiwane z dokumentow ZW w Vendo.",
         ];
        if (warnings.length) {
            parts.push(`Uwaga: ${warnings.join(" ")}`);
        }
        bomZwViewerMeta.textContent = parts.join(" | ");
    }
    if (bomZwViewerError) {
        bomZwViewerError.classList.add("hidden");
        bomZwViewerError.textContent = "";
    }

    renderBomZwViewerSummary(payload);
    renderBomZwViewerTable(rows);
}

function renderBomZwDocumentViewerSummary(payload) {
    if (!bomZwDocumentViewerSummary) return;

    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const totalQty = Number(payload?.totalQty) || rows.reduce((sum, row) => sum + (Number(row?.qty) || 0), 0);
    const unitCodes = [...new Set(rows.map((row) => String(row?.unitCode || "").trim()).filter(Boolean))];

    bomZwDocumentViewerSummary.innerHTML = buildSummaryPills([
        ["Pozycje", rows.length],
        ["Suma ilosci", formatNumber(totalQty)],
        ["Jedn.", unitCodes.join(", ") || "-"],
    ]);
    bomZwDocumentViewerSummary.classList.remove("hidden");
}

function renderBomZwDocumentViewerTable(rows) {
    if (!bomZwDocumentViewerBody) return;
    if (!rows.length) {
        bomZwDocumentViewerBody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">Brak pozycji na wybranym dokumencie ZW.</td>
            </tr>
        `;
        return;
    }

    bomZwDocumentViewerBody.innerHTML = rows.map((row) => `
        <tr>
            <td>${escapeHtml(row.productCode || "-")}</td>
            <td>${escapeHtml(row.productName || "-")}</td>
            <td>${escapeHtml(formatOptionalNumber(row.qty))}</td>
            <td>${escapeHtml(row.unitCode || "-")}</td>
            <td>${escapeHtml(formatDate(row.expectedDate))}</td>
            <td>${escapeHtml(row.notes || "-")}</td>
        </tr>
    `).join("");
}

function renderBomZwDocumentViewerContent(payload) {
    const warnings = Array.isArray(payload?.meta?.warnings) ? payload.meta.warnings.filter(Boolean) : [];

    if (bomZwDocumentViewerTitle) {
        bomZwDocumentViewerTitle.textContent = `Pozycje ${payload?.documentNumber || "ZW"}`.trim();
    }
    if (bomZwDocumentViewerMeta) {
        const parts = [
            `Dostawca: ${payload?.supplierName || "-"}`,
            `Data dostawy: ${formatDate(payload?.deliveryDate)}`,
            `Data wystawienia: ${formatDate(payload?.issueDate || payload?.createdAt)}`,
        ];
        if (warnings.length) {
            parts.push(`Uwaga: ${warnings.join(" ")}`);
        }
        bomZwDocumentViewerMeta.textContent = parts.join(" | ");
    }
    if (bomZwDocumentViewerError) {
        bomZwDocumentViewerError.classList.add("hidden");
        bomZwDocumentViewerError.textContent = "";
    }

    renderBomZwDocumentViewerSummary(payload);
    renderBomZwDocumentViewerTable(Array.isArray(payload?.rows) ? payload.rows : []);
}

async function loadBomZwDocumentViewer(documentId, documentNumber = "") {
    const normalizedDocumentId = Number(documentId);
    if (!Number.isInteger(normalizedDocumentId) || normalizedDocumentId <= 0 || !bomZwDocumentViewer) {
        return;
    }

    const requestToken = operationalBomZwDocumentRequestToken + 1;
    operationalBomZwDocumentRequestToken = requestToken;
    const connection = getConnectionPayload();

    bomZwDocumentViewer.classList.remove("hidden");
    bomZwDocumentViewer.setAttribute("aria-hidden", "false");
    if (bomZwDocumentViewerTitle) {
        bomZwDocumentViewerTitle.textContent = `Pozycje ${documentNumber || "ZW"}`.trim();
    }
    if (bomZwDocumentViewerMeta) {
        bomZwDocumentViewerMeta.textContent = `Ladowanie pozycji dokumentu ${documentNumber || normalizedDocumentId}...`;
    }
    if (bomZwDocumentViewerSummary) {
        bomZwDocumentViewerSummary.classList.add("hidden");
        bomZwDocumentViewerSummary.innerHTML = "";
    }
    if (bomZwDocumentViewerError) {
        bomZwDocumentViewerError.classList.add("hidden");
        bomZwDocumentViewerError.textContent = "";
    }
    if (bomZwDocumentViewerBody) {
        bomZwDocumentViewerBody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">Ladowanie pozycji dokumentu ZW...</td>
            </tr>
        `;
    }
    syncModalOpenState();

    if (!(connection.vendoUserLogin && connection.vendoUserPassword)) {
        if (bomZwDocumentViewerError) {
            bomZwDocumentViewerError.textContent = "Brakuje loginu lub hasla Vendo. Zapisz logowanie, aby otworzyc pozycje ZW.";
            bomZwDocumentViewerError.classList.remove("hidden");
        }
        if (bomZwDocumentViewerBody) {
            bomZwDocumentViewerBody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state">Brakuje logowania Vendo do pobrania pozycji dokumentu ZW.</td>
                </tr>
            `;
        }
        return;
    }

    setStatus("loading", "ZW poz.");

    try {
        const payload = await postJson("/api/zapotrzebowanie/vendo/zw-document-details", {
            documentId: normalizedDocumentId,
            ...connection,
        });

        if (requestToken !== operationalBomZwDocumentRequestToken) return;
        renderBomZwDocumentViewerContent(payload);
        renderCurrentModuleMeta();
        setStatus("success", "ZW poz.");
    } catch (error) {
        if (requestToken !== operationalBomZwDocumentRequestToken) return;
        if (bomZwDocumentViewerError) {
            bomZwDocumentViewerError.textContent = error.message || "Nie udalo sie pobrac pozycji dokumentu ZW.";
            bomZwDocumentViewerError.classList.remove("hidden");
        }
        if (bomZwDocumentViewerBody) {
            bomZwDocumentViewerBody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state">Brak pozycji dla wybranego dokumentu ZW.</td>
                </tr>
            `;
        }
        setStatus("error", "ZW poz.");
    }
}

async function loadBomZwViewer(item) {
    const componentCode = String(item?.componentCode || "").trim();
    if (!componentCode || !bomZwViewer) {
        return;
    }

    const requestToken = operationalBomZwRequestToken + 1;
    operationalBomZwRequestToken = requestToken;
    const connection = getConnectionPayload();

    bomZwViewer.classList.remove("hidden");
    bomZwViewer.setAttribute("aria-hidden", "false");
    if (bomZwViewerTitle) {
        bomZwViewerTitle.textContent = `Szczegoly ZW ${componentCode}`;
    }
    if (bomZwViewerMeta) {
        bomZwViewerMeta.textContent = `Ladowanie dokumentow ZW dla ${item?.componentName || componentCode}...`;
    }
    if (bomZwViewerSummary) {
        bomZwViewerSummary.classList.add("hidden");
        bomZwViewerSummary.innerHTML = "";
    }
    if (bomZwViewerError) {
        bomZwViewerError.classList.add("hidden");
        bomZwViewerError.textContent = "";
    }
    if (bomZwViewerBody) {
        bomZwViewerBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">Ladowanie szczegolow ZW...</td>
            </tr>
        `;
    }
    syncModalOpenState();

    if (!(connection.vendoUserLogin && connection.vendoUserPassword)) {
        if (bomZwViewerError) {
            bomZwViewerError.textContent = "Brakuje loginu lub hasla Vendo. Zapisz logowanie, aby otworzyc modal ZW.";
            bomZwViewerError.classList.remove("hidden");
        }
        if (bomZwViewerBody) {
            bomZwViewerBody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state">Brakuje logowania Vendo do pobrania dokumentow ZW.</td>
                </tr>
            `;
        }
        setStatus("error", "Vendo");
        return;
    }

    setStatus("loading", "ZW");

    try {
        const payload = await postJson("/api/zapotrzebowanie/vendo/zw-details", {
            code: componentCode,
            ...connection,
        });

        if (requestToken !== operationalBomZwRequestToken) return;
        renderBomZwViewerContent(item, payload);
        renderCurrentModuleMeta();
        setStatus("success", "ZW");
    } catch (error) {
        if (requestToken !== operationalBomZwRequestToken) return;
        if (bomZwViewerError) {
            bomZwViewerError.textContent = error.message || "Nie udalo sie pobrac szczegolow ZW.";
            bomZwViewerError.classList.remove("hidden");
        }
        if (bomZwViewerBody) {
            bomZwViewerBody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state">Brak dokumentow ZW dla wybranego indeksu.</td>
                </tr>
            `;
        }
        setStatus("error", "ZW");
    }
}

function openHeaderPrintViewer() {
    if (!headerPrintViewer) {
        return;
    }

    headerPrintViewer.classList.remove("hidden");
    headerPrintViewer.setAttribute("aria-hidden", "false");
    syncModalOpenState();
}

function closeHeaderPrintViewer() {
    headerPrintPreviewRequestToken += 1;
    if (!headerPrintViewer) {
        return;
    }

    headerPrintViewer.classList.add("hidden");
    headerPrintViewer.setAttribute("aria-hidden", "true");
    if (headerPrintViewerSummary) {
        headerPrintViewerSummary.classList.add("hidden");
        headerPrintViewerSummary.innerHTML = "";
    }
    if (headerPrintViewerError) {
        headerPrintViewerError.classList.add("hidden");
        headerPrintViewerError.textContent = "";
    }
    if (headerPrintViewerHeadersBody) {
        headerPrintViewerHeadersBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">Zaznacz naglowki, aby przygotowac wydruk.</td>
            </tr>
        `;
    }
    if (headerPrintViewerBomBody) {
        headerPrintViewerBomBody.innerHTML = `
            <tr>
                <td colspan="9" class="empty-state">Zaznacz naglowki, aby zsumowac pozycje BOM.</td>
            </tr>
        `;
    }
    syncModalOpenState();
}

function renderHeaderPrintViewerLoadingState() {
    if (headerPrintViewerTitle) {
        headerPrintViewerTitle.textContent = "Laczone zlecenia";
    }
    if (headerPrintViewerMeta) {
        headerPrintViewerMeta.textContent = "Ladowanie sumarycznej listy komponentow dla zaznaczonych naglowkow...";
    }
    if (headerPrintViewerSummary) {
        headerPrintViewerSummary.classList.add("hidden");
        headerPrintViewerSummary.innerHTML = "";
    }
    if (headerPrintViewerError) {
        headerPrintViewerError.classList.add("hidden");
        headerPrintViewerError.textContent = "";
    }
    if (headerPrintViewerHeadersBody) {
        headerPrintViewerHeadersBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">Ladowanie wybranych naglowkow...</td>
            </tr>
        `;
    }
    if (headerPrintViewerBomBody) {
        headerPrintViewerBomBody.innerHTML = `
            <tr>
                <td colspan="9" class="empty-state">Ladowanie zsumowanych pozycji BOM...</td>
            </tr>
        `;
    }
}

async function fetchOperationalHeaderDetailPayloadById(headerId) {
    const normalizedHeaderId = Number(headerId);
    const isVendoSource = operationalPayload?.meta?.source === "vendo";
    return postJson(
        isVendoSource
            ? "/api/zapotrzebowanie/vendo/header-details"
            : "/api/zapotrzebowanie/operational/header-details",
        {
            ...(isVendoSource ? { planPositionId: normalizedHeaderId } : { headerId: normalizedHeaderId }),
            ...getConnectionPayload(),
            materialOwnershipFilter: headerMaterialFilter?.value || "MSX_OR_EMPTY",
        }
    );
}

function choosePreferredAggregateName(currentName, nextName) {
    const currentLength = String(currentName || "").trim().length;
    const nextLength = String(nextName || "").trim().length;
    if (!currentLength) return String(nextName || "").trim();
    if (!nextLength) return String(currentName || "").trim();
    return nextLength > currentLength ? String(nextName || "").trim() : String(currentName || "").trim();
}

function buildHeaderPrintPreviewPayload({ headers, detailPayloads, warnings = [] }) {
    const componentMap = new Map();

    (detailPayloads || []).forEach((payload) => {
        const bomItems = Array.isArray(payload?.bomItems) ? payload.bomItems : [];
        bomItems.forEach((item) => {
            const componentCode = String(item?.componentCode || "").trim();
            if (!componentCode) {
                return;
            }

            const codeKey = componentCode.toUpperCase();
            const current = componentMap.get(codeKey) || {
                componentCode,
                componentName: "",
                typeName: "",
                unitQty: 0,
                requiredQty: 0,
                wmsStock: 0,
                vendoStock: 0,
                zwQty: 0,
                toOrder: 0,
            };

            current.componentCode = componentCode;
            current.componentName = choosePreferredAggregateName(current.componentName, item?.componentName);
            current.typeName = String(current.typeName || item?.typeName || "").trim();
            current.unitQty += Number(item?.unitQty) || 0;
            current.requiredQty += Number(item?.requiredQty) || 0;
            current.wmsStock = Math.max(current.wmsStock, Number(item?.wmsStock) || 0);
            current.vendoStock = Math.max(current.vendoStock, Number(item?.vendoStock) || 0);
            current.zwQty = Math.max(current.zwQty, Number(item?.zwQty) || 0);
            componentMap.set(codeKey, current);
        });
    });

    const bomRows = [...componentMap.values()]
        .map((row) => ({
            ...row,
            toOrder: Math.max((Number(row?.requiredQty) || 0) - ((Number(row?.wmsStock) || 0) + (Number(row?.vendoStock) || 0)), 0),
        }))
        .sort((left, right) => String(left?.componentCode || "").localeCompare(String(right?.componentCode || ""), "pl", {
            numeric: true,
            sensitivity: "base",
        }));

    const summary = bomRows.reduce((result, row) => {
        result.totalComponents += 1;
        result.requiredQty += Number(row?.requiredQty) || 0;
        result.shortageItems += (Number(row?.toOrder) || 0) > 0 ? 1 : 0;
        result.shortageQty += Number(row?.toOrder) || 0;
        result.zwQty += Number(row?.zwQty) || 0;
        return result;
    }, {
        totalHeaders: (headers || []).length,
        totalComponents: 0,
        requiredQty: 0,
        shortageItems: 0,
        shortageQty: 0,
        zwQty: 0,
    });

    return {
        headers: headers || [],
        bomRows,
        summary,
        warnings: [...new Set((warnings || []).filter(Boolean))],
        generatedAt: new Date().toISOString(),
    };
}

function buildHeaderPrintScopePayload(payload, scope = headerPrintScope) {
    const normalizedScope = normalizeHeaderPrintScope(scope);
    const headers = Array.isArray(payload?.headers) ? payload.headers : [];
    const allBomRows = Array.isArray(payload?.bomRows) ? payload.bomRows : [];
    const scopedBomRows = allBomRows.filter((row) => {
        const typeName = String(row?.typeName || "").trim().toUpperCase();
        if (normalizedScope === "THT") {
            return typeName === "THT";
        }
        return typeName === "SMD" || typeName === "PCB";
    });
    const summary = scopedBomRows.reduce((result, row) => {
        result.totalHeaders = headers.length;
        result.totalComponents += 1;
        result.requiredQty += Number(row?.requiredQty) || 0;
        result.shortageItems += (Number(row?.toOrder) || 0) > 0 ? 1 : 0;
        result.shortageQty += Number(row?.toOrder) || 0;
        result.zwQty += Number(row?.zwQty) || 0;
        return result;
    }, {
        totalHeaders: headers.length,
        totalComponents: 0,
        requiredQty: 0,
        shortageItems: 0,
        shortageQty: 0,
        zwQty: 0,
    });

    return {
        ...payload,
        scope: normalizedScope,
        bomRows: scopedBomRows,
        summary,
    };
}

async function ensureHeaderPrintPreviewPayload({ forceRefresh = false } = {}) {
    const selectedIds = [...selectedHeaderIds]
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
    const selectionKey = buildSelectedHeadersKey(selectedIds);

    if (!selectedIds.length) {
        throw new Error("Zaznacz co najmniej jeden naglowek do wydruku.");
    }

    if (!forceRefresh && headerPrintPreviewPayload && headerPrintPreviewSelectionKey === selectionKey) {
        return headerPrintPreviewPayload;
    }

    const headers = getSelectedOperationalHeaders();
    const detailResults = await Promise.allSettled(
        selectedIds.map((headerId) => fetchOperationalHeaderDetailPayloadById(headerId))
    );

    const detailPayloads = [];
    const warnings = [];
    detailResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
            const payload = result.value;
            detailPayloads.push(payload);
            const payloadWarnings = Array.isArray(payload?.meta?.warnings) ? payload.meta.warnings.filter(Boolean) : [];
            if (payloadWarnings.length) {
                warnings.push(...payloadWarnings.map((warning) => `${selectedIds[index]}: ${warning}`));
            }
            return;
        }

        warnings.push(`Nie udalo sie pobrac BOM dla naglowka ${selectedIds[index]}: ${result.reason?.message || "blad"}`);
    });

    if (!detailPayloads.length) {
        throw new Error("Nie udalo sie pobrac zadnych pozycji BOM dla zaznaczonych naglowkow.");
    }

    headerPrintPreviewPayload = buildHeaderPrintPreviewPayload({
        headers,
        detailPayloads,
        warnings,
    });
    headerPrintPreviewSelectionKey = selectionKey;
    return headerPrintPreviewPayload;
}

function renderHeaderPrintViewerContent(payload, scope = headerPrintScope) {
    const scopedPayload = buildHeaderPrintScopePayload(payload, scope);
    const headers = Array.isArray(scopedPayload?.headers) ? scopedPayload.headers : [];
    const bomRows = Array.isArray(scopedPayload?.bomRows) ? scopedPayload.bomRows : [];
    const summary = scopedPayload?.summary || {};
    const warnings = Array.isArray(scopedPayload?.warnings) ? scopedPayload.warnings.filter(Boolean) : [];
    const normalizedScope = normalizeHeaderPrintScope(scope);
    const scopeLabel = getHeaderPrintScopeLabel(scope);

    if (headerPrintViewerTitle) {
        headerPrintViewerTitle.textContent = `Laczone zlecenia (${headers.length})`;
    }
    if (headerPrintViewerMeta) {
        headerPrintViewerMeta.textContent = `Podglad wydruku ${scopeLabel} wygenerowany ${formatDateTime(payload?.generatedAt)}.`;
    }
    if (headerPrintViewerBomTitle) {
        headerPrintViewerBomTitle.textContent = `Komponenty do kompletacji ${scopeLabel}`;
    }
    if (headerPrintViewerPrintButton) {
        headerPrintViewerPrintButton.textContent = getHeaderPrintButtonLabel(scope);
    }
    if (headerPrintViewerSummary) {
        headerPrintViewerSummary.innerHTML = buildSummaryPills([
            ["Naglowki", headers.length],
            ["Komponenty", summary.totalComponents ?? 0],
            ["Suma wym.", formatNumber(summary.requiredQty)],
            ["Pozycje z brakiem", summary.shortageItems ?? 0],
            ["Zakres", scopeLabel],
        ]);
        headerPrintViewerSummary.classList.remove("hidden");
    }
    if (headerPrintViewerError) {
        if (warnings.length) {
            headerPrintViewerError.textContent = warnings.join(" | ");
            headerPrintViewerError.classList.remove("hidden");
        } else {
            headerPrintViewerError.classList.add("hidden");
            headerPrintViewerError.textContent = "";
        }
    }
    if (headerPrintViewerHeadersBody) {
        headerPrintViewerHeadersBody.innerHTML = headers.length
            ? headers.map((header, index) => `
                <tr>
                    <td class="align-right">${escapeHtml(index + 1)}</td>
                    <td>${escapeHtml(header.kkwNumber || "-")}</td>
                    <td>${escapeHtml(header.productIndex || "-")}</td>
                    <td>${escapeHtml(header.productName || "-")}</td>
                    <td>${escapeHtml(header.clientName || "-")}</td>
                    <td class="align-right">${escapeHtml(formatNumber(header.orderQty))}</td>
                    <td>${escapeHtml(formatDate(header.termDate))}</td>
                </tr>
            `).join("")
            : `
                <tr>
                    <td colspan="7" class="empty-state">Brak naglowkow do wydruku.</td>
                </tr>
            `;
    }
      if (headerPrintViewerBomBody) {
          headerPrintViewerBomBody.innerHTML = bomRows.length
              ? bomRows.map((row) => `
                  <tr>
                      <td>${escapeHtml(row.componentCode || "-")}</td>
                      <td>${escapeHtml(row.componentName || "-")}</td>
                      <td>${escapeHtml(row.typeName || "-")}</td>
                      <td class="align-right">${escapeHtml(formatNumber(row.requiredQty))}</td>
                  </tr>
              `).join("")
              : `
                  <tr>
                        <td colspan="4" class="empty-state">Brak pozycji ${escapeHtml(scopeLabel)} do wydruku.</td>
                  </tr>
              `;
      }
}

function buildHeaderPrintDocumentHtml(payload, scope = headerPrintScope) {
    const scopedPayload = buildHeaderPrintScopePayload(payload, scope);
    const headers = Array.isArray(scopedPayload?.headers) ? scopedPayload.headers : [];
    const bomRows = Array.isArray(scopedPayload?.bomRows) ? scopedPayload.bomRows : [];
    const summary = scopedPayload?.summary || {};
    const warnings = Array.isArray(scopedPayload?.warnings) ? scopedPayload.warnings.filter(Boolean) : [];
    const normalizedScope = normalizeHeaderPrintScope(scope);
    const scopeLabel = getHeaderPrintScopeLabel(scope);

    return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<title>Laczone zlecenia ${scopeLabel}</title>
<style>
    body { font-family: Inter, "Segoe UI", Arial, sans-serif; margin: 24px; color: #0f172a; }
    h1 { margin: 0 0 6px; font-size: 28px; }
    .meta { margin: 0 0 16px; color: #475569; font-size: 13px; }
    .summary { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
    .summary-item { border: 1px solid #cbd5e1; border-radius: 999px; padding: 6px 12px; font-size: 13px; background: #f8fafc; }
    .section { margin-bottom: 20px; }
    .section h2 { margin: 0 0 10px; font-size: 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 6px 8px; border-bottom: 1px solid #dbe2ea; vertical-align: top; }
    th { text-align: left; color: #475569; font-weight: 700; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    .shortage { background: #fecaca; color: #991b1b; font-weight: 700; }
    .warnings { margin-top: 10px; padding: 10px 12px; border: 1px solid #fbbf24; background: #fffbeb; color: #92400e; border-radius: 10px; font-size: 12px; }
</style>
</head>
<body>
    <h1>Laczone zlecenia ${escapeHtml(scopeLabel)}</h1>
    <p class="meta">Wydruk kompletacyjny wygenerowany ${escapeHtml(formatDateTime(payload?.generatedAt))}.</p>
    <div class="summary">
        <div class="summary-item">Naglowki: <strong>${escapeHtml(headers.length)}</strong></div>
        <div class="summary-item">Komponenty: <strong>${escapeHtml(summary.totalComponents ?? 0)}</strong></div>
        <div class="summary-item">Suma wym.: <strong>${escapeHtml(formatNumber(summary.requiredQty))}</strong></div>
        <div class="summary-item">Pozycje z brakiem: <strong>${escapeHtml(summary.shortageItems ?? 0)}</strong></div>
        <div class="summary-item">Zakres: <strong>${escapeHtml(scopeLabel)}</strong></div>
    </div>

    <section class="section">
        <h2>Wybrane naglowki</h2>
        <table>
            <thead>
                <tr>
                    <th class="num">#</th>
                    <th>KKW</th>
                    <th>Indeks</th>
                    <th>Produkt</th>
                    <th>Klient</th>
                    <th class="num">Ilosc</th>
                    <th>Termin</th>
                </tr>
            </thead>
            <tbody>
                ${headers.map((header, index) => `
                    <tr>
                        <td class="num">${escapeHtml(index + 1)}</td>
                        <td>${escapeHtml(header.kkwNumber || "-")}</td>
                        <td>${escapeHtml(header.productIndex || "-")}</td>
                        <td>${escapeHtml(header.productName || "-")}</td>
                        <td>${escapeHtml(header.clientName || "-")}</td>
                        <td class="num">${escapeHtml(formatNumber(header.orderQty))}</td>
                        <td>${escapeHtml(formatDate(header.termDate))}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    </section>

    <section class="section">
        <h2>Komponenty do kompletacji ${escapeHtml(scopeLabel)}</h2>
        <table>
                <thead>
                    <tr>
                        <th>Kod</th>
                        <th>Komponent</th>
                        <th>Rodzaj</th>
                        <th class="num">Suma wym.</th>
                    </tr>
                </thead>
                <tbody>
                    ${bomRows.map((row) => `
                        <tr>
                            <td>${escapeHtml(row.componentCode || "-")}</td>
                            <td>${escapeHtml(row.componentName || "-")}</td>
                            <td>${escapeHtml(row.typeName || "-")}</td>
                            <td class="num">${escapeHtml(formatNumber(row.requiredQty))}</td>
                        </tr>
                    `).join("")}
                </tbody>
        </table>
    </section>

    ${warnings.length ? `<div class="warnings">${escapeHtml(warnings.join(" | "))}</div>` : ""}
</body>
</html>`;
}

function printHeaderPreviewPayload(payload, scope = headerPrintScope) {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);

    const iframeDocument = iframe.contentWindow?.document;
    if (!iframeDocument || !iframe.contentWindow) {
        iframe.remove();
        setStatus("error", "Wydruk");
        return false;
    }

    iframeDocument.open();
    iframeDocument.write(buildHeaderPrintDocumentHtml(payload, scope));
    iframeDocument.close();

    const cleanup = () => {
        setTimeout(() => iframe.remove(), 800);
    };

    setTimeout(() => {
        try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        } catch {
            // ignore print dialog failures
        } finally {
            cleanup();
        }
    }, 250);
    return true;
}

async function openHeaderPrintPreview() {
    if (!selectedHeaderIds.size) {
        setStatus("error", "Wydruk");
        return;
    }

    const requestToken = headerPrintPreviewRequestToken + 1;
    headerPrintPreviewRequestToken = requestToken;
    openHeaderPrintViewer();
    renderHeaderPrintViewerLoadingState();
    setStatus("loading", "Wydruk");

    try {
        const payload = await ensureHeaderPrintPreviewPayload();
        if (requestToken !== headerPrintPreviewRequestToken) {
            return;
        }
        renderHeaderPrintViewerContent(payload, headerPrintScope);
        renderCurrentModuleMeta();
        setStatus("success", "Wydruk");
    } catch (error) {
        if (requestToken !== headerPrintPreviewRequestToken) {
            return;
        }
        if (headerPrintViewerError) {
            headerPrintViewerError.textContent = error.message || "Nie udalo sie przygotowac wydruku.";
            headerPrintViewerError.classList.remove("hidden");
        }
        if (headerPrintViewerHeadersBody) {
            headerPrintViewerHeadersBody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state">Brak danych dla zaznaczonych naglowkow.</td>
                </tr>
            `;
        }
        if (headerPrintViewerBomBody) {
            headerPrintViewerBomBody.innerHTML = `
                <tr>
                    <td colspan="9" class="empty-state">Nie udalo sie zbudowac listy komponentow do wydruku.</td>
                </tr>
            `;
        }
        setStatus("error", "Wydruk");
    }
}

async function printSelectedHeaders(scope = headerPrintScope) {
    const normalizedScope = normalizeHeaderPrintScope(scope);
    if (!selectedHeaderIds.size) {
        setStatus("error", "Wydruk");
        return;
    }

    setStatus("loading", "Wydruk");

    try {
        const payload = await ensureHeaderPrintPreviewPayload();
        const printed = printHeaderPreviewPayload(payload, normalizedScope);
        if (printed) {
            setHeaderPrintScope(normalizedScope, { rerender: false });
            setStatus("success", "Wydruk");
        }
    } catch (error) {
        setStatus("error", "Wydruk");
        if (headerPrintViewerError && isHeaderPrintViewerOpen()) {
            headerPrintViewerError.textContent = error.message || "Nie udalo sie przygotowac wydruku.";
            headerPrintViewerError.classList.remove("hidden");
        }
    }
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

function renderHeaderStageCell(header) {
    const isDraft = Boolean(header?.statusFlags?.draft);
    const draftBadge = isDraft ? `<span class="header-flag draft">DRAFT</span>` : "";
    return `
        <div class="header-stage-stack">
            <span class="header-stage ${getStageTone(header?.stageKey)}">${escapeHtml(header?.stageLabel || "-")}</span>
            ${draftBadge}
        </div>
    `;
}

function renderHeadersTable(rows, totalRows) {
    updateHeadersCount(rows.length, totalRows);
    if (!rows.length) {
        headersBody.innerHTML = `
            <tr>
                <td colspan="13" class="empty-state">Brak naglowkow dla wybranych filtrow lub snapshot nie zostal jeszcze zaladowany.</td>
            </tr>
        `;
        if (headersTableWrap) {
            headersTableWrap.scrollTop = 0;
        }
        return;
      }

      headersBody.innerHTML = rows.map((header) => `
        <tr class="operations-header-row${selectedHeaderId === header.id ? " is-selected" : ""}${header?.statusFlags?.draft ? " is-draft" : ""}" data-header-row-id="${escapeHtml(header.id)}">
            <td class="selection-column-cell">
                <input
                    type="checkbox"
                    class="header-selection-checkbox"
                    data-header-select
                    data-header-id="${escapeHtml(header.id)}"
                    ${selectedHeaderIds.has(Number(header.id)) ? "checked" : ""}
                    aria-label="Zaznacz naglowek ${escapeHtml(header.productIndex || header.id)} do wydruku"
                >
            </td>
            <td>${escapeHtml(formatDate(header.termDate))}</td>
            <td>${escapeHtml(header.kkwNumber || "-")}</td>
            <td>
                <span class="index-link${selectedHeaderId === header.id ? " active" : ""}">${escapeHtml(header.productIndex || "-")}</span>
            </td>
            <td>${escapeHtml(header.productName || "-")}</td>
            <td>${escapeHtml(header.clientName || "-")}</td>
            <td>${escapeHtml(formatNumber(header.orderQty))}</td>
            <td>${renderHeaderStageCell(header)}</td>
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
            ? headersBody.querySelector(`[data-header-row-id="${String(selectedHeaderId).replace(/"/g, '\\"')}"]`)
            : null;
        const selectedRow = selectedTrigger?.closest("tr") || selectedTrigger;

        if (selectedRow) {
            selectedRow.scrollIntoView({ block: "nearest" });
            return;
        }

        headersTableWrap.scrollTop = isDefaultHeaderSort() ? headersTableWrap.scrollHeight : 0;
    });
}

function renderOperationalHeaders() {
    const headers = Array.isArray(operationalPayload?.headers) ? operationalPayload.headers : [];
    updateHeaderSortButtons();
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
            stageKey: header.stageKey || item.stageKey || null,
            stageLabel: header.stageLabel || item.stageLabel || null,
            statusNames: Array.isArray(header.statusNames) ? header.statusNames : item.statusNames,
            statusFlags: header.statusFlags || item.statusFlags,
            includeInDemand: typeof header.includeInDemand === "boolean" ? header.includeInDemand : item.includeInDemand,
            smdDone: typeof header.smdDone === "boolean" ? header.smdDone : item.smdDone,
            thtDone: typeof header.thtDone === "boolean" ? header.thtDone : item.thtDone,
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

function updateBomNoteEditorState(editor) {
    if (!editor) return;
    const input = editor.querySelector("input");
    const hasNote = Boolean(String(input?.value || "").trim());
    editor.classList.toggle("has-note", hasNote);
}

function normalizeNoteValue(value) {
    return String(value ?? "").trim();
}

function setEditorSavedNote(editor, note) {
    if (!editor) return;
    editor.dataset.savedNote = normalizeNoteValue(note);
}

function getEditorSavedNote(editor) {
    return normalizeNoteValue(editor?.dataset?.savedNote || "");
}

function getEditorCurrentNote(editor) {
    return normalizeNoteValue(editor?.querySelector("input")?.value || "");
}

function hasEditorPendingChanges(editor) {
    return getEditorCurrentNote(editor) !== getEditorSavedNote(editor);
}

function clearNoteAutosave(editor) {
    const timerId = noteAutosaveTimers.get(editor);
    if (timerId) {
        clearTimeout(timerId);
        noteAutosaveTimers.delete(editor);
    }
}

function scheduleNoteAutosave(editor, saveHandler) {
    if (!editor || typeof saveHandler !== "function") {
        return;
    }

    clearNoteAutosave(editor);
    if (!hasEditorPendingChanges(editor)) {
        return;
    }

    const timerId = setTimeout(() => {
        noteAutosaveTimers.delete(editor);
        void saveHandler(editor);
    }, NOTE_AUTOSAVE_DELAY_MS);

    noteAutosaveTimers.set(editor, timerId);
}

function buildReportNoteKey(code, rodzaj) {
    return `${String(code || "").trim().toUpperCase()}::${String(rodzaj || "").trim().toUpperCase()}`;
}

function updateReportNoteEditorState(editor) {
    if (!editor) return;
    const input = editor.querySelector("input");
    const hasNote = Boolean(String(input?.value || "").trim());
    editor.classList.toggle("has-note", hasNote);
}

function normalizePcsPerPanelValue(value) {
    const normalized = String(value ?? "").trim().replace(",", ".");
    if (!normalized) {
        return "";
    }

    const numeric = Number(normalized);
    if (!Number.isInteger(numeric) || numeric <= 0) {
        return "";
    }

    return String(numeric);
}

function updateReportPcsPerPanelEditorState(editor) {
    if (!editor) return;
    const input = editor.querySelector("input");
    const hasValue = Boolean(normalizePcsPerPanelValue(input?.value || ""));
    editor.classList.toggle("has-note", hasValue);
}

function renderReportNoteCell(row) {
    const currentNote = String(row?.note || "").trim();
    return `
        <div class="bom-note-editor report-note-editor${currentNote ? " has-note" : ""}"
            data-report-code="${escapeHtml(row?.code || "")}"
            data-report-rodzaj="${escapeHtml(row?.rodzaj || "")}"
            data-saved-note="${escapeHtml(currentNote)}">
            <input type="text" value="${escapeHtml(row?.note || "")}" placeholder="Uwagi">
        </div>
    `;
}

function getPcsPerPanelSourceLabel(source) {
    if (source === "product_setting") return "Wspolne ustawienie MES";
    if (source === "name_hint") return "Automatyczna podpowiedz z nazwy";
    if (source === "report_panel") return "Zapis z raportu zakupowego";
    if (source === "operator_panel" || source === "admin_panel") return "Zapis z MES";
    if (source === "multiple_consistent") return "Kilka wyrobow gotowych ma te sama wartosc PCB/panel";
    if (source === "multiple_products") return "Surowiec PCB jest powiazany z kilkoma wyrobami gotowymi; zapis ujednolici wszystkie";
    return "";
}

function normalizeReportPcsTargets(targets) {
    if (!Array.isArray(targets)) {
        return [];
    }

    return targets
        .map((target) => ({
            productCode: String(target?.productCode || "").trim(),
            productName: String(target?.productName || "").trim(),
            requiredQty: Number(target?.requiredQty) || 0,
            orderQty: Number(target?.orderQty) || 0,
            headerCount: Number(target?.headerCount) || 0,
            pcsPerPanel: normalizePcsPerPanelValue(target?.pcsPerPanel),
            source: String(target?.source || "").trim() || null,
            updatedAt: target?.updatedAt || null,
            updatedBy: target?.updatedBy || null,
        }))
        .filter((target) => target.productCode);
}

function summarizeReportPcsTargets(targets) {
    const normalizedTargets = normalizeReportPcsTargets(targets);
    if (!normalizedTargets.length) {
        return {
            pcsPerPanel: null,
            pcsPerPanelSource: null,
            pcsPerPanelUpdatedAt: null,
            pcsPerPanelUpdatedBy: null,
            pcsPerPanelMode: "none",
            pcsPerPanelProductCode: null,
            pcsPerPanelProductName: null,
            pcsPerPanelTargetCount: 0,
            pcsPerPanelTargets: [],
        };
    }

    if (normalizedTargets.length === 1) {
        const target = normalizedTargets[0];
        return {
            pcsPerPanel: target.pcsPerPanel || null,
            pcsPerPanelSource: target.source || null,
            pcsPerPanelUpdatedAt: target.updatedAt || null,
            pcsPerPanelUpdatedBy: target.updatedBy || null,
            pcsPerPanelMode: "single",
            pcsPerPanelProductCode: target.productCode,
            pcsPerPanelProductName: target.productName || null,
            pcsPerPanelTargetCount: 1,
            pcsPerPanelTargets: normalizedTargets,
        };
    }

    const distinctValues = [...new Set(normalizedTargets.map((target) => target.pcsPerPanel).filter(Boolean))];
    return {
        pcsPerPanel: distinctValues.length === 1 ? distinctValues[0] : null,
        pcsPerPanelSource: distinctValues.length === 1 ? "multiple_consistent" : "multiple_products",
        pcsPerPanelUpdatedAt: null,
        pcsPerPanelUpdatedBy: null,
        pcsPerPanelMode: "multiple",
        pcsPerPanelProductCode: null,
        pcsPerPanelProductName: null,
        pcsPerPanelTargetCount: normalizedTargets.length,
        pcsPerPanelTargets: normalizedTargets,
    };
}

function renderReportPcsPerPanelCell(row) {
    if (String(row?.rodzaj || "").trim().toUpperCase() !== "PCB") {
        return "-";
    }

    const currentValue = normalizePcsPerPanelValue(row?.pcsPerPanel);
    const source = String(row?.pcsPerPanelSource || "").trim();
    const sourceLabel = getPcsPerPanelSourceLabel(source);
    const targets = normalizeReportPcsTargets(row?.pcsPerPanelTargets);
    const productCodes = targets.map((target) => target.productCode).filter(Boolean);
    const effectiveProductCode = row?.pcsPerPanelProductCode || productCodes[0] || "";
    const effectiveProductName = row?.pcsPerPanelProductName || targets[0]?.productName || "";

    if (!effectiveProductCode && !productCodes.length) {
        return '<span class="empty-inline">-</span>';
    }

    return `
        <div class="bom-note-editor report-pcs-editor${currentValue ? " has-note" : ""}${source === "name_hint" ? " is-hint" : ""}"
            data-report-code="${escapeHtml(row?.code || "")}"
            data-product-code="${escapeHtml(effectiveProductCode)}"
            data-product-name="${escapeHtml(effectiveProductName)}"
            data-product-codes="${escapeHtml(productCodes.join("|"))}"
            data-report-pcs-per-panel
            data-saved-note="${escapeHtml(currentValue)}"
            title="${escapeHtml(sourceLabel)}">
            <input type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(currentValue)}" placeholder="PCB/panel">
        </div>
    `;
}

function renderBomNoteCell(item) {
    const resolvedNote = String(resolveBomNote(item) || "").trim();
    if (!canEditBomNote(item)) {
        if (!resolvedNote || resolvedNote === "-") {
            return "-";
        }

        return `
            <span class="header-note-button bom-note-badge" title="${escapeHtml(resolvedNote)}">
                ${escapeHtml(truncateText(resolvedNote, 24))}
            </span>
        `;
    }

    const currentNote = String(item.note || "").trim();
    return `
        <div class="bom-note-editor${currentNote ? " has-note" : ""}"
            data-source-type="${escapeHtml(item.sourceType)}"
            data-source-material-id="${escapeHtml(item.sourceMaterialId)}"
            data-component-code="${escapeHtml(item.componentCode || "")}"
            data-saved-note="${escapeHtml(currentNote)}">
            <input type="text" value="${escapeHtml(item.note || "")}" placeholder="Uwagi">
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

function buildBomRowKey(item) {
    return [
        String(item?.sourceType || "").trim(),
        String(item?.sourceMaterialId ?? "").trim(),
        String(item?.componentCode || "").trim(),
    ].join("::");
}

function syncSelectedBomRowState() {
    if (!headerDetailBody) return;

    const rows = Array.from(headerDetailBody.querySelectorAll("tr[data-bom-row-key]"));
    rows.forEach((row) => {
        const isSelected = String(row.dataset.bomRowKey || "") === String(selectedBomRowKey || "");
        row.classList.toggle("is-selected", isSelected);

        const componentLink = row.querySelector(".bom-component-link");
        if (componentLink) {
            componentLink.classList.toggle("active", isSelected);
        }
    });
}

function setSelectedBomRowKey(rowKey) {
    selectedBomRowKey = String(rowKey || "").trim();
    syncSelectedBomRowState();
}

function renderHeaderDetailTable(items, { totalCount = items.length } = {}) {
    renderHeaderDetailCount(items.length, totalCount);

    if (!items.length) {
        const emptyMessage = totalCount > 0
            ? "Brak pozycji BOM po zastosowaniu filtra wyszukiwania."
            : "Brak pozycji BOM dla wybranego naglowka.";
        headerDetailBody.innerHTML = `
            <tr>
                <td colspan="11" class="empty-state">${emptyMessage}</td>
            </tr>
        `;
        return;
    }

    const sortedItems = sortBomItemsByToOrder(items);

    headerDetailBody.innerHTML = sortedItems.map((item) => `
        <tr class="operations-bom-row${buildBomRowKey(item) === selectedBomRowKey ? " is-selected" : ""}" data-bom-row-key="${escapeHtml(buildBomRowKey(item))}">
            <td>
                <button
                    type="button"
                    class="index-link bom-component-link${buildBomRowKey(item) === selectedBomRowKey ? " active" : ""}"
                    data-bom-code="${escapeHtml(item.componentCode || "")}"
                    title="Pokaz rozbicie komponentu"
                >
                    ${escapeHtml(item.componentCode || "-")}
                </button>
            </td>
            <td>${escapeHtml(item.componentName || "-")}</td>
            <td>${escapeHtml(item.typeName || "-")}</td>
            <td>${escapeHtml(formatNumber(item.componentQty))}</td>
            <td>${escapeHtml(formatNumber(item.requiredQty))}</td>
            <td>${escapeHtml(formatNumber(item.wmsStock))}</td>
            <td>${escapeHtml(formatNumber(item.vendoStock))}</td>
            <td>
                ${Number(item.zwQty) > 0
                    ? `
                        <button
                            type="button"
                            class="zw-link"
                            data-bom-zw-code="${escapeHtml(item.componentCode || "")}"
                            title="Pokaz szczegoly ZW"
                        >
                            ${escapeHtml(formatNumber(item.zwQty))}
                        </button>
                      `
                    : escapeHtml(formatNumber(item.zwQty))}
            </td>
            <td>${escapeHtml(formatOptionalNumber(item.totalDemandQty))}</td>
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
            "WMS, Vendo i ZW sa liczone live, a Zap. total zbiera popyt z aktywnych naglowkow.",
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
                        maxPages: 10,
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
            syncSelectedHeaderIdsWithHeaders(Array.isArray(payload?.headers) ? payload.headers : []);
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
                    <td colspan="13" class="empty-state">Brak danych dashboardu operacyjnego.</td>
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
    closeBomComponentViewer();
    closeBomZwViewer();
    if (Number(selectedHeaderId) !== Number(headerId)) {
        selectedBomRowKey = "";
    }
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
                <td colspan="11" class="empty-state">Ladowanie pozycji BOM...</td>
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
                    <td colspan="11" class="empty-state">Brak pozycji dla wybranego naglowka.</td>
                </tr>
            `;
        }
        if (!silentStatus) setStatus("error", "Naglowek");
    }
}

async function saveBomNote(editor) {
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

    if (!hasEditorPendingChanges(editor)) {
        updateBomNoteEditorState(editor);
        return;
    }

    clearNoteAutosave(editor);
    bomNoteSaveInFlight = true;
    setStatus("loading", "Uwagi");
    updateOperationalRefreshStatus();
    editor.classList.add("is-saving");
    updateBomNoteEditorState(editor);

    try {
        const normalizedNote = getEditorCurrentNote(editor);
        const payload = await postJson("/api/zapotrzebowanie/vendo/bom-note", {
            planPositionId,
            sourceType,
            sourceMaterialId,
            componentCode,
            note: normalizedNote,
            ...getConnectionPayload(),
        });
        const targetPayload = operationalDetailPayload || vendoPilotPayload;
        if (Array.isArray(targetPayload?.bomItems)) {
            targetPayload.bomItems = targetPayload.bomItems.map((item) => {
                if (String(item?.sourceType || "") === sourceType && Number(item?.sourceMaterialId) === sourceMaterialId) {
                    return {
                        ...item,
                        note: payload?.note?.note || normalizedNote,
                        noteUpdatedAt: payload?.note?.updatedAt || null,
                    };
                }

                return item;
            });
        }
        input.value = payload?.note?.note || normalizedNote;
        setEditorSavedNote(editor, payload?.note?.note || normalizedNote);
        if (headerDetailError) {
            headerDetailError.classList.add("hidden");
            headerDetailError.textContent = "";
        }
        updateBomNoteEditorState(editor);
        setStatus("success", "Uwagi");
    } catch (error) {
        if (headerDetailError) {
            headerDetailError.textContent = error.message || "Nie udalo sie zapisac uwagi.";
            headerDetailError.classList.remove("hidden");
        }
        setStatus("error", "Uwagi");
    } finally {
        bomNoteSaveInFlight = false;
        editor.classList.remove("is-saving");
        updateOperationalRefreshStatus();
    }
}

function syncReportNoteInPayload(code, rodzaj, note, updatedAt) {
    if (!Array.isArray(lastReportPayload?.rows)) {
        return;
    }

    const targetKey = buildReportNoteKey(code, rodzaj);
    lastReportPayload.rows = lastReportPayload.rows.map((row) => {
        if (buildReportNoteKey(row?.code, row?.rodzaj) !== targetKey) {
            return row;
        }

        return {
            ...row,
            note: String(note || ""),
            noteUpdatedAt: updatedAt || null,
        };
    });
}

function syncReportPcsPerPanelInPayload(code, productCodes, pcsPerPanel, source, updatedAt) {
    if (!Array.isArray(lastReportPayload?.rows)) {
        return;
    }

    const targetCode = String(code || "").trim().toUpperCase();
    const normalizedProductCodes = [...new Set((Array.isArray(productCodes) ? productCodes : [productCodes])
        .map((item) => String(item || "").trim().toUpperCase())
        .filter(Boolean))];
    lastReportPayload.rows = lastReportPayload.rows.map((row) => {
        if (String(row?.code || "").trim().toUpperCase() !== targetCode) {
            return row;
        }

        const currentTargets = normalizeReportPcsTargets(row?.pcsPerPanelTargets);
        const nextTargets = currentTargets.map((target) => {
            if (!normalizedProductCodes.includes(String(target?.productCode || "").trim().toUpperCase())) {
                return target;
            }

            return {
                ...target,
                pcsPerPanel: normalizePcsPerPanelValue(pcsPerPanel),
                source: source || "report_panel",
                updatedAt: updatedAt || null,
            };
        });
        const targetExists = nextTargets.some((target) => normalizedProductCodes.includes(String(target?.productCode || "").trim().toUpperCase()));
        const finalTargets = targetExists || !normalizedProductCodes.length
            ? nextTargets
            : currentTargets;
        const summary = summarizeReportPcsTargets(finalTargets);

        return {
            ...row,
            ...summary,
        };
    });
}

async function saveReportNote(editor) {
    const input = editor?.querySelector("input");
    const code = String(editor?.dataset.reportCode || "").trim();
    const rodzaj = String(editor?.dataset.reportRodzaj || "").trim();

    if (!editor || !input || !code || !rodzaj) {
        return;
    }

    if (!hasEditorPendingChanges(editor)) {
        updateReportNoteEditorState(editor);
        return;
    }

    clearNoteAutosave(editor);
    setStatus("loading", "Uwagi");
    editor.classList.add("is-saving");
    updateReportNoteEditorState(editor);

    try {
        const normalizedNote = getEditorCurrentNote(editor);
        const payload = await postJson("/api/zapotrzebowanie/report-note", {
            code,
            rodzaj,
            note: normalizedNote,
            ...getConnectionPayload(),
        });

        syncReportNoteInPayload(code, rodzaj, payload?.note?.note || normalizedNote, payload?.note?.updatedAt || null);
        input.value = payload?.note?.note || normalizedNote;
        setEditorSavedNote(editor, payload?.note?.note || normalizedNote);
        if (reportErrorBox) {
            reportErrorBox.classList.add("hidden");
            reportErrorBox.textContent = "";
        }
        if (rawOutput && lastReportPayload) {
            rawOutput.textContent = JSON.stringify(lastReportPayload, null, 2);
        }
        if (!editor.contains(document.activeElement)) {
            renderFilteredResults();
        }
        setStatus("success", "Uwagi");
    } catch (error) {
        if (reportErrorBox) {
            reportErrorBox.textContent = error.message || "Nie udalo sie zapisac uwagi raportu.";
            reportErrorBox.classList.remove("hidden");
        }
        setStatus("error", "Uwagi");
    } finally {
        editor.classList.remove("is-saving");
    }
}

async function saveReportPcsPerPanel(editor) {
    const input = editor?.querySelector("input");
    const code = String(editor?.dataset.reportCode || "").trim();
    const productCode = String(editor?.dataset.productCode || "").trim();
    const productName = String(editor?.dataset.productName || "").trim();
    const productCodes = String(editor?.dataset.productCodes || "")
        .split("|")
        .map((item) => String(item || "").trim())
        .filter(Boolean);
    const normalizedValue = normalizePcsPerPanelValue(input?.value || "");

    if (!editor || !input || !code || !(productCode || productCodes.length)) {
        return;
    }

    if (!normalizedValue) {
        input.value = getEditorSavedNote(editor);
        updateReportPcsPerPanelEditorState(editor);
        clearNoteAutosave(editor);
        return;
    }

    if (normalizePcsPerPanelValue(getEditorSavedNote(editor)) === normalizedValue) {
        updateReportPcsPerPanelEditorState(editor);
        return;
    }

    clearNoteAutosave(editor);
    editor.classList.add("is-saving");
    setStatus("loading", "PCB/panel");
    updateReportPcsPerPanelEditorState(editor);

    try {
        const payload = await postJson("/api/zapotrzebowanie/report-pcs-per-panel", {
            code,
            productCode,
            productCodes,
            productName,
            pcsPerPanel: normalizedValue,
            source: "report_panel",
            ...getConnectionPayload(),
        });

        const savedValue = normalizePcsPerPanelValue(payload?.setting?.pcsPerPanel || normalizedValue);
        input.value = savedValue;
        setEditorSavedNote(editor, savedValue);
        editor.classList.toggle("is-hint", false);
        if (payload?.setting?.source) {
            editor.title = getPcsPerPanelSourceLabel(payload.setting.source);
        }
        syncReportPcsPerPanelInPayload(
            code,
            productCodes.length ? productCodes : [productCode],
            savedValue,
            payload?.setting?.source || "report_panel",
            payload?.setting?.updatedAt || null
        );
        if (reportErrorBox) {
            reportErrorBox.classList.add("hidden");
            reportErrorBox.textContent = "";
        }
        if (rawOutput && lastReportPayload) {
            rawOutput.textContent = JSON.stringify(lastReportPayload, null, 2);
        }
        if (!editor.contains(document.activeElement)) {
            renderFilteredResults();
        }
        updateReportPcsPerPanelEditorState(editor);
        setStatus("success", "PCB/panel");
    } catch (error) {
        if (reportErrorBox) {
            reportErrorBox.textContent = error.message || "Nie udalo sie zapisac PCB na panel.";
            reportErrorBox.classList.remove("hidden");
        }
        setStatus("error", "PCB/panel");
    } finally {
        editor.classList.remove("is-saving");
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
    if (headerDraftFilter) headerDraftFilter.value = "ALL";
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
    if (detailSection) {
        detailSection.classList.toggle("hidden", hide);
        detailSection.setAttribute("aria-hidden", hide ? "true" : "false");
    }
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
    if (detailCloseButton) detailCloseButton.classList.remove("hidden");
    syncModalOpenState();
}

function clearResults() {
    lastReportPayload = null;
    reportSummary.classList.add("hidden");
    reportSummary.innerHTML = "";
    reportErrorBox.classList.add("hidden");
    reportErrorBox.textContent = "";
    resultsBody.innerHTML = `
        <tr>
            <td colspan="11" class="empty-state">Jeszcze nie pobrano danych zapotrzebowania.</td>
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
    updateConnectionStatusIndicator();
    clearResults();
    renderCurrentModuleMeta();
    setStatus("idle", "Gotowe");
    updateOperationalRefreshStatus();
    scheduleOperationalAutoRefresh();
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

        const pcsTargetsText = normalizeReportPcsTargets(row?.pcsPerPanelTargets)
            .map((target) => [target.productCode, target.productName, target.pcsPerPanel].join(" "))
            .join(" ");
        const searchable = normalizeText([row.code, row.component, row.rodzaj, row.note, row.pcsPerPanel, pcsTargetsText].join(" "));
        return searchable.includes(searchTerm);
    });
}

function renderReportTable(rows, totalRows) {
    updateResultsCount(rows.length, totalRows);
    if (!rows.length) {
        resultsBody.innerHTML = `
            <tr>
                <td colspan="11" class="empty-state">Brak wynikow dla wybranych filtrow.</td>
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
                 <td>
                     ${Number(row.vendoExpected) > 0
                         ? `
                             <button
                                 type="button"
                                 class="zw-link"
                                 data-report-zw-code="${escapeHtml(row.code ?? "")}"
                                 title="Pokaz szczegoly ZW"
                             >
                                 ${escapeHtml(formatNumber(row.vendoExpected))}
                             </button>
                         `
                         : escapeHtml(formatNumber(row.vendoExpected))}
                 </td>
                 <td>${escapeHtml(row.rodzaj ?? "")}</td>
                 <td class="report-pcs-cell">${renderReportPcsPerPanelCell(row)}</td>
                 <td>${escapeHtml(row.status ?? 0)}</td>
                 <td class="to-order ${toneClass}">${escapeHtml(formatNumber(toOrder))}</td>
                 <td class="bom-note report-note-cell">${renderReportNoteCell(row)}</td>
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

    if (detailSection) {
        detailSection.classList.remove("hidden");
        detailSection.setAttribute("aria-hidden", "false");
    }
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
    syncModalOpenState();
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
    const headers = ["Kod", "Komponent", "Suma wymagane", "Stan WMS", "Vendo stan", "Vendo oczekiwane", "Rodzaj", "PCB/panel", "Status", "To order", "Uwagi"];
    const lines = rows.map((row) => ([
        row.code,
        row.component,
        formatCsvNumber(row.requiredQty),
        formatCsvNumber(row.wmsStock),
        formatCsvNumber(row.vendoStock),
        formatCsvNumber(row.vendoExpected),
        row.rodzaj,
        formatCsvNumber(row.pcsPerPanel),
        formatCsvNumber(row.status),
        formatCsvNumber(row.toOrder),
        row.note || "",
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

    if (detailSection) {
        detailSection.classList.remove("hidden");
        detailSection.setAttribute("aria-hidden", "false");
    }
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
    syncModalOpenState();

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
        syncModalOpenState();
        setStatus("error", "Blad");
    }
}

if (saveConnectionButton) saveConnectionButton.addEventListener("click", saveConnection);
if (clearButton) clearButton.addEventListener("click", clearConnection);
if (connectionForm) {
    connectionForm.addEventListener("input", () => {
        updateConnectionStatusIndicator();
        updateOperationalRefreshStatus();
    });
}
if (refreshStorageButton) refreshStorageButton.addEventListener("click", refreshStorageSnapshot);
if (headerSearchInput) headerSearchInput.addEventListener("input", renderOperationalHeaders);
if (headerStatusFilter) headerStatusFilter.addEventListener("change", renderOperationalHeaders);
if (headerPhaseFilter) headerPhaseFilter.addEventListener("change", renderOperationalHeaders);
if (headerDraftFilter) headerDraftFilter.addEventListener("change", renderOperationalHeaders);
if (headerMaterialFilter) headerMaterialFilter.addEventListener("change", () => loadOperationalOverview({ preserveSelection: true }));
if (headerSortButtons.length) {
    headerSortButtons.forEach((button) => {
        button.addEventListener("click", () => setHeaderSort(button.dataset.headerSort));
    });
}
if (refreshHeadersButton) refreshHeadersButton.addEventListener("click", refreshOperationalHeaders);
if (headerSelectionPreviewButton) {
    headerSelectionPreviewButton.addEventListener("click", () => {
        void openHeaderPrintPreview();
    });
}
if (headerSelectionPrintSmdButton) {
    headerSelectionPrintSmdButton.addEventListener("click", () => {
        void printSelectedHeaders("SMD");
    });
}
if (headerSelectionPrintThtButton) {
    headerSelectionPrintThtButton.addEventListener("click", () => {
        void printSelectedHeaders("THT");
    });
}
if (headerSelectionClearButton) {
    headerSelectionClearButton.addEventListener("click", clearSelectedHeaders);
}
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
    headersBody.addEventListener("change", (event) => {
        const selectTrigger = event.target.closest("[data-header-select]");
        if (!selectTrigger) {
            return;
        }

        toggleHeaderSelection(selectTrigger.dataset.headerId, selectTrigger.checked);
    });

    headersBody.addEventListener("click", (event) => {
        if (event.target.closest("[data-header-select]")) {
            return;
        }

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

        const rowTrigger = event.target.closest("[data-header-row-id]");
        if (rowTrigger) loadHeaderDetails(rowTrigger.dataset.headerRowId);
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

if (headerPrintViewerCloseButton) {
    headerPrintViewerCloseButton.addEventListener("click", closeHeaderPrintViewer);
}

if (headerPrintViewerPrintButton) {
    headerPrintViewerPrintButton.addEventListener("click", () => {
        void printSelectedHeaders(headerPrintScope);
    });
}

if (headerPrintScopeSmdButton) {
    headerPrintScopeSmdButton.addEventListener("click", () => {
        setHeaderPrintScope("SMD");
    });
}

if (headerPrintScopeThtButton) {
    headerPrintScopeThtButton.addEventListener("click", () => {
        setHeaderPrintScope("THT");
    });
}

if (headerPrintViewer) {
    headerPrintViewer.addEventListener("click", (event) => {
        if (event.target.closest("[data-header-print-close]")) {
            closeHeaderPrintViewer();
        }
    });
}

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && headerNoteViewer && !headerNoteViewer.classList.contains("hidden")) {
        closeHeaderNoteViewer();
        return;
    }

    if (event.key === "Escape" && headerPrintViewer && !headerPrintViewer.classList.contains("hidden")) {
        closeHeaderPrintViewer();
        return;
    }

    if (event.key === "Escape" && bomZwDocumentViewer && !bomZwDocumentViewer.classList.contains("hidden")) {
        closeBomZwDocumentViewer();
        return;
    }

    if (event.key === "Escape" && bomZwViewer && !bomZwViewer.classList.contains("hidden")) {
        closeBomZwViewer();
        return;
    }

    if (event.key === "Escape" && bomComponentViewer && !bomComponentViewer.classList.contains("hidden")) {
        closeBomComponentViewer();
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
        const rowTrigger = event.target.closest("[data-bom-row-key]");
        if (rowTrigger && !event.target.closest(".bom-note-editor")) {
            setSelectedBomRowKey(rowTrigger.dataset.bomRowKey || "");
        }

        const zwTrigger = event.target.closest("[data-bom-zw-code]");
        if (zwTrigger) {
            const targetPayload = operationalDetailPayload || vendoPilotPayload;
            const bomItems = Array.isArray(targetPayload?.bomItems) ? targetPayload.bomItems : [];
            const targetItem = bomItems.find((item) => String(item?.componentCode || "").trim() === String(zwTrigger.dataset.bomZwCode || "").trim());
            if (targetItem) {
                void loadBomZwViewer(targetItem);
            }
            return;
        }

        const componentTrigger = event.target.closest("[data-bom-code]");
        if (componentTrigger) {
            const targetPayload = operationalDetailPayload || vendoPilotPayload;
            const bomItems = Array.isArray(targetPayload?.bomItems) ? targetPayload.bomItems : [];
            const targetItem = bomItems.find((item) => String(item?.componentCode || "").trim() === String(componentTrigger.dataset.bomCode || "").trim());
            if (targetItem) {
                void loadBomComponentViewer(targetItem);
            }
        }
    });

    headerDetailBody.addEventListener("input", (event) => {
        const noteInput = event.target.closest(".bom-note-editor input");
        if (noteInput) {
            const editor = noteInput.closest(".bom-note-editor");
            updateBomNoteEditorState(editor);
            scheduleNoteAutosave(editor, saveBomNote);
        }
    });

    headerDetailBody.addEventListener("focusout", (event) => {
        const noteInput = event.target.closest(".bom-note-editor input");
        if (noteInput) {
            const editor = noteInput.closest(".bom-note-editor");
            if (!event.relatedTarget || !editor?.contains(event.relatedTarget)) {
                void saveBomNote(editor);
            }
        }
    });

    headerDetailBody.addEventListener("keydown", (event) => {
        const noteInput = event.target.closest(".bom-note-editor input");
        if (noteInput && event.key === "Enter") {
            event.preventDefault();
            noteInput.blur();
        }
    });
}

if (bomComponentViewerCloseButton) {
    bomComponentViewerCloseButton.addEventListener("click", closeBomComponentViewer);
}

if (bomComponentViewer) {
    bomComponentViewer.addEventListener("click", (event) => {
        if (event.target.closest("[data-bom-component-close]")) {
            closeBomComponentViewer();
        }
    });
}

if (bomZwViewerCloseButton) {
    bomZwViewerCloseButton.addEventListener("click", closeBomZwViewer);
}

if (bomZwViewer) {
    bomZwViewer.addEventListener("click", (event) => {
        const documentTrigger = event.target.closest("[data-zw-document-id]");
        if (documentTrigger) {
            void loadBomZwDocumentViewer(
                documentTrigger.dataset.zwDocumentId,
                documentTrigger.dataset.zwDocumentNumber || ""
            );
            return;
        }

        if (event.target.closest("[data-bom-zw-close]")) {
            closeBomZwViewer();
        }
    });
}

if (bomZwDocumentViewerCloseButton) {
    bomZwDocumentViewerCloseButton.addEventListener("click", closeBomZwDocumentViewer);
}

if (bomZwDocumentViewer) {
    bomZwDocumentViewer.addEventListener("click", (event) => {
        if (event.target.closest("[data-bom-zw-document-close]")) {
            closeBomZwDocumentViewer();
        }
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

if (detailSection) {
    detailSection.addEventListener("click", (event) => {
        if (event.target.closest("[data-report-detail-close]")) {
            clearDetailPanel({ hide: true });
            renderFilteredResults();
        }
    });
}

if (resultsBody) {
    resultsBody.addEventListener("click", (event) => {
        const zwTrigger = event.target.closest("[data-report-zw-code]");
        if (zwTrigger) {
            const rows = Array.isArray(lastReportPayload?.rows) ? lastReportPayload.rows : [];
            const targetRow = rows.find((row) => String(row?.code || "").trim() === String(zwTrigger.dataset.reportZwCode || "").trim());
            if (targetRow) {
                void loadBomZwViewer({
                    componentCode: targetRow.code,
                    componentName: targetRow.component,
                    rodzaj: targetRow.rodzaj,
                });
            }
            return;
        }

        const trigger = event.target.closest(".index-link[data-code]");
        if (trigger) loadComponentDetails(trigger.dataset.code, trigger.dataset.rodzaj);
    });

    resultsBody.addEventListener("input", (event) => {
        const noteInput = event.target.closest(".report-note-editor input");
        if (noteInput) {
            const editor = noteInput.closest(".report-note-editor");
            updateReportNoteEditorState(editor);
            scheduleNoteAutosave(editor, saveReportNote);
            return;
        }

        const pcsInput = event.target.closest(".report-pcs-editor input");
        if (pcsInput) {
            const editor = pcsInput.closest(".report-pcs-editor");
            updateReportPcsPerPanelEditorState(editor);
            scheduleNoteAutosave(editor, saveReportPcsPerPanel);
        }
    });

    resultsBody.addEventListener("focusout", (event) => {
        const noteInput = event.target.closest(".report-note-editor input");
        if (noteInput) {
            const editor = noteInput.closest(".report-note-editor");
            if (!event.relatedTarget || !editor?.contains(event.relatedTarget)) {
                void saveReportNote(editor);
            }
            return;
        }

        const pcsInput = event.target.closest(".report-pcs-editor input");
        if (pcsInput) {
            const editor = pcsInput.closest(".report-pcs-editor");
            if (!event.relatedTarget || !editor?.contains(event.relatedTarget)) {
                void saveReportPcsPerPanel(editor);
            }
        }
    });

    resultsBody.addEventListener("keydown", (event) => {
        const noteInput = event.target.closest(".report-note-editor input");
        if (noteInput && event.key === "Enter") {
            event.preventDefault();
            noteInput.blur();
            return;
        }

        const pcsInput = event.target.closest(".report-pcs-editor input");
        if (pcsInput && event.key === "Enter") {
            event.preventDefault();
            pcsInput.blur();
        }
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
updateHeaderSortButtons();
clearVendoPilotPanel();
clearResults();
clearOperationalDetailPanel({ hide: true });
renderStorageMeta(null);
setActiveView("operations");
renderCurrentModuleMeta();
setStatus("idle", "Gotowe");
updateOperationalRefreshStatus();
updateHeaderSelectionToolbar();
loadOperationalOverview();
