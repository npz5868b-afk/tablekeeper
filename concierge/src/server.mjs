import { createServer } from "node:http";
import { createConciergeService } from "./service/composition.mjs";

const service=createConciergeService();
const port=Number(process.env.CONCIERGE_PORT??4310);
const server=createServer(async(req,res)=>{
  res.setHeader("content-type","application/json"); res.setHeader("cache-control","no-store");
  if(req.method==="GET"&&req.url==="/healthz"){res.end(JSON.stringify({ok:true,service:"concierge"}));return;}
  if(req.method!=="POST"||req.url!=="/v1/concierge/turn"){res.statusCode=404;res.end(JSON.stringify({code:"NOT_FOUND"}));return;}
  try{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const result=await service.handleTurn(body);res.end(JSON.stringify(result));
  }catch(error){res.statusCode=error instanceof SyntaxError||error instanceof TypeError?400:500;if(res.statusCode===500)console.error("[concierge_turn] internal_failure",{name:error?.name??"Error",code:error?.cause?.code??error?.code??"UNKNOWN"});res.end(JSON.stringify({code:res.statusCode===400?"INVALID_REQUEST":"INTERNAL_ERROR",message:res.statusCode===400?error.message:"Request failed safely."}));}
});
server.listen(port,"127.0.0.1",()=>console.log(`Concierge listening on http://127.0.0.1:${port}`));
