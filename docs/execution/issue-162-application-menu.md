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
- 通过真实 Electron/原生桌面观察菜单显示与焦点，不把 DOM/API 菜单树检查当作像素或 VoiceOver 验收。修复前曾用隔离 profile 的 macOS 原生“窗口”菜单复现勾选状态与 Corvid 焦点 API 不一致；证据与截图见 [UI 视觉检查记录](../qa/ui-visual-check.md#2026-11-03-corvid-原生窗口菜单焦点勾选-issue-162)。
- 更新 D16、测试索引和验证日志；截图只使用隔离数据且不含个人浏览内容。

## UI 参考与证据边界

- 实现按 Electron 与各 OS 的原生菜单角色和键位；不复制 Rare UI、Kobra、EasyUI、Pin UI 或 Aceternity UI 的 web 菜单样式/素材。它们的网页组件不等同于系统菜单，本切片仅在有可迁移的层级或键盘细节时补充对应 REA Evidence。
- 直接观察、静态证据和推断需分别记录；当前静态证据为上述源代码和 Electron 菜单文档。REA 原生 UI provider 因无法读取目标进程启动时间而拒绝观察；目前保留隔离 Electron 与 macOS System Events 的原生菜单证据，但不标为 REA 证据。REA 故障、截图、尺寸、采集时间及菜单交互覆盖见 [UI 视觉检查记录](../qa/ui-visual-check.md#2026-11-03-corvid-原生窗口菜单焦点勾选-issue-162)。VoiceOver 与原生像素复测仍待完成。

### EasyUI OriginDropdown 参考（REA）

- **页面与时间**：EasyUI [OriginDropdown 组件页](https://easyui.site/components/origin-dropdown)，2026-11-03 21:16（Asia/Shanghai）；REA 使用 provider-owned Chromium 156.0.8078.79，隔离临时 profile，1280×900、en-US、UTC、light、reduced motion。打开菜单状态 Evidence：`ev_38f293f46bdfbc5074a2b5e80f9ecdcdfd8dbfb277b1821bf57a69cce353e522`；稳定首屏 Evidence：`ev_e62f44ddcf7e519829c9094fa1276d4567e4de0d2431528a2919f386256862b8`。菜单打开步骤成功，临时浏览器已由 REA 清理。
- **直接观察**：组件文档用顶栏、面包屑、左侧组件导航和主内容组成两栏层级；预览区留出充足空间。演示菜单贴近触发按钮展开，采用浅表面、细边框、轻阴影和紧凑条目；三项操作有标题与辅助说明，Sign out 用单独颜色强调。访问树将触发器标为 button 并报告 `[expanded]`，弹层标为 menu，条目标为 menuitem，名称可读。
- **静态证据**：页面文档描述从触发器一侧展开，并以轻微缩放和向内位移表达来源；DOM/无障碍树可见 `side`、`open`、`defaultOpen`、`onOpenChange` 等 API。该内容是 EasyUI 自身组件文档和公开 DOM 信息，不证明其实现的屏幕阅读器兼容性、动画时序或跨浏览器行为。
- **对 Corvid 的判断**：可迁移的是菜单项分组和动作语义、清楚的展开状态、稳定的触发器到菜单锚定关系，以及禁用/危险动作要能辨认。Corvid 菜单使用 Electron/OS 原生角色；网页 CSS、阴影、圆角、弹簧动画不应移植到原生菜单。当前代码的菜单分组和本地化标签按平台菜单习惯评估；原生焦点、键盘移动、VoiceOver 朗读与像素效果仍须在隔离的真实 Electron 窗口验收。
- **覆盖限制与未知**：这是单一公开 React 组件页，不代表所有优秀产品或系统菜单；只观察了 macOS 上的 Chromium 参考页面，不验证 Corvid 菜单、OS 原生辅助技术、窄窗布局、Windows/Linux 菜单行为或减少动态效果设置下的组件细节。未复制页面代码、图标或素材。EasyUI 页面曾报告 Cloudflare Insights 脚本受 CSP 拦截；该分析脚本错误不影响已采集的组件预览和访问树，但可观察范围限于所记录状态。
- **记录边界**：此参考证据不能代替本项目原生 Electron REA Evidence；项目截图与目标应用真实菜单证据仍待 Electron 空闲后补充。

## 完成后可以声明

- 仅声明已由 macOS 真实 Electron E2E/REA 观察和当前本地化合同直接证明的菜单行为。

## 完成后仍不能声明

- 未跑的 Windows/Linux、打包版本、辅助技术或其他系统语言设置已验证。
- 所有 Electron 默认菜单细节在每个平台均完全一致。
