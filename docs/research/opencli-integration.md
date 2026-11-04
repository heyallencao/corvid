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

参考 Pi 官方 [SDK 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)：SDK 可嵌入 Node/Bun 进程、创建/打开持久化 Agent session，并订阅消息/工具/运行事件；本仓库锁定 `@earendil-works/pi-coding-agent@1.4.0`，Corvid Node 下限为 `>=22.19.0`。

Pi 默认工具与 Corvid 浏览器权限必须拆开：`desktop/pi-agent.cjs` session factory 禁用 filesystem/shell 工具以及 Pi extensions、skills、prompt templates、themes、context files，只注册 `corvid_page_snapshot` / `corvid_navigate` 并绑定一个显式 Room/Profile/Tab，单次工具输出上限 32 KiB。Agent transcript 与运行时配置位于 Corvid 数据目录；Provider OAuth/API Key 和自定义端点 Key 由 Corvid 版本化凭据 schema 管理，再通过适配器提供给当前运行时，不能读取用户 CLI 的全局配置。此前模型登录实现曾错误依赖用户 CLI 设置，由 [Issue #55](https://github.com/heyallencao/corvid/issues/55) 修正；旧 runtime 凭据文件由 Issue #78 的迁移切片处理。为当前 Pi 依赖树的 `undici` 与 `minimatch` 安全公告增加固定 overrides，`npm audit --audit-level=high` 结果为 0。

当前用户可见首段见 [Pi Agent 工作台验证记录](../reviews/verification-log.md)：通过 Pi SDK 创建、打开 task 专属 transcript；桌面支持明确确认页面上下文、任务事件呈现、多轮续聊与 fixture 下的中断恢复。`tests/pi-runtime-e2e.cjs` 和 `tests/pi-workbench-e2e.cjs` 均隔离临时数据，不调用真实 provider/model。用户接管会暂停运行中的 Pi task，交还 Room 后可经显式页面确认继续同一 transcript；目前仍需用户发起继续。真实模型凭据/费用设置与真实 provider 断连恢复边界仍待实现。


## 2026-11-02 REA 与 Corvid MCP 交互切片

- 已安装 BrowserMCP 来源目录固定在本地干净检出 commit `847790e4e57b5d3de137829bf51e20c5fb357d73`。REA 对 `src/mcp/server.ts`、`src/api/commands.ts`、`src/launcher/stdio.ts`、`src/host/doctor.ts` 做精确选择分析：Evidence `ev_97f8675045ebadba960eefa677e358507fa90a6936a813cab03c6e62360f145b`，父图谱 `ev_c8bfe027d960d704b5fc6a16158ce7c7561b0b177436c18276935fb58ff34dbf`。该分析只证明所选源码声明，不证明实际 BrowserMCP runtime 或 Chrome 行为。
- Corvid MCP 当前包含五个只读工具与四个写工具：`page_navigate`（只允许 HTTP/HTTPS 且禁止 URL 内嵌账号密码）、`page_click`、`page_fill`、`page_press`。每个动作要求显式 `roomId`/`tabId`、managed page 和 Agent 控制；待用户接管或 execution risk 时拒绝。所有动作工具声明 `readOnlyHint:false`、`destructiveHint:true`、`openWorldHint:true`；结果不等于网站操作已成功，Agent 需要再取 Snapshot 验证。
- `node tests/mcp-e2e.cjs` 使用隔离 Electron 与本地 HTTP 页面验证工具清单、操作副作用、HTTP(S) URL 范围、操作后状态、用户接管拒绝和离线错误。仍未连接真实 MCP host、真实网站或打包应用；不提供任意 `evaluate`/CDP、文件上传或 Room 生命周期/控制权转移工具。标签生命周期的有限 MCP 工具见下方 Issue #259 记录。

## 2026-11-04 页面历史导航实现补充

- Corvid SDK Page 通过受控 `back` / `forward` API 路由调用浏览器历史；Browser MCP 新增 `page_back`、`page_forward`、`page_reload`，仍适配现有 SDK，不增加端口、凭据或任意代码执行能力。
- 本轮隔离 Electron + 本地 HTTP fixture 的 MCP E2E 证明空历史不导航、同一 managed Tab 的前进/后退与重新请求、用户接管后拒绝操作、后台 Agent 动作不切换前台 Room。该证据只覆盖 Corvid 当前实现，不验证参考 BrowserMCP 的对应行为、真实 MCP host 或真实网站。


## 2026-11-04 Browser MCP 页面等待能力

- Issue #257 为 MCP 补充两个有限观察工具：精确 URL 等待与 `domcontentloaded`/`load` 等待。它们复用 SDK 轮询与控制权检查，不改变页面，也不支持任意表达式或 `networkidle`。
- 验收使用本地 HTTP 延迟响应，确认点击链接后返回预期 URL、文档完成前等待不提前返回、timeout 有界，并检查后台等待不影响前台浏览空间。真实 MCP host、真实站点及 Chromium 所有加载边界不由该本地证据覆盖。


## 2026-11-04 Browser MCP Agent 标签生命周期

- Issue #259 将 SDK 已有的 Room/Page 生命周期收敛为窄 MCP 工具：`page_new` 只创建 Agent-owned 空白标签，`page_close` 只关闭 Agent 创建且受管的页面；不会接管 Room、关闭用户/未知来源页或自动跳转。网页 `beforeunload` 仍由应用交给用户处理。
- 隔离真实 Electron 将验证 Agent 新建/关闭、未知来源 popup 拒绝关闭、控制权拒绝及后台 Room 不切换前台。此结果不等于真实 MCP host 的用户确认体验或多窗口平台验证。


## 2026-11-04 Browser MCP 视口截图

- Issue #262 为 MCP 增加只读 `page_screenshot`：复用显式授权 Room/受管 Page 与 Agent 控制检查，返回当前视口 `image/png` 内容；不导航、不切换前台、不落盘，图像字节上限 8 MiB，完整页截图不对 MCP 开放。
- 验证使用隔离真实 Electron 和本地 fixture；覆盖 image content/PNG 签名、后台 Room 前台稳定和超限拒绝。没有真实 MCP host，因此不证明具体 host 会显示图像或将其转交视觉模型。


## 2026-11-04 Browser MCP 表单选择与悬停

- Issue #264 将 SDK 已有的 `selectOption()` 与 `hover()` 暴露为 `page_select_option`、`page_hover`。选择支持 value/label/index、单选/多选和清空；按 SDK 合同更新 DOM 选项并发出非可信 input/change 事件，不操作原生选择器；悬停只接受 locator，不开放任意坐标或脚本。两者都遵循显式 Room/Page 与 Agent 控制检查，并标记为可产生页面副作用的 action。
- 隔离真实 Electron + 本地 fixture 验证下拉状态和悬停后菜单可见、错误选项，以及用户接管拒绝。没有真实站点/MCP host 证据，不推断所有自定义下拉菜单、hover 触屏兼容或 host 交互。


## 2026-11-04 Browser MCP 页面元素状态等待

- Issue #266 将 SDK `Page.waitForSelector()` 收敛为 `page_wait_for_selector`：只接受已有 locator schema，状态限定 `attached`、`detached`、`visible`、`hidden`，timeout 100–60,000ms，默认 10 秒；不暴露函数或任意脚本。
- 隔离真实 Electron + 本地 SPA fixture 已验证动态出现、隐藏、移除、timeout 与用户接管中断。通过 fixture 的局部 DOM 变化验证同文档观察，不代表真实网站/MCP host 对所有 selector 和动画的兼容性。

## 2026-11-04 Browser MCP 页面滚动

- Issue #268 将 SDK `Page.scroll(deltaX, deltaY, {x, y})` 暴露为 `page_scroll`：位移每轴限制 -2000..2000，至少一个非零；坐标必须成对且落在主视口内，缺省使用视口中心。主进程使用单次 Room 序列化的 CDP `Input.synthesizeScrollGesture`（mouse source）定位并滚动页面或嵌套容器，不运行网页脚本、不激活后台 Room。
- 验收发现直接对后台 WebContentsView 派发 CDP `mouseWheel` 未产生页面滚动；改用 mouse-source scroll gesture 后，隔离 Electron fixture 中长文档和坐标命中的内部滚动面板都实际滚动。该差异只在当前 macOS/Electron 运行态观测，不推断其他平台或所有 Chromium 版本相同。

## 2026-11-04 Browser SDK 与 MCP 的 contenteditable 输入

- Issue #271 将 `Page.fill()` / `page_fill` 扩展到 `contenteditable="true"`、空属性与 `plaintext-only` 编辑宿主。Snapshot 和 role locator 将编辑宿主识别为 textbox；目标可以是宿主或其后代，但 Selection Range 只选中最近编辑宿主。实际输入使用可信 Backspace 与 Chromium `Input.insertText`，HTML 字符按文本处理，不直接写入 DOM/HTML。原有首字符的行内格式可能保留；换行遵循 Chromium 编辑器段落语义。
- 运行态观察：macOS Electron 中 `Meta+A` 会产生可信按键事件却没有选中编辑内容，因此以内部 Selection Range 限定选择范围；之后的删除与文本输入仍验证 `beforeinput` / `input` 为 `isTrusted`。
