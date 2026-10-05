const normal = value => String(value ?? "").trim().toLowerCase();

export class RetrievalContextError extends Error {
  constructor(message) { super(message); this.name = "RetrievalContextError"; }
}

export function validateRetrievalContext(context = {}) {
  const tenantId = normal(context.tenantId);
  const callerAcl = [...new Set((context.callerAcl ?? []).map(normal).filter(Boolean))].sort();
  const asOfDate = context.asOf == null ? new Date() : new Date(context.asOf);
  if (!tenantId) throw new RetrievalContextError("tenantId is required for retrieval");
  if (!callerAcl.length) throw new RetrievalContextError("callerAcl must contain at least one grant");
  if (Number.isNaN(asOfDate.getTime())) throw new RetrievalContextError("asOf must be a valid instant");
  const asOf = asOfDate.toISOString();
  return Object.freeze({ tenantId, callerAcl: Object.freeze(callerAcl), asOf });
}

export function isVisible(candidate, context) {
  const access = candidate.access ?? candidate.evidence?.[0]?.source;
  if (!access || normal(access.tenantId) !== context.tenantId) return false;
  if (access.tombstone === true || access.superseded === true) return false;
  const grants = (access.acl ?? []).map(normal);
  if (!grants.some(grant => context.callerAcl.includes(grant))) return false;
  const instant = Date.parse(context.asOf), from = Date.parse(access.effectiveFrom);
  const to = access.effectiveTo == null ? Infinity : Date.parse(access.effectiveTo);
  return Number.isFinite(from) && instant >= from && instant < to;
}

export function buildODataSecurityFilter(context) {
  const quote = value => `'${String(value).replaceAll("'","''")}'`;
  const acl = context.callerAcl.map(grant => `acl/any(a: a eq ${quote(grant)})`).join(" or ");
  return `tenantId eq ${quote(context.tenantId)} and tombstone eq false and superseded eq false and effectiveFrom le ${quote(context.asOf)} and (effectiveTo eq null or effectiveTo gt ${quote(context.asOf)}) and (${acl})`;
}
