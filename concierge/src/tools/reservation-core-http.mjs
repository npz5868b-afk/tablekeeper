export class ReservationCoreError extends Error {
  constructor(message, { status = 503, code = "DEPENDENCY_UNAVAILABLE", retryable = true, correlationId = null } = {}) { super(message); this.name = "ReservationCoreError"; Object.assign(this, { status, code, retryable, correlationId }); }
}
export class ReservationCoreHttpTools {
  constructor({ baseUrl = process.env.RESERVATION_CORE_BASE_URL ?? "http://127.0.0.1:4180", bearerToken = process.env.RESERVATION_CORE_DEV_BEARER_TOKEN, fetchImpl = globalThis.fetch } = {}) { this.baseUrl = baseUrl.replace(/\/$/, ""); this.bearerToken = bearerToken; this.fetch = fetchImpl; }
  async #request(path, { method = "GET", body, idempotencyKey } = {}) {
    const headers = { authorization: `Bearer ${this.bearerToken ?? ""}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    let response;
    try { response = await this.fetch(`${this.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (cause) { throw new ReservationCoreError("Reservation Core unavailable", { cause }); }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new ReservationCoreError(payload.message ?? "Reservation Core request failed", { status: response.status, code: payload.code, retryable: payload.retryable, correlationId: payload.correlationId });
    return payload;
  }
  search(envelope) { return this.#request("/v1/availability/search", { method: "POST", body: envelope }); }
  prepare(envelope) { return this.#request("/v1/reservation-preparations", { method: "POST", body: envelope, idempotencyKey: envelope.idempotencyKey }); }
  confirm(envelope) { return this.#request("/v1/reservations:confirm", { method: "POST", body: envelope, idempotencyKey: envelope.idempotencyKey }); }
  get(reservationId) { return this.#request(`/v1/reservations/${encodeURIComponent(reservationId)}`); }
}
