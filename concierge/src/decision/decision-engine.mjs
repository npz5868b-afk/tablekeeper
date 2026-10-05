const normal = value => String(value ?? "").trim().toLowerCase();
const WEIGHTS = Object.freeze({ cuisine:5, location:4, dietary:6, accessibility:6, pricePerPersonMax:4, ambience:2, occasionAmbience:2, style:2, seating:2, feature:2 });

const title = value => String(value??"").trim().replace(/\b\w/g,character=>character.toUpperCase());
const naturalList = values => values.length<2?values[0]??"":values.length===2?`${values[0]} and ${values[1]}`:`${values.slice(0,-1).join(", ")}, and ${values.at(-1)}`;
function supportedReason(check) {
  const value=String(check.expected??"").trim();
  const article=/^[aeiou]/i.test(value)?"an":"a";
  return ({
    cuisine:`${title(value)} cuisine`,
    location:`its ${title(value)} location`,
    dietary:`support for ${value} dining`,
    accessibility:`${value.replace(/-/g," ")} access`,
    pricePerPersonMax:`pricing within RM${value} per person`,
    ambience:`${article} ${value} atmosphere`,
    occasionAmbience:`${article} ${value} atmosphere`,
    style:`its ${value} style`,
    seating:`${value} seating`,
    feature:`its ${value.replace(/-/g," ")} experience`
  })[check.key]??null;
}
function rememberedButUnverified(intent,checks) {
  const details=[];
  const occasion=intent?.slots?.occasion?.value;
  if(occasion) details.push(`your ${String(occasion).toLowerCase()}`);
  const date=intent?.slots?.dateText?.value, time=intent?.slots?.timeText?.value;
  if(date&&time) details.push(`${date} at ${time}`);
  else if(time) details.push(`${time} timing`);
  else if(date) details.push(date);
  for(const check of checks.filter(item=>!item.matched)) {
    const reason=supportedReason(check);
    if(reason&&!details.some(item=>item.toLowerCase()===reason.toLowerCase())) details.push(reason);
  }
  return details.slice(0,3);
}

function fact(candidate, constraint) {
  if (constraint.key === "pricePerPersonMax") return candidate.facts?.pricePerPerson;
  if (constraint.key === "dietary" || constraint.key === "accessibility") return candidate.facts?.[constraint.key]?.[constraint.value];
  const map = { occasionAmbience:"occasions",style:"occasions",seating:"features",feature:"features" };
  return candidate.facts?.[map[constraint.key] ?? constraint.key];
}
function evaluate(candidate, constraint) {
  const actual = fact(candidate,constraint); let matched = false;
  if (actual !== undefined && actual !== null) {
    if (constraint.key === "pricePerPersonMax") matched = Number(actual) <= Number(constraint.value);
    else if (typeof actual === "boolean") matched = actual === true;
    else if (Array.isArray(actual)) matched = actual.some(value => normal(value) === normal(constraint.value));
    else matched = normal(actual) === normal(constraint.value);
  }
  return { key:constraint.key, expected:constraint.value, actual:actual ?? null, known:actual !== undefined && actual !== null, matched, hardness:constraint.hardness, weight:constraint.weight ?? WEIGHTS[constraint.key] ?? 1 };
}

export class DeterministicDecisionEngine {
  hardFilter(intent,candidates) { return candidates.map(candidate => ({candidate,checks:(intent.constraints ?? []).filter(item => item.hardness === "HARD").map(item => evaluate(candidate,item))})).filter(item => item.checks.every(check => check.known && check.matched)); }
  async rank(intent,candidates,{limit=3,excludeIds=[]}={}) {
    const excluded = new Set(excludeIds); const soft=(intent.constraints ?? []).filter(item=>item.hardness === "SOFT");
    return this.hardFilter(intent,candidates).filter(item=>!excluded.has(item.candidate.id)).map(({candidate,checks})=>{
      const softChecks=soft.map(item=>evaluate(candidate,item)); const score=softChecks.reduce((sum,item)=>sum+(item.matched?item.weight:0),0);
      return { id:candidate.id,name:candidate.name,score,scoreBreakdown:{hard:checks,soft:softChecks,total:score},evidence:structuredClone(candidate.evidence ?? []),facts:structuredClone(candidate.facts ?? {}) };
    }).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,limit);
  }
  explain(recommendation,intent={}) {
    if(!recommendation) return null;
    const checks=[...recommendation.scoreBreakdown.hard,...recommendation.scoreBreakdown.soft];
    const reasons=[...new Set(checks.filter(item=>item.matched).map(supportedReason).filter(Boolean))];
    const unverified=rememberedButUnverified(intent,checks);
    const verifiedSentence=reasons.length
      ?`${recommendation.name} stands out because ${naturalList(reasons)} ${reasons.length===1?"is":"are"} verified in our restaurant information.`
      :`I don't yet have a verified restaurant detail that explains ${recommendation.name} against your preferences.`;
    const contextSentence=unverified.length?`I'm still keeping ${naturalList(unverified)} in mind, but ${unverified.length===1?"that detail isn't":"those details aren't"} yet verified for ${recommendation.name}.`:null;
    return {restaurantId:recommendation.id,summary:[verifiedSentence,contextSentence].filter(Boolean).join(" "),evidence:structuredClone(recommendation.evidence)};
  }
  compare(recommendations) { return {restaurantIds:recommendations.map(item=>item.id),dimensions:[...new Set(recommendations.flatMap(item=>[...item.scoreBreakdown.hard,...item.scoreBreakdown.soft].map(check=>check.key)))].sort().map(key=>({key,values:recommendations.map(item=>({restaurantId:item.id,...[...item.scoreBreakdown.hard,...item.scoreBreakdown.soft].find(check=>check.key===key)}))})),winner:recommendations[0]?.id??null}; }
  reject(recommendations,rejectedId) { return recommendations.filter(item=>item.id!==rejectedId); }
}
