param(
  [int]$PartitionCount = 8,
  [int]$BatchSize = 2,
  [int]$MaximumPasses = 20
)

# Codex-only, sequential continuation.  Deliberately keeps one request worker
# active at a time so account usage limits cannot be exhausted by a fan-out.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$node = 'E:\node\node.exe'
$log = Join-Path $root 'data\semantic-sense-coverage-codex-continuation.log'

function Note([string]$message) {
  Add-Content -LiteralPath $log -Value "$(Get-Date -Format s) $message" -Encoding utf8
}

Push-Location $root
try {
  for ($pass = 1; $pass -le $MaximumPasses; $pass += 1) {
    Note "pass $pass: merging existing Codex drafts"
    & $node .\scripts\merge-semantic-sense-coverage-drafts.js *>> $log
    if ($LASTEXITCODE -ne 0) { throw 'draft merge failed' }

    $failed = $false
    for ($index = 0; $index -lt $PartitionCount; $index += 1) {
      Note "pass $pass: partition $index/$PartitionCount starting (single worker)"
      & $node .\scripts\generate-semantic-sense-coverage.js `
        --limit-words 6000 --batch-size $BatchSize `
        --partition-index $index --partition-count $PartitionCount `
        --output ("data\semantic-sense-coverage-partition-" + $index + '.js') `
        --model 'gpt-5.6-terra' *>> $log
      if ($LASTEXITCODE -ne 0) {
        Note "partition $index stopped; preserving completed batches for the next run"
        $failed = $true
        break
      }
    }
    if ($failed) { exit 2 }

    & $node .\scripts\merge-semantic-sense-coverage-drafts.js *>> $log
    if ($LASTEXITCODE -ne 0) { throw 'draft merge failed after generation' }
    & $node .\scripts\compose-semantic-sense-coverage.js *>> $log
    if ($LASTEXITCODE -ne 0) {
      Note "pass $pass incomplete; retaining drafts and retrying sequentially"
      continue
    }

    & python .\scripts\split-example-library.py *>> $log
    if ($LASTEXITCODE -ne 0) { throw 'example shard build failed' }
    & npm.cmd run content:verify *>> $log
    if ($LASTEXITCODE -ne 0) { throw 'content verification failed' }
    & python .\scripts\verify-final-example-library.py --source data\context-resolved-examples.js *>> $log
    if ($LASTEXITCODE -ne 0) { throw 'final library verification failed' }
    & npm.cmd run ios:web:prepare *>> $log
    if ($LASTEXITCODE -ne 0) { throw 'iOS web build failed' }
    & $node --check .\public\app.js *>> $log
    if ($LASTEXITCODE -ne 0) { throw 'app.js syntax check failed' }
    & $node --check .\public\service-worker.js *>> $log
    if ($LASTEXITCODE -ne 0) { throw 'service-worker.js syntax check failed' }
    Note 'all coverage and build checks passed'
    exit 0
  }
  throw "coverage remained incomplete after $MaximumPasses passes"
}
catch {
  Note "FAILED: $($_.Exception.Message)"
  exit 1
}
finally {
  Pop-Location
}
