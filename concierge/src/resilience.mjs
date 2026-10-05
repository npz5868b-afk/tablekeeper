import {
  applyTurn,
  createConversationState,
  createReservationHandoff,
  recommendFromKnowledge,
  answerKnowledgeQuestion
} from "./index.mjs";

export const IntelligenceMode = Object.freeze({ CLOUD: "CLOUD", LOCAL: "LOCAL", SURVIVAL: "SURVIVAL" });

const clone = value => structuredClone(value);
const ok = result => result === true || result?.status === "HEALTHY";

function envelope(mode, provenance, body = {}) {
  return {
    mode,
    provenance: clone(provenance),
    reservationAuthority: "RESERVATION_CORE",
    bookingConfirmed: false,
    ...body
  };
}

/**
 * Deterministic controller. Health boundaries are injected and must return
 * HEALTHY, UNAVAILABLE, or TIMEOUT; this module never probes operator networking.
 */
export class IntelligenceModeController {
  constructor({ cloud, local, reservationCore, initialMode = null } = {}) {
    this.cloud = cloud;
    this.local = local;
    this.reservationCore = reservationCore;
    this.mode = initialMode;
    this.state = createConversationState({ sourceMode: "RESILIENCE" });
    this.transitionSequence = 0;
    this.lastTransition = null;
    this.lostContext = [];
  }

  async probe(boundary, name) {
    if (!boundary?.health) return { boundary: name, status: "UNAVAILABLE" };
    try {
      const result = await boundary.health();
      const status = result?.status ?? (result === true ? "HEALTHY" : "UNAVAILABLE");
      return { boundary: name, status: ["HEALTHY", "UNAVAILABLE", "TIMEOUT"].includes(status) ? status : "UNAVAILABLE" };
    } catch {
      return { boundary: name, status: "UNAVAILABLE" };
    }
  }

  async selectMode() {
    const cloud = await this.probe(this.cloud, "REMOTE_CLOUD");
    let local = { boundary: "LOCAL_RUNTIME", status: "NOT_PROBED" };
    let next = IntelligenceMode.CLOUD;
    if (!ok(cloud)) {
      local = await this.probe(this.local, "LOCAL_RUNTIME");
      next = ok(local) ? IntelligenceMode.LOCAL : IntelligenceMode.SURVIVAL;
    }
    if (next !== this.mode) {
      const previous = this.mode;
      this.mode = next;
      this.transitionSequence += 1;
      this.lastTransition = { sequence: this.transitionSequence, from: previous, to: next, reason: { cloud, local } };
      if (previous === IntelligenceMode.CLOUD && this.state.cloudOpaqueContextPresent) {
        this.lostContext.push({ transitionSequence: this.transitionSequence, kind: "CLOUD_OPAQUE_CONTEXT", reason: "NOT_SAFELY_REPRESENTABLE" });
        delete this.state.cloudOpaqueContextPresent;
      }
    }
    return { mode: this.mode, health: { cloud, local }, transition: clone(this.lastTransition), lostContext: clone(this.lostContext) };
  }

  continuity() {
    return {
      version: this.state.version,
      turn: this.state.turn,
      slots: clone(this.state.slots),
      constraints: clone(this.state.constraints),
      selectedCandidateId: this.state.selectedCandidateId,
      lostContext: clone(this.lostContext)
    };
  }

  async handle(request = {}) {
    const selection = await this.selectMode();
    if (request.input) this.state = applyTurn(this.state, request.input);
    const common = {
      health: selection.health,
      transition: selection.transition,
      continuity: this.continuity()
    };

    if (["PREPARE_RESERVATION", "CONFIRM_RESERVATION"].includes(request.action)) {
      return this.#reservationAction(request, common);
    }
    if (request.action === "FACT") return this.#fact(request, common);
    if (selection.mode === IntelligenceMode.CLOUD) return this.#cloud(request, common);
    if (selection.mode === IntelligenceMode.LOCAL) return this.#local(common);
    return this.#survival(common);
  }

  async #cloud(request, common) {
    try {
      const result = await this.cloud.advise({ input: request.input ?? "", continuity: this.continuity() });
      if (result?.opaqueContext) this.state.cloudOpaqueContextPresent = true;
      return envelope(IntelligenceMode.CLOUD, [{ kind: "REMOTE_MODEL", boundary: "REMOTE_CLOUD" }], {
        status: "ADVISORY",
        advisory: result?.advisory ?? null,
        ...common,
        continuity: this.continuity()
      });
    } catch {
      // A failed request is an immediate deterministic health event; reselect once.
      const originalHealth = this.cloud.health;
      this.cloud.health = async () => ({ status: "UNAVAILABLE" });
      const result = await this.handle({ ...request, input: undefined });
      this.cloud.health = originalHealth;
      return result;
    }
  }

  #local(common) {
    const output = recommendFromKnowledge(this.state);
    this.state = output.state;
    return envelope(IntelligenceMode.LOCAL, [{ kind: "LOCAL_RULES" }, { kind: "GROUNDED_FIXTURE_CORPUS" }], {
      status: "ADVISORY",
      recommendations: output.recommendations,
      summary: output.summary,
      ...common,
      continuity: this.continuity()
    });
  }

  #survival(common) {
    const output = recommendFromKnowledge(this.state);
    this.state = output.state;
    return envelope(IntelligenceMode.SURVIVAL, [{ kind: "DETERMINISTIC_FILTERS" }, { kind: "GROUNDED_FIXTURE_CORPUS" }], {
      status: "STRUCTURED_DISCOVERY",
      aiActive: false,
      filters: clone(this.state.constraints),
      results: output.recommendations,
      availability: { status: "UNKNOWN", next: "RESERVATION_CORE_HANDOFF" },
      ...common,
      continuity: this.continuity()
    });
  }

  #fact(request, common) {
    const answer = answerKnowledgeQuestion({ restaurantId: request.restaurantId, topic: request.topic });
    const provenance = answer.status === "GROUNDED"
      ? [{ kind: "GROUNDED_CLAIM", evidence: answer.evidence }]
      : [{ kind: "FAIL_CLOSED", reason: answer.status }];
    return envelope(this.mode, provenance, { ...answer, ...common });
  }

  async #reservationAction(request, common) {
    if (this.mode !== IntelligenceMode.SURVIVAL) {
      return envelope(this.mode, [{ kind: "AUTHORITY_BOUNDARY", authority: "RESERVATION_CORE" }], {
        status: "SURVIVAL_HANDOFF_REQUIRED",
        handoff: createReservationHandoff(this.state),
        ...common
      });
    }
    if (!this.reservationCore) {
      return envelope(this.mode, [{ kind: "FAIL_CLOSED", reason: "RESERVATION_CORE_UNAVAILABLE" }], {
        status: "RESERVATION_CORE_UNAVAILABLE",
        ...common
      });
    }
    if (request.action === "PREPARE_RESERVATION") {
      const handoff = createReservationHandoff(this.state);
      if (handoff.status !== "HANDOFF_REQUIRED") {
        return envelope(this.mode, [{ kind: "FAIL_CLOSED", reason: handoff.status }], { ...handoff, ...common });
      }
      const prepared = await this.reservationCore.prepare({ ...handoff, request: clone(request.payload ?? {}) });
      return envelope(this.mode, [{ kind: "RESERVATION_CORE", operation: "PREPARE" }], {
        status: prepared.status,
        preparationId: prepared.preparationId ?? null,
        ...common
      });
    }
    const confirmed = await this.reservationCore.confirm(request.preparationId);
    return envelope(this.mode, [{ kind: "RESERVATION_CORE", operation: "CONFIRM" }], {
      status: confirmed.status,
      bookingConfirmed: confirmed.status === "CONFIRMED",
      reservationId: confirmed.status === "CONFIRMED" ? confirmed.reservationId : null,
      ...common
    });
  }
}

/** Test-only deterministic boundary; no network operations. */
export class ScriptedBoundary {
  constructor({ health = [], advisories = [] } = {}) {
    this.healthScript = [...health];
    this.advisories = [...advisories];
    this.calls = { health: 0, advise: 0 };
  }
  async health() {
    this.calls.health += 1;
    return { status: this.healthScript.length > 1 ? this.healthScript.shift() : (this.healthScript[0] ?? "UNAVAILABLE") };
  }
  async advise() {
    this.calls.advise += 1;
    const value = this.advisories.length > 1 ? this.advisories.shift() : this.advisories[0];
    if (value instanceof Error) throw value;
    return value ?? { advisory: null };
  }
}
