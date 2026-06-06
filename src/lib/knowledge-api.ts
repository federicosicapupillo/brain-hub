import { supabase } from "@/integrations/supabase/client";
import { logAction, pushLiveEvent } from "@/lib/workspace-api";

const BUCKET = "brain-uploads";

export type KnowledgeSource = {
  id: string;
  user_id: string;
  brain_id: string;
  node_id: string | null;
  title: string;
  source_type: string;
  status: string;
  description: string | null;
  url: string | null;
  file_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  content_hash: string | null;
  extracted_text: string | null;
  summary: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type KnowledgeChunk = {
  id: string;
  brain_id: string;
  source_id: string;
  node_id: string | null;
  chunk_index: number;
  content: string;
  token_estimate: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

async function getUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error ?? new Error("Non autenticato");
  return data.user.id;
}

// ----- Chunking -----
export function chunkText(text: string, size = 1200, overlap = 200): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length);
    if (end < clean.length) {
      const slice = clean.slice(i, end);
      const lastBreak = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "), slice.lastIndexOf(" "));
      if (lastBreak > size * 0.5) end = i + lastBreak + 1;
    }
    chunks.push(clean.slice(i, end).trim());
    if (end >= clean.length) break;
    i = end - overlap;
    if (i < 0) i = 0;
  }
  return chunks.filter((c) => c.length > 0);
}

// ----- Sources CRUD -----
export async function listKnowledgeSources(brainId?: string): Promise<KnowledgeSource[]> {
  let q = supabase.from("knowledge_sources").select("*").order("created_at", { ascending: false });
  if (brainId) q = q.eq("brain_id", brainId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as KnowledgeSource[];
}

export async function getKnowledgeSource(sourceId: string): Promise<KnowledgeSource> {
  const { data, error } = await supabase.from("knowledge_sources").select("*").eq("id", sourceId).single();
  if (error) throw error;
  return data as KnowledgeSource;
}

export async function updateKnowledgeSource(sourceId: string, patch: Partial<KnowledgeSource>): Promise<void> {
  const { error } = await supabase.from("knowledge_sources").update(patch as never).eq("id", sourceId);
  if (error) throw error;
}

export async function deleteKnowledgeSource(sourceId: string): Promise<void> {
  const user_id = await getUserId();
  const src = await getKnowledgeSource(sourceId);
  if (src.file_path) {
    await supabase.storage.from(BUCKET).remove([src.file_path]).catch(() => undefined);
  }
  const { error } = await supabase.from("knowledge_sources").delete().eq("id", sourceId);
  if (error) throw error;
  await logAction({ action: "source_deleted", message: `Fonte eliminata: ${src.title}`, entity_type: "knowledge_source", entity_id: sourceId, brain_id: src.brain_id });
  await pushLiveEvent({ event_type: "source", title: `Fonte eliminata: ${src.title}`, brain_id: src.brain_id });
  void user_id;
}

// ----- Chunks -----
export async function listKnowledgeChunks(sourceId: string): Promise<KnowledgeChunk[]> {
  const { data, error } = await supabase.from("knowledge_chunks").select("*")
    .eq("source_id", sourceId).order("chunk_index", { ascending: true });
  if (error) throw error;
  return (data ?? []) as KnowledgeChunk[];
}

export async function createKnowledgeChunks(source: Pick<KnowledgeSource, "id" | "brain_id" | "node_id">, content: string): Promise<number> {
  const user_id = await getUserId();
  const pieces = chunkText(content);
  if (pieces.length === 0) return 0;
  const rows = pieces.map((c, idx) => ({
    user_id,
    brain_id: source.brain_id,
    source_id: source.id,
    node_id: source.node_id,
    chunk_index: idx,
    content: c,
    token_estimate: Math.ceil(c.length / 4),
    metadata: {},
  }));
  const { error } = await supabase.from("knowledge_chunks").insert(rows);
  if (error) throw error;
  await logAction({ action: "chunks_created", message: `Generati ${rows.length} chunk`, entity_type: "knowledge_source", entity_id: source.id, brain_id: source.brain_id });
  return rows.length;
}

// ----- Source creators -----
export async function createManualSource(input: {
  brain_id: string; node_id?: string | null; title: string; content: string; tags?: string[]; description?: string;
}): Promise<KnowledgeSource> {
  const user_id = await getUserId();
  const { data, error } = await supabase.from("knowledge_sources").insert({
    user_id,
    brain_id: input.brain_id,
    node_id: input.node_id ?? null,
    title: input.title,
    source_type: "manual",
    status: "ready",
    description: input.description ?? null,
    extracted_text: input.content,
    tags: input.tags ?? [],
  }).select().single();
  if (error) throw error;
  const src = data as KnowledgeSource;
  if (input.content?.trim()) {
    await createKnowledgeChunks({ id: src.id, brain_id: src.brain_id, node_id: src.node_id }, input.content);
  }
  await logAction({ action: "source_created", message: `Nota creata: ${src.title}`, entity_type: "knowledge_source", entity_id: src.id, brain_id: src.brain_id });
  await pushLiveEvent({ event_type: "source", title: `Nuova nota: ${src.title}`, brain_id: src.brain_id });
  return src;
}

export async function createUrlSource(input: {
  brain_id: string; node_id?: string | null; title: string; url: string; description?: string; tags?: string[];
}): Promise<KnowledgeSource> {
  const user_id = await getUserId();
  const { data, error } = await supabase.from("knowledge_sources").insert({
    user_id,
    brain_id: input.brain_id,
    node_id: input.node_id ?? null,
    title: input.title,
    source_type: "url",
    status: "ready",
    url: input.url,
    description: input.description ?? null,
    tags: input.tags ?? [],
  }).select().single();
  if (error) throw error;
  const src = data as KnowledgeSource;
  await logAction({ action: "source_created", message: `Link aggiunto: ${src.title}`, entity_type: "knowledge_source", entity_id: src.id, brain_id: src.brain_id });
  await pushLiveEvent({ event_type: "source", title: `Nuovo link: ${src.title}`, brain_id: src.brain_id });
  return src;
}

const TEXT_MIMES = new Set(["text/plain", "text/markdown", "text/csv", "application/json", "text/json"]);
const TEXT_EXT = /\.(txt|md|markdown|csv|json)$/i;

export async function uploadFileSource(input: {
  brain_id: string; node_id?: string | null; title?: string; file: File; tags?: string[];
}): Promise<KnowledgeSource> {
  const user_id = await getUserId();
  const file = input.file;
  if (file.size > 20 * 1024 * 1024) throw new Error("File troppo grande (max 20 MB)");

  // Insert row first to get id, then upload to user_id/brain_id/source_id/file_name
  const { data: pre, error: preErr } = await supabase.from("knowledge_sources").insert({
    user_id,
    brain_id: input.brain_id,
    node_id: input.node_id ?? null,
    title: input.title?.trim() || file.name,
    source_type: "file",
    status: "processing",
    file_name: file.name,
    mime_type: file.type || null,
    file_size: file.size,
    tags: input.tags ?? [],
  }).select().single();
  if (preErr) throw preErr;
  const src = pre as KnowledgeSource;

  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${user_id}/${input.brain_id}/${src.id}/${safeName}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (upErr) {
    await supabase.from("knowledge_sources").update({ status: "error", metadata: { error: upErr.message } }).eq("id", src.id);
    throw upErr;
  }

  // Try text extraction for plain text files
  let extracted: string | null = null;
  if (TEXT_MIMES.has(file.type) || TEXT_EXT.test(file.name)) {
    try { extracted = await file.text(); } catch { extracted = null; }
  }

  const patch: Partial<KnowledgeSource> = {
    file_path: path,
    status: "ready",
    extracted_text: extracted,
  };
  const { error: updErr } = await supabase.from("knowledge_sources").update(patch as never).eq("id", src.id);
  if (updErr) throw updErr;

  if (extracted && extracted.trim()) {
    await createKnowledgeChunks({ id: src.id, brain_id: src.brain_id, node_id: src.node_id }, extracted);
  }

  await logAction({ action: "source_created", message: `File caricato: ${src.title}`, entity_type: "knowledge_source", entity_id: src.id, brain_id: src.brain_id });
  await pushLiveEvent({ event_type: "source", title: `Nuovo file: ${src.title}`, brain_id: src.brain_id });
  return { ...src, ...patch } as KnowledgeSource;
}

export async function getFileSignedUrl(filePath: string, expiresIn = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(filePath, expiresIn);
  if (error) return null;
  return data.signedUrl;
}

// ----- Import jobs -----
export async function createImportJob(input: {
  brain_id: string; source_type: string; total_items?: number; metadata?: Record<string, unknown>;
}) {
  const user_id = await getUserId();
  const { data, error } = await supabase.from("import_jobs").insert({
    user_id,
    brain_id: input.brain_id,
    source_type: input.source_type,
    total_items: input.total_items ?? 0,
    metadata: (input.metadata ?? {}) as never,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function updateImportJob(jobId: string, patch: { status?: string; processed_items?: number; error_message?: string; metadata?: Record<string, unknown> }) {
  const { error } = await supabase.from("import_jobs").update(patch as never).eq("id", jobId);
  if (error) throw error;
}
