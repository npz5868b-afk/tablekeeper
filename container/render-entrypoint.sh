#!/bin/sh
set -eu

: "${TK_RENDER_DATABASE_URL:?TK_RENDER_DATABASE_URL is required}"
: "${TK_RUNTIME_DATABASE_PASSWORD:?TK_RUNTIME_DATABASE_PASSWORD is required}"

until pg_isready -d "$TK_RENDER_DATABASE_URL" >/dev/null 2>&1; do
  sleep 1
done

contract_digest="$(sha256sum /app/contracts/releases/2.0.0/contract-registry.json | cut -d ' ' -f 1)"
node /app/reservation-core/src/db/reservation-core.mjs migrate \
  --mode up \
  --database-url-env TK_RENDER_DATABASE_URL \
  --migrations /app/reservation-core/migrations \
  --expected-contract-graph-sha256 "$contract_digest" \
  --output /tmp/migration-result.json

printf '%s\n' "ALTER ROLE core_runtime PASSWORD :'runtime_password';" | \
  psql "$TK_RENDER_DATABASE_URL" --no-psqlrc --set ON_ERROR_STOP=1 \
    --set=runtime_password="$TK_RUNTIME_DATABASE_PASSWORD"

RESERVATION_CORE_DATABASE_URL="$(node -e '
  const url = new URL(process.env.TK_RENDER_DATABASE_URL);
  url.username = "core_runtime";
  url.password = process.env.TK_RUNTIME_DATABASE_PASSWORD;
  process.stdout.write(url.toString());
')"
export RESERVATION_CORE_DATABASE_URL

fixture_digest="$(sha256sum /app/platform/restaurant-authority.json | cut -d ' ' -f 1)"
cat > /tmp/render-seed-descriptor.json <<EOF
{
  "descriptorVersion": "1.0.0",
  "fixtureId": "tablekeeper-render-platform-v4",
  "fixturePath": "/app/platform/restaurant-authority.json",
  "fixtureSha256": "$fixture_digest",
  "randomSeed": "20261003",
  "clockInstant": "2026-10-03T00:00:00.000Z",
  "loaderBuildId": "reservation-core-local-demo-v4"
}
EOF

export TK_RENDER_RUNTIME_DATABASE_URL="$RESERVATION_CORE_DATABASE_URL"
node /app/reservation-core/src/db/reservation-core.mjs seed \
  --database-url-env TK_RENDER_RUNTIME_DATABASE_URL \
  --descriptor /tmp/render-seed-descriptor.json \
  --mode apply \
  --output /tmp/seed-result.json

node /app/reservation-core/src/http/server.mjs &
core_pid=$!
node /app/concierge/src/server.mjs &
concierge_pid=$!
node /app/frontend/server.mjs &
frontend_pid=$!

stop() {
  kill "$core_pid" "$concierge_pid" "$frontend_pid" 2>/dev/null || true
  wait "$core_pid" "$concierge_pid" "$frontend_pid" 2>/dev/null || true
}
trap stop INT TERM EXIT

while kill -0 "$core_pid" "$concierge_pid" "$frontend_pid" 2>/dev/null; do
  sleep 1
done
exit 1
