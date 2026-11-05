# Issue #130 Agent 工作台校验错误本地化

## 范围

为 Agent 工作台页面上下文同意、任务输入、页面上下文变化、续聊条件、停止状态、历史记录可用性和用户接回控制权等校验增加稳定错误码，并在 `zh-CN` 与 `en` locale 资源中提供对应文案。Electron IPC 会将错误包装为 `Error invoking remote method ...`；本地化解析仅对标准 IPC 包装解包，再按 Corvid 错误码查询资源。未知错误保持现有回退逻辑。

本切片不代表 Issue #130 完成，也不覆盖所有主进程、存储、Provider/runtime 错误、帮助路径或其他稀有状态。

## 验证

- 环境：2026-11-04，本机 macOS arm64，Node.js v24.22.1，Electron 45.2.1；独立 worktree `/private/tmp/corvid-issue130-agent-error-localization`。
- `node tests/agent-task-continuation-contract.cjs`：通过；检查七种错误码在两种 locale 中都有资源映射，并检查 Electron IPC 包装的页面变化错误能够命中双语资源。
- `env -u ELECTRON_RUN_AS_NODE node tests/pi-workbench-errors-e2e.cjs`：真实开发版 Electron + Playwright + 本地 HTTP 页面夹具，退出码 0。切换英文界面，在 Agent Room 预览并同意页面上下文后，导航已绑定页面并提交旧预览；界面显示 `Message not sent: The page changed. Review and confirm its content again.`，且没有创建任务。
- `node --check desktop/locales.js`、`node --check tests/pi-workbench-errors-e2e.cjs` 与 `git diff --check`：通过。
- PR #249 的六个 GitHub Actions 跨平台 job（macOS、Ubuntu、Windows）均在启动前失败，`steps=[]`；GitHub annotation 指向近期账户付款失败或支出限额，runner 未执行，不能视为跨平台测试失败或通过。
- 测试用隔离临时 `CORVID_DATA_DIR`；没有访问外网或真实浏览数据，没有调用模型、OAuth、签名包、钥匙串或 notarization 流程。

## 限制

真实 Electron E2E 只直接覆盖英文界面中的页面已变化错误；七种错误码的中英文映射由模块合同验证。未运行全量 `npm test`，未验证打包签名版本、Windows/Linux、VoiceOver 或其他 Agent 错误源。此为错误文案逻辑切片，不涉及页面几何或视觉样式；本轮未做竞品 UI/REA 对比。
