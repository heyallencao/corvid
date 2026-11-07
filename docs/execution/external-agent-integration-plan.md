# 外部 Agent 集成执行计划

状态：**范围计划；部分 P1 已落地**。截至 2026-11-08，P0、P1.1、P1.2a、P1.3、P1.4 已合入；P1.2b（#388）与 P1.5（#429）在当前 worktree 作为本地候选，待用户安全复核。本文保留范围与验收基线；验收结果记入[验证记录](../reviews/verification-log.md)。调研依据与证据边界见文末。

## 目标与定位

让 Claude Code、Codex、Cursor、DeepSeek Harness（dsh）等第三方 agent 通过一个 MCP server 驱动 Corvid 浏览器完成网页自动化。设计目标：

- **冷路径**（首次遇到的站点）：接近 ego lite 的往返经济学——批量脚本执行，单个任务 2-3 次 LLM 往返。
- **热路径**（复访站点）：达到 Kaze 的沉淀复利——一次调用命中已沉淀的站点能力。
- **全程可审计**：离散工具调用 + 程序闸门 + 收据，用户可见、可撤销。

## 竞品参照结论（2026-11-07 一手调研）

| 参照 | 采用什么 | 不采用什么 |
| --- | --- | --- |
| ego lite（harness v2.2.0） | 代码式批量执行的往返经济学；面向 agent 的 skill 文档纪律；TaskSpace 持久会话 ergonomics | 裸 `page.cdp()` 逃生舱；无逐动作审计的整段执行 |
| Kaze（本机 0.27.0 asar + 0.27.3 release） | MCP 工具调用主轴；`confirm_action` 模型自主确认；读接口沉淀（`tab.fetchJson` 探端点 → site command）；外部 host 自动注册体验 | 提示词层的安全约束（Corvid 用程序合同替代） |
| Dia | 安全模型声明（会话初始无权限、密码字段不可见、拦截 LLM 生成 URL）——作长期对照，不作近期需求 | 商业化订阅面 |

关键判断：观测模态各家一致（语义快照 + locator，截屏只兜底 canvas 类页面）；差异在**探索循环形状**（ego 批量 vs Kaze 逐工具）与**沉淀内容**（Kaze 沉淀读接口，ego 路线图沉淀 UI 步骤手册）。Corvid 三层全取：批量执行 + 接口沉淀 + 步骤沉淀。

## 架构：单 MCP server，三级工具，一条决策阶梯

```
agent 接到任务
  ├─ 1. sites_search ──命中──→ site_run（热路径，1 次往返）
  │        │未命中
  │        ▼
  ├─ 2. browser_script（冷路径，2-3 次往返，批量 JS，包 SDK 运行器）
  │        │解决不了（沙箱限制/反复失败）
  │        ▼
  └─ 3. page_navigate / click / fill …（逐步结构化工具，兜底）
           └─ 成功序列回流沉淀（接口与步骤两型都产出）
```

- 阶梯优先级写入 `corvid-browser` SKILL.md（模型行为由文档约束，ego 已验证有效）。
- 现有三入口能力不一致（SDK > MCP > 内置 Agent）的问题由 P1 统一：结构化 MCP 工具面补齐到 SDK 平价（不注册 `evaluate`/通用 raw CDP 工具）；`browser_script` 是独立的高权限入口，会拿到实际 SDK 对象，包括 `Page.cdp()`，内置 Agent 的动作面扩展不在本计划范围。

## 与现行合同的关系

- **托管即授权**（AGENTS.md 红线，#407 已合入）：把空间交给 Agent 即视为授权读取其绑定页面上下文，无逐条同意流程。外部 agent 入口沿用同一合同：Room 级授权、程序闸门校验（Room 归属、控制权状态、managed tab、执行风险态）。
- **模型主动确认与系统文件授权分层**：模型可用 `confirm_action` 对付款、发送、删除等高影响动作主动请求用户决定；它只返回决定，不执行动作，也不签发可复用凭证。选择本机文件属于独立安全边界，必须由 Corvid 对每次文件选择逐次审批，不能由 Room 的托管授权或 `confirm_action` 决定替代。
- **结构化工具边界**：Browser MCP 不注册通用 raw CDP 工具，且静默接管仍禁止。SDK `Page.cdp()` 对 `DOM.setFileInputFiles` 与 `Target.*` 返回拒绝，但其他 CDP 方法会转发到页面调试器；`browser_script` 收到实际 SDK Page，因此可调用这些方法。它是显式启用的本地 Node 执行能力，不是沙箱；脚本可读取 `control.json` 管理员凭据并以管理员身份请求 Corvid 控制 API，绕过 scoped Room 检查与逐次文件选择审批。

## 分阶段交付

### P0 接入层（无前置依赖，可立即开工）

| 项 | 交付物 | 验收 |
| --- | --- | --- |
| 0.1 | `corvid connect <host>`：支持 claude-code / codex / cursor / dsh（dsh 配置路径实施时探明）；运行前列出将写入的配置文件与条目，显式同意后写入；`corvid disconnect` 可撤销还原；`corvid doctor` 诊断连通性 | 隔离 fixture 对每种 host 真实写入/撤销的 E2E；断言不触碰无关字段 |
| 0.2 | `corvid-browser` SKILL.md：决策阶梯（按能力可用性分档：P0 期仅 browser_script 与逐步工具两级，`site_run` 级随 P2 启用并升级文档版本）、Room 生命周期（openRoom→claim→操作→yieldControl/finish）、快照策略、收尾分报清单（closed/released/retained）、错误恢复规则 | 真实 Claude Code 与 Codex 各跑一轮**当前工具面可完成范围**的真实任务，全程无人工纠偏 |
| 0.3 | skill 分发：`connect` 时随 MCP 注册把 skill 装入各 agent 发现路径（`.claude/skills` 等），卸载清除 | connect/disconnect 后目录状态断言 |

### P1 能力面（冷路径提速 + 补齐短板）

| 项 | 交付物 | 验收 |
| --- | --- | --- |
| 1.1 | `browser_script` MCP 工具：包装现有 SDK 运行器（与 `cli/corvid.mjs run` 同引擎）；agent 提交 JS → 入口检查指定 Room 授权 → 返回收据 + 终态快照；超时/取消/输出上限；脚本接收实际 SDK Room/Client/Page 对象，含 `evaluate` 与 `Page.cdp()`（`DOM.setFileInputFiles`、`Target.*` 被控制 API 拒绝，其他 CDP 方法可用）；本地 Node 权限运行，**非沙箱**，可读取 `control.json` 管理员凭据并绕过 scoped API/逐次上传审批，此限制须写入 skill 文档；Room 级授权开关（默认关，connect 时显式询问） | 隔离 Electron E2E：批量任务 1 次调用完成；未授权 Room 拒绝；超时取消后页面状态一致 |
| 1.2a | MCP 工具面补齐：download 等待、dialog、popup（Issue #425） | 对应定向 E2E，对齐 SDK 既有用例 |
| 1.2b | 文件选择逐次授权（Issue #388）：Browser MCP `page_upload` 与 SDK `setInputFiles` / chooser `setFiles` 共用主进程审批；符号链接在审批前拒绝；raw CDP 文件 setter 与 `Target.*` 嵌套通道禁止；拒绝、超时、取消/断连、撤权、页面/Room 变化失败关闭；逐次复核文件身份，跨源/opaque chooser 在审批卡前拒绝；路径身份复核与 Chromium 打开文件不是原子操作，保留狭窄检查到打开竞态 | 隔离真实 Electron：批准/拒绝、两条上传路径、页面不发生提前选择、MCP 单次取消、同路径替换后 `CORVID_STALE_REFERENCE`、跨源 chooser 无审批卡且不设置文件、审批后 CDP setter 前的二次校验、路径不泄漏与 raw CDP 拒绝 |
| 1.3 | 复合工具：`page_navigate_and_snapshot`、带等待的动作序列，压缩观测往返 | token 消耗对比基线记入验证日志 |
| 1.4 | 外部 agent 可见性：外部 agent 驱动的标签进命名分组 + 状态标记（#348 范围）；收尾分报 | 桌面 E2E 断言标记与分报 |
| 1.5 | 外部 MCP `confirm_action`（Issue #429）：模型为一个高影响动作提交摘要与影响，工具调用等待 Corvid 桌面审批并返回决定；它不执行动作、不签发可复用授权，Corvid 也不强制验证后续动作。外部 MCP 没有 Corvid 会话 ID，因此审批在桌面对话框中展示，不挂入内置 Agent 对话流 | 隔离真实 Electron 覆盖批准、拒绝、超时、并发排队、单次 MCP 取消、页面导航、Room 接管、客户端撤权，并断言批准本身不执行页面动作 |

### P2 沉淀层（热路径复利）

站点知识按 **`站点 + 意图`** 键存储，同一意图下双型条目并存：

- **接口型**（读）：method、path、参数 schema、返回 schema、`access: read`。执行为一次调用，不碰 UI。验证全自动（真实参数试用 + schema 断言）。
- **经验型**（读写均可）：UI 序列（locator + 等待 + 终态语义断言）。验证需真实回放 + **激活前用户过目**。
- **写操作边界**：写型意图只沉淀经验型，永不沉淀为自动 API 调用；回放中写步骤仍走模型自主 confirm。

消费阶梯为 runtime 合同（非提示词约定）：`site_run` 内置降级——接口型命中即用 → 断言失败自动降级经验型并标记待修复 → 均未命中则冷探索回流双份沉淀。

| 项 | 交付物 | 验收 |
| --- | --- | --- |
| 2.1 | 站点知识存储：per Profile + origin，双型条目，版本化，可列出/删除 | 存储层单测 + 跨重启持久 E2E |
| 2.2 | 固化流水线：成功序列 → 固化候选 → 试用/回放验证 → 激活前展示（命令内容与端点）→ 激活；用户拒绝不落库 | 全链 E2E 含失败路径 |
| 2.3 | `sites_search` / `site_run` 工具：检索 + 执行 + 内置降级阶梯；接口型只读白名单程序校验 | 写操作形态的候选被程序拒绝的 E2E |
| 2.4 | 触发与修复：一期 agent/用户显式「保存这个流程」，二期同端点 ≥N 次自动提议（阈值待决策）；「待修复」条目的重探/重走由后续任务的 recon 步顺带执行，不单设修复任务 | 显式路径先验收；降级产生的待修复标记在下次复访时被消费 |

### P3 打磨（P2 验证后）

- 真实站点基准集（15-30 任务）作回归与对外数据，记录模型/环境/限制。
- 可选逃生舱（`tab.cdp` 门控通道）：暂不做，待 1.1 沉淀出真实需求再决策。

## 安全不变量

1. 托管即授权、Room/Profile/Page 隔离、程序闸门三入口共用，不因新入口放宽。
2. 确认判断权在模型（confirm 机制），Corvid 只做程序闸门，不做逐动作弹卡。
3. 接口型沉淀只读约束在程序层白名单，不依赖提示词自觉。
4. 写第三方应用配置文件必须显式同意 + 可撤销，不做静默注册。
5. 截屏坐标操作不进沉淀层（分辨率/语言敏感，固化无复用价值）。

## 验证纪律

- 每切片跑定向单测/定向 E2E；全量 `npm test` 仅合并门禁运行一次；不新增 CI。
- 真实 host 联测安排在 0.2/0.3 与 P2 收尾各一轮，记录模型与环境。
- 不把定向测试写成全量验证；文档同步本文、feature-board 与验证日志。

## 待拍板决策点

| 决策 | 建议 |
| --- | --- |
| `browser_script` Room 级开关默认值 | 默认关，connect 时显式询问 |
| 站点知识存储隔离域 | per Profile + origin；跨 Room 共享另设开关 |
| 自动沉淀触发阈值 | 二期再定；一期显式触发 |
| 激活展示位置 | 对话流内卡片（与 #407 后的 composer/会话流一致） |

## 与现有 issue 的关系

- #341（site command）：issue 与实现 PR #361 均已关闭未合并；分支 `agent/issue-341-readonly-site-commands` 保留一版实现（含生命周期合同与验证记录）。P2 开工前先复核该实现与本计划双型沉淀及「托管即授权」新合同的相容性，决定重放改造或重写；重开 issue 或新单引用其讨论。
- #350（外部 Agent 工具面）、#388（上传逐次授权）、#348（运行中任务可见标记）、#429（外部 MCP confirm_action）分别对应 1.2/1.2b/1.4/1.5；#346 的内置 Agent 站点操作面不属于本次外部 MCP 确认工具范围。

## 调研证据边界

2026-11-07 一手取证：ego-browser skill 文档 v2.2.0 全文与本机 0.6.2.9 包结构、`import list`；Kaze 本机 0.27.0 asar（sha256 `7e157f79…`）REA 分析（Evidence `ev_6050d2c0…`）、`out/main/agent.js` 系统提示词与 22 个 `defineTool` 工具面、0.27.3 release notes；Dia 官网 changelog/security/plans 与 GitHub 组织检索。未取得：ego/Kaze 运行窗口本轮 REA 观察（window-mismatch 未解决）；Dia 运行态实测；Kaze site command 运行时行为（静态文本不证明可达）。竞品结论以公开文档与打包内文本为限，不构成对其运行时行为的断言。
