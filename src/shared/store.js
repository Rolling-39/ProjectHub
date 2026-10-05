// ─────────────────────────────────────────────────────────────
// ProjectHub / shared/store.js —— 数据层
// 桌面端走 Tauri invoke，浏览器走 mock；变更后用 kit 事件总线广播。
// ─────────────────────────────────────────────────────────────
import { isTauri, invoke, openDialog, saveDialog } from '@rolling/ui-kit/tauri';
import { emit } from '@rolling/ui-kit/ui';
import { mockInvoke } from '../mock.js';

const call = (cmd, args) => (isTauri ? invoke(cmd, args) : mockInvoke(cmd, args));

export const DEFAULT_VIA = { code: 'explorer', docs: 'explorer', link: 'browser', github: 'browser' };

export const TYPE_LABEL = { code: '项目', docs: '文档', link: '网址', github: 'GitHub' };

/** 拉取一个板块的全量数据（数量级几十，前端过滤足够） */
export async function fetchSection(section) {
    const [items, categories, tags] = await Promise.all([
        call('list_items', { section, filter: { excludeArchived: false, favoritesOnly: false } }),
        call('list_categories', { section }),
        call('list_tags', { section }),
    ]);
    return { items, categories, tags };
}

export const saveItem = async (item) => {
    const saved = await call('upsert_item', { item });
    emit('items-changed', { section: item.type });
    return saved;
};

export const removeItem = async (id) => {
    await call('delete_item', { id });
    emit('items-changed', { section: '*' });
};

export const deleteItems = async (ids) => {
    const n = await call('delete_items', { ids });
    emit('items-changed', { section: '*' });
    return n;
};

export const setFlags = async (id, pinned, archived) => {
    await call('set_item_flags', { id, pinned, archived });
    emit('items-changed', { section: '*' });
};

export const openItem = async (id, via) => {
    await call('open_item', { id, via, at: new Date().toISOString() });
    emit('items-changed', { section: '*' });
};

export const saveCategory = async (section, id, name, parentId, sort) => {
    const c = await call('upsert_category', { section, id, name, parentId, sort });
    emit('items-changed', { section });
    return c;
};

export const removeCategory = async (id) => {
    await call('delete_category', { id });
    emit('items-changed', { section: '*' });
};

export const searchAll = (query) => call('search_all', { query });

// ── 目录扫描批量导入（项目板块） ──
export const scanDirectory = (root, maxDepth) => call('scan_directory', { root, maxDepth: maxDepth ?? 3 });

// ── AI 助手（产出均为建议，应用由前端确认） ──
export const aiTest = () => call('ai_test', {});
export const aiCompleteItem = (id) => call('ai_complete_item', { id });
export const aiOrganize = () => call('ai_organize', {});
export const aiCommand = (text) => call('ai_command', { text });
export const aiSummarizeReadme = (id) => call('ai_summarize_readme', { id });
export const aiCalls = () => call('ai_calls', {});
export const aiSaveSuggestions = (batchId, source, suggestions) =>
    call('ai_save_suggestions', { batchId, source, suggestions });
export const aiListSuggestions = (statuses) => call('ai_list_suggestions', { statuses: statuses ?? null });
export const aiApplySuggestions = (rowIds) => call('ai_apply_suggestions', { rowIds });
export const aiUndoSuggestion = (rowId) => call('ai_undo_suggestion', { rowId });
export const aiDiscardSuggestions = (rowIds) => call('ai_discard_suggestions', { rowIds });
export const aiClearSuggestions = () => call('ai_clear_suggestions', {});
export const aiSetGroupName = (rowId, groupName) => call('ai_set_group_name', { rowId, groupName });
export const aiChat = (text) => call('ai_chat', { text });
export const aiChatHistory = () => call('ai_chat_history', {});
export const aiChatClear = () => call('ai_chat_clear', {});
export const aiGetPrompts = () => call('ai_get_prompts', {});

// ── GitHub 收藏（导入式） ──
export const importGithubRepo = async (url, name) => {
    const item = await call('import_github_repo', { url, name: name || null });
    emit('items-changed', { section: 'github' });
    return item;
};
export const refreshGithubRepo = async (id) => {
    const item = await call('refresh_github_repo', { id });
    emit('items-changed', { section: 'github' });
    return item;
};
export const importReadmeManual = async (id, file) => {
    const item = await call('import_readme_manual', { id, file });
    emit('items-changed', { section: 'github' });
    return item;
};

export const findReadme = (dir) => call('find_readme', { dir });
export const readMarkdown = (path) => call('read_markdown', { path });
export const listMarkdownFiles = (dir) => call('list_markdown_files', { dir });
export const listDirFiles = (dir) => call('list_dir_files', { dir });
export const openFile = (path) => call('open_file', { path });

export { openDialog, saveDialog };

export const getSetting = (key) => call('get_setting', { key });
export const setSetting = async (key, value) => {
    await call('set_setting', { key, value });
};

export const exportData = async () => {
    const path = await saveDialog({
        title: '导出备份',
        defaultPath: 'project-hub-backup.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path) return null;
    const count = await call('export_data', { path, at: new Date().toISOString() });
    return { path, count };
};

export const importData = async () => {
    const path = await openDialog({
        title: '导入备份',
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path) return null;
    const count = await call('import_data', { path });
    emit('items-changed', { section: '*' });
    return { path, count };
};
