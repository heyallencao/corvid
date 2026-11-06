# Corvid 桌面打包与启动边界

## 首个可复现产物

首个打包切片为 macOS arm64 `.app` 开发包。`electron-builder` 使用固定版本和显式 bundle identifier，打包桌面、CLI、MCP 与 SDK 运行文件及生产依赖；E2E 测试、文档和工作区数据不进入应用包。构建产物写入被 Git 忽略的 `dist/`。除未签名开发包外，可显式提供钥匙串中的 Developer ID 证书名称主体，构建开启 Hardened Runtime 并强制签名；签名身份不写入仓库。

应用显式使用 `com.heyallencao.corvid` 作为 bundle identifier。桌面与 SDK 共用数据目录解析：优先使用 `CORVID_DATA_DIR`，否则使用当前用户 home 下的 `.corvid`（Windows 为 `%USERPROFILE%\\.corvid`）；本轮不迁移到 `%APPDATA%`，也不复制旧目录。Electron `userData` 在请求单实例锁前指向同一目录，因此隔离数据目录拥有各自的实例锁。测试通过 `CORVID_DATA_DIR` 指向临时目录，不依赖安装位置或当前工作目录。
本轮未包含 Corvid 专属 macOS 图标，因此开发包会使用 Electron 默认图标；品牌图标仍需在面向用户分发前补齐。

## 打包安全配置与验收

electron-builder 为 Electron Framework 写入 Fuse V1：关闭 `RunAsNode`、`NODE_OPTIONS` 和 Node CLI Inspector 入口；打包启动 smoke 使用只绑定 loopback 的 Chromium CDP 连接 renderer，不启用 Node Inspector；启用内嵌 ASAR 完整性校验与 `OnlyLoadAppFromAsar`。保留 `GrantFileProtocolExtraPrivileges` 以支持当前 `file://...app.asar` 桌面壳；关闭该 Fuse 的试验会阻止打包页面加载。Cookie 加密和浏览器 V8 snapshot Fuse 保持 Electron 二进制默认状态；首个安全切片不改变既有 Profile Cookie 存储语义，Corvid 也未打包独立 browser snapshot。macOS arm64/x64 目录包均由 `test:packaged:mac` / `test:packaged:mac:x64` 检查 Fuse 字节、正常启动和隔离副本 ASAR 篡改拒绝；签名包测试跳过篡改副本，因为改写会使外层 Developer ID 签名失效。Fuse 测试限定 macOS，Windows 包不据此推断 Fuse 字节状态。

## 打包后启动验收

`npm run package:mac:dir` 在 Apple Silicon 主机上构建未签名的 arm64 `.app`；`npm run package:mac:dir:x64` 使用原生 Intel 主机或 Apple Silicon 上的 Rosetta Node 构建未签名的 x64 `.app`。构建前删除同架构路径旧 `.app`，构建失败时清除不完整产物，避免旧包被误当作本次结果。需要 Developer ID 签名时，设置 `CORVID_MAC_SIGNING_IDENTITY` 后运行 `npm run package:mac:signed:dir`；签名模式没有可用身份会在改写产物前失败。随后运行 `npm run test:packaged:mac` 做开发包启动检查，或运行 `npm run test:packaged:signed:mac` 验证 Developer ID 签名、从包内启动真实 Electron，并在 packaged app 中测试系统安全存储密钥写入、重启读取和登出删除。

该 smoke test 只使用隔离临时数据目录和本地 Electron UI，不导入真实浏览器资料，不连接 OAuth 或模型，不修改默认浏览器或协议关联。

## Release 产物

仓库的手动 GitHub Release workflow 在同一已合并 `main` SHA 上构建 macOS arm64/x64 DMG 与 ZIP，以及 Windows x64 当前用户 NSIS 安装器。三个目标均完成构建和打包版启动 smoke 后，发布 job 校验五个安装产物的精确文件名和集合，并附 SHA-256 清单。SHA-256 用于检查下载字节完整性，不等于构建来源证明；当前流程未生成 GitHub artifact provenance/attestation。Windows smoke 从 `win-unpacked` 启动应用，并运行打包版单实例、Ctrl 快捷键与设置偏好 E2E；设置测试替换系统目录/保存对话框，不执行 NSIS 安装器安装流程，也不验证 Windows 原生面板。版本与 `package.json` 完全一致，格式为 `0.x.x`；首发仅接受 `0.2.0`，之后常规只递增 patch。GitHub 仓库为公开仓库，Release 资产也公开可下载。

workflow 由 `workflow_dispatch` 启动，只允许从 `main` 触发；仅 build 验收时 `publish` 默认关闭，必须显式开启才会创建公开 Release。preflight 固定事件 SHA，并要求它是触发时的 `main` HEAD；build 和 publish 都 checkout 同一 SHA；只有 publish job 获得 `contents: write` 权限。

## 尚未建立的分发合同

未签名产物不能视为具备可信发布者身份的安装包。本地 Developer ID 签名只证明该产物由当前钥匙串身份签署，不代表已公证或可在全新设备直接安装。Windows NSIS 仍未签名，SmartScreen 提示策略未作产品决定。安装器交互、升级/回滚、自动更新、卸载和数据保留，Linux 构建与原生平台行为仍由[执行任务板 D15/D17](../execution/feature-board.md)跟踪。当前没有独立文件日志目录、崩溃上报器或 Corvid 崩溃转储合同。macOS Intel 与 Windows hosted runner 的 workflow 执行尚未验证；macOS arm64 本机结果不能替代这些平台验收。
