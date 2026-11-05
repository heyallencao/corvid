# Issue #208：Corvid Agent 模型选择器

## 验收环境与结果

- 环境：独立 worktree `/private/tmp/corvid-issue208-model-picker`，macOS arm64、Node.js v24.22.1、Electron 45.2.1；真实开发版 Electron、临时 `CORVID_DATA_DIR`，未访问个人网页或浏览数据。
- 模型目录：本轮运行时读取到 1,599 个模型；回归断言只要求目录超过 50 项，不锁定动态目录的精确数量。
- 通过：`node tests/pi-model-picker-ui-e2e.cjs` EXIT 0。覆盖目录过滤、ArrowDown/ArrowUp 与 Enter、默认模型写入隔离 `agent-model.json`、中文/英文无匹配空状态、Escape 恢复焦点、Tab 前往下一控件，以及 704×420 窄高视口下弹层留在窗口范围内。
- 通过：`node tests/pi-workbench-short-height-e2e.cjs` EXIT 0。覆盖 Agent 工作台中英文欢迎状态和短窗滚动可达性；本轮追加的模型搜索弹层短窗断言也通过。
- 静态检查：`node --check` 覆盖 renderer、locale、新增 UI E2E 及更新过的模型选择测试；`package.json` JSON 解析通过；`git diff --check` 通过。
- 未通过的既有扩展路径：`node tests/pi-workbench-e2e.cjs` 已通过模型搜索、键盘选择、持久化、空状态与中英文检查，随后在既有 Anthropic API Key 保存步骤未能进入已连接状态，最终在 `dataset.connected === 'true'` 等待处失败。该凭据/系统安全存储流程不属于本切片；不据此声称其通过，也未继续触发签名包或钥匙串诊断。
- 本轮没有 OAuth 登录、真实模型调用或真实用户凭据读写。E2E 使用本地隔离数据目录。宽窗截图尺寸为 2560×1636 Retina 像素，窗口逻辑尺寸 1280×850；短窗截图为 1408×776 Retina 像素，逻辑窗口尺寸 704×420、页面视口高 388 像素。

## 截图

- [中文：模型列表与当前选择](screenshots/issue-208-model-picker-zh-CN-1280x850.png)，SHA-256 `ac93c91a215a47175cfa34719715965346ead025646b56172f1fe677c31ee34f`。
- [中文：搜索无匹配结果](screenshots/issue-208-model-picker-no-results-zh-CN-1280x850.png)，SHA-256 `0e793dbb13dae12f4fffb7aae81165388081f8dba371a9e1fe23d29cec6663f3`。
- [英文：搜索无匹配结果](screenshots/issue-208-model-picker-no-results-en-1280x850.png)，SHA-256 `f58de71dff92f829cd835bb7bfea1e3c3e8074cc4d5206581f216b1af6ea73b2`。
- [英文：704×420 窄高窗口中的筛选列表](screenshots/issue-208-model-picker-narrow-en-704x420.png)，SHA-256 `5ed45fbe10fedc2de61e38bec70296b534dc384e09d0b1fb16f78bca7c54a348`。

截图只显示 Corvid 工作台、合成模型目录和空白页面，不含个人浏览数据、账号或凭据。

## UI/UE 参考与判断

- 参考 Aceternity UI Search 文档页（`https://ui.aceternity.com/components`）。项目已有 REA controlled replay：基线 Evidence `ev_03624926237a8c15166f8a3e066fecacb0041f7d616310448135bad5d67c2c4e`、打开搜索 Evidence `ev_9367e9f54ba0a032a62be6dd7b34e22040be41ae2cd7cc73cfc5fa1270817677`、输入筛选并键盘选择 Evidence `ev_643bb90ebc8795e05341a5e84e970dcbc956fd69e74a58594539b513534f02c5`。直接观察到其 combobox/listbox、匹配候选、ArrowDown 与 Enter；没有检查源码。它是组件文档站搜索，不是浏览器或模型选择器。
- 本切片借用的是可见候选与键盘反馈模式。Corvid 将当前模型保留在按钮上，候选行同时展示模型名和提供方，并按模型名、提供方及 ID 匹配；不照搬组件站的分组、配色、代码或素材。
- Corvid 的弹层沿用现有浅色/深色变量、圆角、焦点环和低对比边框；在窄高窗口中通过视口定位，不被可滚动的任务输入卡裁切。截图中没有个人信息。视觉判断仅覆盖本机浅色主题和这两种尺寸；深色主题、VoiceOver 实播及 Windows/Linux 尚未覆盖。
- Rare UI、Kobra、EasyUI、Pin UI 本轮没有针对模型选择器做新捕获；Aceternity 参考来自上述已有 REA Evidence，不将搜索结果页面外推为其完整组件行为。
