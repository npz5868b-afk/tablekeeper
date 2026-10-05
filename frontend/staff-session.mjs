import { randomBytes, timingSafeEqual } from "node:crypto";

const equalSecret=(left,right)=>{const a=Buffer.from(String(left)),b=Buffer.from(String(right));return a.length===b.length&&timingSafeEqual(a,b)};

export class StaffSessionAuthority {
  constructor({pin="0000",ttlMs=8*60*60*1000,clock=()=>Date.now()}={}){this.pin=String(pin);this.ttlMs=ttlMs;this.clock=clock;this.sessions=new Map();this.failures=new Map()}
  login(pin,venueId,clientKey="local"){
    const now=this.clock(),recent=(this.failures.get(clientKey)||[]).filter(at=>now-at<60_000);
    if(recent.length>=5)return{ok:false,code:"STAFF_AUTH_RATE_LIMITED"};
    if(!equalSecret(pin,this.pin)){recent.push(now);this.failures.set(clientKey,recent);return{ok:false,code:"STAFF_PIN_INVALID"}}
    if(!venueId)return{ok:false,code:"STAFF_VENUE_REQUIRED"};this.failures.delete(clientKey);const token=randomBytes(32).toString("base64url");this.sessions.set(token,{expires:now+this.ttlMs,venueId});return{ok:true,token,venueId,maxAge:Math.floor(this.ttlMs/1000)}
  }
  session(token){const value=this.sessions.get(token);if(!value||value.expires<=this.clock()){if(token)this.sessions.delete(token);return null}return{venueId:value.venueId}}
  valid(token,venueId=null){const value=this.session(token);return Boolean(value&&(!venueId||value.venueId===venueId))}
  logout(token){if(token)this.sessions.delete(token)}
}

export const readCookie=(header,name)=>String(header||"").split(";").map(value=>value.trim()).find(value=>value.startsWith(`${name}=`))?.slice(name.length+1)||"";
