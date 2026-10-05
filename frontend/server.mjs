import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { StaffSessionAuthority, readCookie } from "./staff-session.mjs";

const root = new URL(".", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
const authorityConfig=JSON.parse(await readFile(new URL("../platform/restaurant-authority.json",import.meta.url),"utf8"));
const authoritativeVenueIds=Object.freeze(Object.fromEntries(authorityConfig.restaurants.map(({catalogId,venueId})=>[catalogId,venueId])));
const port = Number(process.env.PORT || 4173);
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
const staffCookie="tablekeeper_staff";
const staffSessions=new StaffSessionAuthority({pin:process.env.TABLEKEEPER_STAFF_PIN||"0000"});
const sendJson=(response,status,body,headers={})=>response.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store",...headers}).end(JSON.stringify(body));
const diagnostic=(scope,error)=>console.error(`[${scope}] dependency_failure`,{name:error?.name??"Error",code:error?.cause?.code??error?.code??"UNKNOWN"});

createServer(async (request, response) => {
  const requestUrl=new URL(request.url,"http://localhost"),pathname=requestUrl.pathname;
  if(pathname==="/staff-auth/session"&&request.method==="GET"){
    const session=staffSessions.session(readCookie(request.headers.cookie,staffCookie));sendJson(response,session?200:401,{authenticated:Boolean(session),venueId:session?.venueId??null});return;
  }
  if(pathname==="/staff-auth/login"&&request.method==="POST"){
    try{const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>4096)throw new Error("invalid");chunks.push(chunk)}const {pin,venueId}=JSON.parse(Buffer.concat(chunks).toString("utf8"));if(!authorityConfig.restaurants.some(item=>item.venueId===venueId)){sendJson(response,422,{message:"Select a recognized restaurant."});return}const result=staffSessions.login(pin,venueId,request.socket.remoteAddress||"local");if(!result.ok){sendJson(response,result.code==="STAFF_AUTH_RATE_LIMITED"?429:401,{message:result.code==="STAFF_AUTH_RATE_LIMITED"?"Too many attempts. Please wait a moment.":"That PIN was not accepted."});return}sendJson(response,200,{authenticated:true,venueId:result.venueId},{"Set-Cookie":`${staffCookie}=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${result.maxAge}`});}catch{sendJson(response,400,{message:"Select a restaurant and enter a four-digit PIN."})}return;
  }
  if(pathname==="/staff-auth/logout"&&request.method==="POST"){
    const token=readCookie(request.headers.cookie,staffCookie);staffSessions.logout(token);sendJson(response,200,{authenticated:false},{"Set-Cookie":`${staffCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`});return;
  }
  if (pathname.startsWith("/operations-api/") && ["GET","POST"].includes(request.method)) {
    const staffSession=staffSessions.session(readCookie(request.headers.cookie,staffCookie));if(!staffSession){sendJson(response,401,{code:"STAFF_AUTH_REQUIRED",message:"Staff sign-in is required."});return}
    const route={"/operations-api/state":["GET","/v1/operations/state"],"/operations-api/propose":["POST","/v1/replanning/proposals"],"/operations-api/apply":["POST","/v1/replanning/applications"]}[pathname];
    if (!route || request.method!==route[0]) { response.writeHead(404,{"Content-Type":"application/json"}).end(JSON.stringify({code:"NOT_FOUND"})); return; }
    try {
      const chunks=[]; for await (const chunk of request) chunks.push(chunk);
      const requestedVenue=request.method==="GET"?requestUrl.searchParams.get("venueId"):JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}").venueId;if(requestedVenue!==staffSession.venueId){sendJson(response,403,{code:"STAFF_VENUE_FORBIDDEN",message:"Authenticate for this restaurant before accessing its operations."});return}const venueQuery=`?venueId=${encodeURIComponent(staffSession.venueId)}`;
      const upstream=await fetch(`${process.env.RESERVATION_CORE_BASE_URL||"http://127.0.0.1:4180"}${route[1]}${venueQuery}`,{method:request.method,headers:{authorization:`Bearer ${process.env.RESERVATION_CORE_MANAGER_BEARER_TOKEN||""}`,...(request.method==="POST"?{"content-type":"application/json"}:{})},body:request.method==="POST"?Buffer.concat(chunks):undefined});
      response.writeHead(upstream.status,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(await upstream.text());
    } catch (error) {
      diagnostic("operations_proxy",error);
      response.writeHead(503,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(JSON.stringify({code:"DEPENDENCY_UNAVAILABLE",message:"Live operations are temporarily unavailable.",retryable:true}));
    }
    return;
  }
  if(pathname.startsWith("/reservation-api/v1/")&&["GET","POST"].includes(request.method)){
    const corePath=pathname.slice("/reservation-api".length);
    const allowed=request.method==="POST"&&(["/v1/availability/search","/v1/reservation-preparations","/v1/reservations:confirm"].includes(corePath)||/^\/v1\/reservations\/[0-9a-f-]+:cancel$/i.test(corePath))||request.method==="GET"&&/^\/v1\/reservations\/[0-9a-f-]+(?:\/dining-map)?$/i.test(corePath);
    if(!allowed){sendJson(response,404,{code:"NOT_FOUND"});return}
    try{const chunks=[];for await(const chunk of request)chunks.push(chunk);const upstream=await fetch(`${process.env.RESERVATION_CORE_BASE_URL||"http://127.0.0.1:4180"}${corePath}`,{method:request.method,headers:{authorization:`Bearer ${process.env.RESERVATION_CORE_DEV_BEARER_TOKEN||""}`,...(request.headers["content-type"]?{"content-type":request.headers["content-type"]}:{}),...(request.headers["idempotency-key"]?{"idempotency-key":request.headers["idempotency-key"]}:{})},body:request.method==="POST"?Buffer.concat(chunks):undefined});response.writeHead(upstream.status,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(await upstream.text())}catch(error){diagnostic("reservation_proxy",error);sendJson(response,503,{code:"DEPENDENCY_UNAVAILABLE",message:"The reservation service is temporarily unavailable.",retryable:true})}return;
  }
  if (pathname === "/concierge-api/turn" && request.method === "POST") {
    try {
      const chunks=[]; for await (const chunk of request) chunks.push(chunk);
      const upstream=await fetch(`${process.env.CONCIERGE_BASE_URL||"http://127.0.0.1:4310"}/v1/concierge/turn`,{method:"POST",headers:{"content-type":"application/json"},body:Buffer.concat(chunks)});
      response.writeHead(upstream.status,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(await upstream.text());
    } catch (error) {
      diagnostic("concierge_proxy",error);
      response.writeHead(503,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(JSON.stringify({code:"CONCIERGE_UNAVAILABLE",message:"The concierge is temporarily unavailable.",retryable:true}));
    }
    return;
  }
  const requested = pathname === "/" ? "/index.html" : pathname;
  if (requested === "/runtime-config.js") {
    const publicConfig = {
      baseUrl: "/reservation-api",
      bearerToken: "server-managed",
      tenantId: process.env.RESERVATION_CORE_TENANT_ID || "",
      actorId: process.env.RESERVATION_CORE_ACTOR_ID || "",
      actorType: process.env.RESERVATION_CORE_ACTOR_TYPE || "GUEST",
      venueId: process.env.RESERVATION_CORE_VENUE_ID || "",
      venueIds: authoritativeVenueIds
    };
    response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
    response.end(`globalThis.TABLEKEEPER_RESERVATION_CORE=${JSON.stringify(publicConfig)};`);
    return;
  }
  const file = normalize(join(root, requested));
  if (!file.startsWith(normalize(root))) {
    response.writeHead(403).end("Forbidden"); return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" }).end(body);
  } catch {
    if (request.method === "GET" && !extname(requested)) {
      const body=await readFile(join(root,"index.html")); response.writeHead(200,{"Content-Type":"text/html"}).end(body); return;
    }
    response.writeHead(404).end("Not found");
  }
}).listen(port, () => console.log(`Tablekeeper is ready at http://localhost:${port}`));
