# Corvid 系统设计

Corvid 是面向用户的本地优先浏览器，也是用户与 Agent 协作的主产品。产品主线采用 Ego 式浏览器协作模式：用户日常浏览与 Agent 在独立 Room 中并行工作；Room 控制权可见、可接管、可交还，任务可以跨调用和重启继续。浏览器日常功能、内置 Agent 工作台、外部 Agent SDK/CLI 必须汇入同一套 Profile、Room、Page 与控制权合同，而不是成为彼此割裂的产品入口。统一桌面信息架构与视觉体验见[统一桌面体验设计](ui-experience.md)，按[执行任务板 D21](../execution/feature-board.md)分阶段交付。

当前实现包括桌面日常浏览器、Profile/Room、用户控制权交接、外部 Agent SDK/CLI，以及 Corvid Agent 工作台：用户可从当前网页创建独立 Agent Room，预览并确认页面上下文后开始任务，查看运行状态，并在保存的对话记录上继续多轮交流。Agent 的运行时、SDK 类型、认证流程和会话文件格式均为内部实现，不构成用户可见的产品概念；Corvid 拥有任务与对话记录、模型设置、OAuth/API Key 配置、浏览器工具授权、Profile/Room/Page 绑定、用户接管和恢复语义。更换或升级运行时必须由 Corvid 适配层承接，并维持用户界面、持久化数据和控制权合同；需要迁移时由 Corvid 负责兼容或明确迁移，不要求用户安装、配置或了解某个运行时。当前使用的 SDK 实现细节仅记录在内部验证材料中。模型选择和自定义 OpenAI 兼容端点由 [Issue #55](https://github.com/heyallencao/corvid/issues/55) 交付；对话工作台由 [Issue #56](https://github.com/heyallencao/corvid/issues/56) 迭代。接管后仍需用户显式确认上下文再续聊，自动续跑和更完整的中断恢复尚未实现。详见 [执行任务板](../execution/feature-board.md) 的 D19。

Provider 凭据由 Corvid 以 `agent-credentials.json` schemaVersion 1 管理，并通过运行时适配层提供给当前执行引擎；内置引擎不再拥有账号凭据文件。首次读取时兼容迁移旧版引擎凭据与自定义端点 API Key，写入并校验 Corvid 凭据记录后才清理旧明文副本。模型目录只保留无凭据的端点配置引用；OAuth/API Key、令牌刷新与登出继续经 Provider 的授权合同执行。迁移实现和未覆盖的真实 OAuth 故障/跨平台持久性边界见 D19 与验证记录。

## 系统边界

- 应用负责浏览器窗口、Room、标签以及控制权的生命周期；Agent 通过本地认证接口操作获得授权的 Room。
- **Profile** 是浏览身份及其 Cookie、存储的边界；**Room** 是同一 Profile 下的工作区与控制权边界。不能把 Room 隔离误称为浏览数据隔离。
- 桌面端维护 Room、Page、控制权状态；页面由 Electron `WebContentsView` 承载，同一 Profile 的页面使用同一持久化 session，不同 Profile 使用不同 session。
- Agent SDK 与 CLI 连接本地控制服务。管理员 Bearer 凭据保存在权限为 0600 的 `control.json`；可由管理员为 Agent 客户端签发仅保存 SHA-256 摘要的独立凭据，并将每个客户端限制到明确的 Room ID 列表。服务在每次请求中校验身份和 Room 范围；撤销立即生效。Scoped 客户端只能列出/访问已授权 Room，不能访问全局 Profile、历史、书签、下载或窗口接口。稳定 Room ID、标签 ID 和 Page label 映射由服务维护；显示名称不充当唯一标识。
- 内置 Agent 通过 Corvid 运行时适配层执行会话与模型调用。当前适配器使用 Pi SDK，但其名称、专属类型、配置格式和错误不得进入用户可见的界面、帮助文档或持久化产品合同；Corvid 拥有任务 UI、模型配置、对话记录、Profile/Room/Page 绑定、浏览器工具授权与用户接管合同。替换运行时时由适配层转换供应商格式，并由 Corvid 负责既有配置与对话记录的兼容迁移。任何运行时默认文件与 shell 工具均不作为浏览器 Agent 的隐式能力。
- 页面动作通过被授权页面的 Chromium 调试能力执行。用户控制期间拒绝自动操作；执行超时或异常退出后保留"结果未知"的风险状态，直到用户确认。

## 关键决策

| 决策 | 说明 |
| --- | --- |
| Electron + Chromium | 先保证桌面能力与可验证性；单窗口起步，多窗口后置 |
| 控制服务只监听 `127.0.0.1` | 使用随机端口 + 管理员 Bearer token，token 写入 `control.json`（0600），不暴露远程调试端口；Agent 客户端凭据独立签发，可按 Room 授权与撤销 |
| 每个 Room 一条串行队列 | 页面动作、交还、取回按 Room 排队；用户接管优先，新动作被拒绝而不是抢占 |
| 状态文件原子写 | `rooms.json`、`library.json`、`profiles.json` 使用 tmp + rename，权限 0600；文件带 `schemaVersion` |
| Page label 稳定 | `p1`、`p2` 跨轮次、跨重启保持，已用 label 不复用；Agent 创建的页面与用户页面用 `openedBy` 区分 |
| 观察结果显式受限 | Snapshot 返回截断标记和覆盖限制；不把近似无障碍树说成完整语义 |
| 所有 Agent 共用一套协作合同 | 内置 Agent、SDK/CLI 与后续适配器都必须使用同一 Room/Page 生命周期、授权检查、运行状态、任务记录和控制权交接；不能绕开用户控制或制造另一份浏览器状态 |
| Agent runtime 可替换，Corvid 保持产品合同稳定 | 当前通过适配层使用 Pi SDK 执行会话与模型工具调用；runtime 专属实现留在内部。任务状态、模型偏好、对话记录、浏览器 UI、Profile/Room/Page 绑定、用户控制和恢复由 Corvid 管理。替换或升级 runtime 时，由 Corvid 适配层处理模型配置、授权凭据与会话 checkpoint 的兼容/迁移；不兼容凭据需在 Corvid 界面重新授权，不得要求用户安装、配置或识别底层运行库。验收须保留任务 ID、用户对话记录、模型偏好、上下文授权与 Room/Page 绑定；无法恢复的 checkpoint 要明确说明并允许从 Corvid 对话记录继续，不得静默丢弃。浏览器 Agent 只注册显式授权的 Corvid 工具，不继承第三方文件系统或 shell 工具 |
| 浏览器日常能力是 Agent 的上下文，不是 Agent 的替代品 | 地址栏、标签、历史、书签、下载、权限与站点数据管理继续属于完整浏览器；Agent 从当前用户明确选择的上下文开始工作，并把执行状态和待用户处理事项呈现在桌面 |

## 已知限制

- Agent 客户端的 Room 范围现由服务端校验，但授权管理界面、内置 Agent/MCP 的统一凭据注入与更完整的操作能力合同仍待交付，不能据此宣称完整的多 Agent 隔离已完成。
- 当前管理员凭据仍能访问所有本地数据，并可签发/撤销 Agent 凭据；控制服务面向同一操作系统用户。本机进程若能读取 Corvid 数据目录中的 `control.json`，即可取得管理员权限，因此该机制不是针对恶意同用户进程的操作系统级安全边界。
- Snapshot 覆盖主文档、单层同源 iframe 与开放 Shadow DOM；跨源 iframe、closed Shadow DOM、复杂嵌套尚未支持（列入 Snapshot v2）。
- 部分输入路径使用合成事件（例如清空文件选择、select 变更）；真实网站兼容性需要逐站验证。
- 系统级交互（权限确认、保存对话框）在自动化测试中使用测试替身；原生对话框交互尚未验证。
- 尚未打包、签名、自动更新；Windows 与安装分发未验证。
- 真实网站、真实登录、长时间运行、崩溃恢复和性能尚未做端到端验证。

## 迭代顺序

执行顺序以 [执行任务板](../execution/feature-board.md) 为唯一任务入口：先收敛 P0 的控制权、风险恢复、权限与数据边界；同步完善 P1 日常浏览交互和可访问性；在现有 Room/SDK 合同上交付内置 Agent 工作台，让用户能从浏览上下文启动、观察、暂停/接管、继续和结束任务；再收敛多 Agent 身份与任务连续性；最后处理导入、扩展、安装分发及平台验证。每次交付保持真实桌面 UI、Agent API、状态持久化和错误路径一致，具体验收合同见任务板。
