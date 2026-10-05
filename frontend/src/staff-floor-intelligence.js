import { customerBookingReference } from "./reservation-presentation.js";

export function tableFloorState(resources,reservations,{at=new Date(),venueName="TABLEKEEPER"}={}) {
  const instant=+new Date(at);
  return [...(resources??[])].sort((a,b)=>String(a.label).localeCompare(String(b.label),undefined,{numeric:true})).map(resource=>{
    const assigned=(reservations??[]).filter(item=>item.resourceId===resource.id&&item.status==="CONFIRMED").sort((a,b)=>+new Date(a.start)-+new Date(b.start));
    const current=assigned.find(item=>+new Date(item.start)<=instant&&instant<+new Date(item.end));
    const upcoming=assigned.find(item=>+new Date(item.start)>instant);
    const reservation=current||upcoming||null;
    const status=!resource.active?"OUT_OF_SERVICE":current?"OCCUPIED":upcoming?"RESERVED":"AVAILABLE";
    return {resourceId:resource.id,label:resource.label,capacity:resource.capacity,status,reservation,reservationReference:reservation?customerBookingReference(reservation.id,venueName):null};
  });
}
