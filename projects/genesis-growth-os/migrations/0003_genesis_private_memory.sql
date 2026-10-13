-- Genesis AI phase 2: private profile, goals and decisions.
-- Existing records receive metadata defaults; no rows are deleted or replaced.

ALTER TABLE genesis_projects ADD COLUMN source_type TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE genesis_projects ADD COLUMN confidence TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE genesis_projects ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';

ALTER TABLE genesis_growth_records ADD COLUMN source_type TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE genesis_growth_records ADD COLUMN confidence TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE genesis_growth_records ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
ALTER TABLE genesis_growth_records ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

ALTER TABLE genesis_assets ADD COLUMN source_type TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE genesis_assets ADD COLUMN confidence TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE genesis_assets ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';

UPDATE genesis_growth_records
SET updated_at = COALESCE(NULLIF(updated_at, ''), created_at)
WHERE updated_at IS NULL OR updated_at = '';

CREATE TABLE IF NOT EXISTS genesis_profile_items (
  id TEXT PRIMARY KEY,
  profile_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'user_provided',
  source_ref TEXT,
  confidence TEXT NOT NULL DEFAULT 'user_stated',
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS genesis_goals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  horizon TEXT NOT NULL DEFAULT 'long_term',
  status TEXT NOT NULL DEFAULT 'active',
  priority INTEGER NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL DEFAULT 'user_provided',
  source_ref TEXT,
  confidence TEXT NOT NULL DEFAULT 'user_stated',
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS genesis_decisions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  decision TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'user_provided',
  source_ref TEXT,
  confidence TEXT NOT NULL DEFAULT 'user_stated',
  visibility TEXT NOT NULL DEFAULT 'private',
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_genesis_profile_source_ref
  ON genesis_profile_items(source_ref) WHERE source_ref IS NOT NULL AND source_ref <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_genesis_goals_source_ref
  ON genesis_goals(source_ref) WHERE source_ref IS NOT NULL AND source_ref <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_genesis_decisions_source_ref
  ON genesis_decisions(source_ref) WHERE source_ref IS NOT NULL AND source_ref <> '';
CREATE INDEX IF NOT EXISTS idx_genesis_profile_visibility
  ON genesis_profile_items(visibility, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_genesis_goals_status
  ON genesis_goals(status, priority DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_genesis_decisions_updated
  ON genesis_decisions(updated_at DESC);
