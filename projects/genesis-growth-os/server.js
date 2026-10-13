const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const webpush = require('web-push');
const { sendReminders } = require('./send-reminders');
const { buildDashboardSummary, buildActionSummary } = require('./dashboard-summary');
const genesisEditor = require('./genesis-editor.cjs');

// Load a local .env file if present (zero-dependency). Real environment
// variables always win; this just makes a bare-metal `npm start` pick up the
// password written by install.sh. Docker passes env directly, so .env is absent
// there and this is a no-op.
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
} catch (e) { /* ignore malformed .env */ }

const ENV_APP_PASSWORD = process.env.APP_PASSWORD || '';
const APP_PASSWORD = ENV_APP_PASSWORD || 'changeme';
const UNSAFE_PASSWORDS = new Set([
  '',
  'admin',
  'changeme',
  'change-me',
  'change-this-password',
  'password',
  'please-change-me',
  'replace-me',
  'replace-me-with-a-long-password',
  'the-forge',
]);
const isUnsafePassword = (value) => UNSAFE_PASSWORDS.has(String(value || '').trim().toLowerCase());
const PASSWORD_HASH_KEY = 'password_hash_v1';
const PASSWORD_MIN_LENGTH = 10;
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
const hasSafeEnvPassword = () => Boolean(ENV_APP_PASSWORD) && !isUnsafePassword(ENV_APP_PASSWORD);

const app = express();
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');
if (TRUST_PROXY) app.set('trust proxy', 1);
const port = process.env.PORT || 3007;
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'database.sqlite');

// Ensure data directory exists
if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

const db = new Database(dbPath);
try {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
} catch (e) {
  console.warn(`SQLite runtime tuning skipped: ${e.message}`);
}

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS weeks (
    week_key TEXT PRIMARY KEY,
    data TEXT
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT DEFAULT 'certification',
    completed_at TEXT NOT NULL,
    notes TEXT,
    week_key TEXT
  );
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    sub TEXT,
    created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS genesis_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    domain TEXT NOT NULL DEFAULT 'growth',
    progress INTEGER NOT NULL DEFAULT 0,
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
    FOREIGN KEY(project_id) REFERENCES genesis_projects(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_genesis_projects_status ON genesis_projects(status);
  CREATE INDEX IF NOT EXISTS idx_genesis_growth_records_recorded_at ON genesis_growth_records(recorded_at DESC);
`);

// Idempotent schema migration: add the richer Record columns if they don't exist.
// All new columns are nullable / defaulted so existing rows are untouched. `meta`
// is a JSON catch-all so future record kinds need no further migration.
(function migrate() {
  const cols = db.prepare('PRAGMA table_info(achievements)').all().map((c) => c.name);
  const add = (name, ddl) => { if (!cols.includes(name)) db.exec(`ALTER TABLE achievements ADD COLUMN ${ddl}`); };
  add('value', 'value REAL');
  add('unit', 'unit TEXT');
  add('tags', 'tags TEXT');
  add('pinned', 'pinned INTEGER DEFAULT 0');
  add('source', "source TEXT DEFAULT 'manual'");
  add('ext_key', 'ext_key TEXT');
  add('meta', 'meta TEXT');
})();

// Genesis phase 2 is additive so a phase 1 local database can be upgraded in
// place without deleting weeks, settings, achievements, projects or records.
(function migrateGenesis() {
  const ensureColumns = (table, definitions) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    for (const [name, ddl] of definitions) {
      if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  };
  ensureColumns('genesis_projects', [
    ['source_ref', 'source_ref TEXT'],
    ['repo_path', 'repo_path TEXT'],
    ['git_commit', 'git_commit TEXT'],
    ['evidence_json', 'evidence_json TEXT'],
    ['next_steps_json', 'next_steps_json TEXT'],
    ['source_type', "source_type TEXT NOT NULL DEFAULT 'legacy'"],
    ['confidence', "confidence TEXT NOT NULL DEFAULT 'legacy'"],
    ['visibility', "visibility TEXT NOT NULL DEFAULT 'private'"],
  ]);
  ensureColumns('genesis_growth_records', [
    ['source_ref', 'source_ref TEXT'],
    ['evidence_json', 'evidence_json TEXT'],
    ['details_json', 'details_json TEXT'],
    ['source_type', "source_type TEXT NOT NULL DEFAULT 'legacy'"],
    ['confidence', "confidence TEXT NOT NULL DEFAULT 'legacy'"],
    ['visibility', "visibility TEXT NOT NULL DEFAULT 'private'"],
    ['updated_at', "updated_at TEXT NOT NULL DEFAULT ''"],
  ]);
  db.exec(`
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_genesis_projects_source_ref ON genesis_projects(source_ref) WHERE source_ref IS NOT NULL AND source_ref <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_genesis_growth_source_ref ON genesis_growth_records(source_ref) WHERE source_ref IS NOT NULL AND source_ref <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_genesis_assets_source_ref ON genesis_assets(source_ref) WHERE source_ref IS NOT NULL AND source_ref <> '';
    CREATE INDEX IF NOT EXISTS idx_genesis_assets_project ON genesis_assets(project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_genesis_ingest_created ON genesis_ingest_keys(created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_genesis_profile_source_ref ON genesis_profile_items(source_ref) WHERE source_ref IS NOT NULL AND source_ref <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_genesis_goals_source_ref ON genesis_goals(source_ref) WHERE source_ref IS NOT NULL AND source_ref <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_genesis_decisions_source_ref ON genesis_decisions(source_ref) WHERE source_ref IS NOT NULL AND source_ref <> '';
    CREATE INDEX IF NOT EXISTS idx_genesis_profile_visibility ON genesis_profile_items(visibility, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_genesis_goals_status ON genesis_goals(status, priority DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_genesis_decisions_updated ON genesis_decisions(updated_at DESC);
  `);
  ensureColumns('genesis_assets', [
    ['source_type', "source_type TEXT NOT NULL DEFAULT 'legacy'"],
    ['confidence', "confidence TEXT NOT NULL DEFAULT 'legacy'"],
    ['visibility', "visibility TEXT NOT NULL DEFAULT 'private'"],
  ]);
  db.exec("UPDATE genesis_growth_records SET updated_at = COALESCE(NULLIF(updated_at, ''), created_at) WHERE updated_at IS NULL OR updated_at = ''");
})();

// Persisted random secret used to sign the session cookie (survives restarts).
function getSessionSecret() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'session_secret'").get();
  if (row && row.value) return row.value;
  const secret = require('crypto').randomBytes(48).toString('hex');
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('session_secret', ?)").run(secret);
  return secret;
}
const SESSION_SECRET = process.env.SESSION_SECRET || getSessionSecret();

// Persisted VAPID keys for Web Push (generated once, survive restarts).
function getVapid() {
  const pub = db.prepare("SELECT value FROM settings WHERE key = 'vapid_public'").get();
  const priv = db.prepare("SELECT value FROM settings WHERE key = 'vapid_private'").get();
  if (pub && priv) return { publicKey: pub.value, privateKey: priv.value };
  const keys = webpush.generateVAPIDKeys();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('vapid_public', ?)").run(keys.publicKey);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('vapid_private', ?)").run(keys.privateKey);
  return keys;
}
const VAPID = getVapid();
webpush.setVapidDetails('mailto:forge@example.com', VAPID.publicKey, VAPID.privateKey);

// Persisted sync token for Apple Reminders sync script (Bearer auth).
function getSyncToken() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'sync_token'").get();
  return (row && row.value) ? row.value : null;
}
function generateSyncToken() {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('sync_token', ?)").run(token);
  return token;
}

function getStoredPasswordHash() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(PASSWORD_HASH_KEY);
  if (!row || !row.value) return null;
  try { return JSON.parse(row.value); } catch (_) { return null; }
}
function hasStoredPassword() {
  return Boolean(getStoredPasswordHash());
}
function setupRequired() {
  return !hasSafeEnvPassword() && !hasStoredPassword();
}
function passwordSetupError(password) {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > 256) return 'Password is too long.';
  if (isUnsafePassword(password)) return 'Choose a unique password, not a setup placeholder.';
  return '';
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { alg: 'scrypt', salt, hash };
}
function safeStringEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function verifyStoredPassword(password, record) {
  if (!record || record.alg !== 'scrypt' || !record.salt || !record.hash) return false;
  const expected = Buffer.from(record.hash, 'hex');
  const actual = crypto.scryptSync(password, record.salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function verifyPassword(password) {
  if (typeof password !== 'string') return false;
  if (hasSafeEnvPassword() && safeStringEqual(password, ENV_APP_PASSWORD)) return true;
  const stored = getStoredPasswordHash();
  return verifyStoredPassword(password, stored);
}
function authCookieOptions(req) {
  return {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: SESSION_MAX_AGE_MS,
  };
}
function clearAuthCookieOptions(req) {
  const opts = authCookieOptions(req);
  delete opts.maxAge;
  return opts;
}

const MAX_WEEK_BYTES = 1024 * 1024;
const MAX_SETTINGS_BYTES = 2 * 1024 * 1024;
const MAX_PUSH_BYTES = 32 * 1024;
const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
const MAX_BACKUP_WEEKS = 2000;
const MAX_BACKUP_ACHIEVEMENTS = 5000;
const JSON_BODY_LIMIT = '12mb';
const GENESIS_AGENT_MAX_BODY_BYTES = 256 * 1024;
const GENESIS_AGENT_TOKEN = process.env.GENESIS_AGENT_TOKEN || '';
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PUBLIC_ORIGIN = normalizeOrigin(process.env.PUBLIC_ORIGIN || '');
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function normalizeOrigin(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value).trim());
    return `${url.protocol}//${url.host}`;
  } catch (_) {
    return '';
  }
}
function isValidDateKey(value) {
  if (typeof value !== 'string') return false;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
function hasUnsafeKeys(value, depth = 0) {
  if (depth > 30) return true;
  if (Array.isArray(value)) return value.some((item) => hasUnsafeKeys(item, depth + 1));
  if (!isPlainObject(value)) return false;
  return Object.keys(value).some((key) => UNSAFE_OBJECT_KEYS.has(key) || hasUnsafeKeys(value[key], depth + 1));
}
function jsonByteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
function validationError(res, message) {
  return res.status(400).json({ error: message });
}
function parseJson(value, fallback = null) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}
function optionalString(value, max, field) {
  if (value == null) return '';
  if (typeof value !== 'string') return `${field} must be a string.`;
  if (value.length > max) return `${field} is too long.`;
  return '';
}
function validateWeekPayload(key, body) {
  if (!isValidDateKey(key)) return 'week key must be a valid YYYY-MM-DD date.';
  if (!isPlainObject(body)) return 'week payload must be an object.';
  if (hasUnsafeKeys(body)) return 'payload contains unsafe object keys.';
  if (jsonByteLength(body) > MAX_WEEK_BYTES) return 'week payload is too large.';
  if ('checks' in body && !isPlainObject(body.checks)) return 'checks must be an object.';
  if ('fields' in body && !isPlainObject(body.fields)) return 'fields must be an object.';
  for (const [id, value] of Object.entries(body.checks || {})) {
    if (typeof id !== 'string' || id.length > 180) return 'check ids must be short strings.';
    if (typeof value !== 'boolean') return 'check values must be booleans.';
  }
  for (const [id, value] of Object.entries(body.fields || {})) {
    if (typeof id !== 'string' || id.length > 180) return 'field ids must be short strings.';
    if (!(value == null || ['string', 'number', 'boolean'].includes(typeof value))) return 'field values must be primitive.';
    if (typeof value === 'number' && !Number.isFinite(value)) return 'field numbers must be finite.';
    if (typeof value === 'string' && value.length > 20000) return 'field values are too long.';
  }
  return '';
}
// Merge one level of checks/fields into a stored week instead of replacing it.
// Two writers touch the same week -- the browser and the Apple Reminders sync --
// and a whole-document POST from either silently discards whatever the other
// just recorded.
function mergeWeek(existing, patch) {
  const base = isPlainObject(existing) ? existing : {};
  const next = Object.assign({}, base);
  next.checks = Object.assign({}, base.checks || {});
  next.fields = Object.assign({}, base.fields || {});
  for (const [id, value] of Object.entries(patch.checks || {})) next.checks[id] = value;
  for (const [id, value] of Object.entries(patch.fields || {})) {
    if (value === null) delete next.fields[id]; else next.fields[id] = value;
  }
  // Retiring a routine removes unused placeholders, never a completion that
  // arrived from another device after this client last loaded the week.
  for (const [group, removed] of [['checks', 'removeChecks'], ['fields', 'removeFields']]) {
    for (const [id, expected] of Object.entries(patch[removed] || {})) {
      if (next[group][id] === expected) delete next[group][id];
    }
  }
  if (!next.createdAt) next.createdAt = new Date().toISOString();
  next.schemaVersion = base.schemaVersion || 2;
  next.updatedAt = new Date().toISOString();
  return next;
}
// Assign into a nested plain object by dotted path. Used by PATCH /api/settings
// so a rename does not have to resend quests, pursuits, goals and trophies.
// A null value deletes the key.
function setByPath(target, path, value) {
  const parts = String(path).split('.');
  if (!parts.length || parts.some((k) => !k || UNSAFE_OBJECT_KEYS.has(k) || k.length > 120)) return false;
  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!isPlainObject(node[key])) node[key] = {};
    node = node[key];
  }
  const last = parts[parts.length - 1];
  if (value === null) delete node[last]; else node[last] = value;
  return true;
}
function validateSettingsPatch(body) {
  if (!isPlainObject(body)) return 'patch payload must be an object.';
  if (!isPlainObject(body.set)) return 'patch must carry a set object.';
  const entries = Object.entries(body.set);
  if (!entries.length) return 'patch must set at least one path.';
  if (entries.length > 200) return 'patch sets too many paths at once.';
  if (hasUnsafeKeys(body.set)) return 'patch contains unsafe object keys.';
  for (const [path, value] of entries) {
    if (typeof path !== 'string' || !path || path.length > 240) return 'patch paths must be short strings.';
    if (/(^|\.)(__proto__|constructor|prototype)(\.|$)/.test(path)) return 'patch path is not allowed.';
    if (hasUnsafeKeys(value)) return 'patch values contain unsafe object keys.';
    if (jsonByteLength(value) > MAX_SETTINGS_BYTES) return 'patch value is too large.';
  }
  return '';
}
function validateWeekPatch(key, body) {
  if (!isValidDateKey(key)) return 'week key must be a valid YYYY-MM-DD date.';
  if (!isPlainObject(body)) return 'week patch must be an object.';
  if (!('checks' in body) && !('fields' in body)) return 'week patch must carry checks or fields.';
  const invalid = validateWeekPayload(key, body);
  if (invalid) return invalid;
  return validateWeekPayload(key, { checks: "removeChecks" in body ? body.removeChecks : {}, fields: "removeFields" in body ? body.removeFields : {} });
}
function validateSettingsPayload(body) {
  if (!isPlainObject(body)) return 'settings payload must be an object.';
  if (hasUnsafeKeys(body)) return 'settings contain unsafe object keys.';
  if (jsonByteLength(body) > MAX_SETTINGS_BYTES) return 'settings payload is too large.';
  if ('version' in body && !(typeof body.version === 'number' && Number.isFinite(body.version))) return 'settings version must be a number.';
  return '';
}
function validateIdParam(id) {
  return /^\d+$/.test(String(id || ''));
}
function validateAchievementPayload(body, partial = false) {
  if (!isPlainObject(body)) return 'record payload must be an object.';
  if (hasUnsafeKeys(body)) return 'record contains unsafe object keys.';
  if (!partial || 'title' in body) {
    if (typeof body.title !== 'string' || !body.title.trim()) return 'title is required.';
    if (body.title.length > 160) return 'title is too long.';
  }
  for (const [field, max] of [['category', 64], ['notes', 20000], ['unit', 32], ['tags', 1000], ['source', 32], ['ext_key', 240], ['meta', 20000]]) {
    const err = optionalString(body[field], max, field);
    if (err) return err;
  }
  if ('completed_at' in body && body.completed_at != null) {
    if (typeof body.completed_at !== 'string' || Number.isNaN(Date.parse(body.completed_at))) return 'completed_at must be a valid date.';
  }
  if ('week_key' in body && body.week_key) {
    if (!isValidDateKey(body.week_key)) return 'week_key must be a valid YYYY-MM-DD date.';
  }
  if ('value' in body && body.value !== '' && body.value != null && !Number.isFinite(Number(body.value))) return 'value must be numeric.';
  if ('pinned' in body && !(typeof body.pinned === 'boolean' || body.pinned === 0 || body.pinned === 1)) return 'pinned must be a boolean.';
  return '';
}
function validatePushSubscription(sub) {
  if (!isPlainObject(sub)) return 'subscription must be an object.';
  if (hasUnsafeKeys(sub)) return 'subscription contains unsafe object keys.';
  if (jsonByteLength(sub) > MAX_PUSH_BYTES) return 'subscription payload is too large.';
  if (typeof sub.endpoint !== 'string' || sub.endpoint.length > 2048) return 'subscription endpoint is invalid.';
  try {
    const url = new URL(sub.endpoint);
    if (!['http:', 'https:'].includes(url.protocol)) return 'subscription endpoint is invalid.';
  } catch (_) {
    return 'subscription endpoint is invalid.';
  }
  if (!isPlainObject(sub.keys)) return 'subscription keys are required.';
  for (const key of ['p256dh', 'auth']) {
    if (typeof sub.keys[key] !== 'string' || !sub.keys[key] || sub.keys[key].length > 512) return 'subscription keys are invalid.';
  }
  return '';
}
function getAppSettings() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('app_settings');
  const value = row ? parseJson(row.value) : null;
  return isPlainObject(value) ? value : { version: 3, dayTemplates: null };
}
function readWeeksSnapshot() {
  const rows = db.prepare('SELECT week_key, data FROM weeks ORDER BY week_key').all();
  const weeks = {};
  const invalidWeeks = [];
  rows.forEach((row) => {
    const value = parseJson(row.data);
    if (isPlainObject(value)) weeks[row.week_key] = value;
    else invalidWeeks.push(row.week_key);
  });
  return { weeks, invalidWeeks };
}
function readAchievementsSnapshot() {
  return db.prepare('SELECT * FROM achievements ORDER BY completed_at DESC').all();
}
function buildBackupSnapshot(extra = {}) {
  const { weeks, invalidWeeks } = readWeeksSnapshot();
  const payload = {
    exportedAt: new Date().toISOString(),
    app: 'The Forge',
    version: 3,
    backupVersion: 1,
    database: { version: 2, weeks },
    settings: getAppSettings(),
    achievements: readAchievementsSnapshot(),
    ...extra,
  };
  if (invalidWeeks.length) payload.invalidWeeks = invalidWeeks;
  return payload;
}
function normalizeBackupPayload(payload) {
  if (!isPlainObject(payload)) return { error: 'backup payload must be an object.' };
  if (hasUnsafeKeys(payload)) return { error: 'backup contains unsafe object keys.' };
  if (jsonByteLength(payload) > MAX_BACKUP_BYTES) return { error: 'backup payload is too large.' };

  const incomingDb = payload.database || payload;
  if (!isPlainObject(incomingDb) || !isPlainObject(incomingDb.weeks)) return { error: 'backup database.weeks must be an object.' };
  const weekEntries = Object.entries(incomingDb.weeks);
  if (weekEntries.length > MAX_BACKUP_WEEKS) return { error: 'backup contains too many weeks.' };
  const weeks = {};
  for (const [key, data] of weekEntries) {
    const invalid = validateWeekPayload(key, data);
    if (invalid) return { error: `backup week ${key}: ${invalid}` };
    weeks[key] = data;
  }

  let settings = null;
  if ('settings' in payload) {
    if (!isPlainObject(payload.settings)) return { error: 'backup settings must be an object.' };
    settings = { version: 3, dayTemplates: null, ...payload.settings };
    const invalid = validateSettingsPayload(settings);
    if (invalid) return { error: `backup settings: ${invalid}` };
  }

  let achievements = null;
  if ('achievements' in payload) {
    if (!Array.isArray(payload.achievements)) return { error: 'backup achievements must be an array.' };
    if (payload.achievements.length > MAX_BACKUP_ACHIEVEMENTS) return { error: 'backup contains too many records.' };
    achievements = [];
    const ids = new Set();
    for (const item of payload.achievements) {
      const invalid = validateAchievementPayload(item);
      if (invalid) return { error: `backup record: ${invalid}` };
      if ('id' in item && item.id != null) {
        const numericId = Number(item.id);
        if (!validateIdParam(item.id) || !Number.isSafeInteger(numericId) || numericId < 1) return { error: 'backup record id is invalid.' };
        const id = String(numericId);
        if (ids.has(id)) return { error: 'backup record ids must be unique.' };
        ids.add(id);
      }
      achievements.push(item);
    }
  }

  return { weeks, settings, achievements };
}
const importBackupTransaction = db.transaction(({ weeks, settings, achievements }) => {
  db.prepare('DELETE FROM weeks').run();
  const insertWeek = db.prepare('INSERT INTO weeks (week_key, data) VALUES (?, ?)');
  for (const [key, data] of Object.entries(weeks)) insertWeek.run(key, JSON.stringify(data));

  if (settings) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('app_settings', JSON.stringify(settings));
  }

  if (achievements) {
    db.prepare('DELETE FROM achievements').run();
    const insertAchievement = db.prepare(
      `INSERT INTO achievements (id, title, category, completed_at, notes, week_key, value, unit, tags, pinned, source, ext_key, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const a of achievements) {
      insertAchievement.run(
        a.id || null,
        a.title,
        a.category || 'certification',
        a.completed_at || new Date().toISOString(),
        a.notes || '',
        a.week_key || '',
        (a.value === '' || a.value == null) ? null : Number(a.value),
        a.unit || null,
        a.tags || null,
        a.pinned ? 1 : 0,
        a.source || 'manual',
        a.ext_key || null,
        a.meta || null
      );
    }
  }
});
function originAllowed(req) {
  const originHeader = req.get('origin');
  if (!originHeader) return true;
  const origin = normalizeOrigin(originHeader);
  if (!origin) return false;
  if (PUBLIC_ORIGIN && origin === PUBLIC_ORIGIN) return true;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const requestHost = String(req.get('host') || '').toLowerCase();
    return Boolean(requestHost) && originHost === requestHost;
  } catch (_) {
    return false;
  }
}
function sameOriginWriteGuard(req, res, next) {
  if (!WRITE_METHODS.has(req.method) || originAllowed(req)) return next();
  return res.status(403).json({ error: (req.path === '/api/genesis/action-status' || req.path.startsWith('/api/genesis/quests') || req.path.startsWith('/api/genesis/skills') || req.path.startsWith('/api/genesis/editor')) ? '不允许跨站修改成长资料。' : 'Cross-origin write requests are not allowed.' });
}

// Security headers (no external deps). style-src keeps 'unsafe-inline' because the
// UI relies on inline style attributes; scripts are all same-origin files.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; '));
  next();
});

app.use(sameOriginWriteGuard);
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON request body.' });
  }
  return next(err);
});
app.use(cookieParser(SESSION_SECRET));

// Unauthenticated liveness probe (Docker HEALTHCHECK / orchestrators).
app.get('/healthz', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  } catch (_) {
    res.status(503).json({ status: 'error' });
  }
});

// --- Brute-force protection for /api/login (in-memory, per source IP) ---
const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const loginAttempts = new Map(); // ip -> { count, first }
const clientIp = (req) => req.socket.remoteAddress || 'unknown';
function loginLimiter(req, res, next) {
  const ip = clientIp(req);
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (rec && now - rec.first > LOGIN_WINDOW_MS) loginAttempts.delete(ip);
  const cur = loginAttempts.get(ip);
  if (cur && cur.count >= LOGIN_MAX_ATTEMPTS) {
    const retry = Math.ceil((LOGIN_WINDOW_MS - (now - cur.first)) / 1000);
    res.setHeader('Retry-After', String(retry));
    return res.status(429).json({ success: false, message: `Too many attempts. Try again in ${Math.ceil(retry / 60)} min.` });
  }
  next();
}

app.post('/api/login', loginLimiter, (req, res) => {
  const { password } = req.body;
  if (setupRequired()) {
    return res.status(428).json({ success: false, setupRequired: true, message: 'Password setup required' });
  }
  if (verifyPassword(password)) {
    loginAttempts.delete(clientIp(req));
    res.cookie('auth_token', 'ok', authCookieOptions(req));
    res.json({ success: true });
  } else {
    const ip = clientIp(req);
    const rec = loginAttempts.get(ip);
    if (rec) rec.count++; else loginAttempts.set(ip, { count: 1, first: Date.now() });
    res.status(401).json({ success: false, message: 'Invalid password' });
  }
});

app.get('/api/logout', (req, res) => {
  res.clearCookie('auth_token', clearAuthCookieOptions(req));
  res.redirect('/login.html');
});

// Middleware to protect routes
const requireAuth = (req, res, next) => {
  // Agent routes have already passed requireGenesisAgentAuth and must not
  // require a browser cookie as well.
  if (req.path.startsWith('/genesis/agent/')) return next();
  if (setupRequired()) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(428).json({ error: 'Setup required', setupRequired: true });
    }
    return res.redirect('/setup.html');
  }
  // Accept Bearer token auth from sync scripts alongside cookie auth.
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const stored = getSyncToken();
    if (stored && safeStringEqual(token, stored)) return next();
  }
  if (req.signedCookies.auth_token === 'ok') {
    next();
  } else {
    if (req.originalUrl.startsWith('/api/')) {
      res.status(401).json({ error: '请先登录。' });
    } else {
      res.redirect('/login.html');
    }
  }
};

// Agent ingestion is intentionally separate from the browser session. The
// connector sends a bearer token held in an environment variable/Secret; the
// token is never sent to the frontend or written to logs.
const requireGenesisAgentAuth = (req, res, next) => {
  if (!GENESIS_AGENT_TOKEN) return res.status(503).json({ error: 'Genesis agent integration is not configured.' });
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ') || !safeStringEqual(header.slice(7), GENESIS_AGENT_TOKEN)) {
    return res.status(401).json({ error: 'Genesis agent authentication failed.' });
  }
  const length = Number(req.headers['content-length'] || 0);
  if (length > GENESIS_AGENT_MAX_BODY_BYTES) return res.status(413).json({ error: 'Genesis agent payload is too large.' });
  next();
};

// The shell HTML must always revalidate, or clients stay pinned to a stale
// index that references old asset versions (the cause of "fixes don't show").
const noHtmlCache = (res) => res.set('Cache-Control', 'no-cache, must-revalidate');
app.get('/', requireAuth, (req, res) => {
  noHtmlCache(res);
  res.sendFile(path.join(__dirname, 'public', 'growth.html'));
});
app.get('/growth.html', requireAuth, (req, res) => {
  noHtmlCache(res);
  res.sendFile(path.join(__dirname, 'public', 'growth.html'));
});
app.get('/index.html', requireAuth, (req, res) => {
  noHtmlCache(res);
  res.sendFile(path.join(__dirname, 'public', 'growth.html'));
});
// 旧实现保留供开发维护；正常用户入口始终进入 Genesis。
app.get('/internal/legacy', requireAuth, (req, res) => {
  if (process.env.GENESIS_ENABLE_LEGACY_UI !== '1') return res.status(404).send('页面不存在。');
  noHtmlCache(res);
  res.type('html').send(fs.readFileSync(path.join(__dirname, 'legacy', 'forge.html'), 'utf8').replace('<head>', '<head><base href="/">'));
});

// The service worker must NEVER be cached (Cloudflare/browser) — a stale sw.js
// keeps the whole app pinned to old cached assets. no-store keeps it off every
// cache layer so deploys propagate immediately.
app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-store, must-revalidate');
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});
app.get('/setup.html', (req, res) => {
  noHtmlCache(res);
  if (!setupRequired()) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});
app.get('/login.html', (req, res) => {
  noHtmlCache(res);
  if (setupRequired()) return res.redirect('/setup.html');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/api/setup/status', (req, res) => {
  res.json({
    setupRequired: setupRequired(),
    envPasswordConfigured: hasSafeEnvPassword(),
    storedPasswordConfigured: hasStoredPassword(),
    minLength: PASSWORD_MIN_LENGTH,
  });
});

app.post('/api/setup', (req, res) => {
  if (!setupRequired()) {
    return res.status(409).json({ success: false, message: 'Setup is already complete.' });
  }
  const { password } = req.body || {};
  const error = passwordSetupError(password);
  if (error) return res.status(400).json({ success: false, message: error });
  const value = JSON.stringify(hashPassword(password));
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(PASSWORD_HASH_KEY, value);
  res.cookie('auth_token', 'ok', authCookieOptions(req));
  res.json({ success: true });
});

app.use('/api/genesis/agent/', requireGenesisAgentAuth);
app.use('/api/', requireAuth);
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // HTML (e.g. login.html) revalidates; manifest stays fresh. Versioned
    // ?v= assets (css/js/png) keep the default and are busted on each deploy.
    if (filePath.endsWith('.html') || filePath.endsWith('manifest.json')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  },
}));

// API Endpoints

// A read-only roll-up of everything an external panel needs to show progress:
// level, rank, attributes, streaks, this week's boss, trophy counts and
// today's agenda — each quest carrying the check id you PATCH to tick it.
//
// It exists so a wall display or a bot does not have to pull /api/database and
// grow its own copy of the level curve. See dashboard-summary.js.
app.get('/api/dashboard', (req, res) => {
  try {
    const { weeks } = readWeeksSnapshot();
    res.json(buildDashboardSummary({
      weeks,
      settings: getAppSettings(),
      achievements: readAchievementsSnapshot(),
    }));
  } catch (err) {
    res.status(500).json({ error: 'Could not build dashboard summary.' });
  }
});

function genesisDashboardSnapshot() {
  const projects = genesisEditor.visibleProjects(db,db.prepare(`
    SELECT id, name, description, status, domain, progress, target_date, source_ref, repo_path, git_commit, evidence_json, next_steps_json, source_type, confidence, visibility, created_at, updated_at
    FROM genesis_projects
    ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, updated_at DESC
  `).all());
  const growthRecords = db.prepare(`
    SELECT id, project_id, record_type, title, content, metric_value, metric_unit, source_ref, evidence_json, details_json, source_type, confidence, visibility, recorded_at, created_at, updated_at
    FROM genesis_growth_records
    ORDER BY recorded_at DESC, created_at DESC
    LIMIT 12
  `).all();
  const assets = db.prepare(`
    SELECT id, project_id, title, asset_type, content, tags_json, evidence_json, source_ref, created_at, updated_at
    FROM genesis_assets
    ORDER BY updated_at DESC
    LIMIT 12
  `).all();
  const activeProjects = projects.filter((project) => project.status === 'active');
  const averageProgress = activeProjects.length
    ? Math.round(activeProjects.reduce((sum, project) => sum + Number(project.progress || 0), 0) / activeProjects.length)
    : 0;
  return {
    generatedAt: new Date().toISOString(),
    summary: { projectCount: projects.length, activeProjectCount: activeProjects.length, recordCount: growthRecords.length, assetCount: assets.length, averageProgress },
    projects,
    growthRecords,
    assets,
  };
}

function validateGenesisProject(body) {
  if (!body || typeof body !== 'object') return 'project payload is required.';
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 160) return 'project name is required and must be 160 characters or fewer.';
  if (body.description != null && (typeof body.description !== 'string' || body.description.length > 2000)) return 'project description is invalid.';
  if (body.status != null && !['active', 'paused', 'completed', 'archived'].includes(body.status)) return 'project status is invalid.';
  if (body.progress != null && (!Number.isFinite(Number(body.progress)) || Number(body.progress) < 0 || Number(body.progress) > 100)) return 'project progress must be between 0 and 100.';
  return '';
}

function validateGenesisRecord(body) {
  if (!body || typeof body !== 'object') return 'growth record payload is required.';
  if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200) return 'record title is required and must be 200 characters or fewer.';
  if (body.content != null && (typeof body.content !== 'string' || body.content.length > 10000)) return 'record content is invalid.';
  if (body.record_type != null && (typeof body.record_type !== 'string' || body.record_type.length > 60)) return 'record type is invalid.';
  return '';
}

// 手动行动状态使用独立 settings 键，不进入 app_settings / weeks / 奖励账本。
let genesisQuestBuilder = null;
let genesisSkillTree = null;
const GENESIS_ACTION_STATE_KEY = 'genesis_action_states';
function readGenesisActionStates() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(GENESIS_ACTION_STATE_KEY);
  if (!row) return {};
  const value = JSON.parse(row.value);
  if (!isPlainObject(value) || hasUnsafeKeys(value)) throw new Error('Invalid action state');
  return value;
}

app.post('/api/genesis/action-status', async (req, res) => {
  const body = req.body;
  if (!isPlainObject(body) || hasUnsafeKeys(body) || Object.keys(body).some(key => !['date','quest_id','status','completed'].includes(key)) ||
      typeof body.quest_id !== 'string' || !body.quest_id.trim() || body.quest_id.length > 200 || !isValidDateKey(body.date) ||
      (!('status' in body) && typeof body.completed !== 'boolean')) {
    return res.status(400).json({error:'行动参数无效，请提供当天任务及明确状态。'});
  }
  const status = 'status' in body ? body.status : body.completed ? 'completed' : 'not_started';
  if (!['not_started','in_progress','completed'].includes(status) || ('completed' in body && (typeof body.completed !== 'boolean' || body.completed !== (status === 'completed')))) {
    return res.status(400).json({error:'行动状态无效，已沉淀状态尚未开放。'});
  }
  try {
    const {actionKey, mergeActionStates, savedActionStatus} = await import('./public/genesis-action-model.mjs');
    const {weeks} = readWeeksSnapshot();
    const today = buildActionSummary({weeks,settings:getAppSettings()}).today;
    const quest = today.quests.find(item => item.id === body.quest_id);
    if (body.date !== today.date || !quest) return res.status(400).json({error:'只能记录当前列表中的当天任务，请刷新页面。'});
    const result = db.transaction(() => {
      const states = readGenesisActionStates(), key = actionKey(body.date,body.quest_id), previous = states[key];
      if (quest.done) return {legacy:true};
      if (previous?.date === body.date && previous?.quest_id === body.quest_id && savedActionStatus(previous) === status) {
        return {success:true,deduplicated:true,action:{...previous,status},today:mergeActionStates(today,states)};
      }
      if (!previous && Object.keys(states).length >= 5000) return {full:true};
      const action = {date:body.date,quest_id:body.quest_id,status,completed:status === 'completed',updated_at:new Date().toISOString(),source_type:'manual_action',confidence:'user_stated',visibility:'private'};
      states[key] = action;
      db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(GENESIS_ACTION_STATE_KEY,JSON.stringify(states));
      return {success:true,deduplicated:false,action,today:mergeActionStates(today,states)};
    })();
    if (result.legacy) return res.status(409).json({error:'该任务已有历史完成记录，此处仅作展示。'});
    if (result.full) return res.status(409).json({error:'行动记录容量已满，请保留记录并等待存储升级。'});
    res.set('Cache-Control','no-store').json(result);
  } catch (_) { res.status(500).json({error:'行动状态保存失败，请刷新确认后重试。'}); }
});

// 成长首页：仅 SELECT 和纯汇总，不领取奖励、不修改周计划和记忆。
app.get('/api/genesis/home', async (req, res) => {
  try {
    const { buildGrowthHome } = await import('./public/genesis-home-model.mjs');
    const snapshot = {
      projects: genesisEditor.visibleProjects(db,db.prepare('SELECT id,name,status,domain,evidence_json FROM genesis_projects').all()),
      growthRecords: db.prepare('SELECT id,project_id,title,content,record_type,metric_value,metric_unit,evidence_json,recorded_at,created_at FROM genesis_growth_records').all(),
      assets: db.prepare('SELECT id,project_id,title,content,evidence_json,updated_at FROM genesis_assets').all(),
    };
    const profileItems = db.prepare("SELECT profile_key,value_json,confidence FROM genesis_profile_items WHERE profile_key IN ('display_name','nickname','callsign','current_stage','current_stage_name','growth_route') ORDER BY updated_at DESC").all();
    const goals = db.prepare("SELECT title,description,status,confidence FROM genesis_goals WHERE status='active' ORDER BY priority DESC,updated_at DESC LIMIT 20").all();
    const home = buildGrowthHome({ snapshot, profileItems, goals, environment:'local' });
    home.editor = {available:process.env.GENESIS_ENABLE_LOCAL_EDITING==='1'};
    home.questBuilder = {available:Boolean(genesisQuestBuilder)};
    home.skillTree = {available:Boolean(genesisSkillTree)};
    home.training.questBuilder = home.questBuilder;
    if(genesisQuestBuilder) Object.assign(home.training,{available:true,source:'Genesis 使命与执行记录',today:genesisQuestBuilder.today(),actionTracking:{writable:true,stateOnly:true,source:'Genesis 使命执行'}});
    res.set('Cache-Control','no-store').json(home);
  } catch (_) { res.status(500).json({error:'成长状态暂时无法读取，请重试。'}); }
});

app.get('/api/genesis/dashboard', (req, res) => {
  try { res.json(genesisDashboardSnapshot()); }
  catch (err) { console.error('Genesis dashboard failed:', err); res.status(500).json({ error: 'Could not build Genesis dashboard.' }); }
});

app.get('/api/genesis/projects', (req, res) => {
  res.json(genesisDashboardSnapshot().projects);
});

app.post('/api/genesis/projects', (req, res) => {
  const invalid = validateGenesisProject(req.body);
  if (invalid) return validationError(res, invalid);
  const now = new Date().toISOString();
  const id = `project-${crypto.randomUUID()}`;
  const body = req.body;
  db.prepare(`INSERT INTO genesis_projects (id, name, description, status, domain, progress, target_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, body.name.trim(), String(body.description || ''), body.status || 'active', String(body.domain || 'growth'),
    Math.round(Number(body.progress || 0)), body.target_date || null, now, now
  );
  res.status(201).json({ success: true, project: db.prepare('SELECT * FROM genesis_projects WHERE id = ?').get(id) });
});

app.get('/api/genesis/growth-records', (req, res) => {
  res.json(genesisDashboardSnapshot().growthRecords);
});

app.post('/api/genesis/growth-records', (req, res) => {
  const invalid = validateGenesisRecord(req.body);
  if (invalid) return validationError(res, invalid);
  const now = new Date().toISOString();
  const id = `record-${crypto.randomUUID()}`;
  const body = req.body;
  db.prepare(`INSERT INTO genesis_growth_records (id, project_id, record_type, title, content, metric_value, metric_unit, recorded_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, (body.project_id ? genesisEditor.resolveProject(db,body.project_id) : null), String(body.record_type || 'reflection'), body.title.trim(), String(body.content || ''),
    body.metric_value == null || body.metric_value === '' ? null : Number(body.metric_value), body.metric_unit || null, body.recorded_at || now, now
  );
  res.status(201).json({ success: true, record: db.prepare('SELECT * FROM genesis_growth_records WHERE id = ?').get(id) });
});

function genesisAgentString(value, max, field, required = false) {
  if (value == null || value === '') return required ? `${field} is required.` : '';
  if (typeof value !== 'string' || value.length > max) return `${field} is invalid or too long.`;
  return '';
}
function genesisAgentJson(value, max, field, { array = false } = {}) {
  if (value == null) return '';
  if (array && !Array.isArray(value)) return `${field} must be an array.`;
  if (!array && !isPlainObject(value) && !Array.isArray(value)) return `${field} must be an object or array.`;
  if (hasUnsafeKeys(value) || jsonByteLength(value) > max) return `${field} is invalid or too large.`;
  return '';
}
function genesisAgentDate(value, field) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return `${field} must be a valid date.`;
  return '';
}
const GENESIS_CONFIDENCE_VALUES = new Set(['verified', 'user_stated', 'pending_verification', 'inference', 'agent_generated', 'imported', 'legacy']);
const GENESIS_VISIBILITY_VALUES = new Set(['private', 'shared', 'public']);
function genesisAgentMetadataError(body) {
  if (body.source_type != null && genesisAgentString(body.source_type, 80, 'source_type')) return 'source_type is invalid.';
  if (body.confidence != null && !GENESIS_CONFIDENCE_VALUES.has(body.confidence)) return 'confidence is invalid.';
  if (body.visibility != null && !GENESIS_VISIBILITY_VALUES.has(body.visibility)) return 'visibility is invalid.';
  return '';
}
function validateGenesisAgentProject(body) {
  if (!isPlainObject(body)) return 'project payload must be an object.';
  for (const [value, max, field, required] of [['source_ref', 300, 'source_ref', true], ['name', 160, 'name', true], ['description', 4000, 'description', false], ['domain', 80, 'domain', false], ['repo_path', 500, 'repo_path', false], ['git_commit', 200, 'git_commit', false]]) {
    const error = genesisAgentString(body[value], max, field, required);
    if (error) return error;
  }
  if (body.status != null && !['active', 'paused', 'completed', 'archived'].includes(body.status)) return 'status is invalid.';
  if (body.progress != null && (!Number.isFinite(Number(body.progress)) || Number(body.progress) < 0 || Number(body.progress) > 100)) return 'progress must be between 0 and 100.';
  const metadata = genesisAgentMetadataError(body); if (metadata) return metadata;
  for (const [value, field] of [['target_date', 'target_date']]) { const error = genesisAgentDate(body[value], field); if (error) return error; }
  for (const [value, max, field, opts] of [['evidence', 16000, 'evidence', { array: true }], ['next_steps', 12000, 'next_steps', { array: true }]]) {
    const error = genesisAgentJson(body[value], max, field, opts); if (error) return error;
  }
  return '';
}
function validateGenesisAgentGrowth(body) {
  if (!isPlainObject(body)) return 'growth payload must be an object.';
  for (const [value, max, field, required] of [['source_ref', 300, 'source_ref', true], ['title', 200, 'title', true], ['content', 24000, 'content', false], ['record_type', 80, 'record_type', false], ['project_id', 120, 'project_id', false], ['metric_unit', 40, 'metric_unit', false]]) {
    const error = genesisAgentString(body[value], max, field, required); if (error) return error;
  }
  if (body.metric_value != null && body.metric_value !== '' && !Number.isFinite(Number(body.metric_value))) return 'metric_value must be finite.';
  const metadata = genesisAgentMetadataError(body); if (metadata) return metadata;
  const dateError = genesisAgentDate(body.recorded_at, 'recorded_at'); if (dateError) return dateError;
  for (const [value, max, field, opts] of [['details', 24000, 'details', {}], ['evidence', 16000, 'evidence', { array: true }]]) {
    const error = genesisAgentJson(body[value], max, field, opts); if (error) return error;
  }
  return '';
}
function validateGenesisAgentAsset(body) {
  if (!isPlainObject(body)) return 'asset payload must be an object.';
  for (const [value, max, field, required] of [['source_ref', 300, 'source_ref', true], ['title', 200, 'title', true], ['asset_type', 80, 'asset_type', false], ['content', 24000, 'content', true], ['project_id', 120, 'project_id', false]]) {
    const error = genesisAgentString(body[value], max, field, required); if (error) return error;
  }
  for (const [value, max, field, opts] of [['tags', 4000, 'tags', { array: true }], ['evidence', 16000, 'evidence', { array: true }]]) {
    const error = genesisAgentJson(body[value], max, field, opts); if (error) return error;
  }
  const metadata = genesisAgentMetadataError(body); if (metadata) return metadata;
  return '';
}
function genesisRequestHash(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}
function genesisIdempotencyKey(req) {
  const key = String(req.get('Idempotency-Key') || '').trim();
  return key && key.length <= 200 ? key : null;
}
function genesisReplayIdempotency(req, res, operation, body) {
  const key = genesisIdempotencyKey(req);
  if (!key) return null;
  const hash = genesisRequestHash(body);
  const row = db.prepare('SELECT operation, request_hash, response_json FROM genesis_ingest_keys WHERE idempotency_key = ?').get(key);
  if (!row) return { key, hash };
  if (row.operation !== operation || row.request_hash !== hash) {
    res.status(409).json({ error: 'Idempotency-Key was already used for a different request.' });
    return false;
  }
  const response = parseJson(row.response_json, { success: true });
  response.deduplicated = true;
  res.json(response);
  return false;
}
function genesisStoreIdempotency(context, operation, resourceType, resourceId, response) {
  if (!context) return;
  db.prepare(`INSERT OR IGNORE INTO genesis_ingest_keys (idempotency_key, operation, request_hash, resource_type, resource_id, response_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(context.key, operation, context.hash, resourceType, resourceId, JSON.stringify(response), new Date().toISOString());
}
function genesisExistingProject(projectId) {
  return projectId ? db.prepare('SELECT id FROM genesis_projects WHERE id = ?').get(genesisEditor.resolveProject(db,projectId)) : null;
}

app.get('/api/genesis/projects/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM genesis_projects WHERE id = ?').get(genesisEditor.resolveProject(db,req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  const growthRecords = db.prepare('SELECT * FROM genesis_growth_records WHERE project_id = ? ORDER BY recorded_at DESC, created_at DESC').all(project.id);
  const assets = db.prepare('SELECT * FROM genesis_assets WHERE project_id = ? ORDER BY updated_at DESC').all(project.id);
  const timeline = [
    ...growthRecords.map((item) => ({ kind: 'growth', at: item.recorded_at, title: item.title, record: item })),
    ...assets.map((item) => ({ kind: 'asset', at: item.created_at, title: item.title, asset: item })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  res.json({ project, growthRecords, assets, timeline });
});

// Agent connector endpoints. These are bearer-token protected above the normal
// browser session middleware and are intentionally separate from the dashboard
// read endpoints used by the existing frontend.
app.post('/api/genesis/agent/projects', (req, res) => {
  const invalid = validateGenesisAgentProject(req.body);
  if (invalid) return validationError(res, invalid);
  const body = req.body;
  const context = genesisReplayIdempotency(req, res, 'genesis_save_project', body);
  if (context === false) return;
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM genesis_projects WHERE source_ref = ?').get(body.source_ref);
  const id = existing ? genesisEditor.resolveProject(db,existing.id) : `project-${crypto.randomUUID()}`;
  if(existing && db.prepare('SELECT source_type FROM genesis_projects WHERE id=?').get(id)?.source_type==='manual_edit') {
    const response={success:true,operation:'genesis_save_project',created:false,deduplicated:true,manual_preserved:true,project:db.prepare('SELECT * FROM genesis_projects WHERE id=?').get(id)};
    genesisStoreIdempotency(context,'genesis_save_project','project',id,response);return res.json(response);
  }
  if (existing) {
    db.prepare(`UPDATE genesis_projects SET name = ?, description = ?, status = ?, domain = ?, progress = ?, target_date = ?, repo_path = ?, git_commit = ?, evidence_json = ?, next_steps_json = ?, source_type = ?, confidence = ?, visibility = ?, updated_at = ? WHERE id = ?`).run(
      body.name.trim(), String(body.description || ''), body.status || 'active', String(body.domain || 'growth'), Math.round(Number(body.progress || 0)),
      body.target_date || null, body.repo_path || null, body.git_commit || null, body.evidence == null ? null : JSON.stringify(body.evidence),
      body.next_steps == null ? null : JSON.stringify(body.next_steps), body.source_type || 'agent_generated', body.confidence || 'agent_generated', body.visibility || 'private', now, id
    );
  } else {
    db.prepare(`INSERT INTO genesis_projects (id, name, description, status, domain, progress, target_date, source_ref, repo_path, git_commit, evidence_json, next_steps_json, source_type, confidence, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, body.name.trim(), String(body.description || ''), body.status || 'active', String(body.domain || 'growth'), Math.round(Number(body.progress || 0)),
      body.target_date || null, body.source_ref, body.repo_path || null, body.git_commit || null, body.evidence == null ? null : JSON.stringify(body.evidence),
      body.next_steps == null ? null : JSON.stringify(body.next_steps), body.source_type || 'agent_generated', body.confidence || 'agent_generated', body.visibility || 'private', now, now
    );
  }
  const project = db.prepare('SELECT * FROM genesis_projects WHERE id = ?').get(id);
  const response = { success: true, operation: 'genesis_save_project', created: !existing, deduplicated: Boolean(existing), project };
  genesisStoreIdempotency(context, 'genesis_save_project', 'project', id, response);
  res.status(existing ? 200 : 201).json(response);
});

app.post('/api/genesis/agent/growth-records', (req, res) => {
  const invalid = validateGenesisAgentGrowth(req.body);
  if (invalid) return validationError(res, invalid);
  const body = req.body;
  if (body.project_id && !genesisExistingProject(body.project_id)) return validationError(res, 'project_id does not reference an existing project.');
  const context = genesisReplayIdempotency(req, res, 'genesis_add_growth', body);
  if (context === false) return;
  const existing = db.prepare('SELECT id FROM genesis_growth_records WHERE source_ref = ?').get(body.source_ref);
  if (existing) {
    const record = db.prepare('SELECT * FROM genesis_growth_records WHERE id = ?').get(existing.id);
    return res.json({ success: true, operation: 'genesis_add_growth', created: false, deduplicated: true, record });
  }
  const now = new Date().toISOString();
  const id = `record-${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO genesis_growth_records (id, project_id, record_type, title, content, metric_value, metric_unit, source_ref, evidence_json, details_json, source_type, confidence, visibility, recorded_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, (body.project_id ? genesisEditor.resolveProject(db,body.project_id) : null), String(body.record_type || 'reflection'), body.title.trim(), String(body.content || ''),
    body.metric_value == null || body.metric_value === '' ? null : Number(body.metric_value), body.metric_unit || null, body.source_ref,
    body.evidence == null ? null : JSON.stringify(body.evidence), body.details == null ? null : JSON.stringify(body.details), body.source_type || 'agent_generated', body.confidence || 'agent_generated', body.visibility || 'private', body.recorded_at || now, now, now
  );
  const record = db.prepare('SELECT * FROM genesis_growth_records WHERE id = ?').get(id);
  const response = { success: true, operation: 'genesis_add_growth', created: true, deduplicated: false, record };
  genesisStoreIdempotency(context, 'genesis_add_growth', 'growth', id, response);
  res.status(201).json(response);
});

app.post('/api/genesis/agent/assets', (req, res) => {
  const invalid = validateGenesisAgentAsset(req.body);
  if (invalid) return validationError(res, invalid);
  const body = req.body;
  if (body.project_id && !genesisExistingProject(body.project_id)) return validationError(res, 'project_id does not reference an existing project.');
  const context = genesisReplayIdempotency(req, res, 'genesis_save_asset', body);
  if (context === false) return;
  const existing = db.prepare('SELECT id FROM genesis_assets WHERE source_ref = ?').get(body.source_ref);
  if (existing) {
    const asset = db.prepare('SELECT * FROM genesis_assets WHERE id = ?').get(existing.id);
    return res.json({ success: true, operation: 'genesis_save_asset', created: false, deduplicated: true, asset });
  }
  const now = new Date().toISOString();
  const id = `asset-${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO genesis_assets (id, project_id, title, asset_type, content, tags_json, evidence_json, source_ref, source_type, confidence, visibility, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, (body.project_id ? genesisEditor.resolveProject(db,body.project_id) : null), body.title.trim(), String(body.asset_type || 'playbook'), body.content,
    body.tags == null ? null : JSON.stringify(body.tags), body.evidence == null ? null : JSON.stringify(body.evidence), body.source_ref, body.source_type || 'agent_generated', body.confidence || 'agent_generated', body.visibility || 'private', now, now
  );
  const asset = db.prepare('SELECT * FROM genesis_assets WHERE id = ?').get(id);
  const response = { success: true, operation: 'genesis_save_asset', created: true, deduplicated: false, asset };
  genesisStoreIdempotency(context, 'genesis_save_asset', 'asset', id, response);
  res.status(201).json(response);
});

app.get('/api/genesis/agent/projects', (req, res) => {
  res.json({ success: true, operation: 'genesis_get_projects', projects: genesisDashboardSnapshot().projects });
});

app.get('/api/database', (req, res) => {
  const { weeks, invalidWeeks } = readWeeksSnapshot();
  const payload = { version: 2, weeks };
  if (invalidWeeks.length) payload.invalidWeeks = invalidWeeks;
  res.json(payload);
});

app.post('/api/week/:key', (req, res) => {
  const { key } = req.params;
  const invalid = validateWeekPayload(key, req.body);
  if (invalid) return validationError(res, invalid);
  const data = JSON.stringify(req.body);
  const info = db.prepare('INSERT OR REPLACE INTO weeks (week_key, data) VALUES (?, ?)').run(key, data);
  res.json({ success: true, changes: info.changes });
});

app.get('/api/settings', (req, res) => {
  res.json(getAppSettings());
});

// Partial settings write. Sends only what changed, so concurrent edits to
// different keys from different devices no longer overwrite one another, and a
// pursuit rename stops rewriting the entire document.
app.patch('/api/settings', (req, res) => {
  const invalid = validateSettingsPatch(req.body);
  if (invalid) return validationError(res, invalid);
  const settings = getAppSettings();
  const applied = [];
  for (const [path, value] of Object.entries(req.body.set)) {
    if (!setByPath(settings, path, value)) return validationError(res, `patch path is not allowed: ${path}`);
    applied.push(path);
  }
  const stored = validateSettingsPayload(settings);
  if (stored) return validationError(res, stored);
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('app_settings', JSON.stringify(settings));
  res.json({ success: true, applied });
});

app.post('/api/settings', (req, res) => {
  const invalid = validateSettingsPayload(req.body);
  if (invalid) return validationError(res, invalid);
  const value = JSON.stringify(req.body);
  const info = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('app_settings', value);
  res.json({ success: true, changes: info.changes });
});

// Partial week write: merges the given checks/fields into the stored week.
// The Apple Reminders sync uses this so ticking a quest on your phone cannot
// discard a task you completed in the browser during the same cycle.
app.patch('/api/week/:key', (req, res) => {
  const { key } = req.params;
  const invalid = validateWeekPatch(key, req.body);
  if (invalid) return validationError(res, invalid);
  const row = db.prepare('SELECT data FROM weeks WHERE week_key = ?').get(key);
  const merged = mergeWeek(row ? parseJson(row.data) : null, req.body);
  const stored = validateWeekPayload(key, merged);
  if (stored) return validationError(res, stored);
  db.prepare('INSERT OR REPLACE INTO weeks (week_key, data) VALUES (?, ?)').run(key, JSON.stringify(merged));
  res.json({ success: true, week: merged });
});

app.get('/api/backup', (req, res) => {
  res.json(buildBackupSnapshot());
});

app.post('/api/backup', (req, res) => {
  const normalized = normalizeBackupPayload(req.body);
  if (normalized.error) return validationError(res, normalized.error);
  importBackupTransaction(normalized);
  res.json({ success: true, ...buildBackupSnapshot({
    imported: {
      weeks: Object.keys(normalized.weeks).length,
      settings: Boolean(normalized.settings),
      achievements: Array.isArray(normalized.achievements) ? normalized.achievements.length : null,
    },
  }) });
});

// Runtime hints for the UI (authenticated). Used to nag about the default password.
app.get('/api/config', (req, res) => {
  const needsSetup = setupRequired();
  res.json({
    defaultPassword: needsSetup && APP_PASSWORD === 'changeme',
    insecurePassword: needsSetup,
    setupRequired: needsSetup,
    envPasswordConfigured: hasSafeEnvPassword(),
    storedPasswordConfigured: hasStoredPassword(),
  });
});

// Achievement endpoints
app.get('/api/achievements', (req, res) => {
  res.json(readAchievementsSnapshot());
});

app.post('/api/achievements', (req, res) => {
  const invalid = validateAchievementPayload(req.body);
  if (invalid) return validationError(res, invalid);
  const { title, category, completed_at, notes, week_key, value, unit, tags, pinned, source, ext_key, meta } = req.body;
  // Auto records carry an ext_key and must never duplicate (server-side dedup).
  if (ext_key) {
    const dup = db.prepare('SELECT id FROM achievements WHERE ext_key = ?').get(ext_key);
    if (dup) return res.json({ success: true, id: dup.id, deduped: true });
  }
  const info = db.prepare(
    `INSERT INTO achievements (title, category, completed_at, notes, week_key, value, unit, tags, pinned, source, ext_key, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    title, category || 'certification', completed_at || new Date().toISOString(), notes || '', week_key || '',
    (value === '' || value == null) ? null : Number(value), unit || null, tags || null,
    pinned ? 1 : 0, source || 'manual', ext_key || null, meta || null
  );
  res.json({ success: true, id: info.lastInsertRowid });
});

// Edit a record (also used for pin toggle). Only updates fields that are sent.
app.put('/api/achievements/:id', (req, res) => {
  if (!validateIdParam(req.params.id)) return validationError(res, 'record id is invalid.');
  const invalid = validateAchievementPayload(req.body, true);
  if (invalid) return validationError(res, invalid);
  const allowed = ['title', 'category', 'completed_at', 'notes', 'value', 'unit', 'tags', 'pinned', 'meta'];
  const sets = [], vals = [];
  for (const k of allowed) {
    if (!(k in req.body)) continue;
    let v = req.body[k];
    if (k === 'pinned') v = v ? 1 : 0;
    if (k === 'value') v = (v === '' || v == null) ? null : Number(v);
    sets.push(`${k} = ?`); vals.push(v);
  }
  if (!sets.length) return res.json({ success: true, unchanged: true });
  vals.push(req.params.id);
  db.prepare(`UPDATE achievements SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ success: true });
});

app.delete('/api/achievements/:id', (req, res) => {
  if (!validateIdParam(req.params.id)) return validationError(res, 'record id is invalid.');
  db.prepare('DELETE FROM achievements WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ===== Web Push =====
app.get('/api/push/key', (req, res) => {
  res.json({ key: VAPID.publicKey });
});
app.post('/api/push/subscribe', (req, res) => {
  const sub = req.body;
  const invalid = validatePushSubscription(sub);
  if (invalid) return validationError(res, invalid);
  db.prepare("INSERT OR REPLACE INTO push_subscriptions (endpoint, sub, created_at) VALUES (?, ?, ?)")
    .run(sub.endpoint, JSON.stringify(sub), new Date().toISOString());
  res.json({ success: true });
});
app.post('/api/push/unsubscribe', (req, res) => {
  if (req.body && req.body.endpoint) {
    if (typeof req.body.endpoint !== 'string' || req.body.endpoint.length > 2048) return validationError(res, 'subscription endpoint is invalid.');
    db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(req.body.endpoint);
  }
  res.json({ success: true });
});

// ===== Reminders Sync =====
app.post('/api/sync/token', (req, res) => {
  const token = generateSyncToken();
  res.json({ token });
});
app.get('/api/sync/token', (req, res) => {
  const token = getSyncToken();
  res.json({ token: token || null });
});
app.get('/api/sync/status', (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'sync_status'").get();
  const token = getSyncToken();
  res.json({ status: row ? parseJson(row.value) : null, tokenConfigured: !!token });
});
app.post('/api/sync/heartbeat', (req, res) => {
  const { lastSync, synced, errors } = req.body || {};
  const value = JSON.stringify({ lastSync, synced: synced || 0, errors: errors || 0, receivedAt: new Date().toISOString() });
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('sync_status', ?)").run(value);
  res.json({ success: true });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(err);
  const status = err.status || err.statusCode || 500;
  const message = status >= 500 ? 'Internal server error' : (err.message || 'Request failed');
  if (req.path.startsWith('/api/') || req.path === '/healthz') {
    return res.status(status).json({ error: message });
  }
  return res.status(status).type('text/plain').send(message);
});

async function startGenesisServer() {
 if(process.env.GENESIS_ENABLE_LOCAL_EDITING==='1') genesisEditor.registerEditor({app,db});
 if(process.env.GENESIS_ENABLE_QUEST_BUILDER === '1') {
  genesisQuestBuilder = await require('./genesis-quests.cjs').registerQuests({app,db});
 }
 if(process.env.GENESIS_ENABLE_SKILL_TREE === '1') {
  genesisSkillTree = await require('./genesis-skills.cjs').registerSkills({app,db});
 }
const server = app.listen(port, '0.0.0.0', () => {
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const amber = (s) => paint('38;5;208', s);
  const cyan = (s) => paint('36', s);
  const dim = (s) => paint('2', s);
  const bold = (s) => paint('1', s);
  console.log('');
  console.log('  ' + amber('⚒  T H E   F O R G E'));
  console.log('  ' + dim('─────────────────────────────────────'));
  console.log('  ' + bold('▸') + ' Open    ' + cyan(`http://localhost:${port}`));
  console.log('  ' + bold('▸') + ' Data    ' + dim(dbPath));
  console.log('  ' + bold('▸') + ' Stop    ' + dim('Ctrl+C'));
  if (setupRequired()) {
    console.log('');
    console.log('  ' + paint('33', '⚠  First-run setup required — open the app to create a password.'));
  } else if (!hasSafeEnvPassword() && isUnsafePassword(APP_PASSWORD)) {
    console.log('');
    console.log('  ' + paint('33', '⚠  Unsafe APP_PASSWORD ignored — using the stored setup password.'));
  }
  console.log('');
});

// ===== Reminder scheduler =====
// Reminders used to depend on a cron entry that no install path ever created —
// not the Dockerfile, not install.sh, not the Windows installer — so the one
// feature whose job is to bring you back had no trigger anywhere. Running it
// on a timer inside the process means a stock install needs nothing extra, on
// any platform. A tick is cheap: it reads two rows and returns unless a slot
// is actually due, and sendReminders() dedupes per day per slot regardless.
const REMINDER_TICK_MS = 5 * 60 * 1000;
let reminderTimer = null;
function startReminderScheduler() {
  if (process.env.DISABLE_REMINDERS) return;
  const tick = () => {
    sendReminders(db)
      .then((r) => { if (r && r.sent) console.log(`[reminders] ${r.slot}: ${r.sent} sent — ${r.body}`); })
      .catch((err) => console.warn(`[reminders] ${err.message}`));
  };
  reminderTimer = setInterval(tick, REMINDER_TICK_MS);
  reminderTimer.unref();   // never hold the process open on its own
  tick();                  // catch a slot that came due while the server was down
}
startReminderScheduler();

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  if (reminderTimer) clearInterval(reminderTimer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

}
startGenesisServer().catch(()=>{console.error("Genesis 本地服务启动失败，请检查配置与数据库迁移。");process.exitCode=1;});
