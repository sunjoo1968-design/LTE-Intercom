$ErrorActionPreference = "Stop"

$ServerDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$DistRoot = Join-Path $ServerDir "dist"
$PortableDirName = if ($env:PORTABLE_DIR_NAME) { $env:PORTABLE_DIR_NAME } else { "LTE-Intercom-Server-Portable" }
$PortableDir = Join-Path $DistRoot $PortableDirName

if (Test-Path $PortableDir) {
    Remove-Item -LiteralPath $PortableDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $PortableDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PortableDir "tray") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PortableDir "admin") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PortableDir "icons") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PortableDir "config") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PortableDir "src") | Out-Null

& (Join-Path $PSScriptRoot "create-icons.ps1")

Push-Location $ServerDir
try {
    npx pkg portable-src/server.cjs --targets node18-win-x64 --output (Join-Path $PortableDir "LTE-Intercom-Server.exe")
    if ($LASTEXITCODE -ne 0) { throw "Failed to build server executable" }
    npx pkg portable-src/tray.cjs --targets node18-win-x64 --output (Join-Path $PortableDir "LTE-Intercom-Tray.exe")
    if ($LASTEXITCODE -ne 0) { throw "Failed to build tray executable" }
    npx pkg portable-src/admin.cjs --targets node18-win-x64 --output (Join-Path $PortableDir "LTE-Intercom-Admin.exe")
    if ($LASTEXITCODE -ne 0) { throw "Failed to build admin executable" }
    $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
    if (-not (Test-Path $csc)) {
        $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
    }
    if (-not (Test-Path $csc)) { throw "C# compiler not found for Windows launcher" }
    $launcherIcon = Join-Path $ServerDir "icons\launcher.ico"
    $launcherOut = Join-Path $PortableDir "LTE-Intercom-Launcher.exe"
    $launcherSource = Join-Path $ServerDir "portable-src\LauncherWin.cs"
    & $csc /nologo /target:winexe /platform:x64 "/win32icon:$launcherIcon" "/out:$launcherOut" "$launcherSource"
    if ($LASTEXITCODE -ne 0) { throw "Failed to build launcher executable" }
} finally {
    Pop-Location
}

Copy-Item -LiteralPath (Join-Path $ServerDir "tray\LTE-Intercom-Tray.ps1") -Destination (Join-Path $PortableDir "tray\LTE-Intercom-Tray.ps1")
Copy-Item -Path (Join-Path $ServerDir "src\*.js") -Destination (Join-Path $PortableDir "src")
Copy-Item -LiteralPath (Join-Path $ServerDir "start-tray.bat") -Destination (Join-Path $PortableDir "Start-Tray.bat")
Copy-Item -Path (Join-Path $ServerDir "icons\*.svg") -Destination (Join-Path $PortableDir "icons")
Copy-Item -Path (Join-Path $ServerDir "icons\*.ico") -Destination (Join-Path $PortableDir "icons")

Write-Host "ICO files copied. EXE resource icon embedding is skipped because rcedit corrupts pkg single-file executables."

$adminHtml = node -e "import('./src/admin.js').then((m)=>process.stdout.write(m.renderAdminPage()))"
$adminHtml | Set-Content -LiteralPath (Join-Path $PortableDir "admin\index.html") -Encoding UTF8

@"
LTE Intercom Server Portable

1. Run LTE-Intercom-Launcher.exe first.
2. The launcher starts the server, starts the tray controller, and opens the admin web page.
3. Android clients connect to:
   ws://SERVER_IP:8443/signal
4. Admin web:
   http://localhost:8443/admin

Executable roles:

- LTE-Intercom-Launcher.exe: first-run controller for operators.
- LTE-Intercom-Server.exe: intercom signaling/media relay server.
- LTE-Intercom-Tray.exe: Windows tray controller launcher.
- LTE-Intercom-Admin.exe: opens the admin web UI.

Notes:

- Keep this whole folder together.
- Use the tray menu to enable Start with Windows.
- Firewall must allow TCP 8443.
"@ | Set-Content -LiteralPath (Join-Path $PortableDir "README-FIRST.txt") -Encoding ASCII

Write-Host "Portable package created:"
Write-Host $PortableDir
