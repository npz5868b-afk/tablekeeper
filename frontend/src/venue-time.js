export const VENUE_TIME_ZONE = "Asia/Kuala_Lumpur";
const KUALA_LUMPUR_OFFSET_MINUTES = 8 * 60;

export function venueCalendar(now = new Date()) {
  const shifted = new Date(now.getTime() + KUALA_LUMPUR_OFFSET_MINUTES * 60_000);
  return { year:shifted.getUTCFullYear(), month:shifted.getUTCMonth(), day:shifted.getUTCDate() };
}

export function venueWallTimeToInstant(value) {
  const match=String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if(!match)return null;
  const [,yearText,monthText,dayText,hourText,minuteText]=match;
  const year=Number(yearText),month=Number(monthText)-1,day=Number(dayText),hour=Number(hourText),minute=Number(minuteText);
  const localCheck=new Date(Date.UTC(year,month,day,hour,minute));
  if(localCheck.getUTCFullYear()!==year||localCheck.getUTCMonth()!==month||localCheck.getUTCDate()!==day||hour>23||minute>59)return null;
  return new Date(localCheck.getTime()-KUALA_LUMPUR_OFFSET_MINUTES*60_000);
}

export function venueDateTimeToInstant({year,month,day,hour,minute=0}) {
  return venueWallTimeToInstant(`${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}T${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`);
}
