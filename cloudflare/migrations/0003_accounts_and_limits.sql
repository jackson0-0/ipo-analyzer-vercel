CREATE TABLE IF NOT EXISTS app_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_tokens (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS user_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES app_users(id), expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry ON user_sessions(expires_at);
CREATE TABLE IF NOT EXISTS user_watchlist (user_id TEXT NOT NULL REFERENCES app_users(id), item_key TEXT NOT NULL, item TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,item_key));
CREATE TABLE IF NOT EXISTS app_limits (key TEXT PRIMARY KEY, used INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ai_daily_usage (day TEXT PRIMARY KEY, reserved_micros INTEGER NOT NULL, actual_micros INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL);
