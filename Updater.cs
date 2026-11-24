using System.Diagnostics;
using System.Net.Http;
using System.Reflection;
using System.Text.Json;

namespace MNetPulse;

/// <summary>GitHub Releases 上的一次发布。</summary>
public sealed class ReleaseInfo
{
    public string TagName { get; set; } = "";
    public string Version { get; set; } = "";      // 去掉前导 v，如 1.2.0
    public string HtmlUrl { get; set; } = "";
    public string Notes { get; set; } = "";
    public string? SetupName { get; set; }
    public string? SetupUrl { get; set; }
}

/// <summary>更新设置（持久化在 %LocalAppData%\MNetPulse\update.json）。</summary>
public sealed class UpdateSettings
{
    public bool AutoCheck { get; set; } = true;
    public string IgnoredVersion { get; set; } = "";
}

/// <summary>
/// 基于 GitHub Releases 的在线更新：检查新版本、下载安装包、安装版静默升级。
/// 不引入第三方依赖，便于审计与离线环境使用。
/// </summary>
public sealed class Updater
{
    private const string Repo = "Super-Gouba/m-netpulse";

    private static readonly HttpClient Http = CreateHttp();

    private static HttpClient CreateHttp()
    {
        var h = new HttpClient { Timeout = TimeSpan.FromSeconds(25) };
        h.DefaultRequestHeaders.Add("User-Agent", "MNetPulse-Updater");
        h.DefaultRequestHeaders.Add("Accept", "application/vnd.github+json");
        return h;
    }

    public string CurrentVersion { get; }
    public bool IsPortable { get; }
    public ReleaseInfo? Latest { get; private set; }
    public UpdateSettings Settings { get; } = LoadSettings();

    /// <summary>idle | checking | same | newer | downloading | ready | error</summary>
    public string State { get; private set; } = "idle";
    public string Message { get; private set; } = "";
    public int Progress { get; private set; }

    public event Action? Changed;

    public Updater()
    {
        CurrentVersion =
            Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>()
                   ?.InformationalVersion ?? "1.2.0";

        string installedRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs", "MNetPulse");
        IsPortable = !AppContext.BaseDirectory.StartsWith(
            installedRoot, StringComparison.OrdinalIgnoreCase);
    }

    private void Set(string state, string message, int progress = 0)
    {
        State = state; Message = message; Progress = progress;
        Program.Log($"[更新] {state}: {message}");
        Changed?.Invoke();
    }

    /// <summary>供 UI 层直接设置状态（不触发下载/检查流程）。</summary>
    public void SetState(string state, string message, int progress = 0) => Set(state, message, progress);

    public void SetAutoCheck(bool on)
    {
        Settings.AutoCheck = on;
        SaveSettings();
    }

    public void IgnoreVersion(string version)
    {
        Settings.IgnoredVersion = version;
        SaveSettings();
        if (State == "newer") Set("same", $"已忽略 v{version}，下次检查不再提示");
    }

    public async Task CheckAsync(CancellationToken ct = default)
    {
        if (State is "checking" or "downloading") return;
        Set("checking", "正在检查更新…");
        try
        {
            string json = await Http.GetStringAsync(
                $"https://api.github.com/repos/{Repo}/releases/latest", ct);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            string tag = root.GetProperty("tag_name").GetString() ?? "";
            string ver = tag.TrimStart('v');

            var rel = new ReleaseInfo
            {
                TagName = tag,
                Version = ver,
                HtmlUrl = root.GetProperty("html_url").GetString() ?? "",
                Notes = root.TryGetProperty("body", out var b) ? b.GetString() ?? "" : "",
            };
            if (root.TryGetProperty("assets", out var assets))
            {
                foreach (var a in assets.EnumerateArray())
                {
                    string name = a.GetProperty("name").GetString() ?? "";
                    string url = a.GetProperty("browser_download_url").GetString() ?? "";
                    if (name.Contains("-Setup-", StringComparison.OrdinalIgnoreCase))
                    {
                        rel.SetupName = name; rel.SetupUrl = url;
                    }
                }
            }
            Latest = rel;

            if (!IsNewer(ver, CurrentVersion)) Set("same", $"已是最新版本 v{CurrentVersion}");
            else if (ver == Settings.IgnoredVersion) Set("same", $"已是最新（已忽略 v{ver}）");
            else Set("newer", $"发现新版本 v{ver}");
        }
        catch (OperationCanceledException)
        {
            Set("idle", "检查已取消");
        }
        catch (Exception ex)
        {
            Set("error", "检查失败: " + Short(ex.Message));
        }
    }

    /// <summary>供下载进度回调刷新界面，不改变状态机。</summary>
    public void ReportProgress(int percent)
    {
        Progress = Math.Clamp(percent, 0, 100);
        Changed?.Invoke();
    }

    /// <summary>下载最新版本的安装包到本地，返回完整路径。</summary>
    public async Task<string?> DownloadSetupAsync(IProgress<int>? prog = null, CancellationToken ct = default)
    {
        if (Latest?.SetupUrl is null || Latest.SetupName is null) return null;
        Set("downloading", "正在下载安装包…", 0);
        try
        {
            string dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "MNetPulse", "updates");
            Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, Latest.SetupName);

            using var resp = await Http.GetAsync(Latest.SetupUrl,
                HttpCompletionOption.ResponseHeadersRead, ct);
            resp.EnsureSuccessStatusCode();
            long total = resp.Content.Headers.ContentLength ?? -1L;

            await using var src = await resp.Content.ReadAsStreamAsync(ct);
            await using var fs = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None);
            var buf = new byte[81920];
            long read = 0; int tick = 0;
            while (true)
            {
                int n = await src.ReadAsync(buf, ct);
                if (n <= 0) break;
                await fs.WriteAsync(buf.AsMemory(0, n), ct);
                read += n;
                if (total > 0 && ++tick % 4 == 0)
                    prog?.Report((int)Math.Min(100, read * 100 / total));
            }
            prog?.Report(100);
            Set("ready", "安装包已就绪，等待安装");
            return path;
        }
        catch (Exception ex)
        {
            Set("error", "下载失败: " + Short(ex.Message));
            return null;
        }
    }

    /// <summary>
    /// 由延迟脚本在 2 秒后静默启动安装包，随后主程序退出。
    /// 直接启动会因 exe 仍被占用而安装失败，故采用“先排队、后退出”。
    /// </summary>
    public static void QueueSilentInstall(string setupPath)
    {
        string cmd = Path.Combine(Path.GetTempPath(),
            $"MNetPulse-update-{DateTime.Now:yyyyMMddHHmmss}.cmd");
        string quoted = setupPath.Replace("\\", "\\\\");
        File.WriteAllText(cmd,
            "@echo off\r\n" +
            "timeout /t 2 /nobreak >nul\r\n" +
            $"start \"\" \"{quoted}\" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CURRENTUSER\r\n");

        Program.Log("[更新] 排队静默安装: " + setupPath);
        Process.Start(new ProcessStartInfo("cmd.exe", "/c \"\"" + cmd + "\"\"")
        {
            CreateNoWindow = true,
            UseShellExecute = false,
        });
    }

    public void OpenReleasePage()
    {
        string url = Latest?.HtmlUrl ?? $"https://github.com/{Repo}/releases";
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch (Exception ex) { Program.Log("[更新] 打开页面失败: " + ex.Message); }
    }

    /// <summary>升级用的命名安装包名，供静默安装校验与日志使用。</summary>
    public static string ExpectedSetupName(string version) =>
        $"MNetPulse-Setup-{version}.exe";

    public static bool IsNewer(string candidate, string current)
    {
        int[] a = Parse(candidate), b = Parse(current);
        for (int i = 0; i < Math.Max(a.Length, b.Length); i++)
        {
            int x = i < a.Length ? a[i] : 0;
            int y = i < b.Length ? b[i] : 0;
            if (x != y) return x > y;
        }
        return false;
    }

    private static int[] Parse(string v) =>
        (v ?? "").Split('.', '-', '+').Select(s => int.TryParse(s, out var n) ? n : 0).ToArray();

    private static string Short(string s)
    {
        s = (s ?? "").Replace("\r", " ").Replace("\n", " ");
        return s.Length <= 160 ? s : s[..160] + "…";
    }

    // ---------- 设置持久化 ----------
    private static string SettingsPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "MNetPulse", "update.json");

    private static UpdateSettings LoadSettings()
    {
        try
        {
            string p = SettingsPath;
            if (!File.Exists(p)) return new UpdateSettings();
            return JsonSerializer.Deserialize<UpdateSettings>(File.ReadAllText(p)) ?? new UpdateSettings();
        }
        catch { return new UpdateSettings(); }
    }

    private void SaveSettings()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
            File.WriteAllText(SettingsPath,
                JsonSerializer.Serialize(Settings, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception ex) { Program.Log("[更新] 保存设置失败: " + ex.Message); }
    }
}
