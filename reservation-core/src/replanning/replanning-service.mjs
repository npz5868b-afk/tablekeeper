import { applyApprovedRecovery, approveProposal, proposeRecovery, validateProposal } from './atomic-replanner.mjs';
import { ReservationCorePostgresAuthority } from './postgres-authority.mjs';

export class ReplanningService {
  constructor({ pool, snapshotStore, clock = () => new Date() }) {
    if (!pool || !snapshotStore) throw new TypeError('pool and snapshotStore required');
    this.store = snapshotStore; this.clock = clock;
    this.authority = new ReservationCorePostgresAuthority({ pool, readSnapshot: (...args) => snapshotStore.read(...args), recordReplan: (...args) => snapshotStore.recordReplan(...args) });
  }
  state({ tenantId }) { return this.store.readState(tenantId); }
  async propose({ tenantId, unavailableResourceIds, affectedReservationId }) {
    const snapshot = await this.store.readState(tenantId);
    const affected = snapshot.reservations.find(reservation => reservation.id === affectedReservationId);
    if (!affected || !unavailableResourceIds.includes(affected.resourceId)) throw Object.assign(new Error('affected reservation must have an unavailable allocated resource'), { code:'INVALID_DISRUPTION' });
    const proposal = proposeRecovery(snapshot, { tenantId, unavailableResourceIds, startsAt:affected.start, endsAt:affected.end }, { now: this.clock().toISOString() });
    return { proposal, validation: validateProposal(snapshot, proposal) };
  }
  async apply({ tenantId, actor, proposal, validation, approved }) {
    if (approved !== true) throw Object.assign(new Error('explicit manager approval required'), { code:'APPROVAL_REQUIRED' });
    if (proposal?.tenantId !== tenantId || actor?.actorType !== 'MANAGER') throw Object.assign(new Error('manager authority required'), { code:'AUTH_FORBIDDEN' });
    const now = this.clock().toISOString();
    const approval = approveProposal(proposal, validation, { approverId: actor.actorId, now });
    const result = await applyApprovedRecovery(this.authority, proposal, validation, approval, { now });
    return { result, approval, state: await this.store.readState(tenantId) };
  }
}
