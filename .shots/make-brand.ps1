# Regenerates every brand asset from .shots/brand_src.png (536x399 bean art).
# Outputs:
#   public/favicon.png      64x64  square badge, real favicon size
#   public/icon-192.png    192x192  manifest icon
#   public/icon-512.png    512x512  manifest + apple-touch icon
#   public/logo.jpg       1200x630  og/twitter card — art centred on its own
#                                   pale-blue field (seamless extension)
#   icon.png (repo root)   512x512  legacy app icon — kept in sync
#   logo.png (repo root)   536x399  README header — the art as-is
# Usage: powershell -File .shots/make-brand.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$src = [System.Drawing.Bitmap]::FromFile((Join-Path $root '.shots/brand_src.png'))

function Save-Resize($img, $srcRect, $size, $out, $format) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.SmoothingMode = 'HighQuality'
  $g.PixelOffsetMode = 'HighQuality'
  $g.CompositingQuality = 'HighQuality'
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)), $srcRect, 'Pixel')
  $g.Dispose()
  $bmp.Save($out, $format)
  $bmp.Dispose()
  Write-Host "wrote $out ($size x $size)"
}

# --- square badge: full-height centre crop (fila to shoulders) ---
$side = $src.Height                       # 399
$x0 = [int](($src.Width - $side) / 2)     # 68
$badge = New-Object System.Drawing.Rectangle($x0, 0, $side, $side)

Save-Resize $src $badge 64  (Join-Path $root 'public/favicon.png')   ([System.Drawing.Imaging.ImageFormat]::Png)
Save-Resize $src $badge 192 (Join-Path $root 'public/icon-192.png')  ([System.Drawing.Imaging.ImageFormat]::Png)
Save-Resize $src $badge 512 (Join-Path $root 'public/icon-512.png')  ([System.Drawing.Imaging.ImageFormat]::Png)
Save-Resize $src $badge 512 (Join-Path $root 'icon.png')             ([System.Drawing.Imaging.ImageFormat]::Png)

# --- og card: 1200x630, art scaled to fill height on its sampled bg colour ---
$bg = $src.GetPixel(10, 10)
$card = New-Object System.Drawing.Bitmap(1200, 630)
$g = [System.Drawing.Graphics]::FromImage($card)
$g.Clear($bg)
$g.InterpolationMode = 'HighQualityBicubic'
$g.SmoothingMode = 'HighQuality'
$scale = 630.0 / $src.Height
$dw = [int]($src.Width * $scale)
$dx = [int]((1200 - $dw) / 2)
$g.DrawImage($src, $dx, 0, $dw, 630)
$g.Dispose()
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
  Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
  [System.Drawing.Imaging.Encoder]::Quality, [long]90)
$card.Save((Join-Path $root 'public/logo.jpg'), $enc, $ep)
$card.Dispose()
Write-Host 'wrote public/logo.jpg (1200 x 630)'

# --- README header: art unchanged, just re-homed as PNG ---
Copy-Item (Join-Path $root '.shots/brand_src.png') (Join-Path $root 'logo.png') -Force
Write-Host 'wrote logo.png (README)'

$src.Dispose()
