# Issue #5 启动失败后的凭据清理恢复

关联 [Issue #5](https://github.com/heyallencao/corvid/issues/5)，作为 PR #156「修复内置 Agent 会话清理失败后的重试」的后续窄切片；不修改 PR #156 的工作树。

## 问题与范围

Agent 任务先签发 scoped credential，再创建 runtime session。若 session 初始化失败且 credential 撤销也失败，错误处理本身会再次 reject，导致任务状态未从 `preparing` 更新，用户无法停止或删除任务；凭据映射虽然必须保留以便重试，但界面也没有清理失败状态。

本切片保留原始初始化错误，仍将任务和 assistant turn 标记为 `failed`；撤销失败时增加现有双语清理错误事件、设置 `stopUnconfirmed` 并禁止续聊。凭据句柄留在内存映射中，用户随后移除任务时沿用现有撤销重试路径。任务存储 schema 与产品界面资源不变。

## 验收

- 确定性 runtime 令 `createSession()` reject，同时让首次 `revokeAgentCredential()` reject。
- 调用方收到原始 runtime 初始化失败，而不是被撤销错误替换。
- 持久任务转为 `failed`，assistant turn 失败，清理错误可见，`canContinue` 为 `false`。
- 凭据句柄仍可重试；后续撤销成功后才能删除任务记录。
- 验证命令：`node tests/agent-runtime-contract-e2e.cjs`、`node tests/agent-task-continuation-contract.cjs`、相关 `node --check` 与 `git diff --check`。

## 未覆盖

验证使用确定性假 runtime 和临时数据目录，不启动 Electron、不连接真实 Pi runtime、模型或 OAuth；没有运行全量 `npm test`。不会据此宣称真实 Provider 会话初始化或操作系统凭据存储已验证。
