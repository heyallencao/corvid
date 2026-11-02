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
| 已安装 Kaze：`/Applications/Kaze.app`，版本 `0.26.0` / build `0.26.0` | REA 原生窗口截图和 AX 树显示左侧 Browser/Skills/Scheduled/Activity 导航、Space 选择、Space 标签列表与设置；网站仍占据主画布。 | 2026-11-02 REA `observe_native_ui` Evidence `ev_3c3ee4f92ab10275d5eaae96a797c818258f403328128bf9ee16d740bbdb9067`，窗口 46150、截图 1440×851、SHA-256 `58042b2f78e4d2c1a43c3cadccb1cf6b4bb529516735362359ab6a128ac03425`。 | 只观察一个当前窗口；AX 快照含私人网站区域但研究记录不保留页面内容。可见入口不证明所有状态下行为。 |
| Kaze REA 包分析 | 已安装 `app.asar` SHA-256 `c168a2ef9b3586a9de0965972ec82bebb9391fa68dfbf876e4b7c173ce6682d4`。精确选择 `out/main/agent.js` 与 `out/preload/shell.cjs` 后，REA 发现静态引用 `@earendil-works/pi-coding-agent`（本图谱标记 unavailable），Preload 有 `browserAction.update` 事件监听与动态 `kaze` bridge 声明。 | 入口/Preload 选择分析父 Evidence `ev_0107a3a03ec7fa62018621015fae94f3ea74df50b36a291387717e28da7f8333`；精确查询视图 Evidence `ev_7c1d6b6f18501ac3989aeeb0d6999371eab92b8895605f53b07ba80042618f82`。另有 BrowserMCP adapter SDK 小范围 Evidence `ev_d7e6ba8a3a19e4de954ce6ec1eabcaf991118eb6e4ce28c5ca76ef0b1f0f9dee`。 | REA 记录 5 个 unpacked 原生文件完整性矛盾并标为 observed-untrusted。选择分析只覆盖 2 个源码文件，14,852 个其他文件未分析；图谱/语义节点与 unknowns 有截断；JavaScript 未执行，不能证明运行时加载、可达性、权限效果或授权执行。 |
| Kaze 开源仓库 [`jackwener/Kaze`](https://github.com/jackwener/Kaze/tree/ddd85ed3fb4a492438df7cc27e04a800c82bbcfd)，commit `ddd85ed3fb4a492438df7cc27e04a800c82bbcfd` | README 声称内置 Agent 可选模型端点、任务拥有独立标签组织、用户可接管，并能从设置连接外部 Agent/MCP；还将 BrowserMCP 描述为操作已登录浏览器、带 JavaScript 工作区与可复用网站适配器的开源 MCP 服务。 | 仓库 README/README.zh-CN.md 与安装包模块清单。 | README 是产品方公开说明，不等同于独立端到端验证；本次没有操作已登录网站或连接真实 MCP host。 |

## REA 特别限制

- Kaze 完整 `app.asar` 第一次分析返回 resource constraint：父结果预算耗尽于第三方语言包文件，剩余源文件未分析。保留的完整包级 Evidence 是 partial，不能用来声称整包无某种功能。
- 后续改为精确入口路径选择，避免再次展开整个依赖树。Kaze 包存在 5 个 unpacked native 文件的完整性差异，均被 REA 记录为 observed-untrusted；其中包括带 Developer ID 签名的 Pi TUI native 文件。差异会限制该 native 文件的来源判断，不影响将其他 JS 文件内容直接等同为运行时证明。
- REA 对 EGO 安装目录未识别出可分析运行时组件；这是扫描结果，不是“没有 Agent”或“没有功能”的证据。产品层判断继续以现场 UI 与公开 harness 合同为限。
- 所有静态图谱只说明包内可见语法、模块引用与候选关系；它们不证明代码已加载、调用可达、权限已实施或行为稳定。

## 对 Corvid 的产品映射

| 方向 | 参照启发 | Corvid 当前事实 | 发展要求 |
| --- | --- | --- | --- |
| 日常浏览器主体验 | EGO：普通浏览、标签、Spaces 与 Agent 同处一个浏览器产品。 | Corvid 已有 WebContentsView、Profiles、Rooms、标签、历史/书签/下载和 Chrome 导入。 | 优先完成地址栏、标签、Space/Room、常用日常入口的统一交互；Agent 面板与任务不能替代浏览器主画布。 |
| 内置 Agent | Kaze：可见 Agent 工作区、任务状态和用户接管入口；EGO 的可见 Space 结构提供共享上下文方向。 | Corvid 使用 Pi SDK，已有页面上下文预览与显式同意、Pi transcript、多轮续聊及接管暂停合同。 | 把每个任务的目标、执行状态、页面/运行时和控制权清晰分行呈现；继续补空态、失败恢复、键盘、窄窗与真实 provider 边界。 |
| 外部 Agent/MCP | Kaze UI 提供 Agent 工作区入口；BrowserMCP 源码展示 tab observe/act、清理和站点 adapter 工具形状；EGO harness 提供外部 Agent 共用浏览器会话的参照。 | `mcp/corvid.mjs` 已提供显式 Room/Tab 的发现、快照、HTTP(S) 导航、click/fill/press；本地 E2E 验证写入后页面状态及用户接管时拒绝。 | 页面上下文同意、风险复核 UI、暂停/恢复、MCP host 配置和 adapter 仍需后续实现；不开放任意 `evaluate`/CDP。 |
| 迁移与日常入口 | EGO/Kaze 都将迁移引导作为浏览器产品能力的一部分。 | Corvid Chrome 书签/历史/Cookie/扩展导入已有隔离 E2E，原生钥匙串等仍未验证。 | 按 D13 持续完成真实系统授权、错误恢复、打包及 Windows 边界；不将合成 Profile 测试写成真实 Chrome 认证。 |

## 本轮取舍

本轮已将 D20 从只读 MCP 扩展到四个显式 Room/Tab 绑定的常用动作：HTTP(S) 导航、单一定位器点击、文本输入与按键；统一检查 Agent 控制、无待接管、无执行风险和 managed tab，并由主进程再次校验。REA 比较用于界定 EGO 日常浏览、Kaze 导航与任务入口及 BrowserMCP 工具形状；Corvid 行为以本地 Electron E2E 为准。仍不暴露任意 `evaluate`/CDP、tab 创建/关闭、文件上传或控制权转移。详见[执行任务板](../execution/feature-board.md#d20-部分)和[验证记录](../reviews/verification-log.md)。
