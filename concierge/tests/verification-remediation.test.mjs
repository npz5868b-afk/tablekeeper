import test from "node:test";
import assert from "node:assert/strict";
import { createDiningIntent, mergeIntent } from "../src/contracts/dining-intent.mjs";
import { sanitizeTraceValue, createTrace } from "../src/observability/safe-trace.mjs";
import { AzureOpenAIStructuredOutputProvider, ProviderUnavailableError } from "../src/providers/azure-openai-provider.mjs";
import { ConciergeGraph } from "../src/graph/concierge-graph.mjs";
import { ConciergeService } from "../src/service/concierge-service.mjs";
import { MemoryCheckpointer } from "../src/persistence/memory-checkpointer.mjs";
import { DeterministicLanguageUnderstandingProvider } from "../src/providers/deterministic-provider.mjs";
import { DeterministicLocalRetriever } from "../src/retrieval/local-retriever.mjs";
import { DeterministicDecisionEngine } from "../src/decision/decision-engine.mjs";

const field=(value,sourceText=String(value))=>({value,sourceText,provenance:"EXPLICIT",confidence:1});
const c=(key,value)=>({key,value,hardness:"HARD",...field(value)});
const makeGraph=(overrides={})=>new ConciergeGraph({provider:new DeterministicLanguageUnderstandingProvider(),checkpointer:new MemoryCheckpointer(),retriever:new DeterministicLocalRetriever(),decisionEngine:new DeterministicDecisionEngine(),...overrides});

test("frozen frontend response exposes one interaction and safe traceId only",async()=>{
  const service=new ConciergeService({graph:makeGraph()});
  const response=await service.handleTurn({threadId:"public-thread",turnId:"turn-1",message:"Dinner for two tomorrow at 8 pm"});
  assert.equal(response.threadId,"public-thread"); assert.equal(response.turnId,"turn-1"); assert.equal(typeof response.message,"string");
  assert.ok(response.interaction.type); assert.ok(Object.hasOwn(response.interaction,"payload")); assert.ok(response.capability); assert.ok(response.degradation); assert.match(response.traceId,/^[0-9a-f-]{36}$/);
  assert.equal(Object.hasOwn(response,"trace"),false); assert.equal(Object.hasOwn(response,"transitions"),false);
  assert.equal(JSON.stringify(response).includes("events"),false);
});

test("safe traces omit caller identifiers and redact secrets embedded in strings",()=>{
  const trace=createTrace("caller-thread"); trace.event("FAIL",{message:"Bearer abc.def and api-key=supersecret",authorization:"raw"}); const snapshot=trace.snapshot();
  assert.equal(Object.hasOwn(snapshot,"threadId"),false); assert.doesNotMatch(JSON.stringify(snapshot),/caller-thread|abc\.def|supersecret|authorization/i);
  assert.deepEqual(sanitizeTraceValue({note:"password=hunter2"}),{note:"[REDACTED]"});
});

test("safe trace strings redact api key spelling variants",()=>{
  for(const spelling of ["api-key", "api_key", "api key", "API KEY"]){
    const sanitized=sanitizeTraceValue(`provider failed: ${spelling}: supersecret`);
    assert.equal(sanitized,"provider failed: [REDACTED]");
    assert.doesNotMatch(sanitized,/supersecret/);
  }
});

test("multi-valued constraints coexist and support targeted replacement and removal",()=>{
  let intent=createDiningIntent();
  intent=mergeIntent(intent,{constraints:[c("dietary","vegan"),c("dietary","gluten-free")]});
  assert.deepEqual(intent.constraints.map(item=>item.value).sort(),["gluten-free","vegan"]);
  intent=mergeIntent(intent,{constraints:[{...c("dietary","vegan"),hardness:"SOFT"}]});
  assert.equal(intent.constraints.find(item=>item.value==="vegan").hardness,"SOFT"); assert.ok(intent.constraints.some(item=>item.value==="gluten-free"));
  intent=mergeIntent(intent,{removeConstraints:[{key:"dietary",value:"vegan"}]});
  assert.deepEqual(intent.constraints.map(item=>item.value),["gluten-free"]);
});

test("failure classes and transitions reflect only entered graph nodes",async()=>{
  const retrieval=await makeGraph({retriever:{async retrieve(){throw new Error("offline");}}}).invoke({threadId:"r",turn:"Dinner for two tomorrow at 8 pm"});
  assert.equal(retrieval.error.code,"RETRIEVAL_FAILURE"); assert.ok(retrieval.transitions.some(item=>item.to==="RETRIEVE_CANDIDATES")); assert.ok(!retrieval.transitions.some(item=>item.to==="RANK"));
  const decision=await makeGraph({decisionEngine:{async rank(){throw new Error("bad rank");}}}).invoke({threadId:"d",turn:"Dinner for two tomorrow at 8 pm"});
  assert.equal(decision.error.code,"DECISION_FAILURE"); assert.equal(decision.transitions.at(-1).to,"RANK");
  const checkpoint=new MemoryCheckpointer(); checkpoint.save=async()=>{throw new Error("disk");};
  const saved=await makeGraph({checkpointer:checkpoint}).invoke({threadId:"c",turn:"Dinner for two tomorrow at 8 pm"}); assert.equal(saved.error.code,"CHECKPOINT_FAILURE");
});

test("malformed Azure structured output fails as a provider error",async()=>{
  for(const content of ["not json",JSON.stringify({invented:true})]){
    const provider=new AzureOpenAIStructuredOutputProvider({endpoint:"https://example.test",apiKey:"secret",deployment:"d",fetchImpl:async()=>({ok:true,async json(){return{choices:[{message:{content}}]};}})});
    await assert.rejects(()=>provider.understand("x",createDiningIntent()),ProviderUnavailableError);
  }
});

test("COMPARE honors exactly the referenced first and second candidates",async()=>{
  const graph=makeGraph(); const first=await graph.invoke({threadId:"pair",turn:"Dinner for two tomorrow at 8 pm"});
  const expected=first.recommendations.slice(0,2).map(item=>item.id);
  const compared=await graph.invoke({threadId:"pair",turn:"Compare the first and second"});
  assert.deepEqual(compared.comparison.restaurantIds,expected);
});
