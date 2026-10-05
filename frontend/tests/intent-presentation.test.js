import test from"node:test";
import assert from"node:assert/strict";
import{presentIntentField,renderIntentRows}from"../src/intent-presentation.js";

test("canonical timeFlexibility around is guest-facing in the live row formatter",()=>{
  const field=presentIntentField("timeFlexibility","around");
  assert.deepEqual(field,{label:"Time flexibility",value:"Flexible around this time"});
  assert.notEqual(field.label,"timeFlexibility");
  assert.notEqual(field.value,"around");
});

test("constraint rows use the guest-facing time flexibility presentation",()=>{
  const html=renderIntentRows({constraints:[{key:"timeFlexibility",value:"around",hardness:"SOFT"}]},String);
  assert.match(html,/<small>Time flexibility<\/small><b>Flexible around this time<\/b>/);
  assert.doesNotMatch(html,/<small>timeFlexibility<\/small>|<b>around<\/b>/);
});

test("YOUR EVENING immediately projects canonical party size and no longer lists Party missing",()=>{
  const intent={slots:{occasion:{value:"anniversary"},partySize:{value:2}},constraints:[],readiness:{missing:["dateText","timeText"]}};
  const html=renderIntentRows(intent,String);
  assert.match(html,/data-slot="partySize"><small>Party<\/small><b>2<\/b>/);
  assert.equal(intent.readiness.missing.includes("partySize"),false);
});
