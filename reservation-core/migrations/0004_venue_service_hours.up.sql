SET ROLE reservation_core_migration;
SET search_path = reservation_core, pg_catalog;

CREATE TABLE venue_service_hours (
  service_hours_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  venue_id uuid NOT NULL,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opens_at time without time zone NOT NULL,
  closes_at time without time zone NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  active boolean NOT NULL DEFAULT true,
  CHECK (opens_at < closes_at),
  UNIQUE (tenant_id, service_hours_id),
  UNIQUE (tenant_id, venue_id, day_of_week, opens_at, closes_at),
  FOREIGN KEY (tenant_id, venue_id) REFERENCES venues(tenant_id, venue_id)
);

ALTER TABLE venue_service_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_service_hours FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON venue_service_hours
  USING (tenant_id = reservation_core.current_tenant_id())
  WITH CHECK (tenant_id = reservation_core.current_tenant_id());

REVOKE ALL ON venue_service_hours FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON venue_service_hours TO core_runtime;

RESET ROLE;
