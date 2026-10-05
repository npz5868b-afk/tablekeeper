import test from "node:test";
import assert from "node:assert/strict";
import { FIXTURE_ACL, FIXTURE_RESTAURANTS, FIXTURE_TENANT_ID, materializeFixtureCandidates } from "../src/knowledge/fixture-catalog.mjs";
import { DeterministicLocalRetriever } from "../src/retrieval/local-retriever.mjs";
import { AzureAISearchRetriever, RetrievalUnavailableError } from "../src/retrieval/azure-ai-search-adapter.mjs";
import { RetrievalContextError } from "../src/retrieval/retrieval-policy.mjs";
import { DeterministicDecisionEngine } from "../src/decision/decision-engine.mjs";
import { DeterministicLanguageUnderstandingProvider } from "../src/providers/deterministic-provider.mjs";
import { MemoryCheckpointer } from "../src/persistence/memory-checkpointer.mjs";
import { ConciergeGraph } from "../src/graph/concierge-graph.mjs";
import { ConciergeService } from "../src/service/concierge-service.mjs";

const field = (value, sourceText) => ({ value, sourceText, provenance:"EXPLICIT", confidence:1 });
const constraint = (key,value,hardness="HARD",weight) => ({key,value,hardness,weight,sourceText:String(value),provenance:"EXPLICIT",confidence:1});

test("fixture corpus contains 24 differentiated restaurants with atomic inspectable evidence", () => {
  assert.equal(FIXTURE_RESTAURANTS.length,24);
  const candidates=materializeFixtureCandidates();
  assert.equal(new Set(candidates.map(item=>`${item.facts.cuisine}|${item.facts.location}|${item.facts.pricePerPerson}|${item.facts.ambience}`)).size,24);
  for(const candidate of candidates){
    assert.ok(candidate.evidence.length>=7);
    assert.ok(candidate.evidence.every(item=>item.claimId.startsWith(`${candidate.id}:`)&&item.quote&&item.source.locator.startsWith("fixtures://")&&item.source.notice&&item.source.sourceVersion&&/^[a-f0-9]{64}$/.test(item.source.contentDigest)));
  }
});

test("local retrieval applies tenant, ACL, temporal, supersession and tombstone filters before scoring", async () => {
  const [visible] = materializeFixtureCandidates();
  const variants = [
    visible,
    {...structuredClone(visible),id:"other-tenant",access:{...visible.access,tenantId:"00000000-0000-4000-8000-000000000002"}},
    {...structuredClone(visible),id:"denied",access:{...visible.access,acl:["manager:read"]}},
    {...structuredClone(visible),id:"expired",access:{...visible.access,effectiveTo:"2026-09-01T00:00:00.000Z"}},
    {...structuredClone(visible),id:"future",access:{...visible.access,effectiveFrom:"2026-11-01T00:00:00.000Z"}},
    {...structuredClone(visible),id:"superseded",access:{...visible.access,superseded:true}},
    {...structuredClone(visible),id:"tombstone",access:{...visible.access,tombstone:true}}
  ];
  const result=await new DeterministicLocalRetriever({candidates:variants}).retrieve("Lotus",{}, {tenantId:FIXTURE_TENANT_ID,callerAcl:FIXTURE_ACL,asOf:"2026-10-01T00:00:00Z"});
  assert.deepEqual(result.map(item=>item.id),[visible.id]);
  assert.equal(result[0].retrieval.filterAppliedBeforeRanking,true);
});

test("local retrieval is deterministic, evidence-bearing, and does not delegate exact constraints", async () => {
  const retriever=new DeterministicLocalRetriever();
  const first=await retriever.retrieve("romantic French view",{}); const second=await retriever.retrieve("romantic French view",{});
  assert.deepEqual(first,second);
  assert.equal(first.length,24);
  assert.ok(first[0].evidence.length>0);
  assert.ok(first.every(item=>item.retrieval.exactConstraintsDelegated===false));
});

test("Azure AI Search adapter is server-configured and returns evidence-bearing references", async () => {
  let request;
  const context={tenantId:FIXTURE_TENANT_ID,callerAcl:FIXTURE_ACL,asOf:"2026-10-01T00:00:00Z"};
  const retriever=new AzureAISearchRetriever({endpoint:"https://search.example",apiKey:"secret",indexName:"restaurants",defaultContext:context,fetchImpl:async(url,init)=>{request={url,init};return{ok:true,async json(){return{value:[{id:"r1",name:"One",facts:{cuisine:"italian"},evidence:[{claimId:"r1:cuisine"}],"@search.score":4.2}]};}};}});
  const result=await retriever.retrieve("Italian",{});
  assert.equal(result[0].retrieval.provider,"AZURE_AI_SEARCH");
  assert.equal(result[0].retrieval.exactConstraintsDelegated,false);
  assert.equal(JSON.parse(request.init.body).search,"Italian");
  assert.match(JSON.parse(request.init.body).filter,/tenantId eq/);
  assert.match(JSON.parse(request.init.body).filter,/acl\/any/);
  assert.equal(request.init.headers["api-key"],"secret");
  await assert.rejects(()=>new AzureAISearchRetriever().retrieve("x",{}),RetrievalUnavailableError);
  await assert.rejects(()=>new AzureAISearchRetriever({endpoint:"https://search.example",apiKey:"secret",indexName:"restaurants",defaultContext:{},fetchImpl:retriever.fetch}).retrieve("x",{}),RetrievalContextError);
});

test("hard filtering rejects false and unknown facts exactly", () => {
  const engine=new DeterministicDecisionEngine();
  const intent={constraints:[constraint("dietary","vegan"),constraint("location","bangsar")]};
  const candidates=[
    {id:"known",facts:{dietary:{vegan:true},location:"bangsar"}},
    {id:"false",facts:{dietary:{vegan:false},location:"bangsar"}},
    {id:"unknown",facts:{location:"bangsar"}}
  ];
  assert.deepEqual(engine.hardFilter(intent,candidates).map(item=>item.candidate.id),["known"]);
});

test("weighted ranking is reproducible with inspectable score breakdown and stable tie-breaking", async () => {
  const engine=new DeterministicDecisionEngine();
  const intent={constraints:[constraint("cuisine","italian"),constraint("ambience","quiet","SOFT",3),constraint("feature","view","SOFT",2)]};
  const candidates=[
    {id:"z",name:"Zulu",facts:{cuisine:"italian",ambience:["quiet"],features:["view"]},evidence:[]},
    {id:"a",name:"Alpha",facts:{cuisine:"italian",ambience:["quiet"],features:["view"]},evidence:[]},
    {id:"b",name:"Beta",facts:{cuisine:"italian",ambience:["quiet"],features:[]},evidence:[]}
  ];
  const first=await engine.rank(intent,candidates); const second=await engine.rank(intent,candidates);
  assert.deepEqual(first,second);
  assert.deepEqual(first.map(item=>item.id),["a","z","b"]);
  assert.equal(first[0].score,5);
  assert.deepEqual(first[0].scoreBreakdown.soft.map(item=>[item.key,item.weight,item.matched]),[["ambience",3,true],["feature",2,true]]);
});

test("explain, compare, and reject use only ranked facts and evidence", async () => {
  const engine=new DeterministicDecisionEngine();
  const ranked=await engine.rank({constraints:[constraint("cuisine","french"),constraint("ambience","quiet","SOFT")]},materializeFixtureCandidates());
  const explanation=engine.explain(ranked[0]); const comparison=engine.compare(ranked.slice(0,2)); const rejected=engine.reject(ranked,ranked[0].id);
  assert.equal(explanation.restaurantId,ranked[0].id);
  assert.ok(explanation.evidence.length>0);
  assert.equal(comparison.restaurantIds.length,2);
  assert.ok(comparison.dimensions.some(item=>item.key==="cuisine"));
  assert.ok(!rejected.some(item=>item.id===ranked[0].id));
});

test("EXPLAIN turns grounded checks into concise guest language without fabricating unsupported context",async()=>{
  const engine=new DeterministicDecisionEngine();
  const intent={
    slots:{occasion:field("anniversary","anniversary"),dateText:field("tomorrow","tomorrow"),timeText:field("9:00 pm","9:00 PM")},
    constraints:[constraint("cuisine","japanese"),constraint("occasionAmbience","romantic","SOFT")]
  };
  const kumo=materializeFixtureCandidates().find(item=>item.id==="fixture-kumo-dining");
  const [ranked]=await engine.rank(intent,[kumo]);
  const explanation=engine.explain(ranked,intent);
  assert.match(explanation.summary,/Japanese cuisine.*verified/i);
  assert.match(explanation.summary,/anniversary/i);
  assert.match(explanation.summary,/romantic atmosphere/i);
  assert.match(explanation.summary,/9:00 pm/i);
  assert.match(explanation.summary,/aren't yet verified for Kumo Dining/i);
  assert.doesNotMatch(explanation.summary,/cuisine=japanese|occasionAmbience|score|predicate|retrieval|database/i);
  assert.equal(Object.hasOwn(explanation,"score"),false);
  assert.equal(Object.hasOwn(explanation,"scoreBreakdown"),false);
  assert.ok(explanation.evidence.length>0);
});

test("EXPLAIN naturally combines multiple supported evidence points",async()=>{
  const engine=new DeterministicDecisionEngine();
  const intent={slots:{},constraints:[constraint("cuisine","japanese"),constraint("ambience","intimate","SOFT"),constraint("feature","view","SOFT")]};
  const [ranked]=await engine.rank(intent,[{id:"supported",name:"Sora",facts:{cuisine:"japanese",ambience:["intimate"],features:["view"]},evidence:[{claimId:"supported:cuisine",quote:"Cuisine: Japanese"}]}]);
  const explanation=engine.explain(ranked,intent);
  assert.match(explanation.summary,/Japanese cuisine, an intimate atmosphere, and its view experience are verified/i);
  assert.doesNotMatch(explanation.summary,/cuisine=|ambience=|feature=|score/i);
});

test("multi-turn WHY preserves the recommended candidate and remembered dining context",async()=>{
  const graph=new ConciergeGraph({provider:new DeterministicLanguageUnderstandingProvider(),checkpointer:new MemoryCheckpointer(),retriever:new DeterministicLocalRetriever(),decisionEngine:new DeterministicDecisionEngine()});
  const first=await graph.invoke({threadId:"why-kumo",turn:"Japanese dinner for two tomorrow at 9 pm for our anniversary, preferably romantic"});
  assert.equal(first.recommendations[0].id,"fixture-kumo-dining");
  const before={slots:structuredClone(first.intent.slots),constraints:structuredClone(first.intent.constraints),candidate:first.recommendations[0].id};
  const explained=await graph.invoke({threadId:"why-kumo",turn:"Why Kumo Dining?"});
  assert.equal(explained.intent.intentType,"WHY");
  assert.deepEqual(explained.intent.slots,before.slots);
  assert.deepEqual(explained.intent.constraints,before.constraints);
  assert.equal(explained.recommendations[0].id,before.candidate);
  assert.match(explained.explanation.summary,/Japanese cuisine.*verified/i);
  assert.doesNotMatch(explained.explanation.summary,/cuisine=japanese|romantic (setting|restaurant)|anniversary (venue|restaurant)/i);
});

test("anniversary journey selects grounded Kumo after EXPLAIN and enters Reservation Core handoff",async()=>{
  const graph=new ConciergeGraph({provider:new DeterministicLanguageUnderstandingProvider(),checkpointer:new MemoryCheckpointer(),retriever:new DeterministicLocalRetriever(),decisionEngine:new DeterministicDecisionEngine()});
  const service=new ConciergeService({graph});
  const turns=["I'm planning an anniversary dinner","just two of us","tomorrow","9 PM","Japanese"];
  let result;
  for(const [index,message] of turns.entries()) result=await service.handleTurn({threadId:"selection-e2e",turnId:String(index+1),message});
  assert.equal(result.intent.slots.occasion.value,"anniversary");
  assert.equal(result.intent.slots.partySize.value,2);
  assert.equal(result.intent.slots.dateText.value,"tomorrow");
  assert.equal(result.intent.slots.timeText.value,"9:00 pm");
  assert.equal(result.interaction.payload[0].id,"fixture-kumo-dining");
  const explained=await service.handleTurn({threadId:"selection-e2e",turnId:"6",message:"Why Kumo Dining?"});
  assert.equal(explained.interaction.type,"explanation");
  const selected=await service.handleTurn({threadId:"selection-e2e",turnId:"7",message:"Let's book Kumo Dining"});
  assert.equal(selected.stage,"RESERVATION_HANDOFF");
  assert.equal(selected.interaction.type,"selection");
  assert.deepEqual(selected.interaction.payload,{restaurantId:"fixture-kumo-dining",name:"Kumo Dining",reservationAuthority:"RESERVATION_CORE",bookingConfirmed:false});
  assert.equal(selected.intent.slots.partySize.value,2);
  assert.equal(selected.intent.slots.dateText.value,"tomorrow");
  assert.equal(selected.intent.slots.timeText.value,"9:00 pm");
  assert.equal(selected.intent.slots.occasion.value,"anniversary");
  assert.equal(selected.intent.selectedCandidateId,"fixture-kumo-dining");
  assert.match(selected.message,/check live availability/i);
  assert.match(selected.message,/nothing is booked until you review and confirm/i);
});

test("natural booking variants resolve only against the grounded candidate set",async()=>{
  const variants=["Let's book Kumo Dining","Book Kumo Dining","I'll take Kumo Dining","Let's go with Kumo","Kumo sounds good","I'd like Kumo"];
  for(const [index,message] of variants.entries()){
    const graph=new ConciergeGraph({provider:new DeterministicLanguageUnderstandingProvider(),checkpointer:new MemoryCheckpointer(),retriever:new DeterministicLocalRetriever(),decisionEngine:new DeterministicDecisionEngine()});
    await graph.invoke({threadId:`selection-${index}`,turn:"Japanese dinner for two tomorrow at 9 PM for our anniversary"});
    const result=await graph.invoke({threadId:`selection-${index}`,turn:message});
    assert.equal(result.selection?.restaurantId,"fixture-kumo-dining",message);
    assert.equal(result.selection?.bookingConfirmed,false,message);
    assert.equal(result.recommendations.length,0,message);
  }
});

test("unknown and ambiguous booking references fail closed without changing the checkpoint",async()=>{
  const checkpointer=new MemoryCheckpointer(),intent={version:1,intentType:"SEARCH_AVAILABILITY",slots:{partySize:field(2,"two"),dateText:field("tomorrow","tomorrow"),timeText:field("9:00 pm","9 PM")},constraints:[],selectedCandidateId:null,readiness:{ready:true,missing:[],blocking:false},ambiguities:[],contradictions:[]};
  const recommendations=[{id:"kumo-one",name:"Kumo Dining"},{id:"kumo-two",name:"Kumo Garden"}];
  await checkpointer.save("selection-closed",{intent,stage:"WAIT_FOR_DECISION",recommendations});
  const graph=new ConciergeGraph({provider:{async understand(){throw new Error("provider must not resolve candidate identity");}},checkpointer,retriever:null,decisionEngine:null});
  const ambiguous=await graph.invoke({threadId:"selection-closed",turn:"Let's go with Kumo"});
  assert.match(ambiguous.clarification.question,/which/i);
  assert.equal(ambiguous.intent.selectedCandidateId,null);
  const unknown=await graph.invoke({threadId:"selection-closed",turn:"Book Atlantis"});
  assert.match(unknown.clarification.question,/only reserve one of the restaurants already recommended/i);
  assert.equal(unknown.intent.selectedCandidateId,null);
  assert.equal((await checkpointer.load("selection-closed")).stage,"WAIT_FOR_DECISION");
});

test("repeated grounded selection remains a non-confirming handoff and creates no reservation",async()=>{
  const mutations=[];
  const graph=new ConciergeGraph({provider:new DeterministicLanguageUnderstandingProvider(),checkpointer:new MemoryCheckpointer(),retriever:new DeterministicLocalRetriever(),decisionEngine:new DeterministicDecisionEngine(),reservationTools:{async prepare(){mutations.push("prepare");},async confirm(){mutations.push("confirm");}}});
  await graph.invoke({threadId:"repeat-selection",turn:"Japanese dinner for two tomorrow at 9 PM"});
  const first=await graph.invoke({threadId:"repeat-selection",turn:"Book Kumo Dining"});
  const repeated=await graph.invoke({threadId:"repeat-selection",turn:"Kumo sounds good"});
  assert.equal(first.selection.bookingConfirmed,false);
  assert.equal(repeated.selection.bookingConfirmed,false);
  assert.equal(repeated.selection.restaurantId,first.selection.restaurantId);
  assert.deepEqual(mutations,[]);
});

test("completed graph integrates retrieval, decision, compare and reject transitions", async () => {
  const graph=new ConciergeGraph({provider:new DeterministicLanguageUnderstandingProvider(),checkpointer:new MemoryCheckpointer(),retriever:new DeterministicLocalRetriever(),decisionEngine:new DeterministicDecisionEngine()});
  const first=await graph.invoke({threadId:"decision-flow",turn:"French dinner for two tomorrow at 8 pm, preferably quiet"});
  assert.equal(first.stage,"WAIT_FOR_DECISION"); assert.ok(first.explanation?.evidence.length);
  const compared=await graph.invoke({threadId:"decision-flow",turn:"Compare the first and second"});
  assert.ok(compared.comparison); assert.equal(compared.comparison.restaurantIds.length,2);
  const rejectedId=compared.intent.selectedCandidateId;
  const rejected=await graph.invoke({threadId:"decision-flow",turn:"Reject this one"});
  assert.ok(!rejected.recommendations.some(item=>item.id===rejectedId));
});
