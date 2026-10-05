# ProjectHub

个人项目管理工具：**四个独立板块**（本地代码项目 / 资料文档目录 / 网址收藏 / GitHub 收藏）集中管理你的项目与资料，每条可备注、分组、打标签、收藏置顶。

## 功能特性

- **四板块独立管理**：每块有自己的收藏夹、自定义分组、最近打开/常用视图
- **一键打开**：资源管理器 / 终端（Windows Terminal 优先）/ 默认编辑器 / 浏览器
- **README 阅读**：本地项目选中即渲染；GitHub 收藏粘贴仓库地址自动抓取 README 与图片到本地（不走 GitHub API、无需 token），离线可看
- **AI 助手**（可选，任意 OpenAI 兼容服务）：条目信息补全、全库整理建议（含自动创建分组）、自然语言整理、纯对话，所有修改经确认后应用、可逐条撤回
- **批量操作**：批量选择/删除、目录扫描批量导入 Git 仓库
- **跨板块搜索**：Ctrl+K 全局命令面板
- **数据全本地**：SQLite 存储，JSON 导入/导出备份
- **玻璃拟态 UI**：无边框亚克力透明窗口、主题色自定义（调色盘/16 进制）、亮暗模式

## 技术栈

Tauri 2（Rust）+ 原生 ES 模块 + Vite，SQLite（rusqlite），marked + DOMPurify + highlight.js。

## 开发

依赖：Node ≥ 18、Rust（可编译 Tauri v2），以及同级目录的 **ui-kit**（见下方说明）。

```bash
npm install
npm run dev     # Tauri 桌面端
npm run ui      # 仅前端（浏览器模式，数据为演示桩）
```

## 关于 ui-kit 依赖

本仓库依赖作者另一套私有 UI 套件 `@rolling/ui-kit`（毛玻璃主题 + 窗口骨架 + 组件），**未随本仓库发布**：

- `package.json` 中 `"@rolling/ui-kit": "file:../ui-kit"`
- `src-tauri/Cargo.toml` 中 `tauri-ui-kit = { path = "../../ui-kit/rust" }`

克隆本仓库后需自备该目录并保持相对位置（`ui-kit` 与本仓库同级），或自行调整上述依赖路径。

## License

MIT © Rolling
