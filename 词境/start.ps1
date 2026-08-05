$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js 20 or newer is required. Download it from https://nodejs.org/" -ForegroundColor Yellow
  exit 1
}

$port = if ($env:WORDSCAPE_PORT) { [int]$env:WORDSCAPE_PORT } else { 4173 }
if (-not (Test-Path (Join-Path $PSScriptRoot "node_modules"))) {
  Write-Host "First launch: installing dependencies..." -ForegroundColor Cyan
  npm.cmd install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not (Test-Path (Join-Path $PSScriptRoot "data\offline-dictionary.json"))) {
  Write-Host "First launch: installing the MIT-licensed offline dictionary..." -ForegroundColor Cyan
  npm.cmd run dictionary:install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$running = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $running) {
  New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot "data") | Out-Null
  Start-Process -FilePath "node.exe" -ArgumentList "server.js" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot "data\server.stdout.log") -RedirectStandardError (Join-Path $PSScriptRoot "data\server.stderr.log")
  Start-Sleep -Seconds 2
}

$url = "http://127.0.0.1:$port/"
Start-Process $url
Write-Host "词境已在后台启动：$url" -ForegroundColor Green
