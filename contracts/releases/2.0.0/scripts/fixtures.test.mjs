import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root=path.resolve(import.meta.dirname,'..');
const schema=JSON.parse(await readFile(path.join(root,'schemas/tablekeeper-contracts.schema.json'),'utf8'));
const valid=JSON.parse(await readFile(path.join(root,'fixtures/valid.json'),'utf8'));
const invalid=JSON.parse(await readFile(path.join(root,'fixtures/invalid.json'),'utf8'));
const ajv=new Ajv2020({strict:true,allErrors:true}); addFormats(ajv);
ajv.addFormat('date-time-local',/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
ajv.addFormat('iana-time-zone',/^[A-Za-z_]+(?:\/[A-Za-z_+-]+)+$/);
const validator = ref => ajv.compile({$ref:ref,$defs:schema.$defs});

for (const c of valid.cases) test(c.id,()=>assert.equal(validator(c.schema)(c.value),true,JSON.stringify(validator(c.schema).errors)));
for (const c of invalid.cases.filter(x=>x.kind==='schema')) test(c.id,()=>assert.equal(validator(c.schema)(c.value),false,'dangerous invalid fixture unexpectedly accepted'));

const semantic = {
  'range-order': v => Date.parse(v.start)<Date.parse(v.end),
  'token-ttl': v => Date.parse(v.issuedAt)<Date.parse(v.expiresAt) && Date.parse(v.expiresAt)<=Date.parse(v.preparationExpiresAt),
  'tenant-match': v => v.commandTenantId===v.subjectTenantId,
  'same-key-arbitration': v => v.committedCount===1 && v.replayCount===v.sameFingerprintContenders-1 && v.mismatchCode==='IDEMPOTENCY_KEY_REUSED',
  'consumed-token-replay': v => v.firstReservationId===v.replayReservationId && v.eventCount===1 && v.otherKeyCode==='TOKEN_CONSUMED',
  'stale-group-snapshot': v => v.preparedGroupVersion===v.commitGroupVersion,
  'rls-pool-reset': v => v.crossTenantRows===0 && v.contextAfterRelease===null,
  'approval-binding': v => v.approvalProposalDigest===v.applyProposalDigest && v.approvalValidationDigest===v.applyValidationDigest && v.approvalSnapshotVersion===v.applySnapshotVersion,
  'outbox-atomicity': v => v.domainCommitted===v.outboxCommitted,
  'manifest-hashes': v => v.missing===0 && v.mismatch===0,
  'reservation-transition': v => ({CONFIRMED:['CANCELLED','COMPLETED','NO_SHOW'],CANCELLED:[],COMPLETED:[],NO_SHOW:[]}[v.from]??[]).includes(v.to),
  'if-match-equals-body': v => v.ifMatchVersion===v.expectedVersion,
  'retrieval-prefilter': v => v.returned.every(x=>x.tenantId===v.tenantId && x.aclAllowed && x.validFrom<=v.asOf && (x.validTo===null||v.asOf<x.validTo)),
  'attempt-outbox-separation': v => v.outboxOutcome==='COMMITTED' && ['ACCEPTED','REJECTED','ROLLED_BACK','UNKNOWN_RESPONSE'].includes(v.attemptOutcome),
  'retrieval-source-consistency': v => v.sources.every(x=>x.tenantId===v.tenantId && x.aclAllowed && !x.tombstoned && x.validFrom<=v.asOf && (x.validTo===null||v.asOf<x.validTo)),
  'replan-exact-binding': v => v.proposalDigest===v.validationProposalDigest && v.proposalDigest===v.approvalProposalDigest && v.validationDigest===v.approvalValidationDigest && v.snapshotId===v.applySnapshotId && v.snapshotVersion===v.applySnapshotVersion,
  'evidence-complete-links': v => v.testArtifacts.every(x=>v.artifacts.includes(x)) && v.artifacts.includes(v.networkArtifact) && v.readOnlyRetained
};
for (const c of invalid.cases.filter(x=>x.kind==='semantic')) test(c.id,()=>assert.equal(semantic[c.assertion](c.value),false,`${c.assertion} dangerous case unexpectedly passed`));
test('coverage C01-C12 positive and dangerous negative',()=>{for(let i=1;i<=12;i++){const id=`C${String(i).padStart(2,'0')}`;assert(valid.cases.some(x=>x.contract===id||x.id.includes(id)),`missing positive ${id}`);assert(invalid.cases.some(x=>x.contract===id||x.id.includes(id)),`missing negative ${id}`)}}); 
test('C09 frozen pre-ranking filter and provenance binding',()=>{
  const trace=valid.cases.find(x=>x.id==='V-C09-TRACE').value;
  assert.equal(trace.filterAppliedBeforeRanking,true);
  for(const source of trace.sourceVersions){assert.equal(source.tenantId,trace.tenantId);assert.equal(source.tombstoned,false);assert(Date.parse(source.validFrom)<=Date.parse(trace.asOf));assert(source.validTo===null||Date.parse(trace.asOf)<Date.parse(source.validTo))}
  for(const citation of trace.citations){assert.equal(citation.tenantId,trace.tenantId);assert.equal(citation.retrievalTraceId,trace.traceId);assert(citation.spanStart<citation.spanEnd)}
});
test('C10 exact proposal-validation binding',()=>{
  const pkg=valid.cases.find(x=>x.id==='V-C10-PLAN').value;
  assert.equal(pkg.validation.proposalDigest,pkg.proposal.proposalDigest);
  assert.equal(pkg.validation.snapshotId,pkg.proposal.snapshotId);
  assert.equal(pkg.validation.snapshotVersion,pkg.proposal.snapshotVersion);
});
test('C12 execution, network, artifact and retention links',()=>{
  const m=valid.cases.find(x=>x.id==='V-C12-MANIFEST').value;
  const paths=new Set(m.artifacts.map(x=>x.path));
  assert(paths.has(m.networkControl.artifactPath));
  for(const execution of m.tests) for(const p of execution.artifactPaths) assert(paths.has(p));
  assert.equal(m.retentionPolicy.mode,'READ_ONLY');
  assert(m.artifacts.every(x=>x.readOnlyRetained===true));
});
