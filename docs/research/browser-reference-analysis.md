# EGO 与 Kaze 浏览器参照分析

观察日期：2026-11-02
用途：指导 Corvid 的日常浏览器、内置 Agent 与外部 BrowserMCP 组合路线。
对应战略：[统一桌面体验设计](../architecture/ui-experience.md)；对应执行板：[D21 统一浏览器与 Agent 桌面体验](../execution/feature-board.md#d21-部分)。

## 产品结论

Corvid 以 EGO 的人用日常浏览器为主产品模式：用户拥有正常的浏览器窗口、标签和 Spaces，Agent 在隔离工作区并行协作。Kaze 参照补足内置 Pi Agent 的可见任务流程、持续任务状态、Browser/Agent 工作区，以及面向外部 Agent 的 BrowserMCP 操作入口。Corvid 需要将这些能力放进统一 Profile、Room、Page、页面上下文同意和用户控制权合同；品牌和界面由 Corvid 自己设计。

这个方向不等于 EGO 与 Kaze 的功能已被逐项验证，也不把各自的浏览器实现视为可复用源码。闭源应用的未观察行为保持未知。

## 证据及范围

| 来源 | 观察到的事实 | 证据类型与范围 | 限制 |
| --- | --- | --- | --- |
| 已安装 EGO：`/Applications/ego lite.app`，版本 `0.6.2.5` / build `6.2.5` | REA 原生窗口截图显示标准浏览器布局：顶部标签、地址/搜索栏、书签栏、Google 新标签页；无障碍树中可见创建/打开 Space 的入口。 | 2026-11-02 REA `observe_native_ui` Evidence `ev_3a5609d1eb705ccdf3c5071061a8a6b7aafa5a604f570f210b9c81a8a5c86e5e`，窗口 18761、截图 1450×833、SHA-256 `f00222e8f5d4d97b6c77538ed42ba551794231557039d2d41cad56c8543c6a9e`；对照 EGO skill 的页面/Space API 说明。 | 仅观察一个已打开窗口；AX 快照含网站区域但研究记录不保留个人页面内容。可见入口不证明后台 Agent 隔离、权限和故障恢复。 |
| EGO REA：Evidence `ev_2427a886de292400f519650617741446c0908b99f864b8d8fb04dcb679b1336b` | 已检查应用目录 2,574 个条目；探测 70 个文件、读取 5,076 字节；扫描中未识别出 Electron/runtime candidate。 | `inspect_desktop_application`；目录摘要身份 SHA-256 `422aa7e21004305c40278981ea4c2f909b4297d03b20e7df418bde07cafdcefd`。 | 该摘要只覆盖所检查的路径、元数据和读取范围；REA 明确指出运行时行为、未读字节和构建对应关系未知。此扫描不能解释完整浏览器实现。 |
| EGO 开源仓库 [`citrolabs/ego-lite`](https://github.com/citrolabs/ego-lite/tree/12407167f84a58af24044f072868051952131491)，commit `12407167f84a58af24044f072868051952131491` | 仓库说明其交付物是 `ego-browser` Agent harness/技能接口；可见接口围绕共享浏览器会话、Space、页面句柄与 Agent 操作。 | 仓库 README 与 `AGENTS.md`；源码仓库状态为 `main...origin/main`。 | 该仓库不是 EGO 完整桌面浏览器本体；接口文档或 harness 行为不能证明未公开应用内部实现。 |
| 已安装 Kaze：`/Applications/Kaze.app`，版本 `0.26.0` / build `0.26.0` | REA 原生窗口截图和 AX 树显示左侧 Browser/Skills/Scheduled/Activity 导航、Space 选择、Space 标签列表与设置；网站仍占据主画布。另一次只读截图复核到顶端浏览器栏、紧凑纵向侧栏与占据主体宽度的网站画布。 | 2026-11-02 REA `observe_native_ui` Evidence `ev_3c3ee4f92ab10275d5eaae96a797c818258f403328128bf9ee16d740bbdb9067`，窗口 46150、截图 1440×851、SHA-256 `58042b2f78e4d2c1a43c3cadccb1cf6b4bb529516735362359ab6a128ac03425`；截图复核 Evidence `ev_fdb1ec28706c6b2401549b230199346e86c42a50c2e12ce04b0a06f7073563b3`，同窗口、截图 1440×851、SHA-256 `54a5bf46c65830d1e531f3fb79a7b461e004b993051a55cf51b8b32ae46009ad`。 | 只观察一个当前窗口；最近截图仅截图、不含 AX 节点，显示网站画面但本记录只采用布局信息。AX/截图含私人网站区域，研究记录不保留页面内容。可见入口不证明所有状态下行为。 |
| Kaze Agent 面板模型选择：同一已安装版本、当前运行窗口 | REA 原生截图显示右侧常驻 Agent 面板；输入区上方可见当前模型“DeepSeek V4.1 Flash”，输入提示支持“Ask about this page — @ for tabs, / for skills”。这为 Corvid 提供“模型选择紧邻 Agent 输入”的交互参照。 | 2026-11-02 `observe_native_ui` Evidence `ev_ae7cc8d9bebb43705bcdbb47eb75fc571bdd0ddc99e2c1d199e2d0cb80f6dcb7`，窗口 46150、截图 1440×851。 | 本轮只观察截图；没有读取该下拉项、展开模型列表、进入授权/设置流程或发送 Agent 请求，不能据此推断 Kaze 支持的 provider、登录方式、模型持久化或请求时行为。 |
| Kaze REA 包分析 | 已安装 `app.asar` SHA-256 `c168a2ef9b3586a9de0965972ec82bebb9391fa68dfbf876e4b7c173ce6682d4`。精确选择 `out/main/agent.js` 与 `out/preload/shell.cjs` 后，REA 发现静态引用 `@earendil-works/pi-coding-agent`（本图谱标记 unavailable），Preload 有 `browserAction.update` 事件监听与动态 `kaze` bridge 声明。 | 入口/Preload 选择分析父 Evidence `ev_0107a3a03ec7fa62018621015fae94f3ea74df50b36a291387717e28da7f8333`；精确查询视图 Evidence `ev_7c1d6b6f18501ac3989aeeb0d6999371eab92b8895605f53b07ba80042618f82`。另有 BrowserMCP adapter SDK 小范围 Evidence `ev_d7e6ba8a3a19e4de954ce6ec1eabcaf991118eb6e4ce28c5ca76ef0b1f0f9dee`。 | REA 记录 5 个 unpacked 原生文件完整性矛盾并标为 observed-untrusted。选择分析只覆盖 2 个源码文件，14,852 个其他文件未分析；图谱/语义节点与 unknowns 有截断；JavaScript 未执行，不能证明运行时加载、可达性、权限效果或授权执行。 |
| Kaze 开源仓库 [`jackwener/Kaze`](https://github.com/jackwener/Kaze/tree/ddd85ed3fb4a492438df7cc27e04a800c82bbcfd)，commit `ddd85ed3fb4a492438df7cc27e04a800c82bbcfd` | README 声称内置 Agent 可选模型端点、任务拥有独立标签组织、用户可接管，并能从设置连接外部 Agent/MCP；还将 BrowserMCP 描述为操作已登录浏览器、带 JavaScript 工作区与可复用网站适配器的开源 MCP 服务。 | 仓库 README/README.zh-CN.md 与安装包模块清单。 | README 是产品方公开说明，不等同于独立端到端验证；本次没有操作已登录网站或连接真实 MCP host。 |

## 2026-11-02 当前安装版本窗口复核

本轮复核了两款已安装浏览器的真实窗口。版本来自各自已安装应用包的 `CFBundleShortVersionString`；可见界面来自当前窗口，不把当前页面状态解释为全部产品行为。

| 产品 | 本轮现场观察 | REA Evidence 与额外观察 | 限制 |
| --- | --- | --- | --- |
| EGO lite `0.6.2.5` | 当前窗口是 Google 新标签页；顶部保留多标签，下面是地址/搜索栏和书签栏，主画布仍是普通网页。底部无障碍树可见创建 Space、选择 Profile、打开 Space 的入口。 | 当前截图由桌面无障碍读取，窗口 18761，画面 2880×1696（Retina）；项目此前的 REA `observe_native_ui` 记录见 Evidence `ev_3a5609d1eb705ccdf3c5071061a8a6b7aafa5a604f570f210b9c81a8a5c86e5e`。本轮对同窗口调用 REA 时，系统窗口几何未匹配到 AX window，未产生新的 REA Evidence。 | 当前可见的多个标签含登录页、网站错误和新标签页；它们是此用户窗口的瞬时状态，不作为 EGO 稳定功能证据。上一条 REA 截图与当前桌面截图可支持浏览器布局；本轮不能据此核实 Agent 是否正在后台运行或 Space 隔离实现。 |
| Kaze `0.26.0` | 当前窗口的左侧栏分成 Browser、Skills、Scheduled、Activity；侧栏中有 Personal Space、该 Space 的标签列表和新建 Space 入口。主区域独立显示地址栏及网站画布，工具栏有下载、书签、扩展、更多和 Show agent 入口。 | REA `observe_native_ui` Evidence `ev_ff99b513f1812a97433d873a916b24cd302c814e8828d4950013c9e4e306422d`；窗口 46150，截图 1440×851，SHA-256 `ab893b400776d262e4dda9385cbade9df45a544672c5a883a3bdf9ac6b8e3b6b`，应用 SHA-256 `540cc257fb5f0657e22bcc5a9d55887b0e92c7db0d619f02da2053887cddf531`。无障碍树确认上述导航、标签、地址栏与 Agent 入口。 | 当前只观察到 Personal Space 中一个 X 标签。Agent 面板没有在这次截图中展开；REA 后续窗口匹配失败，桌面点击也未成功，因此本轮不对 Agent 工作区内部任务状态与操作流程作运行时判断。早先的 REA 窗口观察与 Kaze 包分析仍按原范围引用。 |

### 对 Corvid 的界面取舍

- 日常浏览的第一视觉层按 EGO 处理：熟悉的标签、地址/搜索、书签和网页画布必须一直像一个完整浏览器，首次打开也应落在可浏览的页面。
- Space 与 Agent 协作信息吸收 Kaze 的持久分区和常驻入口；Corvid 应把 Room/Profile/标签关系讲清楚，并让 Pi 任务有稳定、可恢复的工作区，而不是让工具导航占掉浏览画布。
- EGO 提供主产品的浏览器形态，Kaze 提供 Agent 导航和任务组织的参照；这是一项基于当前窗口布局、现有研究与 Corvid 合同的产品判断，不代表本轮已验证 Kaze Agent 内部流程或 EGO 后台隔离实现。
- 下一轮 D21 的失败/等待 UI 需分别呈现 Agent 运行状态、页面/Room 上下文和用户控制权；“等待用户”不能被画成任务失败，“失败”应提供可理解原因与针对性恢复动作。继续保持该项为部分，直到键盘、窄屏和真实 Provider 边界补齐。

## REA 特别限制

- Kaze 完整 `app.asar` 第一次分析返回 resource constraint：父结果预算耗尽于第三方语言包文件，剩余源文件未分析。保留的完整包级 Evidence 是 partial，不能用来声称整包无某种功能。
- 后续改为精确入口路径选择，避免再次展开整个依赖树。Kaze 包存在 5 个 unpacked native 文件的完整性差异，均被 REA 记录为 observed-untrusted；其中包括带 Developer ID 签名的 Pi TUI native 文件。差异会限制该 native 文件的来源判断，不影响将其他 JS 文件内容直接等同为运行时证明。
- REA 对 EGO 安装目录未识别出可分析运行时组件；这是扫描结果，不是“没有 Agent”或“没有功能”的证据。产品层判断继续以现场 UI 与公开 harness 合同为限。
- 所有静态图谱只说明包内可见语法、模块引用与候选关系；它们不证明代码已加载、调用可达、权限已实施或行为稳定。

## 对 Corvid 的产品映射

| 方向 | 参照启发 | Corvid 当前事实 | 发展要求 |
| --- | --- | --- | --- |
| 日常浏览器主体验 | EGO：普通浏览、标签、Spaces 与 Agent 同处一个浏览器产品。 | Corvid 已有 WebContentsView、Profiles、Rooms、标签、历史/书签/下载和 Chrome 导入。 | 优先完成地址栏、标签、Space/Room、常用日常入口的统一交互；Agent 面板与任务不能替代浏览器主画布。 |
| 内置 Agent | Kaze：可见 Agent 工作区、任务状态和用户接管入口；EGO 的可见 Space 结构提供共享上下文方向。 | Corvid 使用 Pi SDK，已有页面上下文预览与显式同意、Pi transcript、多轮续聊及接管暂停合同。Pi 工作台现将任务历史独立滚动，并把任务输入/页面上下文确认区固定在底部；长历史刷新保留阅读位置。 | 把每个任务的目标、执行状态、页面/运行时和控制权清晰分行呈现；继续补空态、失败恢复、键盘、窄窗与真实 provider 边界。 |
| 外部 Agent/MCP | Kaze UI 提供 Agent 工作区入口；BrowserMCP 源码展示 tab observe/act、清理和站点 adapter 工具形状；EGO harness 提供外部 Agent 共用浏览器会话的参照。 | `mcp/corvid.mjs` 已提供显式 Room/Tab 的发现、快照、HTTP(S) 导航、click/fill/press；本地 E2E 验证写入后页面状态及用户接管时拒绝。 | 页面上下文同意、风险复核 UI、暂停/恢复、MCP host 配置和 adapter 仍需后续实现；不开放任意 `evaluate`/CDP。 |
| 迁移与日常入口 | EGO/Kaze 都将迁移引导作为浏览器产品能力的一部分。 | Corvid Chrome 书签/历史/Cookie/扩展导入已有隔离 E2E，原生钥匙串等仍未验证。 | 按 D13 持续完成真实系统授权、错误恢复、打包及 Windows 边界；不将合成 Profile 测试写成真实 Chrome 认证。 |

## 本轮取舍

本轮已将 D20 从只读 MCP 扩展到四个显式 Room/Tab 绑定的常用动作：HTTP(S) 导航、单一定位器点击、文本输入与按键；统一检查 Agent 控制、无待接管、无执行风险和 managed tab，并由主进程再次校验。REA 比较用于界定 EGO 日常浏览、Kaze 导航与任务入口及 BrowserMCP 工具形状；Corvid 行为以本地 Electron E2E 为准。仍不暴露任意 `evaluate`/CDP、tab 创建/关闭、文件上传或控制权转移。详见[执行任务板](../execution/feature-board.md#d20-部分)和[验证记录](../reviews/verification-log.md)。

## 2026-11-03 11:37 扩展弹窗执行状态与首发双语合同同步

本次仅同步两个已有切面，不重新扫描竞品包。**Corvid 静态证据：** 当前主分支 `docs/execution/feature-board.md` 的 D14 原记录仍称扩展工具栏弹窗未集成；应用语言硬编码与本地化缺失则由 `desktop/index.html` 等源码检索记录。D14 已按中文 PR [#131](https://github.com/heyallencao/corvid/pull/131) 更新为“部分”：PR 记录了真实 Electron 与隔离合成 Chrome Profile/扩展 E2E，覆盖 MV3 弹窗内容、尺寸、所属 Session、sandbox/Node 边界、Escape/外点关闭与焦点恢复；MV2、弹窗导航失败、屏幕阅读器、暗色/窄窗及 Windows/Linux 仍未验收。截图现位于 main 的 QA 目录，由合成 fixture 生成、不含用户页面数据；截图是辅助布局证据，不证明未覆盖的平台或扩展兼容性。

**REA 参考与限制：** PR #131 复用 Kobra 下拉菜单页面 `https://kobra.systems/components/dropdown-menu` 的 REA Evidence `ev_3edcac9a9d467a934c1bdadc8ef6aa20155315eb1f93278088e0a98d4ac5a54c`。直接记录仅证明该路由可访问；没有完成菜单交互，焦点、关闭与状态行为未知，因此只作为细节灵感来源，不作为扩展弹窗行为证据或验收标准。未复制代码、图标或素材。Rare UI、EasyUI、Pin UI、Aceternity 本次未观察；EGO/Kaze 当前窗口 UI 也未重新采集，不能据此推断其当前扩展行为。

**双语合同与取舍：** 已有开放中文 Issue [#130](https://github.com/heyallencao/corvid/issues/130) 覆盖首发 `zh-CN`/`en`、locale 资源、语言选择、日期/数字格式化、窄窗与无障碍验收，本轮只将该范围同步到架构文档及执行板 D24，不重复开单。UI 灵感站点不决定 Corvid 功能需求；仅在能安全核实且与切面相关时参考细节。未运行测试；本次文档检查不声称验证代码行为。

## 2026-11-03 浏览身份删除范围参考

观察时间：2026-11-03 约 22:50（Asia/Shanghai）。使用 REA `capture_browser_scenario` 启动隔离的 Chromium 156.0.8078.79 临时配置，读取厂商公开帮助页的 DOM 与可访问性树；未连接当前用户的 EGO、Kaze、Chrome 或 Safari 窗口，也没有登录或改动用户数据。以下“直接观察”指在隔离 Chromium 中实际加载到的官方帮助页内容，不等于对 Chrome/Safari 原生界面的交互验证。

| 产品/页面 | 直接观察 | 证据与限制 |
| --- | --- | --- |
| Google Chrome，“Manage Chrome with multiple profiles” | 官方流程先进入 Profile 菜单下的“Manage Chrome profiles”，选中身份后从 More 菜单选择 Delete，再二次确认。帮助页明确列出被删除的书签、历史、密码和其他设置。身份管理集中在 Profile 管理流程内，最终确认前说明数据影响。 | REA controlled replay Evidence `ev_030a3fa846bf1e55eb2d59ebda668384a07c40fac4ae003df523927da1747a99`，Chromium 156.0.8078.79；页面地址最终落在 `https://support.google.com/chrome/answer/2364824?hl=en&open_embed_dialog=1&start_dialog_maximized=1&ai1hc=1`。直接证据是官方文档 DOM/AX，不是 Chrome 原生 Profile picker 的实测。页面表述的删除范围不能证明浏览器缓存、扩展文件或系统下载目录的内部清理实现。 |
| Apple Safari，“Create distinct browsing profiles in Safari on Mac” | 官方指南说明始终存在 Personal (Default)；删除身份会清除该身份的 tabs、history、website data，并关闭其打开的所有网站；收藏夹目录会保留（除非为空）。指南还说明 iCloud Keychain 保存的密码在不同身份中可用，因此 Safari Profile 不等于密码凭据完全隔离。 | REA controlled replay Evidence `ev_97475b45ef50f6216275e5a422ca3577d94f6bc9c09ffe0158cb93f185022e73`，页面从请求地址重定向到 `https://support.apple.com/guide/safari/create-profiles-ibrwf3a9e7d6/mac`。直接证据是官方文档 DOM/AX；未操作 macOS Safari 设置或实际删除 Profile。 |

**设计推断：** Corvid 的删除确认应在最后一步用短清单说清即将移除的浏览资料库、站点存储、身份设置、管理扩展与 Agent 对话/恢复数据，并单独说明已下载到磁盘的文件会保留；不能将“Profile 隔离”表述成第三方密码管理器或系统 Keychain 的隔离保证。Chrome/Safari 会直接删除身份，Safari 会关闭其窗口；Corvid 的 Room、任务与跨窗口状态会形成额外引用，不能直接沿用“点 Delete 后自动关窗”的简化流程。为避免悄悄丢失用户/Agent 工作，删除时应列出仍引用此身份的窗口、空间和可恢复 Agent 任务并阻止操作，先由用户处理这些引用。

**静态证据：** Corvid 当前 Profile 由 `profiles.json` 和 `persist:corvid-profile-${profileId}` session partition 标识；History/Bookmarks/Downloads 与 managed extension records 由独立数据文件持有；Agent task/conversation 和 runtime checkpoint 还分布在 `agent-tasks.json` 与 `agent-sessions/`。这些事实来自 Corvid 当前源代码，不是竞品证据。

**未观察/未知：** 本轮未通过 REA 操作 Chrome/Safari 原生 Profile 管理界面；未检查 EGO/Kaze Profile 删除交互；也没有测量窄窗状态、确认对话框视觉层级、键盘操作或删除失败后的恢复行为。由此不对这些行为作竞品结论。视觉交互实现还需按 UI QA 流程在隔离 Corvid 数据目录及小/常规窗口检查。
