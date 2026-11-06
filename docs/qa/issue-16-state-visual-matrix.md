# Issue #16 工作台状态视觉矩阵（B2）

## 范围与环境

在 macOS arm64、Node.js v24.22.1、Electron 45.2.1 的真实 Electron 工作台中，用隔离 `CORVID_DATA_DIR`、本地 HTTP 页面夹具与确定性 Agent fixture 检查 running、waiting_for_user、completed、failed、interrupted（等待检查）及 Room 控制权交接状态。未连接真实 Provider、模型或 OAuth。窗口外框为 1280×850 CSS px。

## 直接观察与合同

- E2E 检查状态标签的中英文文案、`role=status`、对应 CSS 语义表面/文字 token；失败态仍使用 `role=alert`，Room 所有权以独立 `pi-task-control-state` 状态播报。
- interrupted 显示中性“等待检查 / Waiting for review”，保留任务停止后最终页面操作结果可能需要检查的说明；控制权交接以 warning 表面明确显示“用户控制中 / User in control”。两者语义不同，前者表示任务待复核，后者表示 Room 正由用户控制。
- 中文/英文截图：
  - completed：[中文](screenshots/issue-16-state-matrix/issue-16-state-completed-zh-CN-1280x850.png) `7d4faad30b9ed59c88c69f51380913496e16c5c228d3bbd706da062027df65af`；[英文](screenshots/issue-16-state-matrix/issue-16-state-completed-en-1280x850.png) `6d68d6e9053249abeaa86d52e9009ce0ff67f7f5a750039aa79c5a3729d6c695`
  - running：[中文](screenshots/issue-16-state-matrix/issue-16-state-running-zh-CN-1280x850.png) `d9b214b2d6f4d55caee88c34fd029169d2fd61602229630a62e0b52fb207d028`；[英文](screenshots/issue-16-state-matrix/issue-16-state-running-en-1280x850.png) `761ab3d5a2b0352d93ea6aa79f6fe2ba9781e450e1bf220a2d7ac98b927aa1f0`
  - waiting_for_user 与控制权交接：[中文](screenshots/issue-16-state-matrix/issue-16-state-control-handoff-zh-CN-1280x850.png) `f028a125d6fcdecf1f1b869a0fd0fed49d31e96db8fe25241b7e1b9afa50af53`；[英文](screenshots/issue-16-state-matrix/issue-16-state-control-handoff-en-1280x850.png) `b09f183ba5d5232d77adf7b4bb6b70bec1a797102a991d78ae7845cda9856ff2`
  - interrupted：[中文](screenshots/issue-16-state-matrix/issue-16-state-interrupted-zh-CN-1280x850.png) `8878a839fd73cf6749f8e938d76042d719397251edaf33bbbc831e8506039989`；[英文](screenshots/issue-16-state-matrix/issue-16-state-interrupted-en-1280x850.png) `60b6d4d1ee86ef5afd0726908836cd02288111b6d923ec466db21d69b8c5ae53`
  - failed：[中文](screenshots/issue-16-state-matrix/issue-16-state-failed-zh-CN-1280x850.png) `493cff57412f38674cc4bb27a6a4c33e0f62e7c1ed61de58172f3f178edfecff`；[英文](screenshots/issue-16-state-matrix/issue-16-state-failed-en-1280x850.png) `dc96cbb513702f0d1786efcd9ac42d37601463eec605fb9d54901aecd8bdfcdb`

## 视觉参考与边界

沿用 Kobra Alert `https://kobra.systems/components/alert` 的既有 REA controlled replay Evidence `ev_7dbddd29058eef11227135f0879409777f91101dca4a0c7d543d9886057d2f61`（观察时间记录为 2026-11-03 09:20 Asia/Shanghai）。**直接观察**限于可访问树中的具名 alert 与 Error/Warning/Success/Info 示例；**静态证据**为 Corvid 现有状态 token 及本轮运行态 computed style；**推断**是以语义 token 区分结果与控制权状态；**未知**包括参考站点键盘行为、动效和窄窗状态，本轮没有重新访问或操作该组件，也未复制代码、样式或素材。

只验证 macOS 开发版、浅色主题和 1280×850；不覆盖暗色主题、窄窗、Windows/Linux、打包版、真实 Provider 或屏幕阅读器实播。截图只显示本地合成任务与 loopback 页面，没有用户资料。
