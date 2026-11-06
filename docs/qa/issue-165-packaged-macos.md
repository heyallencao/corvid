# Issue #165 D25-4：macOS arm64 打包版设置与原生对话框

## 环境

- macOS arm64，真实打包 `.app`，Electron 45.2.1；基线为合入 D25-3 后的 main `57e3a74`。
- `CORVID_DATA_DIR` 指向临时隔离目录，下载 fixture 由 `127.0.0.1` 本地 HTTP 服务提供；没有访问真实网页、Provider、OAuth 或用户 Profile。
- 未附原生文件选择器截图：系统窗口默认列出宿主 Downloads 内容，无法在截图中安全去除全部个人文件名。

## 运行证据

- `npm run package:mac:dir` 成功构建 arm64 `Corvid.app`。
- `npm run test:packaged:mac` 成功：Fuses 配置、篡改 app.asar 拒绝启动、打包应用启动与正常退出（macOS arm64，Electron 45.2.1）。
- 直接启动打包应用并检查设置中心：常规与搜索、下载、外观、当前网站、浏览身份、Agent 与连接分类可见；下载路径显示应用级范围，询问保存位置默认开启。
- 从原生目录选择器将下载目录选择到隔离数据目录内的空 `Downloads` 文件夹，保存后 `browser-preferences.json` 为 schemaVersion 2，下载路径写为所选隔离目录，权限为 `0600`。
- 从本地 HTTP fixture 触发下载，在原生“保存下载”面板将目标位置选为隔离文件夹并保存；文件内容与 fixture 字节一致。第二次打开保存面板后取消，应用返回 fixture 页面。
- 退出并以同一隔离数据目录重启打包应用，fixture 标签恢复；设置中心仍显示隔离下载路径与“下载前询问保存位置”开启。

## 边界

- 这是 macOS arm64 开发签名状态下的打包 `.app` 证据；不代表 Developer ID 签名、公证、DMG/ZIP 安装、macOS x64 或 Windows。
- Windows 2022 x64 的打包构建与启动/退出 smoke 已由手动 Release workflow `42139187287` 验证；该 smoke 不打开设置，也不验证 Windows 原生目录/保存对话框。站点确认框的取消/确认仍由自动化替身覆盖。
