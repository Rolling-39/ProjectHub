// ─────────────────────────────────────────────────────────────
// ProjectHub / store.rs —— SQLite 访问层
// ─────────────────────────────────────────────────────────────
use rusqlite::Connection;
use std::path::Path;

/// 放进 tauri State 的数据库句柄
pub struct Db(pub std::sync::Mutex<Connection>);

pub fn init(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.pragma_update(None, "journal_mode", "WAL").ok();
    conn.execute_batch(SCHEMA).map_err(|e| format!("建表失败: {e}"))?;
    // 旧库迁移：ai_suggestions 补列（已存在时忽略报错）
    let _ = conn.execute("ALTER TABLE ai_suggestions ADD COLUMN section TEXT", []);
    let _ = conn.execute("ALTER TABLE ai_suggestions ADD COLUMN group_name TEXT", []);
    let _ = conn.execute("ALTER TABLE ai_suggestions ADD COLUMN url TEXT", []);
    // 一次性迁移：旧版表单缺陷会把默认主题青色误存为自定义色，恢复为跟随主题
    let migrated: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM settings WHERE key = 'color_migration_v1'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(1);
    if migrated == 0 {
        let _ = conn.execute(
            "UPDATE items SET color = NULL WHERE color IN ('#39C5BB', '#39c5bb')",
            [],
        );
        let _ = conn.execute(
            "INSERT INTO settings(key, value) VALUES('color_migration_v1', '1')",
            [],
        );
    }
    Ok(conn)
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS items (
  id            INTEGER PRIMARY KEY,
  type          TEXT NOT NULL CHECK (type IN ('code','docs','link','github')),
  name          TEXT NOT NULL,
  path          TEXT,
  url           TEXT,
  description   TEXT DEFAULT '',
  notes         TEXT DEFAULT '',
  readme_path   TEXT,
  readme_ref    TEXT,
  category_id   INTEGER REFERENCES categories(id),
  pinned        INTEGER DEFAULT 0,
  archived      INTEGER DEFAULT 0,
  color         TEXT,
  icon          TEXT,
  open_count    INTEGER DEFAULT 0,
  last_opened_at TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id        INTEGER PRIMARY KEY,
  section   TEXT NOT NULL CHECK (section IN ('code','docs','link','github')),
  name      TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id),
  sort      INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tags (
  id    INTEGER PRIMARY KEY,
  name  TEXT UNIQUE NOT NULL,
  color TEXT
);

CREATE TABLE IF NOT EXISTS item_tags (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS open_history (
  id        INTEGER PRIMARY KEY,
  item_id   INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  opened_at TEXT DEFAULT (datetime('now')),
  via       TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- AI 建议历史：生成即落库，应用时存 before 快照支持撤回
CREATE TABLE IF NOT EXISTS ai_suggestions (
  id          INTEGER PRIMARY KEY,
  batch_id    TEXT NOT NULL,
  source      TEXT NOT NULL,
  item_id     INTEGER,
  action      TEXT NOT NULL,
  group_id    INTEGER,
  tags        TEXT DEFAULT '[]',
  description TEXT,
  name        TEXT,
  reason      TEXT DEFAULT '',
  status      TEXT DEFAULT 'pending',
  before_json TEXT,
  section     TEXT,
  group_name  TEXT,
  url         TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_sug_status ON ai_suggestions(status);

-- AI 纯对话记录
CREATE TABLE IF NOT EXISTS ai_chat (
  id         INTEGER PRIMARY KEY,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_type   ON items(type);
CREATE INDEX IF NOT EXISTS idx_items_cat    ON items(category_id);
CREATE INDEX IF NOT EXISTS idx_oh_item      ON open_history(item_id);
CREATE INDEX IF NOT EXISTS idx_categories_section ON categories(section);
"#;
