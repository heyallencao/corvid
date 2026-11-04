# Issue #214 网页区域上下文菜单

## 范围

本切片只覆盖网页画布右键菜单：用户控制的 Room 中，根据右键目标提供页面后退/前进/重载、HTTP(S) 链接与图片在新标签页打开/复制地址、选中文本复制，以及可编辑控件的撤销/重做/剪切/复制/粘贴/删除/全选角色。打开链接或图片会创建同一 Room、同一 Profile 的用户标签。菜单动作执行前再次确认标签仍存在、Room 仍由用户控制且没有等待 Agent 交还或处于执行风险态。Agent 拥有的 Room 不弹出用户菜单。

这只是 Issue #214 的部分交付。侧栏上下文菜单、原生对话框本地化、其他菜单及 Issue 中剩余差距仍保持开放。本次实现不加入开发者工具或检查元素入口。

## 复现与验证

- 环境：本机 macOS arm64；Electron 45.2.1；Node.js v24.22.1。隔离临时 `CORVID_DATA_DIR` 与 `127.0.0.1` 本地 HTTP fixture；不读写用户浏览数据、不访问外网、不使用模型或 OAuth。
- `node --test tests/page-context-menu.test.mjs`：验证 zh-CN/en 资源键、不可用导航项状态、HTTP(S) URL 规范化与危险 scheme 拒绝、链接/图片动作回调和编辑角色。
- `node tests/page-context-menu-e2e.cjs`：真实 Electron、本地 fixture；验证网页右键建立原生菜单模板、中文链接操作、链接在同 Room/Profile 新标签打开，以及 Agent 所有权门禁。测试将 `Menu.prototype.popup` 替换成捕获器，避免依赖系统菜单弹出；因此它验证 Electron 收到右键并生成菜单及菜单动作路由，但不验证系统绘制、原生键盘焦点或 VoiceOver。
- 最新主线复验（`9399642`，隔离分支提交 `dad49d2`）：`node --test tests/page-context-menu.test.mjs` 3/3 通过；`env -u ELECTRON_RUN_AS_NODE NODE_PATH=/Users/allen/Workspace/projects/personal/corvid/node_modules node tests/page-context-menu-e2e.cjs` EXIT 0，输出 `PASS webpage context menu: localized actions, same-Room link tab, and Agent ownership guard`；相关 `node --check` 与 `git diff --check` 通过。
- 本轮不运行签名 `.app`、不读取或修改钥匙串、不做公证/打包诊断。测试使用仓库 Electron 开发运行时。
- 本地 Electron 测试通过不代表 Windows/Linux、打包版或实际系统菜单无障碍已验证；未运行全量 `npm test`。

## UI/UE 参考与 REA 证据边界

- Corvid 自身直接行为证据：本轮隔离真实 Electron E2E，右键事件由 `WebContentsView.sendInputEvent` 送入本地 fixture；Electron 菜单被测试捕获，不保存页面个人内容。当前实现的菜单标签直接来自 Corvid `main-locales.cjs` 的 zh-CN/en 资源。
- EGO：项目研究记录中的 REA `observe_native_ui` Evidence `ev_3a5609d1eb705ccdf3c5071061a8a6b7aafa5a604f570f210b9c81a8a5c86e5e`，2026-11-02，1450×833。**直接观察**仅为一个窗口的标签/地址栏/书签栏及 Space 入口；没有打开网页上下文菜单。
- Kaze：项目研究记录中的 REA `observe_native_ui` Evidence `ev_3c3ee4f92ab10275d5eaae96a797c818258f403328128bf9ee16d740bbdb9067` 及同窗口截图复核 `ev_fdb1ec28706c6b2401549b230199346e86c42a50c2e12ce04b0a06f7073563b3`，2026-11-02，1440×851。**直接观察**限于一个窗口的导航、Space 标签与网页画布；没有打开网页上下文菜单。两者是历史布局证据，不是本次菜单交互证据；竞品菜单行为保持未知。本轮没有重新操作已安装竞品。
- Rare UI、Kobra、EasyUI、Pin UI、Aceternity UI 本轮未用于该浏览器原生网页菜单；没有复制代码、图标或素材。设计判断是保留操作系统提供的熟悉菜单行为，并按 Corvid 的用户/Agent 控制权合同裁剪动作；菜单项目并非由竞品页面或营销材料推定。
- 未附截图：捕获器会阻止原生菜单绘制；现有渲染器截图无法同时证明原生菜单样式与实际网页 `WebContentsView` 合成状态，附图会产生误导。夹具内容为合成文本，不含个人信息。

## 未覆盖与后续

- 未实际逐项操作图片菜单、选择文本复制、编辑控件角色、菜单键盘导航、窄窗、深色模式、跨平台及辅助技术播报；其中结构/回调与状态限于模块合同覆盖。
- Issue #214 仍需分别复核侧栏菜单和原生对话框语言等剩余项目，不能因本切片关闭 Issue。
- 可按具体缺口增加真实菜单交互验收；不得把被替换的 `Menu.popup` 描述为原生绘制或人工 UI 验收。
