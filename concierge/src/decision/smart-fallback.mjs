const clone = value => structuredClone(value ?? []);

export function buildSmartFallback({ intent, recommendations = [], rejectedId = null, availability = null } = {}) {
  const hardConstraints = clone((intent?.constraints ?? []).filter(item => item.hardness === "HARD"));
  const alternative = recommendations.find(item => item.id !== rejectedId) ?? null;
  // Reservation Core responses may arrive as the result itself or in the accepted
  // `{ ok, result }` envelope. Inspect only that authoritative payload.
  const authoritativeAvailability = availability?.result ?? availability;
  const unavailable = authoritativeAvailability && Array.isArray(authoritativeAvailability.candidates) && authoritativeAvailability.candidates.length === 0;
  if (!unavailable && intent?.intentType !== "REJECT" && recommendations.length) return null;
  return {
    status: alternative ? "ALTERNATIVE_AVAILABLE" : "NO_GROUNDED_ALTERNATIVE",
    trigger: unavailable ? "REQUESTED_TIME_UNAVAILABLE" : intent?.intentType === "REJECT" ? "PRIMARY_REJECTED" : "HARD_CONSTRAINTS_UNSATISFIED",
    preservedHardConstraints: hardConstraints,
    alternatives: alternative ? [{
      type: "GROUNDED_RESTAURANT",
      restaurantId: alternative.id,
      name: alternative.name,
      reasonEvidence: clone(alternative.evidence),
      availabilityStatus: "NOT_CHECKED",
      next: "CHECK_RESERVATION_CORE"
    }] : [],
    unsupported: {
      nearbyTime: "Reservation Core exposes exact-range search only.",
      waitlist: "No waitlist capability is implemented.",
      scheduledBooking: "No scheduled-booking capability is implemented."
    }
  };
}
