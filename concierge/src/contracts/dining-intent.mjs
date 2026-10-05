const TYPES = new Set(["SEARCH_AVAILABILITY", "ASK_POLICY", "WHY", "COMPARE", "REJECT", "CHANGE_CONSTRAINT", "CHANGE_PREFERENCE", "ACCEPT", "UNKNOWN"]);
const HARDNESS = new Set(["HARD", "SOFT"]);
const PROVENANCE = new Set(["EXPLICIT", "INFERRED"]);
const OPERATIONS = new Set(["SET", "REPLACE", "REMOVE", "KEEP"]);
export const SLOT_KEYS = Object.freeze(["partySize", "dateText", "timeText", "budgetMin", "budgetMax", "budgetBasis", "occasion"]);
export const CONSTRAINT_KEYS = Object.freeze(["cuisine", "location", "pricePerPersonMax", "dietary", "accessibility", "ambience", "occasionAmbience", "style", "seating", "feature", "formality", "timeFlexibility"]);
export const INTENT_UPDATE_KEY_CONTRACT = Object.freeze({
  SLOT: SLOT_KEYS,
  CONSTRAINT: CONSTRAINT_KEYS,
  SELECTED_CANDIDATE: Object.freeze(["selectedCandidateId"])
});
const SLOT_KEY_SET = new Set(SLOT_KEYS), CONSTRAINT_KEY_SET = new Set(CONSTRAINT_KEYS);
const clone = value => structuredClone(value);
const object = value => value && typeof value === "object" && !Array.isArray(value);
const finite = value => typeof value === "number" && Number.isFinite(value);
const PARTY_WORDS = Object.freeze({ one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12 });
const PARTY_TOKEN = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";

export class ContractValidationError extends Error { constructor(message, issues = []) { super(message); this.name = "ContractValidationError"; this.issues = issues; } }
export function createDiningIntent() { return { version:1, intentType:"UNKNOWN", slots:{}, constraints:[], selectedCandidateId:null, readiness:{ ready:false, missing:["partySize", "dateText", "timeText"], blocking:true }, ambiguities:[], contradictions:[] }; }

function canonicalPartyValue(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  const token=String(value??"").trim().toLowerCase();
  if (/^\d+$/.test(token) && Number(token)>0) return Number(token);
  return PARTY_WORDS[token]??null;
}

export function extractExplicitPartySize(turn) {
  const text=String(turn??"");
  const patterns=[
    new RegExp(`\\b(?:just\\s+)?(?:the\\s+)?(${PARTY_TOKEN})\\s+of\\s+us\\b`,"i"),
    new RegExp(`\\b(?:just\\s+)?us\\s+(${PARTY_TOKEN})\\b`,"i"),
    new RegExp(`\\bfor\\s+(${PARTY_TOKEN})\\b`,"i"),
    new RegExp(`\\b(${PARTY_TOKEN})\\s+(?:people|guests|persons?)\\b`,"i")
  ];
  for (const pattern of patterns) {
    const match=pattern.exec(text);
    const value=canonicalPartyValue(match?.[1]);
    if (value) return { value, sourceText:match[0] };
  }
  return null;
}

// Provider output is still authoritative for semantic intent. This boundary only
// canonicalizes an accepted, explicit party-size answer and fills that same
// field when the current graph is specifically waiting for it.
export function normalizeIntentUpdate(turn,currentIntent,rawUpdate) {
  const update=clone(rawUpdate), explicit=extractExplicitPartySize(turn);
  if (!object(update)||!Array.isArray(update.operations)) return update;
  let resolved=false;
  for (const operation of update.operations) {
    if (operation?.target!=="SLOT"||operation.key!=="partySize"||!["SET","REPLACE"].includes(operation.operation)) continue;
    const canonical=canonicalPartyValue(operation.value);
    if (canonical) { operation.value=canonical; resolved=true; }
  }
  const waitingForParty=currentIntent?.readiness?.missing?.includes("partySize")||currentIntent?.slots?.partySize?.value==null;
  if (!resolved&&waitingForParty&&explicit) {
    update.operations.push({operation:currentIntent?.slots?.partySize?.value==null?"SET":"REPLACE",target:"SLOT",key:"partySize",value:explicit.value,hardness:null,provenance:"EXPLICIT",confidence:1,sourceText:explicit.sourceText,weight:null});
    resolved=true;
  }
  if (resolved&&explicit) {
    if (Array.isArray(update.ambiguities)) update.ambiguities=update.ambiguities.filter(item=>!/(party|people|guest|diner)/i.test(item));
    if (typeof update.candidateNextQuestion==="string"&&/(how many|party|people|guest|diner)/i.test(update.candidateNextQuestion)) update.candidateNextQuestion=null;
  }
  return update;
}

function validateField(field, path) {
  const issues=[];
  if (!object(field) || !("value" in field)) return [`${path} must contain value`];
  if (!PROVENANCE.has(field.provenance)) issues.push(`${path}.provenance invalid`);
  if (!finite(field.confidence) || field.confidence < 0 || field.confidence > 1) issues.push(`${path}.confidence must be 0..1`);
  if (typeof field.sourceText !== "string" || !field.sourceText.trim()) issues.push(`${path}.sourceText required`);
  return issues;
}

function validateOperation(item,index) {
  const path=`operations.${index}`, issues=[];
  if (!object(item)) return [`${path} must be an object`];
  const allowed=new Set(["operation","target","key","value","hardness","provenance","confidence","sourceText","weight"]);
  for (const key of Object.keys(item)) if (!allowed.has(key)) issues.push(`${path} unknown property: ${key}`);
  if (!OPERATIONS.has(item.operation)) issues.push(`${path}.operation invalid`);
  if (!["SLOT","CONSTRAINT","SELECTED_CANDIDATE"].includes(item.target)) issues.push(`${path}.target invalid`);
  if (item.target === "SLOT" && !SLOT_KEY_SET.has(item.key)) issues.push(`${path}.key unknown slot`);
  if (item.target === "CONSTRAINT" && !CONSTRAINT_KEY_SET.has(item.key)) issues.push(`${path}.key unknown constraint`);
  if (item.target === "SELECTED_CANDIDATE" && item.key !== "selectedCandidateId") issues.push(`${path}.key invalid`);
  if (["SET","REPLACE"].includes(item.operation) && (item.value === null || item.value === undefined)) issues.push(`${path}.value required`);
  if (item.target === "CONSTRAINT" && !HARDNESS.has(item.hardness)) issues.push(`${path}.hardness invalid`);
  if (!PROVENANCE.has(item.provenance)) issues.push(`${path}.provenance invalid`);
  if (!finite(item.confidence) || item.confidence < 0 || item.confidence > 1) issues.push(`${path}.confidence must be 0..1`);
  if (typeof item.sourceText !== "string" || !item.sourceText.trim()) issues.push(`${path}.sourceText required`);
  if (item.weight != null && (!finite(item.weight) || item.weight <= 0)) issues.push(`${path}.weight invalid`);
  return issues;
}

export function validateIntentUpdate(value) {
  const issues=[];
  if (!object(value)) throw new ContractValidationError("IntentUpdate must be an object",["root"]);
  const allowed=new Set(["intentType","operations","slots","constraints","removeConstraintKeys","removeConstraints","selectedCandidateId","ambiguities","contradictions","candidateNextQuestion"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) issues.push(`unknown property: ${key}`);
  if (value.intentType !== undefined && !TYPES.has(value.intentType)) issues.push("intentType invalid");
  if (value.operations !== undefined) Array.isArray(value.operations) ? value.operations.forEach((item,index)=>issues.push(...validateOperation(item,index))) : issues.push("operations must be an array");
  if (value.slots !== undefined) {
    if (!object(value.slots)) issues.push("slots must be an object");
    else for (const [key,field] of Object.entries(value.slots)) { if (!SLOT_KEY_SET.has(key)) issues.push(`unknown slot: ${key}`); issues.push(...validateField(field,`slots.${key}`)); }
  }
  if (value.constraints !== undefined) {
    if (!Array.isArray(value.constraints)) issues.push("constraints must be an array");
    else value.constraints.forEach((item,index)=>{ if (!object(item)||!CONSTRAINT_KEY_SET.has(item.key)) issues.push(`constraints.${index}.key unknown`); if (!HARDNESS.has(item?.hardness)) issues.push(`constraints.${index}.hardness invalid`); issues.push(...validateField(item,`constraints.${index}`)); });
  }
  if (value.removeConstraintKeys !== undefined && (!Array.isArray(value.removeConstraintKeys)||value.removeConstraintKeys.some(key=>!CONSTRAINT_KEY_SET.has(key)))) issues.push("removeConstraintKeys invalid");
  if (value.removeConstraints !== undefined && (!Array.isArray(value.removeConstraints)||value.removeConstraints.some(item=>!object(item)||!CONSTRAINT_KEY_SET.has(item.key)||(item.value!==undefined&&typeof item.value!=="string")))) issues.push("removeConstraints invalid");
  for (const key of ["ambiguities","contradictions"]) if (value[key] !== undefined && (!Array.isArray(value[key])||value[key].some(item=>typeof item!=="string"))) issues.push(`${key} invalid`);
  if (value.selectedCandidateId !== undefined && value.selectedCandidateId !== null && typeof value.selectedCandidateId !== "string") issues.push("selectedCandidateId invalid");
  if (value.candidateNextQuestion !== undefined && value.candidateNextQuestion !== null && typeof value.candidateNextQuestion !== "string") issues.push("candidateNextQuestion invalid");
  if (issues.length) throw new ContractValidationError("Invalid IntentUpdate",issues);
  return clone(value);
}

export function checkReadiness(intent) {
  const required=["partySize","dateText","timeText"];
  const missing=required.filter(key=>intent.slots?.[key]?.value===undefined||intent.slots[key].value===null||intent.slots[key].value==="");
  return { ready:missing.length===0&&!(intent.ambiguities?.length)&&!(intent.contradictions?.length), missing, blocking:missing.length>0||Boolean(intent.ambiguities?.length)||Boolean(intent.contradictions?.length) };
}

const multiValued=new Set(["dietary","accessibility","feature","seating","ambience","occasionAmbience","style","formality","timeFlexibility"]);
function applyOperation(next,item) {
  if (item.operation === "KEEP") return;
  if (item.target === "SLOT") {
    if (item.operation === "REMOVE") delete next.slots[item.key];
    else if (["partySize","dateText","timeText"].includes(item.key) && item.provenance === "INFERRED" && item.confidence < 0.8) return;
    else next.slots[item.key]={ value:clone(item.value), provenance:item.provenance, confidence:item.confidence, sourceText:item.sourceText };
    return;
  }
  if (item.target === "SELECTED_CANDIDATE") { next.selectedCandidateId=item.operation==="REMOVE"?null:item.value; return; }
  if (item.operation === "REMOVE") { next.constraints=next.constraints.filter(existing=>existing.key!==item.key||(item.value!=null&&String(existing.value)!==String(item.value))); return; }
  const incoming={ key:item.key,value:clone(item.value),hardness:item.hardness,provenance:item.provenance,confidence:item.confidence,sourceText:item.sourceText,...(item.weight==null?{}:{weight:item.weight}) };
  next.constraints=next.constraints.filter(existing=>existing.key!==item.key||(item.operation==="SET"&&multiValued.has(item.key)&&String(existing.value)!==String(item.value)));
  next.constraints.push(incoming);
}

export function mergeIntent(previous,rawUpdate) {
  const update=validateIntentUpdate(rawUpdate), next=clone(previous??createDiningIntent());
  if (update.intentType!==undefined) next.intentType=update.intentType;
  for (const operation of update.operations??[]) applyOperation(next,operation);
  if (update.slots) next.slots={...next.slots,...clone(update.slots)};
  const removals=new Set(update.removeConstraintKeys??[]);
  next.constraints=(next.constraints??[]).filter(item=>!removals.has(item.key));
  for (const removal of update.removeConstraints??[]) next.constraints=next.constraints.filter(item=>item.key!==removal.key||(removal.value!==undefined&&String(item.value)!==removal.value));
  for (const incoming of update.constraints??[]) { next.constraints=next.constraints.filter(item=>item.key!==incoming.key||(multiValued.has(incoming.key)&&String(item.value)!==String(incoming.value))); next.constraints.push(clone(incoming)); }
  if (Object.hasOwn(update,"selectedCandidateId")) next.selectedCandidateId=update.selectedCandidateId;
  if (update.ambiguities!==undefined) next.ambiguities=clone(update.ambiguities);
  if (update.contradictions!==undefined) next.contradictions=clone(update.contradictions);
  next.readiness=checkReadiness(next); return next;
}
export function publicIntent(intent) { return clone(intent); }

export const INTENT_UPDATE_JSON_SCHEMA=Object.freeze({
  type:"object",additionalProperties:false,required:["intentType","operations","ambiguities","contradictions","candidateNextQuestion"],properties:{
    intentType:{enum:[...TYPES]},operations:{type:"array",items:{type:"object",additionalProperties:false,required:["operation","target","key","value","hardness","provenance","confidence","sourceText","weight"],properties:{operation:{enum:[...OPERATIONS]},target:{enum:Object.keys(INTENT_UPDATE_KEY_CONTRACT)},key:{description:`Key must belong to its target. SLOT keys: ${SLOT_KEYS.join(", ")}. CONSTRAINT keys: ${CONSTRAINT_KEYS.join(", ")}. SELECTED_CANDIDATE key: selectedCandidateId. Never invent a key; express supported concepts such as intimate or quiet as values of a valid key.`,enum:[...new Set(Object.values(INTENT_UPDATE_KEY_CONTRACT).flat())]},value:{type:["string","number","boolean","null"]},hardness:{enum:[...HARDNESS,null]},provenance:{enum:[...PROVENANCE]},confidence:{type:"number",minimum:0,maximum:1},sourceText:{type:"string",minLength:1},weight:{type:["number","null"],exclusiveMinimum:0}}}},
    ambiguities:{type:"array",items:{type:"string"}},contradictions:{type:"array",items:{type:"string"}},candidateNextQuestion:{type:["string","null"]}
  }
});
