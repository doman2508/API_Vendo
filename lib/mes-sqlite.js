const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

let cachedDbPath = null;
let cachedDb = null;

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
            source TEXT NOT NULL DEFAULT 'scan'
        );

        CREATE INDEX IF NOT EXISTS idx_mes_batches_device_status
            ON mes_batches(device_id, status, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_mes_batches_kkw
            ON mes_batches(kkw_number);
    `);

    try {
        db.exec(`ALTER TABLE oven_pulses ADD COLUMN sensor_id TEXT NOT NULL DEFAULT 'out';`);
    } catch (_error) {
        // Column already exists in initialized databases.
    }

    try {
        db.exec(`ALTER TABLE oven_pulses ADD COLUMN batch_id INTEGER;`);
    } catch (_error) {
        // Column already exists in initialized databases.
    }

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_oven_pulses_batch
            ON oven_pulses(batch_id);
    `);

    try {
        db.exec(`ALTER TABLE mes_batches ADD COLUMN planned_quantity REAL;`);
    } catch (_error) {
        // Column already exists in initialized databases.
    }

    for (const column of [
        "order_number TEXT",
        "product_code TEXT",
        "product_name TEXT",
    ]) {
        try {
            db.exec(`ALTER TABLE mes_batches ADD COLUMN ${column};`);
        } catch (_error) {
            // Column already exists in initialized databases.
        }
    }
}

function selectActiveBatchRow(db, deviceId) {
    return db.prepare(`
        SELECT
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
            source
        FROM mes_batches
        WHERE device_id = ?
          AND status = 'active'
          AND ended_at IS NULL
        ORDER BY started_at DESC, id DESC
        LIMIT 1
    `).get(deviceId);
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
    return cachedDb;
}

function normalizeDeviceId(value) {
    const deviceId = String(value || "").trim();
    return deviceId || "unknown";
}

function normalizeSensorId(value) {
    const sensorId = String(value || "").trim().toLowerCase();
    return sensorId || "out";
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

function insertOvenPulse(dbPath, payload = {}) {
    const db = getDb(dbPath);
    const deviceId = normalizeDeviceId(payload.device_id || payload.deviceId);
    const sensorId = normalizeSensorId(payload.sensor_id || payload.sensorId);
    const ts = new Date().toISOString();
    const payloadJson = JSON.stringify(payload || {});
    const activeBatch = selectActiveBatchRow(db, deviceId);
    const batchId = activeBatch?.id || null;

    const result = db.prepare(`
        INSERT INTO oven_pulses (device_id, batch_id, sensor_id, ts, payload_json)
        VALUES (?, ?, ?, ?, ?)
    `).run(deviceId, batchId, sensorId, ts, payloadJson);

    return {
        id: Number(result.lastInsertRowid),
        deviceId,
        batchId,
        sensorId,
        ts,
    };
}

function listOvenPulses(dbPath, { deviceId = "", batchId = null, limit = 50 } = {}) {
    const db = getDb(dbPath);
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
    const normalizedDeviceId = String(deviceId || "").trim();
    const normalizedBatchId = Number(batchId);

    if (Number.isInteger(normalizedBatchId) && normalizedBatchId > 0) {
        return db.prepare(`
            SELECT id, device_id AS deviceId, batch_id AS batchId, sensor_id AS sensorId, ts, payload_json AS payloadJson
            FROM oven_pulses
            WHERE batch_id = ?
            ORDER BY ts DESC, id DESC
            LIMIT ?
        `).all(normalizedBatchId, normalizedLimit);
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

function countOvenPulsesForBatch(db, batch) {
    if (!batch) {
        return 0;
    }

    const directCount = db.prepare(`
        SELECT COUNT(*) AS count
        FROM oven_pulses
        WHERE batch_id = ?
    `).get(batch.id)?.count || 0;

    if (directCount > 0) {
        return directCount;
    }

    return countOvenPulsesBetween(db, batch.deviceId, batch.startedAt, batch.endedAt);
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

function countOvenPulsesForKkw(db, batch) {
    if (!batch?.kkwNumber) {
        return countOvenPulsesForBatch(db, batch);
    }

    const relatedBatches = db.prepare(`
        SELECT
            id,
            device_id AS deviceId,
            started_at AS startedAt,
            ended_at AS endedAt
        FROM mes_batches
        WHERE device_id = ?
          AND kkw_number = ?
        ORDER BY started_at ASC, id ASC
    `).all(batch.deviceId, batch.kkwNumber);

    if (!relatedBatches.length) {
        return countOvenPulsesForBatch(db, batch);
    }

    const batchIds = relatedBatches.map((item) => Number(item.id)).filter((id) => Number.isInteger(id) && id > 0);
    const placeholders = batchIds.map(() => "?").join(", ");
    const directCount = batchIds.length
        ? db.prepare(`
            SELECT COUNT(*) AS count
            FROM oven_pulses
            WHERE batch_id IN (${placeholders})
        `).get(...batchIds)?.count || 0
        : 0;

    const fallbackCount = relatedBatches.reduce(
        (sum, item) => sum + countUnassignedOvenPulsesBetween(db, item.deviceId, item.startedAt, item.endedAt),
        0
    );

    return directCount + fallbackCount;
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

function hydrateBatch(db, batch) {
    if (!batch) {
        return null;
    }

    const batchPulseCount = countOvenPulsesForBatch(db, batch);
    const kkwPulseCount = countOvenPulsesForKkw(db, batch);
    const pulseCount = kkwPulseCount;
    const now = new Date();
    const endedAt = batch.endedAt ? new Date(batch.endedAt) : now;
    const startedAt = new Date(batch.startedAt);
    const durationSeconds = Number.isNaN(startedAt.getTime())
        ? null
        : Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 1000);

    return {
        ...batch,
        pulseCount,
        batchPulseCount,
        kkwPulseCount,
        remainingQuantity: batch.plannedQuantity === null || batch.plannedQuantity === undefined
            ? null
            : Math.max(0, Number(batch.plannedQuantity) - pulseCount),
        progressPercent: batch.plannedQuantity
            ? (pulseCount / Number(batch.plannedQuantity)) * 100
            : null,
        durationSeconds,
    };
}

function getActiveOvenBatch(dbPath, { deviceId = "reflow_1" } = {}) {
    const db = getDb(dbPath);
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const batch = selectActiveBatchRow(db, normalizedDeviceId);

    return hydrateBatch(db, batch);
}

function startOvenBatch(dbPath, { deviceId = "reflow_1", kkwNumber = "", plannedQuantity = null, orderNumber = "", productCode = "", productName = "", operator = "", source = "scan" } = {}) {
    const db = getDb(dbPath);
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const normalizedKkwNumber = normalizeKkwNumber(kkwNumber);
    const normalizedPlannedQuantity = toNullableNumber(plannedQuantity);
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
        `).run(now, String(operator || "").trim() || null, existing.id);
        closedBatch = hydrateBatch(db, { ...existing, endedAt: now, status: "closed", endedBy: String(operator || "").trim() || null });
    }

    const result = db.prepare(`
        INSERT INTO mes_batches (device_id, kkw_number, planned_quantity, order_number, product_code, product_name, started_at, status, started_by, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
        normalizedDeviceId,
        normalizedKkwNumber,
        normalizedPlannedQuantity,
        toNullableText(orderNumber),
        toNullableText(productCode),
        toNullableText(productName),
        now,
        String(operator || "").trim() || null,
        String(source || "scan").trim() || "scan"
    );

    return {
        closedBatch,
        batch: getActiveOvenBatch(dbPath, { deviceId: normalizedDeviceId }),
        id: Number(result.lastInsertRowid),
    };
}

function updateOvenBatchDetails(dbPath, { batchId, plannedQuantity = null, orderNumber = "", productCode = "", productName = "" } = {}) {
    const db = getDb(dbPath);
    const normalizedBatchId = Number(batchId);
    const normalizedPlannedQuantity = toNullableNumber(plannedQuantity);
    const updates = [];
    const values = [];

    if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
        throw new Error("Brakuje ID partii MES.");
    }

    if (normalizedPlannedQuantity !== null && normalizedPlannedQuantity > 0) {
        updates.push("planned_quantity = ?");
        values.push(normalizedPlannedQuantity);
    }

    for (const [column, value] of [
        ["order_number", orderNumber],
        ["product_code", productCode],
        ["product_name", productName],
    ]) {
        const text = toNullableText(value);
        if (text) {
            updates.push(`${column} = ?`);
            values.push(text);
        }
    }

    if (!updates.length) {
        return null;
    }

    db.prepare(`
        UPDATE mes_batches
        SET ${updates.join(", ")}
        WHERE id = ?
    `).run(...values, normalizedBatchId);

    const batch = db.prepare(`
        SELECT
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
            source
        FROM mes_batches
        WHERE id = ?
    `).get(normalizedBatchId);

    return hydrateBatch(db, batch);
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
    `).run(now, String(operator || "").trim() || null, activeBatch.id);

    return {
        batch: hydrateBatch(db, {
            ...activeBatch,
            endedAt: now,
            status: "closed",
            endedBy: String(operator || "").trim() || null,
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
            source
        FROM mes_batches
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY started_at DESC, id DESC
        LIMIT ?
    `;
    const rows = db.prepare(sql).all(...params, normalizedLimit);

    return rows.map((row) => hydrateBatch(db, row));
}

function countOvenPulsesSince(db, deviceId, sinceIso) {
    return db.prepare(`
        SELECT COUNT(*) AS count
        FROM oven_pulses
        WHERE device_id = ?
          AND ts >= ?
    `).get(deviceId, sinceIso)?.count || 0;
}

function getOvenSummary(dbPath, { deviceId = "reflow_1" } = {}) {
    const db = getDb(dbPath);
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const now = new Date();

    const lastPulse = db.prepare(`
        SELECT id, device_id AS deviceId, batch_id AS batchId, ts
        FROM oven_pulses
        WHERE device_id = ?
        ORDER BY ts DESC, id DESC
        LIMIT 1
    `).get(normalizedDeviceId) || null;

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const counts = {
        last5m: countOvenPulsesSince(db, normalizedDeviceId, new Date(now.getTime() - 5 * 60 * 1000).toISOString()),
        last15m: countOvenPulsesSince(db, normalizedDeviceId, new Date(now.getTime() - 15 * 60 * 1000).toISOString()),
        last60m: countOvenPulsesSince(db, normalizedDeviceId, new Date(now.getTime() - 60 * 60 * 1000).toISOString()),
        today: countOvenPulsesSince(db, normalizedDeviceId, todayStart.toISOString()),
    };

    const recentRows = db.prepare(`
        SELECT ts
        FROM oven_pulses
        WHERE device_id = ?
        ORDER BY ts DESC, id DESC
        LIMIT 20
    `).all(normalizedDeviceId);

    const sortedRecent = recentRows
        .map((row) => new Date(row.ts).getTime())
        .filter((timestamp) => Number.isFinite(timestamp))
        .sort((left, right) => left - right);

    let averageTaktSeconds = null;
    if (sortedRecent.length > 1) {
        const gaps = [];
        for (let index = 1; index < sortedRecent.length; index += 1) {
            gaps.push((sortedRecent[index] - sortedRecent[index - 1]) / 1000);
        }
        averageTaktSeconds = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
    }

    const lastPulseAt = lastPulse?.ts || null;
    const secondsSinceLastPulse = lastPulseAt
        ? Math.max(0, (now.getTime() - new Date(lastPulseAt).getTime()) / 1000)
        : null;

    return {
        deviceId: normalizedDeviceId,
        now: now.toISOString(),
        lastPulse,
        activeBatch: getActiveOvenBatch(dbPath, { deviceId: normalizedDeviceId }),
        counts,
        piecesPerHourLast15m: counts.last15m * 4,
        averageTaktSeconds,
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
    endOvenBatch,
    getActiveOvenBatch,
    getMesStorageMeta,
    getOvenSummary,
    insertOvenPulse,
    listOvenBatches,
    listOvenPulses,
    normalizeKkwNumber,
    startOvenBatch,
    updateOvenBatchDetails,
};
