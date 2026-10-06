import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// 版本号只在 package.json 里维护一份，构建时注入为 __APP_VERSION__。
// 之前设置页把 "v0.1.0" 硬编码在字符串里，加上 package.json / Cargo.toml /
// tauri.conf.json / package-lock.json，一次升版要手工改 5 处，必漏。
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// @rolling/ui-kit 是 file: 本地依赖（node_modules 里是符号链接），
// 必须放开 fs.allow 并关闭 preserveSymlinks 才能解析到项目外的 ui-kit 源码。
export default defineConfig({
    root: 'src',
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    build: { outDir: '../dist', emptyOutDir: true },
    server: {
        port: 1420,
        strictPort: true,
        fs: { allow: ['..'] },
        // Windows 下 chokidar 事件偶尔丢失导致"改了代码页面不更新"，
        // 改用轮询监听根治（本项目体量小，开销可忽略）
        watch: { usePolling: true, interval: 300 },
    },
    resolve: { preserveSymlinks: false },
});
