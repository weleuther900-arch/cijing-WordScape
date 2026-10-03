param(
  [int[]]$InitialGeneratorProcessIds = @(),
  [int]$PartitionCount = 4,
  [int]$MaximumPasses = 20
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = 'E:\node\node.exe'
$log = Join-Path $root 'data\semantic-sense-coverage-parallel-continuation.log'

function Note([string]$message) {
  Add-Content -LiteralPath $log -Value "$(Get-Date -Format s) $message" -Encoding utf8
}

function Wait-Workers([int[]]$ids) {
  foreach ($id in $ids) {
    if (Get-Process -Id $id -ErrorAction SilentlyContinue) { Wait-Process -Id $id }
  }
}

Push-Location $root
try {
  if ($InitialGeneratorProcessIds.Count -gt 0) {
    Note "waiting for initial workers $($InitialGeneratorProcessIds -join ',')"
    Wait-Workers $InitialGeneratorProcessIds
  }
  for ($pass = 1; $pass -le $MaximumPasses; $pass += 1) {
    & $node .\scripts\merge-semantic-sense-coverage-drafts.js *>> $log
    & $node .\scripts\compose-semantic-sense-coverage.js *>> $log
    if ($LASTEXITCODE -eq 0) {
      & python .\scripts\split-example-library.py *>> $log
      if ($LASTEXITCODE -ne 0) { throw 'example shard build failed' }
      & npm.cmd run content:verify *>> $log
      if ($LASTEXITCODE -ne 0) { throw 'content verification failed' }
      & python .\scripts\verify-final-example-library.py --source data\context-resolved-examples.js *>> $log
      if ($LASTEXITCODE -ne 0) { throw 'final library verification failed' }
      & npm.cmd run ios:web:prepare *>> $log
      if ($LASTEXITCODE -ne 0) { throw 'iOS web build failed' }
      & $node --check .\public\app.js *>> $log
      & $node --check .\public\service-worker.js *>> $log
      Note 'all coverage and build checks passed'
      exit 0
    }

    Note "pass $pass incomplete; starting retry workers"
    $workers = @()
    0..($PartitionCount - 1) | ForEach-Object {
      $index = $_
      $workers += Start-Process -FilePath $node -ArgumentList @('.\scripts\generate-semantic-sense-coverage.js','--limit-words','6000','--batch-size','3','--partition-index',$index,'--partition-count',$PartitionCount,'--output',("data\semantic-sense-coverage-partition-" + $index + '.js'),'--model','gpt-5.6-terra') -WorkingDirectory $root -WindowStyle Hidden -PassThru
    }
    Wait-Workers $workers.Id
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
