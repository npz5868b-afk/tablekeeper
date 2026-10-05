// Legacy intent-presentation helpers. Restaurant selection is intentionally not
// implemented here: the concierge backend is the recommendation authority.
const clone = value => structuredClone(value);
const WORDS = { one:1, two:2, three:3, four:4, five:5, six:6 };

export function createIntentState(){return {turn:0,slots:{},constraints:[],selectedCandidateId:null,mode:"CLOUD"};}
export function applyIntentTurn(previous,input){
  const state=clone(previous), text=input.toLowerCase(); state.turn++;
  const party=text.match(/(?:for|party of)\s+(\d+|one|two|three|four|five|six)|\b(\d+|one|two|three|four|five|six)\s+(?:people|guests)/);
  if(party){const value=party[1]||party[2];state.slots.partySize=Number(value)||WORDS[value];}
  if(/tomorrow/.test(text))state.slots.dateText="Tomorrow";else if(/tonight/.test(text))state.slots.dateText="Tonight";
  const time=text.match(/(?:at|around|make it)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);if(time)state.slots.timeText=`${time[1]}:${time[2]||"00"} ${(time[3]||"pm").toUpperCase()}`;
  const occasion=text.match(/anniversary|birthday|date night|business dinner/);if(occasion)state.slots.occasion=occasion[0].replace(/\b\w/g,c=>c.toUpperCase());
  const range=text.match(/rm\s*(\d+)\s*[–-]\s*(\d+)/);if(range){state.slots.budgetMin=Number(range[1]);state.slots.budgetMax=Number(range[2]);}
  const replace=(key,value,hardness,source)=>{state.constraints=state.constraints.filter(x=>x.key!==key);state.constraints.push({key,value,hardness,sourceText:source});};
  [[/does(?:n't| not) eat beef|no beef/,"dietary","no-beef","HARD"],[/wheelchair|step[- ]free|accessible/,"accessibility","wheelchair-accessible","HARD"],[/not too noisy|quiet|intimate|calm/,"ambience","quiet","SOFT"],[/romantic/,"occasionAmbience","romantic","SOFT"],[/elegant/,"style","elegant","SOFT"],[/private|secluded/,"seating","private","SOFT"],[/view|window|skyline|terrace/,"feature","view","SOFT"]].forEach(([pattern,key,value,hardness])=>{const match=text.match(pattern);if(match)replace(key,value,hardness,match[0]);});
  return state;
}
export function intentTokens(state){const hard=state.constraints.filter(x=>x.hardness==="HARD"),soft=state.constraints.filter(x=>x.hardness==="SOFT");return [
  state.slots.dateText&&{label:state.slots.dateText,kind:"detail"},state.slots.timeText&&{label:state.slots.timeText,kind:"detail"},state.slots.partySize&&{label:`${state.slots.partySize} guests`,kind:"detail"},state.slots.occasion&&{label:state.slots.occasion,kind:"detail"},
  soft.length&&{label:soft.map(x=>x.value==="view"?"View preferred":x.value[0].toUpperCase()+x.value.slice(1)).join(" · "),kind:"preference"},
  state.slots.budgetMin&&{label:`RM${state.slots.budgetMin}–${state.slots.budgetMax}`,kind:"detail"},...hard.map(x=>({label:x.value==="no-beef"?"No beef":x.value,kind:"requirement"}))].filter(Boolean);}
export function setMode(state,mode){return {...clone(state),mode};}
