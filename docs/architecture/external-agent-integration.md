# 外部 Agent 集成（connect / Browser MCP / skill）

状态：P0 已实现（[执行计划](../execution/external-agent-integration-plan.md) P0 节）；桌面自动接入见下文「自动接入」（Issue #438）。本文是对外合同：桌面自动接入与 `corvid connect/disconnect/doctor` 的写入位置、撤销语义、Browser MCP 工具面与 `corvid-browser` skill 分发。

## 自动接入（Corvid 桌面默认行为）

安装 Corvid 桌面后，应用启动时检测本机已在使用的外部 Agent host（marker：`~/.claude.json` 或 `~/.claude`、`~/.codex`、`~/.dsh`；cursor 暂不自动接入，待运行态联测后放开），对检测到且尚未接入的 host 执行与 `corvid connect <host>`（无 `--token`）同一语义的接线：写入托管 MCP 注册条目、安装 skill、经桌面签发 **openRoomGrant** 授权客户端（初始授权范围为空，注册 ≠ 授权），收据记入同一份 `agent-connections.json`。行为合同：

- **总开关**：数据目录 `agent-auto-connect.json`（0600），`enabled` 默认 `true`；设置 →「Agent 与连接」→「外部 Agent 自动接入」可关闭。关闭只停止接入新检测的 host，已建立的接入不受影响。
- **注册 ≠ 授权**：自动签发客户端与 connect 签发语义一致（见下文 openRoomGrant 授权合同），访问用户空间仍走原生审批；自动接入相关 IPC 一律拒绝 API 调用，授权客户端仅可在 Corvid 界面管理。
- **冲突保护**：host 配置中已有非 Corvid 管理形状的 `corvid-browser` 条目（手工修改或外来工具写入）时，跳过该 host 并在设置中标记冲突（`CORVID_AUTO_CONNECT_CONFLICT`），绝不自动覆盖；可用 `corvid connect <host>` 在终端显式处理。
- **逐 host 失败隔离**：单个 host 配置损坏或写入失败只标记该 host（设置中显示原因并提供「重试接入」），不影响应用启动与其他 host。
- **启动自愈**：Corvid 更新/移动导致条目内 server 路径或 skill 内容过期时，启动用配置中的现有 token 重写条目与 skill，不轮换凭据。
- **断开**：设置中断开与 `corvid disconnect <host>` 同语义（配置条目/skill/签发凭据三清；凭据撤销失败时保留收据并报 `CORVID_AUTO_CONNECT_REVOKE_FAILED`）。
- **测试防护**：`CORVID_TEST_MODE=1` 下自动接入仅在显式 `CORVID_AGENT_AUTOCONNECT_TEST=1` 时运行；Electron 测试 launcher 统一沙箱 `HOME`（可用 `CORVID_TEST_HOME` 指定）。

实现：`desktop/agent-auto-connect.cjs`（服务）与 `desktop/agent-host-adapters.cjs`（CLI 共用的 host 适配器/收据读写）。打包态：`mcp/`、`sdk/`、`cli/`、`skills/` 与 MCP 依赖图（@modelcontextprotocol、zod、smol-toml、yaml）随 `asarUnpack` 解包，写入 host 配置的 server 路径指向 `app.asar.unpacked`，host 侧普通 Node 可直接加载。

## corvid connect

```
corvid connect <host> [--token <token>] [--yes]
```

- `host` ∈ `claude-code` / `codex` / `cursor` / `dsh`。
- 运行时先打印完整写入计划（每个配置文件的路径与将写入的条目、skill 安装路径），交互确认后才写盘；非交互环境必须显式 `--yes`，否则拒绝执行。
- **凭据签发**：不带 `--token` 时，connect 用本地管理员凭据（`control.json`）通过运行中的 Corvid 桌面调 `POST /agent-clients` 签发一个 **openRoomGrant** 授权客户端（初始授权范围为空），token 写入 host 配置 env；签发的 `clientId` 持久记录在数据目录 `agent-connections.json`。带 `--token` 时直接使用既有 scoped token，不签发、不撤销。
- connect 永不在 host 配置中写入管理员凭据（`control.json` 的 token 不会离开本机数据目录）。

### 写入位置（P0 实测基准）

| host | MCP 注册 | skill 安装 |
| --- | --- | --- |
| claude-code | `~/.claude.json` 顶层 `mcpServers["corvid-browser"]`（`type: stdio`） | `~/.claude/skills/corvid-browser/SKILL.md` |
| codex | `~/.codex/config.toml` 的 `[mcp_servers.corvid-browser]` 节 | `~/.codex/skills/corvid-browser/SKILL.md` |
| cursor | `~/.cursor/mcp.json` 的 `mcpServers["corvid-browser"]` | `~/.cursor/skills/corvid-browser/SKILL.md` |
| dsh | `~/.dsh/profiles/desktop/cordis.patch.yml` 追加一条 `{insert: [...]}` patch，插入 `@deepseek-ai/dsh-mcp-client`（stdio，`serverName: corvid-browser`） | `~/.dsh/skills/corvid-browser/SKILL.md` |

MCP 注册条目统一为：`command: node`、`args: [<Corvid 资源目录>/mcp/corvid.mjs]`（开发仓库为仓库路径；打包态为 `app.asar.unpacked/mcp/corvid.mjs`）、可选 `env.CORVID_AGENT_TOKEN`。

### 编辑安全规则

- 只新增/替换/删除 `corvid-browser` 这一个条目；写入前后对配置做整体数据比对，任何会触碰无关字段的编辑直接中止。
- 目标文件无法解析（坏 JSON/TOML/YAML）时拒绝写入；dsh patch 文件的用户注释与其他条目原样保留（`yaml` Document 往返）。
- codex 条目结构（command/args/env 的形状）与 connect 写入不一致时视为「已被手工修改」：connect 会要求替换确认，disconnect 仍会移除并在输出中标注漂移；仅轮换 token 值不算漂移。
- skill 文件与仓库源不一致时 disconnect 不删除，报告后留给用户处理。

## corvid disconnect

```
corvid disconnect <host>
```

移除该 host 的 MCP 注册条目与 skill 目录（仅当内容与 connect 写入的一致），并按 `agent-connections.json` 收据撤销 connect 自动签发的凭据；`--token` 方式接入的凭据不属于 connect 管理，不撤销（输出中提示）。重连同一 host 会轮换签发凭据（旧凭据先撤销）。输出逐项报告；未接入时优雅返回。重复执行安全。

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
- 复合工具（P1.3）：`page_navigate_and_snapshot`（导航+等待终态+快照一次调用）、`page_act_and_snapshot`（单击/填/按键/悬停/下拉之一 + 等待文档态或 selector + 快照一次调用）；与单步工具同一套 Room/Tab 闸门，是 browser_script 未启用时的默认往返压缩主力
- 对话框与事件等待（P1.2a）：`page_get_dialog`（读取挂起的 alert/confirm/prompt/beforeunload）、`page_handle_dialog`（接受/取消应答，prompt 支持 promptText）、`page_act_and_wait`（单动作 + popup/download/dialog 事件等待一次调用；事件等待先于动作 arm，与 SDK「先激活 opener 再可信点击」语义一致；popup 返回新受管页，download 返回临时目录保存收据，dialog 在动作后台发射时轮询到即返回）
- 文件选择（P1.2b，Issue #388）：Browser MCP `page_upload`、SDK `Page.setInputFiles()` 和 `waitForFileChooser()` / `FileChooser.setFiles()` 的非空文件选择共用主进程逐次审批。符号链接在审批前拒绝。卡片绑定外部客户端、Room、Profile、Page、窗口和当时 URL；只向 renderer 发送即时父目录名与文件名，不发送绝对路径。拒绝、超时、MCP 取消/断连、客户端撤销、Room 控制权转移/关闭、页面变化或窗口关闭时失败关闭；批准后、调用 CDP 文件选择器前再次验证请求信号、客户端授权、页面上下文和文件身份。chooser 只接受顶层或与顶层同源的 frame，跨源/opaque-origin chooser 在审批卡出现前拒绝并取消；raw `DOM.setFileInputFiles` 与 `Target.*` 嵌套 CDP 通道被禁止。路径身份在 setter 前复核，但 `stat` 与 Chromium 打开文件不是原子操作，仍有狭窄的检查到打开竞态。待审批状态只存在主进程内存，应用重启后不会恢复。
- 模型主动确认（P1.5，Issue #429）：MCP `confirm_action` 让模型向用户描述一个高影响动作并等待决定，返回 `{status, reason}`。它不执行网站动作，也不创建可供后续操作复用的授权凭证；Corvid 不强制验证后续动作是否遵守结果。外部 MCP 请求没有 Corvid Agent 会话 ID，因此由 Corvid 桌面显示审批对话框，而非挂到某条内置对话流。
- Room 生命周期：`room_open`（按名字或 ID 复用/创建）、`room_claim`（请求用户批准）、`room_yield`（交还用户）、`room_finish`（收尾分报：closed / kept / preserved）
- 批量执行（可选）：`browser_script`——一次调用对显式 Room 提交一段 JS，绑定实际 SDK Room/Client/Page 对象（含 `evaluate` 和 `Page.cdp()`），返回收据（result/logs/Room 终态 tabs/durationMs）。`Page.cdp()` 的 `DOM.setFileInputFiles` 与 `Target.*` 会被控制 API 拒绝，其他 CDP 方法可转发给页面调试器。仅在 connect 时显式启用（`--browser-script` 或交互确认，写入 host 配置 `CORVID_BROWSER_SCRIPT=1`）后注册；脚本在子进程中以本地 Node 权限运行、**非沙箱**，可访问该 OS 用户有权访问的本机文件与网络，包括读取 `control.json` 管理员凭据并以管理员身份请求 Corvid 控制 API，绕过 scoped Room 检查及逐次文件选择审批。`timeoutMs`（默认 30s，上限 120s）超时强杀，Room 与页面状态不受破坏；收据总量超 32 KiB 截断。决策阶梯级 1，优先于逐步工具使用（skill 文档版本 0.2.0-p3）

授权与程序闸门与 SDK/CLI/内置 Agent 三入口一致：scoped token 按 Room 授权过滤 Profile/Room 列表；显式 `roomId`/`tabId`；用户控制中的 Room 动作返回 `CORVID_CONTROL_LOST`；执行风险未复核时拒绝。

**外部 Agent 可见性（P1.4）**：外部客户端在其空间内的动作会把客户端名留在空间上（`agentClientName`，随会话状态持久化）；桌面标签栏为 Agent 空间渲染命名分组徽章（`Agent · 客户端名`），受管页（有 label 的页）在标签上展示页名 chip 与 `data-agent-managed` 标记；`room_finish` 的收尾分报（closed/kept/preserved/agent）进入 shell 状态条展示，Agent 重新接管该空间时清除。

**openRoomGrant 授权合同**：connect 自动签发的客户端初始授权范围为空；经 `room_open` **自建**的 Room 自动并入其授权范围（持久化在数据目录 `agent-clients.json`，设置中可随时撤销整个客户端）。授权范围外已存在的同名/同 ID Room 一律返回 `CORVID_FORBIDDEN`，**不会**创建重名 Room——避免制造重名空间导致后续按名 openRoom 产生歧义。用户在设置中手工创建的授权客户端同样适用「自建 Room 自动并入」；显式勾选的空间授予仍然有效。

**Profile（浏览身份）授权面**（Issue #418 拍板）：agent 可用的浏览身份 = 授权客户端被勾选空间覆盖的 Profile（多选）∪ `default`；`room_open` 传入范围外的 `profileId` 返回 `CORVID_FORBIDDEN`。多账号并行自动化 = 在设置中给同一授权客户端勾选多个 Profile 的空间，agent 即可在多个身份中并行自建 Room，Cookie 按各 Profile 语义隔离。不做无界任意身份访问：agent 能用哪些身份由用户通过授权显式决定；自动签发的凭据默认只见 `default`（即用户主浏览身份，agent 在其中的页面共享该 Profile 的登录态——与内置 Corvid Agent 同权）。

## corvid-browser skill

`skills/corvid-browser/SKILL.md` 是随 connect 分发的 Agent 使用说明，内容：安全边界（执行环境非沙箱、托管即授权、高危动作模型自主确认）、决策阶梯（按工具面版本分档，P0 仅逐步工具级可用，`browser_script` 随 P1、`site_run` 随 P2 启用并升级文档版本）、Room 生命周期（openRoom→claim→操作→yieldControl/finish）、快照策略（语义快照 + ref 优先）、操作后检查、错误恢复（按 `CORVID_*` 错误码）与收尾分报清单。工具面变化时同步升级该文档并在 PR 中注明版本。

## 已知边界

- dsh：写入与撤销已按 dsh 真实 boot 组合管线（`loadProfileDirectory` + `composeEntries`）离线验证（零告警）；2026-11-14 运行态补验（Issue #438/#415 遗留补账）：沙箱 HOME 内克隆真实 `~/.dsh` 配置、经同一适配器 patch 插入后随 dsh 桌面真实启动，约 3 秒内观察到 `mcp/corvid.mjs` 子进程 spawn——启动加载链路已验证；host 内工具调用与鉴权语义仍未覆盖（需真实 dsh 会话驱动）。skill 发现路径 `~/.dsh/skills` 取自 dsh 源码 `skill-filesystem` 的 user-dsh root。
- doctor 的 token 校验依赖控制服务在线；Corvid 未运行时只报告不可达，不判定 token 失效。
- Windows 平台的 host 配置路径未验证（P0 仅在 macOS 实测）。
