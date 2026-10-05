import { createServer } from 'node:http';
import pg from 'pg';
import { ConfirmationTokenCodec, LifecycleError, PostgresReservationRepository, ReservationService } from '../lifecycle/index.mjs';
import { createReservationHttpHandler } from './app.mjs';
import { attachPoolErrorHandler } from './pool-safety.mjs';
import { PostgresReplanningSnapshotStore } from '../replanning/postgres-snapshot.mjs';
import { ReplanningService } from '../replanning/replanning-service.mjs';

const databaseUrl = process.env.RESERVATION_CORE_DATABASE_URL;
const tokenSecret = process.env.RESERVATION_CORE_CONFIRMATION_SECRET;
const bearerToken = process.env.RESERVATION_CORE_DEV_BEARER_TOKEN;
const trustedTenantId = process.env.RESERVATION_CORE_TENANT_ID;
const trustedActorId = process.env.RESERVATION_CORE_ACTOR_ID;
const trustedActorType = process.env.RESERVATION_CORE_ACTOR_TYPE || 'GUEST';
const managerBearerToken = process.env.RESERVATION_CORE_MANAGER_BEARER_TOKEN;
const managerActorId = process.env.RESERVATION_CORE_MANAGER_ACTOR_ID;
const operationsVenueId = process.env.RESERVATION_CORE_OPERATIONS_VENUE_ID;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!databaseUrl) throw new Error('RESERVATION_CORE_DATABASE_URL is required');
if (!tokenSecret) throw new Error('RESERVATION_CORE_CONFIRMATION_SECRET is required');
if (!bearerToken || !trustedTenantId || !trustedActorId) throw new Error('RESERVATION_CORE_DEV_BEARER_TOKEN, RESERVATION_CORE_TENANT_ID, and RESERVATION_CORE_ACTOR_ID are required');

const secret = Buffer.from(tokenSecret, 'base64');
if (secret.length < 32) throw new Error('RESERVATION_CORE_CONFIRMATION_SECRET must be base64 for at least 32 bytes');
const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
attachPoolErrorHandler(pool);
const repository = new PostgresReservationRepository(pool);
const service = new ReservationService({ repository, tokenCodec: new ConfirmationTokenCodec(secret), buildId: process.env.RESERVATION_CORE_BUILD_ID || 'reservation-core-web-local' });
const managerService = managerBearerToken && managerActorId && operationsVenueId ? new ReplanningService({ pool, snapshotStore:new PostgresReplanningSnapshotStore({ pool, venueId:operationsVenueId, buildId:process.env.RESERVATION_CORE_BUILD_ID || 'reservation-core-web-local' }) }) : null;
const managerServiceForVenue=managerBearerToken&&managerActorId?venueId=>uuidPattern.test(venueId||'')?new ReplanningService({pool,snapshotStore:new PostgresReplanningSnapshotStore({pool,venueId,buildId:process.env.RESERVATION_CORE_BUILD_ID||'reservation-core-web-local'})}):null:null;
const host = '127.0.0.1';
const port = 4180;
const resolveTrustedContext = request => {
  if (request.headers.authorization !== `Bearer ${bearerToken}`) throw new LifecycleError('AUTH_REQUIRED', 'valid bearer token required');
  return { tenantId: trustedTenantId, actor: { actorType: trustedActorType, actorId: trustedActorId } };
};
const resolveManagerContext = request => {
  if ((!managerService&&!managerServiceForVenue) || request.headers.authorization !== `Bearer ${managerBearerToken}`) throw new LifecycleError('AUTH_REQUIRED', 'valid manager bearer token required');
  return { tenantId:trustedTenantId, actor:{ actorType:'MANAGER', actorId:managerActorId } };
};
const handler = createReservationHttpHandler({ service, resolveTrustedContext, managerService, managerServiceForVenue, resolveManagerContext, allowedOrigin: process.env.RESERVATION_CORE_FRONTEND_ORIGIN || 'http://localhost:4173' });
const server = createServer(handler);

server.listen(port, host, () => process.stdout.write(`Reservation Core web boundary: http://${host}:${port}\n`));
const shutdown = () => server.close(() => pool.end().finally(() => process.exit(0)));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
