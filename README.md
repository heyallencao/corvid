# Corvid

Corvid 是一个本地优先的桌面浏览器，也是用户与 Agent 协作的主产品：用户照常使用完整浏览器，Agent 在各自独立的 **Room** 里执行任务；用户能看到状态、接管控制并在需要时交还 Agent。内置 Agent 工作台与外部 Agent SDK/CLI 将共用 Room、Profile、页面上下文和控制权模型。

项目仍在开发中。当前提供桌面浏览器、Corvid Agent 工作台和外部 Agent SDK/CLI。用户浏览与 Agent Room 共用 Profile、页面和控制权模型；Agent 操作前需要明确页面上下文。Agent 运行时属于 Corvid 内部实现，可在不改变用户界面、任务记录和配置语义的前提下替换或升级。功能覆盖、验收状态和待办事项见 [执行任务板](docs/execution/feature-board.md)；架构与边界见 [系统设计](docs/architecture/overview.md)。

## 核心概念

- **Room**：同一 Profile 下的隔离工作区，也是控制权边界。每个 Agent 在自己的 Room 里工作，页面标签 `p1`、`p2` 跨调用、跨重启保持。
- **Profile**：浏览身份与 Cookie/存储边界。同一 Profile 共享登录状态，不同 Profile 相互隔离；历史、书签、下载按 Profile 归属。
- **Page**：标签页的 Agent 句柄，负责导航、观察、输入和页面能力。
- **控制权**：Agent 可以把 Room 交还用户（`yieldControl`），用户控制期间 Agent 的新动作会被拒绝；用户交还后 Agent 可以取回（`resumeControl`）。

## 本地运行

需要 Node.js 22.19.0 或更新版本（与 `package.json` 的 `engines` 要求一致）。

```bash
npm ci
npm start
```

默认数据目录是 `~/.corvid`；设置 `CORVID_DATA_DIR` 可以使用独立目录。`npm test` 会使用临时数据目录和本地网页 fixture 启动真实 Electron 进程，逐项验证桌面和 Agent 接口行为（测试索引见 [QA 目录](docs/qa/e2e-suites.md)）。在 Apple Silicon 上可用 `npm run package:mac:dir` 构建未签名的 Corvid `.app` 开发包，再运行 `npm run test:packaged:mac` 验证打包后启动。已有 Developer ID 证书时，可通过 `CORVID_MAC_SIGNING_IDENTITY` 和 `npm run package:mac:signed:dir` 构建签名包，并运行 `npm run test:packaged:signed:mac` 检查签名启动与系统凭据往返；本地签名不代表已公证或完成公众安装分发，边界见[桌面打包说明](docs/architecture/distribution.md)。

## 日常使用

- 标签栏显示页面 favicon，支持拖拽排序、中键关闭与**固定标签**（固定标签置顶、关闭前确认）；右键标签可固定/取消固定、重新加载、复制链接、关闭标签或关闭其他标签。
- 标签和 Room 的状态会跨重启恢复；通过工具栏“新建窗口”或 Cmd/Ctrl+N 可创建独立浏览窗口，每窗维护自己的 Room 列表。关闭窗口时其 Room 会转移到仍打开的窗口；Agent 接口仍可查看和操作所有窗口中的 Room。
- `Cmd/Ctrl + F` 打开页内查找：输入即显示 `当前/总数`，Enter / Shift+Enter 前后跳转，Esc 关闭。
- `Cmd/Ctrl + T/W/L/R`、`Cmd/Ctrl + 数字`、`Control + Tab` 等常用快捷键可用；`Cmd/Ctrl + P` 打印当前网页。
- 历史、书签、下载面板支持搜索；下载完成后可以打开文件或在文件夹中显示。
- 窗口位置、尺寸与最大化状态保存在数据目录的 `window-state.json`，重启后恢复。
- 首次启动可选择从 Google Chrome 导入书签、历史、macOS Cookie 和逐项选择的扩展；设置中可以继续迁移。扩展按 Corvid Profile 隔离，权限与 Electron API 兼容边界会显示在界面中；扩展工具栏弹窗、更新、已保存密码及 Chrome Web Store 全面兼容尚未支持。Cookie 导入会调用 macOS 钥匙串读取 Chrome 加密密钥。会话 Cookie 按原语义在 Corvid 退出时失效，带有效期的 Cookie 可跨重启保留。

## Agent 接入

桌面应用启动后，可以通过 CLI 运行一段 Node.js 脚本：

```bash
node cli/corvid.mjs run < task.mjs
```

脚本可用的绑定、页面能力、只读站点命令生命周期、已知限制和错误语义见 [SDK 说明](sdk/README.md)。外部 Agent 可提交受限只读候选并试用；命令须由用户在设置中审查并保留后，才能在原 Room 和网站来源内搜索、运行。Agent 通过本地认证接口操作桌面，不暴露浏览器调试端口；脚本以运行它的本地用户权限执行。

## 文档

- [文档地图](docs/README.md)
- [执行任务板](docs/execution/feature-board.md)
- [测试索引](docs/qa/e2e-suites.md)
- [验证记录](docs/reviews/verification-log.md)
- [重构交接记录](docs/records/rebrand-handoff.md)
