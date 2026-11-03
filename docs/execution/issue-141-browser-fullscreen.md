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

## 已安装参考产品的 REA 静态证据

观察时间：2026-11-03 16:02（Asia/Shanghai）。本轮因共享桌面仍由 #139 验证流程占用，未启动或交互 EGO Lite/Kaze；以下只说明安装包身份和静态分析范围，不把它们当作运行态全屏行为。

| 产品 | 直接观察与证据 | 推断 | 未知与覆盖限制 |
| --- | --- | --- | --- |
| EGO Lite | REA `inspect_desktop_application` Evidence `ev_8706965fa3cf2ec9e762a821dba5f14462d7c66ffbe7c30340ed51e1e31f8bc7`：目录扫描 2,574/2,574 entries，探测 70 个文件、5,076 bytes，发现 7 个未跟随 symlink；候选 Electron 数为 0。文件页 Evidence `ev_167c0bff8d83245abc829044979b9b664d823d6780ad1ca26a14311d211bedd0`。只读 `find '/Applications/ego lite.app/Contents' -type f` 对 `*.asar` 返回空集。 | 当前安装包有名为 `ego Framework.framework` 的本地 Framework；现有 REA 目录扫描没有识别到 Electron 或可选 JavaScript 包。 | 这不证明 EGO Lite 不是基于 Chromium，也不能说明其全屏交互；未读二进制内容、未运行应用、未观察菜单与快捷键。目录扫描不是原子快照，symlink 未跟随。 |
| Kaze | REA `inspect_desktop_application` Evidence `ev_bcd512e68502457fe5fef6bfa37454743488af4a551d8d1ff5682c0e4c7b3bdc`：目录扫描 270/270 entries、28 个文件探测、2,572 bytes；发现 `Contents/Resources/app.asar` 并将其列为 Electron 候选。ASAR SHA-256 为 `c168a2ef9b3586a9de0965972ec82bebb9391fa68dfbf876e4b7c173ce6682d4`。REA ASAR inventory Evidence `ev_bccb58150737314758d343ca2f305f11a12f9498a499298ded9298d5bcb7cdc0` 记录 14,479 nodes、17,738 occurrences、17,737 edges 和 5 项 integrity contradictions；矛盾字节按不可信处理。精确 `package.json` 静态分析 Evidence `ev_a1496c5240d9ec6b5e289860b5cd0c2dadaf7a02948b2a2adad818733681b5a0` 观察到名称 `kaze`、版本 `0.26.0`、main `./out/main/index.js`。 | Kaze 安装包是 Electron 应用；package manifest 指向 `out/main/index.js`。 | 全 ASAR JavaScript 分析遇到 180 秒 REA 服务端单源超时，Evidence `ev_14f5068565ecb04a08a277bd6d09f2f06c33fb9b92d97f188c3c013515cad661` 保留部分结果，图覆盖不完整。后续仅选 `out/main/index.js` 的静态 Evidence `ev_06d3f2b3bc5db95585f4b3968d9dca7f3df3ee2cbcf328c36451bc846344ddbb`；对 `setFullScreen` 的 trace Evidence `ev_bde2e687c947aabf46c39c5f77cefe991c9e52d0fc6b6dff690e7a708b62ab29` 未匹配，但源图为 partial，不能据此认定无全屏功能。未执行应用，未验证实际窗口、快捷键或菜单行为。 |

因此，#141 当前采用的是 Corvid 自身已有菜单与窗口记录合同的延伸；还没有足够运行态证据声称与 EGO Lite/Kaze 的全屏交互一致。窗口可见性、页面 HTML Fullscreen 共存与平台差异仍须在共享桌面释放后，通过运行态观察与隔离 Electron E2E 核验。
