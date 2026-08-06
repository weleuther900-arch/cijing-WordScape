<#!
  词境 · WordScape 一行安装器
  下载当前公开版本到用户本机、创建桌面图标并启动应用。
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$repositoryArchive = "https://github.com/weleuther900-arch/cijing-WordScape/archive/refs/heads/main.zip"
$installRoot = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "词境"
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("cijing-install-" + [guid]::NewGuid().ToString("N"))

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "词境需要 Node.js 20 或更新版本。请先安装：https://nodejs.org/" -ForegroundColor Yellow
  exit 1
}

if (Test-Path -LiteralPath (Join-Path $installRoot "start.ps1")) {
  Write-Host "已找到本机的词境，正在打开。" -ForegroundColor Cyan
  & (Join-Path $installRoot "创建桌面图标.ps1")
  & (Join-Path $installRoot "start.ps1")
  exit $LASTEXITCODE
}

if (Test-Path -LiteralPath $installRoot) {
  throw "安装目录已存在，但没有找到完整的词境。为避免覆盖本地数据，安装已停止。"
}

try {
  New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
  $archivePath = Join-Path $temporaryRoot "source.zip"
  Write-Host "正在下载词境…" -ForegroundColor Cyan
  Invoke-WebRequest -Uri $repositoryArchive -OutFile $archivePath
  Expand-Archive -LiteralPath $archivePath -DestinationPath $temporaryRoot -Force

  $sourceRoot = Get-ChildItem -LiteralPath $temporaryRoot -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "词境\start.ps1") } | Select-Object -First 1
  if (-not $sourceRoot) { throw "下载的项目中没有找到词境启动文件。" }

  New-Item -ItemType Directory -Path (Split-Path -Parent $installRoot) -Force | Out-Null
  Move-Item -LiteralPath (Join-Path $sourceRoot.FullName "词境") -Destination $installRoot
  & (Join-Path $installRoot "创建桌面图标.ps1")
  & (Join-Path $installRoot "start.ps1")
} finally {
  if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
}
