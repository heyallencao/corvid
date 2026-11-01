# Corvid 系统设计

Corvid 的目标是在 macOS 上先建立可运行、可验证的本地桌面浏览器，并保留 Windows 适配空间。用户在自己的标签页里浏览，Agent 在独立 Room 中并行工作。本文只描述系统边界与关键决策，需求与验收状态以 [执行任务板](../execution/feature-board.md) 为准。

## 系统边界

- 应用负责浏览器窗口、Room、标签以及控制权的生命周期；Agent 通过本地认证接口操作获得授权的 Room。
- **Profile** 是浏览身份及其 Cookie、存储的边界；**Room** 是同一 Profile 下的工作区与控制权边界。不能把 Room 隔离误称为浏览数据隔离。
- 桌面端维护 Room、Page、控制权状态；页面由 Electron `WebContentsView` 承载，同一 Profile 的页面使用同一持久化 session，不同 Profile 使用不同 session。
- Agent SDK 与 CLI 连接本地控制服务。服务统一校验房间所有权，维护稳定的 Room ID、标签 ID 和 Page label 映射；显示名称不充当唯一标识。
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

## 已知限制

- 本地控制服务只有一个共享凭据，没有按 Agent 的身份隔离：任何持有 token 的本地客户端都可以按名称或 ID 恢复 Agent 的 Room。
- Snapshot 覆盖主文档、单层同源 iframe 与开放 Shadow DOM；跨源 iframe、closed Shadow DOM、复杂嵌套尚未支持（列入 Snapshot v2）。
- 部分输入路径使用合成事件（例如清空文件选择、select 变更）；真实网站兼容性需要逐站验证。
- 系统级交互（权限确认、保存对话框）在自动化测试中使用测试替身；原生对话框交互尚未验证。
- 尚未打包、签名、自动更新；Windows 与安装分发未验证。
- 真实网站、真实登录、长时间运行、崩溃恢复和性能尚未做端到端验证。

## 迭代顺序

已完成后进入以下顺序：工程底座（版本历史、文档治理、数据 schema）→ Agent API 合同（键盘、焦点、事件、错误码、CDP 逃生口）→ Snapshot v2（多层 iframe、`full_page`/`subtree` 范围、`@N` 引用）→ 产品化（多窗口、标签交互、页内查找、设置）→ 导入、扩展、打包分发。任务状态见 [执行任务板](../execution/feature-board.md)，验证证据见 [验证记录](../reviews/verification-log.md)。
