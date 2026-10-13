-- D1 Quest Builder 的增量结构迁移；不导入本地使命或旧存档。
CREATE TABLE IF NOT EXISTS genesis_quests (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL,
 time TEXT, duration INTEGER, repeat TEXT NOT NULL,
 scheduled_date TEXT, weekdays_json TEXT NOT NULL DEFAULT '[]', starts_on TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active', sort_order INTEGER NOT NULL DEFAULT 0,
 goal_id TEXT, project_id TEXT, legacy_source_id TEXT UNIQUE,
 revision INTEGER NOT NULL DEFAULT 1,
 source_type TEXT NOT NULL DEFAULT 'manual_quest', confidence TEXT NOT NULL DEFAULT 'user_stated',
 visibility TEXT NOT NULL DEFAULT 'private', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(type IN ('study','training','project','life')),
 CHECK(repeat IN ('once','daily','weekly')),
 CHECK(status IN ('active','paused','deleted')),
 CHECK(duration IS NULL OR (duration >= 1 AND duration <= 600))
);
CREATE TABLE IF NOT EXISTS genesis_quest_runs (
 quest_id TEXT NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL,
 snapshot_json TEXT NOT NULL, source_type TEXT NOT NULL DEFAULT 'manual_action',
 confidence TEXT NOT NULL DEFAULT 'user_stated', visibility TEXT NOT NULL DEFAULT 'private',
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(quest_id,date), FOREIGN KEY(quest_id) REFERENCES genesis_quests(id),
 CHECK(status IN ('not_started','in_progress','completed'))
);
CREATE INDEX IF NOT EXISTS idx_genesis_quests_status_order ON genesis_quests(status,sort_order);
CREATE INDEX IF NOT EXISTS idx_genesis_quest_runs_date ON genesis_quest_runs(date);
