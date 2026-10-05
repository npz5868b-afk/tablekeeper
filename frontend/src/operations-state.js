export const emptyOperationsState = () => ({status:"idle",state:null,proposal:null,validation:null,error:null,applied:null});

export const beginOperationsRead = () => ({...emptyOperationsState(),status:"loading"});

export const acceptOperationsRead = state => ({...emptyOperationsState(),status:"ready",state});

export const rejectOperationsRead = error => ({...emptyOperationsState(),status:"read-error",error});

export const beginOperationsProposal = current => ({...current,status:"proposing",proposal:null,validation:null,error:null,applied:null});

export const acceptOperationsProposal = (current,{proposal,validation}) => ({...current,status:"proposal",proposal,validation,error:null});

export const rejectOperationsProposal = (current,error) => ({
  ...current,
  status:error?.code==="RECOVERY_IMPOSSIBLE"?"recovery-impossible":"proposal-error",
  proposal:null,
  validation:null,
  error,
  applied:null
});
