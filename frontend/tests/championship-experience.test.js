import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("nested routes use root-relative assets and load the championship journey", async()=>{
  const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
  assert.match(html,/href="\/src\/styles\.css"/);
  assert.match(html,/src="\/src\/championship-experience\.js"/);
  assert.match(html,/src="\/src\/reservation-experience\.js"/);
  assert.doesNotMatch(html,/(?:href|src)="src\//);
});

test("visible confirmation and My Evening remain behind authoritative Reservation Core results",async()=>{
  const source=await readFile(new URL("../src/reservation-experience.js",import.meta.url),"utf8");
  assert.match(source,/response\.ok!==true\|\|result\?\.status!=="CONFIRMED"/);
  assert.match(source,/reservationBoundary\.getReservation\(result\.reservationId\)/);
  assert.match(source,/reservationBoundary\.getReservation\(reservationId\)/);
  assert.match(source,/booking\.reservation=confirmedReservationRecord\(result\)/);
  assert.match(source,/if\(!booking\.reservation\)throw/);
  assert.doesNotMatch(source,/status\s*:\s*["']CONFIRMED["']/);
});

test("manager recovery is proposal-first and requires an explicit apply action",async()=>{
  const source=await readFile(new URL("../src/championship-experience.js",import.meta.url),"utf8");
  assert.match(source,/operationsBoundary\.state\(selectedOperationsVenue\(\)\?\.venueId\)/);
  assert.match(source,/operationsBoundary\.propose/);
  assert.match(source,/operationsBoundary\.apply/);
  assert.match(source,/Approve table move/);
  assert.match(source,/Nothing changes until you approve/);
  assert.match(source,/authoritative commit and fresh room readback/);
  assert.doesNotMatch(source,/TK-1048|Private Alcove|Window Alcove|5\/5 constraints/);
});

test("an impossible recovery is distinct from an authoritative state read failure",async()=>{
  const source=await readFile(new URL("../src/championship-experience.js",import.meta.url),"utf8");
  assert.match(source,/s\.status==="read-error"/);
  assert.match(source,/s\.status==="recovery-impossible"/);
  assert.match(source,/No safe table move is available\./);
  assert.match(source,/No reservation was changed\./);
  assert.match(source,/Return to live room/);
  assert.match(source,/operationsState=beginOperationsRead\(\)/);
  assert.match(source,/operationsState=acceptOperationsRead/);
});

test("operations proxy keeps manager credentials server-side",async()=>{
  const server=await readFile(new URL("../server.mjs",import.meta.url),"utf8");
  const config=server.match(/const publicConfig = \{[\s\S]*?\n    \};/)?.[0]||"";
  assert.match(server,/RESERVATION_CORE_MANAGER_BEARER_TOKEN/);
  assert.doesNotMatch(config,/MANAGER_BEARER/);
  assert.doesNotMatch(config,/RESERVATION_CORE_DEV_BEARER_TOKEN/);
  assert.match(config,/baseUrl: "\/reservation-api"/);
  assert.match(config,/bearerToken: "server-managed"/);
});

test("every catalog restaurant resolves through the single authoritative venue mapping",async()=>{
  const authority=JSON.parse(await readFile(new URL("../../platform/restaurant-authority.json",import.meta.url),"utf8"));
  const catalog=(await import("../../concierge/src/knowledge/fixture-catalog.mjs")).FIXTURE_RESTAURANTS;
  const server=await readFile(new URL("../server.mjs",import.meta.url),"utf8");
  assert.equal(authority.restaurants.length,24);
  assert.deepEqual(new Set(authority.restaurants.map(x=>x.catalogId)),new Set(catalog.map(x=>x.id)));
  assert.equal(new Set(authority.restaurants.map(x=>x.venueId)).size,24);
  assert.match(server,/authoritativeVenueIds/);
  assert.doesNotMatch(server,/fixture-aegean-blue.*fixture-kumo-dining/);
  const experience=await readFile(new URL("../src/reservation-experience.js",import.meta.url),"utf8");
  assert.doesNotMatch(experience,/runtime\(\)\.venueId(?:\W|$)/);
  assert.doesNotMatch(experience,/uuidPattern\.test\(restaurantId/);
});

test("guest reservation review never renders or accepts physical resource identifiers",async()=>{
  const source=await readFile(new URL("../src/reservation-experience.js",import.meta.url),"utf8");
  assert.match(source,/Assigned for your party by the restaurant/);
  assert.doesNotMatch(source,/candidate\.resources\.map\(x=>esc\(x\.resourceId\)\)/);
  assert.doesNotMatch(source,/name="resource|data-resource/i);
});

test("reservation composer keeps Concierge prefill editable and mobile-safe",async()=>{
  const source=await readFile(new URL("../src/reservation-experience.js",import.meta.url),"utf8");
  const styles=await readFile(new URL("../src/styles.css",import.meta.url),"utf8");
  assert.match(source,/name="partySize"/);assert.match(source,/name="date" type="date"/);assert.match(source,/data-time=/);
  assert.match(source,/intent\?\.partySize/);assert.match(source,/intent\?\.requestedRange/);
  assert.match(styles,/reservation-composer/);assert.match(styles,/@media\(max-width:540px\)/);assert.match(styles,/prefers-reduced-motion:reduce/);
});

test("guest-visible availability is grouped by time while PREPARE retains the selected authority candidate",async()=>{
  const source=await readFile(new URL("../src/reservation-experience.js",import.meta.url),"utf8");
  assert.match(source,/uniqueTimeCandidates\(booking\.candidates\)/);
  assert.match(source,/candidate:booking\.candidate/);
  assert.doesNotMatch(source,/data-resource|name="resource/i);
});

test("Dining Pass renders only a customer reference while full reservation identity stays internal",async()=>{
  const source=await readFile(new URL("../src/reservation-experience.js",import.meta.url),"utf8");
  assert.match(source,/customerBookingReference\(r\.reservationId,booking\.venueName\)/);
  assert.doesNotMatch(source,/<dd>\$\{esc\(r\.reservationId\)\}<\/dd>/);
  assert.match(source,/getReservation\(result\.reservationId\)/);
  assert.match(source,/confirmedReservationId",result\.reservationId/);
  assert.match(source,/getReservation\(reservationId\)/);
});

test("availability and overflow styling remain dark, responsive and reduced-motion safe",async()=>{
  const styles=await readFile(new URL("../src/styles.css",import.meta.url),"utf8");
  assert.match(styles,/\.reservation-fallback\{[^}]*linear-gradient\(145deg,#171711,#0c0c09\)/);
  assert.match(styles,/html\.reservation-open,html\.reservation-open body\{overflow:clip!important;scrollbar-width:none\}/);
  assert.match(styles,/html\.reservation-open::-webkit-scrollbar/);
  assert.match(styles,/html\.reservation-open body\{position:fixed;inset:0;width:100%;height:100%\}/);
  assert.match(styles,/\.reservation-journey\{overflow-y:auto;overscroll-behavior:contain\}/);
  assert.match(styles,/\.reservation-journey>section\{max-height:none;overflow:visible;margin:auto\}/);
  assert.match(styles,/@media\(max-width:540px\)/);
  assert.match(styles,/prefers-reduced-motion:reduce/);
});

test("local frontend startup includes the required real Concierge service",async()=>{
  const manifest=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8"));
  const launcher=await readFile(new URL("../start-local.mjs",import.meta.url),"utf8");
  const server=await readFile(new URL("../server.mjs",import.meta.url),"utf8");
  assert.equal(manifest.scripts.dev,"node start-local.mjs");
  assert.match(launcher,/concierge\/src\/server\.mjs/);
  assert.match(launcher,/required_process_exited/);
  assert.match(server,/diagnostic\("concierge_proxy",error\)/);
  assert.match(server,/CONCIERGE_UNAVAILABLE/);
  assert.doesNotMatch(server,/error\?\.message/);
});

test("product shell provides explicit guest and server-gated staff entry",async()=>{
  const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
  const source=await readFile(new URL("../src/championship-experience.js",import.meta.url),"utf8");
  const landing=await readFile(new URL("../src/reference-landing.js",import.meta.url),"utf8");
  const styles=await readFile(new URL("../src/styles.css",import.meta.url),"utf8");
  assert.match(html,/data-enter-guest/);assert.match(html,/data-enter-staff/);
  assert.match(html,/>Customer</);assert.match(html,/>Restaurant Staff</);
  assert.doesNotMatch(html,/>0000</);
  assert.match(landing,/data-enter-guest[^\n]+enter\(ROUTES\.CONCIERGE\)/);
  assert.match(landing,/data-enter-staff[^\n]+enter\(ROUTES\.STAFF_ACCESS\)/);
  assert.match(landing,/tablekeeper:navigate/);assert.match(source,/addEventListener\("tablekeeper:navigate",renderRoute\)/);
  assert.match(source,/staffBoundary\.login/);assert.match(source,/type="password"/);
  assert.match(source,/await staffBoundary\.session\(\)/);assert.match(source,/navigate\("\/staff-access"\)/);
  assert.match(source,/TABLEKEEPER · RESTAURANT OPERATIONS/);assert.match(source,/Select your restaurant/);assert.match(source,/Staff Access/);assert.match(source,/FLOOR INTELLIGENCE/);
  assert.doesNotMatch(source,/KUMO DINING · PRIVATE ACCESS|open the Kumo Dining console/);
  assert.match(source,/tableFloorState\(resources,reservations,\{venueName\}\)/);assert.match(source,/floorMarkup\(resources,reservations,venue\?\.name\)/);assert.match(source,/table order is not a physical floor position/);
  assert.match(source,/Active tables tonight/);
  assert.doesNotMatch(source,/Local Demo Table 1|Local Demo Table 2|Local Demo/);
  assert.doesNotMatch(source,/Manager credentials remain protected/);
  assert.doesNotMatch(source,/proposalDigest\}\}/);
  assert.match(source,/staffBoundary\.logout/);assert.match(styles,/\.staff-active>\.topbar/);
});

test("canonical routes use exact lookup and render an unavailable state",async()=>{
  const source=await readFile(new URL("../src/championship-experience.js",import.meta.url),"utf8");
  assert.match(source,/findRestaurantById\(id\)/);
  assert.match(source,/venue\?venueDetail\(venue\):unavailable\(id\)/);
  assert.match(source,/RESTAURANT UNAVAILABLE/);
  assert.doesNotMatch(source,/\|\|restaurantCatalog\[0\]/);
});

test("Screen 01 preserves backend recommendation authority",async()=>{
  const source=await readFile(new URL("../src/screen01-concierge.js",import.meta.url),"utf8");
  assert.match(source,/fetch\("\/concierge-api\/turn"/);
  assert.match(source,/renderInteraction\(m\.interaction\)/);
  assert.match(source,/interaction\.payload/);
  assert.doesNotMatch(source,/recommendationFor|rankRestaurants|groundedRestaurants/);
  assert.match(source,/turnId:state\.pendingTurnId/);
  assert.match(source,/state\.pendingTurnId=null/);
});

test("stale adapter has no local recommendation dataset or selector",async()=>{
  const source=await readFile(new URL("../src/intelligence-adapter.js",import.meta.url),"utf8");
  assert.doesNotMatch(source,/groundedRestaurants|recommendationFor/);
});
