# 多会话协作协议（agent-protocol）

> 本文件是所有 Agent 会话（Codex / ZCode / dsh / 人工）在 Corvid 仓库内的协作合同。
> 任何会话开工前必读本文；本文与 `AGENTS.md` 冲突时以 `AGENTS.md` 为准。
> 状态：2026-11-04 首版（v1），由产品所有者批准后生效。

## 0. 设计原则

1. **会话无状态，状态全在仓库**：工作队列、认领、进度、验收全部通过 GitHub Issue / PR / label / 评论承载。任何本地文件、数据库、schedule 不作为协作依据（换机器、换会话必须能无缝接续）。
2. **优先级单一来源**：Issue 的 `priority:*` label。`docs/qa/daily-health-report.md` 只给人看，不是机器队列。
3. **身份用稳定字符串**：当前仓库只有 `heyallencao` 一个协作者账号，GitHub assignee 无法区分会话。会话身份 = 认领评论里的 `工具-lane@机器`（如 `codex-fix@studio`、`zcode-integrate@studio`）。
4. **merge 纪律是协议约束**（免费私有仓库无 branch protection）：只有集成 lane 允许点 merge。工人会话合并自己的 PR 视为违规，集成 lane 每日审计 merged-by 并纠正。

## 1. 工种（lane）

分工按**领域**切（bug 与功能都归领域，优先级横切排序），不按活的性质切：

| lane | label | 职责域 | 备注 |
|---|---|---|---|
| 浏览器核心 | `lane:browser` | 标签页、历史、书签、下载、导入迁移、多窗口、持久化、启动与运行稳定性、性能 | 兼管 `lane:infra` 小切片 |
| Agent 平台 | `lane:agent` | Agent runtime、SDK/CLI、BrowserMCP、工作台、授权与 Task Space 隔离、模型连接与凭据 | 对外 SDK 变化须同步接口文档 |
| 视觉交互体系 | `lane:ui` | 设计 token、图标、窗口 chrome、菜单、面板/弹层模型、可达性、双语、状态反馈语言 | 大切片先在 issue 提交拆解方案 |
| 基建 | `lane:infra` | 打包、CI、签名、E2E 基础设施 | 无专属工人时由 browser 兼管，量大再独立 |
| 集成 | —（指定会话） | 唯一允许 merge 的角色：审 PR、跑全量 E2E、合并或打回；不开新切片 | 当前无 branch protection，靠此规则约束 |
| 调度 | —（dsh 定时会话） | 每日 09:00 体检；为 issue 打 `lane:*` + `priority:P0-P3`；回收 stale；出日报 | 不写业务代码 |

同一 lane 可挂多个会话并行。工人只领自己 lane 的 issue；队列空时结束本轮，不跨 lane 领活。

## 2. Issue 生命周期与 label

```
open ──认领──▶ claimed ──交PR──▶ in-review ──merge──▶ 自动关单(Closes #NNN)
                │ │ │
                │ │ └── 干不下去 ──▶ requeued（回 open 队列）
                │ └──── 需要人拍板 ─▶ blocked:user（答复后回 claimed）
                └────── 无心跳>24h ─▶ stale ──接管──▶ claimed（换身份）
```

需维护的 label：`priority:P0` `priority:P1` `priority:P2` `priority:P3`、`lane:fix`、`lane:structure`、`claimed`、`in-review`、`blocked:user`、`stale`、`requeued`。

## 3. 认领协议（工人会话每一轮的开工步骤）

```bash
# 0. 全局红线：开放 PR > 8 时，禁止领新活，去协助消化
gh pr list --state open --json number --jq 'length'

# 1. 从自己 lane 的队列顶取一个（已排除被认领的）
gh issue list --search "state:open label:lane:browser -label:claimed -label:stale" \
  --limit 5 --json number,title,labels --jq '.[0]'

# 2. 认领三件套：label + 身份评论
gh issue edit <N> --add-label claimed
gh issue comment <N> --body "claimed by codex-fix@studio — 切片: <一句话范围>"

# 3. 读回校验（防撞车）：label 已被他人抢占则放弃，回步骤 1
gh issue view <N> --json labels,assignees

# 4. 隔离开发：从最新 main 拉独立分支
git fetch origin
git worktree add ../corvid-issue-<N> -b fix/issue-<N>-<slug> origin/main
```

分支命名：`<lane>/issue-<N>-<slug>`（如 `browser/issue-77-cookie-recovery`）。不得复用他人分支，不得 force-push 共享分支。

PR 创建前必须 rebase 到 origin/main；集成 lane 按创建顺序 FIFO 合并——main 推进快，冲突窗口必须压在小时级以内。

## 4. 心跳与进度（跨机器可续的关键）

- **进度只写 issue 评论**，不写本地文件。会话中断后，接替者读最后一条评论即知从哪续。
- 每完成一个里程碑或每 2 小时（取先到），发一行心跳：

```
progress(codex-fix@studio): E2E 通过，剩余 docs 同步
```

- 交付即最后一次评论：PR 链接 + 证据（E2E 输出摘要、截图 sha256 前缀）。
- PR 标题格式 `【#NNN】<一句话>`，body 首行写 `Closes #NNN`（合并时 GitHub 自动关单）。

## 5. 接管（takeover）

- `stale` 判定（由调度 lane 每日执行）：claimed 且无心跳评论、无分支新提交超过 24h。
- 接管者动作顺序：
  1. 发 `takeover-intent` 评论（写明对象身份与原因），等待 1 小时宽限——原会话若存活会回复；
  2. **先考古再动工**：fetch 原分支、审 diff、跑测试，确认半成品状态，结论写进 takeover 评论；
  3. 原分支续用（不 force-push）；确实无法续则基于可保留提交开新分支，原分支在 issue 中标注留档。
- 接管后更新认领评论（新身份）并移除 `stale`。

## 6. 阻塞与边界

| 情况 | 动作 |
|---|---|
| 需要用户决策 | 打 `blocked:user`，**一次性**写清全部问题；调度 lane 每日汇总进日报，用户一天答一次；挂超 3 天由调度给默认方案，用户否决即可。禁止反复打断用户（反复请求授权 = 违规） |
| 干着干着发现相邻 bug/改进 | 只完成当前切片；新发现开**新 issue**回队列。不扩切片范围 |
| 需要签名/钥匙串/发布权限 | 写入 issue 评论并打 `blocked:user`；这些操作只由用户本人执行 |
| 疑似与他人撞车（同文件/同 issue 双 PR） | 停手，评论 @集成 lane 仲裁；集成 lane 定合并顺序，后者 rebase |
| 指令冲突 | 优先级：`AGENTS.md` > 本文 > 会话目标文本 > issue 评论 |

## 7. 集成 lane 每轮清单

```bash
gh pr list --state open --json number,title,author
# 对每个 PR：
#  a. 查重：标题 grep【#NNN】，同 issue 多 PR 则关重（留证据全的）
#  b. review（COMMENT 型；同账号无法 Approve）：对照验收标准与证据
#  c. 本地跑全量 env -u ELECTRON_RUN_AS_NODE npm test
#  d. 合格 merge（唯一 merge 权限），不合格打回并写明原因
# 每日附加：
#  - 扫 claimed 无心跳 → 打 stale
#  - 审计 merged-by（工人自合 = 违规，纠正并记录）
#  - 清理已合并/废弃的僵尸分支
#  - main 被合坏 → 立即 revert 恢复 main，修复另开 priority:P0
```

## 8. 调度 lane（dsh 每日 09:00）清单

1. 全项目体检（沿用 `docs/qa/daily-health-report.md` 既有标准），产出日报。
2. **Triage**：为全部 open issue 打/校正 `lane:browser|agent|ui|infra` 与 `priority:*`（新 issue 必打；按领域归属归类，严重度依据体检证据，不沿用昨天结论）。
3. 回收：claimed 无进展 > 24h → `stale`；`blocked:user` 超 3 天 → 给默认方案。
4. 日报中汇总：当日新增/关闭、阻塞问题清单（供用户一次性答复）、WIP 状态。

## 9. 扩展规则（加会话/加机器）

- 新会话入职 = 目标文本一句话：`读 docs/execution/agent-protocol.md，作为 lane:<browser|agent|ui> 工人工作直到队列清空`。
- 同一 lane 可挂多个会话（认领协议保证不撞车）；并行上限由开放 PR 数控制（红线 8），不由机器数控制。
- 某类活积压时：优先同 lane 加工人；其次由调度 lane 调整 label 或建议工人转岗。

## 10. 违规与修正

集成 lane 发现违反本协议的行为（自合 PR、重复打断用户、扩切片、不认领直接干）：
在对应 issue/PR 评论中指出依据条款，必要时 revert 违规合并；反复违规的会话身份记录进日报，由产品所有者处置。

## 11. 已知限制（不掩盖）

- 无 branch protection（免费私有仓库限制）：防自合、防误合仅靠本文纪律 + 集成 lane 审计，非机制强制。
- 同账号无法正式 Approve PR：review 为 COMMENT 型 + 本地 E2E 证据。
- 认领存在理论竞态窗口（GitHub 无事务）：靠读回校验 + 调度错峰缓解；发生时由集成 lane 仲裁。
