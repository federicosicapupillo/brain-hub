import { supabase } from "@/integrations/supabase/client";

export type CompanyOsProfile = {
  id: string;
  user_id: string;
  brain_id: string;
  company_name: string;
  industry: string | null;
  company_size: string | null;
  operating_model: string | null;
  main_goal: string | null;
  pain_points: string[];
  active_departments: string[];
  preferred_modules: string[];
  preset: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type Department =
  | "direzione"
  | "commerciale"
  | "marketing"
  | "hr"
  | "operations"
  | "amministrazione"
  | "progetti"
  | "customer_care"
  | "content_social"
  | "ai_automation"
  | "documenti_knowledge";

export const DEPARTMENTS: { id: Department; label: string }[] = [
  { id: "direzione", label: "Direzione" },
  { id: "commerciale", label: "Commerciale" },
  { id: "marketing", label: "Marketing" },
  { id: "hr", label: "HR" },
  { id: "operations", label: "Operations" },
  { id: "amministrazione", label: "Amministrazione" },
  { id: "progetti", label: "Progetti" },
  { id: "customer_care", label: "Customer Care" },
  { id: "content_social", label: "Content / Social" },
  { id: "ai_automation", label: "AI Automation" },
  { id: "documenti_knowledge", label: "Documenti / Knowledge" },
];

export type PainPoint =
  | "info_sparse"
  | "attivita_non_tracciate"
  | "mancanza_priorita"
  | "follow_up_dimenticati"
  | "documenti_disorganizzati"
  | "automazioni_non_controllate"
  | "strumenti_scollegati"
  | "no_dashboard_unica"
  | "monitoraggio_progetti"
  | "difficolta_delegare";

export const PAIN_POINTS: { id: PainPoint; label: string }[] = [
  { id: "info_sparse", label: "Troppe informazioni sparse" },
  { id: "attivita_non_tracciate", label: "Troppe attività non tracciate" },
  { id: "mancanza_priorita", label: "Mancanza di priorità" },
  { id: "follow_up_dimenticati", label: "Follow-up dimenticati" },
  { id: "documenti_disorganizzati", label: "Documenti disorganizzati" },
  { id: "automazioni_non_controllate", label: "Automazioni non controllate" },
  { id: "strumenti_scollegati", label: "Strumenti scollegati" },
  { id: "no_dashboard_unica", label: "Mancanza di dashboard unica" },
  { id: "monitoraggio_progetti", label: "Difficoltà nel monitorare progetti" },
  { id: "difficolta_delegare", label: "Difficoltà nel delegare" },
];

export type BrainModule =
  | "operating_dashboard"
  | "project_console"
  | "action_queue"
  | "knowledge_map"
  | "tool_connections"
  | "runbooks"
  | "result_review"
  | "learning_loop"
  | "loop_qa"
  | "automation_readiness"
  | "n8n_registry"
  | "telegram_approvals";

export const MODULES: { id: BrainModule; label: string; to: string }[] = [
  { id: "operating_dashboard", label: "Operating Dashboard", to: "/operating-dashboard" },
  { id: "project_console", label: "Project Console", to: "/project-console" },
  { id: "action_queue", label: "Action Queue", to: "/action-queue" },
  { id: "knowledge_map", label: "Knowledge Map", to: "/knowledge-map" },
  { id: "tool_connections", label: "Tool Connections", to: "/tool-connections" },
  { id: "runbooks", label: "Runbooks", to: "/runbooks" },
  { id: "result_review", label: "Result Review", to: "/result-review" },
  { id: "learning_loop", label: "Learning Loop", to: "/result-review" },
  { id: "loop_qa", label: "Loop QA", to: "/loop-qa" },
  { id: "automation_readiness", label: "Automation Readiness", to: "/automation-readiness" },
  { id: "n8n_registry", label: "n8n Workflows", to: "/n8n-workflows" },
  { id: "telegram_approvals", label: "Telegram Approvals", to: "/telegram-approvals" },
];

export type ToolRecommendation = {
  id: string;
  label: string;
  category: "comunicazione" | "produttivita" | "social" | "crm" | "dev" | "ai";
  status: "consigliato" | "opzionale";
};

export const TOOLS: ToolRecommendation[] = [
  { id: "gmail", label: "Gmail", category: "comunicazione", status: "consigliato" },
  { id: "google_calendar", label: "Google Calendar", category: "produttivita", status: "consigliato" },
  { id: "google_drive", label: "Google Drive", category: "produttivita", status: "consigliato" },
  { id: "telegram", label: "Telegram", category: "comunicazione", status: "consigliato" },
  { id: "slack", label: "Slack", category: "comunicazione", status: "opzionale" },
  { id: "notion", label: "Notion", category: "produttivita", status: "opzionale" },
  { id: "trello", label: "Trello", category: "produttivita", status: "opzionale" },
  { id: "asana", label: "Asana", category: "produttivita", status: "opzionale" },
  { id: "hubspot", label: "HubSpot / CRM", category: "crm", status: "opzionale" },
  { id: "instagram", label: "Instagram", category: "social", status: "opzionale" },
  { id: "facebook", label: "Facebook", category: "social", status: "opzionale" },
  { id: "linkedin", label: "LinkedIn", category: "social", status: "opzionale" },
  { id: "tiktok", label: "TikTok", category: "social", status: "opzionale" },
  { id: "youtube", label: "YouTube", category: "social", status: "opzionale" },
  { id: "n8n", label: "n8n", category: "ai", status: "consigliato" },
  { id: "lovable", label: "Lovable", category: "dev", status: "consigliato" },
  { id: "github", label: "GitHub", category: "dev", status: "opzionale" },
  { id: "codex", label: "Codex", category: "ai", status: "opzionale" },
];

export type CompanyPreset = {
  id: string;
  label: string;
  departments: Department[];
  modules: BrainModule[];
  painPoints: PainPoint[];
  recommendedTools: string[];
  recommendedRunbooks: string[];
};

export const PRESETS: CompanyPreset[] = [
  {
    id: "azienda_commerciale",
    label: "Azienda Commerciale",
    departments: ["direzione", "commerciale", "amministrazione", "operations"],
    modules: ["operating_dashboard", "project_console", "action_queue", "knowledge_map", "tool_connections", "runbooks"],
    painPoints: ["follow_up_dimenticati", "mancanza_priorita", "no_dashboard_unica"],
    recommendedTools: ["gmail", "google_calendar", "hubspot", "telegram"],
    recommendedRunbooks: ["Follow-up clienti", "Analisi offerte aperte", "Pipeline lead"],
  },
  {
    id: "agenzia_marketing",
    label: "Agenzia Marketing",
    departments: ["direzione", "marketing", "content_social", "commerciale"],
    modules: ["operating_dashboard", "project_console", "knowledge_map", "tool_connections", "runbooks", "result_review"],
    painPoints: ["info_sparse", "monitoraggio_progetti", "follow_up_dimenticati"],
    recommendedTools: ["instagram", "facebook", "linkedin", "google_drive", "notion"],
    recommendedRunbooks: ["Calendario contenuti", "Campagna marketing", "Analisi landing page"],
  },
  {
    id: "immobiliare",
    label: "Immobiliare",
    departments: ["direzione", "commerciale", "customer_care"],
    modules: ["operating_dashboard", "project_console", "knowledge_map", "tool_connections"],
    painPoints: ["follow_up_dimenticati", "documenti_disorganizzati"],
    recommendedTools: ["gmail", "google_drive", "telegram", "hubspot"],
    recommendedRunbooks: ["Gestione lead immobile", "Onboarding cliente"],
  },
  {
    id: "ristorazione",
    label: "Ristorazione / Food",
    departments: ["direzione", "operations", "marketing", "hr"],
    modules: ["operating_dashboard", "runbooks", "knowledge_map", "tool_connections"],
    painPoints: ["attivita_non_tracciate", "documenti_disorganizzati"],
    recommendedTools: ["instagram", "facebook", "google_calendar"],
    recommendedRunbooks: ["Checklist apertura", "Checklist chiusura", "Onboarding staff"],
  },
  {
    id: "studio_professionale",
    label: "Studio Professionale",
    departments: ["direzione", "amministrazione", "progetti", "documenti_knowledge"],
    modules: ["operating_dashboard", "project_console", "knowledge_map", "tool_connections", "runbooks"],
    painPoints: ["documenti_disorganizzati", "follow_up_dimenticati", "monitoraggio_progetti"],
    recommendedTools: ["gmail", "google_drive", "google_calendar"],
    recommendedRunbooks: ["Gestione pratica", "Scadenziario"],
  },
  {
    id: "startup_ai",
    label: "Startup AI",
    departments: ["direzione", "progetti", "ai_automation", "marketing"],
    modules: ["operating_dashboard", "project_console", "action_queue", "automation_readiness", "n8n_registry", "telegram_approvals", "loop_qa", "result_review"],
    painPoints: ["automazioni_non_controllate", "info_sparse", "no_dashboard_unica"],
    recommendedTools: ["lovable", "n8n", "github", "telegram", "notion"],
    recommendedRunbooks: ["Deploy automatico", "Validazione AI output"],
  },
  {
    id: "team_content",
    label: "Team Content",
    departments: ["marketing", "content_social", "documenti_knowledge"],
    modules: ["project_console", "knowledge_map", "tool_connections", "result_review"],
    painPoints: ["info_sparse", "attivita_non_tracciate"],
    recommendedTools: ["instagram", "tiktok", "youtube", "google_drive", "notion"],
    recommendedRunbooks: ["Pipeline contenuti", "Brief creator"],
  },
  {
    id: "operations_interne",
    label: "Operations interne",
    departments: ["direzione", "operations", "hr", "amministrazione"],
    modules: ["operating_dashboard", "runbooks", "knowledge_map", "action_queue"],
    painPoints: ["attivita_non_tracciate", "difficolta_delegare", "documenti_disorganizzati"],
    recommendedTools: ["google_drive", "slack", "asana", "trello"],
    recommendedRunbooks: ["Checklist processi", "Onboarding staff", "Colli di bottiglia"],
  },
  {
    id: "custom",
    label: "Custom",
    departments: [],
    modules: ["operating_dashboard", "project_console", "action_queue", "knowledge_map"],
    painPoints: [],
    recommendedTools: [],
    recommendedRunbooks: [],
  },
];

export type RecommendedAction = {
  title: string;
  description: string;
  department: Department;
  risk_level: "low" | "medium";
};

const DEPARTMENT_ACTIONS: Record<Department, RecommendedAction[]> = {
  direzione: [
    { title: "Imposta dashboard direzionale", description: "Configura Operating Dashboard con KPI principali.", department: "direzione", risk_level: "low" },
  ],
  commerciale: [
    { title: "Crea pipeline lead", description: "Definisci stati lead e responsabili.", department: "commerciale", risk_level: "low" },
    { title: "Collega CRM", description: "Aggiungi CRM ai Tool Connections.", department: "commerciale", risk_level: "low" },
    { title: "Crea runbook follow-up clienti", description: "Procedura ricorrente di follow-up.", department: "commerciale", risk_level: "low" },
    { title: "Analizza offerte aperte", description: "Action per revisione offerte pending.", department: "commerciale", risk_level: "medium" },
  ],
  marketing: [
    { title: "Crea calendario contenuti", description: "Pianificazione editoriale mensile.", department: "marketing", risk_level: "low" },
    { title: "Collega canali social", description: "Aggiungi Instagram/Facebook/LinkedIn ai tool.", department: "marketing", risk_level: "low" },
    { title: "Crea runbook campagna marketing", description: "Procedura di lancio campagne.", department: "marketing", risk_level: "low" },
    { title: "Analisi landing page", description: "Action per review conversioni.", department: "marketing", risk_level: "medium" },
  ],
  hr: [
    { title: "Crea processo onboarding", description: "Definisci step di onboarding.", department: "hr", risk_level: "low" },
    { title: "Carica documenti procedure", description: "Aggiungi documenti HR alla Knowledge Map.", department: "hr", risk_level: "low" },
    { title: "Crea runbook selezione candidati", description: "Procedura ricorrente di hiring.", department: "hr", risk_level: "low" },
  ],
  operations: [
    { title: "Mappa processi ricorrenti", description: "Identifica processi da standardizzare.", department: "operations", risk_level: "low" },
    { title: "Crea checklist qualità", description: "Checklist operative ricorrenti.", department: "operations", risk_level: "low" },
    { title: "Action per colli di bottiglia", description: "Revisione blocchi operativi.", department: "operations", risk_level: "medium" },
  ],
  amministrazione: [
    { title: "Crea scadenziario", description: "Promemoria scadenze amministrative.", department: "amministrazione", risk_level: "low" },
  ],
  progetti: [
    { title: "Configura Project Console", description: "Imposta blocchi consigliati per ogni progetto.", department: "progetti", risk_level: "low" },
  ],
  customer_care: [
    { title: "Crea runbook gestione ticket", description: "Procedura di risposta ticket.", department: "customer_care", risk_level: "low" },
  ],
  content_social: [
    { title: "Crea pipeline contenuti", description: "Workflow da idea a pubblicazione.", department: "content_social", risk_level: "low" },
  ],
  ai_automation: [
    { title: "Crea inventario automazioni", description: "Censimento workflow AI/n8n.", department: "ai_automation", risk_level: "low" },
    { title: "Configura Telegram Approvals", description: "Approvazioni high-risk via Telegram.", department: "ai_automation", risk_level: "low" },
  ],
  documenti_knowledge: [
    { title: "Carica procedure", description: "Aggiungi documenti operativi alla Knowledge Map.", department: "documenti_knowledge", risk_level: "low" },
    { title: "Collega Google Drive", description: "Tool di archiviazione documentale.", department: "documenti_knowledge", risk_level: "low" },
    { title: "Crea struttura knowledge base", description: "Tassonomia base per la knowledge.", department: "documenti_knowledge", risk_level: "low" },
  ],
};

export function getRecommendedActions(departments: Department[]): RecommendedAction[] {
  const out: RecommendedAction[] = [];
  for (const d of departments) {
    out.push(...(DEPARTMENT_ACTIONS[d] ?? []));
  }
  return out;
}

export function recommendModules(
  departments: Department[],
  pain: PainPoint[],
): BrainModule[] {
  const set = new Set<BrainModule>(["operating_dashboard", "project_console", "knowledge_map", "tool_connections"]);
  if (departments.includes("ai_automation")) {
    set.add("action_queue");
    set.add("automation_readiness");
    set.add("n8n_registry");
    set.add("telegram_approvals");
    set.add("loop_qa");
    set.add("result_review");
    set.add("learning_loop");
  }
  if (departments.includes("operations") || departments.includes("hr") || departments.includes("customer_care")) {
    set.add("runbooks");
  }
  if (departments.includes("progetti")) {
    set.add("action_queue");
  }
  if (pain.includes("automazioni_non_controllate")) {
    set.add("loop_qa");
    set.add("telegram_approvals");
  }
  if (pain.includes("attivita_non_tracciate") || pain.includes("mancanza_priorita")) {
    set.add("action_queue");
  }
  return Array.from(set);
}

export async function getCompanyProfile(brainId: string): Promise<CompanyOsProfile | null> {
  const { data, error } = await supabase
    .from("company_os_profiles")
    .select("*")
    .eq("brain_id", brainId)
    .maybeSingle();
  if (error) return null;
  return (data as CompanyOsProfile | null) ?? null;
}

export async function listCompanyProfiles(): Promise<CompanyOsProfile[]> {
  const { data, error } = await supabase
    .from("company_os_profiles")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) return [];
  return (data as CompanyOsProfile[] | null) ?? [];
}

export type CompanyProfileInput = {
  brain_id: string;
  company_name: string;
  industry?: string | null;
  company_size?: string | null;
  operating_model?: string | null;
  main_goal?: string | null;
  pain_points: string[];
  active_departments: string[];
  preferred_modules: string[];
  preset?: string | null;
  metadata?: Record<string, unknown>;
};

export async function upsertCompanyProfile(input: CompanyProfileInput): Promise<CompanyOsProfile | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const row = {
    user_id: u.user.id,
    brain_id: input.brain_id,
    company_name: input.company_name,
    industry: input.industry ?? null,
    company_size: input.company_size ?? null,
    operating_model: input.operating_model ?? null,
    main_goal: input.main_goal ?? null,
    pain_points: input.pain_points,
    active_departments: input.active_departments,
    preferred_modules: input.preferred_modules,
    preset: input.preset ?? null,
    metadata: input.metadata ?? {},
  };
  const { data, error } = await supabase
    .from("company_os_profiles")
    .upsert(row as never, { onConflict: "user_id,brain_id" })
    .select("*")
    .maybeSingle();
  if (error) return null;
  return (data as CompanyOsProfile | null) ?? null;
}

export async function createRecommendedActionsForProfile(
  profile: CompanyOsProfile,
): Promise<number> {
  const recs = getRecommendedActions(profile.active_departments as Department[]);
  if (recs.length === 0) return 0;
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return 0;
  const rows = recs.map((r) => ({
    user_id: u.user!.id,
    brain_id: profile.brain_id,
    title: r.title,
    description: r.description,
    action_type: "company_os_setup",
    source: "company_os",
    status: "suggested",
    priority: "normal",
    risk_level: r.risk_level,
    requires_confirmation: true,
    metadata: {
      company_os_profile_id: profile.id,
      department: r.department,
      reason: `Suggerito da Company OS per reparto ${r.department}`,
    } as Record<string, unknown>,
  }));
  const { error } = await supabase.from("automation_actions").insert(rows as never);
  if (error) return 0;
  return rows.length;
}

export type CompanyOsEvent =
  | "company_os_viewed"
  | "company_os_profile_created"
  | "company_os_profile_updated"
  | "company_os_recommended_actions_created"
  | "company_os_tool_recommendation_opened"
  | "company_os_dashboard_opened";

export async function logCompanyOsEvent(
  action: CompanyOsEvent,
  notes: string,
  metadata: Record<string, unknown> = {},
) {
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
