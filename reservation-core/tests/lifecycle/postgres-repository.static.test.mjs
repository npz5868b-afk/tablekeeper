import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PostgresReservationRepository } from '../../src/lifecycle/postgres-repository.mjs';

const source = readFileSync(new URL('../../src/lifecycle/postgres-repository.mjs', import.meta.url), 'utf8');

test('every repository operation is transaction scoped with local tenant context', () => {
  assert.match(source, /BEGIN ISOLATION LEVEL/);
  assert.match(source, /set_config\('reservation_core\.tenant_id', \$1, true\)/);
  assert.match(source, /COMMIT/);
  assert.match(source, /ROLLBACK/);
});

test('confirmation co-commits all authoritative records', () => {
  for (const table of ['reservations', 'reservation_allocations', 'accepted_terms', 'idempotency_records', 'domain_audit_records', 'outbox_events', 'command_attempts']) assert.match(source, new RegExp(`reservation_core\\.${table}`));
  assert.match(source, /status='CONSUMED'/);
  assert.match(source, /SERIALIZABLE/);
});

test('availability is advisory and commit relies on exclusion constraint mapping', () => {
  assert.match(source, /occupied_range && tstzrange/);
  assert.match(source, /23P01/);
  assert.match(source, /CONFLICT_ALLOCATION/);
});

test('availability is venue scoped, future only, and constrained by venue-local service hours',()=>{
  assert.match(source,/g\.venue_id = \$2/);
  assert.match(source,/\$4::timestamptz >= now\(\)/);
  assert.match(source,/reservation_core\.venue_service_hours/);
  assert.match(source,/AT TIME ZONE v\.time_zone/);
  assert.match(source,/h\.day_of_week = extract\(dow/);
  assert.match(source,/h\.opens_at/);
  assert.match(source,/h\.closes_at/);
});

test('resource snapshot equality compares PostgreSQL uuid arrays without a text-array cast', () => {
  assert.match(source, /array_agg\(m\.resource_id ORDER BY m\.resource_id\)[^;]+\)=\$3::uuid\[\]/);
  assert.doesNotMatch(source, /array_agg\(m\.resource_id ORDER BY m\.resource_id\)::text\[\]/);
});

test('pool connection acquisition failure maps to retryable dependency unavailable', async () => {
  const repository = new PostgresReservationRepository({ connect: async () => { throw new Error('connection refused'); } });
  await assert.rejects(
    repository.findAvailableCandidates('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 2, { start: '2030-01-01T19:00:00.000Z', end: '2030-01-01T20:00:00.000Z' }),
    error => error.code === 'DEPENDENCY_UNAVAILABLE' && error.retryable === true
  );
});
