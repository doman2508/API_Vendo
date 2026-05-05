const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
    endOvenBatch,
    getOvenSummary,
    insertOvenPulse,
    listOvenBatches,
    startOvenBatch,
} = require("../lib/mes-sqlite");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const LOCAL_MES_DB_PATH = path.join(PROJECT_ROOT, ".data", "mes.db");
const DEMO_SOURCE = "local_demo";
const DEMO_DEVICE_ID = "reflow_1";
const DEMO_OPERATOR = "demo_seed";

const DEMO_BATCHES = [
    {
        kkwNumber: "422/26",
        boardSide: "top",
        plannedQuantity: 20,
        orderNumber: "177/MSX/26/ZLP",
        productCode: "901453",
        productName: "CCNV2-ELP-20260401",
        pcsPerPanel: 4,
        startedAt: "2026-05-03T07:05:00+02:00",
        endedAt: "2026-05-03T07:34:00+02:00",
        transits: [
            { enteredAt: "2026-05-03T07:11:00+02:00", exitedAt: "2026-05-03T07:16:10+02:00" },
            { enteredAt: "2026-05-03T07:12:20+02:00", exitedAt: "2026-05-03T07:17:30+02:00" },
        ],
    },
    {
        kkwNumber: "422/26",
        boardSide: "top",
        plannedQuantity: 20,
        orderNumber: "177/MSX/26/ZLP",
        productCode: "901453",
        productName: "CCNV2-ELP-20260401",
        pcsPerPanel: 4,
        startedAt: "2026-05-03T10:20:00+02:00",
        endedAt: "2026-05-03T10:43:00+02:00",
        transits: [
            { enteredAt: "2026-05-03T10:27:00+02:00", exitedAt: "2026-05-03T10:32:15+02:00" },
        ],
    },
    {
        kkwNumber: "404/26",
        boardSide: "top",
        plannedQuantity: 40,
        orderNumber: "201/MSX/26/ZLP",
        productCode: "900179",
        productName: "VPPS 504.8",
        pcsPerPanel: 2,
        startedAt: "2026-05-04T06:45:00+02:00",
        endedAt: "2026-05-04T07:18:00+02:00",
        transits: [
            { enteredAt: "2026-05-04T06:51:00+02:00", exitedAt: "2026-05-04T06:56:05+02:00" },
            { enteredAt: "2026-05-04T06:52:15+02:00", exitedAt: "2026-05-04T06:57:25+02:00" },
            { enteredAt: "2026-05-04T06:53:35+02:00", exitedAt: "2026-05-04T06:58:50+02:00" },
        ],
    },
    {
        kkwNumber: "404/26",
        boardSide: "top",
        plannedQuantity: 40,
        orderNumber: "201/MSX/26/ZLP",
        productCode: "900179",
        productName: "VPPS 504.8",
        pcsPerPanel: 2,
        startedAt: "2026-05-04T10:10:00+02:00",
        endedAt: "2026-05-04T10:39:00+02:00",
        transits: [
            { enteredAt: "2026-05-04T10:17:20+02:00", exitedAt: "2026-05-04T10:22:30+02:00" },
            { enteredAt: "2026-05-04T10:18:45+02:00", exitedAt: "2026-05-04T10:24:05+02:00" },
        ],
    },
    {
        kkwNumber: "422/26",
        boardSide: "bot",
        plannedQuantity: 20,
        orderNumber: "177/MSX/26/ZLP",
        productCode: "901453",
        productName: "CCNV2-ELP-20260401",
        pcsPerPanel: 4,
        startedAt: "2026-05-05T06:40:00+02:00",
        endedAt: "2026-05-05T07:12:00+02:00",
        transits: [
            { enteredAt: "2026-05-05T06:47:00+02:00", exitedAt: "2026-05-05T06:52:10+02:00" },
            { enteredAt: "2026-05-05T06:48:20+02:00", exitedAt: "2026-05-05T06:53:25+02:00" },
            { enteredAt: "2026-05-05T06:49:40+02:00", exitedAt: "2026-05-05T06:54:45+02:00" },
        ],
    },
    {
        kkwNumber: "422/26",
        boardSide: "top",
        plannedQuantity: 20,
        orderNumber: "177/MSX/26/ZLP",
        productCode: "901453",
        productName: "CCNV2-ELP-20260401",
        pcsPerPanel: 4,
        startedAt: "2026-05-05T09:10:00+02:00",
        endedAt: null,
        transits: [
            { enteredAt: "2026-05-05T09:16:00+02:00", exitedAt: "2026-05-05T09:21:25+02:00" },
            { enteredAt: "2026-05-05T09:17:25+02:00", exitedAt: null },
        ],
    },
];

function ensureLocalDbTarget(dbPath) {
    const normalized = path.resolve(dbPath);
    if (normalized !== LOCAL_MES_DB_PATH) {
        throw new Error(`Odmowa: seed demo moze dzialac tylko na lokalnej bazie ${LOCAL_MES_DB_PATH}.`);
    }

    return normalized;
}

function getDb(dbPath) {
    return new DatabaseSync(dbPath);
}

function deleteDemoData(db) {
    const demoBatchIds = db.prepare(`
        SELECT id
        FROM mes_batches
        WHERE source = ?
    `).all(DEMO_SOURCE).map((row) => Number(row.id)).filter((value) => Number.isInteger(value) && value > 0);

    const demoPulseIds = db.prepare(`
        SELECT id
        FROM oven_pulses
        WHERE payload_json LIKE ?
    `).all('%"demo_seed":true%').map((row) => Number(row.id)).filter((value) => Number.isInteger(value) && value > 0);

    db.exec("BEGIN");
    try {
        if (demoPulseIds.length) {
            const pulsePlaceholders = demoPulseIds.map(() => "?").join(", ");
            db.prepare(`
                DELETE FROM mes_oven_transits
                WHERE pulse_in_id IN (${pulsePlaceholders})
                   OR pulse_out_id IN (${pulsePlaceholders})
            `).run(...demoPulseIds, ...demoPulseIds);

            db.prepare(`
                DELETE FROM oven_pulses
                WHERE id IN (${pulsePlaceholders})
            `).run(...demoPulseIds);
        }

        if (demoBatchIds.length) {
            const batchPlaceholders = demoBatchIds.map(() => "?").join(", ");
            db.prepare(`
                DELETE FROM mes_oven_transits
                WHERE batch_id_in IN (${batchPlaceholders})
                   OR batch_id_out IN (${batchPlaceholders})
            `).run(...demoBatchIds, ...demoBatchIds);

            db.prepare(`
                DELETE FROM oven_pulses
                WHERE batch_id IN (${batchPlaceholders})
            `).run(...demoBatchIds);

            db.prepare(`
                DELETE FROM mes_batches
                WHERE id IN (${batchPlaceholders})
            `).run(...demoBatchIds);
        }

        db.exec("COMMIT");
    } catch (error) {
        try {
            db.exec("ROLLBACK");
        } catch (_rollbackError) {
            // ignore rollback error and surface original failure
        }
        throw error;
    }

    return {
        deletedDemoBatches: demoBatchIds.length,
        deletedDemoPulses: demoPulseIds.length,
    };
}

function updateBatchTimestamps(db, batchId, { startedAt, endedAt }) {
    db.prepare(`
        UPDATE mes_batches
        SET started_at = ?,
            ended_at = ?,
            status = ?,
            started_by = ?,
            ended_by = ?,
            source = ?
        WHERE id = ?
    `).run(
        new Date(startedAt).toISOString(),
        endedAt ? new Date(endedAt).toISOString() : null,
        endedAt ? "closed" : "active",
        DEMO_OPERATOR,
        endedAt ? DEMO_OPERATOR : null,
        DEMO_SOURCE,
        batchId
    );
}

function seedBatch(dbPath, db, batchConfig) {
    const created = startOvenBatch(dbPath, {
        deviceId: DEMO_DEVICE_ID,
        kkwNumber: batchConfig.kkwNumber,
        boardSide: batchConfig.boardSide,
        plannedQuantity: batchConfig.plannedQuantity,
        orderNumber: batchConfig.orderNumber,
        productCode: batchConfig.productCode,
        productName: batchConfig.productName,
        pcsPerPanel: batchConfig.pcsPerPanel,
        pcsPerPanelSource: "admin_panel",
        operator: DEMO_OPERATOR,
        source: DEMO_SOURCE,
    });

    const batchId = Number(created?.batch?.id || created?.id);
    if (!Number.isInteger(batchId) || batchId <= 0) {
        throw new Error(`Nie udalo sie utworzyc demo batch dla ${batchConfig.kkwNumber}.`);
    }

    for (const transit of batchConfig.transits) {
        insertOvenPulse(dbPath, {
            device_id: DEMO_DEVICE_ID,
            sensor_id: "in",
            ts: transit.enteredAt,
            demo_seed: true,
        });

        if (transit.exitedAt) {
            insertOvenPulse(dbPath, {
                device_id: DEMO_DEVICE_ID,
                sensor_id: "out",
                ts: transit.exitedAt,
                demo_seed: true,
            });
        }
    }

    if (batchConfig.endedAt) {
        endOvenBatch(dbPath, {
            deviceId: DEMO_DEVICE_ID,
            operator: DEMO_OPERATOR,
        });
    }

    updateBatchTimestamps(db, batchId, batchConfig);
    return batchId;
}

function main() {
    const dbPath = ensureLocalDbTarget(LOCAL_MES_DB_PATH);
    getOvenSummary(dbPath, { deviceId: DEMO_DEVICE_ID });
    const db = getDb(dbPath);
    const cleanup = deleteDemoData(db);

    const seededBatchIds = DEMO_BATCHES.map((batchConfig) => seedBatch(dbPath, db, batchConfig));
    const summary = getOvenSummary(dbPath, { deviceId: DEMO_DEVICE_ID });
    const latestBatches = listOvenBatches(dbPath, { deviceId: DEMO_DEVICE_ID, limit: 12 });

    console.log(JSON.stringify({
        status: "ok",
        dbPath,
        cleanup,
        seededBatches: seededBatchIds.length,
        seededBatchIds,
        activeBatch: summary.activeBatch
            ? {
                id: summary.activeBatch.id,
                kkwNumber: summary.activeBatch.kkwNumber,
                boardSide: summary.activeBatch.boardSide,
                inputCount: summary.activeBatch.inputCount,
                outputCount: summary.activeBatch.outputCount,
                inOvenCount: summary.activeBatch.inOvenCount,
            }
            : null,
        latestKkws: latestBatches.slice(0, 6).map((batch) => ({
            id: batch.id,
            kkwNumber: batch.kkwNumber,
            boardSide: batch.boardSide,
            startedAt: batch.startedAt,
            status: batch.status,
            batchInputCount: batch.batchInputCount,
            batchOutputCount: batch.batchOutputCount,
            batchInOvenCount: batch.batchInOvenCount,
        })),
    }, null, 2));
}

main();
