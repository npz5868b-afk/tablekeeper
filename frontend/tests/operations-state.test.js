import test from "node:test";
import assert from "node:assert/strict";
import { acceptOperationsProposal, acceptOperationsRead, beginOperationsProposal, beginOperationsRead, rejectOperationsProposal } from "../src/operations-state.js";

const authoritativeState={tenantId:"tenant-1",resources:[{id:"table-1"},{id:"table-2"}],reservations:[{id:"reservation-1",resourceId:"table-1"},{id:"reservation-2",resourceId:"table-2"}]};

test("RECOVERY_IMPOSSIBLE remains a non-mutating proposal outcome and a fresh read clears it",async()=>{
  let getCount=0,proposalCount=0;
  const boundary={
    async state(){getCount++;return structuredClone(authoritativeState)},
    async propose(){proposalCount++;if(proposalCount===1)throw Object.assign(new Error("no feasible assignment"),{code:"RECOVERY_IMPOSSIBLE"});return {proposal:{proposalDigest:"sha256:next",changes:[]},validation:{validationDigest:"sha256:validation"}}}
  };

  let state=beginOperationsRead();
  state=acceptOperationsRead(await boundary.state());
  assert.equal(state.status,"ready");
  assert.equal(state.state.reservations.length,2);

  state=beginOperationsProposal(state);
  await assert.rejects(async()=>{try{await boundary.propose()}catch(error){state=rejectOperationsProposal(state,error);throw error}},error=>error.code==="RECOVERY_IMPOSSIBLE");
  assert.equal(state.status,"recovery-impossible");
  assert.equal(state.error.code,"RECOVERY_IMPOSSIBLE");
  assert.equal(state.state.reservations.length,2);
  assert.equal(state.applied,null);

  state=beginOperationsRead();
  state=acceptOperationsRead(await boundary.state());
  assert.equal(getCount,2);
  assert.equal(state.status,"ready");
  assert.equal(state.error,null);
  assert.equal(state.state.resources.length,2);
  assert.equal(state.state.reservations.length,2);

  state=beginOperationsProposal(state);
  state=acceptOperationsProposal(state,await boundary.propose());
  assert.equal(proposalCount,2);
  assert.equal(state.status,"proposal");
  assert.equal(state.proposal.proposalDigest,"sha256:next");
});
