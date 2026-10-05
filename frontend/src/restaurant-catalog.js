// Presentation projection of concierge/src/knowledge/fixture-catalog.mjs.
// Identity and facts mirror the authoritative backend fixture catalog. Images,
// display copy, and legacy demo traits are frontend-only presentation metadata.
const rows = [
  ["fixture-lotus-yard","Lotus Yard","Malaysian","Bangsar",85,"quiet",["vegetarian","no-beef"],["private"],["romantic"],"1519167758481-83f550bb49b3"],
  ["fixture-ember-room","Ember Room","Italian","KLCC",160,"quiet",["no-beef"],["view"],["romantic","elegant"],"1551632436-cbf8dd35adfa"],
  ["fixture-harbor-leaf","Harbor Leaf","Mediterranean","Damansara",95,"calm",["vegan","vegetarian"],["accessible"],["casual"],"1517248135467-4c7edcad34c4"],
  ["fixture-saffron-terrace","Saffron Terrace","Indian","Bukit Bintang",110,"lively",["vegetarian","halal"],["terrace"],["celebratory"],"1585937421612-70a008356fbe"],
  ["fixture-jade-pavilion","Jade Pavilion","Chinese","KLCC",190,"formal",["no-beef"],["private"],["business"],"1525755662778-989d0524087e"],
  ["fixture-mizu-counter","Mizu Counter","Japanese","Bangsar",220,"intimate",["gluten-free"],["counter"],["date-night"],"1579871494447-9811cf80d66c"],
  ["fixture-basil-house","Basil House","Thai","Chow Kit",70,"lively",["vegetarian","halal"],["street-view"],["casual"],"1559314809-0d155014e29e"],
  ["fixture-maison-ciel","Maison Ciel","French","KLCC",280,"quiet",["vegetarian"],["view"],["romantic","elegant"],"1414235077428-338989a2e8c0"],
  ["fixture-nasi-atelier","Nasi Atelier","Malaysian","Damansara",65,"casual",["halal","no-beef"],["accessible"],["family"],"1604908176997-125f25cc6f3d"],
  ["fixture-olive-grove","Olive Grove","Mediterranean","Bangsar",130,"calm",["vegan","gluten-free"],["garden"],["romantic"],"1547592180-85f173990554"],
  ["fixture-trattoria-nova","Trattoria Nova","Italian","Bukit Bintang",105,"lively",["vegetarian"],["terrace"],["family"],"1552566626-52f8b828add9"],
  ["fixture-kumo-dining","Kumo Dining","Japanese","KLCC",240,"formal",["no-beef"],["private","view"],["business","elegant"],"1785636820215-9b647f2b20c5"],
  ["fixture-spice-route","Spice Route","Indian","Chow Kit",80,"lively",["vegan","halal"],["accessible"],["family"],"1567337710282-00832b415979"],
  ["fixture-red-lantern","Red Lantern","Chinese","Bangsar",120,"intimate",["vegetarian"],["private"],["celebratory"],"1563245372-f21724e3856d"],
  ["fixture-lemongrass-table","Lemongrass Table","Thai","Damansara",90,"calm",["halal","gluten-free"],["garden"],["family"],"1569058242253-92a9c755a0ec"],
  ["fixture-petit-jardin","Petit Jardin","French","Bangsar",210,"quiet",["vegetarian"],["garden"],["romantic"],"1550966871-3ed3cdb5ed0c"],
  ["fixture-warung-modern","Warung Modern","Malaysian","Chow Kit",55,"lively",["halal"],["accessible"],["casual"],"1504674900247-0877df9cc836"],
  ["fixture-aegean-blue","Aegean Blue","Mediterranean","KLCC",150,"calm",["vegan","no-beef"],["view"],["business"],"1547592166-23ac45744acd"],
  ["fixture-osteria-verde","Osteria Verde","Italian","Damansara",125,"quiet",["vegan","vegetarian"],["accessible"],["date-night"],"1579684947550-22e945225d9a"],
  ["fixture-sakura-garden","Sakura Garden","Japanese","Bukit Bintang",175,"calm",["vegetarian"],["garden"],["family"],"1553621042-f6e147245754"],
  ["fixture-copper-tiffin","Copper Tiffin","Indian","Bangsar",100,"intimate",["vegan","gluten-free"],["private"],["date-night"],"1601050690597-df0568f70950"],
  ["fixture-pearl-river","Pearl River","Chinese","Damansara",140,"formal",["no-beef"],["accessible","private"],["business"],"1526318896980-cf78c088247c"],
  ["fixture-siam-rooftop","Siam Rooftop","Thai","KLCC",170,"lively",["halal"],["view","terrace"],["celebratory"],"1559339352-11d035aa65de"],
  ["fixture-atelier-rouge","Atelier Rouge","French","Bukit Bintang",260,"intimate",["gluten-free"],["private"],["romantic","elegant"],"1514933651103-005eec06c04b"]
];

const title = value => value.replace(/\b\w/g, character => character.toUpperCase());
const legacyTraits = (ambience, dietary, features, occasions) => ({
  privacy:features.includes("private")?90:ambience==="intimate"?78:55,
  quiet:["quiet","calm","intimate"].includes(ambience)?88:45,
  romance:occasions.includes("romantic")||occasions.includes("date-night")?90:55,
  view:features.includes("view")||features.includes("terrace")?90:45,
  warmth:["casual","lively"].includes(ambience)?88:68,
  casual:occasions.includes("casual")||occasions.includes("family")?90:45,
  accessible:features.includes("accessible")?100:0,
  business:occasions.includes("business")?90:50,
  late:ambience==="lively"?85:55,
  dietary:dietary.includes("no-beef")?100:70
});

export const restaurantCatalog = Object.freeze(rows.map(([id,name,cuisine,place,pricePerPerson,ambience,dietary,features,occasions,photoId]) => Object.freeze({
  id,name,cuisine,place,pricePerPerson,
  price:`RM${pricePerPerson} per person`,
  ambience:Object.freeze([ambience]),
  dietary:Object.freeze([...dietary]),
  features:Object.freeze([...features]),
  occasions:Object.freeze([...occasions]),
  image:`https://images.unsplash.com/photo-${photoId}?auto=format&fit=crop&w=1800&q=88`,
  presentation:Object.freeze({description:`${title(cuisine)} dining in ${place}.`,imageIsIllustrative:true,focalPosition:"50% 50%"}),
  // Compatibility only for legacy app.js; Screen 01 never imports or uses this.
  traits:Object.freeze(legacyTraits(ambience,dietary,features,occasions)),
  spaces:Object.freeze([])
})));

export function findRestaurantById(id) {
  return restaurantCatalog.find(restaurant => restaurant.id === id) ?? null;
}

export function rankRestaurants(model){
  const weights={privacy:model.soft.privacy,quiet:model.soft.quiet,romance:model.soft.romance,view:model.soft.view,warmth:model.soft.warmth,casual:model.soft.casual,accessible:model.hard.stepFree?100:35,late:model.context.late?90:25,dietary:model.hard.noBeef?100:30,business:model.context.business?90:25};
  return restaurantCatalog.map(r=>({...r,score:Math.round(Object.entries(weights).reduce((n,[k,w])=>n+(r.traits[k]||0)*w,0)/Object.values(weights).reduce((a,b)=>a+b,0))})).filter(r=>!model.hard.stepFree||r.features.includes("accessible")).filter(r=>!model.hard.noBeef||r.dietary.includes("no-beef")).sort((a,b)=>b.score-a.score);
}
