import { INTENT_UPDATE_JSON_SCHEMA, INTENT_UPDATE_KEY_CONTRACT, normalizeIntentUpdate, validateIntentUpdate } from "../contracts/dining-intent.mjs";
import { ProviderUnavailableError, SEMANTIC_UPDATE_INSTRUCTION } from "./azure-openai-provider.mjs";

const REQUIRED_UPDATE_PROPERTIES = ["intentType", "operations", "ambiguities", "contradictions", "candidateNextQuestion"];
const REQUIRED_OPERATION_PROPERTIES = ["operation", "target", "key", "value", "hardness", "provenance", "confidence", "sourceText", "weight"];
export const DEFAULT_GONKA_TIMEOUT_MS = 30_000;
export const MIN_GONKA_TIMEOUT_MS = 1_000;
export const MAX_GONKA_TIMEOUT_MS = 120_000;
const MAX_CONTENT_LENGTH = 64 * 1024;
const MAX_SURROUNDING_PROSE_LENGTH = 1_024;
const TARGET_KEY_RULES = Object.entries(INTENT_UPDATE_KEY_CONTRACT)
  .map(([target, keys]) => `- target \"${target}\" permits only key values: ${keys.map(key => `\"${key}\"`).join(", ")}`)
  .join("\n");

export const GONKA_SEMANTIC_UPDATE_INSTRUCTION = `${SEMANTIC_UPDATE_INSTRUCTION}

GONKA JSON TRANSPORT CONTRACT:
Return exactly one JSON object and nothing else. Do not use markdown or expose reasoning.
The following JSON Schema is authoritative and case-sensitive. Follow its required properties and enums exactly; do not guess, translate, lowercase, or invent enum values or keys:
${JSON.stringify(INTENT_UPDATE_JSON_SCHEMA)}
The operation target-to-key relationship is also authoritative and case-sensitive:
${TARGET_KEY_RULES}
Choose only from the keys listed for the operation's target. Descriptive words that are not keys, including \"intimate\" and \"quiet\", may be values of an allowed key such as \"ambience\"; they must never become keys.
Navigation-only rejection or replanning language is a valid semantic delta with no field mutation. For utterances such as \"I'd prefer another option.\", \"Not this one.\", or \"Show me something else.\", emit intentType \"REJECT\", operations [], empty ambiguities and contradictions, and candidateNextQuestion null. Preserve currentIntent by omission; do not copy its fields into operations.
Provider-native structured-output enforcement is not assumed. The response will be parsed and validated locally, and any mismatch rejects the whole proposal.`;

function diagnostics(requestedModel, actualModel = null, status = "REJECTED") {
  return { provider: "GONKA", requestedModel, actualModel, status };
}

function reject(message, requestedModel, actualModel = null, cause) {
  const error = new ProviderUnavailableError(message, cause ? { cause } : undefined);
  error.diagnostics = diagnostics(requestedModel, actualModel);
  return error;
}

function stripReasoningWrappers(input) {
  let text = input.trim();
  const wrapper = /^\s*<think>[\s\S]*?<\/think>\s*/i;
  while (wrapper.test(text)) text = text.replace(wrapper, "").trim();
  if (/<\/?think>/i.test(text)) throw new Error("unbalanced or embedded reasoning wrapper");
  return text;
}

function objectCandidates(text) {
  const candidates = [];
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === "{") { if (depth === 0) start = index; depth += 1; }
    else if (character === "}") {
      if (depth === 0) throw new Error("unbalanced JSON object");
      depth -= 1;
      if (depth === 0) { candidates.push(text.slice(start, index + 1)); start = -1; }
    }
  }
  if (depth !== 0 || quoted) throw new Error("unterminated JSON object");
  return candidates;
}

export function normalizeGonkaContent(content) {
  if (typeof content !== "string" || !content.trim()) throw new Error("empty provider content");
  if (content.length > MAX_CONTENT_LENGTH) throw new Error("provider content exceeds the normalization limit");
  let text = stripReasoningWrappers(content);
  const fence = /^```json\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fence) text = fence[1].trim();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch {
    const candidates = objectCandidates(text);
    if (candidates.length !== 1) throw new Error("provider content does not contain exactly one JSON object");
    const candidateStart = text.indexOf(candidates[0]);
    const surroundingLength = candidateStart + text.length - candidateStart - candidates[0].length;
    if (surroundingLength > MAX_SURROUNDING_PROSE_LENGTH) throw new Error("surrounding provider prose exceeds the normalization limit");
    parsed = JSON.parse(candidates[0]);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("provider output must be a JSON object");
  return parsed;
}

function validateRequiredProperties(value) {
  const missing = REQUIRED_UPDATE_PROPERTIES.filter(key => !Object.hasOwn(value, key));
  if (missing.length) throw new Error(`missing required properties: ${missing.join(", ")}`);
  if (!Array.isArray(value.operations)) return;
  value.operations.forEach((operation, index) => {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) return;
    const missingOperationProperties = REQUIRED_OPERATION_PROPERTIES.filter(key => !Object.hasOwn(operation, key));
    if (missingOperationProperties.length) throw new Error(`operations.${index} missing required properties: ${missingOperationProperties.join(", ")}`);
    const scalar = operation.value === null || ["string", "number", "boolean"].includes(typeof operation.value);
    if (!scalar || (typeof operation.value === "number" && !Number.isFinite(operation.value))) {
      throw new Error(`operations.${index}.value must be a finite JSON scalar or null`);
    }
  });
}

function validateEvidence(update, turn) {
  const source = String(turn).toLocaleLowerCase();
  for (const operation of update.operations) {
    if (!source.includes(operation.sourceText.toLocaleLowerCase())) throw new Error("operation evidence is not present in the user turn");
  }
}

export function normalizeGonkaTimeout(value) {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return DEFAULT_GONKA_TIMEOUT_MS;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_GONKA_TIMEOUT_MS;
  return Math.min(MAX_GONKA_TIMEOUT_MS, Math.max(MIN_GONKA_TIMEOUT_MS, Math.trunc(parsed)));
}

export class GonkaRouterProvider {
  constructor({
    baseUrl = process.env.GONKA_BASE_URL,
    apiKey = process.env.GONKA_API_KEY,
    model = process.env.GONKA_MODEL,
    timeoutMs = process.env.GONKA_TIMEOUT_MS,
    fetchImpl = globalThis.fetch
  } = {}) {
    Object.assign(this, { baseUrl, apiKey, model, timeoutMs: normalizeGonkaTimeout(timeoutMs), fetch: fetchImpl });
    // Inference calls can incur cost. The graph's legacy cold-start retry is
    // intentionally disabled for Gonka so one user turn makes at most one
    // provider request unless a future explicit configuration says otherwise.
    this.allowFreshInitializationRetry = false;
  }

  async understand(turn, state) {
    if (!this.baseUrl || !this.apiKey || !this.model) throw reject("GonkaRouter provider is not configured", this.model ?? null);
    const requestedModel = this.model;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: requestedModel,
          messages: [
            { role: "system", content: GONKA_SEMANTIC_UPDATE_INSTRUCTION },
            { role: "user", content: JSON.stringify({ turn, currentIntent: state }) }
          ],
          temperature: 0
        }),
        signal: controller.signal
      });
    } catch (cause) {
      const message = controller.signal.aborted ? "GonkaRouter request timed out" : "GonkaRouter request failed";
      throw reject(message, requestedModel, null, cause);
    } finally { clearTimeout(timeout); }
    if (!response?.ok) throw reject(`GonkaRouter returned ${response?.status ?? "an invalid response"}`, requestedModel);
    let payload;
    try { payload = await response.json(); }
    catch (cause) { throw reject("GonkaRouter returned an invalid response body", requestedModel, null, cause); }
    const actualModel = typeof payload?.model === "string" && payload.model.trim() ? payload.model : null;
    try {
      if (!Array.isArray(payload?.choices) || payload.choices.length !== 1) throw new Error("provider response must contain exactly one choice");
      const content = payload.choices[0]?.message?.content;
      const proposal = normalizeGonkaContent(content);
      validateRequiredProperties(proposal);
      const update = validateIntentUpdate(normalizeIntentUpdate(turn,state,proposal));
      validateEvidence(update, turn);
      return { update, diagnostics: diagnostics(requestedModel, actualModel, "ACCEPTED") };
    } catch (cause) {
      throw reject("GonkaRouter returned rejected semantic output", requestedModel, actualModel, cause);
    }
  }
}
