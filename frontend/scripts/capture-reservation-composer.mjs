import { writeFile } from "node:fs/promises";

const pages=await (await fetch("http://127.0.0.1:9223/json")).json();
const page=pages.find(item=>item.type==="page"&&item.url.startsWith("http"));
if(!page)throw new Error("No Chrome page target found");
const socket=new WebSocket(page.webSocketDebuggerUrl);let id=0;const pending=new Map();
const send=(method,params={})=>new Promise(resolve=>{pending.set(++id,resolve);socket.send(JSON.stringify({id,method,params}));});
const reservationId="7ad7d7a2-d216-4694-9033-bee925ba2ffe",venueId="20000000-0000-4000-8000-000000000018";
const range={start:"2026-10-05T13:00:00.000Z",end:"2026-10-05T15:00:00.000Z"};
const candidate={candidateId:"30000000-0000-4000-8000-000000000001",timeRange:range,resources:[{resourceId:"40000000-0000-4000-8000-000000000001",resourceType:"TABLE"}]};
socket.onmessage=async event=>{
  const message=JSON.parse(event.data);
  if(message.id&&pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id);return;}
  if(message.method!=="Fetch.requestPaused")return;
  const url=message.params.request.url;let body={};
  if(url.endsWith("/v1/availability/search")){
    const request=JSON.parse(message.params.request.postData||"{}");
    const requested=request.parameters?.requestedRange,hour=requested?.start?.slice(11,16),requestedVenue=request.parameters?.venueId;
    const permitted=requestedVenue===venueId?["12:30","13:00","13:30"]:["11:00","11:30","12:00"];
    body={venueId:requestedVenue,candidates:permitted.includes(hour)?[{...candidate,timeRange:requested}]:[],authoritativeAtCommitOnly:true};
  }
  else if(url.endsWith("/v1/reservation-preparations"))body={preparationId:"50000000-0000-4000-8000-000000000001",venueId,partySize:2,requestedRange:range,policyVersionIds:["60000000-0000-4000-8000-000000000001"],termsDigest:`sha256:${"a".repeat(64)}`,termsArtifact:"Reservations may be changed or cancelled through the restaurant.",expiresAt:"2026-10-05T11:35:00.000Z",confirmationToken:"opaque-confirmation-token-that-is-long-enough"};
  else if(url.endsWith("/v1/reservations:confirm"))body={ok:true,result:{status:"CONFIRMED",reservationId}};
  else if(url.endsWith(`/v1/reservations/${reservationId}`))body={reservationId,venueId,status:"CONFIRMED",partySize:2,timeRange:range};
  else return send("Fetch.continueRequest",{requestId:message.params.requestId});
  await send("Fetch.fulfillRequest",{requestId:message.params.requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(body)).toString("base64")});
};
await new Promise(resolve=>socket.onopen=resolve);await send("Network.setCacheDisabled",{cacheDisabled:true});await send("Fetch.enable",{patterns:[{urlPattern:"*reservation-api*"}]});
const evaluate=expression=>send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const viewport=async(width,height,mobile)=>{await send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile});await pause(150);};
const capture=async name=>{const shot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});await writeFile(new URL(`../${name}`,import.meta.url),Buffer.from(shot.result.data,"base64"));};
const assertPage=async expression=>{const result=await evaluate(expression),value=result.result?.result?.value;if(!(value===true||value?.ok===true))throw new Error(`Visual assertion failed: ${JSON.stringify(value)}`);};
await evaluate(`sessionStorage.setItem("tablekeeper.concierge.screen01",JSON.stringify({publicState:{intent:{slots:{partySize:{value:2},dateText:{value:"October 5, 2026"},timeText:{value:"around 9 pm"}}}}}))`);
await viewport(1440,1000,false);await send("Page.navigate",{url:"http://127.0.0.1:4173/restaurant/fixture-aegean-blue"});await pause(1200);await evaluate("document.fonts.ready");
await evaluate("document.querySelector('[data-reserve-restaurant]').click()");await pause(300);await capture("reservation-composer-desktop.png");
await evaluate("document.querySelector('[data-request-form]').requestSubmit()");await pause(500);await evaluate("document.fonts.ready");await capture("reservation-availability-desktop.png");
await assertPage("(()=>{const overlay=document.querySelector('.reservation-journey'),panel=overlay.querySelector(':scope>section'),box=panel.getBoundingClientRect(),metrics={htmlOverflow:getComputedStyle(document.documentElement).overflow,panelOverflow:getComputedStyle(panel).overflowY,overlayOverflow:getComputedStyle(overlay).overflowY,overlayScroll:overlay.scrollHeight,overlayClient:overlay.clientHeight,rootWidth:document.documentElement.clientWidth,viewportWidth:innerWidth,top:box.top,bottom:box.bottom,height:innerHeight};return{ok:metrics.htmlOverflow==='clip'&&metrics.panelOverflow==='visible'&&metrics.overlayOverflow==='clip'&&metrics.overlayScroll<=metrics.overlayClient&&metrics.rootWidth===metrics.viewportWidth&&metrics.top>=24&&metrics.bottom<=metrics.height-24,...metrics}})()");
await viewport(1440,900,false);await evaluate("document.fonts.ready");await capture("reservation-availability-desktop-1440x900.png");
await assertPage("(()=>{const overlay=document.querySelector('.reservation-journey'),panel=overlay.querySelector(':scope>section'),box=panel.getBoundingClientRect(),metrics={htmlOverflow:getComputedStyle(document.documentElement).overflow,panelOverflow:getComputedStyle(panel).overflowY,overlayOverflow:getComputedStyle(overlay).overflowY,overlayScroll:overlay.scrollHeight,overlayClient:overlay.clientHeight,rootWidth:document.documentElement.clientWidth,viewportWidth:innerWidth,top:box.top,bottom:box.bottom,height:innerHeight};return{ok:metrics.htmlOverflow==='clip'&&metrics.panelOverflow==='visible'&&metrics.overlayOverflow==='clip'&&metrics.overlayScroll<=metrics.overlayClient&&metrics.rootWidth===metrics.viewportWidth&&metrics.top>=24&&metrics.bottom<=metrics.height-24,...metrics}})()");
await viewport(1440,1000,false);
await evaluate("document.querySelector('[data-candidate]').click()");await pause(150);await evaluate("document.querySelector('[data-prepare]').click()");await pause(400);await evaluate("document.querySelector('.reservation-accept input').click();document.querySelector('[data-confirm]').click()");await pause(600);await capture("reservation-pass-desktop.png");
await assertPage("!document.querySelector('.authoritative-pass').textContent.includes('7ad7d7a2-d216-4694-9033-bee925ba2ffe')");
await evaluate("document.querySelector('.reservation-close').click();document.querySelector('[data-reserve-restaurant]').click()");await viewport(390,844,true);await capture("reservation-composer-mobile-390x844.png");
await evaluate("document.querySelector('[data-request-form]').requestSubmit()");await pause(500);await capture("reservation-availability-mobile-390x844.png");
await assertPage("document.documentElement.scrollWidth<=390&&document.querySelector('.reservation-journey>section').scrollWidth<=document.querySelector('.reservation-journey>section').clientWidth");
await evaluate("document.querySelector('[data-candidate]').click()");await pause(150);await evaluate("document.querySelector('[data-prepare]').click()");await pause(400);await evaluate("document.querySelector('.reservation-accept input').click();document.querySelector('[data-confirm]').click()");await pause(600);await capture("reservation-pass-mobile-390x844.png");
await viewport(1440,1000,false);await evaluate(`sessionStorage.setItem("tablekeeper.concierge.screen01",JSON.stringify({publicState:{intent:{slots:{partySize:{value:2},dateText:{value:"October 5, 2026"},timeText:{value:"around 8 pm"}}}}}))`);await send("Page.navigate",{url:"http://127.0.0.1:4173/restaurant/fixture-warung-modern"});await pause(900);await evaluate("document.querySelector('[data-reserve-restaurant]').click();document.querySelector('[data-request-form]').requestSubmit()");await pause(500);await capture("guest-adaptive-warung-modern.png");
socket.close();
