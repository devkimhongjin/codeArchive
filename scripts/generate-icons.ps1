# Convert the supplied branding asset to platform icon sizes without changing its design.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$repoRoot = Split-Path $PSScriptRoot -Parent
$source = [System.Drawing.Image]::FromFile((Join-Path $repoRoot 'shared/branding/codearchive.png'))
$extensionIcons = Join-Path $repoRoot 'apps/extension/icons'
$desktopAssets = Join-Path $repoRoot 'apps/desktop/src'
New-Item -ItemType Directory -Path $extensionIcons -Force | Out-Null

function Get-IconPng([int]$size) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $stream = [System.IO.MemoryStream]::new()
    try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $ratio = $size / [double][Math]::Max($source.Width, $source.Height)
        $width = [single]($source.Width * $ratio)
        $height = [single]($source.Height * $ratio)
        $graphics.DrawImage($source, [single](($size - $width) / 2), [single](($size - $height) / 2), $width, $height)
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        return ,$stream.ToArray()
    } finally { $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
}

try {
    foreach ($size in @(16, 32, 48, 128)) {
        [System.IO.File]::WriteAllBytes((Join-Path $extensionIcons "icon-$size.png"), (Get-IconPng $size))
    }
    [System.IO.File]::WriteAllBytes((Join-Path $desktopAssets 'icon.png'), (Get-IconPng 256))
    [System.IO.File]::WriteAllBytes((Join-Path $desktopAssets 'tray.png'), (Get-IconPng 32))
    $sizes = @(16, 24, 32, 48, 64, 128, 256)
    $frames = @($sizes | ForEach-Object { ,(Get-IconPng $_) })
    $stream = [System.IO.MemoryStream]::new()
    $writer = [System.IO.BinaryWriter]::new($stream)
    try {
        $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
        $offset = 6 + 16 * $sizes.Count
        for ($index = 0; $index -lt $sizes.Count; $index++) {
            $dimension = if ($sizes[$index] -eq 256) { 0 } else { $sizes[$index] }
            $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
            $writer.Write([byte]0); $writer.Write([byte]0)
            $writer.Write([uint16]1); $writer.Write([uint16]32)
            $writer.Write([uint32]$frames[$index].Length); $writer.Write([uint32]$offset)
            $offset += $frames[$index].Length
        }
        foreach ($frame in $frames) { $writer.Write([byte[]]$frame) }
        [System.IO.File]::WriteAllBytes((Join-Path $desktopAssets 'icon.ico'), $stream.ToArray())
    } finally { $writer.Dispose(); $stream.Dispose() }
} finally { $source.Dispose() }
Write-Output 'Generated extension PNG icons and desktop PNG/ICO icons.'
