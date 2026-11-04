# PR 描述截图链接检查

`node tests/pr-description-images.test.cjs` 验证规则回归；`node scripts/check-pr-description-images.cjs <event.json>` 读取 GitHub Pull Request 事件 JSON，仅检查 PR 描述中的 Markdown/HTML 图片目标与截图说明里的本机路径。

- 开放 PR 可使用自身分支的图片以便评审；指向另一个分支的图片会失败。
- PR 合并时仍指向非 `main` 分支的图片会失败。图片合并后要改为 `main` 固定路径或 GitHub 附件。
- 图片目标不能是本机绝对路径、`file://` 或相对地址；截图说明行中的 `/Users/`、`/tmp/`、`/private/tmp/` 等路径会失败。
- 检查器不下载或渲染图片，不检查图片内容、隐私脱敏、实际交互、REA 证据或正文复现质量。PR 模板要求这些人工检查，逐条治理见 [Issue #244 执行计划](../execution/slices/github-screenshot-evidence.md)。

工作流从目标分支检出检查器，并只请求 `contents: read`、`pull-requests: read` 权限；检查器不执行 PR 分支提供的代码。
