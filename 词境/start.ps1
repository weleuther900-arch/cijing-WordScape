$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js 20 or newer is required. Download it from https://nodejs.org/" -ForegroundColor Yellow
  exit 1
}

$port = if ($env:WORDSCAPE_PORT) { [int]$env:WORDSCAPE_PORT } else { 4174 }

function Test-WordScapeHealth {
  param([int]$CandidatePort)

  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$CandidatePort/api/health" -TimeoutSec 1
    return $health.ok -eq $true -and $health.storage -eq "local"
  } catch {
    return $false
  }
}

function Find-WordScapeBrowser {
  $browsers = @(
    @{ Process = "chrome"; Argument = "--new-window"; Paths = @("$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe", "C:\Program Files\Google\Chrome\Application\chrome.exe", "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe") },
    @{ Process = "msedge"; Argument = "--new-window"; Paths = @("C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "C:\Program Files\Microsoft\Edge\Application\msedge.exe") },
    @{ Process = "firefox"; Argument = "-new-window"; Paths = @("C:\Program Files\Mozilla Firefox\firefox.exe", "C:\Program Files (x86)\Mozilla Firefox\firefox.exe") }
  )

  # Prefer a browser that is already running, but always request a new window.
  # Do not read Path from every Chrome process: that gets slow when many tabs
  # are open and is unnecessary because the candidate executable paths are known.
  foreach ($browser in $browsers) {
    $running = Get-Process -Name $browser.Process -ErrorAction SilentlyContinue | Select-Object -First 1
    $path = $browser.Paths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($running -and $path) { return @{ Path = $path; Argument = $browser.Argument } }
  }
  foreach ($browser in $browsers) {
    $path = $browser.Paths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($path) { return @{ Path = $path; Argument = $browser.Argument } }
  }
  return $null
}

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

$healthy = Test-WordScapeHealth $port
if (-not $healthy) {
  New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot "data") | Out-Null
  $env:WORDSCAPE_PORT = "$port"
  Start-Process -FilePath "node.exe" -ArgumentList "server.js" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot "data\server.stdout.log") -RedirectStandardError (Join-Path $PSScriptRoot "data\server.stderr.log")
  for ($attempt = 0; $attempt -lt 12; $attempt += 1) {
    if (Test-WordScapeHealth $port) {
      $healthy = $true
      break
    }
    Start-Sleep -Milliseconds 250
  }
}

if (-not $healthy) {
  Write-Host "The local WordScape server could not start, or port $port is occupied. Check data\server.stderr.log." -ForegroundColor Yellow
  exit 1
}

$url = "http://127.0.0.1:$port/"
$browser = Find-WordScapeBrowser
if ($browser) {
  Start-Process -FilePath $browser.Path -ArgumentList @($browser.Argument, $url)
  Write-Host "WordScape opened in a new browser window: $url" -ForegroundColor Green
} else {
  Start-Process $url
  Write-Host "WordScape is running: $url" -ForegroundColor Green
}
