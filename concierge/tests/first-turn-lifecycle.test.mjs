import test from "node:test";
import assert from "node:assert/strict";
import { ConciergeGraph } from "../src/graph/concierge-graph.mjs";
import { ConciergeService } from "../src/service/concierge-service.mjs";
import { MemoryCheckpointer } from "../src/persistence/memory-checkpointer.mjs";
import { DeterministicLanguageUnderstandingProvider } from "../src/providers/deterministic-provider.mjs";
import { ProviderUnavailableError } from "../src/providers/azure-openai-provider.mjs";
import { DeterministicLocalRetriever } from "../src/retrieval/local-retriever.mjs";
import { DeterministicDecisionEngine } from "../src/decision/decision-engine.mjs";

const make = provider => {
  const checkpointer=new MemoryCheckpointer();
  const graph=new ConciergeGraph({provider,checkpointer,retriever:new DeterministicLocalRetriever(),decisionEngine:new DeterministicDecisionEngine()});
  return {checkpointer,graph,service:new ConciergeService({graph})};
};
const complete="Japanese dinner for two tomorrow at 8 pm";

test("fresh session succeeds on its first valid request after one transient provider initialization failure",async()=>{
  const deterministic=new DeterministicLanguageUnderstandingProvider();
  let calls=0;
  const provider={async understand(...args){calls+=1;if(calls===1)throw new ProviderUnavailableError("cold start");return deterministic.understand(...args);}};
  const {service}=make(provider);
  const result=await service.handleTurn({threadId:"fresh",turnId:"turn-1",message:complete});
  assert.equal(calls,2);
  assert.equal(result.degradation.active,false);
  assert.equal(result.interaction.type,"recommendations");
  assert.deepEqual(result.interaction.payload.map(item=>item.id),["fixture-kumo-dining","fixture-mizu-counter","fixture-sakura-garden"]);
});

test("existing session applies its next request once and preserves grounded authority",async()=>{
  const deterministic=new DeterministicLanguageUnderstandingProvider();
  let calls=0;
  const provider={async understand(...args){calls+=1;return deterministic.understand(...args);}};
  const {service}=make(provider);
  await service.handleTurn({threadId:"existing",turnId:"turn-1",message:complete});
  const result=await service.handleTurn({threadId:"existing",turnId:"turn-2",message:"Actually, make it Italian, but keep everything else the same."});
  assert.equal(calls,2);
  assert.equal(result.interaction.type,"recommendations");
  assert.ok(result.interaction.payload.every(item=>item.evidence.every(evidence=>evidence.claimId&&evidence.source)));
  assert.equal(result.reservationAuthority,"RESERVATION_CORE");
});

test("failed request does not persist or advance conversational state",async()=>{
  const provider={async understand(){throw new ProviderUnavailableError("offline");}};
  const {service,checkpointer}=make(provider);
  const result=await service.handleTurn({threadId:"failed",turnId:"turn-1",message:complete});
  assert.equal(result.degradation.active,true);
  assert.equal(await checkpointer.load("failed"),null);
  assert.equal(result.intent.readiness.ready,false);
});

test("retrying a transiently failed turn does not duplicate the user turn",async()=>{
  const deterministic=new DeterministicLanguageUnderstandingProvider();
  let available=false,calls=0;
  const provider={async understand(...args){calls+=1;if(!available)throw new ProviderUnavailableError("offline");return deterministic.understand(...args);}};
  const {service,checkpointer}=make(provider);
  const request={threadId:"retry",turnId:"stable-turn",message:complete};
  const failed=await service.handleTurn(request);
  assert.equal(failed.degradation.active,true);
  assert.equal(await checkpointer.load("retry"),null);
  available=true;
  const succeeded=await service.handleTurn(request);
  const replay=await service.handleTurn(request);
  assert.deepEqual(replay,succeeded);
  assert.equal(calls,3);
  const checkpoint=await checkpointer.load("retry");
  assert.equal(checkpoint.intent.slots.partySize.value,2);
  assert.equal(checkpoint.intent.constraints.filter(item=>item.key==="cuisine").length,1);
});
