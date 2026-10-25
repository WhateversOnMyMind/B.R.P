CREATE TABLE measurements (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 pair_id TEXT NOT NULL REFERENCES pairs(id),
 device_id TEXT NOT NULL REFERENCES devices(id),
 arm TEXT NOT NULL CHECK(arm IN ('L','R')),
 boot_id TEXT NOT NULL,
 window_sequence INTEGER NOT NULL CHECK(window_sequence > 0),
 received_ms INTEGER NOT NULL,
 swing_count INTEGER NOT NULL CHECK(swing_count >= 0),
 distance_cm REAL NOT NULL CHECK(distance_cm >= 0),
 alerted INTEGER CHECK(alerted IN (0,1)),
 window_start_ms INTEGER NOT NULL,
 window_end_ms INTEGER NOT NULL,
 window_late_ms INTEGER,
 window_missed_deadlines INTEGER,
 UNIQUE(device_id,boot_id,window_sequence)
);
CREATE INDEX measurements_pair_history ON measurements(pair_id,id DESC);
CREATE INDEX measurements_pair_time ON measurements(pair_id,received_ms);
