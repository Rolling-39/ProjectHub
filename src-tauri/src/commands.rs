// ─────────────────────────────────────────────────────────────
// ProjectHub / commands.rs —— 业务命令
// 注意：pub fn 命令必须放在这个子模块里（crate 根的 pub 命令会因
// tauri 宏的 E0255 编译失败，见 ui-kit README 设计决策 3）。
// ─────────────────────────────────────────────────────────────
use crate::store::Db;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Manager, State};

const ITEM_TYPES: [&str; 4] = ["code", "docs", "link", "github"];

// ── 数据结构 ──

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: i64,
    pub r#type: String,
    pub name: String,
    pub path: Option<String>,
    pub url: Option<String>,
    pub description: String,
    pub notes: String,
    pub readme_path: Option<String>,
    pub readme_ref: Option<String>,
    pub category_id: Option<i64>,
    pub pinned: bool,
    pub archived: bool,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub open_count: i64,
    pub last_opened_at: Option<String>,
    pub created_at: String,
    /// 冗余输出：item_tags + tags 名字（导入导出时忽略，以 item_tags 表为准）
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemInput {
    pub id: Option<i64>,
    pub r#type: String,
    pub name: String,
    pub path: Option<String>,
    pub url: Option<String>,
    pub description: Option<String>,
    pub notes: Option<String>,
    pub category_id: Option<i64>,
    pub pinned: Option<bool>,
    pub archived: Option<bool>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub tags: Option<Vec<String>>,
    /// github 类型：本地化 README 路径与来源（编辑普通条目时原样透传，避免被清空）
    pub readme_path: Option<String>,
    pub readme_ref: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: i64,
    pub section: String,
    pub name: String,
    pub parent_id: Option<i64>,
    pub sort: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: i64,
    pub r#type: String,
    pub name: String,
    pub description: String,
    pub notes: String,
    pub path: Option<String>,
    pub url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownDoc {
    pub content: String,
    pub base_dir: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemFilter {
    #[serde(default = "default_true")]
    pub exclude_archived: bool,
    #[serde(default)]
    pub favorites_only: bool,
}

fn default_true() -> bool { true }

// ── 设置 ──

pub(crate) fn read_setting(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| {
        r.get::<_, String>(0)
    })
    .ok()
}

#[tauri::command]
pub fn get_setting(db: State<Db>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(read_setting(&conn, &key))
}

#[tauri::command]
pub fn set_setting(db: State<Db>, key: String, value: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── 条目查询 ──

fn row_to_item(r: &rusqlite::Row) -> rusqlite::Result<Item> {
    Ok(Item {
        id: r.get("id")?,
        r#type: r.get("type")?,
        name: r.get("name")?,
        path: r.get("path")?,
        url: r.get("url")?,
        description: r.get::<_, Option<String>>("description")?.unwrap_or_default(),
        notes: r.get::<_, Option<String>>("notes")?.unwrap_or_default(),
        readme_path: r.get("readme_path")?,
        readme_ref: r.get("readme_ref")?,
        category_id: r.get("category_id")?,
        pinned: r.get::<_, i64>("pinned")? != 0,
        archived: r.get::<_, i64>("archived")? != 0,
        color: r.get("color")?,
        icon: r.get("icon")?,
        open_count: r.get("open_count")?,
        last_opened_at: r.get("last_opened_at")?,
        created_at: r.get::<_, Option<String>>("created_at")?.unwrap_or_default(),
        tags: Vec::new(),
    })
}

/// 填充单个条目的标签名（几十条目的量级，逐条查询足够）
fn fill_tags(conn: &rusqlite::Connection, item: &mut Item) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id
             WHERE it.item_id = ?1 ORDER BY t.name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![item.id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    item.tags = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_items(
    db: State<Db>,
    section: String,
    filter: Option<ItemFilter>,
) -> Result<Vec<Item>, String> {
    let f = filter.unwrap_or(ItemFilter {
        exclude_archived: true,
        favorites_only: false,
    });
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    // 一条 JOIN 取回条目与标签，替代原实现的 N+1（每条目一次 prepare + 一次查询，
    // 150 条就是约 300 次 SQL，而每次数据变更都会重跑一遍）。
    // 标签列用 LEFT JOIN，没标签的条目也会出现（tag_name 为 NULL）。
    let mut stmt = conn
        .prepare(
            "SELECT i.id, i.type, i.name, i.path, i.url, i.description, i.notes,
                    i.readme_path, i.readme_ref, i.category_id, i.pinned, i.archived,
                    i.color, i.icon, i.open_count, i.last_opened_at, i.created_at,
                    t.name AS tag_name
             FROM items i
             LEFT JOIN item_tags it ON it.item_id = i.id
             LEFT JOIN tags t ON t.id = it.tag_id
             WHERE i.type = ?1
               AND (?2 = 0 OR i.archived = 0)
               AND (?3 = 0 OR i.pinned = 1)
             ORDER BY i.pinned DESC,
                      (i.last_opened_at IS NULL), i.last_opened_at DESC,
                      i.name COLLATE NOCASE,
                      t.name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            params![section, f.exclude_archived as i64, f.favorites_only as i64],
            |r| {
                let item = Item {
                    id: r.get(0)?,
                    r#type: r.get(1)?,
                    name: r.get(2)?,
                    path: r.get(3)?,
                    url: r.get(4)?,
                    description: r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    notes: r.get::<_, Option<String>>(6)?.unwrap_or_default(),
                    readme_path: r.get(7)?,
                    readme_ref: r.get(8)?,
                    category_id: r.get(9)?,
                    pinned: r.get::<_, i64>(10)? != 0,
                    archived: r.get::<_, i64>(11)? != 0,
                    color: r.get(12)?,
                    icon: r.get(13)?,
                    open_count: r.get(14)?,
                    last_opened_at: r.get(15)?,
                    created_at: r.get::<_, Option<String>>(16)?.unwrap_or_default(),
                    tags: Vec::new(),
                };
                Ok((item, r.get::<_, Option<String>>(17)?))
            },
        )
        .map_err(|e| e.to_string())?;

    // 同一条目的多行是连续的（ORDER BY 以条目列为前缀），顺序合并即可
    let mut items: Vec<Item> = Vec::new();
    for row in rows {
        let (mut item, tag) = row.map_err(|e| e.to_string())?;
        if let Some(t) = tag {
            if items.last().map(|last| last.id) == Some(item.id) {
                items.last_mut().expect("刚判断过非空").tags.push(t);
                continue;
            }
            item.tags.push(t);
        }
        items.push(item);
    }
    Ok(items)
}

/// 某板块实际用到的标签（全局标签池，按板块过滤显示）
#[tauri::command]
pub fn list_tags(db: State<Db>, section: String) -> Result<Vec<Tag>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT t.id, t.name, t.color
             FROM tags t
             JOIN item_tags it ON it.tag_id = t.id
             JOIN items i ON i.id = it.item_id
             WHERE i.type = ?1
             ORDER BY t.name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let tags = stmt
        .query_map(params![section], |r| {
            Ok(Tag { id: r.get(0)?, name: r.get(1)?, color: r.get(2)? })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(tags)
}

fn read_item_by_id(conn: &rusqlite::Connection, id: i64) -> Result<Item, String> {
    let mut item = conn
        .query_row("SELECT * FROM items WHERE id = ?1", params![id], row_to_item)
        .map_err(|e| format!("条目不存在: {e}"))?;
    fill_tags(conn, &mut item)?;
    Ok(item)
}

// ── 条目 CRUD ──

fn upsert_item_inner(conn: &mut rusqlite::Connection, item: ItemInput) -> Result<i64, String> {
    let name = item.name.trim().to_string();
    if name.is_empty() {
        return Err("名称不能为空".into());
    }
    if !ITEM_TYPES.contains(&item.r#type.as_str()) {
        return Err("无效的条目类型".into());
    }

    let target_id;
    {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        target_id = match item.id {
            Some(id) => {
                tx.execute(
                    "UPDATE items SET type=?1, name=?2, path=?3, url=?4, description=?5,
                     notes=?6, category_id=?7, pinned=?8, archived=?9, color=?10, icon=?11,
                     readme_path=?12, readme_ref=?13
                     WHERE id=?14",
                    params![
                        item.r#type, name, item.path, item.url,
                        item.description.clone().unwrap_or_default(),
                        item.notes.clone().unwrap_or_default(),
                        item.category_id,
                        item.pinned.unwrap_or(false) as i64,
                        item.archived.unwrap_or(false) as i64,
                        item.color, item.icon,
                        item.readme_path, item.readme_ref, id,
                    ],
                )
                .map_err(|e| e.to_string())?;
                id
            }
            None => {
                tx.execute(
                    "INSERT INTO items(type, name, path, url, description, notes, category_id,
                                       pinned, archived, color, icon, readme_path, readme_ref)
                     VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                    params![
                        item.r#type, name, item.path, item.url,
                        item.description.clone().unwrap_or_default(),
                        item.notes.clone().unwrap_or_default(),
                        item.category_id,
                        item.pinned.unwrap_or(false) as i64,
                        item.archived.unwrap_or(false) as i64,
                        item.color, item.icon,
                        item.readme_path, item.readme_ref,
                    ],
                )
                .map_err(|e| e.to_string())?;
                tx.last_insert_rowid()
            }
        };

        // 标签同步：按名字隐式建 tag，重建 item_tags
        tx.execute("DELETE FROM item_tags WHERE item_id = ?1", params![target_id])
            .map_err(|e| e.to_string())?;
        for t in item.tags.unwrap_or_default() {
            let tn = t.trim();
            if tn.is_empty() {
                continue;
            }
            tx.execute("INSERT OR IGNORE INTO tags(name) VALUES(?1)", params![tn])
                .map_err(|e| e.to_string())?;
            let tid: i64 = tx
                .query_row("SELECT id FROM tags WHERE name = ?1", params![tn], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT OR IGNORE INTO item_tags(item_id, tag_id) VALUES(?1, ?2)",
                params![target_id, tid],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
    }
    Ok(target_id)
}

#[tauri::command]
pub fn upsert_item(db: State<Db>, item: ItemInput) -> Result<Item, String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = upsert_item_inner(&mut conn, item)?;
    read_item_by_id(&conn, id)
}

#[tauri::command]
pub fn delete_item(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM items WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 批量删除：一个事务里删完，返回实际删除条数
#[tauri::command]
pub fn delete_items(db: State<Db>, ids: Vec<i64>) -> Result<usize, String> {
    if ids.is_empty() {
        return Ok(0);
    }
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut n = 0usize;
    for id in &ids {
        n += tx
            .execute("DELETE FROM items WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(n)
}

/// 改收藏/归档标志，返回更新后的条目（供前端就地更新）
#[tauri::command]
pub fn set_item_flags(
    db: State<Db>,
    id: i64,
    pinned: Option<bool>,
    archived: Option<bool>,
) -> Result<Item, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    if let Some(p) = pinned {
        conn.execute("UPDATE items SET pinned = ?1 WHERE id = ?2", params![p as i64, id])
            .map_err(|e| e.to_string())?;
    }
    if let Some(a) = archived {
        conn.execute("UPDATE items SET archived = ?1 WHERE id = ?2", params![a as i64, id])
            .map_err(|e| e.to_string())?;
    }
    read_item_by_id(&conn, id)
}

// ── 分组（按板块独立） ──

fn row_to_category(r: &rusqlite::Row) -> rusqlite::Result<Category> {
    Ok(Category {
        id: r.get(0)?,
        section: r.get(1)?,
        name: r.get(2)?,
        parent_id: r.get(3)?,
        sort: r.get(4)?,
    })
}

#[tauri::command]
pub fn list_categories(db: State<Db>, section: String) -> Result<Vec<Category>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, section, name, parent_id, sort FROM categories WHERE section = ?1 ORDER BY sort, id")
        .map_err(|e| e.to_string())?;
    let cats = stmt
        .query_map(params![section], row_to_category)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(cats)
}

#[tauri::command]
pub fn upsert_category(
    db: State<Db>,
    section: String,
    id: Option<i64>,
    name: String,
    parent_id: Option<i64>,
    sort: Option<i64>,
) -> Result<Category, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("分组名不能为空".into());
    }
    if !ITEM_TYPES.contains(&section.as_str()) {
        return Err("无效的板块".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let cat_id = match id {
        Some(id) => {
            conn.execute(
                "UPDATE categories SET name=?1, parent_id=?2, sort=?3 WHERE id=?4",
                params![name, parent_id, sort.unwrap_or(0), id],
            )
            .map_err(|e| e.to_string())?;
            id
        }
        None => {
            conn.execute(
                "INSERT INTO categories(section, name, parent_id, sort) VALUES(?1, ?2, ?3, ?4)",
                params![section, name, parent_id, sort.unwrap_or(0)],
            )
            .map_err(|e| e.to_string())?;
            conn.last_insert_rowid()
        }
    };
    conn.query_row(
        "SELECT id, section, name, parent_id, sort FROM categories WHERE id = ?1",
        params![cat_id],
        row_to_category,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_category(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE items SET category_id = NULL WHERE category_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("UPDATE categories SET parent_id = NULL WHERE parent_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM categories WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── 打开条目 ──

#[cfg(target_os = "windows")]
fn no_window(cmd: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    // CREATE_NO_WINDOW：避免 cmd/powershell 弹黑框
    cmd.creation_flags(0x0800_0000);
}
#[cfg(not(target_os = "windows"))]
fn no_window(_cmd: &mut std::process::Command) {}

fn spawn_terminal(path: &str) -> Result<(), String> {
    // 优先 Windows Terminal，失败回退 PowerShell
    if std::process::Command::new("wt").args(["-d", path]).spawn().is_ok() {
        return Ok(());
    }
    let script = format!("Set-Location -LiteralPath '{}'", path.replace('\'', "''"));
    let mut c = std::process::Command::new("powershell");
    c.args(["-NoExit", "-Command", &script]);
    no_window(&mut c);
    c.spawn().map(|_| ()).map_err(|e| format!("打开终端失败: {e}"))
}

fn spawn_editor(path: &str, editor_cmd: Option<String>) -> Result<(), String> {
    let spec = editor_cmd.unwrap_or_else(|| "code".into());
    let mut parts = spec.split_whitespace();
    let prog = parts.next().unwrap_or("code").to_string();
    let mut c = std::process::Command::new(&prog);
    for a in parts {
        c.arg(a);
    }
    c.arg(path);
    c.spawn()
        .map(|_| ())
        .map_err(|e| format!("启动编辑器 {prog} 失败（可在设置里改 editor_cmd）：{e}"))
}

fn open_browser(url: &str) -> Result<(), String> {
    let mut c = std::process::Command::new("cmd");
    c.args(["/C", "start", "", url]);
    no_window(&mut c);
    c.spawn().map(|_| ()).map_err(|e| format!("打开浏览器失败: {e}"))
}

/// 打开条目并记录历史。at 由前端传 ISO 时间，避免引入 chrono。
///
/// 返回更新后的条目：前端据此就地更新那一条，不必为"打开次数 +1"重载整块
/// （重载要重取三个集合、重建全部 DOM，还会把详情栏的 README 重读一遍磁盘）。
#[tauri::command]
pub fn open_item(db: State<Db>, id: i64, via: String, at: Option<String>) -> Result<Item, String> {
    let (path, url): (Option<String>, Option<String>) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row("SELECT path, url FROM items WHERE id = ?1", params![id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|_| "条目不存在".to_string())?
    };

    match via.as_str() {
        "explorer" => {
            let p = path.ok_or("该条目没有本地路径")?;
            std::process::Command::new("explorer")
                .arg(&p)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("打开资源管理器失败: {e}"))?;
        }
        "terminal" => {
            let p = path.ok_or("该条目没有本地路径")?;
            spawn_terminal(&p)?;
        }
        "editor" => {
            let p = path.ok_or("该条目没有本地路径")?;
            let editor_cmd = {
                let conn = db.0.lock().map_err(|e| e.to_string())?;
                read_setting(&conn, "editor_cmd")
            };
            spawn_editor(&p, editor_cmd)?;
        }
        "browser" => {
            let u = url.ok_or("该条目没有网址")?;
            open_browser(&u)?;
        }
        _ => return Err("无效的打开方式".into()),
    }

    // 前端没给时间就由数据库取当前 UTC。
    // 不要回落到 1970-01-01：那会静默把 last_opened_at 写坏，
    // 条目在"最近打开"里永远排最后，而且从界面上完全看不出哪里错了。
    let now: String = match at {
        Some(t) if !t.trim().is_empty() => t,
        _ => {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now')", [], |r| r.get(0))
                .map_err(|e| format!("取当前时间失败: {e}"))?
        }
    };

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE items SET open_count = open_count + 1, last_opened_at = ?1 WHERE id = ?2",
        params![now, id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO open_history(item_id, opened_at, via) VALUES(?1, ?2, ?3)",
        params![id, now, via],
    )
    .map_err(|e| e.to_string())?;
    read_item_by_id(&conn, id)
}

// ── Markdown ──

#[tauri::command]
pub fn read_markdown(app: tauri::AppHandle, path: String) -> Result<MarkdownDoc, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("无法读取: {e}"))?;
    if meta.len() > 5_000_000 {
        return Err("文件超过 5MB，不渲染".into());
    }
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("读取失败（需 UTF-8）: {e}"))?;
    let base_dir = std::path::Path::new(&path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    // 本地项目/文档目录的图片要走 asset:// 协议：按需把这个目录加进
    // 资产协议白名单（github_assets 在 $APPDATA 下，静态 scope 已覆盖）。
    if !base_dir.is_empty() {
        let _ = app
            .asset_protocol_scope()
            .allow_directory(&base_dir, true);
    }
    Ok(MarkdownDoc { content, base_dir })
}

/// README 探测：readme*.md 大小写不敏感，精确 README.md 优先，其次 readme.zh*
#[tauri::command]
pub fn find_readme(dir: String) -> Result<Option<String>, String> {
    let mut best: Option<(i32, String)> = None;
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("无法读取目录: {e}"))?;
    for entry in entries.flatten() {
        if !entry.metadata().map(|m| m.is_file()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        if !(lower.starts_with("readme") && lower.ends_with(".md")) {
            continue;
        }
        let score = if lower == "readme.md" {
            0
        } else if lower.starts_with("readme.zh") {
            1
        } else {
            2
        };
        if best.as_ref().map_or(true, |(s, _)| score < *s) {
            let dir_clean = dir.trim_end_matches(|c| c == '\\' || c == '/');
            best = Some((score, format!("{dir_clean}\\{name}")));
        }
    }
    Ok(best.map(|(_, p)| p))
}

#[tauri::command]
pub fn list_markdown_files(dir: String) -> Result<Vec<String>, String> {
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("无法读取目录: {e}"))?;
    let mut files: Vec<(String, String)> = entries
        .flatten()
        .filter(|e| e.metadata().map(|m| m.is_file()).unwrap_or(false))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name.to_lowercase().ends_with(".md") {
                Some((name.to_lowercase(), name))
            } else {
                None
            }
        })
        .collect();
    files.sort();
    Ok(files.into_iter().map(|(_, n)| n).collect())
}

/// 目录内容清单（文件夹在前，名称不区分大小写排序）——文档板块的目录浏览器用
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryInfo {
    pub name: String,
    pub is_dir: bool,
    pub ext: String,
    pub size: u64,
}

#[tauri::command]
pub fn list_dir_files(dir: String) -> Result<Vec<DirEntryInfo>, String> {
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("无法读取目录: {e}"))?;
    let mut rows: Vec<(bool, String, String, u64)> = Vec::new();
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = meta.is_dir();
        let ext = if is_dir {
            String::new()
        } else {
            std::path::Path::new(&name)
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default()
        };
        rows.push((is_dir, name, ext, if is_dir { 0 } else { meta.len() }));
    }
    rows.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.to_lowercase().cmp(&b.1.to_lowercase())));
    Ok(rows
        .into_iter()
        .map(|(is_dir, name, ext, size)| DirEntryInfo { name, is_dir, ext, size })
        .collect())
}

/// 用系统默认程序打开任意文件（Word/PDF 等交给系统关联的应用）
#[tauri::command]
pub fn open_file(path: String) -> Result<(), String> {
    std::fs::metadata(&path).map_err(|_| "文件不存在".to_string())?;
    let mut c = std::process::Command::new("cmd");
    c.args(["/C", "start", "", &path]);
    no_window(&mut c);
    c.spawn().map(|_| ()).map_err(|e| format!("打开失败: {e}"))?;
    Ok(())
}

// ── 跨板块搜索 ──

#[tauri::command]
pub fn search_all(db: State<Db>, query: String) -> Result<Vec<SearchHit>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    // LIKE 的通配符必须转义：搜 "50%" 或 "a_b" 时 % 与 _ 会被当作通配符，
    // 结果变成"匹配一切"，看起来像搜索失灵。
    let escaped = q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    let like = format!("%{escaped}%");
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            // path / url 也要参与匹配：命令面板会把它们展示出来，
            // 能看见却搜不到会让人以为搜索坏了。
            "SELECT DISTINCT i.id, i.type, i.name, i.description, i.notes, i.path, i.url
             FROM items i
             LEFT JOIN item_tags it ON it.item_id = i.id
             LEFT JOIN tags t ON t.id = it.tag_id
             WHERE i.archived = 0
               AND (i.name LIKE ?1 ESCAPE '\\'
                    OR i.description LIKE ?1 ESCAPE '\\'
                    OR i.notes LIKE ?1 ESCAPE '\\'
                    OR i.path LIKE ?1 ESCAPE '\\'
                    OR i.url LIKE ?1 ESCAPE '\\'
                    OR t.name LIKE ?1 ESCAPE '\\')
             ORDER BY i.pinned DESC, i.name COLLATE NOCASE
             LIMIT 50",
        )
        .map_err(|e| e.to_string())?;
    let hits = stmt
        .query_map(params![like], |r| {
            Ok(SearchHit {
                id: r.get(0)?,
                r#type: r.get(1)?,
                name: r.get(2)?,
                description: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                notes: r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                path: r.get(5)?,
                url: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(hits)
}

// ── AI 助手（OpenAI 兼容，产出均为"建议"，应用由前端确认） ──

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgSuggestion {
    #[serde(default, alias = "item_id")]
    pub item_id: i64,
    #[serde(default)]
    pub action: String,
    #[serde(default, alias = "group_id")]
    pub group_id: Option<i64>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub reason: String,
    // ── 扩展动作字段 ──
    #[serde(default)]
    pub section: Option<String>,   // createGroup：目标板块
    #[serde(default, alias = "group_name")]
    pub group_name: Option<String>, // createGroup/moveGroup：按名称引用分组
    #[serde(default)]
    pub url: Option<String>,       // createGithubFav：仓库地址
}

const AI_ITEMS_CAP: usize = 150;

fn collect_library_json(conn: &rusqlite::Connection) -> Result<Value, String> {
    let mut stmt = conn
        .prepare(
            "SELECT i.id, i.type, i.name, i.description, c.name, i.url
             FROM items i LEFT JOIN categories c ON c.id = i.category_id
             WHERE i.archived = 0 ORDER BY i.type, i.name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let mut items: Vec<Value> = stmt
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "type": r.get::<_, String>(1)?,
                "name": r.get::<_, String>(2)?,
                "description": r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                "group": r.get::<_, Option<String>>(4)?,
                "url": r.get::<_, Option<String>>(5)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    items.truncate(AI_ITEMS_CAP);

    // 附上每个条目的标签（模型分组参考 + 缺分组名时的兜底依据）
    let mut tag_map: std::collections::HashMap<i64, Vec<String>> = std::collections::HashMap::new();
    {
        let mut tstmt = conn
            .prepare(
                "SELECT it.item_id, t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id
                 ORDER BY t.name COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;
        let pairs = tstmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        for pair in pairs.flatten() {
            tag_map.entry(pair.0).or_default().push(pair.1);
        }
    }
    for it in items.iter_mut() {
        if let Some(id) = it["id"].as_i64() {
            if let Some(tags) = tag_map.get(&id) {
                it["tags"] = json!(tags);
            }
        }
    }

    let mut cstmt = conn
        .prepare("SELECT id, section, name FROM categories ORDER BY section, sort")
        .map_err(|e| e.to_string())?;
    let groups: Vec<Value> = cstmt
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "section": r.get::<_, String>(1)?,
                "name": r.get::<_, String>(2)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // 标签只给全量名单做参考（避免 AI 造重复词）
    let mut tstmt = conn
        .prepare("SELECT name FROM tags ORDER BY name")
        .map_err(|e| e.to_string())?;
    let tags: Vec<String> = tstmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(json!({ "items": items, "groups": groups, "existingTags": tags }))
}

fn parse_suggestions(content: &str) -> Result<Vec<OrgSuggestion>, String> {
    let v = crate::ai::extract_json(content)?;
    let arr = v
        .get("suggestions")
        .and_then(|s| s.as_array())
        .ok_or("AI 回复缺少 suggestions 数组")?;
    let list: Vec<OrgSuggestion> = arr
        .iter()
        .take(100)
        .filter_map(|s| serde_json::from_value(s.clone()).ok())
        .filter(|s: &OrgSuggestion| s.item_id > 0 && !s.action.is_empty())
        .collect();
    Ok(list)
}

/// moveGroup 建议缺分组名时，自动发起一次小调用让 AI 补齐（按 itemId 对号，
/// 不用 index 避免模型 0/1 起始错位）；仍缺的用条目首个标签或类型名兜底。
/// 全程写前端日志，用户无需手填。
async fn repair_missing_group_names(
    app: &tauri::AppHandle,
    cfg: &crate::ai::AiConfig,
    library: &Value,
    sugs: &mut [OrgSuggestion],
) {
    let missing: Vec<Value> = sugs
        .iter()
        .filter(|s| {
            s.action == "moveGroup"
                && s.group_id.is_none()
                && s.group_name.as_deref().map_or(true, |g| g.trim().is_empty())
        })
        .map(|s| {
            let item = library["items"]
                .as_array()
                .and_then(|items| {
                    items
                        .iter()
                        .find(|it| it["id"].as_i64() == Some(s.item_id))
                        .cloned()
                })
                .unwrap_or(json!({}));
            json!({ "itemId": s.item_id, "item": item })
        })
        .collect();
    if missing.is_empty() {
        return;
    }
    let _ = tauri_ui_kit::append_frontend_log(
        app,
        format!("[ai-repair] 检测到 {} 条 moveGroup 缺分组名，自动补齐中…", missing.len()).as_str(),
    );
    let messages = json!([
        { "role": "system", "content": "你是项目整理助手。为每条 moveGroup 建议起一个合适的中文分组名（2-6 字，简短通用，如：App 系列、嵌入式、工具）。只输出 JSON：{\"fills\":[{\"itemId\":数字,\"groupName\":\"...\"}]}，itemId 必须与输入一致，每条都要有，不要遗漏。" },
        { "role": "user", "content": format!("条目库：{library}\n\n需要补分组名的建议：{}", json!(missing)) },
    ]);
    let reply = match crate::ai::chat(cfg, &messages, true).await {
        Ok(r) => r,
        Err(e) => {
            let _ = tauri_ui_kit::append_frontend_log(app, format!("[ai-repair] 补分组名调用失败: {e}").as_str());
            return;
        }
    };
    let v = match crate::ai::extract_json(&reply) {
        Ok(v) => v,
        Err(e) => {
            let _ = tauri_ui_kit::append_frontend_log(app, format!("[ai-repair] 回复解析失败: {e}｜原文: {reply}").as_str());
            return;
        }
    };
    let mut filled = 0usize;
    if let Some(fills) = v["fills"].as_array() {
        for f in fills {
            let Some(fid) = f["itemId"].as_i64() else { continue };
            let Some(gname) = f["groupName"]
                .as_str()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
            else {
                continue;
            };
            if let Some(s) = sugs.iter_mut().find(|s| s.item_id == fid) {
                s.group_name = Some(gname);
                filled += 1;
            }
        }
    }
    // 确定性兜底：AI 补齐后仍缺的，用条目首个标签（无标签则用类型名）当分组名——
    // 保证每条 moveGroup 都有 groupName，绝不把空分组建议交给用户
    let mut fallback = 0usize;
    for s in sugs.iter_mut() {
        if s.action != "moveGroup"
            || s.group_id.is_some()
            || s.group_name.as_deref().map_or(false, |g| !g.trim().is_empty())
        {
            continue;
        }
        let lib_item = library["items"]
            .as_array()
            .and_then(|items| {
                items
                    .iter()
                    .find(|it| it["id"].as_i64() == Some(s.item_id))
                    .cloned()
            })
            .unwrap_or(json!({}));
        let first_tag = lib_item["tags"]
            .as_array()
            .and_then(|t| t.first())
            .and_then(|t| t.as_str())
            .map(|s| s.to_string());
        let ttype = lib_item["type"].as_str().unwrap_or("code");
        let name = first_tag.unwrap_or_else(|| {
            match ttype {
                "docs" => "文档资料",
                "link" => "常用网址",
                "github" => "GitHub 收藏",
                _ => "我的项目",
            }
            .to_string()
        });
        let _ = tauri_ui_kit::append_frontend_log(
            app,
            format!("[ai-repair] 建议 #{itemId} 兜底分组名：{name}", itemId = s.item_id).as_str(),
        );
        s.group_name = Some(name);
        fallback += 1;
    }
    let _ = tauri_ui_kit::append_frontend_log(
        app,
        format!("[ai-repair] 完成：AI 补齐 {filled} 条，兜底 {fallback} 条").as_str(),
    );
}

fn prompt_for(conn: &rusqlite::Connection, key: &str, default: &str) -> String {
    read_setting(conn, key)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| default.to_string())
}

#[tauri::command]
pub async fn ai_test(db: State<'_, Db>) -> Result<String, String> {
    let cfg = crate::ai::load_config(&db)?;
    let messages = json!([{ "role": "user", "content": "请只回复两个字：正常" }]);
    crate::ai::chat(&cfg, &messages, false).await
}

/// 查看最近 20 次 AI 调用的原始对话（含请求与模型原话）
#[tauri::command]
pub fn ai_calls() -> Vec<Value> {
    crate::ai::get_calls()
}

/// ① 条目元数据补全：简介 + 标签 + 建议分组（返回建议，不落库）
#[tauri::command]
pub async fn ai_complete_item(db: State<'_, Db>, id: i64) -> Result<Value, String> {
    let cfg = crate::ai::load_config(&db)?;
    let (item_json, groups_json): (Value, Value) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let item = read_item_by_id(&conn, id)?;
        let group = conn
            .query_row(
                "SELECT name FROM categories WHERE id = ?1",
                params![item.category_id],
                |r| r.get::<_, String>(0),
            )
            .ok();
        let mut cstmt = conn
            .prepare("SELECT id, name FROM categories WHERE section = ?1 ORDER BY sort")
            .map_err(|e| e.to_string())?;
        let groups: Vec<Value> = cstmt
            .query_map(params![item.r#type], |r| {
                Ok(json!({ "id": r.get::<_, i64>(0)?, "name": r.get::<_, String>(1)? }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let item_json = json!({
            "type": item.r#type, "name": item.name, "path": item.path, "url": item.url,
            "description": item.description, "notes": item.notes, "currentGroup": group,
        });
        (item_json, json!(groups))
    };

    // 用读出来的（用户可在设置里改写的）提示词。
    // 原实现把它读出来却没用，改成硬编码了一条 system 消息 —— 结果是设置页里
    // "① 条目补全提示词"改了完全不生效。编译器那条 unused variable 警告
    // 就是这件事留在地上的痕迹。
    let sys_prompt = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        prompt_for(&conn, "ai_prompt_complete", crate::ai::COMPLETE_PROMPT)
    };
    let messages = json!([
        { "role": "system", "content": sys_prompt },
        { "role": "user", "content": format!("条目：{item_json}\n候选分组：{groups_json}") },
    ]);
    let reply = crate::ai::chat(&cfg, &messages, true).await?;
    let v = crate::ai::extract_json(&reply)?;
    Ok(json!({
        "description": v["description"].as_str().unwrap_or(""),
        "tags": v["tags"].as_array().cloned().unwrap_or_default(),
        "color": v["color"].as_str().map(|s| s.trim().to_string()).filter(|s| !s.is_empty() && s != "null"),
        "groupId": v["groupId"].as_i64(),
        "reason": v["reason"].as_str().unwrap_or(""),
    }))
}

/// ② 全库整理建议
#[tauri::command]
pub async fn ai_organize(app: tauri::AppHandle, db: State<'_, Db>) -> Result<Vec<OrgSuggestion>, String> {
    let cfg = crate::ai::load_config(&db)?;
    let (library, sys_prompt) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let lib = collect_library_json(&conn)?;
        let sys = prompt_for(&conn, "ai_prompt_organize", crate::ai::ORG_SYSTEM_PROMPT);
        (lib, sys)
    };
    let messages = json!([
        { "role": "system", "content": sys_prompt },
        { "role": "user", "content": format!("条目库：{library}\n请给出整理建议。") },
    ]);
    let reply = crate::ai::chat(&cfg, &messages, true).await?;
    let mut sugs = parse_suggestions(&reply)?;
    repair_missing_group_names(&app, &cfg, &library, &mut sugs).await;
    Ok(sugs)
}

/// ④ 自然语言指令 → 整理建议
#[tauri::command]
pub async fn ai_command(app: tauri::AppHandle, db: State<'_, Db>, text: String) -> Result<Vec<OrgSuggestion>, String> {
    if text.trim().is_empty() {
        return Err("指令为空".into());
    }
    let cfg = crate::ai::load_config(&db)?;
    let (library, sys_prompt) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let lib = collect_library_json(&conn)?;
        let sys = prompt_for(&conn, "ai_prompt_organize", crate::ai::ORG_SYSTEM_PROMPT);
        (lib, sys)
    };
    let messages = json!([
        { "role": "system", "content": sys_prompt },
        { "role": "user", "content": format!("条目库：{library}\n\n用户指令：{}", text.trim()) },
    ]);
    let reply = crate::ai::chat(&cfg, &messages, true).await?;
    let mut sugs = parse_suggestions(&reply)?;
    repair_missing_group_names(&app, &cfg, &library, &mut sugs).await;
    Ok(sugs)
}

/// ③ GitHub 收藏摘要：读本地化 README，产出简介 + 标签建议
#[tauri::command]
pub async fn ai_summarize_readme(db: State<'_, Db>, id: i64) -> Result<Value, String> {
    let cfg = crate::ai::load_config(&db)?;
    let (name, url, readme_path): (String, Option<String>, Option<String>) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT name, url, readme_path FROM items WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| "条目不存在".to_string())?
    };
    let path = readme_path.ok_or("该收藏还没有本地 README（先抓取或手动导入）")?;
    let content = std::fs::read_to_string(&path).map_err(|e| format!("读取 README 失败: {e}"))?;
    let chars: String = content.chars().take(8000).collect();
    let sys_prompt = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        prompt_for(&conn, "ai_prompt_summary", crate::ai::SUMMARY_PROMPT)
    };

    let messages = json!([
        { "role": "system", "content": sys_prompt },
        { "role": "user", "content": format!("仓库名：{name}\n地址：{url:?}\nREADME 内容（截断）：\n{chars}") },
    ]);
    let reply = crate::ai::chat(&cfg, &messages, true).await?;
    let v = crate::ai::extract_json(&reply)?;
    Ok(json!({
        "description": v["description"].as_str().unwrap_or(""),
        "tags": v["tags"].as_array().cloned().unwrap_or_default(),
        "reason": v["reason"].as_str().unwrap_or(""),
    }))
}

// ── AI 建议持久化 / 撤回 / 纯对话 ──

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSuggestionRow {
    pub id: i64,
    pub batch_id: String,
    pub source: String,
    pub item_id: i64,
    pub action: String,
    pub group_id: Option<i64>,
    pub tags: Vec<String>,
    pub description: Option<String>,
    pub name: Option<String>,
    pub reason: String,
    pub status: String,
    pub created_at: String,
    pub section: Option<String>,
    pub group_name: Option<String>,
    pub url: Option<String>,
}

fn row_to_sug(r: &rusqlite::Row) -> rusqlite::Result<AiSuggestionRow> {
    let tags_raw: String = r.get("tags")?;
    Ok(AiSuggestionRow {
        id: r.get("id")?,
        batch_id: r.get("batch_id")?,
        source: r.get("source")?,
        item_id: r.get("item_id")?,
        action: r.get("action")?,
        group_id: r.get("group_id")?,
        tags: serde_json::from_str(&tags_raw).unwrap_or_default(),
        description: r.get("description")?,
        name: r.get("name")?,
        reason: r.get::<_, Option<String>>("reason")?.unwrap_or_default(),
        status: r.get("status")?,
        created_at: r.get::<_, Option<String>>("created_at")?.unwrap_or_default(),
        section: r.get("section")?,
        group_name: r.get("group_name")?,
        url: r.get("url")?,
    })
}

/// 生成建议后由前端落库（status=pending），面板切换/重启后仍在
#[tauri::command]
pub fn ai_save_suggestions(
    db: State<Db>,
    batch_id: String,
    source: String,
    suggestions: Vec<OrgSuggestion>,
) -> Result<usize, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut n = 0usize;
    for s in suggestions.iter().take(200) {
        conn.execute(
            "INSERT INTO ai_suggestions(batch_id, source, item_id, action, group_id, tags,
                                        description, name, reason, section, group_name, url)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![
                batch_id, source, s.item_id, s.action, s.group_id,
                serde_json::to_string(&s.tags).unwrap_or_else(|_| "[]".into()),
                s.description, s.name, s.reason,
                s.section, s.group_name, s.url,
            ],
        )
        .map_err(|e| e.to_string())?;
        n += 1;
    }
    Ok(n)
}

#[tauri::command]
pub fn ai_list_suggestions(
    db: State<Db>,
    statuses: Option<Vec<String>>,
) -> Result<Vec<AiSuggestionRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let statuses = statuses.unwrap_or_else(|| {
        vec!["pending".into(), "applied".into(), "undone".into()]
    });
    let mut rows: Vec<AiSuggestionRow> = Vec::new();
    for s in &statuses {
        let mut stmt = conn
            .prepare("SELECT * FROM ai_suggestions WHERE status = ?1 ORDER BY id DESC LIMIT 200")
            .map_err(|e| e.to_string())?;
        let part = stmt
            .query_map(params![s], row_to_sug)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows.extend(part);
    }
    rows.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(rows)
}

/// 应用建议：先存修改前快照（可撤回），再执行动作。
/// 支持 moveGroup(按 id 或名称，名称不存在自动建组)/addTags/setDescription/
/// rename/pin(加入收藏夹)/createGroup(创建分组)/createGithubFav(新增 GitHub 收藏)。
#[tauri::command]
pub async fn ai_apply_suggestions(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    row_ids: Vec<i64>,
) -> Result<Value, String> {
    // 第一阶段：一次性读出待应用的建议行（锁只在同步段持有）
    let rows: Vec<(i64, Option<i64>, String, Option<i64>, String, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)> = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut list = Vec::new();
        for &row_id in &row_ids {
            let row = conn
                .query_row(
                    "SELECT item_id, action, group_id, tags, description, name, section, group_name, url
                     FROM ai_suggestions WHERE id = ?1 AND status = 'pending'",
                    params![row_id],
                    |r| {
                        Ok((
                            r.get::<_, Option<i64>>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, Option<i64>>(2)?,
                            r.get::<_, String>(3)?,
                            r.get::<_, Option<String>>(4)?,
                            r.get::<_, Option<String>>(5)?,
                            r.get::<_, Option<String>>(6)?,
                            r.get::<_, Option<String>>(7)?,
                            r.get::<_, Option<String>>(8)?,
                        ))
                    },
                )
                .map_err(|e| format!("建议 #{row_id} 不存在或已处理: {e}"))?;
            list.push((row_id, row.0, row.1, row.2, row.3, row.4, row.5, row.6, row.7, row.8));
        }
        list
    };

    // 第二阶段：逐条应用；坏条跳过并记录原因，绝不中断整批；每个动作各自加锁，绝不跨 await 持锁
    let mut applied = 0usize;
    let mut skipped = 0usize;
    let mut skip_reason = String::new();
    for (row_id, item_id, action, group_id, tags_raw, description, name, section, group_name, url) in rows {
        let before: Option<String>;
        let mut new_item_id: Option<i64> = None;

        // 单条失败时记原因、跳过、继续下一条
        macro_rules! skip_row {
            ($reason:expr) => {{
                skipped += 1;
                if skip_reason.is_empty() {
                    skip_reason = format!("建议 #{row_id}：{}", $reason);
                }
                let _ = tauri_ui_kit::append_frontend_log(
                    &app,
                    format!("[ai-apply] 跳过建议 #{row_id}（{action}）：{}", $reason).as_str(),
                );
                continue;
            }};
        }

        match action.as_str() {
            "createGroup" => {
                let Some(gname) = group_name
                    .clone()
                    .or_else(|| name.clone())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                else {
                    skip_row!("缺少分组名");
                };
                let sec = section.clone().unwrap_or_else(|| "code".into());
                if !ITEM_TYPES.contains(&sec.as_str()) {
                    skip_row!(format!("无效的板块 {sec}"));
                }
                let conn = db.0.lock().map_err(|e| e.to_string())?;
                let existing: Option<i64> = conn
                    .query_row(
                        "SELECT id FROM categories WHERE section = ?1 AND name = ?2",
                        params![sec, gname],
                        |r| r.get(0),
                    )
                    .ok();
                let gid = match existing {
                    Some(id) => id, // 同名分组直接复用
                    None => {
                        conn.execute(
                            "INSERT INTO categories(section, name) VALUES(?1, ?2)",
                            params![sec, gname],
                        )
                        .map_err(|e| e.to_string())?;
                        conn.last_insert_rowid()
                    }
                };
                conn.execute(
                    "UPDATE ai_suggestions SET group_id = ?1 WHERE id = ?2",
                    params![gid, row_id],
                )
                .map_err(|e| e.to_string())?;
                before = None;
            }
            "createGithubFav" => {
                let Some(u) = url else {
                    skip_row!("缺少仓库地址");
                };
                let item = match import_github_core(&app, &db, u, name.clone()).await {
                    Ok(it) => it,
                    Err(e) => skip_row!(format!("GitHub 导入失败: {e}")),
                };
                new_item_id = Some(item.id);
                let conn = db.0.lock().map_err(|e| e.to_string())?;
                conn.execute(
                    "UPDATE ai_suggestions SET before_json = NULL WHERE id = ?1",
                    params![row_id],
                )
                .map_err(|e| e.to_string())?;
                before = None;
            }
            _ => {
                let mut conn = db.0.lock().map_err(|e| e.to_string())?;
                let Ok(mut item) = conn
                    .query_row("SELECT * FROM items WHERE id = ?1", params![item_id], row_to_item)
                else {
                    skip_row!("条目不存在或已删除");
                };
                before = Some(serde_json::to_string(&item).map_err(|e| e.to_string())?);
                match action.as_str() {
                    "moveGroup" => {
                        let gid = match group_id {
                            Some(g) => g,
                            None => {
                                let Some(gname) = group_name
                                    .clone()
                                    .map(|s| s.trim().to_string())
                                    .filter(|s| !s.is_empty())
                                else {
                                    skip_row!("AI 未提供 groupId 或 groupName（可在卡片里手动填写分组名后重试）");
                                };
                                // 按名称找分组，没有就自动创建（板块跟随条目）
                                match conn.query_row(
                                    "SELECT id FROM categories WHERE section = ?1 AND name = ?2",
                                    params![item.r#type, gname],
                                    |r| r.get(0),
                                ) {
                                    Ok(id) => id,
                                    Err(_) => {
                                        conn.execute(
                                            "INSERT INTO categories(section, name) VALUES(?1, ?2)",
                                            params![item.r#type, gname],
                                        )
                                        .map_err(|e| e.to_string())?;
                                        conn.last_insert_rowid()
                                    }
                                }
                            }
                        };
                        let gsec: String = conn
                            .query_row("SELECT section FROM categories WHERE id = ?1", params![gid], |r| r.get(0))
                            .map_err(|e| e.to_string())?;
                        if gsec != item.r#type {
                            skip_row!(format!("目标分组与条目板块不符（{gsec} ≠ {}）", item.r#type));
                        }
                        item.category_id = Some(gid);
                    }
                    "addTags" => {
                        let new_tags: Vec<String> = serde_json::from_str(&tags_raw).unwrap_or_default();
                        let mut merged = item.tags.clone();
                        for t in new_tags {
                            let t = t.trim();
                            if !t.is_empty() && !merged.iter().any(|x| x.eq_ignore_ascii_case(t)) {
                                merged.push(t.to_string());
                            }
                        }
                        item.tags = merged;
                    }
                    "setDescription" => {
                        item.description = description.unwrap_or_default();
                    }
                    "rename" => {
                        let Some(n) = name else {
                            skip_row!("缺少新名称");
                        };
                        item.name = n;
                    }
                    "pin" => {
                        item.pinned = true;
                    }
                    _ => continue,
                }
                let input = ItemInput {
                    id: Some(item.id),
                    r#type: item.r#type.clone(),
                    name: item.name.clone(),
                    path: item.path.clone(),
                    url: item.url.clone(),
                    description: Some(item.description.clone()),
                    notes: Some(item.notes.clone()),
                    category_id: item.category_id,
                    pinned: Some(item.pinned),
                    archived: Some(item.archived),
                    color: item.color.clone(),
                    icon: item.icon.clone(),
                    tags: Some(item.tags.clone()),
                    readme_path: item.readme_path.clone(),
                    readme_ref: item.readme_ref.clone(),
                };
                if let Err(e) = upsert_item_inner(&mut conn, input) {
                    skip_row!(format!("保存失败: {e}"));
                }
            }
        }

        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE ai_suggestions SET status = 'applied', before_json = ?1, item_id = COALESCE(?2, item_id) WHERE id = ?3",
            params![before, new_item_id, row_id],
        )
        .map_err(|e| e.to_string())?;
        applied += 1;
    }
    Ok(json!({ "applied": applied, "skipped": skipped, "note": skip_reason }))
}

/// 撤回一条已应用的建议：恢复修改前快照；
/// createGroup 撤回=删除仍为空的分组；createGithubFav 撤回=删除导入的条目
#[tauri::command]
pub fn ai_undo_suggestion(db: State<Db>, row_id: i64) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let (status, before_json, action, item_id, group_id): (String, Option<String>, String, Option<i64>, Option<i64>) = conn
        .query_row(
            "SELECT status, before_json, action, item_id, group_id FROM ai_suggestions WHERE id = ?1",
            params![row_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|e| format!("记录不存在: {e}"))?;
    if status != "applied" {
        return Err("只有已应用的建议可以撤回".into());
    }
    match action.as_str() {
        "createGroup" => {
            let gid = group_id.ok_or("缺少分组 id，无法撤回")?;
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM items WHERE category_id = ?1",
                    params![gid],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if count > 0 {
                return Err("该分组下已有条目，无法撤回（可手动删除分组）".into());
            }
            conn.execute("DELETE FROM categories WHERE id = ?1", params![gid])
                .map_err(|e| e.to_string())?;
        }
        "createGithubFav" => {
            let iid = item_id.ok_or("缺少条目 id，无法撤回")?;
            conn.execute("DELETE FROM items WHERE id = ?1", params![iid])
                .map_err(|e| e.to_string())?;
        }
        _ => {
            let before = before_json.ok_or("缺少修改前快照，无法撤回")?;
            let item: Item = serde_json::from_str(&before).map_err(|e| format!("快照解析失败: {e}"))?;
            let input = ItemInput {
                id: Some(item.id),
                r#type: item.r#type.clone(),
                name: item.name.clone(),
                path: item.path.clone(),
                url: item.url.clone(),
                description: Some(item.description.clone()),
                notes: Some(item.notes.clone()),
                category_id: item.category_id,
                pinned: Some(item.pinned),
                archived: Some(item.archived),
                color: item.color.clone(),
                icon: item.icon.clone(),
                tags: Some(item.tags.clone()),
                readme_path: item.readme_path.clone(),
                readme_ref: item.readme_ref.clone(),
            };
            upsert_item_inner(&mut conn, input).map_err(|e| e.to_string())?;
        }
    }
    conn.execute(
        "UPDATE ai_suggestions SET status = 'undone' WHERE id = ?1",
        params![row_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 忽略/清除建议记录
#[tauri::command]
pub fn ai_discard_suggestions(db: State<Db>, row_ids: Vec<i64>) -> Result<usize, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut n = 0usize;
    for &row_id in &row_ids {
        n += conn
            .execute(
                "UPDATE ai_suggestions SET status = 'discarded' WHERE id = ?1",
                params![row_id],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(n)
}

/// 清空全部建议/处理记录
#[tauri::command]
pub fn ai_clear_suggestions(db: State<Db>) -> Result<usize, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let n = conn
        .execute("DELETE FROM ai_suggestions", [])
        .map_err(|e| e.to_string())?;
    Ok(n)
}

/// 用户手动为"AI 未指定分组"的建议补填分组名（应用前调用）
#[tauri::command]
pub fn ai_set_group_name(db: State<Db>, row_id: i64, group_name: String) -> Result<(), String> {
    let gname = group_name.trim().to_string();
    if gname.is_empty() {
        return Err("分组名不能为空".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE ai_suggestions SET group_name = ?1, group_id = NULL WHERE id = ?2",
        params![gname, row_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// ④ 纯对话 + 对话内修改建议：带条目库上下文；回复可携带 suggestions，
/// 由前端以卡片形式展示，用户确认后应用（走同一套持久化+撤回体系）。
#[tauri::command]
pub async fn ai_chat(app: tauri::AppHandle, db: State<'_, Db>, text: String) -> Result<Value, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("消息为空".into());
    }
    let cfg = crate::ai::load_config(&db)?;
    let (sys, history, library): (String, Vec<Value>, Value) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let base = prompt_for(&conn, "ai_prompt_chat", crate::ai::CHAT_PROMPT);
        let library = collect_library_json(&conn)?;
        let sys = format!("{base}\n\n当前条目库：{library}");
        let mut stmt = conn
            .prepare("SELECT role, content FROM ai_chat ORDER BY id DESC LIMIT 20")
            .map_err(|e| e.to_string())?;
        let mut hist: Vec<Value> = stmt
            .query_map([], |r| {
                Ok(json!({ "role": r.get::<_, String>(0)?, "content": r.get::<_, String>(1)? }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        hist.reverse();
        (sys, hist, library)
    };
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute("INSERT INTO ai_chat(role, content) VALUES('user', ?1)", params![text])
            .map_err(|e| e.to_string())?;
    }
    let mut messages = vec![json!({ "role": "system", "content": sys })];
    messages.extend(history);
    messages.push(json!({ "role": "user", "content": text }));
    let raw = crate::ai::chat(&cfg, &json!(messages), true).await?;

    // 解析 {"reply","suggestions"}；模型输出纯文本时整体视为 reply
    let (reply_text, sugs) = match crate::ai::extract_json(&raw) {
        Ok(v) if v.get("reply").is_some() => {
            let reply_text = v["reply"].as_str().unwrap_or("").to_string();
            let sugs: Vec<OrgSuggestion> = v["suggestions"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|s| serde_json::from_value(s.clone()).ok())
                        .filter(|s: &OrgSuggestion| s.item_id > 0 && !s.action.is_empty())
                        .take(50)
                        .collect()
                })
                .unwrap_or_default();
            (reply_text, sugs)
        }
        _ => (raw.clone(), Vec::new()),
    };
    // moveGroup 缺分组名时让 AI 自动补齐，用户无需手填
    let mut sugs = sugs;
    repair_missing_group_names(&app, &cfg, &library, &mut sugs).await;
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO ai_chat(role, content) VALUES('assistant', ?1)",
            params![reply_text],
        )
        .map_err(|e| e.to_string())?;
    }

    // 建议落库（source=chat），读回带 id 的行给前端做应用/忽略
    let saved_rows: Vec<AiSuggestionRow> = if sugs.is_empty() {
        Vec::new()
    } else {
        let batch = format!(
            "chat-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        );
        let rows: Vec<AiSuggestionRow> = {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            for s in &sugs {
                conn.execute(
                    "INSERT INTO ai_suggestions(batch_id, source, item_id, action, group_id, tags,
                                                description, name, reason, section, group_name, url)
                     VALUES(?1,'chat',?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                    params![
                        batch, s.item_id, s.action, s.group_id,
                        serde_json::to_string(&s.tags).unwrap_or_else(|_| "[]".into()),
                        s.description, s.name, s.reason,
                        s.section, s.group_name, s.url,
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
            let mut stmt = conn
                .prepare("SELECT * FROM ai_suggestions WHERE batch_id = ?1 ORDER BY id")
                .map_err(|e| e.to_string())?;
            let mapped = stmt
                .query_map(params![batch], row_to_sug)
                .map_err(|e| e.to_string())?;
            let v: Vec<AiSuggestionRow> = mapped
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            v
        };
        rows
    };

    Ok(json!({ "reply": reply_text, "suggestions": saved_rows }))
}

#[tauri::command]
pub fn ai_chat_history(db: State<Db>) -> Result<Vec<Value>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT role, content, created_at FROM ai_chat ORDER BY id ASC LIMIT 200")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({
                "role": r.get::<_, String>(0)?,
                "content": r.get::<_, String>(1)?,
                "createdAt": r.get::<_, Option<String>>(2)?.unwrap_or_default(),
            }))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn ai_chat_clear(db: State<Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM ai_chat", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 查看/修改系统提示词：prompts 为当前生效值，defaults 为内置默认
#[tauri::command]
pub fn ai_get_prompts(db: State<Db>) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let p = |key: &str, d: &str| prompt_for(&conn, key, d);
    Ok(json!({
        "prompts": {
            "complete": p("ai_prompt_complete", crate::ai::COMPLETE_PROMPT),
            "organize": p("ai_prompt_organize", crate::ai::ORG_SYSTEM_PROMPT),
            "summary": p("ai_prompt_summary", crate::ai::SUMMARY_PROMPT),
            "chat": p("ai_prompt_chat", crate::ai::CHAT_PROMPT),
        },
        "defaults": {
            "complete": crate::ai::COMPLETE_PROMPT,
            "organize": crate::ai::ORG_SYSTEM_PROMPT,
            "summary": crate::ai::SUMMARY_PROMPT,
            "chat": crate::ai::CHAT_PROMPT,
        }
    }))
}

// ── 备份导入/导出 ──

/// 备份里敏感设置的占位符。见 export_data / import_data。
const REDACTED: &str = "__REDACTED__";

/// 哪些设置属于"不该跟着备份文件走"的凭据。
/// 宁可多判几个：漏判的后果是密钥被拷到别处，误判的后果只是重填一次。
fn is_secret_key(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    k.contains("api_key")
        || k.contains("apikey")
        || k.ends_with("_key")
        || k.contains("token")
        || k.contains("secret")
        || k.contains("password")
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Backup {
    version: u32,
    exported_at: String,
    items: Vec<Item>,
    categories: Vec<Category>,
    tags: Vec<Tag>,
    item_tags: Vec<(i64, i64)>,
    settings: Vec<(String, String)>,
}

#[tauri::command]
pub fn export_data(db: State<Db>, path: String, at: Option<String>) -> Result<usize, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let items: Vec<Item> = {
        let mut stmt = conn.prepare("SELECT * FROM items ORDER BY id").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], row_to_item).map_err(|e| e.to_string())?;
        let v: Vec<Item> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        v
    };
    let categories: Vec<Category> = {
        let mut stmt = conn
            .prepare("SELECT id, section, name, parent_id, sort FROM categories ORDER BY id")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], row_to_category).map_err(|e| e.to_string())?;
        let v: Vec<Category> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        v
    };
    let tags: Vec<Tag> = {
        let mut stmt = conn.prepare("SELECT id, name, color FROM tags ORDER BY id").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok(Tag { id: r.get(0)?, name: r.get(1)?, color: r.get(2)? }))
            .map_err(|e| e.to_string())?;
        let v: Vec<Tag> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        v
    };
    let item_tags: Vec<(i64, i64)> = {
        let mut stmt = conn.prepare("SELECT item_id, tag_id FROM item_tags").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?;
        let v: Vec<(i64, i64)> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        v
    };
    // 备份文件可能被拷到别处、贴给人看、丢进网盘，而 settings 里存着 AI 的
    // API Key。所以导出时把密钥类设置换成占位符 —— 设置页写的是"仅存本地"，
    // 导出成明文就与这句话矛盾了。导入时遇到占位符会跳过，保留本机原值。
    let settings: Vec<(String, String)> = {
        let mut stmt = conn.prepare("SELECT key, value FROM settings").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| {
            let k: String = r.get(0)?;
            let v: String = r.get(1)?;
            Ok((k, v))
        }).map_err(|e| e.to_string())?;
        let v: Vec<(String, String)> = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|(k, val)| {
                if is_secret_key(&k) { (k, REDACTED.to_string()) } else { (k, val) }
            })
            .collect();
        v
    };

    let backup = Backup {
        version: 1,
        exported_at: at.unwrap_or_default(),
        items,
        categories,
        tags,
        item_tags,
        settings,
    };
    let count = backup.items.len();
    let json = serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("写入备份失败: {e}"))?;
    Ok(count)
}

#[tauri::command]
pub fn import_data(db: State<Db>, path: String) -> Result<usize, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| format!("读取备份失败: {e}"))?;
    let backup: Backup = serde_json::from_str(&text).map_err(|e| format!("备份格式无效: {e}"))?;

    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM item_tags", []).ok();
    tx.execute("DELETE FROM open_history", []).ok();
    tx.execute("DELETE FROM items", []).ok();
    tx.execute("DELETE FROM categories", []).ok();
    tx.execute("DELETE FROM tags", []).ok();
    // AI 建议与对话也要清：建议行带着导出时那套 item_id，导入后 id 会重新落到
    // 别的条目上，用户点"应用"就会改错东西。对话记录同理（它的上下文是旧库）。
    tx.execute("DELETE FROM ai_suggestions", []).ok();
    tx.execute("DELETE FROM ai_chat", []).ok();
    // 注意这里**不删 settings**：备份里的密钥是占位符，删掉就等于把本机
    // 已配好的 API Key 抹了。改成下面按条 upsert，本机独有/敏感的项得以保留。

    for it in &backup.items {
        tx.execute(
            "INSERT INTO items(id, type, name, path, url, description, notes, readme_path,
                               readme_ref, category_id, pinned, archived, color, icon,
                               open_count, last_opened_at, created_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
            params![
                it.id, it.r#type, it.name, it.path, it.url, it.description, it.notes,
                it.readme_path, it.readme_ref, it.category_id,
                it.pinned as i64, it.archived as i64,
                it.color, it.icon, it.open_count, it.last_opened_at, it.created_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    for c in &backup.categories {
        tx.execute(
            "INSERT INTO categories(id, section, name, parent_id, sort) VALUES(?1,?2,?3,?4,?5)",
            params![c.id, c.section, c.name, c.parent_id, c.sort],
        )
        .map_err(|e| e.to_string())?;
    }
    for t in &backup.tags {
        tx.execute(
            "INSERT INTO tags(id, name, color) VALUES(?1,?2,?3)",
            params![t.id, t.name, t.color],
        )
        .map_err(|e| e.to_string())?;
    }
    for (item_id, tag_id) in &backup.item_tags {
        tx.execute(
            "INSERT OR IGNORE INTO item_tags(item_id, tag_id) VALUES(?1,?2)",
            params![item_id, tag_id],
        )
        .map_err(|e| e.to_string())?;
    }
    for (k, v) in &backup.settings {
        // 占位符说明这是导出时被脱敏的凭据，跳过，保留本机当前值
        if v == REDACTED {
            continue;
        }
        tx.execute(
            "INSERT INTO settings(key, value) VALUES(?1,?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![k, v],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(backup.items.len())
}

// ── 目录扫描批量导入 ──

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredRepo {
    pub path: String,
    pub name: String,
}

/// 递归发现含 .git 的仓库目录（默认 3 层深，跳过 node_modules / target / 隐藏目录等）。
/// 嵌套仓库只保留最浅一层。
#[tauri::command]
pub fn scan_directory(root: String, max_depth: Option<u32>) -> Result<Vec<DiscoveredRepo>, String> {
    if !std::path::Path::new(&root).is_dir() {
        return Err("目录不存在".into());
    }
    let depth = max_depth.unwrap_or(3).clamp(1, 8);
    let skip = |name: &str| {
        name.starts_with('.')
            || matches!(name, "node_modules" | "target" | "dist" | "build" | "out" | "__pycache__")
    };
    let mut found: Vec<DiscoveredRepo> = Vec::new();
    for entry in walkdir::WalkDir::new(&root)
        .max_depth(depth as usize)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            e.depth() == 0 || !skip(&name)
        })
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_dir() {
            continue;
        }
        if entry.path().join(".git").exists() {
            found.push(DiscoveredRepo {
                path: entry.path().to_string_lossy().to_string(),
                name: entry.file_name().to_string_lossy().to_string(),
            });
        }
    }
    // 嵌套去重：A 仓库里的 B 仓库不重复报（保最浅）
    found.sort_by(|a, b| a.path.cmp(&b.path));
    let all_paths: Vec<String> = found.iter().map(|f| f.path.clone()).collect();
    found.retain(|f| {
        !all_paths
            .iter()
            .any(|other| other != &f.path && f.path.starts_with(&format!("{}\\", other)))
    });
    Ok(found)
}

// ── GitHub 收藏（导入式，不走 API） ──

fn assets_dir(app: &tauri::AppHandle, owner: &str, repo: &str) -> Result<std::path::PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取数据目录: {e}"))?;
    Ok(base.join("github_assets").join(format!("{owner}_{repo}")))
}

/// 抓取 + 图片本地化 + 建条目的公共流程（命令与 AI 建议共用）
async fn import_github_core(
    app: &tauri::AppHandle,
    db: &Db,
    url: String,
    name: Option<String>,
) -> Result<Item, String> {
    let fetched = crate::github_fetch::fetch_repo(app, &url).await?;
    let dir = assets_dir(app, &fetched.owner, &fetched.repo)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建资产目录失败: {e}"))?;
    let c = crate::github_fetch::client()?;
    let (content, ok, fail) = crate::github_fetch::localize_images(
        app, &c, &dir, &fetched.content, &fetched.owner, &fetched.repo, &fetched.branch,
    )
    .await;
    std::fs::write(dir.join("README.md"), &content)
        .map_err(|e| format!("写入 README 失败: {e}"))?;

    let display_name = name
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("{}/{}", fetched.owner, fetched.repo));
    let input = ItemInput {
        id: None,
        r#type: "github".into(),
        name: display_name,
        path: None,
        url: Some(format!("https://github.com/{}/{}", fetched.owner, fetched.repo)),
        description: Some(format!("GitHub 收藏 · 图片本地化 {ok} 张（失败 {fail} 张保留原链接）")),
        notes: Some(String::new()),
        category_id: None,
        pinned: Some(false),
        archived: Some(false),
        color: None,
        icon: Some("github".into()),
        tags: Some(Vec::new()),
        readme_path: Some(dir.join("README.md").to_string_lossy().to_string()),
        readme_ref: Some(format!("{}/{}", fetched.branch, fetched.file_name)),
    };
    let id = {
        let mut conn = db.0.lock().map_err(|e| e.to_string())?;
        upsert_item_inner(&mut conn, input)?
    };
    let item = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        read_item_by_id(&conn, id)?
    };
    Ok(item)
}

/// 粘贴仓库地址 → 抓 README + 图片本地化 → 生成收藏条目
#[tauri::command]
pub async fn import_github_repo(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    url: String,
    name: Option<String>,
) -> Result<Item, String> {
    import_github_core(&app, &db, url, name).await
}

/// 重新抓取：清空资产目录后重跑一遍（图片链接以最新 README 为准）
#[tauri::command]
pub async fn refresh_github_repo(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    id: i64,
) -> Result<Item, String> {
    let url = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row("SELECT url FROM items WHERE id = ?1", params![id], |r| {
            r.get::<_, Option<String>>(0)
        })
        .map_err(|_| "条目不存在".to_string())?
    };
    let url = url.ok_or("该条目没有仓库地址")?;

    let fetched = crate::github_fetch::fetch_repo(&app, &url).await?;
    let dir = assets_dir(&app, &fetched.owner, &fetched.repo)?;
    if dir.exists() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let c = crate::github_fetch::client()?;
    let (content, ok, fail) = crate::github_fetch::localize_images(
        &app, &c, &dir, &fetched.content, &fetched.owner, &fetched.repo, &fetched.branch,
    )
    .await;
    std::fs::write(dir.join("README.md"), &content)
        .map_err(|e| format!("写入 README 失败: {e}"))?;

    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE items SET readme_path = ?1, readme_ref = ?2, description = ?3 WHERE id = ?4",
            params![
                dir.join("README.md").to_string_lossy(),
                format!("{}/{}", fetched.branch, fetched.file_name),
                format!("GitHub 收藏 · 图片本地化 {ok} 张（失败 {fail} 张保留原链接）"),
                id,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    let item = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        read_item_by_id(&conn, id)?
    };
    Ok(item)
}

/// 手动导入：把本地 README 文件复制进资产目录（私有仓库的兜底路径）
#[tauri::command]
pub fn import_readme_manual(
    app: tauri::AppHandle,
    db: State<Db>,
    id: i64,
    file: String,
) -> Result<Item, String> {
    let (url, name): (Option<String>, String) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row("SELECT url, name FROM items WHERE id = ?1", params![id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|_| "条目不存在".to_string())?
    };
    // 资产目录：URL 可解析就用 owner_repo，否则用条目名清理后充当
    let key = url
        .as_deref()
        .and_then(|u| crate::github_fetch::parse_repo_url(u).ok())
        .map(|(o, r)| format!("{o}_{r}"))
        .unwrap_or_else(|| {
            let mut s: String = name
                .chars()
                .map(|c| {
                    if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' {
                        c
                    } else {
                        '_'
                    }
                })
                .collect();
            if s.is_empty() {
                s = "manual".into();
            }
            s
        });
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取数据目录: {e}"))?;
    let dir = base.join("github_assets").join(key);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::copy(&file, dir.join("README.md"))
        .map_err(|e| format!("复制失败: {e}"))?;

    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE items SET readme_path = ?1, readme_ref = '手动导入' WHERE id = ?2",
            params![dir.join("README.md").to_string_lossy(), id],
        )
        .map_err(|e| e.to_string())?;
    }
    let item = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        read_item_by_id(&conn, id)?
    };
    Ok(item)
}
