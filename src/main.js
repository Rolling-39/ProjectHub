// ─────────────────────────────────────────────────────────────
// ProjectHub / main.js —— 入口：主题 → createShell（四板块）
// ─────────────────────────────────────────────────────────────
import '@rolling/ui-kit/index.css';
import './styles/app.css';

import { createShell } from '@rolling/ui-kit/shell';
import { Folder, BookOpen, Link2, Github, Settings, ScrollText, Sparkles } from 'lucide';

import { navIcon } from './shared/icons.js';
import { initTheme } from './theme-color.js';
import { installPalette } from './shared/palette.js';

// 首帧前应用主题色与亮暗模式（读 settings；浏览器模式走默认值），
// 这样 createShell 里的 initBackdrop 读到的 tint 就是 accent 派生的。
await initTheme();
installPalette();

const shell = await createShell({
    appName: 'ProjectHub',
    sidebarTitle: 'ProjectHub',
    footer: '© Rolling',
    // 'auto'：Win11 走系统 backdrop（避开 Win10 SWCA 拖动卡顿），其余 acrylic
    backdropBackend: 'auto',
    defaultPanel: 'projects',
    panels: {
        projects: { title: '项目', icon: navIcon(Folder), load: () => import('./panels/projects.js') },
        docs:     { title: '文档', icon: navIcon(BookOpen), load: () => import('./panels/docs.js') },
        links:    { title: '网址', icon: navIcon(Link2), load: () => import('./panels/links.js') },
        github:   { title: 'GitHub 收藏', icon: navIcon(Github), load: () => import('./panels/github.js') },
        aihelper: { title: 'AI 助手', icon: navIcon(Sparkles), load: () => import('./panels/aihelper.js') },
        settings: { title: '设置', icon: navIcon(Settings), hidden: true, load: () => import('./panels/settings.js') },
        log:      { title: '日志', icon: navIcon(ScrollText), hidden: true, load: () => import('./panels/log.js') },
    },
    onReady(s) {
        // 侧栏底部：设置 / 日志 入口（M1 会加图标并顺带整理）
        window.__shell = s;
        const footer = document.querySelector('.sidebar-footer');
        if (footer) {
            const bar = document.createElement('div');
            bar.className = 'pm-side-actions';
            const mk = (label, panel) => {
                const b = document.createElement('button');
                b.className = 'pm-side-btn';
                b.textContent = label;
                b.addEventListener('click', () => s.showPanel(panel));
                return b;
            };
            bar.append(mk('设置', 'settings'), mk('日志', 'log'));
            footer.before(bar);
        }
    },
});

export default shell;
