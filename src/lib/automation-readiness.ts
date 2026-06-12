// Automation Readiness Matrix — static configuration.
// Classifies action_types per: automation level, execution method, permissions,
// verification, required tool, and readiness.
// NO real automations are triggered from this file.

import type { ActionType, RiskLevel } from "@/lib/action-queue";

export type AutomationLevel =
  | "manual_only"
  | "assisted"
  | "one_click"
  | "approval_required"
  | "fully_automatable"
  | "external_connector_required"
  | "not_allowed";

export const AUTOMATION_LEVEL_LABEL: Record<AutomationLevel, string> = {
  manual_only: "Solo manuale",
  assisted: "Assistita",
  one_click: "Un click",
  approval_required: "Richiede approvazione",
  fully_automatable: "Automatizzabile",
  external_connector_required: "Richiede connettore esterno",
  not_allowed: "Non automatizzabile",
};

export const AUTOMATION_LEVEL_TONE: Record<AutomationLevel, string> = {
  manual_only: "bg-slate-500/10 text-slate-600 border-slate-500/30",
  assisted: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  one_click: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  approval_required: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  fully_automatable: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  external_connector_required: "bg-violet-500/10 text-violet-600 border-violet-500/30",
  not_allowed: "bg-red-500/10 text-red-600 border-red-500/30",
};

export type ExecutionMethod =
  | "internal_app"
  | "browser_bridge"
  | "external_api"
  | "n8n_workflow"
  | "playwright_browser_use"
  | "telegram_approval"
  | "manual_user_action"
  | "future_integration";

export const EXECUTION_METHOD_LABEL: Record<ExecutionMethod, string> = {
  internal_app: "App interna",
  browser_bridge: "Browser Bridge",
  external_api: "API esterna",
  n8n_workflow: "Workflow n8n",
  playwright_browser_use: "Playwright / Browser Use",
  telegram_approval: "Approvazione Telegram",
  manual_user_action: "Azione manuale utente",
  future_integration: "Integrazione futura",
};

export type PermissionRequired =
  | "none"
  | "user_confirmation"
  | "high_risk_confirmation"
  | "oauth_required"
  | "api_key_required"
  | "file_system_permission"
  | "social_publish_permission"
  | "payment_permission";

export const PERMISSION_LABEL: Record<PermissionRequired, string> = {
  none: "Nessuno",
  user_confirmation: "Conferma utente",
  high_risk_confirmation: "Conferma rischio alto",
  oauth_required: "OAuth",
  api_key_required: "API key",
  file_system_permission: "Permesso filesystem",
  social_publish_permission: "Permesso pubblicazione social",
  payment_permission: "Permesso pagamenti",
};

export type VerificationMethod =
  | "user_manual_check"
  | "receipt_json"
  | "database_status"
  | "execution_log"
  | "browser_result"
  | "webhook_response"
  | "screenshot_check"
  | "external_api_response"
  | "no_verification_available";

export const VERIFICATION_LABEL: Record<VerificationMethod, string> = {
  user_manual_check: "Verifica manuale",
  receipt_json: "Receipt JSON",
  database_status: "Stato database",
  execution_log: "Execution log",
  browser_result: "Risultato browser",
  webhook_response: "Risposta webhook",
  screenshot_check: "Screenshot",
  external_api_response: "Risposta API esterna",
  no_verification_available: "Nessuna verifica disponibile",
};

export type ReadinessActionType = ActionType | (
  | "create_tool_connection"
  | "add_knowledge_source"
  | "verify_knowledge_source"
  | "start_runbook"
  | "continue_runbook"
  | "publish_social_post"
  | "send_telegram_approval"
  | "generate_media_asset"
  | "organize_project_files"
  | "check_github_status"
  | "check_supabase_status"
);

export type ReadinessEntry = {
  action_type: ReadinessActionType;
  label: string;
  description: string;
  risk_level: RiskLevel;
  automation_level_current: AutomationLevel;
  automation_level_future: AutomationLevel;
  execution_method: ExecutionMethod;
  required_tool: string | null;
  permission_required: PermissionRequired;
  verification_method: VerificationMethod;
  is_ready_for_automation: boolean;
  blocking_reason: string | null;
  next_setup_action: string | null;
  cta_route?: string;
  cta_label?: string;
};

export const READINESS_MATRIX: ReadinessEntry[] = [
  {
    action_type: "generate_fix_prompt",
    label: "Genera prompt di correzione",
    description: "Crea un nuovo prompt di fix partendo da un execution log fallito.",
    risk_level: "medium",
    automation_level_current: "assisted",
    automation_level_future: "fully_automatable",
    execution_method: "internal_app",
    required_tool: null,
    permission_required: "user_confirmation",
    verification_method: "execution_log",
    is_ready_for_automation: true,
    blocking_reason: null,
    next_setup_action: "Confermare flusso assistito → un click",
    cta_route: "/action-queue",
    cta_label: "Apri Action Queue",
  },
  {
    action_type: "generate_first_prompt",
    label: "Genera primo prompt",
    description: "Genera il primo prompt operativo per una roadmap item.",
    risk_level: "medium",
    automation_level_current: "assisted",
    automation_level_future: "fully_automatable",
    execution_method: "internal_app",
    required_tool: null,
    permission_required: "user_confirmation",
    verification_method: "execution_log",
    is_ready_for_automation: true,
    blocking_reason: null,
    next_setup_action: "Template prompt per preset progetto",
    cta_route: "/roadmap",
    cta_label: "Apri Roadmap",
  },
  {
    action_type: "send_next_prompt",
    label: "Invia next prompt",
    description: "Invia il prossimo prompt verso lo strumento target (es. Lovable).",
    risk_level: "high",
    automation_level_current: "approval_required",
    automation_level_future: "approval_required",
    execution_method: "browser_bridge",
    required_tool: "Browser Bridge",
    permission_required: "high_risk_confirmation",
    verification_method: "receipt_json",
    is_ready_for_automation: false,
    blocking_reason: "Richiede conferma esplicita per ogni invio.",
    next_setup_action: "Mantenere approvazione manuale; pianificare Browser Bridge maturo.",
    cta_route: "/action-queue",
    cta_label: "Apri coda",
  },
  {
    action_type: "save_lovable_result",
    label: "Salva risultato Lovable",
    description: "Salva il risultato di un'esecuzione Lovable come execution log.",
    risk_level: "medium",
    automation_level_current: "assisted",
    automation_level_future: "one_click",
    execution_method: "internal_app",
    required_tool: null,
    permission_required: "user_confirmation",
    verification_method: "database_status",
    is_ready_for_automation: true,
    blocking_reason: null,
    next_setup_action: "Parsing receipt automatico",
    cta_route: "/clipboard-ai",
    cta_label: "Clipboard AI",
  },
  {
    action_type: "link_log_to_roadmap",
    label: "Collega log a roadmap",
    description: "Collega un execution log a un roadmap item.",
    risk_level: "medium",
    automation_level_current: "one_click",
    automation_level_future: "fully_automatable",
    execution_method: "internal_app",
    required_tool: null,
    permission_required: "user_confirmation",
    verification_method: "database_status",
    is_ready_for_automation: true,
    blocking_reason: null,
    next_setup_action: "Suggerimento automatico via embeddings",
  },
  {
    action_type: "mark_roadmap_completed",
    label: "Segna roadmap completata",
    description: "Marca un roadmap item come completato.",
    risk_level: "high",
    automation_level_current: "approval_required",
    automation_level_future: "approval_required",
    execution_method: "internal_app",
    required_tool: null,
    permission_required: "high_risk_confirmation",
    verification_method: "database_status",
    is_ready_for_automation: false,
    blocking_reason: "Cambia stato strategico del progetto.",
    next_setup_action: "Mantenere conferma utente.",
  },
  {
    action_type: "mark_roadmap_needs_fix",
    label: "Segna roadmap da correggere",
    description: "Marca un roadmap item come da correggere.",
    risk_level: "medium",
    automation_level_current: "one_click",
    automation_level_future: "fully_automatable",
    execution_method: "internal_app",
    required_tool: null,
    permission_required: "user_confirmation",
    verification_method: "database_status",
    is_ready_for_automation: true,
    blocking_reason: null,
    next_setup_action: "Trigger automatico su failed log",
  },
  {
    action_type: "create_roadmap_item",
    label: "Crea roadmap item",
    description: "Crea un nuovo item nella roadmap.",
    risk_level: "medium",
    automation_level_current: "assisted",
    automation_level_future: "one_click",
    execution_method: "internal_app",
    required_tool: null,
    permission_required: "user_confirmation",
    verification_method: "database_status",
    is_ready_for_automation: true,
    blocking_reason: null,
    next_setup_action: "Template per preset progetto",
    cta_route: "/roadmap",
    cta_label: "Apri Roadmap",
  },
  {
    action_type: "review_pending_result",
    label: "Verifica risultato in attesa",
    description: "Apre un risultato in attesa di review umana.",
    risk_level: "low",
    automation_level_current: "one_click",
    automation_level_future: "one_click",
    execution_method: "internal_app",
    required_tool: null,
    permission_required: "none",
    verification_method: "user_manual_check",
    is_ready_for_automation: true,
    blocking_reason: null,
    next_setup_action: null,
  },
  {
    action_type: "clean_orphan_logs",
    label: "Pulisci log scollegati",
    description: "Rimuove o archivia log non collegati a roadmap.",
    risk_level: "medium",
    automation_level_current: "approval_required",
    automation_level_future: "approval_required",
    execution_method: "internal_app",
    required_tool: null,
    permission_required: "high_risk_confirmation",
    verification_method: "database_status",
    is_ready_for_automation: false,
    blocking_reason: "Operazione distruttiva su dati storici.",
    next_setup_action: "Soft-archive prima di delete.",
  },
  {
    action_type: "open_project_console",
    label: "Apri Project Console",
    description: "Apre la console operativa di un progetto.",
    risk_level: "low",
    automation_level_current: "one_click",
    automation_level_future: "one_click",
    execution_method: "internal_app",
    required_tool: null,
    permission_required: "none",
    verification_method: "no_verification_available",
    is_ready_for_automation: true,
    blocking_reason: null,
    next_setup_action: null,
    cta_route: "/project-console",
    cta_label: "Apri Console",
  },
  {
    action_type: "manual_task",
    label: "Task manuale",
    description: "Task manuale generico.",
    risk_level: "low",
    automation_level_current: "manual_only",
    automation_level_future: "manual_only",
    execution_method: "manual_user_action",
    required_tool: null,
    permission_required: "none",
    verification_method: "user_manual_check",
    is_ready_for_automation: false,
    blocking_reason: "Per definizione richiede intervento umano.",
    next_setup_action: null,
  },
  {
    action_type: "create_tool_connection",
    label: "Aggiungi collegamento tool",
    description: "Aggiunge un tool al Tool Connection Center.",
    risk_level: "low",
    automation_level_current: "assisted",
    automation_level_future: "one_click",
    execution_method: "internal_app",
    required_tool: null,
    permission_required: "user_confirmation",
    verification_method: "database_status",
    is_ready_for_automation: true,
    blocking_reason: null,
    next_setup_action: null,
    cta_route: "/tool-connections",
    cta_label: "Tool Connections",
  },
  {
    action_type: "add_knowledge_source",
    label: "Aggiungi knowledge source",
    description: "Aggiunge una fonte alla Knowledge Map.",
    risk_level: "low",
    automation_level_current: "assisted",
    automation_level_future: "one_click",
    execution_method: "internal_app",
    required_tool: null,
    permission_required: "user_confirmation",
    verification_method: "database_status",
    is_ready_for_automation: true,
    blocking_reason: null,
    next_setup_action: null,
    cta_route: "/knowledge-map",
    cta_label: "Knowledge Map",
  },
  {
    action_type: "verify_knowledge_source",
    label: "Verifica knowledge source",
    description: "Verifica manualmente lo stato di una fonte.",
    risk_level: "low",
    automation_level_current: "one_click",
    automation_level_future: "assisted",
    execution_method: "internal_app",
    required_tool: null,
    permission_required: "user_confirmation",
    verification_method: "user_manual_check",
    is_ready_for_automation: true,
    blocking_reason: null,
    next_setup_action: "Check automatico per link URL.",
    cta_route: "/knowledge-map",
    cta_label: "Knowledge Map",
  },
  {
    action_type: "start_runbook",
    label: "Avvia runbook",
    description: "Avvia un runbook operativo.",
    risk_level: "medium",
    automation_level_current: "approval_required",
    automation_level_future: "one_click",
    execution_method: "internal_app",
    required_tool: null,
    permission_required: "user_confirmation",
    verification_method: "database_status",
    is_ready_for_automation: true,
    blocking_reason: null,
    next_setup_action: null,
    cta_route: "/runbooks",
    cta_label: "Runbooks",
  },
  {
    action_type: "continue_runbook",
    label: "Continua runbook",
    description: "Avanza allo step successivo di un runbook attivo.",
    risk_level: "medium",
    automation_level_current: "approval_required",
    automation_level_future: "one_click",
    execution_method: "internal_app",
    required_tool: null,
    permission_required: "user_confirmation",
    verification_method: "database_status",
    is_ready_for_automation: true,
    blocking_reason: null,
    next_setup_action: null,
    cta_route: "/runbooks",
    cta_label: "Runbooks",
  },
  {
    action_type: "publish_social_post",
    label: "Pubblica post social",
    description: "Pubblica un post su social (Instagram / TikTok / Facebook / X).",
    risk_level: "high",
    automation_level_current: "manual_only",
    automation_level_future: "external_connector_required",
    execution_method: "n8n_workflow",
    required_tool: "Instagram / TikTok / Facebook",
    permission_required: "social_publish_permission",
    verification_method: "external_api_response",
    is_ready_for_automation: false,
    blocking_reason: "Richiede API social, approvazione Telegram e workflow n8n.",
    next_setup_action: "Collegare account social + n8n + Telegram approval.",
    cta_route: "/tool-connections",
    cta_label: "Collegare tool",
  },
  {
    action_type: "send_telegram_approval",
    label: "Invia approvazione Telegram",
    description: "Richiede approvazione operativa via Telegram bot.",
    risk_level: "medium",
    automation_level_current: "manual_only",
    automation_level_future: "external_connector_required",
    execution_method: "telegram_approval",
    required_tool: "Telegram Bot",
    permission_required: "api_key_required",
    verification_method: "webhook_response",
    is_ready_for_automation: false,
    blocking_reason: "Manca bot Telegram configurato.",
    next_setup_action: "Creare bot e collegare token.",
    cta_route: "/tool-connections",
    cta_label: "Tool Connections",
  },
  {
    action_type: "generate_media_asset",
    label: "Genera asset media",
    description: "Genera asset video/immagine via Runway o Higgsfield.",
    risk_level: "medium",
    automation_level_current: "manual_only",
    automation_level_future: "external_connector_required",
    execution_method: "external_api",
    required_tool: "Runway / Higgsfield",
    permission_required: "api_key_required",
    verification_method: "external_api_response",
    is_ready_for_automation: false,
    blocking_reason: "API esterna non ancora collegata.",
    next_setup_action: "Collegare account e API key.",
    cta_route: "/tool-connections",
    cta_label: "Tool Connections",
  },
  {
    action_type: "organize_project_files",
    label: "Organizza file di progetto",
    description: "Sposta/organizza cartelle e file locali del progetto.",
    risk_level: "high",
    automation_level_current: "manual_only",
    automation_level_future: "approval_required",
    execution_method: "playwright_browser_use",
    required_tool: "Desktop agent",
    permission_required: "file_system_permission",
    verification_method: "user_manual_check",
    is_ready_for_automation: false,
    blocking_reason: "Richiede accesso al filesystem locale.",
    next_setup_action: "Installare desktop bridge sicuro.",
  },
  {
    action_type: "check_github_status",
    label: "Verifica stato GitHub",
    description: "Verifica lo stato repository, branch e CI.",
    risk_level: "low",
    automation_level_current: "assisted",
    automation_level_future: "fully_automatable",
    execution_method: "external_api",
    required_tool: "GitHub",
    permission_required: "oauth_required",
    verification_method: "external_api_response",
    is_ready_for_automation: false,
    blocking_reason: "Manca OAuth GitHub esposto al backend.",
    next_setup_action: "Collegare GitHub al progetto.",
    cta_route: "/github-sync",
    cta_label: "GitHub Sync",
  },
  {
    action_type: "check_supabase_status",
    label: "Verifica stato Supabase",
    description: "Verifica salute backend, RLS e migrazioni.",
    risk_level: "low",
    automation_level_current: "assisted",
    automation_level_future: "fully_automatable",
    execution_method: "external_api",
    required_tool: "Supabase",
    permission_required: "api_key_required",
    verification_method: "external_api_response",
    is_ready_for_automation: true,
    blocking_reason: null,
    next_setup_action: "Estendere Health Check su nuove tabelle.",
    cta_route: "/health-check",
    cta_label: "Health Check",
  },
];

export const READINESS_BY_TYPE: Record<string, ReadinessEntry> = Object.fromEntries(
  READINESS_MATRIX.map((e) => [e.action_type, e]),
);

export function getReadiness(actionType: string): ReadinessEntry | undefined {
  return READINESS_BY_TYPE[actionType];
}

export type ReadinessSummary = {
  total: number;
  ready_now: number;
  approval_required: number;
  external_connector_required: number;
  not_automatable: number;
  blocked_by_permission: number;
  future_n8n_ready: number;
};

export function summarizeReadiness(entries: ReadinessEntry[] = READINESS_MATRIX): ReadinessSummary {
  let ready_now = 0;
  let approval = 0;
  let connector = 0;
  let not_auto = 0;
  let blocked_perm = 0;
  let future_n8n = 0;
  for (const e of entries) {
    if (e.is_ready_for_automation) ready_now++;
    if (e.automation_level_current === "approval_required") approval++;
    if (e.automation_level_future === "external_connector_required") connector++;
    if (e.automation_level_current === "not_allowed" || e.automation_level_current === "manual_only")
      not_auto++;
    if (
      e.permission_required === "file_system_permission" ||
      e.permission_required === "social_publish_permission" ||
      e.permission_required === "payment_permission" ||
      e.permission_required === "oauth_required" ||
      e.permission_required === "api_key_required"
    )
      blocked_perm++;
    if (e.execution_method === "n8n_workflow") future_n8n++;
  }
  return {
    total: entries.length,
    ready_now,
    approval_required: approval,
    external_connector_required: connector,
    not_automatable: not_auto,
    blocked_by_permission: blocked_perm,
    future_n8n_ready: future_n8n,
  };
}

export const FUTURE_INTEGRATIONS: { tool: string; reason: string }[] = [
  { tool: "n8n", reason: "Orchestrazione workflow esterni" },
  { tool: "Telegram", reason: "Approvazioni operative" },
  { tool: "Gmail", reason: "Email outbound" },
  { tool: "Google Calendar", reason: "Pianificazione eventi" },
  { tool: "Instagram", reason: "Pubblicazione social" },
  { tool: "TikTok", reason: "Pubblicazione video" },
  { tool: "YouTube", reason: "Upload video" },
  { tool: "Runway", reason: "Generazione media AI" },
  { tool: "Higgsfield", reason: "Generazione video AI" },
  { tool: "GitHub", reason: "Stato repository e CI" },
  { tool: "Supabase", reason: "Health checks avanzati" },
  { tool: "Google Drive", reason: "Gestione documenti" },
  { tool: "Filesystem desktop", reason: "Organizzazione file locali" },
];
