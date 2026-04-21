const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

let cachedDbPath = null;
let cachedDb = null;

function normalizeDbPath(dbPath) {
    return path.resolve(String(dbPath || "").trim());
}

function ensureParentDirectory(filePath) {
    const directoryPath = path.dirname(filePath);
    fs.mkdirSync(directoryPath, { recursive: true });
}

function toSqliteBoolean(value) {
    return value ? 1 : 0;
}

function toNullableNumber(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function toNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function toNullableText(value) {
    const normalized = String(value ?? "").trim();
    return normalized || null;
}

function toIsoText(value) {
    if (!value) {
        return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        const raw = String(value).trim();
        return raw || null;
    }

    return date.toISOString();
}

function initializeSchema(db) {
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS app_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS zakupy_headers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_system TEXT NOT NULL DEFAULT 'access',
            source_access_id INTEGER,
            source_plan_position_id INTEGER,
            source_plan_order_id INTEGER,
            source_order_id INTEGER,
            source_kkw_id INTEGER,
            kkw_number TEXT,
            zlp_number TEXT,
            nr_obcy TEXT,
            product_index TEXT NOT NULL,
            product_name TEXT NOT NULL,
            client_name TEXT,
            order_qty REAL NOT NULL DEFAULT 0,
            term_date TEXT,
            smd_done INTEGER NOT NULL DEFAULT 0,
            tht_done INTEGER NOT NULL DEFAULT 0,
            is_closed INTEGER NOT NULL DEFAULT 0,
            packet_flag INTEGER NOT NULL DEFAULT 0,
            zak_status INTEGER,
            notes TEXT,
            created_by TEXT,
            source_created_at TEXT,
            smd_done_at TEXT,
            tht_done_at TEXT,
            imported_at TEXT NOT NULL,
            UNIQUE(source_system, source_access_id)
        );

        CREATE INDEX IF NOT EXISTS idx_zakupy_headers_product_index
            ON zakupy_headers(product_index);
        CREATE INDEX IF NOT EXISTS idx_zakupy_headers_kkw_number
            ON zakupy_headers(kkw_number);
        CREATE INDEX IF NOT EXISTS idx_zakupy_headers_plan_position
            ON zakupy_headers(source_plan_position_id);

        CREATE TABLE IF NOT EXISTS zakupy_bom_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_system TEXT NOT NULL DEFAULT 'access',
            header_id INTEGER NOT NULL,
            source_header_access_id INTEGER,
            source_material_id INTEGER,
            parent_reference TEXT,
            parent_product_name TEXT,
            component_code TEXT NOT NULL,
            component_name TEXT NOT NULL,
            component_qty REAL NOT NULL DEFAULT 0,
            required_qty REAL NOT NULL DEFAULT 0,
            wms_stock REAL NOT NULL DEFAULT 0,
            wms_ordered REAL NOT NULL DEFAULT 0,
            vendo_stock REAL NOT NULL DEFAULT 0,
            vendo_ordered REAL NOT NULL DEFAULT 0,
            to_order REAL NOT NULL DEFAULT 0,
            type_name TEXT,
            smd_done INTEGER NOT NULL DEFAULT 0,
            tht_done INTEGER NOT NULL DEFAULT 0,
            wms_label TEXT,
            vendo_label TEXT,
            note_1 TEXT,
            note_2 TEXT,
            note_3 TEXT,
            add_1 REAL,
            add_2 REAL,
            add_text_1 TEXT,
            add_text_2 TEXT,
            add_int REAL,
            imported_at TEXT NOT NULL,
            FOREIGN KEY(header_id) REFERENCES zakupy_headers(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_zakupy_bom_header
            ON zakupy_bom_items(header_id);
        CREATE INDEX IF NOT EXISTS idx_zakupy_bom_component
            ON zakupy_bom_items(component_code);
        CREATE INDEX IF NOT EXISTS idx_zakupy_bom_source_header
            ON zakupy_bom_items(source_header_access_id);

        CREATE TABLE IF NOT EXISTS zakupy_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL,
            entity_id INTEGER NOT NULL,
            field_name TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            changed_by TEXT,
            changed_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS zapotrzebowanie_bom_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_position_id INTEGER NOT NULL,
            source_type TEXT NOT NULL,
            source_material_id INTEGER NOT NULL,
            component_code TEXT,
            note TEXT,
            changed_by TEXT,
            updated_at TEXT NOT NULL,
            UNIQUE(plan_position_id, source_type, source_material_id)
        );

        CREATE INDEX IF NOT EXISTS idx_zapotrzebowanie_bom_notes_plan_position
            ON zapotrzebowanie_bom_notes(plan_position_id);
    `);
}

function getDatabase(dbPath) {
    const normalizedPath = normalizeDbPath(dbPath);
    if (cachedDb && cachedDbPath === normalizedPath) {
        return cachedDb;
    }

    if (cachedDb) {
        cachedDb.close();
        cachedDb = null;
        cachedDbPath = null;
    }

    ensureParentDirectory(normalizedPath);
    const db = new DatabaseSync(normalizedPath);
    initializeSchema(db);

    cachedDb = db;
    cachedDbPath = normalizedPath;
    return cachedDb;
}

function setMetaValue(db, key, value) {
    const statement = db.prepare(`
        INSERT INTO app_meta (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
    `);

    statement.run(key, String(value ?? ""), new Date().toISOString());
}

function toBoolean(value) {
    return Boolean(Number(value) || value === true);
}

function mapHeaderRow(row) {
    return {
        id: Number(row.id),
        sourceAccessId: row.sourceAccessId === null ? null : Number(row.sourceAccessId),
        sourcePlanPositionId: row.sourcePlanPositionId === null ? null : Number(row.sourcePlanPositionId),
        sourcePlanOrderId: row.sourcePlanOrderId === null ? null : Number(row.sourcePlanOrderId),
        sourceOrderId: row.sourceOrderId === null ? null : Number(row.sourceOrderId),
        sourceKkwId: row.sourceKkwId === null ? null : Number(row.sourceKkwId),
        kkwNumber: row.kkwNumber || null,
        zlpNumber: row.zlpNumber || null,
        nrObcy: row.nrObcy || null,
        productIndex: row.productIndex || null,
        productName: row.productName || "",
        clientName: row.clientName || null,
        orderQty: Number(row.orderQty) || 0,
        termDate: row.termDate || null,
        smdDone: toBoolean(row.smdDone),
        thtDone: toBoolean(row.thtDone),
        isClosed: toBoolean(row.isClosed),
        packetFlag: toBoolean(row.packetFlag),
        zakStatus: row.zakStatus === null ? null : Number(row.zakStatus),
        notes: row.notes || null,
        createdBy: row.createdBy || null,
        sourceCreatedAt: row.sourceCreatedAt || null,
        importedAt: row.importedAt || null,
        bomCount: Number(row.bomCount) || 0,
        openBomCount: Number(row.openBomCount) || 0,
        shortageBomCount: Number(row.shortageBomCount) || 0,
        shortageQty: Number(row.shortageQty) || 0,
    };
}

function mapBomRow(row) {
    return {
        id: Number(row.id),
        headerId: Number(row.headerId),
        sourceHeaderAccessId: row.sourceHeaderAccessId === null ? null : Number(row.sourceHeaderAccessId),
        sourceMaterialId: row.sourceMaterialId === null ? null : Number(row.sourceMaterialId),
        parentReference: row.parentReference || null,
        parentProductName: row.parentProductName || null,
        componentCode: row.componentCode || "",
        componentName: row.componentName || "",
        componentQty: Number(row.componentQty) || 0,
        requiredQty: Number(row.requiredQty) || 0,
        wmsStock: Number(row.wmsStock) || 0,
        wmsOrdered: Number(row.wmsOrdered) || 0,
        vendoStock: Number(row.vendoStock) || 0,
        vendoOrdered: Number(row.vendoOrdered) || 0,
        toOrder: Number(row.toOrder) || 0,
        typeName: row.typeName || null,
        smdDone: toBoolean(row.smdDone),
        thtDone: toBoolean(row.thtDone),
        wmsLabel: row.wmsLabel || null,
        vendoLabel: row.vendoLabel || null,
        note1: row.note1 || null,
        note2: row.note2 || null,
        note3: row.note3 || null,
        add1: row.add1 === null ? null : Number(row.add1),
        add2: row.add2 === null ? null : Number(row.add2),
        addText1: row.addText1 || null,
        addText2: row.addText2 || null,
        addInt: row.addInt === null ? null : Number(row.addInt),
        importedAt: row.importedAt || null,
    };
}

function determineHeaderStage(header) {
    if (header.isClosed) {
        return {
            key: "CLOSED",
            label: "Gotowe",
        };
    }

    if (!header.smdDone && !header.thtDone) {
        return {
            key: "PENDING_BOTH",
            label: "SMD + THT",
        };
    }

    if (!header.smdDone) {
        return {
            key: "PENDING_SMD",
            label: "Do SMD",
        };
    }

    if (!header.thtDone) {
        return {
            key: "PENDING_THT",
            label: "Do THT",
        };
    }

    return {
        key: "READY",
        label: "Do kontroli",
    };
}

function determineBomOpen(item) {
    const normalizedType = String(item?.typeName || "").trim().toUpperCase();
    if (normalizedType === "THT") {
        return !item.thtDone;
    }

    if (normalizedType === "SMD" || normalizedType === "PCB" || normalizedType.startsWith("P") && normalizedType.includes("FABRYKAT")) {
        return !item.smdDone;
    }

    return !item.smdDone || !item.thtDone;
}

function normalizeBomComponentKey(value) {
    return String(value || "").trim().toUpperCase();
}

function normalizeDateKey(value) {
    if (!value) {
        return "";
    }

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
        return date.toISOString().slice(0, 10);
    }

    return String(value || "").trim().slice(0, 10);
}

function buildImportedBomNoteText(item) {
    const uniqueParts = [];
    for (const candidate of [item?.note1, item?.note2, item?.note3, item?.addText1, item?.addText2]) {
        const value = String(candidate ?? "").trim();
        if (!value || uniqueParts.includes(value)) {
            continue;
        }
        uniqueParts.push(value);
    }

    return uniqueParts.join(" | ");
}

function mergeAccessBomNoteMap(rows) {
    const notesByComponent = new Map();

    for (const row of rows || []) {
        const componentKey = normalizeBomComponentKey(row?.componentCode);
        if (!componentKey) {
            continue;
        }

        const noteText = buildImportedBomNoteText(row);
        if (!noteText) {
            continue;
        }

        const existing = notesByComponent.get(componentKey);
        if (!existing) {
            notesByComponent.set(componentKey, noteText);
            continue;
        }

        const merged = [...new Set([...existing.split(" | ").map((item) => item.trim()).filter(Boolean), ...noteText.split(" | ").map((item) => item.trim()).filter(Boolean)])];
        notesByComponent.set(componentKey, merged.join(" | "));
    }

    return notesByComponent;
}

function findAccessHeaderIdForLiveHeader(db, { planPositionId, productIndex, kkwNumber, termDate }) {
    const normalizedPlanPositionId = Number(planPositionId);
    const normalizedProductIndex = String(productIndex || "").trim();
    const normalizedKkwNumber = String(kkwNumber || "").trim();
    const normalizedTermDate = normalizeDateKey(termDate);

    if (Number.isInteger(normalizedPlanPositionId) && normalizedPlanPositionId > 0) {
        const matchedByPlanPosition = db.prepare(`
            SELECT id
            FROM zakupy_headers
            WHERE source_system = 'access'
              AND source_plan_position_id = ?
            ORDER BY imported_at DESC, source_created_at DESC, id DESC
            LIMIT 1
        `).get(normalizedPlanPositionId);

        if (matchedByPlanPosition?.id) {
            return Number(matchedByPlanPosition.id);
        }
    }

    if (normalizedProductIndex && normalizedKkwNumber) {
        const matchedByKkw = db.prepare(`
            SELECT id
            FROM zakupy_headers
            WHERE source_system = 'access'
              AND product_index = ?
              AND UPPER(COALESCE(kkw_number, '')) = UPPER(?)
            ORDER BY imported_at DESC, source_created_at DESC, id DESC
            LIMIT 1
        `).get(normalizedProductIndex, normalizedKkwNumber);

        if (matchedByKkw?.id) {
            return Number(matchedByKkw.id);
        }
    }

    if (normalizedProductIndex && normalizedTermDate) {
        const matchedByTerm = db.prepare(`
            SELECT id
            FROM zakupy_headers
            WHERE source_system = 'access'
              AND product_index = ?
              AND substr(COALESCE(term_date, ''), 1, 10) = ?
            ORDER BY imported_at DESC, source_created_at DESC, id DESC
            LIMIT 1
        `).get(normalizedProductIndex, normalizedTermDate);

        if (matchedByTerm?.id) {
            return Number(matchedByTerm.id);
        }
    }

    if (normalizedProductIndex) {
        const matchedByProduct = db.prepare(`
            SELECT id
            FROM zakupy_headers
            WHERE source_system = 'access'
              AND product_index = ?
            ORDER BY imported_at DESC, source_created_at DESC, id DESC
            LIMIT 1
        `).get(normalizedProductIndex);

        if (matchedByProduct?.id) {
            return Number(matchedByProduct.id);
        }
    }

    return null;
}

function getAccessBomNotesForLiveHeader(dbPath, { planPositionId, productIndex, kkwNumber, termDate } = {}) {
    const db = getDatabase(dbPath);
    const headerId = findAccessHeaderIdForLiveHeader(db, {
        planPositionId,
        productIndex,
        kkwNumber,
        termDate,
    });

    if (!Number.isInteger(headerId) || headerId <= 0) {
        return new Map();
    }

    const rows = db.prepare(`
        SELECT
            component_code AS componentCode,
            note_1 AS note1,
            note_2 AS note2,
            note_3 AS note3,
            add_text_1 AS addText1,
            add_text_2 AS addText2
        FROM zakupy_bom_items
        WHERE header_id = ?
        ORDER BY id ASC
    `).all(headerId);

    return mergeAccessBomNoteMap(rows);
}

function buildOperationalSummary(headers, storage) {
    const summary = {
        totalHeaders: headers.length,
        openHeaders: 0,
        closedHeaders: 0,
        pendingSmdHeaders: 0,
        pendingThtHeaders: 0,
        packetHeaders: 0,
        totalBomItems: 0,
        openBomItems: 0,
        shortageBomItems: 0,
        shortageQty: 0,
        activeClients: 0,
        lastImportAt: storage?.meta?.last_access_import_at?.value || null,
    };

    const clients = new Set();
    for (const header of headers) {
        if (header.isClosed) {
            summary.closedHeaders += 1;
        } else {
            summary.openHeaders += 1;
        }

        if (!header.smdDone) {
            summary.pendingSmdHeaders += 1;
        }

        if (!header.thtDone) {
            summary.pendingThtHeaders += 1;
        }

        if (header.packetFlag) {
            summary.packetHeaders += 1;
        }

        if (header.clientName) {
            clients.add(header.clientName);
        }

        summary.totalBomItems += header.bomCount;
        summary.openBomItems += header.openBomCount;
        summary.shortageBomItems += header.shortageBomCount;
        summary.shortageQty += header.shortageQty;
    }

    summary.activeClients = clients.size;
    return summary;
}

function importAccessSnapshot({ dbPath, snapshot }) {
    const db = getDatabase(dbPath);
    const importedAt = new Date().toISOString();
    const headers = Array.isArray(snapshot?.headers) ? snapshot.headers : [];
    const bomItems = Array.isArray(snapshot?.bomItems) ? snapshot.bomItems : [];

    const deleteBomStatement = db.prepare("DELETE FROM zakupy_bom_items WHERE source_system = ?");
    const deleteHeaderStatement = db.prepare("DELETE FROM zakupy_headers WHERE source_system = ?");

    const insertHeaderStatement = db.prepare(`
        INSERT INTO zakupy_headers (
            source_system,
            source_access_id,
            source_plan_position_id,
            kkw_number,
            product_index,
            product_name,
            client_name,
            order_qty,
            term_date,
            smd_done,
            tht_done,
            is_closed,
            packet_flag,
            zak_status,
            notes,
            created_by,
            source_created_at,
            smd_done_at,
            tht_done_at,
            imported_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertBomStatement = db.prepare(`
        INSERT INTO zakupy_bom_items (
            source_system,
            header_id,
            source_header_access_id,
            source_material_id,
            parent_reference,
            parent_product_name,
            component_code,
            component_name,
            component_qty,
            required_qty,
            wms_stock,
            wms_ordered,
            vendo_stock,
            vendo_ordered,
            to_order,
            type_name,
            smd_done,
            tht_done,
            wms_label,
            vendo_label,
            note_1,
            note_2,
            note_3,
            add_1,
            add_2,
            add_text_1,
            add_text_2,
            add_int,
            imported_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const headerIdBySourceId = new Map();
    let importedHeaderCount = 0;
    let importedBomCount = 0;
    let skippedBomCount = 0;

    db.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
        deleteBomStatement.run("access");
        deleteHeaderStatement.run("access");

        for (const header of headers) {
            const sourceAccessId = toNullableNumber(header?.sourceAccessId);
            const result = insertHeaderStatement.run(
                "access",
                sourceAccessId,
                toNullableNumber(header?.sourcePlanPositionId),
                toNullableText(header?.kkwNumber),
                String(header?.productIndex || "").trim(),
                String(header?.productName || "").trim(),
                toNullableText(header?.clientName),
                toNumber(header?.orderQty),
                toIsoText(header?.termDate),
                toSqliteBoolean(Boolean(header?.smdDone)),
                toSqliteBoolean(Boolean(header?.thtDone)),
                toSqliteBoolean(Boolean(header?.smdDone) && Boolean(header?.thtDone)),
                toSqliteBoolean(Boolean(header?.packetFlag)),
                toNullableNumber(header?.zakStatus),
                toNullableText(header?.notes),
                toNullableText(header?.createdBy),
                toIsoText(header?.createdAt),
                toIsoText(header?.smdDoneAt),
                toIsoText(header?.thtDoneAt),
                importedAt
            );

            if (sourceAccessId !== null) {
                headerIdBySourceId.set(sourceAccessId, Number(result.lastInsertRowid));
            }
            importedHeaderCount += 1;
        }

        for (const item of bomItems) {
            const sourceHeaderAccessId = toNullableNumber(item?.sourceHeaderAccessId);
            const headerId = sourceHeaderAccessId === null ? null : headerIdBySourceId.get(sourceHeaderAccessId);
            if (!headerId) {
                skippedBomCount += 1;
                continue;
            }

            insertBomStatement.run(
                "access",
                headerId,
                sourceHeaderAccessId,
                toNullableNumber(item?.sourceMaterialId),
                toNullableText(item?.parentReference),
                toNullableText(item?.parentProductName),
                String(item?.componentCode || "").trim(),
                String(item?.componentName || "").trim(),
                toNumber(item?.componentQty),
                toNumber(item?.requiredQty),
                toNumber(item?.wmsStock),
                toNumber(item?.wmsOrdered),
                toNumber(item?.vendoStock),
                toNumber(item?.vendoOrdered),
                toNumber(item?.toOrder),
                toNullableText(item?.typeName),
                toSqliteBoolean(Boolean(item?.smdDone)),
                toSqliteBoolean(Boolean(item?.thtDone)),
                toNullableText(item?.wmsLabel),
                toNullableText(item?.vendoLabel),
                toNullableText(item?.note1),
                toNullableText(item?.note2),
                toNullableText(item?.note3),
                toNullableNumber(item?.add1),
                toNullableNumber(item?.add2),
                toNullableText(item?.addText1),
                toNullableText(item?.addText2),
                toNullableNumber(item?.addInt),
                importedAt
            );

            importedBomCount += 1;
        }

        setMetaValue(db, "last_access_import_at", importedAt);
        setMetaValue(db, "last_access_source_path", snapshot?.accessPath || "");
        setMetaValue(db, "last_access_header_count", importedHeaderCount);
        setMetaValue(db, "last_access_bom_count", importedBomCount);
        setMetaValue(db, "last_access_skipped_bom_count", skippedBomCount);

        db.exec("COMMIT");
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }

    return {
        importedAt,
        headerCount: importedHeaderCount,
        bomCount: importedBomCount,
        skippedBomCount,
        sourceAccessPath: snapshot?.accessPath || null,
    };
}

function getStorageMeta(dbPath) {
    const db = getDatabase(dbPath);

    const metaRows = db.prepare("SELECT key, value, updated_at FROM app_meta ORDER BY key").all();
    const meta = metaRows.reduce((result, row) => {
        result[row.key] = {
            value: row.value,
            updatedAt: row.updated_at,
        };
        return result;
    }, {});

    const counts = {
        headers: db.prepare("SELECT COUNT(*) AS count FROM zakupy_headers").get().count,
        accessHeaders: db.prepare("SELECT COUNT(*) AS count FROM zakupy_headers WHERE source_system = 'access'").get().count,
        bomItems: db.prepare("SELECT COUNT(*) AS count FROM zakupy_bom_items").get().count,
        accessBomItems: db.prepare("SELECT COUNT(*) AS count FROM zakupy_bom_items WHERE source_system = 'access'").get().count,
        auditRows: db.prepare("SELECT COUNT(*) AS count FROM zakupy_audit").get().count,
    };

    const recentHeaders = db.prepare(`
        SELECT
            id,
            source_access_id AS sourceAccessId,
            source_plan_position_id AS sourcePlanPositionId,
            kkw_number AS kkwNumber,
            product_index AS productIndex,
            product_name AS productName,
            client_name AS clientName,
            order_qty AS orderQty,
            term_date AS termDate,
            imported_at AS importedAt
        FROM zakupy_headers
        ORDER BY id DESC
        LIMIT 5
    `).all();

    return {
        dbPath: normalizeDbPath(dbPath),
        counts,
        meta,
        recentHeaders,
    };
}

function getOperationalOverview(dbPath) {
    const db = getDatabase(dbPath);
    const storage = getStorageMeta(dbPath);
    const openBomCaseSql = `
        CASE
            WHEN UPPER(COALESCE(b.type_name, '')) = 'THT' THEN CASE WHEN COALESCE(b.tht_done, 0) = 0 THEN 1 ELSE 0 END
            WHEN UPPER(COALESCE(b.type_name, '')) IN ('SMD', 'PCB')
                OR UPPER(COALESCE(b.type_name, '')) LIKE 'P%FABRYKAT'
                THEN CASE WHEN COALESCE(b.smd_done, 0) = 0 THEN 1 ELSE 0 END
            ELSE CASE WHEN COALESCE(b.smd_done, 0) = 0 OR COALESCE(b.tht_done, 0) = 0 THEN 1 ELSE 0 END
        END
    `;
    const shortageCountSql = "CASE WHEN COALESCE(b.to_order, 0) > 0 THEN 1 ELSE 0 END";
    const shortageQtySql = "CASE WHEN COALESCE(b.to_order, 0) > 0 THEN COALESCE(b.to_order, 0) ELSE 0 END";

    const rows = db.prepare(`
        SELECT
            h.id AS id,
            h.source_access_id AS sourceAccessId,
            h.source_plan_position_id AS sourcePlanPositionId,
            h.source_plan_order_id AS sourcePlanOrderId,
            h.source_order_id AS sourceOrderId,
            h.source_kkw_id AS sourceKkwId,
            h.kkw_number AS kkwNumber,
            h.zlp_number AS zlpNumber,
            h.nr_obcy AS nrObcy,
            h.product_index AS productIndex,
            h.product_name AS productName,
            h.client_name AS clientName,
            h.order_qty AS orderQty,
            h.term_date AS termDate,
            h.smd_done AS smdDone,
            h.tht_done AS thtDone,
            h.is_closed AS isClosed,
            h.packet_flag AS packetFlag,
            h.zak_status AS zakStatus,
            h.notes AS notes,
            h.created_by AS createdBy,
            h.source_created_at AS sourceCreatedAt,
            h.imported_at AS importedAt,
            COUNT(b.id) AS bomCount,
            COALESCE(SUM(${openBomCaseSql}), 0) AS openBomCount,
            COALESCE(SUM(${shortageCountSql}), 0) AS shortageBomCount,
            COALESCE(SUM(${shortageQtySql}), 0) AS shortageQty
        FROM zakupy_headers AS h
        LEFT JOIN zakupy_bom_items AS b ON b.header_id = h.id
        GROUP BY h.id
        ORDER BY
            CASE WHEN h.term_date IS NULL THEN 1 ELSE 0 END,
            h.term_date ASC,
            h.client_name COLLATE NOCASE ASC,
            h.product_index COLLATE NOCASE ASC,
            h.id ASC
    `).all();

    const headers = rows.map((row) => {
        const mapped = mapHeaderRow(row);
        const stage = determineHeaderStage(mapped);
        return {
            ...mapped,
            stageKey: stage.key,
            stageLabel: stage.label,
        };
    });

    return {
        storage,
        summary: buildOperationalSummary(headers, storage),
        headers,
    };
}

function getHeaderDetails(dbPath, headerId) {
    const db = getDatabase(dbPath);
    const headerRow = db.prepare(`
        SELECT
            id AS id,
            source_access_id AS sourceAccessId,
            source_plan_position_id AS sourcePlanPositionId,
            source_plan_order_id AS sourcePlanOrderId,
            source_order_id AS sourceOrderId,
            source_kkw_id AS sourceKkwId,
            kkw_number AS kkwNumber,
            zlp_number AS zlpNumber,
            nr_obcy AS nrObcy,
            product_index AS productIndex,
            product_name AS productName,
            client_name AS clientName,
            order_qty AS orderQty,
            term_date AS termDate,
            smd_done AS smdDone,
            tht_done AS thtDone,
            is_closed AS isClosed,
            packet_flag AS packetFlag,
            zak_status AS zakStatus,
            notes AS notes,
            created_by AS createdBy,
            source_created_at AS sourceCreatedAt,
            imported_at AS importedAt
        FROM zakupy_headers
        WHERE id = ?
    `).get(Number(headerId));

    if (!headerRow) {
        return null;
    }

    const header = mapHeaderRow(headerRow);
    const stage = determineHeaderStage(header);
    const bomRows = db.prepare(`
        SELECT
            id AS id,
            header_id AS headerId,
            source_header_access_id AS sourceHeaderAccessId,
            source_material_id AS sourceMaterialId,
            parent_reference AS parentReference,
            parent_product_name AS parentProductName,
            component_code AS componentCode,
            component_name AS componentName,
            component_qty AS componentQty,
            required_qty AS requiredQty,
            wms_stock AS wmsStock,
            wms_ordered AS wmsOrdered,
            vendo_stock AS vendoStock,
            vendo_ordered AS vendoOrdered,
            to_order AS toOrder,
            type_name AS typeName,
            smd_done AS smdDone,
            tht_done AS thtDone,
            wms_label AS wmsLabel,
            vendo_label AS vendoLabel,
            note_1 AS note1,
            note_2 AS note2,
            note_3 AS note3,
            add_1 AS add1,
            add_2 AS add2,
            add_text_1 AS addText1,
            add_text_2 AS addText2,
            add_int AS addInt,
            imported_at AS importedAt
        FROM zakupy_bom_items
        WHERE header_id = ?
        ORDER BY component_code COLLATE NOCASE ASC, component_name COLLATE NOCASE ASC, id ASC
    `).all(Number(headerId));

    const bomItems = bomRows.map((row) => {
        const mapped = mapBomRow(row);
        return {
            ...mapped,
            isOpen: determineBomOpen(mapped),
        };
    });

    const summary = bomItems.reduce((result, item) => {
        result.totalBomItems += 1;
        result.requiredQty += item.requiredQty;
        if (item.isOpen) {
            result.openBomItems += 1;
        }
        if (item.toOrder > 0) {
            result.shortageBomItems += 1;
            result.shortageQty += item.toOrder;
        }
        if (String(item.typeName || "").trim().toUpperCase() === "PCB") {
            result.pcbItems += 1;
        }
        if (String(item.typeName || "").trim().toUpperCase() === "SMD") {
            result.smdItems += 1;
        }
        if (String(item.typeName || "").trim().toUpperCase() === "THT") {
            result.thtItems += 1;
        }
        return result;
    }, {
        totalBomItems: 0,
        openBomItems: 0,
        shortageBomItems: 0,
        shortageQty: 0,
        requiredQty: 0,
        pcbItems: 0,
        smdItems: 0,
        thtItems: 0,
    });

    return {
        header: {
            ...header,
            stageKey: stage.key,
            stageLabel: stage.label,
        },
        summary,
        bomItems,
    };
}

function buildBomNoteKey(sourceType, sourceMaterialId) {
    return `${String(sourceType || "").trim()}::${Number(sourceMaterialId) || 0}`;
}

function getBomNotesForPlanPosition(dbPath, planPositionId) {
    const db = getDatabase(dbPath);
    const rows = db.prepare(`
        SELECT
            id,
            plan_position_id AS planPositionId,
            source_type AS sourceType,
            source_material_id AS sourceMaterialId,
            component_code AS componentCode,
            note,
            changed_by AS changedBy,
            updated_at AS updatedAt
        FROM zapotrzebowanie_bom_notes
        WHERE plan_position_id = ?
    `).all(Number(planPositionId));

    return new Map(rows.map((row) => [
        buildBomNoteKey(row.sourceType, row.sourceMaterialId),
        {
            id: Number(row.id),
            planPositionId: Number(row.planPositionId),
            sourceType: row.sourceType || "",
            sourceMaterialId: Number(row.sourceMaterialId),
            componentCode: row.componentCode || null,
            note: row.note || "",
            changedBy: row.changedBy || null,
            updatedAt: row.updatedAt || null,
        },
    ]));
}

function upsertBomNote({ dbPath, planPositionId, sourceType, sourceMaterialId, componentCode, note, changedBy }) {
    const db = getDatabase(dbPath);
    const normalizedPlanPositionId = Number(planPositionId);
    const normalizedSourceType = String(sourceType || "").trim();
    const normalizedSourceMaterialId = Number(sourceMaterialId);
    const normalizedNote = String(note ?? "").trim();
    const updatedAt = new Date().toISOString();

    if (!Number.isInteger(normalizedPlanPositionId) || normalizedPlanPositionId <= 0) {
        throw new Error("Brakuje poprawnego planPositionId dla uwagi.");
    }
    if (!normalizedSourceType) {
        throw new Error("Brakuje sourceType dla uwagi.");
    }
    if (!Number.isInteger(normalizedSourceMaterialId) || normalizedSourceMaterialId <= 0) {
        throw new Error("Brakuje poprawnego sourceMaterialId dla uwagi.");
    }

    const previous = db.prepare(`
        SELECT id, note
        FROM zapotrzebowanie_bom_notes
        WHERE plan_position_id = ? AND source_type = ? AND source_material_id = ?
    `).get(normalizedPlanPositionId, normalizedSourceType, normalizedSourceMaterialId);

    db.prepare(`
        INSERT INTO zapotrzebowanie_bom_notes (
            plan_position_id,
            source_type,
            source_material_id,
            component_code,
            note,
            changed_by,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(plan_position_id, source_type, source_material_id) DO UPDATE SET
            component_code = excluded.component_code,
            note = excluded.note,
            changed_by = excluded.changed_by,
            updated_at = excluded.updated_at
    `).run(
        normalizedPlanPositionId,
        normalizedSourceType,
        normalizedSourceMaterialId,
        toNullableText(componentCode),
        normalizedNote,
        toNullableText(changedBy),
        updatedAt
    );

    const current = db.prepare(`
        SELECT
            id,
            plan_position_id AS planPositionId,
            source_type AS sourceType,
            source_material_id AS sourceMaterialId,
            component_code AS componentCode,
            note,
            changed_by AS changedBy,
            updated_at AS updatedAt
        FROM zapotrzebowanie_bom_notes
        WHERE plan_position_id = ? AND source_type = ? AND source_material_id = ?
    `).get(normalizedPlanPositionId, normalizedSourceType, normalizedSourceMaterialId);

    db.prepare(`
        INSERT INTO zakupy_audit (
            entity_type,
            entity_id,
            field_name,
            old_value,
            new_value,
            changed_by,
            changed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        "vendo_bom_note",
        Number(current?.id || previous?.id || 0),
        "note",
        previous?.note || "",
        normalizedNote,
        toNullableText(changedBy),
        updatedAt
    );

    return {
        id: Number(current.id),
        planPositionId: Number(current.planPositionId),
        sourceType: current.sourceType || "",
        sourceMaterialId: Number(current.sourceMaterialId),
        componentCode: current.componentCode || null,
        note: current.note || "",
        changedBy: current.changedBy || null,
        updatedAt: current.updatedAt || null,
    };
}

module.exports = {
    getAccessBomNotesForLiveHeader,
    buildBomNoteKey,
    getBomNotesForPlanPosition,
    getDatabase,
    getHeaderDetails,
    getOperationalOverview,
    getStorageMeta,
    importAccessSnapshot,
    upsertBomNote,
};
