# D06 窗口全屏切片（Issue #141）

**状态：实现中，真实 Electron 验收未完成。** 本文是执行板 D06「标签、窗口与导航」的切片记录；D06 仍是长期能力台账的事实来源。

## 产品行为

- 从“更多浏览工具”菜单或平台快捷键切换 Corvid 窗口全屏。浏览器导航、标签、网页和当前 Agent 工作区继续由同一窗口承载。
- macOS 使用 `⌃⌘F`，Windows/Linux 使用 `F11`。菜单项为可访问的 `menuitemcheckbox`，其选中状态跟随当前窗口的原生事件。
- 全屏状态按 BrowserWindow 隔离。退出或关闭一个窗口不应切换其他窗口。
- 保存窗口状态时保留进入全屏前的普通尺寸、位置和最大化状态；应用退出与重启不得把临时全屏尺寸当作普通窗口尺寸。
- 网页 HTML Fullscreen 属于网页自身状态。Corvid 的窗口级全屏动作在网页已请求 HTML Fullscreen 时不可用，不调用 `setFullScreen` 覆盖网页状态，也不改变站点权限。
- 网页进入 HTML Fullscreen 的状态绑定到具体标签。该标签导航或关闭时，清理状态；如果原生窗口仍因网页全屏而处于全屏，则退出原生全屏，避免“全屏禁用”状态残留。
- `toggleFullscreen` 仅供 Corvid 桌面界面调用；本机控制 API/外部 Agent 不得借此切换窗口。全屏 E2E 检查外部控制 API 不提供窗口全屏路由。

## 实现与验收

- 快捷键判定：`desktop/window-shortcuts.cjs`；平台矩阵单测：`tests/window-shortcuts.test.mjs`。
- 窗口状态、异步原生事件和持久化：`desktop/main.cjs`。网页全屏状态使用 `WebContents` 级 enter/leave 事件绑定到具体标签；实现依据 Electron 45.2.1 本地类型定义、[Electron BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window) 与 [Electron WebContents API](https://www.electronjs.org/docs/latest/api/web-contents)。官方 API 将普通窗口全屏与 HTML API 触发的网页全屏分别发出事件，并说明 macOS 全屏转换异步；这是状态分离和通过事件同步状态的依据。文档于 2026-11-03 16:45（Asia/Shanghai）复核。
- 菜单、本地化与状态呈现：`desktop/index.html`、`desktop/renderer.js`、`desktop/locales.js`、`desktop/styles.css`。
- 隔离 Electron 验收：`tests/fullscreen-e2e.cjs`；中英文回归：`tests/localization-e2e.cjs`。快捷键通过 Electron `WebContents.sendInputEvent` 触发，以覆盖 `before-input-event`；Playwright CDP 键盘输入不经过该处理器。
- 必须在可交互桌面上通过菜单和快捷键进入/退出；验证两窗口状态隔离、网页 HTML Fullscreen 边界、原尺寸与最大化状态恢复、关闭/退出期间不反复进入全屏；全屏 E2E 同时断言浏览器导航与 Corvid Agent 工作区仍然可见。随后更新 D06、测试索引、验证日志并保存脱敏截图。

## 当前证据与限制

- 本地纯逻辑验证：2026-11-03 16:51（Asia/Shanghai）复跑 `node --test tests/window-shortcuts.test.mjs tests/window-fullscreen-state.test.mjs`，13 项通过；状态单测覆盖不匹配标签、迟到的旧标签退出不清理新标签状态、匹配标签退出原生全屏、最大化快照清理、重复清理、无 `describe` 时安全清理、窗口销毁和关闭中边界。本轮 `node --check` 覆盖 `desktop/main.cjs`、`desktop/page-fullscreen.cjs`、`tests/window-fullscreen-state.test.mjs`、`tests/fullscreen-e2e.cjs`，`git diff --check` 通过。此前已检查 `desktop/window-shortcuts.cjs`、`desktop/renderer.js`，并验证 `package.json` 可解析。
- 2026-11-03 16:47（Asia/Shanghai）静态 review 发现窗口级 HTML Fullscreen 退出事件没有标签身份，可能在迟到时清除另一个标签当前的全屏归属；现改由每个 `WebContents` 的进入/退出事件维护精确标签状态，并清除失效的最大化快照。纯逻辑测试覆盖了这类事件顺序，但尚未通过真实 Electron 复现或验收。
- 2026-11-03 16:51（Asia/Shanghai）静态 review 发现导航、标签关闭、`WebContents` 销毁三个清理调用点原先未传入状态序列化函数，窗口存活时可能在清理路径抛错；所有调用点现已传入该函数，清理模块也对无序列化函数的 teardown 做防御处理，并由纯逻辑回归覆盖。该异常此前未在真实 Electron 中复现。
- 2026-11-03 16:57（Asia/Shanghai）全屏 E2E 新增两项产品边界：全屏时 Corvid Agent 工作区保持可见，外部控制 API 不暴露窗口全屏路由；`node --check tests/fullscreen-e2e.cjs` 通过，13 项纯逻辑测试复跑通过。E2E 本身未启动，故两项断言仍未实测。
- 真实 Electron 定向运行已覆盖菜单切换、最大化还原、macOS 快捷键和两个窗口的独立状态；后续运行进入网页 HTML Fullscreen，并观察到 Corvid 将窗口级切换禁用且不会覆盖页面状态。运行也暴露了关闭全屏标签后窗口状态可能残留的问题，当前代码已加入按标签清理逻辑，尚待复验。
- **未完成：**最新版 `tests/fullscreen-e2e.cjs` 与 `tests/localization-e2e.cjs` 尚未完整通过；窗口尺寸/状态重启恢复、中英文实时切换、UI 截图和平台人工检查仍未验收。Agent 工作区全屏可见性已有 E2E 断言但尚未运行。当前 CUA 观察到 macOS 锁屏，锁屏期间的全屏失败不作为产品通过或失败证据；待用户解锁后重跑定向 E2E 和全量回归。
- 2026-11-03 16:43（Asia/Shanghai）通过 CUA `getState()` 复核：`apps` 为空，原生应用枚举返回“Mac is locked and automatic unlock could not unlock it”。本轮没有启动 Corvid/Electron；该结果证明当前无法进行桌面验收，不证明功能通过或失败。
- 2026-11-03 17:00（Asia/Shanghai）全屏 E2E 增加关闭并重启应用后的窗口恢复检查：校验退出时持久化的正常尺寸/最大化状态与重启恢复结果一致，且不恢复临时全屏；另等待网页全屏关闭触发的原生窗口退出完成。`node --check tests/fullscreen-e2e.cjs`、13 项纯逻辑测试与 `git diff --check` 通过；真实 E2E 尚未运行。
- `tests/fullscreen-e2e.cjs` 原有快捷键步骤使用 Playwright `keyboard.press`，该输入不会经过 Electron 的 `before-input-event`，已改为 Electron 原生输入事件。网页全屏夹具通过隔离 HTTP 页面、测试期明确自动同意权限请求来运行，不使用真实站点或账号。
- UI 只在现有“更多浏览工具”菜单加入状态项和快捷键提示，未移植外部组件或视觉素材；本轮未使用 REA 检查 Rare UI、Kobra、EasyUI、Pin UI 或 Aceternity UI。需要进一步调整视觉样式时再按全局 UI 参考约束取证。

## 已安装参考产品的 REA 静态证据

观察时间：2026-11-03 16:02（Asia/Shanghai）。本轮因共享桌面仍由 #139 验证流程占用，未启动或交互 EGO Lite/Kaze；以下只说明安装包身份和静态分析范围，不把它们当作运行态全屏行为。

| 产品 | 直接观察与证据 | 推断 | 未知与覆盖限制 |
| --- | --- | --- | --- |
| EGO Lite | REA `inspect_desktop_application` Evidence `ev_8706965fa3cf2ec9e762a821dba5f14462d7c66ffbe7c30340ed51e1e31f8bc7`：目录扫描 2,574/2,574 entries，探测 70 个文件、5,076 bytes，发现 7 个未跟随 symlink；候选 Electron 数为 0。文件页 Evidence `ev_167c0bff8d83245abc829044979b9b664d823d6780ad1ca26a14311d211bedd0`。只读 `find '/Applications/ego lite.app/Contents' -type f` 对 `*.asar` 返回空集。 | 当前安装包有名为 `ego Framework.framework` 的本地 Framework；现有 REA 目录扫描没有识别到 Electron 或可选 JavaScript 包。 | 这不证明 EGO Lite 不是基于 Chromium，也不能说明其全屏交互；未读二进制内容、未运行应用、未观察菜单与快捷键。目录扫描不是原子快照，symlink 未跟随。 |
| Kaze | REA `inspect_desktop_application` Evidence `ev_bcd512e68502457fe5fef6bfa37454743488af4a551d8d1ff5682c0e4c7b3bdc`：目录扫描 270/270 entries、28 个文件探测、2,572 bytes；发现 `Contents/Resources/app.asar` 并将其列为 Electron 候选。ASAR SHA-256 为 `c168a2ef9b3586a9de0965972ec82bebb9391fa68dfbf876e4b7c173ce6682d4`。REA ASAR inventory Evidence `ev_bccb58150737314758d343ca2f305f11a12f9498a499298ded9298d5bcb7cdc0` 记录 14,479 nodes、17,738 occurrences、17,737 edges 和 5 项 integrity contradictions；矛盾字节按不可信处理。精确 `package.json` 静态分析 Evidence `ev_a1496c5240d9ec6b5e289860b5cd0c2dadaf7a02948b2a2adad818733681b5a0` 观察到名称 `kaze`、版本 `0.26.0`、main `./out/main/index.js`。 | Kaze 安装包是 Electron 应用；package manifest 指向 `out/main/index.js`。 | 全 ASAR JavaScript 分析遇到 180 秒 REA 服务端单源超时，Evidence `ev_14f5068565ecb04a08a277bd6d09f2f06c33fb9b92d97f188c3c013515cad661` 保留部分结果，图覆盖不完整。后续仅选 `out/main/index.js` 的静态 Evidence `ev_06d3f2b3bc5db95585f4b3968d9dca7f3df3ee2cbcf328c36451bc846344ddbb`；对 `setFullScreen` 的 trace Evidence `ev_bde2e687c947aabf46c39c5f77cefe991c9e52d0fc6b6dff690e7a708b62ab29` 未匹配，但源图为 partial，不能据此认定无全屏功能。未执行应用，未验证实际窗口、快捷键或菜单行为。 |

因此，#141 当前采用的是 Corvid 自身已有菜单与窗口记录合同的延伸；还没有足够运行态证据声称与 EGO Lite/Kaze 的全屏交互一致。窗口可见性、页面 HTML Fullscreen 退出与共存、窗口关闭恢复及平台差异，仍须在桌面解锁后通过运行态观察与隔离 Electron E2E 核验。
