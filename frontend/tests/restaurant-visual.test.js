import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { restaurantCatalog, findRestaurantById } from "../src/restaurant-catalog.js";
import { restaurantVisual, topRecommendationId } from "../src/restaurant-visual.js";

test("Your Evening follows the backend-authoritative top recommendation",()=>{
  const a=topRecommendationId({type:"recommendations",payload:[{id:"fixture-lotus-yard"}]});
  const b=topRecommendationId({type:"recommendations",payload:[{id:"fixture-mizu-counter"}]});
  assert.equal(restaurantVisual(a).image,findRestaurantById(a).image);
  assert.equal(restaurantVisual(b).image,findRestaurantById(b).image);
  assert.notEqual(restaurantVisual(a).image,restaurantVisual(b).image);
});

test("unknown identity has a neutral fallback, never another restaurant image",()=>{
  assert.equal(restaurantVisual("fixture-unknown").image,null);
});

test("all 24 presentation images remain unique",()=>{
  assert.equal(restaurantCatalog.length,24);
  assert.equal(new Set(restaurantCatalog.map(item=>item.image)).size,24);
});

test("portrait transition is reduced-motion safe",()=>{
  const css=fs.readFileSync(new URL("../src/screen02-correction.css",import.meta.url),"utf8");
  assert.match(css,/prefers-reduced-motion:reduce[^]*intent-restaurant-portrait img[^]*transition:none/);
});
