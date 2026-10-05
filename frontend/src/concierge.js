const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Deterministic advisory model. It never performs or claims a reservation transaction. */
export function interpretWish(input, now = new Date("2026-09-30T12:00:00+08:00")) {
  const text = input.trim().toLowerCase();
  const partyMatch = text.match(/(?:for|party of)\s+(\d+|two|three|four|five|six)/);
  const words = { two: 2, three: 3, four: 4, five: 5, six: 6 };
  const party = partyMatch ? (Number(partyMatch[1]) || words[partyMatch[1]]) : 2;
  const timeMatch = text.match(/(?:at|around)\s+(\d{1,2})(?::(\d{2}))?\s*(pm|am)?/);
  let time = "7:30 pm";
  if (timeMatch) time = `${timeMatch[1]}:${timeMatch[2] || "00"} ${timeMatch[3] || (Number(timeMatch[1]) < 12 ? "pm" : "")}`.trim();
  let date = "Friday";
  if (text.includes("tonight")) date = "Tonight";
  else if (text.includes("tomorrow")) date = "Tomorrow";
  else date = WEEKDAYS.find(day => text.includes(day.toLowerCase())) || date;
  const occasion = text.includes("anniversary") ? "Anniversary" : text.includes("birthday") ? "Birthday" : text.includes("date") ? "Date night" : "Dinner";
  const preferences = {
    quiet: /quiet|intimate|calm/.test(text),
    dietary: /vegetarian|vegan|gluten|allerg/.test(text) ? (text.includes("vegan") ? "Vegan" : text.includes("gluten") ? "Gluten-aware" : "Vegetarian") : null,
    accessibility: /accessible|wheelchair|step-free/.test(text),
    lateArrival: /late arrival|running late|arrive late/.test(text),
    privateSeating: /private|secluded|corner/.test(text),
    view: /view|skyline|window|terrace/.test(text),
    cuisine: ["japanese", "mediterranean", "italian", "european", "malaysian", "thai"].find(value => text.includes(value)) || null,
    location: ["bangsar", "damansara", "chow kit", "klcc", "bukit bintang"].find(value => text.includes(value)) || null,
    budget: text.match(/(?:rm|under|around)\s*([0-9]{2,4})/)?.[1] || null
  };
  return { date, time, party, occasion, ...preferences, source: input.trim(), observedAt: now.toISOString() };
}

export function conciergeCopy(preferences) {
  const mood = preferences.quiet ? "quiet, intimate rooms" : preferences.occasion === "Anniversary" ? "a sense of occasion" : "warm, welcoming rooms";
  const detail = [preferences.cuisine && `${preferences.cuisine} cooking`, preferences.location && `near ${preferences.location}`, preferences.budget && `around RM${preferences.budget}`].filter(Boolean).join(", ");
  return `I’ve looked for ${mood} for ${preferences.party}${detail ? `, with ${detail}` : ""}. These three feel especially well suited—each with a distinct atmosphere.`;
}
