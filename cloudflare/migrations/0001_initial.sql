CREATE TABLE IF NOT EXISTS ipo_analysis (id INTEGER PRIMARY KEY, company_name TEXT, ticker TEXT, score INTEGER, summary TEXT, red_flag TEXT, about TEXT);
CREATE TABLE IF NOT EXISTS sec_analysis (cache_key TEXT PRIMARY KEY, response TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS calendar_snapshots (month TEXT PRIMARY KEY, response TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS issuer_identities (name_key TEXT PRIMARY KEY, cik TEXT NOT NULL, sec_name TEXT NOT NULL, verified_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reported_facts (accession TEXT PRIMARY KEY, cik TEXT NOT NULL, response TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS worker_cache (key TEXT PRIMARY KEY, response TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS request_slots (name TEXT PRIMARY KEY, next_at INTEGER NOT NULL);
INSERT OR IGNORE INTO request_slots VALUES ('sec',0);
