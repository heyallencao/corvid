# Corvid 项目协作约束

全局约束见 `/Users/allen/.agents/AGENTS.md`。多会话分工、认领、审查与合并规则见 `docs/execution/agent-protocol.md`；冲突时以本文为准。

## 产品红线

- 浏览器安全、用户控制权、页面上下文同意、数据隔离不可绕过。
- UI 与产品合同只用 Corvid 语义；runtime、SDK、IPC、selector 是实现细节，不暴露给用户。

## 文档

- 行为/范围变化同步对应文档：范围→`docs/architecture/` 与 `docs/execution/feature-board.md`；实现/接口→架构或 QA 文档；验证→`docs/reviews/verification-log.md`；手动检查→`docs/qa/`。
- 中文语境，事实与证据一致，记录未覆盖边界；不把计划写成已实现，不把定向测试写成全量验证。
- 对外合同（SDK/CLI、配置格式、持久化 schema、命令行为）变化同步 README、接口说明、迁移说明、测试索引。
- `docs/README.md` 是目录地图；不在 `docs/` 根目录新增材料。

## 验证与交付

- 用户行为变化先定可复现验收；优先隔离真实 Electron + 本地 fixture。报告写清环境、命令、结果、模型/OAuth 使用情况、限制。
- 每轮从代码、issue、运行态证据重新确认事实；可交付改动单独提交；可复现缺陷先开 issue；不碰用户已有未提交修改。

## Release

- `0.x.x` 只递增第三级，除非用户明确要求升更高位。
- Release 只基于已合并 main 的版本；说明写清安装要求、验证范围、未覆盖平台。
- 仓库保持私有，不得改可见性/协作者权限；未验证源码归档不得称安装器。

## Issue/PR 图片

- 用 `github.com/user-attachments/assets/...` 附件或仓库相对路径；禁 `/tmp/`、本机绝对路径、`file://`、易失分支 URL。
- 截图注明状态与窗口尺寸，遮蔽个人数据；截图不能代替复现步骤与验收条件。
