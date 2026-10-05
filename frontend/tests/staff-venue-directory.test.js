import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {restaurantCatalog} from "../src/restaurant-catalog.js";
import {directoryLocations,filterStaffVenues} from "../src/staff-venue-directory.js";

test("staff directory searches the canonical 24 venues by name and location",()=>{
  assert.equal(restaurantCatalog.length,24);
  assert.deepEqual(filterStaffVenues(restaurantCatalog,{query:"kumo"}).map(v=>v.name),["Kumo Dining"]);
  assert.equal(filterStaffVenues(restaurantCatalog,{query:"bangsar"}).length,restaurantCatalog.filter(v=>v.place==="Bangsar").length);
  assert.equal(filterStaffVenues(restaurantCatalog,{query:"garden",location:"Bukit Bintang"}).length,1);
  assert.equal(filterStaffVenues(restaurantCatalog,{query:"not-a-restaurant"}).length,0);
});

test("location chips and imagery derive only from the canonical catalog",()=>{
  assert.deepEqual(directoryLocations(restaurantCatalog),[...new Set(restaurantCatalog.map(v=>v.place))].sort());
  assert.equal(restaurantCatalog.every(v=>/^https:\/\/images\.unsplash\.com\/photo-/.test(v.image)),true);
  assert.equal(new Set(restaurantCatalog.map(v=>v.image)).size,24);
});

test("selector remains responsive, reduced-motion safe, and hands canonical identity to authentication",async()=>{
  const source=await readFile(new URL("../src/championship-experience.js",import.meta.url),"utf8");
  const styles=await readFile(new URL("../src/styles.css",import.meta.url),"utf8");
  assert.match(source,/filterStaffVenues\(venues,\{query:staffVenueQuery,location:staffVenueLocation\}\)/);
  assert.match(source,/selectedOperationsRestaurantId=button\.dataset\.selectStaffVenue/);
  assert.match(source,/staffBoundary\.login\(selectedVenue\.venueId,pin\)/);
  assert.match(source,/selectedVenue\?\.image/);
  assert.match(styles,/@media\(max-width:1050px\).*staff-venue-grid/);
  assert.match(styles,/@media\(max-width:520px\).*staff-venue-grid/);
  assert.match(styles,/@media\(prefers-reduced-motion:reduce\).*staff-venue-card/);
  assert.match(styles,/overflow-x:auto/);
});
