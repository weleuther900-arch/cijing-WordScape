param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$size = 128
$bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.Color]::Transparent)

$surface = [System.Drawing.Drawing2D.GraphicsPath]::new()
$inset = 9
$diameter = 30
$surface.AddArc($inset, $inset, $diameter, $diameter, 180, 90)
$surface.AddArc($size - $inset - $diameter, $inset, $diameter, $diameter, 270, 90)
$surface.AddArc($size - $inset - $diameter, $size - $inset - $diameter, $diameter, $diameter, 0, 90)
$surface.AddArc($inset, $size - $inset - $diameter, $diameter, $diameter, 90, 90)
$surface.CloseFigure()

$surfaceBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#F5F5F7"))
$outlinePen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml("#D2D2D7"), 2)
$letterBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#1D1D1F"))
$font = [System.Drawing.Font]::new("Georgia", 71, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center

$graphics.FillPath($surfaceBrush, $surface)
$graphics.DrawPath($outlinePen, $surface)
$graphics.DrawString("W", $font, $letterBrush, [System.Drawing.RectangleF]::new(0, -6, $size, $size), $format)

$rectangle = [System.Drawing.Rectangle]::new(0, 0, $size, $size)
$lockData = $bitmap.LockBits($rectangle, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$pixelBytes = [byte[]]::new($lockData.Stride * $size)
[System.Runtime.InteropServices.Marshal]::Copy($lockData.Scan0, $pixelBytes, 0, $pixelBytes.Length)
$bitmap.UnlockBits($lockData)

$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$xorBytes = $size * $size * 4
$andStride = [int]([Math]::Ceiling($size / 32.0) * 4)
$andBytes = $andStride * $size
$payloadBytes = 40 + $xorBytes + $andBytes
$fileStream = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
$writer = [System.IO.BinaryWriter]::new($fileStream)

$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([Byte]$size)
$writer.Write([Byte]$size)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$payloadBytes)
$writer.Write([UInt32]22)

$writer.Write([UInt32]40)
$writer.Write([Int32]$size)
$writer.Write([Int32]($size * 2))
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]0)
$writer.Write([UInt32]$xorBytes)
$writer.Write([Int32]0)
$writer.Write([Int32]0)
$writer.Write([UInt32]0)
$writer.Write([UInt32]0)
for ($row = $size - 1; $row -ge 0; $row--) {
  $writer.Write($pixelBytes, $row * $lockData.Stride, $size * 4)
}
$writer.Write([byte[]]::new($andBytes))

$writer.Close()
$format.Dispose()
$font.Dispose()
$letterBrush.Dispose()
$outlinePen.Dispose()
$surfaceBrush.Dispose()
$surface.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
