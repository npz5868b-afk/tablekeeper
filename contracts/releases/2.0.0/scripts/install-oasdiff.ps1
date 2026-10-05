$ErrorActionPreference = 'Stop'
$version = '1.11.7'
$expected = '5327e48ac9926d8b63c63b6768b7599369f890aac768780621a8315fd3beb2cb'
$archive = Join-Path $env:TEMP ("oasdiff_{0}_windows_amd64.tar.gz" -f $version)
$uri = "https://github.com/oasdiff/oasdiff/releases/download/v$version/oasdiff_$version`_windows_amd64.tar.gz"
Invoke-WebRequest -Uri $uri -OutFile $archive
$actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "oasdiff archive hash mismatch: $actual" }
$tools = Join-Path $PSScriptRoot '..\tools'
New-Item -ItemType Directory -Force -Path $tools | Out-Null
tar -xzf $archive -C $tools oasdiff.exe
if (& (Join-Path $tools 'oasdiff.exe') --version) { exit 0 }
throw 'oasdiff execution failed'
