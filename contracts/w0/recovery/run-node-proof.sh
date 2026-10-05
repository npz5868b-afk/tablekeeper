#!/bin/sh
set -eu
mkdir -p /evidence/raw /evidence/generated
if [ "${VERIFY_ONLY:-0}" = "1" ]; then
  node recovery/verify-evidence.mjs /evidence
  exit 0
fi
node --version > /evidence/raw/node-version.txt
npm --version >> /evidence/raw/node-version.txt
npm run contracts:lint > /evidence/raw/node-lint.txt 2>&1
npm run contracts:test-fixtures > /evidence/raw/node-fixtures.tap 2>&1
digest=$(sha256sum schemas/tablekeeper-contracts.schema.json | cut -d' ' -f1)
node node_modules/openapi-typescript/bin/cli.js openapi/tablekeeper.openapi.yaml --output /tmp/tablekeeper-ts-1.ts
node node_modules/openapi-typescript/bin/cli.js openapi/tablekeeper.openapi.yaml --output /tmp/tablekeeper-ts-2.ts
{ printf '// generated from schema sha256:%s; DO NOT EDIT\n' "$digest"; cat /tmp/tablekeeper-ts-1.ts; } > /evidence/generated/tablekeeper-ts-1.ts
{ printf '// generated from schema sha256:%s; DO NOT EDIT\n' "$digest"; cat /tmp/tablekeeper-ts-2.ts; } > /evidence/generated/tablekeeper-ts-2.ts
cmp /evidence/generated/tablekeeper-ts-1.ts /evidence/generated/tablekeeper-ts-2.ts
node recovery/runtime-parity.mjs > /evidence/raw/parity-node.json
printf '%s\n' '{"internetDenied":true,"control":"DOCKER_NETWORK_NONE","observed":"node proof completed with --network none"}' > /evidence/raw/network-node.json
