# Issue #345：Windows 平台手动验收清单

## 自动化门禁

跨平台代码提交后，只能从已合并的 `main` 手动运行仓库现有 Release workflow。`publish=false` 保持默认；该工作流不签名/公证，也不创建公开 Release。Windows job 构建 NSIS x64 和 `win-unpacked`，随后运行 `npm run test:packaged:win`：

- 打包启动、架构、ASAR 资源、首个空间、控制服务与优雅退出。
- 打包版 Ctrl 快捷键：新建/关闭标签、地址栏、重载、前进/后退、切换标签、缩放和 Profile 设置重启恢复。
- 打包版设置中心：目录设置替身、偏好保存与重启恢复；这不验证 Windows 原生目录选择器或保存面板。
- 单实例：第二个进程退出并激活第一个实例，原控制服务保持可用且不新增窗口。

Windows DPAPI 凭据往返与 Chrome 导入类别隔离继续由各自已有的手动 workflow 验收；本 issue 不复制其测试。

## Windows 桌面人工检查

仅在 Windows 10/11 的隔离测试用户或一次性虚拟机上执行。使用空的 `CORVID_DATA_DIR` 和本地合成下载文件，不导入宿主浏览器资料，不提供账号或真实网页数据。每项记录 OS build、架构、Node/Electron 版本、窗口尺寸与缩放比例；分享截图前检查没有用户目录、账号、网页内容或下载路径。

1. 从现有 NSIS 安装器以当前用户安装，不授予管理员权限；安装目录可自选。确认开始菜单/桌面入口按当前安装配置工作。此步骤是待验收项，Windows 自动化目前只运行 `win-unpacked`，不安装 NSIS。
2. 打开“设置 → 下载”：从本地临时根目录选择带空格和中文字符的下载目录。取消选择时字段不变；确认后保存，检查 `browser-preferences.json` 中路径精确、重启后设置仍在。使用无效目录时确认显示错误且没有写入其他目录。
3. 开启“下载前询问保存位置”，触发一个本地合成文件下载。保存面板取消后目标文件不存在；确认后文件内容精确。再关闭询问选项，确认自动保存只写入所选隔离目录。
4. 通过键盘逐项验证 Ctrl+T、Ctrl+N、Ctrl+W、Ctrl+L、Ctrl+R、Ctrl+[、Ctrl+]、Ctrl+Tab、Ctrl+数字、Ctrl+加号/减号/0、F11，以及 Alt 显示菜单；确认操作作用于当前窗口/标签并能恢复窗口。
5. 在 100%、150% 和 200% 显示缩放下检查工具栏、设置、Agent 工作台与菜单无裁切/重叠；中英文均检查中文字体回退、按钮名称和焦点可见。切换窗口、最小化/恢复和从任务栏激活时确认窗口状态正确。
6. 完成 Windows 安全存储手动 workflow，记录 DPAPI 密文重启读取与登出删除结果。Chrome 导入只使用合成 Profile；目录选择器应定位到 `%LOCALAPPDATA%/Google/Chrome/User Data`，取消后预览和导入状态不变。
7. 检查安装、启动、退出、卸载后的用户数据保留行为。此产品尚无正式升级、卸载/保留和签名分发合同；记录观察结果，不据单次手工检查扩展产品承诺。

## 当前路径与平台边界

- 桌面与 SDK 继续将 `CORVID_DATA_DIR` 作为优先路径；未设置时均使用当前用户 home 下的 `.corvid`。Windows 路径为 `%USERPROFILE%\\.corvid`。本切片不把默认目录搬迁到 `%APPDATA%`，也不自动复制旧数据。
- Electron `userData` 与单实例锁使用同一个解析后数据目录，避免同一安装在不同目录的隔离 E2E 相互抢锁；同一数据目录的第二个进程会聚焦已有窗口。
- Windows Chrome User Data 路径已使用 `%LOCALAPPDATA%`，Cookie 导入仍按现有能力边界说明。
- Windows Electron `safeStorage` 使用系统实现（DPAPI），已有原生 Windows workflow 覆盖合成凭据的保存/重启读取/登出删除。
- 应用当前没有独立文件日志目录、崩溃上报器或 Corvid 崩溃转储合同；不能把 Electron/Windows 默认 Crashpad 路径称为已支持日志能力。
- Windows NSIS 仍未签名。本清单不决定未签名安装器的 SmartScreen 接受策略，不运行签名、公证或公开发布。
