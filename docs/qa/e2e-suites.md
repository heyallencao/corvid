# 端到端测试索引

本索引对应 `package.json` 的 `test` 脚本与 `tests/` 目录，共 32 项测试入口。`npm test` 共 30 条命令：1 条 `node --test tests/*.e2e.mjs`（内部运行 3 个 `node:test` 文件）加 29 条独立脚本命令。除 `tests/recovery-e2e.cjs` 预期启动失败外，每项都会启动真实 Electron；`tests/sdk-e2e.cjs` 先启动桌面，再运行 `sdk/e2e.js`。结果记录见 [验证记录](../reviews/verification-log.md)，各工作块的验收合同见 [执行任务板](../execution/feature-board.md)。

## 共同前提与限制

- 环境：本机 macOS、Electron 45.2.1、Node.js ≥ 22.12；2026-11-01 全量 30 条命令 / 32 项通过。
- 隔离：每项自建临时数据目录（`CORVID_DATA_DIR`），使用 `CORVID_PORT=0`、`CORVID_TEST_MODE=1`，下载相关使用 `CORVID_TEST_DOWNLOAD_DIR`；页面来自本地 HTTP 夹具（`127.0.0.1` 随机端口，部分用 `localhost` 制造跨来源）；不读写真实用户数据。
- 测试替身：权限确认、执行风险复核、Room 认领、关闭 Room、站点数据清理、站点权限撤销、beforeunload/标签关闭确认等系统对话框由 `dialog.showMessageBox` / `showMessageBoxSync` 替换；普通下载用测试目录绕开 `showSaveDialogSync`；下载"打开文件/在文件夹中显示"在测试中替换 `shell.openPath` / `shell.showItemInFolder`，只验证应用转发路径与错误呈现。原生对话框与真实系统应用交互本身未验证。
- 未覆盖：真实网站、真实用户数据、Windows、打包与分发、跨源 iframe 内容、closed Shadow DOM、`networkidle`、同步 renderer 卡死、强制 kill 与崩溃恢复、多窗口、按 Agent 身份隔离。
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
| 10 | `tests/evaluation-risk-e2e.cjs` | `evaluate` 永不返回触发 `timed_out`；桌面出现风险提示；重启变为 `unknown_after_restart`；动作被阻止；确认保留风险后仍由用户控制；确认清除后可交还并继续操作。 | 系统确认框为替身；未覆盖同步 renderer 卡死；本地夹具。 |
| 11 | `tests/recovery-e2e.cjs` | 坏 JSON、无效结构、重复 Room/标签 ID 三类会话文件下，启动退出码 1、stderr 提示原文件未修改、文件字节不变、不产生 `control.json`。 | 只覆盖启动失败路径；不覆盖版本升级、权限错误、强杀恢复。 |
| 12 | `tests/permissions-e2e.cjs` | 通知权限：请求先转交用户并拒绝/允许；查询 `Notification.permission` 与 `navigator.permissions.query`；同 Profile 共享、跨 Profile 隔离；桌面 UI 撤销；确认期间导航竞态不授予原来源；重启后不保留。 | 系统权限弹窗为替身；只验证通知（地理位置仅有查询状态），真实地理位置服务与设备权限未覆盖；本地夹具。 |
| 13 | `tests/dialogs-ui-e2e.cjs` | 桌面"网页对话框"面板显示页面 prompt、编辑答复并提交，触发动作完成且 Room 仍归 Agent。 | 只覆盖 prompt 的 UI 路径，单次；无重启与跨 frame。 |
| 14 | `tests/user-control-e2e.cjs` | 动作进行中点击"接管"→ 显示挂起状态、新 Agent 动作被拒、其他 Room 可用、`waitForControl` 超时；动作完成后控制权归用户且跨重启保持；Agent `resumeControl` 被拒直到用户"交还"；接管中退出产生未知风险、复核后可交还；Room 删除后等待报错。 | 风险确认框为替身；未覆盖强制退出与清理失败；本地夹具。 |
| 15 | `tests/site-data-e2e.cjs` | "站点数据"确认/取消；确认期间页面或 Profile 改变则拒绝；按来源清理 Cookie/localStorage/IndexedDB/Cache Storage/Service Worker；跨 Profile、跨站点隔离；同主机不同端口共享 Cookie 但 localStorage 分开。 | 系统确认框为替身；未覆盖 Profile 级清理、子域、filesystem storage；不清理 HTTP 缓存与历史。 |
| 16 | `tests/cli-e2e.cjs` | `node cli/corvid.mjs run`：按名称/ID 创建与恢复 Room；`p1`/`p2`/`p3` label 与并发同名只创建一个 Room；用户 Room、歧义名称、不存在 ID 报错；用户标签与未知来源标签保护；重启后 label 不重用；旧记录缺 label/openedBy 视为 unknown。 | 脚本为 `AsyncFunction`，无静态 `import`/`export`；单凭据；本地夹具；未覆盖自动安装/skill 集成。 |
| 17 | `tests/page-lifecycle-e2e.cjs` | adopt 未管理页（用户/未知来源）、Room 归属校验、初始化中不可 adopt、关闭加载中标签不退出应用；release 与旧句柄失效；`finish` 的 keep 空/指定/all 与收据、保留用户页面、保留 Room 与关闭空 Room；重启保持 finished 状态；label 不复用。 | 未覆盖崩溃/失败中途退出清理；依赖桌面 UI 点击标签；本地夹具。 |
| 18 | `tests/claim-e2e.cjs` | 用户 Room 认领：`openRoom` 拒绝；确认框含私人数据提示；拒绝；确认期间 Room 改变则作废；批准后归 Agent；用户页不可关；`adopt` 后可操作；`finish` 归还用户；`claimRoom` 的 CLI 入口。 | 系统确认框为替身；本地夹具。 |
| 19 | `tests/restore-loading-e2e.cjs` | 预置含慢请求的 `rooms.json`：慢标签未 ready 时其他 Room 与控制接口可用；保存 URL 不被空白页覆盖；用户/Agent 可改导航；历史不重复；重启保持替换后的 URL。 | 未覆盖强杀、不可写会话文件、大量标签资源消耗；本地夹具。 |
| 20 | `tests/library-search-e2e.cjs` | UI 搜索历史/书签（标题/URL、大小写不敏感）、空结果、筛选后删除、切换面板清空搜索、Profile 切换隔离、重启保持。 | 本地子串筛选，无模糊/分词；未测大数据性能；本地夹具。 |
| 21 | `tests/room-close-e2e.cjs` | UI 关闭 Room：取消保留；确认文案含标签数与书签；确认期间新增标签则拒绝；Agent 控制 Room 的提示；关闭后书签/历史保留；重启后 Room 不存在。 | 系统确认框为替身；未覆盖原生界面与异常关闭。 |
| 22 | `tests/beforeunload-e2e.cjs` | 页面 `beforeunload` 取消导航保留草稿并转交用户；确认后导航；多标签关闭的部分完成提示；标签关闭确认与调试器重连；Room 关闭/`finish` 遇到阻止关闭时报部分完成。 | beforeunload 与关闭确认对话框为替身；未覆盖调试器重连失败与崩溃。 |
| 23 | `tests/popup-events-e2e.cjs` | 等待 popup 期间初始化中的弹出标签被用户关闭后，等待以"Popup closed before it could be observed"明确报错，事件仍可观察。 | 仅覆盖此边界；popup 事件为内存记录，不跨重启；本地夹具。 |
| 24 | `tests/agent-download-e2e.cjs` | Agent 下载捕获（来源页归属、URL、文件名、失败、临时路径、`saveAs`、`delete`）；不弹出系统保存对话框；其他页面触发下载不被错误归属；下载中取消；交还时等待中断；`finish` 与退出清理临时文件。 | 跨 frame、异常退出、Windows 未验证；SDK 断开时临时文件是否保留未单测；本地夹具。 |
| 25 | `tests/page-fetch-e2e.cjs` | `page.fetch`：页面 Cookie 与 `credentials: omit`、POST 与请求头、HTTP 404、CORS 拒绝/允许、二进制 `saveAs`、8 MiB 上限不写文件、超时关闭连接、交还后拒绝。 | 不撤销服务端副作用；未覆盖 Service Worker、跨 frame、其他平台；请求体受本地控制通道限制。 |
| 26 | `tests/load-state-e2e.cjs` | `waitForLoadState` 区分 `domcontentloaded` 与 `load`（延迟图片）、超时、交还中断等待、同文档导航；`networkidle` 明确不支持。 | 状态属于已提交文档，过早调用可能观察旧文档；`networkidle` 未实现；本地夹具。 |
| 27 | `tests/contract-e2e.cjs` | Agent API 合同：`keyboard.*`（type/press/down/up/insertText/paste 原生粘贴与焦点）、`focus`、`dblclick`、`reload`、`waitForTimeout`、`info()`/`targetId`、`events()` 排空 popup 事件、动作 `receipt`（popup/dialog）、`cdp()` 原始协议逃生口、错误码（TIMEOUT/NOT_FOUND/STALE_REFERENCE/CONTROL_LOST）。 | 只用本地夹具；`keyboard.paste` 依赖系统剪贴板，恢复是 best-effort；`dblclick` 只验证单层文档；错误码映射基于消息分类，未覆盖全部错误路径。 |
| 28 | `tests/snapshot-e2e.cjs` | Snapshot v2：`page`/`full_page`/`viewport`/`subtree` 范围；多层同源 iframe；`@N` 引用作为动作目标；`frame` 标注；`:has-text`/`:text-is`/`>> nth=` 选择器子集；跨源 iframe 计入 `inaccessibleFrames`；截断与 `total`。 | 跨源 iframe 内容与 closed Shadow DOM 仍不可见；`subtree` 根为跨源 iframe 时报错；本地夹具；未做真实站点体积与性能验证。 |
| 29 | `tests/tab-ux-e2e.cjs` | 桌面 UI：页面 favicon 出现在标签栏；Cmd/Ctrl+F 打开查找条、匹配计数 `1/3`、Enter/Shift+Enter 前后跳转、Esc 关闭；第二标签页；指针拖拽把第一个标签移到第二个之后并用 `/rooms` 断言顺序；切换标签关闭查找条；中键关闭标签。 | 只用本地夹具与单层文档；查找不覆盖跨 frame 高亮与长页面性能；拖拽只验证指针拖动路径，不是原生标签栏；macOS 键位为主。 |
| 30 | `tests/window-state-e2e.cjs` | 窗口位置/尺寸写入 `window-state.json` 并在重启后恢复；状态文件为坏 JSON 时回退默认尺寸；保存位置在已移除显示器上时保持尺寸并回到可见区域。 | 只验证单窗口；最大化/全屏切换、多显示器热插拔、Windows 未覆盖；macOS 窗口系统可能对边界有细微调整（测试断言当前机器行为）。 |
| 31 | `tests/download-file-ops-e2e.cjs` | 下载完成后"打开文件"与"在文件夹中显示"把保存路径转发给 `shell.openPath` / `shell.showItemInFolder`（测试替身）；操作系统返回错误时以 `role=alert` 呈现；下载文件内容不变。 | `shell` 调用被替身替换，未验证真实应用打开、真实文件管理器、权限拒绝的真实系统错误；本地夹具与临时下载目录。 |
| 32 | `tests/tab-pin-menu-e2e.cjs` | 标签固定与右键菜单：右键固定使标签置顶并显示固定图标；跨固定分组的拖拽回弹且不隐式固定；`复制链接` 作用在打开菜单的标签而非当前激活标签；`关闭其他标签` 保留固定标签；关闭固定标签先确认（取消保留、确认移除）；固定状态跨重启保持并可取消固定。 | 确认框与 `clipboard.writeText` 为测试替身；菜单是应用内 DOM 菜单，未验证原生（系统）右键菜单；固定不改变 `openedBy` 归属，Agent 关闭路径未在此项覆盖；本地夹具。 |

## 工作块与测试的映射

| 工作块 | 主要测试入口 |
| --- | --- |
| D01 启动、恢复与会话文件 | `recovery-e2e`、`restore-loading-e2e`、`cli-e2e`、`page-lifecycle-e2e` |
| D02 Room 控制权 | `user-control-e2e`、`browser.e2e`、`sdk-e2e`、`load-state-e2e` |
| D03 权限与浏览器提示 | `permissions-e2e`、`dialogs.e2e`、`dialogs-ui-e2e` |
| D04 执行风险与清理 | `evaluation-risk-e2e`、`sdk-e2e`、`browser.e2e` |
| D05 浏览数据边界 | `site-data-e2e`、`profiles-e2e`、`permissions-e2e`、`browser.e2e` |
| D06 标签、窗口与导航 | `browser-shortcuts-e2e`、`room-close-e2e`、`beforeunload-e2e`、`popup-events-e2e`、`tab-ux-e2e`、`tab-pin-menu-e2e`、`window-state-e2e` |
| D07 用户界面与导航 | `library-e2e`、`library-search-e2e`、`browser-shortcuts-e2e`、`claim-e2e`、`tab-ux-e2e`、`tab-pin-menu-e2e` |
| D08 历史、书签与下载 | `library-e2e`、`library-search-e2e`、`download-e2e`、`download-file-ops-e2e` |
| D09 Profile 管理 | `profiles-e2e` |
| D10 Page 与 SDK 合同 | `sdk-e2e`、`rpc-e2e`、`cli-e2e`、`page-lifecycle-e2e`、`claim-e2e`、`contract-e2e`、`snapshot-e2e` |
| D11 输入与网页能力 | `uploads.e2e`、`sdk-e2e`、`contract-e2e` |
| D12 状态、接管与多 Agent 体验 | `user-control-e2e`、`evaluation-risk-e2e`、`dialogs-ui-e2e`、`permissions-e2e` |

## 单独运行

- 3 个 `node:test` 文件：`node --test tests/browser.e2e.mjs`、`node --test tests/dialogs.e2e.mjs`、`node --test tests/uploads.e2e.mjs`。
- 29 个独立脚本：例如 `node tests/rpc-e2e.cjs`、`node tests/user-control-e2e.cjs`、`node tests/sdk-e2e.cjs`、`node tests/contract-e2e.cjs`、`node tests/snapshot-e2e.cjs`，其余按 `package.json` 中顺序运行。
- `tests/sdk-e2e.cjs` 会自行启动隔离桌面并运行 `sdk/e2e.js`；如已单独启动桌面，也可在相同 `CORVID_DATA_DIR` 下直接运行 `node sdk/e2e.js`。
- 沙箱/CI 环境需清理 `ELECTRON_RUN_AS_NODE` 并允许 Chromium 建立沙箱，否则真实 Electron 可能无法启动。

## 维护约定

- 新增或修改测试时，必须同步更新本索引、[验证记录](../reviews/verification-log.md) 和 [执行任务板](../execution/feature-board.md) 中对应工作块的证据。
- "通过"只记录当次真实运行；不得用 API 级结果代替 UI 结果，也不得用本地夹具结果替代真实网站结论。
- 系统对话框替身、非 `isTrusted` 合成事件和轮询实现必须在"关键限制"列写明。
- 人眼布局检查不属于自动化项，记录在 [桌面 UI 视觉检查记录](ui-visual-check.md)，并在相关验收合同的证据列引用。
