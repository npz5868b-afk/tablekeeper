const labels={partySize:"Party",dateText:"Date",timeText:"Time",timeFlexibility:"Time flexibility",occasionAmbience:"Occasion",ambience:"Atmosphere",location:"Location",budget:"Budget",dietary:"Dietary",accessibility:"Accessibility"};

export function presentIntentField(key,value){
  const label=labels[key]||String(key??"").replace(/([A-Z])/g," $1").trim();
  if(key!=="timeFlexibility")return{label,value};
  const normalized=String(value??"").trim().toLowerCase();
  const displayedValue=normalized==="around"?"Flexible around this time":normalized==="exact"?"At this exact time":normalized==="flexible"?"Flexible timing":value;
  return{label, value:displayedValue};
}

export function presentIntentLabel(key){return(labels[key]||String(key??"").replace(/([A-Z])/g," $1").trim())}

export function renderIntentRows(intent,escapeHtml){
  const esc=escapeHtml;
  const slots=Object.entries(intent?.slots||{});
  const constraints=intent?.constraints||[];
  const slotRows=slots.map(([key,slot])=>{const field=presentIntentField(key,slot.value);return`<div class="public-slot" data-slot="${esc(key)}"><small>${esc(field.label)}</small><b>${esc(field.value)}</b></div>`}).join("");
  const constraintRows=constraints.map(constraint=>{const field=presentIntentField(constraint.key,constraint.value);const label=field.label;return`<div class="public-slot ${constraint.hardness==="HARD"?"protected":""}" data-slot="${esc(constraint.key)}"><small>${esc(label)}</small><b>${esc(field.value)}</b></div>`}).join("");
  return slotRows+constraintRows;
}
