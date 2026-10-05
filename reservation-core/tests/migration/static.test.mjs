import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(testDirectory, '..', '..');
const migrations = resolve(root, 'migrations');
const read = (path) => readFileSync(resolve(migrations, path), 'utf8');
const hash = (path) => createHash('sha256').update(readFileSync(resolve(migrations, path))).digest('hex');
const manifest = JSON.parse(read('manifest.json'));

test('manifest is ordered, pinned, and matches every SQL byte', () => {
  assert.equal(manifest.manifestVersion, '1.0.0');
  assert.equal(manifest.postgresqlMajor, 17);
  assert.equal(manifest.interfaceAddendumSha256, '7954f152760ac0866250507803198cc42115e398664f26f47f05c420d2a4891f');
  assert.deepEqual(manifest.migrations.map(({ id }) => id), [
    '0001_roles_ledger',
    '0002_core_tables',
    '0003_rls_privileges_immutability',
    '0004_venue_service_hours'
  ]);
  for (const migration of manifest.migrations) {
    for (const direction of ['up', 'down']) assert.equal(hash(migration[direction].file), migration[direction].sha256);
  }
});

test('venue-local recurring service hours are tenant isolated and authoritative', () => {
  const sql=read('0004_venue_service_hours.up.sql');
  assert.match(sql,/CREATE TABLE venue_service_hours/);
  assert.match(sql,/day_of_week BETWEEN 0 AND 6/);
  assert.match(sql,/opens_at < closes_at/);
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/FORCE ROW LEVEL SECURITY/);
  assert.match(sql,/tenant_id = reservation_core\.current_tenant_id\(\)/);
});

test('role and ledger migration is default-deny and digest-addressed', () => {
  const sql = read('0001_roles_ledger.up.sql');
  for (const role of ['reservation_core_migration', 'core_runtime']) assert.match(sql, new RegExp(`CREATE ROLE ${role} LOGIN`));
  assert.match(sql, /NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/g);
  assert.match(sql, /REVOKE ALL ON SCHEMA reservation_core FROM PUBLIC/);
  assert.match(sql, /ALTER DEFAULT PRIVILEGES[\s\S]+REVOKE ALL ON TABLES FROM PUBLIC/);
  for (const column of ['migration_id', 'file_name', 'file_sha256', 'contract_graph_sha256']) assert.match(sql, new RegExp(column));
});

test('core table migration declares every C1A authority table and critical constraint', () => {
  const sql = read('0002_core_tables.up.sql');
  const tables = [
    'tenants', 'venues', 'service_periods', 'table_resources', 'table_groups', 'table_group_members',
    'policy_versions', 'preparations', 'reservations', 'reservation_allocations', 'accepted_terms',
    'idempotency_records', 'domain_audit_records', 'outbox_events', 'command_attempts'
  ];
  for (const table of tables) assert.match(sql, new RegExp(`CREATE TABLE ${table} \\(`));
  assert.match(sql, /EXCLUDE USING gist \(tenant_id WITH =, resource_id WITH =, occupied_range WITH &&\)/);
  assert.match(sql, /tstzrange\(occupied_start, occupied_end, '\[\)'\)/);
  assert.match(sql, /UNIQUE \(tenant_id, command_type, idempotency_key_digest\)/);
  assert.match(sql, /status IN \('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'\)/);
  assert.match(sql, /status IN \('OPEN', 'CONSUMED', 'EXPIRED', 'REVOKED'\)/);
});

test('all tenant tables receive enabled and forced RLS through one fail-closed policy', () => {
  const sql = read('0003_rls_privileges_immutability.up.sql');
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /tenant_id = reservation_core\.current_tenant_id\(\)/g);
  assert.match(sql, /current_setting\('reservation_core\.tenant_id', true\)/);
  assert.match(sql, /REVOKE ALL ON ALL TABLES IN SCHEMA reservation_core FROM PUBLIC/);
  assert.doesNotMatch(sql, /GRANT DELETE/);
  for (const table of ['policy_versions', 'accepted_terms', 'domain_audit_records', 'command_attempts']) {
    assert.match(sql, new RegExp(`CREATE TRIGGER ${table}_immutable`));
  }
});

test('constraint catalogue covers role, RLS, allocation, tenancy, idempotency, state, immutability and ledger', () => {
  const catalogue = JSON.parse(read('constraint-catalogue.json'));
  assert.equal(catalogue.postgresqlMajor, 17);
  const kinds = new Set(catalogue.authoritativeConstraints.map(({ kind }) => kind));
  for (const kind of ['role', 'rls', 'privilege', 'exclusion', 'foreign-key', 'unique', 'check', 'trigger', 'ledger']) {
    assert.ok(kinds.has(kind), `missing ${kind}`);
  }
  assert.equal(new Set(catalogue.authoritativeConstraints.map(({ id }) => id)).size, catalogue.authoritativeConstraints.length);
});

test('CLI schema and runner pin PostgreSQL 17 and fail closed', () => {
  const runner = readFileSync(resolve(root, 'src', 'db', 'reservation-core.mjs'), 'utf8');
  const schema = JSON.parse(readFileSync(resolve(root, 'contracts', 'cli', 'v1', 'migration-result.schema.json'), 'utf8'));
  assert.equal(schema.properties.postgresqlMajor.const, 17);
  assert.match(runner, /major !== 17/);
  assert.match(runner, /MIGRATION_DIGEST_MISMATCH/);
  assert.match(runner, /MIGRATION_LEDGER_MISMATCH/);
  assert.match(runner, /REQUIRED_EXTENSION_MISSING/);
  assert.match(runner, /RLS_CONFIGURATION_MISMATCH/);
  assert.match(runner, /--migrations must be absolute/);
  assert.match(runner, /--output must be absolute/);
  assert.match(runner, /pg_advisory_xact_lock/);
  assert.match(runner, /SUBCOMMAND_NOT_IMPLEMENTED/);
});
