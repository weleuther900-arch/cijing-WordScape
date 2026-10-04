param(
  [int]$RetryMinutes = 15
)

# Keeps the Codex-only continuation alive across temporary usage-limit windows.
# Every generator invocation preserves completed batch files before returning.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$continuation = Join-Path $PSScriptRoot 'continue-semantic-sense-coverage-codex.ps1'
$log = Join-Path $root 'data\semantic-sense-coverage-codex-continuation.log'

function Note([string]$message) {
  Add-Content -LiteralPath $log -Value "$(Get-Date -Format s) $message" -Encoding utf8
}

Push-Location $root
try {
  while ($true) {
    Note 'quota-aware supervisor: starting continuation from preserved drafts'
    & pwsh -NoLogo -NoProfile -File $continuation
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) {
      Note 'quota-aware supervisor: continuation completed successfully'
      exit 0
    }

    $tail = (Get-Content -LiteralPath $log -Tail 40 -ErrorAction SilentlyContinue) -join "`n"
    if ($tail -match '(?i)usage limit|try again at|credits') {
      Note "quota-aware supervisor: external Codex limit detected; waiting $RetryMinutes minutes"
      Start-Sleep -Seconds ($RetryMinutes * 60)
      continue
    }

    Note "quota-aware supervisor: continuation stopped with exit code $exitCode; preserving drafts"
    exit $exitCode
  }
}
finally {
  Pop-Location
}
