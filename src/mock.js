// ─────────────────────────────────────────────────────────────
// ProjectHub / mock.js —— 浏览器开发桩
// 只放数据与最直白的增删改查，不实现业务逻辑（见 kit USAGE 4.3）。
// 桌面端（Tauri 内）不会走到这里。
// ─────────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

const state = {
    settings: {},
    categories: [
        { id: 1, section: 'code', name: '开发', parentId: null, sort: 0 },
        { id: 2, section: 'code', name: '学习', parentId: null, sort: 1 },
        { id: 3, section: 'link', name: '常用站点', parentId: null, sort: 0 },
        { id: 4, section: 'docs', name: '方案文档', parentId: null, sort: 0 },
    ],
    // mock 里 tags 直接挂在 item 上，list_tags 现场派生
    items: [
        {
            id: 1, type: 'code', name: 'project-manager', path: 'C:\\demo\\project-manager',
            url: null, description: '本项目（浏览器演示数据）',
            notes: 'M1 备注演示：浏览器模式下可以自由增删改，数据只存在内存里。',
            readmePath: null, readmeRef: null, categoryId: 1, pinned: true, archived: false,
            color: null, icon: 'folder-git-2', openCount: 3,
            lastOpenedAt: '2026-10-04T09:00:00Z', createdAt: '2026-10-03T10:00:00Z',
            tags: ['rust', '工具'],
        },
        {
            id: 2, type: 'code', name: 'base64-tool', path: 'C:\\demo\\base64-tool',
            url: null, description: 'Base64 编解码小工具（ui-kit 视觉源头）',
            notes: '', readmePath: null, readmeRef: null, categoryId: 1, pinned: false,
            archived: false, color: null, icon: null, openCount: 1,
            lastOpenedAt: '2026-10-03T21:00:00Z', createdAt: '2026-06-17T10:00:00Z',
            tags: ['工具'],
        },
        {
            id: 5, type: 'code', name: 'esp32-s3-cam', path: 'C:\\demo\\esp32-s3-cam',
            url: null, description: 'ESP32-S3 摄像头开发板项目',
            notes: '', readmePath: null, readmeRef: null, categoryId: 2, pinned: false,
            archived: false, color: null, icon: 'cpu', openCount: 2,
            lastOpenedAt: '2026-10-02T18:00:00Z', createdAt: '2026-08-20T10:00:00Z',
            tags: ['嵌入式', 'ESP32'],
        },
        {
            id: 6, type: 'code', name: 'device-controller', path: 'C:\\demo\\device-controller',
            url: null, description: '设备控制器，硬件侧固件',
            notes: '', readmePath: null, readmeRef: null, categoryId: 2, pinned: false,
            archived: false, color: null, icon: null, openCount: 0,
            lastOpenedAt: null, createdAt: '2026-09-10T10:00:00Z',
            tags: ['嵌入式'],
        },
        {
            id: 3, type: 'link', name: 'Tauri 官方文档', path: null,
            url: 'https://tauri.app', description: 'Tauri 2 文档与指南',
            notes: '二期 GitHub 抓取会用到 raw 域名。', readmePath: null, readmeRef: null,
            categoryId: 3, pinned: false, archived: false, color: null, icon: null,
            openCount: 8, lastOpenedAt: '2026-10-04T08:30:00Z', createdAt: '2026-10-01T09:00:00Z',
            tags: [],
        },
        {
            id: 4, type: 'docs', name: '产品方案草稿', path: 'C:\\demo\\docs-hub',
            url: null, description: 'ProjectHub 设计与会议记录',
            notes: '', readmePath: null, readmeRef: null, categoryId: 4, pinned: false,
            archived: false, color: null, icon: null, openCount: 0, lastOpenedAt: null,
            createdAt: '2026-10-02T14:00:00Z',
            tags: ['文档'],
        },
    ],
};

let nextId = 100;
const id = () => ++nextId;

// AI 建议历史与对话（mock 内存态）
const mockSuggestions = [];
let nextSugId = 5000;
const mockChat = [];

function tagsOf(section) {
    const names = new Map();
    for (const it of state.items) {
        if (it.type !== section) continue;
        for (const t of it.tags || []) {
            if (!names.has(t)) names.set(t, { id: 1000 + names.size, name: t, color: null });
        }
    }
    return [...names.values()];
}

const CANNED = {
    list_items: ({ section }) => JSON.parse(JSON.stringify(
        state.items.filter((i) => i.type === section)
            .sort((a, b) => (b.pinned - a.pinned) || String(a.name).localeCompare(b.name)),
    )),
    list_categories: ({ section }) => state.categories.filter((c) => c.section === section).map((c) => ({ ...c })),
    list_tags: ({ section }) => tagsOf(section),
    upsert_item: ({ item }) => {
        if (item.id) {
            const idx = state.items.findIndex((i) => i.id === item.id);
            if (idx < 0) throw new Error('条目不存在');
            state.items[idx] = { ...state.items[idx], ...item, tags: item.tags || [] };
            return JSON.parse(JSON.stringify(state.items[idx]));
        }
        const created = {
            readmePath: null, readmeRef: null, openCount: 0, lastOpenedAt: null,
            color: null, icon: null, categoryId: null,
            ...item,
            id: id(), createdAt: now(), archived: !!item.archived, pinned: !!item.pinned,
            tags: item.tags || [],
        };
        state.items.push(created);
        return JSON.parse(JSON.stringify(created));
    },
    delete_item: ({ id: delId }) => {
        state.items = state.items.filter((i) => i.id !== delId);
    },
    delete_items: ({ ids }) => {
        const set = new Set(ids);
        const before = state.items.length;
        state.items = state.items.filter((i) => !set.has(i.id));
        return before - state.items.length;
    },
    set_item_flags: ({ id: itemId, pinned, archived }) => {
        const it = state.items.find((i) => i.id === itemId);
        if (!it) throw new Error('条目不存在');
        if (pinned !== undefined && pinned !== null) it.pinned = !!pinned;
        if (archived !== undefined && archived !== null) it.archived = !!archived;
    },
    open_item: ({ id: itemId, at }) => {
        const it = state.items.find((i) => i.id === itemId);
        if (!it) throw new Error('条目不存在');
        it.openCount = (it.openCount || 0) + 1;
        it.lastOpenedAt = at || now();
        // 浏览器模式不真的打开窗口
    },
    upsert_category: ({ section, id: catId, name, parentId, sort }) => {
        if (catId) {
            const c = state.categories.find((x) => x.id === catId);
            if (!c) throw new Error('分组不存在');
            c.name = name;
            c.parentId = parentId ?? null;
            c.sort = sort ?? 0;
            return { ...c };
        }
        const c = { id: id(), section, name, parentId: parentId ?? null, sort: sort ?? 0 };
        state.categories.push(c);
        return { ...c };
    },
    delete_category: ({ id: catId }) => {
        state.items.forEach((i) => { if (i.categoryId === catId) i.categoryId = null; });
        state.categories.forEach((c) => { if (c.parentId === catId) c.parentId = null; });
        state.categories = state.categories.filter((c) => c.id !== catId);
    },
    find_readme: ({ dir }) => {
        const it = state.items.find((i) => i.path && dir.startsWith(i.path.replace(/[\\\/]+$/, '')));
        return it && it.type !== 'link' ? it.path + '\\README.md' : null;
    },
    read_markdown: () => ({
        content: [
            '# 演示 README', '',
            '这是**浏览器模式**的 mock 内容。桌面端会读取真实文件。', '',
            '| 功能 | 状态 |', '|---|---|',
            '| GFM 表格 | ✓ |', '| 代码高亮 | 见下 |', '', '```rust',
            'fn main() {', '    println!("Hello ProjectHub");', '}', '```', '',
            '- [x] 骨架', '- [x] 主题色', '- [ ] M2 GitHub 收藏', '',
        ].join('\n'),
        baseDir: 'C:\\demo',
    }),
    list_markdown_files: () => ['README.md', '设计笔记.md', '会议记录.md'],
    list_dir_files: () => [
        { name: '参考资料', isDir: true, ext: '', size: 0 },
        { name: 'README.md', isDir: false, ext: 'md', size: 1432 },
        { name: '需求说明书.docx', isDir: false, ext: 'docx', size: 284112 },
        { name: '架构图.pdf', isDir: false, ext: 'pdf', size: 1240512 },
        { name: '数据表.xlsx', isDir: false, ext: 'xlsx', size: 96200 },
        { name: '演示截图.png', isDir: false, ext: 'png', size: 512400 },
    ],
    open_file: () => { /* 浏览器模式不真的打开 */ },
    ai_test: () => Promise.resolve('正常（浏览器演示）'),
    ai_calls: () => [
        {
            ts: Math.floor(Date.now() / 1000),
            model: 'demo-chat',
            messages: [
                { role: 'system', content: '（演示）系统提示词…' },
                { role: 'user', content: '（演示）条目库 JSON…' },
            ],
            reply: '{"suggestions":[]}（演示模型回复）',
            ok: true,
        },
    ],
    ai_complete_item: () => Promise.resolve({
        description: 'AI 演示简介：一个用于验证补全流程的条目',
        tags: ['演示', 'ai'],
        color: 'E86AA6',
        groupId: 1,
        reason: '浏览器演示数据，groupId 指向"开发"分组',
    }),
    ai_organize: () => Promise.resolve({
        suggestions: [
            { itemId: 1, action: 'addTags', tags: ['演示'], groupId: null, description: null, name: null, reason: '演示：为常用条目补充标签', section: null, groupName: null, url: null },
            { itemId: 2, action: 'setDescription', tags: [], groupId: null, description: 'AI 演示：Base64 编解码小工具', name: null, reason: '演示：该条目缺少简介', section: null, groupName: null, url: null },
            { itemId: 2, action: 'moveGroup', tags: [], groupId: null, description: null, name: null, reason: '演示：AI 忘了给分组名，需手动填写', section: null, groupName: null, url: null },
        ],
    }),
    ai_command: () => Promise.resolve({
        suggestions: [
            { itemId: 3, action: 'pin', groupId: null, tags: [], description: null, name: null, reason: '演示：加入收藏夹', section: null, groupName: null, url: null },
            { itemId: null, action: 'createGroup', groupId: null, tags: [], description: null, name: null, reason: '演示：创建新分组', section: 'code', groupName: 'AI 新分组', url: null },
        ],
    }),
    ai_summarize_readme: () => Promise.resolve({
        description: 'AI 演示摘要：一个开源 Windows 优化工具',
        tags: ['windows', '工具'],
        reason: '浏览器演示数据',
    }),
    ai_get_prompts: () => ({
        prompts: {
            complete: '（演示）补全提示词…',
            organize: '（演示）整理提示词…',
            summary: '（演示）摘要提示词…',
            chat: '（演示）对话提示词…',
        },
        defaults: {
            complete: '（默认）补全提示词…',
            organize: '（默认）整理提示词…',
            summary: '（默认）摘要提示词…',
            chat: '（默认）对话提示词…',
        },
    }),
    ai_save_suggestions: ({ source, suggestions }) => {
        suggestions.forEach((s) => mockSuggestions.unshift({
            id: nextSugId++, batchId: 'mock', source, status: 'pending',
            createdAt: now(), beforeJson: null, ...s,
        }));
        return suggestions.length;
    },
    ai_list_suggestions: ({ statuses }) => mockSuggestions
        .filter((s) => !statuses || statuses.includes(s.status))
        .slice(0, 200)
        .map((s) => JSON.parse(JSON.stringify(s))),
    ai_apply_suggestions: ({ rowIds }) => {
        let n = 0;
        for (const rid of rowIds) {
            const row = mockSuggestions.find((s) => s.id === rid && s.status === 'pending');
            if (!row) continue;
            if (row.action === 'createGroup') {
                const sec = row.section || 'code';
                const gname = row.groupName || row.name;
                let g = state.categories.find((c) => c.section === sec && c.name === gname);
                if (!g) {
                    g = { id: id(), section: sec, name: gname, parentId: null, sort: 0 };
                    state.categories.push(g);
                }
                row.groupId = g.id;
                row.status = 'applied';
                n++;
                continue;
            }
            if (row.action === 'createGithubFav') {
                const created = {
                    id: id(), type: 'github', name: row.name || 'AI 新收藏',
                    path: null, url: row.url || 'https://github.com/demo/repo',
                    description: 'GitHub 收藏（AI 导入演示）', notes: '',
                    readmePath: 'C:\\demo\\github_assets\\README.md', readmeRef: 'main/README.md',
                    categoryId: null, pinned: false, archived: false, color: null, icon: 'github',
                    openCount: 0, lastOpenedAt: null, createdAt: now(), tags: [],
                };
                state.items.push(created);
                row.itemId = created.id;
                row.status = 'applied';
                n++;
                continue;
            }
            const item = state.items.find((i) => i.id === row.itemId);
            if (!item) continue;
            row.beforeJson = JSON.stringify(item);
            if (row.action === 'moveGroup') {
                let gid = row.groupId;
                if (gid == null && row.groupName) {
                    let g = state.categories.find((c) => c.section === item.type && c.name === row.groupName);
                    if (!g) {
                        g = { id: id(), section: item.type, name: row.groupName, parentId: null, sort: 0 };
                        state.categories.push(g);
                    }
                    gid = g.id;
                }
                if (gid != null) item.categoryId = gid;
            }
            if (row.action === 'addTags') item.tags = [...new Set([...(item.tags || []), ...(row.tags || [])])];
            if (row.action === 'setDescription' && row.description) item.description = row.description;
            if (row.action === 'rename' && row.name) item.name = row.name;
            if (row.action === 'pin') item.pinned = true;
            row.status = 'applied';
            n++;
        }
        return { applied: n, skipped: 0 };
    },
    ai_undo_suggestion: ({ rowId }) => {
        const row = mockSuggestions.find((s) => s.id === rowId);
        if (!row || row.status !== 'applied') throw new Error('无法撤回');
        if (row.action === 'createGithubFav' && row.itemId != null) {
            state.items = state.items.filter((i) => i.id !== row.itemId);
        } else if (row.action === 'createGroup' && row.groupId != null) {
            state.categories = state.categories.filter((c) => c.id !== row.groupId);
        } else if (row.beforeJson) {
            const prev = JSON.parse(row.beforeJson);
            const idx = state.items.findIndex((i) => i.id === prev.id);
            if (idx >= 0) state.items[idx] = prev;
        }
        row.status = 'undone';
    },
    ai_discard_suggestions: ({ rowIds }) => {
        let n = 0;
        for (const rid of rowIds) {
            const row = mockSuggestions.find((s) => s.id === rid);
            if (row) { row.status = 'discarded'; n++; }
        }
        return n;
    },
    ai_clear_suggestions: () => {
        const n = mockSuggestions.length;
        mockSuggestions.length = 0;
        return n;
    },
    ai_set_group_name: ({ rowId, groupName }) => {
        const row = mockSuggestions.find((s) => s.id === rowId);
        if (!row) throw new Error('记录不存在');
        row.groupName = groupName.trim();
        row.groupId = null;
    },
    ai_chat: ({ text }) => new Promise((resolve) => setTimeout(() => {
        mockChat.push({ role: 'user', content: text });
        const target = state.items.find((i) => i.type === 'code') || state.items[0];
        const reply = `（演示）好的，我建议这样调整：\n\n- 给 **${target?.name || '条目'}** 补一个简介\n- 详情见下方建议卡片，确认后生效`;
        const row = {
            id: nextSugId++, batchId: 'chat-demo', source: 'chat',
            itemId: target?.id ?? 0, action: 'setDescription', groupId: null, tags: [],
            description: 'AI 演示：由对话生成的简介', name: null,
            reason: '对话中生成的建议', status: 'pending', createdAt: now(),
        };
        mockSuggestions.unshift(row);
        mockChat.push({ role: 'assistant', content: reply });
        resolve({ reply, suggestions: [JSON.parse(JSON.stringify(row))] });
    }, 500)),
    ai_chat_history: () => mockChat.map((m) => ({ ...m, createdAt: now() })),
    ai_chat_clear: () => { mockChat.length = 0; },
    import_github_repo: ({ url, name }) => new Promise((resolve) => setTimeout(() => {
        const m = String(url || '').match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
        const owner = m ? m[1] : 'demo';
        const repo = m ? m[2].replace(/\.git$/, '') : 'repo';
        const created = {
            id: id(), type: 'github', name: (name || '').trim() || `${owner}/${repo}`,
            path: null, url: `https://github.com/${owner}/${repo}`,
            description: 'GitHub 收藏 · 图片本地化 3 张（失败 0 张保留原链接）',
            notes: '', readmePath: 'C:\\demo\\github_assets\\README.md', readmeRef: 'main/README.md',
            categoryId: null, pinned: false, archived: false, color: null, icon: 'github',
            openCount: 0, lastOpenedAt: null, createdAt: now(), tags: [],
        };
        state.items.push(created);
        resolve(JSON.parse(JSON.stringify(created)));
    }, 800)),
    refresh_github_repo: ({ id: itemId }) => {
        const it = state.items.find((i) => i.id === itemId);
        if (!it) return Promise.reject(new Error('条目不存在'));
        it.readmeRef = 'main/README.md';
        it.readmePath = it.readmePath || 'C:\\demo\\github_assets\\README.md';
        return Promise.resolve(JSON.parse(JSON.stringify(it)));
    },
    scan_directory: ({ root }) => {
        const base = String(root || 'E:\\Projects').replace(/[\\/]+$/, '');
        return [
            { path: base + '\\awesome-project', name: 'awesome-project' },
            { path: base + '\\project-manager', name: 'project-manager' }, // 与种子路径重复 → 验证"已入库"
        ];
    },
    import_readme_manual: ({ id: itemId, file }) => {
        const it = state.items.find((i) => i.id === itemId);
        if (!it) return Promise.reject(new Error('条目不存在'));
        it.readmePath = file;
        it.readmeRef = '手动导入';
        return Promise.resolve(JSON.parse(JSON.stringify(it)));
    },
    search_all: ({ query }) => {
        const q = (query || '').trim().toLowerCase();
        if (!q) return [];
        return state.items
            .filter((i) => !i.archived &&
                [i.name, i.description, i.notes, ...(i.tags || [])]
                    .some((f) => String(f || '').toLowerCase().includes(q)))
            .slice(0, 50)
            .map(({ id: i, type, name, description, notes, path, url }) => ({ id: i, type, name, description, notes, path, url }));
    },
    get_setting: ({ key }) => state.settings[key] ?? null,
    set_setting: ({ key, value }) => { state.settings[key] = value; },
};

export function mockInvoke(cmd, args) {
    const fn = CANNED[cmd];
    if (!fn) return Promise.reject(new Error('mock 未实现：' + cmd));
    try {
        return Promise.resolve(fn(args || {}));
    } catch (e) {
        return Promise.reject(e);
    }
}
