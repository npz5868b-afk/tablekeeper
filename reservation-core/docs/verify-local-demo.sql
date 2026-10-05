\set ON_ERROR_STOP on

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT set_config('reservation_core.tenant_id', '10000000-0000-4000-8000-000000000001', true);

SELECT count(*) AS authoritative_venue_count
FROM reservation_core.venues
WHERE tenant_id = reservation_core.current_tenant_id();

SELECT v.display_name, count(r.resource_id) AS active_resource_count
FROM reservation_core.venues v
LEFT JOIN reservation_core.table_resources r
  ON r.tenant_id = v.tenant_id AND r.venue_id = v.venue_id AND r.active
WHERE v.tenant_id = reservation_core.current_tenant_id()
GROUP BY v.venue_id, v.display_name
ORDER BY v.display_name;

SELECT v.display_name,
       count(DISTINCT p.policy_version_id) AS policy_count,
       count(DISTINCT h.service_hours_id) AS active_service_hours_count
FROM reservation_core.venues v
LEFT JOIN reservation_core.policy_versions p
  ON p.tenant_id = v.tenant_id AND p.venue_id = v.venue_id
 AND p.category = 'BOOKING_CANCELLATION'
LEFT JOIN reservation_core.venue_service_hours h
  ON h.tenant_id = v.tenant_id AND h.venue_id = v.venue_id AND h.active
WHERE v.tenant_id = reservation_core.current_tenant_id()
GROUP BY v.venue_id, v.display_name
ORDER BY v.display_name;

SELECT count(*) AS kumo_reservation_count
FROM reservation_core.reservations
WHERE tenant_id = reservation_core.current_tenant_id()
  AND venue_id = '10000000-0000-4000-8000-000000000012';

COMMIT;
