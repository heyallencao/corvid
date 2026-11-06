# 只读站点命令

## 当前合同

站点命令是外部 Agent 为重复的只读页面观察提出的声明式候选。Corvid 不接受命令脚本，也不根据页面内容生成可执行代码。当前 schema 只允许 `info` 与语义 `snapshot`（`page` 或 `viewport`）步骤；MCP schema 与主进程 store 都拒绝未知字段、未知步骤、脚本和动作参数。

命令生命周期：

1. Agent 在一个获授权的 Room 与受管 HTTP(S) Page 上提出候选。Corvid 从当前 Page 取得 origin；调用方不能指定或伪造来源。
2. `site_try` 在同一 Room、同一精确 origin 的显式 Page 上运行候选。成功试用只记录计数和时间，不保留页面内容。
3. 用户在 **设置 → Agent 与连接 → 站点命令** 查看名称、描述、来源、步骤与试用次数，并明确保留或删除。没有一次成功试用时不能保留。
4. MCP 的 `site_search` 只返回 retained 命令；`site_run` 只执行 retained 命令。每次调用都需要显式 `roomId`、`tabId`，主进程在每个步骤前后复核 Room 控制权、接管状态、执行风险、Page 所属 Room、管理标签和精确 origin。

`site_propose` 和 `site_try` 会写入候选/试用元数据，因此 MCP annotation 的 `readOnlyHint` 为 false、`destructiveHint` 与 `openWorldHint` 为 false。它们不会操作网页。`site_search` 和 `site_run` 是页面/命令只读操作，标注 `readOnlyHint: true`。Annotation 只是主机提示；安全边界由主进程白名单解释器和现有 Room/Page 检查强制执行。

## 隔离与持久化

命令绑定提出它的稳定 Room ID 与页面 origin，不在 Room、Profile 或网站间自动继承。跨 Room 使用必须重新提出、试用并由用户保留。命令不保存 cookie、凭据、页面正文或截图。当前存储允许最多 200 条命令，每条最多 8 个只读步骤；单次结果最大 32 KiB。

数据写入数据目录内的新 `site-commands.json` 文件，schema `version: 1`，以临时文件原子替换，POSIX 模式为 `0600`。Room 被删除后，命令仍以原 Room ID 隔离保存，用户可在设置列表删除；它不会因此授权给新 Room。未知或损坏 schema 会被拒绝，不自动重写。

## 明确限制

本切片让 Agent 显式提出候选，但 Corvid 尚未统计重复端点、自动推断操作序列或验证“重复三次”门槛。Agent 无法创建可以点击、填写、提交、导航、等待 selector、执行 JavaScript 或调用 CDP 的站点命令。登录、验证码、付款、站点写入、任意 locator、命令分享/导入、跨 Room 复用与自动升级均不在此合同内。后续扩展需单独定义可验证边界并维持用户审查、Room 隔离与主进程只读白名单。
