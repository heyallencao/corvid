# Issue #210 圆角与浮层层级 token 收敛

## 本轮范围

`desktop/styles.css` 新增 4px 步进的 `--radius-xs`、`--radius-sm`、`--radius-md`、`--radius-lg`、`--radius-xl` 与圆形 `--radius-circle`；壳层现有半径声明迁移到这些语义 token。投影几何集中到 card、raised、popover、panel、menu、dialog 六种 elevation token；焦点 halo 和选中态内阴影仍作为交互状态单独表达。浅/深主题已有的表面和 shadow 色值不变。

Issue #210 原文称项目无深色主题。对本轮同步的 `origin/main`（`208124f`）重新核验发现 `desktop/styles.css` 已包含 `@media (prefers-color-scheme: dark)`，故该描述已过时；这不代表 Windows/Linux、打包版主题切换已验收。裸 hex、面色/线色、状态色、hover 灰和对比度仍未统一，本 PR 是部分交付。

## Corvid 运行态验证

- 环境：2026-11-04，本机 macOS arm64，Node.js v24.22.1、Electron 45.2.1；隔离临时 `CORVID_DATA_DIR`，Renderer viewport 1024×700 CSS px，测试页面 `about:blank`，合成书签状态，无个人数据。
- 命令：`env -u ELECTRON_RUN_AS_NODE CORVID_INTERACTION_QA_DIR=/tmp/corvid-issue210-screenshots node tests/interaction-states-e2e.cjs`
- 结果：通过。浅/深主题下检查圆角阶、profile/address/new-tab/menu/site-tools/findbar/library/dialog computed style、六类 elevation 定义；原有选中/hover/active、滚动条/选区与 reduced-motion 合同继续通过。`docs/qa/screenshots/issue-210/` 保存浅/深主题合成截图。
- 不覆盖：整套 npm test、其他操作系统、打包版、屏幕阅读器、系统高对比度或全部组件逐一目视；不包含网页 `WebContentsView` 合成像素。

## UI/UE 参考：Kobra

- 站点/组件： [Kobra Input OTP](https://kobra.systems/components/input-otp)，2026-11-04 约 07:19 UTC。
- REA：Evidence `ev_b0061997e9ffbc39f967e8a14fdb42242d400edb6458f7d5b02132840b458e74`；provider-owned headless Chromium 156.0.8078.80，1280×800、en-US、浅色、reduced motion。页面从站点根路径跳转到 `/components/input-otp`。截图 SHA-256：`398ef521fe9fc5927c61aaad2d5cceb07aeb2269a5ef3a68053a658413d1110b`；DOM SHA-256：`ac2d33a90c938bd6767e933ced982c282b45dd69a296dd2144bd676497f86a9f`；Accessibility SHA-256：`5ed872c6e2812c6545083c00a67ddcfaf731d1b626806d808416dbaf2cf7c3ee`。
- 直接观察：截图显示三列组件文档布局、细分隔线、克制的浅色面、少量绿/淡紫状态标记和轻量投影；AX 树将组件区分成命名导航组并显示当前链接。该页面不是浏览器，也没有观察圆角变量或运行时 hover 行为。
- 静态证据：DOM 中的 meta 描述宣称该组件支持浅/深色与状态设计。这是站点自述，不作为主题切换行为证据。
- 覆盖限制：REA 场景捕获到截图、DOM 和 AX，但 `wait_for(html, visible)` 操作失败，场景 `completeness` 为 incomplete、缺少 action；只直接观察该组件页的浅色静态画面，没有检查其它路由、深色模式、交互、CSS 变量或计算样式。因此这里只借鉴其“不同表面以细线与少量投影区分、状态色节制”的视觉线索，不推断 token 架构，也未复制代码或素材。Rare UI、EasyUI、Pin UI、Aceternity UI 未用于本切片。
- Corvid 判断：沿用产品既有冷灰色面和蓝紫品牌强调；只统一同一壳层的形状与层级变量，避免为了贴近参考扩张色彩或装饰。

## 截图证据

- [浅色主题，1024×700 CSS px](screenshots/issue-210/issue-210-light-1024x700.png)，SHA-256 `4c68848ba1ff72044600aa6a450103fd5c7403e90aa34494c1707a5c4da82db2`。
- [深色主题，1024×700 CSS px](screenshots/issue-210/issue-210-dark-1024x700.png)，SHA-256 `33aa7c815607d7ebf9f8655a352b415eaf0b59e4760c774cd85a9c842e3fdf47`。

截图来自隔离测试数据与 `about:blank`，不含网页主体、个人资料或浏览记录。截图用于检查两主题表面与浮层层级；单张截图不证明其它组件、操作系统或打包运行态。
