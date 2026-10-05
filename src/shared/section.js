// ─────────────────────────────────────────────────────────────
// ProjectHub / shared/section.js —— 板块三列布局
// 子视图栏（视图/分组/标签） + 卡片网格 + 详情（含 README）
// 四个板块共用，差异通过 cfg 注入：
//   { section, title, vias: ['explorer'|'terminal'|'editor'|'browser'][],
//     readme: bool, docsFiles: bool }
// ─────────────────────────────────────────────────────────────
import { el, snack, snackErr, on, fmtSize } from '@rolling/ui-kit/ui';
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

export function mountSection(root, cfg) {
    const state = {
        items: [], categories: [], tags: [],
        view: 'all',            // all | fav | recent | common
        categoryId: null,
        tagId: null,
        query: '',
        selectedId: null,
        selectMode: false,      // 批量选择模式
        selected: new Set(),    // 勾选的条目 id
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

    searchInput.addEventListener('input', () => {
        state.query = searchInput.value.trim().toLowerCase();
        renderCards();
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
    const offBus = on('items-changed', ({ section } = {}) => {
        if (!section || section === '*' || section === cfg.section) load();
    });

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

    function toggleSelect(id) {
        if (state.selected.has(id)) state.selected.delete(id);
        else state.selected.add(id);
        renderBatchbar();
        renderCards();
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
        batchbar.replaceChildren(
            el('label', { class: 'pm-batch-all' }, [allCb, '全选（当前视图）']),
            el('span', { class: 'label', text: `已选 ${state.selected.size} 条` }),
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
        if (item.icon) return el('span', { text: (item.name || '?')[0].toUpperCase() });
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
        countLabel.textContent = `${list.length} 条`;
        cardsGrid.replaceChildren(...(list.length
            ? list.map(cardEl)
            : [el('div', { class: 'empty-state', style: 'grid-column:1/-1', text: '没有匹配的条目' })]));
    }

    // ── 渲染：详情 ──
    function joinPath(dir, name) {
        return dir.replace(/[\\/]+$/, '') + '\\' + name;
    }

    function metaRow(k, v) {
        return el('div', { class: 'kv' }, [el('span', { class: 'k', text: k }), el('span', { class: 'v', text: v })]);
    }

    function renderDetail() {
        const item = state.items.find((i) => i.id === state.selectedId) || null;
        detailPane.replaceChildren();
        if (!item) { detailPane.hidden = true; return; }
        detailPane.hidden = false;
        const group = groupOf(item);

        const notesArea = el('textarea', { class: 'textarea', style: 'min-height:70px', placeholder: '备注…' });
        notesArea.value = item.notes || '';
        notesArea.addEventListener('change', async () => {
            try {
                await store.saveItem({ ...item, notes: notesArea.value });
                snack('备注已保存');
            } catch (e) { snackErr(String(e)); }
        });

        const mdBox = el('div', { class: 'pm-md-host' });
        const readmeCard = el('div', { class: 'card' }, [
            el('div', { class: 'card-header', text: cfg.docsFiles ? '文档目录' : 'README' }),
            mdBox,
        ]);

        detailPane.append(
            el('div', { class: 'card' }, [
                el('div', { class: 'pm-detail-head' }, [
                    el('div', { class: 'pm-icon-block', style: item.color ? `background:${item.color}22;color:${item.color}` : '' },
                        [iconBlock(item, 20)]),
                    el('div', { class: 'pm-detail-titles' }, [
                        el('div', { class: 'pm-detail-name', text: item.name }),
                        el('span', { class: 'badge', text: store.TYPE_LABEL[item.type] }),
                    ]),
                    el('div', { class: 'pm-detail-ops' }, [
                        el('button', {
                            class: 'pm-iconbtn', title: item.pinned ? '取消收藏' : '收藏',
                            style: item.pinned ? 'color:var(--primary)' : '',
                            onClick: () => togglePin(item),
                        }, [inlineIcon(Star, 15)]),
                        ...(cfg.github ? [
                            el('button', {
                                class: 'pm-iconbtn', title: '重新抓取',
                                onClick: () => doRefresh(item),
                            }, [inlineIcon(RefreshCw, 15)]),
                            el('button', {
                                class: 'pm-iconbtn', title: '替换 README…',
                                onClick: () => doReplace(item),
                            }, [inlineIcon(FileUp, 15)]),
                        ] : []),
                        el('button', {
                            class: 'pm-iconbtn', title: '编辑',
                            onClick: () => openItemForm({ type: cfg.section, item, categories: state.categories }),
                        }, [inlineIcon(Pencil, 15)]),
                        el('button', {
                            class: 'pm-iconbtn', title: '关闭详情',
                            onClick: () => { state.selectedId = null; renderCards(); renderDetail(); },
                        }, [inlineIcon(X, 15)]),
                    ]),
                ]),
                item.description ? el('p', { class: 'hint', text: item.description }) : null,
                el('div', { class: 'btn-row', style: 'margin-top:10px' },
                    cfg.vias.map((v) => el('button', {
                        class: 'btn btn-outline btn-sm',
                        onClick: () => doOpen(item, v),
                    }, [inlineIcon(VIA_ICON[v], 13), VIA_LABEL[v]]))),
                el('div', { class: 'btn-row', style: 'margin-top:8px' }, [
                    ...(cfg.github ? [el('button', {
                        class: 'btn btn-text btn-sm', text: 'AI 摘要',
                        onClick: async () => {
                            try {
                                const s = await store.aiSummarizeReadme(item.id);
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
                                                            ...item,
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
                            store.setFlags(item.id, undefined, true)
                                .then(() => { state.selectedId = null; snack('已归档'); })
                                .catch((e) => snackErr(String(e)));
                        },
                    }),
                    el('button', {
                        class: 'btn btn-text btn-sm err-text', text: '删除',
                        onClick: () => openConfirm(`删除「${item.name}」？该操作不可恢复。`, async () => {
                            try {
                                await store.removeItem(item.id);
                                state.selectedId = null;
                                snack('已删除');
                            } catch (e) { snackErr(String(e)); }
                        }),
                    }),
                ]),
            ]),
            el('div', { class: 'card' }, [
                el('div', { class: 'card-header', text: '信息' }),
                metaRow(isLinkType(item.type) ? '网址' : '路径', item.url || item.path || '—'),
                metaRow('分组', group ? group.name : '未分组'),
                metaRow('标签', (item.tags || []).join('、') || '—'),
                metaRow('最近打开', item.lastOpenedAt ? item.lastOpenedAt.slice(0, 19).replace('T', ' ') : '从未'),
                metaRow('打开次数', String(item.openCount || 0)),
                el('div', { class: 'field', style: 'margin-top:10px' }, [
                    el('span', { class: 'label label-strong', text: '备注（失焦自动保存）' }),
                    notesArea,
                ]),
            ]),
            (cfg.readme || cfg.itemReadme) && (item.path || item.readmePath) ? readmeCard : null,
        );

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

    load();

    return { destroy: () => offBus() };
}
