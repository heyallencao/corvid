# Issue #165 D25-3：设置中心键盘与辅助技术验收

## 范围与环境

- 2026-11-06，macOS arm64 开发版，隔离临时 `CORVID_DATA_DIR`，真实 Electron 45.2.1，Playwright 驱动，本地 HTTP 合成网站。
- 页面只包含合成标题与段落；未访问真实站点、Chrome Profile、模型或 OAuth。
- 本记录验证设置中心分类和“当前网站”操作的键盘路径及 Chromium 暴露的可访问名称，不代表 VoiceOver/Narrator 实际朗读验收。

## 直接观察与结果

- Tab 从“常规与搜索”依序到达“当前网站”；Enter 切换分类并将焦点移入内容区。
- 内容区 Tab 顺序先到“管理站点权限”，再到“清理此站点数据”。Enter 激活清理后出现确认，测试返回取消；非破坏选择为默认项，取消后页面数据不变。
- Chromium `Accessibility.getFullAXTree` 在 `zh-CN` 与 `en` 下均暴露具名设置对话框、具名分类导航、站点操作按钮及保存/取消按钮。活动分类 DOM 状态为 `aria-current="location"`，分区由 `aria-labelledby` 命名。
- 命令：`NODE_PATH=/Users/allen/Workspace/projects/personal/corvid/node_modules env -u ELECTRON_RUN_AS_NODE node tests/settings-accessibility-e2e.cjs`；结果 `PASS settings accessibility: Tab/Enter category and site actions, zh-CN/en Chromium AX names, 1 native prompt(s)`。

## 证据边界

- 直接观察：隔离真实 Electron UI 与 Chromium AX 树；确认框由测试替身返回取消，因此不代表系统原生确认框像素或屏幕阅读器交互。
- 未覆盖：VoiceOver、Narrator、打包版、Windows、全产品键盘审计、所有设置分类的逐项读屏，以及原生文件夹/下载对话框辅助技术体验。
- UI 参考边界：本子切片只补充现有交互的可复现键盘/AX 验收，没有改变设置视觉或导航设计；Issue #165 已有的 EasyUI/Kobra 信息分区参考仅支持分类清晰度，不据此推断屏幕阅读器行为。
