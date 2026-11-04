# Issue #211：页面上下文同意标签级联修复

## 范围与当前状态

本切片只处理 Pi/Corvid Agent 表单中的页面上下文同意标签。`#pi-task-form label` 的通用规则已设置 `display:flex`、`align-items:flex-start` 和 `gap:7px`；后续 `.pi-consent` 为覆盖该通用规则，把相同布局属性提高到 `gap:8px` 并各自添加 `!important`。修复使用 `#pi-task-form label.pi-consent` 限定组件上下文，保留 8px 间距与左对齐，不改动页面共享权限合同、文案或键盘流程。

修复与定向真实 Electron 回归已完成。Issue #211 其余 CSS 级联债务仍未处理，因此该 Issue 保持开放。

## 设计证据

- **Corvid 静态证据**：`desktop/styles.css` 中通用表单标签规则先于 `.pi-consent`，同意控件由 `desktop/renderer.js` 作为原生 checkbox 与可读标签组成。样式修复沿用现有表单字号、文本颜色和组件结构，仅消除为覆盖宽泛选择器而添加的强制优先级。
- **REA 直接观察**：Kobra Checkbox 组件页（`https://kobra.systems/components/checkbox`），受控 Chromium 156 回放，2026-11-04，Evidence ID `ev_6f65512faf49a2a401f5e07926ddf2755239dec36eb4ba55072ae37f354bc1c4`，截图 SHA-256 `56276452dc9f67e685c2272f7781f49c477c9909ad8c84c3f5c16f7e74115854`。页面直接展示 Checkbox 组件说明及独立的 shape 选择项；该观察只支持复选框应保持清晰语义和可辨控件，不证明其与说明文字的具体间距、运行态键盘行为或 Corvid 的布局选择。
- **设计判断**：页面上下文同意是发送前的明确控制门槛。保留紧邻说明文本的原生 checkbox 和克制的 8px 间距，可让用户把控件与需要确认的内容作为一组读取；它延续 Corvid 已有表单视觉语言，也不需要从参考站点复制样式或素材。
- **覆盖限制**：REA 为受控回放，不含可核验的发布构建身份；未检查页面服务端代码、不同主机平台或所有交互路径。参考页不用于推断 Corvid 的产品需求。

## 运行态复核

- 截图：[1280×850 页面上下文预览](screenshots/issue-211-consent-label-1280x850.png)，SHA-256 `be9fc8f495bcad03add35ca3884433da1b529198fa454992a5a9e74139f56d27`。本地合成页面、隔离 Agent 数据；图片像素为 2560×1636。截图显示复选框获键盘焦点、说明文字紧随复选框且未溢出表单，发送按钮在明确同意前保持禁用。它只证明该窗口和状态，不替代交互与辅助技术验收。
- 真实 Electron E2E `node tests/pi-workbench-e2e.cjs` 通过（EXIT 0）。环境：macOS arm64、Node.js v24.22.1、Electron 45.2.1；使用本地 HTTP 页面夹具、临时 `CORVID_DATA_DIR` 与确定性 Agent fixture，没有真实模型、Provider、OAuth 或用户数据。隔离 worktree 通过临时 `node_modules` 软链接复用根目录锁定依赖，测试后已删除链接。
- 验证覆盖：页面预览重绘后焦点位于 `#pi-context-consent`；浏览器计算样式为 `display:flex`、`align-items:flex-start`、`column-gap:8px`；文字范围紧邻复选框且未超出标签边界；Space 勾选后发送按钮启用，原页面上下文显式同意流程继续通过。
- `node --check tests/pi-workbench-e2e.cjs`、`git diff --check` 通过；源码检查确认 `.pi-consent` 不再包含 `!important`。
- Impeccable detector (`impeccable detect --json desktop/styles.css`) 以退出码 2 报告既有 side-tab warning 两条（原文件行 442、581），没有报告本次 selector。它们对应其他组件，未纳入本切片，也不据此推定其运行态影响。

## 验收

- `pi-workbench-e2e.cjs` 在真实隔离 Electron 中打开页面预览后，检查同意复选框仍获焦点；计算样式应为 flex、`flex-start` 与 8px gap；说明文字保持在复选框之后且不越出标签容器；随后仍由 Space 勾选并启用发送操作。
- 本地合成网页与隔离数据目录；不连接真实模型、Provider 或 OAuth。截图标明窗口尺寸且只显示本地 fixture。
- zh-CN/en 文案由既有 locale 资源负责。本切片不改文案；完整窄窗、多主题、屏幕阅读器、Windows/Linux、打包版及真实 Provider 流程仍不在本切片覆盖范围。
- Impeccable detector 对 `desktop/styles.css` 报出既有 side-tab warning，分别位于 `.pi-task-event` 和 `.pi-message-queue-item` 的彩色左边线（扫描行 442、581）。它们不在本次组件范围；该扫描不提供本次交互的运行态证明。
