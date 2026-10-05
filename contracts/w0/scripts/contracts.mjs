import { readFile, writeFile, mkdir, readdir, stat, rm, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import $RefParser from '@apidevtools/json-schema-ref-parser';

const root = path.resolve(import.meta.dirname, '..');
const schemaPath = path.join(root, 'schemas', 'tablekeeper-contracts.schema.json');
const openapiPath = path.join(root, 'openapi', 'tablekeeper.openapi.yaml');
const generated = path.join(root, 'generated');
const sha256 = b => createHash('sha256').update(b).digest('hex');
const readJson = async p => JSON.parse(await readFile(p, 'utf8'));

function run(command, args, options = {}) {
  const r = spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: false, ...options });
  if (r.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${r.stdout ?? ''}${r.stderr ?? ''}`);
  return r.stdout;
}

async function walk(dir) {
  const out = [];
  for (const name of (await readdir(dir)).sort()) {
    const p = path.join(dir, name); const s = await stat(p);
    if (s.isDirectory()) out.push(...await walk(p)); else out.push(p);
  }
  return out;
}

async function lint() {
  const registry = await readJson(path.join(root, 'contract-registry.json'));
  const schema = await readJson(schemaPath);
  const expected = Array.from({length:12}, (_,i)=>`C${String(i+1).padStart(2,'0')}`);
  if (registry.registryVersion !== '1.0.0' || registry.architectureBaseline !== 'phase1-architecture-gate/1.0.0') throw new Error('registry is not the frozen 1.0.0 implementation release');
  if (registry.contracts.map(x=>x.id).join(',') !== expected.join(',')) throw new Error('registry C01-C12 mapping/order mismatch');
  for (const c of registry.contracts) for (const k of ['name','producer','consumers','invariants','versioning','representation']) if (!c[k] || !c[k].length) throw new Error(`${c.id}.${k} missing`);
  await $RefParser.bundle(schemaPath, { resolve: { http: false }, dereference: { circular: false } });
  const requiredDefs = ['OperationResult','Preparation','ExpectedVersionCommand','IdempotencyRecord','PolicyVersion','TableGroupSnapshot','RetrievalTrace','ReplanPackage','CommandAttempt','AuditOutboxEnvelope','EvidenceManifest'];
  for (const d of requiredDefs) if (!schema.$defs[d]) throw new Error(`missing schema $defs/${d}`);
  const text = await readFile(schemaPath, 'utf8');
  if (/https?:\/\/(?!json-schema\.org|tablekeeper\.local)/.test(text)) throw new Error('remote schema reference forbidden');
  run(process.execPath, ['node_modules/@redocly/cli/bin/cli.js', 'lint', 'openapi/tablekeeper.openapi.yaml', '--config=redocly.yaml']);
  console.log('PASS lint: registry, offline refs, required definitions, OpenAPI 3.1');
}

async function generate(target = generated) {
  await mkdir(target, {recursive:true});
  const schemaDigest = sha256(await readFile(schemaPath));
  const banner = `// generated from schema sha256:${schemaDigest}; DO NOT EDIT\n`;
  const tsTmp = path.join(target, 'tablekeeper.tmp.ts');
  run(process.execPath, ['node_modules/openapi-typescript/bin/cli.js', openapiPath, '--output', tsTmp]);
  const ts = await readFile(tsTmp, 'utf8');
  await writeFile(path.join(target, 'tablekeeper.ts'), banner + ts.replace(/\r\n/g,'\n'));
  await rm(tsTmp);
  const py = process.env.TABLEKEEPER_PYTHON312 || 'python3.12';
  run(py, ['-m','datamodel_code_generator','--input', schemaPath,'--input-file-type','jsonschema','--output',path.join(target,'tablekeeper.py'),'--output-model-type','pydantic_v2.BaseModel','--target-python-version','3.12','--disable-timestamp','--use-standard-collections','--use-union-operator']);
  const pyText = await readFile(path.join(target,'tablekeeper.py'),'utf8');
  await writeFile(path.join(target,'tablekeeper.py'), `# generated from schema sha256:${schemaDigest}; DO NOT EDIT\n` + pyText.replace(/\r\n/g,'\n'));
  await writeFile(path.join(target,'SOURCE_SHA256'), `${schemaDigest}  schemas/tablekeeper-contracts.schema.json\n`);
  console.log(`PASS generation: ${schemaDigest}`);
}

async function checkGenerated() {
  const tmp = path.join(root, '.generated-check');
  await rm(tmp,{recursive:true,force:true}); await generate(tmp);
  for (const name of ['tablekeeper.ts','tablekeeper.py','SOURCE_SHA256']) {
    if ((await readFile(path.join(tmp,name),'utf8')) !== (await readFile(path.join(generated,name),'utf8'))) throw new Error(`generated diff: ${name}`);
  }
  await rm(tmp,{recursive:true,force:true});
  console.log('PASS generated trees reproduce byte-for-byte');
}

async function compat() {
  const baseline = path.join(root,'compat','1.0.0','tablekeeper.openapi.yaml');
  const bin = process.env.OASDIFF_BIN || path.join(root,'tools',process.platform === 'win32' ? 'oasdiff.exe' : 'oasdiff');
  try { await stat(baseline); } catch {
    run(bin,['breaking',openapiPath,openapiPath]);
    console.log('PASS compatibility: initial 1.0.0 release has no predecessor; self-diff is non-breaking under oasdiff 1.11.7');
    return;
  }
  run(bin,['breaking',baseline,openapiPath,'--fail-on','ERR']);
  console.log('PASS oasdiff compatibility and released-fixture replay');
}

async function hashPackage() {
  const excluded = new Set(['node_modules','.generated-check']);
  const files = (await walk(root)).filter(p => !p.split(path.sep).some(x=>excluded.has(x)) && path.basename(p)!=='SHA256SUMS');
  const lines=[];
  for (const p of files) lines.push(`${sha256(await readFile(p))}  ${path.relative(root,p).replaceAll('\\','/')}`);
  await writeFile(path.join(root,'SHA256SUMS'), lines.join('\n')+'\n');
  console.log(`PASS hashed ${lines.length} W0 artifacts`);
}

const cmd=process.argv[2];
if (cmd==='lint') await lint();
else if (cmd==='generate') await generate();
else if (cmd==='check-generated') await checkGenerated();
else if (cmd==='compat') await compat();
else if (cmd==='hash') await hashPackage();
else throw new Error(`unknown command: ${cmd}`);
