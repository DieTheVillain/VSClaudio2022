# Draws the VSClaudio tool window icon: an orange eight-ray starburst on a transparent background.
# Each size is drawn at 8x and scaled down so the rays stay smooth at 16 px.
# Run from any folder: powershell -NoProfile -ExecutionPolicy Bypass -File vsix\Resources\MakeIcon.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$color = [System.Drawing.ColorTranslator]::FromHtml('#d97757')
# Ray lengths as a fraction of the available radius, clockwise from the top. Slightly uneven on purpose.
$lengths = @(1.00, 0.80, 0.94, 0.76, 0.98, 0.84, 0.90, 0.78)

function New-Icon([int]$size, [string]$path) {
    $scale = 8
    $big = $size * $scale
    $src = New-Object System.Drawing.Bitmap $big, $big, ([System.Drawing.Imaging.PixelFormat]::Format32bppPArgb)
    $g = [System.Drawing.Graphics]::FromImage($src)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $center = $big / 2.0
    $width = $big * 0.13
    $reach = $center - $width / 2.0 - $big * 0.02
    $pen = New-Object System.Drawing.Pen $color, $width
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    for ($i = 0; $i -lt 8; $i++) {
        $angle = ($i * 45 - 90) * [Math]::PI / 180
        $len = $reach * $lengths[$i]
        $x = $center + [Math]::Cos($angle) * $len
        $y = $center + [Math]::Sin($angle) * $len
        $g.DrawLine($pen, [single]$center, [single]$center, [single]$x, [single]$y)
    }
    $pen.Dispose()
    $g.Dispose()

    $dst = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dst)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $size, $size))
    $g.Dispose()
    $src.Dispose()

    $dst.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $dst.Dispose()
    Write-Host "Wrote $path"
}

New-Icon 16 (Join-Path $PSScriptRoot 'VSClaudio16.png')
New-Icon 32 (Join-Path $PSScriptRoot 'VSClaudio32.png')
