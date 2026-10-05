import { chmod, copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { parseArgs, readJson, sha256File, SHA256_HEX } from '../runtime/common.mjs';

const DIGEST = /^(?:sha256:)?([0-9a-f]{64})$/;
const safeRelative = (value) => typeof value === 'string' && value.length > 0 && !value.includes('\\') && !value.startsWith('/') && !value.split('/').includes('..');
const digestHex = (value) => DIGEST.exec(value ?? '')?.[1];
function within(root, path) { const r = resolve(root); const p = resolve(path); return p === r || p.startsWith(`${r}${sep}`); }

async function copyTree(source, target) {
  await mkdir(target, { recursive: true });
  for (const entry of (await readdir(source, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw new Error(`symbolic links are forbidden in staging: ${entry.name}`);
    const from = resolve(source, entry.name); const to = resolve(target, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else if (entry.isFile()) { await mkdir(dirname(to), { recursive: true }); await copyFile(from, to); }
    else throw new Error(`unsupported staging entry: ${entry.name}`);
  }
}

export async function projectEvidence({ staging, output, environmentDigest }) {
  if (!SHA256_HEX.test(environmentDigest ?? '')) throw new Error('environment digest must be lowercase SHA-256');
  const input = resolve(staging); const destination = resolve(output);
  if (within(input, destination) || within(destination, input)) throw new Error('staging and output must be disjoint');
  try { await stat(destination); throw new Error('output must not already exist'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const tests = await readJson(resolve(input, 'test-execution-candidates.json'));
  const artifacts = await readJson(resolve(input, 'artifact-candidates.json'));
  if (tests?.documentVersion !== '1.0.0' || !Array.isArray(tests.candidates)) throw new Error('invalid test-execution-candidates/v1 document');
  if (artifacts?.documentVersion !== '1.0.0' || !Array.isArray(artifacts.candidates)) throw new Error('invalid artifact-candidates/v1 document');
  await copyTree(input, resolve(destination, 'raw/proofs'));
  const finalArtifacts = [];
  for (const [index, candidate] of artifacts.candidates.entries()) {
    if (!safeRelative(candidate.path) || typeof candidate.mediaType !== 'string' || !candidate.mediaType) throw new Error(`invalid artifact candidate ${index}`);
    const expected = digestHex(candidate.sha256); if (!expected) throw new Error(`invalid artifact digest ${index}`);
    const source = resolve(input, candidate.path); if (!within(input, source)) throw new Error(`artifact path escapes staging: ${candidate.path}`);
    const actual = await sha256File(source); if (actual !== expected) throw new Error(`artifact digest mismatch: ${candidate.path}`);
    finalArtifacts.push({ path: `raw/proofs/${candidate.path}`, sha256: actual, mediaType: candidate.mediaType, readOnlyRetained: true });
  }
  for (const name of ['test-execution-candidates.json', 'artifact-candidates.json']) finalArtifacts.push({ path: `raw/proofs/${name}`, sha256: await sha256File(resolve(input, name)), mediaType: 'application/json', readOnlyRetained: true });
  const finalTests = tests.candidates.map((candidate, index) => {
    for (const name of ['testId', 'executionId', 'startedAt', 'finishedAt', 'result']) if (typeof candidate[name] !== 'string' || !candidate[name]) throw new Error(`test candidate ${index} missing ${name}`);
    const definition = digestHex(candidate.testDefinitionDigest); if (!definition) throw new Error(`invalid test definition digest ${index}`);
    if (candidate.environmentDigest !== undefined && digestHex(candidate.environmentDigest) !== environmentDigest) throw new Error(`environment digest mismatch ${index}`);
    if (!['PASS', 'FAIL', 'SKIP'].includes(candidate.result) || !Array.isArray(candidate.artifactPaths) || candidate.artifactPaths.length === 0 || candidate.artifactPaths.some((p) => !safeRelative(p))) throw new Error(`invalid test candidate ${index}`);
    return { testId: candidate.testId, testDefinitionDigest: `sha256:${definition}`, executionId: candidate.executionId, startedAt: candidate.startedAt, finishedAt: candidate.finishedAt, environmentDigest: `sha256:${environmentDigest}`, result: candidate.result, artifactPaths: candidate.artifactPaths.map((p) => `raw/proofs/${p}`), ...(candidate.observedFact === undefined ? {} : { observedFact: candidate.observedFact }), ...(candidate.interpretation === undefined ? {} : { interpretation: candidate.interpretation }) };
  });
  finalArtifacts.sort((a, b) => a.path.localeCompare(b.path)); finalTests.sort((a, b) => a.testId.localeCompare(b.testId));
  await writeFile(resolve(destination, 'test-execution-evidence.json'), `${JSON.stringify(finalTests, null, 2)}\n`, { flag: 'wx' });
  await writeFile(resolve(destination, 'artifact-evidence.json'), `${JSON.stringify(finalArtifacts, null, 2)}\n`, { flag: 'wx' });
  const files = [];
  async function retain(path) { for (const entry of await readdir(path, { withFileTypes: true })) { const child = resolve(path, entry.name); if (entry.isDirectory()) await retain(child); else { await chmod(child, 0o444); files.push(relative(destination, child).replaceAll('\\', '/')); } } await chmod(path, 0o555); }
  await retain(destination);
  return { documentVersion: '1.0.0', result: 'PASS', output: destination, retainedFiles: files.sort() };
}

async function main() { const args = parseArgs(process.argv.slice(2)); if (!args.staging || !args.output || !args['environment-digest']) throw new Error('--staging, --output, and --environment-digest are required'); process.stdout.write(`${JSON.stringify(await projectEvidence({ staging: args.staging, output: args.output, environmentDigest: args['environment-digest'] }), null, 2)}\n`); }
if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
