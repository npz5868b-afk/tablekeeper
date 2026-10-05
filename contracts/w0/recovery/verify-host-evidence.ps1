param([Parameter(Mandatory=$true)][string]$EvidenceRoot)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $EvidenceRoot).Path
$manifestPath=Join-Path $root 'evidence-manifest.json'
$digestPath=Join-Path $root 'evidence-manifest.sha256'
if(-not (Test-Path $manifestPath)){throw 'evidence manifest absent'}
$expected=(Get-Content -LiteralPath $digestPath -Raw).Substring(0,64)
$actual=(Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
if($expected -ne $actual){throw 'manifest digest mismatch'}
$manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
foreach($artifact in $manifest.artifacts){
  $p=Join-Path $root $artifact.path
  if(-not (Test-Path -LiteralPath $p)){throw "missing artifact $($artifact.path)"}
  $h=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()
  if($h -ne $artifact.sha256){throw "artifact digest mismatch $($artifact.path)"}
  if(-not (Get-Item -LiteralPath $p).IsReadOnly){throw "artifact is not read-only $($artifact.path)"}
}
$db=Get-Content -LiteralPath (Join-Path $root 'raw\postgres-results.json') -Raw | ConvertFrom-Json
if(-not $db.postgresVersion17){throw 'PostgreSQL is not version 17'}
foreach($p in $db.assertions.psobject.Properties){if($p.Value -ne $true){throw "failed database assertion $($p.Name)"}}
function Read-CommandRecord([string]$Name){Get-Content -LiteralPath (Join-Path $root ('raw\'+$Name+'.command.json')) -Raw|ConvertFrom-Json}
$nodeCommand=Read-CommandRecord 'node-proof.txt'
$pythonCommand=Read-CommandRecord 'python-proof.txt'
$networkCommand=Read-CommandRecord 'network-create.txt'
$databaseCommand=Read-CommandRecord 'postgres-harness.txt'
$provenanceCommand=Read-CommandRecord 'provenance-verification.txt'
foreach($record in @($nodeCommand,$pythonCommand,$networkCommand,$databaseCommand,$provenanceCommand)){if($record.exitCode -ne 0){throw "recorded native command failed: $($record.argv -join ' ')"}}
if(($nodeCommand.argv -join ' ') -notmatch '--network none'){throw 'Node proof was not network-disabled'}
if(($pythonCommand.argv -join ' ') -notmatch '--network none'){throw 'Python proof was not network-disabled'}
if(($provenanceCommand.argv -join ' ') -notmatch '--network none'){throw 'Provenance proof was not network-disabled'}
if(($networkCommand.argv -join ' ') -notmatch 'network create --internal'){throw 'PostgreSQL network was not internal'}
if(($databaseCommand.argv -join ' ') -notmatch '--network tk-c0-.*-internal'){throw 'PostgreSQL proof did not use the internal network'}
$contractDigest=$manifest.contractDigests[0].Substring(7)
foreach($generated in @('generated\tablekeeper-ts-1.ts','generated\tablekeeper-ts-2.ts','generated\tablekeeper-py-1.py','generated\tablekeeper-py-2.py')){if((Get-Content -LiteralPath (Join-Path $root $generated) -TotalCount 1) -notmatch [regex]::Escape($contractDigest)){throw "generated source digest banner missing: $generated"}}
Write-Output 'PASS independent host artifact, provenance, retention, and database assertion verification'
