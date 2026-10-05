#!/bin/sh
set -eu

until pg_isready -d "$TK_JUDGE_BOOTSTRAP_DATABASE_URL" >/dev/null 2>&1; do
  sleep 1
done

contract_digest="$(sha256sum /app/contracts/releases/2.0.0/contract-registry.json | cut -d ' ' -f 1)"
export TK_JUDGE_BOOTSTRAP_DATABASE_URL
node /app/reservation-core/src/db/reservation-core.mjs migrate \
  --mode up \
  --database-url-env TK_JUDGE_BOOTSTRAP_DATABASE_URL \
  --migrations /app/reservation-core/migrations \
  --expected-contract-graph-sha256 "$contract_digest" \
  --output /tmp/migration-result.json

psql "$TK_JUDGE_BOOTSTRAP_DATABASE_URL" --no-psqlrc --set ON_ERROR_STOP=1 \
  --command "ALTER ROLE core_runtime PASSWORD 'tablekeeper_runtime_only';"

fixture_digest="$(sha256sum /app/platform/restaurant-authority.json | cut -d ' ' -f 1)"
cat > /tmp/judge-seed-descriptor.json <<EOF
{
  "descriptorVersion": "1.0.0",
  "fixtureId": "tablekeeper-judge-platform-v4",
  "fixturePath": "/app/platform/restaurant-authority.json",
  "fixtureSha256": "$fixture_digest",
  "randomSeed": "20261003",
  "clockInstant": "2026-10-03T00:00:00.000Z",
  "loaderBuildId": "reservation-core-local-demo-v4"
}
EOF

export TK_JUDGE_RUNTIME_DATABASE_URL="$RESERVATION_CORE_DATABASE_URL"
node /app/reservation-core/src/db/reservation-core.mjs seed \
  --database-url-env TK_JUDGE_RUNTIME_DATABASE_URL \
  --descriptor /tmp/judge-seed-descriptor.json \
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

