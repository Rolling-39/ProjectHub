// 项目板块（本地代码项目）
import { mountSection } from '../shared/section.js';

export function mount(root) {
    return mountSection(root, {
        section: 'code',
        title: '项目',
        vias: ['explorer', 'terminal', 'editor'],
        readme: true,
        docsFiles: false,
        scan: true, // 目录扫描批量导入（仅项目板块）
    });
}
