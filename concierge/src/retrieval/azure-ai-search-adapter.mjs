import { buildODataSecurityFilter, validateRetrievalContext } from "./retrieval-policy.mjs";

export class RetrievalUnavailableError extends Error { constructor(message, options) { super(message, options); this.name = "RetrievalUnavailableError"; } }

export class AzureAISearchRetriever {
  constructor({ endpoint = process.env.AZURE_AI_SEARCH_ENDPOINT, apiKey = process.env.AZURE_AI_SEARCH_API_KEY, indexName = process.env.AZURE_AI_SEARCH_INDEX, apiVersion = process.env.AZURE_AI_SEARCH_API_VERSION ?? "2024-07-01", fetchImpl = globalThis.fetch, defaultContext = { tenantId: process.env.AZURE_AI_SEARCH_TENANT_ID, callerAcl: process.env.AZURE_AI_SEARCH_CALLER_ACL?.split(","), asOf: process.env.AZURE_AI_SEARCH_AS_OF } } = {}) { Object.assign(this,{endpoint,apiKey,indexName,apiVersion,fetch:fetchImpl,defaultContext}); }
  async retrieve(query, _intent, rawContext = this.defaultContext) {
    if (!this.endpoint || !this.apiKey || !this.indexName) throw new RetrievalUnavailableError("Azure AI Search is not configured");
    const context = validateRetrievalContext(rawContext);
    let response;
    try { response = await this.fetch(`${this.endpoint.replace(/\/$/,"")}/indexes/${encodeURIComponent(this.indexName)}/docs/search?api-version=${encodeURIComponent(this.apiVersion)}`, { method:"POST", headers:{"content-type":"application/json","api-key":this.apiKey}, body:JSON.stringify({ search: query || "*", queryType:"semantic", top:50, filter:buildODataSecurityFilter(context), select:"id,name,facts,evidence,tenantId,acl,effectiveFrom,effectiveTo,superseded,tombstone" }) }); }
    catch (cause) { throw new RetrievalUnavailableError("Azure AI Search request failed",{cause}); }
    if (!response.ok) throw new RetrievalUnavailableError(`Azure AI Search returned ${response.status}`);
    const payload = await response.json();
    return (payload.value ?? []).map(item => ({ id:item.id, name:item.name, facts:item.facts, evidence:item.evidence ?? [], retrieval:{provider:"AZURE_AI_SEARCH",score:item["@search.score"] ?? 0, exactConstraintsDelegated:false,filterAppliedBeforeRanking:true,asOf:context.asOf} }));
  }
}
