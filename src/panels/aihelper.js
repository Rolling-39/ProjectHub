// AI 助手面板 —— 自然语言指令 / 全库整理 / 待应用建议（持久化+撤回）/ 纯对话
// AI 只产出建议；应用走 ai_apply_suggestions（带修改前快照，可逐条撤回）。
import { el, snack, snackErr, fmtIsoLocal } from '@rolling/ui-kit/ui';
import { Sparkles, Wand2 } from 'lucide';

import * as store from '../shared/store.js';
import { inlineIcon } from '../shared/icons.js';
import { openModal, openConfirm } from '../shared/modal.js';
import { renderMarkdownInto } from '../shared/md.js';

const ACTION_LABEL = {
    moveGroup: '移入分组',
    addTags: '新增标签',
    setDescription: '补全简介',
    rename: '重命名',
    pin: '加入收藏夹',
    createGroup: '创建分组',
    createGithubFav: '新增 GitHub 收藏',
};
const STATUS_LABEL = { pending: '待应用', applied: '已应用', undone: '已撤回', discarded: '已忽略' };
const SECTIONS = ['code', 'docs', 'link', 'github'];

export function mount(root) {
    let snapshot = { items: [], categories: [] };
    let pendingRows = [];
    let historyRows = [];
    let chatSugRows = [];   // 对话里产生的、待应用的建议行（含 id，可直接应用/忽略）

    // ── 骨架 ──
    const cmdInput = el('input', {
        class: 'input',
        placeholder: '用一句话描述要做的整理，例如：把带 rust 标签的都归到开发分组',
        style: 'flex:1;min-width:0',
    });
    const cmdBtn = el('button', { class: 'btn btn-primary btn-sm' }, [inlineIcon(Wand2, 14), '执行指令']);
    const orgBtn = el('button', { class: 'btn btn-tonal btn-sm' }, [inlineIcon(Sparkles, 14), '生成全库整理建议']);
    const logBtn = el('button', { class: 'btn btn-text btn-sm', text: '对话记录' });

    const pendingList = el('div', { class: 'pm-ai-list' });
    const pendingBar = el('div', { class: 'btn-row', style: 'display:none;justify-content:flex-end' });
    const applySelBtn = el('button', { class: 'btn btn-primary btn-sm', text: '应用所选' });
    const ignoreSelBtn = el('button', { class: 'btn btn-text btn-sm', text: '忽略所选' });
    pendingBar.append(ignoreSelBtn, applySelBtn);

    const historyList = el('div', { class: 'pm-ai-list' });

    const chatBox = el('div', {
        class: 'result-scroll',
        style: 'max-height:300px;min-height:120px;font-size:12px',
    });
    const chatInput = el('input', { class: 'input', placeholder: '和 AI 聊聊你的项目库，它能看到条目概要…', style: 'flex:1;min-width:0' });
    const chatSend = el('button', { class: 'btn btn-primary btn-sm', text: '发送' });
    const chatClear = el('button', { class: 'btn btn-text btn-sm', text: '清空对话' });

    let busyFlag = false;
    function busy(b) {
        busyFlag = b;
        [cmdBtn, orgBtn, logBtn, applySelBtn, ignoreSelBtn, chatSend, chatClear].forEach((x) => (x.disabled = b));
    }

    // 四个板块各取一次并复用结果。
    // 原实现把每个板块取了两遍（一遍只要 items、一遍只要 categories），
    // 单次调用就是 24 次 IPC，而实际只需要 12 次（4 板块 × 3 个命令）。
    async function ensureSnapshot() {
        const secs = await Promise.all(SECTIONS.map((s) => store.fetchSection(s)));
        snapshot = {
            items: secs.flatMap((d) => d.items),
            categories: secs.flatMap((d) => d.categories),
        };
    }

    const itemOf = (id) => snapshot.items.find((i) => i.id === id);
    const needsGroupName = (r) =>
        r.action === 'moveGroup' && r.groupId == null && !(r.groupName || '').trim();
    // AI 没给分组名时给用户手动填写的输入框（应用前回填到建议行）
    function groupFillInput(r) {
        return el('input', {
            class: 'input pm-group-fill',
            placeholder: '填写分组名',
            dataset: { rowId: String(r.id) },
        });
    }
    const targetOf = (r) => {
        if (r.action === 'moveGroup') {
            const g = snapshot.categories.find((c) => c.id === r.groupId);
            if (g) return g.name;
            if (r.groupName) return `${r.groupName}（自动创建）`;
            return '（AI 未指定分组，应用会被跳过）';
        }
        if (r.action === 'addTags') return (r.tags || []).join('、');
        if (r.action === 'setDescription') return r.description || '';
        if (r.action === 'rename') return r.name || '';
        if (r.action === 'pin') return '设为收藏（置顶）';
        if (r.action === 'createGroup') return `${r.groupName || r.name || ''}（${r.section || 'code'}）`;
        if (r.action === 'createGithubFav') return r.url || '';
        return '';
    };

    // ── 待应用 ──
    function renderPending() {
        pendingBar.style.display = pendingRows.length ? 'flex' : 'none';
        if (!pendingRows.length) {
            pendingList.replaceChildren(el('div', { class: 'empty-state', text: '没有待应用的建议' }));
            return;
        }
        pendingList.replaceChildren(...pendingRows.map((r) => {
            const item = itemOf(r.itemId);
            const cb = el('input', { type: 'checkbox', class: 'pm-ai-cb' });
            cb.checked = true;
            cb.dataset.rowId = String(r.id);
            return el('label', { class: 'pm-ai-row' }, [
                cb,
                el('span', { class: 'badge', text: ACTION_LABEL[r.action] || r.action }),
                el('span', { class: 'pm-ai-item', text: item ? item.name : `#${r.itemId}` }),
                needsGroupName(r)
                    ? groupFillInput(r)
                    : el('span', { class: 'pm-ai-target', text: targetOf(r) }),
                el('span', { class: 'pm-ai-reason', text: r.reason || '' }),
            ]);
        }));
    }

    // ── 历史记录 ──
    function renderHistory() {
        if (!historyRows.length) {
            historyList.replaceChildren(el('div', { class: 'empty-state', text: '还没有处理记录。应用或忽略建议后会出现在这里，已应用的可撤回。' }));
            return;
        }
        historyList.replaceChildren(...historyRows.map((r) => {
            const item = itemOf(r.itemId);
            const row = el('div', { class: 'pm-ai-row', style: 'cursor:default' }, [
                el('span', { class: 'badge', text: STATUS_LABEL[r.status] || r.status }),
                el('span', { class: 'badge', text: ACTION_LABEL[r.action] || r.action }),
                el('span', { class: 'pm-ai-item', text: item ? item.name : `#${r.itemId}` }),
                el('span', { class: 'pm-ai-target', text: targetOf(r) }),
                el('span', { class: 'pm-ai-reason', text: fmtIsoLocal(r.createdAt, { fallback: '' }) }),
                r.status === 'applied'
                    ? el('button', {
                        class: 'btn btn-text btn-sm', text: '撤回',
                        onClick: async () => {
                            try {
                                await store.aiUndoSuggestion(r.id);
                                snack('已撤回，条目恢复到应用前');
                                await refreshLists();
                            } catch (e) { snackErr(String(e)); }
                        },
                    })
                    : null,
            ]);
            return row;
        }));
    }

    async function refreshLists() {
        await ensureSnapshot();
        const rows = await store.aiListSuggestions();
        pendingRows = rows.filter((r) => r.status === 'pending');
        historyRows = rows.filter((r) => r.status === 'applied' || r.status === 'undone');
        renderPending();
        renderHistory();
    }

    async function generate(fn, source) {
        busy(true);
        try {
            // 不在这里取快照：fn() 是后端自己组条目库的，用不到前端快照；
            // 下面 refreshLists() 会取一次（原来这里多取了一次，一轮 24 次 IPC 白跑）
            const res = await fn();
            const list = Array.isArray(res) ? res : res?.suggestions || [];
            if (list.length) {
                await store.aiSaveSuggestions(String(Date.now()), source, list);
            }
            snack(list.length ? `收到 ${list.length} 条建议，已保存待应用` : 'AI 认为不需要调整');
            await refreshLists();
        } catch (e) {
            snackErr(String(e));
        }
        busy(false);
    }

    cmdBtn.addEventListener('click', () => {
        const text = cmdInput.value.trim();
        if (!text) { snack('先输入指令', 'err'); return; }
        generate(() => store.aiCommand(text), 'command');
    });
    cmdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') cmdBtn.click(); });
    orgBtn.addEventListener('click', () => generate(() => store.aiOrganize(), 'organize'));

    applySelBtn.addEventListener('click', async () => {
        // 先把用户手动填写的分组名回填到建议行
        const fills = [...pendingList.querySelectorAll('.pm-group-fill')]
            .filter((inp) => inp.value.trim())
            .map((inp) => ({ rowId: Number(inp.dataset.rowId), name: inp.value.trim() }));
        for (const f of fills) {
            try { await store.aiSetGroupName(f.rowId, f.name); } catch (e) { snackErr(String(e)); return; }
        }
        const ids = [...pendingList.querySelectorAll('.pm-ai-cb')]
            .filter((cb) => cb.checked)
            .map((cb) => Number(cb.dataset.rowId));
        if (!ids.length) { snack('没有勾选任何建议', 'err'); return; }
        busy(true);
        try {
            const res = await store.aiApplySuggestions(ids);
            snack(`已应用 ${res.applied} 条${res.skipped ? `，跳过 ${res.skipped} 条` : ''}，可在处理记录里撤回`);
            await refreshLists();
        } catch (e) { snackErr(String(e)); }
        busy(false);
    });
    ignoreSelBtn.addEventListener('click', async () => {
        const ids = [...pendingList.querySelectorAll('.pm-ai-cb')]
            .filter((cb) => cb.checked)
            .map((cb) => Number(cb.dataset.rowId));
        if (!ids.length) { snack('没有勾选任何建议', 'err'); return; }
        busy(true);
        try {
            await store.aiDiscardSuggestions(ids);
            snack('已忽略所选建议');
            await refreshLists();
        } catch (e) { snackErr(String(e)); }
        busy(false);
    });

    // ── 对话记录查看器 ──
    logBtn.addEventListener('click', () => {
        openModal('AI 对话记录（最近 20 次调用）', (content) => {
            content.append(el('p', { class: 'hint', text: '加载中…' }));
            (async () => {
                let calls = [];
                try { calls = await store.aiCalls(); } catch (_) { calls = []; }
                content.replaceChildren();
                if (!calls.length) {
                    content.append(el('div', {
                        class: 'empty-state',
                        text: '还没有调用记录。桌面端发起过 AI 调用后这里会有：发出的完整提示词 + 模型原话。',
                    }));
                    return;
                }
                const viewer = el('div', {
                    class: 'result-scroll',
                    style: 'max-height:340px;min-height:220px;font-size:11px;white-space:pre-wrap',
                });
                const list = el('div', { class: 'pm-call-list' });
                const show = (c) => {
                    const msgs = (c.messages || []).map((m) => `【${m.role}】\n${m.content}`).join('\n\n');
                    viewer.textContent =
                        `时间：${new Date((c.ts || 0) * 1000).toLocaleString()}｜模型：${c.model}｜${c.ok ? '成功' : '失败'}\n` +
                        `${'─'.repeat(34)}\n${msgs}\n\n${'─'.repeat(34)}\n【模型回复】\n${c.reply || ''}`;
                    viewer.scrollTop = 0;
                };
                calls.slice().reverse().forEach((c) => {
                    list.appendChild(el('button', {
                        class: 'pm-call-row',
                        onClick: () => show(c),
                    }, [
                        el('span', { text: new Date((c.ts || 0) * 1000).toLocaleTimeString() }),
                        el('span', { class: 'pm-ai-item', text: c.model || '' }),
                        el('span', { class: 'badge ' + (c.ok ? 'ok' : 'err'), text: c.ok ? '成功' : '失败' }),
                    ]));
                });
                content.append(list, viewer);
                show(calls[calls.length - 1]);
            })();
        });
    });

    // ── 对话内建议卡片 ──
    function buildSugCard(rows, onApply, onIgnore) {
        const cbs = [];
        const card = el('div', { class: 'pm-chat-sug' }, [
            el('div', { class: 'hint', text: 'AI 给出以下修改建议，勾选后应用（应用后可在处理记录里撤回）：' }),
        ]);
        rows.filter((r) => r.status === 'pending').forEach((r) => {
            const cb = el('input', { type: 'checkbox', class: 'pm-ai-cb' });
            cb.checked = true;
            cb.dataset.rowId = String(r.id);
            cbs.push(cb);
            const item = itemOf(r.itemId);
            card.append(el('label', { class: 'pm-ai-row' }, [
                cb,
                el('span', { class: 'badge', text: ACTION_LABEL[r.action] || r.action }),
                el('span', { class: 'pm-ai-item', text: item ? item.name : `#${r.itemId}` }),
                needsGroupName(r)
                    ? groupFillInput(r)
                    : el('span', { class: 'pm-ai-target', text: targetOf(r) }),
                el('span', { class: 'pm-ai-reason', text: r.reason || '' }),
            ]));
        });
        const applyHandler = async () => {
            // 先回填手动填写的分组名
            const fills = [...card.querySelectorAll('.pm-group-fill')]
                .filter((inp) => inp.value.trim())
                .map((inp) => ({ rowId: Number(inp.dataset.rowId), name: inp.value.trim() }));
            for (const f of fills) {
                try { await store.aiSetGroupName(f.rowId, f.name); } catch (e) { snackErr(String(e)); return; }
            }
            const ids = cbs.filter((c) => c.checked).map((c) => Number(c.dataset.rowId));
            if (!ids.length) { snack('没有勾选任何建议', 'err'); return; }
            await onApply(ids);
        };
        card.append(el('div', { class: 'btn-row', style: 'justify-content:flex-end;margin-top:8px' }, [
            el('button', { class: 'btn btn-text btn-sm', text: '忽略', onClick: () => onIgnore(cbs.filter((c) => c.checked).map((c) => Number(c.dataset.rowId))) }),
            el('button', { class: 'btn btn-primary btn-sm', text: '应用所选', onClick: applyHandler }),
        ]));
        return card;
    }

    function injectChatSugCard() {
        document.querySelectorAll('.pm-chat-sug').forEach((n) => n.remove());
        const pending = chatSugRows.filter((r) => r.status === 'pending');
        if (!pending.length) return;
        chatBox.append(buildSugCard(pending,
            async (ids) => {
                busy(true);
                try {
                    const res = await store.aiApplySuggestions(ids);
                    chatSugRows = chatSugRows.filter((r) => !ids.includes(r.id));
                    snack(`已应用 ${res.applied} 条${res.skipped ? `，跳过 ${res.skipped} 条` : ''}，可在处理记录里撤回`);
                    await refreshLists();
                    await renderChat();
                } catch (e) { snackErr(String(e)); }
                busy(false);
            },
            async (ids) => {
                busy(true);
                try {
                    await store.aiDiscardSuggestions(ids);
                    chatSugRows = chatSugRows.filter((r) => !ids.includes(r.id));
                    snack('已忽略');
                    await refreshLists();
                    await renderChat();
                } catch (e) { snackErr(String(e)); }
                busy(false);
            },
        ));
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    // ── 纯对话 ──
    async function renderChat() {
        let hist = [];
        try { hist = await store.aiChatHistory(); } catch (_) { hist = []; }
        chatBox.replaceChildren();
        if (!hist.length) {
            chatBox.append(el('div', {
                class: 'hint',
                text: '（还没有对话。AI 能看到你的条目库概要，可以问"我的项目都有些什么"或让它帮忙出整理思路）',
            }));
            return;
        }
        // 用户消息纯文本，AI 消息按 Markdown 渲染（消毒后）
        for (const m of hist) {
            const isUser = m.role === 'user';
            const body = el('div');
            if (isUser) {
                body.className = 'pm-chat-text';
                body.textContent = m.content || '';
            } else {
                body.className = 'pm-chat-md';
                renderMarkdownInto(body, { content: m.content || '', baseDir: '' });
            }
            chatBox.append(el('div', { class: 'pm-chat-msg ' + (isUser ? 'user' : 'ai') }, [
                el('div', { class: 'pm-chat-role', text: isUser ? '我' : 'AI' }),
                body,
            ]));
        }
        chatBox.scrollTop = chatBox.scrollHeight;
        injectChatSugCard();
    }
    chatSend.addEventListener('click', async () => {
        const text = chatInput.value.trim();
        if (!text) { snack('先输入消息', 'err'); return; }
        busy(true);
        try {
            const res = await store.aiChat(text);
            chatInput.value = '';
            await ensureSnapshot();
            chatSugRows.push(...(res?.suggestions || []));
            await renderChat();
            if (res?.suggestions?.length) {
                snack(`AI 给出 ${res.suggestions.length} 条修改建议，请在对话中确认`);
            }
        } catch (e) { snackErr(String(e)); }
        busy(false);
    });
    chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') chatSend.click(); });
    chatClear.addEventListener('click', async () => {
        try {
            await store.aiChatClear();
            chatSugRows = []; // 对话清空时，对话流里的建议卡片也一并移除（待应用列表仍保留）
            await renderChat();
            snack('对话已清空');
        } catch (e) { snackErr(String(e)); }
    });

    // ── 组装（对话卡在最上方，方便随时召唤） ──
    root.append(
        el('div', { class: 'card' }, [
            el('div', { class: 'card-header', text: '和 AI 对话' }),
            chatBox,
            el('div', { class: 'pm-form-inline', style: 'margin-top:10px' }, [chatInput, chatSend, chatClear]),
        ]),
        el('div', { class: 'card' }, [
            el('div', { class: 'card-header', text: '自然语言指令' }),
            el('div', { class: 'pm-form-inline' }, [cmdInput, cmdBtn]),
            el('p', { class: 'hint', text: 'AI 把指令翻译成整理建议，保存到下方"待应用"，确认后才改数据。' }),
        ]),
        el('div', { class: 'card' }, [
            el('div', { class: 'card-header', text: '全库整理建议' }),
            el('div', { class: 'btn-row' }, [orgBtn, logBtn]),
        ]),
        el('div', { class: 'card' }, [
            el('div', { class: 'card-header', text: '待应用建议' }),
            pendingList,
            pendingBar,
        ]),
        el('div', { class: 'card' }, [
            el('div', {
                class: 'card-header',
                style: 'display:flex;align-items:center;justify-content:space-between',
            }, [
                el('span', { text: '处理记录' }),
                el('button', {
                    class: 'btn btn-text btn-sm', text: '清空记录',
                    onClick: () => openConfirm('清空全部建议与处理记录？（不影响条目数据）', async () => {
                        try {
                            const n = await store.aiClearSuggestions();
                            snack(`已清空 ${n} 条记录`);
                            await refreshLists();
                        } catch (e) { snackErr(String(e)); }
                    }, '清空'),
                }),
            ]),
            historyList,
        ]),
    );

    busy(true);
    (async () => {
        try {
            await refreshLists();
            await renderChat();
        } catch (e) {
            snackErr('AI 助手初始化失败：' + e);
        }
        busy(false);
    })();
    return {};
}
