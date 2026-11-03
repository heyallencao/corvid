# 验证记录

## 2026-11-04 浏览身份删除用户流程（Issue #174）

- 环境：macOS；隔离 worktree `/private/tmp/corvid-issue174-profile-delete`；Electron 45.2.1；每次真实 Electron E2E 使用临时 `CORVID_DATA_DIR`、下载目录和本地 HTTP fixture；没有使用真实网站、模型、OAuth 或用户浏览器资料。
- 验证：`node --check desktop/renderer.js`、`desktop/main.cjs`、`tests/profile-deletion-e2e.cjs`；`node tests/profile-deletion-services.cjs` EXIT 0；`CORVID_PROFILE_DELETE_QA_DIR=/tmp/corvid-profile-deletion-qa node tests/profile-deletion-e2e.cjs` EXIT 0。模块合同逐类覆盖窗口、Room、进行中下载、Agent 对话和默认身份阻断；真实 Electron UI 覆盖窗口/空间阻断、取消无副作用、清理中的进度/禁用取消/Escape 阻断、首次 Session 清理失败的 `deletionPending` 与可见重试、Cookie/localStorage/书签/历史/下载记录清理、磁盘下载文件保留、重启不复活、同名新 ID 与干净站点存储。
- 双语与视觉：真实 Electron 中切换英文检查删除菜单/标题/阻断状态，并于 700×420 断言保留数据说明和重试/删除动作可见；常规中文和英文窄窗截图见 [UI 视觉检查记录](../qa/ui-visual-check.md#2026-11-04-浏览身份删除确认与窄窗布局-issue-174)。首次窄窗观察发现保留说明被操作区挤出，修改间距和 sticky 操作区后复验通过。
- 发现并修复：首次 E2E 发现主进程预筛窗口/Room 引用后未把 Profile ID 一同传进纯合同校验器，导致真实占用被错误判为空；现修复映射并增加逐类模块合同断言。首次清理失败的用户端错误也映射到明确的重试说明，不透出测试或内部错误名。
- 全量回归情况：`env -u ELECTRON_RUN_AS_NODE npm test` EXIT 1，27 个 `node:test` 用例和前置 43 条脚本（包含本切片 E2E）通过后，在现有 `tests/pi-workbench-e2e.cjs` 因 `#pi-task-form .pi-primary-action` 超时中止。为判断是否回归，在独立临时 worktree 的未改基线 `2286159` 上单独运行同一用例，也 EXIT 1（按钮定位超时）；该工作台覆盖由已有 [Issue #5](https://github.com/heyallencao/corvid/issues/5) 跟踪。本次随后单独运行其后 10 条脚本（Pi 工作台短窗、Agent 停止/端点、Chrome 导入、授权、导航、本地化和应用菜单），均通过。因此未把全量套件记为通过；此缺口在本切片之前已可复现。
- 限制：没有获得完整全量 `npm test` 通过结果；未使用真实 Agent Provider 或 OAuth；扩展和 Agent 运行时目录清理失败由模块注入合同覆盖，未在 UI E2E 逐项故障注入；未检查 SQLite/Chromium 文件层的每一类可恢复字节，也未覆盖其他操作系统或打包应用。Issue #174 尚待独立 review、主线集成和中文 PR。

## 2026-11-03 Corvid Agent 欢迎态短高窗口可读性（Issue #16）

- 问题：真实 Electron 在 704×420 窗口（shell 视口 704×388 CSS px）中，较长的欢迎说明被输入卡片遮挡；英文段落比中文占用更多行，单语截图不足以发现边界问题。
- 修复：`max-height:480px` 时收起装饰图标，让欢迎标题和双语说明使用整行宽度，并把说明精简为保留原意的短句；正文字号为 10px。窗口高度不超过 440px 时输入卡片上限为内容区 34%，441–480px 时为 52%，均保留独立滚动。420px 窗口中输入卡片首屏只显示部分内容，模型选择、提示词、页面复核仍通过卡片滚动访问。
- 验证：`CORVID_UI_EVIDENCE_PATH=docs/qa/screenshots/issue-16-agent-short-height-704x420.png env -u ELECTRON_RUN_AS_NODE node tests/pi-workbench-short-height-e2e.cjs` EXIT 0。断言 zh-CN/en 标题与完整的短版说明均位于消息区，和输入卡片无重叠；逐项滚动确认模型选择、提示词与页面复核按钮可见。`env -u ELECTRON_RUN_AS_NODE node tests/localization-e2e.cjs` 通过，确认双语资源、浏览器界面语言切换、窄窗可见性与重启持久化。隔离 `CORVID_DATA_DIR`、本地 HTTP fixture，未调用真实模型、Provider 或 OAuth。`pi-workbench-short-height-e2e.cjs` 已加入 `npm test`。
- 视觉参考：REA Kaze Agent 模型选择器 Evidence `ev_ae7cc8d9bebb43705bcdbb47eb75fc571bdd0ddc99e2c1d199e2d0cb80f6dcb7` 与 Kobra Composer Evidence `ev_668bf2245d384ec9265daab73179d0986212ea9968e2b05000bd13234459f8f9` 只支持常规窗口输入附近模型入口和有名称控件的有限观察；未观察两者短高窗口行为。细节、直接观察/推断/未知和覆盖限制见[UI 视觉检查记录](../qa/ui-visual-check.md#2026-11-03-corvid-agent-欢迎态短高窗口可读性-issue-16)。
- 失败基线与边界：本分支首次运行既有 `env -u ELECTRON_RUN_AS_NODE node tests/pi-workbench-e2e.cjs` 时在 `#pi-task-form .pi-primary-action` 等待超时，未由本切片修复或重跑通过；全量 `npm test` 未运行。短高用例只覆盖 macOS 开发版 Electron、浅色主题、一个窗口尺寸和本地页面 fixture；截图未包含独立网页 WebContentsView。VoiceOver、打包版、暗色主题及 Windows/Linux 未验证。

## 2026-11-03 macOS 全屏 E2E 异步最大化恢复竞态（Issue #168）

- 根因证据：隔离 Electron 45.2.1 中，关闭 HTML 全屏标签后原生 `BrowserWindow.isFullScreen()` 先变为 `false`，当时 `isMaximized()` 仍为 `false`，而 `window-state.json` 已保留原最大化状态；约 100ms 后原窗口恢复最大化，Corvid `/rooms` 全屏字段稍后才归零。产品状态最终恢复，失败源于测试仅等待原生全屏标志。
- 修复：`tests/fullscreen-e2e.cjs` 通过 `app.browserWindow(shell)` 固定跟踪原窗口，等待该窗口恢复最大化，并同时等待所有窗口的 Corvid `fullscreen`/`pageFullscreen` 状态清零后再断言重启前状态。
- 验收：`env -u ELECTRON_RUN_AS_NODE node tests/fullscreen-e2e.cjs` 通过。随后 `env -u ELECTRON_RUN_AS_NODE npm test` 通过 `fullscreen-e2e.cjs`，继续在 `tests/pi-workbench-e2e.cjs:99` 因 `#pi-task-form .pi-primary-action` 超时；这属于开放 Issue #5，另一个会话在独立 worktree 修改相同工作台测试，本轮没有触碰。全量回归仍未完成。
- 环境与边界：macOS、Electron 45.2.1、临时 `CORVID_DATA_DIR`、本地 HTTP 页面 fixture；未访问真实网站或个人数据，未调用 OAuth/模型。未验证 Windows/Linux、打包版与屏幕阅读器。

## 2026-11-03 原生菜单切片定向合同与 macOS 复核（Issue #162）

- 静态/模块检查：`node --test tests/application-menu.test.mjs` 与 `node --test tests/window-shortcuts.test.mjs` 各 3/3 通过；`node --check desktop/main.cjs`、`node --check desktop/application-menu.cjs`、`node --check tests/application-menu-e2e.cjs` 和 `git diff --check` 通过。
- 菜单 E2E 与修正：首轮真实 Electron E2E 在窗口菜单勾选状态断言失败。macOS 隔离原生菜单实操（System Events 选择“窗口 1”）及 Corvid `/windows` 状态复核确认焦点 API 已切至 `legacy-window`，但原生菜单仍勾选“窗口 2”（[Issue #167](https://github.com/heyallencao/corvid/issues/167)）。修正 radio 组同步为只勾选当前窗口；对应模块测试 3/3 通过，重跑后窗口菜单勾选断言通过。REA `observe_native_ui` 因 provider 无法读取目标进程启动时间而返回 `capability_unavailable`；实际截图与证据边界见 [UI 视觉检查记录](../qa/ui-visual-check.md#2026-11-03-corvid-原生窗口菜单焦点勾选-issue-167)。
- 定向回归：修正 `POST /rooms` 测试夹具响应读取，并把 Agent Room 权限验证放在单窗口阶段；Playwright 菜单 callback 不会可靠地改变 macOS 多窗口原生焦点，不能用它模拟 OS 窗口切换。之后 `env -u ELECTRON_RUN_AS_NODE node tests/application-menu-e2e.cjs` 通过，覆盖菜单树、动作、双窗口 callback 路由、Agent Room 权限状态、语言切换和重启保持；`env -u ELECTRON_RUN_AS_NODE node tests/browser-shortcuts-e2e.cjs` 通过。
- 原生 macOS 复核：使用隔离临时数据启动 Electron，以 `System Events` 在真实“窗口”菜单中双向选择窗口，分别读取 `AXMenuItemMarkChar` 勾选与 Corvid `/windows` 焦点 ID；两个方向均一致。人工诊断脚本在菜单仍打开时由 `closeElectron` 超时后结束了本轮自启进程，但在退出前已读完证据；随后检查无残留 Electron。REA `observe_native_ui` 仍因 provider 无法读取进程启动时间而 `capability_unavailable`；此处不宣称 REA 原生观察。
- 全量回归边界：首次 `npm test` 曾在全屏测试的异步最大化断言失败，已由 [Issue #168](https://github.com/heyallencao/corvid/issues/168) 修正为等待原窗口恢复；后续完整运行已通过该测试，继续在 #5 的 `pi-workbench-e2e.cjs:99` 超时，见上方 #168 记录，不计入 #162 菜单 E2E 失败。
- 未覆盖与限制：全套 `npm test`、VoiceOver、Windows/Linux、打包版、真实鼠标截图/像素与其他系统语言设置尚未完成；网页菜单的 EasyUI REA Evidence 只提供交互分组参考，不是系统菜单验收依据。本次未调用 OAuth 或真实模型。

## 2026-11-03 凭据迁移备份恢复期间的安全存储拒绝保护（Issue #110）

- 复现：迁移中断后，当前 `agent-credentials.json` 可为 schemaVersion 2，而 `.migration-backup` 保留旧 schemaVersion 1。Linux 异步安全存储可用但密文标记为固定口令回退 `v10` 时，provider 拒绝错误文本未匹配旧恢复分支的本地化字符串判断；`decryptStringAsync()` 返回非字符串 `result` 时的普通错误也会被当作可回退的数据损坏；此外，schemaVersion 2 已成功解密校验后若删除 `.migration-backup` 遇到文件系统错误，原 `try/catch` 会把清理失败误判为验证失败；比当前代码更新的 schemaVersion 3 也会落入旧备份回退分支；读取当前文件遇到 EACCES/EIO 还会被宽泛 `catch` 当作文件不存在。这些路径都会覆盖较新的凭据或用户更高版本数据。
- 修正：安全存储错误携带稳定 `error.code`，provider 未验证与解密返回值不符合 Electron 合同均按 `secure-storage-*` 错误码传播。旧备份清理与 schemaVersion 2 解密校验拆开；校验成功但备份删除失败时以 `credential-migration-backup-cleanup-failed` 传播本地化提示并保留当前密文和备份。遇到更新或未知 schemaVersion 时以 `credential-format-unsupported` 拒绝回退并保留两份文件。`EACCES`/`EIO` 等文件读取错误以 `credential-file-access-failed` 停止恢复；仅 JSON 语法损坏以 `credential-file-corrupt` 进入备份恢复。
- 验证：`env -u ELECTRON_RUN_AS_NODE node tests/pi-models-e2e.cjs` EXIT 0。确定性假安全存储分别模拟 Linux `v10` 当前密文、非字符串解密返回，并一次性注入备份删除 `EACCES`；断言稳定错误码且安全场景中当前文件和备份逐字节不变。另验证非安全格式损坏仍可恢复旧备份并迁移成不含明文的 schemaVersion 2，以及安全存储、备份清理、文件访问/损坏和未知格式错误的 zh-CN/en 映射；未知 schemaVersion 3 与旧备份并存、当前文件 EACCES 时两份文件均保持原字节，JSON 语法损坏仍可恢复有效备份。未启动 Electron、未访问真实账号或模型。
- 跨平台回归：代码提交 `00f0e7b` 对应的 [GitHub Actions 三平台凭据检查全部通过](https://github.com/heyallencao/corvid/actions/runs/41622464087)：macOS Keychain、Windows DPAPI、Ubuntu Secret Service。
- 代码提交 `7d6d9d0` 的 [GitHub Actions 三平台凭据检查全部通过](https://github.com/heyallencao/corvid/actions/runs/41624163323)：macOS Keychain、Windows DPAPI、Ubuntu Secret Service。
- 最新 PR 头提交 `5d71cac` 的 [GitHub Actions 三平台凭据检查全部通过](https://github.com/heyallencao/corvid/actions/runs/41624409684)：macOS Keychain、Windows DPAPI、Ubuntu Secret Service。
- 最新 PR 头提交 `5d71cac` 的 `env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0：21 项 `node:test` 与 50 条独立脚本，共 71 项通过；串行套件中的 `restore-loading-e2e` 正常通过，未复现 Issue #34 的长停顿。使用隔离数据目录和本地 fixture，未访问真实 OAuth、账号或模型。
- 边界：provider 恢复路径为 Node 模块合同测试；真实 macOS/Windows/Linux safeStorage 行为继续由独立原生 runner 覆盖。本次没有验证签名打包及断电发生在文件系统各条写入指令时的持久化语义。


## 2026-11-03 凭据原生安全存储与最新主线合并回归（Issue #110）

- 基线：PR #135 分支合入主线 `e5d64b5` 后解决 `package.json`、端到端索引与执行板冲突，保留 #141 全屏工作及测试入口，并纳入凭据原生存储用例。
- 验证：macOS、Node.js v24.14.1、Electron 45.2.1；`npm ci` 成功（133 packages，0 vulnerabilities）。`env -u ELECTRON_RUN_AS_NODE node tests/pi-credential-os-store-e2e.cjs` 通过，验证系统安全存储可用、合成 API Key 加密持久化、重启读取与登出删除。用例通过本地 HTTP fixture 先进入页面，再从 Corvid Agent 工作台执行凭据流程；地址栏定位同时兼容 zh-CN/en。
- 全量回归：`env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0；6 个 `node:test` 文件 21 项，加 50 条独立脚本，共 71 项通过，包含全屏、模型凭据、工作台、Chrome 导入和双语回归。两张测试刷新过的 Issue #129 截图已从工作树恢复。
- 跨平台 CI：本次推送的 [GitHub Actions #41617397773](https://github.com/heyallencao/corvid/actions/runs/41617397773) 中 macOS Keychain、Windows DPAPI 与 Ubuntu Secret Service 三个原生 runner 全部通过。
- 边界：本机原生 `safeStorage` 本轮实测限 macOS 开发机；Windows/Linux 原生 runner 覆盖开发版 Electron 与合成 Key，不验证签名打包、Windows ACL、真实 Linux 桌面差异、OS 用户切换或同用户恶意进程隔离。未验证真实崩溃/断电时迁移的每条指令点恢复。

## 2026-11-03 Chrome Cookie HostOnly/Domain 同名同路径冲突（Issue #149）

- 基线复现：在最新主线 `c753c55` 加入合成 HostOnly/Domain 冲突场景，隔离真实 Electron 显示 `Cookie 新增 4 项`，目标查询返回两份同名、同路径 Cookie，domain 分别为 `example.test` 和 `.example.test`；原 HostOnly 值仍在，但请求可能同时携带重复名称，导入结果也未提示冲突。完整 Cookie 用例在稍后既有扩展弹窗激活等待处超时，故通过 `CORVID_TEST_HOSTONLY_COOKIE_ONLY=1` 隔离目标场景复现。
- 修正：对 Chrome 来源与 Electron 目标 Cookie domain 去除 HostOnly/Domain 表示中的前导点，统一小写并去除尾随点；在相同 URL/name 查询结果内比较规范化 domain 和 path，保留目标 Cookie 并把来源项计为跳过。
- 验证：macOS 26.5.1、arm64、Node.js v24.14.1、Electron 45.2.1；`env -u ELECTRON_RUN_AS_NODE NODE_PATH=/private/tmp/corvid-issue141-browser-fullscreen/node_modules CORVID_TEST_HOSTONLY_COOKIE_ONLY=1 node tests/chrome-import-e2e.cjs` 在基线按预期失败（错误报告新增 4 项并返回两个同名 Cookie），修正后通过，断言只保留目标 HostOnly 值且结果报告跳过。`node --check desktop/main.cjs`、`node --check tests/chrome-import-e2e.cjs` 与 `git diff --check` 通过。
- 边界：使用合成 Chrome Cookies 数据库与临时 Corvid Profile；未读取真实 Chrome Profile、未调用系统钥匙串、OAuth 或模型。仅运行独立 HostOnly 冲突场景，完整 `chrome-import-e2e.cjs` 与全量 `npm test` 未在本分支运行；异步扩展弹窗父窗口激活路径仍需单独复核。

## 2026-11-03 macOS arm64 应用包与隔离启动验收（Issue #146）

- 实现：固定 `electron-builder` 26.18.1、Electron 45.2.1、`playwright-core` 1.64.1、bundle identifier `com.heyallencao.corvid` 与 `Corvid` 产品名；`electron` 与 `playwright-core` 移为开发依赖。`npm run package:mac:dir` 只为 macOS arm64 生成 `.app`；打包选取 desktop/CLI/MCP/SDK 与生产依赖，不带 `docs/`、`tests/`。构建前清除旧 `.app`，构建失败时清除不完整包。
- 构建与检查：macOS 26.5.1、arm64、Node.js v24.14.1。`npm run package:mac:dir` 成功；包内 `app.asar` 共 13,189 条路径，未包含 `docs/` 或 `tests/`；`lipo` 确认主可执行文件仅含 arm64。`Info.plist` 中 bundle ID 为 `com.heyallencao.corvid`、名称为 `Corvid`。主可执行文件 SHA-256：`e1e6fcf02e1263644308692375784cf67507c3bbc7a408acae15d92a8fd4850c`；`app.asar` SHA-256：`67266036e9455a55bb75de1f7f4e76d4d664e860d485645f615c023608513884`。构造旧包哨兵并模拟 `electron-builder` 不可用，验证失败时旧/残留 `.app` 被清除。
- 打包后 E2E：最终 `npm run test:packaged:mac` 通过。真实 Electron 从 `.app` 内启动，断言 `app.isPackaged`、arm64、`app.asar`、浏览器窗口、首个 Room、隔离 `CORVID_DATA_DIR`、控制 API 与正常退出后的 `control.json` 清理。`npm audit --audit-level=high` 报告 0 vulnerabilities；`node --check scripts/package-mac-dir.cjs`、`node --check tests/packaged-app-e2e.cjs` 与 `git diff --check` 通过。
- 边界：本产物 365 MB，使用 Electron 默认图标，未签名且未公证；只能作为本机开发包，不视为公众可安装发行版。未验证 DMG/PKG、安装/卸载、升级/回滚/自动更新、macOS x64、Windows 或 Linux；未运行完整 `npm test`。测试使用临时数据目录，无真实网站、用户 Profile、OAuth 或模型。

## 2026-11-03 浏览器窗口全屏 E2E 与标签销毁竞态（Issue #141）

- 2026-11-03 17:32（Asia/Shanghai）用户解锁后再次独立复跑定向 `fullscreen-e2e.cjs`、`permissions-e2e.cjs` 与完整 `npm test`，三者均 EXIT 0；全量仍为 21 个 `node:test` 用例 + 49 个脚本，共 70 项通过。测试进程结束后检查生成物，仅还原了测试刷新过的 Issue #129 截图，没有留下意外二进制改动。

- 调整：`tests/fullscreen-e2e.cjs` 统一调用 `tests/electron-test-startup.cjs` 的 Electron 启动、首窗口与控制凭据等待、限时关闭/进程诊断；重启阶段要求新 token，避免旧 `control.json` 让恢复断言连到已关闭应用。真实运行首轮发现 `WebContents` 销毁监听在标签状态清除前序列化 shell state，导致已销毁页面访问 `getTitle()` 并使 `/rooms` 返回 400。销毁监听现只清理全屏归属，随后由 `closeTab()` 在移除标签后统一发布状态。
- 回归：将全屏菜单项放在原有首项之后，保持站点工具菜单初始焦点，权限 E2E 同步验证 ArrowDown 落到新增全屏项。`env -u ELECTRON_RUN_AS_NODE node tests/fullscreen-e2e.cjs` 与 `env -u ELECTRON_RUN_AS_NODE node tests/permissions-e2e.cjs` 均 EXIT 0；`env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0，21 个 `node:test` 用例和 49 个独立脚本，共 70 项通过。`node --check` 和 `git diff --check` 通过。
- 环境与边界：macOS、Node.js v24.14.1、Electron 45.2.1；临时 Corvid 数据目录与本地 HTTP fixture。未使用 OAuth、真实账号或模型，npm test 不含真实模型 smoke test。已目视检查菜单截图，范围与限制见[桌面 UI 视觉检查记录](../qa/ui-visual-check.md#2026-11-03-全屏菜单桌面状态-issue-141)；未做人工屏幕阅读或原生窗口全屏截图。Windows/Linux、打包版本和真实网站未覆盖。

## 2026-11-03 内置 Agent 流式文本与工具活动验收（Issue #5）

- 缺口：Agent 事件适配器已映射文本片段和浏览器工具开始/结束事件，工作台也已有任务事件呈现，但既有真实 Electron 测试只断言最终回复，未证明中间流式进度与工具活动抵达用户界面；工具事件原先还会把 `corvid_page_snapshot` 内部名称直接显示给用户。
- 回归：`tests/pi-workbench-e2e.cjs` 新增确定性事件 fixture；断言工具开始事件出现、第一段文本在 task 仍为 `running` 时显示、工具完成事件出现、拼合回复写入任务记录，并断言用户界面使用 Corvid 动作文案且不泄露内部工具名。
- 红绿验证：只增加断言时，旧 fixture 未发出工具事件，测试等待失败；加入本地测试 fixture 的分段文本与工具开始/结束事件后，定向断言再次因旧 UI 暴露内部工具名而失败；更新活动文案后，`env -u ELECTRON_RUN_AS_NODE node tests/pi-workbench-e2e.cjs` 通过。
- 定向回归：`agent-runtime-contract-e2e.cjs`、`pi-runtime-e2e.cjs`、`pi-models-e2e.cjs`、`pi-workbench-e2e.cjs`、`agent-stop-e2e.cjs` 与 `pi-custom-endpoint-e2e.cjs` 均通过；相关 JS `node --check` 和 `git diff --check` 通过。未运行全量 `npm test`。
- 边界：事件来自确定性本地 fixture，不连接真实模型或 Provider；证明的是事件适配到 Corvid 任务卡的本地 UI 路径及用户可见名称映射，不证明真实 Provider 网络延迟、所有工具种类或真实服务的流式稳定性。

## 2026-11-03 Agent 上下文预览键盘焦点与活动文案本地化（Issue #5）

- 缺口：检查页面上下文后工作台重绘会丢失焦点；旧分支的浏览器工具活动文案仅有中文，且把内部工具名称写进任务事件记录。
- 调整：预览成功后将焦点移动到必须确认的页面同意复选框；活动事件改为 Corvid 中英双语资源键，任务记录不存储内部工具名，界面按当前语言翻译活动状态；旧任务中的历史工具事件也在显示时映射为通用活动状态，以兼容升级前已保存的记录。
- 验收：`env -u ELECTRON_RUN_AS_NODE node tests/pi-workbench-e2e.cjs` 与 `node tests/localization-e2e.cjs` 均通过；运行时临时链接主工作区既有 `node_modules`，测试后已移除链接。前者以真实 Electron 与确定性本地 fixture 覆盖 Tab/Enter 预览、焦点落在同意复选框、Space 同意、Tab/Enter 发送、流式文本及工具事件；升级前保存的中文事件在重启后分别以中英文通用文案显示，且不暴露旧工具名；另切换语言验证新事件文案，再切回中文。后者验证 zh-CN/en 资源键和值一致、窄窗文案及本地化格式。`node --check` 涉及的 JS/CJS 文件与 `git diff --check` 通过。
- REA 参考：复用 Kobra `/components/dropdown-menu` 历史受控 Chromium Evidence `ev_3edcac9a9d467a934c1bdadc8ef6aa20155315eb1f93278088e0a98d4ac5a54c`，记录时间 2026-11-03 11:37（Asia/Shanghai）。直接观察限于该路由可访问；未操作菜单，焦点/关闭/键盘行为未知。静态证据只显示菜单示例页面入口，不证明目标交互。本次焦点落点由 Corvid 的显式页面同意流程和真实 Electron 键盘回归决定，不把参考页当验收标准；未复制代码或素材。
- 边界：本地 Electron 与确定性 fixture，不连接真实模型或 Provider；未覆盖 VoiceOver 与其他平台。

## 2026-11-03 主题色对比度修复（Issue #16）

- 范围：浅/深主题的次要文本、warning/success 状态文字与焦点指示 token。浅色 `--text-muted` 从 `#858c98` 调整为 `#5f6878`，warning 从 `#a56a13` 调整为 `#8f5e16`，success 从 `#268461` 调整为 `#1d7352`，`--focus-ring` 改为复用 `--accent`；深色 `--text-muted` 调整为 `#a4afbf`。
- 对比度：真实 Electron 获取 computed CSS token，并对主题下全部 `--surface*` 背景断言 muted 文本至少 4.5:1、焦点指示至少 3:1；warning/success 在一般、柔和及对应状态背景上的文字对比至少 4.5:1。最弱实测值：浅色 muted 4.72:1、深色 muted 4.76:1、焦点指示 4.11:1、warning/success 状态文字 5.14:1；深色最弱状态文字为 6.86:1。
- 验证环境与结果：macOS、Node.js v24.14.1、Electron 45.2.1。`env -u ELECTRON_RUN_AS_NODE node tests/agent-rooms-panel-e2e.cjs` EXIT 0；`CORVID_CONTRAST_SCREENSHOT_PATH=docs/qa/screenshots/issue-16-contrast-after.png env -u ELECTRON_RUN_AS_NODE node tests/agent-rooms-panel-e2e.cjs` EXIT 0；`env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0，8 项串行 `node:test` 与 48 个独立 E2E 脚本，共 56 项通过。`node --check tests/agent-rooms-panel-e2e.cjs` 与 `git diff --check` 通过。
- 隔离与截图：测试使用临时 `CORVID_DATA_DIR` 和本地 fixture；页面为 `about:blank`，未使用 OAuth、真实账号或模型。浅色壳截图为 [issue-16-contrast-after.png](../qa/screenshots/issue-16-contrast-after.png)，2560×1636，SHA-256 `b9ab049878325922e8b6178ebc032e5fafd9f3c398738e5fdcd9a46e3ff125`。测试刷新过的两张 Issue #129 截图已还原。
- 参考与限制：这是依据 Corvid 实际 computed token 和 WCAG 2.2 对比度阈值修正色值，没有移植参考站点的视觉或交互，因此本切片未调用 REA 扫描 UI 灵感站点。自动化只检查列出的 CSS token/背景组合，不等同于所有组件状态的完整 WCAG 审计；未覆盖屏幕阅读器、Windows/Linux、打包版本及其他显示器配置。

## 2026-11-03 Chrome Cookie 预览与同意前读取边界（Issue #139）

- 2026-11-03 17:45（Asia/Shanghai）将 #139 worktree rebase 到包含 #141 的最新主线 `e83627b` 后复跑：`env -u ELECTRON_RUN_AS_NODE node tests/chrome-import-e2e.cjs` 与完整 `env -u ELECTRON_RUN_AS_NODE npm test` 均 EXIT 0；21 个 `node:test` 用例 + 49 个独立脚本共 70 项通过。全量包含全屏和双语回归。临时 `node_modules` 依赖链接及测试刷新过的 #129 两张截图已清理/还原；未读取真实 Chrome Profile、系统钥匙串、OAuth 或模型。

- 缺口：导入预览为显示 Cookie 数量执行 `SELECT * FROM cookies` 并在 JavaScript 中物化整行；真正导入时又在请求 macOS Safe Storage 钥匙串前先读取 Cookie 行。
- 修正：预览使用 `SELECT COUNT(*) AS count FROM cookies NOT INDEXED`，避免把 `value`、`encrypted_value` 等列带入 JavaScript，并避免损坏的二级索引破坏预览计数。`readCookies` 自身要求显式 Cookie 同意，先成功取得钥匙串密钥，再执行带完整性检查的行查询；取消、缺少同意或密钥读取失败都不会读取 Cookie 行。
- 验证：macOS、Node.js v24.14.1、Electron 45.2.1；合成 Chrome Profile/Cookies 数据库、临时 Corvid 数据目录。rebase 前（`d4b6c93`）`env -u ELECTRON_RUN_AS_NODE node tests/chrome-import-e2e.cjs` 与 `env -u ELECTRON_RUN_AS_NODE npm test` 均 EXIT 0；全量为 8 项串行 `node:test` 加 48 个独立脚本，共 56 项通过。SQL 捕获断言预览仅查询 `COUNT(*) ... NOT INDEXED`、无同意及合成密钥读取失败不产生行查询、同意且密钥成功后才读取并解密；真实 Electron E2E 同时覆盖现有 Cookie 导入/失败恢复路径。rebase 到 D21 合并提交 `0dc6a38` 后，三项修改 JavaScript 的 `node --check` 与 `git diff --check` 通过；完整 `npm test` 在最前面的 8 项 `node:test` 阶段失败，browser、dialogs、uploads 三项分别报输入焦点未获得、JavaScript 弹窗不可见、文件选择器超时。单独重跑该 `node:test` 组仍复现相同失败，未开始后续脚本；随后当前树的 `chrome-import-e2e.cjs` 也在末段原生父窗口激活后等待扩展弹窗关闭时超时。该 E2E 在失败前已完成 SQL 合同断言和先前 Cookie 导入路径。CUA 当时报告 macOS 已锁屏，故这些合并后窗口交互结果受锁屏限制，不能归因于 #139，也不能宣称合并后整树全量通过；需解锁后重新验证。首轮定向运行还发现损坏的 Cookie 二级索引会被普通 `COUNT(*)` 查询计划选中，导致预览禁用 Cookie 选项；改用 `NOT INDEXED` 后，预览计数和导入时原有只读完整性拒绝均通过。测试刷新过的两张 #129 截图已还原；未访问真实 Chrome Profile、未弹出或批准系统钥匙串、未使用 OAuth/模型。
- 本轮补充验证：macOS 锁屏期间使用 Node.js v24.22.1 直接加载 `desktop/chrome-import.cjs`，以临时合成 SQLite Profile 和 `DatabaseSync.prototype.prepare` SQL 捕获器执行隔离 harness；预览只产生 `SELECT COUNT(*) AS count FROM cookies NOT INDEXED`，未同意及无效合成密钥均不查询 Cookie 行，同意并提供有效合成密钥后才执行 `SELECT * FROM cookies` 并解码合成值。另构造 100 行数据并损坏 `cookies_name_idx` 根页，普通 `COUNT(*)` 控制查询失败，而 `readProfile` 的预览计数仍返回 100。此项没有启动 Electron，不覆盖窗口、IPC 到主进程的端到端集成或钥匙串系统提示。
- 解锁后复验：macOS 26.5.1、Node.js v24.22.1、Electron 45.2.1，针对当前 #139 分支运行 `env -u ELECTRON_RUN_AS_NODE node tests/chrome-import-e2e.cjs`，EXIT 0；随后运行 `env -u ELECTRON_RUN_AS_NODE npm test`，EXIT 0，8 项串行 `node:test` 与 48 个独立脚本全部通过，共 56 项。全量中再次通过 Chrome 导入、Cookie 解密/写入/隔离/持久化、失败重试和恢复路径。测试结束后删除临时 `node_modules` 符号链接，恢复被测试刷新过的两张 #129 截图；未读取真实 Chrome Profile、未调用系统钥匙串、未使用 OAuth/真实模型。全量测试与 Electron 进程已退出，worktree 清洁。
- 限制与状态：钥匙串失败顺序由合成无效测试密钥验证，没有触发系统授权/拒绝 UI；COUNT 查询只证明 SQLite 不向 JavaScript 返回行列，不声称 SQLite 不读取底层数据库页。真实 Profile、不同 SQLite 损坏形态和平台差异仍未验证。Issue #139 保持 OPEN；尚未创建 PR，等待用户审阅。

## 2026-11-03 Chrome 扩展弹窗原生外点验证（Issue #129）

- 缺口：既有 Playwright CDP 点击未命中原生窗口外点合同；BrowserWindow.focus() 只证明 blur 关闭，不证明物理鼠标输入。
- 验证：macOS、Electron 45.2.1、Chromium 156、临时 CORVID_DATA_DIR 与合成 MV3 扩展。命令：env -u ELECTRON_RUN_AS_NODE CORVID_NATIVE_POINTER_CHECK=1 node tests/chrome-import-e2e.cjs，EXIT 0。先显式聚焦 Corvid 父窗口，按地址栏 bounding box 中心计算屏幕全局坐标 (768, 130)；该坐标位于父窗口内、扩展弹窗 (911, 150, 320×220) 外。通过 CoreGraphics 发布 mouseMoved/down/up 后，弹窗关闭。
- 代码范围：仅增加 macOS opt-in 测试路径；默认完整套件仍使用父窗口激活路径。页面产品实现未改变。测试自动更新的两张已有截图已还原，没有产生新的视觉差异证据。
- 事件传递边界：严格 DOM 诊断未在父页面收到 mousemove/mousedown/mouseup/click，因此只证明原生指针输入导致扩展弹窗因 blur 关闭，不证明点击继续传递到 Corvid 地址栏或网页。
- REA：尝试对测试 Electron PID/窗口调用 observe_native_ui，REA 返回 pid-not-application（LaunchServices 未暴露 Electron helper 为可观察应用），未产生 Evidence ID、截图或 AX 树。此处明确记为未完成 REA 原生观察，不以 CoreGraphics 窗口枚举代替。已有 Kobra dropdown-menu controlled replay 只作此前设计参考，不证明本次运行行为。
- 限制：只验证当前 macOS 开发机（使用 Swift toolchain）和 Electron 45.2.1；未验证 Windows/Linux、打包应用、其他显示器/缩放配置、连续高频点击或屏幕阅读器。未访问真实浏览器 Profile、账号或模型。


## 2026-11-03 扩展弹窗失焦关闭的 Electron 验证边界（Issue #129）

- 复核：现有测试在扩展子窗口打开时使用 Playwright CDP 点击 Corvid 页面。CDP 点击没有切换原生窗口焦点，因此超时并不能证明产品关闭逻辑失效；此前记录将其写成“点击弹窗外关闭”证据过强。
- 修正：回归改为通过原生 `BrowserWindow.focus()` 激活 Corvid 父窗口，检查弹窗因 blur 关闭。此用例验证失焦关闭路径，不声称验证真实鼠标物理点击。
- 验证：`env -u ELECTRON_RUN_AS_NODE node tests/chrome-import-e2e.cjs` EXIT 0；确认失焦关闭路径、Escape 焦点恢复、Profile 切换关闭和弹窗安全边界。更新后的工具栏/弹窗截图已复核，尺寸分别为 2560×1636、640×440，内容为隔离的合成扩展。
- 限制：外点手势的原生鼠标输入尚未覆盖；后续需要可向系统窗口发送真实指针输入的端到端夹具。
## 2026-11-03 Agent 初始化期间接管的取消合同（Issue #96）

- 复核：主线实现于用户在 runtime session 初始化期间接管时会取消准备中的任务；迟到 session 创建后应释放并且不得向模型发出 prompt。启动 Promise 会以“空间已交给用户；Agent 会话尚未就绪”拒绝。
- 修正：`tests/agent-runtime-contract-e2e.cjs` 原先无条件等待启动 Promise 成功，与上述既有行为冲突；改为断言该 Promise 拒绝，并继续检查零 prompt 与迟到 session 已 dispose。
- 验证：`node tests/agent-runtime-contract-e2e.cjs` EXIT 0；`git diff --check` 通过。全量 `npm test` 在该旧断言上失败后停止，本记录不宣称全量回归通过。
## 2026-11-03 Corvid 界面语言偏好与浏览器壳层首批双语（Issue #130）

- 基线与环境：`origin/main` `29f59a2` 的独立 worktree；macOS、Node.js v24.14.1、Electron 45.2.1。真实 Electron 使用临时 `CORVID_DATA_DIR`，预置合成的 `zh-CN` 偏好；未访问真实网页、未使用 OAuth 或模型。
- 实现：应用语言从系统 locale 初始化（英文系统选 `en`，其他选 `zh-CN`），用户可在设置中切换并持久化到独立 `ui-preferences.json`（schema v1、0600）；不绑定 Profile，控制 API 不开放 locale 修改。`desktop/locales.js` 提供中英文资源、插值、复数与 `Intl` 日期/数字/列表格式化。静态 DOM 和 renderer 动态文案扩展至浏览器 chrome、标签/菜单、设置、Chrome 导入与引导、Agent 访问管理、扩展空态、内置 Agent 对话与模型管理、Agent 工作区代表性状态；品牌眉题、Chrome Profile 与端点地址字段也由 locale 资源驱动。默认 Profile/空间名只在界面显示层翻译。架构见[本地化设计](../architecture/localization.md)。
- UI 参照：REA 受控 Chromium 156.0.8078.79 在 Kobra `/components/dropdown-menu` 观察到页面标题、菜单说明和 `Menu size` combobox。Evidence `ev_a9d28bb5e29c9f2ff9465f0f0d3ee1933ba08d6941cc0f38fc7a32ac27a8c48d`，2026-11-03 11:57（Asia/Shanghai），1280×720。**直接观察：**路由可达且 AX 树包含上述标题/说明/combobox。**静态证据：**同次 DOM 标题与 AX 描述标明这是菜单组件示例。**推断：**参考帮助辨别菜单与选择器语义，不构成 Corvid 的语言选择需求。**未知：**场景只等待页面加载，未操作菜单或选择器；焦点、关闭、键盘与窄窗行为未知。Corvid 使用原生 `<select>`，未复制代码或素材。
- UI 参照补充：REA 受控 Chromium 156.0.8078.79 在 Kobra `/components/dialog` 执行点击 `Create workspace` 并捕获 DOM/AX/截图，Evidence `ev_0dc1fb51a7e36baea7fd893e92b73ef348cbab8faeaf8762cd69b6605c436b96`，2026-11-03 13:04（Asia/Shanghai），页面默认 1280×720。**直接观察：**该路由可达，AX 树提供 `Dialog` 标题、“A modal window over the page, and the alert dialog.” 说明、`Multi step` 与 `Alert dialog` 复选框；点击步骤完成，但点击后 AX 树仍只列出 `Create workspace` 按钮，没有可确认的对话框状态。**静态证据：**DOM/AX 同时列出 `open`、`modal`、`multiStep`、`alert` 属性说明。**推断：**Corvid 长设置内容应保持可滚动，并让保存/取消动作在滚动后仍完整可达；此结论由 Corvid 自身 E2E 验收，不照搬 Kobra 样式。**未知：**未能确认 Kobra 点击是否显示弹窗；焦点、Escape、窄窗行为未知，不能把未出现在 AX 树里解释为没有弹窗。未复制代码或素材。
- 验证：本轮 `env -u ELECTRON_RUN_AS_NODE CORVID_CAPTURE_QA_SCREENSHOTS=1 node tests/localization-e2e.cjs` 通过，覆盖源码重复键拒绝、语言即时切换和不支持 locale 拒绝、两份资源键/复数键/占位符一致、DOM 资源键有效、品牌眉题与浏览器控件、Chrome Profile 名称、设置内 Chrome 导入/外部 Agent 授权、Profile 扩展空态、Agent 提示/模型设置（含端点地址字段）、Agent 工作区空态、用户数据名称不变、`Intl` 格式、0600 偏好文件、重启恢复、700×420 窄窗导航，以及中英文设置对话框滚动后保存按钮完整可达。八张隔离空白数据截图已生成：`corvid-localization-en-1024x700.png`、`corvid-localization-zh-CN-1024x700.png`、`corvid-localization-en-700x420.png`、`corvid-localization-zh-CN-700x420.png`、`corvid-localization-en-settings-1024x700.png`、`corvid-localization-zh-CN-settings-1024x700.png`、`corvid-localization-en-settings-700x420.png`、`corvid-localization-zh-CN-settings-700x420.png`。已目视确认两张新窄窗截图中的保存/取消按钮完整落在对话框内；截图处于内容滚动到底部后的状态，不展示设置表单全貌。`node --check desktop/locales.js`、`desktop/renderer.js`、`desktop/main.cjs`、`tests/localization-e2e.cjs` 和 `git diff --check` 通过。只运行定向真实 Electron 用例，没有运行完整 `npm test`，没有访问模型或 OAuth。
- 本轮补充修复与全量验证（2026-11-03）：修正 Profile 扩展权限列表中文仍使用英文逗号的问题，`zh-CN` 使用 `、`、`en` 使用 `, `；同步更新 Chrome 导入汇总断言以覆盖实际历史统计、ASCII/全角括号及错误标点。`env -u ELECTRON_RUN_AS_NODE node tests/chrome-import-e2e.cjs` 与完整 `env -u ELECTRON_RUN_AS_NODE npm test` 均 EXIT 0；共 8 项串行 `node:test` 与 48 个独立脚本，56 项自动化检查通过。套件使用隔离 Electron 数据和本地夹具，未使用 OAuth 或真实模型。Chrome 导入用例会刷新 Issue #129 两张证据图；本轮已还原该测试副产物，没有改变既有截图。
- 限制与状态：截图展示的是明确夹具状态，不能证明所有译文/视图都无溢出；700×420 断言证明设置对话框留在视口内、内容可滚动及保存按钮完整可达，不代表完整窄屏可用性。主进程/依赖生成错误、帮助与罕见状态、全部菜单和键盘焦点流程、VoiceOver 仍需审计。Issue #130 继续开放，D24 保持“部分”，不得宣传全产品已完成双语验收。

## 2026-11-03 下载失败与中断后的安全重试（Issue #126）

- 基线与环境：基于 `ff9d046` 的隔离 worktree；macOS、Node.js v24.14.1、Electron 45.2.1。E2E 使用临时 `CORVID_DATA_DIR`、临时下载目录及本地 HTTP fixture。
- 实现：下载列表为失败、取消和中断记录提供桌面手动重试；每次请求创建独立记录并通过 `retryOf` 关联原记录。重试使用原下载所属浏览身份的 Electron Session，复用 `will-download`、保存位置选择和目标已存在拒绝逻辑；只接受 HTTP(S)，阻止同一来源重复并行重试，外部 API 调用拒绝重试。
- 验证：`env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0，8 项 `node:test` 与 46 个独立脚本共 54 项自动化检查通过；其中重试主流程、边界、Profile 与 Agent 下载测试均单独 EXIT 0。`node --check desktop/main.cjs`、`node --check desktop/renderer.js`、`node --check tests/download-e2e.cjs`、`node --check tests/download-retry-boundaries-e2e.cjs` 与 `git diff --check` 均通过。用例覆盖同名文件失败且原文件不变、手动重试成功、原记录保留、进行中禁用重复重试、取消子尝试、错误文案呈现、跨 Profile 来源拒绝、并发 IPC 只启动一个尝试、使用来源 Profile Session、危险协议拒绝、外部 API 不暴露重试入口、Agent 下载原有行为，以及模拟重启时把持久的 `progressing` 记录恢复为 `interrupted` 后重试成功。
- UI/UE 参考：复用本日 REA 直接观察的 Kobra Alert `/components/alert`，Evidence `ev_7dbddd29058eef11227135f0879409777f91101dca4a0c7d543d9886057d2f61`（09:20 Asia/Shanghai）；仅参考命名状态区与错误状态表达的清晰度，未移植实现。Rare UI 在此前检查中仅显示 Vercel Security Checkpoint，Evidence `ev_f2ea0fa5cdeca7d8b14710c80abd66a5e367a3cabc0eff9faa49a22dc8df806e`，不提供可用切面。交互和覆盖限制见[视觉检查记录](../qa/ui-visual-check.md#2026-11-03-下载失败记录的手动重试-issue-126)。
- 限制：下载目录和原生保存对话框由测试模式替换；重启测试以持久化 `progressing` 记录模拟启动恢复，没有强杀正在下载的 Electron 进程；未验证真实断网恢复、Windows/Linux、真实 Agent/MCP 客户端或打包版。已从来源 Profile 发起隔离重试；未在真实桌面保存对话框中切换 Profile。中文 PR [#127](https://github.com/heyallencao/corvid/pull/127) 已于 2026-11-03 合并，合并提交 `17f9f160cec32126473bd6c8ba12bdb2967ff235`；关联 Issue #126 已关闭。
## 2026-11-03 Agent 续聊并发与 Room 交接竞态（Issue #96）

- 复现：使用确定性 runtime 和临时数据目录直接调用真实 Agent Workbench 模块。旧实现中，首个续聊停在页面上下文读取时，第二个续聊也能通过原状态检查并等待同一读取；此前模块合同用例按预期失败。
- 修复：同一任务开始读取页面上下文前即取得续聊占用并进入 `preparing`；并发续聊立即拒绝。页面读取后、凭据签发后及运行时会话初始化后均检查任务状态；若 Room 已交还用户，拒绝迟到续聊、撤销 scoped credential、销毁迟到会话并保留 `interrupted` 状态。预览校验失败时恢复原任务状态，`finally` 释放占用。
- 验证：基于最新主线 `7a863a1` 的续聊修复通过 `node --check desktop/agent-workbench.cjs`、`node --check tests/agent-task-continuation-contract.cjs`、新增模块合同、`pi-workbench-e2e`、`agent-runtime-contract-e2e`、`agent-stop-e2e` 与完整 `npm test`。完整套件 8 项串行 `node:test` 和 47 个独立脚本全部通过，共 55 项自动化检查。合同用例验证重复提交不进行第二次页面上下文读取、不会重复写入 transcript/session/credential；过期预览失败后恢复原状态且可再次续聊；Room 在上下文读取期间交还用户后不启动迟到续聊或签发 credential。测试依赖通过临时 `node_modules` 符号链接复用本机安装；测试数据均隔离。
- 最新主线复验：将此切片重放到 `origin/main` `29f59a2` 后，`node --check desktop/agent-workbench.cjs`、`node --check tests/agent-task-continuation-contract.cjs`、`node --check tests/agent-access-e2e.cjs`、`git diff origin/main...HEAD --check`、`node tests/agent-task-continuation-contract.cjs` 与 `env -u ELECTRON_RUN_AS_NODE node tests/agent-access-e2e.cjs` 均通过。真实 Electron 用例使用临时 `CORVID_DATA_DIR` 和本地 HTTP fixture；未连接真实模型或 OAuth。隔离 worktree 借用本机依赖的临时 `node_modules` 链接已清理；本次未重跑全量 `npm test`。
- 本轮追加验证（2026-11-03）：`node --check desktop/agent-workbench.cjs`、`node --check tests/agent-task-continuation-contract.cjs`、`node --check tests/agent-access-e2e.cjs`、`git diff --check`、`node tests/agent-task-continuation-contract.cjs`、`env -u ELECTRON_RUN_AS_NODE node tests/agent-access-e2e.cjs` 与 `env -u ELECTRON_RUN_AS_NODE node tests/pi-workbench-e2e.cjs` 均通过。模块合同新增凭据签发和 runtime 初始化期间的 Room 交接门控，断言不调用 prompt、及时撤销凭据、销毁迟到会话并保留 `interrupted`；真实 Electron 用例再次证明 Room A 慢导航不阻塞 Room B，工作台续聊/接管回归通过。测试数据隔离、未连接真实模型或 OAuth；未重跑全量 `npm test`。
- 限制：新增用例直接调用模块并使用 runtime 替身，不覆盖真实 Provider、真实 Electron renderer 双击时序或 UI 状态刷新；此前跨 Room 并行客户端的 Electron 验证是另一条证据。续聊冲突和交接路径复用现有状态提示，本切片未新增用户可见文案；Corvid 全产品 zh-CN/en 资源迁移仍未完成，需另行覆盖。Issue #96 仍开放，未更改 GitHub Issue 或 PR。

## 2026-11-03 Agent 跨 Room 慢操作不互相阻塞（Issue #96）

- 缺口：两个 scoped Agent 客户端的并发 HTTP 请求和跨 Room 拒绝已有 E2E，但此前没有证明一个获准 Room 的长时间页面操作不会阻塞另一个 Room 的操作。
- 验证：真实 Electron、macOS、Node.js v24.14.1、Electron 45.2.1、隔离 `CORVID_DATA_DIR`。本地 HTTP fixture 暂停 Agent A 的 `/slow` 导航响应；A 的导航请求确认仍未结束后，Agent B 对其独立获准 Room 的 `/fast` 导航在 3 秒界限内返回 200，之后释放 A 并确认其也返回 200。既有断言同时确认越权 Room/Tab 读写仍返回 `403/CORVID_FORBIDDEN`。`node --check tests/agent-access-e2e.cjs`、`git diff --check` 和 `env -u ELECTRON_RUN_AS_NODE node tests/agent-access-e2e.cjs` 均通过。
- 边界：证明的是同一 Corvid 主进程中按 Room 分开的浏览器操作队列可独立推进，不证明真实 Provider/模型并发、多个操作系统进程之间的运行调度或抵御同一 OS 用户恶意进程。Issue #96 继续开放。

## 2026-11-03 Chrome 导入向导空白报告复核（Issue #124）

- 范围：隔离最新主线 `d475c07`，macOS、Electron 45.2.1、临时 `CORVID_DATA_DIR`；仅打开导入向导，未选择或读取真实 Chrome 资料。
- 复核：真实 Corvid Electron 窗口中的 CUA 屏幕截图与 Playwright `_electron` 全窗口截图均显示完整对话框；DOM 可见性和元素布局尺寸正常。标题、导入说明、目标浏览身份、资料目录选择、类别、限制说明和导入按钮全部可见。
- 结论：无法复现 Issue #124 所述“正文为空白”；此前的桌面观察与隔离应用窗口的像素结果不一致，不能作为 CSS 缺陷依据。没有产品代码更改，也未创建修复 PR。已在 Issue 中以中文记录证据并关闭；如能提供明确复现条件，可重新打开。
- 限制：未验证其他显示缩放、窗口尺寸、主题、平台或屏幕阅读器；Playwright DOM/样式检查单独不能代表像素呈现，视觉判断由同一状态下的 CUA 与 Playwright 截图支持。UI 记录见[视觉检查记录](../qa/ui-visual-check.md#2026-11-03-chrome-导入向导空白问题复核-issue-124)。

## 2026-11-03 macOS 原生 Chrome 目录选择器复核（Issue #18）

- 缺口：自动化 `chrome-import-e2e` 以测试替身替换原生目录对话框，Issue #18 仍要求人工核对本机选择器。
- 直接观察：macOS、隔离 Corvid 数据目录、真实 Electron 45.2.1。设置中进入 Chrome 导入后，系统显示标题为“选择 Google Chrome 用户资料目录”的原生文件夹面板。为避免读取开发机真实资料，只用“前往文件夹”定位到临时合成 User Data（含合成 `Local State` 和 `Default/Bookmarks`）；选择后 UI 显示“临时合成资料 (Default)”与 1 个书签、0 条历史/Cookie/扩展。再次打开选择器并取消后，已有来源和计数仍保留；未按“导入所选资料”，没有写入目标资料。
- REA：静态桌面目录清点 Evidence `ev_3d3466f904b9aa76b1e4184202671dc36e2338df9c50bae989db7f1a799007f1`；覆盖 110 个条目，运行态为 unknown，不能当作原生对话框的 REA 动态证据。运行态细节来自本机 CUA 无障碍树观察。未引用 Rare UI、Kobra、EasyUI、Pin UI 或 Aceternity UI：本次只验收 macOS 系统面板，不评审 Corvid 自绘 UI。
- 静态实现对照：`desktop/main.cjs` 的 `chooseChromeImportSource` 通过 `dialog.showOpenDialog(..., properties:['openDirectory'])` 打开目录面板，取消时返回 `canceled:true`；该静态代码只能说明预期分支，动态结论以上述 UI 观察为准。
- 最新主线复验：基于 PR #122 合并后的 `faab302` 重基；macOS、Node.js v24.14.1、Electron 45.2.1，`env -u ELECTRON_RUN_AS_NODE node tests/chrome-import-e2e.cjs` EXIT 0，`git diff --check` 通过。回归使用合成 Chrome User Data/密钥与隔离 Corvid 数据目录，不读取真实 Chrome 资料或系统钥匙串；此自动化仍替换原生文件选择器。
- 限制：仅 macOS 手动验证一个合成目录及取消；没有导入、真实 Chrome 数据、真实钥匙串、磁盘/崩溃时序、打包版、Windows/Linux 验收。Issue #18 继续保持开放。

## 2026-11-03 09:48 外部 Agent Room 授权并发回归（Issue #96）

- 缺口：此前 `agent-access-e2e.cjs` 依次验证两个 scoped credential；Issue #96 的验收要求两个客户端并行操作不同获准 Room，但测试没有覆盖并发到达时的读写隔离。
- 补充：真实 Electron E2E 现在用 `Promise.all` 并发列出各自 Room、读取 Room 详情，并在各自授权空间创建标签；随后并发发起跨 Room 详情读取、猜测对方 Tab 激活和跨 Room 创建标签。所有越权请求均返回 `403/CORVID_FORBIDDEN`；并发完成后两方列表仍只包含各自 Room。未修改产品路由。
- 验证：macOS、Node.js v24.14.1、Electron 45.2.1、临时 `CORVID_DATA_DIR`；`node --check tests/agent-access-e2e.cjs`、`env -u ELECTRON_RUN_AS_NODE node tests/agent-access-e2e.cjs` 与 `git diff --check` 通过。追加后 `env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0（45 条独立脚本 + 8 个 `node:test`，共 53 项）。请求并发验证的是共享本地控制服务内两个独立 scoped 身份的授权边界；主进程 dispatch queue 仍串行执行写入，不代表多进程并行调度或同 OS 用户进程隔离。
- 最新主线复验：将切片重放到 PR #120 合并后的 `f268c09`；`env -u ELECTRON_RUN_AS_NODE node tests/agent-access-e2e.cjs` 与完整 `env -u ELECTRON_RUN_AS_NODE npm test` 均 EXIT 0，完整套件 53 项通过。仅使用临时授权和确定性 Room，未调用真实模型或 OAuth。

## 2026-11-03 浏览器标签与空间控件辅助技术语义（Issue #16）

- 基线：隔离 Electron Accessibility 树显示 `#tabs` 将普通“新建标签”按钮放在 `tablist` 中，空间按钮直接位于 `list`；两类组件都没有相应的箭头键/列表项交互合同。REA 被动观察 Corvid shell DOM Evidence `ev_8c9f4ce02b8bd6f50d425c60b49e3ce5a68d873048ae156cee4b4db2236b4893`；动态角色与名称以本地 Playwright CDP Accessibility 树为准。
- 修复：标签栏、空间栏改为具名控件分组，当前项通过 `aria-current="page"` 表达；带空态段落的扩展、模型端点与外部客户端集合也改用具名分组。标签菜单、关闭按钮和 Tab 顺序保持原行为。
- 参考：REA 对 Kobra `/components/composer` 的可访问性树 Evidence `ev_668bf2245d384ec9265daab73179d0986212ea9968e2b05000bd13234459f8f9` 观察到命名清楚的 Subject/Message 文本框与操作按钮；仅作为语义清晰度启发，不作为 Corvid 需求或验收。
- 验证：本机 macOS、Node.js v24.14.1、Electron 45.2.1、隔离临时数据。`node tests/tab-ux-e2e.cjs`、`node tests/navigation-error-e2e.cjs`、`node tests/agent-rooms-panel-e2e.cjs`、`node tests/pi-workbench-e2e.cjs` 均 EXIT 0；全量 `env -u ELECTRON_RUN_AS_NODE npm test` 在清理诊断进程后 EXIT 0（45 条独立脚本 + 8 项 `node:test`，共 53 项）。标签 E2E 通过 `Accessibility.getFullAXTree` 断言分组角色与活动项；其余覆盖导航错误、Agent 空态/接管与对话续聊。首次全量运行暴露了临时增加标签名状态前缀导致的精确可访问名回归，已改为保留标题名并用 `aria-current` 另报当前状态；另一次截图错误发生时，本轮诊断 Electron 进程仍在运行，按 PID 清理后全量复验通过。
- 限制：未运行 VoiceOver/Narrator/Orca；CDP AX 树不等同于真实屏幕阅读器语音/盲文输出。REA 目标发现 Evidence `ev_1f81589c3247e56ea4de1db93f239a52086654699750f538b047bcb5382897ef` 仅证明本地页面归属，不证明平台可访问性。

## 2026-11-03 Chrome SQLite 损坏检测与安全拒绝（Issue #77）

- 红测：在合成 Chrome Profile 的 `Cookies` SQLite 数据库中损坏名称索引页，同时保持 Cookie 主表可读。旧实现仍读出 100 条 Cookie 并显示“导入完成”，证明只 SELECT 主表不足以识别数据库完整性问题。
- 修复：只读导入前对 History/Cookie 数据库执行 `PRAGMA quick_check`；检测到页/索引异常即拒绝导入。SQLite `BUSY/LOCKED` 提示用户完全退出 Chrome；`CORRUPT/NOTADB` 与完整性检查异常说明数据库可能损坏或格式不兼容，并明确本次未写源文件或所选类别。其他读取错误保持独立诊断。
- 绿测：`env -u ELECTRON_RUN_AS_NODE node tests/chrome-import-e2e.cjs` EXIT 0（macOS、Node.js v24.14.1、Electron 45.2.1、隔离真实 Electron Profile）。E2E 断言损坏 Cookie 索引拒绝写入、既有 `library.json` 字节不变、目标 Cookie store 为空、损坏 Chrome Cookie 文件字节不变；既有导入/回滚/重启测试同时通过。`node --check desktop/chrome-import.cjs`、`node --check tests/chrome-import-e2e.cjs` 与 `git diff --check` 通过。
- 远端主线复验：修复基于包含 PR #119 的 `f8cc34f` 重放后，再次运行定向 `chrome-import-e2e` 与完整 `env -u ELECTRON_RUN_AS_NODE npm test`；均 EXIT 0。全量覆盖 45 条独立脚本与 8 个串行 `node:test` 用例，共 53 项。
- 锁竞争回归加入后，再次运行 `node --check tests/chrome-import-e2e.cjs`、定向 `chrome-import-e2e` 与完整 `env -u ELECTRON_RUN_AS_NODE npm test`；均 EXIT 0。完整套件仍为 53 项，新增测试确认预览后发生 `SQLITE_BUSY` 时导入失败关闭。
- SQLite 占用回归：在完成 Chrome 来源预览、选中 Cookie 并同意敏感数据提示后，测试连接对合成 `Cookies` 数据库持有 `BEGIN EXCLUSIVE`，再提交导入；Electron 真实运行态收到 `SQLITE_BUSY`，UI 显示“可能仍被 Chrome 占用”，导入不报告成功，`library.json` 与目标 Cookie store 保持原状，Cookie 源文件字节不变。测试结束在 `finally` 回滚锁定连接。该测试证明提交阶段锁竞争的错误分类与失败关闭，不模拟真实 Chrome 进程锁行为。定向 `chrome-import-e2e` EXIT 0，包含损坏索引及锁竞争两条拒绝路径。
- 本轮独立复验：本机 macOS、Node.js 24.14.1、Electron 45.2.1；修正来源预览测试等待 Cookie 分类启用的条件后，`node --check tests/chrome-import-e2e.cjs`、`git diff --check`、定向 `env -u ELECTRON_RUN_AS_NODE node tests/chrome-import-e2e.cjs` 与完整 `env -u ELECTRON_RUN_AS_NODE npm test` 均 EXIT 0。完整套件通过 45 条独立脚本及 8 项串行 `node:test`，共 53 项。依赖使用隔离 worktree 内的本地硬链接副本；未读取真实 Chrome Profile/系统钥匙串，未调用 OAuth、Provider 或模型。
- UI/UE 参考：2026-11-03 09:20（Asia/Shanghai）通过 REA 受控 Chromium 156.0.8078.79 直接观察 Kobra Alert（`https://kobra.systems/components/alert`）。直接观察：AX 树中主内容使用命名为 `alert` 的语义区域呈现上下文消息，右侧可选 Error/Warning/Success/Info 四类预览（Evidence `ev_7dbddd29058eef11227135f0879409777f91101dca4a0c7d543d9886057d2f61`）。推断：错误状态可明确区分级别并保留上下文说明；Corvid 按自身错误合同显示原因和恢复步骤，没有移植其代码/样式。未知：Kobra alert 的读屏实际播报、持久时间、关闭/键盘交互未验证；Rare UI 与本次错误态无更相关且可观察的切面，未扫描其他参考站点。
- 限制：损坏由合成 SQLite 索引页注入，不是用户真实 Chrome 文件；未注入真实 Chrome 进程锁库、磁盘满、部分写入、进程崩溃或跨版本 Chrome schema。`quick_check` 不能修复损坏源库；Issue #77 继续开放，真实目标磁盘故障后的持久恢复仍未证明。


## 2026-11-03 Agent 凭据系统安全存储（Issue #110）

- 实现：`agent-credentials.json` 升级到 schemaVersion 2，Provider 类型与 Electron 异步 `safeStorage` 密文分开保存。macOS/Windows 使用 Electron 系统密钥后端；Linux 校验异步密文标记，仅接受 Chromium 156 的 Secret Service `v11` 与 Portal `v12`，拒绝固定口令 POSIX 回退 `v10` 与未知标记。安全存储未就绪时返回带稳定标识的错误，由 Corvid locale 资源映射为 zh-CN/en 恢复提示；不创建明文新凭据。旧 schemaVersion 1、runtime `auth.json` 与自定义端点明文 Key 采用备份、加密、解密回读核验后再清理的迁移顺序；失败恢复旧文件。备份清理失败时保留备份供下次启动验证处理。
- #118 基线验证（Linux provider 标记修正前）：`node --check` 涵盖凭据存储、Pi 模型管理、主进程、模型 E2E 与自定义端点 E2E，`git diff --check` 通过；`node tests/pi-models-e2e.cjs` EXIT 0，覆盖 API Key/OAuth 加密、schema v1 与 runtime 授权成功迁移、不可用安全存储/加密失败保持原字节、密钥轮换和并发写入。 `env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0（45 条独立脚本 + 8 个 `node:test` 用例，共 53 项）；这是当前追溯修正前的基线，不代表本次改动后的全量结果。
- Electron 集成：`tests/pi-custom-endpoint-e2e.cjs` 仅使用本地 HTTP 模型夹具和合成 Key；验证发现模型与本地 Agent 请求可读取密文凭据、持久化 JSON 不出现明文 Key。未连接真实 Provider、未运行 OAuth 或 GPT-6 Luna 请求。
- 限制：macOS 开发环境 `safeStorage` 的集成结果不代表签名发布版、Windows/Linux、OS 用户切换、崩溃/断电每个指令点的恢复或真实钥匙串升级体验。同一 OS 用户下的其他进程可能访问应用解密能力；文件权限不提供进程隔离。macOS Keychain 行为依赖打包签名一致性。
- 追溯复核修正（2026-11-03）：原 Linux allowlist 读取 `getSelectedStorageBackend()`，但 [Electron 45.2.1 的异步 API 实现](https://github.com/electron/electron/blob/v45.2.1/shell/browser/api/electron_api_safe_storage.cc)走独立 `OSCryptAsync` provider 链；[Electron 主进程配置](https://github.com/electron/electron/blob/v45.2.1/shell/browser/browser_process_impl.cc)会在 Portal、Secret Service 后加入 Posix 回退。因此同步后端名称既不能证明异步实际 provider，也会误拒绝可用 Portal。Electron 45.2.1 固定使用 Chromium 156.0.8078.75；该版 [Posix provider](https://github.com/chromium/chromium/blob/156.0.8078.75/components/os_crypt/async/browser/posix_key_provider.cc)使用固定密钥并标记 `v10`，[Secret Service provider](https://github.com/chromium/chromium/blob/156.0.8078.75/components/os_crypt/async/browser/freedesktop_secret_key_provider.cc)标记 `v11`，[Portal provider](https://github.com/chromium/chromium/blob/156.0.8078.75/components/os_crypt/async/browser/secret_portal_key_provider.h)标记 `v12`；[Encryptor](https://github.com/chromium/chromium/blob/156.0.8078.75/components/os_crypt/async/common/encryptor.cc)把 provider 标记写在密文开头。现改为只允许 `v11`/`v12`，对新加密结果和读取的既有密文都校验；这是对 Electron/Chromium 内部格式的适配，升级必须重新审查。测试中的 Linux platform/provider tag 是注入模拟，尚未构成原生 Linux 验证。Issue 继续开放，等待签名版及 Windows/Linux 实机/CI 证据。
- 重基后凭据合同复验（2026-11-03）：重放到最新 `origin/main` 后，`pi-models-e2e` 首次运行发现中英文错误合同 fixture 未显式设置应用 locale；测试现用 `corvidI18n.setLocale(language)` 建立对应状态后，`node tests/pi-models-e2e.cjs` EXIT 0，覆盖 zh-CN/en 的安全存储错误映射及凭据迁移合同。该测试仅使用 Node、临时目录和假安全存储，不启动 Electron；通过临时依赖链接使用本地安装的模块，测试后已移除链接。此结果不代替原生 E2E；macOS/Windows/Linux GitHub Actions 尚未运行。
- 重基后 macOS 原生复验（2026-11-03）：macOS 26.5.1、Node.js v24.22.1、Electron 45.2.1；`env -u ELECTRON_RUN_AS_NODE node tests/pi-credential-os-store-e2e.cjs` EXIT 0，实测异步 `safeStorage` 可用、合成 API Key 仅以 schemaVersion 2 密文保存、重启后重新读取连接状态并在登出后删除凭据。测试使用隔离临时数据目录和本地依赖链接，未发起真实模型请求或 OAuth；本次只证明 macOS 开发环境，Windows/Linux 结果仍待原生 Actions 矩阵运行。
- 本轮追溯修正验证：macOS 26.5.1、Node.js v24.14.1；`node --check desktop/agent-credential-store.cjs`、`node --check tests/fake-safe-storage.cjs`、`node --check tests/pi-models-e2e.cjs`、`node tests/pi-models-e2e.cjs` 与 `git diff --check` 均通过。定向用例用模拟密文验证 `v11`/`v12` 放行、`v10`/未知标记在新写入和读取时拒绝、既有文件逐字节保留，以及 `basic_text` 同步标记下 Portal `v12` 仍放行；Linux 与 provider tag 均为注入模拟，不是 Linux 原生验证。本轮未运行 Electron E2E 或全量 `npm test`。
- 双语错误映射补充：`node --check desktop/agent-credential-store.cjs`、`desktop/locales.js`、`desktop/renderer.js`、`tests/pi-models-e2e.cjs` 与 `git diff --check` 通过；`node tests/pi-models-e2e.cjs` EXIT 0。该定向 Node 合同测试用注入的 `v11`/`v12`/`v10`/未知密文标记验证 Linux 放行/拒绝、旧文件保留，并以中英文 locale 资源检查稳定错误标识映射；通过临时链接复用主工作区已安装的依赖，测试后移除链接。未启动 Electron。
- macOS 原生集成定向验证：macOS 26.5.1、Node.js v24.22.1、Electron 45.2.1；`env -u ELECTRON_RUN_AS_NODE node tests/pi-credential-os-store-e2e.cjs` EXIT 0。隔离 Electron 检查异步 `safeStorage` 可用，合成 API Key 保存为 schemaVersion 2 密文且文件权限为 0600，重启后仍可读取，登出后记录删除。依赖通过临时链接复用主工作区已安装包，测试后移除链接；未调用真实模型/OAuth。该证据仅覆盖当前 macOS 开发构建，签名发布版、Windows/Linux 原生后端及全量 `npm test` 仍未验证。
- macOS 原生集成复验（2026-11-03）：macOS 26.5.1、Node.js v24.14.1、Electron 45.2.1；`env -u ELECTRON_RUN_AS_NODE node tests/pi-credential-os-store-e2e.cjs` EXIT 0，重新覆盖隔离数据目录中的系统安全存储可用性、密文保存、重启读回与登出删除。临时链接复用主工作区依赖后已移除；未调用真实模型/OAuth。该复验仍只证明本机 macOS 开发构建。
- 跨平台工作流静态检查（2026-11-03）：`actionlint` v1.7.12 对 `.github/workflows/credential-os-store.yml` 检查通过；CI 固定 Node.js v24.22.2。此项只证明工作流静态语法/合同可解析，不代表 GitHub Actions、Windows 或 Linux runner 已运行。
- 全量回归补验（2026-11-03）：候选分支执行 `env -u ELECTRON_RUN_AS_NODE npm test`，EXIT 1。串行套件通过 `node:test` 的 8 项和此前多个 Electron E2E 后，在 `tests/agent-runtime-contract-e2e.cjs` 失败：Room 交接后延迟完成的 `preparingStart` 于 `desktop/agent-workbench.cjs:188` reject，测试在 `tests/agent-runtime-contract-e2e.cjs:206` 未捕获该拒绝。#110 分支不修改上述 Workbench 模块或测试文件；该失败已交给负责 Agent handoff/#96 的会话核对，故本次候选的完整 `npm test` 尚未通过，不能记为全量绿色。测试结束后移除了临时 `node_modules` 链接；定向 Linux 标记合同和 macOS 原生凭据 E2E 仍分别通过。
- 全量回归复验（2026-11-03）：在临时验证 worktree 基于 #110 提交 `b7aa3cd` 并 cherry-pick #96 合同修复 `902cfab` 后运行 `env -u ELECTRON_RUN_AS_NODE npm test`。#96 的 `agent-runtime-contract-e2e.cjs`、#110 的模型/凭据与 `pi-credential-os-store-e2e.cjs` 均通过；套件随后在第 44 个独立脚本 `tests/chrome-import-e2e.cjs:317` 等待 extension popup outside-click 关闭时超时并 EXIT 1。失败属于 #129 扩展弹窗，已交由另一会话单独复现；该组合运行不证明 PR #135 当前基线全量通过，也未验证 Windows/Linux 原生存储。
## 2026-11-03 Agent 空态到工作台的键盘路径（Issue #16）

- `tests/agent-rooms-panel-e2e.cjs` 现从“Agent 工作区”侧栏入口开始，仅用 Enter 打开空态、打开内置 Corvid Agent 并关闭工作台；断言当前焦点留在入口、转入描述输入框，并在关闭后回到侧栏入口。定向命令 `env -u ELECTRON_RUN_AS_NODE node tests/agent-rooms-panel-e2e.cjs` EXIT 0；完整 `env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0（45 个独立 E2E 脚本与 8 个 `node:test` 用例，共 53 项）；`node --check tests/agent-rooms-panel-e2e.cjs` 与 `git diff --check` 通过。使用隔离数据目录和本地确定性 fixture；未连接真实模型/OAuth。仍不代表完整 VoiceOver 验收。
- UI 参考核验：2026-11-03 通过 REA 受控 Chromium 156.0.8078.79 访问 Kobra Navigation Menu（`https://kobra.systems/components/navigation-menu`）。直接观察：页面 AX 主导航提供有名称的 Products、Solutions、Resources 按钮和 Pricing 链接（`ev_2339b4cab4b45e2596223b85bd032e4df085e8122030453ec35a547f31c7f11e`）；Kobra 页面来源面板写明组件基于 Base UI Navigation Menu primitive（`ev_b7ee07fab2232d4e792dd1e065e21d9846667812fe8a7c8d84ad97faf15ab02e`）。受控 ArrowDown 后 AX 树未显示展开子菜单（`ev_5abe346d7c3f32832d0f148c995ec71c2260bcaa5d8c22cfcee9ea693e9b5556`），故不推断其完整键盘行为。Rare UI（`https://rareui.com/`）仅呈现 Vercel Security Checkpoint（`ev_f2ea0fa5cdeca7d8b14710c80abd66a5e367a3cabc0eff9faa49a22dc8df806e`），该站点没有可观察的组件参考。参考用于检查命名表达，不作为 Corvid 验收标准；未移植代码或素材。
- 补充 UI 参考核验：2026-11-03 10:07（Asia/Shanghai），通过 REA 受控 Chromium 156.0.8078.79 访问 Kobra Chat Input（`https://kobra.systems/components/chat-input`），视口 1280×720、空 Cookie/存储、`en-US`、浅色、减少动态效果。直接观察：REA 可访问树包含名称为 “Message the agent” 的文本框，以及分别命名为 “Add files”、“Opus 5.5”、“Dictate” 和 “Start voice mode” 的按钮（`ev_397c7afcf8153fedf7180367e61f91b485587eaae982a4c67a434e7c765d1f9e`）。推断：为输入与附加操作提供独立可访问名称有助于识别控制项；这只是参考观察，不构成 Corvid 设计要求。未知：本次未操作控件，未验证 Tab 顺序、焦点样式、提交/语音行为或屏幕阅读器播报；REA 对运行宿主平台和架构未提供证据。覆盖限制：仅观察公开组件文档页的 DOM/AX 树，不代表安装版 Kobra，也未移植代码或素材。

## 2026-11-03 网站权限提示中文名称（Issue #115）

- 红测：真实 Electron + 隔离数据目录中捕获 `dialog.showMessageBox` 选项，原提示为 `http://127.0.0.1:<port> 请求 notifications 权限`；将站点权限审查的 `notifications` 文案设为中文后，旧实现也按预期失败。
- 实现：新增 `desktop/permission-labels.cjs`，以锁定的 Electron 45.2.1 `Session.setPermissionRequestHandler` 类型联合为完整映射范围；媒体请求按 `audio` / `video` 显示“麦克风”/“摄像头”，未知类型使用“一项尚未识别的浏览器权限”。请求弹窗与站点权限审查均使用中文名称；保留来源、浏览身份、空间、范围以及默认“拒绝”。
- 验证：`env -u ELECTRON_RUN_AS_NODE node tests/permissions-e2e.cjs` EXIT 0；真实 Electron + 本地 HTTP fixture 验证通知请求与站点权限审查文案、权限表逐项覆盖、摄像头/麦克风与屏幕共享音频名称映射、未知 ID 脱敏、默认拒绝、授权隔离、撤销、导航竞态和重启。`env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0（45 条独立脚本 + 8 个 `node:test` 用例，共 53 项）；增加屏幕共享音频映射后再次定向回归通过。`node --check desktop/permission-labels.cjs`、`desktop/main.cjs`、`tests/permissions-e2e.cjs` 与 `git diff --check` 通过。未调用真实模型或 OAuth。
- 界面参考与限制：本轮仅更换原生确认框的内容文本，不改变布局、焦点或动效；没有使用 Rare UI、Kobra、EasyUI、Pin UI 或 Aceternity UI 的视觉模式。未取得 EGO/Kaze 权限提示的可引用 REA Evidence，因此不对两者该对话框作比较或结论。E2E 替换了 `dialog.showMessageBox`，证明应用传入正确文案，不证明 macOS 原生对话框渲染/焦点、真实摄像头/麦克风/位置授权或其他平台行为。

## 2026-11-03 增强 Electron E2E 启动诊断与清理（Issue #87）

- 目标：启动失败要能区分 Playwright launch、首个桌面窗口与 `control.json` 新凭据等待阶段；报告隔离数据目录、进程状态、窗口与最近日志但不输出 token；清理必须有限时，并在挂起时结束测试子进程。
- 实现：新增 `tests/electron-test-startup.cjs` 共享启动/清理 helper，Library 与慢恢复 E2E 改用它；新增 5 个合成启动/退出/脱敏/清理测试。
- 验证：macOS、Node.js 24.14.1、Electron 45.2.1；重基至包含 PR #114 的最新主线后，`env -u ELECTRON_RUN_AS_NODE npm test` 连续两轮 EXIT 0，每轮 `node:test` 8 项 + 45 条独立脚本，共 53 项。两轮均经过多窗口重启、Library、慢恢复、MCP、Agent、Chrome 导入与导航用例。`node --check`（新增 helper 及两个改造脚本）、`git diff --check` 通过。
- 限制：合成用例验证诊断和清理合同，不复现真实 Electron 间歇启动挂起，也不证明其根因已修复；根因仍由 Issue #87 跟踪。没有连接模型、OAuth、真实网站或真实用户 Profile；只在 macOS 开发环境验证。

## 2026-11-03 取消 Electron E2E 正常关闭后的回退计时器（Issue #34）

- 诊断：在隔离 worktree 对 `restore-loading-e2e` 的清理阶段临时记录时间、Electron 子进程、HTTP 连接和 Node 活动资源。修复前，PASS 后约 1.85 秒已完成 Electron/server/临时目录清理，但 Node 到约 4.80 秒才 `beforeExit`；活动资源显示 Promise.race 中未胜出的 3 秒 graceful-close timeout 仍被引用。独立红测拦截 `setTimeout`/`clearTimeout`，确认正常关闭返回后有 1 个未取消 timer（0 !== 1）。这解释约 3 秒额外等待，不解释 Issue 报告的 5 分钟停顿。
- 修正：`closeElectron()` 的优雅关闭与超时竞速完成后立即清除回退 timer；合成合同检查确保快速成功退出也取消未使用的 timer。
- 验证：`env -u ELECTRON_RUN_AS_NODE node --test tests/electron-startup.e2e.mjs` 6/6 通过；`env -u ELECTRON_RUN_AS_NODE node tests/restore-loading-e2e.cjs` EXIT 0，临时诊断显示 Electron 子进程退出、fixture 连接清零、server 与目录清理完成后约 1.56 秒触发 `beforeExit`；移除临时诊断后，全量 `env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0，22 项 `node:test` + 50 条独立脚本，共 72 项通过。环境为 macOS、Node.js v24.14.1、Electron 45.2.1；使用隔离数据目录和本地 fixture。
- 限制：两轮当前全量回归与定向用例都未复现历史 5 分钟停顿；本修正确认并移除一个 3 秒尾部等待，不证明历史长停顿根因已解决。Issue #34 保持开放；再次出现时需在停顿现场采集 Node/Electron PID、PPID、进程状态与活动句柄。

## 2026-11-03 修正多窗口 E2E 的渲染与持久化等待（Issue #113）

- 初始现象：独立与全量真实 Electron 回归曾报告重启后窗口数不足；在失败诊断中发现 `#rooms button` 会匹配静态侧栏按钮，不能证明 Room 列表已绘制。重启前 `/rooms` 已显示第二窗口和 Room，但 `rooms.json` 仍可能只有一窗记录。
- 根因：测试等待条件只读内存态并错误选择静态按钮，可能在 Room/Tab 初始化或窗口归属持久化之前退出应用；失败并未证明已持久化窗口会丢失。
- 修正：每个窗口等待 `#room-strip button`；重启前等待相关 Tab `ready`，并比较 `rooms.json` 与控制 API 的窗口数、Room 数和所有权归属；关闭后复核持久化文件，恢复超时时输出磁盘/API/shell 快照。
- 验证：macOS、Node.js 24.14.1、Electron 45.2.1、隔离数据目录和本地 HTTP fixture；修正后 `env -u ELECTRON_RUN_AS_NODE node tests/multi-window-e2e.cjs` 连续 10 次通过；`env -u ELECTRON_RUN_AS_NODE npm test` 连续两轮 EXIT 0，每轮 45 条独立脚本 + 3 项 `node:test`，共 48 项。
- 限制：此测试合同只覆盖已就绪并写入 `rooms.json` 的窗口；未覆盖退出恰逢窗口/Room 尚在创建中的强杀语义、多显示器、打包版和 Windows/Linux。

## 2026-11-03 修正书签 E2E 的空间对话框时序（Issue #111）

- 现象：在最新 `origin/main` 上，独立运行 `tests/library-e2e.cjs` 时，地址栏草稿断言失败，表面上与已修复的 Issue #101 相同。
- 根因：测试只等待新空间按钮出现；`createTab` 的早期 `shell-state` 可先渲染空间按钮，而创建 Room 的异步调用尚未完成、模态对话框仍打开。Playwright 随即对被模态对话框遮挡的地址栏执行 `fill`，未触发输入事件。输入事件探针为空且地址栏未获焦点；等待 `#new-room` 隐藏后原路径通过。这是测试前置条件错误，不是产品草稿丢失。
- 修正：E2E 在填写地址栏前明确等待 `#new-room` 隐藏；导航、标题、书签、历史和重启持久化断言保持原样。
- 验证：macOS、Node.js 24.14.1、Electron 45.2.1、每轮使用隔离 Electron 数据目录与本地 HTTP fixture。修正后 `env -u ELECTRON_RUN_AS_NODE node tests/library-e2e.cjs` 连续 3 次通过；`env -u ELECTRON_RUN_AS_NODE npm test` 完整串行回归 EXIT 0。未连接真实站点或用户 Profile。
- 限制：该记录只覆盖 macOS 开发版与本地 fixture，不代表真实网页、打包版或其他平台验证。

## 2026-11-03 关闭最后一个用户标签后返回起始页（Issue #108）

- 行为决策：用户空间关闭最后一个标签后保留原空间、Profile 和窗口，并在同一空间创建由用户打开的 `about:blank` 起始页；仅在原页成功关闭后创建。Agent/API 关闭路径不补建用户起始页。
- 参考边界：EGO Lite 0.6.1.13 Agent API 运行态中，关闭唯一 Agent Page 后观察到活动的 `about:blank` 未托管标签；这只证明其 Agent Page close API 行为，不代表用户手动关闭最后标签的 EGO UI。产品策略依据 Corvid 的持久用户空间合同，不把未观察的 EGO 行为当作事实。
- 实现：浏览器关闭按钮、中键和 Cmd/Ctrl+W 共用用户空间收尾；页面通过 `beforeunload` 阻止关闭时保留原标签且不生成替代标签；Agent/API 的 `closeTab` 仍按既有 Agent 生命周期关闭。
- 红绿验证：先加真实 Electron E2E，旧实现因最后标签关闭后仍无起始页而超时；完成后覆盖关闭按钮、中键、Cmd/Ctrl+W、空间/Profile/窗口/所有权保持、起始页可用、beforeunload 取消及 Agent SDK 关闭边界。
- 命令：`env -u ELECTRON_RUN_AS_NODE node tests/tab-ux-e2e.cjs` EXIT 0；`node --check desktop/main.cjs`、`node --check tests/tab-ux-e2e.cjs`、`git diff --check` 通过。未运行全量 `npm test`，没有 OAuth 或模型请求。
- 限制：macOS 开发版、本地夹具；beforeunload 由测试替身确认；未验证 Windows/Linux、打包版、多窗口竞态、VoiceOver 或真实网站。浅色起始页截图 SHA-256 `3c0de8a57cfb62c015af8a7251062e559d80ebcb55f96640fcb9c9d90d6d0a97`，2096×1412，留在本机 `/tmp/corvid-last-tab.png`；目视结果见 QA 视觉记录。

## 2026-11-03 新标签起始页跟随系统深色主题（Issue #16）

- 缺口：浏览器壳和 Agent 工作区已跟随系统主题，但独立 `WebContentsView` 的新标签起始页使用写死的浅色值，暗色下成为亮色孤岛。
- 修复：在起始页闭合 Shadow DOM 中建立浅/深色语义变量；背景、搜索输入、书签、说明文字、标签和快捷入口统一引用变量。网站页面配色与 Agent 页面上下文合同不变。
- 红绿验证：先增加主题变量断言，未修复时因变量缺失失败；完成后定向 E2E 通过。测试使用隔离 Electron/临时 `CORVID_DATA_DIR` 和本地 HTTP fixture，并对目标 WebContentsView 使用 CDP 模拟浅色→深色→浅色，确认视觉变量切换及恢复；既有 Profile 书签隔离、搜索/快捷入口、标签 favicon、查找、拖拽与中键关闭也通过。
- 命令：`env -u ELECTRON_RUN_AS_NODE node tests/tab-ux-e2e.cjs` EXIT 0；`CORVID_DARK_THEME_SCREENSHOT_PATH=/tmp/corvid-newtab-dark.png env -u ELECTRON_RUN_AS_NODE node tests/tab-ux-e2e.cjs` EXIT 0；截图 SHA-256 `07d6e3ada314a66cafefbd61a1387ddb37a2a9c5c1f27ce95966603576686212`；`node --check desktop/new-tab-page.cjs`、`node --check tests/tab-ux-e2e.cjs`、`git diff --check` 均通过。
- 限制：未运行全量 `npm test`；CDP 媒体模拟不是系统设置切换，未验证 Windows/Linux、打包版、窄窗、VoiceOver 或真实网页；不调用 OAuth/模型。

## 2026-11-03 浏览器壳层系统深色主题（Issue #16）

- 实现：`desktop/styles.css` 将浅色与深色视觉值收敛为语义 token；壳层依据 `prefers-color-scheme` 跟随系统偏好。覆盖浏览器导航、菜单、标签、库面板、Agent 空态/对话输入、状态反馈、导入和设置对话框；实心主操作继续使用满足对比度的深色强调底。网站画布由独立 `WebContentsView` 承载，保持网站配色。
- 验收：真实 Electron `agent-rooms-panel-e2e.cjs` 先模拟 light 再切 dark，检查 `body`、侧栏、标签、地址栏、Agent 面板、CTA、空间对话框、Corvid Agent 输入区和空态图标的 computed style，并切回 light 断言原配色恢复。红测先纠正了对面板基础色的错误预期（应沿用 `--surface`）；地址栏还有 150ms CSS 过渡，因此测试等待目标颜色而不是采样中间帧。修正后通过。
- 结果：`CORVID_THEME_SCREENSHOT_PATH=/tmp/corvid-dark-theme.png env -u ELECTRON_RUN_AS_NODE node tests/agent-rooms-panel-e2e.cjs` EXIT 0；隔离 Electron 目视检查通过，截图 SHA-256 `44ef80300da82fbfa8c55f82dd0ddc3844d0a97d997556c8448026a6356c0aea`。颜色对比抽查：主按钮白字/强调底 4.88:1、正文 14.16:1、次级文本 9.60:1、占位符 4.58:1、警告 7.83:1、错误 6.65:1、成功 6.86:1。
- 限制：只模拟系统媒体偏好，未操作 macOS 外观设置；没有跑全量 `npm test`，也未验证 Windows/Linux、打包运行、网站页面自身主题或实际屏幕阅读器。

## 2026-11-03 Agent 工作区列表状态可访问播报（Issue #16）

- 缺口：Agent 工作区列表整块重绘，列表中的临时 `role=status` 随节点销毁，状态变化无法依靠稳定的 live region 播报。
- 修复：在面板内稳定保留 polite、atomic 的 status 区；仅对任务状态或空间控制权变化更新文案，面板关闭时隐藏播报区；状态快照建立后新增任务也会被播报。
- 红绿验证：旧实现运行 `env -u ELECTRON_RUN_AS_NODE node tests/agent-rooms-panel-e2e.cjs` 时因 `#agent-room-announcer` 不存在失败；修复后真实 Electron 回归通过，验证状态区属性、列表重绘前后 DOM 节点身份不变、任务行不生成重复 live region、关闭面板时清空旧播报，以及任务停止和空间接管时的任务状态与控制权文案。
- 其他检查：`node --check desktop/renderer.js`、`node --check tests/agent-rooms-panel-e2e.cjs`、`git diff --check` 通过；未运行全量 `npm test`。
- 边界：REA 无法检查本地 `file://` shell；E2E 证明 DOM live region 合同，不证明 VoiceOver 或其他屏幕阅读器的实际播报。

## 2026-11-03 内置 Agent 状态可访问播报（Issue #16）

- 缺口：`renderPiTasks()` 每轮会替换任务列表；列表内临时创建的 `role=status` 随即销毁，无法保证辅助技术收到稳定区域的状态更新。
- 修复：在工作台中保留稳定挂载的 polite live region；仅当当前所选任务状态或空间控制状态变化时播报，不重复朗读逐字回复。
- 红绿验证：真实 Electron E2E 在修复前因 `#pi-task-announcer` 不存在失败；修复后断言 `role=status`、`aria-live=polite`、`aria-atomic=true`、状态切换时 live region 节点身份不变，以及接管状态和空间控制状态均有更新。
- 命令：`env -u ELECTRON_RUN_AS_NODE node tests/pi-workbench-e2e.cjs`、`node --check desktop/renderer.js`、`node --check tests/pi-workbench-e2e.cjs`、`git diff --check` 均通过。未运行全量 `npm test`。
- 运行态证据：REA CDP 页面清单 Evidence `ev_093cc98569763990cf050b1121488623a685d612f7f9ff420a2148a047289b45` 不包含本地 `file://` shell；REA `inspect_web_page` 拒绝该目标。CUA 原生可访问树可见工作台入口与空态语义；未用 VoiceOver 验证实际播报。

## 2026-11-03 地址栏草稿在状态刷新中丢失（Issue #101）

- 根因：创建空间对话框关闭后，延迟到达的 `shell-state` 会触发 `draw()`；如果这时地址栏已失焦，旧逻辑会用当前页面 URL 覆盖刚输入但尚未提交的地址，导致 Enter 提交空字符串，页面仍停留在 `about:blank`。问题是浏览器交互缺陷，不是标签无障碍角色选错。
- 修复：地址栏输入时记录草稿及所属 Tab。shell 状态刷新不会覆盖当前 Tab 未提交的草稿；提交后清除草稿状态；切换 Tab 或无活动空间时清除旧草稿。
- 回归：`tests/library-e2e.cjs` 在输入 URL、主动失焦并触发一次真实 `activateRoom` shell 状态刷新后，断言地址栏仍保留草稿并通过 Enter 完成导航、保存书签/历史、重启持久化与删除。红测验证临时恢复旧实现会稳定失败，实际值为空字符串。
- 验证环境：macOS、Node.js 24.14.1、Electron 45.2.1、隔离临时数据目录、本地 HTTP fixture。`env -u ELECTRON_RUN_AS_NODE node tests/library-e2e.cjs` 通过；完整 `env -u ELECTRON_RUN_AS_NODE npm test` 通过，45 条独立脚本命令与 3 项 `node:test` 共 48 项。`node --check desktop/renderer.js`、`node --check tests/library-e2e.cjs` 与 `git diff --check` 通过。
- 限制：不访问真实用户资料，不连接真实网站；没有触发 OAuth 或真实模型。完整回归只覆盖当前 macOS Electron 环境。

## 2026-11-03 内置 Agent 任务级 Room 身份（Issue #96）

- 实现：每个内置 Agent 任务轮次由 Corvid 主进程签发单 Room 内存 scoped credential；续聊重新签发，完成、失败、停止及用户接管时撤销；会话仍在初始化时发生接管也会撤销身份，并丢弃随后才返回的会话，不向模型发送该轮 prompt。运行时连接页面读取与浏览器工具时显式使用该身份，缺少身份时失败关闭，不回退管理员凭据。原始凭据不写入 `agent-clients.json`、`agent-tasks.json` 或对话 transcript；外部 SDK/CLI 与 Browser MCP 继续沿用独立 scoped token 合同。
- 定向验证：本机 macOS、Node.js 24.14.1、Electron 45.2.1、临时测试数据目录。`env -u ELECTRON_RUN_AS_NODE node tests/agent-runtime-contract-e2e.cjs`、`tests/pi-runtime-e2e.cjs`、`tests/pi-models-e2e.cjs`、`tests/agent-access-e2e.cjs` 与 `tests/pi-workbench-e2e.cjs` 均通过；覆盖签发/续聊重新签发、成功/失败/停止/接管撤销、初始化期间接管时不发送 prompt 并清理迟到的 session、任务与授权落盘检查、无身份不回退管理员、Room 越权拒绝，以及真实 Electron 工作台用户接管。修改的 JS/CJS 文件 `node --check` 与 `git diff --check` 通过。
- 全量回归限制：`env -u ELECTRON_RUN_AS_NODE npm test` 未通过，在 `tests/library-e2e.cjs:58` 等待标签按钮“Fixture Page”时超时；RPC 集成检查已通过。随后单独重跑 `tests/library-e2e.cjs`，在同一断言再次超时。失败发生在内置 Agent 身份测试之前，尚未定位为产品缺陷还是测试/启动时序问题，由 [Issue #101](https://github.com/heyallencao/corvid/issues/101) 独立跟踪；因此本轮不宣称全量回归通过。
- 边界：未登录 Provider、未触发 OAuth、未调用真实模型，也未消耗 GPT-6 Luna 额度。只验证本机 macOS 和确定性 fixture；同一 OS 用户进程读取管理员 `control.json` 或控制 Corvid 主进程的能力不受 scoped token 隔离，Windows/Linux 与打包构建尚未验证。

## 2026-11-03 Agent 访问管理界面与 Browser MCP scoped 身份（Issue #96、#98）

- 实现：设置内新增 Agent 客户端签发、一次性显示/复制、已授权 Room 范围列表及即时撤销；只在本机保存 token 的 SHA-256 摘要，文件权限为 0600。Browser MCP 只接受 `CORVID_AGENT_TOKEN`，缺失时拒绝请求且不回退管理员凭据；Profile 列表只返回已授权 Room 所属浏览身份。SDK 可显式传入 scoped token，并从本机控制配置读取 endpoint，不读取其中管理员 token。
- 验证：本机 macOS、Electron 45.2.1、隔离 `CORVID_DATA_DIR`。`node tests/agent-access-e2e.cjs`、`node tests/agent-access-ui-e2e.cjs`、`node tests/mcp-e2e.cjs` 均 EXIT 0；覆盖 Room/Profile 授权过滤、设置内创建/复制/关闭后清空/撤销、撤销即时失效、无 token 不降级、拒绝向非本机配置端点发送 scoped token、MCP 页面操作与越权拒绝。相关桌面/SDK/MCP/测试文件 `node --check` 及 `git diff --check` 通过。`node --test --test-concurrency=1 tests/browser.e2e.mjs` EXIT 0。全量 `npm test` 未运行。
- 界面检查：隔离真实 Electron、704×568 CSS px。目视检查截图显示授权标题、信任边界提示、客户端表单和创建操作均可见；已授权客户端列表位于可滚动内容下方。剪贴板由 E2E 替身接管，没有修改用户剪贴板。
- 限制：MCP 的页面动作测试在执行前显式激活获准 Room。用户留在新标签起始页时后台 Room 的 WebContentsView 仍可能隐藏，页面操作边界由 [Issue #98](https://github.com/heyallencao/corvid/issues/98) 跟踪；内置 Agent 身份统一、同一 OS 用户进程隔离和真实 MCP host 尚未验证。没有进行真实模型调用。

## 2026-11-03 Agent 客户端 Room 授权基础切片（Issue #96）

- 实现范围：管理员可创建、列出与撤销外部 Agent 客户端凭据；每个客户端绑定明确 Room ID。原始 scoped token 仅创建响应返回，磁盘只保存 SHA-256 摘要，`agent-clients.json` 权限为 0600。服务端按身份与 Room scope 限制 `/rooms`、Room 与 Tab 路由；scoped client 无法读取全局 Profile、历史、书签、下载和窗口路由。SDK 支持 `connect({baseUrl, token})`、签发/列出/撤销授权，并新增 `CORVID_FORBIDDEN`。
- 验证通过：Node 24.14.1/macOS、本机 Electron 45.2.1、临时 `CORVID_DATA_DIR`；`node tests/agent-access-e2e.cjs` EXIT 0，覆盖两个客户端各自只列出授权 Room、Room 内创建标签、猜测另一 Room 的 Tab ID 返回 403、全局数据接口拒绝、SDK 授权管理、显式凭据必须成对并拒绝非本机 endpoint、仅存哈希与 0600 权限、撤销即时生效、未撤销授权重启后仍有效和已撤销授权重启后继续失效。`node --test --test-concurrency=1 tests/browser.e2e.mjs` EXIT 0，既有主控制服务 401/Bearer 与浏览器操作合同通过。`node --check` 覆盖桌面模块、授权存储模块、SDK 与新 E2E；`git diff --check` 通过。
- 回归限制：`4396441` 父提交基线与本分支均复现三项既有回归：`tests/rpc-e2e.cjs` 的功能断言通过后，临时目录清理报 `ENOTEMPTY`；`tests/sdk-e2e.cjs` 在截图 PNG 签名断言失败；`tests/mcp-e2e.cjs` 的 `page_fill` 断言收到错误。三项在本地 `main` worktree 均通过。该本地分支含有尚未进入 `origin/main` 的 Chrome Cookie 回滚与新标签 WebContentsView 变更；证据表明失败早于本 PR，但本轮不宣称这些回归已修复或全量回归通过。全量 `npm test` 未运行。
- 安全/产品边界：此切片未提供桌面授权管理 UI，内置 Corvid Agent 与 MCP 还未统一接入 scoped identity；管理员 `control.json` 仍对能读取同一用户 Corvid 数据目录的进程可见，不构成 OS 级恶意同用户进程隔离。后续完成范围见 D23 和 Issue #96。

## 2026-11-03 Corvid 新标签起始页（Issue #93）

- 方向依据：已安装 EGO 0.6.2.5 的既有 REA 页面证据 `ev_3a5609d1eb705ccdf3c5071061a8a6b7aafa5a604f570f210b9c81a8a5c86e5e`（Google 新标签起始体验）；Kaze 0.26.0 仅有浏览器/Agent 工作区观察，未核实其新标签行为。此轮 REA 对两款应用的原生窗口截图因窗口与进程不匹配而失败，故不把失败当成产品证据，也不据此推断 Kaze。
- 实现合同：用户空白标签仍为 `about:blank`，Corvid shell 显示搜索/地址输入、当前浏览身份的常用书签、全部书签、历史和 Corvid Agent 入口。导航复用地址栏现有搜索模板及 URL 验证；书签仅从当前 Profile 读取，不加载远程 favicon；起始页显示时收起浏览器书签栏，避免与起始页书签重复；起始面板不作为 Agent 页面上下文。活动起始页期间隐藏该 BrowserWindow 的页面 WebContentsView，离开时恢复常规浏览画布。
- 验证：本机 macOS、真实 Electron、隔离临时数据目录及本地 HTTP fixture；`env -u ELECTRON_RUN_AS_NODE node tests/tab-ux-e2e.cjs` 通过，覆盖空白页显示、本地搜索模板导航、书签快捷打开、跨 Profile 书签隔离、空白页收起书签栏及既有标签操作。`node --check desktop/main.cjs`、`node --check desktop/renderer.js`、`node --check tests/tab-ux-e2e.cjs` 及 `git diff --check` 通过。未调用 OAuth 或模型；未运行全量测试套件。
- 视觉检查：隔离窗口截图 2560×1636，SHA-256 `abd17037dde5f348c264c3515eff4931037dc83ebaab206e1d7a5e507317555d`；画面包含 Corvid 品牌、明确搜索入口、常用书签卡片和历史/Agent 快捷入口，浏览器书签栏在空白页收起。截图只保存在本机临时目录，未提交；细节与限制见[视觉检查记录](../qa/ui-visual-check.md#2026-11-03-corvid-新标签起始页)。
- 限制：本地 fixture，不验证真实搜索服务/网站、键盘与 VoiceOver、暗色、窄窗、Windows/Linux；起始 UI 采用 shell 本地视图，不宣称复刻 EGO 页面实现。EGO 当前版本由安装包元数据复核为 0.6.2.5；Kaze 当前版本 0.26.0。

## 2026-11-03 空间产品语义与 Electron 测试焦点竞争修复（Issue #16、#86）

- 以隔离真实 Electron/CUA 检查空间导航、菜单、默认名称、Agent 空态和工作台。UI 将 Room 呈现为“空间”、Corvid Profile 呈现为“浏览身份”；Agent 入口与状态使用 Corvid 产品文案，运行时标识留在内部实现和 selector 中。运行时错误 fixture 仍验证错误卡片不泄漏底层运行库名称。
- 修复顶层 Electron `node:test` 并行启动造成的 macOS 焦点竞争，将 test runner 改为 `--test-concurrency=1`；不改变独立 E2E 脚本和产品运行时。
- `env -u ELECTRON_RUN_AS_NODE npm test` 最新运行 EXIT 0：43 条独立 E2E 脚本与 3 项串行 `node:test` 共 46 项通过。Corvid Profile 可见文案统一为“浏览身份”；受影响的 8 项 E2E（Profile 管理、快捷键设置、站点数据、权限、Chrome 导入、库搜索、Agent 空间面板、Agent 工作台）均单独串行通过。布局 E2E 改用测试应用自身的 BrowserWindow，避免依赖系统前台焦点；`node --check` 三个修改后的桌面模块与 `git diff --check` 通过。
- 一次全量复跑遇到 [Issue #87](https://github.com/heyallencao/corvid/issues/87)：Electron 启动阶段未能产生隔离目录的 `control.json`，受影响脚本随后单独通过；修正焦点窗口定位后，最新全量复跑成功。Issue #87 继续跟踪偶发启动挂起的根因和启动诊断。
- 边界：仅 macOS 浅色主题与隔离测试数据；没有 VoiceOver/屏幕阅读器、Windows/Linux、真实网页、OAuth 或真实模型调用验证。

## 2026-11-03 Corvid Agent Provider 凭据所有权与旧格式迁移（Issue #78）

- Corvid 新增版本化 `agent-credentials.json`：API Key / OAuth 凭据使用 Corvid schema；模型运行时经 `CredentialStore` 适配器读取与刷新，凭据枚举只返回 Provider/type 元数据。文件与目录权限分别为 0600 / 0700；当前尚未接操作系统钥匙串加密。
- 首次读取会把旧 runtime `auth.json` 和 `pi-models.json` 中的端点 API Key 合并进 Corvid 凭据文件；新记录回读校验成功后才清理旧授权副本、将旧端点密钥替换为无敏感引用。Corvid 中已有 API Key 优先于旧副本。凭据更新使用单文件串行队列，避免不同 Provider 同时写入时互相覆盖。
- `pi-runtime-e2e.cjs` 验证没有 Corvid 模型适配器时 runtime 不创建/读取自有 auth 文件；`pi-models-e2e.cjs` 覆盖合成 API Key/OAuth 迁移、0600 权限、登出删除、元数据枚举、跨 Provider 并发写和模型偏好连续性；`pi-custom-endpoint-e2e.cjs` 以合成 Key 验证本地模型发现/调用、配置文件无明文 Key。
- 定向验证：`env -u ELECTRON_RUN_AS_NODE node tests/pi-runtime-e2e.cjs`、`env -u ELECTRON_RUN_AS_NODE node tests/pi-models-e2e.cjs` 与 `env -u ELECTRON_RUN_AS_NODE node tests/pi-custom-endpoint-e2e.cjs` 均通过。最新源码全量 `env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0：43 条独立脚本与 3 项 `node:test` 全部通过（46 项）。全量回归后另将三条会话配置错误改为 Corvid 产品语义，并用 `node --check` 和 `git diff --check` 验证；该纯文案改动后的 Agent 定向用例待复跑。
- 边界：没有调用真实 OAuth、Provider 或模型；不验证 macOS Keychain、Windows 文件权限、跨进程同时启动时对同一数据目录的写入、以及升级被强制终止时的凭据迁移恢复。

## 2026-11-03 Corvid Agent 授权提示运行时品牌隔离

- 在真实 Electron 的隔离工作台用例中注入带内部运行时名称的授权说明，验证授权弹窗将内容收敛到 Corvid 指引；检查窗口标题、可见文案、辅助名称和元素标题，并验证取消后界面仍无运行时品牌。
- 仅通过 renderer 事件 fixture 打开并取消弹窗；未登录 Provider、未触发 OAuth、未调用模型、未消耗模型额度。
- 边界：这证明 Corvid UI 的错误归一化与取消呈现，不证明真实 Provider 登录流程、系统浏览器回调或屏幕阅读器体验。

## 2026-11-03 Chrome Cookie 持久化核验与重启恢复（Issue #77）

- 保持按 URL/name 无法限制 path 时不删除同名旧 Cookie 的保护逻辑；部分回滚提示说明当前窗口可重试，关闭窗口或重启后需重新选择同一 Chrome 来源和目标 Profile 再导入。
- [Electron Cookies API 文档](https://www.electronjs.org/docs/latest/api/cookies) 描述 `flushStore()` 返回解析时 Cookie store 已 flush，但没有承诺底层文件系统写错误会拒绝该 Promise；本地 REA 运行观察补足了这个边界。
- REA 控制运行捕获 `ev_8d853848b440ca0bd610373e772629c9ea104b4c8657e247176e8589c13da474` 在 macOS arm64 隔离数据目录中观察到：普通用户对 Profile 目录的写权限为 false，`cookies.set()` 与 `flushStore()` 均解析；主进程 `SIGKILL` 并重启后目标 Cookie 不存在。文件系统快照不记录 syscall；另由 E2E 的 `writeFileSync` 断言确认只读目录返回 `EACCES`。
- 新增落盘核验：`flushStore()` 后用只读 SQLite 检查新导入的持久 Cookie 域名、名称和路径，不读取值；缺库、查询错误或缺少任一记录时撤回可安全撤回的本次 Cookie，显示错误并保留重试来源。会话 Cookie 仍按不跨重启保留的既有语义处理。
- 运行时会为 Node 内置 `node:sqlite` 发出 `ExperimentalWarning`；当前只读查询依赖 Chromium Cookies 表结构，Electron/Node 升级时需要复核 API 与表结构兼容性。
- 隔离真实 Electron E2E 覆盖真实只读 Profile 目录、静默 flush、失败呈现、内存回滚、强杀、恢复权限、重新选择 Chrome 来源导入及再次重启验证持久 Cookie。`NODE_PATH=/Users/allen/Workspace/projects/personal/corvid/node_modules env -u ELECTRON_RUN_AS_NODE node tests/chrome-import-e2e.cjs`：通过。
- 边界：未模拟磁盘满、SQLite 部分写入/损坏、核验前断电或未来 Chromium 数据库格式变化；SQLite 表/路径变化时当前核验会失败关闭。未访问真实 Chrome Profile 或系统钥匙串；Issue 保持开放。

## 2026-11-03 Corvid Agent 运行时错误变体隔离（Issue #89）

- 扩展界面错误归一化规则，覆盖大小写、空格/连字符/下划线组合的 Pi runtime/SDK/session/agent 标识及 Pi 包名；内部错误格式变体统一映射到 Corvid Agent 提示。
- `env -u ELECTRON_RUN_AS_NODE node tests/pi-workbench-e2e.cjs` 在真实 Electron、临时数据目录和确定性 fixture 下通过；fixture 注入小写 `pi runtime` 错误并确认错误卡片不暴露实现名称。`git diff --check` 通过。
- 未触发 OAuth、Provider 登录或真实模型调用；本次只验证当前运行时的错误出口，不代表另一个运行时的配置/会话迁移已经完成。

## 2026-11-02 Corvid Agent 用户界面运行时品牌隔离回归

- 将现有用户可见品牌断言提取为共用检查，并扩展到 Corvid Agent 模型管理弹窗的可见文案、辅助名称和标题；工作台本身与任务错误/恢复卡片继续由同一 Electron 用例检查。底层内部 selector、文件名和 fixture 可保留实现标识，不属于产品语义。
- `env -u ELECTRON_RUN_AS_NODE node tests/pi-workbench-e2e.cjs` 在本地 Electron、临时 Corvid 数据目录和确定性 Agent fixture 下通过；不触发 OAuth、不发起真实模型请求、不消耗模型额度。
- 边界：本次只扩充自动化可见文案回归，不替代授权 UI 的人工辅助技术检查，也不证明未来替换运行时后的凭据或 checkpoint 迁移；相关合同仍由 D19 / Issue #78 跟踪。

## 2026-11-02 Chrome Cookie 回滚保留旧值（Issue #77）

- 根因确认：Electron `cookies.remove(url, name)` 无 path 参数；同名旧 Cookie 可与本次导入的不同 path Cookie 同时匹配 URL。先 broad-remove 再 `cookies.set` 旧值会把安全性押在第二步恢复成功上。
- 修复改为保守回滚：若导入前存在同 URL/name Cookie，跳过不可按 path 限定的删除，保留旧 Cookie 与本轮新增 Cookie；明确显示部分回滚和“为保护目标 Profile 原有 Cookie，跳过删除回滚”，同一来源/目标仍可重试。只有没有旧 Cookie 时才调用 remove；remove 失败同样检查残留并展示告警。
- 真实 Electron E2E 注入 flush/remove 故障，分别验证无旧值时删除失败告警，以及旧 `/` Cookie 与新增 `/app` Cookie 在回滚和重试后都保留；未读取真实 Chrome Profile 或系统钥匙串。
- `env -u ELECTRON_RUN_AS_NODE node tests/chrome-import-e2e.cjs` 与 `env -u ELECTRON_RUN_AS_NODE npm test` 均通过；全量 43 条独立脚本与 3 项 `node:test` 共 46 项（EXIT 0）。真实文件系统 flush 失败后的跨重启持久恢复仍是未知，需要继续评估受保护恢复记录；Issue #77 保持开放到该边界收敛。

## 2026-11-02 Corvid 对话跨 runtime checkpoint 续聊（Issue #78）

- 差异复核确认旧任务记录的对话和任务 ID 虽保留，但不同 runtime 无法恢复 checkpoint，原流程只能提示用户切换兼容环境。
- 实现回退：checkpoint 不兼容时保留旧不透明引用，只将最多 40 条、24,000 字符的 Corvid user/assistant transcript 作为背景上下文创建新会话；不将旧 checkpoint 传给新 runtime。保留 task ID、模型偏好及 Profile/Room/Page 绑定，每次仍需重新预览并同意当前页面上下文。启动失败时旧 checkpoint 与已有对话不被覆盖。
- Electron 工作台用例写入未知 runtime checkpoint fixture，验证 Corvid 自有“从已保存对话继续”入口、长度提示、页面重新同意、旧消息/task ID 保留、新 checkpoint 建立、无 runtime 标识泄露。模块合同验证替代 runtime、任务模型/对话保留、有界 transcript 和迁移启动失败回滚。
- `node tests/agent-runtime-contract-e2e.cjs` 与 `node tests/pi-workbench-e2e.cjs` 通过；随后 `env -u ELECTRON_RUN_AS_NODE npm test` 全量 46 项检查通过（43 条独立脚本 + 3 项 `node:test`）。均使用确定性 fixture/假 runtime，无真实模型调用。升级真实 runtime 的 checkpoint 格式转换和 Provider 重新授权流程尚未由此验证。

## 2026-11-02 Chrome Cookie 回滚 delete/restore 故障复核（Issue #18）

- 红测先在旧代码上失败：注入目标 Cookie store flush 失败后，界面只显示首发 flush 错误，没有说明 rollback delete/restore 失败。
- 新增仅限 `CORVID_TEST_MODE=1` 的按 Cookie 名单次 remove/restore 故障注入；renderer 将“回滚未完整完成”标记为黄色部分状态，保持原目标 Profile、来源与重试动作。
- 真实 Electron E2E 分别注入 remove 和 restore 失败，读取目标 Cookie store 验证各自残留；同来源重试通过，并断言不会把已丢失的旧 Cookie 说成已恢复。
- 发现产品恢复缺口：restore 失败场景中，Electron `cookies.remove(url,name)` 会移除同名且匹配 URL 的多个路径 Cookie；如果之后 `cookies.set` 恢复旧值失败，旧目标 Cookie 会消失。当前告警诚实提示回滚不完整，但不能自动恢复丢失旧值。已创建 [Issue #77](https://github.com/heyallencao/corvid/issues/77) 设计受保护的补救/恢复路径。
- `env -u ELECTRON_RUN_AS_NODE node tests/chrome-import-e2e.cjs` 与全量 `env -u ELECTRON_RUN_AS_NODE npm test` 通过；全量 43 条独立脚本与 3 项 `node:test` 共 46 项（EXIT 0）。不读取真实 Chrome Profile 或系统钥匙串；本次无真实模型请求。

## 2026-11-02 浏览器与 Agent 面板宽度边界复查（Issue #16）

- 真实 Electron 基线证伪了布局合同：760px 内容宽度与 861–972px 区间的网页 `WebContentsView` 只有 308px；973–983px 为 309–319px。失败由新增 E2E 首次在 760px 断言中稳定复现。
- 主进程扣除网页/Agent 间距后的 12px 空间预算；CSS 侧同步按 874–984px 与 ≤873px 使用相同预算。最小窗口从 694px 提升到 704px，以保证窄窗也有 320px 网页与 280px Agent 内容。
- `env -u ELECTRON_RUN_AS_NODE node tests/agent-rooms-panel-e2e.cjs` 通过：在 704/720/721/800/860/873/874/900/972/983/984/1024/1280px 读取所有 WebContentsView bounds，均 ≥320px；Agent Room 卡片内容均 ≥280px；原多 Room、Profile、控制权与 704×568 窄窗断言继续通过。
- 全量 `env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0：43 条独立脚本与 3 项 `node:test` 全部通过，共 46 项检查；本轮 `restore-loading-e2e` 正常通过，未复现长停顿。截图不能覆盖独立 WebContentsView 正文；平台、辅助技术和高 DPI 缩放变化未验证。详情见[视觉检查](../qa/ui-visual-check.md#2026-11-02-窗口空间分配边界复查)。

## 2026-11-02 Agent Room 多任务状态最小窗口复核（Issue #16）

- 确定性 Electron fixture 在请求 640×600 窗口时受 Electron 最小尺寸约束，实际 renderer viewport 为 694×568 CSS px（2×）。两个并行 Room、四个运行/接管/停止/终态 task 状态与操作按钮均留在卡片内，无水平溢出。
- REA 隔离页面发现 Evidence `ev_fa3c888244c221819660a2594fb5273ec56d8710f643cfc5927003ca35352719`；只读页面观察 Evidence `ev_e1fec2d4cb90a5398c864d87c284644508e78201d872ab3c31782bf3b452e6ee`。REA 仅证明运行目标与 DOM/资源结构，不证明像素布局；视觉结论来自 Playwright shell 截图（SHA-256 `ee378bf42192236cebab759a859078ca428143777519a8b2b627dfae5e5e4c13`）。
- `env -u ELECTRON_RUN_AS_NODE node tests/agent-rooms-panel-e2e.cjs` 通过；测试断言四个状态仍存在、Room 与任务卡片无横向溢出、任务按钮位于视口内。确定性 task 查找按 prompt 定位，不会将上一条仍运行的任务误认作新任务。
- 全量 `env -u ELECTRON_RUN_AS_NODE npm test` 最终 EXIT 0，43 条独立脚本与 3 项 `node:test` 全部通过。`restore-loading-e2e` 在串行套件中无输出停留约 5 分钟后返回 PASS，随后全部后续用例通过；间歇性长停顿仍由 OPEN [Issue #34](https://github.com/heyallencao/corvid/issues/34) 跟踪，本次结果不等于该问题已修复。
- 限制：只覆盖 macOS、浅色主题、单窗口和本地 fixture；暗色、辅助技术与其他平台未验证。详见[视觉检查](../qa/ui-visual-check.md#2026-11-02-agent-room-多任务状态最小窗口)。

## 2026-11-02 Agent Room 任务状态与原对话回跳（Issue #73）

- Agent 工作区现在按 Room 展示其 Corvid Agent 任务状态及“查看对话”入口。状态取自任务存储，任务更新时刷新；Profile/面板发生变化后，过期异步结果会被丢弃。Room 控制权与任务运行状态分开呈现，不展示任务 prompt 或页面内容。
- 入口选中原 task ID 并回到原 transcript；任务页面绑定恢复到原 Room/Tab，但不改变用户当前前台 Room，也不创建新任务。所有用户可见状态和按钮都使用 Corvid Agent 语义，底层运行时名称只保留在内部实现与测试标识中。
- 定向验证：`node --check desktop/renderer.js`、`node --check tests/agent-rooms-panel-e2e.cjs`、`git diff --check` 通过；`env -u ELECTRON_RUN_AS_NODE node tests/agent-rooms-panel-e2e.cjs` EXIT 0。真实 Electron + 临时 Corvid 数据目录 + 本地 HTTP 页面 + 确定性 fixture，覆盖两个 Room 上同时运行的任务、运行/等待接管/中断/完成/失败状态、状态更新、Room 控制权独立呈现、prompt 不泄露、原 task ID 回跳、停止后状态更新及 Profile 过滤。
- 全量验证：`env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0；43 条独立脚本命令与 3 项 `node:test`，共 46 项自动化检查通过，包含 #73 新增并行任务状态断言。此前仍为 OPEN 的 [Issue #34](https://github.com/heyallencao/corvid/issues/34) 本轮没有复现；单次全量通过不视为其间歇性挂起问题已解决。
- 限制：未调用 OAuth 或真实模型额度；未验证多窗口、辅助技术、跨平台，也未做独立视觉截图复核。

## 2026-11-02 Agent Room 空态与内置 Agent 引导（Issue #16）

- REA 对隔离 Corvid Electron 运行态的结构观察与 CUA 可访问树/截图检查发现：Agent 工作区空态只提外部 SDK/CLI，没有引导用户进入内置 Corvid Agent；在 `about:blank` 上打开 Agent 时，页面绑定状态也未说明需先打开 HTTP(S) 页面。
- 修复：空态增加“打开 Corvid Agent”按钮，并说明页面内容须先检查和确认；Agent 工作台在当前页面不是 HTTP(S) 时显示可操作指引，不把 `about:blank` 当作可绑定上下文。
- 定向验证：先运行新增断言确认旧空态不能满足验收；修复后 `env -u ELECTRON_RUN_AS_NODE node tests/agent-rooms-panel-e2e.cjs` EXIT 0，覆盖空态入口、不可绑定页面、关闭焦点、并行 Room、Profile 隔离、窄窗、键盘接管/交还及风险复核。
- 当前截图/可访问树目视检查：隔离 `CORVID_TEST_MODE=1` Electron 窗口中 CTA 与 Corvid Agent 界面可见；GPT-6 Luna 账号显示未连接，未触发授权或模型调用。REA 结构 Evidence：`ev_35a2bd3b4ae11b542121538c93e8dfef506a4ad7132e9d9809ebc65ed84163c5`；REA 不支持对此 `file://` 页面截图，截图由 CUA 捕获。
- 全量验证：`env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0；43 条独立脚本命令与 3 项 `node:test`，共 46 项自动化检查通过。没有调用真实模型或 OAuth。
- 限制：不代表真实模型、真实网页、暗色、辅助技术、Windows/Linux 或其他窗口尺寸的视觉验收。

## 2026-11-02 Corvid Agent 产品语义独立于运行时（Issue #70）

- 约束：用户只接触 Corvid Agent、模型、对话、授权与恢复语义；具体执行引擎只作为可替换的内部实现。源码文件、依赖与隔离测试可保留实现名，便于诊断。
- 修复：模型不存在、Provider 不支持 OAuth/API Key 登录及授权步骤错误均改为 Corvid/Provider 语义。模型合同测试新增错误文本断言，确保这些路径不暴露运行时名称；桌面工作台的运行时错误隐藏合同仍由 `pi-workbench-e2e.cjs` 覆盖。
- 验证：`env -u ELECTRON_RUN_AS_NODE node tests/pi-models-e2e.cjs` 通过（EXIT 0）；`env -u ELECTRON_RUN_AS_NODE npm test` 通过（EXIT 0，43 条独立脚本命令与 3 项 `node:test`，共 46 项自动化检查）。本地数据目录及 fixture，不访问真实 Provider/OAuth，不调用模型。
- 限制：本轮没有重命名内部实现标识；尚未实际替换第二个运行时，也未验证跨运行时真实凭据/会话迁移。

## 2026-11-02 Corvid Agent 主动停止与迟到事件隔离（Issue #68）

- 基线复现：新增隔离真实 Electron E2E 后，先在未修复实现上运行并观察到停止后的 `assistant_delta` 把 task.output 改写为“迟到的停止后输出”；测试以非空 output 断言失败，确认 bug 可重复。
- 修复：runtime 事件处理同时检查 task 仍处于 running、事件来源仍是当前 session；主动停止立即落盘为 interrupted 并从活动 session 映射移除，等待 abort 完成后再 dispose。abort 失败或 dispose 失败会以 Corvid 错误提示结果无法确认，任务与 transcript 保留且禁止续写同一 transcript。
- 定向验证：`env -u ELECTRON_RUN_AS_NODE node tests/agent-stop-e2e.cjs` 通过，覆盖停止状态、迟到 assistant delta/tool event 拒收及 abort 失败提示；`env -u ELECTRON_RUN_AS_NODE node tests/pi-workbench-e2e.cjs` 通过，原有多轮对话、重启恢复、用户接管/交还合同保持。
- 全量验证：`env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0；43 条独立脚本命令与 3 项 `node:test`，共 46 项检查通过。未调用真实模型/OAuth，未消耗模型额度。
- 边界：fixture abort 不能证明真实 provider 的远端执行或页面副作用已终止；停止后的结果仍要求用户检查。

# 2026-11-02 Corvid-owned Pi runtime 与自定义模型端点

## 执行与结果

- Pi runtime、模型配置、OAuth 凭据及 transcript 路径统一落在 `CORVID_DATA_DIR` 内；主程序将 Pi agent 数据目录固定为 `CORVID_DATA_DIR/pi-agent`。工作台 Electron E2E 设置旧 `PI_CODING_AGENT_DIR` 诱饵路径，确认该路径不会被创建，Corvid 自有目录权限为 0700。
- Pi OAuth 需要在登录过程中由用户选择登录方式，并可能输入授权码。Corvid 新增应用内授权对话框承接 Pi `select` / `manual_code` 等交互，不提示用户转去 Pi CLI/设置；授权链接也可从 Corvid 授权框打开。
- 自定义 OpenAI Chat Completions 端点由 Corvid 的模型管理器读取与写入；设置及密钥留在 Corvid 数据目录。无密钥模式使用无敏感占位 Bearer，端点需忽略认证头。
- 验证：`node --check` 覆盖修改的主进程、Pi 管理器、预加载、renderer 与手动 smoke 脚本；`git diff --check` 通过。`pi-models-e2e`、`pi-runtime-e2e`、`pi-workbench-e2e`、`pi-custom-endpoint-e2e` 均通过；后者以真实 Pi session 请求本地兼容服务并检查配置目录权限。更新测试后 `env -u ELECTRON_RUN_AS_NODE npm test` 以 EXIT 0 完成：38 个独立脚本命令 + 3 项 `node:test`，共 41 项检查。
- `env -u ELECTRON_RUN_AS_NODE node tests/pi-real-model-smoke.cjs` 通过（EXIT 0）：测试在隔离 Corvid 数据目录创建 OAuth，Corvid 登录框与浏览器授权流程完成后确认凭据落在 `CORVID_DATA_DIR/pi-agent/auth.json`；session 实际模型为 `openai-codex/gpt-6-luna`，向本地 HTTP 页面 fixture 发送真实请求并收到 `CORVID_LUNA_OK`。测试结束清理隔离目录，不读取本机 Pi CLI 认证；真实请求会使用账户额度。此前使用本机 Pi OAuth 的历史请求不作为本次验收证据。

## 覆盖与限制

- 本地端点通过 loopback HTTP fixture；没有使用真实自定义 provider 或 API Key。
- 本地 Electron 回归覆盖 Corvid 自有目录，不读取 Pi CLI 的本机配置/凭据。Corvid OAuth 与真实 GPT-6 Luna 请求本次通过；未量化用量/费用，API Key 登录退出 UI、其他模型/provider 与跨平台仍未验收。
- Kaze 参考只证明 REA 截图中 Agent 面板、模型选择器与输入提示的相对位置；聊天行为/授权流程仍以 Issue #56 定义为 Corvid 待实现与验收目标。

# 验证记录

## 2026-11-02 Corvid Agent runtime adapter 与任务记录迁移（Issue #64）

- 将工作台改为只依赖 Corvid 定义的 runtime 合同；当前 Pi 实现封装在 adapter 中，事件转为 Corvid Agent 事件。任务文件升级为 `schemaVersion=2`，旧任务数组与 v1 envelope 自动迁移，原 session 路径封装成不透明 `sessionRef`；无法识别的 schema 不改写，迁移写入失败保留原文件。
- runtime 恢复能力按 runtime ID/version 校验；只有 adapter 明确列出的兼容版本才允许续聊。未知 checkpoint 保留供后续迁移，但 UI/renderer 只收到 `hasSession` 与 `canContinue`，不接触 checkpoint 内容。独立 fake runtime 通过同一任务/对话合同。
- `env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0：41 条独立脚本命令与 3 项 `node:test`，共 44 项自动化检查通过；定向 runtime 合同、Pi 模型/工作台、自定义端点与 SIGKILL 恢复均包含在全量套件中。`node --check` 与 `git diff --check` 通过。
- 本轮使用隔离临时数据与确定性 fixture，没有触发 OAuth 或真实模型请求，未消耗模型额度。限制：另一个 runtime 仅以合同 fake 验证；真实 runtime 替换、跨版本迁移、provider 断连时的 transcript 行为与 Windows 均未验证。

## 2026-11-02 日常网页打印入口与快捷键（Issue #66）

- 浏览器“更多浏览工具”菜单加入“打印网页…”；macOS `⌘P` 与 Windows/Linux `Ctrl+P` 调用当前选中用户 Room 的页面 `WebContents.print`，使用原生打印设置并包含网页背景。内置 Agent / MCP 路径不能调用打印；Agent 控制、接管等待、执行风险未复核或页面仍在加载时拒绝打印。
- 定向隔离 Electron E2E 通过：菜单和快捷键只触发当前活动标签；断言 `silent:false` / `printBackground:true`；打印失败呈现可访问状态提示，原生对话框取消呈现为取消状态。`node --check` 覆盖主进程、preload、renderer 与 E2E；`git diff --check` 通过。
- `env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0：42 条独立脚本命令及 3 项 `node:test`，共 45 项自动化检查通过。第二次串行全量回归走完整条链并退出；此前一次隔离运行曾在 `library-e2e` 卡住，单测和另一次全量均通过，未查明偶发挂起根因，继续由 [Issue #34](https://github.com/heyallencao/corvid/issues/34) 跟踪。本轮不调用真实模型/OAuth，不连接真实打印机；Electron 原生打印对话框的 macOS 人工复核以及 Windows/Linux 行为尚未完成。

## 2026-11-02 Corvid Agent 产品语义与运行时隔离（Issue #62）

- 产品入口、对话来源和模型设置统一使用 Corvid Agent 语义；任务卡不再呈现运行时名称，原始错误/授权提示若泄露运行时标识则显示 Corvid 自有提示。README 与系统设计明确 Corvid 拥有模型设置、任务/对话合同和迁移责任，运行时可替换或升级。
- 定向真实 Electron 回归在隔离数据目录和本地 HTTP/确定性 Agent fixture 下通过：断言无运行时品牌的可见文案/辅助名称、Corvid Agent 任务来源，以及故意注入 `Pi session could not be resumed` 后 UI 只显示 Corvid Agent 错误提示。`pi-workbench-e2e`、`pi-custom-endpoint-e2e`、`node --check` 与 `git diff --check` 通过。
- `env -u ELECTRON_RUN_AS_NODE npm test` 完整回归通过：40 个独立脚本命令与 3 项 `node:test`，共 43 项检查。未调用真实模型、未触发 OAuth，也未消耗模型额度；GPT-6 Luna smoke 仅同步了新的界面选择器，没有执行。
- 限制：内部实现文件、依赖、测试名称与历史验证记录仍保留具体 runtime 术语用于维护和审计；此项只保证 Corvid 用户界面、错误呈现与当前产品文档不把它描述成用户产品概念。运行时替换后的配置/会话迁移仍需未来实现并验证。

## 2026-11-02 只读数据目录的启动诊断（Issue #60）

- 复现：macOS 真实 Electron + 隔离目录 `chmod 0500`。修复前，模块加载阶段写入 `agent-tasks.json.tmp` 触发 `EACCES`，Electron 没有正常退出；测试在 10 秒后只能强制终止。
- 修复：在加载会持久化状态的 Agent/浏览器模块之前，创建数据目录并验证读/写/进入权限，再用独占临时文件检查写入与删除。失败时跳过其余应用初始化；正式启动调用系统错误框，说明 Corvid 数据目录、权限建议和系统原因，然后以状态码 1 退出。
- 验证：`env -u ELECTRON_RUN_AS_NODE node tests/data-directory-e2e.cjs` 通过；只读目录下真实 Electron 5 秒内以状态码 1 退出，诊断包含具体目录与 `EACCES`，目录中无部分状态/探测文件。`env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0：40 条独立脚本与 3 项 `node:test`，共 43 项检查通过；`git diff --check` 通过。
- 限制：E2E 使用 `CORVID_TEST_MODE=1` 检查诊断文本和快速退出，因此不验证 macOS 原生错误框的实际呈现；未触碰真实 Corvid 数据目录或浏览器资料。

## 2026-11-02 SIGKILL 后浏览会话与 Agent 任务恢复（Issue #54）

- 环境：macOS、Electron 45.2.1、隔离临时 `CORVID_DATA_DIR`、本地 HTTP 页面 fixture；确定性 Agent fixture，不调用真实模型/provider，不读写真实浏览器资料。
- 真实进程恢复：用户 Room 中两个已导航标签、Room/tab ID、各自 URL、活动 Room 与活动标签完成持久化后，对 Electron 主进程直接发送 `SIGKILL`，并用相同数据目录重新启动。重启后的运行时状态与预期 ID/URL/活动上下文一致。
- 控制凭据：重启生成新 control server 和 Bearer；向新 server 使用旧 token 请求 `/rooms` 返回 401。
- Agent 状态：在 `[fixture:hold]` 任务运行期间强制终止；重启后 task 与最后一条 assistant turn 均为 `interrupted`，Agent 面板显示“等待检查”，没有误报完成。
- 验证：`env -u ELECTRON_RUN_AS_NODE node tests/sigkill-recovery-e2e.cjs` 与 `env -u ELECTRON_RUN_AS_NODE npm test` 均 EXIT 0。全量回归含 39 条独立脚本命令与 3 项 `node:test`，共 42 项检查通过；`git diff --check` 通过。
- 限制：证明的是原子保存完成后的主进程强制终止恢复；不证明断电、原子 rename 中途杀进程、renderer 崩溃、OS 重启、真实网站、跨平台或硬件故障恢复。

## 2026-11-02 Corvid Agent 对话体验与 GPT-6 Luna 定向验收（Issue #56）

- 产品界面改为 Corvid 自有语义：Corvid Agent、对话、模型和页面来源；Pi 仅作为内部可替换运行时，不出现在用户入口与运行状态文案中。对话工作区以当前单线程消息流为主，历史可展开选择，输入区固定在底部，模型和页面来源就近可见，页面内容发送前仍需预览与明确同意。
- 隔离 Electron 回归通过：`env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0，38 条独立脚本命令和 3 项 `node:test` 共 41 项自动化检查通过；包括 Agent Room 面板、MCP、Pi runtime/model 配置、Corvid Agent 工作台、自定义端点、Chrome 导入与导航错误回归。测试使用临时数据目录和本地页面 fixture。
- 真实模型专项通过：`env -u ELECTRON_RUN_AS_NODE node tests/pi-real-model-smoke.cjs` EXIT 0。重新完成 Corvid 发起的 ChatGPT OAuth 后，显式选择 `openai-codex/gpt-6-luna`；真实请求只发往本地 HTTP fixture 并收到 `CORVID_LUNA_OK`。没有 fallback 到其他模型；测试凭据和 session 位于隔离 Corvid 数据目录，测试结束清理。
- `git diff --check` 通过。视觉断言与限制见[桌面 UI 视觉检查记录](../qa/ui-visual-check.md#2026-11-02-corvid-agent-对话工作区与短窗复查-issue-56)。
- 限制：这不是对真实网站或聊天服务内容的验收；真实模型请求消耗账户额度但仅执行上述一次 Luna smoke。仍需完成流式/停止、失败重试、键盘与辅助技术、暗色及跨平台的完整验收。

## 2026-11-02 工作区面板关闭后的键盘焦点恢复（Issue #52）

- 基线复现：真实 Electron 中从书签打开右侧面板，键盘激活“关闭面板”后，焦点仍停在已隐藏的 `#close-library`（期望 `#show-bookmarks`）。
- 修复：统一工作区打开/关闭状态，记录最近的侧栏触发按钮；关闭按钮隐藏面板后将焦点还给该按钮。增加 `aria-controls`、`aria-expanded` 和动态面板名称，切换面板同步更新语义状态。
- 验证：`node --check desktop/renderer.js`、`node --check tests/agent-rooms-panel-e2e.cjs`、`git diff --check`、`env -u ELECTRON_RUN_AS_NODE node tests/agent-rooms-panel-e2e.cjs` 均通过（EXIT 0）。完整 `npm test` 返回 EXIT 0，37 个串行 E2E 脚本与 3 项 `node:test` 共 40 项自动化检查全部通过。真实 Electron 检查书签、历史、下载、Agent Rooms、Pi 工作台关闭焦点恢复、Pi→Agent 切换后目标更新，以及既有窄窗口、Profile 隔离、键盘接管/交还和 Room 激活。
- 限制：使用隔离数据目录与 `about:blank`，未运行真实 Agent；不替代 macOS/Windows 屏幕阅读器与完整键盘人工走查。跟踪于 [Issue #52](https://github.com/heyallencao/corvid/issues/52)，属于 [Issue #16](https://github.com/heyallencao/corvid/issues/16) 的 D21 UI 打磨。

## 2026-11-02 Pi Agent 窄短窗口模型与输入栏可见性（Issue #50）

### 执行与结果

- 问题来自 700×420 隔离 Electron 截图：模型/连接设置藏在新任务表单的输入框下方。REA 参照中 Kaze 模型选择器位于 Agent 输入附近；本轮只用该已记录可见位置作布局启发，不推断 Kaze 的窄窗行为。
- 将模型选择置于任务输入前；模型、连接状态和 OAuth 操作收为单行，表单滚动时模型行固定在顶部。短高窗口压缩 Pi 面板标题和上下留白，保持页面上下文、模型、连接操作及任务输入首屏可见；另切换至 Anthropic provider 确认 API Key 输入框与提交动作也完整可见，再切回 Codex provider。页面预览/同意仍由表单滚动区承载。
- 先加入 700×420 可视区断言，基线运行确认模型选择、连接状态与操作均不可见；修复后 `env -u ELECTRON_RUN_AS_NODE node tests/pi-workbench-e2e.cjs` 通过，断言模型选择、连接状态、连接按钮和任务输入框完整位于表单可视区且彼此无重叠。真实 Electron 覆盖宽窗 1280×850、短窗 700×420、长任务历史、页面上下文同意及 Pi 任务流程。
- 全量 `env -u ELECTRON_RUN_AS_NODE npm test` 通过（EXIT 0）：`node --test` 3 项 + 37 个串行 E2E 脚本，共 40 项检查；Node.js v24.22.1、Electron 45.2.1、本机 macOS。
- 按用户要求单独运行 `env -u ELECTRON_RUN_AS_NODE node tests/pi-real-model-smoke.cjs`，真实请求通过（EXIT 0）：使用现有 Pi `openai-codex` OAuth 登录（ChatGPT/Codex 账号），session 实际模型为 `openai-codex/gpt-6-luna`，本地页面上下文请求收到 `CORVID_LUNA_OK`。该模型调用独立于上述本地 fixture 全量回归，可能消耗账户用量；没有读取、输出或写入凭据。
- 截图 SHA-256：宽窗 `75041b643948255a58ad9975005a70bd060827e7a5289c4de313276e8107d25a`；700×420 `8e47ddd6d485379360423b1a5dced6e3403c4de75c2c0595aa3ab5da04506e4c`。文件仅留在本机临时目录；图像只含 shell，不含独立 WebContentsView 页面。

### 覆盖与限制

- UI 全量回归的截图/fixture 使用本地 HTTP 页面和确定性 Pi session，不调用真实模型；单独的真实模型 smoke 使用同一隔离本地页面及用户 ChatGPT/Codex OAuth 凭据验证 GPT-6 Luna。
- 尚未检查暗色主题、VoiceOver/屏幕阅读器、其他平台和真实页面与 Pi 面板同屏时的视觉效果。Issue [#50](https://github.com/heyallencao/corvid/issues/50) 属于持续 UI 打磨 Issue [#16](https://github.com/heyallencao/corvid/issues/16)。

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

## 2026-11-03 后台 Agent Room 与新标签起始页共存（Issue #98）

- 基线复现：旧布局在前台用户停留 `about:blank` 起始页时隐藏 WebContentsView；未激活的授权 Agent Room 的 `page_fill` 返回 `Element is not visible or is covered`。此行为在未修复基线 `23236f0` 的 `tests/mcp-e2e.cjs` 复现。
- 修复：起始页改在用户空白 Tab 的闭合 Shadow DOM 内绘制；布局保持同窗口页面视图可见并将活动用户 Tab 放在最前。主进程校验起始页动作必须来自当前活动的、用户打开的、用户拥有 Room 的空白 Tab，且无 shell modal；页面 UI 和 Profile 书签不暴露给 Agent 所有的 Tab。
- 回归：本机 macOS、真实 Electron、临时 Corvid 数据目录、本地 HTTP fixture。`env -u ELECTRON_RUN_AS_NODE node tests/tab-ux-e2e.cjs` 通过（首页搜索、Profile 书签隔离、三项快捷入口、标签/查找/拖拽/中键关闭）；`env -u ELECTRON_RUN_AS_NODE node tests/mcp-e2e.cjs` 三项通过（未激活后台授权 Room 的页信息、Snapshot、fill/click、前台起始页保持及 SDK PNG 截图）；`env -u ELECTRON_RUN_AS_NODE node tests/sdk-e2e.cjs` 通过。截图目视检查见[UI 视觉检查记录](../qa/ui-visual-check.md#2026-11-03-新标签起始页与后台-agent-room-共存-issue-98)。
- 全量回归：`env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0，43 条独立脚本与 3 项串行 `node:test` 共 46 项通过。
- 限制：测试不验证真实 MCP host、真实网站、Windows/Linux、打包应用、多窗口与 VoiceOver；自动化截图是起始页 WebContentsView 内容，不是系统合成全窗口截图。Issue #98 在合并前继续保持打开。

## 2026-11-03 Agent 同一 Room 重复启动保护（Issue #151）

- 复现：主线 `fdea344` 隔离 worktree 使用确定性 runtime 延迟 `readPageContext()`，并发调用同一 `createAgentWorkbench.start()` 两次。结果为 `readPageCalls=2`、`createdTasks=2`、`createdSessions=2`、`issuedCredentials=2`，两个任务均在同一 Room 运行；页面发送按钮在 IPC 完成前未禁用。
- 修正：WorkBench 在第一次异步页面读取前对 Room 设置启动 claim，并检查已有 `preparing`/`running` 任务。同一 Room 重复/活动启动通过稳定错误 `agent-task-room-busy` 拒绝；claim 在失败和成功返回时释放，不同 Room 可并行。Renderer 点击发送时同步进入 `aria-busy` 状态并禁用，失败后恢复可重试；增加 zh-CN/en 忙碌与启动中资源。
- 验证：`node tests/agent-task-continuation-contract.cjs` EXIT 0，覆盖同 Room 页面读取期间重复提交、已运行任务期间再次启动被拒、不同 Room 同时运行、页面预览失效后可重试、双语状态/稳定错误映射及原有续聊/接管竞态。`node --check desktop/agent-workbench.cjs`、`desktop/renderer.js`、`desktop/locales.js`、两项相关测试脚本与 `git diff --check` 通过。`env -u ELECTRON_RUN_AS_NODE node tests/pi-workbench-e2e.cjs` 在隔离数据目录和本地页面夹具下通过；新增断言确认键盘启动后发送操作立即禁用、设置 `aria-busy=true` 并显示“正在启动 Agent 任务…”，之后原有完整工作台流程通过。第一次运行暴露了测试选择器依赖按钮旧文案的问题，已改用稳定的工作台按钮选择器；测试等待模型目录选择器就绪后再检查隔离配置目录。没有调用真实模型或 OAuth。
- UI 参考与限制：本切片只增加既有主操作按钮的处理中/禁用状态，不改变布局或视觉系统。REA 控制 Chromium 156.0.8078.79 在 1280×720、英文、减少动态效果环境访问 EasyUI 首页；Evidence `ev_652b871de812ab8074a21ed310b9c75273249de4e15e7de6d4699aafc71032c8`。直接观察：页面可访问树将未完成的组件预览标成 `status`，文案为“Loading component preview…”，首页另有可访问名称明确的搜索、主题切换和组件入口；截图与 DOM 均被采集。设计推断：等待状态应能被读屏用户识别，进度按钮文案应清楚表达正在发生的动作，因此本切片同步提供启动中本地化文字与 `aria-busy`。未知：该首页捕获没有触发任何组件或按钮交互，不能证明 EasyUI 的具体加载动画、焦点行为、窄窗表现或错误态；参考只用于状态反馈，不作为 Corvid 视觉规范。REA 一次较早的调用因 `capture` 参数格式错误在执行前拒绝，已改用 `capture.at_end` 重做并取得上述证据。
- 范围：合成 runtime、临时数据目录；不连接 Provider，不证明不同 OS 版本或真实模型调用行为。

## 2026-11-03 最新主线全量回归与桌面锁屏干扰（Issue #87）

- 基线：隔离 worktree 基于 `origin/main` `56b3089`（包含 PR #152 与 #153）；通过临时 `node_modules` 链接复用项目依赖，测试后自动移除。执行 `env -u ELECTRON_RUN_AS_NODE npm test`，在串行 `node:test` 阶段约 32 秒后 EXIT 1，19/22 项通过、3 项失败，因此尚未运行后续 46 条独立 E2E 脚本。
- 失败：`tests/browser.e2e.mjs` 报 `Input focus was not acquired`；`tests/dialogs.e2e.mjs` 的页面 alert 未触发；`tests/uploads.e2e.mjs` 的文件选择器等待超时。该批用例均依赖桌面焦点/原生窗口交互。
- 环境观察：测试结束后 Electron、Node 测试进程均已退出，临时依赖链接已清理。随后的 CUA 桌面状态查询明确返回“Mac is locked and automatic unlock could not unlock it”；这一状态与三项焦点失败一致，但不能证明每项失败都只由锁屏导致，也不能解释 Issue #87 历史上的启动挂起。
- 启动诊断合同：同一轮中 `tests/electron-startup.e2e.mjs` 的 6 项合成启动/清理测试全部通过；真实 Library 与慢恢复 E2E 因 node:test 阶段失败而未运行。本轮不计为全量回归通过，也未复现 Issue #87 的 Electron 启动挂起。真实 Electron 复验等待桌面解锁后重新执行。
- 解锁后续跑核验：用户回复已解锁、其他会话确认 Electron 桌面空闲后，再次以同一 worktree 和临时依赖链接运行 `env -u ELECTRON_RUN_AS_NODE npm test`；测试后依赖链接自动移除。实际仅 19/22 项通过，仍是 browser 输入焦点、dialogs alert 和 uploads 文件选择器三项失败，6 项 `electron-startup.e2e.mjs` 合成诊断继续通过，后续 46 条独立脚本仍未开始。CUA 随后核验却明确报告 Mac 仍锁屏且自动解锁失败，因此这次交互失败仍不能作为产品缺陷证据；测试中有 Electron 成功写出 `control.json`，未复现启动挂起。下一步需由用户在本机实际解锁后再做 UI/Electron 回归；启动挂起根因仍未定位。

## 2026-11-03 启动挂起阶段现场记录补充（Issue #87）

- 改动：主进程仅在 `CORVID_TEST_MODE=1` 时用原子 rename 在隔离数据目录更新 `startup-progress.json`，权限设为 0600；覆盖主模块加载、app ready、会话读取、窗口 `loadFile`、恢复标签页的扩展加载与 debugger/bootstrap、初始 Room、服务监听和 `control.json` 写入，启动完成后冻结阶段值。启动超时错误新增最后阶段字段，并按 Electron 子进程 PID 忽略旧进程记录；阶段记录解析只打印阶段名，不打印记录其他字段或凭据。正常用户运行不启用阶段文件。
- 验证：`node --check desktop/main.cjs`、`node --check desktop/startup-progress.cjs`、`node --check tests/electron-test-startup.cjs` 均通过；`node --test --test-concurrency=1 tests/electron-startup.e2e.mjs` 8/8 通过，覆盖阶段记录禁用/启用、原子更新、0600 权限、临时文件清理、缺失/损坏/旧 PID/非法阶段记录、超时阶段显示及凭据不泄露；`git diff --check` 通过。
- 限制：本机 CUA 仍报告 macOS 锁屏。本轮没有启动真实 Electron，也没有运行完整 `npm test`；阶段写入通过独立模块的合成测试核验，尚未用真实 Electron 证明所有启动阶段均按预期更新。Issue #87 的历史挂起仍未复现，根因未确定。

## 2026-11-03 解锁后全量回归与真实启动阶段校验（Issue #87）

- 环境：macOS；CUA 状态查询不再报告锁屏；Node.js v24.22.1、Electron 45.2.1；隔离 worktree `/private/tmp/corvid-issue87-current-main`、隔离临时 Corvid 数据目录；测试通过临时 `node_modules` 链接复用仓库依赖，退出时自动移除。
- 全量回归：`env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0，24 项串行 `node:test` 与 43 条独立脚本共 67 项通过；覆盖慢恢复、Library、Agent、MCP、Chrome 导入和本地模型 fixture 等路径。本轮没有触发模型 OAuth。
- 真实启动证据：之后单独运行 `env -u ELECTRON_RUN_AS_NODE node --test tests/browser.e2e.mjs`，1/1 通过；该真实 Electron 用例现在等待并检查隔离目录中的 `startup-progress.json`，确认记录到 `startup-complete`，PID 与 Electron 主进程一致且记录不含凭据。`tests/electron-startup.e2e.mjs` 另有 8/8 合成诊断测试通过，覆盖原子写入、权限、旧 PID 与非法阶段处理。
- 清理与限制：临时依赖链接已移除，工作区最初被 Chrome 导入 E2E 重生成的两张 Issue #129 截图已按已提交版本还原；本次测试进程退出。完整回归连续成功一次，但没有复现 Issue #87 历史启动挂起，也未证明根因；持续间歇挂起仍由该 Issue 跟踪。
- 交付：PR #155《补充 Electron 启动阶段现场诊断》已于 2026-11-03 squash 合并，合并提交 `0bf18f8a34513f3db07d2e8189c7c6cb9fafb31f`；Issue #87 保持开放。

## 2026-11-03 慢恢复后的 Electron 清理重复验证（Issue #34）

- 基线：最新主线 `c82e7e5`（含 PR #155 启动阶段记录）；隔离 worktree、隔离 Corvid 临时数据目录与本地 HTTP gate。
- 验证：通过临时 `node_modules` 符号链接复用依赖，连续执行 `env -u ELECTRON_RUN_AS_NODE node tests/restore-loading-e2e.cjs` 五次；每次启动两次真实 Electron、释放慢页面 gate、验证会话恢复和关闭，均输出 PASS 且命令退出码为 0。此前同一代码切片的完整 `npm test` 另有 EXIT 0（24 项 `node:test` + 43 条独立脚本，共 67 项，见本文件上方 Issue #87 记录）。
- 清理与限制：循环后无 `restore-loading-e2e` / `corvid-restore-loading` 测试进程、临时数据目录或依赖链接。未复现历史上 PASS 后继续挂起的现象；五次定向运行不能解释历史根因，Issue #34 保持开放，不做根因已解决的结论。

## 2026-11-03 解锁后最新主线完整串行回归（Issue #87）

- 环境：基于最新 `origin/main` `c30e167`（PR #160）的独立 worktree；macOS 26.5.1 arm64、Node.js v24.14.1、Electron 45.2.1；按锁文件执行 `npm ci`，测试使用隔离临时数据目录与本地 fixture。
- 全量回归：`env -u ELECTRON_RUN_AS_NODE npm test` EXIT 0；24 项串行 `node:test` 与 50 条独立 E2E 脚本，共 74 项通过。包含此前锁屏期间未通过的浏览器输入焦点、页面 alert 与文件选择器路径，也覆盖慢恢复、全屏/多窗口、Chrome 导入、Agent、MCP、模型偏好与本地化。
- 外部服务：未进行 OAuth 登录或远程模型调用；模型相关用例使用本地 fixture/凭据测试。
- 清理：测试生成的两张 Issue #129 截图已恢复至提交版本；测试进程退出，无 Electron、Playwright 或 npm test 残留。
- 限制：完整回归本轮通过一次，但未复现 Issue #87 所述的历史启动挂起，也未定位其根因；本记录不表示该问题已修复，Issue #87 继续开放。此次只在 macOS 开发环境运行，不能证明 Windows/Linux 或打包应用行为。
