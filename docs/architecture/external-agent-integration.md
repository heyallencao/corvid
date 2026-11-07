# 外部 Agent 集成（connect / Browser MCP / skill）

状态：P0 已实现（[执行计划](../execution/external-agent-integration-plan.md) P0 节）。本文是对外合同：`corvid connect/disconnect/doctor` 的写入位置、撤销语义、Browser MCP 工具面与 `corvid-browser` skill 分发。

## corvid connect

```
corvid connect <host> [--token <token>] [--yes]
```

- `host` ∈ `claude-code` / `codex` / `cursor` / `dsh`。
- 运行时先打印完整写入计划（每个配置文件的路径与将写入的条目、skill 安装路径），交互确认后才写盘；非交互环境必须显式 `--yes`，否则拒绝执行。
- `--token` 提供 Corvid 设置中签发的授权客户端（scoped token）。提供时 `CORVID_AGENT_TOKEN` 写入 host 配置的 env；不提供时只注册命令，token 从 MCP 进程的环境变量读取，缺失时 MCP 工具调用返回 `CORVID_UNAUTHORIZED`。
- connect 永不读取或写入 Corvid 的管理员凭据（`control.json`）；scoped token 由用户在设置中签发。

### 写入位置（P0 实测基准）

| host | MCP 注册 | skill 安装 |
| --- | --- | --- |
| claude-code | `~/.claude.json` 顶层 `mcpServers["corvid-browser"]`（`type: stdio`） | `~/.claude/skills/corvid-browser/SKILL.md` |
| codex | `~/.codex/config.toml` 的 `[mcp_servers.corvid-browser]` 节 | `~/.codex/skills/corvid-browser/SKILL.md` |
| cursor | `~/.cursor/mcp.json` 的 `mcpServers["corvid-browser"]` | `~/.cursor/skills/corvid-browser/SKILL.md` |
| dsh | `~/.dsh/profiles/desktop/cordis.patch.yml` 追加一条 `{insert: [...]}` patch，插入 `@deepseek-ai/dsh-mcp-client`（stdio，`serverName: corvid-browser`） | `~/.dsh/skills/corvid-browser/SKILL.md` |

MCP 注册条目统一为：`command: node`、`args: [<仓库>/mcp/corvid.mjs]`、可选 `env.CORVID_AGENT_TOKEN`。

### 编辑安全规则

- 只新增/替换/删除 `corvid-browser` 这一个条目；写入前后对配置做整体数据比对，任何会触碰无关字段的编辑直接中止。
- 目标文件无法解析（坏 JSON/TOML/YAML）时拒绝写入；dsh patch 文件的用户注释与其他条目原样保留（`yaml` Document 往返）。
- codex 条目结构（command/args/env 的形状）与 connect 写入不一致时视为「已被手工修改」：connect 会要求替换确认，disconnect 仍会移除并在输出中标注漂移；仅轮换 token 值不算漂移。
- skill 文件与仓库源不一致时 disconnect 不删除，报告后留给用户处理。

## corvid disconnect

```
corvid disconnect <host>
```

移除该 host 的 MCP 注册条目与 skill 目录（仅当内容与 connect 写入的一致）。输出逐项报告；未接入时优雅返回。重复执行安全。

## corvid doctor

```
corvid doctor [host]
```

- 全局：Corvid 控制服务可达性（`control.json` 端点探活）、`CORVID_AGENT_TOKEN`（环境变量）有效性（对 `/rooms` 的真实鉴权请求）。
- 每种 host：MCP 注册状态（含条目与当前版本是否一致）、MCP 进程 spawn + JSON-RPC `initialize` 握手、skill 安装状态。握手成功只证明命令可启动；鉴权有效性由全局 token 检查覆盖。
- 任一检查未通过时退出码为 1，并给出修复提示。

## Browser MCP 工具面（P0）

server 名 `corvid-browser`（`mcp/corvid.mjs`，stdio）。工具分只读（`readOnlyHint`）与动作（`destructiveHint`）两类：

- 发现：`list_profiles`、`list_rooms`、`list_tabs`
- 读页：`page_info`、`page_snapshot`、`page_screenshot`（视口 PNG image content，≤8 MiB）、`page_wait_for_url`、`page_wait_for_load`、`page_wait_for_selector`
- 页面动作：`page_navigate`（限无凭据 HTTP(S)）、`page_new`、`page_close`、`page_back`、`page_forward`、`page_reload`、`page_click`、`page_hover`、`page_scroll`（有界）、`page_fill`、`page_press`、`page_select_option`
- Room 生命周期：`room_open`（按名字或 ID 复用/创建）、`room_claim`（请求用户批准）、`room_yield`（交还用户）、`room_finish`（收尾分报：closed / kept / preserved）

授权与程序闸门与 SDK/CLI/内置 Agent 三入口一致：scoped token 按 Room 授权过滤 Profile/Room 列表；显式 `roomId`/`tabId`；用户控制中的 Room 动作返回 `CORVID_CONTROL_LOST`；执行风险未复核时拒绝。

**授权范围的扩展合同**：授权客户端经 `room_open` 创建的 Room 自动并入该客户端的授权范围（与「托管即授权」一致）；复用匹配仍只在其授权范围内进行，授权范围外的同名 Room 不会被复用（会新建自己的 Room）。该自动并入会持久化在数据目录的 `agent-clients.json`，用户在设置中可随时撤销整个客户端。

## corvid-browser skill

`skills/corvid-browser/SKILL.md` 是随 connect 分发的 Agent 使用说明，内容：安全边界（执行环境非沙箱、托管即授权、高危动作模型自主确认）、决策阶梯（按工具面版本分档，P0 仅逐步工具级可用，`browser_script` 随 P1、`site_run` 随 P2 启用并升级文档版本）、Room 生命周期（openRoom→claim→操作→yieldControl/finish）、快照策略（语义快照 + ref 优先）、操作后检查、错误恢复（按 `CORVID_*` 错误码）与收尾分报清单。工具面变化时同步升级该文档并在 PR 中注明版本。

## 已知边界

- dsh：写入与撤销已按 dsh 真实 boot 组合管线（`loadProfileDirectory` + `composeEntries`）离线验证（零告警）；但 dsh 桌面端完整启动加载 MCP 插件的运行态行为未在本机验证（mcp-client 插件不在 dsh 桌面默认组合内，需 patch 插入后随启动验证）。skill 发现路径 `~/.dsh/skills` 取自 dsh 源码 `skill-filesystem` 的 user-dsh root。
- doctor 的 token 校验依赖控制服务在线；Corvid 未运行时只报告不可达，不判定 token 失效。
- Windows 平台的 host 配置路径未验证（P0 仅在 macOS 实测）。
