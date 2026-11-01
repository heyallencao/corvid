# OpenCLI / BrowserMCP 机制与 Corvid 集成判断

## 调研范围

- OpenCLI 仓库：`/Users/allen/Workspace/tools/opencli`
- 同作者的 MCP 浏览器项目：`https://github.com/jackwener/browsermcp`，本地临时检出位于 `/tmp/opencli-mcp-review`，npm 包名 `@jackwener/browsermcp`
- 参考：BrowserMCP `README.md`、`src/mcp/server.ts`、`src/api/commands.ts`、`src/launcher/stdio.ts`、`src/host/doctor.ts`、`docs/js-tool.md`
- 调研目的：分析用户所指的 OpenCLI 作者 MCP 浏览器项目，并评估 Corvid 的集成方向。

## OpenCLI 与 BrowserMCP 的关系

OpenCLI 是作者的 CLI Hub；**BrowserMCP** 是同作者独立开发的 MCP 浏览器服务，面向已经登录的 Chrome。BrowserMCP 不是 OpenCLI CLI 自带的 MCP 模式，而是单独安装的 `browsermcp` 命令与 `@jackwener/browsermcp` 包。其 Agent 接口包含通用浏览器工具、站点 adapter、诊断和持久 JS workspace。

OpenCLI 本身把能力拆成两层：

1. **通用浏览器操作原语**：Agent 通过 `browser <session> <command>` 操作浏览器会话，覆盖导航、结构化页面状态、交互、提取、等待、截图、网络观察和标签管理。
2. **站点适配器**：注册带参数与读写属性的稳定命令，由 registry 统一执行；用户 adapter、plugin 和外部 binary 可扩展命令集合。

BrowserMCP 则是直接的 MCP Server，主要工具有：

- 通用浏览器工具：`tabs_list`、`claim_tab`、`open_tab`、`navigate_tab`、`tab_observe`、`tab_act`、`close_tab`、`release_tab` 等。
- `js` / `js_reset`：每个 MCP client session 独立的持久 JavaScript REPL，可组合浏览器 API、访问页面、运行网络探查及管理 adapter；也有 typed tools/helper。
- 站点工具：`sites_search` / `site_run`，可按权限启用并动态注册独立工具。
- `doctor`：读取浏览器连接状态、扩展能力、协议版本告警、站点/命令数量、session 和 JS 状态。
- `session_finish`：按 tab 所有权清理、释放或保留页面。

## BrowserMCP 的连接与生命周期机制

MCP 客户端通过标准 **stdio** 启动 `browsermcp` launcher。Chrome 扩展通过 Native Messaging 启动本地 host；launcher 与 host 之间用本地 Unix socket（macOS/Linux）或 named pipe（Windows）通信。扩展使用 Chrome debugger API 操作真实登录会话，host 提供 MCP 工具所调用的运行时。没有向 localhost 开放 TCP 服务，也不需要 token 配置。MCP client 启动和 Chrome/host 启动解耦；host 断连重启时 launcher 保持 stdio 通道并重连。每个 MCP client 有独立 tab 与 JS session。

这种 BrowserMCP 架构服务于“控制外部 Chrome”。Corvid 已掌握自己的 Electron WebContents 和用户/Agent 所有权，因此不需要复制扩展 + Native Messaging + host/socket 桥接。更适合复用的是其 MCP 工具设计、页面 observe→act→verify 循环、明确 tab handle/ownership、错误 envelope、站点 adapter 动态发现、session 收尾及断线恢复策略。

## Corvid 对照

Corvid 已有本地桌面控制服务和 SDK：桌面只监听 `127.0.0.1`，随机生成 bearer token 并写入 `~/.corvid/control.json`，SDK 读取该凭据后访问 API；Chromium CDP 调试端口不对外开放。SDK 已提供 Room、Page、结构化 snapshot、导航/输入、等待、页面信息、对话框、弹窗事件、下载、evaluation 等能力。

Corvid 与 OpenCLI 的主要区别：

- BrowserMCP 重点是控制扩展连接的外部 Chrome；Corvid 是自有 Electron 浏览器，拥有 Room/Profile/Tab 生命周期与用户/Agent 控制权语义。
- BrowserMCP 用扩展 + Native Messaging + 本地 host/socket 连接 Chrome；Corvid 由 Electron 主进程直接管理 WebContentsView，且已具备认证控制 API。
- BrowserMCP 的动态 site adapter 和工具 schema 机制可作为未来 Corvid 站点能力生态参考；Corvid 首版适合先提供通用浏览器工具，让 Agent 组合操作。
- Corvid SDK `evaluate` 与 `cdp` 能力较强，必须在 MCP 暴露时单独分级，避免把诊断只读工具和任意代码执行混为一谈。

## 集成建议

采用“Corvid MCP Server 适配现有 SDK”的方式，不在 Corvid 内嵌 OpenCLI 的 daemon/Chrome 扩展，不把 OpenCLI CLI 作为浏览器控制后端。MCP server 可作为独立 Node stdio 进程，由 MCP host 启动；它读取 Corvid `control.json`，通过 `sdk.connect()` 调用浏览器。这让 MCP 生命周期跟随 host，也无需开放新端口。

首批 tools 可以映射为：

- 只读诊断：`list_rooms`、`list_profiles`、`list_tabs`、`page_info`、`page_snapshot`、`get_dialog`、`get_popup_events`。
- 受控交互：`navigate`、`click`、`fill`、`press`、`wait_for_selector`。
- 高风险能力后续单独开启：`evaluate`、原始 `cdp`、下载到本地路径、文件上传、Room/Tab 关闭与控制权切换。

对齐 OpenCLI 的设计方式：每个 tool 有窄而显式的 JSON Schema、用途描述、操作副作用声明、紧凑结构化返回值、稳定错误码，以及运行时发现能力的 `tools/list`。不要仅靠自然语言 skill 描述能力，也不要把全部 SDK 方法直接透出。

诊断可提供一个只读 `diagnose` tool，返回桌面健康、Room/Tab 概览、页面就绪状态、对话框/执行风险与最近弹窗事件。健康 probe 首版应为纯读取；不要默认打开页面或执行任意 JS。若后续加入真实端到端 probe，应单独标明并让用户选择目标页面，因为它可能产生副作用。

## 实施顺序建议

1. 用 SDK 已有读取接口实现 stdio MCP server 和只读 tools。
2. 定义 tool schema、稳定错误映射、超时和输出大小上限。
3. 验证用户控制、待恢复控制和 execution risk 状态下的可见性及拒绝策略。
4. 再加入常用写操作；evaluate/CDP 保持显式 opt-in。
5. 提供 MCP 客户端配置示例或安装命令，但不在第一步把本地密钥复制到配置文件。Server 启动时从标准 Corvid 数据目录读取凭据。

## 结论与边界

BrowserMCP 是用户所指的 OpenCLI 作者 MCP 浏览器项目。它已实现完整的 MCP browser server、持久 REPL、doctor、站点工具动态发现和以 tab 所有权为中心的清理流程。Corvid 可借鉴这些 Agent Experience 设计，但连接层应直接接 Corvid SDK/本地控制 API，无需 BrowserMCP 的 Chrome 扩展与 Native Messaging 桥接，也不建议初期照搬自由度较高的 Node REPL。建议先实现显式、窄 schema 的只读与常用交互 tools，随后再考虑动态 adapter；`evaluate`/CDP 保持显式 opt-in。源码调研未运行 BrowserMCP doctor 或真实浏览器操作；对 Corvid 对接的判断是基于已有 SDK/API 的静态映射。

## Corvid 首版实现记录（2026-11-02）

- 新增 `mcp/corvid.mjs`，通过官方 `@modelcontextprotocol/server@2.4.0` 的 stdio transport 提供 MCP；Zod 固定为 `4.6.7`，`npm audit --audit-level=high` 为 0 vulnerabilities。
- 首版只有五个只读 tools：`list_profiles`、`list_rooms`（必须指定 `profileId`）、`list_tabs`（必须指定 `roomId`）、`page_info`、`page_snapshot`。页面读取只接受 Agent-owned、无待接管且无执行风险的 Room；不提供导航、点击、输入、`evaluate`、CDP、控制权转移或关闭工具。
- 每次调用通过 `sdk.connect()` 读取现有 0600 Bearer 凭据；不复制 token、不新增监听端口。MCP stdout 只承载协议消息，错误以工具结果传回。
- 复现：`node tests/mcp-e2e.cjs`。用隔离 `CORVID_DATA_DIR` 验证 initialize、tools/list、tools/call、只读状态、Profile/Room 显式选择、用户接管时拒绝页面读取、未知 ID 与桌面离线错误。它尚未在 Claude Desktop/Cursor 等真实 host 界面手工配置，也未验证打包后入口和 Windows。
- 配置方式（仓库 checkout 环境）：host 启动 `node /绝对路径/corvid/mcp/corvid.mjs`；若 Corvid 数据目录非默认位置，只在本地 server 的环境变量中设置 `CORVID_DATA_DIR`。不要把 `control.json` token 放进 host 配置。MCP 进程与桌面同时运行时才能访问浏览器。

## 内置 Agent runtime 选型（2026-11-02）

用户已明确指定 Pi。产品决定采用 Pi SDK 嵌入会话 runtime，Corvid 继续拥有浏览器 UI、任务状态、Profile/Room/Page 绑定和授权边界；不把 Pi 的 TUI 当作 Corvid 产品界面。首个实现 Issue 为 [Issue #5](https://github.com/heyallencao/corvid/issues/5)。

参考 Pi 官方 [SDK 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)：SDK 可嵌入 Node/Bun 进程、创建和持久化 Agent session，并订阅消息/工具/运行事件；官方 npm 元数据当前为 `@earendil-works/pi-coding-agent@1.4.0`、Node.js `>=22.19.0`。Corvid 声明的最低 Node 版本目前为 `>=22.12.0`，因此集成前须决定提高运行时下限还是隔离/延迟加载 Pi。

Pi 默认工具与 Corvid 浏览器权限必须拆开：内置 Agent 首期禁用 Pi 的 filesystem/shell 工具，只注册当前显式 Room 的 Corvid tools；真实模型凭据、费用和任务持久化需纳入设置与恢复设计。离线确定性 fixture 只能证明生命周期和 UI 合同，不代表真实模型连通。
