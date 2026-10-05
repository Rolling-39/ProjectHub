// ─────────────────────────────────────────────────────────────
// ProjectHub / shared/palette.js —— Ctrl+K 跨板块命令面板
// 全局唯一浮层；搜索名称/简介/备注/标签，结果按板块分组。
// ─────────────────────────────────────────────────────────────
import { el, snack, snackErr } from '@rolling/ui-kit/ui';
import * as store from './store.js';
import { inlineIcon, icon } from './icons.js';
import { Search } from 'lucide';

const SECTION_ORDER = ['code', 'docs', 'link', 'github'];
const SECTION_NAME = { code: '项目', docs: '文档', link: '网址', github: 'GitHub' };

let mask = null;
let input = null;
let listBox = null;
let hits = [];
let active = -1;
let debounceTimer = null;

export function installPalette() {
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
            e.preventDefault();
            if (mask) close();
            else open();
        }
    });
}

function close() {
    mask?.remove();
    mask = null;
    hits = [];
    active = -1;
}

function open() {
    close();
    input = el('input', {
        class: 'input', placeholder: '搜索全部板块：名称 / 简介 / 备注 / 标签…',
        style: 'font-size:14px',
    });
    listBox = el('div', { class: 'pm-palette-list' });
    listBox.appendChild(el('div', { class: 'empty-state', text: '输入关键词开始搜索' }));

    mask = el('div', { class: 'pm-modal-mask pm-palette-mask' }, [
        el('div', { class: 'pm-modal pm-palette', role: 'dialog', 'aria-label': '全局搜索' }, [
            el('div', { class: 'pm-palette-inputrow' }, [
                inlineIcon(Search, 16),
                input,
            ]),
            listBox,
            el('div', { class: 'pm-palette-foot' }, [
                el('span', { class: 'label', text: '↑↓ 选择 · Enter 打开 · Esc 关闭' }),
            ]),
        ]),
    ]);
    mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(); });
    document.body.appendChild(mask);
    input.focus();

    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => runSearch(input.value), 160);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); move(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); return; }
        if (e.key === 'Enter') {
            e.preventDefault();
            const h = hits[active];
            if (h) openHit(h);
        }
    });
    runSearch('');
}

async function runSearch(q) {
    try {
        hits = q.trim() ? await store.searchAll(q) : [];
    } catch (e) {
        hits = [];
        listBox.replaceChildren(el('p', { class: 'hint err-text', text: String(e) }));
        return;
    }
    active = hits.length ? 0 : -1;
    renderHits();
}

function renderHits() {
    if (!hits.length) {
        listBox.replaceChildren(el('div', {
            class: 'empty-state',
            text: input.value.trim() ? '没有匹配的结果' : '输入关键词开始搜索',
        }));
        return;
    }
    const nodes = [];
    for (const section of SECTION_ORDER) {
        const group = hits.filter((h) => h.type === section);
        if (!group.length) continue;
        nodes.push(el('div', { class: 'pm-palette-group', text: SECTION_NAME[section] }));
        for (const h of group) {
            const idx = hits.indexOf(h);
            nodes.push(el('div', {
                class: 'pm-hit' + (idx === active ? ' active' : ''),
                dataset: { idx: String(idx) },
                onClick: () => openHit(h),
                onMouseenter: () => { active = idx; paintActive(); },
            }, [
                el('span', { class: 'pm-hit-dot' }, [icon('circle-small', 10) || el('span')]),
                el('span', { class: 'pm-hit-name', text: h.name }),
                el('span', { class: 'pm-hit-desc', text: h.description || h.notes || h.path || h.url || '' }),
            ]));
        }
    }
    listBox.replaceChildren(...nodes);
}

function paintActive() {
    listBox.querySelectorAll('.pm-hit').forEach((n) => {
        n.classList.toggle('active', Number(n.dataset.idx) === active);
    });
    listBox.querySelector('.pm-hit.active')?.scrollIntoView({ block: 'nearest' });
}

function move(delta) {
    if (!hits.length) return;
    active = (active + delta + hits.length) % hits.length;
    paintActive();
}

async function openHit(h) {
    try {
        await store.openItem(h.id, store.DEFAULT_VIA[h.type]);
        snack(`已打开：${h.name}`);
        close();
    } catch (e) {
        snackErr(String(e));
    }
}
