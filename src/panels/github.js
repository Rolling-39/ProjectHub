// GitHub 收藏板块 —— 导入式：粘贴仓库地址抓 README 本地化
import { mountSection } from '../shared/section.js';

export function mount(root) {
    return mountSection(root, {
        section: 'github',
        title: 'GitHub 收藏',
        vias: ['browser'],
        readme: false,
        itemReadme: true,   // 详情读条目自带的本地 README（github_assets）
        github: true,       // 详情加"重新抓取 / 替换 README"
        addViaWizard: true, // 添加走导入向导
    });
}
