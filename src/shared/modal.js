// ─────────────────────────────────────────────────────────────
// ProjectHub / shared/modal.js —— 轻量模态（表单/确认框共用）
// ─────────────────────────────────────────────────────────────
import { el } from '@rolling/ui-kit/ui';

/**
 * 打开模态。build(contentEl, close) 里构建内容；返回 close 函数。
 * Esc / 点遮罩关闭。同屏只保留一个（新开的顶掉旧的）。
 */
export function openModal(title, build) {
    closeModal();
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const close = () => {
        document.removeEventListener('keydown', onKey, { capture: true });
        mask.remove();
    };
    const content = el('div', { class: 'pm-modal-body' });
    const card = el('div', { class: 'pm-modal', role: 'dialog', 'aria-label': title }, [
        el('div', { class: 'pm-modal-head' }, [
            el('span', { class: 'pm-modal-title', text: title }),
            el('button', { class: 'pm-iconbtn', 'aria-label': '关闭', onClick: close },
                [el('span', { text: '×', style: 'font-size:18px;line-height:1' })]),
        ]),
        content,
    ]);
    const mask = el('div', { class: 'pm-modal-mask' }, [card]);
    mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(); });
    document.addEventListener('keydown', onKey, { capture: true });
    build(content, close);
    document.body.appendChild(mask);
    return close;
}

export function closeModal() {
    document.querySelector('.pm-modal-mask')?.remove();
}

/** 确认框：openConfirm('确认删除？', async () => {...}) */
export function openConfirm(message, onOk, okLabel = '删除') {
    openModal('确认操作', (content, close) => {
        content.append(
            el('p', { class: 'hint', text: message, style: 'margin-bottom:16px' }),
            el('div', { class: 'btn-row', style: 'justify-content:flex-end' }, [
                el('button', { class: 'btn btn-text', text: '取消', onClick: close }),
                el('button', {
                    class: 'btn btn-danger',
                    text: okLabel,
                    onClick: async () => { close(); await onOk(); },
                }),
            ]),
        );
    });
}
