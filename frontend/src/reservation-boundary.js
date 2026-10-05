const CONTRACT_VERSION = "2.0.0";
const runtimeConfig = () => globalThis.TABLEKEEPER_RESERVATION_CORE ?? {};
const uuid = () => crypto.randomUUID();

function config() {
  const value = runtimeConfig();
  const required = ["baseUrl", "bearerToken", "tenantId", "actorId", "actorType"];
  const missing = required.filter(key => !value[key]);
  if (missing.length) {
    const error = new Error(`Reservation service is not configured (${missing.join(", ")}).`);
    error.code = "RESERVATION_NOT_CONFIGURED";
    throw error;
  }
  return value;
}

function envelope(type) {
  const value = config();
  const query = type === "SEARCH_AVAILABILITY";
  return {
    contract: { contractId: query ? "C03" : "C04", contractVersion: CONTRACT_VERSION },
    tenantId: value.tenantId,
    correlationId: uuid(),
    issuedAt: new Date().toISOString(),
    actor: { actorId: value.actorId, actorType: value.actorType },
    [query ? "queryId" : "commandId"]: uuid(),
    [query ? "queryType" : "commandType"]: type
  };
}

async function request(path, { body, idempotencyKey, signal } = {}) {
  const value = config();
  let response;
  try {
    response = await fetch(`${value.baseUrl}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${value.bearerToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {})
    });
  } catch (cause) {
    const error = new Error("The reservation service is temporarily unavailable.", { cause });
    Object.assign(error, { code: "DEPENDENCY_UNAVAILABLE", retryable: true, status: 503 });
    throw error;
  }
  const result = await response.json().catch(() => ({ code: "INVALID_RESPONSE", message: "Reservation service returned an unreadable response.", retryable: false }));
  if (!response.ok) {
    const error = new Error(result.message || "Reservation service request failed.");
    Object.assign(error, { code: result.code || "RESERVATION_REQUEST_FAILED", retryable: result.retryable === true, correlationId: result.correlationId, status: response.status });
    throw error;
  }
  return result;
}

export function createReservationAttemptKeys() {
  return { prepare: uuid(), confirm: uuid(),cancel:uuid() };
}

export const reservationBoundary = {
  searchAvailability({ venueId, partySize, requestedRange, signal }) {
    return request("/v1/availability/search", { signal, body: { ...envelope("SEARCH_AVAILABILITY"), parameters: { venueId, partySize, requestedRange } } });
  },
  prepareReservation({ venueId, partySize, requestedRange, candidate, idempotencyKey, signal }) {
    if (!idempotencyKey) throw new TypeError("A stable preparation idempotency key is required.");
    return request("/v1/reservation-preparations", { idempotencyKey, signal, body: { ...envelope("PREPARE_RESERVATION"), idempotencyKey, payload: { venueId, partySize, requestedRange, selection: { candidateId: candidate.candidateId, resourceIds: candidate.resources.map(resource => resource.resourceId) } } } });
  },
  confirmReservation({ confirmationToken, acceptedTerms, idempotencyKey, signal }) {
    if (!idempotencyKey) throw new TypeError("A stable confirmation idempotency key is required.");
    return request("/v1/reservations:confirm", { idempotencyKey, signal, body: { ...envelope("CONFIRM_RESERVATION"), idempotencyKey, payload: { confirmationToken, acceptedTerms } } });
  },
  cancelReservation({reservationId,idempotencyKey,signal}){
    if(!idempotencyKey)throw new TypeError("A stable cancellation idempotency key is required.");
    return request(`/v1/reservations/${encodeURIComponent(reservationId)}:cancel`,{idempotencyKey,signal,body:{...envelope("CANCEL_RESERVATION"),idempotencyKey,payload:{reservationId}}});
  },
  getReservation(reservationId, { signal } = {}) {
    return request(`/v1/reservations/${encodeURIComponent(reservationId)}`, { signal });
  },
  getDiningMap(reservationId,{signal}={}){
    return request(`/v1/reservations/${encodeURIComponent(reservationId)}/dining-map`,{signal});
  }
};

export function reservationErrorMessage(error) {
  if (error?.code === "RESERVATION_NOT_CONFIGURED") return "Live reservations are not configured on this device. Nothing was booked.";
  if (error?.code === "DEPENDENCY_UNAVAILABLE") return "The reservation service is temporarily unavailable. Your review is still here; please try again.";
  if (error?.status === 409) return "That availability just changed. Nothing was booked—please review and try again.";
  if (error?.status === 401 || error?.status === 403) return "We could not securely connect to the reservation service. Nothing was booked.";
  if (error?.status === 422) return "The reservation details could not be accepted. Nothing was booked; please review them.";
  return error?.message || "We could not complete that request. Nothing was booked.";
}
