[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$postgresImage = 'postgres:17-bookworm@sha256:639ab7ceb90e13123085b741fb31ef493fba25463002f6da665352e7b534b652'
$containerName = 'tablekeeper-c1a-postgres17'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$migrationPath = (Join-Path $root 'migrations')
$assertionPath = (Join-Path $PSScriptRoot 'postgres17-assertions.sql')
$containerCreated = $false

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker is required for the PostgreSQL 17 integration proof.'
}

$existing = docker ps -a --filter "name=^/$containerName$" --format '{{.Names}}'
if ($existing) { throw "Refusing to reuse existing container $containerName" }

try {
  docker run --detach --name $containerName --network none --env POSTGRES_PASSWORD=c1a-local-proof --env POSTGRES_DB=tablekeeper $postgresImage | Out-Null
  $containerCreated = $true
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    docker exec $containerName pg_isready --username postgres --dbname tablekeeper *> $null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 1
  }
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not become ready.' }

  docker cp $migrationPath "${containerName}:/c1a-migrations"
  docker cp $assertionPath "${containerName}:/postgres17-assertions.sql"

  foreach ($migration in @('0001_roles_ledger.up.sql','0002_core_tables.up.sql','0003_rls_privileges_immutability.up.sql')) {
    docker exec --env PGPASSWORD=c1a-local-proof $containerName psql --username postgres --dbname tablekeeper --no-psqlrc --set ON_ERROR_STOP=1 --file "/c1a-migrations/$migration"
    if ($LASTEXITCODE -ne 0) { throw "Migration failed: $migration" }
  }

  docker exec --env PGPASSWORD=c1a-local-proof $containerName psql --username postgres --dbname tablekeeper --no-psqlrc --set ON_ERROR_STOP=1 --file /postgres17-assertions.sql
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL assertions failed.' }

  foreach ($migration in @('0003_rls_privileges_immutability.down.sql','0002_core_tables.down.sql','0001_roles_ledger.down.sql')) {
    docker exec --env PGPASSWORD=c1a-local-proof $containerName psql --username postgres --dbname tablekeeper --no-psqlrc --set ON_ERROR_STOP=1 --file "/c1a-migrations/$migration"
    if ($LASTEXITCODE -ne 0) { throw "Reverse migration failed: $migration" }
  }

  Write-Output '{"suite":"c1a-postgresql17-migrations","result":"PASS"}'
}
finally {
  if ($containerCreated) { docker rm --force $containerName *> $null }
}
