// 设置面板 —— 主题色 + 明暗模式 + 通用（编辑器命令） + 数据（导入/导出）
import { el, snack, snackErr } from '@rolling/ui-kit/ui';
import {
    applyAccent, setThemeMode, getAccent, getMode, persistSetting,
    PRESET_COLORS, hexToRgb, DEFAULT_ACCENT,
} from '../theme-color.js';
import * as store from '../shared/store.js';

function normalize(hex) {
    const rgb = hexToRgb(hex);
    return rgb ? '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('') : DEFAULT_ACCENT;
}

export function mount(root) {
    // ── 主题色 ──
    const swatches = PRESET_COLORS.map((c) => {
        const btn = el('button', {
            class: 'pm-swatch' + (c.toLowerCase() === getAccent() ? ' on' : ''),
            title: c,
            style: `background:${c}`,
            onClick: () => pick(c),
        });
        btn.dataset.color = c;
        return btn;
    });

    const colorInput = el('input', { type: 'color', value: normalize(getAccent()) });
    const hexInput = el('input', { class: 'input pm-hex-input', value: getAccent(), spellcheck: 'false' });

    function markSwatch(hex) {
        swatches.forEach((b) => b.classList.toggle('on', b.dataset.color.toLowerCase() === hex));
    }

    async function pick(hex) {
        if (!applyAccent(hex)) {
            snack('无效的颜色值：' + hex, 'err');
            return;
        }
        hexInput.value = normalize(getAccent());
        colorInput.value = normalize(getAccent());
        markSwatch(getAccent());
        await persistSetting('accent', getAccent());
    }

    colorInput.addEventListener('input', () => pick(colorInput.value));
    hexInput.addEventListener('change', () => pick(hexInput.value));

    // ── 明暗模式 ──
    const modeBtns = ['system', 'light', 'dark'].map((m) => {
        const label = { system: '跟随系统', light: '亮色', dark: '暗色' }[m];
        const b = el('button', {
            class: 'toggle-btn' + (m === getMode() ? ' active' : ''),
            text: label,
            onClick: async () => {
                modeBtns.forEach((x) => x.classList.remove('active'));
                b.classList.add('active');
                await setThemeMode(m);
            },
        });
        return b;
    });

    // ── AI 助手配置 ──
    const aiUrl = el('input', { class: 'input', placeholder: 'https://api.deepseek.com/v1' });
    const aiKey = el('input', { class: 'input', type: 'password', placeholder: 'sk-…' });
    const aiModel = el('input', { class: 'input', placeholder: 'deepseek-chat' });
    const aiStatus = el('span', { class: 'label', text: '' });
    const eyeBtn = el('button', {
        class: 'btn btn-text btn-sm', text: '显示',
        onClick: () => {
            const hidden = aiKey.type === 'password';
            aiKey.type = hidden ? 'text' : 'password';
            eyeBtn.textContent = hidden ? '隐藏' : '显示';
        },
    });
    store.getSetting('ai_base_url').then((v) => { if (v) aiUrl.value = v; }).catch(() => {});
    store.getSetting('ai_api_key').then((v) => { if (v) aiKey.value = v; }).catch(() => {});
    store.getSetting('ai_model').then((v) => { if (v) aiModel.value = v; }).catch(() => {});

    const aiSave = el('button', {
        class: 'btn btn-tonal btn-sm', text: '保存配置',
        onClick: async () => {
            try {
                await store.setSetting('ai_base_url', aiUrl.value.trim());
                await store.setSetting('ai_api_key', aiKey.value.trim());
                await store.setSetting('ai_model', aiModel.value.trim());
                snack('AI 配置已保存');
            } catch (e) { snackErr(String(e)); }
        },
    });
    const aiPing = el('button', {
        class: 'btn btn-outline btn-sm', text: '测试连接',
        onClick: async () => {
            aiPing.disabled = true;
            aiStatus.textContent = '测试中…';
            try {
                const reply = await store.aiTest();
                aiStatus.textContent = `连接正常，模型回复：${reply}`;
            } catch (e) {
                aiStatus.textContent = '失败：' + e;
            }
            aiPing.disabled = false;
        },
    });

    // ── 系统提示词（可查看/修改/恢复默认） ──
    const PROMPT_NAMES = {
        complete: '① 条目补全提示词',
        organize: '② 整理/指令提示词',
        summary: '③ GitHub 摘要提示词',
        chat: '④ 纯对话提示词',
    };
    const promptsWrap = el('div', { class: 'pm-prompt-wrap' });
    store.aiGetPrompts().then(({ prompts, defaults }) => {
        promptsWrap.replaceChildren(...Object.entries(prompts).map(([key, val]) => {
            const ta = el('textarea', {
                class: 'textarea',
                style: 'min-height:90px;font-size:11px;font-family:var(--mono)',
            });
            ta.value = val;
            const details = el('details', { class: 'pm-prompt-details' }, [
                el('summary', { class: 'label label-strong', text: PROMPT_NAMES[key] || key }),
                ta,
                el('div', { class: 'btn-row', style: 'margin-top:6px' }, [
                    el('button', {
                        class: 'btn btn-text btn-sm', text: '恢复默认',
                        onClick: () => { ta.value = defaults[key] || ''; },
                    }),
                    el('button', {
                        class: 'btn btn-tonal btn-sm', text: '保存此提示词',
                        onClick: async () => {
                            try {
                                await store.setSetting('ai_prompt_' + key, ta.value);
                                snack('提示词已保存（留空即恢复默认）');
                            } catch (e) { snackErr(String(e)); }
                        },
                    }),
                ]),
            ]);
            return details;
        }));
    }).catch((e) => {
        promptsWrap.replaceChildren(el('p', { class: 'hint err-text', text: String(e) }));
    });

    // ── 通用：编辑器命令 ──
    const editorInput = el('input', { class: 'input', value: 'code', placeholder: 'code' });
    editorInput.addEventListener('change', async () => {
        try {
            await store.setSetting('editor_cmd', editorInput.value.trim() || 'code');
            snack('编辑器命令已保存');
        } catch (e) { snackErr(String(e)); }
    });
    store.getSetting('editor_cmd').then((v) => {
        if (typeof v === 'string' && v) editorInput.value = v;
    }).catch(() => {});

    // ── 数据：导入/导出 ──
    const exportBtn = el('button', {
        class: 'btn btn-tonal', text: '导出备份…',
        onClick: async () => {
            try {
                const r = await store.exportData();
                if (r) snack(`已导出 ${r.count} 条 → ${r.path}`);
            } catch (e) { snackErr(String(e)); }
        },
    });
    const importBtn = el('button', {
        class: 'btn btn-outline', text: '导入备份…',
        onClick: async () => {
            try {
                const r = await store.importData();
                if (r) snack(`已导入 ${r.count} 条，各板块已刷新`);
            } catch (e) { snackErr(String(e)); }
        },
    });

    root.append(
        el('div', { class: 'card' }, [
            el('div', { class: 'card-header', text: '主题色' }),
            el('div', { class: 'pm-swatches' }, swatches),
            el('div', { class: 'pm-accent-row' }, [
                colorInput,
                hexInput,
                el('span', { class: 'hint', text: '预设 / 调色盘 / 16 进制（如 #39C5BB），全应用即时生效' }),
            ]),
        ]),
        el('div', { class: 'card' }, [
            el('div', { class: 'card-header', text: '明暗模式' }),
            el('div', { class: 'toggle-group' }, modeBtns),
            el('p', { class: 'hint', text: '跟随系统时自动切换；锁定后不再随系统变化。' }),
        ]),
        el('div', { class: 'card' }, [
            el('div', { class: 'card-header', text: 'AI 助手（OpenAI 兼容）' }),
            el('div', { class: 'pm-form-row' }, [
                el('span', { class: 'label label-strong', text: 'Base URL（不含 /chat/completions）' }),
                aiUrl,
            ]),
            el('div', { class: 'pm-form-row' }, [
                el('span', { class: 'label label-strong', text: 'API Key（仅存本地）' }),
                el('div', { class: 'pm-form-inline' }, [aiKey, eyeBtn]),
            ]),
            el('div', { class: 'pm-form-row' }, [
                el('span', { class: 'label label-strong', text: '模型名' }),
                aiModel,
            ]),
            el('div', { class: 'btn-row' }, [aiSave, aiPing, aiStatus]),
            el('p', { class: 'hint', text: 'DeepSeek：https://api.deepseek.com/v1 + deepseek-chat；智谱：https://open.bigmodel.cn/api/paas/v4 + glm-4-flash 等任意 OpenAI 兼容服务均可。调用时会把条目名称/简介/备注/标签（GitHub 收藏含 README 文本）发送给该服务商。' }),
            el('div', { class: 'pm-form-row', style: 'margin-top:12px' }, [
                el('span', { class: 'label label-strong', text: '系统提示词（点击展开查看/修改，留空用内置默认）' }),
                promptsWrap,
            ]),
        ]),
        el('div', { class: 'card' }, [
            el('div', { class: 'card-header', text: '通用' }),
            el('div', { class: 'pm-form-row' }, [
                el('span', { class: 'label label-strong', text: '编辑器命令（打开项目用，支持带参数）' }),
                editorInput,
                el('span', { class: 'hint', text: '默认 code（VS Code）。JetBrains 系可填如 idea64，或自定义可执行文件名。' }),
            ]),
        ]),
        el('div', { class: 'card' }, [
            el('div', { class: 'card-header', text: '数据' }),
            el('div', { class: 'btn-row' }, [exportBtn, importBtn]),
            el('p', { class: 'hint', text: '备份为 JSON（条目/分组/标签/设置）。GitHub 收藏的图片资产目录暂不随备份打包（M2）。' }),
        ]),
        el('div', { class: 'card' }, [
            el('div', { class: 'card-header', text: '关于' }),
            el('p', { class: 'hint', text: 'ProjectHub v0.1.0（M1）· UI：@rolling/ui-kit' }),
            el('button', {
                class: 'btn btn-text', text: '打开日志面板',
                onClick: () => window.__shell?.showPanel('log'),
            }),
        ]),
    );

    return {};
}
