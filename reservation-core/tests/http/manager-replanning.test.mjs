import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReservationHttpHandler } from '../../src/http/app.mjs';

const tenantId='11111111-1111-4111-8111-111111111111',origin='http://localhost:4173';
const guestService={searchAvailability:async()=>({}),prepare:async()=>({}),confirm:async()=>({}),getReservation:async()=>({})};
async function run(work){
  const managerService={state:async context=>({tenantId:context.tenantId,resources:[],reservations:[]}),propose:async input=>({proposal:{tenantId:input.tenantId,proposalDigest:'p'},validation:{validationDigest:'v'}}),apply:async input=>{if(input.approved!==true)throw Object.assign(new Error('approval required'),{code:'APPROVAL_REQUIRED'});return{result:{applied:1},state:{tenantId:input.tenantId}}}};
  const handler=createReservationHttpHandler({service:guestService,resolveTrustedContext:()=>null,managerService,resolveManagerContext:req=>req.headers.authorization==='Bearer manager'?{tenantId,actor:{actorType:'MANAGER',actorId:'manager-1'}}:null,allowedOrigin:origin});
  const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));try{return await work(`http://127.0.0.1:${server.address().port}`)}finally{await new Promise(r=>server.close(r))}
}
const headers={Origin:origin,Authorization:'Bearer manager','Content-Type':'application/json'};
test('manager state and proposal use trusted tenant',()=>run(async base=>{let r=await fetch(`${base}/v1/operations/state`,{headers});assert.equal(r.status,200);assert.equal((await r.json()).tenantId,tenantId);r=await fetch(`${base}/v1/replanning/proposals`,{method:'POST',headers,body:JSON.stringify({tenantId,unavailableResourceIds:['resource-1'],affectedReservationId:'reservation-1'})});assert.equal(r.status,200);assert.equal((await r.json()).proposal.tenantId,tenantId)}));
test('manager apply requires explicit approval',()=>run(async base=>{const r=await fetch(`${base}/v1/replanning/applications`,{method:'POST',headers,body:JSON.stringify({tenantId,proposal:{},validation:{},approved:false})});assert.equal(r.status,422);assert.equal((await r.json()).code,'APPROVAL_REQUIRED')}));
test('non-manager and cross-tenant requests fail closed',()=>run(async base=>{let r=await fetch(`${base}/v1/operations/state`,{headers:{Origin:origin,Authorization:'Bearer guest'}});assert.equal(r.status,403);r=await fetch(`${base}/v1/replanning/proposals`,{method:'POST',headers,body:JSON.stringify({tenantId:'22222222-2222-4222-8222-222222222222',unavailableResourceIds:['resource-1'],affectedReservationId:'reservation-1'})});assert.equal(r.status,403)}));

test('manager operations resolve the requested venue without a default venue',async()=>{
  const requested=[];
  const managerServiceForVenue=venueId=>{requested.push(venueId);return venueId?{state:async context=>({tenantId:context.tenantId,venueId,resources:[],reservations:[]})}:null};
  const handler=createReservationHttpHandler({service:guestService,resolveTrustedContext:()=>null,managerServiceForVenue,resolveManagerContext:()=>({tenantId,actor:{actorType:'MANAGER',actorId:'manager-1'}}),allowedOrigin:origin});
  const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/operations/state?venueId=venue-b`,{headers});assert.equal(response.status,200);assert.equal((await response.json()).venueId,'venue-b');assert.deepEqual(requested,['venue-b'])}finally{await new Promise(resolve=>server.close(resolve))}
});
