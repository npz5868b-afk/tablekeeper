import { createHash, timingSafeEqual } from 'node:crypto';

export class ReplanningError extends Error {
  constructor(code, message = code) { super(message); this.code = code; }
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export const digest = value => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const overlap = (a, b) => a.start < b.end && b.start < a.end;

function validateSnapshot(snapshot) {
  if (!snapshot?.tenantId || !Number.isSafeInteger(snapshot.version) || snapshot.version < 1) throw new ReplanningError('INVALID_SNAPSHOT');
  const resources = new Map(snapshot.resources.map(r => [r.id, r]));
  if (resources.size !== snapshot.resources.length) throw new ReplanningError('INVALID_SNAPSHOT');
  for (const reservation of snapshot.reservations) {
    if (reservation.tenantId !== snapshot.tenantId) throw new ReplanningError('TENANT_ISOLATION_VIOLATION');
    if (!Number.isSafeInteger(reservation.version) || reservation.version < 1 || reservation.start >= reservation.end) throw new ReplanningError('INVALID_SNAPSHOT');
  }
  return resources;
}

function feasible(reservation, resource, unavailableFor, assigned) {
  if (!resource || resource.tenantId !== reservation.tenantId || !resource.active || unavailableFor(reservation, resource.id)) return false;
  if (resource.capacity < reservation.partySize || (reservation.accessibilityRequired && !resource.accessible)) return false;
  return !assigned.some(a => a.resourceId === resource.id && overlap(reservation, a));
}

function preferencePenalty(reservation, resource) {
  return reservation.preferredResourceIds?.includes(resource.id) ? 0 : 1;
}

function score(assignments, reservations, original, resources) {
  let moved = 0, preference = 0;
  for (const r of reservations) {
    const id = assignments.get(r.id);
    if (id !== original.get(r.id)) moved++;
    preference += preferencePenalty(r, resources.get(id));
  }
  const stable = reservations.map(r => `${r.id}:${assignments.get(r.id)}`).join('|');
  return [0, moved, preference, stable];
}

const compare = (a, b) => {
  for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; }
  return 0;
};

export function proposeRecovery(snapshot, disruption, { now, approvalTtlMs = 300000 } = {}) {
  const resources = validateSnapshot(snapshot);
  if (disruption.tenantId !== snapshot.tenantId) throw new ReplanningError('TENANT_ISOLATION_VIOLATION');
  const unavailable = new Set([...disruption.unavailableResourceIds].sort());
  for (const id of unavailable) if (!resources.has(id) || resources.get(id).tenantId !== snapshot.tenantId) throw new ReplanningError('TENANT_ISOLATION_VIOLATION');
  const scoped = disruption.startsAt !== undefined || disruption.endsAt !== undefined;
  if (scoped && (!disruption.startsAt || !disruption.endsAt || disruption.startsAt >= disruption.endsAt)) throw new ReplanningError('INVALID_DISRUPTION');
  const unavailableFor = scoped
    ? (reservation, resourceId) => unavailable.has(resourceId) && overlap(reservation, { start:disruption.startsAt, end:disruption.endsAt })
    : (_reservation, resourceId) => unavailable.has(resourceId);
  const reservations = snapshot.reservations.filter(r => r.status === 'CONFIRMED').sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  const original = new Map(reservations.map(r => [r.id, r.resourceId]));
  const candidates = [...resources.values()].sort((a, b) => a.id.localeCompare(b.id));
  let best = null;
  const search = (index, assigned, map) => {
    if (index === reservations.length) {
      const candidate = { map: new Map(map), score: score(map, reservations, original, resources) };
      if (!best || compare(candidate.score, best.score) < 0) best = candidate;
      return;
    }
    const reservation = reservations[index];
    const ordered = candidates.slice().sort((a, b) =>
      Number(b.id === reservation.resourceId) - Number(a.id === reservation.resourceId) ||
      preferencePenalty(reservation, a) - preferencePenalty(reservation, b) || a.id.localeCompare(b.id));
    for (const resource of ordered) if (feasible(reservation, resource, unavailableFor, assigned)) {
      map.set(reservation.id, resource.id);
      assigned.push({ ...reservation, resourceId: resource.id });
      search(index + 1, assigned, map);
      assigned.pop(); map.delete(reservation.id);
    }
  };
  search(0, [], new Map());
  if (!best) throw new ReplanningError('RECOVERY_IMPOSSIBLE');
  const changes = reservations.filter(r => best.map.get(r.id) !== r.resourceId).map(r => ({
    reservationId: r.id, expectedVersion: r.version, fromResourceId: r.resourceId, toResourceId: best.map.get(r.id)
  }));
  const createdAt = new Date(now).toISOString();
  const normalizedDisruption = { tenantId: snapshot.tenantId, unavailableResourceIds: [...unavailable] };
  if (scoped) Object.assign(normalizedDisruption, { startsAt:disruption.startsAt, endsAt:disruption.endsAt });
  const proposalBody = { tenantId: snapshot.tenantId, snapshotVersion: snapshot.version, snapshotDigest: digest(snapshot), disruption: normalizedDisruption, changes };
  return {
    ...proposalBody,
    proposalDigest: digest(proposalBody),
    approvalExpiresAt: new Date(new Date(now).getTime() + approvalTtlMs).toISOString(),
    explanation: {
      changes: changes.map(c => ({ reservationId: c.reservationId, from: c.fromResourceId, to: c.toResourceId })),
      preserved: ['tenant_isolation', 'capacity_fit', 'accessibility', 'timing', 'non_overlap', 'zero_cancellations'],
      rationale: { objective: ['cancellations', 'moved_reservations', 'guest_preference_penalty', 'stable_assignment_ids'], score: best.score.slice(0, 3), tieBreak: best.score[3] }
    },
    createdAt
  };
}

export function validateProposal(snapshot, proposal) {
  validateSnapshot(snapshot);
  if (proposal.tenantId !== snapshot.tenantId) throw new ReplanningError('TENANT_ISOLATION_VIOLATION');
  if (proposal.snapshotVersion !== snapshot.version) throw new ReplanningError('STALE_SNAPSHOT_VERSION');
  if (!same(proposal.snapshotDigest, digest(snapshot))) throw new ReplanningError('CHANGED_STATE');
  const body = { tenantId: proposal.tenantId, snapshotVersion: proposal.snapshotVersion, snapshotDigest: proposal.snapshotDigest, disruption: proposal.disruption, changes: proposal.changes };
  if (!same(proposal.proposalDigest, digest(body))) throw new ReplanningError('DIGEST_MISMATCH');
  const expected = proposeRecovery(structuredClone(snapshot), proposal.disruption, { now: proposal.createdAt, approvalTtlMs: new Date(proposal.approvalExpiresAt) - new Date(proposal.createdAt) });
  if (!same(expected.proposalDigest, proposal.proposalDigest)) throw new ReplanningError('PROPOSAL_NOT_OPTIMAL');
  const validation = { tenantId: proposal.tenantId, snapshotVersion: proposal.snapshotVersion, snapshotDigest: proposal.snapshotDigest, proposalDigest: proposal.proposalDigest };
  return { ...validation, validationDigest: digest(validation) };
}

export function approveProposal(proposal, validation, { approverId, now }) {
  if (new Date(now) >= new Date(proposal.approvalExpiresAt)) throw new ReplanningError('APPROVAL_EXPIRED');
  const validationBody = { tenantId: validation.tenantId, snapshotVersion: validation.snapshotVersion, snapshotDigest: validation.snapshotDigest, proposalDigest: validation.proposalDigest };
  if (!same(validation.validationDigest, digest(validationBody)) ||
      !same(validation.proposalDigest, proposal.proposalDigest) ||
      validation.tenantId !== proposal.tenantId ||
      validation.snapshotVersion !== proposal.snapshotVersion ||
      !same(validation.snapshotDigest, proposal.snapshotDigest)) throw new ReplanningError('DIGEST_MISMATCH');
  const body = { tenantId: proposal.tenantId, snapshotVersion: proposal.snapshotVersion, snapshotDigest: proposal.snapshotDigest, proposalDigest: proposal.proposalDigest, validationDigest: validation.validationDigest, approverId, expiresAt: proposal.approvalExpiresAt };
  return { ...body, approvalDigest: digest(body) };
}

export async function applyApprovedRecovery(authority, proposal, validation, approval, { now, failAfterChanges } = {}) {
  if (authority?.authorityType !== 'reservation-core-postgresql') throw new ReplanningError('NON_AUTHORITATIVE_APPLY_PATH');
  if (new Date(now) >= new Date(approval.expiresAt)) throw new ReplanningError('APPROVAL_EXPIRED');
  const approvalBody = { tenantId: approval.tenantId, snapshotVersion: approval.snapshotVersion, snapshotDigest: approval.snapshotDigest, proposalDigest: approval.proposalDigest, validationDigest: approval.validationDigest, approverId: approval.approverId, expiresAt: approval.expiresAt };
  if (!same(approval.approvalDigest, digest(approvalBody)) || !same(approval.proposalDigest, proposal.proposalDigest) || !same(approval.validationDigest, validation.validationDigest)) throw new ReplanningError('DIGEST_MISMATCH');
  return authority.transaction(proposal.tenantId, async tx => {
    const current = await tx.lockSnapshot(proposal.snapshotVersion);
    validateProposal(current, proposal);
    for (let i = 0; i < proposal.changes.length; i++) {
      await tx.reallocate(proposal.changes[i]);
      if (failAfterChanges === i + 1) throw new ReplanningError('FORCED_MID_APPLY_FAILURE');
    }
    await tx.recordReplan({ proposalDigest: proposal.proposalDigest, approvalDigest: approval.approvalDigest, approverId: approval.approverId, changes: proposal.changes, explanation: proposal.explanation });
    return { applied: proposal.changes.length, proposalDigest: proposal.proposalDigest };
  });
}
