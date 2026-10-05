import assert from "node:assert/strict";
import test from "node:test";
import { tableFloorState } from "../src/staff-floor-intelligence.js";

const resources=[
  {id:"resource-2",label:"Table 02",capacity:4,active:true},
  {id:"resource-1",label:"Table 01",capacity:2,active:true},
  {id:"resource-3",label:"Table 03",capacity:6,active:false}
];
const reservations=[
  {id:"7ad7d7a2-d216-4694-9033-bee925ba2ffe",resourceId:"resource-1",status:"CONFIRMED",partySize:2,start:"2026-10-05T11:30:00.000Z",end:"2026-10-05T13:30:00.000Z"},
  {id:"6ad7d7a2-d216-4694-9033-bee925ba2ff1",resourceId:"resource-2",status:"CONFIRMED",partySize:4,start:"2026-10-05T14:00:00.000Z",end:"2026-10-05T16:00:00.000Z"}
];

test("floor state derives occupied, reserved and inactive status from authoritative snapshot",()=>{
  const floor=tableFloorState(resources,reservations,{at:"2026-10-05T12:00:00.000Z",venueName:"Kumo Dining"});
  assert.deepEqual(floor.map(table=>[table.label,table.status]),[["Table 01","OCCUPIED"],["Table 02","RESERVED"],["Table 03","OUT_OF_SERVICE"]]);
  assert.equal(floor[0].reservationReference,"TK-KUMO-2FFE");
  assert.equal(floor[0].resourceId,"resource-1");
});

test("floor state never invents a reservation for an unallocated active table",()=>{
  const [table]=tableFloorState([{id:"resource-4",label:"Table 04",capacity:8,active:true}],[],{at:"2026-10-05T12:00:00.000Z"});
  assert.equal(table.status,"AVAILABLE");
  assert.equal(table.reservation,null);
});

test("floor booking references use the selected venue rather than a demo fallback",()=>{
  const [table]=tableFloorState(resources,reservations,{at:"2026-10-05T12:00:00.000Z",venueName:"Basil House"});
  assert.equal(table.reservationReference,"TK-BASIL-2FFE");
});
