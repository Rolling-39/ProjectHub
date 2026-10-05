// ─────────────────────────────────────────────────────────────
// ProjectHub / ai.rs —— AI 调用层（OpenAI 兼容 chat/completions）
// 用户在设置里配 Base URL + API Key + 模型名（DeepSeek/智谱/Kimi/
// OpenAI/本地 Ollama 等同一协议），Rust 只做一次 POST + JSON 提取。
// 所有 AI 产出都是"建议"，应用与否由前端人工确认。
// ─────────────────────────────────────────────────────────────
use serde_json::{json, Value};
use std::sync::Mutex;

/// 最近 20 次 AI 调用的原始对话（请求消息 + 模型原话），供前端查看
static CALLS: Mutex<Vec<Value>> = Mutex::new(Vec::new());

fn record_call(cfg: &AiConfig, messages: &Value, reply: &Result<String, String>) {
    let entry = json!({
        "ts": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        "model": cfg.model,
        "messages": messages,
        "reply": reply.as_deref().unwrap_or("（调用失败，见错误提示）"),
        "ok": reply.is_ok(),
    });
    if let Ok(mut v) = CALLS.lock() {
        v.push(entry);
        let len = v.len();
        if len > 20 {
            v.drain(0..len - 20);
        }
    }
}

pub fn get_calls() -> Vec<Value> {
    CALLS.lock().map(|v| v.clone()).unwrap_or_default()
}

pub struct AiConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

pub fn load_config(db: &crate::store::Db) -> Result<AiConfig, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let get = |k: &str| crate::commands::read_setting(&conn, k);
    let base_url = get("ai_base_url").filter(|s| !s.trim().is_empty());
    let api_key = get("ai_api_key").filter(|s| !s.trim().is_empty());
    let model = get("ai_model").filter(|s| !s.trim().is_empty());
    match (base_url, api_key, model) {
        (Some(b), Some(k), Some(m)) => Ok(AiConfig {
            base_url: b.trim().trim_end_matches('/').to_string(),
            api_key: k,
            model: m,
        }),
        _ => Err("请先在设置里配置 AI 的 Base URL、API Key 和模型名".into()),
    }
}

async fn chat_once(cfg: &AiConfig, messages: &Value, json_mode: bool) -> Result<(u16, String), String> {
    let url = format!("{}/chat/completions", cfg.base_url);
    let mut body = json!({ "model": cfg.model, "messages": messages, "temperature": 0.3 });
    if json_mode {
        body["response_format"] = json!({ "type": "json_object" });
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败: {e}"))?;
    let resp = client
        .post(&url)
        .bearer_auth(&cfg.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败（检查 Base URL / 网络 / 代理）: {e}"))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    Ok((status, text))
}

/// 调一次对话，返回首条回复文本。json_mode=true 时带 response_format，
/// 遇到不支持该字段的服务（400/422）自动降级重试。
pub async fn chat(cfg: &AiConfig, messages: &Value, json_mode: bool) -> Result<String, String> {
    let result = match chat_once(cfg, messages, json_mode).await {
        Ok((status, _text)) if json_mode && (status == 400 || status == 422) => {
            // 部分 OpenAI 兼容服务不支持 response_format，降级重试
            match chat_once(cfg, messages, false).await {
                Ok((s2, t2)) => parse_reply(s2, &t2),
                Err(e) => Err(e),
            }
        }
        Ok((status, text)) => parse_reply(status, &text),
        Err(e) => Err(e),
    };
    record_call(cfg, messages, &result);
    result
}

fn parse_reply(status: u16, text: &str) -> Result<String, String> {
    if !(200..300).contains(&status) {
        let snippet: String = text.chars().take(300).collect();
        return Err(format!("AI 接口返回 {status}：{snippet}"));
    }
    let v: Value = serde_json::from_str(text).map_err(|e| format!("响应不是合法 JSON: {e}"))?;
    v["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "响应缺少 choices[0].message.content".into())
}

/// 模型偶尔无视 json_mode 输出 ```json 围栏或前后缀说明，这里兜底提取
pub fn extract_json(content: &str) -> Result<Value, String> {
    let t = content.trim();
    let t = t
        .strip_prefix("```json")
        .or_else(|| t.strip_prefix("```"))
        .unwrap_or(t);
    let t = t.strip_suffix("```").unwrap_or(t).trim();
    let start = t.find('{').ok_or("AI 回复里没有 JSON")?;
    let end = t.rfind('}').ok_or("AI 回复里没有 JSON")?;
    serde_json::from_str(&t[start..=end]).map_err(|e| format!("AI 回复 JSON 解析失败: {e}"))
}

pub const ORG_SYSTEM_PROMPT: &str = r#"你是个人项目管理工具的整理助手。工具里有四类条目：code(本地代码项目)、docs(资料目录)、link(网址)、github(GitHub 收藏)。
分析用户提供的条目库和指令，输出整理建议。只输出 JSON，不要 markdown 代码块，格式：
{"suggestions":[{"itemId":数字,"action":"动作名","groupId":数字或null,"tags":["要新增的标签"],"description":"新简介或null","name":"新名称或null","reason":"一句话中文理由","section":"板块名或null","groupName":"分组名或null","url":"仓库地址或null"}]}
可用动作：
1. moveGroup：移动条目到分组。groupId 直接给 id；若要移入的分组还不存在，可不填 groupId 而填 groupName（会自动创建该分组）；
2. addTags：新增标签，会与现有标签合并，不要重复已有标签；
3. setDescription：补全/修改简介；
4. rename：重命名；
5. pin：把条目加入收藏夹（置顶收藏）；
6. createGroup：创建新分组，groupName 必填，section 填 code/docs/link/github 之一（没有 itemId 时必填）；
7. createGithubFav：新增 GitHub 收藏，url 必填（github.com/owner/repo），name 可选作备注名；会自动抓取该仓库的 README。
分组字段用法（最重要）：分组已存在 → 只填 groupId；分组可能不存在 → **只填 groupName，不要填 groupId**；两个字段都必须落在一个建议里，绝不允许 groupId 和 groupName 都为空的 moveGroup。
示例——把条目 12 移入名为"嵌入式"的分组（无论该分组是否存在，一律这样写）：
{"itemId":12,"action":"moveGroup","groupName":"嵌入式","reason":"esp32 相关，归入嵌入式"}
示例——创建名为"学习"的文档分组并把条目 8 移进去（两条建议）：
{"itemId":null,"action":"createGroup","groupName":"学习","section":"docs","reason":"收纳资料目录"}
{"itemId":8,"action":"moveGroup","groupName":"学习","reason":"归入新建的学习分组"}
其他规则：
- 只对确实需要改动的条目给建议，没有问题就返回 {"suggestions":[]}，不要编造；
- 同一条目可以给多条建议，但不要给相互冲突的多条。"#
;

pub const COMPLETE_PROMPT: &str = r#"你是 Windows 开发者的项目管理助手。根据条目信息给出：description(一句话中文简介，不超过30字)、tags(2到5个标签的数组，中英文小写均可)、groupId(从候选分组中选最合适的 id，没有合适的为 null)、reason(一句话中文理由)。只输出 JSON，格式：{"description":"...","tags":[],"groupId":null,"reason":"..."}"#;

pub const SUMMARY_PROMPT: &str = r#"你是开发者的收藏整理助手。根据 GitHub 仓库的 README 内容给出：description(一句话中文简介，不超过40字，突出这个仓库是做什么的)、tags(2到5个标签的数组)、reason(一句话中文理由)。只输出 JSON：{"description":"...","tags":[],"reason":"..."}"#;

pub const CHAT_PROMPT: &str = r#"你是个人项目管理工具 ProjectHub 的助手，用中文回答。用户的条目库概要会附在消息末尾。
你既能回答问题，也能给出整理操作建议。只输出 JSON（不要 markdown 代码块），格式：
{"reply":"给用户看的中文回答，可用 markdown 格式","suggestions":[{"itemId":数字,"action":"动作名","groupId":数字或null,"tags":["要新增的标签"],"description":"新简介或null","name":"新名称或null","reason":"一句话中文理由","section":"板块名或null","groupName":"分组名或null","url":"仓库地址或null"}]}
可用动作（与整理助手相同）：
1. moveGroup：移动条目到分组。分组已存在时给 groupId；**分组不存在时直接填 groupName，系统会自动创建该分组**——即使 groups 列表为空也可以这样创建分组，不要以"没有分组"为由拒绝；
2. addTags：新增标签，会与现有标签合并；
3. setDescription：补全/修改简介；
4. rename：重命名；
5. pin：把条目加入收藏夹（置顶收藏）；
6. createGroup：创建新分组，groupName 必填，section 填 code/docs/link/github 之一；
7. createGithubFav：新增 GitHub 收藏，url 必填（github.com/owner/repo），name 可选作备注名；会自动抓取该仓库的 README。
分组字段用法（最重要）：分组已存在 → 只填 groupId；分组可能不存在 → **只填 groupName，不要填 groupId**；绝不允许 groupId 和 groupName 都为空的 moveGroup。
示例——把条目 12 移入名为"嵌入式"的分组（无论该分组是否存在，一律这样写）：
{"itemId":12,"action":"moveGroup","groupName":"嵌入式","reason":"esp32 相关，归入嵌入式"}
其他规则：
- **凡涉及具体条目的整理方案，必须完整地用 suggestions 表达**（每条带 itemId/action/分组信息），reply 只用一两句话概述思路——绝不允许"只在 reply 里描述方案而不给 suggestions"；
- 历史消息仅供参考，**输出格式与你的能力以本提示词为准**——你完全可以创建分组、按名称移动分组，不要被历史里"没有分组/无法执行"之类的旧说法影响；
- 只有当用户明确要求修改/整理条目时才给 suggestions，否则 suggestions 为空数组；
- suggestions 会展示给用户确认后才执行。"#
;
