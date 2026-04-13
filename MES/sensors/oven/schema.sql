CREATE TABLE IF NOT EXISTS oven_pulses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    batch_id INTEGER,
    sensor_id TEXT NOT NULL DEFAULT 'out',
    ts TEXT NOT NULL,
    payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_oven_pulses_device_ts
    ON oven_pulses (device_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_oven_pulses_batch
    ON oven_pulses (batch_id);

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
    ON mes_batches (device_id, status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_mes_batches_kkw
    ON mes_batches (kkw_number);
