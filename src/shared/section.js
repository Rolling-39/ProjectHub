// ─────────────────────────────────────────────────────────────
// ProjectHub / shared/section.js —— 板块三列布局
// 子视图栏（视图/分组/标签） + 卡片网格 + 详情（含 README）
// 四个板块共用，差异通过 cfg 注入：
//   { section, title, vias: ['explorer'|'terminal'|'editor'|'browser'][],
//     readme: bool, docsFiles: bool }
// ─────────────────────────────────────────────────────────────
import { el, snack, snackErr, snackWarn, on, fmtSize, fmtIsoLocal, fmtRelativeDay } from '@rolling/ui-kit/ui';
import {
    FolderOpen, Terminal, Code, ExternalLink, Star, Pencil, Trash2, Plus, FolderPlus, X, File,
    RefreshCw, FileUp, FolderSearch, ListChecks,
} from 'lucide';

import * as store from './store.js';
import { inlineIcon, icon } from './icons.js';
import { renderMarkdownInto } from './md.js';
import { openItemForm } from './itemform.js';
import { openModal, openConfirm } from './modal.js';
import { openGhImport } from './ghwizard.js';
import { openScanImport } from './scanimport.js';

const VIA_ICON = { explorer: FolderOpen, terminal: Terminal, editor: Code, browser: ExternalLink };
const VIA_LABEL = { explorer: '资源管理器', terminal: '终端', editor: '编辑器', browser: '浏览器' };

export async function mountSection(root, cfg) {
    const state = {
        items: [], categories: [], tags: [],
        view: 'all',            // all | fav | recent | common
        categoryId: null,
        tagId: null,
        query: '',
        selectedId: null,
        selectMode: false,      // 批量选择模式
        selected: new Set(),    // 勾选的条目 id
        docDir: null,           // 文档目录浏览器当前所在目录
        lastFilterSig: null,    // 上一次的过滤条件签名（用于同步勾选集）
        detailItemId: null,     // 详情栏当前渲染的是哪一条（用于同条目的轻量刷新）
    };

    // ── 骨架 ──
    const viewList = el('div', { class: 'pm-views' });
    const groupList = el('div', { class: 'pm-groups' });
    const tagChips = el('div', { class: 'pm-subtags' });
    const searchInput = el('input', { class: 'input', placeholder: '在本板块内过滤…', style: 'flex:1;min-width:0' });
    const countLabel = el('span', { class: 'label', text: '' });
    const batchbar = el('div', { class: 'pm-batchbar' });
    batchbar.hidden = true;
    const cardsGrid = el('div', { class: 'pm-cards' });
    const detailPane = el('aside', { class: 'pm-detail' });
    detailPane.hidden = true;

    root.appendChild(el('div', { class: 'pm-layout' }, [
        el('aside', { class: 'pm-subrail' }, [
            el('div', { class: 'pm-subhead' }, [el('span', { text: '视图' })]),
            viewList,
            el('div', { class: 'pm-subhead', style: 'margin-top:16px' }, [
                el('span', { text: '分组' }),
                el('button', {
                    class: 'pm-iconbtn', title: '新建分组', 'aria-label': '新建分组',
                    onClick: () => openGroupForm(null),
                }, [inlineIcon(FolderPlus, 13)]),
            ]),
            groupList,
            el('div', { class: 'pm-subhead', style: 'margin-top:16px' }, [el('span', { text: '标签' })]),
            tagChips,
        ]),
        el('main', { class: 'pm-main' }, [
            el('div', { class: 'pm-toolbar' }, [
                searchInput,
                countLabel,
                el('button', {
                    class: 'btn btn-outline btn-sm',
                    onClick: enterSelectMode,
                }, [inlineIcon(ListChecks, 14), '批量选择']),
                ...(cfg.scan ? [el('button', {
                    class: 'btn btn-outline btn-sm',
                    onClick: () => openScanImport(state.items.map((i) => i.path).filter(Boolean)),
                }, [inlineIcon(FolderSearch, 14), '扫描导入'])] : []),
                el('button', {
                    class: 'btn btn-primary btn-sm',
                    onClick: () => cfg.addViaWizard
                        ? openGhImport()
                        : openItemForm({ type: cfg.section, categories: state.categories }),
                }, [inlineIcon(Plus, 14), '添加']),
            ]),
            batchbar,
            cardsGrid,
        ]),
        detailPane,
    ]));

    // 搜索防抖：不加的话每敲一个字符就重建整个卡片网格，条目多时输入卡顿
    let searchTimer = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            state.query = searchInput.value.trim().toLowerCase();
            renderCards();
        }, 150);
    });

    // ── 数据 ──
    async function load() {
        try {
            const d = await store.fetchSection(cfg.section);
            state.items = d.items;
            state.categories = d.categories;
            state.tags = d.tags;
            renderAll();
        } catch (e) {
            snackErr('加载失败：' + e);
        }
    }
    // ── 事件总线 ──
    // 单条变更（保存/打开/收藏/归档）带 item 回来，就只更新那一条：
    // 重载整块要重取三个集合、重建全部 DOM，还会把详情栏的 README 重新读一遍磁盘。
    // 带 removedIds 的是删除；其余（批量导入、分组改动）才真需要整块重载。
    const offBus = on('items-changed', (p = {}) => {
        const { section, item, removedIds } = p;
        const mine = !section || section === '*' || section === cfg.section;
        if (!mine) return;
        if (item && item.type === cfg.section) { applyItemUpdate(item); return; }
        if (Array.isArray(removedIds) && removedIds.length) { applyRemovals(removedIds); return; }
        load();
    });

    function applyItemUpdate(item) {
        const idx = state.items.findIndex((x) => x.id === item.id);
        if (idx < 0) { load(); return; }
        if (item.archived) {
            // 归档后不应再出现在列表里
            state.items.splice(idx, 1);
            if (state.selectedId === item.id) state.selectedId = null;
        } else {
            state.items[idx] = item;
        }
        renderCards();
        renderDetail();
    }

    function applyRemovals(ids) {
        const gone = new Set(ids);
        state.items = state.items.filter((x) => !gone.has(x.id));
        if (state.selectedId != null && gone.has(state.selectedId)) state.selectedId = null;
        gone.forEach((id) => state.selected.delete(id));
        renderBatchbar();
        renderCards();
        renderDetail();
    }

    const groupOf = (item) => state.categories.find((c) => c.id === item.categoryId) || null;

    function visibleItems() {
        let list = state.items.filter((i) => !i.archived);
        if (state.view === 'fav') list = list.filter((i) => i.pinned);
        if (state.categoryId != null) list = list.filter((i) => i.categoryId === state.categoryId);
        if (state.tagId != null) {
            const tag = state.tags.find((t) => t.id === state.tagId);
            if (tag) list = list.filter((i) => (i.tags || []).includes(tag.name));
        }
        if (state.query) {
            list = list.filter((i) =>
                [i.name, i.description, i.notes].some((s) => String(s || '').toLowerCase().includes(state.query)));
        }
        if (state.view === 'recent') {
            list = list.filter((i) => i.lastOpenedAt)
                .sort((a, b) => String(b.lastOpenedAt).localeCompare(a.lastOpenedAt))
                .slice(0, 10);
        } else if (state.view === 'common') {
            list = list.filter((i) => (i.openCount || 0) > 0)
                .sort((a, b) => (b.openCount || 0) - (a.openCount || 0))
                .slice(0, 10);
        } else {
            list = [...list].sort((a, b) =>
                (b.pinned - a.pinned) || String(a.name).localeCompare(b.name));
        }
        return list;
    }

    async function doOpen(item, via) {
        try {
            await store.openItem(item.id, via);
            snack(`已打开（${VIA_LABEL[via]}）：${item.name}`);
        } catch (e) {
            snackErr(String(e));
        }
    }

    function togglePin(item) {
        store.setFlags(item.id, !item.pinned, undefined)
            .catch((e) => snackErr(String(e)));
    }

    // ── 批量选择/删除 ──
    function enterSelectMode() {
        state.selectMode = true;
        state.selected.clear();
        renderBatchbar();
        renderCards();
    }

    function exitSelectMode() {
        state.selectMode = false;
        state.selected.clear();
        renderBatchbar();
        renderCards();
    }

    // 勾选只改这一张卡片的类名与勾选框，不重建整个网格：
    // 重建会丢滚动位置与焦点，条目多时肉眼可见地卡。
    function toggleSelect(id) {
        if (state.selected.has(id)) state.selected.delete(id);
        else state.selected.add(id);
        const on = state.selected.has(id);
        const card = cardsGrid.querySelector(`.pm-card[data-item-id="${id}"]`);
        if (card) {
            card.classList.toggle('checked', on);
            const cb = card.querySelector('.pm-card-cb');
            if (cb) cb.checked = on;
        }
        renderBatchbar();
    }

    /**
     * 过滤条件变了就把不在当前视图里的勾选清掉。
     * 否则"勾 3 条 → 切分组 → 点删除"会连带删掉用户已经看不见的条目。
     * 返回勾选集是否真的发生了变化。
     */
    function syncSelection(list) {
        const sig = [state.view, state.categoryId, state.tagId, state.query].join('|');
        if (sig === state.lastFilterSig) return false;
        state.lastFilterSig = sig;
        if (!state.selected.size) return false;
        const visible = new Set(list.map((i) => i.id));
        let dropped = 0;
        for (const id of [...state.selected]) {
            if (!visible.has(id)) { state.selected.delete(id); dropped++; }
        }
        if (dropped) snackWarn(`视图已切换，已取消 ${dropped} 条当前不可见的勾选`);
        return dropped > 0;
    }

    function renderBatchbar() {
        if (!state.selectMode) {
            batchbar.hidden = true;
            batchbar.replaceChildren();
            return;
        }
        batchbar.hidden = false;
        const visible = visibleItems();
        const allSel = visible.length > 0 && visible.every((i) => state.selected.has(i.id));
        const allCb = el('input', { type: 'checkbox' });
        allCb.checked = allSel;
        allCb.addEventListener('change', () => {
            if (allCb.checked) visible.forEach((i) => state.selected.add(i.id));
            else visible.forEach((i) => state.selected.delete(i.id));
            renderBatchbar();
            renderCards();
        });
        // 删的是"已勾选"而不是"当前可见已勾选"，所以把不可见的那部分也报出来
        const visibleIds = new Set(visible.map((i) => i.id));
        const hiddenCount = [...state.selected].filter((id) => !visibleIds.has(id)).length;
        batchbar.replaceChildren(
            el('label', { class: 'pm-batch-all' }, [allCb, '全选（当前视图）']),
            el('span', {
                class: 'label',
                text: hiddenCount
                    ? `已选 ${state.selected.size} 条（含 ${hiddenCount} 条当前不可见）`
                    : `已选 ${state.selected.size} 条`,
            }),
            el('span', { style: 'flex:1' }),
            el('button', {
                class: 'btn btn-danger btn-sm',
                text: '删除所选',
                disabled: state.selected.size === 0,
                onClick: () => {
                    const n = state.selected.size;
                    openConfirm(`删除所选 ${n} 条？该操作不可恢复。`, async () => {
                        try {
                            const r = await store.deleteItems([...state.selected]);
                            state.selected.clear();
                            state.selectMode = false;
                            state.selectedId = null;
                            snack(`已删除 ${r} 条`);
                            renderBatchbar();
                            renderCards();
                        } catch (e) {
                            snackErr(String(e));
                        }
                    }, '删除');
                },
            }),
            el('button', { class: 'btn btn-text btn-sm', text: '退出', onClick: exitSelectMode }),
        );
    }

    async function doRefresh(item) {
        snack('正在重新抓取…');
        try {
            const it = await store.refreshGithubRepo(item.id);
            state.selectedId = it.id;
            snack('已更新：' + it.name);
        } catch (e) {
            snackErr(String(e));
        }
    }

    async function doReplace(item) {
        const file = await store.openDialog({
            multiple: false,
            filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
        });
        if (!file) return;
        try {
            await store.importReadmeManual(item.id, file);
            snack('README 已替换');
        } catch (e) {
            snackErr(String(e));
        }
    }

    // ── 渲染：左栏 ──
    function renderViews() {
        viewList.replaceChildren(...[
            ['all', '全部'], ['fav', '收藏'], ['recent', '最近打开'], ['common', '常用'],
        ].map(([key, label]) => el('button', {
            class: 'pm-view-item' + (state.view === key ? ' active' : ''),
            text: label,
            onClick: () => { state.view = key; renderAll(); },
        })));
    }

    function renderGroups() {
        const items = [
            el('button', {
                class: 'pm-view-item' + (state.categoryId == null ? ' active' : ''),
                text: '全部分组',
                onClick: () => { state.categoryId = null; renderAll(); },
            }),
            ...state.categories.map((c) => {
                const indent = c.parentId ? '16px' : '0';
                const row = el('div', { class: 'pm-group-row' });
                const btn = el('button', {
                    class: 'pm-view-item' + (state.categoryId === c.id ? ' active' : ''),
                    text: c.name,
                    style: `margin-left:${indent}`,
                    onClick: () => { state.categoryId = state.categoryId === c.id ? null : c.id; renderAll(); },
                });
                const ops = el('span', { class: 'pm-group-ops' }, [
                    el('button', {
                        class: 'pm-iconbtn', title: '重命名',
                        onClick: (e) => { e.stopPropagation(); openGroupForm(c); },
                    }, [inlineIcon(Pencil, 12)]),
                    el('button', {
                        class: 'pm-iconbtn', title: '删除分组',
                        onClick: (e) => {
                            e.stopPropagation();
                            openConfirm(`删除分组「${c.name}」？其中的条目会变为未分组。`, async () => {
                                try { await store.removeCategory(c.id); snack('分组已删除'); } catch (err) { snackErr(String(err)); }
                            });
                        },
                    }, [inlineIcon(Trash2, 12)]),
                ]);
                row.append(btn, ops);
                return row;
            }),
        ];
        groupList.replaceChildren(...items);
    }

    function renderTags() {
        tagChips.replaceChildren(...state.tags.map((t) => el('button', {
            class: 'chip' + (state.tagId === t.id ? ' on' : ''),
            text: t.name,
            onClick: () => { state.tagId = state.tagId === t.id ? null : t.id; renderAll(); },
        })));
    }

    // ── 渲染：卡片 ──
    function iconBlock(item, size = 18) {
        const custom = item.icon ? icon(item.icon, size) : null;
        if (custom) return custom;
        // 没设图标、或名字不在白名单里：回落成名称首字母色块
        return el('span', { text: (item.name || '?')[0].toUpperCase() });
    }

    function cardEl(item) {
        const selecting = state.selectMode;
        const checked = selecting && state.selected.has(item.id);
        const actions = el('div', { class: 'pm-card-actions' },
            cfg.vias.map((v) => el('button', {
                class: 'pm-iconbtn', title: VIA_LABEL[v], 'aria-label': VIA_LABEL[v],
                onClick: (e) => { e.stopPropagation(); doOpen(item, v); },
            }, [inlineIcon(VIA_ICON[v], 14)])));

        const iconStyle = item.color
            ? `background:${item.color}22;color:${item.color};`
            : '';
        const group = groupOf(item);

        let cb = null;
        if (selecting) {
            cb = el('input', { type: 'checkbox', class: 'pm-card-cb', 'aria-label': '选择' });
            cb.checked = checked;
            cb.addEventListener('click', (e) => e.stopPropagation());
            cb.addEventListener('change', () => toggleSelect(item.id));
        }

        const card = el('div', {
            class: 'pm-card'
                + (state.selectedId === item.id && !selecting ? ' sel' : '')
                + (selecting ? ' selecting' : '')
                + (checked ? ' checked' : ''),
            // 供勾选时就地定位这张卡片（避免勾一下重建整个网格）
            dataset: { itemId: String(item.id) },
            role: 'button', tabindex: '0',
            onClick: () => {
                if (selecting) { toggleSelect(item.id); return; }
                state.selectedId = item.id;
                renderCards();
                renderDetail();
            },
            onDblclick: () => { if (!selecting) doOpen(item, store.DEFAULT_VIA[item.type]); },
        }, [
            el('div', { class: 'pm-card-head' }, [
                cb,
                el('div', { class: 'pm-icon-block', style: iconStyle }, [iconBlock(item)]),
                el('div', { class: 'pm-card-titles' }, [
                    el('div', { class: 'pm-card-name', text: item.name }),
                    el('div', { class: 'pm-card-sub', text: group ? group.name : '未分组' }),
                ]),
                actions,
            ]),
            el('div', {
                class: 'pm-card-desc',
                text: item.description || item.notes || '—',
            }),
            el('div', { class: 'pm-card-foot' }, [
                el('span', { class: 'pm-card-tags', text: (item.tags || []).join(' / ') }),
                item.pinned ? el('span', { class: 'pm-pin-flag', title: '已收藏' }, [inlineIcon(Star, 13)]) : null,
            ]),
        ]);
        card.addEventListener('keydown', (e) => {
            if (!selecting && e.key === 'Enter') doOpen(item, store.DEFAULT_VIA[item.type]);
        });
        return card;
    }

    function renderCards() {
        const list = visibleItems();
        if (syncSelection(list)) renderBatchbar();
        countLabel.textContent = `${list.length} 条`;
        cardsGrid.replaceChildren(...(list.length
            ? list.map(cardEl)
            : [el('div', { class: 'empty-state', style: 'grid-column:1/-1', text: '没有匹配的条目' })]));
    }

    // ── 渲染：详情 ──
    function joinPath(dir, name) {
        return dir.replace(/[\\/]+$/, '') + '\\' + name;
    }

    /** 键值行。返回行与值节点：值节点要留给"同条目状态刷新"就地改文本。 */
    function metaRow(k, v) {
        const val = el('span', { class: 'v', text: v });
        return { row: el('div', { class: 'kv' }, [el('span', { class: 'k', text: k }), val]), val };
    }

    // 详情栏当前渲染的条目。事件回调必须读它而不是 build 时的闭包变量：
    // 状态刷新之后闭包里的 item 已经是旧对象了（比如备注、收藏状态会回退）。
    let detailItem = null;
    const drefs = {};

    function renderDetail() {
        const item = state.items.find((i) => i.id === state.selectedId) || null;
        if (!item) {
            detailPane.hidden = true;
            detailPane.replaceChildren();
            state.detailItemId = null;
            detailItem = null;
            Object.keys(drefs).forEach((k) => { delete drefs[k]; });
            return;
        }
        detailPane.hidden = false;
        // 同一条目、只是状态变了（打开次数/收藏/备注/编辑内容）：
        // 只刷新会变的字段。重建整个详情栏会把 README 重新读一遍磁盘，
        // 再跑一次 marked + DOMPurify + hljs，而这些内容并没有变。
        if (state.detailItemId === item.id && drefs.name && updateDetail(item)) {
            detailItem = item;
            return;
        }
        detailItem = item;
        state.detailItemId = item.id;
        Object.keys(drefs).forEach((k) => { delete drefs[k]; });
        buildDetail(item);
    }

    /** 就地刷新详情栏里会变的部分；结构相关的东西变了就返回 false 走完整重建 */
    function updateDetail(item) {
        if (!drefs.name || !drefs.opened || !drefs.count || !drefs.path) return false;
        // README 卡片的"该不该出现"变了（例如编辑时补了路径）→ 需要重建
        const shouldShowMd = !!((cfg.readme || cfg.itemReadme) && (item.path || item.readmePath));
        if (!!drefs.mdCard !== shouldShowMd) return false;

        const group = groupOf(item);
        drefs.name.textContent = item.name;
        if (drefs.iconHost) {
            drefs.iconHost.style.cssText = item.color ? `background:${item.color}22;color:${item.color}` : '';
            drefs.iconHost.replaceChildren(iconBlock(item, 20));
        }
        if (drefs.desc) {
            drefs.desc.textContent = item.description || '';
            drefs.desc.hidden = !item.description;
        }
        if (drefs.pin) {
            drefs.pin.style.color = item.pinned ? 'var(--primary)' : '';
            drefs.pin.title = item.pinned ? '取消收藏' : '收藏';
        }
        // 备注正在输入时不要覆盖用户正在敲的内容
        if (drefs.notes && document.activeElement !== drefs.notes) drefs.notes.value = item.notes || '';
        drefs.path.textContent = item.url || item.path || '—';
        drefs.group.textContent = group ? group.name : '未分组';
        drefs.tags.textContent = (item.tags || []).join('、') || '—';
        drefs.opened.textContent = fmtIsoLocal(item.lastOpenedAt, { seconds: true, fallback: '从未' });
        drefs.opened.title = fmtRelativeDay(item.lastOpenedAt, '从未');
        drefs.count.textContent = String(item.openCount || 0);
        return true;
    }

    function buildDetail(item) {
        detailPane.replaceChildren();
        const group = groupOf(item);

        const notesArea = el('textarea', { class: 'textarea', style: 'min-height:70px', placeholder: '备注…' });
        notesArea.value = item.notes || '';
        drefs.notes = notesArea;
        notesArea.addEventListener('change', async () => {
            try {
                // 读 detailItem 而不是闭包里的 item：状态刷新后闭包里的对象是旧的
                await store.saveItem({ ...detailItem, notes: notesArea.value });
                snack('备注已保存');
            } catch (e) { snackErr(String(e)); }
        });

        const mdBox = el('div', { class: 'pm-md-host' });
        const readmeCard = el('div', { class: 'card' }, [
            el('div', { class: 'card-header', text: cfg.docsFiles ? '文档目录' : 'README' }),
            mdBox,
        ]);
        drefs.mdCard = readmeCard;

        // 信息卡片的行先建好再塞进 append：值节点要留引用供就地刷新
        const pathRow = metaRow(isLinkType(item.type) ? '网址' : '路径', item.url || item.path || '—');
        const groupRow = metaRow('分组', group ? group.name : '未分组');
        const tagsRow = metaRow('标签', (item.tags || []).join('、') || '—');
        const openedRow = metaRow('最近打开', fmtIsoLocal(item.lastOpenedAt, { seconds: true, fallback: '从未' }));
        const countRow = metaRow('打开次数', String(item.openCount || 0));
        drefs.path = pathRow.val;
        drefs.group = groupRow.val;
        drefs.tags = tagsRow.val;
        drefs.opened = openedRow.val;
        drefs.count = countRow.val;
        // 精确时间放 title，正文里给"今天/3 天前"这种好读的
        drefs.opened.title = fmtRelativeDay(item.lastOpenedAt, '从未');

        // Node.append() 会把 null 转成文本节点 "null" —— 不像 el()，它不过滤子节点。
        // 最后一个参数是按条件给的 readmeCard，非 README 板块（网址等）恒为 null，
        // 于是详情栏底部会多出一行 "null"。这里统一过滤一次再 append。
        detailPane.append(...[
            el('div', { class: 'card' }, [
                el('div', { class: 'pm-detail-head' }, [
                    (drefs.iconHost = el('div',
                        { class: 'pm-icon-block', style: item.color ? `background:${item.color}22;color:${item.color}` : '' },
                        [iconBlock(item, 20)])),
                    el('div', { class: 'pm-detail-titles' }, [
                        (drefs.name = el('div', { class: 'pm-detail-name', text: item.name })),
                        el('span', { class: 'badge', text: store.TYPE_LABEL[item.type] }),
                    ]),
                    el('div', { class: 'pm-detail-ops' }, [
                        (drefs.pin = el('button', {
                            class: 'pm-iconbtn', title: item.pinned ? '取消收藏' : '收藏',
                            style: item.pinned ? 'color:var(--primary)' : '',
                            onClick: () => togglePin(detailItem),
                        }, [inlineIcon(Star, 15)])),
                        ...(cfg.github ? [
                            el('button', {
                                class: 'pm-iconbtn', title: '重新抓取',
                                onClick: () => doRefresh(detailItem),
                            }, [inlineIcon(RefreshCw, 15)]),
                            el('button', {
                                class: 'pm-iconbtn', title: '替换 README…',
                                onClick: () => doReplace(detailItem),
                            }, [inlineIcon(FileUp, 15)]),
                        ] : []),
                        el('button', {
                            class: 'pm-iconbtn', title: '编辑',
                            onClick: () => openItemForm({ type: cfg.section, item: detailItem, categories: state.categories }),
                        }, [inlineIcon(Pencil, 15)]),
                        el('button', {
                            class: 'pm-iconbtn', title: '关闭详情',
                            onClick: () => { state.selectedId = null; renderCards(); renderDetail(); },
                        }, [inlineIcon(X, 15)]),
                    ]),
                ]),
                // 恒存在，空内容靠 hidden 收起 —— 这样状态刷新能就地改它
                (drefs.desc = el('p', { class: 'hint', text: item.description || '', hidden: !item.description })),
                el('div', { class: 'btn-row', style: 'margin-top:10px' },
                    cfg.vias.map((v) => el('button', {
                        class: 'btn btn-outline btn-sm',
                        onClick: () => doOpen(detailItem, v),
                    }, [inlineIcon(VIA_ICON[v], 13), VIA_LABEL[v]]))),
                el('div', { class: 'btn-row', style: 'margin-top:8px' }, [
                    ...(cfg.github ? [el('button', {
                        class: 'btn btn-text btn-sm', text: 'AI 摘要',
                        onClick: async () => {
                            try {
                                const s = await store.aiSummarizeReadme(detailItem.id);
                                openModal('AI 摘要建议', (content, close) => {
                                    const desc = el('input', { class: 'input', value: s.description || '' });
                                    const tags = el('input', { class: 'input', value: (s.tags || []).join(', ') });
                                    content.append(
                                        el('p', { class: 'hint', text: s.reason || '' , style: 'margin-bottom:10px' }),
                                        fieldWrap('简介', desc),
                                        fieldWrap('标签（逗号分隔）', tags),
                                        el('div', { class: 'btn-row', style: 'justify-content:flex-end' }, [
                                            el('button', { class: 'btn btn-text', text: '跳过', onClick: close }),
                                            el('button', {
                                                class: 'btn btn-primary', text: '应用',
                                                onClick: async () => {
                                                    try {
                                                        await store.saveItem({
                                                            ...detailItem,
                                                            description: desc.value.trim(),
                                                            tags: tags.value.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
                                                        });
                                                        snack('已应用 AI 摘要');
                                                        close();
                                                    } catch (e) { snackErr(String(e)); }
                                                },
                                            }),
                                        ]),
                                    );
                                });
                            } catch (e) { snackErr(String(e)); }
                        },
                    })] : []),
                    el('button', {
                        class: 'btn btn-text btn-sm', text: '归档',
                        onClick: () => {
                            store.setFlags(detailItem.id, undefined, true)
                                .then(() => { state.selectedId = null; snack('已归档'); })
                                .catch((e) => snackErr(String(e)));
                        },
                    }),
                    el('button', {
                        class: 'btn btn-text btn-sm err-text', text: '删除',
                        onClick: () => openConfirm(`删除「${detailItem.name}」？该操作不可恢复。`, async () => {
                            try {
                                await store.removeItem(detailItem.id);
                                state.selectedId = null;
                                snack('已删除');
                            } catch (e) { snackErr(String(e)); }
                        }),
                    }),
                ]),
            ]),
            el('div', { class: 'card' }, [
                el('div', { class: 'card-header', text: '信息' }),
                pathRow.row,
                groupRow.row,
                tagsRow.row,
                openedRow.row,
                countRow.row,
                el('div', { class: 'field', style: 'margin-top:10px' }, [
                    el('span', { class: 'label label-strong', text: '备注（失焦自动保存）' }),
                    notesArea,
                ]),
            ]),
            (cfg.readme || cfg.itemReadme) && (item.path || item.readmePath) ? readmeCard : null,
        ].filter(Boolean));

        // README / 文档目录 / GitHub 本地 README（异步填充）
        const showDir = cfg.readme && item.path;
        const showItemMd = cfg.itemReadme && item.readmePath;
        if (showDir || showItemMd) {
            mdBox.appendChild(el('div', { class: 'loading-row show' }, [
                el('span', { class: 'spinner' }), el('span', { class: 'label', text: '读取中…' }),
            ]));
            (async () => {
                try {
                    if (showItemMd) {
                        // GitHub 收藏：直接读本地化的 README 文件
                        const doc = await store.readMarkdown(item.readmePath);
                        renderMarkdownInto(mdBox, doc);
                    } else if (cfg.docsFiles) {
                        // 文档目录浏览器：文件夹可进入，md 应用内阅读，其他类型交系统程序
                        state.docDir = item.path;
                        const crumb = el('div', { class: 'pm-crumb' });
                        const fileList = el('div', { class: 'pm-filelist' });
                        const mdView = el('div');
                        mdBox.replaceChildren(crumb, fileList, mdView);

                        const extIcon = (ext, isDir) => {
                            const map = {
                                md: 'file-text', txt: 'file-text', doc: 'file-text', docx: 'file-text',
                                rtf: 'file-text', odt: 'file-text', pdf: 'file-text',
                                xls: 'file-spreadsheet', xlsx: 'file-spreadsheet', csv: 'file-spreadsheet',
                                ppt: 'file', pptx: 'file',
                                png: 'file-image', jpg: 'file-image', jpeg: 'file-image', gif: 'file-image',
                                webp: 'file-image', bmp: 'file-image', svg: 'file-image',
                                zip: 'file-archive', rar: 'file-archive', '7z': 'file-archive',
                                js: 'file-code', ts: 'file-code', py: 'file-code', rs: 'file-code',
                                html: 'file-code', css: 'file-code', json: 'file-code',
                                mp3: 'file-audio', wav: 'file-audio', flac: 'file-audio',
                                mp4: 'file-video', mkv: 'file-video', avi: 'file-video',
                            };
                            return icon(isDir ? 'folder' : (map[ext] || 'file'), 14)
                                || inlineIcon(File, 14);
                        };

                        async function readDoc(fileName) {
                            mdView.replaceChildren(el('div', { class: 'loading-row show' }, [
                                el('span', { class: 'spinner' }),
                            ]));
                            try {
                                const doc = await store.readMarkdown(joinPath(state.docDir, fileName));
                                renderMarkdownInto(mdView, doc);
                            } catch (e) {
                                mdView.replaceChildren(el('p', { class: 'hint err-text', text: String(e) }));
                            }
                        }

                        async function loadDir() {
                            fileList.replaceChildren(el('div', { class: 'loading-row show' }, [
                                el('span', { class: 'spinner' }),
                            ]));
                            try {
                                const entries = await store.listDirFiles(state.docDir);
                                // 面包屑：根目录名 / 子目录 / …
                                crumb.replaceChildren();
                                const relPart = state.docDir.slice(item.path.length).replace(/^[\\/]+/, '');
                                const segs = relPart ? relPart.split(/[\\/]+/) : [];
                                crumb.appendChild(el('button', {
                                    class: 'pm-crumb-item' + (segs.length ? '' : ' current'),
                                    text: item.name,
                                    onClick: () => { state.docDir = item.path; loadDir(); },
                                }));
                                let acc = item.path;
                                for (const s of segs) {
                                    acc = acc.replace(/[\\/]+$/, '') + '\\' + s;
                                    const target = acc;
                                    crumb.appendChild(el('span', { class: 'pm-crumb-sep', text: '/' }));
                                    crumb.appendChild(el('button', {
                                        class: 'pm-crumb-item' + (target === state.docDir ? ' current' : ''),
                                        text: s,
                                        onClick: () => { state.docDir = target; loadDir(); },
                                    }));
                                }
                                if (!entries.length) {
                                    fileList.replaceChildren(el('div', { class: 'hint', text: '空目录' }));
                                    return;
                                }
                                fileList.replaceChildren(...entries.map((f) => el('button', {
                                    class: 'pm-file-row',
                                    onClick: async () => {
                                        const full = joinPath(state.docDir, f.name);
                                        if (f.isDir) { state.docDir = full; loadDir(); return; }
                                        if (f.ext === 'md') { readDoc(f.name); return; }
                                        try {
                                            await store.openFile(full);
                                            snack('已用系统程序打开：' + f.name);
                                        } catch (e) { snackErr(String(e)); }
                                    },
                                }, [
                                    el('span', { class: 'pm-file-ico' }, [extIcon(f.ext, f.isDir)]),
                                    el('span', { class: 'pm-file-name', text: f.name }),
                                    el('span', { class: 'pm-file-size', text: f.isDir ? '文件夹' : fmtSize(f.size) }),
                                ])));
                            } catch (e) {
                                fileList.replaceChildren(el('p', { class: 'hint err-text', text: String(e) }));
                            }
                        }

                        await loadDir();
                        // 默认阅读根目录 README（如有）
                        try {
                            const readme = await store.findReadme(item.path);
                            if (readme) {
                                const doc = await store.readMarkdown(readme);
                                renderMarkdownInto(mdView, doc);
                            } else {
                                mdView.replaceChildren(el('div', {
                                    class: 'hint',
                                    text: '点击文件列表阅读 .md；其他类型将用系统默认程序打开',
                                }));
                            }
                        } catch (e) {
                            mdView.replaceChildren(el('p', { class: 'hint err-text', text: String(e) }));
                        }
                    } else {
                        const readme = await store.findReadme(item.path);
                        mdBox.replaceChildren();
                        if (!readme) {
                            mdBox.appendChild(el('div', { class: 'hint', text: '未找到 README.md' }));
                            return;
                        }
                        const doc = await store.readMarkdown(readme);
                        renderMarkdownInto(mdBox, doc);
                    }
                } catch (e) {
                    mdBox.replaceChildren(el('p', { class: 'hint err-text', text: String(e) }));
                }
            })();
        }
    }

    const isLinkType = (t) => t === 'link' || t === 'github';

    // ── 分组表单 ──
    function openGroupForm(cat) {
        openModal(cat ? '重命名分组' : '新建分组', (content, close) => {
            const name = el('input', { class: 'input', value: cat?.name || '', placeholder: '分组名' });
            const parent = el('select', { class: 'select' }, [
                el('option', { value: '', text: '（顶级分组）' }),
                ...state.categories.filter((c) => c.id !== cat?.id && !c.parentId)
                    .map((c) => el('option', { value: String(c.id), text: c.name })),
            ]);
            if (cat?.parentId) parent.value = String(cat.parentId);
            const err = el('p', { class: 'hint err-text' });
            content.append(
                fieldWrap('分组名', name),
                fieldWrap('上级分组', parent),
                err,
                el('div', { class: 'btn-row', style: 'justify-content:flex-end' }, [
                    el('button', { class: 'btn btn-text', text: '取消', onClick: close }),
                    el('button', {
                        class: 'btn btn-primary', text: cat ? '保存' : '创建',
                        onClick: async () => {
                            if (!name.value.trim()) { err.textContent = '分组名不能为空'; return; }
                            try {
                                await store.saveCategory(
                                    cfg.section,
                                    cat?.id ?? null,
                                    name.value,
                                    parent.value ? Number(parent.value) : null,
                                    0,
                                );
                                close();
                                snack(cat ? '分组已更新' : '分组已创建');
                            } catch (e) { err.textContent = String(e); }
                        },
                    }),
                ]),
            );
            name.focus();
        });
    }

    function fieldWrap(label, control) {
        return el('div', { class: 'pm-form-row' }, [
            el('span', { class: 'label label-strong', text: label }),
            control,
        ]);
    }

    function renderAll() {
        renderViews();
        renderGroups();
        renderTags();
        renderBatchbar();
        renderCards();
        renderDetail();
    }

    // 这里必须 await。
    //
    // shell 会等 mount() 的 promise 落地，才把新面板揭示出来（在那之前上一个面板
    // 一直留在屏幕上）。不 await 的话，揭示时数据还没到，用户看到的就是
    // "只有 视图/分组/标签 三个表头，卡片和详情栏都是空的"那一下 —— 也就是
    // 切换时的"闪一下"。只有 await 了，mount() 才等价于"首屏已渲染"。
    await load();

    return {
        destroy() {
            clearTimeout(searchTimer);
            offBus();
        },
    };
}
