export const ROUTES=Object.freeze({WELCOME:"/",CONCIERGE:"/concierge",STAFF_ACCESS:"/staff-access",OPERATIONS:"/operations"});

export function navigateRoute(path,{replace=false,state={tablekeeper:true}}={}){
  history[replace?"replaceState":"pushState"](state,"",path);
  dispatchEvent(new CustomEvent("tablekeeper:navigate",{detail:{path,replace}}));
}

export const exitStaffToWelcome=()=>navigateRoute(ROUTES.WELCOME,{replace:true,state:{tablekeeper:true,exit:"staff"}});
export function customerParentRoute(path=location.pathname){
  if(path.startsWith("/recommendation/"))return ROUTES.CONCIERGE;
  if(path.startsWith("/restaurant/"))return "/discovery";
  return ROUTES.WELCOME;
}
export const returnCustomerToParent=()=>navigateRoute(customerParentRoute(),{replace:true,state:{tablekeeper:true,hierarchy:"customer"}});
