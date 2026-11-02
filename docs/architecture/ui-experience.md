# Corvid 统一桌面体验设计

状态：active · v0.1
对应执行板：[D21 统一浏览器与 Agent 桌面体验](../execution/feature-board.md)

## 产品方向

Corvid 是可作为日常浏览器使用的完整桌面产品。Ego 提供“用户与 Agent 在同一浏览器并行工作”的产品参照；Kaze 提供持久侧栏、清楚的 Space 结构与 Browser/Agent 区域切换参照。Corvid 建立自己的品牌、视觉语言和交互合同，不复制参考产品的界面实现。

内置 Agent 使用 Pi SDK。Pi 是执行运行时；Corvid 负责用户可见的任务体验、页面上下文同意、Profile/Room/Page 绑定、任务状态、暂停/恢复、控制权和结果呈现。

## 当前基线

- 本机隔离启动的空白 Corvid 窗口显示 Profile/Room 横条、标签条、地址与九个图标操作；左侧没有持久导航或 Space 列表。
- 浏览器日常入口、Agent Room 和 Pi Workbench 处于同一行，信息层级与图标语言不一致。
- History/Bookmarks/Downloads、Agent Room、Pi Workbench 复用一个顶部展开并压缩网页高度的 `#library` 面板。
- `desktop/index.html` 内存在重复覆盖的内联 CSS，浏览器 chrome、任务面板和对话框缺少共享设计 token。
- 已安装产品的现场观察：Ego 当前窗口使用浏览器导航和可见 Space 入口，并保持普通网页浏览能力；Kaze 使用 Browser/Skills/Scheduled/Activity 侧栏与可见 Space/标签组织。Ego 的 AX 树包含多个旧/后台 WebContents，不能视作单窗 DOM；截图/观察仅作产品层参照，不采集或引用私人页面内容。

## 设计原则

1. **浏览器优先，Agent 并行。** 地址栏、标签、网页保持主画布；Agent 侧栏不得夺走用户正在看的页面或隐藏当前控制权。
2. **Space 是持续导航。** Profile、用户 Room 与 Agent Room 都能被用户理解和找到；列表要显示当前选择、运行/等待/用户接管等事实状态。
3. **Pi 是工作区，不是工具图标。** 用户可以看到任务上下文、同意范围、对话、运行状态、待处理动作和结果。
4. **日常能力是一等入口。** 历史、书签、下载、设置在桌面信息架构里稳定可达；站点权限和站点数据属于当前页面的站点工具。
5. **安静、精确、亲和。** 使用低对比中性色、单一品牌强调色、统一间距与圆角、语义图标和清晰层级。状态依靠文案/形状/颜色共同表达，避免依赖 emoji 或颜色单独表达。
6. **桌面尺寸自适应。** 大窗口显示持久侧栏和 Pi 并排工作区；窄窗把导航收拢为图标列，网页与 Pi 面板同步收窄。当前 Chromium `WebContentsView` 位于 shell HTML 之上，不能可靠地用 HTML 面板覆盖网页，因此保持并排布局；桌面窗口下限用于保留至少 320px 网页画布与可读的 Agent 面板。
7. **可访问且可预期。** 控件有可访问名称和清晰 focus-visible，快捷键/触控板可达，减少动态效果设置下仍保留状态转换。

## 目标信息架构

- **左侧导航：** Corvid 品牌；Profile 切换；Spaces/Rooms 列表与新建；Agent 区（Pi 工作台入口与 Agent Room 列表）；底部书签、历史、下载、设置。
- **浏览器 chrome：** 标签行和新建标签；后退、前进、刷新；地址/搜索输入；收藏与当前站点工具。
- **主画布：** 当前 Browser Page，由 Chromium `WebContentsView` 呈现。
- **Pi 工作区：** 右侧并行面板，含任务列表/对话、明确的页面预览和同意、暂停/继续/停止状态；保持当前 task transcript 绑定。
- **通用列表与设置：** 复用统一的标题、搜索、空态、条目、错误和确认组件。

## 交付顺序与当前进度

1. **首轮已实现**：统一 CSS token、结构化样式文件、持久左侧 Profile/Space/常用入口、收敛浏览器顶部工具层级，并将 Pi Agent 工作区放到右侧；保持现有浏览和 Room 合同。隔离 Electron 下已人工检查书签/历史/下载/设置和约 770px 窄窗；修复 HTML modal 被网页 view 覆盖的问题。证据见[桌面 UI 视觉检查记录](../qa/ui-visual-check.md#2026-11-02-corvid-浏览器壳与-pi-工作区人工检查)。
2. **继续打磨**：完善 Pi 任务列表空态、运行、等待用户、完成、失败、恢复和上下文同意；通过 Pi Room 实际运行与状态切换继续验收。
3. **后续统一**：History/Bookmarks/Downloads、设置、站点权限/站点数据对话框、菜单、错误/空态与动态状态。
4. **完整视觉验收**：宽/窄最小窗口、多 Room/标签、多 Profile、长内容、键盘、屏幕阅读器、对比度、减少动态效果，并按 macOS/Windows 分别留存复验结论。

## 不在本次视觉方向中改变

- 不更改 Pi SDK runtime、默认工具 allowlist、授权合同、数据隔离和用户交接语义。
- 不把未实现的 Skills、Scheduled、Activity 加入导航作为空壳功能。
- 不在视觉 QA 中使用或保留真实用户 Profile、网页内容、Cookie、历史、书签或登录数据。

## 验收边界

每一批 UI 变化只声明该批实际在隔离 Electron 窗口中验证的视觉和交互结果。没有覆盖的 OS、打包版本、屏幕阅读器、主题模式或真实网站保留为未验证；Ego/Kaze 的未观测行为不推断为产品事实。
