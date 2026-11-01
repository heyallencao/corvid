# 重构交接记录：go-lite → Corvid

日期：2026-11-01
范围：品牌与概念重构、工程底座改造（第一块）；后续 Agent API 合同与 Snapshot v2 另行记录。

## 决策

| 项目 | 决定 |
| --- | --- |
| 产品名 | Corvid（工作代号，后续可替换） |
| 核心概念 | Room（原 Space）；同一 Profile 下的工作区与控制权边界 |
| 控制权 API | Agent 交还用户 = `yieldControl`；用户控制后取回 = `resumeControl`；等待 = `waitForControl` |
| Room API | 创建/恢复 = `openRoom`；列表 = `listRooms`；用户批准认领 = `claimRoom`；恢复已交还 = `resumeRoom` |
| CLI | `node cli/corvid.mjs run < script.mjs`、`node cli/corvid.mjs help` |
| 环境变量 | `CORVID_DATA_DIR`、`CORVID_TEST_MODE`、`CORVID_PORT`、`CORVID_TEST_DOWNLOAD_DIR` |
| 数据目录 | `~/.corvid`（本机此前不存在旧数据目录，无需迁移用户数据） |
| 数据文件 | `rooms.json`（原 `spaces.json`，schemaVersion=1）、`library.json`（schemaVersion=1）、`profiles.json`、`control.json` |
| 文档 | 删除参考产品的调研证据与合同对照文档；文档改为自有产品语言 |

## 代码改动

- 全仓库改名：包名 `corvid`、CLI 入口 `cli/corvid.mjs`、窗口标题、UI 文案、`Room` 概念与 `p1` 页面标签语义、测试目录前缀。
- API 与路由：`/rooms`、`/rooms/open`、`/rooms/:id/{yieldControl,resumeControl,claim,adopt,release,finish,activate}`；内部动作名同步为 `yieldControl` / `resumeControl`。
- 状态字段：`activeRoomId`、`roomId`、`yielded`、`userResumePending`。
- 数据 schema：`rooms.json`、`library.json` 增加 `schemaVersion: 1`；读取缺失版本的旧文件视作 v1 兼容；未知版本拒绝加载并保留原文件。
- 旧数据迁移：启动时若只有 `spaces.json` 而无 `rooms.json`，自动转换为 `rooms.json`（原文件保留）；`~/.go-lite` 目录不会自动搬迁。
- 文档：新增 `docs/architecture/overview.md`、`docs/records/rebrand-handoff.md`；删除 `docs/research/` 下参考产品证据与合同对照；任务板、QA、验证记录改由文档负责人重写。

## 验证

- 2026-11-01 重构后执行 `npm test`：24 条命令、26 项真实 Electron 测试全部通过（本机 macOS、Electron 45.2.1、隔离临时数据目录）。
- 首次运行发现 CLI 命令名未同步（断言 `Usage: corvid run < script.mjs`），修正后重新全量通过。
- 重构后未修改任何原有测试断言范围；所有断言随命名同步更新。

## 风险与遗留

- **仓库此前没有 commit**：本次重构完成后才做首次提交，因此没有"重构前"的 git 历史；回滚依赖重构前的 tarball 备份（`/tmp/corvid-baseline-20261101-174251.tar.gz`，仅本机临时保留）。
- 项目目录仍叫 `go-lite`；目录改名需要切换工作区后另行执行。
- 单凭据、无按 Agent 身份隔离；跨源 iframe / closed Shadow DOM 不支持；真实网站、Windows、打包分发均未验证。
- 下一步：Agent API 合同（keyboard、焦点、事件、错误码、CDP 逃生口）与 Snapshot v2。
