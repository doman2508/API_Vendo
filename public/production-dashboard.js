const dashboardForm = document.getElementById("production-dashboard-form");
const dashboardSubmitButton = document.getElementById("production-dashboard-submit-button");
const dashboardStatusBadge = document.getElementById("dashboard-status-badge");
const dashboardError = document.getElementById("production-dashboard-error");
const dashboardSummary = document.getElementById("production-dashboard-summary");
const dashboardHero = document.getElementById("production-dashboard-hero");
const dashboardMetrics = document.getElementById("production-dashboard-metrics");
const dashboardTimeline = document.getElementById("production-dashboard-timeline");
const dashboardDebug = document.getElementById("production-dashboard-debug");
const dashboardRawOutput = document.getElementById("production-dashboard-raw-output");
const dashboardConnectionForm = document.getElementById("connection-form");
const dashboardClearButton = document.getElementById("clear-button");
const dashboardToggleTvModeButton = document.getElementById("toggle-tv-mode");
let dashboardCurrentData = null;
let dashboardClockTimer = null;
let dashboardTvMode = false;

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

    try {
        window.localStorage.setItem("productionDashboardTvMode", dashboardTvMode ? "1" : "0");
    } catch (_error) {
        // Ignore storage errors in kiosk-like environments.
    }
}

function dashboardInitTvMode() {
    let storedValue = null;

    try {
        storedValue = window.localStorage.getItem("productionDashboardTvMode");
    } catch (_error) {
        storedValue = null;
    }

    dashboardApplyTvMode(storedValue === "1");
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

function dashboardGetProductionBadge(metrics) {
    if ((metrics.plannedWorkHours || 0) <= 0) {
        return { label: "Brak normy", className: "phase-badge waiting" };
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
    return {
        vendoUserLogin: dashboardConnectionForm?.vendoUserLogin?.value?.trim() || "",
        vendoUserPassword: dashboardConnectionForm?.vendoUserPassword?.value || "",
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

    if (dashboardDebug) {
        dashboardDebug.className = "dashboard-debug-empty";
        dashboardDebug.textContent = "Brak danych debug.";
    }

    if (dashboardRawOutput) {
        dashboardRawOutput.textContent = "Brak danych.";
    }
}

function renderDashboardSummary(data) {
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
                <span>Czas wykorzystany</span>
                <strong>${dashboardFormatDurationHours(metrics.productionElapsedHours)}</strong>
            </div>
            <div class="dashboard-metric-row">
                <span>Zuzycie normy</span>
                <strong>${dashboardFormatPercent(metrics.productionProgressPercent)}</strong>
            </div>
            <div class="dashboard-metric-row">
                <span>Zakladany koniec</span>
                <strong>${dashboardFormatDateTime(metrics.expectedFinishAt)}</strong>
            </div>
            <div class="dashboard-metric-row">
                <span>Przewidywany koniec</span>
                <strong>${dashboardFormatDateTime(metrics.predictedFinishAt)}</strong>
            </div>
            <div class="dashboard-progress">
                <div class="dashboard-progress-bar" style="width: ${productionWidth}%"></div>
            </div>
        </section>
    `;
}

function renderDashboardDebug(data) {
    const debug = data.debug || {};
    const metrics = dashboardGetLiveMetrics(data.metrics || {});
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

async function runDashboard() {
    clearDashboardView();
    dashboardSetStatus("loading", "Pobieranie");
    dashboardSubmitButton.disabled = true;

    try {
        const data = await dashboardPostJson("/api/production-dashboard", dashboardCollectPayload());
        dashboardCurrentData = data;
        dashboardRawOutput.textContent = JSON.stringify(data, null, 2);
        dashboardSyncLiveView();
        dashboardStartClock();
    } catch (error) {
        dashboardError.textContent = error.message || "Nie udalo sie pobrac danych dashboardu.";
        dashboardError.classList.remove("hidden");
        dashboardSetStatus("error", "Blad");
    } finally {
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
        dashboardApplyTvMode(!dashboardTvMode);
    });
}

clearDashboardView();
dashboardInitTvMode();
