$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$IconDir = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")) "icons"
New-Item -ItemType Directory -Force -Path $IconDir | Out-Null

function New-Ico($name, $accent, $kind) {
    $bitmap = New-Object System.Drawing.Bitmap 256, 256
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::FromArgb(7, 9, 12))

    $panelBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(18, 23, 29))
    $linePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(47, 58, 70), 8)
    $accentBrush = New-Object System.Drawing.SolidBrush $accent
    $whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(244, 247, 251))

    $path = New-RoundedRectPath 42 54 172 128 18
    $graphics.FillPath($panelBrush, $path)
    $graphics.DrawPath($linePen, $path)

    if ($kind -eq "server") {
        foreach ($y in @(78, 118, 158)) {
            $graphics.FillRectangle($accentBrush, 72, $y, 24, 12)
            $graphics.FillRectangle($whiteBrush, 110, $y, 70, 12)
        }
    } elseif ($kind -eq "tray") {
        $graphics.FillEllipse($accentBrush, 86, 82, 84, 84)
        $font = New-Object System.Drawing.Font "Arial", 44, ([System.Drawing.FontStyle]::Bold)
        $graphics.DrawString("T", $font, $whiteBrush, 102, 92)
    } elseif ($kind -eq "admin") {
        $graphics.FillRectangle($accentBrush, 70, 82, 116, 16)
        $graphics.FillEllipse($accentBrush, 78, 122, 34, 34)
        $graphics.FillEllipse($whiteBrush, 144, 122, 34, 34)
    } else {
        $graphics.FillEllipse($accentBrush, 66, 92, 40, 40)
        $graphics.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(86, 163, 255))), 108, 92, 40, 40)
        $graphics.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(239, 63, 69))), 150, 92, 40, 40)
    }

    $pngStream = New-Object System.IO.MemoryStream
    $bitmap.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
    $png = $pngStream.ToArray()
    $icoPath = Join-Path $IconDir "$name.ico"
    $file = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
    $writer = New-Object System.IO.BinaryWriter $file
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]1)
    $writer.Write([Byte]0)
    $writer.Write([Byte]0)
    $writer.Write([Byte]0)
    $writer.Write([Byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$png.Length)
    $writer.Write([UInt32]22)
    $writer.Write($png)
    $writer.Close()
    $file.Close()
    $graphics.Dispose()
    $bitmap.Dispose()
}

function New-RoundedRectPath($x, $y, $w, $h, $r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

New-Ico "launcher" ([System.Drawing.Color]::FromArgb(35, 193, 107)) "launcher"
New-Ico "server" ([System.Drawing.Color]::FromArgb(86, 163, 255)) "server"
New-Ico "tray" ([System.Drawing.Color]::FromArgb(35, 193, 107)) "tray"
New-Ico "admin" ([System.Drawing.Color]::FromArgb(245, 185, 66)) "admin"

Write-Host "ICO files created in $IconDir"
