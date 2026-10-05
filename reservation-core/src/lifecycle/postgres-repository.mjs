import { LifecycleError } from './errors.mjs';

const asError = error => {
  if (error instanceof LifecycleError) return error;
  if (error?.code === '23P01' || error?.code === '23505') return new LifecycleError('CONFLICT_ALLOCATION', 'allocation conflict', { cause: error });
  if (error?.code === '40001' || error?.code === '40P01') return new LifecycleError('CONFLICT_STATE', 'concurrent state change', { retryable: true, cause: error });
  return new LifecycleError('DEPENDENCY_UNAVAILABLE', 'reservation database unavailable', { retryable: true, cause: error });
};

export class PostgresReservationRepository {
  constructor(pool) {
    if (!pool?.connect) throw new TypeError('PostgreSQL pool required');
    this.pool = pool;
  }

  async scoped(tenantId, work, isolation = 'READ COMMITTED') {
    let client;
    try {
      client = await this.pool.connect();
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await client.query("SELECT set_config('reservation_core.tenant_id', $1, true)", [tenantId]);
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      if (client) try { await client.query('ROLLBACK'); } catch { /* preserve original */ }
      throw asError(error);
    } finally { client?.release(); }
  }

  async findAvailableCandidates(tenantId, venueId, partySize, timeRange) {
    return this.scoped(tenantId, async client => {
      const result = await client.query(`
        SELECT array_agg(m.resource_id ORDER BY m.resource_id) AS resource_ids
          FROM reservation_core.table_groups g
          JOIN reservation_core.venues v
            ON v.tenant_id = g.tenant_id AND v.venue_id = g.venue_id
          JOIN reservation_core.table_group_members m
            ON m.tenant_id = g.tenant_id AND m.group_id = g.group_id AND m.group_version = g.version
          JOIN reservation_core.table_resources r
            ON r.tenant_id = m.tenant_id AND r.resource_id = m.resource_id
         WHERE g.tenant_id = $1 AND g.venue_id = $2 AND g.active AND r.active
           AND $4::timestamptz >= now()
           AND ($4::timestamptz AT TIME ZONE v.time_zone)::date = ($5::timestamptz AT TIME ZONE v.time_zone)::date
           AND EXISTS (
             SELECT 1 FROM reservation_core.venue_service_hours h
              WHERE h.tenant_id = g.tenant_id AND h.venue_id = g.venue_id AND h.active
                AND h.day_of_week = extract(dow FROM ($4::timestamptz AT TIME ZONE v.time_zone))::smallint
                AND ($4::timestamptz AT TIME ZONE v.time_zone)::time >= h.opens_at
                AND ($5::timestamptz AT TIME ZONE v.time_zone)::time <= h.closes_at
           )
         GROUP BY g.group_id, g.version
        HAVING sum(r.capacity) >= $3
           AND bool_and(NOT EXISTS (
             SELECT 1 FROM reservation_core.reservation_allocations a
              WHERE a.tenant_id = $1 AND a.resource_id = m.resource_id AND a.released_at IS NULL
                AND a.occupied_range && tstzrange($4::timestamptz, $5::timestamptz, '[)')
           ))
         ORDER BY min(g.label)`, [tenantId, venueId, partySize, timeRange.start, timeRange.end]);
      return result.rows.map(row => row.resource_ids);
    });
  }

  async getRequiredPolicy(tenantId, venueId) {
    return this.scoped(tenantId, async client => {
      const result = await client.query(`
        SELECT policy_version_id, canonical_content_digest, rendered_terms_artifact
          FROM reservation_core.policy_versions
         WHERE tenant_id = $1 AND (venue_id = $2 OR venue_id IS NULL) AND category = 'BOOKING_CANCELLATION'
         ORDER BY (venue_id IS NOT NULL) DESC, published_at DESC LIMIT 1`, [tenantId, venueId]);
      if (!result.rowCount) return null;
      return { policyVersionId: result.rows[0].policy_version_id, termsDigest: result.rows[0].canonical_content_digest, termsArtifact: result.rows[0].rendered_terms_artifact };
    });
  }

  async createPreparation(tenantId, input) {
    return this.scoped(tenantId, async client => {
      const prior = await client.query(`SELECT request_fingerprint, result_envelope FROM reservation_core.idempotency_records WHERE tenant_id=$1 AND command_type=$2 AND idempotency_key_digest=$3 FOR UPDATE`, [tenantId, input.commandType, input.idempotencyKeyDigest]);
      if (prior.rowCount) {
        if (prior.rows[0].request_fingerprint !== input.requestFingerprint) throw new LifecycleError('IDEMPOTENCY_KEY_REUSED');
        return prior.rows[0].result_envelope;
      }
      const group = await client.query(`SELECT g.group_id,g.version FROM reservation_core.table_groups g WHERE g.tenant_id=$1 AND g.venue_id=$2 AND g.active AND (SELECT array_agg(m.resource_id ORDER BY m.resource_id) FROM reservation_core.table_group_members m WHERE m.tenant_id=g.tenant_id AND m.group_id=g.group_id AND m.group_version=g.version)=$3::uuid[] LIMIT 1`, [tenantId, input.venueId, input.resourceIds]);
      if (!group.rowCount) throw new LifecycleError('STALE_RESOURCE_SNAPSHOT');
      const response = { preparationId: input.preparationId, tenantId, venueId: input.venueId, partySize: input.partySize, requestedRange: input.timeRange, resolvedResourceSnapshot: { groupId: group.rows[0].group_id, groupVersion: Number(group.rows[0].version), resourceIds: input.resourceIds }, policyVersionIds: [input.policy.policyVersionId], termsDigest: input.policy.termsDigest, termsArtifact: input.policy.termsArtifact, createdAt: input.createdAt, expiresAt: input.expiresAt, status: 'OPEN', confirmationToken: input.confirmationToken };
      await client.query(`INSERT INTO reservation_core.preparations(preparation_id,tenant_id,venue_id,party_size,requested_start,requested_end,group_id,group_version,resolved_resource_ids,policy_version_ids,terms_digest,terms_artifact,status,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'OPEN',$13,$14)`, [input.preparationId, tenantId, input.venueId, input.partySize, input.timeRange.start, input.timeRange.end, group.rows[0].group_id, group.rows[0].version, input.resourceIds, [input.policy.policyVersionId], input.policy.termsDigest, input.policy.termsArtifact, input.createdAt, input.expiresAt]);
      await client.query(`INSERT INTO reservation_core.idempotency_records(idempotency_record_id,tenant_id,command_type,idempotency_key_digest,request_fingerprint,status,result_envelope,response_contract_version,created_at,finalized_at) VALUES(gen_random_uuid(),$1,$2,$3,$4,'SUCCEEDED',$5,'2.0.0',$6,$6)`, [tenantId, input.commandType, input.idempotencyKeyDigest, input.requestFingerprint, response, input.createdAt]);
      return response;
    }, 'SERIALIZABLE');
  }

  async findCommandResult(tenantId, commandType, idempotencyKeyDigest) {
    return this.scoped(tenantId, async client => {
      const result = await client.query(`SELECT request_fingerprint,result_envelope FROM reservation_core.idempotency_records WHERE tenant_id=$1 AND command_type=$2 AND idempotency_key_digest=$3 AND status='SUCCEEDED'`, [tenantId, commandType, idempotencyKeyDigest]);
      return result.rowCount ? { requestFingerprint: result.rows[0].request_fingerprint, result: result.rows[0].result_envelope } : null;
    });
  }

  async confirm(tenantId, input) {
    return this.scoped(tenantId, async client => {
      const commandType = 'CONFIRM_RESERVATION';
      const prior = await client.query(`SELECT request_fingerprint,result_envelope FROM reservation_core.idempotency_records WHERE tenant_id=$1 AND command_type=$2 AND idempotency_key_digest=$3 FOR UPDATE`, [tenantId, commandType, input.idempotencyKeyDigest]);
      if (prior.rowCount) {
        if (prior.rows[0].request_fingerprint !== input.requestFingerprint) throw new LifecycleError('IDEMPOTENCY_KEY_REUSED');
        return prior.rows[0].result_envelope;
      }
      const prepResult = await client.query(`SELECT * FROM reservation_core.preparations WHERE tenant_id=$1 AND preparation_id=$2 FOR UPDATE`, [tenantId, input.claims.preparationId]);
      if (!prepResult.rowCount) throw new LifecycleError('TOKEN_INVALID');
      const prep = prepResult.rows[0];
      if (prep.status === 'CONSUMED') throw new LifecycleError('TOKEN_CONSUMED');
      if (prep.status !== 'OPEN') throw new LifecycleError('CONFLICT_STATE');
      if (new Date(prep.expires_at) <= new Date(input.now)) throw new LifecycleError('TOKEN_EXPIRED');
      const sameIds = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
      if (prep.venue_id !== input.claims.venueId || Number(prep.party_size) !== input.claims.partySize ||
          new Date(prep.requested_start).toISOString() !== input.claims.timeRange.start || new Date(prep.requested_end).toISOString() !== input.claims.timeRange.end ||
          prep.terms_digest !== input.claims.termsDigest || !sameIds(prep.policy_version_ids, input.claims.policyVersionIds) || !sameIds(prep.resolved_resource_ids, input.claims.proposedResourceIds)) throw new LifecycleError('TOKEN_SCOPE_MISMATCH');
      const snapshot = await client.query(`SELECT g.version,(SELECT array_agg(m.resource_id ORDER BY m.resource_id) FROM reservation_core.table_group_members m WHERE m.tenant_id=g.tenant_id AND m.group_id=g.group_id AND m.group_version=g.version) resource_ids FROM reservation_core.table_groups g WHERE g.tenant_id=$1 AND g.group_id=$2 AND g.active FOR UPDATE`, [tenantId, prep.group_id]);
      if (!snapshot.rowCount || Number(snapshot.rows[0].version) !== Number(prep.group_version) || !sameIds(snapshot.rows[0].resource_ids, prep.resolved_resource_ids)) throw new LifecycleError('STALE_RESOURCE_SNAPSHOT');
      const reservationId = input.reservationId();
      await client.query(`INSERT INTO reservation_core.reservations(reservation_id,tenant_id,venue_id,preparation_id,status,party_size,starts_at,ends_at,created_at,updated_at) VALUES($1,$2,$3,$4,'CONFIRMED',$5,$6,$7,$8,$8)`, [reservationId, tenantId, prep.venue_id, prep.preparation_id, prep.party_size, prep.requested_start, prep.requested_end, input.now]);
      for (const resourceId of prep.resolved_resource_ids) await client.query(`INSERT INTO reservation_core.reservation_allocations(allocation_id,tenant_id,reservation_id,resource_id,occupied_start,occupied_end) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5)`, [tenantId, reservationId, resourceId, prep.requested_start, prep.requested_end]);
      for (const term of input.acceptedTerms) await client.query(`INSERT INTO reservation_core.accepted_terms(accepted_terms_id,tenant_id,reservation_id,policy_version_id,terms_digest,terms_artifact,accepted_at,accepted_by_type,accepted_by_id,acceptance_channel) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9)`, [tenantId, reservationId, term.policyVersionId, term.termsDigest, prep.terms_artifact, term.acceptedAt, term.acceptedBy.actorType, term.acceptedBy.actorId, term.acceptanceChannel ?? 'API']);
      await client.query(`UPDATE reservation_core.preparations SET status='CONSUMED',consumed_at=$3,version=version+1 WHERE tenant_id=$1 AND preparation_id=$2`, [tenantId, prep.preparation_id, input.now]);
      const logical = { reservationId, status: 'CONFIRMED', version: 1 };
      await client.query(`INSERT INTO reservation_core.idempotency_records(idempotency_record_id,tenant_id,command_type,idempotency_key_digest,request_fingerprint,status,result_envelope,aggregate_id,aggregate_version,response_contract_version,created_at,finalized_at) VALUES(gen_random_uuid(),$1,$2,$3,$4,'SUCCEEDED',$5,$6,1,'2.0.0',$7,$7)`, [tenantId, commandType, input.idempotencyKeyDigest, input.requestFingerprint, logical, reservationId, input.now]);
      await client.query(`INSERT INTO reservation_core.domain_audit_records(audit_id,tenant_id,actor_type,actor_id,command_id,correlation_id,idempotency_key_digest,aggregate_type,aggregate_id,result_version,event_type,outcome,occurred_at,contract_version,build_id) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,'RESERVATION',$7,1,'RESERVATION_CONFIRMED','COMMITTED',$8,'2.0.0',$9)`, [tenantId, input.command.actor.actorType, input.command.actor.actorId, input.command.commandId, input.command.correlationId, input.idempotencyKeyDigest, reservationId, input.now, input.buildId]);
      await client.query(`INSERT INTO reservation_core.outbox_events(event_id,tenant_id,event_type,event_version,aggregate_id,aggregate_version,command_id,idempotency_key_digest,correlation_id,actor,occurred_at,outcome,build_id,payload) VALUES($1,$2,'RESERVATION_CONFIRMED','2.0.0',$3,1,$4,$5,$6,$7,$8,'COMMITTED',$9,$10)`, [input.eventId(), tenantId, reservationId, input.command.commandId, input.idempotencyKeyDigest, input.command.correlationId, input.command.actor, input.now, input.buildId, logical]);
      await client.query(`INSERT INTO reservation_core.command_attempts(attempt_id,tenant_id,actor,command_id,correlation_id,idempotency_key_digest,request_fingerprint,build_id,outcome,recorded_at) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,'ACCEPTED',$8)`, [tenantId, input.command.actor, input.command.commandId, input.command.correlationId, input.idempotencyKeyDigest, input.requestFingerprint, input.buildId, input.now]);
      return logical;
    }, 'SERIALIZABLE');
  }

  async getReservation(tenantId, reservationId, actorId) {
    return this.scoped(tenantId, async client => {
      const result = await client.query(`SELECT r.*,v.display_name, array_agg(DISTINCT a.resource_id)::text[] resource_ids, jsonb_agg(DISTINCT jsonb_build_object('policyVersionId',t.policy_version_id,'termsDigest',t.terms_digest,'acceptedAt',to_char(t.accepted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'acceptedBy',jsonb_build_object('actorType',t.accepted_by_type,'actorId',t.accepted_by_id),'acceptanceChannel',t.acceptance_channel)) accepted_terms FROM reservation_core.reservations r JOIN reservation_core.venues v ON v.tenant_id=r.tenant_id AND v.venue_id=r.venue_id JOIN reservation_core.reservation_allocations a ON a.tenant_id=r.tenant_id AND a.reservation_id=r.reservation_id JOIN reservation_core.accepted_terms t ON t.tenant_id=r.tenant_id AND t.reservation_id=r.reservation_id WHERE r.tenant_id=$1 AND r.reservation_id=$2 AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM reservation_core.accepted_terms own WHERE own.tenant_id=r.tenant_id AND own.reservation_id=r.reservation_id AND own.accepted_by_type='GUEST' AND own.accepted_by_id=$3)) GROUP BY r.reservation_id,v.display_name`, [tenantId, reservationId, actorId??null]);
      if (!result.rowCount) return null;
      const row = result.rows[0];
      return { reservationId: row.reservation_id, venueName:row.display_name, status: row.status, version: Number(row.version), partySize: Number(row.party_size), timeRange: { start: new Date(row.starts_at).toISOString(), end: new Date(row.ends_at).toISOString() }, acceptedTerms: row.accepted_terms, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),cancelledAt:row.cancelled_at?new Date(row.cancelled_at).toISOString():null };
    });
  }

  async cancel(tenantId,input){
    return this.scoped(tenantId,async client=>{
      const commandType='CANCEL_RESERVATION';
      const prior=await client.query(`SELECT request_fingerprint,result_envelope FROM reservation_core.idempotency_records WHERE tenant_id=$1 AND command_type=$2 AND idempotency_key_digest=$3 FOR UPDATE`,[tenantId,commandType,input.idempotencyKeyDigest]);
      if(prior.rowCount){if(prior.rows[0].request_fingerprint!==input.requestFingerprint)throw new LifecycleError('IDEMPOTENCY_KEY_REUSED');return prior.rows[0].result_envelope;}
      const current=await client.query(`SELECT r.reservation_id,r.status,r.version FROM reservation_core.reservations r WHERE r.tenant_id=$1 AND r.reservation_id=$2 AND EXISTS (SELECT 1 FROM reservation_core.accepted_terms own WHERE own.tenant_id=r.tenant_id AND own.reservation_id=r.reservation_id AND own.accepted_by_type='GUEST' AND own.accepted_by_id=$3) FOR UPDATE`,[tenantId,input.reservationId,input.command.actor.actorId]);
      if(!current.rowCount)throw new LifecycleError('NOT_FOUND');
      const row=current.rows[0];
      if(row.status!=='CONFIRMED'&&row.status!=='CANCELLED')throw new LifecycleError('CONFLICT_STATE');
      if(row.status==='CONFIRMED'){
        await client.query(`UPDATE reservation_core.reservations SET status='CANCELLED',cancelled_at=$3,updated_at=$3,version=version+1 WHERE tenant_id=$1 AND reservation_id=$2`,[tenantId,input.reservationId,input.now]);
        await client.query(`UPDATE reservation_core.reservation_allocations SET released_at=$3 WHERE tenant_id=$1 AND reservation_id=$2 AND released_at IS NULL`,[tenantId,input.reservationId,input.now]);
      }
      const version=row.status==='CONFIRMED'?Number(row.version)+1:Number(row.version),logical={reservationId:input.reservationId,status:'CANCELLED',version};
      await client.query(`INSERT INTO reservation_core.idempotency_records(idempotency_record_id,tenant_id,command_type,idempotency_key_digest,request_fingerprint,status,result_envelope,aggregate_id,aggregate_version,response_contract_version,created_at,finalized_at) VALUES(gen_random_uuid(),$1,$2,$3,$4,'SUCCEEDED',$5,$6,$7,'2.0.0',$8,$8)`,[tenantId,commandType,input.idempotencyKeyDigest,input.requestFingerprint,logical,input.reservationId,version,input.now]);
      if(row.status==='CONFIRMED'){
        await client.query(`INSERT INTO reservation_core.domain_audit_records(audit_id,tenant_id,actor_type,actor_id,command_id,correlation_id,idempotency_key_digest,aggregate_type,aggregate_id,expected_version,result_version,event_type,outcome,occurred_at,contract_version,build_id) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,'RESERVATION',$7,$8,$9,'RESERVATION_CANCELLED','COMMITTED',$10,'2.0.0',$11)`,[tenantId,input.command.actor.actorType,input.command.actor.actorId,input.command.commandId,input.command.correlationId,input.idempotencyKeyDigest,input.reservationId,Number(row.version),version,input.now,input.buildId]);
        await client.query(`INSERT INTO reservation_core.outbox_events(event_id,tenant_id,event_type,event_version,aggregate_id,aggregate_version,command_id,idempotency_key_digest,correlation_id,actor,occurred_at,outcome,build_id,payload) VALUES($1,$2,'RESERVATION_CANCELLED','2.0.0',$3,$4,$5,$6,$7,$8,$9,'COMMITTED',$10,$11)`,[input.eventId(),tenantId,input.reservationId,version,input.command.commandId,input.idempotencyKeyDigest,input.command.correlationId,input.command.actor,input.now,input.buildId,logical]);
      }
      return logical;
    },'SERIALIZABLE');
  }

  async getDiningMap(tenantId,reservationId,actorId){
    return this.scoped(tenantId,async client=>{
      const reservation=await client.query(`SELECT r.reservation_id,r.venue_id,r.status,r.party_size,r.starts_at,r.ends_at,v.display_name FROM reservation_core.reservations r JOIN reservation_core.venues v ON v.tenant_id=r.tenant_id AND v.venue_id=r.venue_id WHERE r.tenant_id=$1 AND r.reservation_id=$2 AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM reservation_core.accepted_terms own WHERE own.tenant_id=r.tenant_id AND own.reservation_id=r.reservation_id AND own.accepted_by_type='GUEST' AND own.accepted_by_id=$3))`,[tenantId,reservationId,actorId??null]);
      if(!reservation.rows[0])return null;
      const resources=await client.query(`SELECT tr.resource_id,tr.label,tr.capacity,tr.active,(a.resource_id IS NOT NULL) allocated FROM reservation_core.table_resources tr LEFT JOIN reservation_core.reservation_allocations a ON a.tenant_id=tr.tenant_id AND a.reservation_id=$2 AND a.resource_id=tr.resource_id AND a.released_at IS NULL WHERE tr.tenant_id=$1 AND tr.venue_id=$3 AND tr.active ORDER BY tr.label,tr.resource_id`,[tenantId,reservationId,reservation.rows[0].venue_id]);
      return {reservation:reservation.rows[0],resources:resources.rows};
    });
  }
}
