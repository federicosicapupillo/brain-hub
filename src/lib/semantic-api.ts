import { supabase } from "@/integrations/supabase/client";
import { logAction, pushLiveEvent } from "@/lib/workspace-api";
import { embedSourceChunks, embedBrainChunks, semanticSearchFn } from "@/lib/embeddings.functions";

export type EmbeddingStatusCounts = {
  total: number; pending: number; processing: number; ready: number; error: number;
};

export type SemanticSearchResult = {
  chunk_id: string;
  source_id: string;
  brain_id: string;
  node_id: string | null;
  content: string;
  similarity: number;
  source_title: string;
  source_type: string;
  source_tags: string[];
};

export async function getEmbeddingStatus(brainId?: string | null): Promise<EmbeddingStatusCounts> {
  let q = supabase.from("knowledge_chunks").select("embedding_status");
  if (brainId) q = q.eq("brain_id", brainId);
  const { data, error } = await q;
  if (error) throw error;
  const counts: EmbeddingStatusCounts = { total: 0, pending: 0, processing: 0, ready: 0, error: 0 };
  for (const r of data ?? []) {
    counts.total++;
    const s = (r as { embedding_status: string }).embedding_status;
    if (s in counts) (counts as unknown as Record<string, number>)[s]++;
  }
  return counts;
}

export async function generateEmbeddingsForSource(sourceId: string, force = false) {
  const res = await embedSourceChunks({ data: { sourceId, force } });
  await logAction({
    action: "embeddings_source",
    message: `Embeddings fonte: ${res.processed}/${res.total} ok, ${res.failed} errori`,
    entity_type: "knowledge_source", entity_id: sourceId,
    severity: res.failed > 0 ? "warning" : "info",
  });
  return res;
}

export async function generateEmbeddingsForBrain(brainId: string, force = false) {
  const res = await embedBrainChunks({ data: { brainId, force } });
  await logAction({
    action: "embeddings_brain",
    message: `Embeddings cervello: ${res.processed}/${res.total} ok, ${res.failed} errori`,
    brain_id: brainId, entity_type: "brain", entity_id: brainId,
    severity: res.failed > 0 ? "warning" : "info",
  });
  await pushLiveEvent({ event_type: "embeddings", title: `Embeddings aggiornati (${res.processed})`, brain_id: brainId });
  return res;
}

export async function semanticSearch(query: string, options: { brainId?: string | null; limit?: number; threshold?: number } = {}) {
  const res = await semanticSearchFn({
    data: {
      query,
      brainId: options.brainId ?? null,
      limit: options.limit ?? 10,
      threshold: options.threshold ?? 0.5,
    },
  });
  await logAction({
    action: "semantic_search",
    message: `Ricerca semantica: ${(res.results ?? []).length} risultati`,
    brain_id: options.brainId ?? null,
  });
  return res as { results: SemanticSearchResult[]; error: string | null };
}

export async function resetEmbeddingsForSource(sourceId: string) {
  const { error } = await supabase.from("knowledge_chunks").update({
    embedding: null as unknown as never,
    embedded_at: null,
    embedding_status: "pending",
    embedding_error: null,
  } as never).eq("source_id", sourceId);
  if (error) throw error;
}

export function friendlyEmbeddingError(code: string): string {
  switch (code) {
    case "EMBEDDINGS_NOT_CONFIGURED":
      return "Configura la chiave embeddings nei Secrets per attivare la ricerca semantica.";
    case "EMBEDDINGS_CREDITS_EXHAUSTED":
      return "Crediti AI esauriti. Aggiungi crediti per continuare.";
    case "EMBEDDINGS_RATE_LIMIT":
      return "Troppe richieste, riprova tra qualche secondo.";
    case "EMBEDDINGS_NOT_AVAILABLE":
      return "Embeddings non abilitati per questo workspace.";
    default:
      return code.startsWith("EMBEDDINGS_ERROR") ? "Errore provider embeddings." : code;
  }
}
