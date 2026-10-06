// 日志面板 —— 用 kit 的日志（内存缓冲 + frontend.log 落盘），排障用
import { el, onLog, logText, clearLog, snack } from '@rolling/ui-kit/ui';

export function mount(root) {
    const box = el('div', {
        class: 'result-scroll',
        style: 'max-height:none;min-height:420px;font-size:11px',
    });
    box.textContent = logText();

    // 日志常成串打出来（AI 补分组名一轮十几行）。每来一行就把上限 2000 行
    // join 一次再整体重设 textContent，会明显卡；合并到下一帧统一刷一次。
    let rafId = 0;
    const off = onLog((line, lines) => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
            rafId = 0;
            box.textContent = line ? lines.join('\n') : '';
            box.scrollTop = box.scrollHeight;
        });
    });

    root.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'card-header', text: '运行日志' }),
        box,
        el('div', { class: 'btn-row' }, [
            el('button', {
                class: 'btn btn-tonal', text: '复制日志',
                onClick: async () => {
                    await navigator.clipboard?.writeText(logText());
                    snack('已复制');
                },
            }),
            el('button', {
                class: 'btn btn-text', text: '清空',
                onClick: () => { clearLog(); snack('已清空'); },
            }),
        ]),
    ]));

    return {
        destroy() {
            cancelAnimationFrame(rafId);
            off();
        },
    };
}
