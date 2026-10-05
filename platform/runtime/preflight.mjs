import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DIGEST_REFERENCE, SHA256_HEX, assertFile, parseArgs, readJson, sha256File, workspacePath } from './common.mjs';

export async function runPreflight({ workspace, coreImage, checkDocker = false }) {
  const failures = [];
  const observations = [];
  const lock = await readJson(workspacePath(workspace, 'platform/images.lock.json'));
  if (lock.lockVersion !== '1.0.0') failures.push('unsupported images lock version');
  if (lock.platform !== 'linux/amd64') failures.push('locked platform must be linux/amd64');
  const pins = {
    c0_5IntegrationReadinessSha256: 'architecture/phase1/c0.5-integration-readiness.json',
    interfaceAddendumSha256: 'reservation-core/docs/c0.5-interface-addendum.md',
    architectureGateSha256: 'architecture/phase1/architecture-gate.md',
    contractFreezeManifestSha256: 'contracts/w0/contract-freeze-manifest.json',
    contractGraphSha256: 'contracts/w0/SHA256SUMS'
  };
  for (const [name, relativePath] of Object.entries(pins)) {
    const expected = lock.pins[name];
    if (!SHA256_HEX.test(expected ?? '')) failures.push(`${name} is not a SHA-256 hex digest`);
    else {
      try {
        const actual = await sha256File(workspacePath(workspace, relativePath));
        observations.push({ type: 'pin', path: relativePath, expectedSha256: expected, actualSha256: actual });
        if (actual !== expected) failures.push(`digest mismatch: ${relativePath}`);
      } catch { failures.push(`missing pinned input: ${relativePath}`); }
    }
  }
  for (const dependency of lock.dependencyLocks) {
    const path = workspacePath(workspace, dependency.path);
    try {
      await assertFile(path);
      const actual = await sha256File(path);
      observations.push({ type: 'dependency-lock', path: dependency.path, expectedSha256: dependency.sha256, actualSha256: actual });
      if (actual !== dependency.sha256) failures.push(`dependency lock mismatch: ${dependency.path}`);
    } catch { failures.push(`missing dependency lock: ${dependency.path}`); }
  }
  for (const imageName of ['postgres17', 'node22']) {
    if (!DIGEST_REFERENCE.test(lock.images[imageName]?.reference ?? '')) failures.push(`${imageName} is not digest pinned`);
  }
  if (!DIGEST_REFERENCE.test(coreImage ?? '')) failures.push('TK_CORE_IMAGE is absent or not digest pinned');
  const references = [lock.images.postgres17.reference, lock.images.node22.reference, coreImage].filter(Boolean);
  if (checkDocker && failures.length === 0) {
    const version = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', windowsHide: true });
    if (version.status !== 0) failures.push('Docker engine is unavailable');
    for (const reference of version.status === 0 ? references : []) {
      const inspect = spawnSync('docker', ['image', 'inspect', reference, '--format', '{{json .RepoDigests}}'], { encoding: 'utf8', windowsHide: true });
      observations.push({ type: 'local-image', reference, present: inspect.status === 0 });
      if (inspect.status !== 0) failures.push(`locked image is not locally present (pull forbidden): ${reference}`);
    }
  }
  return { documentVersion: '1.0.0', result: failures.length ? 'FAIL' : 'PASS', contractGraphSha256: lock.pins.contractGraphSha256, postgresImage: lock.images.postgres17.reference, nodeImage: lock.images.node22.reference, coreImage: coreImage ?? null, observations, failures };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runPreflight({ workspace: resolve(args.workspace || process.cwd()), coreImage: args['core-image'] || process.env.TK_CORE_IMAGE, checkDocker: Boolean(args['check-docker']) });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.result !== 'PASS') process.exitCode = 1;
}
if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
