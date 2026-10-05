export function shouldSubmitComposer(event,value,inFlight=false){return event.key==="Enter"&&!event.shiftKey&&!event.isComposing&&!inFlight&&String(value??"").trim().length>0}
