-- 单用户首次设置：只保存带盐、Secret pepper保护的派生值，不保存明文密码。
CREATE TABLE IF NOT EXISTS genesis_owner_auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  algorithm TEXT NOT NULL CHECK (algorithm = 'pbkdf2-sha256-pepper-v1'),
  iterations INTEGER NOT NULL CHECK (iterations = 100000),
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  session_epoch TEXT NOT NULL,
  created_at TEXT NOT NULL
);
