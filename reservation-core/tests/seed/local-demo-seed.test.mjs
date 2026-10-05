import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { FIXTURE_RESTAURANTS } from '../../../concierge/src/knowledge/fixture-catalog.mjs';
import { loadSeedBundle, PostgresLocalDemoSeedRepository, SeedError } from '../../src/seed/local-demo-seed.mjs';

const descriptorPath=resolve('fixtures/local-demo/tablekeeper-platform.seed-descriptor.json');

test('versioned platform descriptor maps every catalog restaurant to one authoritative venue',async()=>{
  const bundle=await loadSeedBundle(descriptorPath),venues=bundle.fixture.venues;
  assert.equal(bundle.descriptor.fixtureSha256,'451f4cb0e0bff7164e1dc0e4466fc9e1aaedf1d138319715be646bab7d9883a6');
  assert.equal(venues.length,24);
  assert.deepEqual(new Set(venues.map(x=>x.canonicalRestaurantId)),new Set(FIXTURE_RESTAURANTS.map(x=>x.id)));
  assert.equal(new Set(venues.map(x=>x.venueId)).size,24);
  for(const venue of venues){assert.ok(venue.resources.length);assert.equal(venue.policies.length,1);assert.ok(venue.serviceHours.length);assert.ok(venue.resources.every((r,index)=>r.label===`Table ${String(index+1).padStart(2,'0')}`&&[2,4,6,8].includes(r.capacity)));}
  const kumo=venues.find(x=>x.canonicalRestaurantId==='fixture-kumo-dining');
  assert.equal(kumo.venueId,'10000000-0000-4000-8000-000000000012');
  assert.deepEqual(kumo.resources.map(({resourceId,label,version})=>({resourceId,label,version})),[
    {resourceId:'10000000-0000-4000-8000-000000000013',label:'Table 01',version:3},
    {resourceId:'10000000-0000-4000-8000-000000000016',label:'Table 02',version:3}
  ]);
});

class FixtureClient{
  constructor(fixture){this.fixture=fixture;this.commands=[];this.venueById=new Map(fixture.venues.map(v=>[v.venueId,v]));}
  async query(sql,params=[]){this.commands.push(sql);if(!sql.startsWith('SELECT ')||sql.includes('set_config'))return{rows:[]};const f=this.fixture;
    if(sql.includes('FROM reservation_core.tenants'))return{rows:[{tenantId:f.tenant.tenantId,displayName:f.tenant.displayName,createdAt:f.tenant.createdAt}]};
    const all=f.venues;
    if(sql.includes('FROM reservation_core.venues')){const v=this.venueById.get(params[1]);return{rows:v?[{venueId:v.venueId,displayName:v.displayName,timeZone:v.timeZone,createdAt:v.createdAt}]:[]};}
    if(sql.includes('FROM reservation_core.table_resources')){const r=all.flatMap(v=>v.resources).find(x=>x.resourceId===params[1]);return{rows:r?[r]:[]};}
    if(sql.includes('FROM reservation_core.table_groups')){const g=all.flatMap(v=>v.groups).find(x=>x.groupId===params[1]);return{rows:g?[{groupId:g.groupId,label:g.label,version:g.version,active:g.active}]:[]};}
    if(sql.includes('FROM reservation_core.table_group_members')){const g=all.flatMap(v=>v.groups).find(x=>x.groupId===params[1]);return{rows:g.resourceIds.slice().sort().map(resourceId=>({resourceId}))};}
    if(sql.includes('FROM reservation_core.policy_versions')){const p=all.flatMap(v=>v.policies).find(x=>x.policyVersionId===params[1]);return{rows:p?[p]:[]};}
    if(sql.includes('FROM reservation_core.venue_service_hours')){const h=all.flatMap(v=>v.serviceHours).find(x=>x.serviceHoursId===params[1]);return{rows:h?[h]:[]};}
    throw new Error(`unexpected query: ${sql}`);
  }
  release(){this.released=true;}
}

test('apply uses one tenant-scoped serializable transaction and is additive/idempotent',async()=>{
  const{fixture}=await loadSeedBundle(descriptorPath),client=new FixtureClient(fixture),repository=new PostgresLocalDemoSeedRepository({connect:async()=>client});
  const counts=await repository.apply(fixture);
  assert.equal(counts.venues,24);assert.equal(counts.policies,24);assert.ok(counts.resources>24);assert.ok(counts.serviceHours>=24);
  assert.equal(client.commands[0],'BEGIN ISOLATION LEVEL SERIALIZABLE');assert.match(client.commands[1],/set_config/);assert.equal(client.commands.at(-1),'COMMIT');
  assert.equal(client.commands.some(sql=>/TRUNCATE|DELETE FROM/i.test(sql)),false);assert.equal(client.released,true);
});

test('conflicting authoritative venue rolls back instead of overwriting state',async()=>{
  const{fixture}=await loadSeedBundle(descriptorPath),client=new FixtureClient(fixture),original=client.query.bind(client);
  client.query=async(sql,params=[])=>sql.includes('FROM reservation_core.venues')?{rows:[{venueId:params[1],displayName:'Wrong venue',timeZone:'Asia/Kuala_Lumpur',createdAt:fixture.tenant.createdAt}]}:original(sql,params);
  await assert.rejects(()=>new PostgresLocalDemoSeedRepository({connect:async()=>client}).apply(fixture),error=>error instanceof SeedError&&error.code==='SEED_STATE_MISMATCH');
  assert.equal(client.commands.at(-1),'ROLLBACK');
});
