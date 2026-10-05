const base=process.env.CONCIERGE_BASE_URL??"http://127.0.0.1:4310";
const health=await fetch(`${base}/healthz`);if(!health.ok)throw new Error(`health failed: ${health.status}`);
const turn=await fetch(`${base}/v1/concierge/turn`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({threadId:"smoke-thread",turnId:"smoke-turn-1",message:"Dinner for two tomorrow at 8 pm"})});
const payload=await turn.json();if(!turn.ok||payload.threadId!=="smoke-thread"||!payload.interaction||!payload.traceId)throw new Error(`turn failed: ${turn.status}`);
console.log(JSON.stringify({ok:true,health:await health.json(),interaction:payload.interaction.type}));
