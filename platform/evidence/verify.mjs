import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs, readJson, sha256File, SHA256_HEX } from '../runtime/common.mjs';

const FROZEN_DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function verifyEvidence(root) {
  const errors = []; const base = resolve(root);
  const tests = await readJson(resolve(base, 'test-execution-evidence.json'));
  const artifacts = await readJson(resolve(base, 'artifact-evidence.json'));
  if (!Array.isArray(tests) || !Array.isArray(artifacts)) return { result: 'FAIL', errors: ['evidence projections must be arrays'] };
  for (const [i, item] of tests.entries()) {
    if (!item.testId || !FROZEN_DIGEST.test(item.testDefinitionDigest ?? '') || !FROZEN_DIGEST.test(item.environmentDigest ?? '') || !UUID.test(item.executionId ?? '') || !String(item.startedAt ?? '').endsWith('Z') || !String(item.finishedAt ?? '').endsWith('Z') || !['PASS','FAIL','SKIP'].includes(item.result) || !Array.isArray(item.artifactPaths) || item.artifactPaths.length === 0) errors.push(`invalid TestExecutionEvidence ${i}`);
  }
  for (const [i, item] of artifacts.entries()) {
    if (!item.path?.startsWith('raw/proofs/') || !SHA256_HEX.test(item.sha256 ?? '') || !item.mediaType || item.readOnlyRetained !== true) { errors.push(`invalid ArtifactEvidence ${i}`); continue; }
    const path = resolve(base, item.path); const actual = await sha256File(path).catch(() => null); if (actual !== item.sha256) errors.push(`artifact digest mismatch: ${item.path}`);
    try { await access(path, constants.W_OK); errors.push(`artifact remains writable: ${item.path}`); } catch {}
  }
  const declared = new Set(artifacts.map((item) => item.path)); for (const test of tests) for (const path of test.artifactPaths ?? []) if (!declared.has(path)) errors.push(`test references undeclared artifact: ${path}`);
  return { documentVersion: '1.0.0', result: errors.length ? 'FAIL' : 'PASS', errors, testCount: tests.length, artifactCount: artifacts.length };
}
async function main() { const args = parseArgs(process.argv.slice(2)); if (!args.input) throw new Error('--input is required'); const result = await verifyEvidence(args.input); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (result.result !== 'PASS') process.exitCode = 1; }
if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
