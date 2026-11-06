# Issue #377/#378/#381 Agent 工作台布局重构 — 视觉检查

日期：2026-11-06
环境：隔离 Electron（`CORVID_TEST_MODE=1`、独立 `CORVID_DATA_DIR`、本地 fixture 页），worktree `agent-workbench-redesign`，macOS arm64。

## 检查范围

Agent 工作台右侧面板：composer（页面绑定/输入/模型簇/同意发送）、任务卡（状态行/操作行/对话流/消息队列）、工具栏/历史/欢迎态；浅色与深色、zh-CN 与 en、1280×850 与 704×420。

## 证据

`docs/qa/screenshots/issue-377/`（隔离 Electron 实拍，1280×850 为 2x 位图）：

| 截图 | 状态 | 检查点 |
| --- | --- | --- |
| workbench-welcome-zh-1280x850.png | 欢迎空态，未连接 | 胶囊页面绑定+连接按钮、模型簇一行、无任务卡 |
| workbench-preview-consent-zh-1280x850.png | 已填任务+已展开预览 | 代码预览卡、同意+发送同行、focus-within accent 边框 |
| workbench-send-row-zh-1280x850.png | 同意勾选后 | 发送行布局、禁用态解除 |
| workbench-task-zh-1280x850.png | 任务完成+队列 1 条 | 状态行/操作行分离、队列一体表面、事件胶囊 |
| workbench-task-en-1280x850.png | 同上（en） | 长文案不破版 |
| workbench-task-dark-zh-1280x850.png | 深色 | 深色表面层级、胶囊/按钮对比度 |
| workbench-task-zh-704x420.png | 窄窗 zh | composer 折行、操作行换行 |
| workbench-task-en-704x420.png | 窄窗 en | 同上 |

## 结论

- composer 主次分明：页面绑定胶囊 < 输入区 < 模型/连接/发送；未连接态认证收为单行，不再压制输入区。
- 任务卡状态行与操作行分离，操作为 ghost 胶囊，视觉权重低于状态与对话内容。
- 深色模式表面层级正确（composer 卡 rgb(32,37,47)，prompt 融入卡片）。
- 短高/窄窗断点无溢出（typography-e2e 断言 + 截图确认）。

## 未覆盖

- 真实模型长流式输出的气泡阅读体验（见 issue #382）。
- 队列 ≥3 条的密度（见 issue #382）。
- 屏幕阅读器/完整键盘之外的辅助技术验收（面板级 aria 合同未改，沿用既有验收）。
