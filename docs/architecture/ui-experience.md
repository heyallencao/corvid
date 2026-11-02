# Corvid 统一桌面体验设计

状态：active · v0.1
对应执行板：[D21 统一浏览器与 Agent 桌面体验](../execution/feature-board.md)

## 产品方向

Corvid 是可作为日常浏览器使用的完整桌面产品。产品主线按两层组合：以 EGO 的用户日常浏览器与共享 Spaces 为主产品模式，让用户继续使用浏览器时，Agent 在隔离 Space 中并行工作；吸收 Kaze 的内置 Agent 工作台、任务分组/状态/接管，以及 BrowserMCP 外部浏览器操作能力。Corvid 要把这些放进统一的 Profile、Room、Page 和授权合同，建立自己的品牌、视觉语言和交互，不复制参考产品的界面实现。完整参照证据与限制见[双浏览器参照分析](../research/browser-reference-analysis.md)。

当前内置 Agent 集成 Pi SDK 作为可替换的执行运行时。PI 是内部实现选择，不是产品名称、功能名称或用户需要理解的概念。产品始终称为 Corvid Agent；对话、任务、工作区、模型连接、页面来源、授权、错误与恢复均使用 Corvid 定义的产品语义。用户界面、帮助文案、通知和可导出的产品记录不得要求用户认识或操作底层运行库；Provider 与模型名称可以按配置需要展示。

Corvid 持有任务 ID、对话与消息、模型偏好、Profile/Room/Page 绑定、授权边界、控制权和状态呈现。适配器专属的会话检查点属于内部实现元数据，必须封装为可迁移数据；更换或升级执行引擎时，由 Corvid 负责兼容迁移、重新授权或清楚说明恢复限制，用户继续从 Corvid 对话中工作。不得把运行库命名或专属会话格式提升为公开产品合同。

Provider 凭据也由 Corvid 管理：账号授权写入版本化的 Corvid 凭据记录，由当前 Agent 适配器提供给模型调用；运行时自有凭据文件仅作为升级迁移来源，不作为后续的用户数据合同。当前本地文件权限限制为 owner-only（0600），尚未接入操作系统钥匙串加密。

## 当前基线

- 本机隔离启动的空白 Corvid 窗口显示 Profile/Room 横条、标签条、地址与九个图标操作；左侧没有持久导航或 Space 列表。
- 浏览器日常入口、Agent Room 和 Corvid Agent 工作区处于同一行，信息层级与图标语言不一致。
- History/Bookmarks/Downloads、Agent Room、Corvid Agent 工作区复用一个顶部展开并压缩网页高度的 `#library` 面板。
- `desktop/index.html` 内存在重复覆盖的内联 CSS，浏览器 chrome、任务面板和对话框缺少共享设计 token。
- 已安装产品的现场观察：Ego 当前窗口使用浏览器导航和可见 Space 入口，并保持普通网页浏览能力；Kaze 使用 Browser/Skills/Scheduled/Activity 侧栏与可见 Space/标签组织。Ego 的 AX 树包含多个旧/后台 WebContents，不能视作单窗 DOM；截图/观察仅作产品层参照，不采集或引用私人页面内容。
- 参照边界：EGO 的公开 `ego-lite` 仓库是 Agent harness/技能，不是完整浏览器运行时；Kaze 的开源仓库主要提供公开产品说明、网站与技能，安装版 Electron 包包含实际运行时代码。对 EGO 的闭源浏览器本体不推断未观察到的实现；对 Kaze 的 REA 静态图谱不推断运行时可达性或授权效果。

## 设计原则

1. **EGO 式日常浏览为主，Kaze 式 Agent 协作为内建能力。** 地址栏、标签、网页保持主画布；Agent 通过隔离 Space 并行工作，侧栏和任务空间不得夺走用户正在看的页面或隐藏当前控制权。
2. **空间是持续导航。** 延续 EGO 共享浏览器中的隔离 Space 思路，并结合 Kaze 可见的 Space/任务组织；界面统一把 Room 呈现为“空间”、把 Profile 呈现为“浏览身份”，避免用户同时学习多套内部术语；用户空间与 Agent 空间都能被找到，列表显示当前选择、运行/等待/用户接管等事实状态。
3. **Agent 是 Corvid 工作区，不是运行库名称。** 用户可以看到页面来源、同意范围、对话、运行状态、待处理动作和结果；引擎名称和会话格式仅留在实现与受限诊断中，运行时可以独立替换。
4. **日常能力是一等入口。** 历史、书签、下载、设置在桌面信息架构里稳定可达；站点权限和站点数据属于当前页面的站点工具。
5. **安静、精确、亲和。** 使用低对比中性色、单一品牌强调色、统一间距与圆角、语义图标和清晰层级。状态依靠文案/形状/颜色共同表达，避免依赖 emoji 或颜色单独表达。
6. **桌面尺寸自适应。** 大窗口显示持久侧栏和 Corvid Agent 并排工作区；窄窗把导航收拢为图标列，网页与 Agent 面板同步收窄。当前 Chromium `WebContentsView` 位于 shell HTML 之上，不能可靠地用 HTML 面板覆盖网页，因此保持并排布局；桌面窗口下限用于保留至少 320px 网页画布与可读的 Agent 面板。
7. **可访问且可预期。** 控件有可访问名称和清晰 focus-visible，快捷键/触控板可达，减少动态效果设置下仍保留状态转换。

## 目标信息架构

- **左侧导航：** Corvid 品牌；Profile 切换；Spaces/Rooms 列表与新建；Agent 区（Corvid Agent 对话入口与 Agent Room 列表）；底部书签、历史、下载、设置。
- **浏览器 chrome：** 标签行和新建标签；后退、前进、刷新；地址/搜索输入；收藏与当前站点工具。
- **主画布：** 当前 Browser Page，由 Chromium `WebContentsView` 呈现。
- **Corvid Agent 对话工作区：** 右侧并行面板采用持续聊天布局，空态引导、单线程消息流、活动与状态位于上方，固定输入框、当前页面来源和模型选择位于底部；历史按对话收起，可选中后续聊。发送页面内容前提供可检查的预览和明确同意。运行、失败、停止、接管和继续状态就近显示在对话中，conversation 与 Agent Room/task/transcript 保持清晰对应。交互密度参考 REA 可见的 Kaze Agent 面板和模型/输入相对位置，Corvid 保留自己的视觉语言、EGO 式日常浏览主线及授权合同。当前切片由 [Issue #56](https://github.com/heyallencao/corvid/issues/56) 跟踪。
- **通用列表与设置：** 复用统一的标题、搜索、空态、条目、错误和确认组件。

## 交付顺序与当前进度

1. **首轮已实现**：统一 CSS token、结构化样式文件、持久左侧 Profile/Space/常用入口、收敛浏览器顶部工具层级，并将 Corvid Agent 工作区放到右侧；保持现有浏览和 Room 合同。隔离 Electron 下已人工检查书签/历史/下载/设置和约 770px 窄窗；修复 HTML modal 被网页 view 覆盖的问题。证据见[桌面 UI 视觉检查记录](../qa/ui-visual-check.md#2026-11-02-corvid-浏览器壳与-pi-工作区人工检查)。
2. **继续打磨**：Corvid Agent 任务卡分开呈现任务目标、页面来源、执行状态与用户控制状态；单线程消息流、历史选择、固定输入区与模型选择已进入本轮。流式工具活动、停止、失败重试和辅助技术验收由 [Issue #56](https://github.com/heyallencao/corvid/issues/56) 继续跟踪。
3. **后续统一**：History/Bookmarks/Downloads、设置、站点权限/站点数据对话框、菜单、错误/空态与动态状态；补运行中停止、失败重试、键盘与辅助技术体验。
4. **完整视觉验收**：宽/窄最小窗口、多 Room/标签、多 Profile、长内容、键盘、屏幕阅读器、对比度、减少动态效果，并按 macOS/Windows 分别留存复验结论。

## 不在本次视觉方向中改变

- 不更改 Pi SDK runtime、默认工具 allowlist、授权合同、数据隔离和用户交接语义。
- 不把未实现的 Skills、Scheduled、Activity 加入导航作为空壳功能。
- 不在视觉 QA 中使用或保留真实用户 Profile、网页内容、Cookie、历史、书签或登录数据。

## 验收边界

每一批 UI 变化只声明该批实际在隔离 Electron 窗口中验证的视觉和交互结果。没有覆盖的 OS、打包版本、屏幕阅读器、主题模式或真实网站保留为未验证；Ego/Kaze 的未观测行为不推断为产品事实。
