export function setDiningPlacementVisible({reservationShell,placementShell},visible) {
  placementShell.hidden=!visible;
  reservationShell.hidden=visible;
}
