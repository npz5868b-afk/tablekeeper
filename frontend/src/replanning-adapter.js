export const recoveryFixture={
  proposalDigest:"sha256:demo-grounded-proposal",status:"PROPOSED",change:{reservationId:"TK-1048",fromResourceId:"private-alcove-a",toResourceId:"window-alcove-b"},
  preserved:["accessibility","party fit","timing","no overlap","zero cancellations"]
};
export function createRecoveryState(){return {status:"NORMAL",activeResource:"private-alcove-a",proposal:null,applied:false};}
export function disrupt(state){return {...state,status:"PROPOSED",proposal:structuredClone(recoveryFixture)};}
export function applyRecovery(state,{stale=false}={}){if(stale)return {...state,status:"STALE",applied:false};return {...state,status:"APPLIED",activeResource:state.proposal.change.toResourceId,applied:true};}
