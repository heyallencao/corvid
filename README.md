# Corvid

Corvid 是一个本地优先的桌面浏览器，让用户和 AI Agent 在同一个浏览器里并行工作：用户照常在自己的标签页里浏览，Agent 在各自独立的 **Room** 里执行任务，互不抢占焦点、标签和输入。

项目仍在开发中。功能覆盖、验收状态和待办事项见 [执行任务板](docs/execution/feature-board.md)；架构与边界见 [系统设计](docs/architecture/overview.md)。

## 核心概念

- **Room**：同一 Profile 下的隔离工作区，也是控制权边界。每个 Agent 在自己的 Room 里工作，页面标签 `p1`、`p2` 跨调用、跨重启保持。
- **Profile**：浏览身份与 Cookie/存储边界。同一 Profile 共享登录状态，不同 Profile 相互隔离；历史、书签、下载按 Profile 归属。
- **Page**：标签页的 Agent 句柄，负责导航、观察、输入和页面能力。
- **控制权**：Agent 可以把 Room 交还用户（`yieldControl`），用户控制期间 Agent 的新动作会被拒绝；用户交还后 Agent 可以取回（`resumeControl`）。

## 本地运行

需要 Node.js 22.12 或更新版本。

```bash
npm ci
npm start
```

默认数据目录是 `~/.corvid`；设置 `CORVID_DATA_DIR` 可以使用独立目录。`npm test` 会使用临时数据目录和本地网页 fixture 启动真实 Electron 进程，逐项验证桌面和 Agent 接口行为（测试索引见 [QA 目录](docs/qa/e2e-suites.md)）。

## Agent 接入

桌面应用启动后，可以通过 CLI 运行一段 Node.js 脚本：

```bash
node cli/corvid.mjs run < task.mjs
```

脚本可用的绑定、页面能力、已知限制和错误语义见 [SDK 说明](sdk/README.md)。Agent 通过本地认证接口操作桌面，不暴露浏览器调试端口；脚本以运行它的本地用户权限执行。

## 文档

- [文档地图](docs/README.md)
- [执行任务板](docs/execution/feature-board.md)
- [测试索引](docs/qa/e2e-suites.md)
- [验证记录](docs/reviews/verification-log.md)
- [重构交接记录](docs/records/rebrand-handoff.md)
