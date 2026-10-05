// ─────────────────────────────────────────────────────────────
// ProjectHub / shared/scanimport.js —— 目录扫描批量导入（项目板块）
// 指定根目录 → Rust walkdir 发现 .git 仓库 → 勾选批量入库。
// 已入库的路径自动标记且不可重复勾选。
// ─────────────────────────────────────────────────────────────
import { el, snack, snackErr } from '@rolling/ui-kit/ui';
import { openModal } from './modal.js';
import * as store from './store.js';
import { inlineIcon } from './icons.js';
import { FolderOpen } from 'lucide';

const normPath = (p) => String(p || '').replace(/[\\/]+$/, '').toLowerCase();

function field(label, control) {
    return el('div', { class: 'pm-form-row' }, [
        el('span', { class: 'label label-strong', text: label }),
        control,
    ]);
}

/**
 * 打开扫描导入弹窗。existingPaths = 当前板块已入库的本地路径数组。
 * onDone() 导入成功后回调（板块刷新走事件总线，这里只用于收尾提示）。
 */
export function openScanImport(existingPaths = [], onDone) {
    const existing = new Set(existingPaths.map(normPath));

    openModal('扫描导入本地项目', (content, close) => {
        const rootInput = el('input', { class: 'input', placeholder: '例如 E:\\Projects（最多向下找 3 层）' });
        const pickBtn = el('button', {
            class: 'btn btn-outline btn-sm',
            onClick: async () => {
                const p = await store.openDialog({ directory: true, multiple: false });
                if (p) rootInput.value = p;
            },
        }, [inlineIcon(FolderOpen, 13), '选择目录']);

        const resultList = el('div', { class: 'pm-scan-list' });
        const status = el('p', { class: 'hint', text: '扫描只读目录结构，不会改动任何文件。' });
        const scanBtn = el('button', { class: 'btn btn-tonal', text: '扫描' });
        const importBtn = el('button', { class: 'btn btn-primary', text: '导入所选', disabled: true });

        let found = [];

        function renderResults() {
            if (!found.length) {
                resultList.replaceChildren(el('div', { class: 'empty-state', text: '没有发现 Git 仓库' }));
                importBtn.disabled = true;
                return;
            }
            const boxes = [];
            let selectable = 0;
            found.forEach((r, idx) => {
                const dup = existing.has(normPath(r.path));
                const cb = el('input', { type: 'checkbox' });
                cb.checked = !dup;
                cb.disabled = dup;
                if (!dup) selectable++;
                boxes.push(el('label', {
                    class: 'pm-scan-row' + (dup ? ' dup' : ''),
                    dataset: { idx: String(idx) },
                }, [
                    cb,
                    el('span', { class: 'pm-scan-name', text: r.name }),
                    el('span', { class: 'pm-scan-path', text: r.path }),
                    dup ? el('span', { class: 'badge ok', text: '已入库' }) : null,
                ]));
            });
            resultList.replaceChildren(...boxes);
            importBtn.disabled = selectable === 0;
        }

        scanBtn.addEventListener('click', async () => {
            const root = rootInput.value.trim();
            if (!root) { snack('请先填写或选择根目录', 'err'); return; }
            scanBtn.disabled = true;
            importBtn.disabled = true;
            status.textContent = '扫描中…';
            resultList.replaceChildren(el('div', { class: 'loading-row show' }, [
                el('span', { class: 'spinner' }), el('span', { class: 'label', text: '扫描中…' }),
            ]));
            try {
                found = await store.scanDirectory(root, 3);
                renderResults();
                status.textContent = found.length
                    ? `发现 ${found.length} 个仓库，默认全选（已入库的除外）`
                    : '没有发现 Git 仓库，换个上层目录试试？';
            } catch (e) {
                resultList.replaceChildren();
                status.textContent = '扫描失败：' + e;
            }
            scanBtn.disabled = false;
        });

        importBtn.addEventListener('click', async () => {
            const selected = [];
            resultList.querySelectorAll('.pm-scan-row').forEach((row) => {
                const cb = row.querySelector('input[type="checkbox"]');
                if (cb.checked && !cb.disabled) {
                    const idx = Number(row.dataset.idx);
                    selected.push(found[idx]);
                }
            });
            if (!selected.length) { snack('没有勾选任何仓库', 'err'); return; }
            importBtn.disabled = true;
            scanBtn.disabled = true;
            let ok = 0;
            for (const r of selected) {
                try {
                    await store.saveItem({
                        id: null, type: 'code', name: r.name, path: r.path,
                        url: null, description: '扫描导入', notes: '',
                        categoryId: null, pinned: false, archived: false,
                        color: null, icon: 'folder-git-2', tags: [],
                        readmePath: null, readmeRef: null,
                    });
                    ok++;
                } catch (e) {
                    snackErr(`${r.name} 导入失败：${e}`);
                }
            }
            snack(`已导入 ${ok} 个项目`);
            onDone?.();
            close();
        });

        content.append(
            el('div', { class: 'pm-form-row' }, [
                el('span', { class: 'label label-strong', text: '扫描根目录' }),
                el('div', { class: 'pm-form-inline' }, [rootInput, pickBtn]),
            ]),
            el('div', { class: 'btn-row' }, [scanBtn, importBtn]),
            resultList,
            status,
        );
    });
}
