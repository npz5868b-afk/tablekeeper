import test from "node:test";
import assert from "node:assert/strict";
import { StaffSessionAuthority, readCookie } from "../staff-session.mjs";

test("staff PIN issues an expiring opaque session without exposing the PIN",()=>{
  let now=1000;const authority=new StaffSessionAuthority({pin:"0000",ttlMs:500,clock:()=>now});
  assert.equal(authority.login("1234","venue-a","desk").ok,false);
  const login=authority.login("0000","venue-a","desk");assert.equal(login.ok,true);assert.equal(login.venueId,"venue-a");assert.match(login.token,/^[A-Za-z0-9_-]+$/);assert.doesNotMatch(login.token,/0000/);assert.equal(authority.valid(login.token,"venue-a"),true);assert.equal(authority.valid(login.token,"venue-b"),false);
  now=1501;assert.equal(authority.valid(login.token),false);
});

test("staff session logout and cookie parsing fail closed",()=>{
  const authority=new StaffSessionAuthority({pin:"0000"}),login=authority.login("0000","venue-a");
  assert.equal(readCookie(`theme=dark; tablekeeper_staff=${login.token}`,"tablekeeper_staff"),login.token);
  authority.logout(login.token);assert.equal(authority.valid(login.token),false);assert.equal(authority.valid("unknown"),false);
});

test("repeated invalid staff attempts are rate limited",()=>{
  const authority=new StaffSessionAuthority({pin:"0000"});for(let i=0;i<5;i++)assert.equal(authority.login("9999","venue-a","desk").code,"STAFF_PIN_INVALID");assert.equal(authority.login("0000","venue-a","desk").code,"STAFF_AUTH_RATE_LIMITED");
});
