import { randomUUID } from "node:crypto";
const SECRET_KEY = /authorization|api[-_ ]?key|token|password|cookie|secret/i;
const SECRET_STRING = /(bearer\s+[a-z0-9._~-]+|(?:api[-_ ]?key|token|password|secret)\s*[=:]\s*[^\s,;]+)/ig;

export function sanitizeTraceValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeTraceValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEY.test(key)).map(([key, item]) => [key, sanitizeTraceValue(item)]));
  if (typeof value !== "string") return value;
  const redacted = value.replace(SECRET_STRING, "[REDACTED]");
  return redacted.length > 512 ? `${redacted.slice(0, 512)}…` : redacted;
}

export function createTrace() {
  const traceId = randomUUID(); const events = [];
  return { traceId, event(stage, detail = {}) { events.push({ stage, at: new Date().toISOString(), detail: sanitizeTraceValue(detail) }); }, snapshot() { return { traceId, events: structuredClone(events) }; } };
}
