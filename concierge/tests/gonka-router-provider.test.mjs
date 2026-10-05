import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEFAULT_GONKA_TIMEOUT_MS, MAX_GONKA_TIMEOUT_MS, MIN_GONKA_TIMEOUT_MS, GonkaRouterProvider, normalizeGonkaContent, normalizeGonkaTimeout } from "../src/providers/gonka-router-provider.mjs";
import { AzureOpenAIStructuredOutputProvider, ProviderUnavailableError } from "../src/providers/azure-openai-provider.mjs";
import { createDiningIntent, mergeIntent } from "../src/contracts/dining-intent.mjs";
import { createConciergeService } from "../src/service/composition.mjs";

const operation=(overrides={})=>({operation:"SET",target:"SLOT",key:"partySize",value:2,hardness:null,provenance:"EXPLICIT",confidence:1,sourceText:"for two",weight:null,...overrides});
const update=(overrides={})=>({intentType:"SEARCH_AVAILABILITY",operations:[operation()],ambiguities:[],contradictions:[],candidateNextQuestion:null,...overrides});
const response=(content,{model="configured/model",status=200}={})=>({ok:status>=200&&status<300,status,async json(){return{model,choices:[{message:{content}}]};}});
const provider=(fetchImpl,overrides={})=>new GonkaRouterProvider({baseUrl:"https://example.test/v1",apiKey:"fixture-key",model:"configured/model",timeoutMs:25,fetchImpl,...overrides});
const t6Turn="There'll be six of us next Friday. Actually, make that five — one person dropped out. We'd like dinner sometime after seven, preferably around quarter to eight. Somewhere lively is good, but being able to talk matters more than having a party atmosphere.";
const t6Update={intentType:"SEARCH_AVAILABILITY",operations:[
  operation({operation:"SET",key:"partySize",value:6,sourceText:"There'll be six of us"}),
  operation({operation:"REPLACE",key:"partySize",value:5,sourceText:"make that five"}),
  operation({key:"dateText",value:"next Friday",sourceText:"next Friday"}),
  operation({key:"timeText",value:"19:45",sourceText:"quarter to eight"}),
  operation({target:"CONSTRAINT",key:"timeFlexibility",value:"after 19:00",hardness:"SOFT",sourceText:"after seven"}),
  operation({target:"CONSTRAINT",key:"ambience",value:"lively",hardness:"SOFT",sourceText:"Somewhere lively is good",weight:1}),
  operation({target:"CONSTRAINT",key:"ambience",value:"conversation-friendly",hardness:"SOFT",sourceText:"being able to talk matters more",weight:2})
],ambiguities:[],contradictions:[],candidateNextQuestion:"Would you like to specify a cuisine or location preference?"};

test("Gonka timeout defaults to 30 seconds and safely normalizes configuration",()=>{
  const base={baseUrl:"https://example.test/v1",apiKey:"fixture-key",model:"configured/model",fetchImpl:async()=>{throw new Error("must not run");}};
  assert.equal(new GonkaRouterProvider(base).timeoutMs,DEFAULT_GONKA_TIMEOUT_MS);
  assert.equal(new GonkaRouterProvider({...base,timeoutMs:"45000"}).timeoutMs,45_000);
  assert.equal(normalizeGonkaTimeout("invalid"),DEFAULT_GONKA_TIMEOUT_MS);
  assert.equal(normalizeGonkaTimeout(""),DEFAULT_GONKA_TIMEOUT_MS);
  assert.equal(normalizeGonkaTimeout(-1),MIN_GONKA_TIMEOUT_MS);
  assert.equal(normalizeGonkaTimeout(999_999),MAX_GONKA_TIMEOUT_MS);
});

test("composition passes configured Gonka timeout without making a request",()=>{
  const service=createConciergeService({env:{CONCIERGE_LANGUAGE_PROVIDER:"gonka",CONCIERGE_RETRIEVAL_PROVIDER:"local",GONKA_BASE_URL:"https://example.test/v1",GONKA_API_KEY:"fixture-key",GONKA_MODEL:"requested/GLM",GONKA_TIMEOUT_MS:"45000"},fetchImpl:async()=>{throw new Error("must not run");}});
  assert.equal(service.graph.provider.timeoutMs,45_000);
});

test("Gonka request uses the authoritative case-sensitive contract without provider-native response_format",async()=>{
  let request;
  await provider(async(_url,init)=>{request=JSON.parse(init.body);return response(JSON.stringify(update()));}).understand("for two",createDiningIntent());
  assert.equal(Object.hasOwn(request,"response_format"),false);
  const prompt=request.messages[0].content;
  for(const value of ["SLOT","CONSTRAINT","SELECTED_CANDIDATE","SET","REPLACE","REMOVE","KEEP","EXPLICIT","INFERRED","HARD","SOFT"]) assert.ok(prompt.includes(`\"${value}\"`));
  assert.ok(prompt.includes('"ASK_POLICY"'));
  assert.equal(prompt.includes('"NONE"'),false);
  assert.match(prompt,/target "SLOT" permits only key values: "partySize", "dateText", "timeText"/);
  assert.match(prompt,/target "CONSTRAINT" permits only key values: "cuisine", "location", "pricePerPersonMax"/);
  assert.match(prompt,/"intimate" and "quiet"[\s\S]*"ambience"/);
  assert.match(prompt,/navigation-only rejection[\s\S]*intentType "REJECT"[\s\S]*operations \[\]/i);
});

test("mocked anniversary request preserves supported ambience and follows canonical readiness",async()=>{
  const turn="It's our anniversary next Friday. We want somewhere intimate and quiet.";
  const proposal=update({operations:[
    operation({key:"dateText",value:"next Friday",sourceText:"next Friday"}),
    operation({key:"occasion",value:"anniversary",sourceText:"anniversary"}),
    operation({target:"CONSTRAINT",key:"ambience",value:"intimate",hardness:"SOFT",sourceText:"intimate"}),
    operation({target:"CONSTRAINT",key:"ambience",value:"quiet",hardness:"SOFT",sourceText:"quiet"})
  ],candidateNextQuestion:null});
  let calls=0;
  const service=createConciergeService({env:{CONCIERGE_LANGUAGE_PROVIDER:"gonka",CONCIERGE_RETRIEVAL_PROVIDER:"local",GONKA_BASE_URL:"https://example.test/v1",GONKA_API_KEY:"fixture-key",GONKA_MODEL:"deepseek-ai/DeepSeek-V4-Flash-0731"},fetchImpl:async()=>{calls+=1;return response(JSON.stringify(proposal),{model:"deepseek-ai/DeepSeek-V4-Flash-0731"});}});
  const result=await service.handleTurn({threadId:"gonka-anniversary",turnId:"1",message:turn});
  assert.equal(calls,1);
  assert.equal(result.intent.slots.dateText.value,"next Friday");
  assert.equal(result.intent.slots.occasion.value,"anniversary");
  assert.deepEqual(result.intent.constraints.map(({key,value})=>({key,value})),[
    {key:"ambience",value:"intimate"},
    {key:"ambience",value:"quiet"}
  ]);
  assert.deepEqual(result.intent.readiness,{ready:false,missing:["partySize","timeText"],blocking:true});
  assert.equal(result.interaction.type,"clarification");
  assert.equal(result.interaction.payload.question,"How many people are dining?");
});

test("live-provider boundary resolves conversational party answers to canonical numbers",async()=>{
  const cases=[
    ["just two of us",2],["two of us",2],["the two of us",2],["just us two",2],
    ["for two",2],["2 people",2],["There will be four of us",4],["six people",6]
  ];
  for(const [turn,expected] of cases){
    const current=createDiningIntent();
    current.slots.occasion={value:"anniversary",provenance:"EXPLICIT",confidence:1,sourceText:"anniversary"};
    const stale=update({operations:[],ambiguities:["party size is unclear"],candidateNextQuestion:"How many people are dining?"});
    const result=await provider(async()=>response(JSON.stringify(stale))).understand(turn,current);
    assert.equal(result.update.operations.at(-1).value,expected,turn);
    assert.equal(result.update.operations.at(-1).key,"partySize",turn);
    assert.deepEqual(result.update.ambiguities,[],turn);
    assert.equal(result.update.candidateNextQuestion,null,turn);
  }
});

test("Gonka multi-turn anniversary clarification preserves occasion and advances beyond party",async()=>{
  const firstProposal=update({operations:[operation({key:"occasion",value:"anniversary",sourceText:"anniversary"})],candidateNextQuestion:"How many people are dining?"});
  const secondProposal=update({operations:[],ambiguities:["party size is unclear"],candidateNextQuestion:"How many people are dining?"});
  let calls=0;
  const service=createConciergeService({env:{CONCIERGE_LANGUAGE_PROVIDER:"gonka",CONCIERGE_RETRIEVAL_PROVIDER:"local",GONKA_BASE_URL:"https://example.test/v1",GONKA_API_KEY:"fixture-key",GONKA_MODEL:"configured/model"},fetchImpl:async()=>response(JSON.stringify(++calls===1?firstProposal:secondProposal))});
  const first=await service.handleTurn({threadId:"anniversary-party-clarification",turnId:"1",message:"I'm planning an anniversary dinner"});
  assert.equal(first.interaction.type,"clarification");
  assert.match(first.message,/how many people/i);
  const second=await service.handleTurn({threadId:"anniversary-party-clarification",turnId:"2",message:"just two of us"});
  assert.equal(second.intent.slots.occasion.value,"anniversary");
  assert.equal(second.intent.slots.partySize.value,2);
  assert.deepEqual(second.intent.readiness.missing,["dateText","timeText"]);
  assert.equal(second.interaction.type,"clarification");
  assert.doesNotMatch(second.message,/how many|party|people|guest/i);
  assert.equal(second.message,"What date would you like?");
});

test("natural rejection utterances preserve a ready canonical intent and exclude the current primary",async()=>{
  const initialTurn="Anniversary dinner for two next Friday at 19:30, intimate and quiet.";
  const initialProposal=update({operations:[
    operation({key:"partySize",value:2,sourceText:"two"}),
    operation({key:"dateText",value:"next Friday",sourceText:"next Friday"}),
    operation({key:"timeText",value:"19:30",sourceText:"19:30"}),
    operation({key:"occasion",value:"anniversary",sourceText:"Anniversary"}),
    operation({target:"CONSTRAINT",key:"ambience",value:"intimate",hardness:"SOFT",sourceText:"intimate"}),
    operation({target:"CONSTRAINT",key:"ambience",value:"quiet",hardness:"SOFT",sourceText:"quiet"})
  ],candidateNextQuestion:null});
  const rejectionProposal=update({intentType:"REJECT",operations:[],candidateNextQuestion:null});
  for(const [index,turn] of ["I'd prefer another option.","Not this one.","Show me something else."].entries()){
    let calls=0;
    const service=createConciergeService({env:{CONCIERGE_LANGUAGE_PROVIDER:"gonka",CONCIERGE_RETRIEVAL_PROVIDER:"local",GONKA_BASE_URL:"https://example.test/v1",GONKA_API_KEY:"fixture-key",GONKA_MODEL:"deepseek-ai/DeepSeek-V4-Flash-0731"},fetchImpl:async()=>{calls+=1;return response(JSON.stringify(calls===1?initialProposal:rejectionProposal),{model:"deepseek-ai/DeepSeek-V4-Flash-0731"});}});
    const threadId=`gonka-natural-reject-${index}`;
    const first=await service.handleTurn({threadId,turnId:"1",message:initialTurn});
    assert.equal(first.intent.readiness.ready,true);
    assert.ok(first.interaction.payload.length>1);
    const rejectedId=first.interaction.payload[0].id;
    const replanned=await service.handleTurn({threadId,turnId:"2",message:turn});
    assert.equal(calls,1);
    assert.equal(replanned.intent.intentType,"REJECT");
    assert.equal(replanned.intent.slots.partySize.value,2);
    assert.equal(replanned.intent.slots.dateText.value,"next Friday");
    assert.equal(replanned.intent.slots.timeText.value,"19:30");
    assert.equal(replanned.intent.slots.occasion.value,"anniversary");
    assert.deepEqual(replanned.intent.constraints.filter(item=>item.key==="ambience").map(item=>item.value),["intimate","quiet"]);
    assert.equal(replanned.interaction.type,"recommendations");
    assert.ok(!replanned.interaction.payload.some(item=>item.id===rejectedId));
    assert.equal(replanned.semanticProvider.status,"ACCEPTED");
    assert.equal(replanned.semanticProvider.provider,"DETERMINISTIC_NAVIGATION");
  }
});

test("Gonka still rejects an unknown constraint key fail-closed",async()=>{
  const proposal=update({operations:[operation({target:"CONSTRAINT",key:"quiet",value:true,hardness:"SOFT",sourceText:"quiet"})]});
  await assert.rejects(
    ()=>provider(async()=>response(JSON.stringify(proposal))).understand("quiet",createDiningIntent()),
    error=>error instanceof ProviderUnavailableError
      && error.cause?.name==="ContractValidationError"
      && error.cause.issues.includes("operations.0.key unknown constraint")
  );
});

test("mocked live T6 contract reduces ordered corrections and keeps candidateNextQuestion advisory",async()=>{
  let calls=0;
  const service=createConciergeService({env:{CONCIERGE_LANGUAGE_PROVIDER:"gonka",CONCIERGE_RETRIEVAL_PROVIDER:"local",GONKA_BASE_URL:"https://example.test/v1",GONKA_API_KEY:"fixture-key",GONKA_MODEL:"deepseek-ai/DeepSeek-V4-Flash-0731"},fetchImpl:async()=>{calls+=1;return response(JSON.stringify(t6Update),{model:"deepseek-ai/DeepSeek-V4-Flash-0731"});}});
  const result=await service.handleTurn({threadId:"gonka-t6",turnId:"1",message:t6Turn});
  assert.equal(calls,1);
  assert.equal(result.intent.slots.partySize.value,5);
  assert.equal(result.intent.slots.dateText.value,"next Friday");
  assert.equal(result.intent.slots.timeText.value,"19:45");
  assert.equal(result.intent.constraints.find(item=>item.key==="timeFlexibility").value,"after 19:00");
  assert.equal(result.intent.constraints.find(item=>item.value==="lively").weight,1);
  assert.equal(result.intent.constraints.find(item=>item.value==="conversation-friendly").weight,2);
  assert.deepEqual(result.intent.readiness,{ready:true,missing:[],blocking:false});
  assert.notEqual(result.interaction.type,"clarification");
});

test("bounded normalization accepts clean, fenced, whitespace, reasoning-wrapped, and single-object prose",()=>{
  const json=JSON.stringify(update());
  for(const content of [json,`  ${json}\n`,`\`\`\`json\n${json}\n\`\`\``,`<think>discarded</think>${json}`,`<think>a</think><think>b</think>\n\`\`\`json\n${json}\n\`\`\``,`Result follows: ${json} end.`]) {
    assert.deepEqual(normalizeGonkaContent(content),update());
  }
});

test("bounded normalization rejects malformed, ambiguous, empty, and reasoning-contaminated content",()=>{
  const json=JSON.stringify(update());
  for(const content of ["", "{broken", `${json}\n${json}`, "<think>unterminated", `${json}<think>hidden</think>`, `${"x".repeat(1025)}${json}`, "x".repeat(65537)]) {
    assert.throws(()=>normalizeGonkaContent(content));
  }
});

test("observed routed-model fixture strips reasoning and reports requested and actual models truthfully",async()=>{
  const fixture=JSON.parse(await readFile(new URL("./fixtures/gonka-observed-response.json",import.meta.url),"utf8"));
  const capture={};
  const subject=new GonkaRouterProvider({baseUrl:"https://example.test/v1",apiKey:"fixture-key",model:fixture.requestedModel,fetchImpl:async(url,init)=>{capture.url=url;capture.init=init;return{ok:true,status:200,async json(){return fixture.response;}};}});
  const result=await subject.understand("Actually make that two.",createDiningIntent());
  assert.equal(result.diagnostics.requestedModel,"zai-org/GLM-5.3-Flash");
  assert.equal(result.diagnostics.actualModel,"MiniMaxAI/MiniMax-M2.7");
  assert.equal(result.diagnostics.status,"ACCEPTED");
  assert.equal(result.update.operations[0].sourceText,"make that two");
  assert.equal(JSON.stringify(result).includes("Sanitized reasoning text"),false);
  assert.equal(capture.url,"https://example.test/v1/chat/completions");
  assert.equal(JSON.parse(capture.init.body).model,fixture.requestedModel);
  assert.equal(Object.keys(capture.init.headers).includes("api-key"),false);
});

test("Azure and Gonka conform to the same validated IntentUpdate consumed by the reducer",async()=>{
  const proposal=update();
  const azure=new AzureOpenAIStructuredOutputProvider({endpoint:"https://azure.example.test",apiKey:"fixture-key",deployment:"semantic",fetchImpl:async()=>response(JSON.stringify(proposal))});
  const gonka=provider(async()=>response(JSON.stringify(proposal)));
  const azureUpdate=await azure.understand("for two",createDiningIntent());
  const gonkaResult=await gonka.understand("for two",createDiningIntent());
  assert.deepEqual(gonkaResult.update,azureUpdate);
  assert.deepEqual(mergeIntent(createDiningIntent(),gonkaResult.update),mergeIntent(createDiningIntent(),azureUpdate));
});

test("Gonka fails closed for invalid contract, unknown targets, wrong types, fabricated evidence, and missing choices",async()=>{
  const cases=[
    {intentType:"SEARCH_AVAILABILITY"},
    update({operations:[{operation:"SET",target:"SLOT",key:"partySize",value:2,hardness:null,provenance:"EXPLICIT",confidence:1,sourceText:"for two"}]}),
    update({operations:[operation({value:{guests:2}})]}),
    update({operations:[operation({target:"slot"})]}),
    update({operations:[operation({target:"SYSTEM"})]}),
    update({operations:[operation({confidence:"high"})]}),
    update({operations:[operation({sourceText:"two diners are attending"})]}),
    null,
    "multiple-choices"
  ];
  for(const proposal of cases){
    const fetchImpl=proposal===null
      ?async()=>({ok:true,status:200,async json(){return{model:"actual",choices:[]};}})
      :proposal==="multiple-choices"
        ?async()=>({ok:true,status:200,async json(){return{model:"actual",choices:[{message:{content:JSON.stringify(update())}},{message:{content:JSON.stringify(update({operations:[]}))}}]};}})
        :async()=>response(JSON.stringify(proposal),{model:"actual"});
    await assert.rejects(()=>provider(fetchImpl).understand("for two",createDiningIntent()),ProviderUnavailableError);
  }
});

test("Gonka fails closed for HTTP, network, timeout, and missing configuration",async()=>{
  await assert.rejects(()=>provider(async()=>response("",{status:502})).understand("x",createDiningIntent()),ProviderUnavailableError);
  await assert.rejects(()=>provider(async()=>{throw new Error("offline");}).understand("x",createDiningIntent()),ProviderUnavailableError);
  await assert.rejects(()=>provider((_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(new Error("aborted")),{once:true}))).understand("x",createDiningIntent()),/timed out/);
  await assert.rejects(()=>new GonkaRouterProvider({baseUrl:"",apiKey:"",model:"",fetchImpl:async()=>{throw new Error("must not run");}}).understand("x",createDiningIntent()),ProviderUnavailableError);
});

test("fresh Gonka failure makes exactly one inference attempt",async()=>{
  let calls=0;
  const service=createConciergeService({env:{CONCIERGE_LANGUAGE_PROVIDER:"gonka",CONCIERGE_RETRIEVAL_PROVIDER:"local",GONKA_BASE_URL:"https://example.test/v1",GONKA_API_KEY:"fixture-key",GONKA_MODEL:"requested/model"},fetchImpl:async()=>{calls+=1;throw new Error("offline");}});
  const result=await service.handleTurn({threadId:"gonka-no-retry",turnId:"1",message:"dinner for two"});
  assert.equal(calls,1);
  assert.equal(result.degradation.active,true);
  assert.equal(result.capability.languageUnderstanding,"DEGRADED");
  assert.deepEqual(result.semanticProvider,{provider:"GONKA",requestedModel:"requested/model",actualModel:null,status:"REJECTED"});
});

test("separate provider reasoning is ignored and never enters the accepted semantic result",async()=>{
  const subject=provider(async()=>({ok:true,status:200,async json(){return{model:"actual/model",choices:[{message:{reasoning_content:"private reasoning must disappear",content:JSON.stringify(update())}}]};}}));
  const result=await subject.understand("for two",createDiningIntent());
  assert.equal(JSON.stringify(result).includes("private reasoning"),false);
});

test("configured Gonka uses one mocked request and exposes safe model substitution metadata",async()=>{
  let calls=0;
  const proposal=update();
  const service=createConciergeService({env:{CONCIERGE_LANGUAGE_PROVIDER:"gonka",CONCIERGE_RETRIEVAL_PROVIDER:"local",GONKA_BASE_URL:"https://example.test/v1",GONKA_API_KEY:"fixture-key",GONKA_MODEL:"requested/GLM"},fetchImpl:async()=>{calls+=1;return response(JSON.stringify(proposal),{model:"actual/MiniMax"});}});
  const result=await service.handleTurn({threadId:"gonka-success",turnId:"1",message:"for two"});
  assert.equal(calls,1);
  assert.deepEqual(result.semanticProvider,{provider:"GONKA",requestedModel:"requested/GLM",actualModel:"actual/MiniMax",status:"ACCEPTED"});
  assert.equal(result.capability.languageUnderstanding,"CLOUD");
  assert.equal(JSON.stringify(result).includes("fixture-key"),false);
});

test("unknown language provider configuration fails closed instead of silently selecting local",()=>{
  assert.throws(()=>createConciergeService({env:{CONCIERGE_LANGUAGE_PROVIDER:"typo"},fetchImpl:async()=>{throw new Error("must not run");}}),/Unsupported language provider/);
});

test("rejected Gonka output preserves prior canonical intent and reports degradation",async()=>{
  let calls=0;
  const service=createConciergeService({env:{CONCIERGE_LANGUAGE_PROVIDER:"gonka",CONCIERGE_RETRIEVAL_PROVIDER:"local",GONKA_BASE_URL:"https://example.test/v1",GONKA_API_KEY:"fixture-key",GONKA_MODEL:"requested/GLM"},fetchImpl:async()=>{calls+=1;return response("not json",{model:"actual/MiniMax"});}});
  const existing=mergeIntent(createDiningIntent(),{intentType:"SEARCH_AVAILABILITY",operations:[operation()],ambiguities:[],contradictions:[],candidateNextQuestion:null});
  await service.graph.checkpointer.save("gonka-reject",{intent:existing,stage:"WAIT_FOR_USER",recommendations:[]});
  const result=await service.handleTurn({threadId:"gonka-reject",turnId:"2",message:"change it"});
  assert.equal(calls,1);
  assert.equal(result.intent.slots.partySize.value,2);
  assert.equal(result.capability.languageUnderstanding,"DEGRADED");
  assert.equal(result.degradation.active,true);
  assert.deepEqual(result.semanticProvider,{provider:"GONKA",requestedModel:"requested/GLM",actualModel:"actual/MiniMax",status:"REJECTED"});
});
