-- V2.2 server-controlled review scheduling. Existing learning_records are preserved.
ALTER TABLE learning_records ADD COLUMN correct_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE learning_records ADD COLUMN correct_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE learning_records ADD COLUMN incorrect_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE learning_records ADD COLUMN last_review_at TEXT;
ALTER TABLE learning_records ADD COLUMN last_correct_day TEXT;
CREATE TABLE IF NOT EXISTS review_preferences (user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, last_invited_day TEXT, snoozed_day TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS review_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, record_id TEXT NOT NULL, day TEXT NOT NULL, question_number INTEGER NOT NULL DEFAULT 1, question TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('invited','active','completed','skipped','cancelled')) DEFAULT 'invited', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id,day,question_number), FOREIGN KEY(record_id) REFERENCES learning_records(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS review_sessions_user_status ON review_sessions(user_id,status,updated_at DESC);
CREATE TABLE IF NOT EXISTS review_attempts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT NOT NULL, request_id TEXT NOT NULL, answer TEXT NOT NULL, verdict TEXT CHECK(verdict IN ('correct','incorrect','uncertain')), feedback TEXT, state TEXT NOT NULL CHECK(state IN ('processing','done','failed')) DEFAULT 'processing', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id,request_id), FOREIGN KEY(session_id) REFERENCES review_sessions(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS review_attempts_session ON review_attempts(session_id,created_at);
