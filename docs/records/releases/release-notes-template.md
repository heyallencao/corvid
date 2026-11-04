# Corvid v{{VERSION}} — 预览版

此 Release 面向受邀测试者。仓库保持私有，下载权限由仓库协作者权限控制。

## 下载与安装

- **Apple Silicon Mac**：下载 `Corvid-{{VERSION}}-mac-arm64.dmg`，打开磁盘映像并将 Corvid 拖入“应用程序”。
- **Intel Mac**：下载 `Corvid-{{VERSION}}-mac-x64.dmg`，打开磁盘映像并将 Corvid 拖入“应用程序”。
- **Windows x64**：下载 `Corvid-{{VERSION}}-win-x64.exe` 并运行当前用户安装程序。
- `SHA256SUMS.txt` 提供每个安装产物的 SHA-256 校验值。

## 安全与平台限制

当前产物未使用 Apple Developer ID 或 Windows 代码签名证书，macOS 也未公证。macOS 可能阻止首次打开；测试者需在 Finder 中对应用选择“右键 → 打开”并确认。Windows SmartScreen 可能显示未知发布者提示。不要在不理解此提示时继续安装。

本版仅提供 macOS arm64/x64 与 Windows x64。Linux、自动更新、卸载后的数据保留、默认浏览器/协议注册、签名与公证尚未验收。用户数据仍留在各自本机 Corvid 数据目录。

## 验证范围

Release 工作流在 macOS arm64 上运行 `npm test`，在 macOS 两种架构和 Windows x64 上构建应用包并启动打包版 smoke test。未连接真实模型/OAuth；未读取真实浏览器资料。
