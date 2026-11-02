# 端到端测试索引

本索引覆盖 `tests/` 下 46 项入口，其中 `tests/pi-real-model-smoke.cjs` 为需显式运行的真实模型验收，不属于 `npm test`。当前 `npm test` 配置包含 1 条 `node --test tests/*.e2e.mjs`（内部运行 3 个 `node:test` 文件）和 42 条独立脚本命令，共 45 项自动化检查。索引中的序号按 `package.json` 的 test 脚本顺序排列。除 `tests/recovery-e2e.cjs`（预期启动失败）与 `tests/agent-runtime-contract-e2e.cjs`（隔离数据目录的模块合同测试）外，每项都会启动真实 Electron；`tests/sdk-e2e.cjs` 先启动桌面，再运行 `sdk/e2e.js`。结果记录见 [验证记录](../reviews/verification-log.md)，各工作块的验收合同见 [执行任务板](../execution/feature-board.md)。

## 共同前提与限制

- 环境：本机 macOS、Electron 45.2.1、Node.js v24.22.1；最近一次全量回归为 2026-11-02，42 条独立脚本命令 + 3 项 `node:test`，共 45 项。
- 全量回归：此前一次运行在 `restore-loading-e2e` PASS 后未退出，已由 [Issue #34](https://github.com/heyallencao/corvid/issues/34) 跟踪并按非复现关闭。随后独立连续两次运行该用例均退出码 0；完整 `env -u ELECTRON_RUN_AS_NODE npm test` 为 37 条命令 / 39 项通过（EXIT 0）。清理阶段观测到 Electron exit 0 且 HTTP fixture 关闭；详见[验证记录](../reviews/verification-log.md)。
- 隔离：每项自建临时数据目录（`CORVID_DATA_DIR`），使用 `CORVID_PORT=0`、`CORVID_TEST_MODE=1`，下载相关使用 `CORVID_TEST_DOWNLOAD_DIR`；页面来自本地 HTTP 夹具（`127.0.0.1` 随机端口，部分用 `localhost` 制造跨来源）；不读写真实用户数据。
- 测试替身：权限确认、执行风险复核、Room 认领、关闭 Room、站点数据清理、站点权限撤销、beforeunload/标签关闭确认等系统对话框由 `dialog.showMessageBox` / `showMessageBoxSync` 替换；普通下载用测试目录绕开 `showSaveDialogSync`；下载"打开文件/在文件夹中显示"在测试中替换 `shell.openPath` / `shell.showItemInFolder`，只验证应用转发路径与错误呈现。原生对话框与真实系统应用交互本身未验证。
- 未覆盖：真实网站、真实用户数据、Windows、打包与分发、跨源 iframe 内容、closed Shadow DOM、`networkidle`、同步 renderer 卡死、断电/写入中断恢复、按 Agent 身份隔离；SIGKILL 恢复仅覆盖已提交状态后的 Room/标签与 Agent task 恢复。
- 每项结束时清理自己创建的 Electron 进程、HTTP 服务与临时目录。

## 索引

| # | 测试入口 | 验证内容 | 关键限制 |
| --- | --- | --- | --- |
| 1 | `tests/browser.e2e.mjs` | 真实 Electron + 本地夹具：未认证请求返回 401、`control.json` 权限 0600、创建两个 Room、同 Profile 跨 Room Cookie 共享、Snapshot/fill/click、后台 Room 不影响前台、`yieldControl` 等待进行中动作、接管后拒绝新动作、`resumeControl`、`evaluate` 超时字段、风险态阻止动作、晚到结果、已交还 Room 不被 Agent 删除、`/shutdown` 清理。 | 只用本地夹具；单进程；无崩溃/强杀；不涉及系统对话框；macOS。 |
| 2 | `tests/dialogs.e2e.mjs` | 页面 alert/confirm/prompt 与触发动作同时挂起时的观察与应答；prompt 默认值与取消返回 `null`；连续两个对话框；HTTP 请求中断后新连接可继续应答。 | 仅顶层文档；Electron 的 `prompt` 由 preload 同步桥提供；跨 frame、应用重启、调试器被外部工具分离未验证。 |
| 3 | `tests/uploads.e2e.mjs` | `setInputFiles` 多文件/单文件/空数组清空、相对路径/缺失路径/`multiple` 约束；同源 iframe 与开放 Shadow DOM；frame 文档替换后引用失效；`waitForFileChooser` 的 arm/click/setFiles/cancel、动态 input、节点移除、交还与超时。 | 无目录上传、跨源 frame、原生选择器 UI；清空文件输入使用非 `isTrusted` 合成事件；本地夹具。 |
| 4 | `tests/rpc-e2e.cjs` | 直接 HTTP 控制接口：不暴露 CDP 地址、Bearer 认证、Snapshot 引用与 fill/click/text/evaluate、截图 base64、等待动作与 `yieldControl` 的队列顺序、导航后旧引用失效、`/shutdown` 清除 `control.json`。 | API 级验证，不经过桌面 UI；本地夹具。 |
| 5 | `tests/library-e2e.cjs` | Playwright 驱动桌面 UI：创建 Room、地址栏导航、标题与历史记录、添加/删除书签、重启持久化、删除后重启为空。 | 本地夹具；不覆盖搜索、系统对话框、真实站点。 |
| 6 | `tests/sdk-e2e.cjs` | 包装脚本：启动隔离桌面并运行 `sdk/e2e.js`。SDK 覆盖截图（视口/整页/裁剪/路径与尺寸校验）、`waitForURL` 多种匹配、`waitForSelector` 四态、`waitForFunction`、定位符（css/xpath/text/role/href/frame）、Snapshot 引用与失效、`isTrusted: true` 的点击/输入/按键、`selectOption`、拖放/滚轮/鼠标、交还后动作被拒、popup 等待、`evaluate` 超时。 | 夹具仅单层同源 iframe 与开放 Shadow DOM；select 与清空为非 `isTrusted`；截图未逐像素校验；整体 30 秒超时。 |
| 7 | `tests/download-e2e.cjs` | 下载完成内容、同名文件不覆盖并标记失败、慢下载进度与取消、状态文案、重启历史、文件名/URL 搜索；使用临时下载目录。 | 保存对话框被测试模式绕开，非原生交互；本地夹具；断点续传与其他下载协议未验证。 |
| 8 | `tests/profiles-e2e.cjs` | 旧 schema（无 `profileId`）迁移到 default Profile；同 Profile Cookie 共享、跨 Profile Cookie/书签/历史/下载隔离；UI 创建与重命名 Profile（取消/空白/裁剪）；重启保持 ID、名称与隔离；未知 `profileId` 报错。 | 未覆盖删除 Profile、默认 Profile 选择；不使用真实 Chromium Profile；本地夹具。 |
| 9 | `tests/browser-shortcuts-e2e.cjs` | 通过 Electron `sendInputEvent` 验证 Cmd/Ctrl+T/L/W/R/`[`/`]`、Control+Tab、数字切标签、缩放 `+`/`-`/`0`；地址栏导航；搜索模板校验/保存与 `{query}` 搜索；设置按 Profile 隔离并跨重启保持。 | 只覆盖清单内快捷键；以 macOS 键位为主；未验证 Windows 键位；本地夹具。 |
| 10 | `tests/browser-print-e2e.cjs` | 真实 Electron + 本地 HTTP fixture：更多浏览工具菜单与 Cmd/Ctrl+P 发起当前活动用户页面打印；断言调用当前选中 WebContents、`silent:false` 与背景打印；失败显示可访问状态提示；取消打印对话框显示取消状态而非失败。 | 用 WebContents.print 测试替身，不打开真实打印机/系统对话框；只验证当前 macOS 键位与本地页面；Agent/MCP 无打印入口。原生 macOS 对话框仍需人工复核。 |
| 11 | `tests/evaluation-risk-e2e.cjs` | `evaluate` 永不返回触发 `timed_out`；桌面出现风险提示；重启变为 `unknown_after_restart`；动作被阻止；确认保留风险后仍由用户控制；确认清除后可交还并继续操作。 | 系统确认框为替身；未覆盖同步 renderer 卡死；本地夹具。 |
| 12 | `tests/recovery-e2e.cjs` | 坏 JSON、无效结构、重复 Room/标签 ID 三类会话文件下，启动退出码 1、stderr 提示原文件未修改、文件字节不变、不产生 `control.json`。 | 只覆盖启动失败路径；不覆盖版本升级、权限错误、强杀恢复。 |
| 13 | `tests/data-directory-e2e.cjs` | 真实 Electron 在隔离 `CORVID_DATA_DIR` 被设为只读（0500）时，于加载写数据模块前以退出码 1 迅速停止；stderr 含 Corvid 诊断、目录路径与 `EACCES`；目录中没有部分状态或探测文件。 | 测试模式不弹原生错误对话框，只验证同一诊断文本和退出；原生系统对话框的实际呈现仍未人工复核。 |
| 14 | `tests/sigkill-recovery-e2e.cjs` | 真实 Electron 主进程被 `SIGKILL` 后以同一隔离数据目录重启；验证 Room ID、标签 ID/URL、活动 Room/标签恢复；旧 Bearer 在新控制服务上返回 401；运行中的 Agent task 与 assistant turn 恢复为 `interrupted`，桌面显示“等待检查”而非完成。 | 使用本地 HTTP fixture 与确定性 Agent fixture，不调用模型；只覆盖已原子写入后的进程强制终止，不模拟断电、写入中途杀进程、renderer crash 或真实网站。 |
| 15 | `tests/permissions-e2e.cjs` | 通知权限：请求先转交用户并拒绝/允许；查询 `Notification.permission` 与 `navigator.permissions.query`；同 Profile 共享、跨 Profile 隔离；桌面 UI 撤销；确认期间导航竞态不授予原来源；重启后不保留；站点工具菜单由键盘触发、方向/Home/End 导航、Tab 离开、Escape 恢复焦点、点外关闭与 `aria-expanded` 同步。 | 系统权限弹窗为替身；只验证通知（地理位置仅有查询状态），真实地理位置服务与设备权限未覆盖；菜单使用本地 HTTP fixture，不是屏幕阅读器验收。 |
| 16 | `tests/dialogs-ui-e2e.cjs` | 桌面"网页对话框"面板显示页面 prompt、编辑答复并提交，触发动作完成且 Room 仍归 Agent。 | 只覆盖 prompt 的 UI 路径，单次；无重启与跨 frame。 |
| 17 | `tests/user-control-e2e.cjs` | 动作进行中点击"接管"→ 显示挂起状态、新 Agent 动作被拒、其他 Room 可用、`waitForControl` 超时；动作完成后控制权归用户且跨重启保持；Agent `resumeControl` 被拒直到用户"交还"；接管中退出产生未知风险、复核后可交还；Room 删除后等待报错。 | 风险确认框为替身；未覆盖强制退出与清理失败；本地夹具。 |
| 18 | `tests/site-data-e2e.cjs` | "站点数据"确认/取消；确认期间页面或 Profile 改变则拒绝；按来源清理 Cookie/localStorage/IndexedDB/Cache Storage/Service Worker；跨 Profile、跨站点隔离；同主机不同端口共享 Cookie 但 localStorage 分开。 | 系统确认框为替身；未覆盖 Profile 级清理、子域、filesystem storage；不清理 HTTP 缓存与历史。 |
| 19 | `tests/cli-e2e.cjs` | `node cli/corvid.mjs run`：按名称/ID 创建与恢复 Room；`p1`/`p2`/`p3` label 与并发同名只创建一个 Room；用户 Room、歧义名称、不存在 ID 报错；用户标签与未知来源标签保护；重启后 label 不重用；旧记录缺 label/openedBy 视为 unknown。 | 脚本为 `AsyncFunction`，无静态 `import`/`export`；单凭据；本地夹具；未覆盖自动安装/skill 集成。 |
| 20 | `tests/page-lifecycle-e2e.cjs` | adopt 未管理页（用户/未知来源）、Room 归属校验、初始化中不可 adopt、关闭加载中标签不退出应用；release 与旧句柄失效；`finish` 的 keep 空/指定/all 与收据、保留用户页面、保留 Room 与关闭空 Room；重启保持 finished 状态；label 不复用。 | 未覆盖崩溃/失败中途退出清理；依赖桌面 UI 点击标签；本地夹具。 |
| 21 | `tests/claim-e2e.cjs` | 用户 Room 认领：`openRoom` 拒绝；确认框含私人数据提示；拒绝；确认期间 Room 改变则作废；批准后归 Agent；用户页不可关；`adopt` 后可操作；`finish` 归还用户；`claimRoom` 的 CLI 入口。 | 系统确认框为替身；本地夹具。 |
| 22 | `tests/restore-loading-e2e.cjs` | 预置含慢请求的 `rooms.json`：慢标签未 ready 时其他 Room 与控制接口可用；保存 URL 不被空白页覆盖；用户/Agent 可改导航；历史不重复；重启保持替换后的 URL。 | 未覆盖强杀、不可写会话文件、大量标签资源消耗；本地夹具。 |
| 23 | `tests/library-search-e2e.cjs` | UI 搜索历史/书签（标题/URL、大小写不敏感）、空结果、筛选后删除、切换面板清空搜索、Profile 切换隔离、重启保持。 | 本地子串筛选，无模糊/分词；未测大数据性能；本地夹具。 |
| 24 | `tests/room-close-e2e.cjs` | UI 关闭 Room：取消保留；确认文案含标签数与书签；确认期间新增标签则拒绝；Agent 控制 Room 的提示；关闭后书签/历史保留；重启后 Room 不存在。 | 系统确认框为替身；未覆盖原生界面与异常关闭。 |
| 25 | `tests/beforeunload-e2e.cjs` | 页面 `beforeunload` 取消导航保留草稿并转交用户；确认后导航；多标签关闭的部分完成提示；标签关闭确认与调试器重连；Room 关闭/`finish` 遇到阻止关闭时报部分完成。 | beforeunload 与关闭确认对话框为替身；未覆盖调试器重连失败与崩溃。 |
| 26 | `tests/popup-events-e2e.cjs` | 等待 popup 期间初始化中的弹出标签被用户关闭后，等待以"Popup closed before it could be observed"明确报错，事件仍可观察。 | 仅覆盖此边界；popup 事件为内存记录，不跨重启；本地夹具。 |
| 27 | `tests/agent-download-e2e.cjs` | Agent 下载捕获（来源页归属、URL、文件名、失败、临时路径、`saveAs`、`delete`）；不弹出系统保存对话框；其他页面触发下载不被错误归属；下载中取消；交还时等待中断；`finish` 与退出清理临时文件。 | 跨 frame、异常退出、Windows 未验证；SDK 断开时临时文件是否保留未单测；本地夹具。 |
| 28 | `tests/page-fetch-e2e.cjs` | `page.fetch`：页面 Cookie 与 `credentials: omit`、POST 与请求头、HTTP 404、CORS 拒绝/允许、二进制 `saveAs`、8 MiB 上限不写文件、超时关闭连接、交还后拒绝。 | 不撤销服务端副作用；未覆盖 Service Worker、跨 frame、其他平台；请求体受本地控制通道限制。 |
| 29 | `tests/load-state-e2e.cjs` | `waitForLoadState` 区分 `domcontentloaded` 与 `load`（延迟图片）、超时、交还中断等待、同文档导航；`networkidle` 明确不支持。 | 状态属于已提交文档，过早调用可能观察旧文档；`networkidle` 未实现；本地夹具。 |
| 30 | `tests/contract-e2e.cjs` | Agent API 合同：`keyboard.*`（type/press/down/up/insertText/paste 原生粘贴与焦点）、`focus`、`dblclick`、`reload`、`waitForTimeout`、`info()`/`targetId`、`events()` 排空 popup 事件、动作 `receipt`（popup/dialog）、`cdp()` 原始协议逃生口、错误码（TIMEOUT/NOT_FOUND/STALE_REFERENCE/CONTROL_LOST）。 | 只用本地夹具；`keyboard.paste` 依赖系统剪贴板，恢复是 best-effort；`dblclick` 只验证单层文档；错误码映射基于消息分类，未覆盖全部错误路径。 |
| 31 | `tests/snapshot-e2e.cjs` | Snapshot v2：`page`/`full_page`/`viewport`/`subtree` 范围；多层同源 iframe；`@N` 引用作为动作目标；`frame` 标注；`:has-text`/`:text-is`/`>> nth=` 选择器子集；跨源 iframe 计入 `inaccessibleFrames`；截断与 `total`。 | 跨源 iframe 内容与 closed Shadow DOM 仍不可见；`subtree` 根为跨源 iframe 时报错；本地夹具；未做真实站点体积与性能验证。 |
| 32 | `tests/tab-ux-e2e.cjs` | 桌面 UI：页面 favicon 出现在标签栏；Cmd/Ctrl+F 打开查找条、匹配计数 `1/3`、Enter/Shift+Enter 前后跳转、Esc 关闭；第二标签页；指针拖拽把第一个标签移到第二个之后并用 `/rooms` 断言顺序；切换标签关闭查找条；中键关闭标签。 | 只用本地夹具与单层文档；查找不覆盖跨 frame 高亮与长页面性能；拖拽只验证指针拖动路径，不是原生标签栏；macOS 键位为主。 |
| 33 | `tests/tab-pin-menu-e2e.cjs` | 标签固定与菜单：右键、`Shift+F10`、ContextMenu 键均可打开；焦点进入首项；方向键循环、Home/End 导航；Tab/Shift+Tab 离开并将焦点移至相邻 shell 控件；Escape 关闭并恢复触发标签焦点；ARIA 菜单关系/展开状态同步；并覆盖固定、拖拽分组、复制链接目标、关闭其他标签、固定标签确认与重启恢复。 | 确认框与 `clipboard.writeText` 为测试替身；菜单是应用内 DOM 菜单，未验证原生（系统）右键菜单与 VoiceOver；固定不改变 `openedBy` 归属，Agent 关闭路径未在此项覆盖；本地夹具。 |
| 34 | `tests/window-state-e2e.cjs` | 多窗口边界位置/尺寸写入 `window-state.json` 并按稳定窗口 ID 重启恢复；旧单窗口对象格式仍可读；状态文件损坏回退默认尺寸；已移除显示器上的位置回退到可见区域。 | macOS；最大化/全屏切换、多显示器热插拔、Windows 窗口管理规则未覆盖；窗口系统可能微调边界坐标。 |
| 35 | `tests/multi-window-e2e.cjs` | 两个 BrowserWindow 与独立 shell UI；每窗 Room 列表隔离，控制 API 汇总所有 Room；Agent 可操作后台窗口 Room；关闭窗口将 Room 转移至剩余窗口；重启恢复窗口 ID 与 Room 归属，`rooms.json` 写为 schemaVersion=2。 | 真实 Electron + 本地 HTTP 页面夹具；macOS；未覆盖 Windows 焦点规则、多显示器窗口排列、窗口键盘切换与窗口崩溃恢复。 |
| 36 | `tests/download-file-ops-e2e.cjs` | 下载完成后“打开文件”与“在文件夹中显示”转发保存路径给 `shell.openPath` / `shell.showItemInFolder`（测试替身）；操作系统返回错误时以 `role=alert` 呈现；下载文件内容不变。 | shell 调用被替身替换，未验证真实应用打开或文件管理器行为；本地夹具与临时下载目录。 |
| 37 | `tests/agent-rooms-panel-e2e.cjs` | 真实 Electron 桌面 UI：Agent 工作区面板开合与空态；书签、历史、下载、Agent Rooms 与 Corvid Agent 面板经关闭按钮关闭后键盘焦点返回打开面板的侧栏项，面板切换时恢复目标随之更新；同 Profile 多个 Agent Room 并行显示且不跨 Profile 泄露；窄窗口行布局无横向溢出；键盘 Tab/Enter 接管与交还；执行超时状态和复核入口；查看 Room 后面板关闭且活动 Room 更新。 | 风险复核的原生对话框由测试替身处理；本地隔离数据目录与 `about:blank` 页面；不接入真实 Agent 执行器。 |
| 38 | `tests/mcp-e2e.cjs` | stdio MCP initialize/tools/list/tools/call；只读与写工具 annotations；显式 Profile/Room/Tab 选择；页信息与 snapshot；本地 HTTP 导航；role 定位器 fill/press/click 并通过后续 snapshot 检查页面实际状态；拒绝 `javascript:` 导航；未知 ID、桌面离线错误；用户接管后拒绝读取和写入。 | 真实 Electron + 隔离数据目录；页面使用本地 HTTP fixture；JSON-RPC 子进程验证，不是 Claude Desktop/Cursor UI 配置、真实 MCP host 或真实网站兼容性测试。 |
| 39 | `tests/agent-runtime-contract-e2e.cjs` | 不启动 Electron 的模块合同测试：旧任务数组原子迁移到 Corvid schemaVersion 2；旧 session 路径保留在不透明的 runtime checkpoint 中；能续聊的旧 checkpoint 经 adapter 恢复；未知 runtime 数据保留并显示不可续聊状态；不支持的 schema 拒绝改写；只读目录写入失败时旧文件字节不变；第二个独立假 runtime 通过相同任务/对话合同。 | 仅临时数据目录与确定性假 runtime；不验证 Pi SDK/真实 provider；Electron UI 启动与用户可见恢复提示由 `pi-workbench-e2e.cjs` 覆盖。 |
| 40 | `tests/pi-runtime-e2e.cjs` | Pi SDK session 在隔离 Corvid Room/Profile/Tab 上启动；未确认上下文、跨 Profile 与用户控制 Room 均拒绝；Pi transcript 路径位于任务专属目录；活跃工具仅含 Corvid snapshot/navigation，默认文件系统/shell/扩展关闭。 | 不调用真实模型/provider；使用隔离 Pi 配置目录与 `about:blank` 页面，以 SDK 打开合成 transcript 验证恢复路径、task 目录边界与工具 allowlist。 |
| 41 | `tests/pi-models-e2e.cjs` | Pi 聊天模型目录包含 GPT-6 Luna；模型选择跨 Corvid 重建持久化且文件权限为 0600；模型设置不包含凭据；无账号时拒绝创建模型 session；临时目录中的 API Key 通过 Pi 登录合同写入并在新 runtime 中仍可识别；开始 task 时记录模型，并在用户切换默认模型后续聊仍使用原模型。 | 全部使用临时 Pi 配置目录与 Corvid 数据目录；不发真实 API Key 请求、不测试 OAuth 浏览器回调或 UI API Key 登录/退出；真实 GPT-6 Luna 请求单独验收。 |
| 42 | `tests/pi-workbench-e2e.cjs` | 真实 Electron 桌面：Corvid Agent 当前对话、可展开历史、新建会话与同一对话多轮续聊；本地页面来源预览与未同意时禁止发送；任务目标、执行状态和页面来源分开展示；用户可见界面不出现运行时名称，运行时专属错误转换成 Corvid Agent 提示；Provider 断连 fixture 保留会话记录、仅播报一个失败 alert、重新检查同意后恢复同一任务；重启续聊、用户接管/交还、移除任务和 700×420 窄短窗口可见性。 | 不调用真实模型；确定性 fixture 不证明真实 provider 故障时对话记录完整性；不替代人工视觉/屏幕阅读器检查；浏览器页面为本地 HTTP 夹具。 |
| 43 | `tests/pi-custom-endpoint-e2e.cjs` | 真实 Electron UI 发现本地兼容端点模型、保存无 Key 端点、选择模型、创建并运行 Pi session；确认请求实际到达本地 fixture、Pi config 写入 Corvid 的 `pi-agent` 目录且权限为 0700。 | 仅本地 HTTP OpenAI Chat Completions fixture；不连接真实 provider；无 Key 时 Pi 会发送无敏感占位 Bearer，服务端需忽略该头。 |
| 44 | `tests/chrome-import-e2e.cjs` | 合成 Chrome User Data 多 Profile 发现；书签/历史解析与 UI 导入；导入时明确选择不同于当前活动 Profile 的 Corvid 目标，并验证书签/历史归属与失败重试目标固定；扩展逐项选择、多个版本选最新、无效 manifest 过滤、符号链接失败清理、权限展示、真实 content script 执行、目标 Profile 隔离、重复导入、启停/移除与跨重启恢复；合成 v10 Cookie 解密及属性保留；首次导入/稍后选择持久化；选择 Cookie 时需单独确认敏感数据说明后才启用导入；Cookie flushStore 故障时回滚并可重试、回滚持久化失败明确告警；单 Cookie set 故障单独计数、提示部分导入、保留来源重试且已写 Cookie 去重；同域/名称/路径下不同值 Cookie 冲突保留目标值，非冲突持久 Cookie 导入并跨重启保留；library.json 替换失败时旧数据与临时文件清理正确并可重试；源 Chrome 书签/历史哈希不变。 | Cookie 密钥通过仅测试模式环境覆盖为合成值，不读系统钥匙串；故障只针对测试环境配置的 Cookie 名称并注入一次；验证 HostOnly/Domain Cookie 写入 Corvid Session、Profile 隔离、持久 Cookie 重启恢复与会话 Cookie 退出失效；不覆盖密码、扩展更新及完整 Chrome API；原生文件选择器替身；macOS 真实 Electron + 临时 Profile fixture，不读真实 Chrome 数据。 |
| 45 | `tests/navigation-error-e2e.cjs` | 真实 Electron 主框架导航失败时显示用户可读错误、保留失败 URL 并提供重试；恢复本地服务后重试成功且清除错误；加载状态可见；新建空白标签立即选中并接收地址栏导航；新导航替代挂起请求后不遗留旧失败状态。 | 临时 Corvid 数据目录与本地 HTTP fixture；只映射少数网络错误到中文说明，证书失败显示通用安全连接提示；不覆盖所有 Chromium 错误码、代理/DNS 环境及原生证书详情页面。 |
| 46 | `tests/pi-real-model-smoke.cjs`（手动运行） | 在隔离 `CORVID_DATA_DIR` 中经 Corvid 发起 ChatGPT OAuth，断言 Corvid auth 文件存在、session 实际 provider/model 是 `openai-codex/gpt-6-luna`，向本地 HTTP 页面上下文请求并收到标记响应。 | 会访问真实 OpenAI/Codex 服务并消耗账户用量；不得读取外部 CLI 凭据，不纳入 `npm test`；需在 Corvid OAuth 对话框及浏览器中完成账号授权；当前执行证据限本机 macOS。 |

## 工作块与测试的映射

| 工作块 | 主要测试入口 |
| --- | --- |
| D01 启动、恢复与会话文件 | `recovery-e2e`、`data-directory-e2e`、`sigkill-recovery-e2e`、`restore-loading-e2e`、`cli-e2e`、`page-lifecycle-e2e` |
| D02 Room 控制权 | `user-control-e2e`、`browser.e2e`、`sdk-e2e`、`load-state-e2e` |
| D03 权限与浏览器提示 | `permissions-e2e`、`dialogs.e2e`、`dialogs-ui-e2e` |
| D04 执行风险与清理 | `evaluation-risk-e2e`、`sdk-e2e`、`browser.e2e` |
| D05 浏览数据边界 | `site-data-e2e`、`profiles-e2e`、`permissions-e2e`、`browser.e2e` |
| D06 标签、窗口与导航 | `browser-shortcuts-e2e`、`room-close-e2e`、`beforeunload-e2e`、`popup-events-e2e`、`tab-ux-e2e`、`tab-pin-menu-e2e`、`window-state-e2e`、`multi-window-e2e` |
| D07 用户界面与导航 | `library-e2e`、`library-search-e2e`、`browser-shortcuts-e2e`、`claim-e2e`、`tab-ux-e2e`、`tab-pin-menu-e2e` |
| D08 历史、书签与下载 | `library-e2e`、`library-search-e2e`、`download-e2e`、`download-file-ops-e2e` |
| D09 Profile 管理 | `profiles-e2e` |
| D10 Page 与 SDK 合同 | `sdk-e2e`、`rpc-e2e`、`cli-e2e`、`page-lifecycle-e2e`、`claim-e2e`、`contract-e2e`、`snapshot-e2e` |
| D11 输入与网页能力 | `uploads.e2e`、`sdk-e2e`、`contract-e2e` |
| D19 内置 Agent / Pi runtime | `pi-runtime-e2e`（session 创建、transcript 路径边界与工具 allowlist；无真实模型）、`pi-models-e2e`（模型目录、选择持久化、无凭据拒绝、临时 API Key 持久化、任务创建与续聊模型保持；无真实请求）、`pi-workbench-e2e`（Corvid Agent 对话/历史/模型 UI、700×420 页面来源/模型/输入及页面同意、多轮续聊、重启恢复、用户接管与交还；本地 fixture）、`pi-custom-endpoint-e2e`（Corvid 端点配置、发现与本地兼容 fixture 请求）、`pi-real-model-smoke`（Corvid ChatGPT OAuth + GPT-6 Luna 单次真实请求） |
| D12 状态、接管与多 Agent 体验 | `user-control-e2e`、`evaluation-risk-e2e`、`dialogs-ui-e2e`、`permissions-e2e`、`agent-rooms-panel-e2e` |
| D07 用户界面与日常导航 | `navigation-error-e2e`（加载状态、主框架失败提示、URL 保留、重试与被替代导航） |
| D13 首次启动与 Chrome 导入 | `chrome-import-e2e`（书签/历史、可选择非活动 Profile 作为目标并在失败重试时锁定目标、合成 v10 Cookie 解密、Cookie 类别单独确认、Profile 隔离、扩展执行与重启恢复、重复导入、Cookie flushStore 故障回滚/重试与回滚故障告警、不同值 Cookie 冲突保留、library.json 替换失败回滚/重试、引导状态；真实系统钥匙串授权未覆盖） |

## 单独运行

- 3 个 `node:test` 文件：`node --test tests/browser.e2e.mjs`、`node --test tests/dialogs.e2e.mjs`、`node --test tests/uploads.e2e.mjs`。
- 37 个独立脚本：例如 `node tests/rpc-e2e.cjs`、`node tests/user-control-e2e.cjs`、`node tests/sdk-e2e.cjs`、`node tests/contract-e2e.cjs`、`node tests/snapshot-e2e.cjs`、`node tests/agent-rooms-panel-e2e.cjs`、`node tests/mcp-e2e.cjs`、`node tests/pi-runtime-e2e.cjs`，其余按 `package.json` 中顺序运行。
- `tests/sdk-e2e.cjs` 会自行启动隔离桌面并运行 `sdk/e2e.js`；如已单独启动桌面，也可在相同 `CORVID_DATA_DIR` 下直接运行 `node sdk/e2e.js`。
- 沙箱/CI 环境需清理 `ELECTRON_RUN_AS_NODE` 并允许 Chromium 建立沙箱，否则真实 Electron 可能无法启动。

## 维护约定

- 新增或修改测试时，必须同步更新本索引、[验证记录](../reviews/verification-log.md) 和 [执行任务板](../execution/feature-board.md) 中对应工作块的证据。
- "通过"只记录当次真实运行；不得用 API 级结果代替 UI 结果，也不得用本地夹具结果替代真实网站结论。
- 系统对话框替身、非 `isTrusted` 合成事件和轮询实现必须在"关键限制"列写明。
- 人眼布局检查不属于自动化项，记录在 [桌面 UI 视觉检查记录](ui-visual-check.md)，并在相关验收合同的证据列引用。
