import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs, workspacePath } from '../runtime/common.mjs';

const SERVICES = new Set(['postgres', 'migration', 'readiness', 'seed', 'prove']);
const ACTIONS = new Set(['stop', 'kill', 'disconnect', 'connect']);

export function buildInjection({ action, service, project = 'tablekeeper-c2' }) {
  if (!ACTIONS.has(action)) throw new Error(`unsupported action: ${action}`);
  if (!SERVICES.has(service)) throw new Error(`unsupported service: ${service}`);
  if (action === 'stop') return ['compose', '--project-name', project, 'stop', '--timeout', '1', service];
  if (action === 'kill') return ['compose', '--project-name', project, 'kill', '--signal', 'KILL', service];
  const container = `${project}-${service}-1`;
  const network = `${project}_database_internal`;
  return ['network', action, network, container];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = buildInjection({ action: args.action, service: args.service });
  const workspace = resolve(args.workspace || process.cwd());
  if (command[0] === 'compose') command.splice(3, 0, '--file', workspacePath(workspace, 'platform/compose.c2.yaml'));
  const result = { documentVersion: '1.0.0', mode: args.execute ? 'EXECUTE' : 'DRY_RUN', action: args.action, service: args.service, command: ['docker', ...command] };
  if (args.execute) {
    const execution = spawnSync('docker', command, { cwd: workspace, encoding: 'utf8', windowsHide: true });
    result.exitCode = execution.status;
    result.stdout = execution.stdout;
    result.stderr = execution.stderr;
    result.result = execution.status === 0 ? 'PASS' : 'FAIL';
    if (execution.status !== 0) process.exitCode = 1;
  } else result.result = 'PASS';
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
