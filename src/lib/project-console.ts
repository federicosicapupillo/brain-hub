import { supabase } from "@/integrations/supabase/client";

export type BlockId =
  | "roadmap"
  | "tasks"
  | "execution_tracking"
  | "browser_bridge"
  | "next_prompt_generator"
  | "roadmap_intelligence"
  | "problemi_da_risolvere"
  | "prossimo_step_consigliato"
  | "file_documenti"
  | "note_progetto"
  | "tool_collegati"
  | "lead_contatti"
  | "annunci_immobili"
  | "opportunita"
  | "kpi"
  | "log_attivita"
  | "build_status"
  | "checklist_operative";

export const ALL_BLOCKS: { id: BlockId; label: string; hint: string }[] = [
  { id: "roadmap", label: "Roadmap", hint: "Tappe e milestone" },
  { id: "tasks", label: "Tasks", hint: "Attività operative" },
  { id: "execution_tracking", label: "Execution Tracking", hint: "Storico prompt Lovable" },
  { id: "browser_bridge", label: "Browser Bridge", hint: "Lovable Browser Bridge" },
  { id: "next_prompt_generator", label: "Next Prompt Generator", hint: "Prossimo prompt da risultato" },
  { id: "roadmap_intelligence", label: "Roadmap Intelligence", hint: "Suggerimenti sullo stato roadmap" },
  { id: "problemi_da_risolvere", label: "Problemi da risolvere", hint: "Errori, blocchi, fallimenti" },
  { id: "prossimo_step_consigliato", label: "Prossimo step consigliato", hint: "Una sola azione consigliata" },
  { id: "file_documenti", label: "File / documenti", hint: "Fonti collegate al progetto" },
  { id: "note_progetto", label: "Note progetto", hint: "Appunti liberi" },
  { id: "tool_collegati", label: "Tool collegati", hint: "Integrazioni e strumenti" },
  { id: "lead_contatti", label: "Lead / contatti", hint: "Pipeline contatti" },
  { id: "annunci_immobili", label: "Annunci / immobili", hint: "Immobiliare" },
  { id: "opportunita", label: "Opportunità", hint: "Capannoni, deal, target" },
  { id: "kpi", label: "KPI", hint: "Metriche chiave" },
  { id: "log_attivita", label: "Log attività", hint: "Storico azioni" },
  { id: "build_status", label: "Errori / build status", hint: "Stato build Lovable" },
  { id: "checklist_operative", label: "Checklist operative", hint: "To-do strutturate" },
];

export const PRIORITIES = [
  "sviluppo_app",
  "marketing",
  "vendite",
  "immobiliare",
  "lead_generation",
  "automazione",
  "contenuti_social",
  "bug_fix",
  "documentazione",
  "generico",
] as const;
export type ProjectPriority = (typeof PRIORITIES)[number];

export const PRESETS: Record<string, { label: string; blocks: BlockId[]; priority: ProjectPriority }> = {
  custom: { label: "Custom", blocks: [], priority: "generico" },
  sviluppo_app: {
    label: "Sviluppo App",
    priority: "sviluppo_app",
    blocks: [
      "roadmap",
      "tasks",
      "execution_tracking",
      "browser_bridge",
      "next_prompt_generator",
      "problemi_da_risolvere",
      "build_status",
      "file_documenti",
    ],
  },
  immobiliare: {
    label: "Immobiliare",
    priority: "immobiliare",
    blocks: [
      "annunci_immobili",
      "lead_contatti",
      "checklist_operative",
      "file_documenti",
      "kpi",
      "note_progetto",
    ],
  },
  marketing: {
    label: "Marketing / Comunicazione",
    priority: "marketing",
    blocks: ["kpi", "checklist_operative", "file_documenti", "note_progetto", "log_attivita"],
  },
  lead_generation: {
    label: "Lead Generation",
    priority: "lead_generation",
    blocks: ["lead_contatti", "kpi", "checklist_operative", "prossimo_step_consigliato", "log_attivita"],
  },
  ai_automation: {
    label: "AI Automation",
    priority: "automazione",
    blocks: [
      "execution_tracking",
      "browser_bridge",
      "next_prompt_generator",
      "roadmap_intelligence",
      "log_attivita",
      "build_status",
    ],
  },
  content_creation: {
    label: "Content Creation",
    priority: "contenuti_social",
    blocks: ["file_documenti", "checklist_operative", "note_progetto", "kpi"],
  },
  roadmap_operativa: {
    label: "Roadmap Operativa",
    priority: "generico",
    blocks: ["roadmap", "tasks", "prossimo_step_consigliato", "roadmap_intelligence", "problemi_da_risolvere"],
  },
};

export type ConsoleConfig = {
  id: string;
  user_id: string;
  brain_id: string | null;
  project_id: string | null;
  console_name: string;
  preset: string;
  project_priority: string;
  visible_blocks: BlockId[];
  block_order: BlockId[];
  block_settings: Record<string, unknown>;
  metadata: Record<string, unknown>;
  updated_at: string;
};

function rowToConfig(r: any): ConsoleConfig {
  return {
    id: r.id,
    user_id: r.user_id,
    brain_id: r.brain_id,
    project_id: r.project_id,
    console_name: r.console_name,
    preset: r.preset,
    project_priority: r.project_priority,
    visible_blocks: Array.isArray(r.visible_blocks) ? (r.visible_blocks as BlockId[]) : [],
    block_order: Array.isArray(r.block_order) ? (r.block_order as BlockId[]) : [],
    block_settings: (r.block_settings ?? {}) as Record<string, unknown>,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    updated_at: r.updated_at,
  };
}

export async function loadConfigForBrain(brainId: string): Promise<ConsoleConfig | null> {
  const { data, error } = await supabase
    .from("project_console_configs")
    .select("*")
    .eq("brain_id", brainId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToConfig(data) : null;
}

export async function listConfigs(): Promise<ConsoleConfig[]> {
  const { data, error } = await supabase
    .from("project_console_configs")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToConfig);
}

export async function upsertConfig(input: {
  brain_id: string | null;
  console_name: string;
  preset: string;
  project_priority: string;
  visible_blocks: BlockId[];
  block_order: BlockId[];
}): Promise<ConsoleConfig> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");

  // If brain_id present, upsert by (user_id, brain_id). Otherwise insert.
  if (input.brain_id) {
    const existing = await loadConfigForBrain(input.brain_id);
    if (existing) {
      const { data, error } = await supabase
        .from("project_console_configs")
        .update({
          console_name: input.console_name,
          preset: input.preset,
          project_priority: input.project_priority,
          visible_blocks: input.visible_blocks,
          block_order: input.block_order,
        })
        .eq("id", existing.id)
        .select()
        .single();
      if (error) throw error;
      return rowToConfig(data);
    }
  }
  const { data, error } = await supabase
    .from("project_console_configs")
    .insert({
      user_id: u.user.id,
      brain_id: input.brain_id,
      console_name: input.console_name,
      preset: input.preset,
      project_priority: input.project_priority,
      visible_blocks: input.visible_blocks,
      block_order: input.block_order,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToConfig(data);
}

export function defaultConfig(brainId: string | null): ConsoleConfig {
  const preset = PRESETS.sviluppo_app;
  return {
    id: "",
    user_id: "",
    brain_id: brainId,
    project_id: null,
    console_name: "Console",
    preset: "sviluppo_app",
    project_priority: preset.priority,
    visible_blocks: preset.blocks,
    block_order: preset.blocks,
    block_settings: {},
    metadata: {},
    updated_at: new Date().toISOString(),
  };
}
