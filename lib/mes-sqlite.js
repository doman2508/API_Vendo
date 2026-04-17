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
        const panelCount = countOvenPulsesForBatch(db, batch);
        return {
            panelCount,
            pcbCount: resolveBatchPcbCount(panelCount, batch?.pcsPerPanel),
            missingPcsPerPanel: !normalizePositiveInteger(batch?.pcsPerPanel),
        };
    }

    const fallbackPcsPerPanel = normalizePositiveInteger(batch?.pcsPerPanel)
        || normalizePositiveInteger(selectProductSettingsRow(db, batch?.productCode)?.pcsPerPanel);

    let panelCount = 0;
    let pcbCount = 0;
    let missingPcsPerPanel = false;

    for (const relatedBatch of relatedBatches) {
        const relatedPanelCount = countOvenPulsesForBatch(db, relatedBatch);
        const relatedPcsPerPanel = normalizePositiveInteger(relatedBatch.pcsPerPanel) || fallbackPcsPerPanel;

        panelCount += relatedPanelCount;

        if (!relatedPcsPerPanel) {
            missingPcsPerPanel = true;
            continue;
        }

        pcbCount += relatedPanelCount * relatedPcsPerPanel;
    }

    return {
        panelCount,
        pcbCount: missingPcsPerPanel ? null : pcbCount,
        missingPcsPerPanel,
    };
}

function hydrateBatch(db, batch) {
    if (!batch) {
        return null;
    }

    const batchPanelCount = countOvenPulsesForBatch(db, batch);
    const kkwMetrics = calculateKkwMetrics(db, batch);
    const panelCount = kkwMetrics.panelCount;
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
        SELECT id, device_id AS deviceId, batch_id AS batchId, sensor_id AS sensorId, ts
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
    const activeBatch = getActiveOvenBatch(dbPath, { deviceId: normalizedDeviceId });
    const pcbPerHourLast15m = activeBatch?.pcsPerPanel
        ? counts.last15m * Number(activeBatch.pcsPerPanel) * 4
        : null;

    return {
        deviceId: normalizedDeviceId,
        now: now.toISOString(),
        lastPulse,
        activeBatch,
        counts,
        panelsPerHourLast15m: counts.last15m * 4,
        piecesPerHourLast15m: counts.last15m * 4,
        pcbPerHourLast15m,
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
    upsertOvenBatchPcsPerPanel,
};
