# Corvid 版本与 Release 流程

## 版本约定

- 版本采用 `0.x.x`。普通开发和补丁 Release 只递增第三级数字；只有用户明确要求时才递增第二级或第一级。
- Release 的版本号、`package.json` 和 `main` 上的版本提交必须一致。禁止从 PR head 或含未提交修改的工作区打包。
- 同一版本只发布一次；已存在的 tag/Release 不覆盖、不重写。

## 发布门槛

1. 从 GitHub `main` 检查最新提交、`package.json` 版本、最近 tag/Release 和相关工作流状态。
2. 仅在 `main` 有尚未发布的合法版本时继续。所有必需检查须成功；因付款或 spending limit 导致 runner 未启动时，记录为计费阻塞并停止，不能当作代码通过。
3. 在隔离干净 checkout 中安装依赖、运行适用的发布验收并构建对应版本。不得使用当前开发工作区的未提交内容。
4. 有已验证的安装包时，上传并标注 OS/架构、签名状态和安装要求。若只有源码归档，明确写出 Node.js 版本、`npm ci`、`npm start` 步骤，不能称为桌面安装器。
5. 发布说明记录功能摘要、验证命令/结果、未覆盖平台和已知限制。发布资产的访问范围遵循 GitHub 仓库当前可见性；任何可见性或访问权限变更都必须由用户明确要求，不由 release workflow 隐式执行。

## 当前分发状态（2026-11-06）

- GitHub 仓库：`heyallencao/corvid`，当前为公开仓库；截至本次核查没有 `v0.2.0` tag 或 GitHub Release，公开安装资产尚未创建。
- 当前 Release 候选来自已合并的 `main` SHA `0d08671742740342028b6629d6231d90366ccc69`，`package.json.version` 为 `0.2.0`。Release workflow 的 preflight、Windows x64 构建，以及 Intel Mac app smoke 和 DMG/ZIP 构建已通过；三次正式 workflow 的 Apple Silicon 全量 E2E 均未通过，因此 publish job 都被跳过。具体失败签名与链接见验证日志「v0.2.0 正式 Release 门禁重试」。
- 失败套件各自隔离复验通过，但这不足以证明 hosted 全量门禁可靠或定位根因。当前不能把 workflow artifact 当作公开 Release，也不能宣称 v0.2.0 已可下载。
- Release 来源必须继续使用 `main` 固定 SHA，不能使用 PR head 或含未提交修改的工作区。只有 Apple Silicon 全量 `npm test`、三平台 packaged smoke、五项资产和 SHA-256 清单检查全部通过后，workflow 才能创建公开 Release。
- 必需检查若被 GitHub 账户计费/额度错误阻止，应记录为计费阻塞，不能当作代码通过。

## 执行入口

持续分发能力仍属于 [执行任务板 D15/D17](../../execution/feature-board.md)；本文件定义发布约束，不代表打包、签名或跨平台安装器已经实现。
