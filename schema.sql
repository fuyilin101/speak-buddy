CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, nickname TEXT NOT NULL, age_group TEXT NOT NULL, english_level TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS companions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, character TEXT NOT NULL, custom_name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, companion_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, correction_json TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mistakes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, original TEXT NOT NULL, corrected TEXT NOT NULL, error_type TEXT NOT NULL, explanation_zh TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1, mastery TEXT NOT NULL DEFAULT 'weak', last_seen TEXT NOT NULL);
