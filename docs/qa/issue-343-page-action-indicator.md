# Issue #343 页面动作指示 QA

## 范围

首期只覆盖外部 Browser MCP/SDK 发起的 `click`、`hover`、`scroll`、`fill`。指示层由 Corvid Electron 原生透明窗口合成，显示动作阶段与目标位置；不向网站 DOM 注入节点或事件，不向指示层传递填入文本、locator 或网页文字。内置 Corvid Agent 页面动作不在首期范围。

仅当目标空间/标签处于前台、Corvid 窗口可见并拥有焦点、没有模态框且空间仍由 Agent 控制时显示。后台动作不激活窗口。用户接管或等待、结束、失败、页面/空间切换、模态框打开或窗口失焦时清除。

## 定向验收

- 环境：macOS arm64，Node.js v24.22.1，Electron 45.2.1；隔离 `CORVID_DATA_DIR` 临时目录；本地 HTTP fixture；不访问真实网站、真实用户数据、OAuth 或模型。
- 命令：`env -u ELECTRON_RUN_AS_NODE CORVID_PAGE_ACTION_INDICATOR_SCREENSHOT_PATH=docs/qa/screenshots/issue-343-page-action-indicator.png node tests/page-action-indicator-e2e.cjs`
- 结果：EXIT 0。覆盖后台空间动作不创建前台指示、click/hover/scroll/fill 阶段及坐标、填入文本不泄漏、叠加层不接管键盘焦点、click 对页面的实际效果、交还与结束时清除、失效目标失败。随后 `caffeinate -dimsu env -u ELECTRON_RUN_AS_NODE node tests/localization-e2e.cjs` EXIT 0，双语资源键与应用中英文回归通过。
- macOS Playwright/直接子进程启动的 Electron 不稳定取得系统前台焦点。新增 `tests/electron-test-launcher.cjs`：dialogs/uploads 在 macOS 通过 Launch Services `open -na` 启动各自隔离的数据目录，使原生窗口成为前台应用；其他平台保留直接子进程启动。脚本以该实例的 `startup-progress.json` PID 清理窗口。原生前台启动后，dialogs/uploads 两项定向测试通过。动作指示定向测试自身仍在隔离进程内 stub `isFocused()`，所以它不单独证明 OS 焦点门槛。另曾通过桌面交互观察到聚焦中的 Corvid 窗口显示标记和“正在点击”标签，但该次桌面截图未保存为交付图片。
- 自动化 PNG 是透明原生叠加窗口的 `capturePage()` 结果，尺寸 2560×1622（设备像素），SHA-256：`d827d0434aa1bf2babfa2bb63b8ab2d8fb79d522568ba334ed80bb4b69f2da4d`。透明像素在常见图片查看器中以黑色显示；它只证明标记层渲染，不证明完整网页合成层像素或点击穿透行为。
- 原生焦点根因与修复：直接 `spawn`/Playwright attach 的 Electron 虽然窗口可见，但不能在 macOS 自动化会话中取得前台焦点；`app.focus({steal:true})` 也未改变 `isFocused() === false`，页面 alert handler 会执行而原生 dialog 不出现。改用 Launch Services `open -na` 启动隔离 Electron 后，系统前台 bundle 为 `com.github.Electron`，本地 fixture 的 `page.dialog()` 成功返回 alert；`tests/dialogs.e2e.mjs` 与 `tests/uploads.e2e.mjs` 串行定向复跑 2/2 通过，覆盖页面对话框、chooser、文件内容/事件、iframe 与 shadow DOM 输入、取消/过期/控制权边界。
- 全量门禁：最终在 rebase 到 `origin/main` `13fa144` 后运行 `caffeinate -dimsu env -u ELECTRON_RUN_AS_NODE npm test`，EXIT 0。Node 阶段 46/46 通过，随后 `test:serial` 全部独立 E2E 脚本均报告 PASS，包含新增的页面动作指示验收；无 skip。环境为 macOS arm64、Node.js v24.22.1、Electron 45.2.1，测试使用隔离临时数据目录与本地 fixture，不调用 OAuth、真实模型或真实网站。
- 中间复跑记录：一次基于 `43942bb` 的完整复跑在 `chrome-import-e2e.cjs` 键盘焦点断言失败；该脚本单独运行通过，随后同一基线的完整复跑也通过。之后 main 前进至 `13fa144`，rebase 后的最终完整门禁再次通过。

## 未覆盖

尚未自动验证不同显示缩放/多显示器下的坐标映射、窗口移动/缩放期间的指示同步、macOS/Windows 原生点击穿透，以及 VoiceOver/Narrator 实际播报。跨平台运行和打包版未验证；需按其平台流程分别验收，不由本机 macOS 结果外推。
