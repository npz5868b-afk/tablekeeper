import assert from 'node:assert/strict';
import test from 'node:test';
import { applyApprovedRecovery, approveProposal, digest, proposeRecovery, ReplanningError, validateProposal } from '../../src/replanning/atomic-replanner.mjs';
import { ReservationCorePostgresAuthority } from '../../src/replanning/postgres-authority.mjs';

const T = 'tenant-a';
const NOW = '2026-09-30T10:00:00.000Z';
const base = () => ({
  tenantId: T, version: 7,
  resources: [
    { id: 'table-a', tenantId: T, capacity: 4, accessible: true, active: true },
    { id: 'table-b', tenantId: T, capacity: 4, accessible: false, active: true },
    { id: 'table-c', tenantId: T, capacity: 6, accessible: true, active: true },
    { id: 'table-d', tenantId: T, capacity: 4, accessible: true, active: true }
  ],
  reservations: [
    { id: 'r1', tenantId: T, version: 3, status: 'CONFIRMED', partySize: 4, accessibilityRequired: true, preferredResourceIds: ['table-a'], resourceId: 'table-a', start: '2026-10-01T18:00:00Z', end: '2026-10-01T19:30:00Z' },
    { id: 'r2', tenantId: T, version: 2, status: 'CONFIRMED', partySize: 4, accessibilityRequired: false, preferredResourceIds: ['table-b'], resourceId: 'table-b', start: '2026-10-01T18:15:00Z', end: '2026-10-01T19:15:00Z' },
    { id: 'r3', tenantId: T, version: 1, status: 'CONFIRMED', partySize: 5, accessibilityRequired: false, preferredResourceIds: ['table-c'], resourceId: 'table-c', start: '2026-10-01T19:30:00Z', end: '2026-10-01T21:00:00Z' }
  ]
});
const disruption = { tenantId: T, unavailableResourceIds: ['table-a', 'table-b'] };
const chain = (snapshot = base()) => {
  const proposal = proposeRecovery(snapshot, disruption, { now: NOW, approvalTtlMs: 60_000 });
  const validation = validateProposal(snapshot, proposal);
  const approval = approveProposal(proposal, validation, { approverId: 'manager-1', now: NOW });
  return { proposal, validation, approval };
};
const code = expected => error => error instanceof ReplanningError && error.code === expected;

class TransactionalAuthority {
  authorityType = 'reservation-core-postgresql';
  constructor(snapshot) { this.snapshot = structuredClone(snapshot); this.audit = []; }
  async transaction(tenantId, work) {
    if (tenantId !== this.snapshot.tenantId) throw new ReplanningError('TENANT_ISOLATION_VIOLATION');
    const before = structuredClone(this.snapshot), auditBefore = structuredClone(this.audit);
    const tx = {
      lockSnapshot: async expected => {
        if (expected !== this.snapshot.version) throw new ReplanningError('STALE_SNAPSHOT_VERSION');
        return structuredClone(this.snapshot);
      },
      reallocate: async change => {
        const r = this.snapshot.reservations.find(x => x.id === change.reservationId);
        if (!r || r.version !== change.expectedVersion) throw new ReplanningError('STALE_AGGREGATE_VERSION');
        const resource = this.snapshot.resources.find(x => x.id === change.toResourceId);
        if (!resource || resource.tenantId !== tenantId || !resource.active || resource.capacity < r.partySize || (r.accessibilityRequired && !resource.accessible)) throw new ReplanningError('HARD_CONSTRAINT_VIOLATION');
        if (this.snapshot.reservations.some(x => x.id !== r.id && x.status === 'CONFIRMED' && x.resourceId === resource.id && x.start < r.end && r.start < x.end)) throw new ReplanningError('ALLOCATION_OVERLAP');
        r.resourceId = resource.id; r.version++; this.snapshot.version++;
      },
      recordReplan: async event => { this.audit.push(event); }
    };
    try { return await work(tx); } catch (e) { this.snapshot = before; this.audit = auditBefore; throw e; }
  }
}

test('confirmed multi-reservation disruption yields deterministic feasible zero-cancellation recovery', () => {
  const snapshot = base();
  const before = digest(snapshot);
  const first = proposeRecovery(snapshot, disruption, { now: NOW, approvalTtlMs: 60_000 });
  const second = proposeRecovery(snapshot, disruption, { now: NOW, approvalTtlMs: 60_000 });
  assert.equal(first.proposalDigest, second.proposalDigest);
  assert.equal(digest(snapshot), before, 'planning must not mutate the snapshot');
  assert.deepEqual(first.changes, [
    { reservationId: 'r1', expectedVersion: 3, fromResourceId: 'table-a', toResourceId: 'table-c' },
    { reservationId: 'r2', expectedVersion: 2, fromResourceId: 'table-b', toResourceId: 'table-d' }
  ]);
  assert.equal(first.explanation.rationale.score[0], 0);
});

test('approved recovery applies atomically through authority', async () => {
  const snapshot = base(), authority = new TransactionalAuthority(snapshot), { proposal, validation, approval } = chain(snapshot);
  const result = await applyApprovedRecovery(authority, proposal, validation, approval, { now: NOW });
  assert.equal(result.applied, 2); assert.equal(authority.audit.length, 1);
  assert.deepEqual(authority.snapshot.reservations.slice(0, 2).map(r => r.resourceId), ['table-c', 'table-d']);
});

test('impossible recovery is rejected without cancellation', () => {
  const snapshot = base(); snapshot.resources = snapshot.resources.slice(0, 2);
  assert.throws(() => proposeRecovery(snapshot, disruption, { now: NOW }), code('RECOVERY_IMPOSSIBLE'));
});

test('time-scoped outage rejects an overlapping alternative but permits the same compatible table on a later date', () => {
  const tenantId='10000000-0000-4000-8000-000000000001';
  const table1='10000000-0000-4000-8000-000000000013',table2='10000000-0000-4000-8000-000000000016';
  const snapshot={tenantId,version:6,resources:[
    {id:table1,tenantId,capacity:4,accessible:false,active:true,version:1},
    {id:table2,tenantId,capacity:4,accessible:false,active:true,version:1}
  ],reservations:[
    {id:'5343dd88-5a64-4a53-b315-86301d177dc4',tenantId,version:1,status:'CONFIRMED',partySize:2,accessibilityRequired:false,preferredResourceIds:[],resourceId:table1,start:'2026-10-03T11:00:00.000Z',end:'2026-10-03T13:00:00.000Z'},
    {id:'061696d0-f996-4e00-8a5d-aa093b4e16e1',tenantId,version:1,status:'CONFIRMED',partySize:2,accessibilityRequired:false,preferredResourceIds:[],resourceId:table2,start:'2026-10-03T11:33:00.000Z',end:'2026-10-03T13:33:00.000Z'},
    {id:'aa1ccb24-544e-49e2-96e6-836bccd1db51',tenantId,version:1,status:'CONFIRMED',partySize:2,accessibilityRequired:false,preferredResourceIds:[],resourceId:table1,start:'2026-10-05T11:00:00.000Z',end:'2026-10-05T13:00:00.000Z'}
  ]};
  assert.throws(()=>proposeRecovery(snapshot,{tenantId,unavailableResourceIds:[table2],startsAt:'2026-10-03T11:33:00.000Z',endsAt:'2026-10-03T13:33:00.000Z'},{now:NOW}),code('RECOVERY_IMPOSSIBLE'));
  const proposal=proposeRecovery(snapshot,{tenantId,unavailableResourceIds:[table1],startsAt:'2026-10-05T11:00:00.000Z',endsAt:'2026-10-05T13:00:00.000Z'},{now:NOW});
  assert.deepEqual(proposal.changes,[{reservationId:'aa1ccb24-544e-49e2-96e6-836bccd1db51',expectedVersion:1,fromResourceId:table1,toResourceId:table2}]);
  assert.equal(validateProposal(snapshot,proposal).proposalDigest,proposal.proposalDigest);
});

test('accessibility is a hard constraint', () => {
  const snapshot = base(); snapshot.resources.find(r => r.id === 'table-c').accessible = false; snapshot.resources.find(r => r.id === 'table-d').accessible = false;
  assert.throws(() => proposeRecovery(snapshot, disruption, { now: NOW }), code('RECOVERY_IMPOSSIBLE'));
});

test('overlap and double allocation are rejected by authority', async () => {
  const snapshot = base(), authority = new TransactionalAuthority(snapshot);
  authority.snapshot.reservations.push({ id: 'block', tenantId: T, version: 1, status: 'CONFIRMED', partySize: 2, resourceId: 'table-c', start: '2026-10-01T18:00:00Z', end: '2026-10-01T19:00:00Z' });
  const before = digest(authority.snapshot);
  await assert.rejects(authority.transaction(T, tx => tx.reallocate({ reservationId: 'r1', expectedVersion: 3, toResourceId: 'table-c' })), code('ALLOCATION_OVERLAP'));
  assert.equal(digest(authority.snapshot), before);
});

test('stale snapshot version is rejected', () => {
  const snapshot = base(), { proposal } = chain(snapshot); snapshot.version++;
  assert.throws(() => validateProposal(snapshot, proposal), code('STALE_SNAPSHOT_VERSION'));
});

test('changed state between proposal and apply is rejected', async () => {
  const snapshot = base(), authority = new TransactionalAuthority(snapshot), { proposal, validation, approval } = chain(snapshot);
  authority.snapshot.resources.find(r => r.id === 'table-c').capacity = 3;
  await assert.rejects(applyApprovedRecovery(authority, proposal, validation, approval, { now: NOW }), code('CHANGED_STATE'));
});

test('stale aggregate version is rejected inside transaction', async () => {
  const snapshot = base(), authority = new TransactionalAuthority(snapshot), before = digest(authority.snapshot);
  await assert.rejects(authority.transaction(T, tx => tx.reallocate({ reservationId: 'r1', expectedVersion: 2, toResourceId: 'table-c' })), code('STALE_AGGREGATE_VERSION'));
  assert.equal(digest(authority.snapshot), before);
});

test('expired approval is rejected', async () => {
  const snapshot = base(), authority = new TransactionalAuthority(snapshot), { proposal, validation, approval } = chain(snapshot);
  await assert.rejects(applyApprovedRecovery(authority, proposal, validation, approval, { now: '2026-09-30T10:02:00Z' }), code('APPROVAL_EXPIRED'));
});

test('proposal and approval digest mismatch are rejected', async () => {
  const snapshot = base(), authority = new TransactionalAuthority(snapshot), { proposal, validation, approval } = chain(snapshot);
  proposal.changes[0].toResourceId = 'table-d';
  await assert.rejects(applyApprovedRecovery(authority, proposal, validation, approval, { now: NOW }), code('DIGEST_MISMATCH'));
});

test('manager approval rejects a forged validation digest', () => {
  const snapshot = base();
  const proposal = proposeRecovery(snapshot, disruption, { now: NOW, approvalTtlMs: 60_000 });
  const validation = { ...validateProposal(snapshot, proposal), validationDigest: digest({ forged:true }) };
  assert.throws(() => approveProposal(proposal, validation, { approverId:'manager-1', now:NOW }), code('DIGEST_MISMATCH'));
});

test('forced mid-apply failure rolls back every reservation and audit effect', async () => {
  const snapshot = base(), authority = new TransactionalAuthority(snapshot), before = digest(authority.snapshot), { proposal, validation, approval } = chain(snapshot);
  await assert.rejects(applyApprovedRecovery(authority, proposal, validation, approval, { now: NOW, failAfterChanges: 1 }), code('FORCED_MID_APPLY_FAILURE'));
  assert.equal(digest(authority.snapshot), before); assert.deepEqual(authority.audit, []);
});

test('non-PostgreSQL mutation authority is rejected', async () => {
  const snapshot = base(), { proposal, validation, approval } = chain(snapshot);
  await assert.rejects(applyApprovedRecovery({ transaction() {} }, proposal, validation, approval, { now: NOW }), code('NON_AUTHORITATIVE_APPLY_PATH'));
});

test('PostgreSQL authority issues rollback on a database exclusion failure', async () => {
  const commands = [];
  const client = {
    async query(sql) {
      commands.push(sql);
      if (sql.startsWith('SELECT version')) return { rowCount: 1, rows: [{ version: 3 }] };
      if (sql.startsWith('UPDATE reservation_core.reservation_allocations')) throw Object.assign(new Error('exclusion'), { code: '23P01' });
      return { rowCount: 1, rows: [] };
    },
    release() { commands.push('RELEASE'); }
  };
  const authority = new ReservationCorePostgresAuthority({ pool: { connect: async () => client }, readSnapshot: async () => base(), recordReplan: async () => {} });
  await assert.rejects(authority.transaction(T, tx => tx.reallocate({ reservationId: 'r1', expectedVersion: 3, toResourceId: 'table-c' })), code('ALLOCATION_OVERLAP'));
  assert.ok(commands.includes('ROLLBACK')); assert.equal(commands.at(-1), 'RELEASE'); assert.ok(!commands.includes('COMMIT'));
});
