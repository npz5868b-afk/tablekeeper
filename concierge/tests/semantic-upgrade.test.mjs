import test from "node:test";
import assert from "node:assert/strict";
import { AzureOpenAIStructuredOutputProvider, ProviderUnavailableError, SEMANTIC_UPDATE_INSTRUCTION } from "../src/providers/azure-openai-provider.mjs";
import { ContractValidationError, createDiningIntent, mergeIntent, validateIntentUpdate } from "../src/contracts/dining-intent.mjs";
import { ConciergeGraph } from "../src/graph/concierge-graph.mjs";
import { ConciergeService } from "../src/service/concierge-service.mjs";
import { MemoryCheckpointer } from "../src/persistence/memory-checkpointer.mjs";

const op=(operation,target,key,value,sourceText,{hardness=null,provenance="EXPLICIT",confidence=1,weight=null}={})=>({operation,target,key,value,hardness,provenance,confidence,sourceText,weight});
const delta=(operations,extra={})=>({intentType:"CHANGE_PREFERENCE",operations,ambiguities:[],contradictions:[],candidateNextQuestion:null,...extra});
const field=(value,sourceText=String(value))=>({value,sourceText,provenance:"EXPLICIT",confidence:1});
const constraint=(key,value,sourceText=String(value),weight)=>({key,value,hardness:"SOFT",sourceText,provenance:"EXPLICIT",confidence:1,...(weight?{weight}:{})});
const fakeProvider=(content,capture={})=>new AzureOpenAIStructuredOutputProvider({endpoint:"https://example.test",apiKey:"secret",deployment:"semantic",fetchImpl:async(url,init)=>{capture.url=url;capture.init=init;return{ok:true,async json(){return{choices:[{message:{content:JSON.stringify(content)}}]};}};}});

test("torture 1 preserves explicit slots and models not-too-formal as a soft negative preference",async()=>{
  const turn="Dinner for two this Saturday at 8 PM, somewhere romantic and quiet but not too formal.";
  const update=delta([
    op("SET","SLOT","partySize",2,"for two"),op("SET","SLOT","dateText","this Saturday","this Saturday"),op("SET","SLOT","timeText","20:00","8 PM"),
    op("SET","CONSTRAINT","occasionAmbience","romantic","romantic",{hardness:"SOFT"}),op("SET","CONSTRAINT","ambience","quiet","quiet",{hardness:"SOFT"}),op("SET","CONSTRAINT","formality","not-formal","not too formal",{hardness:"SOFT"})
  ],{intentType:"SEARCH_AVAILABILITY"});
  const intent=mergeIntent(createDiningIntent(),await fakeProvider(update).understand(turn,createDiningIntent()));
  assert.equal(intent.slots.partySize.value,2); assert.equal(intent.slots.timeText.value,"20:00"); assert.ok(intent.constraints.some(x=>x.key==="formality"&&x.value==="not-formal"&&x.hardness==="SOFT"));
});

test("torture 2 explicit replacement retains unrelated state",()=>{
  let state=mergeIntent(createDiningIntent(),{slots:{partySize:field(4,"four"),dateText:field("Saturday"),timeText:field("20:00")},constraints:[constraint("ambience","quiet"),constraint("occasionAmbience","romantic")]});
  state=mergeIntent(state,delta([op("REPLACE","SLOT","partySize",2,"make that two people instead")]));
  assert.equal(state.slots.partySize.value,2); assert.equal(state.slots.dateText.value,"Saturday"); assert.deepEqual(state.constraints.map(x=>x.value).sort(),["quiet","romantic"]);
});

test("torture 3 REMOVE quiet and KEEP romantic",()=>{
  let state=mergeIntent(createDiningIntent(),{constraints:[constraint("ambience","quiet"),constraint("occasionAmbience","romantic")]});
  state=mergeIntent(state,delta([op("REMOVE","CONSTRAINT","ambience","quiet","quiet doesn't matter anymore",{hardness:"SOFT"}),op("KEEP","CONSTRAINT","occasionAmbience","romantic","keep it romantic",{hardness:"SOFT"})]));
  assert.deepEqual(state.constraints.map(x=>x.value),["romantic"]);
});

test("torture 4 remove romantic then establish lively",()=>{
  let state=mergeIntent(createDiningIntent(),{constraints:[constraint("occasionAmbience","romantic")]});
  state=mergeIntent(state,delta([op("REMOVE","CONSTRAINT","occasionAmbience","romantic","don't want somewhere romantic anymore",{hardness:"SOFT"}),op("SET","CONSTRAINT","ambience","lively","lively is fine",{hardness:"SOFT"})]));
  assert.deepEqual(state.constraints.map(x=>x.value),["lively"]);
});

test("torture 5 natural time, dress-up, negative formality, and conservative relationship inference",()=>{
  const update=delta([op("SET","SLOT","occasion","anniversary","anniversary"),op("SET","SLOT","partySize",2,"with my wife",{provenance:"INFERRED",confidence:.65}),op("SET","SLOT","dateText","this Friday","this Friday"),op("SET","SLOT","timeText","19:30","half past seven"),op("SET","CONSTRAINT","style","elegant","dress up",{hardness:"SOFT"}),op("SET","CONSTRAINT","formality","not-formal","nothing stiff or overly formal",{hardness:"SOFT"})],{ambiguities:["Please confirm the party size."],candidateNextQuestion:"Will this be for two people?"});
  const state=mergeIntent(createDiningIntent(),update);
  assert.equal(state.slots.partySize,undefined); assert.equal(state.slots.timeText.value,"19:30"); assert.equal(state.readiness.ready,false); assert.equal(state.ambiguities.length,1); assert.equal(update.operations[1].provenance,"INFERRED");
});

test("torture 6 ordered correction wins; explanatory number is not an operation; priority and negative atmosphere are retained",()=>{
  const update=delta([op("SET","SLOT","partySize",6,"six of us"),op("REPLACE","SLOT","partySize",5,"make that five"),op("SET","SLOT","dateText","next Friday","next Friday"),op("SET","SLOT","timeText","19:45","quarter to eight"),op("SET","CONSTRAINT","timeFlexibility","after-19:00","after seven",{hardness:"SOFT",weight:2}),op("SET","CONSTRAINT","ambience","lively","lively is good",{hardness:"SOFT",weight:1}),op("SET","CONSTRAINT","ambience","conversation-friendly","being able to talk matters more",{hardness:"SOFT",weight:3}),op("SET","CONSTRAINT","ambience","not-party-atmosphere","party atmosphere",{hardness:"SOFT",weight:3})],{intentType:"SEARCH_AVAILABILITY"});
  const state=mergeIntent(createDiningIntent(),update);
  assert.equal(state.slots.partySize.value,5); assert.equal(state.slots.partySize.sourceText,"make that five"); assert.ok(!update.operations.some(x=>x.sourceText==="one person")); assert.equal(state.constraints.find(x=>x.value==="conversation-friendly").weight,3);
  assert.ok(state.constraints.some(x=>x.value==="not-party-atmosphere"&&x.hardness==="SOFT"));
});

test("operation validation rejects unknown fields and malformed operations",()=>{
  assert.throws(()=>validateIntentUpdate(delta([op("SET","SLOT","invented",1,"one")])) ,ContractValidationError);
  assert.throws(()=>validateIntentUpdate({...delta([]),invented:true}),ContractValidationError);
});

test("duplicate SET is idempotent and same-turn operation order is deterministic",()=>{
  const update=delta([op("SET","CONSTRAINT","ambience","quiet","quiet",{hardness:"SOFT"})]);
  const once=mergeIntent(createDiningIntent(),update), twice=mergeIntent(once,update);
  assert.deepEqual(twice,once);
  const corrected=mergeIntent(createDiningIntent(),delta([op("SET","SLOT","partySize",6,"six"),op("REPLACE","SLOT","partySize",5,"five")]));
  assert.equal(corrected.slots.partySize.value,5);
});

test("Azure request uses strict schema, semantic instructions, and canonical state as context",async()=>{
  const capture={},turn="make that two"; const update=delta([op("REPLACE","SLOT","partySize",2,turn)]);
  await fakeProvider(update,capture).understand(turn,mergeIntent(createDiningIntent(),{slots:{partySize:field(4,"four")}}));
  const body=JSON.parse(capture.init.body);
  assert.equal(body.response_format.json_schema.strict,true); assert.ok(body.response_format.json_schema.schema.required.includes("operations")); assert.match(body.messages[0].content,/explanations/); assert.match(body.messages[0].content,/current canonical intent is context/i); assert.equal(body.messages[1].role,"user"); assert.equal(capture.init.headers["api-key"],"secret"); assert.ok(SEMANTIC_UPDATE_INSTRUCTION.length>500);
});

test("Azure provider rejects invalid JSON, schema-invalid output, fabricated evidence, HTTP and network failures",async()=>{
  const configured=fetchImpl=>new AzureOpenAIStructuredOutputProvider({endpoint:"https://example.test",apiKey:"secret",deployment:"d",fetchImpl});
  for (const content of ["not-json",JSON.stringify({invented:true}),JSON.stringify(delta([op("SET","SLOT","partySize",2,"not in turn")]))]) {
    await assert.rejects(()=>configured(async()=>({ok:true,async json(){return{choices:[{message:{content}}]};}})).understand("for two",createDiningIntent()),ProviderUnavailableError);
  }
  await assert.rejects(()=>configured(async()=>({ok:false,status:503})).understand("x",createDiningIntent()),ProviderUnavailableError);
  await assert.rejects(()=>configured(async()=>{throw new Error("offline");}).understand("x",createDiningIntent()),ProviderUnavailableError);
  await assert.rejects(()=>new AzureOpenAIStructuredOutputProvider({fetchImpl:async()=>{}}).understand("x",createDiningIntent()),ProviderUnavailableError);
});

test("Azure language failure preserves state and reports degraded rather than local capability",async()=>{
  const graph=new ConciergeGraph({provider:{async understand(){throw new ProviderUnavailableError("offline");}},checkpointer:new MemoryCheckpointer()});
  const service=new ConciergeService({graph,capabilities:{languageUnderstanding:"CLOUD",retrieval:"LOCAL"}});
  const result=await service.handleTurn({threadId:"azure-down",turnId:"1",message:"Dinner for two"});
  assert.equal(result.degradation.active,true); assert.deepEqual(result.degradation.reasons,["LANGUAGE_PROVIDER_FAILURE"]); assert.equal(result.capability.languageUnderstanding,"DEGRADED"); assert.equal(result.intent.readiness.ready,false);
});
