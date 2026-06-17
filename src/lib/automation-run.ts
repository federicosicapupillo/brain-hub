import { supabase } from "@/integrations/supabase/client";

export type RunStatus =
  | "draft"
  | "approved"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export type ExecutionMode =
  | "manual_copy"
  | "semi_automatic"
  | "n8n_webhook"
  | "playwright_browser"
  | "external_agent";

export type AutomationRun = {
  run_id: string;
  run_status: RunStatus;
  target: string;
  execution_mode: ExecutionMode;
  approved_by_user: boolean;
  approved_at: string | null;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  cancelled_at: string | null;
  blocked_at: string | null;
  last_error: string | null;
  retry_count: number;
  execution_notes: string;
  external_result_reference: string | null;
  payload_version: number;
  updated_at: string;
};

export type ItemLike = {
  id: string;
  brain_id: string | null;
  title: string;
  content?: string | null;
  content_type?: string | null;
  target_tool?: string | null;
  risk_level?: string | null;
  automation_status?: string | null;
  project_id?: string | null;
  success_criteria?: string | null;
  expected_output?: string | null;
  execution_instructions?: string | null;
  metadata: Record<string, unknown> | null;
};

const ACTIVE_RUN_STATUSES: RunStatus[] = ["approved", "queued", "running"];

export const DEFAULT_SUCCESS_CRITERIA =
  "Build pulita, nessun errore TypeScript, nessun errore console, funzionalità richiesta completata senza modificare aree protette.";
export const DEFAULT_EXPECTED_OUTPUT =
  "Riepilogo modifiche effettuate, file modificati, stato build, eventuali errori console e note operative.";
export const DEFAULT_PROTECTED_AREAS =
  "Non modificare auth, login, signup, sessioni, RLS, policy Supabase, route, sidebar, layout globale o componenti condivisi se non esplicitamente richiesto.";
export const DEFAULT_PROJECT_NAME = "Progetto non specificato";

/** Extract a section by uppercase-ish heading from a prompt text. Best-effort. */
export function extractPromptSection(text: string | null | undefined, headers: string[]): string {
  if (!text || typeof text !== "string") return "";
  for (const h of headers) {
    const esc = h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(?:^|\\n)[\\s*#>\\-]*${esc}[\\s*:#>\\-]*\\n([\\s\\S]*?)(?=\\n[\\s*#>\\-]*[A-ZÀ-Ý][A-ZÀ-Ý0-9 \\/&'\\-]{3,}[\\s*:#>\\-]*\\n|$)`,
      "i",
    );
    const m = text.match(re);
    if (m && m[1]) {
      const v = m[1].trim();
      if (v) return v;
    }
  }
  return "";
}


export function defaultAutomationRun(): AutomationRun {
  return {
    run_id: `run_${Date.now()}`,
    run_status: "draft",
    target: "lovable",
    execution_mode: "manual_copy",
    approved_by_user: false,
    approved_at: null,
    queued_at: null,
    started_at: null,
    completed_at: null,
    failed_at: null,
    cancelled_at: null,
    blocked_at: null,
    last_error: null,
    retry_count: 0,
    execution_notes: "",
    external_result_reference: null,
    payload_version: 1,
    updated_at: new Date().toISOString(),
  };
}

/** Read metadata.automation_run. If missing, return an in-memory draft default (does NOT persist). */
export function getAutomationRun(item: ItemLike): AutomationRun {
  const m = (item.metadata as Record<string, unknown> | null) ?? {};
  const r = m.automation_run as Partial<AutomationRun> | undefined;
  if (!r || typeof r !== "object") return defaultAutomationRun();
  return { ...defaultAutomationRun(), ...r };
}

/** Find a run already active (approved/queued/running). Returns null otherwise. */
export function findActiveRun(item: ItemLike): AutomationRun | null {
  const run = getAutomationRun(item);
  return ACTIVE_RUN_STATUSES.includes(run.run_status) ? run : null;
}

function firstNonEmpty(...vals: Array<string | null | undefined>): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return "";
}

export function buildAutomationPayload(
  item: ItemLike,
  ctx: { project_id?: string | null; brain_name?: string | null; project_name?: string | null },
): Record<string, unknown> {
  const m = (item.metadata as Record<string, unknown> | null) ?? {};
  const pkg = (m.execution_package as Record<string, unknown> | undefined) ?? {};
  const run = getAutomationRun(item);
  const prompt = firstNonEmpty(pkg.promptOnly as string | undefined, item.content) || "";

  const checklist = Array.isArray(pkg.checklist)
    ? (pkg.checklist as unknown[]).map(String).filter((s) => s.trim()).join("\n- ")
    : "";

  const success_criteria = firstNonEmpty(
    item.success_criteria,
    pkg.success_criteria as string | undefined,
    pkg.successCriteria as string | undefined,
    checklist ? `- ${checklist}` : "",
    extractPromptSection(prompt, [
      "CRITERI DI SUCCESSO",
      "SUCCESS CRITERIA",
      "CRITERI DI ACCETTAZIONE",
    ]),
  ) || DEFAULT_SUCCESS_CRITERIA;

  const expected_output = firstNonEmpty(
    item.expected_output,
    pkg.expected_output as string | undefined,
    pkg.expectedOutput as string | undefined,
    extractPromptSection(prompt, [
      "OUTPUT ATTESO",
      "EXPECTED OUTPUT",
      "RISULTATO ATTESO",
    ]),
  ) || DEFAULT_EXPECTED_OUTPUT;

  const protected_areas = firstNonEmpty(
    pkg.protected_areas as string | undefined,
    pkg.protectedAreas as string | undefined,
    pkg.protection_rules as string | undefined,
    extractPromptSection(prompt, [
      "REGOLE DI SICUREZZA OBBLIGATORIE",
      "REGOLE DI SICUREZZA",
      "AREE PROTETTE",
      "PROTECTED AREAS",
      "NON MODIFICARE",
    ]),
  ) || DEFAULT_PROTECTED_AREAS;

  const project_name = firstNonEmpty(
    ctx.project_name,
    ctx.brain_name,
  ) || DEFAULT_PROJECT_NAME;

  return {
    execution_package_id: item.id,
    project_id: ctx.project_id ?? item.project_id ?? null,
    brain_id: item.brain_id,
    project_name,
    brain_name: ctx.brain_name ?? null,
    package_type: (pkg.package_type as string | undefined) ?? "standard",
    risk_level: item.risk_level ?? (pkg.riskLevel as string | undefined) ?? null,
    target: run.target,
    execution_mode: run.execution_mode,
    prompt,
    success_criteria,
    expected_output,
    protected_areas,
    callback_required: true,
    callback_expected_fields: [
      "build_status",
      "console_errors",
      "modified_files",
      "summary",
      "notes",
    ],
  };
}


export type LogEventType =
  | "automation_approved"
  | "automation_queued"
  | "automation_started"
  | "automation_completed"
  | "automation_failed"
  | "automation_cancelled"
  | "automation_blocked"
  | "automation_retried"
  | "automation_payload_copied"
  | "automation_callback_received"
  | "automation_dry_run_started"
  | "automation_dry_run_completed"
  | "automation_dry_run_failed"
  | "automation_dry_run_blocked"
  | "automation_dry_run_restored"
  | "n8n_payload_prepared"
  | "n8n_callback_template_generated"
  | "n8n_callback_sent_to_inbox"
  | "n8n_ready_for_real_test"
  | "n8n_callback_received"
  | "lovable_prompt_copied"
  | "lovable_project_opened"
  | "lovable_prompt_sent_manually"
  | "lovable_result_saved"
  | "local_agent_job_prepared"
  | "local_agent_job_copied"
  | "local_agent_job_downloaded"
  | "local_agent_job_started_manually"
  | "local_agent_job_cancelled"
  | "local_agent_job_failed"
  | "local_agent_callback_received"
  | "local_agent_starter_kit_downloaded"
  | "local_agent_starter_kit_copied"
  | "lovable_browser_bridge_prompt_copied"
  | "lovable_browser_bridge_extension_downloaded"
  | "lovable_browser_bridge_prompt_inserted"
  | "lovable_browser_bridge_prompt_sent_confirmed"
  | "lovable_browser_bridge_result_saved"
  | "lovable_browser_bridge_prompt_completed"
  | "lovable_browser_bridge_prompt_failed"
  | "lovable_browser_bridge_prompt_retry_requested"
  | "roadmap_intelligence_status_suggested"
  | "roadmap_intelligence_next_action_suggested"
  | "roadmap_item_execution_log_linked"
  | "roadmap_item_marked_completed"
  | "roadmap_item_marked_needs_fix"
  | "roadmap_intelligence_issue_detected"
  | "roadmap_intelligence_issue_ignored"
  | "project_health_check_completed"
  | "project_health_issue_detected"
  | "project_health_warning_ignored"
  | "project_health_next_action_suggested"
  | "automation_action_created"
  | "automation_action_approved"
  | "automation_action_rejected"
  | "automation_action_ready_to_execute"
  | "automation_action_executed"
  | "automation_action_failed"
  | "automation_action_cancelled"
  | "automation_action_duplicate_prevented"
  | "automation_action_prepared"
  | "automation_action_source_opened"
  | "automation_action_linked_object_opened"
  | "runbook_template_selected"
  | "runbook_instance_created"
  | "runbook_instance_started"
  | "runbook_step_action_created"
  | "runbook_step_completed"
  | "runbook_instance_completed"
  | "runbook_instance_blocked"
  | "runbook_instance_cancelled"
  | "runbook_instance_failed"
  | "tool_connection_created"
  | "tool_connection_updated"
  | "tool_connection_status_changed"
  | "tool_connection_opened"
  | "tool_connection_manual_check_completed"
  | "tool_connection_recommended_ignored"
  | "knowledge_source_created"
  | "knowledge_source_updated"
  | "knowledge_source_status_changed"
  | "knowledge_source_opened"
  | "knowledge_source_linked_to_tool"
  | "knowledge_source_linked_to_roadmap"
  | "knowledge_source_archived"
  | "knowledge_source_missing_recommended"
  | "n8n_workflow_registered"
  | "n8n_workflow_updated"
  | "n8n_workflow_status_changed"
  | "n8n_workflow_linked_to_action_type"
  | "n8n_workflow_manual_test_marked"
  | "n8n_workflow_opened"
  | "n8n_execution_payload_prepared"
  | "n8n_execution_dry_run_started"
  | "n8n_execution_dry_run_completed"
  | "n8n_execution_started"
  | "n8n_execution_completed"
  | "n8n_execution_failed"
  | "n8n_execution_receipt_saved"
  | "telegram_approval_request_created"
  | "telegram_approval_request_ready"
  | "telegram_approval_request_sent"
  | "telegram_approval_request_approved"
  | "telegram_approval_request_rejected"
  | "telegram_approval_request_cancelled"
  | "telegram_approval_request_failed"
  | "telegram_connection_created"
  | "telegram_connection_updated"
  | "telegram_connection_disabled"
  | "telegram_approval_send_started"
  | "telegram_approval_sent"
  | "telegram_approval_send_failed"
  | "telegram_approval_resend_requested"
  | "telegram_delivery_stale_detected"
  | "telegram_delivery_unblocked"
  | "telegram_delivery_retry_started"
  | "telegram_delivery_attempt_logged"
  | "telegram_connection_diagnostics_opened"
  | "n8n_real_execution_enabled"
  | "n8n_real_execution_disabled"
  | "n8n_real_execution_started"
  | "n8n_real_execution_succeeded"
  | "n8n_real_execution_failed"
  | "n8n_real_execution_blocked_missing_approval"
  | "n8n_real_execution_review_created"
  | "n8n_real_execution_dashboard_viewed"
  | "n8n_real_execution_warning_opened"
  | "n8n_real_execution_environment_validation_failed"
  | "n8n_real_execution_duplicate_run_confirmed"
  | "n8n_real_execution_recent_log_opened"
  | "n8n_hmac_enabled"
  | "n8n_hmac_disabled"
  | "n8n_hmac_secret_missing"
  | "n8n_hmac_signature_attached"
  | "n8n_hmac_execution_blocked"
  | "google_calendar_oauth_started"
  | "google_calendar_oauth_completed"
  | "google_calendar_oauth_failed"
  | "google_calendar_disconnected"
  | "google_calendar_sync_started"
  | "google_calendar_sync_completed"
  | "google_calendar_sync_failed"
  | "google_calendar_action_created"
  | "calendar_suggestion_generated"
  | "calendar_action_created"
  | "calendar_suggestion_ignored"
  | "calendar_followup_suggested"
  | "calendar_preparation_suggested"
  | "github_repository_added"
  | "github_repository_updated"
  | "github_repository_archived"
  | "code_file_mapped"
  | "code_action_suggested"
  | "code_action_created"
  | "codex_prompt_built"
  | "claude_code_prompt_built"
  | "github_issue_draft_built"
  | "github_operational_review_created"
  | "agent_created"
  | "agent_updated"
  | "agent_archived"
  | "agent_activated"
  | "agent_paused"
  | "agent_permission_updated"
  | "agent_template_created"
  | "agent_safety_warning"
  | "agent_action_created"
  | "agent_center_viewed";





const LOG_TITLES: Record<LogEventType, string> = {
  automation_approved: "Run approvata",
  automation_queued: "Run messa in coda",
  automation_started: "Run in esecuzione",
  automation_completed: "Run completata",
  automation_failed: "Run fallita",
  automation_cancelled: "Run cancellata",
  automation_blocked: "Run bloccata",
  automation_retried: "Run riprovata",
  automation_payload_copied: "Payload automazione copiato",
  automation_callback_received: "Callback ricevuta",
  n8n_payload_prepared: "Payload n8n preparato",
  n8n_callback_template_generated: "Template callback n8n generato",
  n8n_callback_sent_to_inbox: "Callback n8n inviata alla inbox",
  n8n_ready_for_real_test: "Pronto per test n8n reale controllato",
  n8n_callback_received: "Callback n8n webhook reale ricevuta",
  lovable_prompt_copied: "Prompt Lovable copiato negli appunti",
  lovable_project_opened: "Progetto Lovable aperto in nuova tab",
  lovable_prompt_sent_manually: "Prompt Lovable segnato come inviato manualmente",
  lovable_result_saved: "Risultato Lovable salvato",
  automation_dry_run_started: "Dry run avviato",
  automation_dry_run_completed: "Dry run completato",
  automation_dry_run_failed: "Dry run fallito",
  automation_dry_run_blocked: "Dry run bloccato",
  automation_dry_run_restored: "Stato pre dry run ripristinato",
  local_agent_job_prepared: "Job Playwright preparato",
  local_agent_job_copied: "Job JSON copiato",
  local_agent_job_downloaded: "Job JSON scaricato",
  local_agent_job_started_manually: "Job consegnato all'agente locale",
  local_agent_job_cancelled: "Job agente locale annullato",
  local_agent_job_failed: "Job agente locale fallito",
  local_agent_callback_received: "Callback agente locale ricevuta",
  local_agent_starter_kit_downloaded: "Starter kit agente locale scaricato",
  local_agent_starter_kit_copied: "Starter kit agente locale copiato",
  lovable_browser_bridge_prompt_copied: "Prompt copiato per Browser Bridge",
  lovable_browser_bridge_extension_downloaded: "Estensione Browser Bridge scaricata",
  lovable_browser_bridge_prompt_inserted: "Prompt inserito in Lovable via Browser Bridge",
  lovable_browser_bridge_prompt_sent_confirmed: "Prompt inviato a Lovable con conferma (Browser Bridge)",
  lovable_browser_bridge_result_saved: "Risultato Lovable salvato (Browser Bridge)",
  lovable_browser_bridge_prompt_completed: "Prompt Lovable segnato come completato (Browser Bridge)",
  lovable_browser_bridge_prompt_failed: "Prompt Lovable segnato come fallito (Browser Bridge)",
  lovable_browser_bridge_prompt_retry_requested: "Re-invio prompt Lovable richiesto (Browser Bridge)",
  roadmap_intelligence_status_suggested: "Stato roadmap suggerito (Roadmap Intelligence)",
  roadmap_intelligence_next_action_suggested: "Prossima azione roadmap suggerita (Roadmap Intelligence)",
  roadmap_item_execution_log_linked: "Execution log collegato a roadmap item",
  roadmap_item_marked_completed: "Roadmap item segnata come completata",
  roadmap_item_marked_needs_fix: "Roadmap item segnata da correggere",
  roadmap_intelligence_issue_detected: "Problema roadmap rilevato (Roadmap Intelligence)",
  roadmap_intelligence_issue_ignored: "Problema roadmap ignorato (Roadmap Intelligence)",
  project_health_check_completed: "Project Health Check completato",
  project_health_issue_detected: "Problema salute progetto rilevato",
  project_health_warning_ignored: "Warning salute progetto ignorato",
  project_health_next_action_suggested: "Prossima azione salute progetto suggerita",
  automation_action_created: "Azione automazione creata",
  automation_action_approved: "Azione automazione approvata",
  automation_action_rejected: "Azione automazione rifiutata",
  automation_action_ready_to_execute: "Azione automazione pronta da eseguire",
  automation_action_executed: "Azione automazione eseguita",
  automation_action_failed: "Azione automazione fallita",
  automation_action_cancelled: "Azione automazione annullata",
  automation_action_duplicate_prevented: "Duplicato azione prevenuto",
  automation_action_prepared: "Azione automazione preparata",
  automation_action_source_opened: "Sorgente azione aperta",
  automation_action_linked_object_opened: "Oggetto collegato azione aperto",
  runbook_template_selected: "Template runbook selezionato",
  runbook_instance_created: "Runbook creato",
  runbook_instance_started: "Runbook avviato",
  runbook_step_action_created: "Step runbook creato",
  runbook_step_completed: "Step runbook completato",
  runbook_instance_completed: "Runbook completato",
  runbook_instance_blocked: "Runbook bloccato",
  runbook_instance_cancelled: "Runbook annullato",
  runbook_instance_failed: "Runbook fallito",
  tool_connection_created: "Tool collegato",
  tool_connection_updated: "Tool aggiornato",
  tool_connection_status_changed: "Stato tool cambiato",
  tool_connection_opened: "Tool aperto",
  tool_connection_manual_check_completed: "Verifica tool",
  tool_connection_recommended_ignored: "Tool consigliato ignorato",
  knowledge_source_created: "Fonte knowledge creata",
  knowledge_source_updated: "Fonte knowledge aggiornata",
  knowledge_source_status_changed: "Stato fonte knowledge cambiato",
  knowledge_source_opened: "Fonte knowledge aperta",
  knowledge_source_linked_to_tool: "Fonte knowledge collegata a tool",
  knowledge_source_linked_to_roadmap: "Fonte knowledge collegata a roadmap",
  knowledge_source_archived: "Fonte knowledge archiviata",
  knowledge_source_missing_recommended: "Fonte consigliata mancante",
  n8n_workflow_registered: "Workflow n8n registrato",
  n8n_workflow_updated: "Workflow n8n aggiornato",
  n8n_workflow_status_changed: "Stato workflow n8n cambiato",
  n8n_workflow_linked_to_action_type: "Workflow n8n collegato ad action type",
  n8n_workflow_manual_test_marked: "Test manuale workflow n8n",
  n8n_workflow_opened: "Workflow n8n aperto",
  n8n_execution_payload_prepared: "Payload n8n preparato (controllato)",
  n8n_execution_dry_run_started: "Dry run n8n avviato",
  n8n_execution_dry_run_completed: "Dry run n8n completato",
  n8n_execution_started: "Esecuzione n8n avviata",
  n8n_execution_completed: "Esecuzione n8n completata",
  n8n_execution_failed: "Esecuzione n8n fallita",
  n8n_execution_receipt_saved: "Receipt esecuzione n8n salvata",
  telegram_approval_request_created: "Richiesta approvazione Telegram creata",
  telegram_approval_request_ready: "Richiesta Telegram pronta da inviare",
  telegram_approval_request_sent: "Richiesta Telegram inviata",
  telegram_approval_request_approved: "Approvazione Telegram ricevuta",
  telegram_approval_request_rejected: "Rifiuto Telegram ricevuto",
  telegram_approval_request_cancelled: "Richiesta Telegram annullata",
  telegram_approval_request_failed: "Richiesta Telegram fallita",
  telegram_connection_created: "Destinazione Telegram creata",
  telegram_connection_updated: "Destinazione Telegram aggiornata",
  telegram_connection_disabled: "Destinazione Telegram disabilitata",
  telegram_approval_send_started: "Invio Telegram avviato",
  telegram_approval_sent: "Notifica Telegram inviata",
  telegram_approval_send_failed: "Invio Telegram fallito",
  telegram_approval_resend_requested: "Reinvio Telegram richiesto",
  telegram_delivery_stale_detected: "Invio Telegram sospeso rilevato",
  telegram_delivery_unblocked: "Invio Telegram sbloccato",
  telegram_delivery_retry_started: "Retry invio Telegram avviato",
  telegram_delivery_attempt_logged: "Tentativo invio Telegram registrato",
  telegram_connection_diagnostics_opened: "Diagnostica Telegram aperta",
  n8n_real_execution_enabled: "Esecuzione reale n8n abilitata",
  n8n_real_execution_disabled: "Esecuzione reale n8n disabilitata",
  n8n_real_execution_started: "Esecuzione reale n8n avviata",
  n8n_real_execution_succeeded: "Esecuzione reale n8n riuscita",
  n8n_real_execution_failed: "Esecuzione reale n8n fallita",
  n8n_real_execution_blocked_missing_approval: "Esecuzione reale n8n bloccata: manca approvazione Telegram",
  n8n_real_execution_review_created: "Result Review creata da esecuzione reale n8n",
  n8n_real_execution_dashboard_viewed: "Tile esecuzione reale n8n visualizzata",
  n8n_real_execution_warning_opened: "Warning esecuzione reale n8n aperto",
  n8n_real_execution_environment_validation_failed: "Validazione ambiente/URL n8n fallita",
  n8n_real_execution_duplicate_run_confirmed: "Run reale duplicata confermata manualmente",
  n8n_real_execution_recent_log_opened: "Log esecuzione reale n8n aperto",
  n8n_hmac_enabled: "Firma HMAC n8n abilitata",
  n8n_hmac_disabled: "Firma HMAC n8n disabilitata",
  n8n_hmac_secret_missing: "Secret HMAC n8n mancante",
  n8n_hmac_signature_attached: "Firma HMAC n8n allegata alla request",
  n8n_hmac_execution_blocked: "Esecuzione n8n bloccata per secret HMAC mancante",
  google_calendar_oauth_started: "Google Calendar OAuth avviato",
  google_calendar_oauth_completed: "Google Calendar OAuth completato",
  google_calendar_oauth_failed: "Google Calendar OAuth fallito",
  google_calendar_disconnected: "Google Calendar disconnesso",
  google_calendar_sync_started: "Sync Google Calendar avviato",
  google_calendar_sync_completed: "Sync Google Calendar completato",
  google_calendar_sync_failed: "Sync Google Calendar fallito",
  google_calendar_action_created: "Action creata da evento Calendar",
  calendar_suggestion_generated: "Suggerimento calendario generato",
  calendar_action_created: "Action creata da suggerimento Calendar",
  calendar_suggestion_ignored: "Suggerimento calendario ignorato",
  calendar_followup_suggested: "Follow-up calendario suggerito",
  calendar_preparation_suggested: "Preparazione calendario suggerita",
  github_repository_added: "Repository GitHub aggiunto",
  github_repository_updated: "Repository GitHub aggiornato",
  github_repository_archived: "Repository GitHub archiviato",
  code_file_mapped: "File codice mappato",
  code_action_suggested: "Azione codice suggerita",
  code_action_created: "Azione codice creata",
  codex_prompt_built: "Prompt Codex preparato",
  claude_code_prompt_built: "Prompt Claude Code preparato",
  github_issue_draft_built: "Bozza GitHub issue preparata",
  github_operational_review_created: "Result Review creata da GitHub Operational",
  agent_created: "Agente creato",
  agent_updated: "Agente aggiornato",
  agent_archived: "Agente archiviato",
  agent_activated: "Agente attivato",
  agent_paused: "Agente messo in pausa",
  agent_permission_updated: "Permesso agente aggiornato",
  agent_template_created: "Agente creato da template",
  agent_safety_warning: "Warning sicurezza agente",
  agent_action_created: "Azione creata da agente",
  agent_center_viewed: "Agent Center visualizzato",

};



export type PreviousStateSnapshot = {
  run_status: RunStatus;
  output_result: string | null;
  result_meta: Record<string, unknown> | null;
  post_execution_review: Record<string, unknown> | null;
  captured_at: string;
};

export type DryRunMeta = {
  enabled: boolean;
  scenario: string;
  executed_at: string;
  result: "success" | "warning" | "failed" | "blocked";
  notes: string;
  previous_state_snapshot?: PreviousStateSnapshot | null;
};

/** Stable FNV-1a hash for callback dedupe. */
export function computeCallbackHash(parts: {
  execution_package_id: string;
  run_id?: string | null;
  status?: string | null;
  build_status?: string | null;
  summary?: string | null;
  raw_output?: string | null;
}): string {
  const s = [
    parts.execution_package_id,
    parts.run_id ?? "",
    parts.status ?? "",
    parts.build_status ?? "",
    (parts.summary ?? "").trim(),
    (parts.raw_output ?? "").trim(),
  ].join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Merge patch into metadata.automation_run, persist on clipboard_items, write log row. */
export async function updateAutomationRun(
  item: ItemLike,
  patch: Partial<AutomationRun>,
  eventType: LogEventType,
  opts: { notes?: string } = {},
): Promise<AutomationRun> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw new Error("Non autenticato");

  const prevMeta = (item.metadata as Record<string, unknown> | null) ?? {};
  const prevRun = getAutomationRun(item);
  const nextRun: AutomationRun = {
    ...prevRun,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  const newMeta = { ...prevMeta, automation_run: nextRun };

  const { error: upErr } = await supabase
    .from("clipboard_items")
    .update({ metadata: newMeta } as never)
    .eq("id", item.id);
  if (upErr) throw upErr;

  const { error: logErr } = await supabase.from("clipboard_execution_logs").insert({
    user_id: userData.user.id,
    clipboard_item_id: item.id,
    action: eventType,
    previous_status: prevRun.run_status,
    new_status: nextRun.run_status,
    notes: opts.notes ?? LOG_TITLES[eventType],
    metadata: {
      clipboard_item_id: item.id,
      brain_id: item.brain_id,
      run_id: nextRun.run_id,
      from_status: prevRun.run_status,
      to_status: nextRun.run_status,
      execution_mode: nextRun.execution_mode,
      target: nextRun.target,
      risk_level: item.risk_level ?? null,
      retry_count: nextRun.retry_count,
    },
  } as never);
  if (logErr) throw logErr;

  return nextRun;
}

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  draft: "Bozza",
  approved: "Approvata",
  queued: "In coda",
  running: "In esecuzione",
  completed: "Completata",
  failed: "Fallita",
  cancelled: "Cancellata",
  blocked: "Bloccata",
};
