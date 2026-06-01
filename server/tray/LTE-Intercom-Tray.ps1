Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ConsoleWindow {
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$ErrorActionPreference = "Continue"

$consoleHandle = [ConsoleWindow]::GetConsoleWindow()
if ($consoleHandle -ne [IntPtr]::Zero) {
    [ConsoleWindow]::ShowWindow($consoleHandle, 0) | Out-Null
}

$createdMutex = $false
$Script:Mutex = New-Object System.Threading.Mutex($true, "LTEIntercomServerTrayV2", [ref]$createdMutex)
if (-not $createdMutex) {
    exit
}

$Script:ScriptPath = $PSCommandPath
$Script:TrayDir = Split-Path -Parent $Script:ScriptPath
$Script:ServerDir = Resolve-Path (Join-Path $Script:TrayDir "..")
$Script:LogDir = Join-Path $Script:ServerDir "logs"
$Script:TrayLog = Join-Path $Script:LogDir "tray.log"
$Script:ServerEntry = Join-Path $Script:ServerDir "src\index.js"
$Script:ServerExe = Join-Path $Script:ServerDir "LTE-Intercom-Server.exe"
$Script:TrayIconPath = Join-Path $Script:ServerDir "icons\tray.ico"
$Script:Port = if ($env:PORT) { $env:PORT } else { "8443" }
$Script:AdminUrl = "http://localhost:$Script:Port/admin"
$Script:ControlUrl = "http://127.0.0.1:$Script:Port"
$Script:ServerProcess = $null
$Script:StartupShortcut = Join-Path ([Environment]::GetFolderPath("Startup")) "LTE Intercom Server Tray.lnk"

if (-not (Test-Path $Script:LogDir)) {
    New-Item -ItemType Directory -Force -Path $Script:LogDir | Out-Null
}

function Write-TrayLog($message) {
    $line = "$(Get-Date -Format o) $message"
    Add-Content -LiteralPath $Script:TrayLog -Value $line
}

Write-TrayLog "Tray starting. script=$Script:ScriptPath serverDir=$Script:ServerDir port=$Script:Port"

function Test-ServerOnline {
    try {
        $response = Invoke-RestMethod -Uri "$Script:ControlUrl/health" -TimeoutSec 1
        return $response.status -eq "ok"
    } catch {
        return $false
    }
}

function Start-IntercomServer {
    if (Test-ServerOnline) {
        Set-Status "Server already running"
        Write-TrayLog "Server already running"
        return
    }

    if (Test-Path $Script:ServerExe) {
        Write-TrayLog "Starting portable server exe: $Script:ServerExe"
        $Script:ServerProcess = Start-Process `
            -FilePath $Script:ServerExe `
            -WorkingDirectory $Script:ServerDir `
            -WindowStyle Hidden `
            -PassThru
    } else {
        Write-TrayLog "Starting node server entry: $Script:ServerEntry"
        $Script:ServerProcess = Start-Process `
            -FilePath "node" `
            -ArgumentList "`"$Script:ServerEntry`"" `
            -WorkingDirectory $Script:ServerDir `
            -WindowStyle Hidden `
            -PassThru
    }

    Start-Sleep -Milliseconds 800
    if (Test-ServerOnline) {
        Set-Status "Server started"
        Write-TrayLog "Server started"
    } else {
        Set-Status "Server start requested"
        Write-TrayLog "Server start requested but health check is not online yet"
    }
}

function Stop-IntercomServer {
    if (Test-ServerOnline) {
        try {
            Invoke-RestMethod `
                -Method Post `
                -Uri "$Script:ControlUrl/admin/server/shutdown" `
                -ContentType "application/json" `
                -Body "{}" `
                -TimeoutSec 1 | Out-Null
        } catch {
        }
    }

    if ($Script:ServerProcess -and -not $Script:ServerProcess.HasExited) {
        Stop-Process -Id $Script:ServerProcess.Id -Force
    }
    Set-Status "Server shutdown requested"
}

function Restart-IntercomServer {
    if (Test-ServerOnline) {
        try {
            Invoke-RestMethod `
                -Method Post `
                -Uri "$Script:ControlUrl/admin/server/restart" `
                -ContentType "application/json" `
                -Body "{}" `
                -TimeoutSec 1 | Out-Null
            Set-Status "Server restart requested"
            return
        } catch {
        }
    }

    Start-IntercomServer
}

function Open-AdminWeb {
    Start-IntercomServer
    Start-Process $Script:AdminUrl
    Set-Status "Admin web opened"
}

function Enable-Startup {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Script:StartupShortcut)
    $shortcut.TargetPath = "powershell.exe"
    $shortcut.Arguments = "-STA -NoProfile -ExecutionPolicy Bypass -File `"$Script:ScriptPath`""
    $shortcut.WorkingDirectory = $Script:ServerDir
    $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,220"
    if (Test-Path $Script:TrayIconPath) {
        $shortcut.IconLocation = $Script:TrayIconPath
    }
    $shortcut.Description = "LTE Intercom Server Tray"
    $shortcut.Save()
    Set-Status "Windows startup enabled"
}

function Disable-Startup {
    if (Test-Path $Script:StartupShortcut) {
        Remove-Item -LiteralPath $Script:StartupShortcut -Force
    }
    Set-Status "Windows startup disabled"
}

function Test-StartupEnabled {
    return Test-Path $Script:StartupShortcut
}

function Toggle-Startup {
    if (Test-StartupEnabled) {
        Disable-Startup
    } else {
        Enable-Startup
    }
    Update-TrayState
}

function Set-Status($message) {
    $Script:LastStatus = $message
    if ($Script:NotifyIcon) {
        $Script:NotifyIcon.BalloonTipTitle = "LTE Intercom Server"
        $Script:NotifyIcon.BalloonTipText = $message
        $Script:NotifyIcon.ShowBalloonTip(800)
    }
}

function Update-TrayState {
    $online = Test-ServerOnline
    $startup = Test-StartupEnabled
    $Script:StartupItem.Checked = $startup

    if ($online) {
        $Script:StatusItem.Text = "Status: Online"
        $Script:NotifyIcon.Text = "LTE Intercom Server - Online"
    } else {
        $Script:StatusItem.Text = "Status: Offline"
        $Script:NotifyIcon.Text = "LTE Intercom Server - Offline"
    }
}

function Exit-TrayKeepServer {
    $Script:Timer.Stop()
    $Script:NotifyIcon.Visible = $false
    $Script:NotifyIcon.Dispose()
    if ($Script:Mutex) {
        $Script:Mutex.ReleaseMutex()
        $Script:Mutex.Dispose()
    }
    $Script:Form.Close()
}

function Exit-TrayShutdownServer {
    Stop-IntercomServer
    Start-Sleep -Milliseconds 500
    Exit-TrayKeepServer
}

$Script:Form = New-Object System.Windows.Forms.Form
$Script:Form.ShowInTaskbar = $false
$Script:Form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
$Script:Form.Add_Shown({ $Script:Form.Hide() })

$Script:Menu = New-Object System.Windows.Forms.ContextMenuStrip
$Script:StatusItem = New-Object System.Windows.Forms.ToolStripMenuItem("Status: Checking")
$Script:StatusItem.Enabled = $false
$OpenItem = New-Object System.Windows.Forms.ToolStripMenuItem("Open Admin Web")
$StartItem = New-Object System.Windows.Forms.ToolStripMenuItem("Start Server")
$RestartItem = New-Object System.Windows.Forms.ToolStripMenuItem("Restart Server")
$ShutdownItem = New-Object System.Windows.Forms.ToolStripMenuItem("Shutdown Server")
$Script:StartupItem = New-Object System.Windows.Forms.ToolStripMenuItem("Start with Windows")
$Script:StartupItem.CheckOnClick = $false
$ExitKeepItem = New-Object System.Windows.Forms.ToolStripMenuItem("Exit Tray - Keep Server")
$ExitShutdownItem = New-Object System.Windows.Forms.ToolStripMenuItem("Exit Tray - Shutdown Server")

$OpenItem.Add_Click({ Open-AdminWeb })
$StartItem.Add_Click({ Start-IntercomServer })
$RestartItem.Add_Click({ Restart-IntercomServer })
$ShutdownItem.Add_Click({ Stop-IntercomServer })
$Script:StartupItem.Add_Click({ Toggle-Startup })
$ExitKeepItem.Add_Click({ Exit-TrayKeepServer })
$ExitShutdownItem.Add_Click({ Exit-TrayShutdownServer })

[void]$Script:Menu.Items.Add($Script:StatusItem)
[void]$Script:Menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$Script:Menu.Items.Add($OpenItem)
[void]$Script:Menu.Items.Add($StartItem)
[void]$Script:Menu.Items.Add($RestartItem)
[void]$Script:Menu.Items.Add($ShutdownItem)
[void]$Script:Menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$Script:Menu.Items.Add($Script:StartupItem)
[void]$Script:Menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$Script:Menu.Items.Add($ExitKeepItem)
[void]$Script:Menu.Items.Add($ExitShutdownItem)

$Script:NotifyIcon = New-Object System.Windows.Forms.NotifyIcon
if (Test-Path $Script:TrayIconPath) {
    $Script:NotifyIcon.Icon = New-Object System.Drawing.Icon -ArgumentList $Script:TrayIconPath
} else {
    $Script:NotifyIcon.Icon = [System.Drawing.SystemIcons]::Application
}
$Script:NotifyIcon.ContextMenuStrip = $Script:Menu
$Script:NotifyIcon.Text = "LTE Intercom Server"
$Script:NotifyIcon.Visible = $true
$Script:NotifyIcon.Add_DoubleClick({ Open-AdminWeb })
Write-TrayLog "NotifyIcon visible"

$Script:Timer = New-Object System.Windows.Forms.Timer
$Script:Timer.Interval = 5000
$Script:Timer.Add_Tick({ Update-TrayState })
$Script:Timer.Start()

Start-IntercomServer
Update-TrayState

[System.Windows.Forms.Application]::Run($Script:Form)
