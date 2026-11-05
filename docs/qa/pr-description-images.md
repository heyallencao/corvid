# PR 描述截图链接检查

`node tests/pr-description-images.test.cjs` 验证规则回归；`node scripts/check-pr-description-images.cjs <event.json>` 读取 GitHub Pull Request 事件 JSON，仅检查 PR 描述中的 Markdown/HTML 图片目标与截图说明里的本机路径。创建/更新 PR 时，作者或 reviewer 应逐项完成 `.github/PULL_REQUEST_TEMPLATE.md` 的截图检查；取得 PR event JSON 后可额外运行该脚本。

- 开放 PR 可使用自身分支的图片以便评审；指向另一个分支的图片会失败。
- PR 合并时仍指向非 `main` 分支的图片会失败。图片合并后要改为 `main` 固定路径或 GitHub 附件。
- 图片目标不能是本机绝对路径、`file://` 或相对地址；截图说明行中的 `/Users/`、`/tmp/`、`/private/tmp/` 等路径会失败。
- 检查器不下载或渲染图片，不检查图片内容、隐私脱敏、实际交互、REA 证据或正文复现质量。PR 模板要求人工确认脱敏和 GitHub 页面渲染；逐条治理记录见 [Issue #244](https://github.com/heyallencao/corvid/issues/244)。

仓库约束禁止新增由 PR 触发的 GitHub Actions workflow，因此这里不声称存在自动 PR 门禁。若未来要自动运行，须先符合仓库 CI 成本规则；当前以 PR 模板人工检查和可复用脚本/合同测试防止常见链接错误。
