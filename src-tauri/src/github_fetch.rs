// ─────────────────────────────────────────────────────────────
// ProjectHub / github_fetch.rs —— GitHub 收藏的抓取与本地化
// 不走 GitHub API、不要 token：raw.githubusercontent.com 直连探测
// README（HEAD / main / master × 常见文件名），图片下载到本地资产
// 目录，Markdown 内地址重写为本地相对路径。reqwest 走系统代理。
// ─────────────────────────────────────────────────────────────
use regex::Regex;
use serde_json::json;
use tauri::{AppHandle, Emitter};

pub struct FetchedRepo {
    pub owner: String,
    pub repo: String,
    pub branch: String,
    pub file_name: String,
    pub content: String,
}

const README_NAMES: [&str; 9] = [
    // 中文版本优先：命中任意中文变体就用它，没有再回落英文 README.md
    "README.zh-CN.md",
    "README.zh.md",
    "README_zh-CN.md",
    "README_zh.md",
    "README.zh-Hans.md",
    "README.md",
    "readme.md",
    "Readme.md",
    "README.en.md",
];
const BRANCHES: [&str; 3] = ["HEAD", "main", "master"];
const MAX_IMAGES: usize = 30;
const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
/// 单次导入的图片总字节上限。单张 5 MB × 30 张能到 150 MB，
/// 而这些图只是给条目当配图看，不值得占掉这些磁盘与流量。
const MAX_TOTAL_BYTES: usize = 30 * 1024 * 1024;

/// 解析 github.com/{owner}/{repo}（兼容带协议、www、.git、多余路径）
pub fn parse_repo_url(url: &str) -> Result<(String, String), String> {
    let u = url.trim().trim_end_matches('/');
    let u = u
        .strip_prefix("https://")
        .or_else(|| u.strip_prefix("http://"))
        .unwrap_or(u);
    let u = u.strip_prefix("www.").unwrap_or(u);
    let mut parts = u.split('/').filter(|s| !s.is_empty());
    let host = parts.next().ok_or("地址为空")?;
    if host != "github.com" {
        return Err("目前仅支持 github.com 仓库地址".into());
    }
    let owner = parts.next().ok_or("地址不完整：缺少 owner")?;
    let repo = parts.next().ok_or("地址不完整：缺少仓库名")?;
    let repo = repo.strip_suffix(".git").unwrap_or(repo);
    if owner.is_empty() || repo.is_empty() {
        return Err("地址不完整".into());
    }
    Ok((owner.to_string(), repo.to_string()))
}

pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("ProjectHub/0.1")
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败: {e}"))
}

fn emit(app: &AppHandle, message: &str) {
    let _ = app.emit("github-import", json!({ "message": message }));
}

/// 依次探测 raw 地址，命中即下载内容
pub async fn fetch_repo(app: &AppHandle, url: &str) -> Result<FetchedRepo, String> {
    let (owner, repo) = parse_repo_url(url)?;
    let c = client()?;
    emit(app, "开始探测 README（HEAD / main / master × 常见文件名）…");
    for branch in BRANCHES {
        for name in README_NAMES {
            let raw = format!("https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{name}");
            let resp = match c.get(&raw).send().await {
                Ok(r) => r,
                Err(_) => continue,
            };
            if !resp.status().is_success() {
                continue;
            }
            // 直接复用这一次响应的 body。
            // 原实现是先 GET 一次只看状态码（把整份 README 下下来丢掉），
            // 命中之后再 GET 一次取内容 —— 每个候选都要多传一整份 body。
            let content = resp
                .text()
                .await
                .map_err(|e| format!("解码失败: {e}"))?;
            emit(app, &format!("命中 {branch}/{name}（{} KB）", content.len() / 1024));
            return Ok(FetchedRepo {
                owner,
                repo,
                branch: branch.to_string(),
                file_name: name.to_string(),
                content,
            });
        }
    }
    Err("未找到 README：仓库可能是私有库 / 地址有误 / 代理未生效。可改用手动导入本地 README 文件。".into())
}

/// 收集 README 里的图片引用（Markdown 内联 + <img> 标签）。
/// 返回（原始引用, 补全后的 raw 绝对地址）——替换时要锚定原始引用，
/// 否则相对路径的引用不会被重写。去重、跳过 data:。
fn collect_images(md: &str, owner: &str, repo: &str, branch: &str) -> Vec<(String, String)> {
    let mut refs: Vec<String> = Vec::new();
    {
        let mut push = |s: &str| {
            let s = s.trim();
            if s.is_empty() || s.starts_with("data:") {
                return;
            }
            if !refs.iter().any(|r| r == s) {
                refs.push(s.to_string());
            }
        };
        if let Ok(re) = Regex::new(r"!\[[^\]]*\]\(\s*([^\s)]+)[^)]*\)") {
            for cap in re.captures_iter(md) {
                if let Some(m) = cap.get(1) {
                    push(m.as_str());
                }
            }
        }
        if let Ok(re) = Regex::new(r#"<img[^>]+src=["']([^"']+)["']"#) {
            for cap in re.captures_iter(md) {
                if let Some(m) = cap.get(1) {
                    push(m.as_str());
                }
            }
        }
    }
    refs.into_iter()
        .map(|r| {
            let abs = if r.starts_with("http://") || r.starts_with("https://") {
                r.clone()
            } else if let Some(stripped) = r.strip_prefix('/') {
                format!("https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{stripped}")
            } else {
                let rel = r.trim_start_matches("./");
                format!("https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{rel}")
            };
            (r, abs)
        })
        .collect()
}

/// 清理 URL 尾段为安全文件名主干（不含扩展名）
fn sanitize_stem(url: &str, idx: usize) -> String {
    let tail = url.split(['?', '#']).next().unwrap_or("");
    let tail = tail.rsplit('/').next().unwrap_or("");
    let mut s: String = tail
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if s.is_empty() || s == "_" {
        s = format!("img{idx:02}");
    }
    // 尾部已带图片扩展名的去掉，统一由内容嗅探决定
    let lower = s.to_lowercase();
    for e in [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"] {
        if lower.ends_with(e) {
            s.truncate(s.len() - e.len());
            break;
        }
    }
    s
}

/// 按文件字节嗅探真实图片格式（shields 等服务常返回 SVG 但 URL 带 .png）
fn sniff_ext(bytes: &[u8], url: &str) -> String {
    if bytes.starts_with(b"\x89PNG") {
        return "png".into();
    }
    if bytes.starts_with(b"\xFF\xD8\xFF") {
        return "jpg".into();
    }
    if bytes.starts_with(b"GIF8") {
        return "gif".into();
    }
    if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return "webp".into();
    }
    let head = bytes
        .iter()
        .take(256)
        .copied()
        .skip_while(|b| b.is_ascii_whitespace())
        .collect::<Vec<u8>>();
    if head.starts_with(b"<svg") || head.starts_with(b"<?xml") {
        return "svg".into();
    }
    // 未知格式：沿用 URL 里的扩展名（若有）
    let tail = url.split(['?', '#']).next().unwrap_or("");
    let e = tail.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    if matches!(e.as_str(), "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp") {
        return if e == "jpeg" { "jpg".into() } else { e };
    }
    "png".into()
}

/// 把一处图片引用改成本地文件名，只改"确实在引用图片"的位置。
///
/// 原实现是 `content.replace(orig, fname)` 全局替换：只要正文里出现过同样的
/// 字符串（例如代码块里贴了同一段 URL、或 alt 文本恰好一样），就会被一起改掉。
/// 这里只认 Markdown 图片语法 `](url` 与 <img src="url"> 三种锚点。
fn rewrite_image_ref(md: &str, orig: &str, fname: &str) -> Option<String> {
    let mut out = md.to_string();
    let mut changed = false;
    let needles = [
        (format!("]({orig}"), format!("]({fname}")),
        (format!("src=\"{orig}\""), format!("src=\"{fname}\"")),
        (format!("src='{orig}'"), format!("src='{fname}'")),
    ];
    for (from, to) in &needles {
        if out.contains(from.as_str()) {
            out = out.replace(from.as_str(), to.as_str());
            changed = true;
        }
    }
    if changed { Some(out) } else { None }
}

/// 下载图片到 dir，返回（重写后的 markdown，成功数，失败数）。
/// 替换锚定图片语法；失败者保留原链接（在线兜底）。
pub async fn localize_images(
    app: &AppHandle,
    c: &reqwest::Client,
    dir: &std::path::Path,
    md: &str,
    owner: &str,
    repo: &str,
    branch: &str,
) -> (String, usize, usize) {
    let urls = collect_images(md, owner, repo, branch);
    let total = urls.len().min(MAX_IMAGES);
    if total == 0 {
        return (md.to_string(), 0, 0);
    }
    emit(app, &format!("发现 {total} 张图片，下载到本地…"));
    let mut content = md.to_string();
    let (mut ok, mut fail) = (0usize, 0usize);
    let mut total_bytes = 0usize;
    let mut capped_logged = false;
    for (i, (orig, url)) in urls.iter().take(MAX_IMAGES).enumerate() {
        if total_bytes >= MAX_TOTAL_BYTES {
            fail += 1;
            if !capped_logged {
                capped_logged = true;
                let mb = MAX_TOTAL_BYTES / (1024 * 1024);
                emit(app, &format!("已达总量上限 {mb} MB，其余图片保留在线链接"));
            }
            continue;
        }
        let mut saved = false;
        if let Ok(resp) = c.get(url).send().await {
            if resp.status().is_success() {
                if let Ok(bytes) = resp.bytes().await {
                    if bytes.len() <= MAX_IMAGE_BYTES {
                        let fname =
                            format!("img{i:02}_{}.{ext}", sanitize_stem(url, i), ext = sniff_ext(&bytes, url));
                        if std::fs::write(dir.join(&fname), &bytes).is_ok() {
                            // 锚定图片语法替换（相对/绝对引用都能覆盖）
                            match rewrite_image_ref(&content, orig.as_str(), &fname) {
                                Some(next) => {
                                    content = next;
                                    total_bytes += bytes.len();
                                    saved = true;
                                }
                                // 文件写成功了但正文里找不到可锚定的引用位置：
                                // 记失败，免得报"本地化成功"却看不见图
                                None => saved = false,
                            }
                        }
                    }
                }
            }
        }
        if saved {
            ok += 1;
            emit(app, &format!("图片 {}/{}：已本地化", i + 1, total));
        } else {
            fail += 1;
            emit(app, &format!("图片 {}/{}：下载失败（保留原链接）", i + 1, total));
        }
    }
    (content, ok, fail)
}
