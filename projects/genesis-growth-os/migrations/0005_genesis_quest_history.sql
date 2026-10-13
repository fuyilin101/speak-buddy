-- D1 历史结构增量；通过 Wrangler 迁移账本执行一次，禁止手工重复重放 ALTER。
ALTER TABLE genesis_quests ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE genesis_quests ADD COLUMN dimension TEXT CHECK(dimension IN ('body','learning','creation','life'));
ALTER TABLE genesis_quest_runs ADD COLUMN completed_at TEXT;
-- 不重写任何既有 snapshot_json，不推测历史完成时间。
UPDATE genesis_quests SET dimension = CASE type WHEN 'training' THEN 'body' WHEN 'study' THEN 'learning' WHEN 'project' THEN 'creation' WHEN 'life' THEN 'life' END WHERE dimension IS NULL;
CREATE INDEX IF NOT EXISTS idx_genesis_quest_runs_history ON genesis_quest_runs(quest_id,date DESC);
