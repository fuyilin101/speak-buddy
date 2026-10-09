CREATE TABLE IF NOT EXISTS learning_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  original_text TEXT NOT NULL,
  suggested_text TEXT NOT NULL,
  learning_type TEXT NOT NULL CHECK (learning_type IN ('grammar','expression')),
  focus_point TEXT NOT NULL DEFAULT '',
  explanation_zh TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'review' CHECK (status IN ('review','mastered')),
  review_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  next_review_at TEXT,
  UNIQUE(user_id, learning_type, original_text, suggested_text)
);
CREATE INDEX IF NOT EXISTS learning_records_by_user ON learning_records(user_id, status, updated_at DESC);
