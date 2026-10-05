export const directoryLocations = venues => Object.freeze([...new Set(venues.map(venue => venue.place).filter(Boolean))].sort((a,b)=>a.localeCompare(b)));

export function filterStaffVenues(venues,{query="",location="ALL"}={}){
  const needle=query.trim().toLocaleLowerCase();
  return venues.filter(venue=>{
    const matchesLocation=location==="ALL"||venue.place===location;
    return matchesLocation&&(!needle||`${venue.name} ${venue.place}`.toLocaleLowerCase().includes(needle));
  });
}
