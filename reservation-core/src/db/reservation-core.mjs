import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const componentRoot = resolve(here, '..', '..');

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseArgs(argv) {
  const [subcommand, ...rest] = argv;
  if (!subcommand) throw new CliError('USAGE', 'missing subcommand');
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new CliError('USAGE', `invalid argument near ${flag ?? '<end>'}`);
    }
    if (values.has(flag)) throw new CliError('USAGE', `duplicate flag ${flag}`);
    values.set(flag, value);
  }
  return { subcommand, values };
}

function required(values, name) {
  const value = values.get(name);
  if (!value) throw new CliError('USAGE', `missing ${name}`);
  return value;
}

function rejectUnknown(values, allowed) {
  for (const name of values.keys()) {
    if (!allowed.has(name)) throw new CliError('USAGE', `unknown flag ${name}`);
  }
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runPsql(databaseUrl, sql, { tuples = true } = {}) {
  const psql = process.env.PSQL_BIN || 'psql';
  const args = ['--dbname', databaseUrl, '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--quiet'];
  if (tuples) args.push('--tuples-only', '--no-align', '--field-separator=\t');
  args.push('--command', sql);
  const child = spawnSync(psql, args, {
    encoding: 'utf8',
    env: process.env,
    windowsHide: true
  });
  if (child.error) throw new CliError('PSQL_UNAVAILABLE', child.error.message);
  if (child.status !== 0) {
    const safe = (child.stderr || 'psql failed').replaceAll(databaseUrl, '<redacted>').trim();
    throw new CliError('DATABASE_COMMAND_FAILED', safe);
  }
  return child.stdout.trim();
}

function loadManifest(migrationsDirectory) {
  const manifestPath = resolve(migrationsDirectory, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new CliError('MIGRATION_MANIFEST_INVALID', error.message);
  }
  if (manifest.manifestVersion !== '1.0.0' || manifest.postgresqlMajor !== 17 || !Array.isArray(manifest.migrations)) {
    throw new CliError('MIGRATION_MANIFEST_INVALID', 'unsupported manifest shape');
  }
  let previous = '';
  for (const migration of manifest.migrations) {
    if (!/^[0-9]{4}_[a-z0-9_]+$/.test(migration.id) || migration.id <= previous) {
      throw new CliError('MIGRATION_ORDER_INVALID', `unordered migration ${migration.id}`);
    }
    previous = migration.id;
    for (const direction of ['up', 'down']) {
      const file = migration[direction].file;
      const expected = migration[direction].sha256;
      const actual = sha256(readFileSync(resolve(migrationsDirectory, file)));
      if (actual !== expected) throw new CliError('MIGRATION_DIGEST_MISMATCH', `${file} digest mismatch`);
    }
  }
  return manifest;
}

function serverMajor(databaseUrl) {
  const versionNumber = Number(runPsql(databaseUrl, 'SHOW server_version_num;'));
  const major = Math.floor(versionNumber / 10000);
  if (!Number.isInteger(versionNumber) || major !== 17) {
    throw new CliError('POSTGRESQL_MAJOR_MISMATCH', `required PostgreSQL 17; observed ${versionNumber || 'unknown'}`);
  }
  return major;
}

function assertDatabaseShape(databaseUrl) {
  const extension = runPsql(databaseUrl, "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist');");
  if (extension !== 't') throw new CliError('REQUIRED_EXTENSION_MISSING', 'required extension btree_gist is absent');

  const roles = runPsql(databaseUrl, `
    SELECT count(*) = 2
    FROM pg_roles
    WHERE rolname IN ('reservation_core_migration', 'core_runtime')
      AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls;
  `);
  if (roles !== 't') throw new CliError('DATABASE_ROLE_MISMATCH', 'required fail-closed roles are absent or unsafe');

  const rls = runPsql(databaseUrl, `
    SELECT count(*) = 15
       AND bool_and(c.relrowsecurity AND c.relforcerowsecurity)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'reservation_core'
      AND c.relname IN (
        'tenants','venues','service_periods','table_resources','table_groups','table_group_members',
        'policy_versions','preparations','reservations','reservation_allocations','accepted_terms',
        'idempotency_records','domain_audit_records','outbox_events','command_attempts'
      );
  `);
  if (rls !== 't') throw new CliError('RLS_CONFIGURATION_MISMATCH', 'tenant tables are absent or lack forced RLS');
}

function readLedger(databaseUrl) {
  const exists = runPsql(databaseUrl, "SELECT to_regclass('reservation_core.schema_migrations') IS NOT NULL;");
  if (exists !== 't') return [];
  const output = runPsql(databaseUrl, 'SELECT migration_id, file_name, file_sha256, contract_graph_sha256 FROM reservation_core.schema_migrations ORDER BY migration_id;');
  if (!output) return [];
  return output.split(/\r?\n/).map((line) => {
    const [migrationId, fileName, fileSha256, contractGraphSha256] = line.split('\t');
    return { migrationId, fileName, fileSha256, contractGraphSha256 };
  });
}

function assertLedger(manifest, ledger, contractGraphSha256, { allowPrefix = false } = {}) {
  if ((!allowPrefix && ledger.length !== manifest.migrations.length) || ledger.length > manifest.migrations.length) {
    throw new CliError('MIGRATION_LEDGER_MISMATCH', 'migration count differs from immutable manifest');
  }
  ledger.forEach((row, index) => {
    const expected = manifest.migrations[index];
    if (row.migrationId !== expected.id || row.fileName !== expected.up.file || row.fileSha256 !== expected.up.sha256) {
      throw new CliError('MIGRATION_LEDGER_MISMATCH', `ledger mismatch at ${row.migrationId}`);
    }
    if (row.contractGraphSha256 !== contractGraphSha256) {
      throw new CliError('CONTRACT_GRAPH_MISMATCH', `ledger contract graph mismatch at ${row.migrationId}`);
    }
  });
}

function migrationResult(operation, result, postgresqlMajor, ledger, contractGraphSha256, startedAt, failureCode) {
  return {
    documentVersion: '1.0.0',
    operation,
    result,
    postgresqlMajor,
    migrationHead: ledger.at(-1)?.migrationId ?? null,
    appliedMigrations: ledger.map(({ migrationId, fileName, fileSha256 }) => ({ migrationId, fileName, fileSha256 })),
    contractGraphSha256,
    startedAt,
    finishedAt: new Date().toISOString(),
    ...(failureCode ? { failureCode } : {})
  };
}

function writeResult(path, document) {
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  writeFileSync(path, serialized, { encoding: 'utf8', flag: 'w' });
  process.stdout.write(serialized);
}

async function seed(values) {
  const allowed = new Set(['--database-url-env', '--descriptor', '--mode', '--output']);
  rejectUnknown(values, allowed);
  const databaseUrlEnvironmentName = required(values, '--database-url-env');
  const databaseUrl = process.env[databaseUrlEnvironmentName];
  if (!databaseUrl) throw new CliError('DATABASE_URL_MISSING', `environment variable ${databaseUrlEnvironmentName} is unset`);
  const descriptorArgument = required(values, '--descriptor');
  const outputArgument = required(values, '--output');
  if (!isAbsolute(descriptorArgument) || !isAbsolute(outputArgument)) throw new CliError('USAGE', '--descriptor and --output must be absolute');
  const mode = required(values, '--mode');
  if (!['apply', 'verify'].includes(mode)) throw new CliError('USAGE', 'invalid --mode');
  const startedAt = new Date().toISOString();
  const { Pool } = await import('pg');
  const { loadSeedBundle, PostgresLocalDemoSeedRepository } = await import('../seed/local-demo-seed.mjs');
  const bundle = await loadSeedBundle(resolve(descriptorArgument));
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const repository = new PostgresLocalDemoSeedRepository(pool);
    const observedCounts = await repository[mode](bundle.fixture);
    const head = await pool.query('SELECT migration_id FROM reservation_core.schema_migrations ORDER BY migration_id DESC LIMIT 1');
    writeResult(resolve(outputArgument), {
      documentVersion: '1.0.0', operation: mode, result: 'PASS', fixtureId: bundle.descriptor.fixtureId,
      descriptorSha256: bundle.descriptorSha256, fixtureSha256: bundle.descriptor.fixtureSha256,
      loaderBuildId: bundle.descriptor.loaderBuildId, migrationHead: head.rows[0]?.migration_id ?? null,
      randomSeed: bundle.descriptor.randomSeed, clockInstant: bundle.descriptor.clockInstant,
      startedAt, finishedAt: new Date().toISOString(), observedCounts
    });
  } catch (error) {
    const failure = error instanceof CliError ? error : new CliError(error.code ?? 'SEED_FAILED', error.message);
    writeResult(resolve(outputArgument), {
      documentVersion: '1.0.0', operation: mode, result: 'FAIL', fixtureId: bundle.descriptor.fixtureId,
      descriptorSha256: bundle.descriptorSha256, fixtureSha256: bundle.descriptor.fixtureSha256,
      loaderBuildId: bundle.descriptor.loaderBuildId, migrationHead: null,
      randomSeed: bundle.descriptor.randomSeed, clockInstant: bundle.descriptor.clockInstant,
      startedAt, finishedAt: new Date().toISOString(), failureCode: failure.code
    });
    process.stderr.write(`${failure.code}: ${failure.message}\n`);
    process.exitCode = 1;
  } finally { await pool.end(); }
}

function migrate(values) {
  const allowed = new Set(['--mode', '--database-url-env', '--migrations', '--expected-contract-graph-sha256', '--target', '--output']);
  rejectUnknown(values, allowed);
  const mode = required(values, '--mode');
  if (!['up', 'verify', 'down'].includes(mode)) throw new CliError('USAGE', 'invalid --mode');
  const databaseUrlEnvironmentName = required(values, '--database-url-env');
  const databaseUrl = process.env[databaseUrlEnvironmentName];
  if (!databaseUrl) throw new CliError('DATABASE_URL_MISSING', `environment variable ${databaseUrlEnvironmentName} is unset`);
  const migrationsArgument = required(values, '--migrations');
  if (!isAbsolute(migrationsArgument)) throw new CliError('USAGE', '--migrations must be absolute');
  const migrationsDirectory = resolve(migrationsArgument);
  const contractGraphSha256 = required(values, '--expected-contract-graph-sha256');
  if (!/^[0-9a-f]{64}$/.test(contractGraphSha256)) throw new CliError('USAGE', 'invalid contract graph SHA-256');
  const outputArgument = required(values, '--output');
  if (!isAbsolute(outputArgument)) throw new CliError('USAGE', '--output must be absolute');
  const output = resolve(outputArgument);
  const startedAt = new Date().toISOString();
  const manifest = loadManifest(migrationsDirectory);
  let major = 17;
  let ledger = [];
  try {
    major = serverMajor(databaseUrl);
    ledger = readLedger(databaseUrl);
    assertLedger(manifest, ledger, contractGraphSha256, { allowPrefix: mode !== 'verify' });
    if (mode === 'up') {
      for (const migration of manifest.migrations.slice(ledger.length)) {
        const body = readFileSync(resolve(migrationsDirectory, migration.up.file), 'utf8');
        const sql = [
          'BEGIN;',
          "SELECT pg_advisory_xact_lock(hashtextextended('tablekeeper.reservation-core.migrations', 0));",
          body,
          `INSERT INTO reservation_core.schema_migrations (migration_id, file_name, file_sha256, contract_graph_sha256) VALUES (${sqlLiteral(migration.id)}, ${sqlLiteral(migration.up.file)}, ${sqlLiteral(migration.up.sha256)}, ${sqlLiteral(contractGraphSha256)});`,
          'COMMIT;'
        ].join('\n');
        runPsql(databaseUrl, sql, { tuples: false });
      }
    } else if (mode === 'down') {
      const target = values.get('--target') ?? null;
      if (target && !manifest.migrations.some((migration) => migration.id === target)) throw new CliError('MIGRATION_TARGET_UNKNOWN', target);
      const desiredLength = target ? manifest.migrations.findIndex((migration) => migration.id === target) + 1 : 0;
      for (const migration of [...manifest.migrations.slice(desiredLength, ledger.length)].reverse()) {
        const body = readFileSync(resolve(migrationsDirectory, migration.down.file), 'utf8');
        const sql = [
          'BEGIN;',
          "SELECT pg_advisory_xact_lock(hashtextextended('tablekeeper.reservation-core.migrations', 0));",
          `DELETE FROM reservation_core.schema_migrations WHERE migration_id = ${sqlLiteral(migration.id)};`,
          body,
          'COMMIT;'
        ].join('\n');
        runPsql(databaseUrl, sql, { tuples: false });
      }
    }
    ledger = readLedger(databaseUrl);
    assertLedger(manifest, ledger, contractGraphSha256, { allowPrefix: mode === 'down' });
    if (mode === 'up' || mode === 'verify') assertDatabaseShape(databaseUrl);
    writeResult(output, migrationResult(mode, 'PASS', major, ledger, contractGraphSha256, startedAt));
  } catch (error) {
    const failure = error instanceof CliError ? error : new CliError('INTERNAL_ERROR', error.message);
    try { ledger = readLedger(databaseUrl); } catch { ledger = []; }
    writeResult(output, migrationResult(mode, 'FAIL', major, ledger, contractGraphSha256, startedAt, failure.code));
    process.stderr.write(`${failure.code}: ${failure.message}\n`);
    process.exitCode = 1;
  }
}

async function main() {
  const { subcommand, values } = parseArgs(process.argv.slice(2));
  if (subcommand === 'migrate') return migrate(values);
  if (subcommand === 'seed') return seed(values);
  throw new CliError('SUBCOMMAND_NOT_IMPLEMENTED', `${subcommand} is not implemented`);
}

try {
  await main();
} catch (error) {
  const failure = error instanceof CliError ? error : new CliError('INTERNAL_ERROR', error.message);
  process.stderr.write(`${failure.code}: ${failure.message}\n`);
  process.exitCode = 2;
}
