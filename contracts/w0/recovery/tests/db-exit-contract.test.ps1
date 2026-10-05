$ErrorActionPreference='Stop'
$scriptPath=Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) 'db\run.sh'
$text=Get-Content -LiteralPath $scriptPath -Raw
$tail="if grep -q ':false' /evidence/raw/postgres-results.json; then`n  exit 1`nfi`nexit 0"
if(($text -replace "`r`n","`n") -notlike "*$tail*"){throw 'run.sh does not use explicit false-assertion failure and successful exit control flow'}
function Get-ModeledExitCode([string]$Json){if($Json -match ':false'){return 1};return 0}
$passing='{"postgresVersion17":true,"assertions":{"allocationExclusion":true}}'
$failing='{"postgresVersion17":true,"assertions":{"allocationExclusion":false}}'
if((Get-ModeledExitCode $passing) -ne 0){throw 'all-true assertion document modeled nonzero'}
if((Get-ModeledExitCode $failing) -ne 1){throw 'false assertion document did not model nonzero'}
Write-Output 'PASS db/run.sh exit contract: all true => 0; any :false => 1'
