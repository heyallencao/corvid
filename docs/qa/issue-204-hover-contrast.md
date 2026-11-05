# Issue #204 主要操作按钮 hover 对比修复

## 本轮范围

本切片只修复首次启动 Chrome 导入引导的主要操作按钮：全局中性按钮 hover 默认值曾以过高 CSS 特异性覆盖强调色背景，导致白色文字在浅色主题上落到浅灰背景。规则改为低特异性 `:where(...)` 默认，保留中性按钮的 hover 表面，同时让带语义样式的操作按钮保留自己的背景和文字配对。

Issue #204 的其他低对比文本、字号、菜单危险操作样式仍未覆盖；Issue 保持开放。

## Corvid 运行态验证

- 环境：2026-11-04，本机 macOS arm64、Node.js v24.22.1、Electron 45.2.1；临时 `CORVID_DATA_DIR`，首次运行只展示合成 Chrome 导入引导，不读取真实浏览数据；窗口 shell viewport 1024×700 CSS px，locale 为 `zh-CN`。
- 基线复现：修改前的隔离真实 Electron E2E 在浅色主题测得白字/hover 背景对比度 **1.16:1**，低于 4.5:1；用例以失败退出，证明回归条件存在。初次探测曾在背景过渡中途取样，已改为等待 220ms 后检查稳定态。
- 修复后：`NODE_PATH=/Users/allen/Workspace/projects/personal/corvid/node_modules env -u ELECTRON_RUN_AS_NODE CORVID_BUTTON_HOVER_QA_DIR=/tmp/corvid-issue204-validation node tests/button-hover-contrast-e2e.cjs` EXIT 0；浅/深主题主要操作均保留强调色，计算对比度各为 **4.88:1**；次要中性操作仍使用主题 hover 面色。`node --check tests/button-hover-contrast-e2e.cjs`、`node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"`、`git diff --check` 通过。完整 `npm test` 未运行。
- `docs/qa/screenshots/issue-204/` 保存浅/深主题主要操作稳定 hover 的合成截图。截图不包含网页主体、账户资料或浏览记录；尺寸、哈希见下方。
- 限制：只验 zh-CN 和 1024×700；未验英文文案、704×420 窄窗、VoiceOver、Windows/Linux、打包版或网页 `WebContentsView` 的原生合成像素。颜色与字号债务仍待后续范围。

## UI/UE 参考与 REA 边界

- 本切片保留 Corvid 既有蓝紫主要操作和中性次要操作语义，不引入新颜色或装饰。相关静态参考复用 Kobra Input OTP 的 REA Evidence `ev_b0061997e9ffbc39f967e8a14fdb42242d400edb6458f7d5b02132840b458e74`（2026-11-04，浅色静态截图/DOM/AX；场景 incomplete）。它仅提供克制表面与状态层级语境，不证明按钮 hover 对比或可访问行为，也未复制代码/素材。
- 本轮判定来自 Corvid 隔离 Electron 的 before/after computed style、对比度计算和截图，不从竞品外观推断 CSS 级联。REA 该 Evidence 未覆盖目标按钮交互；这一限制保持明确。
- Impeccable detector 本轮的实际结果记于验证日志；不以 detector 代替真实运行态测量。

## 截图证据

- [浅色主题，1024×700 CSS px](screenshots/issue-204/issue-204-onboarding-hover-light-1024x700.png)，SHA-256 `7fb69ef492b983efa4da63413dcfad6b5a3d4a29c94f4074dbbaf08349c47920`。
- [深色主题，1024×700 CSS px](screenshots/issue-204/issue-204-onboarding-hover-dark-1024x700.png)，SHA-256 `bfe09cb8abbcaf3b3a57f1a7e897e8e92d6d437715ebbc4a7c14d7c51db85396`。
