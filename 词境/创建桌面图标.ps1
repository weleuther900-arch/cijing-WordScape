$ErrorActionPreference = "Stop"

$appDirectory = $PSScriptRoot
$startScript = Join-Path $appDirectory "start.ps1"
if (-not (Test-Path -LiteralPath $startScript)) {
  throw "未找到词境启动脚本。"
}

$iconPath = Join-Path $appDirectory "assets\wordscape-icon.ico"
if (-not (Test-Path -LiteralPath $iconPath)) {
  & (Join-Path $appDirectory "scripts\create-desktop-icon.ps1") -OutputPath $iconPath
}
if (-not (Test-Path -LiteralPath $iconPath)) {
  throw "未能创建词境图标。"
}

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutTitle = ([string][char]0x8BCD) + ([string][char]0x5883)
$shortcutPath = Join-Path $desktop "$shortcutTitle.lnk"
$previousShortcut = Join-Path $desktop "WordScape.lnk"
if ($previousShortcut -ne $shortcutPath -and (Test-Path -LiteralPath $previousShortcut)) {
  Remove-Item -LiteralPath $previousShortcut -Force
}
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = (Join-Path $PSHOME "powershell.exe")
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`""
$shortcut.WorkingDirectory = $appDirectory
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = $shortcutTitle
$shortcut.Save()

Write-Host "Desktop shortcut created: $shortcutPath" -ForegroundColor Green
