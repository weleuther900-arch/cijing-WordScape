param(
  [int]$InitialGeneratorProcessId = 0,
  [int]$MaximumPasses = 20
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = 'E:\node\node.exe'
$runnerLog = Join-Path $root 'data\semantic-sense-coverage-continuation.log'

function Write-ProgressLine([string]$message) {
  Add-Content -LiteralPath $runnerLog -Value "$(Get-Date -Format s) $message" -Encoding utf8
}

if ($InitialGeneratorProcessId -gt 0) {
  $initial = Get-Process -Id $InitialGeneratorProcessId -ErrorAction SilentlyContinue
  if ($initial) {
    Write-ProgressLine "waiting for initial generator $InitialGeneratorProcessId"
    Wait-Process -Id $InitialGeneratorProcessId
  }
}

Push-Location $root
try {
  for ($pass = 1; $pass -le $MaximumPasses; $pass += 1) {
    Write-ProgressLine "generation pass $pass started"
    & $node .\scripts\generate-semantic-sense-coverage.js --limit-words 6000 --batch-size 3 --model gpt-5.6-terra *>> $runnerLog
    Write-ProgressLine "generation pass $pass exited $LASTEXITCODE"

    & $node .\scripts\compose-semantic-sense-coverage.js *>> $runnerLog
    if ($LASTEXITCODE -ne 0) {
      Write-ProgressLine "coverage remains incomplete after pass $pass"
      Start-Sleep -Seconds 15
      continue
    }

    & python .\scripts\split-example-library.py *>> $runnerLog
    if ($LASTEXITCODE -ne 0) { throw 'example shard build failed' }
    & npm.cmd run content:verify *>> $runnerLog
    if ($LASTEXITCODE -ne 0) { throw 'content verification failed' }
    & python .\scripts\verify-final-example-library.py --source data\context-resolved-examples.js *>> $runnerLog
    if ($LASTEXITCODE -ne 0) { throw 'final library verification failed' }
    & npm.cmd run ios:web:prepare *>> $runnerLog
    if ($LASTEXITCODE -ne 0) { throw 'iOS web build failed' }
    & $node --check .\public\app.js *>> $runnerLog
    & $node --check .\public\service-worker.js *>> $runnerLog
    Write-ProgressLine 'all local coverage and build checks passed'
    exit 0
  }
  throw "coverage remained incomplete after $MaximumPasses passes"
}
catch {
  Write-ProgressLine "FAILED: $($_.Exception.Message)"
  exit 1
}
finally {
  Pop-Location
}
