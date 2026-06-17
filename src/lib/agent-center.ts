// Brain Hub v3.3 — Agent Center (Registry & Permissions)
// Agents in questa versione NON eseguono azioni live: producono solo
// suggested action, prompt draft, review draft, checklist, warning, note.

import { supabase } from "@/integrations/supabase/client";
import type { LogEventType } from "@/lib/automation-run";
import {
  createAction,
  type AutomationAction,
  type ActionType,
  type RiskLevel,
} from "@/lib/action-queue";

// ============================================================
// Types
// ============================================================

export type AgentStatus = "draft" | "active" | "paused" | "archived";
export type OperatingMode = "manual" | "suggest_only" | "approval_required" | "supervised";

export type PermissionLevel =
  | "none"
  | "read"
  | "suggest"
  | "prepare"
  | "request_approval"
  | "execute_after_approval";

export const PERMISSION_LEVEL_LABEL: Record<PermissionLevel, string> = {
  none: "Nessuno",
  read: "Lettura",
  suggest: "Suggerimento",
  prepare: "Preparazione",
  request_approval: "Richiede approvazione",
  execute_after_approval: "Esegue dopo approvazione",
};

export const STATUS_LABEL: Record<AgentStatus, string> = {
  draft: "Bozza",
  active: "Attivo",
  paused: "In pausa",
  archived: "Archiviato",
};

export const OPERATING_MODE_LABEL: Record<OperatingMode, string> = {
  manual: "Manuale",
  suggest_only: "Solo suggerimenti",
  approval_required: "Approvazione richiesta",
  supervised: "Supervisionato",
};

export type Agent = {
  id: string;
  user_id: string;
  brain_id: string | null;
  name: string;
  agent_key: string;
  description: string | null;
  role: string;
  status: AgentStatus;
  operating_mode: OperatingMode;
  max_risk_level: RiskLevel;
  requires_approval: boolean;
  can_create_actions: boolean;
  can_execute_tools: boolean;
  can_call_external_apis: boolean;
  can_trigger_n8n: boolean;
  can_send_telegram: boolean;
  can_modify_external_data: boolean;
  allowed_sources: string[];
  allowed_tools: string[];
  output_targets: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AgentPermission = {
  id: string;
  user_id: string;
  brain_id: string | null;
  agent_id: string;
  tool_key: string;
  permission_level: PermissionLevel;
  risk_level: RiskLevel;
  requires_approval: boolean;
  is_enabled: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export const TOOL_KEYS = [
  "calendar",
  "drive_knowledge",
  "github_operational",
  "n8n_workflows",
  "telegram_approvals",
  "action_queue",
  "result_review",
  "learning_loop",
  "company_os",
  "build_engine_router",
] as const;

export type ToolKey = (typeof TOOL_KEYS)[number];

export const TOOL_KEY_LABEL: Record<ToolKey, string> = {
  calendar: "Calendar",
  drive_knowledge: "Drive Knowledge",
  github_operational: "GitHub Operational",
  n8n_workflows: "n8n Workflows",
  telegram_approvals: "Telegram Approvals",
  action_queue: "Action Queue",
  result_review: "Result Review",
  learning_loop: "Learning Loop",
  company_os: "Company OS",
  build_engine_router: "Build Engine Router",
};

// ============================================================
// Logging
// ============================================================

async function logEvent(
  action: LogEventType,
  notes: string,
  metadata: Record<string, unknown>,
): Promise<void> {
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

export async function logAgentCenterEvent(
  action: LogEventType,
  notes: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await logEvent(action, notes, metadata);
}

// ============================================================
// Registry CRUD
// ============================================================

export type CreateAgentInput = {
  brain_id?: string | null;
  name: string;
  agent_key: string;
  description?: string | null;
  role: string;
  status?: AgentStatus;
  operating_mode?: OperatingMode;
  max_risk_level?: RiskLevel;
  requires_approval?: boolean;
  can_create_actions?: boolean;
  can_execute_tools?: boolean;
  can_call_external_apis?: boolean;
  can_trigger_n8n?: boolean;
  can_send_telegram?: boolean;
  can_modify_external_data?: boolean;
  allowed_sources?: string[];
  allowed_tools?: string[];
  output_targets?: string[];
  metadata?: Record<string, unknown>;
};

export async function listAgents(brainId?: string | null): Promise<Agent[]> {
  let q = supabase
    .from("agent_registry" as never)
    .select("*")
    .order("created_at", { ascending: false });
  if (brainId) q = q.eq("brain_id", brainId);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as unknown) as Agent[];
}

export async function getAgent(agentId: string): Promise<Agent> {
  const { data, error } = await supabase
    .from("agent_registry" as never)
    .select("*")
    .eq("id", agentId)
    .single();
  if (error) throw error;
  return (data as unknown) as Agent;
}

export async function createAgent(input: CreateAgentInput): Promise<Agent> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");

  // Safety defaults: nessuna esecuzione live in v3.3
  const payload = {
    user_id: u.user.id,
    brain_id: input.brain_id ?? null,
    name: input.name,
    agent_key: input.agent_key,
    description: input.description ?? null,
    role: input.role,
    status: input.status ?? "draft",
    operating_mode: input.operating_mode ?? "manual",
    max_risk_level: input.max_risk_level ?? "low",
    requires_approval: input.requires_approval ?? true,
    can_create_actions: input.can_create_actions ?? true,
    can_execute_tools: false,
    can_call_external_apis: false,
    can_trigger_n8n: false,
    can_send_telegram: false,
    can_modify_external_data: false,
    allowed_sources: input.allowed_sources ?? [],
    allowed_tools: input.allowed_tools ?? [],
    output_targets: input.output_targets ?? ["action_queue"],
    metadata: input.metadata ?? {},
  };

  const { data, error } = await supabase
    .from("agent_registry" as never)
    .insert(payload as never)
    .select()
    .single();
  if (error) throw error;
  const agent = (data as unknown) as Agent;
  await logEvent("agent_created", `Agente creato: ${agent.name}`, {
    agent_id: agent.id,
    agent_key: agent.agent_key,
    role: agent.role,
  });
  return agent;
}

export async function updateAgent(
  agentId: string,
  patch: Partial<CreateAgentInput> & { status?: AgentStatus },
): Promise<Agent> {
  // Safety override: blocca i flag live anche se passati nel patch
  const safePatch: Record<string, unknown> = { ...patch };
  for (const k of [
    "can_execute_tools",
    "can_call_external_apis",
    "can_trigger_n8n",
    "can_send_telegram",
    "can_modify_external_data",
  ]) {
    if (k in safePatch) safePatch[k] = false;
  }
  const { data, error } = await supabase
    .from("agent_registry" as never)
    .update(safePatch as never)
    .eq("id", agentId)
    .select()
    .single();
  if (error) throw error;
  const agent = (data as unknown) as Agent;
  await logEvent("agent_updated", `Agente aggiornato: ${agent.name}`, {
    agent_id: agent.id,
  });
  if (patch.status === "active") {
    await logEvent("agent_activated", `Agente attivato: ${agent.name}`, { agent_id: agent.id });
  } else if (patch.status === "paused") {
    await logEvent("agent_paused", `Agente in pausa: ${agent.name}`, { agent_id: agent.id });
  }
  return agent;
}

export async function archiveAgent(agentId: string): Promise<void> {
  const { error } = await supabase
    .from("agent_registry" as never)
    .update({ status: "archived" } as never)
    .eq("id", agentId);
  if (error) throw error;
  await logEvent("agent_archived", "Agente archiviato", { agent_id: agentId });
}

// ============================================================
// Permission matrix
// ============================================================

export type UpsertPermissionInput = {
  agent_id: string;
  brain_id?: string | null;
  tool_key: string;
  permission_level: PermissionLevel;
  risk_level?: RiskLevel;
  requires_approval?: boolean;
  is_enabled?: boolean;
  metadata?: Record<string, unknown>;
};

export async function listAgentPermissions(agentId: string): Promise<AgentPermission[]> {
  const { data, error } = await supabase
    .from("agent_permission_matrix" as never)
    .select("*")
    .eq("agent_id", agentId)
    .order("tool_key", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown) as AgentPermission[];
}

export async function upsertAgentPermission(
  input: UpsertPermissionInput,
): Promise<AgentPermission> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");

  // Safety: blocca execute_after_approval in v3.3
  const safeLevel: PermissionLevel =
    input.permission_level === "execute_after_approval"
      ? "request_approval"
      : input.permission_level;

  const payload = {
    user_id: u.user.id,
    brain_id: input.brain_id ?? null,
    agent_id: input.agent_id,
    tool_key: input.tool_key,
    permission_level: safeLevel,
    risk_level: input.risk_level ?? "low",
    requires_approval: input.requires_approval ?? true,
    is_enabled: input.is_enabled ?? true,
    metadata: input.metadata ?? {},
  };

  const { data, error } = await supabase
    .from("agent_permission_matrix" as never)
    .upsert(payload as never, { onConflict: "agent_id,tool_key" })
    .select()
    .single();
  if (error) throw error;
  const perm = (data as unknown) as AgentPermission;
  await logEvent("agent_permission_updated", `Permesso aggiornato: ${input.tool_key}`, {
    agent_id: input.agent_id,
    tool_key: input.tool_key,
    permission_level: safeLevel,
  });
  return perm;
}

// ============================================================
// Templates
// ============================================================

export type AgentTemplate = {
  template_key: string;
  name: string;
  role: string;
  description: string;
  business_summary: string;
  reads: string[];
  can_propose: string[];
  cannot_do: string[];
  recommended_tools: ToolKey[];
  max_risk_level: RiskLevel;
  output_targets: string[];
  default_permissions: Array<{
    tool_key: ToolKey;
    permission_level: PermissionLevel;
    risk_level: RiskLevel;
  }>;
};

export function getDefaultAgentTemplates(): AgentTemplate[] {
  return [
    {
      template_key: "project_manager",
      name: "Project Manager Agent",
      role: "project_manager",
      description: "Coordina roadmap, action queue e priorità di progetto.",
      business_summary:
        "Aiuta a tenere sotto controllo lo stato dei progetti e a proporre prossimi passi.",
      reads: ["Action Queue", "Result Review", "Company OS", "Calendar"],
      can_propose: ["Action suggerite", "Checklist", "Note interne"],
      cannot_do: ["Eseguire azioni", "Inviare Telegram", "Triggerare n8n"],
      recommended_tools: ["action_queue", "result_review", "company_os", "calendar"],
      max_risk_level: "low",
      output_targets: ["action_queue", "result_review"],
      default_permissions: [
        { tool_key: "action_queue", permission_level: "suggest", risk_level: "low" },
        { tool_key: "result_review", permission_level: "suggest", risk_level: "low" },
        { tool_key: "company_os", permission_level: "read", risk_level: "low" },
        { tool_key: "calendar", permission_level: "read", risk_level: "low" },
      ],
    },
    {
      template_key: "developer",
      name: "Developer Agent",
      role: "developer",
      description: "Propone code review, fix e refactor sui repository collegati.",
      business_summary:
        "Aiuta a tenere puliti i repository proponendo review e correzioni da approvare.",
      reads: ["GitHub Operational", "Action Queue", "Result Review"],
      can_propose: ["Prompt Codex / Claude Code", "Code review action", "Issue draft"],
      cannot_do: ["Commit", "Push", "PR automatici", "Modifica codice"],
      recommended_tools: ["github_operational", "action_queue", "result_review"],
      max_risk_level: "medium",
      output_targets: ["action_queue", "result_review"],
      default_permissions: [
        { tool_key: "github_operational", permission_level: "suggest", risk_level: "medium" },
        { tool_key: "action_queue", permission_level: "suggest", risk_level: "medium" },
        { tool_key: "result_review", permission_level: "suggest", risk_level: "low" },
      ],
    },
    {
      template_key: "knowledge",
      name: "Knowledge Agent",
      role: "knowledge",
      description: "Cura la knowledge base e segnala fonti mancanti o obsolete.",
      business_summary:
        "Mantiene aggiornata la knowledge aziendale segnalando gap e duplicazioni.",
      reads: ["Drive Knowledge", "Company OS", "Result Review"],
      can_propose: ["Note knowledge", "Action suggerite", "Checklist"],
      cannot_do: ["Modificare file Drive", "Cancellare fonti", "Pubblicare contenuti"],
      recommended_tools: ["drive_knowledge", "company_os", "action_queue"],
      max_risk_level: "low",
      output_targets: ["action_queue", "result_review"],
      default_permissions: [
        { tool_key: "drive_knowledge", permission_level: "read", risk_level: "low" },
        { tool_key: "company_os", permission_level: "read", risk_level: "low" },
        { tool_key: "action_queue", permission_level: "suggest", risk_level: "low" },
      ],
    },
    {
      template_key: "calendar_followup",
      name: "Calendar Follow-up Agent",
      role: "calendar_followup",
      description: "Trasforma eventi calendario in action di preparazione e follow-up.",
      business_summary:
        "Garantisce che ogni riunione abbia preparazione prima e follow-up dopo.",
      reads: ["Calendar", "Action Queue"],
      can_propose: ["Action di preparazione", "Action di follow-up", "Note riunione"],
      cannot_do: ["Modificare eventi Calendar", "Invitare partecipanti", "Inviare email"],
      recommended_tools: ["calendar", "action_queue"],
      max_risk_level: "low",
      output_targets: ["action_queue"],
      default_permissions: [
        { tool_key: "calendar", permission_level: "read", risk_level: "low" },
        { tool_key: "action_queue", permission_level: "suggest", risk_level: "low" },
      ],
    },
    {
      template_key: "automation_guardian",
      name: "Automation Guardian Agent",
      role: "automation_guardian",
      description: "Sorveglia n8n, HMAC, Telegram e flag anomalie operative.",
      business_summary:
        "Vigila sull'infrastruttura di automazione e segnala problemi prima che diventino blocchi.",
      reads: ["n8n Workflows", "Telegram Approvals", "Action Queue", "Result Review"],
      can_propose: ["Warning", "Action di verifica", "Checklist di safety"],
      cannot_do: [
        "Triggerare n8n",
        "Inviare Telegram",
        "Modificare configurazione live",
        "Modificare secret",
      ],
      recommended_tools: [
        "n8n_workflows",
        "telegram_approvals",
        "action_queue",
        "result_review",
      ],
      max_risk_level: "medium",
      output_targets: ["action_queue", "result_review"],
      default_permissions: [
        { tool_key: "n8n_workflows", permission_level: "read", risk_level: "medium" },
        { tool_key: "telegram_approvals", permission_level: "read", risk_level: "medium" },
        { tool_key: "action_queue", permission_level: "suggest", risk_level: "low" },
        { tool_key: "result_review", permission_level: "suggest", risk_level: "low" },
      ],
    },
    {
      template_key: "marketing_content",
      name: "Marketing / Content Agent",
      role: "marketing_content",
      description: "Prepara bozze contenuti e calendari editoriali.",
      business_summary:
        "Suggerisce idee di contenuto, bozze e checklist editoriali da approvare manualmente.",
      reads: ["Company OS", "Calendar", "Drive Knowledge"],
      can_propose: ["Bozze contenuti", "Checklist editoriali", "Action di pubblicazione"],
      cannot_do: [
        "Pubblicare social",
        "Inviare email",
        "Modificare Drive",
        "Spendere budget",
      ],
      recommended_tools: ["calendar", "drive_knowledge", "action_queue"],
      max_risk_level: "low",
      output_targets: ["action_queue", "result_review"],
      default_permissions: [
        { tool_key: "calendar", permission_level: "read", risk_level: "low" },
        { tool_key: "drive_knowledge", permission_level: "read", risk_level: "low" },
        { tool_key: "action_queue", permission_level: "suggest", risk_level: "low" },
      ],
    },
    {
      template_key: "sales_crm",
      name: "Sales / CRM Agent",
      role: "sales_crm",
      description: "Prepara follow-up commerciali e note CRM da eventi calendar.",
      business_summary:
        "Aiuta il team commerciale con follow-up e checklist post-meeting, sempre da approvare.",
      reads: ["Calendar", "Action Queue", "Company OS"],
      can_propose: ["Follow-up commerciali", "Note CRM", "Checklist di chiusura"],
      cannot_do: ["Inviare email", "Modificare CRM esterno", "Inviare offerte automaticamente"],
      recommended_tools: ["calendar", "action_queue", "company_os"],
      max_risk_level: "low",
      output_targets: ["action_queue", "result_review"],
      default_permissions: [
        { tool_key: "calendar", permission_level: "read", risk_level: "low" },
        { tool_key: "action_queue", permission_level: "suggest", risk_level: "low" },
        { tool_key: "company_os", permission_level: "read", risk_level: "low" },
      ],
    },
  ];
}

export async function createAgentFromTemplate(
  templateKey: string,
  brainId?: string | null,
): Promise<Agent> {
  const tpl = getDefaultAgentTemplates().find((t) => t.template_key === templateKey);
  if (!tpl) throw new Error(`Template non trovato: ${templateKey}`);

  const agent = await createAgent({
    brain_id: brainId ?? null,
    name: tpl.name,
    agent_key: `${tpl.template_key}_${Date.now().toString(36)}`,
    description: tpl.description,
    role: tpl.role,
    status: "draft",
    operating_mode: "manual",
    max_risk_level: tpl.max_risk_level,
    requires_approval: true,
    allowed_tools: tpl.recommended_tools,
    output_targets: tpl.output_targets,
    metadata: {
      template_key: tpl.template_key,
      business_summary: tpl.business_summary,
      reads: tpl.reads,
      can_propose: tpl.can_propose,
      cannot_do: tpl.cannot_do,
    },
  });

  for (const p of tpl.default_permissions) {
    await upsertAgentPermission({
      agent_id: agent.id,
      brain_id: brainId ?? null,
      tool_key: p.tool_key,
      permission_level: p.permission_level,
      risk_level: p.risk_level,
      requires_approval: true,
      is_enabled: true,
    });
  }

  await logEvent("agent_template_created", `Agente da template: ${tpl.name}`, {
    agent_id: agent.id,
    template_key: templateKey,
  });
  return agent;
}

// ============================================================
// Safety validation
// ============================================================

export type SafetyIssue = {
  severity: "info" | "warning" | "error";
  message: string;
};

export function validateAgentSafety(agent: Agent): SafetyIssue[] {
  const issues: SafetyIssue[] = [];
  if (agent.can_execute_tools) {
    issues.push({
      severity: "error",
      message: "can_execute_tools deve essere false in questa versione (manual-first).",
    });
  }
  if (agent.can_call_external_apis) {
    issues.push({
      severity: "error",
      message: "can_call_external_apis deve essere false in questa versione.",
    });
  }
  if (agent.can_trigger_n8n || agent.can_send_telegram || agent.can_modify_external_data) {
    issues.push({
      severity: "error",
      message: "Trigger n8n/Telegram/modifiche esterne non sono permessi.",
    });
  }
  if (agent.status === "active" && agent.allowed_tools.length === 0) {
    issues.push({
      severity: "warning",
      message: "Agente attivo senza strumenti consentiti.",
    });
  }
  if (
    (agent.max_risk_level === "medium" || agent.max_risk_level === "high") &&
    !agent.requires_approval
  ) {
    issues.push({
      severity: "warning",
      message: "Agente con max risk medium/high deve richiedere approvazione.",
    });
  }
  return issues;
}

// ============================================================
// Suggested action (mai eseguita)
// ============================================================

export async function createAgentSuggestedAction(input: {
  agent: Agent;
  action_type: Extract<ActionType, "agent_recommendation" | "agent_setup" | "agent_review">;
  title: string;
  description?: string;
  brain_id?: string | null;
  project_id?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<AutomationAction> {
  const action = await createAction({
    source: "agent_center",
    action_type: input.action_type,
    title: input.title,
    description: input.description ?? null,
    priority: "medium",
    brain_id: input.brain_id ?? input.agent.brain_id ?? null,
    project_id: input.project_id ?? null,
    metadata: {
      agent_id: input.agent.id,
      agent_key: input.agent.agent_key,
      agent_role: input.agent.role,
      origin: "agent_center",
      requires_confirmation: true,
      ...(input.metadata ?? {}),
    },
  });
  await logEvent("agent_action_created", `Action creata da agente: ${input.agent.name}`, {
    agent_id: input.agent.id,
    action_id: action.id,
  });
  return action;
}

// ============================================================
// Summary + warnings
// ============================================================

export type AgentCenterSummary = {
  total: number;
  draft: number;
  active: number;
  paused: number;
  archived: number;
  byRole: Record<string, number>;
  recommendedNext: AgentTemplate | null;
};

export async function getAgentCenterSummary(
  brainId?: string | null,
): Promise<AgentCenterSummary> {
  const agents = await listAgents(brainId ?? null);
  const byRole: Record<string, number> = {};
  let draft = 0;
  let active = 0;
  let paused = 0;
  let archived = 0;
  for (const a of agents) {
    byRole[a.role] = (byRole[a.role] ?? 0) + 1;
    if (a.status === "draft") draft++;
    else if (a.status === "active") active++;
    else if (a.status === "paused") paused++;
    else if (a.status === "archived") archived++;
  }
  const templates = getDefaultAgentTemplates();
  const existingTplKeys = new Set(
    agents.map((a) => (a.metadata as Record<string, unknown>).template_key).filter(Boolean),
  );
  const recommendedNext =
    templates.find((t) => !existingTplKeys.has(t.template_key)) ?? null;
  return {
    total: agents.length,
    draft,
    active,
    paused,
    archived,
    byRole,
    recommendedNext,
  };
}

export type AgentCenterWarning = {
  id: string;
  level: "warning" | "info" | "error";
  title: string;
  description: string;
  cta?: { label: string; to: string };
};

export async function getAgentCenterWarnings(
  brainId?: string | null,
): Promise<AgentCenterWarning[]> {
  const warnings: AgentCenterWarning[] = [];
  const agents = await listAgents(brainId ?? null);

  if (brainId && agents.length === 0) {
    warnings.push({
      id: `ac-no-agent-${brainId}`,
      level: "info",
      title: "Nessun agente configurato",
      description: "Configura almeno un agente per il brain operativo.",
      cta: { label: "Apri Agent Center", to: "/agent-center" },
    });
  }

  for (const a of agents) {
    const safety = validateAgentSafety(a);
    for (const s of safety) {
      if (s.severity === "warning" || s.severity === "error") {
        warnings.push({
          id: `ac-safety-${a.id}-${s.message.slice(0, 30)}`,
          level: s.severity === "error" ? "error" : "warning",
          title: `Safety: ${a.name}`,
          description: s.message,
          cta: { label: "Apri agente", to: "/agent-center" },
        });
      }
    }

    if (a.status === "active") {
      const perms = await listAgentPermissions(a.id);
      const enabled = perms.filter((p) => p.is_enabled && p.permission_level !== "none");
      if (enabled.length === 0) {
        warnings.push({
          id: `ac-active-no-perm-${a.id}`,
          level: "warning",
          title: `Agente attivo senza permessi: ${a.name}`,
          description: "Configura almeno un permesso tool per l'agente attivo.",
          cta: { label: "Apri Agent Center", to: "/agent-center" },
        });
      }
    }

    // Developer agent senza repository
    if (a.role === "developer") {
      const { count } = await supabase
        .from("github_repository_registry" as never)
        .select("id", { count: "exact", head: true })
        .eq("brain_id", a.brain_id ?? "");
      if (!count || count === 0) {
        warnings.push({
          id: `ac-dev-no-repo-${a.id}`,
          level: "info",
          title: `Developer Agent senza repository: ${a.name}`,
          description: "Collega un repository GitHub al brain dell'agente.",
          cta: { label: "Apri GitHub Operational", to: "/github-operational" },
        });
      }
    }

    // Automation Guardian senza connettori
    if (a.role === "automation_guardian") {
      const { count: telCount } = await supabase
        .from("telegram_connection_settings" as never)
        .select("id", { count: "exact", head: true });
      if (!telCount || telCount === 0) {
        warnings.push({
          id: `ac-guardian-no-tel-${a.id}`,
          level: "info",
          title: `Automation Guardian senza Telegram: ${a.name}`,
          description: "Configura Telegram per abilitare la sorveglianza completa.",
          cta: { label: "Apri Telegram", to: "/telegram-approvals" },
        });
      }
    }

    // Calendar agent senza connessione
    if (a.role === "calendar_followup") {
      const { count: calCount } = await supabase
        .from("calendar_connection_settings" as never)
        .select("id", { count: "exact", head: true });
      if (!calCount || calCount === 0) {
        warnings.push({
          id: `ac-cal-no-conn-${a.id}`,
          level: "info",
          title: `Calendar Agent senza Calendar: ${a.name}`,
          description: "Collega Google Calendar al brain dell'agente.",
          cta: { label: "Apri Calendar Knowledge", to: "/calendar-knowledge" },
        });
      }
    }
  }

  return warnings;
}
