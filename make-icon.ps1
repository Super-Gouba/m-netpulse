// 生成简单应用图标（绿色脉冲波形）
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(256, 256)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)
# 背景圆角方块
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point(0,0)), (New-Object System.Drawing.Point(0,256)),
  [System.Drawing.Color]::FromArgb(255,16,24,39), [System.Drawing.Color]::FromArgb(255,6,10,18))
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 56; $w = 256; $h = 256
$path.AddArc(0,0,$r,$r,180,90); $path.AddArc($w-$r,0,$r,$r,270,90)
$path.AddArc($w-$r,$h-$r,$r,$r,0,90); $path.AddArc(0,$h-$r,$r,$r,90,90)
$path.CloseFigure()
$g.FillPath($bgBrush, $path)
# 脉冲波形
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255,34,211,165), 16)
$pen.StartCap = 'Round'; $pen.EndCap = 'Round'; $pen.LineJoin = 'Round'
$pts = @(
  (New-Object System.Drawing.Point(28,128)),
  (New-Object System.Drawing.Point(80,128)),
  (New-Object System.Drawing.Point(108,60)),
  (New-Object System.Drawing.Point(148,196)),
  (New-Object System.Drawing.Point(172,128)),
  (New-Object System.Drawing.Point(228,128))
)
$g.DrawLines($pen, $pts)
$g.Dispose()
$bmp.Save("$PSScriptRoot\app_256.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

# PNG → ICO（多尺寸打包，用 Icon 写入 256px 帧）
Add-Type -TypeDefinition @'
using System;
using System.IO;
public static class IcoWriter {
  public static void Write(string pngPath, string icoPath) {
    byte[] png = File.ReadAllBytes(pngPath);
    using (var fs = new FileStream(icoPath, FileMode.Create)) {
      fs.Write(new byte[] {0,0}, 0, 2);          // reserved
      fs.Write(new byte[] {1,0}, 0, 2);          // type = icon
      fs.Write(new byte[] {1,0}, 0, 2);          // count = 1
      // directory entry
      fs.WriteByte(0); fs.WriteByte(0);          // width/height 0 = 256
      fs.WriteByte(0); fs.WriteByte(0);          // colors, reserved
      fs.Write(new byte[] {0,0}, 0, 2);          // planes
      fs.Write(new byte[] {32,0}, 0, 2);         // bpp
      byte[] size = BitConverter.GetBytes((uint)png.Length);
      fs.Write(size, 0, 4);
      fs.Write(BitConverter.GetBytes((uint)22), 0, 4);
      fs.Write(png, 0, png.Length);
    }
  }
}
'@
[IcoWriter]::Write("$PSScriptRoot\app_256.png", "$PSScriptRoot\app.ico")
Remove-Item "$PSScriptRoot\app_256.png"
Write-Host "OK: app.ico"
