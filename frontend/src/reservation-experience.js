import { createReservationAttemptKeys, reservationBoundary, reservationErrorMessage } from "./reservation-boundary.js";
import { candidateFallbackPresentation, reservationRecoveryPresentation } from "./championship-slice.js";
import { VENUE_TIME_ZONE, venueCalendar, venueDateTimeToInstant, venueWallTimeToInstant } from "./venue-time.js";
import { composeReservationRange, confirmedReservationRecord, customerBookingReference, nearbyReservationRanges, uniqueTimeCandidates } from "./reservation-presentation.js";
import { guestDiningMapMarkup, guestDiningMapModel } from "./guest-dining-map.js";
import { setDiningPlacementVisible } from "./dining-placement-state.js";

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[char]));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const booking = { restaurantId:null, venueId:null, venueName:null, partySize:null, requestedRange:null, candidates:[], candidate:null, preparation:null, accepted:false, confirmation:null, reservation:null, keys:null, error:null, errorDetail:null, errorPhase:null, searchCompleted:false, busy:false,cancelPrompt:false };

function runtime() { return globalThis.TABLEKEEPER_RESERVATION_CORE ?? {}; }
function authoritativeVenueId(restaurantId) {
  const configured = runtime().venueIds?.[restaurantId];
  return uuidPattern.test(configured || "") ? configured : null;
}
function conciergeIntent() {
  try { return JSON.parse(sessionStorage.getItem("tablekeeper.concierge.screen01") || "null")?.publicState?.intent || null; }
  catch { return null; }
}
function slotValue(slots, key) { const value=slots?.[key]; return value && typeof value === "object" ? value.value : value; }
function inferRequestedRange(intent) {
  const dateText=String(slotValue(intent?.slots,"dateText")||"").toLowerCase();
  const timeText=String(slotValue(intent?.slots,"timeText")||"");
  const partySize=Number(slotValue(intent?.slots,"partySize"));
  const time=timeText.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!dateText || !time || !Number.isInteger(partySize) || partySize < 1) return null;
  const now=new Date(),calendar=venueCalendar(now);let year=calendar.year,month=calendar.month,day=calendar.day;
  if (dateText.includes("tomorrow")) { const tomorrow=new Date(Date.UTC(year,month,day+1));year=tomorrow.getUTCFullYear();month=tomorrow.getUTCMonth();day=tomorrow.getUTCDate(); }
  else if (!dateText.includes("today") && !dateText.includes("tonight")) {
    const months=["january","february","march","april","may","june","july","august","september","october","november","december"];
    const date=dateText.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/);
    if(!date)return null;
    month=months.indexOf(date[1]);day=Number(date[2]);const explicitYear=date[3]?Number(date[3]):null;year=explicitYear??year;
    let candidate=venueDateTimeToInstant({year,month,day,hour:0});if(!candidate)return null;
    if(!explicitYear&&candidate.getTime()<now.getTime()){year+=1;candidate=venueDateTimeToInstant({year,month,day,hour:0});if(!candidate)return null;}
  }
  let hour=Number(time[1])%12; if ((time[3]||"pm").toLowerCase()==="pm") hour+=12;
  const start=venueDateTimeToInstant({year,month,day,hour,minute:Number(time[2]||0)});if(!start)return null;
  return { partySize, requestedRange:{start:start.toISOString(),end:new Date(start.getTime()+2*60*60*1000).toISOString()} };
}
function preparationTerms(preparation) {
  const ids=preparation?.policyVersionIds || [];
  return ids.map(policyVersionId => ({ policyVersionId, termsDigest:preparation.termsDigest }));
}
function timeLabel(range) { return new Intl.DateTimeFormat("en-MY",{timeZone:VENUE_TIME_ZONE,dateStyle:"medium",timeStyle:"short"}).format(new Date(range.start)); }
function dateValue(range){if(!range?.start)return"";const local=new Date(new Date(range.start).getTime()+8*3600_000);return`${local.getUTCFullYear()}-${String(local.getUTCMonth()+1).padStart(2,"0")}-${String(local.getUTCDate()).padStart(2,"0")}`;}
function clockValue(range){if(!range?.start)return"19:00";const local=new Date(new Date(range.start).getTime()+8*3600_000);return`${String(local.getUTCHours()).padStart(2,"0")}:${String(local.getUTCMinutes()).padStart(2,"0")}`;}
function minimumDate(){const value=venueCalendar();return`${value.year}-${String(value.month+1).padStart(2,"0")}-${String(value.day).padStart(2,"0")}`;}
function diningTimeLabel(value){const [hour,minute]=value.split(":").map(Number);return new Intl.DateTimeFormat("en-MY",{hour:"numeric",minute:"2-digit",hour12:true,timeZone:"UTC"}).format(new Date(Date.UTC(2020,0,1,hour,minute)));}
const composeRange=composeReservationRange;

const shell=document.createElement("div"); shell.className="reservation-journey"; shell.hidden=true;
const diningMapShell=document.createElement("div");diningMapShell.className="guest-dining-map";diningMapShell.hidden=true;diningMapShell.innerHTML='<button class="guest-map-close" aria-label="Close your table view">×</button><div data-guest-map-content></div>';document.body.append(diningMapShell);diningMapShell.querySelector(".guest-map-close").onclick=()=>setDiningPlacementVisible({reservationShell:shell,placementShell:diningMapShell},false);
shell.innerHTML='<button class="reservation-scrim" aria-label="Close reservation review"></button><section role="dialog" aria-modal="true" aria-labelledby="reservation-heading"><button class="reservation-close" aria-label="Close">\u00d7</button><div data-reservation-content></div></section>';
document.body.append(shell);

function setBusy(value) { booking.busy=value; render(); }
function fail(error,phase) { booking.error=reservationErrorMessage(error); booking.errorDetail={code:error?.code,retryable:error?.retryable===true,correlationId:error?.correlationId}; booking.errorPhase=phase; booking.busy=false; render(); }
function resetFor(restaurantId, venueName) {
  const intent=inferRequestedRange(conciergeIntent());
  const calendar=venueCalendar(),fallbackDate=new Date(Date.UTC(calendar.year,calendar.month,calendar.day+1));
  const fallbackRange=composeRange(`${fallbackDate.getUTCFullYear()}-${String(fallbackDate.getUTCMonth()+1).padStart(2,"0")}-${String(fallbackDate.getUTCDate()).padStart(2,"0")}`,"19:00");
  Object.assign(booking,{restaurantId,venueId:authoritativeVenueId(restaurantId),venueName:venueName||"Selected restaurant",partySize:intent?.partySize||2,requestedRange:intent?.requestedRange||fallbackRange,candidates:[],candidate:null,preparation:null,accepted:false,confirmation:null,reservation:null,keys:createReservationAttemptKeys(),error:null,errorDetail:null,errorPhase:null,searchCompleted:false,busy:false});
}
function setReservationOpen(value){
  if(value&&!document.documentElement.classList.contains("reservation-open")){booking.pageScrollY=scrollY;document.body.style.top=`-${booking.pageScrollY}px`;}
  shell.hidden=!value;document.body.classList.toggle("lock",value);document.documentElement.classList.toggle("reservation-open",value);
  if(!value&&Number.isFinite(booking.pageScrollY)){document.body.style.top="";scrollTo(0,booking.pageScrollY);booking.pageScrollY=null;}
}
function close() { setReservationOpen(false); }
function open(restaurantId, venueName) { resetFor(restaurantId,venueName); setReservationOpen(true); render(); }
async function openSelectionAndSearch({restaurantId,name}) { open(restaurantId,name); if(booking.venueId&&booking.requestedRange&&booking.partySize) await search(); }
async function openPersistedEvening() {
  const reservationId=localStorage.getItem("tablekeeper.confirmedReservationId");
  setReservationOpen(true);
  if (!reservationId) {
    Object.assign(booking,{confirmation:null,reservation:null,error:null,busy:false});
    $("[data-reservation-content]",shell).innerHTML='<small>MY EVENING</small><h2 id="reservation-heading">No confirmed evening yet.</h2><p>A recommendation is not a reservation. Your Dining Pass will appear here once your booking is confirmed.</p>';
    return;
  }
  $("[data-reservation-content]",shell).innerHTML='<small>MY EVENING</small><h2 id="reservation-heading">Retrieving your confirmed evening\u2026</h2>';
  try {
    const result=await reservationBoundary.getReservation(reservationId);
    booking.reservation=confirmedReservationRecord(result);
    if(!booking.reservation)throw Object.assign(new Error("The saved reservation is not confirmed."),{code:"CONFIRMATION_NOT_VERIFIED"});
    booking.confirmation=booking.reservation;
    booking.venueName=booking.reservation.venueName||"Selected restaurant";
    booking.partySize=booking.reservation.partySize;
    booking.candidate={timeRange:booking.reservation.timeRange};
    render();
  } catch(error) {
    localStorage.removeItem("tablekeeper.confirmedReservationId");
    $("[data-reservation-content]",shell).innerHTML=`<small>MY EVENING</small><h2 id="reservation-heading">We could not verify this evening.</h2><div class="reservation-error" role="alert"><b>No confirmation is being shown.</b><p>${esc(reservationErrorMessage(error))}</p></div>`;
  }
}

function renderError() { if(!booking.error)return"";const recovery=reservationRecoveryPresentation(booking.errorDetail,booking.errorPhase);return`<div class="reservation-error ${recovery.uncertain?"reservation-uncertain":""}" role="alert"><b>${esc(recovery.title)}</b><p>${esc(recovery.message||booking.error)}</p>${recovery.message?`<small>${esc(booking.error)}</small>`:""}</div>`; }
function render() {
  const content=$("[data-reservation-content]",shell);
  if (booking.confirmation) {
    const r=booking.reservation || booking.confirmation;
    if(booking.cancelPrompt){content.innerHTML=`<article class="cancellation-confirm"><small>RESERVATION CARE</small><h2 id="reservation-heading">Cancel your evening at ${esc(booking.venueName)}?</h2><p>Your reservation and allocated table will be released. This cannot be undone.</p>${renderError()}<button class="reservation-primary" data-keep-reservation ${booking.busy?"disabled":""}>KEEP RESERVATION</button><button class="reservation-cancel-confirm" data-confirm-cancellation ${booking.busy?"disabled":""}>${booking.busy?"CANCELLING…":"YES, CANCEL BOOKING"}</button></article>`;content.querySelector("[data-keep-reservation]").onclick=()=>{booking.cancelPrompt=false;booking.error=null;render()};content.querySelector("[data-confirm-cancellation]").onclick=cancelReservation;return;}
    const cancelled=r.status==="CANCELLED";
    content.innerHTML=`<article class="authoritative-pass ${cancelled?"is-cancelled":""}"><small>TABLEKEEPER \u00b7 DINING PASS</small><b>${cancelled?"CANCELLED":"CONFIRMED"}</b><h2 id="reservation-heading">${esc(booking.venueName)}</h2><dl><div class="booking-reference"><dt>Booking reference</dt><dd>${esc(customerBookingReference(r.reservationId,booking.venueName))}</dd></div><div><dt>Status</dt><dd>${esc(r.status)}</dd></div><div><dt>Party</dt><dd>${esc(r.partySize||booking.partySize)}</dd></div><div><dt>Time</dt><dd>${esc(timeLabel(r.timeRange||booking.candidate?.timeRange))}</dd></div></dl>${cancelled?'<p class="cancelled-note">This evening was cancelled and its table was released.</p>':'<button class="reservation-primary guest-map-action" data-view-your-table>VIEW YOUR TABLE</button><button class="reservation-cancel-action" data-cancel-booking>CANCEL BOOKING</button><p>Verified booking · Tablekeeper</p>'}</article>`;
    content.querySelector("[data-view-your-table]")?.addEventListener("click",()=>openDiningMap(r));
    content.querySelector("[data-cancel-booking]")?.addEventListener("click",()=>{booking.cancelPrompt=true;booking.error=null;render()});
    return;
  }
  if (booking.preparation) {
    const terms=preparationTerms(booking.preparation);
    const recovery=reservationRecoveryPresentation(booking.errorDetail,booking.errorPhase);
    content.innerHTML=`<small>BOOKING TERMS</small><h2 id="reservation-heading">Review before confirming</h2><p>${esc(booking.preparation.termsArtifact)}</p><dl class="reservation-facts"><div><dt>Expires</dt><dd>${esc(timeLabel({start:booking.preparation.expiresAt}))}</dd></div><div><dt>Policies</dt><dd>${terms.length}</dd></div></dl>${renderError()}<label class="reservation-accept"><input type="checkbox" ${booking.accepted?"checked":""}> I have read and accept these booking terms.</label><button class="reservation-primary" data-confirm ${booking.accepted&&!booking.busy?"":"disabled"}>${booking.busy?"Confirming\u2026":esc(booking.errorPhase==="confirm"?recovery.action:"Confirm reservation")}</button>`;
    $("input",content).onchange=e=>{booking.accepted=e.target.checked;booking.error=null;render()};
    $("[data-confirm]",content).onclick=confirm;
    return;
  }
  if (booking.candidate) {
    content.innerHTML=`<small>LIVE AVAILABILITY</small><h2 id="reservation-heading">Review this time</h2><p>Availability will be checked again when you confirm. No reservation has been made yet.</p><dl class="reservation-facts"><div><dt>Time</dt><dd>${esc(timeLabel(booking.candidate.timeRange))}</dd></div><div><dt>Table</dt><dd>Assigned for your party by the restaurant</dd></div></dl>${renderError()}<button class="reservation-primary" data-prepare ${booking.busy?"disabled":""}>${booking.busy?"Preparing\u2026":"Review booking terms"}</button>`;
    $("[data-prepare]",content).onclick=prepare;
    return;
  }
  const ready=booking.venueId&&booking.requestedRange&&booking.partySize;
  const needsRequest=!booking.requestedRange||!booking.partySize;
  const venueMissing=!booking.venueId;
  return renderComposer(content,{ready,venueMissing});
  content.innerHTML=`<small>LIVE RESERVATION</small><h2 id="reservation-heading">${esc(booking.venueName)}</h2><p>${ready?`${booking.partySize} guests \u00b7 ${esc(timeLabel(booking.requestedRange))}`:venueMissing?"Live booking is not available for this restaurant yet.":"Choose your party size and preferred time to search live availability."}</p>${renderError()}${needsRequest&&!venueMissing?`<form class="reservation-request" data-request-form><label>Party size<input name="partySize" type="number" min="1" max="20" value="2" required></label><label>Requested start<input name="start" type="datetime-local" required></label><button class="reservation-primary">Continue to live availability</button></form>`:""}${booking.candidates.length?`<div class="reservation-fallback"><small>AVAILABLE OPTIONS</small><p>Your party size and requested range remain unchanged until you choose an option.</p></div><div class="reservation-candidates">${booking.candidates.map((candidate,index)=>{const fallback=candidateFallbackPresentation(candidate,booking.requestedRange);return`<button data-candidate="${index}"><b>${esc(timeLabel(candidate.timeRange))}</b><span>${esc(fallback.label)} · Availability not yet confirmed</span></button>`}).join("")}</div>`:!needsRequest?`${booking.searchCompleted?'<div class="reservation-fallback"><b>No available time was found.</b><p>Your party size and requested time are preserved. Waitlist is not offered because this system does not support it.</p><button type="button" data-back-to-recommendations>View other restaurant options</button></div>':""}<button class="reservation-primary" data-search ${ready&&!booking.busy?"":"disabled"}>${booking.busy?"Checking\u2026":booking.searchCompleted?"Check this time again":"Check live availability"}</button>`:""}`;
  $("[data-request-form]",content)?.addEventListener("submit",event=>{event.preventDefault();const form=new FormData(event.currentTarget),start=venueWallTimeToInstant(String(form.get("start"))),partySize=Number(form.get("partySize"));if(!Number.isInteger(partySize)||partySize<1||!start)return;booking.partySize=partySize;booking.requestedRange={start:start.toISOString(),end:new Date(start.getTime()+2*60*60*1000).toISOString()};booking.error=null;render()});
  $("[data-search]",content)?.addEventListener("click",search);
  $("[data-back-to-recommendations]",content)?.addEventListener("click",close);
  content.querySelectorAll("[data-candidate]").forEach(button=>button.onclick=()=>{booking.candidate=booking.candidates[Number(button.dataset.candidate)];booking.error=null;render()});
}
async function openDiningMap(reservation){const content=diningMapShell.querySelector("[data-guest-map-content]");setDiningPlacementVisible({reservationShell:shell,placementShell:diningMapShell},true);content.innerHTML='<section class="guest-map-unavailable"><small>YOUR DINING PLACEMENT</small><h2>Revealing your table…</h2></section>';try{const projection=await reservationBoundary.getDiningMap(reservation.reservationId),model=guestDiningMapModel(projection);content.innerHTML=guestDiningMapMarkup(model,{bookingReference:customerBookingReference(reservation.reservationId,booking.venueName),timeLabel:timeLabel(reservation.timeRange||booking.candidate?.timeRange)});}catch{content.innerHTML=guestDiningMapMarkup({available:false});}}
function renderComposer(content,{ready,venueMissing}) {
  const visibleCandidates=uniqueTimeCandidates(booking.candidates);
  const diningTimes=nearbyReservationRanges(dateValue(booking.requestedRange),clockValue(booking.requestedRange)).map(range=>range.time);
  content.innerHTML=`<small>RESERVE YOUR EVENING</small><h2 id="reservation-heading">${esc(booking.venueName)}</h2><p class="reservation-intro">Choose the details of your evening. We will check the restaurant's live availability.</p>${renderError()}${venueMissing?'<div class="reservation-fallback"><b>Reservations are not available here yet.</b><p>Nothing has been booked.</p></div>':`<form class="reservation-composer" data-request-form><label><span>Party</span><select name="partySize" aria-label="Party size">${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${booking.partySize===i+1?"selected":""}>${i+1} ${i?"guests":"guest"}</option>`).join("")}</select></label><label><span>Date</span><input name="date" type="date" min="${minimumDate()}" value="${dateValue(booking.requestedRange)}" required></label><fieldset><legend>Preferred time</legend><div class="reservation-times">${diningTimes.map(time=>`<button type="button" data-time="${time}" class="${clockValue(booking.requestedRange)===time?"selected":""}" aria-pressed="${clockValue(booking.requestedRange)===time}">${diningTimeLabel(time)}</button>`).join("")}</div><input type="hidden" name="time" value="${clockValue(booking.requestedRange)}"></fieldset><button class="reservation-primary metallic-cta" ${ready&&!booking.busy?"":"disabled"}>${booking.busy?"Checking\u2026":"Check availability"}</button></form>`}${visibleCandidates.length?`<div class="reservation-fallback"><small>LIVE AVAILABILITY</small><p>These times are available now for your party. Availability is checked again before confirmation.</p></div><div class="reservation-candidates">${visibleCandidates.map((candidate,index)=>{const fallback=candidateFallbackPresentation(candidate,booking.requestedRange);return`<button data-candidate="${index}"><b>${esc(timeLabel(candidate.timeRange))}</b><span>${esc(fallback.label)}</span></button>`}).join("")}</div>`:booking.searchCompleted?'<div class="reservation-fallback"><b>No available time was found nearby.</b><p>Choose another preferred time or date. Nothing has been booked.</p></div>':""}`;
  $("[data-request-form]",content)?.addEventListener("submit",event=>{event.preventDefault();const form=new FormData(event.currentTarget),partySize=Number(form.get("partySize")),range=composeRange(String(form.get("date")),String(form.get("time")));if(!Number.isInteger(partySize)||partySize<1||!range)return;booking.partySize=partySize;booking.requestedRange=range;booking.candidates=[];booking.searchCompleted=false;booking.error=null;search();});
  content.querySelectorAll("[data-time]").forEach(button=>button.onclick=()=>{const form=button.closest("form"),range=composeRange(form.elements.date.value,button.dataset.time),partySize=Number(form.elements.partySize.value);if(!range||!Number.isInteger(partySize)||partySize<1)return;booking.partySize=partySize;booking.requestedRange=range;booking.candidates=[];booking.searchCompleted=false;render();});
  content.querySelectorAll("[data-candidate]").forEach(button=>button.onclick=()=>{booking.candidate=visibleCandidates[Number(button.dataset.candidate)];booking.error=null;render()});
}
async function search() { setBusy(true); try { const ranges=nearbyReservationRanges(dateValue(booking.requestedRange),clockValue(booking.requestedRange)); const results=await Promise.all(ranges.map(requestedRange=>reservationBoundary.searchAvailability({venueId:booking.venueId,partySize:booking.partySize,requestedRange:{start:requestedRange.start,end:requestedRange.end}}))); booking.candidates=results.flatMap(result=>result.candidates||[]); booking.searchCompleted=true; booking.error=null; booking.errorDetail=null; booking.errorPhase=null; booking.busy=false; render(); } catch(error) { fail(error,"search"); } }
async function prepare() { setBusy(true); try { const response=await reservationBoundary.prepareReservation({venueId:booking.venueId,partySize:booking.partySize,requestedRange:booking.candidate.timeRange,candidate:booking.candidate,idempotencyKey:booking.keys.prepare}); booking.preparation=response.result||response; booking.error=null; booking.errorDetail=null; booking.errorPhase=null; booking.busy=false; render(); } catch(error) { fail(error,"prepare"); } }
async function confirm() { setBusy(true); try { const acceptedAt=new Date().toISOString(); const acceptedTerms=preparationTerms(booking.preparation).map(term=>({...term,acceptedAt,acceptedBy:{actorId:runtime().actorId,actorType:runtime().actorType},acceptanceChannel:"WEB"})); const response=await reservationBoundary.confirmReservation({confirmationToken:booking.preparation.confirmationToken,acceptedTerms,idempotencyKey:booking.keys.confirm}); const result=response.result; if (response.ok!==true||result?.status!=="CONFIRMED"||!result.reservationId) throw Object.assign(new Error("No authoritative confirmation was returned."),{code:"CONFIRMATION_NOT_VERIFIED"}); booking.confirmation=result; try { booking.reservation=await reservationBoundary.getReservation(result.reservationId); } catch { booking.reservation=null; } localStorage.setItem("tablekeeper.confirmedReservationId",result.reservationId); booking.busy=false; render(); } catch(error) { fail(error,"confirm"); } }
async function cancelReservation(){booking.busy=true;booking.error=null;render();try{const reservationId=(booking.reservation||booking.confirmation)?.reservationId,response=await reservationBoundary.cancelReservation({reservationId,idempotencyKey:booking.keys?.cancel||(booking.keys=createReservationAttemptKeys()).cancel});if(response.ok!==true||response.result?.status!=="CANCELLED")throw Object.assign(new Error("Cancellation was not authoritatively verified."),{code:"CANCELLATION_NOT_VERIFIED"});booking.reservation=await reservationBoundary.getReservation(reservationId);booking.confirmation=booking.reservation;booking.cancelPrompt=false;booking.busy=false;render()}catch(error){booking.busy=false;booking.error=reservationErrorMessage(error);booking.errorDetail={code:error?.code,retryable:error?.retryable===true};booking.errorPhase="cancel";render()}}

document.addEventListener("click",event=>{ const target=event.target.closest("[data-reserve-restaurant]"); if(target) open(target.dataset.reserveRestaurant,target.dataset.venueName||"Selected restaurant"); if(event.target.closest(".reservation-close,.reservation-scrim")) close(); });
document.addEventListener("tablekeeper:reservation-selection",event=>{openSelectionAndSearch(event.detail).catch(error=>fail(error,"search"));});
document.addEventListener("click",event=>{ if(event.target.closest("[data-evening],.topbar [data-view='evening']")){event.preventDefault();event.stopImmediatePropagation();openPersistedEvening();} },true);
document.addEventListener("keydown",event=>{ if(event.key==="Escape"&&!shell.hidden) close(); });

export { authoritativeVenueId, composeRange, inferRequestedRange, preparationTerms, uniqueTimeCandidates };
