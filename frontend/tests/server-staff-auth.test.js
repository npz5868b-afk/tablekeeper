import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const freePort=()=>new Promise((resolve,reject)=>{const server=createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port))})});
const start=async()=>{const port=await freePort(),child=spawn(process.execPath,["server.mjs"],{cwd:new URL("..",import.meta.url),env:{...process.env,PORT:String(port)},stdio:["ignore","pipe","pipe"]});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("frontend server did not start")),5000);child.stdout.on("data",data=>{if(String(data).includes("Tablekeeper is ready")){clearTimeout(timer);resolve()}});child.once("exit",code=>reject(new Error(`frontend server exited ${code}`))) });return{child,base:`http://127.0.0.1:${port}`}};

test("staff PIN and operations authorization remain server-enforced",async()=>{
  const {child,base}=await start();
  try{
    const venueId="10000000-0000-4000-8000-000000000012",otherVenueId="20000000-0000-4000-8000-000000000007";
    let response=await fetch(`${base}/operations-api/state`);assert.equal(response.status,401);
    response=await fetch(`${base}/staff-auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({pin:"1111",venueId})});assert.equal(response.status,401);
    response=await fetch(`${base}/staff-auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({pin:"0000",venueId})});assert.equal(response.status,200);
    const cookie=response.headers.get("set-cookie");assert.match(cookie,/tablekeeper_staff=/);assert.match(cookie,/HttpOnly/i);assert.match(cookie,/SameSite=Strict/i);
    response=await fetch(`${base}/staff-auth/session`,{headers:{cookie}});assert.equal(response.status,200);assert.deepEqual(await response.json(),{authenticated:true,venueId});
    response=await fetch(`${base}/operations-api/state?venueId=${otherVenueId}`,{headers:{cookie}});assert.equal(response.status,403);assert.equal((await response.json()).code,"STAFF_VENUE_FORBIDDEN");
    response=await fetch(`${base}/staff-auth/logout`,{method:"POST",headers:{cookie}});assert.equal(response.status,200);
    response=await fetch(`${base}/staff-auth/session`,{headers:{cookie}});assert.equal(response.status,401);
  }finally{child.kill()}
});
