import test from "node:test";
import assert from "node:assert/strict";
import {applyIntentTurn,createIntentState,intentTokens,setMode} from "../src/intelligence-adapter.js";
import {applyRecovery,createRecoveryState,disrupt} from "../src/replanning-adapter.js";

test("multi-turn intent preserves context and refines time",()=>{let state=createIntentState();state=applyIntentTurn(state,"Tomorrow around 8pm for our anniversary, two people. Romantic, elegant, quiet, RM300-400, no beef.");state=applyIntentTurn(state,"Actually make it 8:30.");assert.equal(state.slots.timeText,"8:30 PM");assert.equal(state.slots.partySize,2);assert.equal(state.constraints.find(x=>x.key==="dietary").hardness,"HARD");assert.ok(intentTokens(state).some(x=>x.label==="No beef"));});
test("legacy intent adapter does not select or recommend restaurants",()=>{const state=applyIntentTurn(createIntentState(),"What about the second one?");assert.equal(state.selectedCandidateId,null);});
test("resilience mode changes preserve representable intent",()=>{const state=applyIntentTurn(createIntentState(),"Tomorrow for two");assert.equal(setMode(state,"SURVIVAL").slots.partySize,2);});
test("recovery is proposal-only until atomic apply succeeds",()=>{const proposal=disrupt(createRecoveryState());assert.equal(proposal.activeResource,"private-alcove-a");assert.equal(proposal.applied,false);const applied=applyRecovery(proposal);assert.equal(applied.activeResource,"window-alcove-b");assert.equal(applied.applied,true);const stale=applyRecovery(proposal,{stale:true});assert.equal(stale.activeResource,"private-alcove-a");assert.equal(stale.applied,false);});
