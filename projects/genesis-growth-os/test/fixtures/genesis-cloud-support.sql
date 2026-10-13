-- 本地 D1 验证夹具；Phase C 将其固化为正式增量迁移。
CREATE TABLE IF NOT EXISTS genesis_project_aliases (
 alias_id TEXT PRIMARY KEY REFERENCES genesis_projects(id),
 canonical_id TEXT NOT NULL REFERENCES genesis_projects(id),
 source_type TEXT NOT NULL DEFAULT 'manual_merge', visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility='private'),
 created_at TEXT NOT NULL, CHECK(alias_id<>canonical_id)
);
CREATE TABLE IF NOT EXISTS genesis_edit_history (
 id TEXT PRIMARY KEY, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
 before_json TEXT NOT NULL, source_type TEXT NOT NULL DEFAULT 'manual_edit',
 visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility='private'), created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_genesis_edit_history_resource ON genesis_edit_history(resource_type,resource_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_genesis_project_aliases_canonical ON genesis_project_aliases(canonical_id);
CREATE TABLE IF NOT EXISTS genesis_cloud_write_state (
 id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0)
);
INSERT OR IGNORE INTO genesis_cloud_write_state(id,revision) VALUES(1,0);
