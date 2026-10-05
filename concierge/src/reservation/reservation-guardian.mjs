const CONFLICT_CODES = new Set(["STALE_RESOURCE_SNAPSHOT", "ALLOCATION_CONFLICT", "IDEMPOTENCY_KEY_REUSED"]);
const OPERATIONS = new Set(["search", "prepare", "confirm", "get"]);

export function normalizedSuccessfulReservationResult(reservation) {
  if(reservation?.ok!==true||!OPERATIONS.has(reservation.operation))return null;
  const payload=reservation.result;
  if(!payload||typeof payload!=="object"||Array.isArray(payload))return null;
  if(payload.ok===true)return payload.result&&typeof payload.result==="object"&&!Array.isArray(payload.result)?payload.result:null;
  if(Object.hasOwn(payload,"ok"))return null;
  return payload;
}

export function confirmedReservationResult(reservation) {
  const result=normalizedSuccessfulReservationResult(reservation);
  return reservation?.operation==="confirm"&&result?.status==="CONFIRMED"&&typeof result.reservationId==="string"&&result.reservationId?result:null;
}

export function guardReservationOutcome(reservation) {
  if (!reservation) return null;
  const result = normalizedSuccessfulReservationResult(reservation);
  const confirmation=confirmedReservationResult(reservation);
  if (confirmation) {
    return { status: "CONFIRMED", authoritative: true, reservationId: confirmation.reservationId, recovery: null };
  }
  if (reservation.ok === true && result) {
    return { status: "AUTHORITATIVE_RESULT", authoritative: true, bookingConfirmed: false, recovery: null };
  }
  if(reservation.ok===true){
    return {status:"MALFORMED_RESULT",authoritative:false,bookingConfirmed:false,message:"Reservation Core returned an unrecognized result. Booking status is unverified.",recovery:{action:"RETRY_WHEN_AVAILABLE",preserveCanonicalConstraints:true,authority:"RESERVATION_CORE"}};
  }
  const code = reservation.error?.code ?? "DEPENDENCY_UNAVAILABLE";
  if (reservation.operation === "confirm" && reservation.error?.retryable === true && !CONFLICT_CODES.has(code)) {
    return {
      status: "UNCERTAIN",
      authoritative: false,
      bookingConfirmed: false,
      message: "Reservation Core did not return an authoritative outcome. Booking status is unverified.",
      recovery: { action: "RETRY_SAME_CONFIRM_COMMAND", reuseIdempotencyKey: true, authority: "RESERVATION_CORE" }
    };
  }
  return {
    status: "FAILED",
    authoritative: true,
    bookingConfirmed: false,
    message: "Reservation Core rejected or could not execute the request.",
    recovery: { action: CONFLICT_CODES.has(code) ? "RECHECK_AVAILABILITY" : "RETRY_WHEN_AVAILABLE", preserveCanonicalConstraints: true, authority: "RESERVATION_CORE" }
  };
}
