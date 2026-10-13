-- D1 成长路线；只创建结构，不生成技能、等级或个人记忆。
CREATE TABLE IF NOT EXISTS genesis_skills (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
 description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 2000),
 category TEXT NOT NULL DEFAULT '' CHECK(length(category) <= 60),
 parent_id TEXT REFERENCES genesis_skills(id),
 status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started','learning','practicing','mastered')),
 revision INTEGER NOT NULL DEFAULT 1,
 source_type TEXT NOT NULL DEFAULT 'manual_skill',
 visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility='private'),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK(parent_id IS NULL OR parent_id <> id)
);
CREATE TABLE IF NOT EXISTS genesis_skill_links (
 id TEXT PRIMARY KEY,
 skill_id TEXT NOT NULL REFERENCES genesis_skills(id),
 target_type TEXT NOT NULL CHECK(target_type IN ('goal','quest','project','asset')),
 target_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(skill_id,target_type,target_id)
);
CREATE INDEX IF NOT EXISTS idx_genesis_skills_parent ON genesis_skills(parent_id,created_at,id);
CREATE INDEX IF NOT EXISTS idx_genesis_skill_links_target ON genesis_skill_links(target_type,target_id);
