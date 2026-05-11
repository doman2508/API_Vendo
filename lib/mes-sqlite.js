const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

let cachedDbPath = null;
let cachedDb = null;

const BATCH_SELECT_FIELDS = `
    id,
    device_id AS deviceId,
    session_id AS sessionId,
    kkw_number AS kkwNumber,
    board_side AS boardSide,
    planned_quantity AS plannedQuantity,
    order_number AS orderNumber,
    product_code AS productCode,
    product_name AS productName,
    started_at AS startedAt,
    ended_at AS endedAt,
    status,
    started_by AS startedBy,
    ended_by AS endedBy,
    source,
    pcs_per_panel AS pcsPerPanel,
    pcs_per_panel_source AS pcsPerPanelSource
`;

const PULSE_SELECT_FIELDS = `
    id,
    device_id AS deviceId,
    batch_id AS batchId,
    session_id AS sessionId,
    sensor_id AS sensorId,
    ts,
    payload_json AS payloadJson
`;

const TRANSIT_SELECT_FIELDS = `
    id,
    device_id AS deviceId,
    session_id AS sessionId,
    pulse_in_id AS pulseInId,
    pulse_out_id AS pulseOutId,
    batch_id_in AS batchIdIn,
    batch_id_out AS batchIdOut,
    entered_at AS enteredAt,
    exited_at AS exitedAt,
    duration_seconds AS durationSeconds,
    status
`;

const SESSION_SELECT_FIELDS = `
    id,
    device_id AS deviceId,
    started_at AS startedAt,
    ended_at AS endedAt,
    status,
    started_by AS startedBy,
    ended_by AS endedBy,
    reason
`;

const OVEN_SENSOR_DISTANCE_CM = 273;

function normalizeDbPath(dbPath) {
    return path.resolve(String(dbPath || "").trim());
}

function ensureParentDirectory(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function initializeSchema(db) {
    db.exec(`
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS oven_pulses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            batch_id INTEGER,
            session_id INTEGER,
            sensor_id TEXT NOT NULL DEFAULT 'out',
            ts TEXT NOT NULL,
            payload_json TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_oven_pulses_device_ts
            ON oven_pulses(device_id, ts DESC);

        CREATE TABLE IF NOT EXISTS mes_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            session_id INTEGER,
            kkw_number TEXT NOT NULL,
            board_side TEXT,
            planned_quantity REAL,
            order_number TEXT,
            product_code TEXT,
            product_name TEXT,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            started_by TEXT,
            ended_by TEXT,
            source TEXT NOT NULL DEFAULT 'scan',
            pcs_per_panel INTEGER,
            pcs_per_panel_source TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_mes_batches_device_status
            ON mes_batches(device_id, status, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_mes_batches_kkw
            ON mes_batches(kkw_number);

        CREATE TABLE IF NOT EXISTS mes_product_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_code TEXT NOT NULL UNIQUE,
            pcs_per_panel INTEGER NOT NULL,
            updated_at TEXT NOT NULL,
            updated_by TEXT,
            source TEXT NOT NULL DEFAULT 'operator'
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_mes_product_settings_product_code
            ON mes_product_settings(product_code);

        CREATE TABLE IF NOT EXISTS mes_oven_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            started_by TEXT,
            ended_by TEXT,
            reason TEXT NOT NULL DEFAULT 'auto'
        );

        CREATE INDEX IF NOT EXISTS idx_mes_oven_sessions_device_status
            ON mes_oven_sessions(device_id, status, started_at DESC, id DESC);

        CREATE TABLE IF NOT EXISTS mes_oven_transits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            session_id INTEGER,
            pulse_in_id INTEGER,
            pulse_out_id INTEGER,
            batch_id_in INTEGER,
            batch_id_out INTEGER,
            entered_at TEXT,
            exited_at TEXT,
            duration_seconds REAL,
            status TEXT NOT NULL DEFAULT 'open',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_mes_oven_transits_device_status
            ON mes_oven_transits(device_id, status, entered_at ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_mes_oven_transits_batch_in
            ON mes_oven_transits(batch_id_in, entered_at ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_mes_oven_transits_batch_out
            ON mes_oven_transits(batch_id_out, exited_at ASC, id ASC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_mes_oven_transits_pulse_in
            ON mes_oven_transits(pulse_in_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_mes_oven_transits_pulse_out
            ON mes_oven_transits(pulse_out_id);
    `);

    for (const column of [
        "sensor_id TEXT NOT NULL DEFAULT 'out'",
        "batch_id INTEGER",
        "session_id INTEGER",
    ]) {
        try {
            db.exec(`ALTER TABLE oven_pulses ADD COLUMN ${column};`);
        } catch (_error) {
            // Column already exists in initialized databases.
        }
    }

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_oven_pulses_batch
            ON oven_pulses(batch_id);
        CREATE INDEX IF NOT EXISTS idx_oven_pulses_session
            ON oven_pulses(device_id, session_id, ts DESC);
    `);

    for (const column of [
        "session_id INTEGER",
        "board_side TEXT",
        "planned_quantity REAL",
        "order_number TEXT",
        "product_code TEXT",
        "product_name TEXT",
        "pcs_per_panel INTEGER",
        "pcs_per_panel_source TEXT",
    ]) {
        try {
            db.exec(`ALTER TABLE mes_batches ADD COLUMN ${column};`);
        } catch (_error) {
            // Column already exists in initialized databases.
        }
    }

    try {
        db.exec("ALTER TABLE mes_oven_transits ADD COLUMN session_id INTEGER;");
    } catch (_error) {
        // Column already exists in initialized databases.
    }

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_mes_batches_session
            ON mes_batches(device_id, session_id, started_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_mes_oven_transits_device_session_status
            ON mes_oven_transits(device_id, session_id, status, entered_at ASC, id ASC);
    `);
}

function getDb(dbPath) {
    const normalizedPath = normalizeDbPath(dbPath);
    if (cachedDb && cachedDbPath === normalizedPath) {
        return cachedDb;
    }

    ensureParentDirectory(normalizedPath);
    cachedDb = new DatabaseSync(normalizedPath);
    cachedDbPath = normalizedPath;
    initializeSchema(cachedDb);
    ensureOvenSessionBackfill(cachedDb);
    ensureTransitsBackfilled(cachedDb);
    return cachedDb;
}

function normalizeDeviceId(value) {
    const deviceId = String(value || "").trim();
    return deviceId || "unknown";
}

function normalizeSessionId(value) {
    return normalizePositiveInteger(value);
}

function toFiniteNumberOrNull(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function resolveOvenSpeedCmPerSecond(durationSeconds) {
    const normalizedDuration = toFiniteNumberOrNull(durationSeconds);
    if (normalizedDuration === null || normalizedDuration <= 0) {
        return null;
    }

    return OVEN_SENSOR_DISTANCE_CM / normalizedDuration;
}

function resolveOvenSpeedMetersPerMinute(durationSeconds) {
    const speedCmPerSecond = resolveOvenSpeedCmPerSecond(durationSeconds);
    if (speedCmPerSecond === null) {
        return null;
    }

    return (speedCmPerSecond * 60) / 100;
}

function resolveBoardSpacingCm(speedCmPerSecond, taktSeconds) {
    const normalizedSpeed = toFiniteNumberOrNull(speedCmPerSecond);
    const normalizedTakt = toFiniteNumberOrNull(taktSeconds);

    if (normalizedSpeed === null || normalizedSpeed <= 0 || normalizedTakt === null || normalizedTakt < 0) {
        return null;
    }

    return normalizedSpeed * normalizedTakt;
}

function buildOvenProcessMetrics({
    averageDurationSeconds = null,
    averageEntryTaktSeconds = null,
    averageExitTaktSeconds = null,
} = {}) {
    const averageOvenSpeedCmPerSecond = resolveOvenSpeedCmPerSecond(averageDurationSeconds);
    const averageOvenSpeedMetersPerMinute = resolveOvenSpeedMetersPerMinute(averageDurationSeconds);

    return {
        sensorDistanceCm: OVEN_SENSOR_DISTANCE_CM,
        averageOvenSpeedCmPerSecond,
        averageOvenSpeedMetersPerMinute,
        averageEntrySpacingCm: resolveBoardSpacingCm(averageOvenSpeedCmPerSecond, averageEntryTaktSeconds),
        averageExitSpacingCm: resolveBoardSpacingCm(averageOvenSpeedCmPerSecond, averageExitTaktSeconds),
    };
}

function normalizeSensorId(value) {
    const sensorId = String(value || "").trim().toLowerCase();
    if (!sensorId) {
        return "out";
    }

    if (["in", "entry", "entrance", "wejscie", "input"].includes(sensorId)) {
        return "in";
    }

    if (["out", "exit", "wyjscie", "output"].includes(sensorId)) {
        return "out";
    }

    return sensorId;
}

function normalizeKkwNumber(value) {
    const raw = String(value || "").trim();
    if (!raw) {
        return "";
    }

    if (raw.includes("|")) {
        const parts = raw.split("|").map((part) => part.trim()).filter(Boolean);
        const kkwPart = parts.find((part) => /^\d+\/\d+$/.test(part));
        return kkwPart || parts[parts.length - 1] || raw;
    }

    return raw.replace(/^KKW[:\s-]*/i, "").trim();
}

function normalizeBoardSide(value) {
    const side = String(value || "").trim().toLowerCase();
    if (!side) {
        return null;
    }

    if (["top", "t", "gora", "upper", "up"].includes(side)) {
        return "top";
    }

    if (["bot", "bottom", "b", "dol", "down"].includes(side)) {
        return "bot";
    }

    return null;
}

function normalizePositiveInteger(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const numeric = Number(String(value).replace(",", "."));
    if (!Number.isInteger(numeric) || numeric <= 0) {
        return null;
    }

    return numeric;
}

function parsePcsPerPanelFromText(value) {
    const text = String(value || "").trim();
    if (!text) {
        return null;
    }

    const match = text.match(/\((\d+)\s*[x×]\s*(\d+)\)/i);
    if (!match) {
        return null;
    }

    const rows = Number(match[1]);
    const columns = Number(match[2]);
    if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows <= 0 || columns <= 0) {
        return null;
    }

    return normalizePositiveInteger(rows * columns);
}

function toNullableNumber(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const numeric = Number(String(value).replace(",", "."));
    return Number.isFinite(numeric) ? numeric : null;
}

function toNullableText(value) {
    const text = String(value || "").trim();
    return text || null;
}

function normalizeProductCode(value) {
    return toNullableText(value);
}

function selectBatchRowById(db, batchId) {
    return db.prepare(`
        SELECT
            ${BATCH_SELECT_FIELDS}
        FROM mes_batches
        WHERE id = ?
        LIMIT 1
    `).get(batchId);
}

function selectBatchRowsByDeviceAndKkw(db, deviceId, kkwNumber, boardSide = null) {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const normalizedKkwNumber = normalizeKkwNumber(kkwNumber);
    const normalizedBoardSide = normalizeBoardSide(boardSide);

    if (!normalizedDeviceId || !normalizedKkwNumber) {
        return [];
    }

    const params = [normalizedDeviceId, normalizedKkwNumber];
    const boardSideClause = normalizedBoardSide
        ? "AND board_side = ?"
        : "AND (board_side IS NULL OR TRIM(board_side) = '')";
    if (normalizedBoardSide) {
        params.push(normalizedBoardSide);
    }

    return db.prepare(`
        SELECT
            ${BATCH_SELECT_FIELDS}
        FROM mes_batches
        WHERE device_id = ?
          AND kkw_number = ?
          ${boardSideClause}
        ORDER BY started_at DESC, id DESC
    `).all(...params);
}

function selectActiveBatchRow(db, deviceId, { sessionId = null } = {}) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const params = [deviceId];
    const sessionClause = normalizedSessionId ? "AND session_id = ?" : "";
    if (normalizedSessionId) {
        params.push(normalizedSessionId);
    }

    return db.prepare(`
        SELECT
            ${BATCH_SELECT_FIELDS}
        FROM mes_batches
        WHERE device_id = ?
          AND status = 'active'
          AND ended_at IS NULL
          ${sessionClause}
        ORDER BY started_at DESC, id DESC
        LIMIT 1
    `).get(...params);
}

function selectPreviousBatchRow(db, batch) {
    if (!batch?.deviceId || !batch?.startedAt) {
        return null;
    }

    const normalizedSessionId = normalizeSessionId(batch.sessionId);
    const params = [batch.deviceId, batch.id, batch.startedAt];
    const sessionClause = normalizedSessionId ? "AND session_id = ?" : "";
    if (normalizedSessionId) {
        params.push(normalizedSessionId);
    }

    return db.prepare(`
        SELECT
            ${BATCH_SELECT_FIELDS}
        FROM mes_batches
        WHERE device_id = ?
          AND id <> ?
          AND started_at <= ?
          ${sessionClause}
        ORDER BY started_at DESC, id DESC
        LIMIT 1
    `).get(...params) || null;
}

function selectOvenSessionRowById(db, sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
        return null;
    }

    return db.prepare(`
        SELECT
            ${SESSION_SELECT_FIELDS}
        FROM mes_oven_sessions
        WHERE id = ?
        LIMIT 1
    `).get(normalizedSessionId) || null;
}

function selectActiveOvenSessionRow(db, deviceId) {
    return db.prepare(`
        SELECT
            ${SESSION_SELECT_FIELDS}
        FROM mes_oven_sessions
        WHERE device_id = ?
          AND status = 'active'
          AND ended_at IS NULL
        ORDER BY started_at DESC, id DESC
        LIMIT 1
    `).get(deviceId) || null;
}

function resolveLegacySessionStartedAt(db, deviceId) {
    const row = db.prepare(`
        SELECT MIN(ts) AS startedAt
        FROM (
            SELECT MIN(ts) AS ts
            FROM oven_pulses
            WHERE device_id = ?

            UNION ALL

            SELECT MIN(started_at) AS ts
            FROM mes_batches
            WHERE device_id = ?

            UNION ALL

            SELECT MIN(COALESCE(entered_at, exited_at, created_at)) AS ts
            FROM mes_oven_transits
            WHERE device_id = ?
        )
    `).get(deviceId, deviceId, deviceId) || {};

    const startedAt = String(row.startedAt || "").trim();
    if (startedAt) {
        return startedAt;
    }

    return new Date().toISOString();
}

function createOvenSession(
    db,
    {
        deviceId,
        startedAt = null,
        operator = "",
        reason = "auto",
    } = {}
) {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const now = new Date().toISOString();
    const effectiveStartedAt = String(startedAt || "").trim() || now;
    const normalizedOperator = toNullableText(operator);
    const normalizedReason = String(reason || "").trim() || "auto";

    const result = db.prepare(`
        INSERT INTO mes_oven_sessions (
            device_id,
            started_at,
            status,
            started_by,
            reason
        )
        VALUES (?, ?, 'active', ?, ?)
    `).run(
        normalizedDeviceId,
        effectiveStartedAt,
        normalizedOperator,
        normalizedReason
    );

    return selectOvenSessionRowById(db, Number(result.lastInsertRowid));
}

function closeOvenSession(
    db,
    {
        sessionId,
        endedAt = null,
        operator = "",
        status = "closed",
    } = {}
) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
        return null;
    }

    const now = String(endedAt || "").trim() || new Date().toISOString();
    const normalizedOperator = toNullableText(operator);
    const normalizedStatus = String(status || "").trim() || "closed";

    db.prepare(`
        UPDATE mes_oven_sessions
        SET ended_at = ?,
            status = ?,
            ended_by = ?
        WHERE id = ?
    `).run(now, normalizedStatus, normalizedOperator, normalizedSessionId);

    return selectOvenSessionRowById(db, normalizedSessionId);
}

function ensureOpenOvenSession(
    db,
    deviceId,
    {
        startedAt = null,
        operator = "",
        reason = "auto",
    } = {}
) {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const activeSession = selectActiveOvenSessionRow(db, normalizedDeviceId);
    if (activeSession) {
        return activeSession;
    }

    return createOvenSession(db, {
        deviceId: normalizedDeviceId,
        startedAt,
        operator,
        reason,
    });
}

function ensureOvenSessionBackfill(db) {
    const deviceRows = db.prepare(`
        SELECT DISTINCT device_id AS deviceId
        FROM (
            SELECT device_id
            FROM oven_pulses
            WHERE session_id IS NULL

            UNION

            SELECT device_id
            FROM mes_batches
            WHERE session_id IS NULL

            UNION

            SELECT device_id
            FROM mes_oven_transits
            WHERE session_id IS NULL
        )
        WHERE device_id IS NOT NULL
          AND TRIM(device_id) <> ''
    `).all();

    for (const row of deviceRows) {
        const deviceId = normalizeDeviceId(row?.deviceId);
        const session = ensureOpenOvenSession(db, deviceId, {
            startedAt: resolveLegacySessionStartedAt(db, deviceId),
            reason: "legacy_backfill",
        });

        if (!session?.id) {
            continue;
        }

        db.prepare(`
            UPDATE oven_pulses
            SET session_id = ?
            WHERE device_id = ?
              AND session_id IS NULL
        `).run(session.id, deviceId);

        db.prepare(`
            UPDATE mes_batches
            SET session_id = ?
            WHERE device_id = ?
              AND session_id IS NULL
        `).run(session.id, deviceId);

        db.prepare(`
            UPDATE mes_oven_transits
            SET session_id = ?
            WHERE device_id = ?
              AND session_id IS NULL
        `).run(session.id, deviceId);
    }
}

function selectProductSettingsRow(db, productCode) {
    const normalizedProductCode = normalizeProductCode(productCode);
    if (!normalizedProductCode) {
        return null;
    }

    return db.prepare(`
        SELECT
            id,
            product_code AS productCode,
            pcs_per_panel AS pcsPerPanel,
            updated_at AS updatedAt,
            updated_by AS updatedBy,
            source
        FROM mes_product_settings
        WHERE product_code = ?
        LIMIT 1
    `).get(normalizedProductCode) || null;
}

function selectPulseRowById(db, pulseId) {
    return db.prepare(`
        SELECT ${PULSE_SELECT_FIELDS}
        FROM oven_pulses
        WHERE id = ?
        LIMIT 1
    `).get(pulseId) || null;
}

function selectPulseRowsByIds(db, pulseIds = []) {
    const normalizedIds = Array.from(new Set(
        (Array.isArray(pulseIds) ? pulseIds : [pulseIds])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
    ));

    if (!normalizedIds.length) {
        return [];
    }

    const placeholders = normalizedIds.map(() => "?").join(", ");
    return db.prepare(`
        SELECT ${PULSE_SELECT_FIELDS}
        FROM oven_pulses
        WHERE id IN (${placeholders})
        ORDER BY ts ASC, id ASC
    `).all(...normalizedIds);
}

function selectTransitRowByPulseInId(db, pulseId) {
    return db.prepare(`
        SELECT
            ${TRANSIT_SELECT_FIELDS}
        FROM mes_oven_transits
        WHERE pulse_in_id = ?
        LIMIT 1
    `).get(pulseId) || null;
}

function selectTransitRowByPulseOutId(db, pulseId) {
    return db.prepare(`
        SELECT
            ${TRANSIT_SELECT_FIELDS}
        FROM mes_oven_transits
        WHERE pulse_out_id = ?
        LIMIT 1
    `).get(pulseId) || null;
}

function selectOldestOpenTransitRow(db, deviceId, sessionId = null) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const params = [deviceId];
    const sessionClause = normalizedSessionId ? "AND session_id = ?" : "";
    if (normalizedSessionId) {
        params.push(normalizedSessionId);
    }

    return db.prepare(`
        SELECT
            ${TRANSIT_SELECT_FIELDS}
        FROM mes_oven_transits
        WHERE device_id = ?
          ${sessionClause}
          AND pulse_in_id IS NOT NULL
          AND pulse_out_id IS NULL
          AND status = 'open'
        ORDER BY entered_at ASC, id ASC
        LIMIT 1
    `).get(...params) || null;
}

function selectOpenTransitRowsByDevice(db, deviceId, sessionId = null) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const params = [deviceId];
    const sessionClause = normalizedSessionId ? "AND session_id = ?" : "";
    if (normalizedSessionId) {
        params.push(normalizedSessionId);
    }

    return db.prepare(`
        SELECT
            ${TRANSIT_SELECT_FIELDS}
        FROM mes_oven_transits
        WHERE device_id = ?
          ${sessionClause}
          AND pulse_in_id IS NOT NULL
          AND pulse_out_id IS NULL
          AND status = 'open'
        ORDER BY entered_at ASC, id ASC
    `).all(...params);
}

function selectPulseRowsMissingTransit(db, limit = 500) {
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 500, 5000));
    return db.prepare(`
        SELECT ${PULSE_SELECT_FIELDS}
        FROM oven_pulses
        WHERE id NOT IN (
            SELECT pulse_in_id
            FROM mes_oven_transits
            WHERE pulse_in_id IS NOT NULL
            UNION
            SELECT pulse_out_id
            FROM mes_oven_transits
            WHERE pulse_out_id IS NOT NULL
        )
        ORDER BY ts ASC, id ASC
        LIMIT ?
    `).all(normalizedLimit);
}

function isEntrySensor(sensorId) {
    const normalized = normalizeSensorId(sensorId);
    return normalized === "in";
}

function isExitSensor(sensorId) {
    const normalized = normalizeSensorId(sensorId);
    return normalized === "out";
}

function resolveTransitStatus({ pulseInId = null, pulseOutId = null } = {}) {
    if (pulseInId && pulseOutId) {
        return "closed";
    }

    if (pulseInId) {
        return "open";
    }

    if (pulseOutId) {
        return "orphan_out";
    }

    return "orphan";
}

function resolveTransitDurationSeconds(enteredAt, exitedAt) {
    if (!enteredAt || !exitedAt) {
        return null;
    }

    const entered = new Date(enteredAt).getTime();
    const exited = new Date(exitedAt).getTime();
    if (!Number.isFinite(entered) || !Number.isFinite(exited)) {
        return null;
    }

    return Math.max(0, (exited - entered) / 1000);
}

function resolvePulseSessionId(db, pulseRow) {
    const explicitSessionId = normalizeSessionId(pulseRow?.sessionId);
    if (explicitSessionId) {
        return explicitSessionId;
    }

    const batchSessionId = normalizeSessionId(
        pulseRow?.batchId
            ? selectBatchRowById(db, pulseRow.batchId)?.sessionId
            : null
    );
    if (batchSessionId) {
        return batchSessionId;
    }

    return ensureOpenOvenSession(db, pulseRow?.deviceId, {
        startedAt: pulseRow?.ts || new Date().toISOString(),
        reason: "pulse_backfill",
    })?.id || null;
}

function syncTransitForPulse(db, pulseRow) {
    if (!pulseRow?.id || !pulseRow?.deviceId) {
        return null;
    }

    const now = new Date().toISOString();
    const sensorId = normalizeSensorId(pulseRow.sensorId);
    const sessionId = resolvePulseSessionId(db, pulseRow);

    if (sessionId && normalizeSessionId(pulseRow.sessionId) !== sessionId) {
        db.prepare(`
            UPDATE oven_pulses
            SET session_id = ?
            WHERE id = ?
        `).run(sessionId, pulseRow.id);
    }

    if (isEntrySensor(sensorId)) {
        const existingTransit = selectTransitRowByPulseInId(db, pulseRow.id);
        const nextStatus = existingTransit?.status === "reset"
            ? "reset"
            : resolveTransitStatus({
            pulseInId: pulseRow.id,
            pulseOutId: existingTransit?.pulseOutId || null,
        });
        const durationSeconds = resolveTransitDurationSeconds(pulseRow.ts, existingTransit?.exitedAt || null);

        if (existingTransit) {
            db.prepare(`
                UPDATE mes_oven_transits
                SET device_id = ?,
                    session_id = ?,
                    batch_id_in = ?,
                    entered_at = ?,
                    duration_seconds = ?,
                    status = ?,
                    updated_at = ?
                WHERE id = ?
            `).run(
                pulseRow.deviceId,
                sessionId,
                pulseRow.batchId ?? null,
                pulseRow.ts,
                durationSeconds,
                nextStatus,
                now,
                existingTransit.id
            );

            return existingTransit.id;
        }

        const result = db.prepare(`
            INSERT INTO mes_oven_transits (
                device_id,
                session_id,
                pulse_in_id,
                batch_id_in,
                entered_at,
                status,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            pulseRow.deviceId,
            sessionId,
            pulseRow.id,
            pulseRow.batchId ?? null,
            pulseRow.ts,
            nextStatus,
            now,
            now
        );

        return Number(result.lastInsertRowid);
    }

    if (isExitSensor(sensorId)) {
        const existingTransit = selectTransitRowByPulseOutId(db, pulseRow.id);
        const openTransit = existingTransit || selectOldestOpenTransitRow(db, pulseRow.deviceId, sessionId);
        const nextStatus = resolveTransitStatus({
            pulseInId: openTransit?.pulseInId || null,
            pulseOutId: pulseRow.id,
        });
        const durationSeconds = resolveTransitDurationSeconds(openTransit?.enteredAt || null, pulseRow.ts);

        if (openTransit) {
            db.prepare(`
                UPDATE mes_oven_transits
                SET device_id = ?,
                    session_id = ?,
                    pulse_out_id = ?,
                    batch_id_out = ?,
                    exited_at = ?,
                    duration_seconds = ?,
                    status = ?,
                    updated_at = ?
                WHERE id = ?
            `).run(
                pulseRow.deviceId,
                sessionId,
                pulseRow.id,
                pulseRow.batchId ?? null,
                pulseRow.ts,
                durationSeconds,
                nextStatus,
                now,
                openTransit.id
            );

            return openTransit.id;
        }

        const result = db.prepare(`
            INSERT INTO mes_oven_transits (
                device_id,
                session_id,
                pulse_out_id,
                batch_id_out,
                exited_at,
                status,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            pulseRow.deviceId,
            sessionId,
            pulseRow.id,
            pulseRow.batchId ?? null,
            pulseRow.ts,
            nextStatus,
            now,
            now
        );

        return Number(result.lastInsertRowid);
    }

    return null;
}

function removePulseFromTransit(db, pulseRow) {
    if (!pulseRow?.id) {
        return;
    }

    const now = new Date().toISOString();
    if (isEntrySensor(pulseRow.sensorId)) {
        const transit = selectTransitRowByPulseInId(db, pulseRow.id);
        if (!transit) {
            return;
        }

        if (transit.pulseOutId) {
            db.prepare(`
                UPDATE mes_oven_transits
                SET pulse_in_id = NULL,
                    batch_id_in = NULL,
                    entered_at = NULL,
                    duration_seconds = NULL,
                    status = 'orphan_out',
                    updated_at = ?
                WHERE id = ?
            `).run(now, transit.id);
            return;
        }

        db.prepare(`
            DELETE FROM mes_oven_transits
            WHERE id = ?
        `).run(transit.id);
        return;
    }

    if (isExitSensor(pulseRow.sensorId)) {
        const transit = selectTransitRowByPulseOutId(db, pulseRow.id);
        if (!transit) {
            return;
        }

        if (transit.pulseInId) {
            db.prepare(`
                UPDATE mes_oven_transits
                SET pulse_out_id = NULL,
                    batch_id_out = NULL,
                    exited_at = NULL,
                    duration_seconds = NULL,
                    status = 'open',
                    updated_at = ?
                WHERE id = ?
            `).run(now, transit.id);
            return;
        }

        db.prepare(`
            DELETE FROM mes_oven_transits
            WHERE id = ?
        `).run(transit.id);
    }
}

function syncTransitBatchAssignments(db, pulseRows = []) {
    for (const pulseRow of pulseRows) {
        syncTransitForPulse(db, pulseRow);
    }
}

function clearTransitBatchAssignments(db, pulseRows = []) {
    for (const pulseRow of pulseRows) {
        if (!pulseRow?.id) {
            continue;
        }

        if (isEntrySensor(pulseRow.sensorId)) {
            db.prepare(`
                UPDATE mes_oven_transits
                SET batch_id_in = NULL,
                    updated_at = ?
                WHERE pulse_in_id = ?
            `).run(new Date().toISOString(), pulseRow.id);
            continue;
        }

        if (isExitSensor(pulseRow.sensorId)) {
            db.prepare(`
                UPDATE mes_oven_transits
                SET batch_id_out = NULL,
                    updated_at = ?
                WHERE pulse_out_id = ?
            `).run(new Date().toISOString(), pulseRow.id);
        }
    }
}

function ensureTransitsBackfilled(db) {
    while (true) {
        const missingRows = selectPulseRowsMissingTransit(db, 500);
        if (!missingRows.length) {
            break;
        }

        db.exec("BEGIN");
        try {
            for (const pulseRow of missingRows) {
                syncTransitForPulse(db, pulseRow);
            }
            db.exec("COMMIT");
        } catch (error) {
            try {
                db.exec("ROLLBACK");
            } catch (_rollbackError) {
                // ignore rollback errors and surface the original failure
            }
            throw error;
        }
    }
}

function upsertProductSettings(db, { productCode, pcsPerPanel, operator = "", source = "operator" } = {}) {
    const normalizedProductCode = normalizeProductCode(productCode);
    const normalizedPcsPerPanel = normalizePositiveInteger(pcsPerPanel);
    const now = new Date().toISOString();

    if (!normalizedProductCode || !normalizedPcsPerPanel) {
        return null;
    }

    db.prepare(`
        INSERT INTO mes_product_settings (product_code, pcs_per_panel, updated_at, updated_by, source)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(product_code) DO UPDATE SET
            pcs_per_panel = excluded.pcs_per_panel,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by,
            source = excluded.source
    `).run(
        normalizedProductCode,
        normalizedPcsPerPanel,
        now,
        toNullableText(operator),
        toNullableText(source) || "operator"
    );

    return selectProductSettingsRow(db, normalizedProductCode);
}

function resolveProductPcsPerPanel(dbPath, { productCode = "", productName = "", fallbackText = "" } = {}) {
    const db = getDb(dbPath);
    const productSetting = selectProductSettingsRow(db, productCode);
    const storedPcsPerPanel = normalizePositiveInteger(productSetting?.pcsPerPanel);
    if (storedPcsPerPanel) {
        return {
            productCode: normalizeProductCode(productCode),
            pcsPerPanel: storedPcsPerPanel,
            source: "product_setting",
            updatedAt: productSetting?.updatedAt || null,
            updatedBy: productSetting?.updatedBy || null,
        };
    }

    const inferredPcsPerPanel = parsePcsPerPanelFromText(productName || productCode);
    if (inferredPcsPerPanel) {
        return {
            productCode: normalizeProductCode(productCode),
            pcsPerPanel: inferredPcsPerPanel,
            source: "name_hint",
            updatedAt: null,
            updatedBy: null,
        };
    }

    const fallbackPcsPerPanel = parsePcsPerPanelFromText(fallbackText);
    if (fallbackPcsPerPanel) {
        return {
            productCode: normalizeProductCode(productCode),
            pcsPerPanel: fallbackPcsPerPanel,
            source: "name_hint",
            updatedAt: null,
            updatedBy: null,
        };
    }

    return {
        productCode: normalizeProductCode(productCode),
        pcsPerPanel: null,
        source: null,
        updatedAt: null,
        updatedBy: null,
    };
}

function upsertProductPcsPerPanel(dbPath, { productCode, pcsPerPanel, changedBy = "", source = "shared_panel" } = {}) {
    const db = getDb(dbPath);
    const saved = upsertProductSettings(db, {
        productCode,
        pcsPerPanel,
        operator: changedBy,
        source,
    });

    if (!saved) {
        throw new Error("Nie udalo sie zapisac PCB na panel dla produktu.");
    }

    return {
        productCode: saved.productCode || "",
        pcsPerPanel: normalizePositiveInteger(saved.pcsPerPanel),
        source: saved.source || null,
        updatedAt: saved.updatedAt || null,
        updatedBy: saved.updatedBy || null,
    };
}

function resolveBatchPcsPerPanel(db, { productCode = "", pcsPerPanel = null, pcsPerPanelSource = "", currentBatch = null } = {}) {
    const explicitPcsPerPanel = normalizePositiveInteger(pcsPerPanel);
    if (explicitPcsPerPanel) {
        return {
            pcsPerPanel: explicitPcsPerPanel,
            pcsPerPanelSource: toNullableText(pcsPerPanelSource) || "operator",
            productSetting: null,
        };
    }

    const currentPcsPerPanel = normalizePositiveInteger(currentBatch?.pcsPerPanel);
    if (currentPcsPerPanel) {
        return {
            pcsPerPanel: currentPcsPerPanel,
            pcsPerPanelSource: toNullableText(currentBatch?.pcsPerPanelSource),
            productSetting: null,
        };
    }

    const productSetting = selectProductSettingsRow(db, productCode);
    if (productSetting?.pcsPerPanel) {
        return {
            pcsPerPanel: normalizePositiveInteger(productSetting.pcsPerPanel),
            pcsPerPanelSource: "product_setting",
            productSetting,
        };
    }

    const inferredPcsPerPanel = parsePcsPerPanelFromText(currentBatch?.productName || productCode);
    if (inferredPcsPerPanel) {
        return {
            pcsPerPanel: inferredPcsPerPanel,
            pcsPerPanelSource: "name_hint",
            productSetting: null,
        };
    }

    return {
        pcsPerPanel: null,
        pcsPerPanelSource: null,
        productSetting: null,
    };
}

function insertOvenPulse(dbPath, payload = {}) {
    const db = getDb(dbPath);
    const deviceId = normalizeDeviceId(payload.device_id || payload.deviceId);
    const sensorId = normalizeSensorId(payload.sensor_id || payload.sensorId);
    const rawTs = String(payload.ts || payload.timestamp || "").trim();
    const parsedTs = rawTs ? new Date(rawTs) : null;
    const ts = parsedTs && !Number.isNaN(parsedTs.getTime())
        ? parsedTs.toISOString()
        : new Date().toISOString();
    const payloadJson = JSON.stringify(payload || {});
    const activeSession = ensureOpenOvenSession(db, deviceId, {
        startedAt: ts,
        reason: "pulse_ingest",
    });
    const activeBatch = selectActiveBatchRow(db, deviceId, { sessionId: activeSession?.id || null });
    const batchId = activeBatch?.id || null;
    const sessionId = activeSession?.id || activeBatch?.sessionId || null;
    let pulse = null;

    db.exec("BEGIN");
    try {
        const result = db.prepare(`
            INSERT INTO oven_pulses (device_id, batch_id, session_id, sensor_id, ts, payload_json)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(deviceId, batchId, sessionId, sensorId, ts, payloadJson);

        pulse = {
            id: Number(result.lastInsertRowid),
            deviceId,
            batchId,
            sessionId,
            sensorId,
            ts,
        };

        syncTransitForPulse(db, pulse);
        db.exec("COMMIT");
    } catch (error) {
        try {
            db.exec("ROLLBACK");
        } catch (_rollbackError) {
            // ignore rollback errors and surface the original failure
        }
        throw error;
    }

    return pulse;
}

function listAttributedOvenPulsesForBatch(db, batchId, limit) {
    const normalizedBatchId = Number(batchId);
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 50, 500));

    if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
        return [];
    }

    return db.prepare(`
        SELECT id, deviceId, batchId, sessionId, sensorId, ts, payloadJson
        FROM (
            SELECT
                ${PULSE_SELECT_FIELDS}
            FROM mes_oven_transits t
            JOIN oven_pulses p
              ON p.id = t.pulse_in_id
            WHERE t.batch_id_in = ?

            UNION

            SELECT
                ${PULSE_SELECT_FIELDS}
            FROM mes_oven_transits t
            JOIN oven_pulses p
              ON p.id = t.pulse_out_id
            WHERE t.batch_id_in = ?
               OR (t.batch_id_in IS NULL AND t.batch_id_out = ?)
        )
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `).all(normalizedBatchId, normalizedBatchId, normalizedBatchId, normalizedLimit);
}

function listOvenPulses(
    dbPath,
    { deviceId = "", batchId = null, unassigned = false, limit = 50, scope = "raw" } = {}
) {
    const db = getDb(dbPath);
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
    const normalizedDeviceId = String(deviceId || "").trim();
    const normalizedBatchId = Number(batchId);
    const normalizedUnassigned = Boolean(unassigned);
    const normalizedScope = String(scope || "").trim().toLowerCase();

    if (Number.isInteger(normalizedBatchId) && normalizedBatchId > 0) {
        if (normalizedScope === "attributed" || normalizedScope === "entry" || normalizedScope === "transit") {
            return listAttributedOvenPulsesForBatch(db, normalizedBatchId, normalizedLimit);
        }

        return db.prepare(`
            SELECT ${PULSE_SELECT_FIELDS}
            FROM oven_pulses
            WHERE batch_id = ?
            ORDER BY ts DESC, id DESC
            LIMIT ?
        `).all(normalizedBatchId, normalizedLimit);
    }

    if (normalizedUnassigned && normalizedDeviceId) {
        return db.prepare(`
            SELECT ${PULSE_SELECT_FIELDS}
            FROM oven_pulses
            WHERE device_id = ?
              AND batch_id IS NULL
            ORDER BY ts DESC, id DESC
            LIMIT ?
        `).all(normalizedDeviceId, normalizedLimit);
    }

    if (normalizedUnassigned) {
        return db.prepare(`
            SELECT ${PULSE_SELECT_FIELDS}
            FROM oven_pulses
            WHERE batch_id IS NULL
            ORDER BY ts DESC, id DESC
            LIMIT ?
        `).all(normalizedLimit);
    }

    if (normalizedDeviceId) {
        return db.prepare(`
            SELECT ${PULSE_SELECT_FIELDS}
            FROM oven_pulses
            WHERE device_id = ?
            ORDER BY ts DESC, id DESC
            LIMIT ?
        `).all(normalizedDeviceId, normalizedLimit);
    }

    return db.prepare(`
        SELECT ${PULSE_SELECT_FIELDS}
        FROM oven_pulses
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `).all(normalizedLimit);
}

function countOvenPulsesBetween(db, deviceId, startedAt, endedAt = null) {
    if (!startedAt) {
        return 0;
    }

    if (endedAt) {
        return db.prepare(`
            SELECT COUNT(*) AS count
            FROM oven_pulses
            WHERE device_id = ?
              AND ts >= ?
              AND ts <= ?
        `).get(deviceId, startedAt, endedAt)?.count || 0;
    }

    return db.prepare(`
        SELECT COUNT(*) AS count
        FROM oven_pulses
        WHERE device_id = ?
          AND ts >= ?
    `).get(deviceId, startedAt)?.count || 0;
}

function countUnassignedOvenPulsesBetween(db, deviceId, startedAt, endedAt = null) {
    if (!startedAt) {
        return 0;
    }

    if (endedAt) {
        return db.prepare(`
            SELECT COUNT(*) AS count
            FROM oven_pulses
            WHERE device_id = ?
              AND batch_id IS NULL
              AND ts >= ?
              AND ts <= ?
        `).get(deviceId, startedAt, endedAt)?.count || 0;
    }

    return db.prepare(`
        SELECT COUNT(*) AS count
        FROM oven_pulses
        WHERE device_id = ?
          AND batch_id IS NULL
          AND ts >= ?
    `).get(deviceId, startedAt)?.count || 0;
}

function listBatchesForKkw(db, batch) {
    if (!batch?.kkwNumber) {
        return [];
    }

    return selectBatchRowsByDeviceAndKkw(db, batch.deviceId, batch.kkwNumber, batch.boardSide)
        .sort((left, right) => {
            const leftTime = Date.parse(left?.startedAt || "") || 0;
            const rightTime = Date.parse(right?.startedAt || "") || 0;
            if (leftTime !== rightTime) {
                return leftTime - rightTime;
            }
            return (Number(left?.id) || 0) - (Number(right?.id) || 0);
        });
}

function aggregateTransitsByEntryBatchIds(db, batchIds = []) {
    const normalizedIds = Array.from(new Set(
        (Array.isArray(batchIds) ? batchIds : [batchIds])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
    ));

    if (!normalizedIds.length) {
        return {
            entryCount: 0,
            openCount: 0,
        };
    }

    const placeholders = normalizedIds.map(() => "?").join(", ");
    const row = db.prepare(`
        SELECT
            COUNT(CASE WHEN pulse_in_id IS NOT NULL THEN 1 END) AS entryCount,
            COUNT(CASE WHEN pulse_in_id IS NOT NULL AND pulse_out_id IS NULL AND status = 'open' THEN 1 END) AS openCount
        FROM mes_oven_transits
        WHERE batch_id_in IN (${placeholders})
    `).get(...normalizedIds) || {};

    return {
        entryCount: row.entryCount || 0,
        openCount: row.openCount || 0,
    };
}

function aggregateTransitsByAttributionBatchIds(db, batchIds = []) {
    const normalizedIds = Array.from(new Set(
        (Array.isArray(batchIds) ? batchIds : [batchIds])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
    ));

    if (!normalizedIds.length) {
        return {
            outputCount: 0,
            averageDurationSeconds: null,
            minDurationSeconds: null,
            maxDurationSeconds: null,
            durationSampleCount: 0,
        };
    }

    const placeholders = normalizedIds.map(() => "?").join(", ");
    const row = db.prepare(`
        SELECT
            COUNT(CASE WHEN pulse_out_id IS NOT NULL THEN 1 END) AS outputCount,
            AVG(duration_seconds) AS averageDurationSeconds,
            MIN(duration_seconds) AS minDurationSeconds,
            MAX(duration_seconds) AS maxDurationSeconds,
            COUNT(CASE WHEN duration_seconds IS NOT NULL THEN 1 END) AS durationSampleCount
        FROM mes_oven_transits
        WHERE COALESCE(batch_id_in, batch_id_out) IN (${placeholders})
    `).get(...normalizedIds) || {};

    return {
        outputCount: row.outputCount || 0,
        averageDurationSeconds: row.averageDurationSeconds === null || row.averageDurationSeconds === undefined
            ? null
            : Number(row.averageDurationSeconds),
        minDurationSeconds: row.minDurationSeconds === null || row.minDurationSeconds === undefined
            ? null
            : Number(row.minDurationSeconds),
        maxDurationSeconds: row.maxDurationSeconds === null || row.maxDurationSeconds === undefined
            ? null
            : Number(row.maxDurationSeconds),
        durationSampleCount: row.durationSampleCount || 0,
    };
}

function getBatchTransitMetrics(db, batch) {
    if (!batch?.id) {
        return {
            inputCount: 0,
            outputCount: 0,
            inOvenCount: 0,
            averageDurationSeconds: null,
            minDurationSeconds: null,
            maxDurationSeconds: null,
            durationSampleCount: 0,
        };
    }

    const byEntry = aggregateTransitsByEntryBatchIds(db, [batch.id]);
    const byOutput = aggregateTransitsByAttributionBatchIds(db, [batch.id]);

    return {
        inputCount: byEntry.entryCount,
        outputCount: byOutput.outputCount,
        inOvenCount: byEntry.openCount,
        averageDurationSeconds: byOutput.averageDurationSeconds,
        minDurationSeconds: byOutput.minDurationSeconds,
        maxDurationSeconds: byOutput.maxDurationSeconds,
        durationSampleCount: byOutput.durationSampleCount,
    };
}

function resolveSuggestedUnassignedWindow(db, batch, { maxLookbackMinutes = 30 } = {}) {
    if (!batch?.deviceId || !batch?.startedAt) {
        return null;
    }

    const normalizedLookbackMinutes = Math.max(1, Math.min(Number(maxLookbackMinutes) || 30, 8 * 60));
    const windowEndDate = new Date(batch.startedAt);
    if (Number.isNaN(windowEndDate.getTime())) {
        return null;
    }

    const fallbackWindowStartDate = new Date(windowEndDate.getTime() - normalizedLookbackMinutes * 60 * 1000);
    let windowStartDate = fallbackWindowStartDate;

    const previousBatch = selectPreviousBatchRow(db, batch);
    const previousBoundary = previousBatch?.endedAt || previousBatch?.startedAt || null;
    if (previousBoundary) {
        const previousBoundaryDate = new Date(previousBoundary);
        if (
            !Number.isNaN(previousBoundaryDate.getTime())
            && previousBoundaryDate.getTime() > windowStartDate.getTime()
        ) {
            windowStartDate = previousBoundaryDate;
        }
    }

    if (windowStartDate.getTime() >= windowEndDate.getTime()) {
        return null;
    }

    return {
        windowStart: windowStartDate.toISOString(),
        windowEnd: windowEndDate.toISOString(),
        previousBatchId: previousBatch?.id || null,
        previousBoundary: previousBoundary || null,
        maxLookbackMinutes: normalizedLookbackMinutes,
    };
}

function buildBatchUnassignedSuggestion(
    db,
    batch,
    {
        limit = 200,
        maxLookbackMinutes = 30,
        includePulseIds = true,
    } = {}
) {
    if (!batch) {
        return null;
    }

    const window = resolveSuggestedUnassignedWindow(db, batch, { maxLookbackMinutes });
    if (!window) {
        return null;
    }

    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));
        const count = db.prepare(`
        SELECT COUNT(*) AS count
        FROM oven_pulses
        WHERE device_id = ?
          AND batch_id IS NULL
          AND (? IS NULL OR session_id = ?)
          AND ts >= ?
          AND ts < ?
    `).get(batch.deviceId, normalizeSessionId(batch.sessionId), normalizeSessionId(batch.sessionId), window.windowStart, window.windowEnd)?.count || 0;

    if (!count) {
        return null;
    }

    const rows = db.prepare(`
        SELECT ${PULSE_SELECT_FIELDS}
        FROM oven_pulses
        WHERE device_id = ?
          AND batch_id IS NULL
          AND (? IS NULL OR session_id = ?)
          AND ts >= ?
          AND ts < ?
        ORDER BY ts ASC, id ASC
        LIMIT ?
    `).all(
        batch.deviceId,
        normalizeSessionId(batch.sessionId),
        normalizeSessionId(batch.sessionId),
        window.windowStart,
        window.windowEnd,
        normalizedLimit
    );

    return {
        batchId: batch.id,
        deviceId: batch.deviceId,
        kkwNumber: batch.kkwNumber || null,
        count,
        previewCount: rows.length,
        truncated: count > rows.length,
        pulseIds: includePulseIds ? rows.map((row) => row.id) : [],
        firstTs: rows[0]?.ts || null,
        lastTs: rows.length ? rows[rows.length - 1].ts : null,
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        previousBatchId: window.previousBatchId,
        previousBoundary: window.previousBoundary,
        maxLookbackMinutes: window.maxLookbackMinutes,
    };
}

function resolveBatchPcbCount(panelCount, pcsPerPanel) {
    const normalizedPcsPerPanel = normalizePositiveInteger(pcsPerPanel);
    if (!normalizedPcsPerPanel) {
        return null;
    }

    return panelCount * normalizedPcsPerPanel;
}

function calculateKkwMetrics(db, batch) {
    const relatedBatches = listBatchesForKkw(db, batch);
    if (!relatedBatches.length) {
        const metrics = getBatchTransitMetrics(db, batch);
        return {
            inputCount: metrics.inputCount,
            outputCount: metrics.outputCount,
            inOvenCount: metrics.inOvenCount,
            panelCount: metrics.outputCount,
            pcbCount: resolveBatchPcbCount(metrics.outputCount, batch?.pcsPerPanel),
            averageDurationSeconds: metrics.averageDurationSeconds,
            minDurationSeconds: metrics.minDurationSeconds,
            maxDurationSeconds: metrics.maxDurationSeconds,
            durationSampleCount: metrics.durationSampleCount,
            missingPcsPerPanel: !normalizePositiveInteger(batch?.pcsPerPanel),
        };
    }

    const fallbackPcsPerPanel = normalizePositiveInteger(batch?.pcsPerPanel)
        || normalizePositiveInteger(selectProductSettingsRow(db, batch?.productCode)?.pcsPerPanel)
        || parsePcsPerPanelFromText(batch?.productName || batch?.productCode);
    const relatedBatchIds = relatedBatches.map((relatedBatch) => relatedBatch.id);
    const entryAggregate = aggregateTransitsByEntryBatchIds(db, relatedBatchIds);
    const outputAggregate = aggregateTransitsByAttributionBatchIds(db, relatedBatchIds);

    let panelCount = 0;
    let pcbCount = 0;
    let missingPcsPerPanel = false;

    for (const relatedBatch of relatedBatches) {
        const relatedMetrics = getBatchTransitMetrics(db, relatedBatch);
        const relatedPanelCount = relatedMetrics.outputCount;
        const relatedPcsPerPanel = normalizePositiveInteger(relatedBatch.pcsPerPanel)
            || normalizePositiveInteger(selectProductSettingsRow(db, relatedBatch?.productCode)?.pcsPerPanel)
            || parsePcsPerPanelFromText(relatedBatch?.productName || relatedBatch?.productCode)
            || fallbackPcsPerPanel;

        panelCount += relatedPanelCount;

        if (!relatedPcsPerPanel) {
            missingPcsPerPanel = true;
            continue;
        }

        pcbCount += relatedPanelCount * relatedPcsPerPanel;
    }

    return {
        inputCount: entryAggregate.entryCount,
        outputCount: outputAggregate.outputCount,
        inOvenCount: entryAggregate.openCount,
        panelCount,
        pcbCount: missingPcsPerPanel ? null : pcbCount,
        averageDurationSeconds: outputAggregate.averageDurationSeconds,
        minDurationSeconds: outputAggregate.minDurationSeconds,
        maxDurationSeconds: outputAggregate.maxDurationSeconds,
        durationSampleCount: outputAggregate.durationSampleCount,
        missingPcsPerPanel,
    };
}

function hydrateBatch(db, batch) {
    if (!batch) {
        return null;
    }

    const normalizedBoardSide = normalizeBoardSide(batch.boardSide);
    const resolvedPcsPerPanel = resolveBatchPcsPerPanel(db, {
        productCode: batch.productCode,
        currentBatch: batch,
    });
    const effectivePcsPerPanel = normalizePositiveInteger(resolvedPcsPerPanel.pcsPerPanel);
    const effectivePcsPerPanelSource = toNullableText(resolvedPcsPerPanel.pcsPerPanelSource) || toNullableText(batch.pcsPerPanelSource);
    const relatedBatches = listBatchesForKkw(db, batch);
    const relatedBatchIds = relatedBatches.length
        ? relatedBatches
            .map((relatedBatch) => Number(relatedBatch?.id))
            .filter((value) => Number.isInteger(value) && value > 0)
        : [Number(batch.id)].filter((value) => Number.isInteger(value) && value > 0);
    const batchMetrics = getBatchTransitMetrics(db, batch);
    const kkwMetrics = calculateKkwMetrics(db, batch);
    const averageEntryTaktSeconds = getAverageTransitGapSecondsByEntryBatchIds(db, relatedBatchIds);
    const averageExitTaktSeconds = getAverageTransitGapSecondsByAttributionBatchIds(db, relatedBatchIds);
    const batchAverageEntryTaktSeconds = getAverageTransitGapSecondsByEntryBatchIds(db, [batch.id]);
    const batchAverageExitTaktSeconds = getAverageTransitGapSecondsByAttributionBatchIds(db, [batch.id]);
    const kkwProcessMetrics = buildOvenProcessMetrics({
        averageDurationSeconds: kkwMetrics.averageDurationSeconds,
        averageEntryTaktSeconds,
        averageExitTaktSeconds,
    });
    const batchProcessMetrics = buildOvenProcessMetrics({
        averageDurationSeconds: batchMetrics.averageDurationSeconds,
        averageEntryTaktSeconds: batchAverageEntryTaktSeconds,
        averageExitTaktSeconds: batchAverageExitTaktSeconds,
    });
    const panelCount = kkwMetrics.outputCount;
    const batchPanelCount = batchMetrics.outputCount;
    const batchInputCount = batchMetrics.inputCount;
    const batchInOvenCount = batchMetrics.inOvenCount;
    const batchPcbCount = resolveBatchPcbCount(batchPanelCount, effectivePcsPerPanel);
    const kkwPcbCount = kkwMetrics.pcbCount;
    const now = new Date();
    const endedAt = batch.endedAt ? new Date(batch.endedAt) : now;
    const startedAt = new Date(batch.startedAt);
    const durationSeconds = Number.isNaN(startedAt.getTime())
        ? null
        : Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 1000);

    return {
        ...batch,
        boardSide: normalizedBoardSide,
        pulseCount: panelCount,
        batchPulseCount: batchPanelCount,
        kkwPulseCount: panelCount,
        panelCount,
        batchPanelCount,
        kkwPanelCount: panelCount,
        pcsPerPanel: effectivePcsPerPanel,
        pcsPerPanelSource: effectivePcsPerPanelSource,
        pcbCount: kkwPcbCount,
        batchPcbCount,
        kkwPcbCount,
        hasPcsPerPanel: Boolean(effectivePcsPerPanel),
        remainingQuantity: batch.plannedQuantity === null
            || batch.plannedQuantity === undefined
            || kkwPcbCount === null
            || kkwPcbCount === undefined
            ? null
            : Math.max(0, Number(batch.plannedQuantity) - kkwPcbCount),
        progressPercent: batch.plannedQuantity && kkwPcbCount !== null && kkwPcbCount !== undefined
            ? (kkwPcbCount / Number(batch.plannedQuantity)) * 100
            : null,
        durationSeconds,
        pcsPerPanelMissing: !effectivePcsPerPanel,
        kkwPcbCountMissing: kkwMetrics.missingPcsPerPanel,
        inputCount: kkwMetrics.inputCount,
        outputCount: kkwMetrics.outputCount,
        inCount: kkwMetrics.inputCount,
        outCount: kkwMetrics.outputCount,
        inOvenCount: kkwMetrics.inOvenCount,
        sensorDistanceCm: kkwProcessMetrics.sensorDistanceCm,
        averageEntryTaktSeconds,
        averageExitTaktSeconds,
        averageOvenTimeSeconds: kkwMetrics.averageDurationSeconds,
        averageOvenSpeedCmPerSecond: kkwProcessMetrics.averageOvenSpeedCmPerSecond,
        averageOvenSpeedMetersPerMinute: kkwProcessMetrics.averageOvenSpeedMetersPerMinute,
        averageEntrySpacingCm: kkwProcessMetrics.averageEntrySpacingCm,
        averageExitSpacingCm: kkwProcessMetrics.averageExitSpacingCm,
        minOvenTimeSeconds: kkwMetrics.minDurationSeconds,
        maxOvenTimeSeconds: kkwMetrics.maxDurationSeconds,
        ovenTimeSampleCount: kkwMetrics.durationSampleCount,
        batchInputCount,
        batchOutputCount: batchPanelCount,
        batchInCount: batchInputCount,
        batchOutCount: batchPanelCount,
        batchInOvenCount,
        batchAverageEntryTaktSeconds,
        batchAverageExitTaktSeconds,
        batchAverageOvenTimeSeconds: batchMetrics.averageDurationSeconds,
        batchAverageOvenSpeedCmPerSecond: batchProcessMetrics.averageOvenSpeedCmPerSecond,
        batchAverageOvenSpeedMetersPerMinute: batchProcessMetrics.averageOvenSpeedMetersPerMinute,
        batchAverageEntrySpacingCm: batchProcessMetrics.averageEntrySpacingCm,
        batchAverageExitSpacingCm: batchProcessMetrics.averageExitSpacingCm,
        batchMinOvenTimeSeconds: batchMetrics.minDurationSeconds,
        batchMaxOvenTimeSeconds: batchMetrics.maxDurationSeconds,
        batchOvenTimeSampleCount: batchMetrics.durationSampleCount,
    };
}

function getActiveOvenBatch(dbPath, { deviceId = "reflow_1", currentSessionOnly = false } = {}) {
    const db = getDb(dbPath);
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const activeSessionId = selectActiveOvenSessionRow(db, normalizedDeviceId)?.id || null;
    if (currentSessionOnly && !activeSessionId) {
        return null;
    }

    const sessionId = currentSessionOnly ? activeSessionId : null;
    const batch = selectActiveBatchRow(db, normalizedDeviceId, { sessionId });

    return hydrateBatch(db, batch);
}

function startOvenBatch(
    dbPath,
    {
        deviceId = "reflow_1",
        kkwNumber = "",
        boardSide = null,
        plannedQuantity = null,
        orderNumber = "",
        productCode = "",
        productName = "",
        pcsPerPanel = null,
        pcsPerPanelSource = "",
        operator = "",
        source = "scan",
    } = {}
) {
    const db = getDb(dbPath);
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const normalizedKkwNumber = normalizeKkwNumber(kkwNumber);
    const normalizedBoardSide = normalizeBoardSide(boardSide);
    const normalizedPlannedQuantity = toNullableNumber(plannedQuantity);
    const normalizedProductCode = normalizeProductCode(productCode);
    const normalizedProductName = toNullableText(productName);
    const now = new Date().toISOString();

    if (!normalizedKkwNumber) {
        throw new Error("Brakuje numeru KKW.");
    }

    const existing = hydrateBatch(db, selectActiveBatchRow(db, normalizedDeviceId));
    let closedBatch = null;
    if (existing) {
        db.prepare(`
            UPDATE mes_batches
            SET ended_at = ?, status = 'closed', ended_by = ?
            WHERE id = ?
        `).run(now, toNullableText(operator), existing.id);
        closedBatch = hydrateBatch(db, {
            ...existing,
            endedAt: now,
            status: "closed",
            endedBy: toNullableText(operator),
        });
    }

    const session = ensureOpenOvenSession(db, normalizedDeviceId, {
        startedAt: now,
        operator,
        reason: "batch_start",
    });

    const resolvedPcsPerPanel = resolveBatchPcsPerPanel(db, {
        productCode: normalizedProductCode,
        pcsPerPanel,
        pcsPerPanelSource,
    });

    const result = db.prepare(`
        INSERT INTO mes_batches (
            device_id,
            session_id,
            kkw_number,
            board_side,
            planned_quantity,
            order_number,
            product_code,
            product_name,
            started_at,
            status,
            started_by,
            source,
            pcs_per_panel,
            pcs_per_panel_source
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `).run(
        normalizedDeviceId,
        session?.id || null,
        normalizedKkwNumber,
        normalizedBoardSide,
        normalizedPlannedQuantity,
        toNullableText(orderNumber),
        normalizedProductCode,
        normalizedProductName,
        now,
        toNullableText(operator),
        String(source || "scan").trim() || "scan",
        resolvedPcsPerPanel.pcsPerPanel,
        resolvedPcsPerPanel.pcsPerPanelSource
    );

    return {
        closedBatch,
        batch: getActiveOvenBatch(dbPath, { deviceId: normalizedDeviceId }),
        id: Number(result.lastInsertRowid),
    };
}

function updateOvenBatchDetails(
    dbPath,
    {
        batchId,
        kkwNumber = "",
        boardSide,
        plannedQuantity = null,
        orderNumber = "",
        productCode = "",
        productName = "",
        pcsPerPanel = null,
        pcsPerPanelSource = "",
        applyToRelated = false,
    } = {}
) {
    const db = getDb(dbPath);
    const normalizedBatchId = Number(batchId);
    const normalizedPlannedQuantity = toNullableNumber(plannedQuantity);
    const normalizedPcsPerPanel = normalizePositiveInteger(pcsPerPanel);
    const normalizedBoardSide = normalizeBoardSide(boardSide);
    const updates = [];
    const values = [];

    if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
        throw new Error("Brakuje ID partii MES.");
    }

    const currentBatch = selectBatchRowById(db, normalizedBatchId);
    if (!currentBatch) {
        throw new Error("Nie znaleziono partii MES.");
    }

    const targetBatches = applyToRelated
        ? selectBatchRowsByDeviceAndKkw(db, currentBatch.deviceId, currentBatch.kkwNumber, currentBatch.boardSide)
        : [currentBatch];
    const targetBatchIds = Array.from(new Set(
        targetBatches
            .map((batchRow) => Number(batchRow?.id))
            .filter((value) => Number.isInteger(value) && value > 0)
    ));

    if (normalizedPlannedQuantity !== null && normalizedPlannedQuantity > 0) {
        updates.push("planned_quantity = ?");
        values.push(normalizedPlannedQuantity);
    }

    const normalizedKkwNumber = normalizeKkwNumber(kkwNumber);
    if (normalizedKkwNumber) {
        updates.push("kkw_number = ?");
        values.push(normalizedKkwNumber);
    }

    if (normalizedBoardSide) {
        updates.push("board_side = ?");
        values.push(normalizedBoardSide);
    }

    let nextProductCode = normalizeProductCode(currentBatch.productCode);

    for (const [column, value] of [
        ["order_number", orderNumber],
        ["product_code", productCode],
        ["product_name", productName],
    ]) {
        const text = toNullableText(value);
        if (!text) {
            continue;
        }

        updates.push(`${column} = ?`);
        values.push(text);

        if (column === "product_code") {
            nextProductCode = normalizeProductCode(text);
        }
    }

    if (normalizedPcsPerPanel) {
        updates.push("pcs_per_panel = ?");
        values.push(normalizedPcsPerPanel);
        updates.push("pcs_per_panel_source = ?");
        values.push(toNullableText(pcsPerPanelSource) || "operator");
    } else if (!normalizePositiveInteger(currentBatch.pcsPerPanel)) {
        const resolvedPcsPerPanel = resolveBatchPcsPerPanel(db, {
            productCode: nextProductCode,
            currentBatch,
        });

        if (resolvedPcsPerPanel.pcsPerPanel) {
            updates.push("pcs_per_panel = ?");
            values.push(resolvedPcsPerPanel.pcsPerPanel);
            updates.push("pcs_per_panel_source = ?");
            values.push(resolvedPcsPerPanel.pcsPerPanelSource);
        }
    }

      if (updates.length) {
          if (targetBatchIds.length > 1) {
              const placeholders = targetBatchIds.map(() => "?").join(", ");
              db.prepare(`
                  UPDATE mes_batches
                  SET ${updates.join(", ")}
                  WHERE id IN (${placeholders})
              `).run(...values, ...targetBatchIds);
          } else {
              db.prepare(`
                  UPDATE mes_batches
                  SET ${updates.join(", ")}
                  WHERE id = ?
              `).run(...values, normalizedBatchId);
          }
      }

      return hydrateBatch(db, selectBatchRowById(db, normalizedBatchId));
  }

function upsertOvenBatchPcsPerPanel(
    dbPath,
    {
        batchId = null,
        deviceId = "reflow_1",
        pcsPerPanel = null,
        operator = "",
        source = "operator",
        saveForProduct = true,
        applyToRelated = false,
    } = {}
) {
    const db = getDb(dbPath);
    const normalizedBatchId = Number(batchId);
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const normalizedPcsPerPanel = normalizePositiveInteger(pcsPerPanel);
    const normalizedSource = toNullableText(source) || "operator";

    if (!normalizedPcsPerPanel) {
        throw new Error("PCB na panel musi byc dodatnia liczba calkowita.");
    }

    const activeSessionId = selectActiveOvenSessionRow(db, normalizedDeviceId)?.id || null;
    const batch = Number.isInteger(normalizedBatchId) && normalizedBatchId > 0
        ? selectBatchRowById(db, normalizedBatchId)
        : (activeSessionId ? selectActiveBatchRow(db, normalizedDeviceId, { sessionId: activeSessionId }) : null);

    if (!batch) {
        throw new Error("Brakuje aktywnej partii MES do aktualizacji.");
    }

    const targetBatches = applyToRelated
        ? selectBatchRowsByDeviceAndKkw(db, batch.deviceId, batch.kkwNumber, batch.boardSide)
        : [batch];
    const targetBatchIds = Array.from(new Set(
        targetBatches
            .map((batchRow) => Number(batchRow?.id))
            .filter((value) => Number.isInteger(value) && value > 0)
    ));
    const placeholders = targetBatchIds.map(() => "?").join(", ");

    db.prepare(`
        UPDATE mes_batches
        SET pcs_per_panel = ?, pcs_per_panel_source = ?
        WHERE id IN (${placeholders})
    `).run(normalizedPcsPerPanel, normalizedSource, ...targetBatchIds);

    let productSetting = null;
    let warning = null;

    if (saveForProduct) {
        if (normalizeProductCode(batch.productCode)) {
            productSetting = upsertProductSettings(db, {
                productCode: batch.productCode,
                pcsPerPanel: normalizedPcsPerPanel,
                operator,
                source: normalizedSource,
            });
        } else {
            warning = "Partia nie ma kodu produktu, zapisano tylko dla tej partii.";
        }
    }

    return {
        batch: hydrateBatch(db, selectBatchRowById(db, batch.id)),
        productSetting,
        savedForProduct: Boolean(productSetting),
        warning,
    };
}

function assignOvenPulsesToBatch(
    dbPath,
    {
        batchId,
        pulseIds = [],
        suggestedUnassigned = false,
        maxLookbackMinutes = 30,
        forceReassign = false,
    } = {}
) {
    const db = getDb(dbPath);
    const normalizedBatchId = Number(batchId);
    const useSuggestedUnassigned = Boolean(suggestedUnassigned);
    const normalizedForceReassign = Boolean(forceReassign);

    if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
        throw new Error("Brakuje ID partii MES do przypisania impulsow.");
    }

    const batch = selectBatchRowById(db, normalizedBatchId);
    if (!batch) {
        throw new Error("Nie znaleziono partii MES do przypisania impulsow.");
    }
    const batchSessionId = normalizeSessionId(batch.sessionId)
        || ensureOpenOvenSession(db, batch.deviceId, {
            startedAt: batch.startedAt || new Date().toISOString(),
            reason: "batch_session_repair",
        })?.id
        || null;

    if (useSuggestedUnassigned) {
        const suggestion = buildBatchUnassignedSuggestion(db, batch, {
            limit: 1000,
            maxLookbackMinutes,
        });

        if (!suggestion?.count) {
            return {
                assigned: 0,
                skippedCount: 0,
                batch: hydrateBatch(db, batch),
                suggestion: null,
                pulseIds: [],
                mode: "suggested",
            };
        }

        let assigned = 0;
        const suggestionPulseRows = selectPulseRowsByIds(db, suggestion.pulseIds);
        db.exec("BEGIN");
        try {
            assigned = db.prepare(`
                UPDATE oven_pulses
                SET batch_id = ?,
                    session_id = ?
                WHERE device_id = ?
                  AND batch_id IS NULL
                  AND (? IS NULL OR session_id = ?)
                  AND ts >= ?
                  AND ts < ?
            `).run(
                batch.id,
                batchSessionId,
                batch.deviceId,
                batchSessionId,
                batchSessionId,
                suggestion.windowStart,
                suggestion.windowEnd
            ).changes || 0;
            syncTransitBatchAssignments(db, suggestionPulseRows.map((pulseRow) => ({
                ...pulseRow,
                batchId: batch.id,
                sessionId: batchSessionId,
            })));
            db.exec("COMMIT");
        } catch (error) {
            try {
                db.exec("ROLLBACK");
            } catch (_rollbackError) {
                // ignore rollback errors and surface the original failure
            }
            throw error;
        }

        return {
            assigned,
            skippedCount: Math.max(0, suggestion.count - assigned),
            batch: hydrateBatch(db, selectBatchRowById(db, batch.id)),
            suggestion,
            pulseIds: suggestion.pulseIds,
            mode: "suggested",
        };
    }

    const normalizedIds = Array.from(new Set(
        (Array.isArray(pulseIds) ? pulseIds : [pulseIds])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
    ));

    if (!normalizedIds.length) {
        throw new Error("Wybierz co najmniej jeden impuls do przypisania.");
    }

    const placeholders = normalizedIds.map(() => "?").join(", ");
    const selectedRows = db.prepare(`
        SELECT ${PULSE_SELECT_FIELDS}
        FROM oven_pulses
        WHERE id IN (${placeholders})
        ORDER BY ts ASC, id ASC
    `).all(...normalizedIds);

    const eligibleRows = selectedRows.filter((row) => {
        if (row.deviceId !== batch.deviceId) {
            return false;
        }

        const rowSessionId = normalizeSessionId(row.sessionId);
        if (rowSessionId && batchSessionId && rowSessionId !== batchSessionId) {
            return false;
        }

        if (normalizedForceReassign) {
            return Number(row.batchId) !== Number(batch.id);
        }

        return row.batchId === null || row.batchId === undefined;
    });
    const eligibleIds = eligibleRows.map((row) => row.id);

    if (!eligibleIds.length) {
        return {
            assigned: 0,
            skippedCount: normalizedIds.length,
            batch: hydrateBatch(db, batch),
            pulseIds: [],
            mode: "selected",
        };
    }

    const eligiblePlaceholders = eligibleIds.map(() => "?").join(", ");
    let assigned = 0;
    db.exec("BEGIN");
    try {
        assigned = db.prepare(`
            UPDATE oven_pulses
            SET batch_id = ?,
                session_id = ?
            WHERE id IN (${eligiblePlaceholders})
              AND device_id = ?
        `).run(batch.id, batchSessionId, ...eligibleIds, batch.deviceId).changes || 0;
        syncTransitBatchAssignments(db, eligibleRows.map((pulseRow) => ({
            ...pulseRow,
            batchId: batch.id,
            sessionId: batchSessionId,
        })));
        db.exec("COMMIT");
    } catch (error) {
        try {
            db.exec("ROLLBACK");
        } catch (_rollbackError) {
            // ignore rollback errors and surface the original failure
        }
        throw error;
    }

    return {
        assigned,
        skippedCount: Math.max(0, normalizedIds.length - assigned),
        batch: hydrateBatch(db, selectBatchRowById(db, batch.id)),
        pulseIds: eligibleIds,
        mode: "selected",
    };
}

function getOvenBatchUnassignedSuggestion(
    dbPath,
    {
        batchId = null,
        deviceId = "",
        limit = 200,
        maxLookbackMinutes = 30,
        includePulseIds = true,
    } = {}
) {
    const db = getDb(dbPath);
    const normalizedBatchId = Number(batchId);
    const normalizedDeviceId = normalizeDeviceId(deviceId || "reflow_1");
    const activeSessionId = selectActiveOvenSessionRow(db, normalizedDeviceId)?.id || null;
    const batch = Number.isInteger(normalizedBatchId) && normalizedBatchId > 0
        ? selectBatchRowById(db, normalizedBatchId)
        : (activeSessionId ? selectActiveBatchRow(db, normalizedDeviceId, { sessionId: activeSessionId }) : null);

    if (!batch) {
        return null;
    }

    return buildBatchUnassignedSuggestion(db, batch, {
        limit,
        maxLookbackMinutes,
        includePulseIds,
    });
}

function deleteOvenBatch(dbPath, { batchId, deletePulses = false, scope = "kkw" } = {}) {
    const db = getDb(dbPath);
    const normalizedBatchId = Number(batchId);
    const hardDeletePulses = Boolean(deletePulses);
    const normalizedScope = scope === "entry" ? "entry" : "kkw";

    if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
        throw new Error("Brakuje ID partii MES do usuniecia.");
    }

    const batch = selectBatchRowById(db, normalizedBatchId);
    if (!batch) {
        throw new Error("Nie znaleziono partii MES do usuniecia.");
    }

    const relatedBatches = selectBatchRowsByDeviceAndKkw(db, batch.deviceId, batch.kkwNumber, batch.boardSide);
    const batchesToDelete = normalizedScope === "entry"
        ? [batch]
        : (relatedBatches.length ? relatedBatches : [batch]);
    const batchIds = Array.from(new Set(
        batchesToDelete
            .map((row) => Number(row?.id))
            .filter((value) => Number.isInteger(value) && value > 0)
    ));
    const hydratedBatch = hydrateBatch(db, batch);

    if (!batchIds.length) {
        throw new Error("Nie znaleziono partii MES do usuniecia.");
    }

    const placeholders = batchIds.map(() => "?").join(", ");
    const affectedPulseRows = db.prepare(`
        SELECT ${PULSE_SELECT_FIELDS}
        FROM oven_pulses
        WHERE batch_id IN (${placeholders})
        ORDER BY ts ASC, id ASC
    `).all(...batchIds);
    let detachedPulses = 0;
    let deletedPulses = 0;
    let deletedBatchCount = 0;

    db.exec("BEGIN");
    try {
        if (hardDeletePulses) {
            for (const pulseRow of affectedPulseRows) {
                removePulseFromTransit(db, pulseRow);
            }
            deletedPulses = db.prepare(`
                DELETE FROM oven_pulses
                WHERE batch_id IN (${placeholders})
            `).run(...batchIds).changes || 0;
        } else {
            detachedPulses = db.prepare(`
                UPDATE oven_pulses
                SET batch_id = NULL
                WHERE batch_id IN (${placeholders})
            `).run(...batchIds).changes || 0;
            clearTransitBatchAssignments(db, affectedPulseRows);
        }

        deletedBatchCount = db.prepare(`
            DELETE FROM mes_batches
            WHERE id IN (${placeholders})
        `).run(...batchIds).changes || 0;

        db.exec("COMMIT");
    } catch (error) {
        try {
            db.exec("ROLLBACK");
        } catch (rollbackError) {
            // ignore rollback errors and surface the original failure
        }
        throw error;
    }

    return {
        deleted: deletedBatchCount > 0,
        batch: hydratedBatch,
        batchIds,
        deletedBatchCount,
        kkwNumber: batch.kkwNumber || null,
        deviceId: batch.deviceId || null,
        scope: normalizedScope,
        detachedPulses,
        deletedPulses,
        deletePulses: hardDeletePulses,
    };
}

function deleteOvenPulses(dbPath, { pulseIds = [] } = {}) {
    const db = getDb(dbPath);
    const normalizedIds = Array.from(new Set(
        (Array.isArray(pulseIds) ? pulseIds : [pulseIds])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
    ));

    if (!normalizedIds.length) {
        throw new Error("Wybierz co najmniej jeden impuls do usuniecia.");
    }

    const placeholders = normalizedIds.map(() => "?").join(", ");
    const deletedRows = db.prepare(`
        SELECT ${PULSE_SELECT_FIELDS}
        FROM oven_pulses
        WHERE id IN (${placeholders})
        ORDER BY ts DESC, id DESC
    `).all(...normalizedIds);

    if (!deletedRows.length) {
        return {
            deleted: 0,
            pulses: [],
        };
    }

    db.exec("BEGIN");
    try {
        for (const pulseRow of deletedRows) {
            removePulseFromTransit(db, pulseRow);
        }

        db.prepare(`
            DELETE FROM oven_pulses
            WHERE id IN (${placeholders})
        `).run(...normalizedIds);
        db.exec("COMMIT");
    } catch (error) {
        try {
            db.exec("ROLLBACK");
        } catch (_rollbackError) {
            // ignore rollback errors and surface the original failure
        }
        throw error;
    }

    return {
        deleted: deletedRows.length,
        pulses: deletedRows,
    };
}

function endOvenBatch(dbPath, { deviceId = "reflow_1", operator = "" } = {}) {
    const db = getDb(dbPath);
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const activeBatch = getActiveOvenBatch(dbPath, {
        deviceId: normalizedDeviceId,
        currentSessionOnly: true,
    });

    if (!activeBatch) {
        return {
            batch: null,
            closed: false,
        };
    }

    const now = new Date().toISOString();
    db.prepare(`
        UPDATE mes_batches
        SET ended_at = ?, status = 'closed', ended_by = ?
        WHERE id = ?
    `).run(now, toNullableText(operator), activeBatch.id);

    return {
        batch: hydrateBatch(db, {
            ...activeBatch,
            endedAt: now,
            status: "closed",
            endedBy: toNullableText(operator),
        }),
        closed: true,
    };
}

function listOvenBatches(dbPath, { deviceId = "", kkwNumber = "", limit = 20 } = {}) {
    const db = getDb(dbPath);
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
    const normalizedDeviceId = String(deviceId || "").trim();
    const normalizedKkwNumber = normalizeKkwNumber(kkwNumber);
    const where = [];
    const params = [];

    if (normalizedDeviceId) {
        where.push("device_id = ?");
        params.push(normalizedDeviceId);
    }

    if (normalizedKkwNumber) {
        where.push("kkw_number = ?");
        params.push(normalizedKkwNumber);
    }

    const sql = `
        SELECT
            ${BATCH_SELECT_FIELDS}
        FROM mes_batches
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY started_at DESC, id DESC
        LIMIT ?
    `;
    const rows = db.prepare(sql).all(...params, normalizedLimit);

    return rows.map((row) => hydrateBatch(db, row));
}

function countPulsesSinceBySensor(db, deviceId, sensorId, sinceIso, sessionId = null) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    return db.prepare(`
        SELECT COUNT(*) AS count
        FROM oven_pulses
        WHERE device_id = ?
          AND sensor_id = ?
          AND (? IS NULL OR session_id = ?)
          AND ts >= ?
    `).get(deviceId, normalizeSensorId(sensorId), normalizedSessionId, normalizedSessionId, sinceIso)?.count || 0;
}

function countOvenPulsesSince(db, deviceId, sinceIso, sessionId = null) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    return db.prepare(`
        SELECT COUNT(*) AS count
        FROM oven_pulses
        WHERE device_id = ?
          AND (? IS NULL OR session_id = ?)
          AND ts >= ?
    `).get(deviceId, normalizedSessionId, normalizedSessionId, sinceIso)?.count || 0;
}

function getLastPulseBySensor(db, deviceId, sensorId, sessionId = null) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    return db.prepare(`
        SELECT ${PULSE_SELECT_FIELDS}
        FROM oven_pulses
        WHERE device_id = ?
          AND sensor_id = ?
          AND (? IS NULL OR session_id = ?)
        ORDER BY ts DESC, id DESC
        LIMIT 1
    `).get(deviceId, normalizeSensorId(sensorId), normalizedSessionId, normalizedSessionId) || null;
}

function getAveragePulseGapSeconds(db, deviceId, sensorId, limit = 20, sessionId = null) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const rows = db.prepare(`
        SELECT ts
        FROM oven_pulses
        WHERE device_id = ?
          AND sensor_id = ?
          AND (? IS NULL OR session_id = ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `).all(
        deviceId,
        normalizeSensorId(sensorId),
        normalizedSessionId,
        normalizedSessionId,
        Math.max(2, Math.min(Number(limit) || 20, 200))
    );

    return calculateAverageGapSeconds(rows.map((row) => row.ts));
}

function calculateAverageGapSeconds(values = []) {
    const sorted = (Array.isArray(values) ? values : [values])
        .map((value) => new Date(value).getTime())
        .filter((timestamp) => Number.isFinite(timestamp))
        .sort((left, right) => left - right);

    if (sorted.length < 2) {
        return null;
    }

    const gaps = [];
    for (let index = 1; index < sorted.length; index += 1) {
        gaps.push((sorted[index] - sorted[index - 1]) / 1000);
    }

    return gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
}

function getAverageTransitGapSecondsByEntryBatchIds(db, batchIds = [], limit = 20) {
    const normalizedIds = Array.from(new Set(
        (Array.isArray(batchIds) ? batchIds : [batchIds])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
    ));

    if (!normalizedIds.length) {
        return null;
    }

    const placeholders = normalizedIds.map(() => "?").join(", ");
    const rows = db.prepare(`
        SELECT entered_at AS ts
        FROM mes_oven_transits
        WHERE batch_id_in IN (${placeholders})
          AND entered_at IS NOT NULL
        ORDER BY entered_at DESC, id DESC
        LIMIT ?
    `).all(...normalizedIds, Math.max(2, Math.min(Number(limit) || 20, 200)));

    return calculateAverageGapSeconds(rows.map((row) => row.ts));
}

function getAverageTransitGapSecondsByAttributionBatchIds(db, batchIds = [], limit = 20) {
    const normalizedIds = Array.from(new Set(
        (Array.isArray(batchIds) ? batchIds : [batchIds])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
    ));

    if (!normalizedIds.length) {
        return null;
    }

    const placeholders = normalizedIds.map(() => "?").join(", ");
    const rows = db.prepare(`
        SELECT exited_at AS ts
        FROM mes_oven_transits
        WHERE COALESCE(batch_id_in, batch_id_out) IN (${placeholders})
          AND exited_at IS NOT NULL
        ORDER BY exited_at DESC, id DESC
        LIMIT ?
    `).all(...normalizedIds, Math.max(2, Math.min(Number(limit) || 20, 200)));

    return calculateAverageGapSeconds(rows.map((row) => row.ts));
}

function countOpenTransitsForDevice(db, deviceId, sessionId = null) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    return db.prepare(`
        SELECT COUNT(*) AS count
        FROM mes_oven_transits
        WHERE device_id = ?
          AND (? IS NULL OR session_id = ?)
          AND pulse_in_id IS NOT NULL
          AND pulse_out_id IS NULL
          AND status = 'open'
    `).get(deviceId, normalizedSessionId, normalizedSessionId)?.count || 0;
}

function resetOpenOvenTransits(
    dbPath,
    {
        deviceId = "reflow_1",
        operator = "",
        reason = "manual_reset",
    } = {}
) {
    const db = getDb(dbPath);
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const normalizedReason = String(reason || "").trim() || "manual_reset";
    const normalizedOperator = toNullableText(operator);
    const now = new Date().toISOString();
    const activeSession = selectActiveOvenSessionRow(db, normalizedDeviceId);
    const activeSessionId = activeSession?.id || null;
    const openTransits = selectOpenTransitRowsByDevice(db, normalizedDeviceId, activeSessionId);

    const transitIds = openTransits
        .map((row) => Number(row?.id))
        .filter((value) => Number.isInteger(value) && value > 0);
    const batchIds = Array.from(new Set(
        openTransits
            .map((row) => Number(row?.batchIdIn))
            .filter((value) => Number.isInteger(value) && value > 0)
    ));
    const affectedKkws = batchIds
        .map((batchId) => hydrateBatch(db, selectBatchRowById(db, batchId)))
        .filter(Boolean)
        .map((batch) => ({
            batchId: batch.id,
            kkwNumber: batch.kkwNumber || null,
            boardSide: batch.boardSide || null,
            startedAt: batch.startedAt || null,
        }));
    const placeholders = transitIds.map(() => "?").join(", ");
    let nextSession = null;

    db.exec("BEGIN");
    try {
        if (transitIds.length) {
            db.prepare(`
                UPDATE mes_oven_transits
                SET status = 'reset',
                    updated_at = ?
                WHERE id IN (${placeholders})
            `).run(now, ...transitIds);
        }

        if (activeSessionId) {
            closeOvenSession(db, {
                sessionId: activeSessionId,
                endedAt: now,
                operator: normalizedOperator,
                status: "reset",
            });
        }

        nextSession = createOvenSession(db, {
            deviceId: normalizedDeviceId,
            startedAt: now,
            operator: normalizedOperator,
            reason: normalizedReason,
        });
        db.exec("COMMIT");
    } catch (error) {
        try {
            db.exec("ROLLBACK");
        } catch (_rollbackError) {
            // ignore rollback errors and surface the original failure
        }
        throw error;
    }

    return {
        deviceId: normalizedDeviceId,
        resetCount: transitIds.length,
        affectedBatchIds: batchIds,
        affectedKkws,
        previousSessionId: activeSessionId,
        currentSessionId: nextSession?.id || null,
        operator: normalizedOperator,
        reason: normalizedReason,
        resetAt: now,
    };
}

function getDeviceTransitStats(db, deviceId, limit = 100, sessionId = null) {
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
    const normalizedSessionId = normalizeSessionId(sessionId);
    const row = db.prepare(`
        SELECT
            AVG(duration_seconds) AS averageDurationSeconds,
            MIN(duration_seconds) AS minDurationSeconds,
            MAX(duration_seconds) AS maxDurationSeconds,
            COUNT(*) AS sampleCount
        FROM (
            SELECT duration_seconds
            FROM mes_oven_transits
            WHERE device_id = ?
              AND (? IS NULL OR session_id = ?)
              AND duration_seconds IS NOT NULL
            ORDER BY exited_at DESC, id DESC
            LIMIT ?
        )
    `).get(deviceId, normalizedSessionId, normalizedSessionId, normalizedLimit) || {};

    return {
        averageDurationSeconds: row.averageDurationSeconds === null || row.averageDurationSeconds === undefined
            ? null
            : Number(row.averageDurationSeconds),
        minDurationSeconds: row.minDurationSeconds === null || row.minDurationSeconds === undefined
            ? null
            : Number(row.minDurationSeconds),
        maxDurationSeconds: row.maxDurationSeconds === null || row.maxDurationSeconds === undefined
            ? null
            : Number(row.maxDurationSeconds),
        sampleCount: row.sampleCount || 0,
    };
}

function getOvenSummary(dbPath, { deviceId = "reflow_1" } = {}) {
    const db = getDb(dbPath);
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const now = new Date();
    const activeSession = selectActiveOvenSessionRow(db, normalizedDeviceId);
    const activeSessionId = activeSession?.id || null;

    const lastPulse = db.prepare(`
        SELECT ${PULSE_SELECT_FIELDS}
        FROM oven_pulses
        WHERE device_id = ?
          AND (? IS NULL OR session_id = ?)
        ORDER BY ts DESC, id DESC
        LIMIT 1
    `).get(normalizedDeviceId, activeSessionId, activeSessionId) || null;

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const entryCounts = {
        last5m: countPulsesSinceBySensor(db, normalizedDeviceId, "in", new Date(now.getTime() - 5 * 60 * 1000).toISOString(), activeSessionId),
        last15m: countPulsesSinceBySensor(db, normalizedDeviceId, "in", new Date(now.getTime() - 15 * 60 * 1000).toISOString(), activeSessionId),
        last60m: countPulsesSinceBySensor(db, normalizedDeviceId, "in", new Date(now.getTime() - 60 * 60 * 1000).toISOString(), activeSessionId),
        today: countPulsesSinceBySensor(db, normalizedDeviceId, "in", todayStart.toISOString(), activeSessionId),
    };
    const counts = {
        last5m: countPulsesSinceBySensor(db, normalizedDeviceId, "out", new Date(now.getTime() - 5 * 60 * 1000).toISOString(), activeSessionId),
        last15m: countPulsesSinceBySensor(db, normalizedDeviceId, "out", new Date(now.getTime() - 15 * 60 * 1000).toISOString(), activeSessionId),
        last60m: countPulsesSinceBySensor(db, normalizedDeviceId, "out", new Date(now.getTime() - 60 * 60 * 1000).toISOString(), activeSessionId),
        today: countPulsesSinceBySensor(db, normalizedDeviceId, "out", todayStart.toISOString(), activeSessionId),
    };
    const averageEntryTaktSeconds = getAveragePulseGapSeconds(db, normalizedDeviceId, "in", 20, activeSessionId);
    const averageExitTaktSeconds = getAveragePulseGapSeconds(db, normalizedDeviceId, "out", 20, activeSessionId);
    const averageTaktSeconds = averageExitTaktSeconds;

    const lastPulseAt = lastPulse?.ts || null;
    const secondsSinceLastPulse = lastPulseAt
        ? Math.max(0, (now.getTime() - new Date(lastPulseAt).getTime()) / 1000)
        : null;
    const activeBatch = getActiveOvenBatch(dbPath, {
        deviceId: normalizedDeviceId,
        currentSessionOnly: true,
    });
    const pendingAssignment = activeBatch
        ? buildBatchUnassignedSuggestion(db, activeBatch, {
            limit: 1000,
            maxLookbackMinutes: 30,
            includePulseIds: false,
        })
        : null;
    const pcbPerHourLast15m = activeBatch?.pcsPerPanel
        ? counts.last15m * Number(activeBatch.pcsPerPanel) * 4
        : null;
    const transitStats = getDeviceTransitStats(db, normalizedDeviceId, 100, activeSessionId);
    const processMetrics = buildOvenProcessMetrics({
        averageDurationSeconds: transitStats.averageDurationSeconds,
        averageEntryTaktSeconds,
        averageExitTaktSeconds,
    });
    const inOvenCount = countOpenTransitsForDevice(db, normalizedDeviceId, activeSessionId);
    const lastEntryPulse = getLastPulseBySensor(db, normalizedDeviceId, "in", activeSessionId);
    const lastExitPulse = getLastPulseBySensor(db, normalizedDeviceId, "out", activeSessionId);

    return {
        deviceId: normalizedDeviceId,
        sessionId: activeSessionId,
        now: now.toISOString(),
        lastPulse,
        lastEntryPulse,
        lastExitPulse,
        activeBatch,
        pendingAssignment,
        counts,
        entryCounts,
        panelsPerHourLast15m: counts.last15m * 4,
        piecesPerHourLast15m: counts.last15m * 4,
        pcbPerHourLast15m,
        averageTaktSeconds,
        averageEntryTaktSeconds,
        averageExitTaktSeconds,
        sensorDistanceCm: processMetrics.sensorDistanceCm,
        averageOvenTimeSeconds: transitStats.averageDurationSeconds,
        averageOvenSpeedCmPerSecond: processMetrics.averageOvenSpeedCmPerSecond,
        averageOvenSpeedMetersPerMinute: processMetrics.averageOvenSpeedMetersPerMinute,
        averageEntrySpacingCm: processMetrics.averageEntrySpacingCm,
        averageExitSpacingCm: processMetrics.averageExitSpacingCm,
        minOvenTimeSeconds: transitStats.minDurationSeconds,
        maxOvenTimeSeconds: transitStats.maxDurationSeconds,
        ovenTimeSampleCount: transitStats.sampleCount,
        inOvenCount,
        secondsSinceLastPulse,
        status: secondsSinceLastPulse === null
            ? "Brak danych"
            : secondsSinceLastPulse > 120
                ? "Brak przeplywu"
                : "Pracuje",
    };
}

function getMesStorageMeta(dbPath) {
    const normalizedPath = normalizeDbPath(dbPath);
    return {
        dbPath: normalizedPath,
        exists: fs.existsSync(normalizedPath),
    };
}

module.exports = {
    assignOvenPulsesToBatch,
    deleteOvenBatch,
    deleteOvenPulses,
    endOvenBatch,
    getActiveOvenBatch,
    getBatchUnassignedSuggestion: getOvenBatchUnassignedSuggestion,
    getMesStorageMeta,
    getOvenSummary,
    parsePcsPerPanelFromText,
    resolveProductPcsPerPanel,
    insertOvenPulse,
    listOvenBatches,
    listOvenPulses,
    normalizeKkwNumber,
    startOvenBatch,
    updateOvenBatchDetails,
    upsertProductPcsPerPanel,
    upsertOvenBatchPcsPerPanel,
    resetOpenOvenTransits,
};
