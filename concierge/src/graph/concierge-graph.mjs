import { createDiningIntent, mergeIntent, publicIntent } from "../contracts/dining-intent.mjs";
import { createTrace } from "../observability/safe-trace.mjs";
import { buildSmartFallback } from "../decision/smart-fallback.mjs";
import { guardReservationOutcome } from "../reservation/reservation-guardian.mjs";

const questionFor = intent => intent.contradictions?.[0] ? `Please resolve this conflict: ${intent.contradictions[0]}` : intent.ambiguities?.[0] ? `Could you clarify: ${intent.ambiguities[0]}?` : ({ partySize: "How many people are dining?", dateText: "What date would you like?", timeText: "What time would you prefer?" })[intent.readiness.missing[0]];
const failureCodes = { provider: "LANGUAGE_PROVIDER_FAILURE", retrieval: "RETRIEVAL_FAILURE", decision: "DECISION_FAILURE", checkpoint: "CHECKPOINT_FAILURE", unexpected: "UNEXPECTED_FAILURE" };
class StageFailure extends Error { constructor(kind, cause) { super(`${kind} failed`, { cause }); this.kind = kind; } }
async function at(kind, operation) { try { return await operation(); } catch (cause) { throw new StageFailure(kind, cause); } }

function referencedIds(turn, recommendations) {
  const ordinals = { first:0, second:1, third:2 };
  const matches = [...String(turn).toLowerCase().matchAll(/\b(first|second|third)\b/g)];
  return [...new Set(matches.map(match => recommendations?.[ordinals[match[1]]]?.id).filter(Boolean))];
}

function deterministicNavigationUpdate(turn, previous) {
  if (!previous?.recommendations?.length) return null;
  const text=String(turn).trim().toLowerCase().replace(/[.!?]+$/g, "").trim();
  const rejectPhrases=new Set([
    "i\'d prefer another option",
    "id prefer another option",
    "not this one",
    "show me something else"
  ]);
  if (!rejectPhrases.has(text)) return null;
  return {
    intentType:"REJECT",
    operations:[],
    ambiguities:[],
    contradictions:[],
    candidateNextQuestion:null
  };
}

const selectionCue=/\b(book|reserve|take|go with|sounds good|i(?:'d| would) like)\b/i;
const genericCandidateWords=new Set(["dining","restaurant","kitchen","room","house","table","the"]);
const normalizedWords=value=>String(value??"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
function candidateAliases(candidate) {
  const full=normalizedWords(candidate?.name), words=full.split(/\s+/).filter(Boolean);
  const distinctive=words.filter(word=>word.length>=3&&!genericCandidateWords.has(word));
  return [...new Set([full,distinctive.join(" "),distinctive[0]].filter(value=>value?.length>=3))];
}
export function resolveGroundedSelection(turn,recommendations=[]) {
  const text=normalizedWords(turn);
  if(!selectionCue.test(String(turn))) return {status:"NONE"};
  const matches=recommendations.filter(candidate=>candidateAliases(candidate).some(alias=>new RegExp(`(?:^| )${alias.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?: |$)`).test(text)));
  if(matches.length===1) return {status:"RESOLVED",candidate:matches[0]};
  if(matches.length>1) return {status:"AMBIGUOUS",candidates:matches};
  return {status:"UNKNOWN"};
}

export class ConciergeGraph {
  constructor({ provider, checkpointer, retriever, decisionEngine, reservationTools }) { Object.assign(this, { provider, checkpointer, retriever, decisionEngine, reservationTools }); }
  async invoke({ threadId, turn, reservationAction = null }) {
    if (!threadId || typeof turn !== "string") throw new TypeError("threadId and turn are required");
    let previous;
    try { previous = await at("checkpoint", () => this.checkpointer.load(threadId)); }
    catch (error) { return this.#failure({ threadId, previous: { intent:createDiningIntent(),stage:"START",recommendations:[] }, error, transitions:[], trace:createTrace() }); }
    const freshThread = previous == null;
    previous ??= { intent:createDiningIntent(),stage:"START",recommendations:[] };
    const trace=createTrace(); const transitions=[];
    const step=(from,to,detail={})=>{transitions.push({from,to});trace.event(to,detail);};
    try {
      step(previous.stage,"UNDERSTAND");
      const selection=resolveGroundedSelection(turn,previous.recommendations);
      if(selection.status!=="NONE"&&!reservationAction) {
        if(selection.status!=="RESOLVED") {
          const question=selection.status==="AMBIGUOUS"?"Which of those restaurants would you like to reserve?":"I can only reserve one of the restaurants already recommended. Which option would you like?";
          step("UNDERSTAND","CLARIFY_SELECTION",{status:selection.status});
          return {ok:true,threadId,intent:publicIntent(previous.intent),stage:previous.stage,clarification:{question,missing:[]},recommendations:previous.recommendations??[],transitions,trace:trace.snapshot(),providerDiagnostics:{provider:"GROUNDED_SELECTION",requestedModel:null,actualModel:null,status:"REJECTED"}};
        }
        const intent=mergeIntent(previous.intent,{intentType:"ACCEPT",operations:[{operation:"SET",target:"SELECTED_CANDIDATE",key:"selectedCandidateId",value:selection.candidate.id,hardness:null,provenance:"EXPLICIT",confidence:1,sourceText:String(turn).trim(),weight:null}],ambiguities:[],contradictions:[],candidateNextQuestion:null});
        step("UNDERSTAND","SELECT_CANDIDATE",{candidateId:selection.candidate.id});
        step("SELECT_CANDIDATE","RESERVATION_HANDOFF");
        const checkpoint={intent,stage:"RESERVATION_HANDOFF",recommendations:previous.recommendations};
        await at("checkpoint",()=>this.checkpointer.save(threadId,checkpoint));
        return {ok:true,threadId,intent:publicIntent(intent),stage:checkpoint.stage,selection:{restaurantId:selection.candidate.id,name:selection.candidate.name,reservationAuthority:"RESERVATION_CORE",bookingConfirmed:false},recommendations:[],transitions,trace:trace.snapshot(),providerDiagnostics:{provider:"GROUNDED_SELECTION",requestedModel:null,actualModel:null,status:"ACCEPTED"}};
      }
      const navigationUpdate=deterministicNavigationUpdate(turn,previous);
      let providerResult;
      if(navigationUpdate) providerResult={update:navigationUpdate,diagnostics:{provider:"DETERMINISTIC_NAVIGATION",requestedModel:null,actualModel:null,status:"ACCEPTED"}};
      else {
        try { providerResult=await at("provider",()=>this.provider.understand(turn,previous.intent)); }
        catch(error) {
          // A fresh thread has no state to duplicate. Reattempt one transient
          // semantic-provider initialization failure before any merge or save.
          if(!freshThread||this.provider?.allowFreshInitializationRetry===false||!(error instanceof StageFailure)||error.kind!=="provider") throw error;
          trace.event("FRESH_PROVIDER_REATTEMPT",{attempt:2});
          providerResult=await at("provider",()=>this.provider.understand(turn,previous.intent));
        }
      }
      const update=providerResult?.update??providerResult;
      const providerDiagnostics=providerResult?.diagnostics??null;
      if(providerDiagnostics) trace.event("LANGUAGE_PROVIDER_RESULT",providerDiagnostics);
      const references=referencedIds(turn,previous.recommendations);
      if(references.length===1) update.selectedCandidateId=references[0];
      else if(/\b(it|this one|that one)\b/i.test(turn)&&previous.recommendations?.length) update.selectedCandidateId=previous.intent.selectedCandidateId??previous.recommendations[0].id;
      else if(update.intentType==="REJECT"&&previous.recommendations?.length&&!update.selectedCandidateId) update.selectedCandidateId=previous.intent.selectedCandidateId??previous.recommendations[0].id;
      step("UNDERSTAND","MERGE_INTENT",{operationCount:update.operations?.length??0,changedFields:[...(update.operations??[]).filter(item=>item.operation!=="KEEP").map(item=>item.key),...Object.keys(update.slots??{}),...(update.constraints??[]).map(item=>item.key)]});
      const intent=await at("provider",()=>mergeIntent(previous.intent,update));
      step("MERGE_INTENT","CHECK_READINESS",{ready:intent.readiness.ready,missing:intent.readiness.missing});
      if(!intent.readiness.ready){
        step("CHECK_READINESS","PLAN_CLARIFICATION"); step("PLAN_CLARIFICATION","WAIT_FOR_USER");
        const checkpoint={intent,stage:"WAIT_FOR_USER",recommendations:previous.recommendations??[]};
        await at("checkpoint",()=>this.checkpointer.save(threadId,checkpoint));
        return {ok:true,threadId,intent:publicIntent(intent),stage:checkpoint.stage,clarification:{question:update.candidateNextQuestion??questionFor(intent),missing:intent.readiness.missing},recommendations:[],transitions,trace:trace.snapshot(),providerDiagnostics};
      }
      step("CHECK_READINESS","RETRIEVE_CANDIDATES");
      const candidates=this.retriever?await at("retrieval",()=>this.retriever.retrieve(turn,intent)):[];
      step("RETRIEVE_CANDIDATES","HARD_FILTER"); step("HARD_FILTER","RANK");
      const excludeIds=intent.intentType==="REJECT"&&intent.selectedCandidateId?[intent.selectedCandidateId]:[];
      const recommendations=this.decisionEngine?await at("decision",()=>this.decisionEngine.rank(intent,candidates,{excludeIds})):candidates;
      step("RANK","EXPLAIN_RECOMMENDATION",{count:recommendations.length});
      const selected=recommendations.find(item=>item.id===intent.selectedCandidateId)??recommendations[0];
      const explanation=this.decisionEngine?.explain?await at("decision",()=>this.decisionEngine.explain(selected,intent)):null;
      let comparison=null;
      if(intent.intentType==="COMPARE"&&this.decisionEngine?.compare){
        const pair=references.length>=2?references.slice(0,2).map(id=>recommendations.find(item=>item.id===id)).filter(Boolean):recommendations.slice(0,2);
        comparison=await at("decision",()=>this.decisionEngine.compare(pair));
      }
      let reservation=null; let lastStage="EXPLAIN_RECOMMENDATION";
      if(intent.intentType==="ACCEPT"&&reservationAction){
        step(lastStage,"RESERVATION_TOOL",{operation:reservationAction.operation}); lastStage="RESERVATION_TOOL";
        try {
          if(!this.reservationTools||typeof this.reservationTools[reservationAction.operation]!=="function") throw new Error("Reservation operation unavailable");
          reservation={ok:true,operation:reservationAction.operation,result:await this.reservationTools[reservationAction.operation](reservationAction.input)};
        } catch(error) {
          reservation={ok:false,operation:reservationAction.operation,error:{code:error.code??"DEPENDENCY_UNAVAILABLE",message:"Reservation Core could not complete the request.",retryable:error.retryable??false,correlationId:error.correlationId??null}};
          trace.event("RESERVATION_FAILURE",{code:reservation.error.code,retryable:reservation.error.retryable});
        }
      }
      const guardian=guardReservationOutcome(reservation);
      const availability=reservation?.ok === true && reservation.operation === "search" ? reservation.result : null;
      const fallback=buildSmartFallback({intent,recommendations,rejectedId:intent.selectedCandidateId,availability});
      step(lastStage,"WAIT_FOR_DECISION");
      const checkpoint={intent,stage:"WAIT_FOR_DECISION",recommendations};
      await at("checkpoint",()=>this.checkpointer.save(threadId,checkpoint));
      return {ok:true,threadId,intent:publicIntent(intent),stage:checkpoint.stage,recommendations,explanation,comparison,reservation,guardian,fallback,transitions,trace:trace.snapshot(),providerDiagnostics};
    } catch(error) { return this.#failure({threadId,previous,error,transitions,trace}); }
  }

  #failure({threadId,previous,error,transitions,trace}) {
    const kind=error instanceof StageFailure?error.kind:"unexpected"; const code=failureCodes[kind]??failureCodes.unexpected;
    trace.event(code,{category:kind,name:error.cause?.name??error.name});
    return {ok:false,threadId,intent:publicIntent(previous.intent),stage:previous.stage,clarification:{question:"I couldn't safely complete that request. Please try again.",missing:previous.intent.readiness?.missing??[]},recommendations:previous.recommendations??[],error:{code,retryable:kind!=="unexpected"},transitions,trace:trace.snapshot(),providerDiagnostics:error.cause?.diagnostics??null};
  }
}
