import { DeterministicLanguageUnderstandingProvider } from "../providers/deterministic-provider.mjs";
import { AzureOpenAIStructuredOutputProvider } from "../providers/azure-openai-provider.mjs";
import { GonkaRouterProvider } from "../providers/gonka-router-provider.mjs";
import { DeterministicLocalRetriever } from "../retrieval/local-retriever.mjs";
import { AzureAISearchRetriever } from "../retrieval/azure-ai-search-adapter.mjs";
import { DeterministicDecisionEngine } from "../decision/decision-engine.mjs";
import { MemoryCheckpointer } from "../persistence/memory-checkpointer.mjs";
import { ReservationCoreHttpTools } from "../tools/reservation-core-http.mjs";
import { ConciergeGraph } from "../graph/concierge-graph.mjs";
import { ConciergeService } from "./concierge-service.mjs";

export function createConciergeService({ env=process.env, fetchImpl=globalThis.fetch }={}) {
  const languageProvider=env.CONCIERGE_LANGUAGE_PROVIDER??"deterministic";
  if(!["deterministic","azure","gonka"].includes(languageProvider)) throw new Error(`Unsupported language provider: ${languageProvider}`);
  const cloudLanguage=["azure","gonka"].includes(languageProvider);
  const cloudRetrieval=env.CONCIERGE_RETRIEVAL_PROVIDER==="azure";
  const provider=languageProvider==="azure"
    ?new AzureOpenAIStructuredOutputProvider({endpoint:env.AZURE_OPENAI_ENDPOINT,apiKey:env.AZURE_OPENAI_API_KEY,deployment:env.AZURE_OPENAI_DEPLOYMENT,apiVersion:env.AZURE_OPENAI_API_VERSION,fetchImpl})
    :languageProvider==="gonka"
      ?new GonkaRouterProvider({baseUrl:env.GONKA_BASE_URL,apiKey:env.GONKA_API_KEY,model:env.GONKA_MODEL,timeoutMs:env.GONKA_TIMEOUT_MS,fetchImpl})
      :new DeterministicLanguageUnderstandingProvider();
  const retriever=cloudRetrieval?new AzureAISearchRetriever({endpoint:env.AZURE_AI_SEARCH_ENDPOINT,apiKey:env.AZURE_AI_SEARCH_API_KEY,indexName:env.AZURE_AI_SEARCH_INDEX,apiVersion:env.AZURE_AI_SEARCH_API_VERSION,fetchImpl}):new DeterministicLocalRetriever();
  const reservationTools=new ReservationCoreHttpTools({baseUrl:env.RESERVATION_CORE_BASE_URL,bearerToken:env.RESERVATION_CORE_DEV_BEARER_TOKEN,fetchImpl});
  const graph=new ConciergeGraph({provider,retriever,decisionEngine:new DeterministicDecisionEngine(),checkpointer:new MemoryCheckpointer(),reservationTools});
  return new ConciergeService({graph,capabilities:{languageUnderstanding:cloudLanguage?"CLOUD":"LOCAL",retrieval:cloudRetrieval?"CLOUD":"LOCAL"}});
}
