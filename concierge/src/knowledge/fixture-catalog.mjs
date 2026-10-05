export const FIXTURE_NOTICE = "Synthetic product-development fixtures; not verified real-world restaurant information.";
export const FIXTURE_TENANT_ID = "00000000-0000-4000-8000-000000000001";
export const FIXTURE_ACL = Object.freeze(["concierge:read"]);
const FIXTURE_EFFECTIVE_FROM = "2026-01-01T00:00:00.000Z";

const rows = [
  ["lotus-yard","Lotus Yard","malaysian","bangsar",85,"quiet",["vegetarian","no-beef"],["private"],["romantic"]],
  ["ember-room","Ember Room","italian","klcc",160,"quiet",["no-beef"],["view"],["romantic","elegant"]],
  ["harbor-leaf","Harbor Leaf","mediterranean","damansara",95,"calm",["vegan","vegetarian"],["accessible"],["casual"]],
  ["saffron-terrace","Saffron Terrace","indian","bukit bintang",110,"lively",["vegetarian","halal"],["terrace"],["celebratory"]],
  ["jade-pavilion","Jade Pavilion","chinese","klcc",190,"formal",["no-beef"],["private"],["business"]],
  ["mizu-counter","Mizu Counter","japanese","bangsar",220,"intimate",["gluten-free"],["counter"],["date-night"]],
  ["basil-house","Basil House","thai","chow kit",70,"lively",["vegetarian","halal"],["street-view"],["casual"]],
  ["maison-ciel","Maison Ciel","french","klcc",280,"quiet",["vegetarian"],["view"],["romantic","elegant"]],
  ["nasi-atelier","Nasi Atelier","malaysian","damansara",65,"casual",["halal","no-beef"],["accessible"],["family"]],
  ["olive-grove","Olive Grove","mediterranean","bangsar",130,"calm",["vegan","gluten-free"],["garden"],["romantic"]],
  ["trattoria-nova","Trattoria Nova","italian","bukit bintang",105,"lively",["vegetarian"],["terrace"],["family"]],
  ["kumo-dining","Kumo Dining","japanese","klcc",240,"formal",["no-beef"],["private","view"],["business","elegant"]],
  ["spice-route","Spice Route","indian","chow kit",80,"lively",["vegan","halal"],["accessible"],["family"]],
  ["red-lantern","Red Lantern","chinese","bangsar",120,"intimate",["vegetarian"],["private"],["celebratory"]],
  ["lemongrass-table","Lemongrass Table","thai","damansara",90,"calm",["halal","gluten-free"],["garden"],["family"]],
  ["petit-jardin","Petit Jardin","french","bangsar",210,"quiet",["vegetarian"],["garden"],["romantic"]],
  ["warung-modern","Warung Modern","malaysian","chow kit",55,"lively",["halal"],["accessible"],["casual"]],
  ["aegean-blue","Aegean Blue","mediterranean","klcc",150,"calm",["vegan","no-beef"],["view"],["business"]],
  ["osteria-verde","Osteria Verde","italian","damansara",125,"quiet",["vegan","vegetarian"],["accessible"],["date-night"]],
  ["sakura-garden","Sakura Garden","japanese","bukit bintang",175,"calm",["vegetarian"],["garden"],["family"]],
  ["copper-tiffin","Copper Tiffin","indian","bangsar",100,"intimate",["vegan","gluten-free"],["private"],["date-night"]],
  ["pearl-river","Pearl River","chinese","damansara",140,"formal",["no-beef"],["accessible","private"],["business"]],
  ["siam-rooftop","Siam Rooftop","thai","klcc",170,"lively",["halal"],["view","terrace"],["celebratory"]],
  ["atelier-rouge","Atelier Rouge","french","bukit bintang",260,"intimate",["gluten-free"],["private"],["romantic","elegant"]]
];

const stableDigest = value => {
  let hash = 2166136261;
  for (const character of value) { hash ^= character.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8,"0").repeat(8);
};
const source = (id, name) => Object.freeze({
  sourceId: `fixture:venue:${id}`,
  sourceVersion: "1",
  contentDigest: stableDigest(`${id}|${name}|1`),
  tenantId: FIXTURE_TENANT_ID,
  acl: FIXTURE_ACL,
  effectiveFrom: FIXTURE_EFFECTIVE_FROM,
  effectiveTo: null,
  superseded: false,
  tombstone: false,
  kind: "FIXTURE",
  title: `${name} fixture profile v1`,
  locator: `fixtures://restaurants/${id}/v1`,
  capturedAt: "2026-09-30T00:00:00.000Z",
  notice: FIXTURE_NOTICE
});
const claim = (restaurantId, path, value, sourceId) => Object.freeze({ claimId: `${restaurantId}:${path}`, restaurantId, path, value: structuredClone(value), evidence: { sourceId, quote: `${path}: ${Array.isArray(value) ? value.join(", ") : value}` } });

export const FIXTURE_RESTAURANTS = Object.freeze(rows.map(([slug,name,cuisine,location,pricePerPerson,ambience,dietary,features,occasions]) => {
  const id = `fixture-${slug}`; const itemSource = source(slug, name);
  const claims = [claim(id,"cuisine",cuisine,itemSource.sourceId), claim(id,"location",location,itemSource.sourceId), claim(id,"pricePerPerson",pricePerPerson,itemSource.sourceId), claim(id,"ambience",[ambience],itemSource.sourceId), claim(id,"features",features,itemSource.sourceId), claim(id,"occasions",occasions,itemSource.sourceId), ...dietary.map(value => claim(id,`dietary.${value}`,true,itemSource.sourceId))];
  if (features.includes("accessible")) claims.push(claim(id,"accessibility.wheelchair-accessible",true,itemSource.sourceId));
  return Object.freeze({ id, name, source: itemSource, claims: Object.freeze(claims) });
}));

export function materializeFixtureCandidates() {
  return FIXTURE_RESTAURANTS.map(restaurant => {
    const facts = {};
    for (const item of restaurant.claims) {
      const parts = item.path.split("."); let cursor = facts;
      for (const part of parts.slice(0,-1)) cursor = cursor[part] ??= {};
      cursor[parts.at(-1)] = structuredClone(item.value);
    }
    return { id: restaurant.id, name: restaurant.name, facts, fixtureBacked: true, access: { tenantId: restaurant.source.tenantId, acl: structuredClone(restaurant.source.acl), effectiveFrom: restaurant.source.effectiveFrom, effectiveTo: restaurant.source.effectiveTo, superseded: restaurant.source.superseded, tombstone: restaurant.source.tombstone }, evidence: restaurant.claims.map(item => ({ claimId: item.claimId, path: item.path, value: structuredClone(item.value), quote: item.evidence.quote, source: structuredClone(restaurant.source) })) };
  });
}
