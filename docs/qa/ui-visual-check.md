# 桌面 UI 视觉检查记录

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
