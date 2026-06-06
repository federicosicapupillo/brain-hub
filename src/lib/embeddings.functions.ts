import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const EMBED_MODEL = "google/gemini-embedding-001";
const EMBED_DIMS = 1536;
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/embeddings";

async function embedTexts(inputs: string[]): Promise<number[][]> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("EMBEDDINGS_NOT_CONFIGURED");
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs, dimensions: EMBED_DIMS }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    if (res.status === 402) throw new Error("EMBEDDINGS_CREDITS_EXHAUSTED");
    if (res.status === 429) throw new Error("EMBEDDINGS_RATE_LIMIT");
    if (res.status === 403 || res.status === 404) throw new Error("EMBEDDINGS_NOT_AVAILABLE");
    throw new Error(`EMBEDDINGS_ERROR: ${res.status} ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

const BATCH_SIZE = 8;

// ============ Embed a source's chunks ============
export const embedSourceChunks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ sourceId: z.string().uuid(), force: z.boolean().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let q = supabase.from("knowledge_chunks").select("id, content, embedding_status").eq("source_id", data.sourceId);
    if (!data.force) q = q.in("embedding_status", ["pending", "error"]);
    const { data: chunks, error } = await q;
    if (error) throw new Error(error.message);
    if (!chunks || chunks.length === 0) return { processed: 0, failed: 0, total: 0 };

    let processed = 0;
    let failed = 0;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      try {
        const vectors = await embedTexts(batch.map((c) => c.content));
        await Promise.all(batch.map((c, j) =>
          supabase.from("knowledge_chunks").update({
            embedding: vectors[j] as unknown as never,
            embedding_model: EMBED_MODEL,
            embedded_at: new Date().toISOString(),
            embedding_status: "ready",
            embedding_error: null,
          }).eq("id", c.id)
        ));
        processed += batch.length;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        await Promise.all(batch.map((c) =>
          supabase.from("knowledge_chunks").update({
            embedding_status: "error",
            embedding_error: msg.slice(0, 500),
          }).eq("id", c.id)
        ));
        failed += batch.length;
        if (msg === "EMBEDDINGS_NOT_CONFIGURED" || msg === "EMBEDDINGS_CREDITS_EXHAUSTED" || msg === "EMBEDDINGS_NOT_AVAILABLE") {
          return { processed, failed, total: chunks.length, error: msg };
        }
      }
    }
    return { processed, failed, total: chunks.length };
  });

// ============ Embed all chunks in a brain ============
export const embedBrainChunks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ brainId: z.string().uuid(), force: z.boolean().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let q = supabase.from("knowledge_chunks").select("id, content").eq("brain_id", data.brainId);
    if (!data.force) q = q.in("embedding_status", ["pending", "error"]);
    const { data: chunks, error } = await q.limit(500);
    if (error) throw new Error(error.message);
    if (!chunks || chunks.length === 0) return { processed: 0, failed: 0, total: 0 };

    let processed = 0;
    let failed = 0;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      try {
        const vectors = await embedTexts(batch.map((c) => c.content));
        await Promise.all(batch.map((c, j) =>
          supabase.from("knowledge_chunks").update({
            embedding: vectors[j] as unknown as never,
            embedding_model: EMBED_MODEL,
            embedded_at: new Date().toISOString(),
            embedding_status: "ready",
            embedding_error: null,
          }).eq("id", c.id)
        ));
        processed += batch.length;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        await Promise.all(batch.map((c) =>
          supabase.from("knowledge_chunks").update({
            embedding_status: "error", embedding_error: msg.slice(0, 500),
          }).eq("id", c.id)
        ));
        failed += batch.length;
        if (msg === "EMBEDDINGS_NOT_CONFIGURED" || msg === "EMBEDDINGS_CREDITS_EXHAUSTED" || msg === "EMBEDDINGS_NOT_AVAILABLE") {
          return { processed, failed, total: chunks.length, error: msg };
        }
      }
    }
    return { processed, failed, total: chunks.length };
  });

// ============ Semantic search ============
export const semanticSearchFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    query: z.string().min(1).max(2000),
    brainId: z.string().uuid().nullable().optional(),
    limit: z.number().int().min(1).max(50).optional(),
    threshold: z.number().min(0).max(1).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let vector: number[];
    try {
      const out = await embedTexts([data.query]);
      vector = out[0];
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return { error: msg, results: [] as never[] };
    }
    const { data: rows, error } = await supabase.rpc("match_knowledge_chunks", {
      query_embedding: vector as unknown as string,
      match_brain_id: data.brainId ?? undefined,
      match_threshold: data.threshold ?? 0.5,
      match_count: data.limit ?? 10,
    });
    if (error) throw new Error(error.message);
    return { results: rows ?? [], error: null };
  });
