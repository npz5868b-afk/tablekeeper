import { writeFile } from "node:fs/promises";

const pages=await (await fetch("http://127.0.0.1:9223/json")).json(),page=pages.find(item=>item.type==="page"&&item.url.startsWith("http"));
if(!page)throw new Error("No Chrome page target found");
const socket=new WebSocket(page.webSocketDebuggerUrl);let id=0;const pending=new Map();
const send=(method,params={})=>new Promise(resolve=>{pending.set(++id,resolve);socket.send(JSON.stringify({id,method,params}));});
const now=Date.now(),iso=offset=>new Date(now+offset).toISOString();
const venueLayouts={
  "10000000-0000-4000-8000-000000000012":{name:"kumo",capacities:[4,4]},
  "20000000-0000-4000-8000-000000000021":{name:"copper-tiffin",capacities:[2,4,6]},
  "20000000-0000-4000-8000-000000000018":{name:"aegean-blue",capacities:[2,4,4,6]},
  "20000000-0000-4000-8000-000000000007":{name:"basil-house",capacities:[2,4,4,6,8]}
};
const resourcesFor=venueId=>(venueLayouts[venueId]||venueLayouts["10000000-0000-4000-8000-000000000012"]).capacities.map((capacity,index)=>({id:`${venueId.slice(0,-3)}${String(index+1).padStart(3,"0")}`,label:`Table ${String(index+1).padStart(2,"0")}`,capacity,active:true,version:1}));
const resources=resourcesFor("10000000-0000-4000-8000-000000000012");
const reservations=[
  {id:"7ad7d7a2-d216-4694-9033-bee925ba2ffe",resourceId:resources[0].id,status:"CONFIRMED",partySize:2,start:iso(-30*60_000),end:iso(90*60_000),version:1},
  {id:"6ad7d7a2-d216-4694-9033-bee925ba2ff1",resourceId:resources[1].id,status:"CONFIRMED",partySize:4,start:iso(90*60_000),end:iso(210*60_000),version:1}
];
socket.onmessage=async event=>{const message=JSON.parse(event.data);if(message.id&&pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id);return}if(message.method!=="Fetch.requestPaused")return;const url=message.params.request.url;let body;if(url.endsWith("/staff-auth/session"))body={authenticated:true};else if(url.includes("/operations-api/state")){const venueId=new URL(url).searchParams.get("venueId"),venueResources=resourcesFor(venueId);body={tenantId:"10000000-0000-4000-8000-000000000001",venueId,version:"visual",resources:venueResources,reservations:venueId==="10000000-0000-4000-8000-000000000012"?reservations:[]}}else return send("Fetch.continueRequest",{requestId:message.params.requestId});await send("Fetch.fulfillRequest",{requestId:message.params.requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(body)).toString("base64")})};
await new Promise(resolve=>socket.onopen=resolve);await send("Network.setCacheDisabled",{cacheDisabled:true});await send("Fetch.enable",{patterns:[{urlPattern:"*staff-auth/session"},{urlPattern:"*operations-api/state*"}]});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),evaluate=expression=>send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
const capture=async(name,width,height,mobile,selector=null)=>{await send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile});await send("Page.navigate",{url:"http://127.0.0.1:4173/operations"});await pause(900);await evaluate("document.fonts.ready");const assertion=await evaluate(`({ok:document.documentElement.scrollWidth<=innerWidth,scrollWidth:document.documentElement.scrollWidth,innerWidth})`);if(!assertion.result.result.value.ok)throw new Error(JSON.stringify(assertion.result.result.value));if(selector){await evaluate(`document.querySelector('${selector}').scrollIntoView({block:'start'})`);await pause(200)}const shot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});await writeFile(new URL(`../${name}`,import.meta.url),Buffer.from(shot.result.data,"base64"))};
await capture("floor-intelligence-desktop.png",1440,1000,false);
await capture("floor-intelligence-mobile-390x844.png",390,844,true,".staff-floor");
await send("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
for(const [restaurantId,name] of [["fixture-kumo-dining","floor-kumo-2-tables.png"],["fixture-copper-tiffin","floor-copper-tiffin-3-tables.png"],["fixture-aegean-blue","floor-aegean-blue-4-tables.png"],["fixture-basil-house","floor-basil-house-5-tables.png"]]){await evaluate(`(()=>{const select=document.querySelector('[data-operations-venue]');select.value='${restaurantId}';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await pause(500);const shot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});await writeFile(new URL(`../${name}`,import.meta.url),Buffer.from(shot.result.data,"base64"))}
socket.close();
