import { venueWallTimeToInstant } from "./venue-time.js";

export function composeReservationRange(date,time) {
  const start=venueWallTimeToInstant(`${date}T${time}`);
  return start?{start:start.toISOString(),end:new Date(start.getTime()+2*3600_000).toISOString()}:null;
}

export function uniqueTimeCandidates(candidates) {
  const unique=new Map();
  for(const candidate of candidates??[]){
    const key=candidate?.timeRange?.start;
    if(key&&!unique.has(key))unique.set(key,candidate);
  }
  return [...unique.values()];
}

export function nearbyReservationRanges(date,preferredTime,{count=5,stepMinutes=30,durationMinutes=120}={}) {
  const match=/^(\d{2}):(\d{2})$/.exec(String(preferredTime));
  if(!match||count<1||count%2===0)return [];
  const center=Number(match[1])*60+Number(match[2]),radius=Math.floor(count/2),ranges=[];
  for(let offset=-radius;offset<=radius;offset+=1){
    const minute=center+offset*stepMinutes;
    if(minute<0||minute>=24*60)continue;
    const time=`${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`;
    const composed=composeReservationRange(date,time);
    if(composed)ranges.push({...composed,time,end:new Date(new Date(composed.start).getTime()+durationMinutes*60_000).toISOString()});
  }
  return ranges;
}

export function customerBookingReference(reservationId,venueName="TABLEKEEPER") {
  const venue=String(venueName).normalize("NFKD").replace(/[^a-z0-9 ]/gi,"").trim().split(/\s+/)[0]?.toUpperCase().slice(0,8)||"BOOKING";
  const suffix=String(reservationId).replace(/[^a-f0-9]/gi,"").slice(-4).toUpperCase();
  return suffix?`TK-${venue}-${suffix}`:`TK-${venue}`;
}

export function confirmedReservationRecord(value) {
  const result=value?.result??value;
  return result&&typeof result==="object"&&["CONFIRMED","CANCELLED"].includes(result.status)&&typeof result.reservationId==="string"&&result.reservationId?result:null;
}
