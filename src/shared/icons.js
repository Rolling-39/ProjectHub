// ─────────────────────────────────────────────────────────────
// ProjectHub / shared/icons.js —— lucide 单色图标封装
// lucide 的 SVG 是 stroke: currentColor，颜色完全由所在元素的 color
// 继承 → 主题色一换，导航/按钮/卡片图标全部联动。禁止用 Emoji。
import { createElement, icons } from 'lucide';

function sized(svg, size) {
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    return svg;
}

/** 把 lucide 图标节点（import { Folder } from 'lucide'）转成 SVG 元素 */
export function navIcon(node, size = 16) {
    return sized(createElement(node), size);
}

export const inlineIcon = navIcon;

/** 按名字渲染图标（条目自定义 icon 字段用，kebab-case，如 'folder-git-2'） */
export function icon(name, size = 16) {
    const node = icons?.[name];
    if (!node) return null;
    return sized(createElement(node), size);
}
