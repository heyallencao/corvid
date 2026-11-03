# 桌面 UI 视觉检查记录

## 2026-11-03 Corvid Agent 欢迎态短高窗口可读性（Issue #16）

- 环境与截图：macOS、Electron 45.2.1、隔离 `CORVID_DATA_DIR`、本地 HTTP fixture；窗口 704×420，实际 shell 视口 704×388 CSS px。截图[短高窗口欢迎态](screenshots/issue-16-agent-short-height-704x420.png)，SHA-256 `dfbd257e684cf76331e066e153aa4f7dc0c3365079d7ad93f0915cd8b5d50a4c`；页面主体是明确标注的 Corvid 本地 fixture，不含个人网页、账号或凭据。
- 直接观察：修复前截图中欢迎标题和说明被输入卡片压住；修复后 zh-CN/en 标题和经精简的完整说明都落在消息区内，且与输入卡片没有几何重叠。短窗将装饰图标收起并让文案使用整行宽度；双语说明在保留“提问/总结/协助浏览、分享前检查页面”的意思下精简，正文字号设为 10px。输入卡片独立滚动，模型选择、提示词和页面复核按钮通过自动化逐项滚动至可视区。截图展示 zh-CN 初始状态；英文说明由同一 Electron 运行中的可见边界断言验证。
- 视觉判断：在此尺寸下，欢迎文案优先于装饰，英文说明自然换行仍完整，连接当前页面等操作保留可达性。视口高度不超过 440px 时，输入卡片上限降至内容区 34%，其他不超过 480px 的短窗上限为 52%；因此 420px 高度下卡片仅露出页面来源和连接操作的一部分，模型/提示词/复核需在卡片内滚动，不能宣称所有控件同时首屏可见。没有继续缩小字号。
- 自动化：`env -u ELECTRON_RUN_AS_NODE node tests/pi-workbench-short-height-e2e.cjs` 通过；检查 zh-CN/en 的标题、完整段落、消息区边界和与输入卡片不重叠；另逐项滚动验证模型、提示词和页面复核控件可见。无真实模型、Provider 或 OAuth。先前在本分支基线上运行既有 `pi-workbench-e2e.cjs` 曾于 `#pi-task-form .pi-primary-action` 等待超时；该用例尚未由本补丁重跑通过，不能把本次定向用例当作整套工作台回归。
- REA 参考及证据边界（2026-11-03，REA 未返回精确采集时刻）：Kaze Agent 面板的模型选择器截图 Evidence `ev_ae7cc8d9bebb43705bcdbb47eb75fc571bdd0ddc99e2c1d199e2d0cb80f6dcb7`，直接观察仅限常规窗口下模型选择器位于输入区附近；未展开选择器、未测窄高窗口。Kobra Composer 页面 Evidence `ev_668bf2245d384ec9265daab73179d0986212ea9968e2b05000bd13234459f8f9`，直接可访问性树含有命名的 Subject/Message 输入框与操作按钮，加载后未操作表单。静态证据：本轮未检查两者源码或脚本。推断：短窗中紧邻输入的模型入口与明确命名控件值得参考；长说明需要更多空间是由本地双语实际渲染直接测得，并非竞品行为推断。未知：Kaze/Kobra 在短高窗口的响应式折叠、滚动、键盘顺序及读屏输出均未观察；不复制组件、样式或素材。EGO 本轮未重采集，Rare UI、EasyUI、Pin UI 与 Aceternity UI 也未扫描。

## 2026-11-03 Corvid 原生窗口菜单焦点勾选（Issue #167）

- 环境与隔离：macOS、Electron 45.2.1、`CORVID_DATA_DIR=/tmp/corvid-menu-native-ui-20261103b`；仅有新建的默认窗口与空白起始页，没有导入浏览器资料或打开私人网页。系统菜单由 macOS `System Events` 操作，窗口菜单截图只采集菜单窗口。
- 直接观察：通过原生“窗口”菜单选择“窗口 1”后，Corvid `/windows` 控制接口报告焦点窗口为 `legacy-window`；macOS 菜单的 `AXMenuItemMarkChar` 仍在“窗口 2”显示勾选。“窗口 1”未勾选。截图：[窗口菜单错误勾选（修复前）](screenshots/issue-162-window-menu-stale-check-before.png)，414×326，SHA-256 `f42a135f80c21fe3a32b08363f2cf7dcef9b02b76fd3804c665dfb90d2972dc2`。
- 静态定位：`syncApplicationMenuState` 对 radio 项逐个写入 `checked=true/false`；真实 Electron 菜单运行显示在 macOS radio 组上，随后把已选项重新写为 `false` 会把原选择恢复。已在本地修为只勾选当前焦点项，并让单元测试模拟 radio 组互斥状态。
- REA 覆盖：尝试使用 REA `observe_native_ui` 读取同一隔离窗口，但 `native-macos` provider 报 `capability_unavailable`：进程未提供可验证的启动时间，无法完成 PID 防复用校验。因此本条原生菜单行为来自 `System Events`、Corvid 隔离控制接口和单独菜单截图，不标记为 REA 观察，也不把 provider 失败当成产品行为。
- 修复后直接复核（2026-11-03 21:51 Asia/Shanghai）：隔离 Electron 45.2.1、临时 `CORVID_DATA_DIR`，macOS `System Events` 分别选择“窗口 1”和“窗口 2”；读取到窗口 1 时 `AXMenuItemMarkChar=✓` 且窗口 2 无勾选，反向切换后窗口 2 为 `✓` 且窗口 1 无勾选。Corvid `/windows` 焦点 ID 相应从 `legacy-window` 切到第二窗口 UUID，再切回 `legacy-window`。这是原生 AX 菜单状态与控制 API 的直接观察，不是 REA Evidence，也不验证像素/VoiceOver。人工诊断脚本结束时测试 helper 超时并终止了本轮自启 Electron；状态读取已在退出前完成，退出后确认无残留 Electron 进程。
- 自动化复核：`node tests/application-menu.test.mjs` 3/3；`env -u ELECTRON_RUN_AS_NODE node tests/application-menu-e2e.cjs` 通过（隔离真实 Electron）；`env -u ELECTRON_RUN_AS_NODE node tests/browser-shortcuts-e2e.cjs` 通过。菜单 E2E 的系统菜单动作以 Electron callback 驱动，不将其作为物理鼠标输入证据。全套 `npm test`、VoiceOver、Windows/Linux、打包版与原生像素对照尚未覆盖。
- 参考关系：网页菜单参考 EasyUI OriginDropdown 的可读层级与状态语义，具体页面、Evidence ID 与移植边界见[Issue #162 执行记录](../execution/issue-162-application-menu.md)。原生菜单依平台行为实现，不复制网页皮肤。

## 2026-11-03 全屏菜单桌面状态（Issue #141）

- 环境与状态：macOS、Electron 45.2.1、隔离 `CORVID_DATA_DIR`、本地合成权限 fixture；菜单打开，键盘焦点位于原有“清理此站点数据”首项。未访问真实网站或用户资料，没有 OAuth 或模型请求。
- 截图与检查：[更多浏览工具菜单](screenshots/issue-141-site-tools-fullscreen.png)，2560×1636，SHA-256 `9c34e9e6b5e2fc7b09dd71faf47b414124a5858b2ea6ebb9571e07cada04ca7f`。人工目视确认菜单靠近触发按钮、边界与焦点状态清楚，新“全屏模式”及 `⌃⌘F` 快捷键可辨。
- 结果与限制：全屏项排在原有首项之后，不改变打开菜单时的初始焦点；菜单截图来自 Playwright shell 渲染器，不含 macOS 原生标题栏、系统合成窗口边界或独立 `WebContentsView` 页面，因此不能证明原生窗口全屏的完整视觉效果。真实全屏状态、双窗口、网页全屏及重启行为由隔离 Electron E2E 验证；其他平台和打包版未覆盖。
- UI 参照：本轮沿用 Corvid 自有“更多浏览工具”菜单与键盘焦点合同；未复制 Rare UI、Kobra、EasyUI、Pin UI 或 Aceternity UI 的组件、样式或素材。

## 2026-11-03 浅/深主题状态文字与焦点对比度（Issue #16）

- 环境与状态：macOS、Electron 45.2.1、隔离 `CORVID_DATA_DIR`；Corvid 壳显示 `about:blank`，无网页主体、个人数据、账号信息或模型调用。截图对应浅色主题、2560×1636 像素。
- 检查：真实 Electron computed CSS token。浅色与深色 `--text-muted` 在全部 `--surface*` 背景上达到至少 4.5:1；焦点指示色在这些背景上达到至少 3:1；warning/success 状态文字在一般及对应语义背景上达到至少 4.5:1。实测最弱比值分别为：浅色 muted 4.72:1、深色 muted 4.76:1、焦点指示 4.11:1、浅色状态文字 5.14:1、深色状态文字 6.86:1。
- 结果：在 [截图](screenshots/issue-16-contrast-after.png) 中，浅色浏览器壳的侧栏标签、次要操作和地址栏提示可辨；截图 SHA-256 `b9ab049878325922e8b6178ebc032e5fafd9f3c398738e5fdcd9a46e3ff125`。各主题状态阈值断言由 [Agent Room 面板 E2E](../../tests/agent-rooms-panel-e2e.cjs) 覆盖。
- 参考：色值根据 Corvid 实际 token 对比度与 [WCAG 2.2 对比度（最低）](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)及[非文本对比度](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast)阈值修正；本切片未移植 UI 组件或样式，也未调用 REA 扫描 Rare UI、Kobra、EasyUI、Pin UI 或 Aceternity UI。
- 限制：截图只展示一个浅色 `about:blank` 壳状态，不能证明全部文字、图标、悬停/禁用态、组件背景或网站内容均合规。自动化计算选定 token 组合，不代表完整 WCAG 审核；未做 VoiceOver/屏幕阅读器、跨平台和打包版检查。完整自动化覆盖与边界见[验证日志](../reviews/verification-log.md#2026-11-03-主题色对比度修复-issue-16)。

## 2026-11-03 Profile 扩展权限双语分隔符

- 检查：`tests/chrome-import-e2e.cjs` 在真实 Electron 中使用合成 Chrome 扩展导入夹具，验证 Profile 扩展列表展示必需与可选权限；中文界面使用 `、` 分隔同组权限，英文界面使用 `, `。同时更新 Chrome 导入结果断言，兼容中文/ASCII 括号、英文冒号与中英文状态标点。
- 结果：定向 `node tests/chrome-import-e2e.cjs` 通过，覆盖 Cookie 解密/写入/Profile 隔离、失败回滚与重试、扩展导入及管理。未使用 ChatGPT OAuth 或模型请求；截图由测试自动刷新后已还原，未改变已有 Issue #129 证据图。
- 限制：本轮仅定向验证 Chrome 导入与 Profile 扩展路径；全量测试结果另记验证日志。


## 2026-11-03 Chrome 扩展工具栏弹窗（Issue #129）

- 环境：macOS、Electron 45.2.1、Chromium 156、真实 Corvid Electron 窗口；隔离 `CORVID_DATA_DIR`，使用合成 Chrome Profile 与本地 HTTP 页面。没有读取真实浏览器资料，没有 ChatGPT OAuth 或模型请求。
- 检查：`tests/chrome-import-e2e.cjs` 实际导入 MV3 合成扩展；打开 Corvid 工具栏中的扩展入口，检查扩展页面、320×220 内容尺寸、默认 Profile Session 路径、sandbox 与 `nodeIntegration=false`；验证 Escape、父窗口获得原生焦点后关闭弹窗、切换浏览身份关闭弹窗，及 Escape 后焦点回到原入口。此前所谓“点击更多浏览工具关闭”由 Playwright CDP 点击，未改变原生弹窗焦点，不能作为真实外点证据。现增加 macOS opt-in 原生 CoreGraphics 指针验证：按 Corvid 地址栏中心计算弹窗外坐标，弹窗在失焦后关闭。严格诊断未在父页面捕获到 DOM 鼠标事件，因此不声称事件继续传递到地址栏。工作 Profile 弹窗的 Session 路径与默认 Profile 不同。
- 截图： [Corvid 工具栏](screenshots/issue-129-extension-toolbar.png)，2560×1636，SHA-256 `43c7278beb2ed7e8a2b63a31c346c3939313200f115dfe351824de4326c56d4e`；[合成扩展弹窗](screenshots/issue-129-extension-popup.png)，640×440，SHA-256 `be434151e38545dfedb02d99b7bac189d7ee428232c8c45389c89e6774f6c2aa`。仅含本地生成的扩展名称、ID 和页面，不含用户网页或凭据；适用于 PR/Issue 布局审阅。
- 原生输入复验：`CORVID_NATIVE_POINTER_CHECK=1 node tests/chrome-import-e2e.cjs` EXIT 0；真实 Electron 父窗口先获焦点，原生指针坐标由地址栏中心计算并确认不与扩展弹窗 bounds 相交；CoreGraphics 输入后弹窗关闭。另一次严格 DOM 事件诊断没有在父页面捕获到鼠标事件，因此只验证弹窗关闭，不证明事件传递到网页。REA `observe_native_ui` 因 LaunchServices 不暴露 Electron helper PID 而返回 `pid-not-application`，未取得该次运行的 REA 截图或 AX Evidence；不把窗口清单当作 REA 观察。此验证仅限当前 macOS 开发运行（需 Swift toolchain），不证明其他平台或打包版。既有 Kobra dropdown-menu controlled replay Evidence 仅作为先前交互参考，不是本次原生输入证据。
- 双语：扩展工具栏名称、入口可访问名、不可用与打开失败状态由 `desktop/locales.js` 同时提供 `zh-CN`/`en` 资源；其余现有浏览器与 Agent UI 还未全量本地化，完整覆盖见执行板 D23。
- UI/UE 参考与 REA 证据：Kobra `https://kobra.systems/components/dropdown-menu`，REA 隔离 Chromium 156 controlled replay，Evidence `ev_3edcac9a9d467a934c1bdadc8ef6aa20155315eb1f93278088e0a98d4ac5a54c`（2026-11-03；REA inline 结果未提供精确采集时刻）。**直接观察**：REA 到达指定组件路径，并请求 DOM、可访问树与截图；本次用例未操作组件。**静态证据**：本轮没有检查其静态脚本或源码。**推断**：没有依据该参考推导 Corvid 行为；实现采用 Corvid 自己的 Profile/Session 与窗口焦点合同。**未知/限制**：由于当前 REA server 的 `inspect_analysis_view` schema 没有 browser-scenario view，未能从 retained Evidence 再提取 Kobra 控件细节；因此没有声称验证 Kobra 的开合、焦点、Escape、外点或窄窗行为，也没有复制其代码/样式/素材。Rare UI、EasyUI、Pin UI、Aceternity UI 本轮未扫描。
- 限制：MV2 实际弹窗兼容、扩展页面失败路径、屏幕阅读器播报、暗色/窄窗及 Windows/Linux 尚未覆盖；截图是合成夹具视觉证据，不证明第三方商店扩展兼容。


## 2026-11-03 下载失败记录的手动重试（Issue #126）

- 检查：真实 Electron + Playwright `_electron` 全窗口截图显示下载面板中成功记录、失败记录与“重试”操作的行内对齐；失败原因“目标文件已存在，未覆盖”可读，按钮位于对应行右侧。截图 SHA-256 `cd68e7c1dbbdf3fa66ab1eda5ee580da1e593cd9d8997be9325dc42238b93c6e`，2560×1636，仅留在本机 `/tmp/corvid-download-retry.png`。`tests/download-e2e.cjs` 还验证新尝试为独立记录、进行中按钮显示“重试中…”且禁用、取消子尝试不改变原记录。
- UI/UE 参考：复用本日 REA 直接观察的 Kobra Alert `/components/alert`，Evidence `ev_7dbddd29058eef11227135f0879409777f91101dca4a0c7d543d9886057d2f61`（2026-11-03 09:20 Asia/Shanghai）。直接观察限于 AX 树中的命名 alert 区域和四类状态预览；本次只沿用“状态文字说明清楚”的细节，不推断重试控件行为，也未移植代码、样式或素材。Rare UI（`https://rareui.com/`）同一轮仅观察到 Vercel Security Checkpoint（Evidence `ev_f2ea0fa5cdeca7d8b14710c80abd66a5e367a3cabc0eff9faa49a22dc8df806e`；2026-11-03 09:20 Asia/Shanghai），无可用交互参考；未扫描其他参考站点。
- 限制：未检查真实保存对话框的重试路径、窄窗焦点顺序、系统屏幕阅读器播报或 Windows/Linux 表现；Kobra/ Rare UI 证据不构成 Corvid 验收标准。

## 2026-11-03 Chrome 导入向导空白问题复核（Issue #124）

- 环境：macOS、隔离 worktree（主线提交 `d475c07`）、Electron 45.2.1；使用临时 `CORVID_DATA_DIR`，未读取真实 Chrome 资料。
- 操作：在实际 Corvid 窗口依次打开“设置 → 从 Google Chrome 导入”；对照 macOS 屏幕截图、Playwright `_electron` 全窗口截图、DOM 可见状态及布局尺寸。
- 结果：未复现“正文空白”。屏幕和 Playwright 截图均完整显示导入标题、说明、浏览身份选择、资料目录按钮、资料类别、限制说明和导入按钮；DOM 计算样式为可见，布局矩形非零。截图暂存 `/tmp/corvid-issue124-playwright.png`，不纳入仓库。最初报告来自不同桌面观察结果，现有证据不足以归因于产品样式缺陷。
- 处理：在 Issue #124 以中文补充复核范围与限制后关闭；没有修改 CSS 或创建产品修复 PR。若能提供特定系统显示设置、窗口尺寸或操作步骤下的复现，可重新打开。
- 限制：没有选择资料目录或导入项目；只检查当前 macOS/Electron 环境与默认窗口尺寸；未覆盖暗色主题、窄窗、其他系统和屏幕阅读器。REA 被动 DOM 证据不等同于像素呈现，本结论以同一隔离运行状态下的 CUA 屏幕截图与 Playwright Electron 截图为依据。

## 2026-11-03 浏览器标签与空间控件的辅助技术语义（Issue #16）

- Corvid 运行态：隔离 Electron 45.2.1 / Chrome 156.0.8078.75，`desktop/index.html`，REA 目标 Evidence `ev_1f81589c3247e56ea4de1db93f239a52086654699750f538b047bcb5382897ef`；被动 DOM Evidence `ev_8c9f4ce02b8bd6f50d425c60b49e3ce5a68d873048ae156cee4b4db2236b4893`（2026-11-03 01:22:13 UTC）。REA 仅观察本地 `file://` shell 的 DOM 树，脚本/资源受到策略过滤，不执行点击，也不提供可访问性树或 VoiceOver 语音。
- 参考：Kobra `/components/composer`，REA controlled replay Evidence `ev_668bf2245d384ec9265daab73179d0986212ea9968e2b05000bd13234459f8f9`（2026-11-03；REA 未返回精确观察时刻）。直接可访问性树显示两个有名称的文本框（Subject、Message）及命名操作按钮；页面加载后未操作表单。仅借鉴其控件名称清楚、语义与用途相符；该组件是邮件撰写示例，不作为 Corvid 交互需求。
- 发现与修正：Corvid 原把包含普通“新建标签”按钮的容器标成 `tablist`，标签项还有独立的切换与关闭按钮；空间栏则把空间按钮放进 `list`。现改为具名 `group`，活动标签与空间用 `aria-current="page"` 标示；扩展、模型端点与外部客户端的动态集合也统一使用具名分组，避免空态段落或非 listitem 子项落入 `list`。现有逐项 Tab、切换、关闭与快捷菜单行为保留。
- 验证：`tests/tab-ux-e2e.cjs` 通过 Chromium `Accessibility.getFullAXTree` 断言“标签页”“空间”均为具名 `group`，不存在 `tablist`/`tab` 角色，并检查活动标签/空间的 `aria-current`；另外 `navigation-error-e2e.cjs`、`agent-rooms-panel-e2e.cjs`、`pi-workbench-e2e.cjs` 定向真实 Electron 回归通过。
- 限制：REA 被动检查不证明辅助技术播报；Kobra 只观察页面加载后的静态交互树。尚未在 macOS VoiceOver、Windows Narrator 或 Linux Orca 下人工走查，也未覆盖真实屏幕阅读器里的浏览器网页画布焦点。

## 2026-11-03 系统深色主题适配

- 环境：本机 macOS、Electron 45.2.1、隔离临时 `CORVID_DATA_DIR`；真实 Electron E2E 通过 Playwright 将 `prefers-color-scheme` 分别设为 light/dark 检查。页面保持 `about:blank`，不连接 Provider，不调用模型或 OAuth。
- 检查范围：浏览器主背景、持久侧栏、标签行、Agent 工作区空态、主操作按钮、空间菜单、原生 HTML 对话框、Corvid Agent 输入区与欢迎图标；浅色偏好恢复后再次读取相同表面。截图 SHA-256 `44ef80300da82fbfa8c55f82dd0ddc3844d0a97d997556c8448026a6356c0aea`，2560×1636 Retina，文件 `/tmp/corvid-dark-theme.png`，仅保留在本机。
- 视觉结果：壳层以暗色背景、分层面板与适配后的边线呈现；正文、次级文字、占位符和状态色保持可辨；主操作按钮保留白字与深蓝底。色彩变量集中适配，页面 `WebContentsView` 内容不被强制改色。
- 自动化：`env -u ELECTRON_RUN_AS_NODE node tests/agent-rooms-panel-e2e.cjs` 通过；断言浅/深配色切换、浏览器与 Agent 表面、对话框及输入控件的实际计算颜色，恢复浅色后颜色回到原值。
- 限制：系统偏好通过 Chromium/Playwright 媒体模拟切换，未操作 macOS 系统外观设置；未覆盖 Windows/Linux、打包版、外接高对比度主题、网站自身的深色配色或真实屏幕阅读器。

## 2026-11-03 Agent 工作区任务状态播报合同

- 环境：macOS 真实 Electron、临时 Corvid 数据目录、确定性任务 fixture；未连接真实模型或 Provider。
- 检查：`tests/agent-rooms-panel-e2e.cjs` 先在旧实现上因稳定播报区不存在而失败；修复后验证 `#agent-room-announcer` 的 `role=status`、`aria-live=polite`、`aria-atomic=true`，Agent Room 列表重绘后节点身份不变，任务停止与接管状态变化写入稳定播报区。
- REA 边界：本地 `file://` shell 不在 REA 可检查的浏览器目标中，REA 页面检查拒绝该目标；本项行为由真实 Electron E2E 断言，不把 DOM 合同当成屏幕阅读器播报证据。
- 限制：未使用 VoiceOver 或其他屏幕阅读器，不证明不同辅助技术实际播报顺序、打断策略或体验；未做新的像素截图检查。

## 2026-11-03 内置 Agent 状态可访问播报（Issue #16）

- 环境：本机 macOS、Electron 45.2.1、隔离 `CORVID_DATA_DIR` 与确定性 Agent fixture；未调用真实模型、Provider 或 OAuth。
- 运行态边界：REA 对本机 CDP 的页面清单 Evidence `ev_093cc98569763990cf050b1121488623a685d612f7f9ff420a2148a047289b45` 只列出 HTTP(S) 页面，Corvid shell 的 `file://` 页面被排除；随后 REA 被动页面检查明确拒绝该目标。改用 CUA 读取原生可访问树，确认 Corvid Agent 的入口、空态标题、页面提示和任务输入框可访问；这不等于 VoiceOver 实际播报验收。
- 基线与修复：`renderPiTasks()` 每次刷新都会替换整段任务列表，原任务状态虽然临时带有 `role=status`，节点本身却随着整段列表重建。新增稳定挂载的 `#pi-task-announcer`，在所选任务状态或空间控制状态变化时以 `role=status`、`aria-live="polite"`、`aria-atomic="true"` 播报；流式回复增量不会触发播报。
- 验证：`tests/pi-workbench-e2e.cjs` 的真实 Electron 红测先因缺少稳定播报区失败；修复后 `env -u ELECTRON_RUN_AS_NODE node tests/pi-workbench-e2e.cjs` EXIT 0，断言 live region 属性、接管前后节点身份不变，以及“等待你接管/用户控制中”播报。`node --check desktop/renderer.js`、`node --check tests/pi-workbench-e2e.cjs` 与 `git diff --check` 通过。
- 限制：未在 VoiceOver 下验证实际语音/盲文输出，未完成整个浏览与 Agent 流程的键盘及辅助技术验收；REA 不支持直接检查当前 `file://` shell 页面。

## 2026-11-03 新标签起始页与后台 Agent Room 共存（Issue #98）

- 环境：本机 macOS、真实 Electron、隔离数据目录、本地 HTTP fixture；未使用真实 Profile、Cookie、网站、模型或 OAuth。
- 视觉与合成：全窗口检查确认侧栏、标签和地址栏仍由浏览器壳绘制；起始页内容位于当前空白标签 WebContentsView 中，背景页保持在活动起始页下方。起始页单页截图显示品牌、搜索、浏览身份书签、历史与 Corvid Agent 快捷入口；书签图标不发起远程 favicon 请求。内容通过闭合 Shadow DOM 绘制，不属于网页 Snapshot 内容。
- 交互：真实 Electron E2E 从起始页打开书签、历史和 Corvid Agent 面板；另一个获准 Agent Room 在前台空白起始页保持不变时完成 Snapshot、fill、click 和 SDK PNG 截图。后台页面不激活、不抢占前台。
- 验证：`env -u ELECTRON_RUN_AS_NODE node tests/tab-ux-e2e.cjs`、`env -u ELECTRON_RUN_AS_NODE node tests/mcp-e2e.cjs`、`env -u ELECTRON_RUN_AS_NODE node tests/sdk-e2e.cjs` 均通过；全量 `env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0（43 条独立脚本与 3 项串行 `node:test`，共 46 项）。起始页截图 SHA-256 `2747572393f3750117f6d03e3e2c8d85e827ecd130a962e5807da060beaba588`，保存在本机临时目录，不作为仓库二进制文件。
- 限制：未验证暗色、窄窗、辅助技术、Windows/Linux、打包分发和真实网站。起始页快捷入口仍需键盘与屏幕阅读器人工复核。

## 2026-11-03 关闭最后一个用户标签后返回起始页（Issue #108）

- 环境：本机 macOS、真实 Electron、隔离测试数据与本地 HTTP fixture；关闭前最后页面为合成夹具，没有真实网页或用户数据。
- 观察：关闭最后一个用户标签后，空间栏、浏览身份和浏览器壳保持不变；新的空白标签显示 Corvid 起始页，仍可从搜索栏继续浏览。关闭按钮、中键及 Cmd/Ctrl+W 呈现相同结果。
- 验证：`tests/tab-ux-e2e.cjs` 覆盖三种关闭方式、同空间/Profile/窗口归属、起始页可见、`beforeunload` 取消时保留原页面，以及 Agent SDK 关闭不创建用户起始页。截图 SHA-256 `3c0de8a57cfb62c015af8a7251062e559d80ebcb55f96640fcb9c9d90d6d0a97`，2096×1412，仅留在本机 `/tmp/corvid-last-tab.png`。
- 限制：未验证 Windows/Linux、打包版、多个窗口同时关闭、VoiceOver 或系统原生 beforeunload 弹窗；对话框由测试替身控制。

## 2026-11-03 新标签起始页深色主题（Issue #16）

- 环境：本机 macOS、真实 Electron、隔离测试数据与本地 HTTP fixture；通过目标 `WebContentsView` CDP 媒体偏好模拟深色，再恢复浅色。没有使用真实 Profile、Cookie、网页数据、OAuth 或模型。
- 观察：起始页过渡到深石墨色背景与低饱和靛蓝光晕；标题、说明和书签文字保持清晰；搜索框、书签卡片及快捷入口改用深色表面和描边，没有残留浅色块。
- 证据：截图 SHA-256 `07d6e3ada314a66cafefbd61a1387ddb37a2a9c5c1f27ce95966603576686212`，尺寸 2096×1412；截图只保留在本机 `/tmp/corvid-newtab-dark.png`。定向 E2E 断言浅色→深色→浅色恢复，并覆盖原有导航、书签与标签流程。
- 限制：截图只包含起始页 WebContentsView，不是窗口合成截图；CDP 媒体模拟不等同于系统外观切换。未验证窄窗、VoiceOver、Windows/Linux、打包版或真实网站。

## 2026-11-03 Corvid 新标签起始页

- 环境：本机 macOS、真实 Electron、隔离测试数据与本地 HTTP fixture；测试窗口截图尺寸 2560×1636。没有使用真实 Profile、Cookie 或网页数据。
- 观察：Corvid 侧栏及浏览器 chrome 保持可见；起始内容居中，层级依次为品牌、欢迎标题、搜索/地址输入、当前浏览身份的常用书签、历史和 Corvid Agent 快捷入口。浅紫强调色与现有浏览器壳一致；书签卡片以站点域名标识，不依赖远程图标。起始页收起重复的浏览器书签栏，输入框清晰且与顶部地址栏职责相容。
- 证据：截图 SHA-256 `abd17037dde5f348c264c3515eff4931037dc83ebaab206e1d7a5e507317555d`，仅留在本机临时目录；对应自动化见[验证日志](../reviews/verification-log.md#2026-11-03-corvid-新标签起始页)。
- 限制：截图来自本地夹具与浅色主题，未验证窄窗、暗色、键盘完整路径、VoiceOver、真实网站或其他平台；截图不包含独立页面 WebContentsView 内容。

## 2026-11-03 空间术语收敛（Issue #16）

- 环境：本机 macOS、真实 Electron 开发构建、全新临时 `CORVID_DATA_DIR`；通过 CUA 读取可访问树和截图，检查首次导入提示、浏览器主界面、Agent 工作区空态；模型保持未连接，未调用 OAuth 或模型。
- 基线发现：导航区、默认空间条目、空间菜单、Agent 空态分别显示 `Spaces`、`我的 Room`、`Space 选项`、`Agent Room`；屏幕上同一概念中英混用，用户需额外理解内部 Room 词汇。关闭/授权确认框也包含 Room。
- 修复：用户可见导航、菜单、创建表单、任务恢复说明、页面上下文提示、空间关闭/授权确认框统一称“空间”；Corvid Profile 切换、管理、导入目标、设置和权限/站点数据确认统一称“浏览身份”。导入来源继续标明 Chrome Profile。内部 Room/Profile API 与持久化合同不变。
- Agent 产品语义复核：隔离 Electron 可访问树显示入口/标题为“Corvid Agent”，工作区为空时显示“Agent 工作区”，未连接 HTTP(S) 页面时明确提示连接条件；当前用户可见状态使用 Corvid 语义，Pi 保留在内部 selector/API。既有运行时错误 fixture 断言错误卡片不泄漏运行库名称。未连接模型，也未触发 OAuth。
- 定向验证：`env -u ELECTRON_RUN_AS_NODE node tests/agent-rooms-panel-e2e.cjs` 通过；该用例断言默认空间名、导航标题、创建/选项辅助名称和 Agent 空态语义。`tests/pi-workbench-e2e.cjs` 覆盖运行时错误归一化。
- 全量验证：`env -u ELECTRON_RUN_AS_NODE npm test` 最新运行 EXIT 0，43 条独立脚本与 3 项串行 `node:test` 共 46 项通过。将 Corvid Profile 文案统一为“浏览身份”后，受影响的 8 项真实 Electron E2E 串行通过（Profile 管理、快捷键设置、站点数据、权限、Chrome 导入、库搜索、Agent 空间面板与 Agent 工作台）。一次额外全量复跑在 Electron 启动阶段偶发挂起，修正测试对前台窗口的依赖后再次全量通过；启动稳定性仍由 Issue #87 跟踪。
- 限制：截图来自隔离首次启动流程，没有真实网页或用户数据；只检查 macOS 浅色主题的视觉与 AX 树，不代表 VoiceOver、Windows 或 Linux 的语言/布局验收。

## 2026-11-02 窗口空间分配边界复查（Issue #16）

- 环境：macOS、Electron 45.2.1、真实 Electron 应用、隔离 `CORVID_DATA_DIR`，Agent Room 面板打开；不调用模型或 OAuth。
- 基线复现：真实 `WebContentsView.getBounds()` 显示在 760px 内容宽度网页仅 308px；861–972px 展开侧栏后同样为 308px，973–983px 仅 309–319px，低于 Issue #16 要求的 320px。问题来自窗口宽度预算没有扣除 Agent 与网页画布间距，且 CSS/主进程断点只覆盖到 972px。
- 修复后真实 Electron 在 704、720、721、800、860、873、874、900、972、983、984、1024、1280px 共 13 个内容宽度点逐项读取所有 WebContentsView 边界：网页画布均不少于 320px，Agent Room 卡片内容均不少于 280px。最小窗口从 694×568 调整为 704×568 CSS px；874px 起展开完整侧栏，既有多任务卡片无溢出检查继续通过。
- 回归：`env -u ELECTRON_RUN_AS_NODE node tests/agent-rooms-panel-e2e.cjs` 与全量 `env -u ELECTRON_RUN_AS_NODE npm test` 通过；断言真实 Electron 主进程 WebContentsView bounds 与渲染层 Agent 面板宽度。全量包含 43 条独立脚本和 3 项 `node:test`，共 46 项检查；本次 `restore-loading-e2e` 未出现长停顿。
- 限制：仅 macOS、单窗口、浅色主题、本地 fixture；未做 Windows/Linux/缩放比例及辅助技术复验。

## 2026-11-02 Agent Room 多任务状态最小窗口（Issue #16）

- 环境：本机 macOS、Electron 45.2.1、临时 `CORVID_DATA_DIR`、本地 HTTP 页面与确定性 Agent fixture；不调用模型或 OAuth。请求窗口 640×600 后，Electron 最小尺寸约束下实际 renderer viewport 为 694×568 CSS px、`devicePixelRatio=2`。
- REA 运行态确认：隔离 Electron 页面发现 Evidence `ev_fa3c888244c221819660a2594fb5273ec56d8710f643cfc5927003ca35352719`；被动检查 Evidence `ev_e1fec2d4cb90a5398c864d87c284644508e78201d872ab3c31782bf3b452e6ee` 确认页面载入 Corvid shell、renderer 和 stylesheet。REA 本次仅提供 DOM 结构/资源元数据，不提供属性值、计算布局或截图，不把它计为视觉证据。
- 实际布局：Playwright 截图 SHA-256 `ee378bf42192236cebab759a859078ca428143777519a8b2b627dfae5e5e4c13`。两个 Agent Room 各显示多项状态及对话入口；运行/等待接管/中断/完成/失败在窄窗内仍可读，Room 控制操作可见，卡片与任务按钮没有水平溢出，网页画布仍保留在左侧。
- 自动化：`env -u ELECTRON_RUN_AS_NODE node tests/agent-rooms-panel-e2e.cjs` 通过；新增窄窗下四项并行/终态状态计数、Room/task 行 `scrollWidth` 和任务按钮视口边界断言。截图文件仅留在本机 `/tmp/corvid-agent-room-tasks-640.png`，未提交。
- 限制：只覆盖 macOS、浅色主题和本地 fixture；没有检查暗色、VoiceOver/屏幕阅读器、Windows/Linux 或更小显示器。

## 2026-11-02 Agent Room 空态进入内置 Agent（Issue #16）

- 观察依据：REA 对隔离 `CORVID_TEST_MODE=1` Electron 运行态的页面结构检查 Evidence `ev_35a2bd3b4ae11b542121538c93e8dfef506a4ad7132e9d9809ebc65ed84163c5`，以及 CUA 对最新构建的可访问树和截图观察；REA 页面检查不点击、不执行 renderer 脚本。REA 的浏览器指纹报告 Electron 45.2.1 / Chrome 156.0.8078.75，环境平台未由 REA 识别。
- 发现与修复：旧空态只写“通过 SDK/CLI 启动的工作区会显示在这里”，没有通往内置 Agent 的动作。现在说明从当前网页创建前需要检查并同意页面内容，并提供“打开 Corvid Agent”按钮；在 `about:blank` 时工作台提示先打开 HTTP(S) 页面。
- 实际界面：隔离桌面截图中，Agent 工作区空态说明与按钮完整显示；点击按钮后，Corvid Agent 工作台显示 GPT-6 Luna、账号未连接，以及“请先打开一个 HTTP(S) 页面，再连接 Corvid Agent”，预览按钮禁用。未发起授权或模型调用。
- 自动化：`env -u ELECTRON_RUN_AS_NODE node tests/agent-rooms-panel-e2e.cjs` 通过；覆盖空态 CTA、焦点进入任务输入框/关闭后回到侧栏、无效页面提示、Profile 隔离、并行 Room、窄窗、键盘交接与风险复核。焦点断言在视觉截图之后的最终交互小修中新增。
- 限制：本轮只目视检查 macOS 隔离窗口的空态和内置工作台，不覆盖暗色、VoiceOver、真实页面/模型或其他平台；REA 对 `file://` 页面只提供结构观察，截图来自 CUA。

## 2026-11-02 Corvid Agent 对话工作区与短窗复查（Issue #56）

- 环境：本机 macOS、Electron 45.2.1、隔离 `CORVID_DATA_DIR`、本地 HTTP 页面 fixture；自动化对话只使用确定性 Agent fixture，不触发真实模型。真实 GPT-6 Luna 请求另见验证日志，页面也仅为本地 fixture。
- 布局与操作：单个当前对话显示在主消息区；对话历史通过独立入口展开并可选中；底部输入区固定，模型选择和页面来源贴近输入。新对话、预览并同意页面上下文、发送、多轮续聊、恢复后的同 transcript 续聊均通过真实 Electron E2E。
- 窄短窗：在 700×420 真实 Electron 窗口断言页面来源、模型选择、连接状态/操作、输入框与页面预览按钮均完整处于可视区域且互不重叠；对话滚动区与固定输入区分开。测试截图保存在本机临时目录，不作为仓库二进制产物。
- 产品语义：可见入口、标题、状态和错误文案使用“Corvid Agent”；Pi 仅是当前可替换运行时，开发实现名仍保留在测试文件与内部代码中。
- 限制：自动化几何断言与 shell 截图不替代逐像素视觉基线、屏幕阅读器/VoiceOver、暗色主题、Windows/Linux 或真实站点检查；本地 fixture 不验证真实 provider 的故障与流式视觉表现。

## 2026-11-02 Pi Agent 窄短窗口模型与输入栏可见性

- 关联：[Issue #50](https://github.com/heyallencao/corvid/issues/50)（属于 [Issue #16](https://github.com/heyallencao/corvid/issues/16) 的 D21 打磨）。
- 环境：本机 macOS、Node.js v24.22.1、Electron 45.2.1、隔离 Corvid/Pi 临时目录和本地 HTTP 页面 fixture；不调用真实模型。通过真实 Electron `pi-workbench-e2e` 在 1280×850 与 700×420 窗口检查；截图仅捕获 shell，独立 `WebContentsView` 页面不在图内。
- 结果：窄短窗将 Pi 标题栏与表单留白压缩；模型选择、连接状态和连接按钮合为一行，表单滚动时模型栏固定在顶部；任务输入保留在首屏并与模型栏分开，页面上下文预览按钮可见。测试断言模型选择、连接状态、连接操作和输入框均完整落在表单可视区且无重叠。
- 截图 SHA-256：宽窗 `75041b643948255a58ad9975005a70bd060827e7a5289c4de313276e8107d25a`；700×420 `8e47ddd6d485379360423b1a5dced6e3403c4de75c2c0595aa3ab5da04506e4c`。文件仅留在本机临时目录。
- 限制：验证浅色主题和本地 fixture；没有验证暗色、VoiceOver、真实页面/WebContentsView 同屏效果或其他平台。

## 2026-11-02 Pi Agent 模型选择控件与短窗口复查

- 参照：REA 对运行中的 Kaze 0.26.0 截图观察到右侧 Agent 面板输入区上方的当前模型选择器（Evidence `ev_ae7cc8d9bebb43705bcdbb47eb75fc571bdd0ddc99e2c1d199e2d0cb80f6dcb7`）；未展开菜单或进入授权流程。
- 环境：真实 Electron 45.2.1、隔离 Corvid/Pi 配置目录、本地 HTTP 页面与确定性 Agent fixture；不调用模型。宽窗约 1280×850，短窗 700×420。
- 结果：模型下拉放在 Pi 输入区内、任务页面之后、上下文预览动作之前；当前 Provider 连接状态与连接/退出动作紧凑并排。宽窗截图 SHA-256 `55d70632cd8a1751916d707e4ff85cedbc07202108adb54ff062f9f44de5f21f`；短窗截图 SHA-256 `88869f059821ec4cce151b1299fb60f0dbc44badbc151a051eb27b158be56634`。截图在本机临时目录，不纳入仓库。
- 短窗中 Agent 输入表单有独立滚动；首屏优先显示任务页面与输入框，模型选择和后续动作可在表单内滚动查看。测试覆盖模型选择与未连接提示的可操作性，不代表所有最小高度下控件都同时露出。
- 限制：截图是本地 fixture 与浅色主题；未做真实模型运行时视觉检查、暗色/VoiceOver/其他平台复核。

## 2026-11-02 主框架导航失败反馈（真实 Electron E2E）

- 环境：真实 Electron、临时 `CORVID_DATA_DIR`、本地 HTTP fixture；不访问真实网站或用户 Profile。
- 操作：在用户 Room 导航到断连页面，检查状态条中的中文错误和重试按钮；恢复 fixture 后重试；期间另开一条挂起导航并由新导航替代。
- 结果：失败 URL 保留在地址栏；加载指示在导航中出现；失败状态包含简洁原因和“重试”；恢复后错误消失；被替代请求不污染新页面状态；切换到成功标签隐藏失败提示，切回失败标签后恢复提示。页面控制仍由原 WebContentsView 承载，状态提示在浏览器 chrome 区显示。
- 限制：这是交互/可见文案 E2E，不是人工截图审查；错误码映射有限，证书错误只显示通用安全连接提示；未覆盖 Windows、代理环境与所有 Chromium 网络错误。

## 2026-11-02 宽窄窗口比例与最小尺寸复查

- 环境：本机 macOS；Electron 45.2.1；隔离 `CORVID_DATA_DIR=/tmp/corvid-ui-layout-data-20261102`；本地无用户数据夹具 `127.0.0.1:38882`。
- 宽窗观察：1280px 内容宽度下侧栏 232px、网页和工作区并排；打开 Pi 工作台后网页没有被盖住，Panel 标题、表单和关闭按钮完整。
- 窄窗观察：macOS 窗口达到新设置的最小宽度约 694px 后，侧栏折叠到 64px，网页画布至少约 320px，Pi 工作区约 300px，视图间有留白；可访问树保留所有导航标签。Agent 面板仍按右侧并排布局呈现，关闭入口可见。
- 发现并修复：最初尝试在窄窗口把面板浮在网页上，但 `WebContentsView` 位于 BrowserWindow HTML 层之上，会遮住浮层；因此改为根据窗口宽度共同收窄网页与面板，并为 BrowserWindow 设置最小尺寸。对于已保存的更窄窗口，在启动时按当前显示器工作区修正初始边界，防止只设置最小尺寸却仍恢复到不可用的旧尺寸。
- 限制：仅 macOS 一种显示器/缩放设置和本地 fixture；未验证 Windows/Linux、超小显示器、手动拖到各个中间断点、菜单/站点工具、暗色、屏幕阅读器和键盘完整流程。Pi 未启动模型。自动化测试未运行。

## 2026-11-02 Corvid 浏览器壳与 Pi 工作区人工检查

- 环境：本机 macOS；Electron 45.2.1；`CORVID_DATA_DIR=/tmp/corvid-ui-redesign-20261102`；仅使用本地非敏感 HTTP 夹具页。未触碰真实浏览器 Profile、Cookie 或页面。
- 操作：实机查看新侧栏、标签/地址栏、Pi 工作台、Agent 工作区、书签、历史、下载和设置；生成 Pi Room 并检查上下文预览（未勾选发送同意、未启动 Pi/模型）；将窗口缩至约 770px 检查折叠导航与右侧 Pi 面板。
- 结果：左侧导航在窄窗收拢为图标，AX 名称仍可读；标签、地址栏、导航按钮与 Pi 工作区可用；Agent Room 状态与查看/接管操作分行显示；书签/历史/下载空态与历史列表可见；设置弹层居中且表单完整；Pi 页面预览要求显式同意，启动按钮在检查前禁用。
- 发现并修复：HTML 设置/确认弹层原先被 Electron `WebContentsView` 覆盖；新增 shell modal 状态，在对话框显示期间隐藏网页 view，并在关闭时恢复。复开设置已在屏幕截图中确认弹层、表单、按钮完整。Agent Room 行原先压缩状态文字，调整为卡片式两行布局，窄窗下复查清晰。
- 限制：仅一个宽窗口、单 Profile、本地夹具；未检查暗色主题、键盘全流程/屏幕阅读器、Windows/Linux、真实站点、原生系统对话框、真实 Pi provider 或用户同意后的模型调用。窄窗口测试只检查约 770px，未验证最小窗口阈值；未运行自动化测试。截图仅在本机交互过程查看，未作为仓库产物保留。

## 2026-11-02 Agent Room 面板

- 环境：本机 macOS；Electron 45.2.1；临时 `CORVID_DATA_DIR`；默认 Profile 与空白页面。
- 操作：打开“Agent 工作区”，观察空态；经本地控制接口创建临时 Agent Room；检查列表项、接管、交还 Agent 与查看动作。
- 观察：面板位于浏览器工具栏下方，空态与 Room 行可读；状态和标签数量清楚；接管/交还立即更新；查看切换 Room 后关闭面板。Agent Room 列表隐藏了通用搜索框。
- 限制：仅检查默认 Profile 的宽窗口与状态转换；未检查键盘、窄窗口、跨 Profile、多窗口同步、执行风险复核或模型任务；未运行自动化测试。记录见 [验证日志](../reviews/verification-log.md#2026-11-02-agent-room-面板人工检查)。
- 后续自动化：[Agent Room 面板端到端检查](../../tests/agent-rooms-panel-e2e.cjs) 覆盖窄窗口、键盘接管/交还、跨 Profile 列表过滤与风险复核状态；这些属于自动化行为验收，不替代人工检查原生对话框和视觉适配。

## 2026-11-02 Pi 任务卡状态层级检查

- 环境：本机 macOS；Node.js v24.22.1；Electron 45.2.1；`tests/pi-workbench-e2e.cjs` 创建临时数据目录与本地 HTTP fixture；隔离窗口截图暂存于 `/tmp/corvid-pi-task-card-review.png`，不纳入仓库。
- 操作：真实 Electron 中启动确定性 Pi session fixture 并在完成态检查任务卡；截图只捕获 Corvid shell，`WebContentsView` 页面不在截图画面内。
- 观察：任务目标位于卡片标题；runtime 与页面名另起一行；“已完成”以状态 pill 显示，打开 Room/继续对话/移除记录为独立操作；任务消息与事件在卡片下方分层显示。默认 Profile 的当前窗口宽度下各项均可读，没有再挤进同一条省略状态文本。
- 限制：只检查一个完成态任务、单 Profile 与默认窗口宽度；未覆盖窄窗/超长目标/多任务列表/深色/键盘与屏幕阅读器，也未把截图作为视觉基线保存。

## 2026-11-02 Pi 工作台任务历史与固定输入区

- 参照观察：REA 当前对 Kaze 窗口的截图复核显示顶端浏览器栏、紧凑纵向导航和占主体宽度的网站画布（Evidence `ev_fdb1ec28706c6b2401549b230199346e86c42a50c2e12ce04b0a06f7073563b3`，1440×851，SHA-256 `54a5bf46c65830d1e531f3fb79a7b461e004b993051a55cf51b8b32ae46009ad`）。EGO 浏览器壳参考为同日既有 REA Evidence `ev_3a5609d1eb705ccdf3c5071061a8a6b7aafa5a604f570f210b9c81a8a5c86e5e`。REA 本次无法稳定关联 EGO 窗口，因此没有把失败视作产品信息。
- 环境：真实 Electron 45.2.1、临时 `CORVID_DATA_DIR`、仅本地 HTTP fixture 与确定性 Pi stub；不调用真实模型。工作台截图存于本机临时目录，不纳入仓库。
- 操作与结果：创建 8 项任务并续聊，确认任务历史有独立滚动区；滚动回历史顶部时输入/页面上下文确认区仍在面板底部可见。再把窗口缩到 700×420，在窄短窗口完成页面上下文预览、显式同意和任务启动。Pi 状态刷新会保持阅读位置；原本位于历史末尾时继续跟随新内容。宽窗 fixture 截图 SHA-256 `2aae5a35af2d6186a3418c20ddc73cd659e6de5a9b7946c742bc66b2aab51fec`；窄短窗截图 SHA-256 `75a9ae90e00cace0110aa345a96ea11b6eebcb0e2a5dc2cc7c418004403cadd5`，均仅留在本机临时目录。
- 限制：这次是本地 fixture 的布局/交互验证，不证明真实 provider、跨平台、深色、屏幕阅读器或所有高度下的视觉质量；EGO 截图仍是同日既有快照。

## 2026-11-02 站点工具菜单键盘状态

- 环境：真实 Electron、临时 Corvid 数据目录、本地通知权限 fixture；未读取真实浏览数据。
- REA 运行时核对：在隔离启动的 Corvid Electron 45.2.1 中发现 `desktop/index.html` 页面（目标 `D6DC7DF217942879F1912FEC3D294FA0`）；只读 DOM 观察记录了 `#more-tools` 的 `aria-haspopup`、`aria-expanded`、`aria-controls` 属性名，以及 `#site-tools` 的 `role`、`aria-label`、`hidden` 属性名（Evidence `ev_39906920bf7a751852e981a5cdd90c2488b3a4c2b6a02a34d5c32a5ab43b7374`；目标发现 Evidence `ev_8c900697a3651d337e39316971b952d8742fa52b167e682c4c51bed4ecef7795`）。REA 的 Electron DOM 观察不返回属性值或焦点状态；像素截图工具拒绝 `file://` 目标，因此没有将它算作视觉证据。
- 操作与结果：从“站点工具”按钮用 ArrowDown 打开菜单；焦点环落在第一项，菜单贴近地址栏工具区。方向键、Home/End 可移动焦点；Tab 离开会关闭菜单并推进焦点；Escape 关闭并回到触发按钮；点击地址栏等外部区域关闭菜单并同步 `aria-expanded=false`。权限菜单原有确认/撤销流程继续通过。
- 截图为菜单打开时的 shell 截图，SHA-256 `770e48103db75e492f54f97061eaa0cfacaeae7bf89f1c365ed977577ba0b05a`，留在本机临时目录。
- 限制：这是键盘行为与焦点样式检查，不是 VoiceOver/屏幕阅读器验收；截图中的页面由独立 `WebContentsView` 承载，不包含页面正文；系统权限对话框仍由测试替身处理。REA 仅被动观察当前页面，没有执行键盘动作；键盘状态由真实 Electron E2E 覆盖。

## 2026-11-02 标签上下文菜单键盘闭环

- 环境：macOS、Electron 45.2.1、真实 Electron、隔离 `CORVID_DATA_DIR` 与本地 HTTP 页面 fixture；未读取真实浏览器资料或访问真实网站。
- REA 当前应用基线与复核：`desktop/index.html` 的标签按钮和菜单 DOM（Evidence `ev_935b672fa23f8053636782a670a04e23d9a1677c6f13d0d403b1ed47503d5731`；目标发现 `ev_d1ec17de5fd8928b84e6166203b5247113f8eeabc9312c67837518a7af254725`）。更新后的 Electron DOM 显示标签按钮具备 `aria-haspopup`、`aria-expanded`、`aria-controls`，菜单容器具备 `role`、`aria-label`、`hidden`。REA 被动观察不读取属性值/焦点，也不执行键盘输入；行为由 E2E 证明。
- 操作与结果：鼠标右键、`Shift+F10` 与 ContextMenu 键均可打开菜单；焦点落在首项，方向键循环，Home/End 定位首尾；Escape 关闭后返回原标签；Tab 与 Shift+Tab 关闭菜单并把焦点移至相邻 shell 控件。打开态键盘截图 SHA-256 `0002435ac8fa46a60ccd24a8d09ea7b857ba95951b911465bd1949af41fcd70c`，本机临时留存并已检查首项焦点环和菜单位置。
- 限制：仅 macOS、本地 fixture 和应用内菜单；没有 VoiceOver/屏幕阅读器验收，截图不包含独立 `WebContentsView` 的网页正文，也不代表原生系统右键菜单。

本记录是一次人工目视检查，用于补足自动化测试无法覆盖的布局问题。它不是逐像素视觉基线，也不替代 e2e 断言。

## 环境与方法

- 时间：2026-11-01；本机 macOS；Electron 45.2.1。
- 方法：用 Playwright `_electron` 启动真实应用（隔离临时数据目录、`CORVID_TEST_MODE=1`、`CORVID_PORT=0`），在本地 HTTP 夹具页面上执行真实操作，再对 shell 渲染进程截图。
- 夹具：两个本地页面（标题"产品化演示"与"第二个标签页"，带 SVG favicon，各含两处 `needle` 文本）。
- 截图：产物保存在本机 `/tmp/corvid-chrome-*.png`，未提交进仓库（二进制证据不入库）；本记录只保留观察结论。

## 检查步骤与观察

1. 地址栏导航到第一个夹具页，再点 `+` 新建标签页并导航到第二个页面。
   - 标签栏显示两个标签，均有页面 favicon（蓝色方块），当前标签高亮，关闭按钮 `×` 在 hover/选中时出现，`+` 在最右。
   - 与 `/rooms` 状态一致：两个标签、URL 与激活状态正确；未出现空标签或标题丢失。
2. `Cmd + F` 打开页内查找并输入 `needle`。
   - 查找条显示输入框、`1/2` 计数、向上/向下按钮与关闭按钮；计数与夹具中两处匹配一致。
3. 打开"下载"面板。
   - 面板显示标题、搜索框与空状态文案，工具栏按钮全部可点击。

## 发现并修复的问题

- **查找条遮挡工具栏**：初版查找条定位在 `top:82px`，正好压住书签、历史、下载、设置、站点数据、站点权限按钮；点击"下载"时被遮挡（自动化步骤超时暴露，截图确认）。修复：定位到 `top:118px`（工具栏下方，浮在页面区之上）。修复后重新截图确认工具栏完整可见、各按钮可点击。
- **夹具编码假象**：首次夹具响应未声明 `charset=utf-8`，标签标题显示乱码；这是夹具问题而非应用缺陷，夹具补上 `charset=utf-8` 后标题正常。应用侧 `page-title-updated` 传递的标题字符串本身正确。

## 未覆盖与限制

- 截图只覆盖 shell 渲染进程（工具栏、标签栏、查找条、库面板）；页面内容由独立 `WebContentsView` 承载，不在截图内，页面渲染需要另做检查。
- 未验证：真实站点 favicon 形态、查找高亮样式、超长标签标题截断、窗口最小尺寸下的布局、浅色/深色主题、Windows 与 Linux 外观。
- 未建立逐像素视觉基线；本记录只证明上述步骤中的布局问题已修复。

## 后续

- 若建立视觉回归，建议用同样的 Playwright 启动方式 + 截图哈希，并明确阈值与允许的字体/抗锯齿差异。

## 2026-11-03 Agent 空态至工作台键盘焦点核验（Issue #16）

- 本次改动没有调整视觉样式；真实 Electron 定向 E2E 使用 Enter 从 Agent 工作区侧栏打开空态及 Corvid Agent 工作台，核对焦点进入任务输入框并在关闭后恢复到入口。全量回归结果和 REA 参考证据见[验证记录](../reviews/verification-log.md#2026-11-03-agent-空态到工作台的键盘路径-issue-16)。
- REA 直接观察 Kobra Chat Input 文档页的可访问树：消息框及附加按钮均有独立名称；这是公开组件页的 DOM/AX 观察，只作交互命名参考。没有在本轮对 Corvid 工作台截图作人工目视复核，也没有验证实际读屏播报、完整 Tab 顺序或 Kobra 控件行为；相关未覆盖项仍保持开放。
