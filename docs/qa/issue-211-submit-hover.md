# Issue #211：对话框提交按钮的悬停状态

状态：部分修复，完整级联债务仍由 [Issue #211](https://github.com/heyallencao/corvid/issues/211) 跟踪。

## 观察与判断

旧的 `button:hover:not(:disabled)` 选择器特异性为 `(0,2,1)`，高于 `dialog form > button[type="submit"]` 的 `(0,1,3)`。所以指针悬停时，全局中性背景覆盖对话框提交按钮的 `--accent-solid` 主色。主按钮的色彩和操作层级会在用户准备确认时突然变化。

当前主线已把新标签按钮样式改为稳定的 `#new-tab` ID 选择器；Issue 中关于 `aria-label` 失配的旧证据已不适用于最新 `origin/main`。重复声明、其余级联债务不在本切片内。实现把通用中性悬停限定为非 `submit` 按钮，让对话框提交按钮继续使用既有主色规则。

## 参考证据

- **Kobra Chat Input**：REA `capture_browser_scenario` Evidence `ev_996ee85086d0d37ca6f674d30e7fe76884766d21c66af9c8f561d80dd054864d`，公开页面 `https://kobra.systems/components/chat-input`，观察日期 2026-11-04。已有记录直接观察到输入区和发送操作被清楚组合；当次没有悬停或提交，故只作操作层级参考，不作为按钮 hover 行为证据。详见[双浏览器参照分析](../research/browser-reference-analysis.md#2026-11-04-rea-交互参考补充agent-输入与侧栏展示)。
- **Rare UI**：已记录的 REA 页面被 Vercel Security Checkpoint 拦截；EasyUI、Pin UI 本轮未检查。Aceternity Sidebar 的 hover 展开来自页面说明，本轮未执行验证。本切片不从这些未知行为推导产品规则。
- Corvid 视觉判断直接依据自身原生对话框：主要操作应持续显示品牌强调色，取消操作保持中性。测试和截图使用隔离临时数据，不含用户网页、账号或真实 Profile 内容。

## 验证与截图

- `node tests/interaction-states-e2e.cjs`：macOS arm64、Node.js v24.22.1、Electron 45.2.1，1024×700；隔离 `CORVID_DATA_DIR`，浅色与深色主题。真实打开“新建空间”对话框、确认指针命中 `:hover` 并等待 120ms 状态过渡完成，再断言 computed background 同时等于悬停前颜色和 `--accent-solid` token。修复版本通过；把选择器临时还原后，同一 E2E 在主色断言处按预期失败（实测浅色 hover 背景 `rgb(236, 238, 242)`，token 为 `rgb(83, 103, 216)`）。
- Impeccable detector 对 `desktop/index.html` 发现既有侧边强调线、面板阴影组合和类型层级提示；这些都不属于本次按钮级联改动，未扩大本切片范围。
- 截图对应对话框打开、输入框聚焦、鼠标悬停在主按钮的状态：
  - 浅色：[1024×700](screenshots/issue-211-submit-hover/light-1024x700.png)
  - 深色：[1024×700](screenshots/issue-211-submit-hover/dark-1024x700.png)

尚未覆盖打包版本、Windows/Linux 原生主题和自动化、键盘焦点路径的完整人工走查或辅助技术实播；此切片也不表示 Issue #211 的其他 CSS 级联债务已经解决。
