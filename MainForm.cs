using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Runtime.InteropServices;

namespace MNetPulse;

public sealed class MainForm : Form
{
    private readonly WebView2 _web = new();
    private readonly TrafficMonitor _monitor = new();
    private readonly Updater _upd = new();
    private System.Windows.Forms.Timer? _pushTimer;

    public MainForm()
    {
        Program.Log("MainForm 构造开始");
        Text = "M-NetPulse · 网络流量监控 v1.3.0";
        try
        {
            // 从 exe 自身提取图标 — 不依赖工作目录
            Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath ?? Application.ExecutablePath)
                   ?? SystemIcons.Application;
        }
        catch (Exception ex) { Program.Log("图标提取失败(忽略): " + ex.Message); }
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(1180, 720);
        Size = new Size(1360, 820);
        Font = new Font("Segoe UI", 9F);

        Controls.Add(_web);
        _web.Dock = DockStyle.Fill;

        Load += async (_, _) => await InitWebViewAsync();
        FormClosed += (_, _) => _monitor.Dispose();
        Program.Log("MainForm 构造完成");
    }

    private async Task InitWebViewAsync()
    {
        try
        {
            string exeDir = AppContext.BaseDirectory;
            string wwwroot = Path.Combine(exeDir, "wwwroot");
            Program.Log($"InitWebView: wwwroot={wwwroot} exists={Directory.Exists(wwwroot)}");
            if (!Directory.Exists(wwwroot))
            {
                MessageBox.Show("缺少 wwwroot 资源目录：" + wwwroot, "M-NetPulse",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
                return;
            }

            Program.Log("InitWebView: 检查 WebView2 运行时");
            var runtime = CoreWebView2Environment.GetAvailableBrowserVersionString();
            if (string.IsNullOrEmpty(runtime))
            {
                // WebView2 未安装 — 提示并引导下载
                var r = MessageBox.Show(
                    "未检测到 Microsoft WebView2 运行时。\n\n" +
                    "点击「是」前往官网下载安装（约 2 MB 引导包），\n" +
                    "安装完成后重新打开 M-NetPulse。",
                    "M-NetPulse 需要WebView2 运行时",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
                if (r == DialogResult.Yes)
                {
                    System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(
                        "https://developer.microsoft.com/microsoft-edge/webview2/") { UseShellExecute = true });
                }
                Close();
                return;
            }
            Program.Log("InitWebView: WebView2 版本 " + runtime);

            var env = await CoreWebView2Environment.CreateAsync(
                userDataFolder: Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "MNetPulse", "WebView2"));
            Program.Log("InitWebView: 环境创建完成");
            await _web.EnsureCoreWebView2Async(env);
            Program.Log("InitWebView: WebView2 初始化完成");
        _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        _web.CoreWebView2.Settings.IsZoomControlEnabled = false;
        _web.CoreWebView2.Settings.IsStatusBarEnabled = false;

        _web.CoreWebView2.AddHostObjectToScript("host", new Bridge(_monitor, this));
        _web.CoreWebView2.NavigationCompleted += (_, _) =>
        {
            _ = _web.CoreWebView2.ExecuteScriptAsync(
                "window.__netpulseNative = true;");
        };
        Program.Log("InitWebView: 导航到 app.local");
        _web.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "app.local", wwwroot, CoreWebView2HostResourceAccessKind.Allow);
        _web.CoreWebView2.Navigate("https://app.local/index.html");

        // 1s 推送实时快照
        _pushTimer = new System.Windows.Forms.Timer { Interval = 1000 };
        _pushTimer.Tick += async (_, _) => await PushSnapshotAsync();
        _pushTimer.Start();

        // 在线更新状态变化推送给设置页
        _upd.Changed += () => { try { _ = PushUpdateAsync(); } catch { } };
        _ = AutoCheckUpdateAsync();
        Program.Log("InitWebView: 完成");
        }
        catch (Exception ex)
        {
            Program.Log("InitWebView 异常: " + ex);
            MessageBox.Show("初始化失败：\n" + ex.Message, "M-NetPulse",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private async Task PushSnapshotAsync()
    {
        if (_web.CoreWebView2 == null || _web.IsDisposed) return;
        try
        {
            var m = _monitor;
            string json = System.Text.Json.JsonSerializer.Serialize(new
            {
                downBps = m.DownBps,
                upBps = m.UpBps,
                downTotal = m.DayRecv,
                upTotal = m.DaySent,
                adapter = m.AdapterName,
                speed = m.AdapterSpeed,
                pidTrafficOk = m.PidStatsWorking,
                apps = m.GetProcessTraffic().Select(a => new
                {
                    pid = a.Pid,
                    name = a.Name,
                    proc = a.Proc,
                    down = a.DownBps,
                    up = a.UpBps,
                    sdown = a.SessionDown,
                    sup = a.SessionUp,
                    conns = a.Conns,
                }).Take(50).ToList(),
                conns = m.Conns.Take(80).Select(c => new
                {
                    pid = c.Pid,
                    proc = c.Process,
                    remote = c.Remote,
                    port = c.Port,
                    down = c.Down,
                    up = c.Up,
                }),
            });
            await _web.CoreWebView2.ExecuteScriptAsync(
                $"window.dispatchEvent(new MessageEvent('netpulse', {{data: {json}}}));");
        }
        catch (Exception ex)
        {
            // 页面导航/释放期间偶发，记录后忽略
            Program.Log("PushSnapshot 异常(忽略): " + ex.Message);
        }
    }

    /// <summary>启动后自动检查更新：发现新版本则询问是否升级。</summary>
    private async Task AutoCheckUpdateAsync()
    {
        if (!_upd.Settings.AutoCheck) return;
        try
        {
            await Task.Delay(8000);                 // 避开启动时的网络与界面高峰
            await _upd.CheckAsync();
        }
        catch (Exception ex) { Program.Log("[更新] 自动检查异常: " + ex.Message); }
    }

    /// <summary>下载安装包；安装版排队静默安装并退出，便携版引导到发布页。</summary>
    private async Task DownloadAndInstallAsync()
    {
        var prog = new Progress<int>(p => _upd.ReportProgress(p));
        string? path = await _upd.DownloadSetupAsync(prog);
        if (path == null) return;

        // 升级包名必须与当前版本不同，避免“升级到同名版本”的无意义重装
        if (!string.IsNullOrEmpty(_upd.Latest?.Version))
        {
            string expect = Updater.ExpectedSetupName(_upd.Latest.Version);
            if (!string.Equals(Path.GetFileName(path), expect, StringComparison.OrdinalIgnoreCase))
                Program.Log($"[更新] 警告：下载文件名 {Path.GetFileName(path)} 与预期 {expect} 不一致");
        }

        if (_upd.IsPortable)
        {
            _upd.SetState("same", "便携版：已打开下载页，请手动替换程序文件");
            _upd.OpenReleasePage();
            return;
        }

        // 安装版：校验签名/存在后排队静默安装，随后退出
        try
        {
            var fi = new System.IO.FileInfo(path);
            if (!fi.Exists || fi.Length < 1024 * 1024)
            {
                _upd.SetState("error", "安装包校验失败（文件缺失或过小）");
                return;
            }
        }
        catch (Exception ex) { Program.Log("[更新] 校验异常: " + ex.Message); }

        _upd.SetState("ready", "将在 3 秒后自动重启并完成升级…");
        await Task.Delay(1200);
        Updater.QueueSilentInstall(path);
        await Task.Delay(500);
        Application.Exit();
    }

    /// <summary>把更新状态推给前端设置页。</summary>
    private async Task PushUpdateAsync()
    {
        if (_web.CoreWebView2 == null || _web.IsDisposed) return;
        try
        {
            string json = System.Text.Json.JsonSerializer.Serialize(new
            {
                current = _upd.CurrentVersion,
                state = _upd.State,
                message = _upd.Message,
                progress = _upd.Progress,
                isPortable = _upd.IsPortable,
                autoCheck = _upd.Settings.AutoCheck,
                latest = _upd.Latest == null ? null : new
                {
                    ver = _upd.Latest.Version,
                    notes = _upd.Latest.Notes,
                },
            });
            await _web.CoreWebView2.ExecuteScriptAsync(
                $"window.dispatchEvent(new MessageEvent('netpulse-update', {{data: {json}}}));");
        }
        catch { /* 页面导航期间忽略 */ }
    }

    /// <summary>暴露给 JS 的 host object。</summary>
    [ComVisible(true)]
    [ClassInterface(ClassInterfaceType.AutoDual)]
    public sealed class Bridge
    {
        private readonly TrafficMonitor _m;
        private readonly MainForm _form;

        public Bridge(TrafficMonitor m, MainForm form) { _m = m; _form = form; }

        public string GetSnapshot() => System.Text.Json.JsonSerializer.Serialize(new
        {
            downBps = _m.DownBps,
            upBps = _m.UpBps,
            downTotal = _m.DayRecv,
            upTotal = _m.DaySent,
            adapter = _m.AdapterName,
            speed = _m.AdapterSpeed,
        });

        public string GetConnections() => System.Text.Json.JsonSerializer.Serialize(
            _m.Conns.Select(c => new { proc = c.Process, remote = c.Remote, port = c.Port }));

        public void Minimize() => _form.WindowState = FormWindowState.Minimized;
        public void ToggleMaximize() =>
            _form.WindowState = _form.WindowState == FormWindowState.Maximized
                ? FormWindowState.Normal : FormWindowState.Maximized;
        public void CloseToTray() => _form.WindowState = FormWindowState.Minimized;
        public bool IsNative => true;

        /* ---------- 在线更新 ---------- */
        public string UpdateStatus() => System.Text.Json.JsonSerializer.Serialize(new
        {
            current = _form._upd.CurrentVersion,
            state = _form._upd.State,
            message = _form._upd.Message,
            progress = _form._upd.Progress,
            isPortable = _form._upd.IsPortable,
            autoCheck = _form._upd.Settings.AutoCheck,
            latest = _form._upd.Latest == null ? null : new { ver = _form._upd.Latest.Version, notes = _form._upd.Latest.Notes },
        });
        public void CheckUpdate() => _ = _form._upd.CheckAsync();
        public void SetAutoUpdate(bool on) => _form._upd.SetAutoCheck(on);
        public void IgnoreUpdate() { if (_form._upd.Latest != null) _form._upd.IgnoreVersion(_form._upd.Latest.Version); }
        public void OpenReleasePage() => _form._upd.OpenReleasePage();
        public void InstallUpdate() => _ = _form.DownloadAndInstallAsync();
    }
}
