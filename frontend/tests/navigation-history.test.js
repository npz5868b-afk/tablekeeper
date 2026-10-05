import test from "node:test";
import assert from "node:assert/strict";
import {customerParentRoute,exitStaffToWelcome,navigateRoute,returnCustomerToParent,ROUTES} from "../src/navigation.js";

function browser(initial=[ROUTES.WELCOME]){
  const stack=[...initial];let index=stack.length-1;const events=[];
  globalThis.history={pushState(_s,_t,path){stack.splice(++index);stack.push(path)},replaceState(_s,_t,path){stack[index]=path},back(){if(index>0)index--}};
  globalThis.location={get pathname(){return stack[index]}};
  globalThis.CustomEvent=class{constructor(type,options){this.type=type;this.detail=options.detail}};
  globalThis.dispatchEvent=event=>events.push(event);
  return{stack,current:()=>stack[index],back:()=>history.back(),events};
}

test("leaving Staff replaces its history entry so welcome Back cannot reopen Staff",()=>{
  const b=browser();navigateRoute(ROUTES.STAFF_ACCESS);exitStaffToWelcome();
  assert.deepEqual(b.stack,[ROUTES.WELCOME,ROUTES.WELCOME]);assert.equal(b.current(),ROUTES.WELCOME);
  b.back();assert.equal(b.current(),ROUTES.WELCOME);assert.equal(b.stack.includes(ROUTES.STAFF_ACCESS),false);
});

test("direct Staff entry exits safely and remains stable after refresh semantics",()=>{
  const b=browser([ROUTES.STAFF_ACCESS]);exitStaffToWelcome();
  assert.deepEqual(b.stack,[ROUTES.WELCOME]);assert.equal(b.events.at(-1).detail.replace,true);
});

test("customer Back follows canonical hierarchy instead of incidental Staff history",()=>{
  assert.equal(customerParentRoute(ROUTES.CONCIERGE),ROUTES.WELCOME);
  assert.equal(customerParentRoute("/recommendation/fixture-kumo-dining"),ROUTES.CONCIERGE);
  assert.equal(customerParentRoute("/restaurant/fixture-kumo-dining"),"/discovery");
  const b=browser([ROUTES.STAFF_ACCESS,ROUTES.CONCIERGE]);returnCustomerToParent();
  assert.equal(b.current(),ROUTES.WELCOME);assert.equal(b.stack.at(-1),ROUTES.WELCOME);
});

test("Staff restaurant selection remains an in-flow transition before scoped login",async()=>{
  const source=await (await import("node:fs/promises")).readFile(new URL("../src/championship-experience.js",import.meta.url),"utf8");
  assert.match(source,/selectedOperationsRestaurantId=button\.dataset\.selectStaffVenue/);
  assert.match(source,/staffAccess\(\).*return/);
  assert.match(source,/staffBoundary\.login\(selectedVenue\.venueId,pin\)/);
  assert.match(source,/data-staff-home[^\n]+selectedOperationsRestaurantId=null;staffAccess\(\)/);
});
