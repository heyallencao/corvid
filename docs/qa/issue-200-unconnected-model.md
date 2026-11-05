# Issue #200：未连接时隐藏默认模型名

## 范围

全新安装且模型账号尚未连接时，模型目录仍需保存默认选择，但收起状态不能把该默认值显示成已经配置可用的模型。未连接时显示中性状态“当前选择尚未连接”；用户完成连接后，选择器继续显示实际模型名。连接状态、账号连接入口、模型选择持久化和页面同意合同保持不变。

服务端返回的连接状态也按 Corvid 当前界面语言呈现：`已连接`、`未连接` 与 `无需密钥` 均映射到 zh-CN/en 资源，不把主进程中的中文状态字面值带进英文界面。

## 运行态证据

隔离真实 Electron 使用合成本地页面与临时 `CORVID_DATA_DIR`；未读取用户浏览数据，也未连接模型、Provider、OAuth、API Key 或系统凭据存储。

| 状态 | BrowserWindow 外框尺寸 | PNG 尺寸 | SHA-256 |
| --- | --- | --- | --- |
| 英文未连接 | 1280×850 | 2560×1618 | `29333375666bfbf7f08639c8c113b20eb162a9c98eda9127ae220ecf3b45e8f9` |
| 中文未连接 | 1280×850 | 2560×1618 | `c2a5ecd6c44ff11a52e5f672401bfe91399e2aa843500d9a1545febed67fb356` |
| 英文窄窗，滚动后显示模型与连接操作 | 704×420 | 1408×776 | `631e101075ee53d1316a9d5bfbab127620c6742d11094975192955ae85a2a489` |

截图来自 [英文宽窗](screenshots/issue-200-unconnected-model-en-1280x850.png)、[中文宽窗](screenshots/issue-200-unconnected-model-zh-CN-1280x850.png) 和 [英文窄窗](screenshots/issue-200-unconnected-model-en-704x420.png)。BrowserWindow 尺寸是测试设置的外框尺寸；PNG 为 Retina 图像尺寸，不将 PNG 高度当作 CSS viewport。素材只包含 Corvid 本地合成页面、默认合成 Profile 和未连接模型状态。

直接观察：宽窗的模型选择器显示中性未连接文案，下面的状态行与“连接账号”操作仍清晰可见；英文 704×420 窗口收窄导航后，选择器、状态和 CTA 可通过工作台表单滚动到达，文本没有裁切，焦点环可见。

静态证据：`desktop/renderer.js` 原先无条件把 `catalog.selection` 对应的 `model.name` 放进收起的 `<select>`，而连接状态由同一 Provider 的 `configured` 字段决定。新逻辑仅在该字段为 false（或当前选择不在目录中）时替换收起选项的可见标签，不改写选项值或 `agent-model.json`。

## 参考与判断

- **参考站点/组件：** Kobra Alert（Kobra 系统状态预览组件）。项目研究记录中的历史 REA Evidence `ev_7dbddd29058eef11227135f0879409777f91101dca4a0c7d543d9886057d2f61`，记录时间 2026-11-03（原记录标题时间为 16:59，时区未注明）。直接观察仅证明页面提供了可访问的状态预览；精确路由、交互稳定性和视觉样式均不是这条证据的结论。[参考分析记录](../research/browser-reference-analysis.md#2026-11-03-1659-浏览身份安全删除对话框复核)。
- **设计推断：** 将连接状态放在所选模型旁边，可让用户理解“已保存选择”和“尚未授权使用”是两个状态；不连接时收起显示具体默认模型名会造成可用性暗示。这里沿用 Corvid 现有状态卡片，不复制 Kobra 的代码、图标或样式。
- **未知：** 本切片没有重新打开 Kobra；未验证其读屏播报和交互行为。未执行真实 Provider 登录；“连接成功后显示具体模型名”由既有 workbench E2E 的配置状态路径断言补充，未在本次窄范围 E2E 中写入系统凭据。深色主题和辅助技术实测仍未覆盖。

## 验收

- `tests/pi-unconnected-model-label-e2e.cjs`：真实 Electron 在 zh-CN/en 检查默认模型持久选择、未连接标签及连接状态翻译；键盘可到达模型管理；704×420 下可滚动找到连接状态与账号 CTA。测试无 Provider、OAuth、API Key 或系统凭据调用。
- `tests/pi-workbench-e2e.cjs` 新增断言：已配置的合成 Provider 仍显示其真实选定模型；这条现有大流程包含系统凭据写入，未在本轮运行。
- `node --check desktop/renderer.js`、`node --check desktop/locales.js`、两个相关 E2E 脚本和 `git diff --check` 均通过。

**本轮实测：** macOS arm64、Node.js v24.22.1、Electron 45.2.1。定向命令：

```sh
env -u ELECTRON_RUN_AS_NODE CORVID_UI_EVIDENCE_DIR=/private/tmp/corvid-issue200-evidence node tests/pi-unconnected-model-label-e2e.cjs
```

结果 EXIT 0。实际运行的是未签名开发 Electron；没有构建、启动或检查签名包，也没有触发钥匙串流程。未运行全量 `npm test`、真实登录或跨平台/打包版验证。
