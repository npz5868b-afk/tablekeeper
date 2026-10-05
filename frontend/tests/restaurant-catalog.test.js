import test from "node:test";
import assert from "node:assert/strict";
import { FIXTURE_RESTAURANTS, materializeFixtureCandidates } from "../../concierge/src/knowledge/fixture-catalog.mjs";
import { findRestaurantById, rankRestaurants, restaurantCatalog } from "../src/restaurant-catalog.js";

const base=()=>({hard:{noBeef:false,stepFree:false},soft:{privacy:40,quiet:40,romance:40,view:40,warmth:40,casual:40},context:{business:false,late:false}});

test("presentation catalog contains every unique canonical fixture identity",()=>{
  assert.equal(restaurantCatalog.length,24);
  const ids=restaurantCatalog.map(x=>x.id);
  assert.equal(new Set(ids).size,24);
  assert.ok(ids.every(id=>id.startsWith("fixture-")));
  assert.deepEqual(ids,FIXTURE_RESTAURANTS.map(x=>x.id));
});

test("frontend factual projection matches the authoritative fixture catalog",()=>{
  const candidates=materializeFixtureCandidates();
  for(const candidate of candidates){
    const item=findRestaurantById(candidate.id);
    assert.equal(item.name,candidate.name);
    assert.equal(item.cuisine,candidate.facts.cuisine[0].toUpperCase()+candidate.facts.cuisine.slice(1));
    assert.equal(item.place.toLowerCase(),candidate.facts.location);
    assert.equal(item.pricePerPerson,candidate.facts.pricePerPerson);
    assert.deepEqual(item.ambience,candidate.facts.ambience);
    assert.deepEqual(item.features,candidate.facts.features);
    assert.deepEqual(item.occasions,candidate.facts.occasions);
  }
});

test("all presentation images are distinct",()=>{
  assert.equal(new Set(restaurantCatalog.map(x=>x.image)).size,24);
});

test("canonical lookup resolves exactly and unknown IDs fail honestly",()=>{
  assert.equal(findRestaurantById("fixture-saffron-terrace")?.name,"Saffron Terrace");
  assert.equal(findRestaurantById("fixture-lotus-yard")?.name,"Lotus Yard");
  assert.equal(findRestaurantById("lotus-yard"),null);
  assert.equal(findRestaurantById("fixture-not-real"),null);
});

test("legacy demo ranking preserves hard filtering without affecting Screen 01",()=>{
  const model=base();model.hard.stepFree=true;model.hard.noBeef=true;
  const ranked=rankRestaurants(model);
  assert.ok(ranked.length>0);
  assert.ok(ranked.every(x=>x.features.includes("accessible")&&x.dietary.includes("no-beef")));
});
