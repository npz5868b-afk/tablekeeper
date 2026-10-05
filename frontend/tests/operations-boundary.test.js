import test from 'node:test';
import assert from 'node:assert/strict';
import { operationsBoundary } from '../src/operations-boundary.js';

test('operations boundary reads, proposes and applies exact authority artifacts',async()=>{
  const calls=[];globalThis.fetch=async(url,init={})=>{calls.push([url,init]);if(url.endsWith('/state'))return new Response(JSON.stringify({tenantId:'t',reservations:[]}),{status:200});if(url.endsWith('/propose'))return new Response(JSON.stringify({proposal:{proposalDigest:'d'},validation:{validationDigest:'v'}}),{status:200});return new Response(JSON.stringify({result:{applied:1},state:{reservations:[]}}),{status:200})};
  await operationsBoundary.state('venue-1');
  const proposed=await operationsBoundary.propose({tenantId:'t',venueId:'venue-1',unavailableResourceIds:['r'],affectedReservationId:'reservation-1'});
  await operationsBoundary.apply({tenantId:'t',venueId:'venue-1',proposal:proposed.proposal,validation:proposed.validation});
  assert.deepEqual(calls.map(x=>x[0]),['/operations-api/state?venueId=venue-1','/operations-api/propose','/operations-api/apply']);
  assert.equal(JSON.parse(calls[1][1].body).venueId,'venue-1');
  assert.equal(JSON.parse(calls[2][1].body).venueId,'venue-1');
  assert.equal(JSON.parse(calls[1][1].body).affectedReservationId,'reservation-1');
  assert.equal(JSON.parse(calls[2][1].body).approved,true);
});

test('operations boundary preserves retryability and never synthesizes success',async()=>{
  globalThis.fetch=async()=>new Response(JSON.stringify({code:'DEPENDENCY_UNAVAILABLE',message:'offline',retryable:true}),{status:503});
  await assert.rejects(()=>operationsBoundary.state(),error=>error.code==='DEPENDENCY_UNAVAILABLE'&&error.retryable===true);
});
