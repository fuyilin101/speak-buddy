-- Genesis AI phase 1: projects and reusable growth records.
-- This migration is intentionally separate from The Forge's local SQLite schema.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS genesis_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  domain TEXT NOT NULL DEFAULT 'growth',
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  target_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS genesis_growth_records (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  record_type TEXT NOT NULL DEFAULT 'reflection',
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  metric_value REAL,
  metric_unit TEXT,
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES genesis_projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_genesis_projects_status
  ON genesis_projects(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_genesis_growth_records_project
  ON genesis_growth_records(project_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_genesis_growth_records_recorded_at
  ON genesis_growth_records(recorded_at DESC, created_at DESC);
