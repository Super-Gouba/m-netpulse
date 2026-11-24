# M-NetPulse

Windows 网络流量监控软件：实时上下行速率、今日累计、按进程的应用流量与 TCP 连接明细。
单文件 exe（自包含 .NET 6），WebView2 界面，无需安装运行时。

## 功能

- **真实采集**：全局速率来自网卡性能计数器（Network Interface, Bytes/Sec）逐卡求和；
  今日累计由真实速率累加并跨重启持久化。
- **连接详情**：系统 TCP 表（`GetExtendedTcpTable`）中的真实活动连接，含远程 IP、端口、归属进程。
- **应用流量**：按真实连接归属 PID；进程级速率/累计取自 `GetPerTcpConnectionEStats`
  （Windows 10/11 正式版可用；不支持时界面明确提示，不伪造数字）。
- 120 秒滚动曲线、月度配额环、告警中心、统计报表、进程限速占位（限速/历史报表为演示数据）。
- **在线自动更新**：启动时经 GitHub Releases 检查新版本；安装版可一键下载并静默升级
  （先卸载旧版再装新版），便携版引导到发布页手动替换。可在设置页关闭或忽略指定版本。

> 只显示真实数据是本项目的底线：采集失败或不可用时给出空态与说明，不用模拟值冒充。

## 构建

需要 .NET 6 SDK 与 WebView2 Runtime（Win10 1809+ / Win11 通常自带）。

```powershell
# 便携版单文件 exe
dotnet publish -c Release -r win-x64 --self-contained `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:EnableCompressionInSingleFile=true
```

产物：`bin\Release\net6.0-windows\win-x64\publish\MNetPulse.exe`（约 65 MB，含 wwwroot）。

安装版使用 Inno Setup 6 打包：

```powershell
& "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe" installer.iss
```

> `installer.iss` 中的 `AppId` 必须固定，Inno 据此识别同系列已装版本并在升级时先卸载旧版；
> 修改它会导致新版本与旧版本并存。

## 自动更新原理

- 检查：`GET https://api.github.com/repos/Super-Gouba/m-netpulse/releases/latest`（仅读取公开信息）。
- 下载：Release 资产 `MNetPulse-Setup-<版本>.exe`，存到 `%LocalAppData%\MNetPulse\updates\`。
- 安装版升级：写一个临时 `.cmd` 延迟 2 秒启动安装包并 `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CURRENTUSER`，
  主程序随即将退出，由安装包完成“卸载旧版 → 装新版”。
- 便携版：打开发布页，用户手动替换 exe。
- 偏好（是否自动检查、忽略的版本）持久化在 `%LocalAppData%\MNetPulse\update.json`。

## 数据自查

运行后查看 `%LocalAppData%\MNetPulse\startup.log`，每 15 秒一行 `[PID]` 诊断：
`全局↓=…B/s ↑=…B/s` 为真实速率；`EStats成功>0` 表示进程级字节统计可用。

## 许可

MIT，见 [LICENSE](LICENSE)。
