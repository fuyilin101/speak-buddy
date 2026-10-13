-- Genesis AI phase 2: agent evidence, reusable assets and idempotent ingestion.
-- This migration only adds columns/tables. Existing phase 1 rows remain valid.

ALTER TABLE genesis_projects ADD COLUMN source_ref TEXT;
ALTER TABLE genesis_projects ADD COLUMN repo_path TEXT;
ALTER TABLE genesis_projects ADD COLUMN git_commit TEXT;
ALTER TABLE genesis_projects ADD COLUMN evidence_json TEXT;
ALTER TABLE genesis_projects ADD COLUMN next_steps_json TEXT;

ALTER TABLE genesis_growth_records ADD COLUMN source_ref TEXT;
ALTER TABLE genesis_growth_records ADD COLUMN evidence_json TEXT;
ALTER TABLE genesis_growth_records ADD COLUMN details_json TEXT;

CREATE TABLE IF NOT EXISTS genesis_assets (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  title TEXT NOT NULL,
  asset_type TEXT NOT NULL DEFAULT 'playbook',
  content TEXT NOT NULL DEFAULT '',
  tags_json TEXT,
  evidence_json TEXT,
  source_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES genesis_projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS genesis_ingest_keys (
  idempotency_key TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_genesis_projects_source_ref
  ON genesis_projects(source_ref) WHERE source_ref IS NOT NULL AND source_ref <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_genesis_growth_source_ref
  ON genesis_growth_records(source_ref) WHERE source_ref IS NOT NULL AND source_ref <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_genesis_assets_source_ref
  ON genesis_assets(source_ref) WHERE source_ref IS NOT NULL AND source_ref <> '';
CREATE INDEX IF NOT EXISTS idx_genesis_assets_project
  ON genesis_assets(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_genesis_ingest_created
  ON genesis_ingest_keys(created_at DESC);
