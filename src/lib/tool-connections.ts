import { supabase } from "@/integrations/supabase/client";
import type { LogEventType } from "@/lib/automation-run";

export type ToolStatus =
  | "connected"
  | "missing"
  | "needs_setup"
  | "inactive"
  | "broken"
  | "unknown";

export const TOOL_STATUS_LABEL: Record<ToolStatus, string> = {
  connected: "Collegato",
  missing: "Mancante",
  needs_setup: "Da configurare",
  inactive: "Inattivo",
  broken: "Problema",
  unknown: "Sconosciuto",
};

export const TOOL_STATUS_TONE: Record<ToolStatus, string> = {
  connected: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  missing: "bg-muted text-muted-foreground border-border",
  needs_setup: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  inactive: "bg-slate-500/10 text-slate-500 border-slate-500/30",
  broken: "bg-red-500/10 text-red-600 border-red-500/30",
  unknown: "bg-muted text-muted-foreground border-border",
};

export type ConnectionType =
  | "link_only"
  | "api_key_required"
  | "oauth_required"
  | "manual_workflow"
  | "browser_bridge"
  | "future_integration"
  | "external_app"
  | "custom";

export const CONNECTION_TYPE_LABEL: Record<ConnectionType, string> = {
  link_only: "Solo link",
  api_key_required: "Richiede API key",
  oauth_required: "Richiede OAuth",
  manual_workflow: "Workflow manuale",
  browser_bridge: "Browser Bridge",
  future_integration: "Integrazione futura",
  external_app: "App esterna",
  custom: "Custom",
};

export type ToolCategory =
  | "ai_assistant"
  | "app_builder"
  | "code_repo"
  | "db_backend"
  | "automation"
  | "browser_automation"
  | "communication"
  | "calendar_email"
  | "social_publishing"
  | "media_generation"
  | "design"
  | "storage_knowledge"
  | "payments"
  | "crm_leads"
  | "custom";

export const TOOL_CATEGORY_LABEL: Record<ToolCategory, string> = {
  ai_assistant: "AI Assistant",
  app_builder: "App Builder",
  code_repo: "Code / Repository",
  db_backend: "Database / Backend",
  automation: "Automation",
  browser_automation: "Browser Automation",
  communication: "Communication",
  calendar_email: "Calendar / Email",
  social_publishing: "Social Publishing",
  media_generation: "Media Generation",
  design: "Design",
  storage_knowledge: "Storage / Knowledge",
  payments: "Payments",
  crm_leads: "CRM / Leads",
  custom: "Custom",
};

export type ToolCatalogEntry = {
  name: string;
  category: ToolCategory;
  default_connection_type: ConnectionType;
  default_url?: string;
};

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  { name: "Lovable", category: "app_builder", default_connection_type: "external_app", default_url: "https://lovable.dev" },
  { name: "GitHub", category: "code_repo", default_connection_type: "oauth_required", default_url: "https://github.com" },
  { name: "Supabase", category: "db_backend", default_connection_type: "api_key_required", default_url: "https://supabase.com" },
  { name: "Google Drive", category: "storage_knowledge", default_connection_type: "oauth_required", default_url: "https://drive.google.com" },
  { name: "Gmail", category: "calendar_email", default_connection_type: "oauth_required", default_url: "https://mail.google.com" },
  { name: "Google Calendar", category: "calendar_email", default_connection_type: "oauth_required", default_url: "https://calendar.google.com" },
  { name: "Telegram", category: "communication", default_connection_type: "api_key_required", default_url: "https://web.telegram.org" },
  { name: "Instagram", category: "social_publishing", default_connection_type: "manual_workflow", default_url: "https://instagram.com" },
  { name: "Facebook", category: "social_publishing", default_connection_type: "manual_workflow", default_url: "https://facebook.com" },
  { name: "TikTok", category: "social_publishing", default_connection_type: "manual_workflow", default_url: "https://www.tiktok.com" },
  { name: "YouTube", category: "social_publishing", default_connection_type: "oauth_required", default_url: "https://youtube.com" },
  { name: "Runway", category: "media_generation", default_connection_type: "external_app", default_url: "https://runwayml.com" },
  { name: "Higgsfield", category: "media_generation", default_connection_type: "external_app", default_url: "https://higgsfield.ai" },
  { name: "Midjourney", category: "media_generation", default_connection_type: "external_app", default_url: "https://midjourney.com" },
  { name: "ElevenLabs", category: "media_generation", default_connection_type: "api_key_required", default_url: "https://elevenlabs.io" },
  { name: "D-ID", category: "media_generation", default_connection_type: "api_key_required", default_url: "https://d-id.com" },
  { name: "Canva", category: "design", default_connection_type: "external_app", default_url: "https://canva.com" },
  { name: "Perplexity", category: "ai_assistant", default_connection_type: "external_app", default_url: "https://perplexity.ai" },
  { name: "ChatGPT", category: "ai_assistant", default_connection_type: "external_app", default_url: "https://chat.openai.com" },
  { name: "Claude", category: "ai_assistant", default_connection_type: "external_app", default_url: "https://claude.ai" },
  { name: "Gemini", category: "ai_assistant", default_connection_type: "external_app", default_url: "https://gemini.google.com" },
  { name: "Codex", category: "ai_assistant", default_connection_type: "external_app" },
  { name: "Antigravity", category: "ai_assistant", default_connection_type: "external_app" },
  { name: "n8n", category: "automation", default_connection_type: "manual_workflow", default_url: "https://n8n.io" },
  { name: "Playwright / Browser Use", category: "browser_automation", default_connection_type: "browser_bridge" },
  { name: "Obsidian", category: "storage_knowledge", default_connection_type: "manual_workflow", default_url: "https://obsidian.md" },
  { name: "Stripe", category: "payments", default_connection_type: "api_key_required", default_url: "https://stripe.com" },
  { name: "Twilio / WhatsApp", category: "communication", default_connection_type: "api_key_required", default_url: "https://twilio.com" },
  { name: "Custom Tool", category: "custom", default_connection_type: "custom" },
];

export const PRESET_RECOMMENDED_TOOLS: Record<string, string[]> = {
  sviluppo_app: ["Lovable", "GitHub", "Supabase", "Codex", "Antigravity", "Playwright / Browser Use", "n8n"],
  ai_automation: ["n8n", "Playwright / Browser Use", "Telegram", "Gmail", "Google Calendar", "ChatGPT", "Claude", "Codex"],
  content_creation: ["Runway", "Higgsfield", "Midjourney", "ElevenLabs", "D-ID", "Canva", "Instagram", "TikTok", "YouTube"],
  immobiliare: ["Google Drive", "Twilio / WhatsApp", "Instagram", "Facebook", "Canva"],
  lead_generation: ["Perplexity", "Google Drive", "Gmail", "Telegram", "Twilio / WhatsApp"],
  marketing: ["Canva", "Instagram", "Facebook", "TikTok", "Gmail"],
  roadmap_operativa: ["Lovable", "GitHub", "n8n"],
  custom: [],
};

export type ToolLink = {
  id: string;
  user_id: string;
  brain_id: string;
  tool_name: string;
  tool_category: string;
  connection_type: string | null;
  connection_status: string;
  is_required: boolean;
  is_recommended: boolean;
  url: string | null;
  notes: string | null;
  last_manual_check_at: string | null;
  last_checked_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

const NEW_STATUSES: ToolStatus[] = [
  "connected",
  "missing",
  "needs_setup",
  "inactive",
  "broken",
  "unknown",
];

export function normalizeStatus(s: string | null | undefined): ToolStatus {
  if (!s) return "unknown";
  if ((NEW_STATUSES as string[]).includes(s)) return s as ToolStatus;
  // Map legacy strumenti-progetti statuses (da_collegare, manuale, attivo, ...)
  switch (s) {
    case "attivo":
    case "ok":
      return "connected";
    case "da_collegare":
      return "missing";
    case "manuale":
      return "needs_setup";
    case "rotto":
    case "errore":
      return "broken";
    case "inattivo":
      return "inactive";
    default:
      return "unknown";
  }
}

export async function listToolLinks(brainId: string): Promise<ToolLink[]> {
  const { data, error } = await supabase
    .from("project_tool_links")
    .select("*")
    .eq("brain_id", brainId)
    .order("tool_name");
  if (error) throw error;
  return (data ?? []) as unknown as ToolLink[];
}

async function logEvent(action: LogEventType, notes: string, metadata: Record<string, unknown>) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase.from("clipboard_execution_logs").insert({
    user_id: u.user.id,
    clipboard_item_id: null,
    action,
    notes,
    metadata,
  } as never);
}

export type ToolLinkInput = {
  brain_id: string;
  tool_name: string;
  tool_category: ToolCategory | string;
  connection_type?: ConnectionType | null;
  connection_status?: ToolStatus;
  is_required?: boolean;
  is_recommended?: boolean;
  url?: string | null;
  notes?: string | null;
};

export async function createToolLink(input: ToolLinkInput): Promise<ToolLink> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");
  const { data, error } = await supabase
    .from("project_tool_links")
    .insert({
      user_id: u.user.id,
      brain_id: input.brain_id,
      tool_name: input.tool_name,
      tool_category: input.tool_category,
      connection_type: input.connection_type ?? null,
      connection_status: input.connection_status ?? "missing",
      is_required: input.is_required ?? false,
      is_recommended: input.is_recommended ?? false,
      url: input.url ?? null,
      notes: input.notes ?? null,
    } as never)
    .select()
    .single();
  if (error) throw error;
  const link = data as unknown as ToolLink;
  await logEvent("tool_connection_created", `Tool collegato: ${link.tool_name}`, {
    tool_link_id: link.id,
    tool_name: link.tool_name,
    brain_id: link.brain_id,
    connection_type: link.connection_type,
    connection_status: link.connection_status,
  });
  return link;
}

export async function updateToolLink(
  id: string,
  patch: Partial<ToolLinkInput> & { connection_status?: ToolStatus },
  previous?: ToolLink,
): Promise<ToolLink> {
  const { data, error } = await supabase
    .from("project_tool_links")
    .update(patch as never)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  const next = data as unknown as ToolLink;
  await logEvent("tool_connection_updated", `Tool aggiornato: ${next.tool_name}`, {
    tool_link_id: next.id,
    tool_name: next.tool_name,
  });
  if (previous && patch.connection_status && patch.connection_status !== previous.connection_status) {
    await logEvent(
      "tool_connection_status_changed",
      `Stato tool ${next.tool_name}: ${previous.connection_status} → ${patch.connection_status}`,
      {
        tool_link_id: next.id,
        tool_name: next.tool_name,
        from: previous.connection_status,
        to: patch.connection_status,
      },
    );
  }
  return next;
}

export async function setToolStatus(link: ToolLink, status: ToolStatus): Promise<ToolLink> {
  return updateToolLink(link.id, { connection_status: status }, link);
}

export async function markManualCheck(link: ToolLink): Promise<ToolLink> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("project_tool_links")
    .update({ last_manual_check_at: now, last_checked_at: now } as never)
    .eq("id", link.id)
    .select()
    .single();
  if (error) throw error;
  await logEvent(
    "tool_connection_manual_check_completed",
    `Verifica manuale: ${link.tool_name}`,
    { tool_link_id: link.id, tool_name: link.tool_name },
  );
  return data as unknown as ToolLink;
}

export async function deleteToolLink(link: ToolLink): Promise<void> {
  const { error } = await supabase.from("project_tool_links").delete().eq("id", link.id);
  if (error) throw error;
  await logEvent("tool_connection_updated", `Tool rimosso: ${link.tool_name}`, {
    tool_link_id: link.id,
    tool_name: link.tool_name,
    removed: true,
  });
}

export async function logToolOpened(link: ToolLink) {
  await logEvent("tool_connection_opened", `Tool aperto: ${link.tool_name}`, {
    tool_link_id: link.id,
    tool_name: link.tool_name,
    url: link.url,
  });
}

export async function logRecommendedIgnored(brainId: string, toolName: string) {
  await logEvent(
    "tool_connection_recommended_ignored",
    `Suggerimento ignorato: ${toolName}`,
    { brain_id: brainId, tool_name: toolName },
  );
}

export function recommendedToolsForPreset(preset: string | null | undefined): string[] {
  if (!preset) return [];
  return PRESET_RECOMMENDED_TOOLS[preset] ?? [];
}

export type ToolSummary = {
  total: number;
  connected: number;
  missing: number;
  needs_setup: number;
  broken: number;
  recommended_missing: string[];
  required_missing: string[];
};

export function summarizeTools(
  links: ToolLink[],
  recommended: string[],
): ToolSummary {
  const byName = new Map(links.map((l) => [l.tool_name.toLowerCase(), l]));
  let connected = 0;
  let missing = 0;
  let needs_setup = 0;
  let broken = 0;
  for (const l of links) {
    const s = normalizeStatus(l.connection_status);
    if (s === "connected") connected++;
    else if (s === "missing") missing++;
    else if (s === "needs_setup") needs_setup++;
    else if (s === "broken") broken++;
  }
  const recommended_missing = recommended.filter((name) => {
    const l = byName.get(name.toLowerCase());
    if (!l) return true;
    return normalizeStatus(l.connection_status) !== "connected";
  });
  const required_missing = links
    .filter((l) => l.is_required && normalizeStatus(l.connection_status) !== "connected")
    .map((l) => l.tool_name);
  return {
    total: links.length,
    connected,
    missing,
    needs_setup,
    broken,
    recommended_missing,
    required_missing,
  };
}
