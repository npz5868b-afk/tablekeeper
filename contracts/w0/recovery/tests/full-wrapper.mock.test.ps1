$ErrorActionPreference='Stop'
$testRoot=Split-Path -Parent $MyInvocation.MyCommand.Path
$recovery=Split-Path -Parent $testRoot
. (Join-Path $recovery 'native-command.ps1')
$mock=Join-Path $testRoot 'mock-native.cmd'
$sandbox=Join-Path $env:TEMP ('tablekeeper recovery mock '+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $sandbox|Out-Null
function Invoke-Lifecycle {
  param([string]$Name,[string]$FailMatch='', [int]$FailCode=17,[string]$FailMatch2='',[int]$FailCode2=18)
  $run=Join-Path $sandbox ($Name+' '+[guid]::NewGuid().ToString('N'));$raw=Join-Path $run 'raw'
  New-Item -ItemType Directory -Path $raw|Out-Null
  $env:TK_MOCK_CALLS=Join-Path $run 'calls.txt';$env:TK_MOCK_FAIL_MATCH=$FailMatch;$env:TK_MOCK_FAIL_CODE=[string]$FailCode;$env:TK_MOCK_FAIL_MATCH2=$FailMatch2;$env:TK_MOCK_FAIL_CODE2=[string]$FailCode2
  $networkCreated=$false;$containerCreated=$false;$primary=$null;$cleanup=@()
  function D([string[]]$A,[string]$L,[switch]$Allow){Invoke-NativeCommand -Executable $mock -ArgumentList $A -LogPath (Join-Path $raw $L) -AllowFailure:$Allow}
  try {
    D @('version') 'version.txt'|Out-Null
    foreach($image in @('node@sha256:aaa','python@sha256:bbb','postgres@sha256:ccc')){D @('pull','--platform','linux/amd64',$image) ('pull-'+$image.Substring(0,$image.IndexOf('@'))+'.txt')|Out-Null}
    D @('build','-f',(Join-Path $sandbox 'path with spaces\Dockerfile.node'),'-t','node:test',(Join-Path $sandbox 'context with spaces')) 'build-node.txt'|Out-Null
    D @('build','-f','Dockerfile.python','-t','python:test','context') 'build-python.txt'|Out-Null
    D @('network','create','--internal','net') 'network-create.txt'|Out-Null;$networkCreated=$true
    D @('run','-d','--name','pg','--network','net','postgres@sha256:ccc') 'postgres-start.txt'|Out-Null;$containerCreated=$true
    D @('exec','pg','pg_isready','-U','postgres') 'ready.txt'|Out-Null
    D @('run','--rm','--network','net','postgres@sha256:ccc','sh','/proof/run.sh') 'postgres-proof.txt'|Out-Null
    D @('run','--rm','--network','none','node:test') 'node-proof.txt'|Out-Null
    D @('run','--rm','--network','none','python:test') 'python-proof.txt'|Out-Null
    New-Item -ItemType Directory -Path (Join-Path $run 'generated')|Out-Null
    Set-Content -LiteralPath (Join-Path $run 'generated\mock.txt') -Value 'evidence'
    D @('run','--rm','--network','none','-e','VERIFY_ONLY=1','node:test') 'verification.txt'|Out-Null
  } catch {$primary=$_}
  finally {
    if($containerCreated){$x=D @('rm','-f','pg') 'cleanup-container.txt' -Allow;if($x.ExitCode -ne 0){$cleanup+='container'}}
    if($networkCreated){$x=D @('network','rm','net') 'cleanup-network.txt' -Allow;if($x.ExitCode -ne 0 -and (($x.Stdout+$x.Stderr)-notmatch '(?i)network not found')){$cleanup+='network'}}
  }
  [pscustomobject]@{Run=$run;Primary=$primary;Cleanup=$cleanup;Calls=if(Test-Path $env:TK_MOCK_CALLS){@(Get-Content $env:TK_MOCK_CALLS)}else{@()}}
}
try {
  $happy=Invoke-Lifecycle 'happy'
  if($happy.Primary -or $happy.Cleanup.Count){throw 'happy path failed'}
  if($happy.Calls.Count -ne 15){throw "happy path command count $($happy.Calls.Count)"}
  if(-not (Get-Content (Join-Path $happy.Run 'raw\build-node.txt') -Raw).Contains('#0 building with')){throw 'stderr progress was not preserved'}
  $buildFail=Invoke-Lifecycle 'native-failure' 'build -f' 23
  if(-not $buildFail.Primary -or $buildFail.Primary.Exception.Message -notmatch 'exit code 23'){throw 'nonzero native exit was not authoritative'}
  $createFail=Invoke-Lifecycle 'container-create-failure' 'run -d' 24
  if(-not $createFail.Primary -or ($createFail.Calls -join '|') -notmatch 'network rm net' -or ($createFail.Calls -join '|') -match 'rm -f pg'){throw 'creation failure cleanup scope incorrect'}
  $proofFail=Invoke-Lifecycle 'proof-failure-cleanup' 'postgres@sha256:ccc sh /proof/run.sh' 25
  if(-not $proofFail.Primary -or ($proofFail.Calls -join '|') -notmatch 'rm -f pg' -or ($proofFail.Calls -join '|') -notmatch 'network rm net'){throw 'proof failure cleanup missing'}
  $cleanupAbsent=Invoke-Lifecycle 'network-absent' 'network rm' 1
  if($cleanupAbsent.Cleanup.Count){throw 'already-absent network was treated as cleanup failure'}
  $cleanupFailure=Invoke-Lifecycle 'cleanup-failure' 'rm -f pg' 26
  if($cleanupFailure.Primary -or $cleanupFailure.Cleanup -notcontains 'container'){throw 'cleanup failure after successful proof not detected'}
  $doubleFailure=Invoke-Lifecycle 'primary-plus-cleanup' 'postgres@sha256:ccc sh /proof/run.sh' 27 'rm -f pg' 28
  if(-not $doubleFailure.Primary -or $doubleFailure.Primary.Exception.Message -notmatch 'exit code 27' -or $doubleFailure.Cleanup -notcontains 'container'){throw 'primary failure was masked by cleanup failure'}
  $partial=Join-Path $sandbox 'partial evidence';New-Item -ItemType Directory -Path $partial|Out-Null;Set-Content (Join-Path $partial 'keep.txt') 'keep'
  $repeat1=Invoke-Lifecycle 'repeat';$repeat2=Invoke-Lifecycle 'repeat'
  if($repeat1.Run -eq $repeat2.Run -or (Get-Content (Join-Path $partial 'keep.txt')) -ne 'keep'){throw 'retry isolation failed'}
  Write-Output 'PASS full mock: happy path, BuildKit stderr/exit 0, native failure, creation failure, proof cleanup, absent network, cleanup failure, spaces, repeat, partial evidence'
} finally {
  Remove-Item -LiteralPath $sandbox -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item Env:TK_MOCK_CALLS,Env:TK_MOCK_FAIL_MATCH,Env:TK_MOCK_FAIL_CODE,Env:TK_MOCK_FAIL_MATCH2,Env:TK_MOCK_FAIL_CODE2 -ErrorAction SilentlyContinue
}
