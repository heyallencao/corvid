# Issue #165：Corvid 浏览器设置中心

关联：[GitHub Issue #165](https://github.com/heyallencao/corvid/issues/165)。本 PR 继续扩展设置中心的首批功能；Issue 保持开放，直到跨平台和辅助技术边界补齐。

## 本切片范围

- 将设置组织为常规与搜索、下载、外观、当前网站、浏览身份、Agent 与连接，并显示设置作用范围。
- 保留应用语言、Profile 搜索模板、Chrome 资料导入、Profile 扩展与 Agent 访问入口；从设置提供已有模型连接管理入口。
- 新增应用级“跟随系统/浅色/深色”偏好、启动时恢复/打开新标签、起始页/空白页、下载目录和下载前询问偏好，统一存入 `browser-preferences.json`，与语言、Profile 和站点状态分开。旧 schemaVersion 1 主题文件迁移时保留主题，并为新字段使用兼容当前体验的默认值。
- 下载目录为空时使用系统默认 Downloads；选择的目录应用于所有浏览身份。下载前询问默认开启；关闭后直接保存到所选或系统默认目录。测试模式可通过已有目录和保存结果环境变量模拟路径/取消，但不代表原生系统对话框已验证。
- 启动选择“打开一个新标签页”时保留上次恢复的页面，在活动空间复用已有用户空白标签，避免每次重启累积标签；新标签页偏好只影响用户创建的 `about:blank`，不改变 Agent 页面。
- 设置中心按当前活动标签显示 HTTP(S) 来源；其他页面、空标签与非网页协议下禁用站点操作。可用时沿用现有权限查看及清理数据确认流程。
- 分类按钮同步 `aria-current` 并把焦点移到对应分区。宽屏使用分类侧栏，窄窗切为上下布局；内容区独立滚动，保存与取消操作固定。

## 数据与边界

`browser-preferences.json` 当前格式为 `{ "schemaVersion": 2, "theme": "system|light|dark", "startupBehavior": "restore|new-tab", "newTabBehavior": "home|blank", "downloadDirectory": "", "askWhereToSave": true }`，权限 `0600`，通过临时文件与 rename 原子替换。schemaVersion 1 仅含主题时迁移其主题，其余字段回退为现有体验默认值。下载目录必须是可访问的绝对目录；验证错误按当前 Corvid locale 显示。偏好不包含 Profile ID，也不更改网页自身配色。

当前网站入口只针对活动标签来源，不提供跨站点枚举，也不更改已有站点权限/数据访问合同。主题为应用级首选项；`system` 交由 Electron `nativeTheme` 解析。

## 验收

- 已有 `tests/localization-e2e.cjs` 检查首个设置切片的 zh-CN/en 资源、分类选择与焦点、无当前网页时站点操作禁用、主题即时应用、0600 持久化和重启恢复。
- `env -u ELECTRON_RUN_AS_NODE CORVID_CAPTURE_QA_SCREENSHOTS=1 node tests/settings-preferences-e2e.cjs` 已通过，覆盖 schemaVersion 1 迁移、设置保存/重启、空白页注入开关、启动新标签复用、下载取消与自动保存、失效目录中英文错误，以及 700×420 设置布局；更新的中英文截图见[视觉检查记录](../qa/ui-visual-check.md)。
- `env -u ELECTRON_RUN_AS_NODE CORVID_CAPTURE_QA_SCREENSHOTS=1 node tests/settings-site-e2e.cjs` 已通过：空白页禁用站点操作；活动 HTTP(S) 来源显示与操作启用；合成通知权限获准后可在设置中取消审查并保留授权、确认撤销；取消站点数据清理保持 fixture localStorage，确认后清除且不改变独立权限；确认默认选择为非破坏项；语言切换后动态来源仍正确。Electron 权限/清理确认框用替身控制结果。测试截图在 700×420 需滚动内容区，并验证范围说明、当前来源、两个操作按钮及固定底部动作可完整显示。
- 系统文件夹/保存对话框由测试替身覆盖；真实桌面对话框还需单独验收。

## 尚未覆盖

启动、新标签、下载偏好和设置中心的站点权限/数据操作已由 macOS 隔离 Electron 与本地 HTTP fixture 验收；权限请求与清理确认结果使用替身，真实系统对话框仍未覆盖。屏幕阅读器、全产品键盘审计、Windows/Linux 和打包版也未覆盖。Issue #165 保持开放，待这些边界补齐后再判断完成。

## UI/UE 参考

本切片采用 EasyUI 首页的信息分区和可访问状态表达作为有限参考，REA Evidence 与观察/推断/未知边界见[视觉检查记录](../qa/ui-visual-check.md#2026-11-03-设置中心首个切片-issue-165)。该参考不是设置产品要求；Corvid 保留自身品牌、组件和交互合同。
