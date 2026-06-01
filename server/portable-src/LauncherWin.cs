using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;

internal static class LauncherWin
{
    private static readonly string BaseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    private static readonly string Port = Environment.GetEnvironmentVariable("PORT") ?? "8443";
    private static readonly string ServerExe = Path.Combine(BaseDir, "LTE-Intercom-Server.exe");
    private static readonly string AdminExe = Path.Combine(BaseDir, "LTE-Intercom-Admin.exe");
    private static readonly string TrayScript = Path.Combine(BaseDir, "tray", "LTE-Intercom-Tray.ps1");
    private static readonly string PowerShell = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.Windows),
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe"
    );
    private static readonly string LogDir = Path.Combine(BaseDir, "logs");

    [STAThread]
    private static void Main()
    {
        Directory.CreateDirectory(LogDir);
        Log("launcher started");

        if (!IsServerOnline())
        {
            StartHidden(ServerExe, "", BaseDir);
            WaitForServer();
        }

        StartHidden(
            PowerShell,
            "-STA -NoProfile -ExecutionPolicy Bypass -File \"" + TrayScript + "\"",
            BaseDir
        );
        StartHidden(AdminExe, "", BaseDir);
    }

    private static void StartHidden(string fileName, string arguments, string workingDirectory)
    {
        try
        {
            var info = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                WorkingDirectory = workingDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            Process.Start(info);
            Log("started " + fileName);
        }
        catch (Exception error)
        {
            Log("start failed " + fileName + " " + error.Message);
        }
    }

    private static bool IsServerOnline()
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Port + "/health");
            request.Timeout = 800;
            using (var response = (HttpWebResponse)request.GetResponse())
            {
                return response.StatusCode == HttpStatusCode.OK;
            }
        }
        catch
        {
            return false;
        }
    }

    private static void WaitForServer()
    {
        for (var attempt = 0; attempt < 20; attempt += 1)
        {
            if (IsServerOnline()) return;
            Thread.Sleep(250);
        }
    }

    private static void Log(string message)
    {
        try
        {
            File.AppendAllText(
                Path.Combine(LogDir, "launcher.log"),
                DateTime.Now.ToString("o") + " " + message + Environment.NewLine
            );
        }
        catch
        {
        }
    }
}
