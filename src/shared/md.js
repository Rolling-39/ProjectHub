// ─────────────────────────────────────────────────────────────
// ProjectHub / shared/md.js —— Markdown 渲染
// marked 解析 → DOMPurify 消毒 → 相对路径资源转资产协议 → hljs 高亮。
// README 是外部内容，消毒顺序不能反。
// ─────────────────────────────────────────────────────────────
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github-dark.css';

marked.setOptions({ gfm: true, breaks: false });

function assetUrl(absPath) {
    const t = window.__TAURI__;
    if (t?.core?.convertFileSrc) return t.core.convertFileSrc(absPath);
    return absPath; // 浏览器模式：保持原样（图片不可达属预期）
}

/** 把 markdown 渲染进容器。doc = { content, baseDir } */
export function renderMarkdownInto(container, doc) {
    container.classList.add('md-body');
    const raw = marked.parse(doc?.content || '');
    container.innerHTML = DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] });

    const base = String(doc?.baseDir || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const toLocal = (rel) => assetUrl(base + '/' + String(rel).replace(/^\.\//, ''));

    container.querySelectorAll('img[src]').forEach((img) => {
        const src = img.getAttribute('src') || '';
        if (/^(https?:|data:|blob:|asset:)/i.test(src) || src.startsWith('/')) return;
        img.src = toLocal(src);
        img.loading = 'lazy';
    });
    container.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href') || '';
        if (/^#/i.test(href)) return; // 页内锚点不动
        if (/^(https?:|mailto:)/i.test(href)) {
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            return;
        }
        a.href = toLocal(href);
        a.target = '_blank';
    });
    container.querySelectorAll('pre code').forEach((blk) => {
        try { hljs.highlightElement(blk); } catch (_) { /* 未知语言忽略 */ }
    });
}
