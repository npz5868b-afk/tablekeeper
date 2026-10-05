import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs, readJson, workspacePath } from './common.mjs';
import { runPreflight } from './preflight.mjs';
import { validateReadiness } from '../readiness/gate.mjs';

function run(command, args, options) { const result = spawnSync(command, args, { ...options, encoding: 'utf8', windowsHide: true }); return { command: [command, ...args], status: result.status, stdout: result.stdout, stderr: result.stderr }; }
async function assertEmptyDirectory(path) { await mkdir(path, { recursive: false }).catch((error) => { if (error.code !== 'EEXIST') throw error; }); if ((await readdir(path)).length) throw new Error(`directory must be empty: ${path}`); }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ['core-image','postgres-password-file','migration-url-file','runtime-url-file','staging-dir','report'];
  for (const name of required) if (!args[name]) throw new Error(`--${name} is required`);
  const workspace = resolve(args.workspace || process.cwd()); const lock = await readJson(workspacePath(workspace, 'platform/images.lock.json'));
  const reportPath = resolve(args.report); const staging = resolve(args['staging-dir']); await assertEmptyDirectory(staging);
  const report = { documentVersion: '1.0.0', result: 'FAIL', startedAt: new Date().toISOString(), steps: [] };
  const environmentDigest = createHash('sha256').update(JSON.stringify({ coreImage: args['core-image'], postgresImage: lock.images.postgres17.reference, nodeImage: lock.images.node22.reference, pins: lock.pins })).digest('hex');
  try {
    const preflight = await runPreflight({ workspace, coreImage: args['core-image'], checkDocker: true }); report.steps.push({ name: 'preflight', result: preflight.result, detail: preflight }); if (preflight.result !== 'PASS') throw new Error('preflight failed');
    const compose = workspacePath(workspace, 'platform/compose.c2.yaml');
    const env = { ...process.env, TK_CORE_IMAGE: args['core-image'], TK_POSTGRES_IMAGE: lock.images.postgres17.reference, TK_NODE_IMAGE: lock.images.node22.reference, TK_CONTRACT_GRAPH_SHA256: lock.pins.contractGraphSha256, TK_POSTGRES_BOOTSTRAP_PASSWORD_FILE: resolve(args['postgres-password-file']), TK_MIGRATION_DATABASE_URL_FILE: resolve(args['migration-url-file']), TK_RUNTIME_DATABASE_URL_FILE: resolve(args['runtime-url-file']), TK_STAGING_DIR: staging, TK_FINAL_EVIDENCE_DIR: resolve(args['final-evidence-dir'] || `${reportPath}.evidence`), TK_ENVIRONMENT_DIGEST: environmentDigest, TK_SEED_INPUT_DIR: resolve(args['seed-input-dir'] || staging), TK_SEED_DESCRIPTOR_CONTAINER_PATH: args['seed-descriptor-container-path'] || '/fixtures/c2/seed-descriptor.json', TK_EXECUTION_ID: args['execution-id'] || '00000000-0000-4000-8000-000000000000', TK_BUILD_ID: args['build-id'] || 'UNSET' };
    const base = ['compose','--project-name','tablekeeper-c2','--file',compose];
    for (const [name, dockerArgs] of [['compose-config',[...base,'--profile','core-operations','--profile','evidence','config','--quiet']],['postgres-start',[...base,'up','--detach','--pull','never','--wait','postgres']],['migration',[...base,'--profile','core-operations','run','--rm','--no-deps','migration']],['readiness',[...base,'--profile','core-operations','run','--rm','--no-deps','readiness']]]) {
      const outcome = run('docker', dockerArgs, { cwd: workspace, env }); report.steps.push({ name, result: outcome.status === 0 ? 'PASS' : 'FAIL', exitCode: outcome.status, stdout: outcome.stdout, stderr: outcome.stderr }); if (outcome.status !== 0) throw new Error(`${name} failed`);
    }
    const readiness = JSON.parse(await readFile(resolve(staging, 'readiness.json'), 'utf8')); const errors = validateReadiness(readiness, lock.pins.contractGraphSha256); report.steps.push({ name: 'readiness-gate', result: errors.length ? 'FAIL' : 'PASS', errors }); if (errors.length) throw new Error('readiness gate failed');
    report.result = 'PASS'; report.environmentDigest = environmentDigest;
  } catch (error) { report.failure = { code: 'C2A_ORCHESTRATION_FAILED', message: error.message }; }
  report.finishedAt = new Date().toISOString(); await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' }); if (report.result !== 'PASS') process.exitCode = 1;
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
