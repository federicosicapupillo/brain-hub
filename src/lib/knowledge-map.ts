import { supabase } from "@/integrations/supabase/client";

export type KSourceType =
  | "local_folder_path"
  | "local_file_path"
  | "external_drive_path"
  | "google_drive_folder"
  | "google_drive_file"
  | "github_repository"
  | "github_file"
  | "lovable_project"
  | "supabase_project"
  | "figma_or_design"
  | "image_asset"
  | "video_asset"
  | "audio_asset"
  | "pdf_document"
  | "markdown_document"
  | "chat_export"
  | "prompt_collection"
  | "research_link"
  | "competitor_link"
  | "client_brief"
  | "legal_document"
  | "contract"
  | "invoice_or_quote"
  | "social_asset"
  | "landing_page"
  | "website_url"
  | "custom";

export const SOURCE_TYPE_LABEL: Record<KSourceType, string> = {
  local_folder_path: "Cartella locale",
  local_file_path: "File locale",
  external_drive_path: "Disco esterno",
  google_drive_folder: "Google Drive — cartella",
  google_drive_file: "Google Drive — file",
  github_repository: "Repository GitHub",
  github_file: "File GitHub",
  lovable_project: "Progetto Lovable",
  supabase_project: "Progetto Supabase",
  figma_or_design: "Figma / Design",
  image_asset: "Immagine",
  video_asset: "Video",
  audio_asset: "Audio",
  pdf_document: "PDF",
  markdown_document: "Markdown",
  chat_export: "Chat export",
  prompt_collection: "Collezione prompt",
  research_link: "Link ricerca",
  competitor_link: "Link competitor",
  client_brief: "Brief cliente",
  legal_document: "Documento legale",
  contract: "Contratto",
  invoice_or_quote: "Fattura / preventivo",
  social_asset: "Asset social",
  landing_page: "Landing page",
  website_url: "Sito web",
  custom: "Custom",
};

export type KCategory =
  | "Codice"
  | "Documentazione"
  | "Brief"
  | "Prompt"
  | "Media"
  | "Design"
  | "Dati"
  | "Ricerca"
  | "Cliente"
  | "Commerciale"
  | "Legale"
  | "Marketing"
  | "Social"
  | "Repository"
  | "Tool"
  | "Altro";

export const CATEGORIES: KCategory[] = [
  "Codice",
  "Documentazione",
  "Brief",
  "Prompt",
  "Media",
  "Design",
  "Dati",
  "Ricerca",
  "Cliente",
  "Commerciale",
  "Legale",
  "Marketing",
  "Social",
  "Repository",
  "Tool",
  "Altro",
];

export type KStatus =
  | "active"
  | "missing"
  | "needs_review"
  | "outdated"
  | "duplicate"
  | "archived"
  | "unknown";

export const STATUS_LABEL: Record<KStatus, string> = {
  active: "Attivo",
  missing: "Mancante",
  needs_review: "Da verificare",
  outdated: "Obsoleto",
  duplicate: "Duplicato",
  archived: "Archiviato",
  unknown: "Sconosciuto",
};

export type KImportance = "bassa" | "media" | "alta" | "critica";
export const IMPORTANCE: KImportance[] = ["bassa", "media", "alta", "critica"];

export type KnowledgeSourceRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  brain_id: string | null;
  roadmap_item_id: string | null;
  task_id: string | null;
  prompt_execution_log_id: string | null;
  runbook_instance_id: string | null;
  tool_link_id: string | null;
  title: string;
  source_type: KSourceType;
  category: KCategory;
  source_url: string | null;
  local_path: string | null;
  external_drive_name: string | null;
  status: KStatus;
  importance: KImportance;
  description: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

const TABLE = "project_knowledge_sources" as never;

function normalize(r: any): KnowledgeSourceRow {
  return {
    ...r,
    tags: Array.isArray(r.tags) ? r.tags : [],
    metadata: r.metadata ?? {},
  } as KnowledgeSourceRow;
}

export async function listKnowledgeSources(brainId?: string): Promise<KnowledgeSourceRow[]> {
  let q = supabase.from(TABLE).select("*").order("updated_at", { ascending: false });
  if (brainId) q = q.eq("brain_id", brainId);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as any[]).map(normalize);
}

export type CreateKnowledgeInput = {
  brain_id: string | null;
  project_id?: string | null;
  title: string;
  source_type: KSourceType;
  category: KCategory;
  source_url?: string | null;
  local_path?: string | null;
  external_drive_name?: string | null;
  description?: string | null;
  status?: KStatus;
  importance?: KImportance;
  tags?: string[];
  roadmap_item_id?: string | null;
  task_id?: string | null;
  prompt_execution_log_id?: string | null;
  runbook_instance_id?: string | null;
  tool_link_id?: string | null;
  metadata?: Record<string, unknown>;
};

export async function createKnowledgeSource(input: CreateKnowledgeInput): Promise<KnowledgeSourceRow> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");
  const payload = {
    user_id: u.user.id,
    brain_id: input.brain_id,
    project_id: input.project_id ?? null,
    title: input.title,
    source_type: input.source_type,
    category: input.category,
    source_url: input.source_url ?? null,
    local_path: input.local_path ?? null,
    external_drive_name: input.external_drive_name ?? null,
    description: input.description ?? null,
    status: input.status ?? "active",
    importance: input.importance ?? "media",
    tags: input.tags ?? [],
    roadmap_item_id: input.roadmap_item_id ?? null,
    task_id: input.task_id ?? null,
    prompt_execution_log_id: input.prompt_execution_log_id ?? null,
    runbook_instance_id: input.runbook_instance_id ?? null,
    tool_link_id: input.tool_link_id ?? null,
    metadata: input.metadata ?? {},
  };
  const { data, error } = await supabase.from(TABLE).insert(payload as never).select().single();
  if (error) throw error;
  return normalize(data);
}

export async function updateKnowledgeSource(id: string, patch: Partial<CreateKnowledgeInput>): Promise<void> {
  const { error } = await supabase.from(TABLE).update(patch as never).eq("id", id);
  if (error) throw error;
}

export async function deleteKnowledgeSource(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw error;
}

export async function setKnowledgeStatus(id: string, status: KStatus): Promise<void> {
  await updateKnowledgeSource(id, { status });
}

// ---- Recommendations per preset ----
export type RecommendedItem = { title: string; source_type: KSourceType; category: KCategory; importance: KImportance };

export const RECOMMENDED_BY_PRESET: Record<string, RecommendedItem[]> = {
  sviluppo_app: [
    { title: "Repository GitHub", source_type: "github_repository", category: "Repository", importance: "critica" },
    { title: "Progetto Lovable", source_type: "lovable_project", category: "Tool", importance: "critica" },
    { title: "Progetto Supabase", source_type: "supabase_project", category: "Tool", importance: "alta" },
    { title: "README", source_type: "markdown_document", category: "Documentazione", importance: "alta" },
    { title: "Roadmap tecnica", source_type: "markdown_document", category: "Documentazione", importance: "alta" },
    { title: "Prompt history", source_type: "prompt_collection", category: "Prompt", importance: "media" },
    { title: "File regole progetto", source_type: "markdown_document", category: "Documentazione", importance: "media" },
    { title: "Changelog", source_type: "markdown_document", category: "Documentazione", importance: "media" },
    { title: "Bug log", source_type: "markdown_document", category: "Documentazione", importance: "media" },
  ],
  immobiliare: [
    { title: "Cartella foto immobili", source_type: "local_folder_path", category: "Media", importance: "alta" },
    { title: "Cartella documenti immobili", source_type: "local_folder_path", category: "Documentazione", importance: "alta" },
    { title: "Annunci", source_type: "landing_page", category: "Marketing", importance: "media" },
    { title: "Cartelli A3", source_type: "pdf_document", category: "Marketing", importance: "media" },
    { title: "Materiali social", source_type: "social_asset", category: "Social", importance: "media" },
    { title: "Brief clienti", source_type: "client_brief", category: "Cliente", importance: "alta" },
    { title: "Listino / prezzi", source_type: "pdf_document", category: "Commerciale", importance: "alta" },
    { title: "Contratti / incarichi", source_type: "contract", category: "Legale", importance: "critica" },
  ],
  content_creation: [
    { title: "Cartella asset", source_type: "local_folder_path", category: "Media", importance: "alta" },
    { title: "Script video", source_type: "markdown_document", category: "Documentazione", importance: "alta" },
    { title: "Prompt Runway/Higgsfield", source_type: "prompt_collection", category: "Prompt", importance: "media" },
    { title: "Immagini Midjourney", source_type: "image_asset", category: "Media", importance: "media" },
    { title: "Calendario editoriale", source_type: "google_drive_file", category: "Marketing", importance: "alta" },
    { title: "Export video", source_type: "video_asset", category: "Media", importance: "media" },
    { title: "Copy social", source_type: "social_asset", category: "Social", importance: "media" },
  ],
  lead_generation: [
    { title: "Lista lead", source_type: "google_drive_file", category: "Dati", importance: "critica" },
    { title: "Fonti ricerca", source_type: "research_link", category: "Ricerca", importance: "media" },
    { title: "Script chiamata", source_type: "markdown_document", category: "Commerciale", importance: "alta" },
    { title: "CRM / sheet", source_type: "google_drive_file", category: "Dati", importance: "alta" },
    { title: "Offerte", source_type: "pdf_document", category: "Commerciale", importance: "alta" },
    { title: "Follow-up", source_type: "markdown_document", category: "Commerciale", importance: "media" },
    { title: "Report campagne", source_type: "google_drive_file", category: "Marketing", importance: "media" },
  ],
  marketing: [
    { title: "Asset campagna", source_type: "local_folder_path", category: "Marketing", importance: "alta" },
    { title: "Calendario editoriale", source_type: "google_drive_file", category: "Marketing", importance: "alta" },
    { title: "Brief cliente", source_type: "client_brief", category: "Brief", importance: "alta" },
  ],
  ai_automation: [
    { title: "Collezione prompt", source_type: "prompt_collection", category: "Prompt", importance: "critica" },
    { title: "Chat export", source_type: "chat_export", category: "Documentazione", importance: "alta" },
    { title: "Documentazione workflow", source_type: "markdown_document", category: "Documentazione", importance: "alta" },
  ],
};

export type Summary = {
  total: number;
  active: number;
  needs_review: number;
  missing: number;
  outdated: number;
  unlinked: number;
  critical: number;
  recommended_missing: RecommendedItem[];
};

export function summarizeKnowledge(rows: KnowledgeSourceRow[], preset?: string): Summary {
  const total = rows.length;
  const active = rows.filter((r) => r.status === "active").length;
  const needs_review = rows.filter((r) => r.status === "needs_review").length;
  const missing = rows.filter((r) => r.status === "missing").length;
  const outdated = rows.filter((r) => r.status === "outdated").length;
  const unlinked = rows.filter(
    (r) =>
      !r.roadmap_item_id &&
      !r.task_id &&
      !r.prompt_execution_log_id &&
      !r.runbook_instance_id &&
      !r.tool_link_id,
  ).length;
  const critical = rows.filter((r) => r.importance === "critica").length;
  const recs = preset ? RECOMMENDED_BY_PRESET[preset] ?? [] : [];
  const present = new Set(rows.map((r) => r.title.toLowerCase()));
  const recommended_missing = recs.filter((r) => !present.has(r.title.toLowerCase()));
  return { total, active, needs_review, missing, outdated, unlinked, critical, recommended_missing };
}
