# 验证记录

## 2026-11-02 Pi Agent 多模型选择与 GPT-6 Luna 实际调用

### 执行与结果

- Kaze 参照来自 REA 对正在运行的 Kaze 0.26.0 窗口截图：右侧 Agent 面板的输入区附近显示当前模型下拉“DeepSeek V4.1 Flash”；Evidence `ev_ae7cc8d9bebb43705bcdbb47eb75fc571bdd0ddc99e2c1d199e2d0cb80f6dcb7`。本轮没有展开菜单或操作授权流程。
- Corvid 在 Pi Agent 输入区加入 provider/model 选择、认证状态、OAuth 连接与 API Key 登录入口；默认模型偏好写入 Corvid `agent-model.json`（0600），任务记录保存创建时的模型。Pi SDK 创建 session 时显式指定模型并比对 session 实际 provider/id；续聊使用任务原模型；错误记录对常见 Bearer/API Key 形式脱敏。API Key 使用 Pi `ModelRuntime.login()` 凭据存储合同，设置与 Pi 现有登录共享。
- `node --check` 覆盖 `desktop/pi-models.cjs`、`desktop/pi-agent.cjs`、`desktop/pi-workbench.cjs`、`desktop/main.cjs`、`desktop/renderer.js` 及新增/更新测试文件；`git diff --check` 通过。`node tests/pi-models-e2e.cjs`、`env -u ELECTRON_RUN_AS_NODE node tests/pi-runtime-e2e.cjs`、`env -u ELECTRON_RUN_AS_NODE node tests/pi-workbench-e2e.cjs` 均通过（EXIT 0）。Electron 测试的 Pi 目录、Corvid 数据和页面均使用临时隔离 fixture；模型设置文件不含凭据，未连接状态有 UI 提示，API Key 凭据经模拟登录写入临时 Pi 凭据存储且重建 runtime 后仍识别，模型选择写入与任务原模型续聊合同通过。
- 宽窗及 700×420 短窗 shell 截图已目视检查，SHA-256 与布局观察见[视觉检查记录](../qa/ui-visual-check.md#2026-11-02-pi-agent-模型选择控件与短窗口复查)。短窗优先显示任务页面与输入框；模型选择/连接状态在表单内滚动区域中，不声称所有控件在最小高度下同时显示。
- 用户指定的真实模型 smoke：`env -u ELECTRON_RUN_AS_NODE node tests/pi-real-model-smoke.cjs` 通过（EXIT 0）。测试确认 Pi credential metadata 为 `openai-codex` / `oauth`，Corvid session 实际 model 为 `openai-codex/gpt-6-luna`，向本地 fixture 页面上下文发送一次短请求并收到 `CORVID_LUNA_OK`。没有打印或写入凭据。该请求真实访问 OpenAI/Codex 服务并使用账户额度。
- 本轮没有运行完整 `npm test`，没有验证手动 OAuth 浏览器回调、API Key 登录/退出 UI 流程或其他 Provider 的真实请求。API Key 登录函数仅用临时目录和虚构 Key 做了持久化合同验证。

### 覆盖与限制

- D19 仍为“部分”。真实模型 smoke 只证明本机 macOS、当前 Pi 1.4.0 OAuth 凭据与指定 GPT-6 Luna 调用；不代表其他账户、模型、Provider、平台、打包应用或断线恢复已验证。Kaze 登录/模型列表行为未实机观察；Kaze 包的静态分析也未执行 JS，相关细节继续未知。
- 功能由 [Issue #47](https://github.com/heyallencao/corvid/issues/47) 跟踪，对应 [PR #48](https://github.com/heyallencao/corvid/pull/48)，PR #48 已于 2026-11-02 合并至 `main`，merge commit `7c8cbdac87f445cc3fb6e37e2bc85e1a9736047c`。

## 2026-11-02 Pi 任务失败反馈与可恢复性

### 执行与结果

- 修复失败任务的重复错误播报；以单个失败卡片显示“任务未完成”和原因。Transcript 存在时显示“检查上下文并恢复”，仍沿用预览及重新勾选页面上下文的续聊流程；初始化失败没有 transcript 时显示重新发起指引，不提供伪恢复按钮。
- 故障注入仅在 `CORVID_TEST_MODE=1` 下生效：一次模拟首轮 Provider 断连（写入 transcript 后失败），一次模拟 Pi session 初始化失败（无 transcript）；正常运行路径不受影响。
- `node --check desktop/main.cjs`、`node --check desktop/renderer.js`、`node --check tests/pi-workbench-e2e.cjs`、`git diff --check` 与 `env -u ELECTRON_RUN_AS_NODE node tests/pi-workbench-e2e.cjs` 均通过（EXIT 0）。真实 Electron 45.2.1 E2E 验证单一 alert、失败原因、同 task/session 恢复、无 transcript 指引，以及既有重启恢复和用户接管回归。
- REA 运行时观察：隔离启动的 Corvid Electron 45.2.1 / Chrome 156 目标为 `desktop/index.html`；目标发现 Evidence `ev_ee873355f02ca2f84a0a44d0124038ebe7ac07596dc1fcaa98a703384c4821c8`，当前页面 DOM Evidence `ev_66d284ef78f65764947ff137d8336adacf33ee8c75b29ad0602e8874018d0063`。DOM 结构与 `renderPiTasks()` 的任务卡实现相符。REA DOM 观察不返回文本值；REA 像素截图工具不接受应用 `file://` 页面，因此视觉文案/交互断言以真实 Electron E2E 为准，未将该 DOM 观察写作失败态截图证据。

### 覆盖与限制

- 本地确定性 fixture 不连接真实模型，不证明真实 Provider 的断连语义、transcript 完整性或恢复成功率。真实模型登录/选择待单独调查；按用户要求，候选验收环境为 ChatGPT 登录及 GPT-6-luna，但在核实账户认证和 SDK 支持前不运行真实请求。
- 当前修复对应 [Issue #45](https://github.com/heyallencao/corvid/issues/45)，D19 仍为“部分”。

## 2026-11-02 站点工具菜单键盘与焦点管理

### 执行与结果

- 站点工具按钮声明 `aria-haspopup="menu"` 与 `aria-controls`；点击或 ArrowUp/ArrowDown 打开菜单并把焦点放到首项/末项。菜单支持方向键循环、Home/End、Escape 返回触发按钮、Tab 离开并推进焦点。点击外部、选择菜单动作与 Escape 均同步 `aria-expanded`，动作完成后焦点回到触发按钮。
- `node --check desktop/renderer.js`、`node --check tests/permissions-e2e.cjs`、`env -u ELECTRON_RUN_AS_NODE node tests/permissions-e2e.cjs` 均通过（EXIT 0）。真实 Electron + 隔离数据目录的权限用例覆盖触发方式、每项焦点、关闭原因、ARIA 状态及既有通知权限请求/确认/撤销/隔离/重启合同。
- `env -u ELECTRON_RUN_AS_NODE npm test` 全量通过（37 条串行命令 / 39 项 Electron E2E，EXIT 0）。菜单打开态 fixture 截图 SHA-256 `770e48103db75e492f54f97061eaa0cfacaeae7bf89f1c365ed977577ba0b05a`，本机临时留存并已目视检查焦点环与菜单位置。
- REA 当前应用只读核对：隔离启动的 Electron 45.2.1 目标为 `desktop/index.html`，DOM 存在站点工具触发器和菜单的预期 ARIA/role 属性名（Evidence `ev_39906920bf7a751852e981a5cdd90c2488b3a4c2b6a02a34d5c32a5ab43b7374`；目标发现 Evidence `ev_8c900697a3651d337e39316971b952d8742fa52b167e682c4c51bed4ecef7795`）。该被动检查不读取属性值、不检查焦点或键盘行为，也不支持对此 `file://` 页面截图；这些状态以 E2E 结果为准。

### 覆盖与限制

- 该切片落实 Issue #16 中站点工具菜单、键盘与焦点反馈的一项；Pi/Agent 状态、标签右键菜单和屏幕阅读器尚未收敛，D21 继续为“部分”。
- 页面来自本地权限 fixture；截图只捕获 shell，不包含独立 `WebContentsView` 页面正文。测试替换系统权限对话框，不等于 VoiceOver 或原生系统对话框验收。

## 2026-11-02 标签上下文菜单键盘与焦点闭环

### 执行与结果

- 标签菜单可以由右键、`Shift+F10` 或 ContextMenu 键打开；每个标签按钮声明菜单关系与展开状态。打开后焦点进入首项，方向键循环、Home/End 导航，Escape 回到原标签；Tab/Shift+Tab 关闭并把焦点移动到相邻 shell 控件。菜单动作后尝试回到原标签，若标签已关闭则聚焦当前活动标签或新建标签。
- REA 现场检查当前隔离 Electron 45.2.1 的 `desktop/index.html` 页面，目标发现 Evidence `ev_d1ec17de5fd8928b84e6166203b5247113f8eeabc9312c67837518a7af254725`、页面 DOM Evidence `ev_935b672fa23f8053636782a670a04e23d9a1677c6f13d0d403b1ed47503d5731`。DOM 中标签按钮具备 `aria-haspopup`、`aria-expanded`、`aria-controls`；REA 不返回属性值/焦点，也不执行输入，所以键盘行为以下列真实 Electron E2E 为准。
- 验证：`node --check desktop/renderer.js`、`node --check tests/tab-pin-menu-e2e.cjs`、`git diff --check` 与最新 `env -u ELECTRON_RUN_AS_NODE node tests/tab-pin-menu-e2e.cjs` 均通过（EXIT 0）。较早一次全量回归在最后的测试定位器微调前通过 37 条命令 / 39 项 E2E（EXIT 0）；最新全量重跑停在 `restore-loading-e2e` 超过 5 分钟，Node/Electron 进程仍存活且后续测试未开始。确认挂起后向精确进程发送 SIGTERM，`npm test` 进程退出码 143，因此最新完整回归没有最终退出码；已重新打开 [Issue #34](https://github.com/heyallencao/corvid/issues/34) 记录该复现。
- Issue #34 的后续独立复验：临时诊断副本完整通过，阶段日志确认两次应用启动、`app.close()`、fixture server 清理和临时目录删除均完成；随后原始 `env -u ELECTRON_RUN_AS_NODE node tests/restore-loading-e2e.cjs` 也通过（EXIT 0）。这未复现全量串行中的挂起，根因仍未知，Issue #34 保持开放。
- 键盘菜单 shell 截图 SHA-256 `0002435ac8fa46a60ccd24a8d09ea7b857ba95951b911465bd1949af41fcd70c`，本机临时留存并目视确认焦点环可见、菜单未遮住核心地址栏操作。

### 覆盖与限制

- 覆盖本地 HTTP fixture、macOS 与应用内 HTML 菜单；没有 VoiceOver/屏幕阅读器、原生系统菜单、Windows/Linux 或真实网站验收。shell 截图不包含由独立 `WebContentsView` 承载的网页正文。

## 2026-11-02 Pi 工作台长历史与窄短窗口

### 执行与结果

- Pi 工作台将任务历史放进独立滚动区，任务输入/页面绑定/上下文预览与显式同意留在底部；刷新时保留历史阅读位置，若用户原在历史末尾则继续跟随新输出。矮窗口中输入卡片可内部滚动，页面绑定收为单行省略。
- REA 当前 Kaze 现场截图 Evidence `ev_fdb1ec28706c6b2401549b230199346e86c42a50c2e12ce04b0a06f7073563b3`（1440×851）确认紧凑纵向导航、顶端浏览器栏与主画布并存；EGO 参考采用同日既有 Evidence `ev_3a5609d1eb705ccdf3c5071061a8a6b7aafa5a604f570f210b9c81a8a5c86e5e`。参照边界与 REA 限制见[双浏览器参照分析](../research/browser-reference-analysis.md)。
- `node --check desktop/renderer.js`、`node --check tests/pi-workbench-e2e.cjs`、`env -u ELECTRON_RUN_AS_NODE node tests/pi-workbench-e2e.cjs` 和 `env -u ELECTRON_RUN_AS_NODE npm test` 均通过（EXIT 0）。定向 E2E 在真实 Electron 45.2.1 中创建 8 项本地 fixture 任务、验证长历史滚动、输入区可达、续聊/重启/接管恢复，并在 700×420 窗口预览页面上下文、勾选同意和启动任务。全量回归 37 条串行命令 / 39 项 Electron E2E 全部通过。
- 宽窗与窄短窗 fixture 截图已目视复核，SHA-256 分别为 `2aae5a35af2d6186a3418c20ddc73cd659e6de5a9b7946c742bc66b2aab51fec` 与 `75a9ae90e00cace0110aa345a96ea11b6eebcb0e2a5dc2cc7c418004403cadd5`；临时截图没有加入 Git。

### 覆盖与限制

- REA 本次对 Kaze 的现行截图观察没有读取或记录页面文字；EGO 当前窗口的 PID/窗口关联不稳定，因此沿用同日既有 EGO REA 观察。Corvid 行为由隔离真实 Electron 与本地 fixture 验证，未声称真实模型/provider、跨平台、深色或屏幕阅读器已通过。
- 截图是本地 fixture 下的布局检查，不是逐像素基线；在最低窗口高度下，较长上下文预览需要在输入卡片内部滚动。

## 2026-11-02 BrowserMCP 常用页面操作与双浏览器 REA 复核

### 执行与结果

- MCP 新增 `page_navigate`、`page_click`、`page_fill`、`page_press`。每个动作都要提供明确 `roomId`/`tabId`；目标必须是 Agent 控制、无待接管、无执行风险且受管理的页面。导航限制为无嵌入凭据的 HTTP(S) URL；动作工具声明为可写、具有外部副作用。
- `node tests/mcp-e2e.cjs` 通过：真实 Electron 连接隔离 stdio MCP 进程，在本地 HTTP 页面执行导航、fill、press、click，再通过 Snapshot 确认页面状态变化；拒绝 `javascript:`、URL 内嵌凭据和用户接管后的页面动作；离线错误保持合法 MCP 响应。
- 命令：`node --check mcp/corvid.mjs`、`node --check tests/mcp-e2e.cjs`、`git diff --check`、`env -u ELECTRON_RUN_AS_NODE node tests/mcp-e2e.cjs`、`env -u ELECTRON_RUN_AS_NODE npm test`；通过。全量套件 37 条串行命令 / 39 项 Electron E2E 全部完成。
- REA 只读现场证据：EGO 窗口 `ev_3a5609d1eb705ccdf3c5071061a8a6b7aafa5a604f570f210b9c81a8a5c86e5e` 显示常规浏览器栏与 Space 入口；Kaze 窗口 `ev_3c3ee4f92ab10275d5eaae96a797c818258f403328128bf9ee16d740bbdb9067` 显示 Browser/Skills/Scheduled/Activity 侧栏、Space/标签与网页主画布。Kaze 精确源码查询、BrowserMCP 源码分析见[双浏览器参照分析](../research/browser-reference-analysis.md)。

### 覆盖与限制

- MCP E2E 只使用本地页面 fixture，不连接真实 MCP host 或真实网站；MCP host 的用户确认体验、打包启动入口、Windows 尚未验证。
- REA 静态 Kaze 图谱只选了 `out/main/agent.js` 与 `out/preload/shell.cjs`，并记录安装包中 5 个 unpacked native 文件的完整性矛盾；不能证明运行时调用与授权实现。现场窗口只观察可见布局，未执行点击或读取私人页面内容来形成产品结论。
- 尚未提供 MCP 页面上下文确认、执行风险复核界面、暂停/恢复、文件上传、任意 `evaluate`/CDP 或 Tab/Room 生命周期工具；D20 维持“部分”。

## 2026-11-02 Pi 任务卡信息层级与控制状态

### 执行与结果

- 任务首条用户目标作为标题显示；运行状态单独呈现；Pi runtime 与来源页面作为上下文单独显示，避免状态行因长 URL/标题被截断。
- Room 处于用户控制时，任务状态“等待用户”与控制权状态“用户控制中”分别显示；接管事件仍保留在任务记录中。
- 命令：`node --check desktop/renderer.js`、`node --check tests/pi-workbench-e2e.cjs`、`git diff --check`、`env -u ELECTRON_RUN_AS_NODE node tests/pi-workbench-e2e.cjs`；全部通过（EXIT 0）。环境为本机 macOS、Node.js v24.22.1、Electron 45.2.1、临时 `CORVID_DATA_DIR` 与本地 HTTP fixture；没有调用真实模型/provider。
- 随后 `env -u ELECTRON_RUN_AS_NODE npm test` 全量通过（37 条命令 / 39 项 E2E，EXIT 0）；所有测试使用各自的临时数据目录和本地 fixture。另完成默认窗口宽度下的一次截图目视检查，见[UI 检查记录](../qa/ui-visual-check.md#2026-11-02-pi-任务卡状态层级检查)。

### 覆盖与限制

- 验证真实 Electron 下目标/状态/页面上下文分离及用户接管期间的双状态；完整 task recovery/continuation 流程在同一用例中继续通过。
- 截图检查与自动化均未覆盖窄窗、屏幕阅读器、真实 Pi provider 或其他平台表现；这些继续保留为未验证。

## 2026-11-02 Chrome 导入目标 Profile 选择与跨 Profile E2E

### 执行与结果

- 导入流程提供显式 Corvid 目标 Profile 下拉框，初始选中当前活动 Profile，用户可在首次提交前改选；提交开始后目标被锁定，部分失败可在同一 Profile 安全重试。
- 真实 Electron E2E 在活动 Profile 为“Imported work”时，将 Chrome “Profile 1”的书签与历史直接导入 Corvid `default`，并断言工作 Profile 没有收到这些资料；随后将扩展单独导入 `Imported work`，验证扩展仍只在目标 Profile 加载；故障与部分成功后目标保持锁定，重试不会切换 Profile。
- 命令：`node --check desktop/renderer.js`、`node --check tests/chrome-import-e2e.cjs`、`env -u ELECTRON_RUN_AS_NODE node tests/chrome-import-e2e.cjs`；全部通过（EXIT 0）。

### 覆盖与限制

- 使用合成 Chrome Profile、测试目录选择器替身与隔离 Electron 数据目录；未读取真实 Chrome 数据或真实系统钥匙串。

## 2026-11-02 restore-loading 清理挂起复验：Issue #34 按非复现关闭

### 执行与结果

- `env -u ELECTRON_RUN_AS_NODE node tests/restore-loading-e2e.cjs` 连续两次独立运行通过并以 EXIT 0 结束；清理诊断显示 `app.close()` 后 Electron 子进程退出码 0，fixture HTTP server 随后关闭。
- `env -u ELECTRON_RUN_AS_NODE npm test` 全部 37 条命令 / 39 项测试通过并以 EXIT 0 结束；`restore-loading-e2e` 之后的 Pi、MCP、Chrome 导入和导航用例均执行。
- 清理上一轮遗留测试进程后未能重现挂起，没有发现需要修改产品生命周期代码的问题。移除临时诊断日志后再次运行独立用例，确认常规清理路径仍退出正常。Issue #34 已记录以上证据并关闭。

### 覆盖与限制

- 本次复验在 macOS、Node.js v24.22.1、Electron 45.2.1 和隔离临时数据目录运行；结果不能排除其他平台或环境下偶发的进程清理问题。

## 2026-11-02 Chrome Cookie 单项写入失败分类与同源重试

### 执行与结果

- 真实 Electron + 合成 Chrome Profile：只注入一次指定 Cookie 的写入失败；UI 将结果显示为部分导入，并把写入失败与不支持项分开计数，不显示 Cookie 名称、域名或值。
- 其他有效 Cookie 正常导入；同一导入对话框重试后，失败 Cookie 成功写入，已成功 Cookie 按冲突/去重规则跳过；Corvid 目标 Profile 得到四项且 Chrome Cookie 文件哈希保持不变。
- 命令：`node --check desktop/main.cjs`、`node --check desktop/renderer.js`、`node --check tests/chrome-import-e2e.cjs`、`git diff --check`、`env -u ELECTRON_RUN_AS_NODE node tests/chrome-import-e2e.cjs`；定向测试通过。随后一次全量尝试在 `restore-loading-e2e` 输出 PASS 后，Electron/Node 子进程超过 6 分钟仍未退出；为结束挂起进程而终止该次运行，因此没有全量退出码，跟踪见 [Issue #34](https://github.com/heyallencao/corvid/issues/34)。此前同一代码切片在测试用真实点击替代脚本点击前的全量回归曾通过；最新真实点击行为由 Chrome 导入定向 E2E 覆盖。

### 覆盖与限制

- 故障仅在 `CORVID_TEST_MODE=1` 且设置 `CORVID_TEST_CHROME_COOKIE_SET_FAIL_NAME` 时触发；不访问真实 Chrome Profile 或系统钥匙串。
- 验证 macOS 真实 Electron 与临时 Profile；原生钥匙串授权、Windows、打包版及真实 Chrome 数据未覆盖。

## 2026-11-02 浏览器主框架导航失败提示与重试

### 执行与结果

- 真实 Electron 中断连导航显示中文失败原因和重试按钮，地址栏保留失败 URL；本地服务恢复后重试成功，错误提示清除。
- 新导航开始显示加载状态；替代挂起导航后不遗留旧错误。导航错误按标签状态呈现，切到另一标签不泄漏，切回后原失败 URL 和重试状态仍可见。
- 修复真实 Electron 回归中发现的新标签初始化竞态：空白标签创建后立刻成为活动标签，但界面此前等 Chromium 初始化完成才收到状态，快速输入网址会导航到旧标签；现在用户新建标签时立即广播活动状态，并验证界面选中状态与地址栏目标一致。
- 命令：`node --check desktop/main.cjs`、`node --check desktop/renderer.js`、`node --check tests/navigation-error-e2e.cjs`、`git diff --check`、`env -u ELECTRON_RUN_AS_NODE node tests/navigation-error-e2e.cjs`、`env -u ELECTRON_RUN_AS_NODE npm test`；定向用例和全量 37 条命令 / 39 项测试通过（EXIT 0）。

### 覆盖与限制

- 使用临时 Corvid 数据目录和本地 HTTP fixture；不访问真实网站或用户 Profile。
- 只将常见 DNS/断网/拒绝连接/超时与证书错误映射为有限中文说明；未覆盖所有 Chromium 网络错误、代理配置、Windows 和原生证书详情页。

## 2026-11-02 Chrome Cookie 钥匙串单独同意门槛

### 执行与结果

- 选择 Cookie 类别后显示独立说明，写明 macOS 钥匙串访问目标、用途、拒绝/取消时不写入以及目标 Corvid Profile；未勾选同意时“导入”按钮保持禁用。
- 主进程通过共享校验拒绝缺少同意的 Cookie 请求；只导入书签等非敏感类别不需要 Cookie 同意；Cookie 平台仍限制为 macOS。
- 命令：`node --check desktop/renderer.js`、`node --check desktop/main.cjs`、`node --check desktop/chrome-import.cjs`、`node --check tests/chrome-import-e2e.cjs`、`git diff --check`、`env -u ELECTRON_RUN_AS_NODE node tests/chrome-import-e2e.cjs`、`env -u ELECTRON_RUN_AS_NODE npm test`；全部通过（EXIT 0）。

### 覆盖与限制

- UI 使用真实 Electron 与合成 Chrome Profile；校验 macOS/Windows 平台规则使用纯函数参数，不读取开发机 Chrome 数据。
- 测试密钥绕过真实 Keychain prompt；钥匙串允许、拒绝和原生提示布局仍待人工 macOS 验收。

## 2026-11-02 Chrome Cookie 冲突保留与新增导入 E2E

### 执行与结果

- 在 Corvid 目标 Profile 预置同域、同名、同路径但值不同且有有效期的 Cookie，再导入 Chrome Cookie；冲突项计为跳过，目标值在首次尝试、故障回滚、成功重试及重启后均保持不变。
- 另一个非冲突的持久 Chrome Cookie 成功导入并跨重启保留；HostOnly 会话 Cookie 仍按会话语义在退出后失效，其他 Profile 不可见。
- 命令：`node --check tests/chrome-import-e2e.cjs`、`git diff --check`、`node tests/chrome-import-e2e.cjs`；全部通过（EXIT 0）。

### 覆盖与限制

- 使用合成 Chrome Cookie fixture 与临时 Electron Session；没有访问真实 Chrome Profile 或系统钥匙串。
- 验证同一 domain/name/path 的冲突策略，不代表对所有 SameSite、partition key 与浏览器版本的完整迁移兼容。

## 2026-11-02 Chrome 书签/历史导入原子替换与重试 E2E

### 执行与结果

- 在已有书签库上，从真实 Electron 导入 UI 注入一次 `library.json` 替换失败；验证旧库字节不变、临时文件已清理、Chrome 书签与历史没有部分追加。
- 同一导入窗重试后，书签/历史与所选扩展成功导入；Cookie 类别按既有去重合同处理。
- 故障注入仅在 `CORVID_TEST_MODE=1` 且显式设置 `CORVID_TEST_CHROME_LIBRARY_IMPORT_FAIL_RENAME_ONCE=1` 时生效。
- 命令：`node --check desktop/library.cjs`、`node --check tests/chrome-import-e2e.cjs`、`git diff --check`、`node tests/chrome-import-e2e.cjs`；全部通过（EXIT 0）。

### 覆盖与限制

- 用可控的写入后、重命名前故障验证原子替换的失败合同；真实磁盘满、只读权限、文件系统与崩溃时序仍未覆盖。
- 未访问开发机真实 Chrome Profile 或系统钥匙串。

## 2026-11-02 Chrome Cookie 回滚失败提示 E2E

### 执行与结果

- 在隔离真实 Electron 用例中先注入 Cookie 导入 flush 失败，再注入回滚 flush 失败；导入结果明确提示回滚未完整完成、Profile 可能仍有 Cookie，且同时保留原始失败原因。
- 验证目标 Session 中已新增 Cookie 被移除，手动冲刷清理结果后可从同一 Chrome 来源重试成功；未访问真实 Chrome Profile 或系统钥匙串。
- 命令：`node --check desktop/main.cjs`、`node --check tests/chrome-import-e2e.cjs`、`git diff --check`、`node tests/chrome-import-e2e.cjs`；全部通过（EXIT 0）。
- 全量回归：`env -u ELECTRON_RUN_AS_NODE npm test`，36 条命令、38 项通过（EXIT 0）。

### 覆盖与限制

- 故障注入仅在 `CORVID_TEST_MODE=1` 且显式设置对应 `CORVID_TEST_CHROME_COOKIE_*_FAIL_ONCE=1` 时启用。
- 已验证回滚持久化失败时的告警；删除新增 Cookie 或恢复既有 Cookie 本身失败的故障注入，以及真实磁盘损坏仍未覆盖。

## 2026-11-02 Chrome Cookie 持久化故障回滚与重试 E2E

### 执行与结果

- 在隔离的真实 Electron E2E 中，仅测试模式下让首次 Cookie `flushStore` 抛出一次合成故障；界面显示错误，导入器删除本次已写 Cookie 并完成回滚持久化。
- 检查目标 Profile Cookie store 为空、未选中的书签/历史没有变化；同一导入窗直接重试后两项支持 Cookie 成功写入，未知版本与分区 Cookie 仍显示不支持。
- 命令：`node --check desktop/main.cjs`、`node --check tests/chrome-import-e2e.cjs`、`git diff --check`、`node tests/chrome-import-e2e.cjs`；全部通过（EXIT 0）。
- 全量回归：首次运行在 `restore-loading-e2e` 超过 5 分钟未完成；该用例单独运行通过，第二次 `env -u ELECTRON_RUN_AS_NODE npm test` 全部通过，36 条命令、38 项（EXIT 0）。

### 覆盖与限制

- 故障注入仅在 `CORVID_TEST_MODE=1` 且显式设置 `CORVID_TEST_CHROME_COOKIE_FLUSH_FAIL_ONCE=1` 时生效；没有读取真实 Chrome 数据或系统钥匙串。
- 该用例验证整体 flush 失败后的 Cookie 回滚与重试，不覆盖单 Cookie 写入失败时的部分成功语义、书签/历史原子写入失败、真实磁盘 I/O 故障及进程强杀。

## 2026-11-02 Chrome Cookie 导入真实 Electron Session 验收

### 执行与结果

- 在 Chrome 导入 E2E 中使用隔离合成密钥覆盖，仅在 `CORVID_TEST_MODE=1` 下绕过系统钥匙串；真实 macOS 钥匙串未访问。
- 真实 Electron 将解密 HostOnly Cookie 和 Domain Cookie 写入指定 Profile；E2E 验证其他 Profile 不可见，Cookie 源数据库哈希不变，持久 Cookie 跨重启保留，会话 Cookie 在 Corvid 退出后按会话语义失效。
- Cookie 导入状态现展示新增、重复跳过和不支持数量。合成 v20/分区 Cookie 显示为不支持，重复运行显示跳过数。

### 覆盖与限制

- 未运行系统钥匙串实际授权/拒绝流程；未使用开发机真实 Chrome Profile。非 macOS Cookie 导入仍标记不支持。
- 同日 REA 对安装版 Ego 的隔离 provider-owned 启动未完成：应用启动超时，日志为应用 Mach IPC `bootstrap_check_in` 权限拒绝；REA 清理后无运行进程，未访问现有用户 Profile，也没有运行 UI 证据。此结果只记录为未验证，不代表 Ego 产品缺少该功能。

## 2026-11-02 Chrome 扩展迁移切片：定向真实 Electron E2E 通过

### 执行与结果

- 命令：`node --check desktop/main.cjs`、`node --check desktop/chrome-extensions.cjs`、`node --check desktop/renderer.js`、`node --check tests/chrome-import-e2e.cjs` 与 `node tests/chrome-import-e2e.cjs`；全部通过。随后运行 `env -u ELECTRON_RUN_AS_NODE npm test`，36 条命令、38 项通过（EXIT 0）。
- 合成两份 Chrome Profile 与本地 HTTP 页面；验证扩展导入、最新版本选择、无效 manifest 过滤、扩展目录符号链接失败清理、实际 content script 执行、权限展示、Profile 隔离、重复导入、停用/移除、跨重启恢复及源 Profile 文件哈希不变。
- 运行环境：macOS、Electron 45.2.1；不读取真实 Chrome Profile。

### 覆盖与限制

- 扩展导入前由用户逐项选择；复制到 Corvid 管理目录后按目标 Profile 加载，设置可启停/移除。合成 MV3 content script 在真实 Electron 页面中实际运行。
- Electron 只支持部分 Chrome API；不代表 Chrome Web Store 扩展全面兼容。未覆盖扩展更新、真实扩展样本、完整权限撤销、Windows/打包版与真实 Chrome 目录。

## 2026-11-02 Google Chrome 导入首启与隔离验收：36 条命令、38 项通过

### 执行与结果

- 命令：`node tests/chrome-import-e2e.cjs` 定向 E2E 通过（EXIT 0）；修正测试隔离开关及过期 UI 测试合同后，`env -u ELECTRON_RUN_AS_NODE npm test` 的 36 条命令、38 项全部通过（EXIT 0）。
- 本轮新增合成 Chrome User Data 多 Profile fixture 和真实 Electron UI 测试。首次运行先暴露首启导入引导缺失：Pi 工作台初始化早于旧数据检测并创建 `agent-tasks.json`，误判为既有 Corvid 数据；已将旧数据快照移至主进程初始化早期，并由干净/既有/待选择重启用例覆盖。测试模式默认关闭首启引导，仅该导入测试通过专用环境标记显式启用。全量回归还校正了跟随 UI 文案变化后过期的 Space 菜单与 Pi 回复文本测试选择器。
- 环境：macOS、Node.js v24.22.1、Electron 45.2.1；临时 Corvid 与 Chrome Profile 数据目录；对话框目录选择器由测试替身提供。

### 覆盖与限制

- 验证多 Chrome Profile 发现，书签与历史解析、UI 导入、Corvid Profile 归属和隔离、重复导入去重、源书签/历史哈希不变、合成 macOS v10 Cookie 解密与属性保留、首次导入/稍后状态持久化。
- 未访问真实 Chrome Profile；未读取系统钥匙串或验证 Cookie 写入目标 UI；已保存密码、原生选择器、打包版与 Windows 未覆盖。扩展迁移已由后续切片覆盖，扩展更新与完整 API 兼容仍未覆盖。D13 保持部分。

## 2026-11-02 Pi Agent 用户接管与续聊回归：35 条命令、37 项通过

### 执行与结果

- 命令：`env -u ELECTRON_RUN_AS_NODE npm test`；35 条命令、37 项全部通过（EXIT 0）。`git diff --check` 与四个改动入口的 `node --check` 通过。
- 增补：用户在完成任务后发送后续消息，Pi 使用 task 专属 transcript 继续；重启后的未完成任务显示为结果未知，用户重新检查页面上下文并确认后可继续；用户接管 Room 时运行中的 Pi task 进入等待态并 abort，交还后用新页面上下文再次确认可在同一 task/transcript 续聊。
- 环境：macOS、Node.js v24.22.1、Electron 45.2.1；隔离临时 Corvid/Pi 配置目录、本地 HTTP 页面夹具。

### 覆盖与限制

- Pi SDK `SessionManager.open` 使用合成 session header 验证 session 恢复初始化；拒绝 task transcript 路径越界；工具 allowlist 保持仅限 Corvid 浏览器工具。
- Electron E2E fixture 验证同一 task/Profile/Room/Tab 下首轮、后续轮、重启结果未知、显式重新确认后继续、用户接管期间页面导航、交还后同 transcript 续聊及删除 transcript。
- 没有调用真实模型/provider；真实 provider 的断连/崩溃 transcript 完整性、交还后自动继续（当前由用户显式发起）、凭据/费用界面、Windows 与打包仍未验证。D19 仍为部分。

## 2026-11-02 Corvid Pi Agent 工作台首段回归：35 条命令、37 项通过

### 执行与结果

- 命令：`env -u ELECTRON_RUN_AS_NODE npm test`；35 条命令、37 项全部通过（EXIT 0）。另 `git diff --check` 通过。
- 新增桌面入口：`tests/pi-workbench-e2e.cjs`；Pi runtime 合同由 `tests/pi-runtime-e2e.cjs` 回归。
- 环境：本机 macOS、Node.js v24.22.1、Electron 45.2.1；独立临时 Corvid 数据目录、本地 HTTP 页面夹具和 `CORVID_TEST_MODE=1`。

### 覆盖与限制

- 桌面内创建独立 Agent Room；显式预览 URL/title/结构化页面快照；未勾选上下文同意时禁止启动；保存 Pi 事件输出、任务/Profile/Room/Tab 绑定；完成状态可见。
- 重启把未完成任务恢复为“结果待检查”；移除任务同时清理 task 专属 Pi transcript 目录。
- 测试 session 是明确标识的本地确定性 fixture，没有调用真实 Pi prompt 或 provider。真实模型凭据/费用、接管后同会话继续、Pi transcript 恢复、Windows/打包与真实网站均未验证；完整 D19 仍未完成。

## 2026-11-02 Pi SDK runtime 基础回归：34 条命令、36 项通过

### 执行与结果

- 命令：`env -u ELECTRON_RUN_AS_NODE npm test`；34 条命令，含 3 个 `node:test` 用例与 33 个独立脚本，36 项全部通过（EXIT 0）。
- 新增：`node tests/pi-runtime-e2e.cjs`；另执行 `npm ci`（lockfile clean install）、`node --check desktop/pi-agent.cjs` 与 `npm audit --audit-level=high`（0 vulnerabilities）。
- 环境：本机 macOS；Node.js v24.22.1；Electron 45.2.1；Pi SDK 1.4.0；临时 Corvid 数据目录和临时 Pi 配置目录。

### 覆盖与限制

- session 创建、任务隔离 transcript 目录、显式页面上下文确认、Profile/Room/Tab 绑定、用户控制 Room 拒绝、仅两个 Corvid 浏览器工具可用；Pi 默认 filesystem/shell 工具、extensions、skills、prompt templates、themes 与 context files 均关闭。
- 未调用真实模型或 `session.prompt()`，未验证首条 transcript 写入/恢复、模型凭据、桌面工作台和任务 UI。此结果只证明 Pi runtime 接入基础和授权边界。
- npm 在安装时阻止了两个依赖的安装脚本（Google GenAI 的 no-op 与 protobufjs 版本告警脚本）；session 初始化与全量测试通过，不需要批准执行这些脚本。

## 2026-11-02 Corvid stdio MCP 只读工具回归：33 条命令、35 项通过

### 执行与结果

- 命令：`env -u ELECTRON_RUN_AS_NODE npm test`；33 条命令，含 3 个 `node:test` 用例与 32 个独立脚本，35 项全部通过。
- 新增单项：`node tests/mcp-e2e.cjs`，另执行 `npm audit --audit-level=high`（0 vulnerabilities）与 `node --check mcp/corvid.mjs`。
- 环境：本机 macOS；Node.js v24.22.1；Electron 45.2.1；各测试使用临时 `CORVID_DATA_DIR`。MCP 通过本地 JSON-RPC stdio 客户端夹具交互。

### 覆盖

- MCP initialize、tools/list、tools/call；五个工具全部标记只读；Profiles、Rooms、Tabs、Page info 与 snapshot。
- 显式 Profile/Room 参数、未知 Profile/Tab 稳定错误、Room 用户接管时拒绝页面读取、调用前后 Room 数量不变。
- 桌面未运行时仍经 stdout 返回有效 MCP tool error。

### 未覆盖边界

- 未在 Claude Desktop、Cursor 等真实 MCP Host 界面手工配置；未验证打包后命令、Windows、真实网站、真实用户数据或模型调用。
- 工具只读，尚无 MCP 写操作；页面工具限定 Agent-owned Room，用户控制或执行风险状态不读取页面。
- 本轮未接入 Pi runtime；Pi SDK 选型及后续边界记录在 Issue #5 与架构文档。

## 2026-11-02 Agent Room 面板端到端回归：32 条命令、34 项通过

### 执行与结果

- 命令：`env -u ELECTRON_RUN_AS_NODE npm test`；串行执行 32 条命令，包含 1 条 `node --test tests/*.e2e.mjs`（3 项）与 31 个独立 Electron 脚本，34 项全部通过（EXIT 0）。
- 环境：本机 macOS；Node.js v24.22.1；Electron 45.2.1；测试各自使用隔离临时 `CORVID_DATA_DIR` 与本地/空白页面，不访问真实用户浏览数据。
- 新增测试：`tests/agent-rooms-panel-e2e.cjs`。

### 本轮新增覆盖

- 面板开合、空态，以及 Agent Room 创建后状态实时出现。
- 同 Profile 可同时显示多个 Agent Room；其他 Profile 的 Room 名称不出现在当前列表。
- 640 px 窗口下列表行无横向溢出。
- 键盘 Tab/Enter 可接管 Room 并交还 Agent；查看 Room 后面板关闭且活动 Room 切换正确。
- 超时执行显示风险状态；“复核”入口交给用户控制并保留风险提示。

### 测试替身与未验证边界

- 页面为 `about:blank`；执行风险复核对话框使用 Electron 测试替身。本测试证明本地 Room 状态与界面流转，不验证真实模型、内置 Agent 执行、真实网站、原生对话框或 Windows。
- 多窗口间面板状态推送、同步 Renderer 卡死和完整任务历史仍未覆盖。

## 2026-11-02 Agent Room 面板人工检查

### 执行与结果

- 命令：`CORVID_DATA_DIR=/tmp/corvid-panel-qa.gpVWaB npm start`；临时数据目录下运行桌面应用，并通过应用本地控制接口创建一次性 Agent Room。
- 环境：本机 macOS；Electron 45.2.1；默认 Profile；空白 `about:blank` 页面；未连接真实网站或用户浏览数据。
- 覆盖：Agent 工作区按钮与面板开合；无 Agent Room 的空态；Agent Room 行显示控制状态和标签数量；“接管”后状态显示“用户控制中”；“交还 Agent”后恢复；“查看”切换到该 Room 并关闭面板。
- 结果：上述人工操作均按预期显示。检查中发现搜索框对该列表无用，已隐藏。
- 未运行自动化测试。本次未检查跨 Profile 隔离、执行风险复核、慢/断连状态、窄窗口与键盘操作；面板仍只展示 Room 当前状态，不提供内置模型执行或任务历史。
- Issue：[Add a first-class Agent Room activity panel](https://github.com/heyallencao/corvid/issues/1)。

本记录是隔离数据目录中的人工冒烟检查，不替代端到端验收。功能状态在对应 E2E 合同通过前不得标为“部分”或“已验证”。

## 2026-11-01 产品化第三批回归（多窗口）：31 条命令、33 项通过

### 执行与结果

- 命令：在项目根目录执行 `env -u ELECTRON_RUN_AS_NODE npm test`。串行执行 31 条命令：1 条 `node --test tests/*.e2e.mjs`（内部 3 个 `node:test` 文件）加 30 条独立脚本命令，合计 33 项入口，全部通过（EXIT 0）。
- 环境：本机 macOS；Electron 45.2.1；Node.js ≥ 22.12；每项使用隔离临时 `CORVID_DATA_DIR`、`CORVID_PORT=0`、`CORVID_TEST_MODE=1` 与本地 HTTP 夹具。
- 新增测试：`tests/multi-window-e2e.cjs`；`tests/window-state-e2e.cjs` 扩展为数组状态及旧单窗口状态读取。

### 本轮新增覆盖

- **多窗口 UI**：从 shell 窗口创建第二个 BrowserWindow；每窗只列出自己的 Room；Agent 控制 API 汇总所有窗口，且可操作后台窗口 Room。
- **关闭与恢复**：关闭一个窗口后其 Room 转到剩余窗口；进程退出时最终会话状态和窗口状态落盘；重启后恢复窗口 ID、Room 归属与每窗 Room 列表。
- **会话格式**：`rooms.json` 使用 `schemaVersion=2`，包含窗口活动 Room/Profile 与 Room 的 `windowId`；v1 单窗口会话在读取时迁移到兼容内存表示，下次持久化写为 v2。
- **窗口状态**：窗口几何信息按窗口 ID 关联恢复，仍读取早期单对象窗口状态格式；坏状态回退、离屏坐标回退保留回归覆盖。

### 测试替身与未验证边界

- 页面使用本地 HTTP 夹具；没有连接真实网站或用户数据。
- 未验证 Windows、多显示器排列、窗口焦点与键盘切换顺序、窗口崩溃/强制终止恢复、打包应用；macOS 会对窗口 y 坐标做小幅系统调整。
- 完整通过只表示本机 Electron 45.2.1 与上述夹具条件下结果通过，不覆盖原生系统对话框。

本文件按时间倒序记录 Corvid 的端到端验证。每条记录必须包含：执行命令、时间、操作系统、Electron 版本、数据目录与夹具、覆盖范围、结果、测试替身和未验证边界。结论只在当次环境与夹具范围内成立；"通过"不等于功能完成。工作块与验收合同见 [执行任务板](../execution/feature-board.md)，逐项测试说明见 [端到端测试索引](../qa/e2e-suites.md)。

## 2026-11-01 产品化第二批回归（标签固定与右键菜单）：30 条命令、32 项通过

### 执行与结果

- 命令：在项目根目录执行 `env -u ELECTRON_RUN_AS_NODE npm test`。脚本串行执行 30 条命令：1 条 `node --test tests/*.e2e.mjs`（内部 3 个 `node:test` 文件）加 29 条独立脚本命令，合计 32 项测试入口，全部通过（EXIT 0）。
- 环境：本机 macOS；Electron 45.2.1；Node.js ≥ 22.12；每项使用 `mkdtemp` 临时数据目录与 `CORVID_PORT=0`、`CORVID_TEST_MODE=1`；页面来自本地 HTTP 夹具。
- 新增测试：`tests/tab-pin-menu-e2e.cjs`（该文件连跑 3 次均通过，再纳入全量回归）。

### 本轮新增覆盖

- **标签固定**：`setTabPinned` 只允许用户操作；固定标签始终位于 `tabIds` 前段（`normalizeTabOrder`）；`reorderTabs` 校验固定分组边界，跨组拖拽在渲染层回弹、不会隐式改变固定状态；`pinned` 写入 `rooms.json` 并在重启后恢复；固定标签显示固定图标与边框。
- **关闭语义**：`closeTabFromUser` 对固定标签先弹确认（取消保留、确认移除，并在确认后重新校验标签未变）；`closeOtherTabs` 跳过固定标签、按标签逐个关闭并在部分失败时报出已完成数量；Agent 路径（`closeTab`/`finish`/`closeRoom`）行为不变，固定状态不改变 `openedBy` 归属。
- **右键菜单**（应用内 DOM 菜单，`role=menu`/`role=menuitem`）：固定/取消固定、重新加载、复制链接（`clipboard.writeText`）、关闭标签、关闭其他标签；菜单作用于打开它的标签而非当前激活标签；点击其他位置或按 Escape 关闭。
- **拖拽与固定共存**：标签栏增量渲染的签名包含 `pinned`，固定状态变化会重建标签栏，其余状态更新不会。

### 测试替身与未验证边界

- `dialog.showMessageBox`（关闭固定标签确认）与 `clipboard.writeText`（复制链接）在应用进程内被替换；只验证调用路径与状态流转，不验证原生确认框外观，也不验证系统剪贴板真实内容。
- 右键菜单是应用内 DOM 菜单；**原生（系统）右键菜单未实现也未验证**。
- 未验证：标签分组、多窗口、最后标签关闭策略、拖拽在 Windows/真实窗口管理器上的表现、长标签标题截断、固定标签与 Agent 并发操作的交互（本轮未覆盖 Agent 与用户同时操作的时序）。
- 计数口径：32 项 = 3 个 `node:test` 文件 + 29 个独立脚本；30 条命令 = 1 条 `node --test` + 29 条独立脚本。
- 测试稳定性：本项开发中先出现两处夹具竞态（`#new-tab` 点击后未等渲染器跟上就向地址栏输入，导致导航落到上一个标签；重启后 0 标签时的同类竞态）。已在测试侧改为等待渲染器状态（标签栏数量与地址栏内容）再输入；这属于测试夹具修复，但说明"渲染器状态滞后于主进程状态"是真实存在的窗口，用户手速无法触及，记录在此备查。

## 2026-11-01 产品化第一批回归：29 条命令、31 项通过

### 执行与结果

- 命令：在项目根目录执行 `env -u ELECTRON_RUN_AS_NODE npm test`（在 DSH 沙箱内需清理该变量，避免 Electron 以 Node 模式启动）。脚本串行执行 29 条命令：1 条 `node --test tests/*.e2e.mjs`（内部 3 个 `node:test` 文件）加 28 条独立脚本命令，合计 31 项测试入口，全部通过。
- 环境：本机 macOS；Electron 45.2.1；Node.js ≥ 22.12；每项使用 `mkdtemp` 临时数据目录与 `CORVID_PORT=0`、`CORVID_TEST_MODE=1`；下载类使用 `CORVID_TEST_DOWNLOAD_DIR`；页面来自本地 HTTP 夹具。
- 前置基线：目录从 `go-lite` 改名为 `corvid` 后，先不改代码执行旧套件，26 条命令 / 28 项全绿，确认改名未破坏路径假设。
- 新增测试：`tests/tab-ux-e2e.cjs`、`tests/window-state-e2e.cjs`、`tests/download-file-ops-e2e.cjs`。
- 版本：`package.json` 从 0.1.0 升到 0.2.0（产品化第一版）。

### 本轮新增覆盖

- **页内查找**：Cmd/Ctrl+F 经主进程 `before-input-event` 打开查找条；输入即查找并显示 `当前/总数`；Enter 前向、Shift+Enter 反向、Esc 关闭；切换标签时自动关闭并调用 `stopFindInPage(clearSelection)`；页面主文档导航时发送重置事件（`shell-find-reset`）。
- **标签栏**：页面 `page-favicon-updated` 的 favicon 显示在标签上；指针拖拽排序，主进程校验 `tabIds` 集合后持久化顺序；中键关闭标签；查找条在标签切换时关闭。
- **窗口状态**：`window-state.json`（0600、临时文件 + rename 原子写）保存位置、尺寸、最大化状态，重启恢复；坏 JSON 回退默认 1280×850；保存位置落在已移除显示器上时保持尺寸并回到可见区域。
- **下载文件操作**：完成记录提供"打开"与"在文件夹中显示"，分别转发 `shell.openPath` / `shell.showItemInFolder`；操作系统返回错误时以 `role=alert` 呈现，下载文件内容不变。
- **标签栏增量渲染**：`draw()` 只在房间或标签内容（id/标题/URL/favicon/激活态）变化时重建标签栏，避免下载进度等无关状态更新在拖拽或点击关闭按钮时拆掉 DOM。
- **人眼布局检查**：对 shell 渲染进程截图核对标签栏、查找条与库面板布局，发现并修复"查找条遮挡工具栏按钮"（`top:82px` → `top:118px`），记录见 [桌面 UI 视觉检查记录](../qa/ui-visual-check.md)；截图未入库，页面内容（独立 `WebContentsView`）不在截图范围内。

### 测试替身与未验证边界

- `shell.openPath` / `shell.showItemInFolder` 由测试在应用进程内替换；只验证应用转发路径与错误呈现，不验证真实应用打开、真实文件管理器、真实权限拒绝。
- 既有系统对话框替身范围不变（见下一条记录）。
- 未验证：真实站点的 favicon 形态与查找高亮样式、长页面查找性能、跨 frame 查找高亮；拖拽排序在真实窗口管理器与 Windows 上的表现；多显示器热插拔、最大化/全屏切换；原生菜单、右键菜单；多窗口；真实保存对话框。
- 计数口径：31 项 = 3 个 `node:test` 文件 + 28 个独立脚本；29 条命令 = 1 条 `node --test` + 28 条独立脚本。
- 抖动与修复：全量回归中 `tab-ux-e2e` 曾出现一次 `boundingBox()` 返回 null（状态更新在拖拽测量期间重建了标签栏 DOM）。修复为标签栏增量渲染（内容未变则不重建），并让测试对坐标测量重试；随后该测试连跑 3 次通过，并在最终全量回归中通过。

## 2026-11-01 Snapshot v2 回归：26 条命令、28 项通过

### 执行与结果

- 命令：在项目根目录执行 `npm test`。脚本串行执行 26 条命令：1 条 `node --test tests/*.e2e.mjs`（内部 3 个 `node:test` 文件）加 25 条独立脚本命令，合计 28 项测试入口，全部通过。
- 环境：本机 macOS；Electron 45.2.1；Node.js ≥ 22.12；每项使用 `mkdtemp` 临时数据目录与 `CORVID_PORT=0`、`CORVID_TEST_MODE=1`；页面来自本地 HTTP 夹具（含两个来源用于跨源 iframe 计数）。
- 新增测试：`tests/snapshot-e2e.cjs`。

### 本轮新增覆盖

- Snapshot 范围：`page`（默认，含全部可见交互元素）、`full_page`（`page` 的别名）、`viewport`（绝对视口相交，跨 frame 坐标换算）、`subtree`（`root` 引用或选择器，支持 iframe 根）。
- 多层同源 iframe：递归遍历并标注 `frame`；`@N` 引用可作为 click/fill 等动作目标；同一节点在后续 snapshot 中保持同一引用。
- 选择器子集：`:has-text("...")`、`:text-is("...")`、`>> nth=N`（含 `-1`）。
- 跨源 iframe 内容不可见但计入 `inaccessibleFrames`；超过 200 项时 `truncated=true` 且 `total` 保留真实数量。
- 引用失效：主导航后 `@N` 引用报 `CORVID_STALE_REFERENCE`；`resolve` 内部路径也改用同一引用表，避免旧格式引用混入。

### 未验证与边界

- 跨源 iframe 内容、closed Shadow DOM 仍不可见；`subtree` 以跨源 iframe 为根会报错。
- 只测本地夹具；未验证真实站点的元素规模、懒加载与性能开销。
- 引用稳定性以文档为界：主文档导航后全部失效；帧内导航使该帧内节点失效。

## 2026-11-01 API 合同回归：25 条命令、27 项通过

### 执行与结果

- 命令：在项目根目录执行 `npm test`。脚本串行执行 25 条命令：1 条 `node --test tests/*.e2e.mjs`（内部 3 个 `node:test` 文件）加 24 条独立脚本命令，合计 27 项测试入口，全部通过。
- 环境：本机 macOS；Electron 45.2.1；Node.js ≥ 22.12；每项使用 `mkdtemp` 临时数据目录与 `CORVID_PORT=0`、`CORVID_TEST_MODE=1`；页面来自本地 HTTP 夹具。
- 新增测试：`tests/contract-e2e.cjs`（本轮新增的 Agent API 合同回归）。

### 本轮新增覆盖

- 键盘：`keyboard.type/press/down/up/insertText/paste`；`down`/`up` 维护修饰键状态，`paste` 使用系统剪贴板与 `webContents.paste()`，剪贴板恢复为 best-effort。
- 页面：`focus()`、`dblclick()`（可信双击事件序列）、`reload()`、`waitForTimeout()`、`info()`（`targetId`/`roomId`/加载状态/dialog）、`events()`（排空 popup 事件）、动作 `receipt`（`popups` + `dialog`）、`cdp()`（`Runtime.evaluate`、`Page.getLayoutMetrics`）。
- 错误码：SDK 运营错误使用 `CORVID_*` 代码（`TIMEOUT`、`NOT_FOUND`、`STALE_REFERENCE`、`CONTROL_LOST`、`EXECUTION_RISK`、`UNSUPPORTED`、`UNAUTHORIZED`、`DESKTOP_ERROR`）；桌面端按错误消息分类返回代码。参数形状错误仍使用 `TypeError`/`RangeError`。

### 未验证与边界

- 仍只覆盖本地夹具与单层文档；跨源 iframe、closed Shadow DOM、复杂嵌套未覆盖。
- 错误码映射基于桌面错误消息文本，未穷尽所有路径；新增错误必须补映射与测试。
- `keyboard.paste` 的系统剪贴板行为依赖平台，Windows 未验证；剪贴板内容恢复失败不会报错。
- `room.cdp()` 尚未提供，只有 `page.cdp()`。

## 2026-11-01 全量回归：24 条命令、26 项通过

### 执行与结果

- 命令：在项目根目录执行 `npm test`。脚本按固定顺序串行执行 24 条命令：1 条 `node --test tests/*.e2e.mjs`（内部运行 3 个 `node:test` 文件）加 23 条独立脚本命令，合计 26 项测试入口。
- 结果：24 条命令全部成功，26 项测试通过，无跳过项。
- 环境：本机 macOS；Electron 45.2.1；Node.js ≥ 22.12；每项使用 `mkdtemp` 临时数据目录，`CORVID_DATA_DIR` 指向该目录，`CORVID_PORT=0` 使用随机端口，`CORVID_TEST_MODE=1`；下载相关测试使用 `CORVID_TEST_DOWNLOAD_DIR`；页面夹具为本地 HTTP 服务（`127.0.0.1` 随机端口，部分测试用 `localhost` 制造跨来源）。
- 隔离：所有测试均未读取真实用户 Profile、真实历史/书签/下载或真实浏览器数据；结束后清理自己创建的进程与临时目录。`browser.e2e.mjs` 额外断言 `control.json` 权限为 0600，`/shutdown` 后文件被删除且端点不可用。

### 覆盖范围（按主题）

- **启动与恢复**：坏会话文件（非法 JSON、结构无效、重复 Room/标签 ID）拒绝启动并保留原文件；慢页面异步恢复不阻塞其他 Room 与控制接口，保存 URL 不被空白页覆盖；重启保持替换后的 URL 与 Page label（`recovery-e2e`、`restore-loading-e2e`、`cli-e2e`、`page-lifecycle-e2e`）。
- **控制权**：`yieldControl` 等待进行中动作；接管请求挂起期间拒绝新 Agent 动作；其他 Room 不受影响；`resumeControl` 恢复；用户手动接管跨重启保持；`waitForControl` 的超时与成功路径；Room 删除后等待报错（`browser.e2e`、`user-control-e2e`、`load-state-e2e`、`sdk-e2e`）。
- **权限与对话框**：通知权限先转交用户，允许/拒绝/查询/撤销、Profile 隔离、确认期间导航竞态、重启不保留；页面 alert/confirm/prompt 在动作挂起时经 SDK 应答（prompt 另支持桌面 UI），连续弹窗与连接中断后重连应答（`permissions-e2e`、`dialogs.e2e`、`dialogs-ui-e2e`）。
- **执行风险**：`evaluate` 超时与 `waitForFunction` 谓词超时进入风险态、阻止后续动作、晚到结果更新、重启 `unknown_after_restart`、桌面复核保留/清除（`browser.e2e`、`sdk-e2e`、`evaluation-risk-e2e`）。
- **浏览数据边界**：同 Profile 跨 Room Cookie 共享；跨 Profile Cookie/书签/历史/下载隔离；站点数据清理范围（Cookie、localStorage、IndexedDB、Cache Storage、Service Worker）；站点权限按 Profile + 来源；确认期间来源/Profile 改变则拒绝（`site-data-e2e`、`profiles-e2e`、`permissions-e2e`、`browser.e2e`）。
- **Page/SDK/CLI**：`openRoom` 创建/恢复、`listRooms`、`claimRoom`、`resumeRoom`；Page label `p1`–`p4` 跨重启、不复用、未知来源保护；`adopt`/`release`/`finish` 的 keep 策略与收据；Snapshot、定位、等待、截图、`evaluate`、`fetch`、对话框、上传、select、指针、Agent 下载（`sdk-e2e`、`rpc-e2e`、`cli-e2e`、`page-lifecycle-e2e`、`claim-e2e`）。
- **日常浏览**：地址栏导航、前进/后退/刷新、标签创建/切换/关闭、快捷键、缩放、搜索模板；历史/书签/下载的添加、删除、搜索、重启；Profile 创建/切换/重命名；关闭 Room；beforeunload；弹窗（`library-e2e`、`library-search-e2e`、`download-e2e`、`browser-shortcuts-e2e`、`profiles-e2e`、`room-close-e2e`、`beforeunload-e2e`、`popup-events-e2e`）。
- **桌面 UI 与下载路径**：站点数据、站点权限通过桌面按钮与状态提示验证；下载使用测试下载目录；Agent 下载断言未弹出系统保存对话框（`agent-download-e2e`）。

### 测试替身（系统对话框）

本轮的原生系统对话框不是真实交互，以下路径由测试在应用进程内替换：

- `dialog.showMessageBox`：通知权限确认、执行风险复核、Room 认领批准、关闭 Room 确认、站点数据清理确认、站点权限撤销确认。
- `dialog.showMessageBoxSync`：`beforeunload` 离开确认、标签关闭确认。
- `dialog.showSaveDialogSync`：普通下载保存路径；`download-e2e` 用 `CORVID_TEST_MODE=1` + `CORVID_TEST_DOWNLOAD_DIR` 绕开；`agent-download-e2e` 反向断言保存对话框未被调用。

这些替身验证的是应用状态流转（谁获得控制权、风险是否清除、数据是否按范围清理），不验证原生对话框的布局、按钮文案、键盘操作、平台差异或用户误操作。

### 未验证与已知限制

- **真实网站**：未访问真实登录态、复杂 CSP/CORS、Service Worker 站点、反自动化站点或需要真实证书的站点；全部页面来自本地夹具。
- **真实用户数据**：未使用真实 Profile、真实书签/历史/下载/Cookie；真实数据迁移与清理不能在测试中执行。
- **系统级交互**：真实保存对话框、真实权限弹窗、原生 beforeunload/关闭确认、系统默认浏览器与协议注册均未验证。
- **平台**：Windows 以及 macOS 打包/签名/公证/安装/升级均未验证；自动化只在 macOS 运行。
- **页面能力**：跨源 iframe 内容、closed Shadow DOM、复杂嵌套 frame 不支持或未验证；`networkidle` 未实现；截图未逐像素比对；`select` 与清空文件选择等路径使用非 `isTrusted` 合成事件。
- **稳定性**：同步 renderer 卡死、强制 kill、崩溃恢复、长时间运行、性能与资源上限未验证。
- **安全隔离**：本地控制服务只有一个共享 Bearer 凭据，没有按 Agent 身份隔离；任何持有凭据的本地客户端都可以按名称或 ID 恢复 Agent Room。不得据此宣称多 Agent 安全隔离。
- **其他**：多窗口、扩展、浏览器数据导入、自动更新未实现或未验证。

### 结论

本轮证明上述本地夹具与 macOS 环境内的 26 项行为通过；它不证明真实网站兼容性、原生对话框、Windows、打包分发或安全隔离。下一轮应按 [执行任务板](../execution/feature-board.md) 的验收合同补充未覆盖项，并在本文件顶部追加新记录。

## 重构前基线（历史记录汇总）

说明：重构前的验证日志按功能增量记录，未逐条保留命令与输出。以下是按主题汇总的覆盖范围，只作为回归与用例设计的参考，不能替代当前 32 项结果，也不能把旧计数当作当前套件规模。历史记录中的计数在 12–26 项之间且记录顺序有交错，反映当时套件规模；所有历史记录同样使用隔离临时数据目录与本地 HTTP 夹具，系统对话框已使用测试替身。

覆盖主题：

- **启动与恢复**：坏会话文件保护、慢页面恢复时其他 Room 与控制接口可用、原 URL 保留、历史不重复。
- **控制权**：接管/交还、进行中动作、等待控制、跨重启用户控制保持、风险未解决时等待超时、Room 删除。
- **权限**：通知授权范围、桌面 UI 撤销、Profile 与来源隔离、重启失效、确认期间导航竞态、等待接管期间到达的权限请求。
- **执行风险**：`evaluate` 超时、风险态阻止动作、重启、桌面复核。
- **数据边界**：站点数据清理、Profile 隔离、Profile 重命名、旧数据 schema 兼容。
- **Page/SDK/CLI**：CLI 多轮、Room 认领、页面生命周期、`finish` keep 策略、popup 等待与事件、Agent 下载、`page.fetch`、加载状态、截图、URL/选择器/函数等待、指针/select/上传/对话框。
- **桌面 UI**：地址栏/标签/快捷键/缩放/搜索模板、历史/书签/下载搜索、关闭 Room、beforeunload。
- **输入与页面操作**：click/fill/press 的 `isTrusted` 事件、同源 iframe、开放 Shadow DOM、悬停/拖放/滚轮、文件选择器。

已知限制（与当前一致）：系统对话框为测试替身；跨源 iframe 与 closed Shadow DOM 不支持；select 与清空文件选择使用非 `isTrusted` 事件；截图未逐像素；`waitForURL` 轮询可能错过短暂 URL；未覆盖真实网站、真实用户数据、Windows、打包分发、崩溃恢复与性能。

基线结论：当前 32 项是这些历史主题在概念重命名、API 合同、Snapshot v2 与产品化前两批后的回归集合；历史计数不再维护，后续以本文件的时间倒序记录为准。
