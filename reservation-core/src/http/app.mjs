import { randomUUID } from 'node:crypto';
import { LifecycleError } from '../lifecycle/index.mjs';

const statuses = {
  VALIDATION_FAILED: 422, CONTRACT_VERSION_UNSUPPORTED: 422, AUTH_REQUIRED: 401, AUTH_FORBIDDEN: 403,
  TENANT_SCOPE_VIOLATION: 403, NOT_FOUND: 404, CONFLICT_ALLOCATION: 409, CONFLICT_STATE: 409,
  STALE_RESOURCE_SNAPSHOT: 409, IDEMPOTENCY_KEY_REUSED: 409, TOKEN_INVALID: 422, TOKEN_EXPIRED: 409,
  TOKEN_SCOPE_MISMATCH: 403, TOKEN_CONSUMED: 409, POLICY_VERSION_NOT_FOUND: 422, TERMS_NOT_ACCEPTED: 422,
  DEPENDENCY_UNAVAILABLE: 503, INTERNAL: 500
};
const replanningStatuses = { APPROVAL_REQUIRED: 422, APPROVAL_EXPIRED: 409, DIGEST_MISMATCH: 422, PROPOSAL_NOT_OPTIMAL: 409, STALE_SNAPSHOT_VERSION: 409, STALE_AGGREGATE_VERSION: 409, CHANGED_STATE: 409, ALLOCATION_OVERLAP: 409, RECOVERY_IMPOSSIBLE: 409, TENANT_ISOLATION_VIOLATION: 403, AUTH_FORBIDDEN: 403, INVALID_SNAPSHOT: 422, INVALID_DISRUPTION: 422 };

const json = (response, status, body, headers = {}) => {
  const bytes = JSON.stringify(body);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(bytes), 'Cache-Control': 'no-store', ...headers });
  response.end(bytes);
};

const readJson = async request => {
  if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new LifecycleError('VALIDATION_FAILED', 'Content-Type must be application/json');
  const chunks = []; let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1_048_576) throw new LifecycleError('VALIDATION_FAILED', 'request body too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new LifecycleError('VALIDATION_FAILED', 'invalid JSON'); }
};

function bind(body, trusted, request) {
  if (body.tenantId !== trusted.tenantId || body.actor?.actorType !== trusted.actor.actorType || body.actor?.actorId !== trusted.actor.actorId) throw new LifecycleError('TENANT_SCOPE_VIOLATION', 'request context does not match trusted context');
  if (body.commandType) {
    const key = request.headers['idempotency-key'];
    if (!key || body.idempotencyKey !== key) throw new LifecycleError('VALIDATION_FAILED', 'Idempotency-Key must match the command envelope');
  }
}

export function createReservationHttpHandler({ service, resolveTrustedContext, managerService = null, managerServiceForVenue = null, resolveManagerContext = null, allowedOrigin = 'http://localhost:4173' }) {
  if (!service || typeof resolveTrustedContext !== 'function') throw new TypeError('ReservationService and trusted context resolver required');
  return async (request, response) => {
    const origin = request.headers.origin;
    const cors = origin === allowedOrigin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    try {
      if (origin && origin !== allowedOrigin) throw new LifecycleError('AUTH_FORBIDDEN', 'origin not allowed');
      if (request.method === 'OPTIONS') {
        response.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key', 'Access-Control-Max-Age': '600' });
        return response.end();
      }
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname.startsWith('/v1/operations/') || url.pathname.startsWith('/v1/replanning/')) {
        if ((!managerService && typeof managerServiceForVenue !== 'function') || typeof resolveManagerContext !== 'function') throw new LifecycleError('NOT_FOUND', 'route not found');
        const manager = await resolveManagerContext(request);
        if (manager?.actor?.actorType !== 'MANAGER') throw new LifecycleError('AUTH_FORBIDDEN', 'manager authority required');
        if (request.method === 'GET' && url.pathname === '/v1/operations/state') {
          const venueId=url.searchParams.get('venueId');
          const scopedService=managerServiceForVenue?.(venueId)??managerService;
          if(!scopedService)throw new LifecycleError('VALIDATION_FAILED','valid venueId required');
          return json(response, 200, await scopedService.state(manager), cors);
        }
        if (request.method === 'POST' && url.pathname === '/v1/replanning/proposals') {
          const body = await readJson(request);
          if (body.tenantId !== manager.tenantId) throw new LifecycleError('TENANT_SCOPE_VIOLATION', 'request context does not match trusted context');
          if (!Array.isArray(body.unavailableResourceIds) || body.unavailableResourceIds.length < 1 || typeof body.affectedReservationId !== 'string') throw new LifecycleError('VALIDATION_FAILED', 'unavailableResourceIds and affectedReservationId required');
          const scopedService=managerServiceForVenue?.(body.venueId)??managerService;
          if(!scopedService)throw new LifecycleError('VALIDATION_FAILED','valid venueId required');
          return json(response, 200, await scopedService.propose({ tenantId:manager.tenantId, unavailableResourceIds:body.unavailableResourceIds, affectedReservationId:body.affectedReservationId }), cors);
        }
        if (request.method === 'POST' && url.pathname === '/v1/replanning/applications') {
          const body = await readJson(request);
          if (body.tenantId !== manager.tenantId) throw new LifecycleError('TENANT_SCOPE_VIOLATION', 'request context does not match trusted context');
          const scopedService=managerServiceForVenue?.(body.venueId)??managerService;
          if(!scopedService)throw new LifecycleError('VALIDATION_FAILED','valid venueId required');
          return json(response, 200, await scopedService.apply({ tenantId:manager.tenantId, actor:manager.actor, proposal:body.proposal, validation:body.validation, approved:body.approved }), cors);
        }
        throw new LifecycleError('NOT_FOUND', 'route not found');
      }
      const trusted = await resolveTrustedContext(request);
      if (!trusted?.tenantId || !trusted?.actor?.actorType || !trusted?.actor?.actorId) throw new LifecycleError('AUTH_REQUIRED', 'trusted tenant and actor context required');
      if (request.method === 'POST' && url.pathname === '/v1/availability/search') {
        const body = await readJson(request); bind(body, trusted, request); return json(response, 200, await service.searchAvailability(body), cors);
      }
      if (request.method === 'POST' && url.pathname === '/v1/reservation-preparations') {
        const body = await readJson(request); bind(body, trusted, request); return json(response, 200, await service.prepare(body), cors);
      }
      if (request.method === 'POST' && url.pathname === '/v1/reservations:confirm') {
        const body = await readJson(request); bind(body, trusted, request); return json(response, 200, await service.confirm(body), cors);
      }
      const cancelMatch=request.method==='POST'&&url.pathname.match(/^\/v1\/reservations\/([0-9a-f-]+):cancel$/i);
      if(cancelMatch){const body=await readJson(request);bind(body,trusted,request);if(body.payload?.reservationId!==cancelMatch[1])throw new LifecycleError('VALIDATION_FAILED','reservation path and command must match');return json(response,200,await service.cancel(body),cors);}
      const mapMatch=request.method==='GET'&&url.pathname.match(/^\/v1\/reservations\/([0-9a-f-]+)\/dining-map$/i);
      if(mapMatch)return json(response,200,await service.getDiningMap({tenantId:trusted.tenantId,reservationId:mapMatch[1],actorId:trusted.actor.actorId}),cors);
      const match = request.method === 'GET' && url.pathname.match(/^\/v1\/reservations\/([0-9a-f-]+)$/i);
      if (match) return json(response, 200, await service.getReservation({ tenantId: trusted.tenantId, reservationId: match[1], actorId: trusted.actor.actorId }), cors);
      throw new LifecycleError('NOT_FOUND', 'route not found');
    } catch (cause) {
      const error = cause instanceof LifecycleError ? cause : cause?.code && replanningStatuses[cause.code] ? cause : new LifecycleError('INTERNAL', 'internal failure', { cause });
      const correlationId = request.headers['x-correlation-id'] || randomUUID();
      json(response, statuses[error.code] ?? replanningStatuses[error.code] ?? 500, { code: error.code, message: error.message, retryable: error.retryable === true, correlationId }, cors);
    }
  };
}
