# Corvid 桌面打包与启动边界

## 首个可复现产物

首个打包切片为 macOS arm64 `.app` 开发包。`electron-builder` 使用固定版本和显式 bundle identifier，打包桌面、CLI、MCP 与 SDK 运行文件及生产依赖；E2E 测试、文档和工作区数据不进入应用包。构建产物写入被 Git 忽略的 `dist/`。除未签名开发包外，可显式提供钥匙串中的 Developer ID 证书名称主体，构建开启 Hardened Runtime 并强制签名；签名身份不写入仓库。

应用显式使用 `com.heyallencao.corvid` 作为 bundle identifier。Corvid 用户数据仍使用 `~/.corvid`；测试通过 `CORVID_DATA_DIR` 指向临时目录，不依赖安装位置或当前工作目录。
本轮未包含 Corvid 专属 macOS 图标，因此开发包会使用 Electron 默认图标；品牌图标仍需在面向用户分发前补齐。

## Electron Fuses 安全配置

electron-builder 产物显式设置 Fuse V1：关闭 `RunAsNode`、`NODE_OPTIONS` 和 Node CLI Inspector 参数；开启 `EnableEmbeddedAsarIntegrityValidation` 与 `OnlyLoadAppFromAsar`，要求应用代码从 `app.asar` 加载并校验归档。Apple Silicon 未签名开发包设置 `resetAdHocDarwinSignature`，避免翻转 Fuse 后沿用失效的 Electron 临时签名；Developer ID 模式由 electron-builder 在翻转 Fuse 后重新签名。

保留明确的兼容边界：`EnableCookieEncryption` 暂时关闭，避免未设计 Cookie 数据迁移时引入不可逆存储转换；`LoadBrowserProcessSpecificV8Snapshot` 关闭，因为当前没有独立 Browser V8 snapshot；`GrantFileProtocolExtraPrivileges` 与 `WasmTrapHandlers` 保留 Electron 原始启用状态。`tests/packaged-fuses-e2e.cjs` 检查完整 Fuse 字节集合，新增或未知 Fuse 会让验收失败，要求升级 Electron 时先逐项决策。

## 打包后启动验收

`npm run package:mac:dir` 在 Apple Silicon 主机上构建未签名的 arm64 `.app`。构建前删除同路径旧 `.app`，构建失败时清除不完整产物，避免旧包被误当作本次结果。需要 Developer ID 签名时，设置 `CORVID_MAC_SIGNING_IDENTITY` 后运行 `npm run package:mac:signed:dir`；签名模式没有可用身份会在改写产物前失败。随后运行 `npm run test:packaged:mac` 检查 Fuse 状态、在隔离副本篡改 `app.asar` 后确认运行时拒绝，并从正常打包产物启动真实 Electron。启动检查只通过本地 loopback Chromium CDP 控制 renderer，不依赖已关闭的 Node Inspector。`npm run test:packaged:signed:mac` 另检查 Developer ID 签名、signed app 启动以及系统安全存储密钥写入、重启读取和登出删除；signed app 的 ASAR 篡改路径不运行，因为修改会破坏外层代码签名，应在未签名副本上单独验证。

这些打包验收只使用隔离临时数据目录和本地 Electron UI，不导入真实浏览器资料，不连接 OAuth 或模型，不修改默认浏览器或协议关联。

## 尚未建立的分发合同

未签名开发包不能视为面向公众的 macOS 安装包。本地 Developer ID 签名只证明该产物由当前钥匙串身份签署，不代表已公证或可在全新设备直接安装。DMG/PKG 安装体验、公证、升级/回滚、自动更新、卸载和数据保留，Windows/Linux 构建与原生平台行为仍由[执行任务板 D15/D17](../execution/feature-board.md)跟踪。构建当前只在 macOS arm64 上验收；其他架构不得由该结果外推。
