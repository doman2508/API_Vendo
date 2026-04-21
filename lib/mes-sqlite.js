const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

let cachedDbPath = null;
let cachedDb = null;

const BATCH_SELECT_FIELDS = `
    id,
    device_id AS deviceId,
    kkw_number AS kkwNumber,
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
            sensor_id TEXT NOT NULL DEFAULT 'out',
            ts TEXT NOT NULL,
            payload_json TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_oven_pulses_device_ts
            ON oven_pulses(device_id, ts DESC);

        CREATE TABLE IF NOT EXISTS mes_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            kkw_number TEXT NOT NULL,
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

        CREATE TABLE IF NOT EXISTS mes_oven_transits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
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
    `);

    for (const column of [
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
    ensureTransitsBackfilled(cachedDb);
    return cachedDb;
}

function normalizeDeviceId(value) {
    const deviceId = String(value || "").trim();
    return deviceId || "unknown";
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

function selectBatchRowsByDeviceAndKkw(db, deviceId, kkwNumber) {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const normalizedKkwNumber = normalizeKkwNumber(kkwNumber);

    if (!normalizedDeviceId || !normalizedKkwNumber) {
        return [];
    }

    return db.prepare(`
        SELECT
            ${BATCH_SELECT_FIELDS}
        FROM mes_batches
        WHERE device_id = ?
          AND kkw_number = ?
        ORDER BY started_at DESC, id DESC
    `).all(normalizedDeviceId, normalizedKkwNumber);
}

function selectActiveBatchRow(db, deviceId) {
    return db.prepare(`
        SELECT
            ${BATCH_SELECT_FIELDS}
        FROM mes_batches
        WHERE device_id = ?
          AND status = 'active'
          AND ended_at IS NULL
        ORDER BY started_at DESC, id DESC
        LIMIT 1
    `).get(deviceId);
}

function selectPreviousBatchRow(db, batch) {
    if (!batch?.deviceId || !batch?.startedAt) {
        return null;
    }

    return db.prepare(`
        SELECT
            ${BATCH_SELECT_FIELDS}
        FROM mes_batches
        WHERE device_id = ?
          AND id <> ?
          AND started_at <= ?
        ORDER BY started_at DESC, id DESC
        LIMIT 1
    `).get(batch.deviceId, batch.id, batch.startedAt) || null;
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
        SELECT id, device_id AS deviceId, batch_id AS batchId, sensor_id AS sensorId, ts, payload_json AS payloadJson
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
        SELECT id, device_id AS deviceId, batch_id AS batchId, sensor_id AS sensorId, ts, payload_json AS payloadJson
        FROM oven_pulses
        WHERE id IN (${placeholders})
        ORDER BY ts ASC, id ASC
    `).all(...normalizedIds);
}

function selectTransitRowByPulseInId(db, pulseId) {
    return db.prepare(`
        SELECT
            id,
            device_id AS deviceId,
            pulse_in_id AS pulseInId,
            pulse_out_id AS pulseOutId,
            batch_id_in AS batchIdIn,
            batch_id_out AS batchIdOut,
            entered_at AS enteredAt,
            exited_at AS exitedAt,
            duration_seconds AS durationSeconds,
            status
        FROM mes_oven_transits
        WHERE pulse_in_id = ?
        LIMIT 1
    `).get(pulseId) || null;
}

function selectTransitRowByPulseOutId(db, pulseId) {
    return db.prepare(`
        SELECT
            id,
            device_id AS deviceId,
            pulse_in_id AS pulseInId,
            pulse_out_id AS pulseOutId,
            batch_id_in AS batchIdIn,
            batch_id_out AS batchIdOut,
            entered_at AS enteredAt,
            exited_at AS exitedAt,
            duration_seconds AS durationSeconds,
            status
        FROM mes_oven_transits
        WHERE pulse_out_id = ?
        LIMIT 1
    `).get(pulseId) || null;
}

function selectOldestOpenTransitRow(db, deviceId) {
    return db.prepare(`
        SELECT
            id,
            device_id AS deviceId,
            pulse_in_id AS pulseInId,
            pulse_out_id AS pulseOutId,
            batch_id_in AS batchIdIn,
            batch_id_out AS batchIdOut,
            entered_at AS enteredAt,
            exited_at AS exitedAt,
            duration_seconds AS durationSeconds,
            status
        FROM mes_oven_transits
        WHERE device_id = ?
          AND pulse_in_id IS NOT NULL
          AND pulse_out_id IS NULL
        ORDER BY entered_at ASC, id ASC
        LIMIT 1
    `).get(deviceId) || null;
}

function selectPulseRowsMissingTransit(db, limit = 500) {
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 500, 5000));
    return db.prepare(`
        SELECT id, device_id AS deviceId, batch_id AS batchId, sensor_id AS sensorId, ts, payload_json AS payloadJson
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

function syncTransitForPulse(db, pulseRow) {
    if (!pulseRow?.id || !pulseRow?.deviceId) {
        return null;
    }

    const now = new Date().toISOString();
    const sensorId = normalizeSensorId(pulseRow.sensorId);

    if (isEntrySensor(sensorId)) {
        const existingTransit = selectTransitRowByPulseInId(db, pulseRow.id);
        const nextStatus = resolveTransitStatus({
            pulseInId: pulseRow.id,
            pulseOutId: existingTransit?.pulseOutId || null,
        });
        const durationSeconds = resolveTransitDurationSeconds(pulseRow.ts, existingTransit?.exitedAt || null);

        if (existingTransit) {
            db.prepare(`
                UPDATE mes_oven_transits
                SET device_id = ?,
                    batch_id_in = ?,
                    entered_at = ?,
                    duration_seconds = ?,
                    status = ?,
                    updated_at = ?
                WHERE id = ?
            `).run(
                pulseRow.deviceId,
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
                pulse_in_id,
                batch_id_in,
                entered_at,
                status,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            pulseRow.deviceId,
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
        const openTransit = existingTransit || selectOldestOpenTransitRow(db, pulseRow.deviceId);
        const nextStatus = resolveTransitStatus({
            pulseInId: openTransit?.pulseInId || null,
            pulseOutId: pulseRow.id,
        });
        const durationSeconds = resolveTransitDurationSeconds(openTransit?.enteredAt || null, pulseRow.ts);

        if (openTransit) {
            db.prepare(`
                UPDATE mes_oven_transits
                SET device_id = ?,
                    pulse_out_id = ?,
                    batch_id_out = ?,
                    exited_at = ?,
                    duration_seconds = ?,
                    status = ?,
                    updated_at = ?
                WHERE id = ?
            `).run(
                pulseRow.deviceId,
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
                pulse_out_id,
                batch_id_out,
                exited_at,
                status,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            pulseRow.deviceId,
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
    const activeBatch = selectActiveBatchRow(db, deviceId);
    const batchId = activeBatch?.id || null;
    let pulse = null;

    db.exec("BEGIN");
    try {
        const result = db.prepare(`
            INSERT INTO oven_pulses (device_id, batch_id, sensor_id, ts, payload_json)
            VALUES (?, ?, ?, ?, ?)
        `).run(deviceId, batchId, sensorId, ts, payloadJson);

        pulse = {
            id: Number(result.lastInsertRowid),
            deviceId,
            batchId,
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

function listOvenPulses(dbPath, { deviceId = "", batchId = null, unassigned = false, limit = 50 } = {}) {
    const db = getDb(dbPath);
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
    const normalizedDeviceId = String(deviceId || "").trim();
    const normalizedBatchId = Number(batchId);
    const normalizedUnassigned = Boolean(unassigned);

    if (Number.isInteger(normalizedBatchId) && normalizedBatchId > 0) {
        return db.prepare(`
            SELECT id, device_id AS deviceId, batch_id AS batchId, sensor_id AS sensorId, ts, payload_json AS payloadJson
            FROM oven_pulses
            WHERE batch_id = ?
            ORDER BY ts DESC, id DESC
            LIMIT ?
        `).all(normalizedBatchId, normalizedLimit);
    }

    if (normalizedUnassigned && normalizedDeviceId) {
        return db.prepare(`
            SELECT id, device_id AS deviceId, batch_id AS batchId, sensor_id AS sensorId, ts, payload_json AS payloadJson
            FROM oven_pulses
            WHERE device_id = ?
              AND batch_id IS NULL
            ORDER BY ts DESC, id DESC
            LIMIT ?
        `).all(normalizedDeviceId, normalizedLimit);
    }

    if (normalizedUnassigned) {
        return db.prepare(`
            SELECT id, device_id AS deviceId, batch_id AS batchId, sensor_id AS sensorId, ts, payload_json AS payloadJson
            FROM oven_pulses
            WHERE batch_id IS NULL
            ORDER BY ts DESC, id DESC
            LIMIT ?
        `).all(normalizedLimit);
    }

    if (normalizedDeviceId) {
        return db.prepare(`
            SELECT id, device_id AS deviceId, batch_id AS batchId, sensor_id AS sensorId, ts, payload_json AS payloadJson
            FROM oven_pulses
            WHERE device_id = ?
            ORDER BY ts DESC, id DESC
            LIMIT ?
        `).all(normalizedDeviceId, normalizedLimit);
    }

    return db.prepare(`
        SELECT id, device_id AS deviceId, batch_id AS batchId, sensor_id AS sensorId, ts, payload_json AS payloadJson
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

    return db.prepare(`
        SELECT
            ${BATCH_SELECT_FIELDS}
        FROM mes_batches
        WHERE device_id = ?
          AND kkw_number = ?
        ORDER BY started_at ASC, id ASC
    `).all(batch.deviceId, batch.kkwNumber);
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
            COUNT(CASE WHEN pulse_in_id IS NOT NULL AND pulse_out_id IS NULL THEN 1 END) AS openCount
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
          AND ts >= ?
          AND ts < ?
    `).get(batch.deviceId, window.windowStart, window.windowEnd)?.count || 0;

    if (!count) {
        return null;
    }

    const rows = db.prepare(`
        SELECT id, device_id AS deviceId, batch_id AS batchId, sensor_id AS sensorId, ts, payload_json AS payloadJson
        FROM oven_pulses
        WHERE device_id = ?
          AND batch_id IS NULL
          AND ts >= ?
          AND ts < ?
        ORDER BY ts ASC, id ASC
        LIMIT ?
    `).all(batch.deviceId, window.windowStart, window.windowEnd, normalizedLimit);

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
        || normalizePositiveInteger(selectProductSettingsRow(db, batch?.productCode)?.pcsPerPanel);
    const relatedBatchIds = relatedBatches.map((relatedBatch) => relatedBatch.id);
    const entryAggregate = aggregateTransitsByEntryBatchIds(db, relatedBatchIds);
    const outputAggregate = aggregateTransitsByAttributionBatchIds(db, relatedBatchIds);

    let panelCount = 0;
    let pcbCount = 0;
    let missingPcsPerPanel = false;

    for (const relatedBatch of relatedBatches) {
        const relatedMetrics = getBatchTransitMetrics(db, relatedBatch);
        const relatedPanelCount = relatedMetrics.outputCount;
        const relatedPcsPerPanel = normalizePositiveInteger(relatedBatch.pcsPerPanel) || fallbackPcsPerPanel;

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

    const batchMetrics = getBatchTransitMetrics(db, batch);
    const kkwMetrics = calculateKkwMetrics(db, batch);
    const panelCount = kkwMetrics.outputCount;
    const batchPanelCount = batchMetrics.outputCount;
    const batchInputCount = batchMetrics.inputCount;
    const batchInOvenCount = batchMetrics.inOvenCount;
    const batchPcbCount = resolveBatchPcbCount(batchPanelCount, batch.pcsPerPanel);
    const kkwPcbCount = kkwMetrics.pcbCount;
    const now = new Date();
    const endedAt = batch.endedAt ? new Date(batch.endedAt) : now;
    const startedAt = new Date(batch.startedAt);
    const durationSeconds = Number.isNaN(startedAt.getTime())
        ? null
        : Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 1000);

    return {
        ...batch,
        pulseCount: panelCount,
        batchPulseCount: batchPanelCount,
        kkwPulseCount: panelCount,
        panelCount,
        batchPanelCount,
        kkwPanelCount: panelCount,
        pcbCount: kkwPcbCount,
        batchPcbCount,
        kkwPcbCount,
        hasPcsPerPanel: Boolean(normalizePositiveInteger(batch.pcsPerPanel)),
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
        pcsPerPanelMissing: !normalizePositiveInteger(batch.pcsPerPanel),
        kkwPcbCountMissing: kkwMetrics.missingPcsPerPanel,
        inputCount: kkwMetrics.inputCount,
        outputCount: kkwMetrics.outputCount,
        inCount: kkwMetrics.inputCount,
        outCount: kkwMetrics.outputCount,
        inOvenCount: kkwMetrics.inOvenCount,
        averageOvenTimeSeconds: kkwMetrics.averageDurationSeconds,
        minOvenTimeSeconds: kkwMetrics.minDurationSeconds,
        maxOvenTimeSeconds: kkwMetrics.maxDurationSeconds,
        ovenTimeSampleCount: kkwMetrics.durationSampleCount,
        batchInputCount,
        batchOutputCount: batchPanelCount,
        batchInCount: batchInputCount,
        batchOutCount: batchPanelCount,
        batchInOvenCount,
        batchAverageOvenTimeSeconds: batchMetrics.averageDurationSeconds,
        batchMinOvenTimeSeconds: batchMetrics.minDurationSeconds,
        batchMaxOvenTimeSeconds: batchMetrics.maxDurationSeconds,
        batchOvenTimeSampleCount: batchMetrics.durationSampleCount,
    };
}

function getActiveOvenBatch(dbPath, { deviceId = "reflow_1" } = {}) {
    const db = getDb(dbPath);
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const batch = selectActiveBatchRow(db, normalizedDeviceId);

    return hydrateBatch(db, batch);
}

function startOvenBatch(
    dbPath,
    {
        deviceId = "reflow_1",
        kkwNumber = "",
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
    const normalizedPlannedQuantity = toNullableNumber(plannedQuantity);
    const normalizedProductCode = normalizeProductCode(productCode);
    const normalizedProductName = toNullableText(productName);
    const now = new Date().toISOString();

    if (!normalizedKkwNumber) {
        throw new Error("Brakuje numeru KKW.");
    }

    const existing = getActiveOvenBatch(dbPath, { deviceId: normalizedDeviceId });
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

    const resolvedPcsPerPanel = resolveBatchPcsPerPanel(db, {
        productCode: normalizedProductCode,
        pcsPerPanel,
        pcsPerPanelSource,
    });

    const result = db.prepare(`
        INSERT INTO mes_batches (
            device_id,
            kkw_number,
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
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `).run(
        normalizedDeviceId,
        normalizedKkwNumber,
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
        plannedQuantity = null,
        orderNumber = "",
        productCode = "",
        productName = "",
        pcsPerPanel = null,
        pcsPerPanelSource = "",
    } = {}
) {
    const db = getDb(dbPath);
    const normalizedBatchId = Number(batchId);
    const normalizedPlannedQuantity = toNullableNumber(plannedQuantity);
    const normalizedPcsPerPanel = normalizePositiveInteger(pcsPerPanel);
    const updates = [];
    const values = [];

    if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
        throw new Error("Brakuje ID partii MES.");
    }

    const currentBatch = selectBatchRowById(db, normalizedBatchId);
    if (!currentBatch) {
        throw new Error("Nie znaleziono partii MES.");
    }

    if (normalizedPlannedQuantity !== null && normalizedPlannedQuantity > 0) {
        updates.push("planned_quantity = ?");
        values.push(normalizedPlannedQuantity);
    }

    const normalizedKkwNumber = normalizeKkwNumber(kkwNumber);
    if (normalizedKkwNumber) {
        updates.push("kkw_number = ?");
        values.push(normalizedKkwNumber);
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
        db.prepare(`
            UPDATE mes_batches
            SET ${updates.join(", ")}
            WHERE id = ?
        `).run(...values, normalizedBatchId);
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

    const batch = Number.isInteger(normalizedBatchId) && normalizedBatchId > 0
        ? selectBatchRowById(db, normalizedBatchId)
        : selectActiveBatchRow(db, normalizedDeviceId);

    if (!batch) {
        throw new Error("Brakuje aktywnej partii MES do aktualizacji.");
    }

    db.prepare(`
        UPDATE mes_batches
        SET pcs_per_panel = ?, pcs_per_panel_source = ?
        WHERE id = ?
    `).run(normalizedPcsPerPanel, normalizedSource, batch.id);

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
    } = {}
) {
    const db = getDb(dbPath);
    const normalizedBatchId = Number(batchId);
    const useSuggestedUnassigned = Boolean(suggestedUnassigned);

    if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
        throw new Error("Brakuje ID partii MES do przypisania impulsow.");
    }

    const batch = selectBatchRowById(db, normalizedBatchId);
    if (!batch) {
        throw new Error("Nie znaleziono partii MES do przypisania impulsow.");
    }

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
                SET batch_id = ?
                WHERE device_id = ?
                  AND batch_id IS NULL
                  AND ts >= ?
                  AND ts < ?
            `).run(batch.id, batch.deviceId, suggestion.windowStart, suggestion.windowEnd).changes || 0;
            syncTransitBatchAssignments(db, suggestionPulseRows.map((pulseRow) => ({
                ...pulseRow,
                batchId: batch.id,
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
        SELECT id, device_id AS deviceId, batch_id AS batchId, sensor_id AS sensorId, ts, payload_json AS payloadJson
        FROM oven_pulses
        WHERE id IN (${placeholders})
        ORDER BY ts ASC, id ASC
    `).all(...normalizedIds);

    const eligibleIds = selectedRows
        .filter((row) => row.deviceId === batch.deviceId && (row.batchId === null || row.batchId === undefined))
        .map((row) => row.id);

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
            SET batch_id = ?
            WHERE id IN (${eligiblePlaceholders})
              AND device_id = ?
              AND batch_id IS NULL
        `).run(batch.id, ...eligibleIds, batch.deviceId).changes || 0;
        syncTransitBatchAssignments(db, selectedRows
            .filter((row) => eligibleIds.includes(row.id))
            .map((pulseRow) => ({
                ...pulseRow,
                batchId: batch.id,
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
    const batch = Number.isInteger(normalizedBatchId) && normalizedBatchId > 0
        ? selectBatchRowById(db, normalizedBatchId)
        : selectActiveBatchRow(db, normalizedDeviceId);

    if (!batch) {
        return null;
    }

    return buildBatchUnassignedSuggestion(db, batch, {
        limit,
        maxLookbackMinutes,
        includePulseIds,
    });
}

function deleteOvenBatch(dbPath, { batchId, deletePulses = false } = {}) {
    const db = getDb(dbPath);
    const normalizedBatchId = Number(batchId);
    const hardDeletePulses = Boolean(deletePulses);

    if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
        throw new Error("Brakuje ID partii MES do usuniecia.");
    }

    const batch = selectBatchRowById(db, normalizedBatchId);
    if (!batch) {
        throw new Error("Nie znaleziono partii MES do usuniecia.");
    }

    const relatedBatches = selectBatchRowsByDeviceAndKkw(db, batch.deviceId, batch.kkwNumber);
    const batchesToDelete = relatedBatches.length ? relatedBatches : [batch];
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
        SELECT id, device_id AS deviceId, batch_id AS batchId, sensor_id AS sensorId, ts, payload_json AS payloadJson
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
        SELECT id, device_id AS deviceId, batch_id AS batchId, sensor_id AS sensorId, ts, payload_json AS payloadJson
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
    const activeBatch = getActiveOvenBatch(dbPath, { deviceId: normalizedDeviceId });

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

function countPulsesSinceBySensor(db, deviceId, sensorId, sinceIso) {
    return db.prepare(`
        SELECT COUNT(*) AS count
        FROM oven_pulses
        WHERE device_id = ?
          AND sensor_id = ?
          AND ts >= ?
    `).get(deviceId, normalizeSensorId(sensorId), sinceIso)?.count || 0;
}

function countOvenPulsesSince(db, deviceId, sinceIso) {
    return db.prepare(`
        SELECT COUNT(*) AS count
        FROM oven_pulses
        WHERE device_id = ?
          AND ts >= ?
    `).get(deviceId, sinceIso)?.count || 0;
}

function getLastPulseBySensor(db, deviceId, sensorId) {
    return db.prepare(`
        SELECT id, device_id AS deviceId, batch_id AS batchId, sensor_id AS sensorId, ts
        FROM oven_pulses
        WHERE device_id = ?
          AND sensor_id = ?
        ORDER BY ts DESC, id DESC
        LIMIT 1
    `).get(deviceId, normalizeSensorId(sensorId)) || null;
}

function getAveragePulseGapSeconds(db, deviceId, sensorId, limit = 20) {
    const rows = db.prepare(`
        SELECT ts
        FROM oven_pulses
        WHERE device_id = ?
          AND sensor_id = ?
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `).all(deviceId, normalizeSensorId(sensorId), Math.max(2, Math.min(Number(limit) || 20, 200)));

    const sorted = rows
        .map((row) => new Date(row.ts).getTime())
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

function countOpenTransitsForDevice(db, deviceId) {
    return db.prepare(`
        SELECT COUNT(*) AS count
        FROM mes_oven_transits
        WHERE device_id = ?
          AND pulse_in_id IS NOT NULL
          AND pulse_out_id IS NULL
    `).get(deviceId)?.count || 0;
}

function getDeviceTransitStats(db, deviceId, limit = 100) {
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
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
              AND duration_seconds IS NOT NULL
            ORDER BY exited_at DESC, id DESC
            LIMIT ?
        )
    `).get(deviceId, normalizedLimit) || {};

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

    const lastPulse = db.prepare(`
        SELECT id, device_id AS deviceId, batch_id AS batchId, sensor_id AS sensorId, ts
        FROM oven_pulses
        WHERE device_id = ?
        ORDER BY ts DESC, id DESC
        LIMIT 1
    `).get(normalizedDeviceId) || null;

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const entryCounts = {
        last5m: countPulsesSinceBySensor(db, normalizedDeviceId, "in", new Date(now.getTime() - 5 * 60 * 1000).toISOString()),
        last15m: countPulsesSinceBySensor(db, normalizedDeviceId, "in", new Date(now.getTime() - 15 * 60 * 1000).toISOString()),
        last60m: countPulsesSinceBySensor(db, normalizedDeviceId, "in", new Date(now.getTime() - 60 * 60 * 1000).toISOString()),
        today: countPulsesSinceBySensor(db, normalizedDeviceId, "in", todayStart.toISOString()),
    };
    const counts = {
        last5m: countPulsesSinceBySensor(db, normalizedDeviceId, "out", new Date(now.getTime() - 5 * 60 * 1000).toISOString()),
        last15m: countPulsesSinceBySensor(db, normalizedDeviceId, "out", new Date(now.getTime() - 15 * 60 * 1000).toISOString()),
        last60m: countPulsesSinceBySensor(db, normalizedDeviceId, "out", new Date(now.getTime() - 60 * 60 * 1000).toISOString()),
        today: countPulsesSinceBySensor(db, normalizedDeviceId, "out", todayStart.toISOString()),
    };
    const averageEntryTaktSeconds = getAveragePulseGapSeconds(db, normalizedDeviceId, "in", 20);
    const averageExitTaktSeconds = getAveragePulseGapSeconds(db, normalizedDeviceId, "out", 20);
    const averageTaktSeconds = averageExitTaktSeconds;

    const lastPulseAt = lastPulse?.ts || null;
    const secondsSinceLastPulse = lastPulseAt
        ? Math.max(0, (now.getTime() - new Date(lastPulseAt).getTime()) / 1000)
        : null;
    const activeBatch = getActiveOvenBatch(dbPath, { deviceId: normalizedDeviceId });
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
    const transitStats = getDeviceTransitStats(db, normalizedDeviceId, 100);
    const inOvenCount = countOpenTransitsForDevice(db, normalizedDeviceId);
    const lastEntryPulse = getLastPulseBySensor(db, normalizedDeviceId, "in");
    const lastExitPulse = getLastPulseBySensor(db, normalizedDeviceId, "out");

    return {
        deviceId: normalizedDeviceId,
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
        averageOvenTimeSeconds: transitStats.averageDurationSeconds,
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
    insertOvenPulse,
    listOvenBatches,
    listOvenPulses,
    normalizeKkwNumber,
    startOvenBatch,
    updateOvenBatchDetails,
    upsertOvenBatchPcsPerPanel,
};
