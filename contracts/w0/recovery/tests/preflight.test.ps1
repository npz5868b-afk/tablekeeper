$ErrorActionPreference='Stop'
$tests=Split-Path -Parent $MyInvocation.MyCommand.Path
$recovery=Split-Path -Parent $tests
$w0=Split-Path -Parent $recovery
$runner=Get-Content -LiteralPath (Join-Path $recovery 'run-c0-recovery.ps1') -Raw
$cmd=Get-Content -LiteralPath (Join-Path $recovery 'run-c0-recovery.cmd') -Raw
$images=Get-Content -LiteralPath (Join-Path $recovery 'images.json') -Raw|ConvertFrom-Json
foreach($name in @('node22','python312','postgres17')){if($images.images.$name.reference -notmatch '@sha256:[0-9a-f]{64}$' -or $images.images.$name.platformDigest -notmatch '^sha256:[0-9a-f]{64}$'){throw "bad image digest $name"}}
if((Get-Content (Join-Path $recovery 'Dockerfile.node22') -Raw) -notmatch [regex]::Escape($images.images.node22.reference)){throw 'Node Dockerfile digest mismatch'}
if((Get-Content (Join-Path $recovery 'Dockerfile.python312') -Raw) -notmatch [regex]::Escape($images.images.python312.reference)){throw 'Python Dockerfile digest mismatch'}
foreach($p in @('package.json','package-lock.json','recovery\requirements-linux.lock','recovery\Dockerfile.node22','recovery\Dockerfile.python312','recovery\db\run.sh','recovery\verify-evidence.mjs')){if(-not(Test-Path -LiteralPath (Join-Path $w0 $p))){throw "missing build/proof input $p"}}
if($runner -match '&\s*\$DockerExe'){throw 'runner bypasses robust native helper'}
if($runner -notmatch 'for\(\$i=0;\$i -lt 60;\$i\+\+\)' -or $runner -notmatch 'Start-Sleep -Seconds 1'){throw 'readiness timeout is not bounded at 60 seconds'}
foreach($needle in @("'--network','none'","'network','create','--internal'","':/proof:ro'","':/evidence'","cleanup-postgres.txt","cleanup-network.txt","primaryFailure")){if($runner -notmatch [regex]::Escape($needle)){throw "runner invariant missing $needle"}}
if($cmd -notmatch 'if not exist "%DOCKER_EXE%"' -or $cmd -notmatch '-DockerExe "%DOCKER_EXE%"'){throw 'CMD path quoting/preflight missing'}
$ignore=Get-Content -LiteralPath (Join-Path $w0 '.dockerignore') -Raw
if($ignore -notmatch 'recovery/evidence'){throw 'prior evidence contaminates Docker build context'}
foreach($f in Get-ChildItem $recovery -Recurse -File -Include *.sh,*.sql,*.mjs,*.py){$bytes=[IO.File]::ReadAllBytes($f.FullName);for($i=0;$i -lt $bytes.Length-1;$i++){if($bytes[$i]-eq 13 -and $bytes[$i+1]-eq 10){throw "CRLF in Linux-consumed file $($f.FullName)"}}}
$nodeProof=Get-Content -LiteralPath (Join-Path $recovery 'run-node-proof.sh') -Raw
$pythonProof=Get-Content -LiteralPath (Join-Path $recovery 'run-python-proof.sh') -Raw
$verifier=Get-Content -LiteralPath (Join-Path $recovery 'verify-evidence.mjs') -Raw
foreach($name in @('tablekeeper-ts-1.ts','tablekeeper-ts-2.ts')){if($nodeProof -notmatch [regex]::Escape($name) -or $verifier -notmatch [regex]::Escape($name)){throw "TS generation/verifier path mismatch $name"}}
foreach($name in @('tablekeeper-py-1.py','tablekeeper-py-2.py')){if($pythonProof -notmatch [regex]::Escape($name) -or $verifier -notmatch [regex]::Escape($name)){throw "Python generation/verifier path mismatch $name"}}
if($nodeProof -notmatch 'generated from schema sha256' -or $pythonProof -notmatch 'generated from schema sha256'){throw 'generated digest banners missing'}
if($runner.IndexOf('provenance-verification.txt') -gt $runner.LastIndexOf('IsReadOnly=$true')){throw 'read-only marking occurs before required provenance write'}
Write-Output 'PASS static preflight: digests, contexts, paths, quoting, helper exclusivity, bounded readiness, mounts, networks, LF, generation paths/banners, evidence/write ordering'
