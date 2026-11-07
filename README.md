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

默认数据目录是当前用户 home 下的 `.corvid`（Windows 为 `%USERPROFILE%\\.corvid`）；设置 `CORVID_DATA_DIR` 可以使用独立目录。`npm test` 会使用临时数据目录和本地网页 fixture 启动真实 Electron 进程，逐项验证桌面和 Agent 接口行为（测试索引见 [QA 目录](docs/qa/e2e-suites.md)）。在 Apple Silicon 上可用 `npm run package:mac:dir` 构建未签名的 Corvid `.app` 开发包，再运行 `npm run test:packaged:mac` 验证打包后启动。Windows x64 可运行 `npm run package:win:release` 构建未签名 NSIS 安装器，并用 `npm run test:packaged:win` 检查打包启动、快捷键、设置偏好及单实例路径；该检查使用隔离测试替身，不代替原生对话框和安装器人工验收。跨平台验收使用 [Windows 手动 QA 清单](docs/qa/issue-345-windows.md) 与仓库既有手动 workflow。已有 Developer ID 证书时，可通过 `CORVID_MAC_SIGNING_IDENTITY` 和 `npm run package:mac:signed:dir` 构建签名包，并运行 `npm run test:packaged:signed:mac` 检查签名启动与系统凭据往返；本地签名不代表已公证或完成公众安装分发，边界见[桌面打包说明](docs/architecture/distribution.md)。

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

脚本可用的绑定、页面能力、已知限制和错误语义见 [SDK 说明](sdk/README.md)。Agent 通过本地认证接口操作桌面，不暴露浏览器调试端口；脚本以运行它的本地用户权限执行。

外部 Agent（Claude Code、Codex、Cursor、dsh）可以用一条命令接入 Corvid 的 Browser MCP server，并获得教 Agent 如何使用的 `corvid-browser` skill：

```bash
node cli/corvid.mjs connect codex --token <在 Corvid 设置中签发的授权客户端 token>
node cli/corvid.mjs doctor codex   # 诊断控制服务、MCP 注册与 skill 安装
node cli/corvid.mjs disconnect codex  # 撤销 connect 写入的全部条目
```

`connect` 运行时会先列出将写入的配置文件与条目（MCP server 注册 + skill 安装路径），显式确认后写入；脚本化场景加 `--yes`。加 `--browser-script` 可以一并启用 `browser_script` 批量脚本执行工具（脚本以本地 Node 权限运行、可通过 dynamic import 触达整个 Node API，非沙箱；默认不启用，交互模式下 connect 会单独询问）。它可以读取当前 OS 用户可访问的本机文件，包括 `control.json` 管理员凭据，并以管理员身份请求 Corvid 控制 API，绕过 scoped Room 授权和逐次文件选择审批；Room scoped API 权限也不限制脚本的直接文件与网络访问。传入脚本的 SDK `Page` 还提供 `Page.cdp()`：`DOM.setFileInputFiles` 与 `Target.*` 会被拒绝，其他 CDP 方法可转发给页面调试器。该开关只控制外部 host 的 MCP 工具面，本地 `corvid run` CLI 不受影响。不提供 `--token` 时，connect 用本地管理员凭据经运行中的 Corvid 桌面自动签发一个 openRoomGrant 授权客户端（初始授权范围为空，只能访问其自建的 Room），token 写入 host 配置 env，`disconnect` 时自动撤销；`--token` 则写入你在 Corvid 设置中签发的既有凭据，`disconnect` 不撤销它。授权客户端经 `room_open` 创建的 Room 会自动并入其授权范围；授权范围外已存在的同名 Room 会被拒绝（不创建重名 Room）。支持 `claude-code`、`codex`、`cursor`、`dsh` 四种 host，写入位置与撤销语义见 [外部 Agent 集成说明](docs/architecture/external-agent-integration.md)。

Browser MCP 的 `page_upload` 与 SDK 非空 `setInputFiles` / `FileChooser.setFiles` 每次选择本机文件前都会等待 Corvid 桌面批准；拒绝符号链接，拒绝、请求/连接取消、撤权、Room/页面变化或窗口关闭时失败关闭，审批中同路径文件被替换会报 `CORVID_STALE_REFERENCE`，跨源 chooser 在审批卡出现前拒绝。批准后会在调用 CDP setter 前复核文件身份；该路径检查与 Chromium 实际打开文件之间不是原子操作。此审批只约束通过 Corvid 文件选择 API 的操作，不限制已启用的非沙箱 `browser_script` 直接读取本机文件。外部 Agent 的 `confirm_action` 只返回用户对所述动作的决定，不执行网页操作，也不是后续动作的强制授权凭证；其审批在 Corvid 桌面显示，因为外部 MCP 请求没有内置 Agent 会话 ID。接口细节见 [SDK 说明](sdk/README.md) 与[外部 Agent 集成架构](docs/architecture/external-agent-integration.md)。

## 文档

- [文档地图](docs/README.md)
- [执行任务板](docs/execution/feature-board.md)
- [测试索引](docs/qa/e2e-suites.md)
- [验证记录](docs/reviews/verification-log.md)
- [重构交接记录](docs/records/rebrand-handoff.md)
