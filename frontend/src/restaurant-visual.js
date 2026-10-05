import { findRestaurantById } from "./restaurant-catalog.js";

export function topRecommendationId(interaction) {
  return interaction?.type === "recommendations" && Array.isArray(interaction.payload) ? interaction.payload[0]?.id ?? null : null;
}

export function restaurantVisual(id) {
  const restaurant=findRestaurantById(id);
  return restaurant ? {restaurantId:restaurant.id,image:restaurant.image,name:restaurant.name,alt:`Illustrative ${restaurant.cuisine} dining atmosphere for ${restaurant.name}`,focalPosition:restaurant.presentation.focalPosition||"50% 50%"} : {restaurantId:null,image:null,name:null,alt:"Restaurant image unavailable",focalPosition:"50% 50%"};
}
