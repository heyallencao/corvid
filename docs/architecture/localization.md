# Corvid 界面本地化架构

## 产品范围

Corvid 首发界面支持简体中文（`zh-CN`）和英文（`en`）。本地化覆盖浏览器 chrome、Agent 工作区、设置、菜单、错误与状态、帮助文案及可访问名称；网站主体内容仍由网站自身负责语言。首发全覆盖由 [Issue #130](https://github.com/heyallencao/corvid/issues/130) 跟踪。

## 当前实现合同

- 应用语言是应用级 UI 偏好，不属于 Profile，也不随浏览身份切换。
- 主进程从 `app.getLocale()` 选择初始语言：系统语言为英文时用 `en`，其余情况用 `zh-CN`；`CORVID_TEST_MODE=1` 下未显式设置时固定为 `zh-CN`，确保现有中文 UI 用例不受宿主机语言影响。用户选择优先并持久化到数据目录 `ui-preferences.json`，格式为 `{ "schemaVersion": 1, "uiLocale": "zh-CN" | "en" }`，文件权限为 `0600`。
- `setUiLocale` 仅供 Corvid 桌面界面调用；本机控制 API 不接受该操作。当前窗口状态仅向桌面 renderer 提供 `uiLocale`，不加入外部 Agent 的共享状态合同。
- renderer 使用 `desktop/locales.js` 管理应用界面资源；主进程原生系统对话框与导航错误使用 `desktop/main-locales.cjs`，遵循同一 `zh-CN` / `en` 偏好。主进程创建提示前按应用 locale 格式化权限名称、复数和句子，不改写用户保存的 Profile/Room 名称。新增主进程用户文案须加入双语资源，并检查参数占位符、句子分隔和窄窗可读性。
- `desktop/locales.js` 是可扩展的 locale 资源与格式化边界，提供安全的 locale 规范化、键值回退、参数插值、复数选择，以及 `Intl.NumberFormat` / `Intl.DateTimeFormat` 包装。
- Electron 原生应用菜单的菜单标题、动作标签和帮助提示由主进程 `desktop/application-menu.cjs` 按同一 `zh-CN` / `en` locale 提供；切换应用语言时重建原生菜单。新增菜单文案须保持两种资源键和语义对应。此主进程资源路径已有模块合同测试，真实菜单运行态仍由 [Issue #162](../execution/slices/application-menu.md) 验收。
- 静态 DOM 通过 `data-i18n`、`data-i18n-aria-label`、`data-i18n-title` 和 `data-i18n-placeholder` 绑定资源；动态渲染文案使用 `corvidI18n.t()`、`plural()` 或 locale 格式化函数，不应在业务流程里新增用户可见的硬编码文案；动态列表中的枚举分隔符也必须遵循当前 locale。
- 语言选择即时应用并持久化；未支持的 locale 被主进程拒绝。切换后 `document.documentElement.lang`、可见标签与控件名称保持一致。
- 系统生成的默认 Profile/Space 名称只在桌面 renderer 显示层本地化；Room、Profile 持久化名称与外部控制合同不随 UI locale 改写。用户自行创建/重命名的名称按用户内容原样显示。

## 当前覆盖状态

本地化资源现已覆盖浏览器导航与标签、Profile/Space 状态、站点工具、书签/历史/下载列表、Agent 空间状态与控制权交接、内置 Agent 对话/续聊/模型选择、模型端点管理、外部 Agent 授权、Profile 扩展管理、Chrome 导入及引导弹窗的主要动态文案和可访问名称。品牌眉题、浏览器类型说明、Chrome Profile 与模型端点地址字段也使用 locale 资源。静态 DOM 以 `data-i18n*` 属性绑定；renderer 创建的内容使用资源键、参数化文案、复数和 locale 格式化函数。动态默认名称只做显示转换，不写回用户数据。

此状态是**源码覆盖**，不等同完整双语验收。主进程与存储模块抛出的错误仍有未统一的中英文原文；不同 provider/runtime 的授权进度和错误内容可能由依赖产生；帮助/首次使用路径与所有罕见错误仍需逐项审计。新增文案须继续清点整个 `desktop/` 和扩展界面，不能只检查 `index.html` / `renderer.js`。真实 Electron 双语定向 E2E 已通过；700×420 用例分别检查浏览器导航控件，以及中英文设置对话框滚动后保存按钮完整可达。覆盖范围与限制记录在[验证日志](../reviews/verification-log.md#2026-11-03-corvid-界面语言偏好与浏览器壳层首批双语-issue-130)。Issue #130 与 D24 在完成真实 Electron 中英文全流程、完整窄窗布局、键盘焦点和辅助技术语义审阅前保持开放/“部分”。

## UI 参考

本切片采用原生 `<select>` 提供语言选择，以保留系统控件的键盘和辅助技术语义。Kobra 下拉菜单页面只作为精确相关的菜单/选择器参照；REA 观察证据、复核时间与限制见[本轮验证记录](../reviews/verification-log.md#2026-11-03-corvid-界面语言偏好与浏览器壳层首批双语-issue-130)。未复制第三方代码、图标或素材。
