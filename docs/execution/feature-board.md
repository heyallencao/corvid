# Corvid 执行任务板

本文件同时是 Corvid 的功能覆盖矩阵、交付顺序和端到端验收合同入口。产品主线是面向用户的完整浏览器：日常浏览与 Agent 协作在同一个桌面应用中完成。内置 Agent 与外部 SDK/CLI 共用 **Room**（同一 Profile 下的工作区与控制权边界）、**Profile**（浏览身份与 Cookie 隔离边界）、**Page**（标签页的 Agent 句柄，标签为 `p1`、`p2`…）、**Snapshot**（页面语义快照）及同一授权合同。控制权接口为 `yieldControl`（Agent 交还用户）、`resumeControl`（用户控制后 Agent 取回）、`waitForControl`（等待）；Room 接口为 `openRoom`、`listRooms`、`claimRoom`、`resumeRoom`。

规划与证据分开记录：本板只维护工作块、当前差距和验收合同；执行结果写入 [验证记录](../reviews/verification-log.md)，37 项测试的逐项说明见 [端到端测试索引](../qa/e2e-suites.md)，系统边界与关键决策见 [系统设计](../architecture/overview.md)。

## 当前事实与证据边界

- 实现形态：Electron 45.2.1 + Chromium；页面由 `WebContentsView` 承载；本地控制服务只监听 `127.0.0.1` 的随机端口，使用 Bearer token 认证，凭据写入 `control.json`（权限 0600），应用关闭时删除。
- 数据目录：默认 `~/.corvid`，可用 `CORVID_DATA_DIR` 覆盖；`CORVID_TEST_MODE`、`CORVID_PORT`、`CORVID_TEST_DOWNLOAD_DIR` 用于隔离测试。
- 持久化文件：`rooms.json`（`schemaVersion=2`；支持 v1 会话迁移；旧 `spaces.json` 在启动时自动迁移一次，原文件保留）、`library.json`（`schemaVersion=1`，历史/书签/下载）、`profiles.json`、`window-state.json`（窗口位置、尺寸、最大化状态，0600）、`agent-tasks.json`（Pi 任务绑定、输出与恢复状态，0600）、`control.json`。会话、库与窗口状态文件使用临时文件 + rename 原子写，权限 0600。
- 入口：桌面运行 `npm start`；全量回归 `npm test`；CLI 为 `node cli/corvid.mjs run < script.mjs` 与 `node cli/corvid.mjs help`。
- 2026-11-01 在本机 macOS、Electron 45.2.1、隔离临时数据目录下执行 `env -u ELECTRON_RUN_AS_NODE npm test`：31 条命令、33 项真实 Electron 测试全部通过（新增 `tests/multi-window-e2e.cjs`；含 Agent API 合同回归、Snapshot v2、标签与窗口产品化回归）。该结果只覆盖本地夹具和 macOS，未验证真实网站、真实用户数据、原生系统对话框、Windows 与打包分发。
- 2026-11-02 本机 macOS、Node.js v24.22.1、Electron 45.2.1、隔离临时数据目录：`env -u ELECTRON_RUN_AS_NODE npm test`，33 条命令 / 35 项真实 Electron 测试全部通过，新增 `tests/mcp-e2e.cjs`。另 `npm audit --audit-level=high` 为 0 vulnerabilities。仅覆盖 stdio 协议夹具与本地浏览器状态；真实 MCP host 配置、真实网站、打包入口、Windows 和真实模型未验证。
- 2026-11-02 Pi runtime 基础 E2E：`node tests/pi-runtime-e2e.cjs` 通过；Pi `1.4.0` 会话无 API 调用启动，工具清单仅含 `corvid_page_snapshot` / `corvid_navigate`，测试隔离 Pi 配置和 Corvid 数据目录；`npm audit --audit-level=high` 为 0 vulnerabilities。还未验证真实模型、桌面任务 UI、Pi transcript 首条消息写入或恢复。
- 2026-11-02 全量回归：本机 macOS、Node.js v24.22.1、Electron 45.2.1、隔离临时数据目录；`env -u ELECTRON_RUN_AS_NODE npm test` 35 条命令 / 37 项真实 Electron 用例全部通过，新增 `tests/pi-workbench-e2e.cjs`，Pi runtime 合同回归继续通过。`npm audit --audit-level=high` 为 0 vulnerabilities。Pi 无模型调用；未验证真实 MCP Host、真实网站、打包、Windows 或真实模型。
- 自动化中的系统对话框是测试替身（`dialog.showMessageBox` / `showMessageBoxSync` / `showSaveDialogSync` 被替换）；下载测试用测试模式与临时下载目录绕开保存对话框。相关条目只能证明应用状态流转，不能证明原生对话框交互。

## 状态定义与证据要求

| 状态 | 含义 | 证据要求 |
| --- | --- | --- |
| 待实现 | 没有可用实现，或没有可运行的端到端验收 | 无；不得出现在完成清单中 |
| 部分 | 已有实现且至少一项真实 Electron 端到端通过，但存在明确未覆盖边界 | 行内写清"覆盖"与"限制"；附测试入口；未覆盖项列入验收合同 |
| 已验证 | 在声明的平台和环境内，该行验收合同全部通过且可复现 | 命令、日期、操作系统、Electron 版本、隔离数据目录、夹具、预期/实测、失败日志与未覆盖条件 |

补充规则：

1. 单项通过不能关闭整行；"部分"不能写成"完成"。
2. 只测过 API 不等于测过桌面 UI；只测过 UI 不等于测过重启；只测过 macOS 不等于通过 Windows。
3. 系统对话框替身、非 `isTrusted` 合成事件、轮询式实现必须在证据中标出。
4. `evaluate` 超时表示"结果未知"，不是"已终止"；不得声称已撤销页面副作用。
5. 所有测试必须使用隔离数据目录和本地夹具，不得使用真实用户 Profile 或真实浏览数据。

截至 2026-11-01，没有条目达到"已验证"：33 项通过只覆盖本地夹具与 macOS，P0/P1 仍存在上表逐行列出的未覆盖边界。

## P0：可安全使用且控制权可靠

| ID | 状态 | 工作块与当前差距 | 可执行验收合同 |
| --- | --- | --- | --- |
| D01 | 部分 | **启动、恢复与会话文件**。已实现：启动读取 `rooms.json` 恢复 Room/标签；坏 JSON、结构无效、重复 Room/标签 ID 拒绝启动并保留原文件；慢页面异步恢复不阻塞其他 Room 与控制接口；`control.json` 0600 且关闭时删除；旧 `spaces.json` 一次性迁移并保留原文件。差距：强制杀进程/异常退出后的恢复、数据目录不可写、v1 到 v2 迁移缺少独立迁移测试与回滚策略、超大标签量资源消耗、旧数据目录搬迁。 | ① `node tests/recovery-e2e.cjs`：三类坏输入均退出码 1、stderr 含"原文件未修改"、原文件字节不变、不产生 `control.json`。② `node tests/restore-loading-e2e.cjs`：慢标签未 ready 时其他 Room 与 `/rooms` 可用，保存 URL 不被空白页覆盖，用户/Agent 可改导航，历史不重复，重启保持。③ 补测并写清阈值：未知 `schemaVersion` 拒绝且保留原文件；补测 v1→v2 会话迁移的字段保留与重启稳定性；只读数据目录给出可诊断错误；`SIGKILL` 后重启恢复；数千标签的启动时间与内存预算。④ 补测旧 `spaces.json` 迁移只发生一次、迁移后 ID 稳定；升级/回滚合同另行设计。 |
| D02 | 部分 | **Room 控制权**。已实现：桌面"接管"/"交还 Agent"；`yieldControl` 等正在进行动作完成后再返回；接管请求挂起期间新 Agent 动作被拒；其他 Room 不受影响；用户手动接管跨重启保持，Agent 不能自行 `resumeControl`；`waitForControl` 在用户交还后返回，在风险未清或 Room 删除时明确失败；接管未完成时退出会保留用户控制并标记结果未知。差距：强制退出、renderer 卡死、清理失败（下载/调试器/文件选择器）、设备提示、Windows 焦点与快捷键差异。 | ① `node tests/user-control-e2e.cjs`：接管中请求、动作完成、其他 Room、重启、`manualControl`、等待超时/成功、Room 删除报错。② `node --test tests/browser.e2e.mjs`：`yieldControl` 等待进行中动作，返回后新动作被拒，`resumeControl` 恢复。③ `node tests/load-state-e2e.cjs` 与 `node tests/sdk-e2e.cjs` 中等待类操作在交还时立即以 user control 失败。④ 补测：强制 kill、同步 renderer 卡死、清理失败、设备选择提示、Windows 平台。⑤ 合同：用户未"交还 Agent"前，任何 Agent 客户端不得取回控制权；`waitForControl` 只观察，不主动改变控制权。 |
| D03 | 部分 | **权限与浏览器提示**。已实现：主文档通知权限请求先转交用户再弹窗；允许/拒绝、状态查询、同 Profile 同来源共享、跨 Profile 与权限类型隔离、桌面 UI 撤销、导航竞态不授予原来源、重启不保留；页面 alert/confirm/prompt 可在触发动作仍挂起时经 SDK 应答，prompt 还支持经桌面 UI 应答，支持连续弹窗和连接中断后重连应答。差距：系统确认框为测试替身；摄像头/麦克风与真实地理位置服务、设备选择器、跨 frame 对话框、应用重启期间打开的对话框未验证。 | ① `node tests/permissions-e2e.cjs`：拒绝/允许/查询/撤销/隔离/导航竞态/重启。② `node --test tests/dialogs.e2e.mjs`、`node tests/dialogs-ui-e2e.cjs`：对话框等待、连续弹窗、prompt 默认值、UI 应答、触发动作保持挂起。③ 补测：摄像头/麦克风、真实地理位置、跨源 frame 对话框、设备选择器、原生对话框人工记录。④ 合同：无已存授权时查询当前显示 `denied`，这是已知限制，不得宣称已区分"未决定"与"拒绝"。 |
| D04 | 部分 | **长任务、执行风险与清理**。已实现：`evaluate` 的 `timeoutMs` 支持 100–60000；超时返回 `timed_out`、`executionStopped: false`、`mayHaveLateEffects: true`；Room 进入风险态并阻止新 Agent 动作与 `resumeControl`，`yieldControl` 仍可用；晚到结果更新为 `late_completed`/`late_failed`；重启后为 `unknown_after_restart`；桌面"页面执行状态未知"可保留或确认清除；`waitForFunction` 谓词超时同样进入风险态。差距：同步死循环、超时后的关闭/退出/清理、其他长时间操作（fetch/下载/上传）、风险确认后的页面副作用。 | ① `node --test tests/browser.e2e.mjs`、`node tests/sdk-e2e.cjs`：超时字段、风险阻止、晚到结果、跨重启。② `node tests/evaluation-risk-e2e.cjs`：UI 复核保留/清除并恢复动作。③ 补测：同步 renderer 卡死；超时后关闭页面/退出应用；清理失败；`fetch` 超时与下载取消后的风险语义。④ 合同：任何"超时"都不得报告为"执行已停止"，也不得撤销已发送请求、定时器或页面副作用。 |
| D05 | 部分 | **浏览数据边界**。已实现：同 Profile 的 Room 共享 Cookie；不同 Profile 的 Cookie、书签、历史、下载隔离；"站点数据"按 origin 清理 Cookie、localStorage、IndexedDB、Cache Storage、Service Worker，取消或确认期间页面/Profile 改变则拒绝；权限按 Profile + 来源记录；会话/库/Profile 文件原子写 0600；`control.json` 0600。差距：Profile 级清理、filesystem storage、子域/协议范围、真实系统确认框；HTTP 缓存与历史不在清理范围。 | ① `node tests/site-data-e2e.cjs`：取消、确认期间来源改变拒绝、跨 Profile/站点隔离、同主机不同端口共享 Cookie 而 localStorage 分开。② `node tests/profiles-e2e.cjs`：Cookie 共享与隔离、旧数据归 default Profile。③ 补测：Profile 级清理、子域、filesystem storage、清理后 Service Worker 残留；真实确认框人工验证。④ 合同：不得使用真实用户数据；清理影响范围必须在桌面 UI 文案中可见。 |

## P1：日常浏览、共享状态与 Agent 工作流

| ID | 状态 | 工作块与当前差距 | 可执行验收合同 |
| --- | --- | --- | --- |
| D06 | 部分 | **标签、窗口与导航**。已实现：多窗口（“新建窗口”按钮或 Cmd/Ctrl+N；每窗拥有独立 Room/Profile 选择与页面视图；关闭窗口时 Room 转移到剩余窗口；`rooms.json` schemaVersion=2 持久化窗口 ID/Room 归属并跨重启恢复）、标签创建/切换/关闭、地址栏导航、前进/后退/刷新、快捷键（Cmd/Ctrl+T、W、L、R、N、`[`、`]`、1–9、`+`/`-`/`0`、Control+Tab）、缩放与搜索模板、标签 favicon、标签拖拽排序、中键关闭标签、标签固定与右键菜单、窗口尺寸/位置/最大化状态持久化、`beforeunload` 与 Room 关闭保护、弹窗等待。差距：窗口焦点切换顺序、标签分组、最后标签关闭策略、原生菜单与系统对话框、全屏、popup 事件跨重启。`tests/multi-window-e2e.cjs` 覆盖创建、窗口间 Room 隔离、Agent API 跨窗访问、窗口关闭时 Room 转移、窗口与归属重启恢复。 | ① `node tests/browser-shortcuts-e2e.cjs`、`node tests/room-close-e2e.cjs`、`node tests/beforeunload-e2e.cjs`、`node tests/popup-events-e2e.cjs`、`node tests/sdk-e2e.cjs`、`node tests/tab-ux-e2e.cjs`、`node tests/tab-pin-menu-e2e.cjs`、`node tests/window-state-e2e.cjs`、`node tests/multi-window-e2e.cjs`。② 后续补测窗口焦点顺序、最后标签关闭行为、真实原生 beforeunload/关闭确认、原生右键菜单。③ 合同：快捷键只可宣称覆盖清单内组合；多窗口作为独立验收块，不得用单窗口结果替代；拖拽排序只证明指针拖动与状态顺序，不证明原生标签栏行为；固定标签不改变标签归属（`openedBy`）与 Agent 关闭权限，Agent 路径（`closeTab`/`finish`/`closeRoom`）不受固定状态影响。 |
| D07 | 部分 | **用户界面与日常导航**。已实现：Room/Profile 选择、标签栏（favicon、拖拽排序、中键关闭、固定标签置顶与固定图标、右键菜单）、地址栏、状态区、页内查找（Cmd/Ctrl+F 查找条、结果计数、Enter/Shift+Enter 前后跳转、Esc 关闭、切换标签自动关闭）、设置（搜索模板/缩放）、历史/书签/下载面板、错误以 `role=alert`/`role=status` 呈现、缩放按 Profile 保存。差距：加载失败/证书错误/重定向页面、错误页与重试、地址解析边界、焦点与纯键盘操作、窗口最小尺寸布局、视觉基线、真实搜索引擎、原生（系统）菜单、页内查找的跨 frame 匹配与高亮样式、查找条在真实长页面上的性能。 | ① 通过桌面 UI 实测而非仅 API：成功导航、错误地址、页面加载失败、重定向、慢加载、缩放与窗口 resize；断言可见文案、URL、标题与焦点。② `node tests/tab-ux-e2e.cjs`：favicon 来自页面、查找计数与前后跳转、Esc 关闭、切换标签关闭查找条。③ `node tests/tab-pin-menu-e2e.cjs`：右键菜单各条目作用在打开菜单的标签上、Escape 关闭菜单、`role=menuitem` 键盘可达；固定标签的固定/取消固定与图标呈现。④ 记录实际错误与页面状态，不只断言接口成功。⑤ 人眼布局检查记录见 [桌面 UI 视觉检查记录](../qa/ui-visual-check.md)（发现并修复查找条遮挡工具栏）；截图仅作为辅助证据，逐像素视觉基线另行建立。⑥ 真实搜索引擎需单独授权与网络前提，默认只测本地搜索模板夹具。 |
| D08 | 部分 | **历史、书签与下载**。已实现：历史/书签搜索、删除、Profile 隔离、重启持久化；下载完成、进度、取消、同名文件不覆盖、状态文案、重启历史、文件名/URL 搜索；下载完成后"打开文件"与"在文件夹中显示"（系统调用由测试替身验证）、打开失败以 `role=alert` 呈现；测试模式使用临时下载目录。差距：真实系统保存对话框、真实打开文件/文件管理器行为未人工验证、重试/续传、其他下载协议、组织/文件夹、导入导出、库文件损坏恢复、真实下载站。 | ① `node tests/library-e2e.cjs`、`node tests/library-search-e2e.cjs`、`node tests/download-e2e.cjs`、`node tests/download-file-ops-e2e.cjs`。② 手工验证真实保存对话框：选择、取消、同名、权限错误，并记录为手工证据；真实打开文件/在文件夹中显示需要人工记录。③ 补测 `library.json` 损坏拒绝/备份、下载中断后重启状态、多 Profile 并发下载取消。④ 合同：不得把临时下载目录结果当作真实保存对话框已验证；不得把 shell 调用替身当作真实系统应用已打开。 |
| D09 | 部分 | **Profile 管理**。已实现：创建、切换、重命名（取消、空白拒绝、裁剪）、跨重启、Room/书签/下载归属、旧数据默认归 default Profile。差距：删除、默认 Profile 选择、重名策略（当前允许）、真实 Chromium 数据迁移、Profile 级权限/数据管理、数量与命名约束。 | ① `node tests/profiles-e2e.cjs`。② 新增删除路径前先定义引用关系与确认/取消合同（不可删 default、不可删最后一个），并验证删除后 Room/历史/下载/权限行为。③ 补测重名创建与切换、Profile 删除影响范围。④ 禁止使用真实浏览器 Profile 做测试。 |
| D10 | 部分 | **Page 与 SDK 合同**。已实现：`openRoom`/`resumeRoom`/`claimRoom`/`listRooms`；Room ID、Page label 稳定与未知来源保护；`adopt`/`release`/`finish`（keep 校验与收据）；Snapshot v2（`page`/`full_page`/`viewport`/`subtree` 范围、多层同源 iframe、`@N` 稳定引用、`frame` 标注、200 项截断与 `total`、跨源计入 `inaccessibleFrames`）；选择器（css/xpath/text/role/href、frame 限定、`:has-text`/`:text-is`/`>> nth=`）；输入与键盘（click/fill/press/`dblclick`/`focus`/`keyboard.*`/`insertText`/原生 `paste`）；等待（URL/selector/function/loadstate/popup/download/`waitForTimeout`）；`reload`/`info`/`events`/`receipt`/`cdp`；截图、`evaluate`、`fetch`、对话框、上传、select、指针、Agent 下载；统一 `CORVID_*` 错误码；CLI 多轮调用。差距：跨源 iframe 与 closed Shadow DOM 内容、`networkidle`、截图 `scale`/`raw`、`room.cdp()`、popup 历史跨重启、单凭据无 Agent 身份隔离、CLI 静态 import 与自动安装。 | ① `node tests/contract-e2e.cjs`、`node tests/snapshot-e2e.cjs` 覆盖新增合同。② 以 `npm test` 中 SDK/CLI 项为回归基线。③ 新增能力必须同时覆盖成功、错误/失效、控制权变更、重启或断开四类路径（适用时）。④ Snapshot 合同：范围必须显式、跨源内容计入 `inaccessibleFrames`、失效引用必须报错而不是静默重编号。⑤ 错误码新增必须同步映射与测试；参数形状错误与运营错误分开。 |
| D11 | 部分 | **输入与网页能力**。已实现：`fill`、`press`、`click`、`dblclick`、`focus`、`hover`、`dragAndDrop`、`mouse.*`、`wheel`、`selectOption`、`setInputFiles`、`waitForFileChooser`、`keyboard.*`（type/press/down/up/insertText/paste）；点击/输入/按键为 `isTrusted: true` 事件；清空文件选择与 select 变更使用非 `isTrusted` 合成事件；同源 iframe 与开放 Shadow DOM 输入。差距：contenteditable、IME、任意组合键、目录上传、跨源 frame、OS 级拖放、原生文件选择器 UI、富文本、真实网站反自动化兼容性。 | ① `node --test tests/uploads.e2e.mjs`、`node tests/sdk-e2e.cjs`、`node tests/contract-e2e.cjs`。② 新增输入路径必须验证事件 `isTrusted` 状态、焦点、滚动与视口边界。③ 合同：`paste` 的剪贴板恢复是 best-effort；合成事件只能标注为合成路径；跨源 frame、目录上传、IME 作为待实现项。 |
| D12 | 部分 | **状态、接管与多 Agent 体验**。已实现：桌面状态"Agent 控制中/用户控制中/正在接管…/页面执行状态未知/网页对话框/站点权限/站点数据"；后台 Room 操作不改变前台 Room；错误以 alert 呈现；系统确认框当前为测试替身。差距：后台操作时前台焦点保持、多 Agent 身份、任务进度与长任务指示、崩溃/断开/清理失败后的状态一致性、无障碍与键盘可达性、状态同步延迟。 | ① 同时运行用户 Room 与至少两个 Agent Room，UI 可区分状态并可接管。② 断言前台 URL 与 `activeRoomId` 不受后台操作影响，并补测前台焦点保持。③ 退出/错误后不得显示虚假"已完成"；每个新状态必须对应可测试的状态源。④ 在单凭据问题解决前，UI 与文档都不得暗示 Agent 之间相互隔离。⑤ `node tests/agent-rooms-panel-e2e.cjs` 覆盖面板开合、并行 Room 列表、Profile 过滤、窄窗溢出、键盘接管/交还、执行风险复核与 Room 激活；真实模型与跨窗口实时刷新仍未覆盖。 |
| D19 | 部分 | **内置 Agent 工作台与统一任务体验**。已实现第一段 Pi 任务流程（[Issue #8](https://github.com/heyallencao/corvid/issues/8)）：从当前 HTTP(S) 页面创建独立 Agent Room，预览快照并明确同意后启动 Pi SDK；Pi 输出/工具事件流入桌面任务面板；任务 Profile/Room/Tab 绑定及输出落盘，重启时运行中的任务标为“结果待检查”；停止、查看 Room 和清理记录及其 task 专属 Pi transcript 可用。E2E 使用明确标识的本地 fixture，不调用真实模型。剩余：任务中接管后的同会话继续、Pi transcript 会话恢复、等待用户与未知状态的完整生命周期、模型/凭据管理与真实 provider、跨 Room 任务统一入口和无障碍/窄屏/慢网验收。 | ① 当前任务从独立 Agent Room 的指定标签发起；页面快照与 URL/title 在发送前完整预览，启动前勾选同意；页面变化或 Room/Profile/Tab 绑定变化时拒绝。② Pi 工具限定于已确认的同一 Room/Profile/Tab；Pi 文件系统/shell 默认工具关闭；接管、待接管或执行风险时拒绝页面操作。③ fixture 验证启动、真实 Pi 事件映射、完成/错误、停止和重启恢复；fixture 不得冒充真实模型结果。④ 未恢复的运行任务只能呈现为中断/结果未知，不能标完成；其 task-to-Room 关系可检查。⑤ 真实模型凭据、provider 费用与数据发送范围单独设计并验证；当前未声明真实模型已接入。⑥ 后续继续满足 Issue #5 的同 Room 接管后续跑、SDK/CLI 状态一致性、键盘/窄窗/空态/慢任务/无网络/辅助技术验收。 |
| D20 | 部分 | **外部 Agent / MCP 浏览器接入**。`mcp/corvid.mjs` 适配官方 stdio MCP SDK 与现有 SDK，暴露 `list_profiles`、按显式 Profile 查 `list_rooms`、按 Room 查 `list_tabs`、Agent-owned Room 下的 `page_info` 与 `page_snapshot`；不开放新 TCP 端口，不暴露写操作。实现与验收见 [Issue #4](https://github.com/heyallencao/corvid/issues/4)。 | ① `node tests/mcp-e2e.cjs`：协议初始化、工具发现与调用、明确 Profile/Room 范围、只读标记、Room 用户控制时拒绝页面读取、稳定错误、Corvid 未运行时保持协议有效。② `npm test` 全量回归。③ 未覆盖真实 MCP host 的 UI 配置、macOS 打包路径、Windows 与真实网站；无模型执行能力。④ 后续写工具必须单独建 Issue，逐项增加授权与副作用验收；禁止通过 MCP 暴露任意 `evaluate`/CDP。

## P2：平台、迁移与能力补齐

| ID | 状态 | 工作块与当前差距 | 可执行验收合同 |
| --- | --- | --- | --- |
| D13 | 待实现 | **首次启动与浏览器数据导入**。未实现书签/历史/Cookie/登录/扩展导入；源格式、平台加密与授权边界未调研。 | ① 先只读调研源格式、平台加密与授权，输出调研记录。② 用合成源 Profile 验证预览、选择、取消、备份、部分失败、重复导入幂等。③ 只导入书签不得声称"完整迁移"。④ 任何真实数据迁移需用户明确授权并可回滚。 |
| D14 | 待实现 | **扩展**。未实现扩展安装/启用/禁用/更新与权限模型。 | ① 用自建测试扩展验证安装、启停、更新、卸载、Profile 归属。② 扩展权限提示接入 D03 的权限合同。③ 明确不支持 API 与平台；不承诺第三方商店兼容。 |
| D15 | 待实现 | **安装、默认浏览器与更新**。无打包、签名、安装器、协议注册、默认浏览器与自动更新。 | ① 全新环境验证 macOS arm64/x64 与 Windows x64 安装、首启、协议/默认浏览器选择、升级、回滚、卸载与数据保留。② 配置修改可见、可撤销；未经用户明确操作不修改系统默认应用或其他 Agent 配置。③ 无法取得的平台标"未验证"。 |
| D16 | 部分 | **其他日常功能**。已部分接入：设置（搜索模板、缩放）、快捷键、站点权限/站点数据面板、页内查找（Cmd/Ctrl+F 查找条、结果计数、前后跳转、Esc 关闭，见 D07 证据）、下载文件操作（打开/在文件夹中显示，见 D08 证据）、窗口状态持久化（见 D06 证据）、标签固定与标签右键菜单（应用内菜单，见 D06/D07 证据）；系统剪贴板（整页复制等）、全屏、打印、媒体、开发者工具、下载管理增强（重试/续传）、原生菜单未实现或未调查；多窗口已由 D06 实现并有 Electron E2E 覆盖，平台边界仍待补测。 | ① 逐项先定义用户行为、错误路径和退出恢复，再实现与测试。② "已实现"与"已验证"分列。③ 不把通用浏览器预期当已实现；未调查项保持"待实现/未知"。 |
| D17 | 部分 | **平台与分发**。目前只在开发机上以 macOS 直接运行 Electron；macOS 打包/签名/公证、Windows 构建与运行、其他平台、自动更新、崩溃上报均未验证。 | ① 在全新环境验证 macOS arm64/x64 与 Windows x64 的构建、安装、运行、升级。② 记录 OS、架构、Electron 版本、签名与结果。③ 无法取得的平台标"未验证"，禁止用模拟结果代替。 |
| D18 | 部分 | **持续发现与能力台账**。已具备：本板、验证记录与测试索引构成初始能力矩阵。差距：没有独立的发现流程、来源记录与定期复核机制，未调查能力仍可能被误读为已穷尽。 | ① 维护能力台账（能力、来源、观察/推断/未知、证据、验收状态）。② 只使用公开资料、自建夹具与自有产品行为，不访问私人浏览数据。③ 发现新能力时新增任务、更新本板与测试索引；无法复现的观察标"未知"。 |

## 完成条件

- P0 全部达到"已验证"，并在 macOS 与 Windows 上、用真实网站与真实系统对话框复测通过；平台无法取得时保持"部分"并记录原因。
- P1 全部"已验证"或经明确产品决策不做；决策记录写入本板。
- P2 的导入、扩展、安装分发各有独立合同与平台证据；未验证平台不写"已验证"。
- 系统对话框替身全部有对应人工验证记录；原生对话框不得由自动化结果代替。
- Agent 身份隔离完成前，不得宣称多 Agent 之间安全隔离；单凭据风险持续记录在文档中。
- Corvid 的产品完成条件包括内置 Agent 工作台与完整日常浏览器体验；SDK/CLI 的接口能力不能替代用户可见的任务发起、进度、接管、恢复和结果界面。D19 未达到其验收合同前，不得宣称内置 Agent 已交付。
- 任一"部分"不得因单项通过整体关闭；验证证据按 [验证记录](../reviews/verification-log.md) 的格式追加。
- 文档、测试索引与任务板同步：新增或修改测试必须同时登记到 [端到端测试索引](../qa/e2e-suites.md) 与本板证据列。

## 端到端运行方式

1. **环境准备**：Node.js ≥ 22.19；`npm ci` 安装依赖；`npm start` 启动桌面；`npm test` 执行全量回归（35 条命令、37 项测试入口，按固定顺序串行执行）。
2. **隔离原则**：每项测试自建临时数据目录与本地 HTTP 夹具（`127.0.0.1` 随机端口，必要时用 `localhost` 制造跨来源），结束时清理进程与临时目录；不读写真实用户数据。
3. **环境变量**：

   | 变量 | 用途 |
   | --- | --- |
   | `CORVID_DATA_DIR` | 覆盖数据目录，测试必须使用 |
   | `CORVID_TEST_MODE` | 测试模式，启用 `/shutdown`、临时下载目录等测试路径 |
   | `CORVID_PORT` | 控制服务端口，`0` 表示随机 |
   | `CORVID_TEST_DOWNLOAD_DIR` | 下载测试目标目录，绕开系统保存对话框 |

   默认数据目录为 `~/.corvid`。
4. **持久化文件**：`rooms.json`（`schemaVersion=2`，v1 单窗口会话迁移，旧 `spaces.json` 自动迁移一次）、`library.json`（`schemaVersion=1`，历史/书签/下载）、`profiles.json`、`control.json`（Bearer token，0600）。
5. **运行前提**：普通终端直接执行 `npm test`；在沙箱/CI 环境需要清理 `ELECTRON_RUN_AS_NODE` 并允许 Chromium 建立沙箱，否则真实 Electron 可能无法启动。当前只在 macOS 验证。
6. **测试替身与人工验证**：自动化中的系统对话框是测试替身；真实保存对话框、原生权限提示、原生 beforeunload 必须单独做人工验证并写入验证记录。
7. **CLI**：先启动桌面，并使用相同的 `CORVID_DATA_DIR`，再运行 `node cli/corvid.mjs run < script.mjs`；脚本在 Node 中执行（`AsyncFunction`，无静态 `import`/`export`），拥有本地用户权限。`node cli/corvid.mjs help` 查看入口说明。
8. **索引与记录**：逐项测试说明见 [端到端测试索引](../qa/e2e-suites.md)；每次全量或新增测试后，按时间倒序追加到 [验证记录](../reviews/verification-log.md)。
