// ─────────────────────────────────────────────────────────────
// ProjectHub / theme-color.js —— 主题色 accent 与亮暗三选一
// ─────────────────────────────────────────────────────────────
// kit 的颜色体系用 "R, G, B" 三元组 + rgba(var(--primary-rgb), α) 派生，
// 所以换主题色只需重写三元组这一层，容器色/焦点环/光晕全部自动联动。
//
// 写入路径：theme-color.js 生成 6 个基础变量（亮/暗两套）→ app.css 把它们
// 按 亮/暗 映射到 kit 的 --primary-rgb / --on-primary / --backdrop-tint /
// --backdrop-fallback → 原生侧 refreshBackdrop() 重新读 tint。
//
// 亮暗三选一（跟随系统/亮/暗）：kit 只有跟随系统，这里用 html[data-theme]
// 覆盖块实现，不动 kit。
import { refreshBackdrop } from '@rolling/ui-kit/theme';
import { invoke, invokeOr, isTauri } from '@rolling/ui-kit/tauri';
import { log } from '@rolling/ui-kit/ui';

export const PRESET_COLORS = [
    '#39C5BB', '#4A9EFF', '#9D6BFF', '#E86AA6',
    '#F2A33C', '#5CB85C', '#E24B4A', '#98A2AE',
];
export const DEFAULT_ACCENT = '#39C5BB';

let currentAccent = DEFAULT_ACCENT;
let currentMode = 'system';

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** '#39C5BB' / '#3C5' / '39C5BB' → [r,g,b]；非法返回 null */
export function hexToRgb(hex) {
    if (typeof hex !== 'string') return null;
    let h = hex.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            default: h = (r - g) / d + 4;
        }
        h /= 6;
    }
    return [h, s, l];
}

function hslToRgb(h, s, l) {
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map((v) => Math.round(v * 255));
}

const lighten = (rgb, amt) => {
    const [h, s, l] = rgbToHsl(rgb);
    return hslToRgb(h, s, clamp(l + amt, 0, 1));
};
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const css = (rgb) => `rgb(${rgb.join(',')})`;

/** W3C 相对亮度，用于决定品牌色上的文字取深还是浅 */
function relLum([r, g, b]) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const ON_DARK_TEXT = '#0E1B19';   // 亮品牌色上的深色文字
const ON_LIGHT_TEXT = '#FAFDFB';  // 深品牌色上的浅色文字

/** 计算、写入 accent 的全套派生值（亮/暗两套基础变量 + 直写主变量双保险） */
function writeAccentVars(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return false;
    // 暗色模式自动提亮（对应 kit 默认 亮 57,197,187 → 暗 74,218,208 的关系）
    const dark = lighten(rgb, 0.08);
    const onLight = relLum(rgb) > 0.4 ? ON_DARK_TEXT : ON_LIGHT_TEXT;
    const onDark = relLum(dark) > 0.4 ? ON_DARK_TEXT : ON_LIGHT_TEXT;
    // 原生窗口背景着色（仅 Win10 生效；Win11 走系统 backdrop 会忽略）
    const tintLight = mix(rgb, [248, 250, 249], 0.85).concat(96);
    const tintDark = mix(dark, [16, 18, 18], 0.88).concat(64);
    // 兜底底色（不透明渐变，原生模糊不可用时保证可读）
    const fbLight = mix(rgb, [255, 255, 255], 0.78);
    const fbDark = mix(dark, [10, 14, 13], 0.85);

    const s = document.documentElement.style;
    s.setProperty('--accent-light-rgb', rgb.join(', '));
    s.setProperty('--accent-dark-rgb', dark.join(', '));
    s.setProperty('--accent-on-light', onLight);
    s.setProperty('--accent-on-dark', onDark);
    s.setProperty('--tint-light', tintLight.join(', '));
    s.setProperty('--tint-dark', tintDark.join(', '));
    s.setProperty('--fallback-light',
        `linear-gradient(135deg, ${css(fbLight)} 0%, ${css(mix(fbLight, [255, 255, 255], 0.35))} 100%)`);
    s.setProperty('--fallback-dark',
        `linear-gradient(135deg, ${css(fbDark)} 0%, ${css(mix(fbDark, [0, 0, 0], 0.3))} 100%)`);
    // 双保险：按当前生效方案直写主变量，绕过任何媒体查询映射的时序问题
    s.setProperty('--primary-rgb', (isDarkNow() ? dark : rgb).join(', '));
    s.setProperty('--on-primary', isDarkNow() ? onDark : onLight);
    return true;
}

function isDarkNow() {
    if (currentMode === 'dark') return true;
    if (currentMode === 'light') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

/** 应用主题色（16 进制，带 # 或不带均可）。非法值返回 false，当前值不变。 */
export function applyAccent(hex) {
    if (!writeAccentVars(hex)) return false;
    const h = hex.trim();
    currentAccent = ('#' + h.replace(/^#/, '')).toLowerCase();
    // 主题切换瞬间禁用过渡，避免 transition 滞留旧色造成"半新半旧"
    const html = document.documentElement;
    html.classList.add('theme-switching');
    requestAnimationFrame(() => requestAnimationFrame(() => html.classList.remove('theme-switching')));
    return true;
}

export function getAccent() { return currentAccent; }
export function getMode() { return currentMode; }

/** 持久化一条设置；浏览器模式或后端未就绪时只记日志不报错 */
export async function persistSetting(key, value) {
    try {
        await invoke('set_setting', { key, value });
        log(`设置已保存：${key}=${value}`);
    } catch (e) {
        log(`设置未持久化（${isTauri ? '后端未就绪' : '浏览器模式'}）：${e}`);
    }
}

/**
 * 设置亮暗模式：'system' | 'light' | 'dark'
 * 锁定模式下 kit 的系统配色监听不会触发，需手动重设原生背景。
 */
export async function setThemeMode(mode, persist = true) {
    if (!['system', 'light', 'dark'].includes(mode)) return;
    currentMode = mode;
    if (mode === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);
    if (isTauri) {
        try { await refreshBackdrop(); } catch (e) { log('重设原生背景失败：' + e); }
    }
    // 亮暗切换影响主变量取值，重写一遍（theme-switching 已在 applyAccent 里瞬时禁过渡）
    writeAccentVars(currentAccent);
    if (persist) await persistSetting('theme_mode', mode);
}

/** 启动时调用：读 settings 应用主题色与亮暗模式（首帧前） */
export async function initTheme() {
    const accent = await invokeOr(null, 'get_setting', { key: 'accent' });
    if (!applyAccent(typeof accent === 'string' ? accent : DEFAULT_ACCENT)) {
        applyAccent(DEFAULT_ACCENT);
    }
    const mode = await invokeOr(null, 'get_setting', { key: 'theme_mode' });
    currentMode = ['system', 'light', 'dark'].includes(mode) ? mode : 'system';
    if (currentMode !== 'system') {
        document.documentElement.setAttribute('data-theme', currentMode);
    }
    writeAccentVars(currentAccent);
    // 跟随系统时，系统亮暗切换要重写主变量（映射走 media，直写值需要手动刷新）
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (currentMode === 'system') writeAccentVars(currentAccent);
    });
}
