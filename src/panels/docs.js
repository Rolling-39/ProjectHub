// 文档板块（资料/文档目录）
import { mountSection } from '../shared/section.js';

export function mount(root) {
    return mountSection(root, {
        section: 'docs',
        title: '文档',
        vias: ['explorer', 'terminal', 'editor'],
        readme: true,
        docsFiles: true, // 可切换浏览目录内任意 .md
    });
}
