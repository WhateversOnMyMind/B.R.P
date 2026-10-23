PRAGMA foreign_keys = ON;
CREATE TABLE pairs (id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0));
CREATE TABLE devices (
 id TEXT PRIMARY KEY, pair_id TEXT NOT NULL REFERENCES pairs(id), arm TEXT NOT NULL CHECK(arm IN ('L','R')),
 boot_id TEXT, sequence INTEGER NOT NULL DEFAULT 0, last_seen_ms INTEGER, status_json TEXT NOT NULL DEFAULT '{}', exchange_id TEXT,
 UNIQUE(pair_id,arm)
);
CREATE TABLE credentials (
 token_hash TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('operator','device')), pair_id TEXT NOT NULL REFERENCES pairs(id),
 device_id TEXT REFERENCES devices(id), label TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
 CHECK((role='device' AND device_id IS NOT NULL) OR (role='operator' AND device_id IS NULL))
);
CREATE TABLE device_boots (device_id TEXT NOT NULL REFERENCES devices(id), boot_id TEXT NOT NULL, PRIMARY KEY(device_id,boot_id));
CREATE TABLE commands (
 id TEXT PRIMARY KEY, pair_id TEXT NOT NULL REFERENCES pairs(id), revision INTEGER NOT NULL, action TEXT NOT NULL,
 target TEXT NOT NULL CHECK(target IN ('pair','L','R')), value_json TEXT, capture_id TEXT,
 left_boot TEXT, right_boot TEXT, created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','applied','failed','expired','unknown')),
 UNIQUE(pair_id,revision)
);
CREATE UNIQUE INDEX one_pending_per_pair ON commands(pair_id) WHERE state='pending';
CREATE INDEX command_history ON commands(pair_id,created_ms DESC);
CREATE TABLE command_results (
 command_id TEXT NOT NULL REFERENCES commands(id), arm TEXT NOT NULL CHECK(arm IN ('L','R')),
 result TEXT NOT NULL CHECK(result IN ('applied','failed')), message TEXT NOT NULL DEFAULT '', received_ms INTEGER NOT NULL,
 PRIMARY KEY(command_id,arm)
);
CREATE TABLE captures (
 device_id TEXT NOT NULL REFERENCES devices(id), capture_id TEXT NOT NULL REFERENCES commands(id), pair_id TEXT NOT NULL REFERENCES pairs(id),
 bytes INTEGER NOT NULL CHECK(bytes BETWEEN 0 AND 2000160), sha256 TEXT NOT NULL, object_key TEXT NOT NULL,
 created_ms INTEGER NOT NULL, PRIMARY KEY(device_id,capture_id)
);
CREATE INDEX capture_history ON captures(pair_id,created_ms DESC);
