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
| 已安装 EGO：`/Applications/ego lite.app`，版本 `0.6.2.5` / build `6.2.5` | 当前窗口显示浏览器导航、标签、Space 入口、创建与打开 Space；普通网页浏览与 Agent 工作区同属一个浏览器产品。 | 2026-11-02 只读现场 UI/AX 观察；不记录页面内容。 | UI 观察证明可见结构，不证明后台 Agent 隔离、权限与故障恢复实现。 |
| EGO REA：Evidence `ev_2427a886de292400f519650617741446c0908b99f864b8d8fb04dcb679b1336b` | 已检查应用目录 2,574 个条目；探测 70 个文件、读取 5,076 字节；扫描中未识别出 Electron/runtime candidate。 | `inspect_desktop_application`；目录摘要身份 SHA-256 `422aa7e21004305c40278981ea4c2f909b4297d03b20e7df418bde07cafdcefd`。 | 该摘要只覆盖所检查的路径、元数据和读取范围；REA 明确指出运行时行为、未读字节和构建对应关系未知。此扫描不能解释完整浏览器实现。 |
| EGO 开源仓库 [`citrolabs/ego-lite`](https://github.com/citrolabs/ego-lite/tree/12407167f84a58af24044f072868051952131491)，commit `12407167f84a58af24044f072868051952131491` | 仓库说明其交付物是 `ego-browser` Agent harness/技能接口；可见接口围绕共享浏览器会话、Space、页面句柄与 Agent 操作。 | 仓库 README 与 `AGENTS.md`；源码仓库状态为 `main...origin/main`。 | 该仓库不是 EGO 完整桌面浏览器本体；接口文档或 harness 行为不能证明未公开应用内部实现。 |
| 已安装 Kaze：`/Applications/Kaze.app`，版本 `0.26.0` / build `0.26.0` | 可见主导航 Browser/Skills/Scheduled/Activity、Space 切换及 Space 内标签；浏览器窗口内另有 Agent 工作区入口。 | 2026-11-02 只读现场 UI/AX 观察；不记录私人页面内容。 | 证明产品导航与可见入口，不证明各入口在所有状态下的完整行为。 |
| Kaze REA 包分析 | 已安装 `app.asar` SHA-256 `c168a2ef9b3586a9de0965972ec82bebb9391fa68dfbf876e4b7c173ce6682d4`；包内含 `out/main/index.js`、`out/main/agent.js`、`out/preload/shell.cjs`、renderer 与 `@jackwener/browsermcp` 站点适配器。Pi Agent 入口对 Pi coding-agent 与 Electron/Node 能力有静态模块引用。 | REA `analyze_javascript_application` 的小范围选择分析，Evidence `ev_567d227d3be26ac6a00ce15a13597a07f8807485dfe4db299e2e512a8b0c7055`；BrowserMCP adapter-sdk/package 选择分析 `ev_d7e6ba8a3a19e4de954ce6ec1eabcaf991118eb6e4ce28c5ca76ef0b1f9dee`。 | 初次全包图谱因父进程结果预算耗尽而为 partial；针对入口的小范围图谱也不证明运行时可达性、具体默认值或授权执行效果。外部 Pi/BrowserMCP 依赖未在该选择分析中展开。 |
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
| 外部 Agent/MCP | Kaze README 所述 BrowserMCP 操作已登录浏览器；EGO harness 提供外部 Agent 共用浏览器会话的参照。 | `mcp/corvid.mjs` 当前仅暴露显式范围的只读发现与页面快照。 | 明确页面/标签选择、Snapshot、授权操作、风险复核、暂停/接管和 MCP host 配置；保留 Profile/Room 隔离，不开放任意 `evaluate`/CDP。 |
| 迁移与日常入口 | EGO/Kaze 都将迁移引导作为浏览器产品能力的一部分。 | Corvid Chrome 书签/历史/Cookie/扩展导入已有隔离 E2E，原生钥匙串等仍未验证。 | 按 D13 持续完成真实系统授权、错误恢复、打包及 Windows 边界；不将合成 Profile 测试写成真实 Chrome 认证。 |

## 本轮取舍

当前先修整 Pi 任务卡信息层级：任务目标独立显示，运行状态与页面/运行时上下文分开，Room 控制状态另行呈现。此切片落实 Kaze 的可见任务状态，同时保留 Corvid 的浏览器并行空间；不改 Pi runtime、授权、Room/Profile/Page 绑定。该切片的测试与视觉证据必须在合并前补齐，并同步更新 [任务板](../execution/feature-board.md) 和 [验证记录](../reviews/verification-log.md)。
