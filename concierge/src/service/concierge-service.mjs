import { confirmedReservationResult } from "../reservation/reservation-guardian.mjs";

export class ConciergeService {
  constructor({ graph, capabilities = {} }) {
    this.graph = graph;
    this.capabilities = { languageUnderstanding: "AVAILABLE", retrieval: "AVAILABLE", reservation: "AVAILABLE", ...capabilities };
    this.completedTurns = new Map();
    this.threadQueues = new Map();
  }
  async handleTurn(request) {
    const { threadId, turnId, message } = request;
    if (!threadId || !turnId || typeof message !== "string" || !message.trim()) throw new TypeError("threadId, turnId, and message are required");
    const key=`${threadId}:\0${turnId}`;
    if(this.completedTurns.has(key)) return structuredClone(this.completedTurns.get(key));
    const prior=this.threadQueues.get(threadId)??Promise.resolve();
    const current=prior.catch(()=>{}).then(()=>this.#applyTurn(request,key));
    this.threadQueues.set(threadId,current);
    try { return await current; }
    finally { if(this.threadQueues.get(threadId)===current)this.threadQueues.delete(threadId); }
  }
  async #applyTurn(request,key) {
    const { threadId, turnId, message } = request;
    if(this.completedTurns.has(key)) return structuredClone(this.completedTurns.get(key));
    const response = await this.graph.invoke({ ...request, turn: message });
    const confirmed = Boolean(confirmedReservationResult(response.reservation));
    const interaction = selectInteraction(response);
    const reasons = response.ok ? (response.reservation?.ok === false ? ["RESERVATION_UNAVAILABLE"] : []) : [response.error?.code ?? "UNEXPECTED_FAILURE"];
    const languageUnderstanding = response.error?.code === "LANGUAGE_PROVIDER_FAILURE" ? "DEGRADED" : this.capabilities.languageUnderstanding;
    const result = {
      contract: { name: "ConciergeTurnResponse", version: "1.0.0" }, threadId, turnId,
      message: publicMessage(interaction, response.guardian), intent: response.intent, stage: response.stage, interaction,
      capability: { ...this.capabilities, languageUnderstanding, reservation: response.reservation?.ok === false ? "DEGRADED" : this.capabilities.reservation },
      degradation: { active: reasons.length > 0, reasons }, traceId: response.trace?.traceId,
      semanticProvider: response.providerDiagnostics ?? null,
      reservationAuthority: "RESERVATION_CORE", bookingConfirmed: confirmed,
      recommendationExplanation: response.explanation ?? null,
      smartFallback: response.fallback ?? null,
      reservationGuardian: response.guardian ?? null
    };
    // Cache only committed graph turns. Failed turns remain retryable and the
    // graph guarantees they retain their prior checkpoint.
    if(response.ok===true)this.completedTurns.set(key,structuredClone(result));
    return result;
  }
}

function selectInteraction(response) {
  if (response.selection) return { type: "selection", payload: response.selection };
  if (response.reservation) return { type: "reservation", payload: response.reservation };
  if (response.comparison) return { type: "comparison", payload: response.comparison };
  if (response.intent?.intentType === "WHY" && response.explanation) return { type: "explanation", payload: response.explanation };
  if (response.clarification) return { type: "clarification", payload: response.clarification };
  return { type: "recommendations", payload: response.recommendations ?? [] };
}

function publicMessage(interaction, guardian) {
  if (interaction.type === "selection") return `I'll check live availability for ${interaction.payload.name} with Reservation Core now. Nothing is booked until you review and confirm.`;
  if (interaction.type === "clarification") return interaction.payload.question;
  if (interaction.type === "reservation") return guardian?.message ?? (interaction.payload.ok ? "Reservation Core returned an authoritative result." : "Reservation Core could not complete that request safely.");
  if (interaction.type === "comparison") return "Here is a grounded comparison of the referenced options.";
  if (interaction.type === "explanation") return interaction.payload.summary;
  return interaction.payload.length ? `I found ${interaction.payload.length} grounded option${interaction.payload.length === 1 ? "" : "s"}.` : "I couldn't find a grounded option satisfying every hard constraint.";
}
