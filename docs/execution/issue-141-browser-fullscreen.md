# D06 窗口全屏切片（Issue #141）

**状态：实现中，尚未完成真实 Electron 验收。** 本文是执行板 D06「标签、窗口与导航」的切片记录；D06 仍是长期能力台账的事实来源。

## 产品行为

- 从“更多浏览工具”菜单或平台快捷键切换 Corvid 窗口全屏。浏览器导航、标签、网页和当前 Agent 工作区继续由同一窗口承载。
- macOS 使用 `⌃⌘F`，Windows/Linux 使用 `F11`。菜单项为可访问的 `menuitemcheckbox`，其选中状态跟随当前窗口的原生事件。
- 全屏状态按 BrowserWindow 隔离。退出或关闭一个窗口不应切换其他窗口。
- 保存窗口状态时保留进入全屏前的普通尺寸、位置和最大化状态；应用退出与重启不得把临时全屏尺寸当作普通窗口尺寸。
- 网页 HTML Fullscreen 属于网页自身状态。Corvid 的窗口级全屏动作在网页已请求 HTML Fullscreen 时不可用，不调用 `setFullScreen` 覆盖网页状态，也不改变站点权限。
- `toggleFullscreen` 仅供 Corvid 桌面界面调用；本机控制 API/外部 Agent 不得借此切换窗口。

## 实现与验收

- 快捷键判定：`desktop/window-shortcuts.cjs`；平台矩阵单测：`tests/window-shortcuts.test.mjs`。
- 窗口状态、异步原生事件和持久化：`desktop/main.cjs`。
- 菜单、本地化与状态呈现：`desktop/index.html`、`desktop/renderer.js`、`desktop/locales.js`、`desktop/styles.css`。
- 隔离 Electron 验收：`tests/fullscreen-e2e.cjs`；中英文回归：`tests/localization-e2e.cjs`。
- 必须在可交互桌面上通过菜单和快捷键进入/退出；验证两窗口状态隔离、网页 HTML Fullscreen 边界、原尺寸与最大化状态恢复、关闭/退出期间不反复进入全屏；随后更新 D06、测试索引、验证日志并保存脱敏截图。

## 当前证据与限制

- 本地纯逻辑验证：`node --test tests/window-shortcuts.test.mjs`，3 项通过；`node --check` 覆盖本切片 JavaScript 文件，`git diff --check` 通过。
- **未完成：**`tests/fullscreen-e2e.cjs`、窗口尺寸/状态重启恢复、Agent 工作区全屏可见性、中英文实时切换、UI 截图和平台人工检查均尚未在真实 Electron 中运行。
- 本轮不启动 Electron/UI 测试，以免与并行的 Issue #139 全量验证争用桌面窗口；待该会话明确释放后再继续。
- UI 只在现有“更多浏览工具”菜单加入状态项和快捷键提示，未移植外部组件或视觉素材；本轮未使用 REA 检查 Rare UI、Kobra、EasyUI、Pin UI 或 Aceternity UI。需要进一步调整视觉样式时再按全局 UI 参考约束取证。
