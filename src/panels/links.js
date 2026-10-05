// 网址板块
import { mountSection } from '../shared/section.js';

export function mount(root) {
    return mountSection(root, {
        section: 'link',
        title: '网址',
        vias: ['browser'],
        readme: false,
        docsFiles: false,
    });
}
