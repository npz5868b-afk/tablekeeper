param([Parameter(Mandatory=$true)][string]$DockerExe)
$ErrorActionPreference='Stop'
$recovery=Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $recovery 'native-command.ps1')
$w0=Split-Path -Parent $recovery;$evidenceRoot=Join-Path $recovery 'evidence'
$runId='tk-c0-'+[DateTimeOffset]::UtcNow.ToString('yyyyMMddHHmmssfff')+'-'+([guid]::NewGuid().ToString('N').Substring(0,8))
$runRoot=Join-Path (Join-Path $evidenceRoot 'runs') $runId;$raw=Join-Path $runRoot 'raw';$db=Join-Path $recovery 'db'
$network=$runId+'-internal';$postgres=$runId+'-postgres';$nodeImage='tablekeeper-c0-node22:'+$runId;$pythonImage='tablekeeper-c0-python312:'+$runId
$nodeRef='node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c'
$pythonRef='python:3.12-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e'
$postgresRef='postgres:17-bookworm@sha256:639ab7ceb90e13123085b741fb31ef493fba25463002f6da665352e7b534b652'
$networkCreated=$false;$postgresCreated=$false;$primaryFailure=$null;$cleanupFailures=@()
New-Item -ItemType Directory -Force -Path $raw|Out-Null
$pre=Join-Path $evidenceRoot 'pre-recovery'
if(-not(Test-Path $pre)){New-Item -ItemType Directory -Path $pre|Out-Null;Copy-Item (Join-Path $w0 'contract-freeze-manifest.json'),(Join-Path $w0 'c0-checklist.md'),(Join-Path $w0 'SHA256SUMS') -Destination $pre}
function Invoke-Docker {param([Parameter(Mandatory=$true)][string[]]$DockerArgs,[Parameter(Mandatory=$true)][string]$Log,[switch]$AllowFailure);$result=Invoke-NativeCommand -Executable $DockerExe -ArgumentList $DockerArgs -LogPath (Join-Path $raw $Log) -AllowFailure:$AllowFailure;return $result}
try {
  Invoke-Docker -DockerArgs @('version') -Log 'docker-version.txt'|Out-Null
  Invoke-Docker -DockerArgs @('pull','--platform','linux/amd64',$nodeRef) -Log 'pull-node.txt'|Out-Null
  Invoke-Docker -DockerArgs @('pull','--platform','linux/amd64',$pythonRef) -Log 'pull-python.txt'|Out-Null
  Invoke-Docker -DockerArgs @('pull','--platform','linux/amd64',$postgresRef) -Log 'pull-postgres.txt'|Out-Null
  Invoke-Docker -DockerArgs @('build','--pull=false','--network','default','-f',(Join-Path $recovery 'Dockerfile.node22'),'-t',$nodeImage,$w0) -Log 'build-node.txt'|Out-Null
  Invoke-Docker -DockerArgs @('build','--pull=false','--network','default','-f',(Join-Path $recovery 'Dockerfile.python312'),'-t',$pythonImage,$w0) -Log 'build-python.txt'|Out-Null
  Invoke-Docker -DockerArgs @('network','create','--internal',$network) -Log 'network-create.txt'|Out-Null;$networkCreated=$true
  Invoke-Docker -DockerArgs @('run','-d','--name',$postgres,'--network',$network,'-e','POSTGRES_PASSWORD=c0-proof','-e','POSTGRES_DB=tablekeeper',$postgresRef) -Log 'postgres-start.txt'|Out-Null;$postgresCreated=$true
  $healthy=$false
  for($i=0;$i -lt 60;$i++){$ready=Invoke-Docker -DockerArgs @('exec',$postgres,'pg_isready','-U','postgres','-d','tablekeeper') -Log ('postgres-ready-{0:D2}.txt' -f $i) -AllowFailure;if($ready.ExitCode -eq 0){$healthy=$true;break};Start-Sleep -Seconds 1}
  if(-not $healthy){throw 'PostgreSQL 17 did not become ready within 60 seconds'}
  Invoke-Docker -DockerArgs @('run','--rm','--network',$network,'-e',('PGHOST='+$postgres),'-e','PGUSER=postgres','-e','PGPASSWORD=c0-proof','-e','PGDATABASE=tablekeeper','-v',($db+':/proof:ro'),'-v',($runRoot+':/evidence'),$postgresRef,'sh','/proof/run.sh') -Log 'postgres-harness.txt'|Out-Null
  Invoke-Docker -DockerArgs @('run','--rm','--network','none','-v',($runRoot+':/evidence'),$nodeImage) -Log 'node-proof.txt'|Out-Null
  Invoke-Docker -DockerArgs @('run','--rm','--network','none','-v',($runRoot+':/evidence'),$pythonImage) -Log 'python-proof.txt'|Out-Null
} catch {$primaryFailure=$_}
finally {
  if($postgresCreated){$remove=Invoke-Docker -DockerArgs @('rm','-f',$postgres) -Log 'cleanup-postgres.txt' -AllowFailure;if($remove.ExitCode -ne 0 -and (($remove.Stdout+$remove.Stderr)-notmatch '(?i)(no such container|container .* not found)')){$cleanupFailures+="docker rm -f $postgres exit $($remove.ExitCode)"}}
  if($networkCreated){$remove=Invoke-Docker -DockerArgs @('network','rm',$network) -Log 'cleanup-network.txt' -AllowFailure;if($remove.ExitCode -ne 0 -and (($remove.Stdout+$remove.Stderr)-notmatch '(?i)(no such network|network .* not found)')){$cleanupFailures+="docker network rm $network exit $($remove.ExitCode)"}}
}
if($primaryFailure -or $cleanupFailures.Count){$failure=[ordered]@{executionId=$runId;status='failed';primaryFailure=if($primaryFailure){$primaryFailure.Exception.Message}else{$null};cleanupFailures=$cleanupFailures;createdAt=[DateTimeOffset]::UtcNow.ToString('o');runRoot=$runRoot};$failure|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $runRoot 'failure.json') -Encoding utf8;Get-ChildItem -LiteralPath $runRoot -Recurse -File|ForEach-Object{$_.IsReadOnly=$true};if($primaryFailure){throw $primaryFailure};throw($cleanupFailures -join [Environment]::NewLine)}
$environment=[ordered]@{executionId=$runId;platform='linux/amd64';nodeImage=$nodeRef;pythonImage=$pythonRef;postgresImage=$postgresRef;networkMode='none for generators; internal-only for PostgreSQL';createdAt=[DateTimeOffset]::UtcNow.ToString('o')}
$environment|ConvertTo-Json -Depth 4|Set-Content -LiteralPath (Join-Path $raw 'environment.json') -Encoding utf8
$networkControls=[ordered]@{internetDenied=$true;controls=@(@{mode='none';commandRecord='node-proof.txt.command.json'},@{mode='none';commandRecord='python-proof.txt.command.json'},@{mode='internal';commandRecord='network-create.txt.command.json'},@{mode='internal';commandRecord='postgres-harness.txt.command.json'});createdAt=[DateTimeOffset]::UtcNow.ToString('o')}
$networkControls|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $raw 'network-controls.json') -Encoding utf8
try {
  Invoke-Docker -DockerArgs @('run','--rm','--network','none','-e','VERIFY_ONLY=1','-v',($runRoot+':/evidence'),$nodeImage) -Log 'provenance-verification.txt'|Out-Null
  Get-ChildItem -LiteralPath $runRoot -Recurse -File|ForEach-Object{$_.IsReadOnly=$true}
  & (Join-Path $recovery 'verify-host-evidence.ps1') -EvidenceRoot $runRoot
  [System.IO.File]::WriteAllText((Join-Path $evidenceRoot 'latest-success.txt'),$runId+[Environment]::NewLine,(New-Object System.Text.UTF8Encoding($false)))
  Write-Output "PASS: recovery evidence ready at $runRoot"
} catch {
  $postFailure=Join-Path (Join-Path $evidenceRoot 'failed') $runId
  New-Item -ItemType Directory -Force -Path $postFailure|Out-Null
  @{executionId=$runId;status='post-proof-verification-failed';message=$_.Exception.Message;runRoot=$runRoot;createdAt=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $postFailure 'failure.json') -Encoding utf8
  throw
}
