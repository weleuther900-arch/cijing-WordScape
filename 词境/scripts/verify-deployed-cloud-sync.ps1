param(
  [string]$Endpoint = $env:WORDSCAPE_SYNC_URL
)

$ErrorActionPreference = "Stop"
if (-not $Endpoint) { $Endpoint = "https://wordscape.weleuther900.workers.dev/api/sync" }
$origin = "http://127.0.0.1:4173"
$payload = @{ action = "pull"; profileId = ("f" * 64); revision = 0 } | ConvertTo-Json -Compress

try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $Endpoint -Method Post -ContentType "application/json" -Headers @{ Origin = $origin; "Cache-Control" = "no-store" } -Body $payload -TimeoutSec 30
  $body = $response.Content | ConvertFrom-Json
  if ($response.StatusCode -ne 200) { throw "Expected HTTP 200, got $($response.StatusCode)." }
  if ($body.status -ne "missing") { throw "Expected an empty test profile, got status '$($body.status)'." }
  if ($response.Headers["Access-Control-Allow-Origin"] -ne $origin) { throw "The desktop origin is not allowed to call cloud sync." }
  Write-Output "Deployed cloud sync verification passed: $Endpoint"
} catch {
  Write-Error "Deployed cloud sync verification failed: $($_.Exception.Message)"
  exit 1
}