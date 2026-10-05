import { defineConfig } from 'vite';

// @rolling/ui-kit 是 file: 本地依赖（node_modules 里是符号链接），
// 必须放开 fs.allow 并关闭 preserveSymlinks 才能解析到项目外的 ui-kit 源码。
export default defineConfig({
    root: 'src',
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
