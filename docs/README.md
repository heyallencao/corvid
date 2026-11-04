# Corvid 文档地图

本目录是 Corvid 的受管理文档区域。规划、实现状态和验证证据分开记录：功能只有在对应端到端验收通过后才能标为已验证，且必须附可复现命令、环境和结果。

## 目录

- `architecture/`：系统边界、架构设计与关键决策。入口：[系统设计](architecture/overview.md)、[统一桌面体验设计](architecture/ui-experience.md)、[界面本地化架构](architecture/localization.md)、[桌面打包与启动边界](architecture/distribution.md)。
- `execution/`：执行任务板、任务优先级和验收合同。入口：[执行任务板](execution/feature-board.md)；当前切片：[Issue #162 Corvid 原生浏览器菜单](execution/issue-162-application-menu.md)、[Issue #174 浏览身份删除](execution/issue-174-profile-deletion.md)、[Issue #244 GitHub 截图证据治理](execution/issue-244-github-screenshot-evidence.md)。
- `reviews/`：验证记录、质量门禁和评审证据。入口：[验证记录](reviews/verification-log.md)。
- `qa/`：端到端测试索引、浏览器/桌面 QA 记录和手动验证记录。入口：[测试索引](qa/e2e-suites.md)，另有 [桌面 UI 视觉检查记录](qa/ui-visual-check.md)、[Issue #211 对话框提交悬停验收](qa/issue-211-submit-hover.md)、[Issue #279 Chrome 导入对话框布局验收](qa/issue-279-chrome-import-layout.md) 与 [PR 截图链接检查说明](qa/pr-description-images.md)。
- `records/`：ADR、变更记录、迁移说明和交接记录。入口：[重构交接记录](records/rebrand-handoff.md)。
- `research/`：技术调研与上游笔记（仅自有产品相关的调研，不存放参考产品的逆向证据）。

## 约定

- 规划类文档使用中文；代码标识符、命令、路径和协议字段保留原文。
- GitHub Issue 与 Pull Request 的标题、正文、评论、评审意见和状态更新全部使用中文；必要的代码符号、命令、路径、API 名称及协议字段保留原文。
- 每份文档只放在有明确用途的子目录，不在本目录直接堆放文件。
- 长期计划必须指向执行任务板；战略或范围变化时同步更新任务板。
- 验证记录必须写清"测了什么、没测什么、用什么环境、怎么复现"。
