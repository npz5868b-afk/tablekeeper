import { readFile } from 'node:fs/promises';
import { parseArgs, SHA256_HEX } from '../runtime/common.mjs';

export function validateReadiness(document, expectedContractGraphSha256) {
  const errors = [];
  const requiredChecks = new Set(['postgresql-major', 'migration-digests', 'required-extensions', 'runtime-role', 'rls', 'tenant-context-reset', 'domain-query']);
  if (document?.documentVersion !== '1.0.0') errors.push('documentVersion must be 1.0.0');
  if (document?.component !== 'reservation-core') errors.push('component must be reservation-core');
  if (!['READY', 'NOT_READY'].includes(document?.status)) errors.push('status must be READY or NOT_READY');
  if (!SHA256_HEX.test(document?.contractGraphSha256 ?? '')) errors.push('contractGraphSha256 must be lowercase SHA-256');
  if (document?.contractGraphSha256 !== expectedContractGraphSha256) errors.push('contract graph digest mismatch');
  if (!Array.isArray(document?.checks) || document.checks.length === 0) errors.push('checks must be non-empty');
  else for (const [index, check] of document.checks.entries()) {
    if (typeof check.name !== 'string' || !check.name) errors.push(`checks[${index}].name is required`);
    if (check.status !== 'PASS') errors.push(`checks[${index}] did not PASS`);
    if (typeof check.reasonCode !== 'string' || !check.reasonCode) errors.push(`checks[${index}].reasonCode is required`);
    if (typeof check.observedFact !== 'string' || !check.observedFact) errors.push(`checks[${index}].observedFact is required`);
    requiredChecks.delete(check.name);
  }
  if (requiredChecks.size) errors.push(`required checks missing: ${[...requiredChecks].sort().join(', ')}`);
  if (new Set((document?.checks ?? []).map((check) => check.name)).size !== (document?.checks ?? []).length) errors.push('check names must be unique');
  if (document?.status !== 'READY') errors.push('top-level readiness is not READY');
  return errors;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args['expected-contract-graph-sha256']) throw new Error('--input and --expected-contract-graph-sha256 are required');
  const document = JSON.parse(await readFile(args.input, 'utf8'));
  const errors = validateReadiness(document, args['expected-contract-graph-sha256']);
  process.stdout.write(`${JSON.stringify({ result: errors.length ? 'FAIL' : 'PASS', errors }, null, 2)}\n`);
  if (errors.length) process.exitCode = 1;
}
if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
