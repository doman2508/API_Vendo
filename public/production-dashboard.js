const dashboardForm = document.getElementById("production-dashboard-form");
const dashboardSubmitButton = document.getElementById("production-dashboard-submit-button");
const dashboardStatusBadge = document.getElementById("dashboard-status-badge");
const dashboardError = document.getElementById("production-dashboard-error");
const dashboardSummary = document.getElementById("production-dashboard-summary");
const dashboardHero = document.getElementById("production-dashboard-hero");
const dashboardMetrics = document.getElementById("production-dashboard-metrics");
const dashboardTimeline = document.getElementById("production-dashboard-timeline");
const dashboardOverviewSection = document.getElementById("production-overview-section");
const dashboardOverviewGrid = document.getElementById("production-overview-grid");
const dashboardOverviewSettings = document.getElementById("production-overview-settings");
const dashboardScreenStationsInput = document.getElementById("screen-stations");
const dashboardOverviewPrepStationsInput = document.getElementById("overview-prep-stations");
const dashboardScreenSettingsPinInput = document.getElementById("screen-settings-pin");
const dashboardOverviewRefreshState = document.getElementById("production-overview-refresh-state");
const dashboardOverviewAutoRefreshInput = document.getElementById("production-overview-auto-refresh");
const dashboardOverviewDensityInput = document.getElementById("production-overview-density");
const dashboardOverviewFilterButtons = Array.from(document.querySelectorAll("[data-overview-filter]"));
const dashboardCollectionTitle = document.getElementById("production-collection-title");
const dashboardCollectionCopy = document.getElementById("production-collection-copy");
const dashboardDebug = document.getElementById("production-dashboard-debug");
const dashboardRawOutput = document.getElementById("production-dashboard-raw-output");
const dashboardConnectionForm = document.getElementById("connection-form");
const dashboardClearButton = document.getElementById("clear-button");
const dashboardToggleTvModeButton = document.getElementById("toggle-tv-mode");
const dashboardToggleUltrawideModeButton = document.getElementById("toggle-ultrawide-mode");
const dashboardScreenTopbar = document.getElementById("production-screen-topbar");
const dashboardScreenTitle = document.getElementById("production-screen-title");
const dashboardScreenMeta = document.getElementById("production-screen-meta");
const dashboardScreenSettingsToggleButton = document.getElementById("screen-settings-toggle");
const dashboardScreenTvToggleButton = document.getElementById("screen-tv-toggle");
const dashboardScreenUltrawideToggleButton = document.getElementById("screen-ultrawide-toggle");
const dashboardModeButtons = Array.from(document.querySelectorAll("[data-dashboard-mode]"));
const dashboardDetailSections = Array.from(document.querySelectorAll(".production-dashboard-detail"));
const dashboardHeroSection = document.querySelector(".hero");
const dashboardConfigPanels = Array.from(document.querySelectorAll(".dashboard-config-panel"));
const dashboardOverviewNote = document.getElementById("production-overview-note");
let dashboardCurrentData = null;
let dashboardClockTimer = null;
let dashboardTvMode = false;
let dashboardUltrawideMode = false;
let dashboardMode = "single";
let dashboardScreenSettingsOpen = false;
let dashboardScreenSettingsPin = "";
let dashboardScreenStations = [];
let dashboardOverviewPrepStations = [];
let dashboardOverviewFilter = "all";
let dashboardOverviewAutoRefresh = true;
let dashboardOverviewDensity = "standard";
let dashboardOverviewLastFetchedAt = null;
let dashboardOverviewNextRefreshAt = null;
let dashboardRunInFlight = false;

const DASHBOARD_OVERVIEW_REFRESH_MS = 30 * 1000;

const dashboardNumberFormatter = new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
});

function dashboardSetStatus(type, text) {
    if (!dashboardStatusBadge) {
        return;
    }

    dashboardStatusBadge.className = `status ${type}`;
    dashboardStatusBadge.textContent = text;
}

function dashboardApplyTvMode(enabled) {
    dashboardTvMode = Boolean(enabled);
    document.body.classList.toggle("tv-mode", dashboardTvMode);

    if (dashboardToggleTvModeButton) {
        dashboardToggleTvModeButton.textContent = dashboardTvMode ? "Wyjdz z TV mode" : "TV mode";
        dashboardToggleTvModeButton.classList.toggle("ghost", !dashboardTvMode);
    }

    if (dashboardScreenTvToggleButton) {
        dashboardScreenTvToggleButton.textContent = dashboardTvMode ? "Wyjdz z TV mode" : "TV mode";
        dashboardScreenTvToggleButton.classList.toggle("ghost", !dashboardTvMode);
    }

    try {
        window.localStorage.setItem("productionDashboardTvMode", dashboardTvMode ? "1" : "0");
    } catch (_error) {
        // Ignore storage errors in kiosk-like environments.
    }
}

async function dashboardToggleFullscreen(enabled) {
    if (!document.fullscreenEnabled) {
        return;
    }

    try {
        if (enabled && !document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
        } else if (!enabled && document.fullscreenElement) {
            await document.exitFullscreen();
        }
    } catch (_error) {
        // Ignore fullscreen failures - kiosk browsers may block it.
    }
}

async function dashboardApplyUltrawideMode(enabled) {
    dashboardUltrawideMode = Boolean(enabled);
    document.body.classList.toggle("ultrawide-mode", dashboardUltrawideMode);

    if (dashboardUltrawideMode && !dashboardTvMode) {
        dashboardApplyTvMode(true);
    }

    if (dashboardToggleUltrawideModeButton) {
        dashboardToggleUltrawideModeButton.textContent = dashboardUltrawideMode ? "Wyjdz z 3440 x 1440" : "3440 x 1440";
        dashboardToggleUltrawideModeButton.classList.toggle("ghost", !dashboardUltrawideMode);
    }

    if (dashboardScreenUltrawideToggleButton) {
        dashboardScreenUltrawideToggleButton.textContent = dashboardUltrawideMode ? "Wyjdz z 3440 x 1440" : "3440 x 1440";
        dashboardScreenUltrawideToggleButton.classList.toggle("ghost", !dashboardUltrawideMode);
    }

    try {
        window.localStorage.setItem("productionDashboardUltrawideMode", dashboardUltrawideMode ? "1" : "0");
    } catch (_error) {
        // Ignore storage errors in kiosk-like environments.
    }

    await dashboardToggleFullscreen(dashboardUltrawideMode);
}

function dashboardFormatScreenStationsLabel() {
    if (!dashboardScreenStations.length) {
        return "Stanowiska: nie wybrano";
    }

    return `Stanowiska: ${dashboardScreenStations.join(", ")}`;
}

function dashboardApplyScreenLayout() {
    const isScreenMode = dashboardMode === "screen";
    document.body.classList.toggle("screen-mode", isScreenMode);

    if (dashboardHeroSection) {
        dashboardHeroSection.classList.toggle("hidden", isScreenMode);
    }

    if (dashboardScreenTopbar) {
        dashboardScreenTopbar.classList.toggle("hidden", !isScreenMode);
    }

    for (const panel of dashboardConfigPanels) {
        panel.classList.toggle("hidden", isScreenMode && !dashboardScreenSettingsOpen);
    }

    if (dashboardScreenSettingsToggleButton) {
        dashboardScreenSettingsToggleButton.textContent = dashboardScreenSettingsOpen ? "Ukryj ustawienia" : "Ustawienia";
    }

    if (dashboardScreenTitle) {
        dashboardScreenTitle.textContent = "Ekran produkcyjny";
    }

    if (dashboardScreenMeta) {
        const refreshText = dashboardOverviewRefreshState?.textContent?.trim() || "Ostatnia aktualizacja: -";
        dashboardScreenMeta.textContent = `${dashboardFormatScreenStationsLabel()} • ${refreshText}`;
    }
}

function dashboardSaveScreenSettingsPin(value) {
    dashboardScreenSettingsPin = String(value || "").trim();
    try {
        window.localStorage.setItem("productionDashboardScreenSettingsPin", dashboardScreenSettingsPin);
    } catch (_error) {
        // Ignore storage errors in kiosk-like environments.
    }
}

function dashboardApplyMode(mode) {
    dashboardMode = ["overview", "screen"].includes(mode) ? mode : "single";

    for (const button of dashboardModeButtons) {
        const isActive = button.dataset.dashboardMode === dashboardMode;
        button.classList.toggle("active", isActive);
    }

    const showOverview = dashboardMode === "overview" || dashboardMode === "screen";
    for (const section of dashboardDetailSections) {
        section.classList.toggle("hidden", showOverview);
    }

    if (dashboardOverviewSection) {
        dashboardOverviewSection.classList.toggle("hidden", !showOverview);
    }

    if (dashboardOverviewNote) {
        dashboardOverviewNote.classList.toggle("hidden", !showOverview);
        dashboardOverviewNote.textContent = dashboardMode === "screen"
            ? "Ekran produkcyjny pokazuje tylko stanowiska przypisane do tego monitora i nie korzysta z filtrow operatora ani KKW."
            : "Przeglad produkcji pobiera automatycznie wszystkie aktywne stanowiska i nie korzysta z filtrow operatora ani KKW.";
    }

    if (dashboardOverviewSettings) {
        dashboardOverviewSettings.classList.toggle("hidden", !showOverview);
    }

    for (const button of dashboardOverviewFilterButtons) {
        const isActive = button.dataset.overviewFilter === dashboardOverviewFilter;
        button.classList.toggle("active", isActive && dashboardMode === "overview");
        button.classList.toggle("hidden", dashboardMode !== "overview");
    }

    if (dashboardCollectionTitle) {
        dashboardCollectionTitle.textContent = dashboardMode === "screen"
            ? "Ekran produkcyjny"
            : "Przeglad aktywnych stanowisk";
    }

    if (dashboardCollectionCopy) {
        dashboardCollectionCopy.textContent = dashboardMode === "screen"
            ? "Widok dla stanowisk przypisanych do konkretnego monitora produkcyjnego."
            : "Panel kierownika dla wszystkich aktywnych maszyn i operatorow.";
    }

    dashboardApplyScreenLayout();
}

function dashboardInitTvMode() {
    let storedValue = null;
    let ultrawideValue = null;

    try {
        storedValue = window.localStorage.getItem("productionDashboardTvMode");
        ultrawideValue = window.localStorage.getItem("productionDashboardUltrawideMode");
    } catch (_error) {
        storedValue = null;
        ultrawideValue = null;
    }

    dashboardApplyTvMode(storedValue === "1");
    void dashboardApplyUltrawideMode(ultrawideValue === "1");
}

function dashboardParsePrepStations(value) {
    return String(value || "")
        .split(/[,\n;]+/)
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean);
}

function dashboardSavePrepStations(value) {
    dashboardOverviewPrepStations = dashboardParsePrepStations(value);
    try {
        window.localStorage.setItem("productionDashboardPrepStations", dashboardOverviewPrepStations.join(", "));
    } catch (_error) {
        // Ignore storage errors in kiosk-like environments.
    }
}

function dashboardInitOverviewSettings() {
    let storedValue = "";
    let screenStationsValue = "";
    let screenSettingsPinValue = "";

    try {
        storedValue = window.localStorage.getItem("productionDashboardPrepStations") || "";
        screenStationsValue = window.localStorage.getItem("productionDashboardScreenStations") || "";
        screenSettingsPinValue = window.localStorage.getItem("productionDashboardScreenSettingsPin") || "";
    } catch (_error) {
        storedValue = "";
        screenStationsValue = "";
        screenSettingsPinValue = "";
    }

    dashboardOverviewPrepStations = dashboardParsePrepStations(storedValue);
    dashboardScreenStations = dashboardParsePrepStations(screenStationsValue);
    dashboardScreenSettingsPin = String(screenSettingsPinValue || "").trim();

    if (dashboardOverviewPrepStationsInput) {
        dashboardOverviewPrepStationsInput.value = dashboardOverviewPrepStations.join(", ");
    }

    if (dashboardScreenStationsInput) {
        dashboardScreenStationsInput.value = dashboardScreenStations.join(", ");
    }

    if (dashboardScreenSettingsPinInput) {
        dashboardScreenSettingsPinInput.value = dashboardScreenSettingsPin;
    }

    let autoRefreshValue = "1";
    let filterValue = "all";
    let densityValue = "standard";

    try {
        autoRefreshValue = window.localStorage.getItem("productionDashboardOverviewAutoRefresh") || "1";
        filterValue = window.localStorage.getItem("productionDashboardOverviewFilter") || "all";
        densityValue = window.localStorage.getItem("productionDashboardOverviewDensity") || "standard";
    } catch (_error) {
        autoRefreshValue = "1";
        filterValue = "all";
        densityValue = "standard";
    }

    dashboardOverviewAutoRefresh = autoRefreshValue !== "0";
    dashboardOverviewFilter = filterValue;
    dashboardOverviewDensity = ["standard", "dense", "compact"].includes(densityValue) ? densityValue : "standard";

    if (dashboardOverviewAutoRefreshInput) {
        dashboardOverviewAutoRefreshInput.checked = dashboardOverviewAutoRefresh;
    }

    if (dashboardOverviewDensityInput) {
        dashboardOverviewDensityInput.value = dashboardOverviewDensity;
    }
}

function dashboardFormatNumber(value, suffix = "") {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return "-";
    }

    return `${dashboardNumberFormatter.format(Number(value))}${suffix}`;
}

function dashboardFormatPercent(value) {
    return dashboardFormatNumber(value, "%");
}

function dashboardFormatDateTime(value) {
    if (!value) {
        return "-";
    }

    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
        return "-";
    }

    return new Intl.DateTimeFormat("pl-PL", {
        dateStyle: "short",
        timeStyle: "short",
    }).format(date);
}

function dashboardFormatDateTimeSeconds(value) {
    if (!value) {
        return "-";
    }

    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
        return "-";
    }

    return new Intl.DateTimeFormat("pl-PL", {
        dateStyle: "short",
        timeStyle: "medium",
    }).format(date);
}

function dashboardFormatDurationHours(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return "-";
    }

    const totalMinutes = Math.max(Math.round(Number(value) * 60), 0);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

function dashboardFormatDurationMinutes(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return "-";
    }

    const totalMinutes = Math.max(Math.round(Number(value)), 0);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

function dashboardFormatDurationSeconds(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return "-";
    }

    const totalSeconds = Math.max(Math.round(Number(value)), 0);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes.toString().padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`;
    }

    if (minutes > 0) {
        return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
    }

    return `${seconds}s`;
}

function dashboardFormatExpectedRate(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value)) || Number(value) <= 0) {
        return "-";
    }

    return `${dashboardNumberFormatter.format(Number(value))} szt./h`;
}

function dashboardFormatCycleTimeFromRate(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value)) || Number(value) <= 0) {
        return "-";
    }

    return dashboardFormatDurationSeconds(3600 / Number(value));
}

function dashboardGetLiveMetrics(metrics) {
    const startedAt = metrics?.startedAt ? new Date(metrics.startedAt) : null;
    const hasStarted = startedAt && Number.isFinite(startedAt.getTime());
    const elapsedHours = hasStarted
        ? Math.max((Date.now() - startedAt.getTime()) / 36e5, 0)
        : metrics?.elapsedHours ?? null;
    const plannedTotalHours = Number(metrics?.plannedTotalHours || 0) || 0;
    const plannedPrepMinutes = Number(metrics?.plannedPrepMinutes || 0) || 0;
    const plannedPrepHours = plannedPrepMinutes > 0 ? plannedPrepMinutes / 60 : 0;
    const plannedWorkHours = Number(metrics?.plannedWorkHours || 0) || 0;
    const activePhaseKey = metrics?.activePhase?.key || "unknown";
    const timeProgressPercent = plannedTotalHours > 0 && elapsedHours !== null
        ? (elapsedHours / plannedTotalHours) * 100
        : metrics?.timeProgressPercent ?? 0;
    const timeRemainingHours = plannedTotalHours > 0 && elapsedHours !== null
        ? plannedTotalHours - elapsedHours
        : metrics?.timeRemainingHours ?? null;
    const timeDeltaHours = plannedTotalHours > 0 && elapsedHours !== null
        ? elapsedHours - plannedTotalHours
        : metrics?.timeDeltaHours ?? null;
    const prepElapsedHours = metrics?.prepElapsedHours !== null && metrics?.prepElapsedHours !== undefined
        ? Number(metrics.prepElapsedHours)
        : activePhaseKey === "prep" && elapsedHours !== null
            ? elapsedHours
            : null;
    const productionElapsedHours = activePhaseKey === "production" && elapsedHours !== null
        ? elapsedHours
        : metrics?.productionElapsedHours !== null && metrics?.productionElapsedHours !== undefined
            ? Number(metrics.productionElapsedHours)
            : null;
    const prepProgressPercent = plannedPrepHours > 0 && prepElapsedHours !== null
        ? (prepElapsedHours / plannedPrepHours) * 100
        : metrics?.prepProgressPercent ?? 0;
    const productionProgressPercent = plannedWorkHours > 0 && productionElapsedHours !== null
        ? (productionElapsedHours / plannedWorkHours) * 100
        : metrics?.productionProgressPercent ?? 0;

    let timeStatus = "Brak normy czasowej";
    let timeStatusTone = "idle";
    if (plannedTotalHours > 0 && elapsedHours !== null) {
        if (timeProgressPercent <= 95) {
            timeStatus = "W normie czasowej";
            timeStatusTone = "success";
        } else if (timeProgressPercent <= 105) {
            timeStatus = "Blisko limitu czasu";
            timeStatusTone = "loading";
        } else {
            timeStatus = "Po czasie";
            timeStatusTone = "error";
        }
    }

    return {
        ...metrics,
        elapsedHours,
        timeProgressPercent,
        timeRemainingHours,
        timeDeltaHours,
        prepElapsedHours,
        productionElapsedHours,
        prepProgressPercent,
        productionProgressPercent,
        timeStatus,
        timeStatusTone,
    };
}

function dashboardBuildStatusLabel(hours) {
    if (hours === null || hours === undefined || Number.isNaN(Number(hours))) {
        return "-";
    }

    const value = Number(hours);
    if (value < 0) {
        return `przekroczenie ${dashboardFormatDurationHours(Math.abs(value))}`;
    }

    return `zapas ${dashboardFormatDurationHours(value)}`;
}

function dashboardGetPhaseCardClass(activePhase, phaseKey) {
    const activeClass = activePhase?.key === phaseKey ? " phase-card-active" : "";
    return `phase-card phase-card-${phaseKey}${activeClass}`;
}

function dashboardGetPrepBadge(metrics) {
    if ((metrics.plannedPrepMinutes || 0) <= 0) {
        return { label: "Brak normy", className: "phase-badge waiting" };
    }

    if (metrics.activePhase?.key === "prep") {
        return { label: "Aktywny", className: "phase-badge active" };
    }

    if (metrics.activePhase?.key === "production" || (metrics.prepProgressPercent || 0) >= 100) {
        return { label: "Wykonano", className: "phase-badge complete" };
    }

    if ((metrics.prepProgressPercent || 0) > 0) {
        return { label: "W toku", className: "phase-badge loading" };
    }

    return { label: "Nieaktywny", className: "phase-badge waiting" };
}

function dashboardFormatOverviewRefreshState() {
    if (!dashboardOverviewLastFetchedAt) {
        return "Ostatnia aktualizacja: -";
    }

    const suffix = dashboardOverviewAutoRefresh && dashboardOverviewNextRefreshAt
        ? ` • odswieza za ${Math.max(Math.ceil((dashboardOverviewNextRefreshAt - Date.now()) / 1000), 0)}s`
        : "";

    return `Ostatnia aktualizacja: ${dashboardFormatDateTimeSeconds(dashboardOverviewLastFetchedAt)}${suffix}`;
}

function dashboardGetPrepResult(metrics) {
    const plannedPrepMinutes = Number(metrics?.plannedPrepMinutes || 0);
    const prepElapsedHours = metrics?.prepElapsedHours !== null && metrics?.prepElapsedHours !== undefined
        ? Number(metrics.prepElapsedHours)
        : null;

    if (plannedPrepMinutes <= 0 || prepElapsedHours === null || Number.isNaN(prepElapsedHours)) {
        return {
            label: "Brak wyniku",
            remaining: "-",
            className: "phase-badge waiting",
        };
    }

    const plannedPrepHours = plannedPrepMinutes / 60;
    const deltaHours = prepElapsedHours - plannedPrepHours;

    if (Math.abs(deltaHours) < (1 / 120)) {
        return {
            label: "Rowno z norma",
            remaining: "0h 00m",
            className: "phase-badge complete",
        };
    }

    if (deltaHours < 0) {
        return {
            label: "Ponizej normy",
            remaining: dashboardFormatDurationHours(Math.abs(deltaHours)),
            className: "phase-badge loading",
        };
    }

    return {
        label: "Przekroczono norme",
        remaining: `-${dashboardFormatDurationHours(deltaHours)}`,
        className: "phase-badge error",
    };
}

function dashboardGetProductionBadge(metrics) {
    if ((metrics.plannedWorkHours || 0) <= 0) {
        return { label: "Brak normy", className: "phase-badge waiting" };
    }

    if (metrics.activePhase?.key === "prep") {
        return { label: "Oczekuje", className: "phase-badge waiting" };
    }

    if (metrics.activePhase?.key === "production") {
        return { label: "Aktywny", className: "phase-badge active" };
    }

    if ((metrics.productionProgressPercent || 0) >= 100) {
        return { label: "Wykonano", className: "phase-badge complete" };
    }

    if ((metrics.productionProgressPercent || 0) > 0) {
        return { label: "W toku", className: "phase-badge loading" };
    }

    return { label: "Oczekuje", className: "phase-badge waiting" };
}

function dashboardSyncLiveView() {
    if (!dashboardCurrentData) {
        return;
    }

    if (dashboardMode === "overview" || dashboardMode === "screen") {
        renderDashboardSummary(dashboardCurrentData);
        if (dashboardMode === "screen") {
            renderProductionScreen(dashboardCurrentData);
        } else {
            renderProductionOverview(dashboardCurrentData);
        }
        renderDashboardDebug(dashboardCurrentData);
        if (dashboardOverviewRefreshState) {
            dashboardOverviewRefreshState.textContent = dashboardFormatOverviewRefreshState();
        }
        dashboardApplyScreenLayout();
        if (
            dashboardOverviewAutoRefresh
            && dashboardOverviewNextRefreshAt
            && Date.now() >= dashboardOverviewNextRefreshAt
            && !dashboardRunInFlight
        ) {
            void runDashboard({ silent: true, preserveView: true, source: "auto-refresh" });
        }
        dashboardSetStatus("success", dashboardMode === "screen" ? "Ekran produkcyjny" : "Przeglad produkcji");
        return;
    }

    const liveData = {
        ...dashboardCurrentData,
        metrics: dashboardGetLiveMetrics(dashboardCurrentData.metrics || {}),
    };

    renderDashboardSummary(liveData);
    renderDashboardHero(liveData);
    renderDashboardMetrics(liveData);
    renderDashboardTimeline(liveData);
    renderDashboardDebug(liveData);
    dashboardSetStatus(
        liveData.metrics?.timeStatusTone || liveData.metrics?.statusTone || "success",
        liveData.metrics?.timeStatus || liveData.metrics?.status || "Gotowe"
    );
}

function dashboardStartClock() {
    if (dashboardClockTimer) {
        clearInterval(dashboardClockTimer);
    }

    dashboardClockTimer = setInterval(() => {
        dashboardSyncLiveView();
    }, 1000);
}

function dashboardStopClock() {
    if (dashboardClockTimer) {
        clearInterval(dashboardClockTimer);
        dashboardClockTimer = null;
    }
}

function dashboardCollectPayload() {
    const basePayload = {
        vendoUserLogin: dashboardConnectionForm?.vendoUserLogin?.value?.trim() || "",
        vendoUserPassword: dashboardConnectionForm?.vendoUserPassword?.value || "",
    };

    if (dashboardMode === "overview" || dashboardMode === "screen") {
        return basePayload;
    }

    return {
        ...basePayload,
        operatorName: dashboardForm?.operatorName?.value?.trim() || "",
        kkwNumber: dashboardForm?.kkwNumber?.value?.trim() || "",
        stationCode: dashboardForm?.stationCode?.value?.trim() || "",
        operationName: dashboardForm?.operationName?.value?.trim() || "",
    };
}

async function dashboardPostJson(url, payload) {
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

function clearDashboardView() {
    dashboardCurrentData = null;
    dashboardOverviewLastFetchedAt = null;
    dashboardOverviewNextRefreshAt = null;
    dashboardStopClock();
    dashboardError?.classList.add("hidden");
    if (dashboardError) {
        dashboardError.textContent = "";
    }

    if (dashboardSummary) {
        dashboardSummary.classList.add("hidden");
        dashboardSummary.innerHTML = "";
    }

    if (dashboardHero) {
        dashboardHero.className = "dashboard-hero-empty";
        dashboardHero.textContent = "Uruchom dashboard, aby pobrac aktywne dane operatorskie z Vendo.";
    }

    if (dashboardMetrics) {
        dashboardMetrics.className = "dashboard-metrics-empty";
        dashboardMetrics.textContent = "Brak danych.";
    }

    if (dashboardTimeline) {
        dashboardTimeline.className = "dashboard-metrics-empty";
        dashboardTimeline.textContent = "Brak danych.";
    }

    if (dashboardOverviewGrid) {
        dashboardOverviewGrid.className = "dashboard-overview-empty";
        dashboardOverviewGrid.textContent = "Uruchom przeglad produkcji, aby pobrac aktywne stanowiska z Vendo.";
    }

    if (dashboardOverviewRefreshState) {
        dashboardOverviewRefreshState.textContent = "Ostatnia aktualizacja: -";
    }

    dashboardApplyScreenLayout();

    if (dashboardDebug) {
        dashboardDebug.className = "dashboard-debug-empty";
        dashboardDebug.textContent = "Brak danych debug.";
    }

    if (dashboardRawOutput) {
        dashboardRawOutput.textContent = "Brak danych.";
    }
}

function renderDashboardSummary(data) {
    if (dashboardMode === "screen") {
        dashboardSummary.classList.add("hidden");
        dashboardSummary.innerHTML = "";
        return;
    }

    if (dashboardMode === "overview") {
        return renderOverviewSummary(data);
    }

    const metrics = dashboardGetLiveMetrics(data.metrics || {});
    const cards = [
        ["Aktywny etap", metrics.activePhase?.label || "-"],
        ["Status czasu", metrics.timeStatus || "-"],
        ["Zuzycie normy", dashboardFormatPercent(metrics.timeProgressPercent || 0)],
        ["Czas do normy", dashboardBuildStatusLabel(metrics.timeRemainingHours)],
    ];

    dashboardSummary.innerHTML = cards.map(([label, value]) => `
        <div class="summary-card">
            <span>${label}</span>
            <strong>${value}</strong>
        </div>
    `).join("");
    dashboardSummary.classList.remove("hidden");
}

function renderOverviewSummary(data) {
    const summary = data.summary || {};
    const cards = [
        ["Aktywne stanowiska", dashboardFormatNumber(summary.activeStations || 0)],
        ["Aktywni operatorzy", dashboardFormatNumber(summary.activeOperators || 0)],
        ["Aktywne KKW", dashboardFormatNumber(summary.activeKkws || 0)],
        ["Status", "Przeglad produkcji"],
    ];

    dashboardSummary.innerHTML = cards.map(([label, value]) => `
        <div class="summary-card">
            <span>${label}</span>
            <strong>${value}</strong>
        </div>
    `).join("");
    dashboardSummary.classList.remove("hidden");
}

function renderDashboardHero(data) {
    const { kkw = {}, operator = {}, operation = {}, station = {}, worker = {} } = data;
    const metrics = dashboardGetLiveMetrics(data.metrics || {});
    const activePhaseClass = metrics.activePhase?.key === "prep"
        ? "dashboard-mini-card phase-chip prep"
        : metrics.activePhase?.key === "production"
            ? "dashboard-mini-card phase-chip production"
            : "dashboard-mini-card";
    dashboardHero.className = "dashboard-hero";
    dashboardHero.innerHTML = `
        <div class="dashboard-hero-main">
            <span>${kkw.orderNumber || "Brak numeru zlecenia"}</span>
            <strong>${kkw.number || "-"} • ${operation.name || "-"}</strong>
            <span>${kkw.productCode || "-"} ${kkw.productName ? `- ${kkw.productName}` : ""}</span>
        </div>
        <div class="dashboard-hero-meta">
            <div class="dashboard-mini-card">
                <span>Operator</span>
                <strong>${operator.name || "-"}</strong>
            </div>
            <div class="dashboard-mini-card">
                <span>Stanowisko</span>
                <strong>${station.code || "-"}</strong>
            </div>
            <div class="dashboard-mini-card">
                <span>Start pracy</span>
                <strong>${dashboardFormatDateTimeSeconds(metrics.startedAt || worker.DataRozpoczecia)}</strong>
            </div>
            <div class="${activePhaseClass}">
                <span>Na co nabity</span>
                <strong>${metrics.activePhase?.label || "-"}</strong>
            </div>
            <div class="dashboard-mini-card">
                <span>Zrodlo etapu</span>
                <strong>${metrics.activePhase?.source || "-"}</strong>
            </div>
        </div>
    `;
}

function renderDashboardMetrics(data) {
    const metrics = dashboardGetLiveMetrics(data.metrics || {});
    const prepWidth = Math.max(0, Math.min(metrics.prepProgressPercent || 0, 100));
    const prepBadge = dashboardGetPrepBadge(metrics);
    const prepResult = dashboardGetPrepResult(metrics);

    dashboardMetrics.className = "phase-panel";
    dashboardMetrics.innerHTML = `
        <section class="${dashboardGetPhaseCardClass(metrics.activePhase, "prep")}">
            <div class="phase-card-header">
                <div>
                    <span class="phase-card-eyebrow">Etap</span>
                    <h4>Przyrzad</h4>
                </div>
                <span class="${prepBadge.className}">${prepBadge.label}</span>
            </div>
            <div class="dashboard-metric-row">
                <span>Norma</span>
                <strong>${dashboardFormatDurationMinutes(metrics.plannedPrepMinutes)}</strong>
            </div>
            <div class="dashboard-metric-row">
                <span>Czas wykorzystany</span>
                <strong>${dashboardFormatDurationHours(metrics.prepElapsedHours)}</strong>
            </div>
            <div class="dashboard-metric-row">
                <span>Zuzycie normy</span>
                <strong>${dashboardFormatPercent(metrics.prepProgressPercent)}</strong>
            </div>
            <div class="dashboard-metric-row">
                <span>Pozostalo</span>
                <strong>${prepResult.remaining}</strong>
            </div>
            <div class="dashboard-inline-badge-row">
                <span class="${prepResult.className}">${prepResult.label}</span>
            </div>
            <div class="dashboard-progress">
                <div class="dashboard-progress-bar" style="width: ${prepWidth}%"></div>
            </div>
        </section>
    `;
}

function renderDashboardTimeline(data) {
    const metrics = dashboardGetLiveMetrics(data.metrics || {});
    const productionWidth = Math.max(0, Math.min(metrics.productionProgressPercent || 0, 100));
    const productionBadge = dashboardGetProductionBadge(metrics);
    const productionStarted = metrics.activePhase?.key === "production" || (Number(metrics.completedQuantity || 0) > 0) || (Number(metrics.productionElapsedHours || 0) > 0);
    dashboardTimeline.className = "phase-panel";
    dashboardTimeline.innerHTML = `
        <section class="${dashboardGetPhaseCardClass(metrics.activePhase, "production")}">
            <div class="phase-card-header">
                <div>
                    <span class="phase-card-eyebrow">Etap</span>
                    <h4>Produkcja</h4>
                </div>
                <span class="${productionBadge.className}">${productionBadge.label}</span>
            </div>
            <div class="dashboard-metric-row">
                <span>Norma</span>
                <strong>${dashboardFormatDurationHours(metrics.plannedWorkHours)}</strong>
            </div>
            <div class="dashboard-metric-row">
                <span>Planowana wydajnosc</span>
                <strong>${dashboardFormatExpectedRate(metrics.expectedRate)}</strong>
            </div>
            <div class="dashboard-metric-row">
                <span>Czas 1 szt. wg normy</span>
                <strong>${dashboardFormatCycleTimeFromRate(metrics.expectedRate)}</strong>
            </div>
            <div class="dashboard-metric-row">
                <span>Ilosc do wykonania</span>
                <strong>${dashboardFormatNumber(metrics.plannedQuantity)} szt.</strong>
            </div>
            <div class="dashboard-metric-row">
                <span>Wykonano</span>
                <strong>${dashboardFormatNumber(metrics.completedQuantity)} szt.</strong>
            </div>
            <div class="dashboard-metric-row">
                <span>Pozostalo</span>
                <strong>${dashboardFormatNumber(metrics.remainingQuantity)} szt.</strong>
            </div>
            <div class="dashboard-metric-row">
                <span>Czas wykorzystany</span>
                <strong>${productionStarted ? dashboardFormatDurationHours(metrics.productionElapsedHours) : "-"}</strong>
            </div>
            <div class="dashboard-metric-row">
                <span>Zuzycie normy</span>
                <strong>${productionStarted ? dashboardFormatPercent(metrics.productionProgressPercent) : "-"}</strong>
            </div>
            <div class="dashboard-metric-row">
                <span>Zakladany koniec</span>
                <strong>${productionStarted ? dashboardFormatDateTime(metrics.expectedFinishAt) : "-"}</strong>
            </div>
            <div class="dashboard-metric-row">
                <span>Przewidywany koniec</span>
                <strong>${productionStarted ? dashboardFormatDateTime(metrics.predictedFinishAt) : "-"}</strong>
            </div>
            <div class="dashboard-progress">
                <div class="dashboard-progress-bar" style="width: ${productionWidth}%"></div>
            </div>
        </section>
    `;
}

function renderDashboardDebug(data) {
    const debugPanel = dashboardDebug?.closest("section");
    const rawPanel = dashboardRawOutput?.closest(".raw-panel");

    if (dashboardMode === "screen") {
        if (debugPanel) {
            debugPanel.classList.add("hidden");
        }
        dashboardDebug.className = "dashboard-debug-empty hidden";
        dashboardDebug.textContent = "Brak danych debug.";
        if (rawPanel) {
            rawPanel.classList.add("hidden");
        }
        return;
    }

    const debug = data.debug || {};
    const metrics = dashboardGetLiveMetrics(data.metrics || {});
    if (debugPanel) {
        debugPanel.classList.remove("hidden");
    }
    if (rawPanel) {
        rawPanel.classList.remove("hidden");
    }
    dashboardDebug.className = "dashboard-debug-grid";
    dashboardDebug.innerHTML = `
        <div class="dashboard-mini-card">
            <span>Dopasowane operacje</span>
            <strong>${dashboardFormatNumber(debug.matchedOperations || 0)}</strong>
        </div>
        <div class="dashboard-mini-card">
            <span>Dopasowane stanowiska</span>
            <strong>${dashboardFormatNumber(debug.matchedStations || 0)}</strong>
        </div>
        <div class="dashboard-mini-card">
            <span>Dopasowani pracownicy wykonan</span>
            <strong>${dashboardFormatNumber(debug.matchedWorkers || 0)}</strong>
        </div>
        <div class="dashboard-mini-card">
            <span>Dopasowane aktywne prace</span>
            <strong>${dashboardFormatNumber(debug.matchedWorklogs || 0)}</strong>
        </div>
        <div class="dashboard-mini-card">
            <span>Rodzaje wykonan</span>
            <strong>${Array.isArray(debug.executionKinds) && debug.executionKinds.length ? debug.executionKinds.join(", ") : "-"}</strong>
        </div>
        <div class="dashboard-mini-card">
            <span>Surowy czas z Vendo</span>
            <strong>${dashboardFormatNumber(metrics.rawPlannedWorkValue || 0)}</strong>
        </div>
        <div class="dashboard-mini-card">
            <span>Plan z normy</span>
            <strong>${dashboardFormatDurationHours(metrics.plannedWorkHours)}</strong>
        </div>
        <div class="dashboard-mini-card">
            <span>Prep elapsed raw</span>
            <strong>${dashboardFormatNumber(metrics.prepElapsedHours || 0, " h")}</strong>
        </div>
        <div class="dashboard-mini-card">
            <span>TPZ operacji</span>
            <strong>${dashboardFormatNumber(data.operation?.tpz || 0, " min")}</strong>
        </div>
        <div class="dashboard-mini-card">
            <span>TPZ stanowiska</span>
            <strong>${dashboardFormatNumber(data.station?.tpz || 0, " min")}</strong>
        </div>
        <div class="dashboard-mini-card">
            <span>Wykonania debug</span>
            <strong>${Array.isArray(debug.executionRecords) && debug.executionRecords.length
                ? debug.executionRecords
                    .slice(0, 3)
                    .map((item) => `${item.kind || "-"} ${item.startedAt || "-"} ${item.endedAt || "-"}`)
                    .join(" | ")
                : "-"}</strong>
        </div>
    `;
}

function dashboardInferDepartment(record) {
    const stationCode = String(record?.station?.code || "").toUpperCase();

    if (stationCode.startsWith("SMD")) {
        return "SMD";
    }
    if (stationCode.startsWith("AOI")) {
        return "AOI";
    }
    if (stationCode.startsWith("THT")) {
        return "THT";
    }
    if (stationCode.startsWith("FALA")) {
        return "FALA";
    }
    if (stationCode.startsWith("TEST")) {
        return "TEST";
    }
    if (stationCode.includes("PAKOWANIE")) {
        return "PAKOWANIE";
    }

    return "INNE";
}

function dashboardShouldShowPrep(record, metrics) {
    const stationCode = String(record?.station?.code || "").trim().toUpperCase();
    const configuredStations = dashboardOverviewPrepStations;
    const listedStation = stationCode && configuredStations.includes(stationCode);
    const activePrep = metrics?.activePhase?.key === "prep";

    if (!configuredStations.length) {
        return activePrep;
    }

    return listedStation || activePrep;
}

function dashboardGetScreenRecords(data) {
    const allRecords = Array.isArray(data?.records) ? data.records : [];
    if (!dashboardScreenStations.length) {
        return [];
    }

    return allRecords.filter((record) => dashboardScreenStations.includes(String(record?.station?.code || "").trim().toUpperCase()));
}

function dashboardGetOverviewCategory(record) {
    const metrics = dashboardGetLiveMetrics(record.metrics || {});

    if (metrics.activePhase?.key === "prep") {
        return "prep";
    }

    if (metrics.timeStatusTone === "error" || Number(metrics.timeDeltaHours || 0) > 0) {
        return "late";
    }

    if (
        metrics.timeStatusTone === "loading"
        || metrics.statusTone === "error"
        || metrics.statusTone === "loading"
    ) {
        return "risk";
    }

    return "production";
}

function dashboardGetOverviewPriority(record) {
    const metrics = dashboardGetLiveMetrics(record.metrics || {});
    const category = dashboardGetOverviewCategory(record);
    const categoryRank = {
        late: 0,
        risk: 1,
        prep: 2,
        production: 3,
    };

    return [
        categoryRank[category] ?? 4,
        -(Number(metrics.timeProgressPercent) || 0),
        -(Number(metrics.productionProgressPercent) || 0),
        String(record.station?.code || ""),
    ];
}

function dashboardCompareOverviewRecords(left, right) {
    const leftPriority = dashboardGetOverviewPriority(left);
    const rightPriority = dashboardGetOverviewPriority(right);

    for (let index = 0; index < leftPriority.length; index += 1) {
        if (leftPriority[index] < rightPriority[index]) {
            return -1;
        }
        if (leftPriority[index] > rightPriority[index]) {
            return 1;
        }
    }

    return 0;
}

function renderOverviewCard(record) {
    const metrics = dashboardGetLiveMetrics(record.metrics || {});
    const category = dashboardGetOverviewCategory(record);
    const prepBadge = dashboardGetPrepBadge(metrics);
    const prepResult = dashboardGetPrepResult(metrics);
    const productionBadge = dashboardGetProductionBadge(metrics);
    const productionWidth = Math.max(0, Math.min(metrics.productionProgressPercent || 0, 100));
    const productionStarted = metrics.activePhase?.key === "production" || (Number(metrics.completedQuantity || 0) > 0) || (Number(metrics.productionElapsedHours || 0) > 0);
    const productLabel = [record.kkw?.productCode, record.kkw?.productName].filter(Boolean).join(" - ") || record.kkw?.productName || record.kkw?.productCode || "-";
    const showPrep = dashboardShouldShowPrep(record, metrics);
    const prepSection = showPrep ? `
        <section class="overview-card-prep ${metrics.activePhase?.key === "prep" ? "overview-card-prep-active" : ""}">
            <div class="overview-card-prep-header">
                <div>
                    <span class="phase-card-eyebrow">Przyrzad</span>
                    <strong>${dashboardFormatDurationMinutes(metrics.plannedPrepMinutes)}</strong>
                </div>
                <div class="overview-card-prep-badges">
                    <span class="${prepBadge.className}">${prepBadge.label}</span>
                    <span class="${prepResult.className}">${prepResult.label}</span>
                </div>
            </div>
            <div class="overview-card-prep-grid">
                <div class="overview-card-prep-item">
                    <span>Norma</span>
                    <strong>${dashboardFormatDurationMinutes(metrics.plannedPrepMinutes)}</strong>
                </div>
                <div class="overview-card-prep-item">
                    <span>Czas</span>
                    <strong>${dashboardFormatDurationHours(metrics.prepElapsedHours)}</strong>
                </div>
                <div class="overview-card-prep-item">
                    <span>% normy</span>
                    <strong>${dashboardFormatPercent(metrics.prepProgressPercent)}</strong>
                </div>
                <div class="overview-card-prep-item">
                    <span>Pozostalo</span>
                    <strong>${prepResult.remaining}</strong>
                </div>
            </div>
        </section>
    ` : "";

    return `
        <article class="overview-card overview-card-tone-${category}">
            <div class="overview-card-header">
                <div>
                    <span class="phase-card-eyebrow">${record.station?.code || "-"}</span>
                    <h4>${record.operation?.name || "-"}</h4>
                </div>
                <div class="overview-card-kkw">
                    <span class="phase-badge neutral">${record.kkw?.number || "-"}</span>
                    <span class="overview-card-product">${productLabel}</span>
                </div>
            </div>
            <div class="overview-card-meta">
                <span>${record.operator?.name || "-"}</span>
                <strong>${dashboardFormatDateTime(metrics.startedAt || record.execution?.startedAt)}</strong>
            </div>
            ${prepSection}
            <section class="${dashboardGetPhaseCardClass(metrics.activePhase, "production")} overview-card-production">
                <div class="phase-card-header">
                    <div>
                        <span class="phase-card-eyebrow">Etap</span>
                        <h4>Produkcja</h4>
                    </div>
                    <span class="${productionBadge.className}">${productionBadge.label}</span>
                </div>
                <div class="overview-card-production-grid">
                    <div class="dashboard-metric-row">
                        <span>Norma</span>
                        <strong>${dashboardFormatDurationHours(metrics.plannedWorkHours)}</strong>
                    </div>
                    <div class="dashboard-metric-row">
                        <span>Planowana wydajnosc</span>
                        <strong>${dashboardFormatExpectedRate(metrics.expectedRate)}</strong>
                    </div>
                    <div class="dashboard-metric-row">
                        <span>Czas 1 szt. wg normy</span>
                        <strong>${dashboardFormatCycleTimeFromRate(metrics.expectedRate)}</strong>
                    </div>
                    <div class="dashboard-metric-row">
                        <span>Czas</span>
                        <strong>${productionStarted ? dashboardFormatDurationHours(metrics.productionElapsedHours) : "-"}</strong>
                    </div>
                    <div class="dashboard-metric-row">
                        <span>Ilosc do wykonania</span>
                        <strong>${dashboardFormatNumber(metrics.plannedQuantity)} szt.</strong>
                    </div>
                    <div class="dashboard-metric-row">
                        <span>Wykonano</span>
                        <strong>${dashboardFormatNumber(metrics.completedQuantity)} szt.</strong>
                    </div>
                    <div class="dashboard-metric-row">
                        <span>Pozostalo</span>
                        <strong>${dashboardFormatNumber(metrics.remainingQuantity)} szt.</strong>
                    </div>
                    <div class="dashboard-metric-row">
                        <span>% normy</span>
                        <strong>${productionStarted ? dashboardFormatPercent(metrics.productionProgressPercent) : "-"}</strong>
                    </div>
                    <div class="dashboard-metric-row">
                        <span>Planowane zakonczenie</span>
                        <strong>${productionStarted ? dashboardFormatDateTime(metrics.expectedFinishAt) : "-"}</strong>
                    </div>
                </div>
                <div class="dashboard-progress">
                    <div class="dashboard-progress-bar" style="width: ${productionWidth}%"></div>
                </div>
            </section>
        </article>
    `;
}

function renderProductionOverview(data) {
    const allRecords = Array.isArray(data.records) ? data.records : [];

    if (!dashboardOverviewGrid) {
        return;
    }

    const records = allRecords.filter((record) => {
        if (dashboardOverviewFilter === "all") {
            return true;
        }

        return dashboardGetOverviewCategory(record) === dashboardOverviewFilter;
    });

    if (!records.length) {
        dashboardOverviewGrid.className = "dashboard-overview-empty";
        dashboardOverviewGrid.textContent = "Brak stanowisk dla wybranego filtra.";
        return;
    }

    const departmentOrder = ["SMD", "AOI", "THT", "FALA", "TEST", "PAKOWANIE", "INNE"];
    const groupedRecords = new Map();

    for (const record of records) {
        const department = dashboardInferDepartment(record);
        if (!groupedRecords.has(department)) {
            groupedRecords.set(department, []);
        }
        groupedRecords.get(department).push(record);
    }

    const sections = departmentOrder
        .filter((department) => groupedRecords.has(department))
        .map((department) => {
            const departmentRecords = groupedRecords.get(department).slice().sort(dashboardCompareOverviewRecords);

            return `
                <section class="overview-department">
                    <div class="overview-department-header">
                        <div>
                            <span class="phase-card-eyebrow">Dzial</span>
                            <h4>${department}</h4>
                        </div>
                        <span class="phase-badge neutral">${departmentRecords.length}</span>
                    </div>
                    <div class="dashboard-overview-grid">
                        ${departmentRecords.map((record) => renderOverviewCard(record)).join("")}
                    </div>
                </section>
            `;
        });

    dashboardOverviewGrid.className = `dashboard-overview-groups overview-density-${dashboardOverviewDensity}`;
    dashboardOverviewGrid.innerHTML = sections.join("");
}

function renderProductionScreen(data) {
    if (!dashboardOverviewGrid) {
        return;
    }

    if (!dashboardScreenStations.length) {
        dashboardOverviewGrid.className = "dashboard-overview-empty";
        dashboardOverviewGrid.textContent = "Ustaw stanowiska dla tego ekranu, aby pokazac lokalny panel produkcyjny.";
        return;
    }

    const records = dashboardGetScreenRecords(data);
    if (!records.length) {
        dashboardOverviewGrid.className = "dashboard-overview-empty";
        dashboardOverviewGrid.textContent = "Brak aktywnych prac dla stanowisk przypisanych do tego ekranu.";
        return;
    }

    const sortedRecords = records.slice().sort(dashboardCompareOverviewRecords);
    if (sortedRecords.length === 1) {
        dashboardOverviewGrid.className = "dashboard-screen-single";
        dashboardOverviewGrid.innerHTML = renderOverviewCard(sortedRecords[0]);
        return;
    }

    dashboardOverviewGrid.className = "dashboard-screen-grid";
    dashboardOverviewGrid.innerHTML = sortedRecords.map((record) => renderOverviewCard(record)).join("");
}

function dashboardSetOverviewFilter(filter) {
    dashboardOverviewFilter = filter || "all";

    for (const button of dashboardOverviewFilterButtons) {
        const isActive = button.dataset.overviewFilter === dashboardOverviewFilter;
        button.classList.toggle("active", isActive);
    }

    try {
        window.localStorage.setItem("productionDashboardOverviewFilter", dashboardOverviewFilter);
    } catch (_error) {
        // Ignore storage errors in kiosk-like environments.
    }

    if ((dashboardMode === "overview" || dashboardMode === "screen") && dashboardCurrentData) {
        if (dashboardMode === "screen") {
            renderProductionScreen(dashboardCurrentData);
        } else {
            renderProductionOverview(dashboardCurrentData);
        }
    }
}

async function runDashboard(options = {}) {
    const { silent = false, preserveView = false, source = "manual" } = options;

    if (dashboardRunInFlight) {
        return;
    }

    dashboardRunInFlight = true;

    if (!preserveView) {
        clearDashboardView();
    }

    if (!silent) {
        dashboardSetStatus("loading", "Pobieranie");
    }

    dashboardSubmitButton.disabled = true;

    try {
        const endpoint = (dashboardMode === "overview" || dashboardMode === "screen")
            ? "/api/production-overview"
            : "/api/production-dashboard";
        const data = await dashboardPostJson(endpoint, dashboardCollectPayload());
        dashboardCurrentData = data;
        if (dashboardMode === "overview" || dashboardMode === "screen") {
            dashboardOverviewLastFetchedAt = new Date().toISOString();
            dashboardOverviewNextRefreshAt = dashboardOverviewAutoRefresh
                ? Date.now() + DASHBOARD_OVERVIEW_REFRESH_MS
                : null;
        } else {
            dashboardOverviewLastFetchedAt = null;
            dashboardOverviewNextRefreshAt = null;
        }
        dashboardRawOutput.textContent = JSON.stringify(data, null, 2);
        if (dashboardMode === "overview" || dashboardMode === "screen") {
            renderDashboardSummary(data);
            if (dashboardMode === "screen") {
                renderProductionScreen(data);
            } else {
                renderProductionOverview(data);
            }
            renderDashboardDebug(data);
            if (dashboardOverviewRefreshState) {
                dashboardOverviewRefreshState.textContent = dashboardFormatOverviewRefreshState();
            }
            dashboardApplyScreenLayout();
            dashboardSetStatus("success", dashboardMode === "screen" ? "Ekran produkcyjny" : "Przeglad produkcji");
        } else {
            dashboardSyncLiveView();
        }
        dashboardStartClock();
    } catch (error) {
        dashboardError.textContent = error.message || "Nie udalo sie pobrac danych dashboardu.";
        dashboardError.classList.remove("hidden");
        dashboardSetStatus("error", "Blad");
    } finally {
        if (source !== "auto-refresh" || !dashboardCurrentData) {
            dashboardSubmitButton.disabled = false;
        } else {
            dashboardSubmitButton.disabled = false;
        }
        dashboardRunInFlight = false;
        dashboardSubmitButton.disabled = false;
    }
}

if (dashboardForm) {
    dashboardForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        await runDashboard();
    });
}

if (dashboardClearButton) {
    dashboardClearButton.addEventListener("click", () => {
        clearDashboardView();
        dashboardSetStatus("idle", "Gotowe");
    });
}

if (dashboardToggleTvModeButton) {
    dashboardToggleTvModeButton.addEventListener("click", () => {
        if (dashboardUltrawideMode) {
            void dashboardApplyUltrawideMode(false);
        }
        dashboardApplyTvMode(!dashboardTvMode);
    });
}

if (dashboardScreenTvToggleButton) {
    dashboardScreenTvToggleButton.addEventListener("click", () => {
        if (dashboardUltrawideMode) {
            void dashboardApplyUltrawideMode(false);
        }
        dashboardApplyTvMode(!dashboardTvMode);
    });
}

if (dashboardToggleUltrawideModeButton) {
    dashboardToggleUltrawideModeButton.addEventListener("click", async () => {
        await dashboardApplyUltrawideMode(!dashboardUltrawideMode);
    });
}

if (dashboardScreenUltrawideToggleButton) {
    dashboardScreenUltrawideToggleButton.addEventListener("click", async () => {
        await dashboardApplyUltrawideMode(!dashboardUltrawideMode);
    });
}

if (dashboardScreenSettingsToggleButton) {
    dashboardScreenSettingsToggleButton.addEventListener("click", () => {
        if (!dashboardScreenSettingsOpen && dashboardScreenSettingsPin) {
            const enteredPin = window.prompt("Podaj PIN do ustawien ekranu:");
            if ((enteredPin || "").trim() !== dashboardScreenSettingsPin) {
                dashboardSetStatus("error", "Bledny PIN");
                return;
            }
        }

        dashboardScreenSettingsOpen = !dashboardScreenSettingsOpen;
        dashboardApplyScreenLayout();
    });
}

if (dashboardOverviewPrepStationsInput) {
    dashboardOverviewPrepStationsInput.addEventListener("change", () => {
        dashboardSavePrepStations(dashboardOverviewPrepStationsInput.value);
        dashboardApplyScreenLayout();
        if ((dashboardMode === "overview" || dashboardMode === "screen") && dashboardCurrentData) {
            if (dashboardMode === "screen") {
                renderProductionScreen(dashboardCurrentData);
            } else {
                renderProductionOverview(dashboardCurrentData);
            }
        }
    });
}

if (dashboardScreenStationsInput) {
    dashboardScreenStationsInput.addEventListener("change", () => {
        dashboardScreenStations = dashboardParsePrepStations(dashboardScreenStationsInput.value);

        try {
            window.localStorage.setItem("productionDashboardScreenStations", dashboardScreenStations.join(", "));
        } catch (_error) {
            // Ignore storage errors in kiosk-like environments.
        }

        dashboardApplyScreenLayout();
        if (dashboardMode === "screen" && dashboardCurrentData) {
            renderProductionScreen(dashboardCurrentData);
        }
    });
}

if (dashboardScreenSettingsPinInput) {
    const saveScreenSettingsPin = () => {
        dashboardSaveScreenSettingsPin(dashboardScreenSettingsPinInput.value);
    };

    dashboardScreenSettingsPinInput.addEventListener("input", saveScreenSettingsPin);
    dashboardScreenSettingsPinInput.addEventListener("change", saveScreenSettingsPin);
    dashboardScreenSettingsPinInput.addEventListener("blur", saveScreenSettingsPin);
}

if (dashboardOverviewAutoRefreshInput) {
    dashboardOverviewAutoRefreshInput.addEventListener("change", () => {
        dashboardOverviewAutoRefresh = dashboardOverviewAutoRefreshInput.checked;
        dashboardOverviewNextRefreshAt = dashboardOverviewAutoRefresh
            ? Date.now() + DASHBOARD_OVERVIEW_REFRESH_MS
            : null;

        try {
            window.localStorage.setItem("productionDashboardOverviewAutoRefresh", dashboardOverviewAutoRefresh ? "1" : "0");
        } catch (_error) {
            // Ignore storage errors in kiosk-like environments.
        }

        if (dashboardOverviewRefreshState) {
            dashboardOverviewRefreshState.textContent = dashboardFormatOverviewRefreshState();
        }
        dashboardApplyScreenLayout();
    });
}

if (dashboardOverviewDensityInput) {
    dashboardOverviewDensityInput.addEventListener("change", () => {
        dashboardOverviewDensity = ["standard", "dense", "compact"].includes(dashboardOverviewDensityInput.value)
            ? dashboardOverviewDensityInput.value
            : "standard";

        try {
            window.localStorage.setItem("productionDashboardOverviewDensity", dashboardOverviewDensity);
        } catch (_error) {
            // Ignore storage errors in kiosk-like environments.
        }

        if (dashboardMode === "overview" && dashboardCurrentData) {
            renderProductionOverview(dashboardCurrentData);
        }
    });
}

for (const button of dashboardOverviewFilterButtons) {
    button.addEventListener("click", () => {
        dashboardSetOverviewFilter(button.dataset.overviewFilter || "all");
    });
}

document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && dashboardUltrawideMode) {
        void dashboardApplyUltrawideMode(false);
    }
});

for (const button of dashboardModeButtons) {
    button.addEventListener("click", async () => {
        dashboardApplyMode(button.dataset.dashboardMode || "single");
        clearDashboardView();
        dashboardSetStatus("idle", "Gotowe");
        if ((dashboardMode === "overview" || dashboardMode === "screen") && dashboardConnectionForm?.vendoUserLogin?.value?.trim() && dashboardConnectionForm?.vendoUserPassword?.value) {
            await runDashboard();
        }
    });
}

clearDashboardView();
dashboardInitTvMode();
dashboardInitOverviewSettings();
dashboardApplyMode("single");
