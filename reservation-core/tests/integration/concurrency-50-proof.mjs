import {createServer} from "node:http";
import {randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import {writeFile} from "node:fs/promises";
import pg from "pg";
import {ConfirmationTokenCodec,PostgresReservationRepository,ReservationService} from "../../src/lifecycle/index.mjs";
import {createReservationHttpHandler} from "../../src/http/app.mjs";

const databaseUrl=process.env.TK_PROOF_DATABASE_URL;
if(process.env.TK_PROOF_ALLOW_DISPOSABLE!=="YES"||!databaseUrl)throw Error("Refusing to run without TK_PROOF_ALLOW_DISPOSABLE=YES and TK_PROOF_DATABASE_URL");
const parsed=new URL(databaseUrl);
if(!["127.0.0.1","localhost"].includes(parsed.hostname))throw Error("Proof database must be loopback-isolated");
const concurrency=50,tenantId="10000000-0000-4000-8000-000000000001",venueId="20000000-0000-4000-8000-000000000003",partySize=8;
const pool=new pg.Pool({connectionString:databaseUrl,max:55});
const service=new ReservationService({repository:new PostgresReservationRepository(pool),tokenCodec:new ConfirmationTokenCodec(Buffer.alloc(32,29)),buildId:"concurrency-50-proof"});
const handler=createReservationHttpHandler({service,resolveTrustedContext:request=>({tenantId,actor:{actorType:"GUEST",actorId:String(request.headers["x-proof-client"]||"")}})});
const server=createServer(handler);await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const endpoint=`http://127.0.0.1:${server.address().port}`;
const now=()=>new Date().toISOString();
const local=new Date(Date.now()+8*3600_000+5*86400_000),start=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),11,0));
const requestedRange={start:start.toISOString(),end:new Date(+start+90*60_000).toISOString()};
const actor=index=>({actorType:"GUEST",actorId:`proof-client-${String(index+1).padStart(2,"0")}`});
const command=(index,commandType,payload)=>({contract:{contractId:"C04",contractVersion:"2.0.0"},tenantId,commandId:randomUUID(),idempotencyKey:randomUUID(),correlationId:randomUUID(),issuedAt:now(),actor:actor(index),commandType,payload});
const post=async(path,body,index)=>{try{const response=await fetch(endpoint+path,{method:"POST",headers:{"content-type":"application/json","idempotency-key":body.idempotencyKey,"x-proof-client":actor(index).actorId},body:JSON.stringify(body)});return{status:response.status,body:await response.json()}}catch(error){return{status:0,body:{code:"NETWORK_FAILURE",message:error.message}}}};
const tenantRead=async(sql,values=[])=>{const client=await pool.connect();try{await client.query("BEGIN READ ONLY");await client.query("SELECT set_config('reservation_core.tenant_id',$1,true)",[tenantId]);const result=await client.query(sql,values);await client.query("COMMIT");return result}finally{client.release()}};
const counts=async()=>{const result=await tenantRead(`SELECT
  count(DISTINCT r.reservation_id) FILTER (WHERE r.status='CONFIRMED')::int confirmed_reservations,
  count(DISTINCT a.allocation_id) FILTER (WHERE a.released_at IS NULL)::int active_conflicting_allocations
FROM reservation_core.reservations r
LEFT JOIN reservation_core.reservation_allocations a ON a.tenant_id=r.tenant_id AND a.reservation_id=r.reservation_id
WHERE r.tenant_id=$1 AND r.venue_id=$2 AND tstzrange(r.starts_at,r.ends_at,'[)') && tstzrange($3::timestamptz,$4::timestamptz,'[)')`,[tenantId,venueId,requestedRange.start,requestedRange.end]);return result.rows[0]};
try{
  const initial=await counts();if(initial.confirmed_reservations!==0||initial.active_conflicting_allocations!==0)throw Error("Disposable proof database was not clean before the race");
  const searchActor=actor(0),search={contract:{contractId:"C03",contractVersion:"2.0.0"},tenantId,queryId:randomUUID(),correlationId:randomUUID(),issuedAt:now(),actor:searchActor,queryType:"SEARCH_AVAILABILITY",parameters:{venueId,partySize,requestedRange}};
  const searchResponse=await fetch(endpoint+"/v1/availability/search",{method:"POST",headers:{"content-type":"application/json","x-proof-client":searchActor.actorId},body:JSON.stringify(search)}),availability=await searchResponse.json();
  if(searchResponse.status!==200||availability.candidates?.length!==1)throw Error(`Expected exactly one conflicting opportunity, observed HTTP ${searchResponse.status} with ${availability.candidates?.length??0} candidates`);
  const candidate=availability.candidates[0],prepared=[];
  for(let index=0;index<concurrency;index++){
    const request=command(index,"PREPARE_RESERVATION",{venueId,partySize,requestedRange,selection:{candidateId:candidate.candidateId,resourceIds:candidate.resources.map(resource=>resource.resourceId)}}),response=await post("/v1/reservation-preparations",request,index);
    if(response.status!==200)throw Error(`Preparation ${index+1} failed before race: HTTP ${response.status} ${response.body.code||"UNKNOWN"}`);
    const acceptedTerms=response.body.policyVersionIds.map(policyVersionId=>({policyVersionId,termsDigest:response.body.termsDigest,acceptedAt:now(),acceptedBy:actor(index),acceptanceChannel:"WEB"}));
    prepared.push({index,request:command(index,"CONFIRM_RESERVATION",{confirmationToken:response.body.confirmationToken,acceptedTerms})});
  }
  const raceStarted=performance.now(),outcomes=await Promise.all(prepared.map(({index,request})=>post("/v1/reservations:confirm",request,index))),raceDurationMs=Math.round((performance.now()-raceStarted)*100)/100;
  const classify=list=>Object.fromEntries([...new Set(list.map(item=>`${item.status}:${item.body.code||"SUCCESS"}`))].sort().map(key=>[key,list.filter(item=>`${item.status}:${item.body.code||"SUCCESS"}`===key).length]));
  const postRace=await counts(),fiveXx=outcomes.filter(item=>item.status>=500&&item.status<600).length,successes=outcomes.filter(item=>item.status===200),conflicts=outcomes.filter(item=>item.status===409);
  const retryOutcomes=await Promise.all(prepared.map(({index,request})=>post("/v1/reservations:confirm",request,index))),postRetry=await counts(),retryFiveXx=retryOutcomes.filter(item=>item.status>=500&&item.status<600).length;
  const overlap=await tenantRead(`SELECT count(*)::int overlap_pairs FROM reservation_core.reservation_allocations a JOIN reservation_core.reservation_allocations b ON a.tenant_id=b.tenant_id AND a.resource_id=b.resource_id AND a.allocation_id<b.allocation_id AND a.released_at IS NULL AND b.released_at IS NULL AND tstzrange(a.occupied_start,a.occupied_end,'[)') && tstzrange(b.occupied_start,b.occupied_end,'[)') WHERE a.tenant_id=$1`,[tenantId]);
  const version=(await pool.query("SHOW server_version")).rows[0].server_version,revision=(()=>{try{return execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim()}catch{return null}})();
  const invariantPassed=postRace.confirmed_reservations<=1&&postRace.active_conflicting_allocations<=1&&overlap.rows[0].overlap_pairs===0&&postRetry.confirmed_reservations===postRace.confirmed_reservations&&postRetry.active_conflicting_allocations===postRace.active_conflicting_allocations&&fiveXx===0&&retryFiveXx===0;
  const evidence={schemaVersion:"1.0.0",observedAt:now(),revision,environment:{node:process.version,platform:`${process.platform}-${process.arch}`,postgresql:version,databaseHost:parsed.hostname,databasePort:Number(parsed.port),databaseName:parsed.pathname.slice(1),isolatedDisposable:true},scenario:{concurrency,venueId,partySize,requestedRange,sharedCandidateId:candidate.candidateId,sharedResourceIds:candidate.resources.map(resource=>resource.resourceId),authoritativePath:"HTTP C03 SEARCH -> C04 PREPARE -> C04 CONFIRM -> PostgreSQL",raceDurationMs},observed:{initial,race:{attempts:outcomes.length,successfulConfirmations:successes.length,conflictingRejections:conflicts.length,internalOr5xxFailures:fiveXx,classifications:classify(outcomes)},postRace,retry:{attempts:retryOutcomes.length,internalOr5xxFailures:retryFiveXx,classifications:classify(retryOutcomes)},postRetry,finalPersistedProof:{overlappingActiveAllocationPairs:overlap.rows[0].overlap_pairs}},inferred:{statement:"At most one authoritative conflicting allocation survived, and exact retries created no additional reservation.",basis:"Observed persisted counts, exclusion-constrained allocation rows, retry readback, and zero overlapping active allocation pairs."},result:invariantPassed?"PASS":"FAIL"};
  const output=process.argv[2];if(output)await writeFile(output,`${JSON.stringify(evidence,null,2)}\n`);process.stdout.write(`${JSON.stringify(evidence,null,2)}\n`);if(!invariantPassed)process.exitCode=1;
}finally{await new Promise(resolve=>server.close(resolve));await pool.end()}
