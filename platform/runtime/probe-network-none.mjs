import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs, readJson, sha256File, workspacePath } from './common.mjs';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.output) throw new Error('--output is required');
  const workspace = resolve(args.workspace || process.cwd());
  const lock = await readJson(workspacePath(workspace, 'platform/images.lock.json'));
  const output = resolve(args.output);
  const probe = "fetch('https://example.com',{signal:AbortSignal.timeout(3000)}).then(()=>process.exit(9)).catch(()=>process.exit(0))";
  const execution = spawnSync('docker', ['run', '--rm', '--pull', 'never', '--network', 'none', lock.images.node22.reference, 'node', '--eval', probe], { encoding: 'utf8', windowsHide: true });
  const raw = `${execution.stdout ?? ''}${execution.stderr ?? ''}`;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, raw, { encoding: 'utf8', flag: 'wx' });
  const artifactDigest = `sha256:${await sha256File(output)}`;
  const result = { internetDenied: execution.status === 0, control: 'DOCKER_NETWORK_NONE', artifactPath: output, artifactDigest };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.internetDenied) process.exitCode = 1;
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
