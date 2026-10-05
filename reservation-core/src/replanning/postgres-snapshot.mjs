import { randomUUID } from 'node:crypto';
import { ReplanningError } from './atomic-replanner.mjs';

const versionOf = (resources, reservations) => {
  const value = 1 + resources.reduce((sum, item) => sum + item.version, 0) + reservations.reduce((sum, item) => sum + item.version, 0);
  if (!Number.isSafeInteger(value)) throw new ReplanningError('INVALID_SNAPSHOT');
  return value;
};

export class PostgresReplanningSnapshotStore {
  constructor({ pool, venueId, buildId = 'reservation-core-operations-local' }) {
    if (!pool?.connect || !venueId) throw new TypeError('pool and venueId required');
    Object.assign(this, { pool, venueId, buildId });
  }

  async read(client, tenantId, { expectedVersion, lock = false } = {}) {
    const suffix = lock ? ' FOR UPDATE' : '';
    const resourceResult = await client.query(`SELECT resource_id,label,capacity,active,version FROM reservation_core.table_resources WHERE tenant_id=$1 AND venue_id=$2 ORDER BY resource_id${suffix}`, [tenantId, this.venueId]);
    const reservationResult = await client.query(`SELECT r.reservation_id,r.version,r.status,r.party_size,r.starts_at,r.ends_at,a.resource_id FROM reservation_core.reservations r JOIN reservation_core.reservation_allocations a ON a.tenant_id=r.tenant_id AND a.reservation_id=r.reservation_id AND a.released_at IS NULL WHERE r.tenant_id=$1 AND r.venue_id=$2 AND r.status='CONFIRMED' ORDER BY r.starts_at,r.reservation_id${suffix}`, [tenantId, this.venueId]);
    const resources = resourceResult.rows.map(row => ({ id: row.resource_id, tenantId, label: row.label, capacity: Number(row.capacity), accessible: false, active: row.active, version: Number(row.version) }));
    const reservations = reservationResult.rows.map(row => ({ id: row.reservation_id, tenantId, version: Number(row.version), status: row.status, partySize: Number(row.party_size), accessibilityRequired: false, preferredResourceIds: [], resourceId: row.resource_id, start: new Date(row.starts_at).toISOString(), end: new Date(row.ends_at).toISOString() }));
    const snapshot = { tenantId, venueId: this.venueId, version: versionOf(resources, reservations), resources, reservations };
    if (expectedVersion !== undefined && snapshot.version !== expectedVersion) throw new ReplanningError('STALE_SNAPSHOT_VERSION');
    return snapshot;
  }

  async readState(tenantId) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await client.query("SELECT set_config('reservation_core.tenant_id', $1, true)", [tenantId]);
      const snapshot = await this.read(client, tenantId);
      await client.query('COMMIT');
      return snapshot;
    } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
    finally { client.release(); }
  }

  async recordReplan(client, tenantId, event) {
    const correlationId = randomUUID(), occurredAt = new Date().toISOString();
    for (const change of event.changes) {
      const commandId = randomUUID();
      const current = await client.query('SELECT version FROM reservation_core.reservations WHERE tenant_id=$1 AND reservation_id=$2', [tenantId, change.reservationId]);
      if (current.rowCount !== 1) throw new ReplanningError('CHANGED_STATE');
      const resultVersion = Number(current.rows[0].version);
      await client.query(`INSERT INTO reservation_core.domain_audit_records(audit_id,tenant_id,actor_type,actor_id,command_id,correlation_id,idempotency_key_digest,aggregate_type,aggregate_id,expected_version,result_version,event_type,outcome,occurred_at,contract_version,build_id) VALUES($1,$2,'MANAGER',$3,$4,$5,$6,'RESERVATION',$7,$8,$9,'RESERVATION_REALLOCATED','COMMITTED',$10,'2.0.0',$11)`, [randomUUID(), tenantId, event.approverId, commandId, correlationId, event.proposalDigest, change.reservationId, change.expectedVersion, resultVersion, occurredAt, this.buildId]);
      await client.query(`INSERT INTO reservation_core.outbox_events(event_id,tenant_id,event_type,event_version,aggregate_id,aggregate_version,command_id,idempotency_key_digest,correlation_id,actor,occurred_at,outcome,build_id,payload) VALUES($1,$2,'RESERVATION_REALLOCATED','2.0.0',$3,$4,$5,$6,$7,$8,$9,'COMMITTED',$10,$11)`, [randomUUID(), tenantId, change.reservationId, resultVersion, commandId, event.proposalDigest, correlationId, { actorType:'MANAGER', actorId:event.approverId }, occurredAt, this.buildId, { ...change, proposalDigest:event.proposalDigest, approvalDigest:event.approvalDigest }]);
    }
  }
}
