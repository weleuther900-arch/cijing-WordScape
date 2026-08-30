$ErrorActionPreference = "Stop"

$appDirectory = $PSScriptRoot
$launcherScript = Join-Path $appDirectory "launch.vbs"
if (-not (Test-Path -LiteralPath $launcherScript)) {
  throw "WordScape desktop launcher was not found."
}

$iconPath = Join-Path $appDirectory "assets\wordscape-icon.ico"
if (-not (Test-Path -LiteralPath $iconPath)) {
  & (Join-Path $appDirectory "scripts\create-desktop-icon.ps1") -OutputPath $iconPath
}
if (-not (Test-Path -LiteralPath $iconPath)) {
  throw "WordScape icon could not be created."
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
$shortcut.TargetPath = (Join-Path $env:WINDIR "System32\wscript.exe")
$shortcut.Arguments = "`"$launcherScript`""
$shortcut.WorkingDirectory = $appDirectory
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = $shortcutTitle
$shortcut.Save()

Write-Host "Desktop shortcut created: $shortcutPath" -ForegroundColor Green
