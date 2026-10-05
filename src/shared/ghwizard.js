// ─────────────────────────────────────────────────────────────
// ProjectHub / shared/ghwizard.js —— GitHub 收藏导入向导
// 自动抓取（raw 直连，进度经 github-import 事件）+ 手动导入兜底。
// ─────────────────────────────────────────────────────────────
import { el, snack, snackErr } from '@rolling/ui-kit/ui';
import { listen } from '@rolling/ui-kit/tauri';
import { openModal } from './modal.js';
import * as store from './store.js';

function field(label, control) {
    return el('div', { class: 'pm-form-row' }, [
        el('span', { class: 'label label-strong', text: label }),
        control,
    ]);
}

export function openGhImport() {
    openModal('添加 GitHub 收藏', (content, close) => {
        const url = el('input', { class: 'input', placeholder: 'github.com/owner/repo' });
        const name = el('input', { class: 'input', placeholder: '备注名（可选，默认 owner/repo）' });
        const aiChk = el('input', { type: 'checkbox' });
        aiChk.checked = true;
        const aiRow = el('label', { class: 'pm-form-inline', style: 'cursor:pointer' }, [
            aiChk,
            el('span', { class: 'hint', text: '导入后用 AI 生成一句话简介和标签（需已在设置里配置 AI；失败不影响导入）' }),
        ]);
        const status = el('div', {
            class: 'result-scroll',
            style: 'display:none;max-height:170px;min-height:60px;font-size:11px',
        });
        let running = false;
        let offProgress = null;
        // 面板关闭后自动退订（Esc 关闭也覆盖）
        listen('github-import', (e) => {
            if (!document.contains(status)) {
                offProgress?.();
                return;
            }
            const msg = e?.payload?.message;
            if (msg) log(msg);
        }).then((u) => { offProgress = u; }).catch(() => {});

        const log = (line) => {
            status.style.display = '';
            status.textContent += (status.textContent ? '\n' : '') + line;
            status.scrollTop = status.scrollHeight;
        };

        const innerClose = () => {
            offProgress?.();
            close();
        };

        const fetchBtn = el('button', { class: 'btn btn-primary', text: '自动抓取' });
        const manualBtn = el('button', { class: 'btn btn-outline', text: '手动选择本地 README…' });
        const setRunning = (v) => {
            running = v;
            fetchBtn.disabled = v;
            manualBtn.disabled = v;
        };

        fetchBtn.addEventListener('click', async () => {
            if (running) return;
            if (!url.value.trim()) { snack('请先粘贴仓库地址', 'err'); return; }
            setRunning(true);
            log('— 开始抓取 ' + url.value.trim() + ' —');
            try {
                const item = await store.importGithubRepo(url.value.trim(), name.value);
                log('导入成功：' + item.name);
                if (aiChk.checked) {
                    try {
                        log('AI 摘要生成中…');
                        const s = await store.aiSummarizeReadme(item.id);
                        await store.saveItem({ ...item, description: s.description || item.description, tags: s.tags || [] });
                        log(`AI 摘要：${s.description || '（空）'}`);
                    } catch (e2) {
                        log(`AI 摘要跳过：${e2}`);
                    }
                }
                snack('已导入：' + item.name);
                innerClose();
            } catch (e) {
                log('失败：' + e);
                snackErr('抓取失败，可改用手动导入');
            }
            setRunning(false);
        });

        manualBtn.addEventListener('click', async () => {
            if (running) return;
            const file = await store.openDialog({
                multiple: false,
                filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
            });
            if (!file) return;
            const nm = name.value.trim();
            if (!nm) { snack('手动导入请先填备注名', 'err'); return; }
            setRunning(true);
            try {
                const created = await store.saveItem({
                    id: null, type: 'github', name: nm,
                    path: null, url: url.value.trim() || null,
                    description: '', notes: '', categoryId: null,
                    pinned: false, archived: false, color: null, icon: 'github',
                    tags: [], readmePath: null, readmeRef: null,
                });
                await store.importReadmeManual(created.id, file);
                snack('已导入本地 README');
                innerClose();
            } catch (e) {
                snackErr(String(e));
            }
            setRunning(false);
        });

        content.append(
            field('仓库地址', url),
            field('备注名', name),
            aiRow,
            el('div', { class: 'btn-row' }, [fetchBtn, manualBtn]),
            status,
            el('p', {
                class: 'hint',
                text: '不走 GitHub API：从 raw.githubusercontent.com 直连下载 README 与图片（需能访问 GitHub 的网络，代理开着即可）。私有仓库抓不到，用手动导入。',
            }),
        );
    });
}
