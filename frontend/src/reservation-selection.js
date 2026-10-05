export function reservationSelectionDetail(interaction) {
  if(interaction?.type!=="selection") return null;
  const restaurantId=String(interaction.payload?.restaurantId??"").trim();
  const name=String(interaction.payload?.name??"").trim();
  if(!restaurantId||!name||interaction.payload?.reservationAuthority!=="RESERVATION_CORE"||interaction.payload?.bookingConfirmed!==false) return null;
  return {restaurantId,name};
}

export function dispatchReservationSelection(interaction,target=document) {
  const detail=reservationSelectionDetail(interaction);
  if(!detail) return false;
  target.dispatchEvent(new CustomEvent("tablekeeper:reservation-selection",{detail}));
  return true;
}
