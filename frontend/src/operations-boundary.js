export class OperationsBoundaryError extends Error {
  constructor(payload={},status=500){super(payload.message||'Live operations request failed');Object.assign(this,{code:payload.code||'INTERNAL',retryable:payload.retryable===true,status,correlationId:payload.correlationId||null})}
}
async function request(path,init={}){
  let response;
  try{response=await fetch(path,{...init,headers:{...(init.body?{'content-type':'application/json'}:{}),...(init.headers||{})}})}catch(cause){throw new OperationsBoundaryError({code:'DEPENDENCY_UNAVAILABLE',message:'Live operations are temporarily unavailable.',retryable:true},503)}
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new OperationsBoundaryError(payload,response.status);
  return payload;
}
export const operationsBoundary={
  state:venueId=>request(`/operations-api/state?venueId=${encodeURIComponent(venueId)}`),
  propose:({tenantId,venueId,unavailableResourceIds,affectedReservationId})=>request('/operations-api/propose',{method:'POST',body:JSON.stringify({tenantId,venueId,unavailableResourceIds,affectedReservationId})}),
  apply:({tenantId,venueId,proposal,validation})=>request('/operations-api/apply',{method:'POST',body:JSON.stringify({tenantId,venueId,proposal,validation,approved:true})})
};
