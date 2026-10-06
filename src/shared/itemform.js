// ─────────────────────────────────────────────────────────────
// ProjectHub / shared/itemform.js —— 条目新增/编辑表单
// ─────────────────────────────────────────────────────────────
import { el, snack, snackErr } from '@rolling/ui-kit/ui';
import { openModal } from './modal.js';
import * as store from './store.js';
import { inlineIcon, icon, hasIcon, ICON_NAMES } from './icons.js';
import { hexToRgb } from '../theme-color.js';
import { FolderOpen, Sparkles } from 'lucide';

function field(labelText, control) {
    return el('div', { class: 'pm-form-row' }, [
        el('span', { class: 'label label-strong', text: labelText }),
        control,
    ]);
}

/**
 * 图标选择器：把白名单里的名字和图标一起摆出来。
 * 原先只有一个自由输入框，要求用户盲猜 kebab-case 名（如 folder-git-2），
 * 猜错还会静默存进库里 —— 换成能看见、能筛的网格。
 *
 * 它是**内联展开在表单里的面板**，不是第二个模态。原因有两条：
 *   1. openModal() 的第一件事就是 closeModal()（"同屏只保留一个，新的顶掉旧的"），
 *      在表单里再开一个模态会把表单本身关掉 —— 表现就是"点选择图标、挑一个，
 *      然后整个添加界面没了"。
 *   2. 模态的 Esc 监听挂在 document 的捕获阶段，两层模态会互相抢（先注册的那个
 *      先响应，按 Esc 反而关掉底层表单）。内联面板从根上避开这个问题。
 *
 * 返回面板节点（默认隐藏），由调用方负责显隐。
 */
function buildIconPicker(onPick) {
    const search = el('input', {
        class: 'input',
        placeholder: '筛选，如 file / folder / git / book…',
        style: 'margin-bottom:10px',
        spellcheck: 'false',
    });
    const grid = el('div', { class: 'pm-icon-grid' });
    const hint = el('p', { class: 'hint', style: 'margin:8px 2px 0' });

    function render(q) {
        const kw = q.trim().toLowerCase();
        const list = kw ? ICON_NAMES.filter((n) => n.includes(kw)) : ICON_NAMES;
        hint.textContent = kw
            ? `匹配 ${list.length} / ${ICON_NAMES.length} 个`
            : `共 ${list.length} 个可选图标，点一下即选中`;
        if (!list.length) {
            grid.replaceChildren(el('div', { class: 'empty-state', text: '没有匹配的图标' }));
            return;
        }
        grid.replaceChildren(...list.map((n) => el('button', {
            class: 'pm-icon-pick', title: n, 'aria-label': n,
            onClick: () => onPick(n),
        }, [icon(n, 18), el('span', { class: 'pm-icon-pick-name', text: n })])));
    }
    search.addEventListener('input', () => render(search.value));
    render('');
    return el('div', { class: 'pm-icon-picker', hidden: true }, [search, grid, hint]);
}

/**
 * 打开条目表单。item 为 null 表示新增。
 * ctx = { type, categories, item? }
 */
export function openItemForm(ctx) {
    const { type, categories } = ctx;
    const item = ctx.item || null;
    const isLink = type === 'link' || type === 'github';
    const isGh = type === 'github';
    const title = (item ? '编辑' : '添加') + store.TYPE_LABEL[type];

    const name = el('input', { class: 'input', value: item?.name || '', placeholder: '必填，自己起个好认的名字' });
    const path = el('input', { class: 'input', value: item?.path || '', placeholder: '例如 E:\\Projects\\demo' });
    const url = el('input', { class: 'input', value: item?.url || '', placeholder: isGh ? 'github.com/owner/repo' : 'https://…' });
    const description = el('input', { class: 'input', value: item?.description || '', placeholder: '一行简介（可选）' });
    const notes = el('textarea', { class: 'textarea', style: 'min-height:80px', placeholder: '自由备注（可选）' });
    notes.value = item?.notes || '';
    const tagsInput = el('input', { class: 'input', value: (item?.tags || []).join(', '), placeholder: '用逗号分隔，如 rust, 工具' });
    // 外观：颜色默认"跟随主题色"，选"自定义"才写入 color 字段
    const normalizeHex = (hex) => {
        const rgb = hexToRgb(hex);
        return rgb ? '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('') : null;
    };
    const accentHex = (() => {
        const rgb = getComputedStyle(document.documentElement).getPropertyValue('--primary-rgb').trim();
        if (!rgb) return '#39C5BB';
        return '#' + rgb.split(',').map((v) => Number(v.trim()).toString(16).padStart(2, '0')).join('');
    })();
    const color = el('input', { type: 'color', value: normalizeHex(item?.color) || accentHex });
    let colorMode = item?.color ? 'custom' : 'theme';
    const colorWrap = el('span', { style: 'display:' + (colorMode === 'custom' ? 'inline-flex' : 'none') });
    colorWrap.appendChild(color);
    const iconInput = el('input', {
        class: 'input',
        value: item?.icon || '',
        placeholder: '点「选择图标」挑一个（可选）',
        spellcheck: 'false',
    });
    const iconPreview = el('span', { class: 'pm-icon-preview', title: '当前图标' });

    /** 预览：名字无效时显示问号，让"存了个渲染不出来的名字"当场可见 */
    function paintIconPreview() {
        const v = iconInput.value.trim();
        iconPreview.replaceChildren();
        iconPreview.classList.toggle('bad', !!v && !hasIcon(v));
        if (!v) {
            iconPreview.appendChild(el('span', { text: '—' }));
            iconPreview.title = '未设置图标，卡片显示名称首字母';
            return;
        }
        const node = icon(v, 16);
        if (node) {
            iconPreview.appendChild(node);
            iconPreview.title = '当前图标：' + v;
        } else {
            iconPreview.appendChild(el('span', { text: '?' }));
            iconPreview.title = '名字不在可用列表里：' + v;
        }
    }
    iconInput.addEventListener('input', paintIconPreview);

    const iconPicker = buildIconPicker(pickIcon);
    let iconPickerOpen = false;
    const iconPickBtn = el('button', {
        class: 'btn btn-outline btn-sm', text: '选择图标',
        onClick: () => setIconPickerOpen(!iconPickerOpen),
    });
    const iconClearBtn = el('button', {
        class: 'btn btn-text btn-sm', text: '不用图标',
        onClick: () => { iconInput.value = ''; paintIconPreview(); setIconPickerOpen(false); },
    });

    /** 选中一个图标：填进输入框、刷新预览、收起面板（收起来才算"选完了"） */
    function pickIcon(picked) {
        iconInput.value = picked;
        paintIconPreview();
        setIconPickerOpen(false);
    }

    function setIconPickerOpen(open) {
        iconPickerOpen = open;
        iconPicker.hidden = !open;
        iconPickBtn.textContent = open ? '收起' : '选择图标';
        if (open) iconPicker.querySelector('input')?.focus();
    }

    paintIconPreview();

    const colorModeBtns = [
        { key: 'theme', label: '跟随主题' },
        { key: 'custom', label: '自定义' },
    ].map((m) => {
        const b = el('button', { class: 'toggle-btn', text: m.label });
        b.dataset.mode = m.key;
        b.classList.toggle('active', colorMode === m.key);
        b.addEventListener('click', () => {
            colorMode = m.key;
            colorModeBtns.forEach((x) => x.classList.toggle('active', x.dataset.mode === m.key));
            colorWrap.style.display = m.key === 'custom' ? 'inline-flex' : 'none';
            if (colorHint) colorHint.textContent = m.key === 'custom' ? '' : '图标色块将跟随主题色';
        });
        return b;
    });
    const colorHint = el('span', { class: 'hint', text: colorMode === 'custom' ? '' : '图标色块将跟随主题色' });

    const groupSel = el('select', { class: 'select' }, [
        el('option', { value: '', text: '（无分组）' }),
        ...categories.map((c) => el('option', { value: String(c.id), text: c.name })),
    ]);
    if (item?.categoryId != null) groupSel.value = String(item.categoryId);

    let pinned = !!item?.pinned;
    const pinBtns = ['否', '是'].map((lbl, i) => {
        const b = el('button', {
            class: 'toggle-btn' + ((i === 1) === pinned ? ' active' : ''),
            text: lbl,
            onClick: () => {
                pinned = i === 1;
                pinBtns.forEach((x, j) => x.classList.toggle('active', (j === 1) === pinned));
            },
        });
        return b;
    });

    const row = el('div', { class: 'pm-form-inline' });

    if (!isLink) {
        const pick = el('button', {
            class: 'btn btn-outline btn-sm', text: '选择目录',
            onClick: async () => {
                const p = await store.openDialog({ directory: true, multiple: false });
                if (p) path.value = p;
            },
        }, [inlineIcon(FolderOpen, 13), '选择目录']);
        row.append(path, pick);
    }

    // AI 补全（仅编辑已有条目时可用）：结果填进表单，仍需点"保存"落库
    const aiBtn = item?.id ? el('button', {
        class: 'btn btn-text btn-sm',
        onClick: async () => {
            aiBtn.disabled = true;
            try {
                const s = await store.aiCompleteItem(item.id);
                if (s.description) description.value = s.description;
                if (Array.isArray(s.tags) && s.tags.length) tagsInput.value = s.tags.join(', ');
                if (s.groupId != null && groupSel.querySelector(`option[value="${s.groupId}"]`)) {
                    groupSel.value = String(s.groupId);
                }
                if (s.color && hexToRgb(s.color)) {
                    colorMode = 'custom';
                    colorModeBtns.forEach((x) => x.classList.toggle('active', x.dataset.mode === 'custom'));
                    colorWrap.style.display = 'inline-flex';
                    color.value = normalizeHex(s.color) || color.value;
                }
                snack('AI 补全完成' + (s.reason ? `：${s.reason}` : '') + '，检查后点保存');
            } catch (e) {
                snackErr(String(e));
            }
            aiBtn.disabled = false;
        },
    }, [inlineIcon(Sparkles, 13), 'AI 补全']) : null;

    const err = el('p', { class: 'hint err-text', style: 'display:none' });

    const modal = openModal(title, (content, close) => {
        content.append(
            field('名称', name),
            isLink ? field(isGh ? '仓库地址' : '网址', url) : field('本地路径', row),
            el('div', { class: 'pm-form-row' }, [
                el('div', { class: 'pm-form-inline', style: 'justify-content:space-between' }, [
                    el('span', { class: 'label label-strong', text: '简介' }),
                    aiBtn,
                ].filter(Boolean)),
                description,
            ]),
            field('备注', notes),
            field('分组', groupSel),
            field('标签', tagsInput),
            el('div', { class: 'pm-form-row' }, [
                el('span', { class: 'label label-strong', text: '外观' }),
                el('div', { class: 'pm-form-inline' }, [
                    el('div', { class: 'toggle-group' }, colorModeBtns),
                    colorWrap,
                    colorHint,
                ]),
                el('div', { class: 'pm-form-inline', style: 'margin-top:8px' }, [
                    el('span', { class: 'label', text: '图标', style: 'flex-shrink:0' }),
                    iconPreview,
                    iconInput,
                    iconPickBtn,
                    iconClearBtn,
                ]),
                iconPicker,
                el('div', { class: 'pm-form-inline', style: 'margin-top:8px' }, [
                    el('span', { class: 'label', text: '收藏置顶', style: 'flex-shrink:0' }),
                    el('div', { class: 'toggle-group' }, pinBtns),
                    el('span', { class: 'hint', text: '选"是"＝固定在列表顶部并出现在收藏视图', style: 'margin-left:8px' }),
                ]),
            ]),
            err,
            el('div', { class: 'btn-row', style: 'justify-content:flex-end' }, [
                el('button', { class: 'btn btn-text', text: '取消', onClick: close }),
                el('button', {
                    class: 'btn btn-primary',
                    text: item ? '保存' : '添加',
                    onClick: async () => {
                        const tags = tagsInput.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
                        const input = {
                            id: item?.id ?? null,
                            type,
                            name: name.value.trim(),
                            path: isLink ? null : path.value.trim() || null,
                            url: isLink ? url.value.trim() || null : null,
                            description: description.value.trim(),
                            notes: notes.value,
                            categoryId: groupSel.value ? Number(groupSel.value) : null,
                            pinned,
                            archived: item?.archived ?? false,
                            color: colorMode === 'custom' ? color.value : null,
                            icon: iconInput.value.trim() || null,
                            tags,
                            readmePath: item?.readmePath ?? null,
                            readmeRef: item?.readmeRef ?? null,
                        };
                        if (!input.name) { err.textContent = '名称不能为空'; err.style.display = ''; return; }
                        if (isLink && !input.url) { err.textContent = (isGh ? '仓库地址' : '网址') + '不能为空'; err.style.display = ''; return; }
                        if (!isLink && !input.path) { err.textContent = '本地路径不能为空'; err.style.display = ''; return; }
                        // 名字不在白名单里就存，等于存一个渲染不出来的图标：
                        // 卡片会静默退回首字母，用户以为是自己没设成功。当场拦住。
                        const iconVal = iconInput.value.trim();
                        if (iconVal && !hasIcon(iconVal)) {
                            err.textContent = `图标名「${iconVal}」不在可用列表里，请点「选择图标」挑一个`;
                            err.style.display = '';
                            return;
                        }
                        try {
                            await store.saveItem(input);
                            snack(item ? '已保存' : '已添加');
                            close();
                        } catch (e) {
                            err.textContent = String(e);
                            err.style.display = '';
                        }
                    },
                }),
            ]),
        );
    });
    void modal;
}
