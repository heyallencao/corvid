# Corvid 桌面打包与分发边界

## Release 产物

GitHub Actions 的手动 Release workflow 在同一源码 SHA 上构建 macOS arm64/x64 DMG+ZIP 和 Windows x64 当前用户 NSIS 安装器。三个目标均通过构建和打包版启动 smoke 后，才创建私有 GitHub Release，并附 SHA-256 清单。版本必须与 `package.json` 完全一致，格式为 `0.x.x`；常规开发只递增 patch，只有用户明确要求时才升级 minor/major。

`electron-builder` 使用固定版本和显式 bundle identifier，打包桌面、CLI、MCP、SDK 与生产依赖；测试、文档和工作区数据不进入应用包。构建产物写入 Git 忽略的 `dist/`。目前应用图标仍是 Electron 默认图标。

## 打包后启动验收

本地 Apple Silicon 开发验收使用 `npm run package:mac:dir` 和 `npm run test:packaged:mac`。Release workflow 在 macOS arm64 上运行 `npm test`，并在 macOS arm64、macOS x64 与 Windows x64 原生 runner 分别构建并启动打包应用。macOS 开发包构建前清除同路径旧 `.app`，失败时删除不完整产物；各平台 smoke 检查 `app.isPackaged`、目标架构、归档资源、浏览器窗口、Room 控制接口及优雅退出后的 `control.json` 清理。

Smoke 使用隔离临时数据目录和本地 Electron UI，不导入真实浏览器资料，不连接 OAuth 或模型，不修改默认浏览器或协议关联。

## 当前限制

安装包没有 Apple Developer ID、macOS 公证或 Windows 代码签名，当前面向受邀测试者，不代表公众级可信安装体验。macOS 首次打开可能需要用户确认，Windows 可能显示 SmartScreen 提示。Linux、自动更新、默认浏览器/协议注册、升级/回滚、卸载后的数据保留仍未验证，详见[执行任务板 D15/D17](../execution/feature-board.md)。

若 GitHub Actions runner 因账户计费限制无法启动，不得把构建或 Release 报告为成功，也不得用源码归档代替可安装产物。
