# Issue #407 Agent 对话区简洁度与视觉层级 — 视觉检查

日期：2026-11-07
环境：隔离 Electron（`CORVID_TEST_MODE=1`、独立临时 `CORVID_DATA_DIR`、本地 HTTP fixture 页），worktree `ui/issue-407-agent-chat-density`，macOS arm64、Node.js v24.22.1、Electron 45.2.1。未调用真实模型、Provider 或 OAuth。

## 检查范围

Agent 工作台右侧面板：会话流（会话头、消息、排队消息、运行行、收尾行、警示条）、composer（页面来源徽标、模型徽标、输入区、内嵌发送）、空态；zh-CN 与 en、浅色与深色、1280×850 与 704×420。

## 证据

`docs/qa/screenshots/issue-407/`（隔离 Electron 实拍；1280×850 与 704×420 均为窗口外框尺寸，位图为 2x 设备像素）：

| 截图 | 状态 | 检查点 | SHA-256 |
| --- | --- | --- | --- |
| before-after-zh-CN-1280x850.png | 前后对照（zh-CN，1280×850） | 左为 #377 卡片式工作台（同意 + 后续消息卡 + 加入队列 + 检查并预览页面上下文），右为 #407 托管式会话流 | `1669a38b322928bc0d17a9cba8907ad6d3bc54b07c1ef1eb535b3fdcd13cc445` |
| before-after-en-1280x850.png | 前后对照（en，1280×850） | 同上，英文文案长度下的收尾行与动作分组 | `ef86129abda4891e1070c44f5f241d9532e4d7e6adeb2c28e4bc9d4b13d1797f` |
| issue-407-empty-zh-CN-1280x850.png | 空态，未绑定页面 | 欢迎文案 + 页面徽标「连接当前页面」，无卡片、无同意步骤 | `b83edf109d1c4317621c3362d9f928176deadde53be5a38edb47db1ea03f05ba` |
| issue-407-empty-en-1280x850.png | 空态（en） | 英文欢迎文案不破版 | `7923277903a8475ba5ba50fad80ddb7e81aa2335edfe71a9ef867baae5d26cac` |
| issue-407-running-queued-zh-CN-1280x850.png | 运行中 + 2 条排队消息 | 会话头「日期 · 页面」+ ⋯ 菜单、排队气泡（排队中 + 撤回 ✕）、运行行（波形 + 状态 + 用时 + 停止） | `30b4c42aa9a0d8919101fafa401f23ba921e142a4aef83558c0486cc7f42b4b6` |
| issue-407-running-queued-en-1280x850.png | 同上（en） | 运行行与排队标签英文文案 | `665f9f20d7f99bee68414e646f8b34c52a3a89e020a411f97c76545ae56448e6` |
| issue-407-running-queued-zh-CN-704x420.png | 窄窗（zh-CN，704×420，视口 719×388） | 徽标行、输入区、发送按钮不换行、不被裁切；会话流独立滚动 | `b34884607e3b5f41c853fba03b06b4ec804ebc5834a772d933274e5986be7822` |
| issue-407-running-queued-en-704x420.png | 窄窗（en） | 英文徽标省略而不挤压输入区 | `2be7a93a5bb6b038eeb1864b1124a5798afa5898ff0541561619d4bf4e7c5917` |
| issue-407-stopped-zh-CN-1280x850.png | 已停止（等待检查） | 收尾行状态 + 完整文字提示，排队消息保留 | `627a341e18c4dc47de07fa9af3a27d877d7555679ca0f92770393c1c9abc2d0f` |
| issue-407-completed-zh-CN-1280x850.png | 已完成 | 收尾行：状态 + 用时 + 视为一组的动作胶囊 | `2e78e5458821f1c30ce46caf610cb7c89f46e6c5bd165553a093c7d2f240a2ac` |
| issue-407-completed-en-1280x850.png | 已完成（en） | 动作分组在英文长度下不拆行 | `7e40598da94d86c308dd8092662cc9f66fae586437c2a0ee2cfc8d29394fbb6f` |
| issue-407-completed-zh-CN-704x420.png | 已完成（窄窗） | 窄窗收尾行按组换行 | `4a06b0de987e4951f55d1f11d701c97e294938ab4179db0df0e3a5a4c26e0b6a` |
| issue-407-running-queued-dark-zh-CN-1280x850.png | 深色主题，运行中 + 排队 | 暗色下排队虚线、运行行强调色、composer 表面层级 | `5f0b17f701594ad0fd4c7b9c69671c1ee2d7f739ded03b4ac446991db68c12be` |

截图采集脚本为一次性隔离运行脚本（未提交）；`before-after-*` 由 `#377` 既有 QA 截图与本次截图合成，两侧均为同一隔离方式、同一窗口尺寸与同一状态。

## 结论

- 对话内容、状态、输入区三层分离：消息直接排在面板底色上，只有运行中与收尾各占一行，去掉了任务卡、操作按钮条与状态胶囊。
- 授权与高风险提示未被图标化：等待接管、失败、停止未确认仍以完整文字的警示条/错误块呈现；排队消息的撤回按钮带完整可访问名称。
- 托管即授权后，composer 常驻「页面来源徽标 + 模型徽标 + 输入区 + 内嵌发送」，运行中无需切换控件即可继续输入；原「检查页面并发送下一条」「加入队列」「检查并预览页面上下文」等步骤消失。
- 窄窗（704×420）下徽标行不换行、输入区与发送按钮均可见且可聚焦；会话流与历史各自滚动，composer 不产生内部滚动。
- 深色主题下新表面、虚线排队气泡与语义色状态可辨。

## 限制

- 仅 macOS 开发版、浅色/深色两套主题、zh-CN/en 两种语言；未覆盖 Windows、打包版与其他 macOS 版本。
- 未做读屏实播（VoiceOver/Narrator），无障碍结论限于 ARIA 角色、可访问名称与键盘可达性的自动化断言。
- 截图来自确定性 fixture 与隔离数据目录，不代表真实模型输出、真实网站布局或长会话滚动性能。
- 本轮不以截图证明功能正确性；行为合同见 `docs/reviews/verification-log.md` 中 #407 条目与对应 E2E。
