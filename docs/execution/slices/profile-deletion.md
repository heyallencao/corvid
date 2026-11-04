# Issue #174：删除非默认浏览身份

本任务板对应中文 GitHub Issue [#174](https://github.com/heyallencao/corvid/issues/174)，并从总执行板 [D09 Profile 管理](feature-board.md#d09-部分)进入。策略依据与竞品观察见[浏览器参照分析：浏览身份删除范围](../research/browser-reference-analysis.md#2026-11-03-浏览身份删除范围参考)。

## 目标

为非默认浏览身份提供清晰、可恢复失败、安全阻断的删除流程。产品始终保留 `default`；用户先处理仍由窗口、Room 或可恢复 Agent 任务引用的身份，避免浏览器和 Agent 工作被悄悄关闭。删除范围以 Corvid 自己的资料所有权为准，确认时逐类列明。

## 设计合同

- `default` 不可删除；初始版本没有“默认身份切换”，所以默认身份也是唯一不能删除的身份。
- 检查所有 BrowserWindow、Room、Agent 任务和进行中的下载引用。存在窗口/Room、正在运行/启动/等待用户的 Agent，或可恢复的 Agent 对话/运行时检查点时，返回明确阻断项，不产生数据变化。
- 删除前说明清理范围：Cookie 与站点存储/缓存、身份设置、收藏夹、历史/下载记录、Corvid 管理扩展、已完成且不可继续的 Agent 对话/检查点，以及身份对应的 Rooms/tabs 持久化状态。
- 已下载到文件系统的文件默认保留；删除下载记录不删除该文件。不可暗示清理了浏览器外部密码管理器、系统 Keychain 或第三方扩展自己的外部数据。
- 取消不产生副作用。清理中失败不得返回成功或丢弃最后一份 Profile 记录；用户看到明确失败与重试路径。新建同名身份必须使用新 ID/partition，不能复用待删身份的数据。
- 新增/修改的所有面向用户文案同时覆盖 `zh-CN` 与 `en`，包括空态、确认、取消、阻断原因、失败和可访问名称；常规/窄窗均能阅读。

## 实施顺序

1. 补齐 Profile 数据拥有者和检查接口：窗口/Room、Agent 任务、下载、扩展、library 与持久化会话数据。
2. 定义删除前预检与无副作用阻断；确认时重新预检，防止对话框打开期间产生新 Room、任务或下载。数据清理协调器先持久化 `deletionPending` 再清理，可重入重试，最后一步才移除 Profile 主记录。
3. 按可重复顺序清理 Agent runtime data、Chromium Session 站点数据/缓存/认证缓存/代码缓存、身份扩展与其文件、library 记录；下载磁盘文件保留。任一步失败保留 `deletionPending`，不可被选择或启动新 Agent，用户可重试。
4. 添加浏览身份设置入口、影响范围确认、阻断详情与失败重试 UI，保持现有浅/深主题与双语资源边界。
5. 使用隔离 `CORVID_DATA_DIR` 与本地 fixture 覆盖正常删除、默认拒绝、窗口/Room/任务/下载阻断、取消无副作用、存储清理失败重试、重启不复活、新同名 ID 不复用旧隔离数据；真实 Electron 检查常规/窄窗布局与键盘焦点。
6. 更新 `docs/qa/e2e-suites.md`、验证日志和本任务板；PR 截图只使用合成 Profile 与本地 fixture。

## 当前状态

- [x] 浏览器市场参考：用 REA 隔离配置读取 Chrome 与 Safari 官方身份帮助页；记录具体行为、证据 ID 和未观察边界。
- [x] Issue 与执行范围已建立。
- [x] Profile 删除事务与重试边界已复核并实现可注入协调器：默认身份与引用阻断、Agent 写入锁、持久删除标记、Session 数据和缓存清理、扩展/资料库移除、最终删除 Profile 记录；模块合同覆盖故障后重试。
- [x] 在 Electron 主流程中接入协调器，按窗口、Room、进行中下载和 Agent 活动对话做二次预检；失败的 `deletionPending` 身份可从浏览身份菜单重新打开删除流程并重试。
- [x] 双语 UI、数据清理、预检和 E2E 实现；首次 Session 清理失败的真实 Electron UI 路径会保留身份并成功重试。
- [x] 真实 Electron 常规/700×420 窗口检查并保存合成数据截图；仍需独立 review、最新主线集成和中文 PR。

## 证据与取舍

- Chrome 官方说明的删除路径为 Profile 菜单 → 管理身份 → 选择身份 → More/Delete → 再确认；删除警告包含书签、历史、密码和设置。REA Evidence `ev_030a3fa846bf1e55eb2d59ebda668384a07c40fac4ae003df523927da1747a99` 是官方帮助页 DOM/AX 捕获，不是原生界面交互证明。
- Safari 官方说明固定保留 Personal (Default)；删除会关掉该身份的网站、清除 tabs/history/site data，但保留非空收藏夹目录；iCloud Keychain 密码跨身份可用。REA Evidence `ev_97475b45ef50f6216275a5e422ca3577d94f6bc9c09ffe0158cb93f185022e73` 同样是帮助页 DOM/AX 捕获。
- Kobra 的计划卡 REA Evidence `ev_c855872bf1206ac32d64dbfea78ed383499bbde08ab53f811bcbf8d415256b07` 显示待办、当前状态和待用户动作在卡片上分区；`ev_82b410170686a21723ebde805c5c5b4aec0617a625e153208b85b5d248e02f25` 单次“View Plan”动作前后 AX 摘要未变，不能据此声称其交互稳定。这里只借鉴“阻断原因与用户可做的下一步分开呈现”，不复制组件/源码。
- 尚无本轮 EGO/Kaze Profile 删除运行态证据；本范围不据此作功能对标结论。REA 页面分析未观察原生浏览器 Profile 窗口、删除失败恢复或窄窗行为。
- Corvid 运行态截图/断言来自真实 Electron 45.2.1、Playwright 窗口和临时本地 HTTP fixture；它们是本产品运行证据，不是 REA 参考站点证据。窗口/Room/下载/Agent 四类阻断由模块合同逐类核验，真实 Electron UI 本轮实际覆盖窗口与 Room 阻断及 Session 失败后的可见重试。
