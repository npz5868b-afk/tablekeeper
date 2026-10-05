import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs, sha256File, workspacePath } from '../runtime/common.mjs';
import { runPreflight } from '../runtime/preflight.mjs';

async function listFiles(root, relative = 'platform') {
  const output = [];
  async function walk(path) { for (const entry of (await readdir(path, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) { const child=resolve(path,entry.name); if (entry.isDirectory()) await walk(child); else if (entry.isFile() && !child.endsWith('c2a-validation.json')) output.push({ path: child.slice(root.length + 1).replaceAll('\\','/'), sha256: await sha256File(child) }); } }
  await walk(resolve(root, relative)); return output;
}

async function main() {
  const args=parseArgs(process.argv.slice(2)); const workspace=resolve(args.workspace || process.cwd()); const output=resolve(args.output || workspacePath(workspace,'platform/evidence/c2a-validation.json'));
  const coreImage='reservation-core:test@sha256:' + '1'.repeat(64);
  const preflight=await runPreflight({workspace,coreImage,checkDocker:false});
  const tests=spawnSync(process.execPath,['--test',workspacePath(workspace,'platform/tests/platform.test.mjs')],{cwd:workspace,encoding:'utf8',windowsHide:true});
  const docker=spawnSync('docker',['version','--format','{{.Server.Version}}'],{encoding:'utf8',windowsHide:true});
  const lock=JSON.parse(await readFile(workspacePath(workspace,'platform/images.lock.json'),'utf8'));
  const composeEnv={...process.env,TK_CORE_IMAGE:coreImage,TK_POSTGRES_IMAGE:lock.images.postgres17.reference,TK_NODE_IMAGE:lock.images.node22.reference,TK_CONTRACT_GRAPH_SHA256:lock.pins.contractGraphSha256,TK_POSTGRES_BOOTSTRAP_PASSWORD_FILE:workspacePath(workspace,'platform/images.lock.json'),TK_MIGRATION_DATABASE_URL_FILE:workspacePath(workspace,'platform/images.lock.json'),TK_RUNTIME_DATABASE_URL_FILE:workspacePath(workspace,'platform/images.lock.json'),TK_STAGING_DIR:workspacePath(workspace,'platform'),TK_FINAL_EVIDENCE_DIR:workspacePath(workspace,'platform/evidence'),TK_ENVIRONMENT_DIGEST:'2'.repeat(64),TK_SEED_INPUT_DIR:workspacePath(workspace,'platform'),TK_SEED_DESCRIPTOR_CONTAINER_PATH:'/fixtures/c2/seed-descriptor.json',TK_EXECUTION_ID:'00000000-0000-4000-8000-000000000000',TK_BUILD_ID:'validation'};
  const compose=docker.status===0?spawnSync('docker',['compose','--project-name','tablekeeper-c2','--file',workspacePath(workspace,'platform/compose.c2.yaml'),'--profile','core-operations','--profile','evidence','config','--quiet'],{cwd:workspace,env:composeEnv,encoding:'utf8',windowsHide:true}):{status:null,stdout:'',stderr:'Docker unavailable'};
  const imageChecks=docker.status===0?[lock.images.postgres17.reference,lock.images.node22.reference].map((reference)=>{const result=spawnSync('docker',['image','inspect',reference,'--format','{{json .RepoDigests}}'],{encoding:'utf8',windowsHide:true});return{reference,result:result.status===0?'PASS':'FAIL',exitCode:result.status,observedRepoDigests:result.stdout.trim(),stderr:result.stderr};}):[];
  const localDockerPass=docker.status===0&&compose.status===0&&imageChecks.every((item)=>item.result==='PASS');
  const evidence={documentVersion:'1.0.0',generatedAt:new Date().toISOString(),result:preflight.result==='PASS'&&tests.status===0&&localDockerPass?'PASS':'FAIL',checks:{immutablePreflight:preflight,negativeCapabilityTests:{result:tests.status===0?'PASS':'FAIL',exitCode:tests.status,stdout:tests.stdout,stderr:tests.stderr},dockerBoundary:{result:docker.status===0?'AVAILABLE':'BLOCKED',exitCode:docker.status,stdout:docker.stdout,stderr:docker.stderr},composeConfig:{result:compose.status===0?'PASS':'FAIL',exitCode:compose.status,stdout:compose.stdout,stderr:compose.stderr},lockedLocalImages:imageChecks,externalReservationCoreImage:{result:'BLOCKED',reason:'C2A correctly requires a W1-built digest-pinned image; no placeholder image was created.'}},sourceFiles:await listFiles(workspace)};
  await mkdir(dirname(output),{recursive:true}); await writeFile(output,`${JSON.stringify(evidence,null,2)}\n`,{flag:'wx'}); process.stdout.write(`${JSON.stringify({result:evidence.result,output,dockerBoundary:evidence.checks.dockerBoundary.result},null,2)}\n`); if(evidence.result!=='PASS') process.exitCode=1;
}
main().catch((error)=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
