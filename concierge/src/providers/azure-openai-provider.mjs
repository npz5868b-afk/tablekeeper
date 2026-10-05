import { INTENT_UPDATE_JSON_SCHEMA, normalizeIntentUpdate, validateIntentUpdate } from "../contracts/dining-intent.mjs";

export const SEMANTIC_UPDATE_INSTRUCTION = `You produce a semantic IntentUpdate delta for a dining concierge.
Output only the supplied strict JSON schema. The current canonical intent is context, never user evidence.
Emit ordered operations; later explicit corrections in the same utterance must come later and supersede earlier conflicts.
Use SET to add, REPLACE for a correction, REMOVE when the user withdraws a value, and KEEP only for an explicitly retained value. KEEP never creates state.
sourceText must be an exact, non-empty excerpt from the current user utterance. Never copy currentIntent text into sourceText.
Distinguish EXPLICIT user values from INFERRED values. Do not infer reservation-critical party size, date, or time when uncertain; use ambiguities and candidateNextQuestion instead.
Numbers in explanations (for example, "one person dropped out") are not target party sizes. The final requested value is authoritative.
Normalize common times safely (half past seven to 19:30 when dinner context supports PM; quarter to eight to 19:45). Preserve flexibility such as after seven as a timeFlexibility constraint.
Negated soft preferences such as not too formal are SOFT constraints with a negative value such as "not-formal"; do not make them hard exclusions unless the wording requires it.
Represent relative priority with positive numeric weights: higher priority gets a larger weight. Do not invent restaurant facts, availability, prices, identities, reservation state, or booking confirmation.
Use only allowed keys. When genuinely uncertain, report an ambiguity rather than inventing certainty. Do not output reasoning or chain-of-thought.`;

export class ProviderUnavailableError extends Error { constructor(message, options) { super(message, options); this.name = "ProviderUnavailableError"; } }

export class AzureOpenAIStructuredOutputProvider {
  constructor({ endpoint = process.env.AZURE_OPENAI_ENDPOINT, apiKey = process.env.AZURE_OPENAI_API_KEY, deployment = process.env.AZURE_OPENAI_DEPLOYMENT, apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21", fetchImpl = globalThis.fetch } = {}) {
    this.endpoint = endpoint; this.apiKey = apiKey; this.deployment = deployment; this.apiVersion = apiVersion; this.fetch = fetchImpl;
  }
  async understand(turn, state) {
    if (!this.endpoint || !this.apiKey || !this.deployment) throw new ProviderUnavailableError("Azure OpenAI provider is not configured");
    const url = `${this.endpoint.replace(/\/$/, "")}/openai/deployments/${encodeURIComponent(this.deployment)}/chat/completions?api-version=${encodeURIComponent(this.apiVersion)}`;
    let response;
    try {
      response = await this.fetch(url, { method: "POST", headers: { "content-type": "application/json", "api-key": this.apiKey }, body: JSON.stringify({ messages: [{ role: "system", content: SEMANTIC_UPDATE_INSTRUCTION }, { role: "user", content: JSON.stringify({ turn, currentIntent: state }) }], temperature: 0, response_format: { type: "json_schema", json_schema: { name: "intent_update", strict: true, schema: INTENT_UPDATE_JSON_SCHEMA } } }) });
    } catch (cause) { throw new ProviderUnavailableError("Azure OpenAI request failed", { cause }); }
    if (!response.ok) throw new ProviderUnavailableError(`Azure OpenAI returned ${response.status}`);
    try {
      const proposal=JSON.parse((await response.json()).choices[0].message.content);
      const update=validateIntentUpdate(normalizeIntentUpdate(turn,state,proposal));
      const source=String(turn).toLocaleLowerCase();
      if ((update.operations??[]).some(item=>!source.includes(item.sourceText.toLocaleLowerCase()))) throw new Error("operation evidence is not present in the user turn");
      return update;
    }
    catch (cause) { throw new ProviderUnavailableError("Azure OpenAI returned invalid structured output", { cause }); }
  }
}

export const MicrosoftFoundryStructuredOutputProvider = AzureOpenAIStructuredOutputProvider;
