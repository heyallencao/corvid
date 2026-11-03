# Issue #162：Corvid 原生浏览器菜单

状态：进行中  
对应执行板：[`feature-board.md` D16](feature-board.md)  
GitHub Issue：[将 Electron 默认菜单替换为 Corvid 双语浏览器菜单](https://github.com/heyallencao/corvid/issues/162)

## 基线证据

- 主线 `56adc9c` 的 `desktop/main.cjs` 未调用 `Menu.setApplicationMenu()`，也没有 Corvid 菜单模块；Electron [`Menu`](https://www.electronjs.org/docs/latest/api/menu) 与[应用菜单指南](https://www.electronjs.org/docs/latest/tutorial/application-menu)说明未设置应用菜单时会自动提供默认菜单。由此确认当前不是“没有任何菜单”，而是没有 Corvid 自有菜单合同。Electron [`BrowserWindow`](https://www.electronjs.org/docs/latest/api/browser-window) 文档说明 Windows/Linux 的自动隐藏菜单栏可由单按 Alt 显示。不同平台菜单实际像素、可访问性树与键盘行为尚需本地 Electron 观察。资料复核：2026-11-03。
- Corvid 已有页面级查找、打印、全屏、缩放、后退/前进、标签/窗口创建和关闭动作，以及 Cmd/Ctrl 快捷键；菜单必须委托现有行为，不能另造绕过控制权的路径。
- 界面语言保存在 `ui-preferences.json`，`setUiLocale` 可运行时变更并跨重启保持；主进程菜单也需跟随该 locale。

## 本切片范围

- 用 Corvid 双语菜单替换 Electron 自动菜单，并避免菜单暴露框架或调试入口。
- 新建/关闭标签和窗口；浏览导航、查找、打印、全屏、缩放；常用文本编辑角色。
- 菜单动作与对应快捷键绑定当前聚焦窗口及用户控制的活动 Room/Tab；Agent 所有、待接管或有未决执行风险的 Room 不接受页面导航、地址栏、标签修改、查找/打印或缩放操作。窗口级动作（如新窗口、最小化）仍可用。
- Windows/Linux 菜单栏默认隐藏以保留网页空间，通过平台键位可访问；macOS 使用系统菜单栏。

## 验收

- 纯模块合同核对中英文菜单、快捷键、标准编辑角色、窗口列表和无调试入口。
- 隔离真实 Electron E2E 覆盖菜单树、菜单动作、双窗口焦点路由、Agent Room 菜单项禁用、语言实时切换和重启保持；另验证 Agent Room 中的快捷键受同一控制权保护。
- 通过真实 Electron/原生桌面观察菜单显示与焦点，不把 DOM/API 菜单树检查当作像素或 VoiceOver 验收。
- 更新 D16、测试索引和验证日志；截图只使用隔离数据且不含个人浏览内容。

## UI 参考与证据边界

- 实现按 Electron 与各 OS 的原生菜单角色和键位；不复制 Rare UI、Kobra、EasyUI、Pin UI 或 Aceternity UI 的 web 菜单样式/素材。它们的网页组件不等同于系统菜单，本切片仅在有可迁移的层级或键盘细节时补充对应 REA Evidence。
- 直接观察、静态证据和推断需分别记录；当前静态证据为上述源代码和 Electron 菜单文档。REA 原生运行态 Evidence、截图、窗口尺寸、采集时间与限制待完成隔离 Electron 验收后补入。

## 完成后可以声明

- 仅声明已由 macOS 真实 Electron E2E/REA 观察和当前本地化合同直接证明的菜单行为。

## 完成后仍不能声明

- 未跑的 Windows/Linux、打包版本、辅助技术或其他系统语言设置已验证。
- 所有 Electron 默认菜单细节在每个平台均完全一致。
