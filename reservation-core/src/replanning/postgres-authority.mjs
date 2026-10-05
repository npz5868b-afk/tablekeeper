import { ReplanningError } from './atomic-replanner.mjs';

// The snapshot reader and audit writer are Reservation Core adapters. Both receive the
// same PostgreSQL client and therefore participate in the single apply transaction.
export class ReservationCorePostgresAuthority {
  authorityType = 'reservation-core-postgresql';

  constructor({ pool, readSnapshot, recordReplan }) {
    if (!pool?.connect || typeof readSnapshot !== 'function' || typeof recordReplan !== 'function') throw new TypeError('invalid PostgreSQL authority dependencies');
    this.pool = pool; this.readSnapshot = readSnapshot; this.writeAudit = recordReplan;
  }

  async transaction(tenantId, work) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query("SELECT set_config('reservation_core.tenant_id', $1, true)", [tenantId]);
      const tx = {
        lockSnapshot: async expectedVersion => this.readSnapshot(client, tenantId, { expectedVersion, lock: true }),
        reallocate: async change => {
          const locked = await client.query(
            `SELECT version FROM reservation_core.reservations
             WHERE tenant_id = $1 AND reservation_id = $2 AND status = 'CONFIRMED'
             FOR UPDATE`, [tenantId, change.reservationId]);
          if (locked.rowCount !== 1 || Number(locked.rows[0].version) !== change.expectedVersion) throw new ReplanningError('STALE_AGGREGATE_VERSION');
          const updated = await client.query(
            `UPDATE reservation_core.reservation_allocations a
                SET resource_id = $3
              WHERE a.tenant_id = $1 AND a.reservation_id = $2 AND a.released_at IS NULL
              RETURNING allocation_id`, [tenantId, change.reservationId, change.toResourceId]);
          if (updated.rowCount !== 1) throw new ReplanningError('ALLOCATION_CARDINALITY_MISMATCH');
          await client.query(
            `UPDATE reservation_core.reservations
                SET version = version + 1, updated_at = transaction_timestamp()
              WHERE tenant_id = $1 AND reservation_id = $2`, [tenantId, change.reservationId]);
        },
        recordReplan: event => this.writeAudit(client, tenantId, event)
      };
      const result = await work(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original rejection */ }
      // PostgreSQL exclusion violation: reservation_allocations_no_overlap.
      if (error?.code === '23P01') throw new ReplanningError('ALLOCATION_OVERLAP');
      if (error?.code === '40001') throw new ReplanningError('CHANGED_STATE');
      throw error;
    } finally { client.release(); }
  }
}
