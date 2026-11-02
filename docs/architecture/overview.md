# Corvid 系统设计

Corvid 是面向用户的本地优先浏览器，也是用户与 Agent 协作的主产品。产品主线采用 Ego 式浏览器协作模式：用户日常浏览与 Agent 在独立 Room 中并行工作；Room 控制权可见、可接管、可交还，任务可以跨调用和重启继续。浏览器日常功能、内置 Agent 工作台、外部 Agent SDK/CLI 必须汇入同一套 Profile、Room、Page 与控制权合同，而不是成为彼此割裂的产品入口。统一桌面信息架构与视觉体验见[统一桌面体验设计](ui-experience.md)，按[执行任务板 D21](../execution/feature-board.md)分阶段交付。

当前实现包括桌面日常浏览器、Profile/Room、用户控制权交接、外部 Agent SDK/CLI，以及首段 Pi Agent 工作台：用户可从当前网页创建独立 Agent Room，预览并确认页面上下文后启动 Pi，查看任务事件，并在保存 transcript 上继续多轮对话。任务与 transcript 目录按 task 绑定，未完成任务重启后显示为结果未知。接管后自动续跑、实时 provider/凭据设置和更完整的中断恢复仍未实现；详见 [执行任务板](../execution/feature-board.md) 的 D19。

## 系统边界

- 应用负责浏览器窗口、Room、标签以及控制权的生命周期；Agent 通过本地认证接口操作获得授权的 Room。
- **Profile** 是浏览身份及其 Cookie、存储的边界；**Room** 是同一 Profile 下的工作区与控制权边界。不能把 Room 隔离误称为浏览数据隔离。
- 桌面端维护 Room、Page、控制权状态；页面由 Electron `WebContentsView` 承载，同一 Profile 的页面使用同一持久化 session，不同 Profile 使用不同 session。
- Agent SDK 与 CLI 连接本地控制服务。服务统一校验房间所有权，维护稳定的 Room ID、标签 ID 和 Page label 映射；显示名称不充当唯一标识。
- 内置 Agent 采用 Pi SDK 作为可替换的会话/执行运行时；Corvid 仍拥有任务 UI、Profile/Room/Page 绑定、浏览器工具授权与用户接管合同。Pi 默认文件与 shell 工具不作为浏览器 Agent 的隐式能力。
- 页面动作通过被授权页面的 Chromium 调试能力执行。用户控制期间拒绝自动操作；执行超时或异常退出后保留"结果未知"的风险状态，直到用户确认。

## 关键决策

| 决策 | 说明 |
| --- | --- |
| Electron + Chromium | 先保证桌面能力与可验证性；单窗口起步，多窗口后置 |
| 控制服务只监听 `127.0.0.1` | 使用随机端口 + Bearer token，token 写入 `control.json`（0600），不暴露远程调试端口 |
| 每个 Room 一条串行队列 | 页面动作、交还、取回按 Room 排队；用户接管优先，新动作被拒绝而不是抢占 |
| 状态文件原子写 | `rooms.json`、`library.json`、`profiles.json` 使用 tmp + rename，权限 0600；文件带 `schemaVersion` |
| Page label 稳定 | `p1`、`p2` 跨轮次、跨重启保持，已用 label 不复用；Agent 创建的页面与用户页面用 `openedBy` 区分 |
| 观察结果显式受限 | Snapshot 返回截断标记和覆盖限制；不把近似无障碍树说成完整语义 |
| 所有 Agent 共用一套协作合同 | 内置 Agent、SDK/CLI 与后续适配器都必须使用同一 Room/Page 生命周期、授权检查、运行状态、任务记录和控制权交接；不能绕开用户控制或制造另一份浏览器状态 |
| Pi 提供内置 Agent runtime，Corvid 提供产品体验与边界 | 通过 Pi SDK 嵌入会话与模型工具调用；任务状态、浏览器 UI、Profile/Room/Page 绑定、用户控制和恢复仍由 Corvid 管理。浏览器 Agent 只注册显式授权的 Corvid 工具，不继承 Pi 的文件系统或 shell 工具 |
| 浏览器日常能力是 Agent 的上下文，不是 Agent 的替代品 | 地址栏、标签、历史、书签、下载、权限与站点数据管理继续属于完整浏览器；Agent 从当前用户明确选择的上下文开始工作，并把执行状态和待用户处理事项呈现在桌面 |

## 已知限制

- 本地控制服务只有一个共享凭据，没有按 Agent 的身份隔离：任何持有 token 的本地客户端都可以按名称或 ID 恢复 Agent 的 Room。
- Snapshot 覆盖主文档、单层同源 iframe 与开放 Shadow DOM；跨源 iframe、closed Shadow DOM、复杂嵌套尚未支持（列入 Snapshot v2）。
- 部分输入路径使用合成事件（例如清空文件选择、select 变更）；真实网站兼容性需要逐站验证。
- 系统级交互（权限确认、保存对话框）在自动化测试中使用测试替身；原生对话框交互尚未验证。
- 尚未打包、签名、自动更新；Windows 与安装分发未验证。
- 真实网站、真实登录、长时间运行、崩溃恢复和性能尚未做端到端验证。

## 迭代顺序

执行顺序以 [执行任务板](../execution/feature-board.md) 为唯一任务入口：先收敛 P0 的控制权、风险恢复、权限与数据边界；同步完善 P1 日常浏览交互和可访问性；在现有 Room/SDK 合同上交付内置 Agent 工作台，让用户能从浏览上下文启动、观察、暂停/接管、继续和结束任务；再收敛多 Agent 身份与任务连续性；最后处理导入、扩展、安装分发及平台验证。每次交付保持真实桌面 UI、Agent API、状态持久化和错误路径一致，具体验收合同见任务板。
