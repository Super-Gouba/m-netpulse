using System.Reflection;

namespace MNetPulse;

internal static class Program
{
    public static string LogPath { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "MNetPulse", "startup.log");

    public static void Log(string msg)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
            File.AppendAllText(LogPath,
                $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {msg}\n");
        }
        catch { }
    }

    [STAThread]
    private static void Main()
    {
        try { File.Delete(LogPath); } catch { }
        Log($"启动: exe={Assembly.GetExecutingAssembly().Location}");

        // 全局异常捕获 — 写日志并弹窗，避免静默崩溃
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            Log("未处理异常: " + e.ExceptionObject);
            try
            {
                MessageBox.Show(e.ExceptionObject.ToString(), "M-NetPulse 启动错误",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            catch { }
        };
        Application.ThreadException += (_, e) =>
        {
            Log("UI线程异常: " + e.Exception);
            MessageBox.Show(e.Exception.ToString(), "M-NetPulse 错误",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        };

        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}
