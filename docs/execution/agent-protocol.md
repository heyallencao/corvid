# 多会话协作协议（agent-protocol）

> 本文件是所有 Agent 会话（Codex / ZCode / dsh / 人工）在 Corvid 仓库内的协作合同。
> 任何会话开工前必读本文；本文与 `AGENTS.md` 冲突时以 `AGENTS.md` 为准。
> 状态：2026-11-04 首版（v1），由产品所有者批准后生效。

## 0. 设计原则

1. **会话无状态，状态全在仓库**：工作队列、认领、进度、验收全部通过 GitHub Issue / PR / label / 评论承载。任何本地文件、数据库、schedule 不作为协作依据（换机器、换会话必须能无缝接续）。
2. **优先级单一来源**：Issue 的 `priority:*` label。`docs/qa/daily-health-report.md` 只给人看，不是机器队列。
3. **身份用稳定字符串**：当前仓库只有 `heyallencao` 一个协作者账号，GitHub assignee 无法区分会话。会话身份 = 认领评论里的 `工具-lane@机器`（如 `codex-fix@studio`、`zcode-integrate@studio`）。
4. **全权责任制**：谁认领 issue 谁完成到合并（自合并，前置检查见第 7 节）。无独立集成关卡；调度 lane 每日抽样审计合并质量，坏 main 立即 revert——用追责代替排队。

## 1. 工种（lane）

分工按**领域**切（bug 与功能都归领域，优先级横切排序），不按活的性质切：

| lane | label | 职责域 | 备注 |
|---|---|---|---|
| 浏览器核心 | `lane:browser` | 标签页、历史、书签、下载、导入迁移、多窗口、持久化、启动与运行稳定性、性能 | 兼管 `lane:infra` 小切片 |
| Agent 平台 | `lane:agent` | Agent runtime、SDK/CLI、BrowserMCP、工作台、授权与 Task Space 隔离、模型连接与凭据 | 对外 SDK 变化须同步接口文档 |
| 视觉交互体系 | `lane:ui` | 设计 token、图标、窗口 chrome、菜单、面板/弹层模型、可达性、双语、状态反馈语言 | 大切片先在 issue 提交拆解方案 |
| 基建 | `lane:infra` | 打包、CI、签名、E2E 基础设施 | 无专属工人时由 browser 兼管，量大再独立 |
| 调度 | —（dsh 定时会话） | 每日 09:00 体检；为 issue 打 `lane:*` + `priority:P0-P3`；回收 stale；出日报 | 不写业务代码 |

同一 lane 可挂多个会话并行。工人只领自己 lane 的 issue；队列空时结束本轮，不跨 lane 领活。工人按第 7 节自合并自己的 PR。

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
# 0. 全局断路器（仅故障时触发，如 CI/额度中断导致积压）：
#    开放 PR > 8 → 全员暂停领取新 issue，优先完成自己名下 PR 的
#    rebase 与自合并，直至 <= 8 后恢复第 1 步。正常流自合并即时消化，
#    队列常态应为个位数。
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

PR 创建前必须 rebase 到 origin/main；自合并前再次 rebase 确认最新——main 推进快，冲突窗口必须压在小时级以内。

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

## 6. 阻塞、边界与冲突处理

| 情况 | 动作 |
|---|---|
| 需要用户决策 | 打 `blocked:user`，**一次性**写清全部问题；调度 lane 每日汇总进日报，用户一天答一次；挂超 3 天由调度给默认方案，用户否决即可。禁止反复打断用户（反复请求授权 = 违规） |
| 干着干着发现相邻 bug/改进 | 只完成当前切片；新发现开**新 issue**回队列。不扩切片范围 |
| 需要签名/钥匙串/发布权限 | 写入 issue 评论并打 `blocked:user`；这些操作只由用户本人执行 |
| 疑似与他人撞车（同 issue 双 PR） | 按 §7 前置检查 a 查重：对方已交付且覆盖自己 → 关自己的 PR 注明引用；只覆盖部分 → rebase 保留剩余增量 |
| 与他人改同一文件且语义互斥 | 停手，在对方 PR/issue 评论写明矛盾点并 @调度仲裁；不许强行盖掉对方实现 |
| 指令冲突 | 优先级：`AGENTS.md` > 本文 > 会话目标文本 > issue 评论 |

### 冲突处理标准动作（rebase/合并冲突）

1. **逐块三选一**：取 main 侧 / 保留自己侧 / 融合两侧。判据是内容对比（`git diff`、`git log <file>` 看远端该文件近期提交），不靠提交标题猜。
2. **自己侧是旧副本**（远端已交付同一工作的更完善版本）→ 全取 main 侧；自己的提交在 rebase 中变空自动丢弃是正常结果，不是丢失。
3. **融合两侧的适配性修改**（如远端改了 API 签名、自己的代码要跟着改）属于冲突解决的正经工作量，必须做，不算改动他人代码。
4. **冲突解决完必须重跑**：本切片相关测试 + 冲突文件的模块测试。没跑测试的冲突解决视为未完成，禁止进入 §7 合并前置检查。
5. **分支烂到无法 rebase**（冲突密集、历史混乱）：基于 origin/main 开新分支，cherry-pick 可保留的提交；旧分支在 PR 评论标注废弃留档，不删除。
6. **rebase 后测试挂**：先分清是适配遗漏还是 main 本身红——main 红 → 按 §7 坏 main 流程 revert 肇事合并；适配遗漏 → 修自己的适配。
7. 全程**不 force-push** 共享分支；自己名下的 feature 分支允许 `--force-with-lease` 覆盖自己的提交。

## 7. 自合并规则与审计

工人对自己的 PR 执行合并，**前置检查全部满足才允许点 merge**：

 a. 查重：开工前已做；合并前再确认无他人同 issue 的新 PR（标题 grep【#NNN】）
 b. rebase 到 origin/main 最新后无冲突
 c. 本地全量 `env -u ELECTRON_RUN_AS_NODE npm test` 通过
 d. PR 描述含验收证据（E2E 输出摘要、截图 sha256 前缀），图片链接符合 AGENTS.md 规则
 e. merge 后确认 `Closes #N` 自动关单生效，issue 无遗留未覆盖边界未记录

**不自合的高危变更**：签名/公证/发布产物、凭据存储与迁移、安全与授权语义——打 `blocked:user` 交产品所有者或其指定会话复核。

**坏 main 责任**：谁合并谁负责——发现 main 被自己合坏，立即 revert 恢复 main，修复另开 `priority:P0` issue。

**审计（调度 lane，每日）**：抽样当日 merge，检查证据完整性、是否 rebase 后合并、是否越范围；违规按第 10 节记录进日报。审计是追责手段，不是合并关卡。

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

## 12. 目标提示词模板

新会话入职模板独立维护于 [`agent-goal-templates.md`](agent-goal-templates.md)（browser/agent/ui/integrate/dispatcher 五类，替换 `<机器名>` 即用）。会话日常运行无需阅读模板文件。
