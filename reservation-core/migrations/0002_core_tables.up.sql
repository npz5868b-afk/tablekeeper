SET ROLE reservation_core_migration;
SET search_path = reservation_core, pg_catalog;

CREATE TABLE tenants (
  tenant_id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  created_at timestamptz NOT NULL
);

CREATE TABLE venues (
  venue_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  time_zone text NOT NULL CHECK (length(btrim(time_zone)) > 0),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, venue_id)
);

CREATE TABLE service_periods (
  service_period_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  venue_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (starts_at < ends_at),
  UNIQUE (tenant_id, service_period_id),
  FOREIGN KEY (tenant_id, venue_id) REFERENCES venues(tenant_id, venue_id)
);

CREATE TABLE table_resources (
  resource_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  venue_id uuid NOT NULL,
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  capacity integer NOT NULL CHECK (capacity > 0),
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (tenant_id, resource_id),
  UNIQUE (tenant_id, venue_id, label),
  FOREIGN KEY (tenant_id, venue_id) REFERENCES venues(tenant_id, venue_id)
);

CREATE TABLE table_groups (
  group_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  venue_id uuid NOT NULL,
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, group_id),
  UNIQUE (tenant_id, venue_id, label),
  FOREIGN KEY (tenant_id, venue_id) REFERENCES venues(tenant_id, venue_id)
);

CREATE TABLE table_group_members (
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  group_version bigint NOT NULL CHECK (group_version >= 1),
  resource_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, group_id, group_version, resource_id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES table_groups(tenant_id, group_id),
  FOREIGN KEY (tenant_id, resource_id) REFERENCES table_resources(tenant_id, resource_id)
);

CREATE TABLE policy_versions (
  policy_version_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id),
  venue_id uuid,
  category text NOT NULL CHECK (category IN ('BOOKING_CANCELLATION', 'DEPOSIT', 'PRIVACY', 'VENUE_RULES')),
  canonical_content_digest text NOT NULL CHECK (canonical_content_digest ~ '^sha256:[0-9a-f]{64}$'),
  rendered_terms_artifact text NOT NULL CHECK (length(btrim(rendered_terms_artifact)) > 0),
  locale text NOT NULL CHECK (locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  published_at timestamptz NOT NULL,
  immutable boolean NOT NULL DEFAULT true CHECK (immutable),
  UNIQUE (tenant_id, policy_version_id),
  FOREIGN KEY (tenant_id, venue_id) REFERENCES venues(tenant_id, venue_id)
);

CREATE TABLE preparations (
  preparation_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  venue_id uuid NOT NULL,
  party_size integer NOT NULL CHECK (party_size > 0),
  requested_start timestamptz NOT NULL,
  requested_end timestamptz NOT NULL,
  group_id uuid,
  group_version bigint,
  resolved_resource_ids uuid[] NOT NULL CHECK (cardinality(resolved_resource_ids) > 0),
  policy_version_ids uuid[] NOT NULL CHECK (cardinality(policy_version_ids) > 0),
  terms_digest text NOT NULL CHECK (terms_digest ~ '^sha256:[0-9a-f]{64}$'),
  terms_artifact text NOT NULL CHECK (length(btrim(terms_artifact)) > 0),
  status text NOT NULL CHECK (status IN ('OPEN', 'CONSUMED', 'EXPIRED', 'REVOKED')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (requested_start < requested_end),
  CHECK (created_at < expires_at),
  CHECK ((group_id IS NULL) = (group_version IS NULL)),
  CHECK ((status = 'CONSUMED') = (consumed_at IS NOT NULL)),
  UNIQUE (tenant_id, preparation_id),
  FOREIGN KEY (tenant_id, venue_id) REFERENCES venues(tenant_id, venue_id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES table_groups(tenant_id, group_id)
);

CREATE TABLE reservations (
  reservation_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  venue_id uuid NOT NULL,
  preparation_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW')),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  party_size integer NOT NULL CHECK (party_size > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  cancelled_at timestamptz,
  CHECK (starts_at < ends_at),
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CHECK (updated_at >= created_at),
  UNIQUE (tenant_id, reservation_id),
  UNIQUE (tenant_id, preparation_id),
  FOREIGN KEY (tenant_id, venue_id) REFERENCES venues(tenant_id, venue_id),
  FOREIGN KEY (tenant_id, preparation_id) REFERENCES preparations(tenant_id, preparation_id)
);

CREATE TABLE reservation_allocations (
  allocation_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  occupied_start timestamptz NOT NULL,
  occupied_end timestamptz NOT NULL,
  occupied_range tstzrange GENERATED ALWAYS AS (tstzrange(occupied_start, occupied_end, '[)')) STORED,
  released_at timestamptz,
  CHECK (occupied_start < occupied_end),
  UNIQUE (tenant_id, allocation_id),
  UNIQUE (tenant_id, reservation_id, resource_id),
  FOREIGN KEY (tenant_id, reservation_id) REFERENCES reservations(tenant_id, reservation_id),
  FOREIGN KEY (tenant_id, resource_id) REFERENCES table_resources(tenant_id, resource_id),
  CONSTRAINT reservation_allocations_no_overlap
    EXCLUDE USING gist (tenant_id WITH =, resource_id WITH =, occupied_range WITH &&)
    WHERE (released_at IS NULL)
    DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE accepted_terms (
  accepted_terms_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  policy_version_id uuid NOT NULL,
  terms_digest text NOT NULL CHECK (terms_digest ~ '^sha256:[0-9a-f]{64}$'),
  terms_artifact text NOT NULL CHECK (length(btrim(terms_artifact)) > 0),
  accepted_at timestamptz NOT NULL,
  accepted_by_type text NOT NULL CHECK (accepted_by_type IN ('GUEST', 'MANAGER', 'SYSTEM')),
  accepted_by_id text NOT NULL CHECK (length(btrim(accepted_by_id)) > 0),
  acceptance_channel text NOT NULL CHECK (length(btrim(acceptance_channel)) > 0),
  UNIQUE (tenant_id, accepted_terms_id),
  UNIQUE (tenant_id, reservation_id, policy_version_id),
  FOREIGN KEY (tenant_id, reservation_id) REFERENCES reservations(tenant_id, reservation_id),
  FOREIGN KEY (tenant_id, policy_version_id) REFERENCES policy_versions(tenant_id, policy_version_id)
);

CREATE TABLE idempotency_records (
  idempotency_record_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id),
  command_type text NOT NULL CHECK (length(btrim(command_type)) > 0),
  idempotency_key_digest text NOT NULL CHECK (idempotency_key_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('IN_PROGRESS', 'SUCCEEDED', 'REJECTED')),
  result_envelope jsonb,
  aggregate_id uuid,
  aggregate_version bigint CHECK (aggregate_version IS NULL OR aggregate_version >= 1),
  response_contract_version text,
  created_at timestamptz NOT NULL,
  finalized_at timestamptz,
  lease_expires_at timestamptz,
  UNIQUE (tenant_id, idempotency_record_id),
  UNIQUE (tenant_id, command_type, idempotency_key_digest),
  CHECK ((status = 'IN_PROGRESS') = (finalized_at IS NULL)),
  CHECK (status = 'IN_PROGRESS' OR result_envelope IS NOT NULL)
);

CREATE TABLE domain_audit_records (
  audit_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  command_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  idempotency_key_digest text NOT NULL CHECK (idempotency_key_digest ~ '^sha256:[0-9a-f]{64}$'),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  expected_version bigint,
  result_version bigint NOT NULL CHECK (result_version >= 1),
  event_type text NOT NULL,
  outcome text NOT NULL CHECK (outcome = 'COMMITTED'),
  occurred_at timestamptz NOT NULL,
  contract_version text NOT NULL,
  build_id text NOT NULL,
  UNIQUE (tenant_id, audit_id)
);

CREATE TABLE outbox_events (
  event_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id),
  event_type text NOT NULL,
  event_version text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version bigint NOT NULL CHECK (aggregate_version >= 1),
  command_id uuid NOT NULL,
  idempotency_key_digest text NOT NULL CHECK (idempotency_key_digest ~ '^sha256:[0-9a-f]{64}$'),
  correlation_id uuid NOT NULL,
  actor jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome = 'COMMITTED'),
  build_id text NOT NULL,
  payload jsonb NOT NULL,
  published_at timestamptz,
  UNIQUE (tenant_id, event_id),
  UNIQUE (tenant_id, command_id, event_type)
);

CREATE TABLE command_attempts (
  attempt_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id),
  actor jsonb NOT NULL,
  command_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  idempotency_key_digest text NOT NULL CHECK (idempotency_key_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  build_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('ACCEPTED', 'REJECTED', 'ROLLED_BACK', 'UNKNOWN_RESPONSE')),
  reason_code text,
  recorded_at timestamptz NOT NULL,
  UNIQUE (tenant_id, attempt_id),
  UNIQUE (tenant_id, command_id, attempt_id)
);

RESET ROLE;
