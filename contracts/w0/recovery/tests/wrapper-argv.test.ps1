$ErrorActionPreference='Stop'
$testRoot=Split-Path -Parent $MyInvocation.MyCommand.Path
$recoveryRoot=Split-Path -Parent $testRoot
. (Join-Path $recoveryRoot 'native-command.ps1')
$runnerText=Get-Content -LiteralPath (Join-Path (Split-Path -Parent $testRoot) 'run-c0-recovery.ps1') -Raw
if($runnerText -notmatch '\[string\[\]\]\$DockerArgs'){throw 'production helper does not use DockerArgs parameter'}
if($runnerText -match '\[string\[\]\]\$Args(?:\W|$)'){throw 'production helper regressed to automatic Args collision'}
$DockerExe=Join-Path $testRoot 'mock-docker.cmd'
$out=Join-Path $env:TEMP ('tablekeeper-wrapper-argv-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $out | Out-Null
function Invoke-Docker([string[]]$DockerArgs,[string]$Log){
  Invoke-NativeCommand -Executable $DockerExe -ArgumentList $DockerArgs -LogPath (Join-Path $out $Log) | Out-Null
}
try {
  $digest='node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c'
  Invoke-Docker @('version') 'version.txt'
  Invoke-Docker @('pull','--platform','linux/amd64',$digest) 'pull.txt'
  Invoke-Docker @('network','create','--internal','tk-c0-test-internal') 'network.txt'
  $actual=@{
    version=@((Get-Content (Join-Path $out 'version.txt.command.json') -Raw | ConvertFrom-Json).argv)
    pull=@((Get-Content (Join-Path $out 'pull.txt.command.json') -Raw | ConvertFrom-Json).argv)
    network=@((Get-Content (Join-Path $out 'network.txt.command.json') -Raw | ConvertFrom-Json).argv)
  }
  $expected=@{
    version=@('version')
    pull=@('pull','--platform','linux/amd64',$digest)
    network=@('network','create','--internal','tk-c0-test-internal')
  }
  foreach($key in $expected.Keys){
    if((ConvertTo-Json @($actual[$key]) -Compress) -ne (ConvertTo-Json @($expected[$key]) -Compress)){
      throw "$key argv mismatch: '$($actual[$key] -join ' ')'"
    }
  }
  Write-Output 'PASS wrapper argv forwarding: version, digest pull, internal network create'
} finally {
  Remove-Item -LiteralPath $out -Recurse -Force -ErrorAction SilentlyContinue
}
