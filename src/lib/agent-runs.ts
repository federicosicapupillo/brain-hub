// Brain Hub v3.5 — Agent Run Console
// Manual-first. NESSUNA API esterna, nessun LLM esterno, nessun n8n trigger,
// nessun invio Telegram, nessuna modifica Drive/Calendar/GitHub, nessun commit.
// Solo run manuali, output euristico, action suggested e review interne.

import { supabase } from "@/integrations/supabase/client";
import type { LogEventType } from "@/lib/automation-run";
import {
  createAction,
  type AutomationAction,
  type ActionType,
  type RiskLevel,
} from "@/lib/action-queue";
import {
  createReviewItem,
  type ResultReviewItem,
  type ReviewSourceType,
} from "@/lib/result-review";
import {
  getAgent,
  listAgents,
  type Agent,
} from "@/lib/agent-center";

// ============================================================
// Types
// ============================================================

export type AgentRunStatus =
  | "draft"
  | "previewed"
  | "completed"
  | "action_created"
  | "review_created"
  | "code_handoff_created"
  | "archived";

export type AgentRunMode = "manual" | "simulated" | "supervised";

export const RUN_STATUS_LABEL: Record<AgentRunStatus, string> = {
  draft: "Bozza",
  previewed: "Preview generata",
  completed: "Completata",
  action_created: "Azione creata",
  review_created: "Review creata",
  code_handoff_created: "Code Handoff creato",
  archived: "Archiviata",
};

export const RUN_STATUS_TONE: Record<AgentRunStatus, string> = {
  draft: "bg-muted text-muted-foreground border-muted",
  previewed: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  action_created: "bg-indigo-500/10 text-indigo-600 border-indigo-500/30",
  review_created: "bg-violet-500/10 text-violet-600 border-violet-500/30",
  code_handoff_created: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  archived: "bg-muted text-muted-foreground border-border",
};

export type ContextSourceKey =
  | "company_os"
  | "company_blueprint"
  | "action_queue"
  | "result_review"
  | "learning_loop"
  | "loop_qa"
  | "drive_knowledge"
  | "calendar_upcoming"
  | "calendar_suggestions"
  | "github"
  | "code_handoffs"
  | "n8n_workflows"
  | "telegram_approvals"
  | "master_snapshot";

export const CONTEXT_SOURCE_LABEL: Record<ContextSourceKey, string> = {
  company_os: "Company OS summary",
  company_blueprint: "Company Blueprint",
  action_queue: "Action Queue summary",
  result_review: "Result Review summary",
  learning_loop: "Learning Loop suggestions",
  loop_qa: "Loop QA warnings",
  drive_knowledge: "Drive Knowledge summary",
  calendar_upcoming: "Calendar upcoming events",
  calendar_suggestions: "Calendar suggestions",
  github: "GitHub repositories / code actions",
  code_handoffs: "Code Handoffs summary",
  n8n_workflows: "n8n workflows status",
  telegram_approvals: "Telegram approvals status",
  master_snapshot: "Master Snapshot current",
};

export type AgentRunLog = {
  id: string;
  user_id: string;
  brain_id: string | null;
  agent_id: string;
  run_status: AgentRunStatus | string;
  run_mode: AgentRunMode | string;
  objective: string;
  input_context: Record<string, unknown>;
  output_summary: string | null;
  output_json: Record<string, unknown>;
  suggested_action_id: string | null;
  result_review_item_id: string | null;
  code_handoff_id: string | null;
  risk_level: RiskLevel | string;
  requires_approval: boolean;
  metadata: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  ai_prompt_text?: string | null;
  ai_result_text?: string | null;
  ai_provider?: string | null;
  ai_handoff_status?: AiHandoffStatus | string | null;
  ai_prompt_copied_at?: string | null;
  ai_result_received_at?: string | null;
};

export type AiProvider = "chatgpt" | "claude" | "gemini" | "manual_ai";

export const AI_PROVIDER_LABEL: Record<AiProvider, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  manual_ai: "Manual AI",
};

export type AiHandoffStatus =
  | "not_started"
  | "prompt_ready"
  | "prompt_copied"
  | "result_received"
  | "action_created"
  | "review_created";

export const AI_HANDOFF_STATUS_LABEL: Record<AiHandoffStatus, string> = {
  not_started: "Non iniziato",
  prompt_ready: "Prompt pronto",
  prompt_copied: "Prompt copiato",
  result_received: "Risultato ricevuto",
  action_created: "Action creata",
  review_created: "Review creata",
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

export async function logAgentRunEvent(
  action: LogEventType,
  notes: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await logEvent(action, notes, metadata);
}

// ============================================================
// CRUD
// ============================================================

export async function listAgentRuns(
  brainId?: string | null,
): Promise<AgentRunLog[]> {
  let q = supabase
    .from("agent_run_logs" as never)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (brainId) q = q.eq("brain_id", brainId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as AgentRunLog[];
}

export async function getAgentRun(runId: string): Promise<AgentRunLog> {
  const { data, error } = await supabase
    .from("agent_run_logs" as never)
    .select("*")
    .eq("id", runId)
    .single();
  if (error) throw error;
  return data as unknown as AgentRunLog;
}

export type CreateAgentRunInput = {
  agent_id: string;
  brain_id?: string | null;
  objective: string;
  input_context?: Record<string, unknown>;
  run_mode?: AgentRunMode;
  risk_level?: RiskLevel;
  metadata?: Record<string, unknown>;
};

export async function createAgentRun(
  input: CreateAgentRunInput,
): Promise<AgentRunLog> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");

  const payload = {
    user_id: u.user.id,
    agent_id: input.agent_id,
    brain_id: input.brain_id ?? null,
    objective: input.objective,
    input_context: input.input_context ?? {},
    output_json: {},
    run_mode: input.run_mode ?? "manual",
    run_status: "draft" as AgentRunStatus,
    risk_level: input.risk_level ?? "low",
    requires_approval: true,
    metadata: input.metadata ?? {},
  };
  const { data, error } = await supabase
    .from("agent_run_logs" as never)
    .insert(payload as never)
    .select()
    .single();
  if (error) throw error;
  const run = data as unknown as AgentRunLog;
  await logEvent("agent_run_created", `Run agente creata`, {
    run_id: run.id,
    agent_id: run.agent_id,
    objective: run.objective,
  });
  return run;
}

export async function updateAgentRun(
  runId: string,
  patch: Partial<AgentRunLog>,
): Promise<AgentRunLog> {
  const { data, error } = await supabase
    .from("agent_run_logs" as never)
    .update(patch as never)
    .eq("id", runId)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as AgentRunLog;
}

export async function archiveAgentRun(runId: string): Promise<AgentRunLog> {
  const next = await updateAgentRun(runId, {
    run_status: "archived" as AgentRunStatus,
  });
  await logEvent("agent_run_archived", "Run agente archiviata", {
    run_id: runId,
  });
  return next;
}

// ============================================================
// Context builder
// ============================================================

export type AgentRunContext = {
  sources: ContextSourceKey[];
  collected: Record<string, unknown>;
  warnings: Array<{ source: ContextSourceKey; message: string }>;
};

type Counter = { count: number };

async function safeCount(table: string, brainId: string | null): Promise<number> {
  try {
    let q = supabase
      .from(table as never)
      .select("id", { count: "exact", head: true });
    if (brainId) q = q.eq("brain_id", brainId);
    const { count } = await q;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export type BuildContextInput = {
  brain_id?: string | null;
  sources: ContextSourceKey[];
};

export async function buildAgentRunContext(
  input: BuildContextInput,
): Promise<AgentRunContext> {
  const brainId = input.brain_id ?? null;
  const collected: Record<string, unknown> = {};
  const warnings: AgentRunContext["warnings"] = [];

  const safe = async (
    key: ContextSourceKey,
    fn: () => Promise<unknown>,
  ): Promise<void> => {
    try {
      collected[key] = await fn();
    } catch (err) {
      warnings.push({
        source: key,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  for (const src of input.sources) {
    switch (src) {
      case "company_os":
        await safe(src, async () => ({
          profiles: await safeCount("company_os_profiles", brainId),
        }));
        break;
      case "company_blueprint":
        await safe(src, async () => ({
          blueprints: await safeCount("company_os_blueprints", brainId),
        }));
        break;
      case "action_queue":
        await safe(src, async () => {
          let q = supabase
            .from("automation_actions" as never)
            .select("id,status,risk_level,action_type,title,created_at")
            .order("created_at", { ascending: false })
            .limit(20);
          if (brainId) q = q.eq("brain_id", brainId);
          const { data } = await q;
          return { recent: data ?? [], total: (data ?? []).length };
        });
        break;
      case "result_review":
        await safe(src, async () => {
          let q = supabase
            .from("result_review_items" as never)
            .select("id,title,review_status,source_type,created_at")
            .order("created_at", { ascending: false })
            .limit(20);
          if (brainId) q = q.eq("brain_id", brainId);
          const { data } = await q;
          return { recent: data ?? [], total: (data ?? []).length };
        });
        break;
      case "learning_loop":
        await safe(src, async () => {
          let q = supabase
            .from("learning_loop_suggestions" as never)
            .select("id,title,status,created_at")
            .order("created_at", { ascending: false })
            .limit(20);
          if (brainId) q = q.eq("brain_id", brainId);
          const { data } = await q;
          return { recent: data ?? [] };
        });
        break;
      case "loop_qa":
        await safe(src, async () => {
          const mod = await import("@/lib/loop-qa");
          const w = await mod.getLoopWarnings(brainId);
          return { warnings: w };
        });
        break;
      case "drive_knowledge":
        await safe(src, async () => ({
          files: await safeCount("drive_file_map", brainId),
        }));
        break;
      case "calendar_upcoming":
        await safe(src, async () => {
          let q = supabase
            .from("calendar_event_map" as never)
            .select("id,title,start_time")
            .order("start_time", { ascending: true })
            .limit(10);
          if (brainId) q = q.eq("brain_id", brainId);
          const { data } = await q;
          return { upcoming: data ?? [] };
        });
        break;
      case "calendar_suggestions":
        await safe(src, async () => {
          let q = supabase
            .from("automation_actions" as never)
            .select("id,title,action_type,status")
            .in("action_type", [
              "meeting_preparation",
              "meeting_follow_up",
              "calendar_deadline_check",
              "calendar_content_check",
            ])
            .order("created_at", { ascending: false })
            .limit(20);
          if (brainId) q = q.eq("brain_id", brainId);
          const { data } = await q;
          return { suggestions: data ?? [] };
        });
        break;
      case "github":
        await safe(src, async () => {
          let q = supabase
            .from("github_repository_registry" as never)
            .select("id,repository_url,repository_owner,repository_name")
            .limit(20);
          if (brainId) q = q.eq("brain_id", brainId);
          const { data } = await q;
          return { repositories: data ?? [] };
        });
        break;
      case "code_handoffs":
        await safe(src, async () => {
          let q = supabase
            .from("code_engine_handoffs" as never)
            .select("id,engine,handoff_status,created_at")
            .order("created_at", { ascending: false })
            .limit(20);
          if (brainId) q = q.eq("brain_id", brainId);
          const { data } = await q;
          return { handoffs: data ?? [] };
        });
        break;
      case "n8n_workflows":
        await safe(src, async () => {
          const { data } = await supabase
            .from("n8n_workflow_registry" as never)
            .select("id,workflow_name,status")
            .limit(20);
          return { workflows: data ?? [] };
        });
        break;
      case "telegram_approvals":
        await safe(src, async () => {
          const { data } = await supabase
            .from("telegram_approval_requests" as never)
            .select("id,status,created_at")
            .order("created_at", { ascending: false })
            .limit(20);
          return { approvals: data ?? [] };
        });
        break;
      case "master_snapshot":
        await safe(src, async () => {
          const { data } = await supabase
            .from("master_snapshot_versions" as never)
            .select("id,version,is_current,created_at")
            .eq("is_current", true)
            .order("created_at", { ascending: false })
            .limit(1);
          return { current: (data ?? [])[0] ?? null };
        });
        break;
    }
  }

  await logEvent("agent_run_context_built", "Contesto run agente costruito", {
    sources: input.sources,
    brain_id: brainId,
    warnings: warnings.length,
  });

  if (warnings.length > 0) {
    await logEvent(
      "agent_run_warning_generated",
      `Warning durante costruzione contesto`,
      { warnings, brain_id: brainId },
    );
  }

  return { sources: input.sources, collected, warnings };
}

// ============================================================
// Heuristic preview
// ============================================================

export type AgentRunPreview = {
  summary: string;
  bullets: string[];
  suggested_action: {
    title: string;
    description: string;
    action_type: ActionType;
    risk_level: RiskLevel;
  } | null;
  suggests_code_handoff: boolean;
  notes: string[];
};

type PreviewInput = {
  agent: Agent;
  objective: string;
  context: AgentRunContext;
};

function extractList<T = unknown>(
  collected: Record<string, unknown>,
  key: ContextSourceKey,
  field: string,
): T[] {
  const block = collected[key];
  if (!block || typeof block !== "object") return [];
  const v = (block as Record<string, unknown>)[field];
  return Array.isArray(v) ? (v as T[]) : [];
}

function buildPreviewByRole(input: PreviewInput): AgentRunPreview {
  const { agent, objective, context } = input;
  const c = context.collected;
  const notes: string[] = context.warnings.map(
    (w) => `Warning ${w.source}: ${w.message}`,
  );

  switch (agent.role) {
    case "project_manager": {
      const actions = extractList(c, "action_queue", "recent");
      const reviews = extractList(c, "result_review", "recent");
      return {
        summary: `Project Manager review per: ${objective}`,
        bullets: [
          `Action recenti: ${actions.length}`,
          `Review recenti: ${reviews.length}`,
          "Priorità consigliata: chiudere review pending prima di nuove action",
          "Nessuna modifica automatica eseguita",
        ],
        suggested_action: {
          title: `PM follow-up: ${objective}`,
          description: "Revisionare action e review aperte e proporre prossimo passo.",
          action_type: "agent_recommendation",
          risk_level: "low",
        },
        suggests_code_handoff: false,
        notes,
      };
    }
    case "developer": {
      const repos = extractList(c, "github", "repositories");
      const handoffs = extractList(c, "code_handoffs", "handoffs");
      return {
        summary: `Developer review per: ${objective}`,
        bullets: [
          `Repository collegati: ${repos.length}`,
          `Handoff esistenti: ${handoffs.length}`,
          "Prompt Codex/Claude Code suggerito (manuale)",
          "Nessun commit, push o PR eseguito",
        ],
        suggested_action: {
          title: `Code review: ${objective}`,
          description:
            "Preparare code review manuale e, se necessario, un Code Handoff per Codex/Claude Code.",
          action_type: "code_review",
          risk_level: "low",
        },
        suggests_code_handoff: true,
        notes,
      };
    }
    case "calendar_followup": {
      const upcoming = extractList(c, "calendar_upcoming", "upcoming");
      return {
        summary: `Calendar follow-up per: ${objective}`,
        bullets: [
          `Eventi prossimi: ${upcoming.length}`,
          "Verificare preparazione mancante",
          "Verificare follow-up mancante",
          "Nessuna modifica a Google Calendar",
        ],
        suggested_action: {
          title: `Calendar follow-up: ${objective}`,
          description: "Suggerire azioni di preparazione / follow-up per eventi imminenti.",
          action_type: "meeting_preparation",
          risk_level: "low",
        },
        suggests_code_handoff: false,
        notes,
      };
    }
    case "knowledge": {
      return {
        summary: `Knowledge review per: ${objective}`,
        bullets: [
          "Verificare fonti senza knowledge source collegata",
          "Identificare aree knowledge incomplete",
          "Nessuna modifica a file Drive",
        ],
        suggested_action: {
          title: `Knowledge gap: ${objective}`,
          description: "Mappare i gap knowledge e suggerire fonti da aggiungere.",
          action_type: "agent_recommendation",
          risk_level: "low",
        },
        suggests_code_handoff: false,
        notes,
      };
    }
    case "automation_guardian": {
      const workflows = extractList(c, "n8n_workflows", "workflows");
      const approvals = extractList(c, "telegram_approvals", "approvals");
      return {
        summary: `Automation Guardian per: ${objective}`,
        bullets: [
          `Workflow n8n monitorati: ${workflows.length}`,
          `Telegram approvals viste: ${approvals.length}`,
          "Nessun trigger n8n eseguito",
          "Nessun messaggio Telegram inviato",
        ],
        suggested_action: {
          title: `Automation guard: ${objective}`,
          description: "Segnalare workflow rischiosi e proporre verifica manuale.",
          action_type: "agent_review",
          risk_level: "medium",
        },
        suggests_code_handoff: false,
        notes,
      };
    }
    case "marketing_content": {
      return {
        summary: `Marketing/Content per: ${objective}`,
        bullets: [
          "Proporre idee contenuti come prompt manuali",
          "Preparare checklist editoriali",
          "Nessuna pubblicazione automatica",
        ],
        suggested_action: {
          title: `Content brief: ${objective}`,
          description: "Preparare bozza brief editoriale da revisionare.",
          action_type: "manual_task",
          risk_level: "low",
        },
        suggests_code_handoff: false,
        notes,
      };
    }
    case "sales_crm": {
      return {
        summary: `Sales/CRM per: ${objective}`,
        bullets: [
          "Identificare follow-up clienti aperti",
          "Identificare scadenze pipeline",
          "Nessuna email automatica inviata",
        ],
        suggested_action: {
          title: `Sales follow-up: ${objective}`,
          description: "Preparare lista follow-up clienti e prossimi step manuali.",
          action_type: "manual_task",
          risk_level: "low",
        },
        suggests_code_handoff: false,
        notes,
      };
    }
    default: {
      return {
        summary: `Run agente per: ${objective}`,
        bullets: [
          `Ruolo: ${agent.role}`,
          `Sorgenti contesto: ${context.sources.length}`,
          "Output euristico — nessuna AI esterna usata",
        ],
        suggested_action: {
          title: `Agente: ${objective}`,
          description: `Raccomandazione manuale generata dall'agente "${agent.name}".`,
          action_type: "agent_recommendation",
          risk_level: "low",
        },
        suggests_code_handoff: false,
        notes,
      };
    }
  }
}

export async function generateAgentRunPreview(input: {
  run_id?: string;
  agent_id: string;
  brain_id?: string | null;
  objective: string;
  context: AgentRunContext;
}): Promise<AgentRunPreview> {
  const agent = await getAgent(input.agent_id);
  const preview = buildPreviewByRole({
    agent,
    objective: input.objective,
    context: input.context,
  });
  if (input.run_id) {
    await updateAgentRun(input.run_id, {
      run_status: "previewed" as AgentRunStatus,
      output_summary: preview.summary,
      output_json: preview as unknown as Record<string, unknown>,
    });
  }
  await logEvent(
    "agent_run_preview_generated",
    `Preview generata per ${agent.name}`,
    { agent_id: agent.id, objective: input.objective },
  );
  return preview;
}

// ============================================================
// Completion / lifecycle
// ============================================================

export async function completeAgentRun(
  runId: string,
  output: { summary: string; json?: Record<string, unknown> },
): Promise<AgentRunLog> {
  const next = await updateAgentRun(runId, {
    run_status: "completed" as AgentRunStatus,
    output_summary: output.summary,
    output_json: output.json ?? {},
    completed_at: new Date().toISOString(),
  });
  await logEvent("agent_run_completed", "Run agente completata", {
    run_id: runId,
  });
  return next;
}

// ============================================================
// Action / Review / Code Handoff creation
// ============================================================

export async function createActionFromAgentRun(
  runId: string,
): Promise<AutomationAction> {
  const run = await getAgentRun(runId);
  const agent = await getAgent(run.agent_id);
  const out = run.output_json as Partial<AgentRunPreview>;
  const sa = out.suggested_action ?? null;

  const action = await createAction({
    source: "agent_center",
    action_type: (sa?.action_type ?? "agent_recommendation") as ActionType,
    title: sa?.title ?? `Agente: ${run.objective}`,
    description: sa?.description ?? out.summary ?? undefined,
    risk_level: (sa?.risk_level ?? "low") as RiskLevel,
    priority: "medium",
    brain_id: run.brain_id,
    metadata: {
      agent_run_id: run.id,
      agent_id: agent.id,
      agent_role: agent.role,
      agent_name: agent.name,
      objective: run.objective,
    },
  });

  await updateAgentRun(runId, {
    suggested_action_id: action.id,
    run_status: "action_created" as AgentRunStatus,
  });
  await logEvent("agent_run_action_created", "Action creata da agent run", {
    run_id: runId,
    action_id: action.id,
    agent_id: agent.id,
  });
  return action;
}

export async function createReviewFromAgentRun(
  runId: string,
): Promise<ResultReviewItem> {
  const run = await getAgentRun(runId);
  const agent = await getAgent(run.agent_id);

  const review = await createReviewItem({
    source_type: "agent_run" as ReviewSourceType,
    source_id: run.id,
    title: `Agent run: ${run.objective}`,
    result_text: run.output_summary,
    brain_id: run.brain_id,
    risk_level: run.risk_level,
    metadata: {
      agent_run_id: run.id,
      agent_id: agent.id,
      agent_role: agent.role,
      objective: run.objective,
    },
  });

  await updateAgentRun(runId, {
    result_review_item_id: review.id,
    run_status: "review_created" as AgentRunStatus,
  });
  await logEvent("agent_run_review_created", "Review creata da agent run", {
    run_id: runId,
    review_id: review.id,
  });
  return review;
}

export async function createCodeHandoffFromAgentRun(
  runId: string,
  engine: "codex" | "claude_code",
): Promise<{ handoff_id: string }> {
  const run = await getAgentRun(runId);
  const agent = await getAgent(run.agent_id);

  // First ensure an action exists so the handoff is linked to it
  let actionId = run.suggested_action_id;
  if (!actionId) {
    const action = await createActionFromAgentRun(runId);
    actionId = action.id;
  }

  const { createCodeEngineHandoffFromAction } = await import(
    "@/lib/code-engine-handoff"
  );
  const handoff = await createCodeEngineHandoffFromAction(actionId, engine);

  await updateAgentRun(runId, {
    code_handoff_id: handoff.id,
    run_status: "code_handoff_created" as AgentRunStatus,
  });
  await logEvent(
    "agent_run_code_handoff_created",
    `Code handoff ${engine} creato da agent run`,
    {
      run_id: runId,
      handoff_id: handoff.id,
      engine,
      agent_id: agent.id,
    },
  );
  return { handoff_id: handoff.id };
}

// ============================================================
// Summary & warnings
// ============================================================

export type AgentRunSummary = {
  total: number;
  draft: number;
  previewed: number;
  completed: number;
  action_created: number;
  review_created: number;
  code_handoff_created: number;
  archived: number;
  last_run_at: string | null;
};

export async function getAgentRunSummary(
  brainId?: string | null,
): Promise<AgentRunSummary> {
  const runs = await listAgentRuns(brainId ?? null);
  const s: AgentRunSummary = {
    total: runs.length,
    draft: 0,
    previewed: 0,
    completed: 0,
    action_created: 0,
    review_created: 0,
    code_handoff_created: 0,
    archived: 0,
    last_run_at: runs[0]?.created_at ?? null,
  };
  for (const r of runs) {
    switch (r.run_status) {
      case "draft": s.draft++; break;
      case "previewed": s.previewed++; break;
      case "completed": s.completed++; break;
      case "action_created": s.action_created++; break;
      case "review_created": s.review_created++; break;
      case "code_handoff_created": s.code_handoff_created++; break;
      case "archived": s.archived++; break;
    }
  }
  return s;
}

export type AgentRunWarning = {
  id: string;
  level: "warning" | "info" | "error";
  title: string;
  description: string;
  cta?: { label: string; to: string };
};

export async function getAgentRunWarnings(
  brainId?: string | null,
): Promise<AgentRunWarning[]> {
  const warnings: AgentRunWarning[] = [];
  const agents = await listAgents(brainId ?? null);
  const runs = await listAgentRuns(brainId ?? null);
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const lastByAgent = new Map<string, AgentRunLog>();
  for (const r of runs) {
    const existing = lastByAgent.get(r.agent_id);
    if (!existing || existing.created_at < r.created_at) {
      lastByAgent.set(r.agent_id, r);
    }
  }

  for (const a of agents) {
    if (a.status === "active") {
      const last = lastByAgent.get(a.id);
      if (!last || new Date(last.created_at).getTime() < sevenDaysAgo) {
        warnings.push({
          id: `ar-no-recent-${a.id}`,
          level: "info",
          title: `Agente attivo senza run recenti: ${a.name}`,
          description: "Nessuna run negli ultimi 7 giorni.",
          cta: { label: "Apri Run Console", to: "/agent-runs" },
        });
      }
    }
    if (a.status === "draft") {
      warnings.push({
        id: `ar-agent-draft-${a.id}`,
        level: "info",
        title: `Agente in bozza: ${a.name}`,
        description: "Configura e attiva l'agente prima di lanciare run.",
        cta: { label: "Apri Agent Center", to: "/agent-center" },
      });
    }
  }

  for (const r of runs) {
    if (
      r.run_status === "completed" &&
      !r.suggested_action_id &&
      !r.result_review_item_id
    ) {
      warnings.push({
        id: `ar-no-followup-${r.id}`,
        level: "warning",
        title: `Run completata senza follow-up`,
        description: `"${r.objective}" non ha né action né review collegate.`,
        cta: { label: "Apri Run Console", to: "/agent-runs" },
      });
    }
  }

  // Developer Agent senza Code Handoff dopo preview che lo suggerisce
  for (const r of runs) {
    const out = r.output_json as Partial<AgentRunPreview>;
    if (out?.suggests_code_handoff && !r.code_handoff_id) {
      warnings.push({
        id: `ar-dev-no-handoff-${r.id}`,
        level: "info",
        title: "Code Handoff suggerito ma non creato",
        description: `"${r.objective}": l'agente suggerisce un handoff Codex/Claude Code.`,
        cta: { label: "Apri Run Console", to: "/agent-runs" },
      });
    }
  }

  try {
    const aiW = await getAgentAiHandoffWarnings(brainId ?? null);
    for (const w of aiW) warnings.push(w);
  } catch {
    // non-blocking
  }

  return warnings;
}

// ============================================================
// v3.6 — AI Handoff (manual, no external API)
// ============================================================

function simpleHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16);
}

function formatAgentPermissionsForPrompt(agent: Agent): string[] {
  const lines: string[] = [];
  lines.push(`- max_risk_level: ${agent.max_risk_level ?? "low"}`);
  lines.push(`- requires_approval: ${agent.requires_approval ?? true}`);
  if (Array.isArray(agent.allowed_tools)) {
    lines.push(`- allowed_tools: ${agent.allowed_tools.join(", ") || "—"}`);
  }
  return lines;
}

export async function buildAgentAiPrompt(
  runId: string,
  provider: AiProvider,
): Promise<{ prompt: string; hash: string }> {
  const run = await getAgentRun(runId);
  const agent = await getAgent(run.agent_id);
  const preview = run.output_json as Partial<AgentRunPreview>;
  const context = (run.input_context ?? {}) as Record<string, unknown>;

  const lines: string[] = [];
  lines.push(`# Brain Hub — Agent AI Handoff`);
  lines.push(`Provider richiesto: ${AI_PROVIDER_LABEL[provider]}`);
  lines.push("");
  lines.push(`## Agente`);
  lines.push(`- nome: ${agent.name}`);
  lines.push(`- ruolo: ${agent.role}`);
  lines.push(`- status: ${agent.status}`);
  lines.push(...formatAgentPermissionsForPrompt(agent));
  lines.push("");
  lines.push(`## Obiettivo run`);
  lines.push(run.objective);
  lines.push("");
  lines.push(`## Contesto selezionato`);
  lines.push("```json");
  lines.push(JSON.stringify(context, null, 2));
  lines.push("```");
  lines.push("");
  lines.push(`## Output euristico già generato da Brain Hub`);
  lines.push(preview.summary ?? run.output_summary ?? "(nessun summary)");
  if (Array.isArray(preview.bullets)) {
    for (const b of preview.bullets) lines.push(`- ${b}`);
  }
  if (preview.suggested_action) {
    lines.push("");
    lines.push(`### Action già suggerita (euristica)`);
    lines.push(`- title: ${preview.suggested_action.title}`);
    lines.push(`- type: ${preview.suggested_action.action_type}`);
    lines.push(`- risk: ${preview.suggested_action.risk_level}`);
    lines.push(`- description: ${preview.suggested_action.description}`);
  }
  lines.push("");
  lines.push(`## Vincoli di sicurezza (OBBLIGATORI)`);
  lines.push(`- Non inventare dati: usa solo il contesto fornito.`);
  lines.push(`- Non proporre azioni fuori dai permessi dichiarati sopra.`);
  lines.push(`- Rispetta il risk level massimo: "${agent.max_risk_level ?? "low"}".`);
  lines.push(`- Non chiedere accessi non previsti (Drive/Calendar/GitHub/Telegram/n8n).`);
  lines.push(`- Non suggerire automazioni non approvate dall'utente.`);
  lines.push(`- Tutte le azioni dovranno passare da Action Queue / Result Review manuali.`);
  lines.push("");
  lines.push(`## Formato output richiesto (Markdown con sezioni)`);
  lines.push(`### summary`);
  lines.push(`### findings`);
  lines.push(`### recommended_actions`);
  lines.push(`### risks`);
  lines.push(`### missing_information`);
  lines.push(`### next_step`);
  lines.push(`### action_queue_candidates`);
  lines.push("");
  lines.push(
    `Rispondi in italiano. Non eseguire azioni: produci solo testo da incollare in Brain Hub.`,
  );

  const prompt = lines.join("\n");
  const hash = simpleHash(prompt);

  await updateAgentRun(runId, {
    ai_prompt_text: prompt,
    ai_provider: provider,
    ai_handoff_status: "prompt_ready" as AiHandoffStatus,
    metadata: {
      ...(run.metadata ?? {}),
      ai_prompt_hash: hash,
      ai_prompt_built_at: new Date().toISOString(),
    },
  });

  await logEvent("agent_ai_prompt_built", "Prompt AI agente costruito", {
    run_id: runId,
    agent_id: agent.id,
    provider,
    prompt_hash: hash,
  });
  return { prompt, hash };
}

export async function copyAgentAiPrompt(runId: string): Promise<void> {
  const now = new Date().toISOString();
  await updateAgentRun(runId, {
    ai_handoff_status: "prompt_copied" as AiHandoffStatus,
    ai_prompt_copied_at: now,
  });
  await logEvent("agent_ai_prompt_copied", "Prompt AI agente copiato", {
    run_id: runId,
    copied_at: now,
  });
}

export async function saveAgentAiResult(
  runId: string,
  resultText: string,
): Promise<AgentRunLog> {
  const trimmed = resultText.trim();
  if (!trimmed) throw new Error("Risultato vuoto");
  const now = new Date().toISOString();
  const next = await updateAgentRun(runId, {
    ai_result_text: trimmed,
    ai_handoff_status: "result_received" as AiHandoffStatus,
    ai_result_received_at: now,
  });
  await logEvent("agent_ai_result_saved", "Risultato AI agente salvato", {
    run_id: runId,
    chars: trimmed.length,
  });
  return next;
}

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high"];

function riskRank(r: RiskLevel | string | null | undefined): number {
  const idx = RISK_ORDER.indexOf((r ?? "low") as RiskLevel);
  return idx < 0 ? 0 : idx;
}

type PriorityLevel = "low" | "medium" | "high";

export type ExtractedAiSuggestedAction = {
  title: string | null;
  description: string | null;
  action_type: ActionType | null;
  risk_level: RiskLevel | null;
  priority: PriorityLevel | null;
  verification: string | null;
};

function normalizeRiskLevel(v: string | null | undefined): RiskLevel | null {
  if (!v) return null;
  const s = v.toLowerCase().trim();
  if (s === "low" || s === "medium" || s === "high") return s;
  return null;
}

function normalizePriority(v: string | null | undefined): PriorityLevel | null {
  if (!v) return null;
  const s = v.toLowerCase().trim();
  if (s === "low" || s === "medium" || s === "high") return s;
  return null;
}

// Robust scalar field extractor for a YAML/markdown-ish block.
// Matches: `key: value`, `key: "value"`, `- key: value`, `**key:** value`.
function extractField(block: string, key: string): string | null {
  const re = new RegExp(
    `^[\\s\\-*]*(?:\\*\\*)?\\s*${key}\\s*(?:\\*\\*)?\\s*[:=]\\s*["']?([^"'\\n\\r]+?)["']?\\s*$`,
    "im",
  );
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

function tryJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pickFromJsonCandidate(
  obj: unknown,
): ExtractedAiSuggestedAction | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title : null;
  const description =
    typeof o.description === "string" ? o.description : null;
  const action_type =
    typeof o.action_type === "string" ? (o.action_type as ActionType) : null;
  const risk_level = normalizeRiskLevel(
    typeof o.risk_level === "string" ? o.risk_level : null,
  );
  const priority = normalizePriority(
    typeof o.priority === "string" ? o.priority : null,
  );
  const verification =
    typeof o.verification === "string" ? o.verification : null;
  if (
    !title &&
    !description &&
    !action_type &&
    !risk_level &&
    !priority &&
    !verification
  ) {
    return null;
  }
  return { title, description, action_type, risk_level, priority, verification };
}

function extractFirstBlockAfter(
  text: string,
  headerRegex: RegExp,
): string | null {
  const m = text.match(headerRegex);
  if (!m || m.index === undefined) return null;
  const after = text.slice(m.index + m[0].length);
  const stop = after.search(
    /\n(?:#{1,6}\s|action_queue_candidates\b|recommended_actions\b)/i,
  );
  return stop >= 0 ? after.slice(0, stop) : after;
}

export function extractSuggestedActionFromAiResult(
  aiResultText: string | null | undefined,
): ExtractedAiSuggestedAction {
  const empty: ExtractedAiSuggestedAction = {
    title: null,
    description: null,
    action_type: null,
    risk_level: null,
    priority: null,
    verification: null,
  };
  if (!aiResultText) return empty;
  const text = aiResultText;

  // 1) JSON: full doc or fenced ```json blocks.
  const candidates: unknown[] = [];
  const fullJson = tryJsonParse(text.trim());
  if (fullJson) candidates.push(fullJson);
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fm: RegExpExecArray | null;
  while ((fm = fenceRe.exec(text)) !== null) {
    const parsed = tryJsonParse(fm[1].trim());
    if (parsed) candidates.push(parsed);
  }
  const pickFromContainer = (
    container: unknown,
  ): ExtractedAiSuggestedAction | null => {
    if (!container || typeof container !== "object") return null;
    const c = container as Record<string, unknown>;
    const aqc = c.action_queue_candidates;
    if (Array.isArray(aqc) && aqc.length > 0) {
      const got = pickFromJsonCandidate(aqc[0]);
      if (got) return got;
    }
    const rec = c.recommended_actions;
    if (Array.isArray(rec) && rec.length > 0) {
      const got = pickFromJsonCandidate(rec[0]);
      if (got) return got;
    }
    const sa = c.suggested_action;
    if (sa) {
      const got = pickFromJsonCandidate(sa);
      if (got) return got;
    }
    return pickFromJsonCandidate(container);
  };
  for (const cand of candidates) {
    const got = pickFromContainer(cand);
    if (got) return got;
  }

  // 2) Markdown/YAML-ish: prefer action_queue_candidates, then recommended_actions.
  const aqcBlock = extractFirstBlockAfter(
    text,
    /(?:^|\n)\s*(?:#{1,6}\s*)?action_queue_candidates\s*:?\s*\n/i,
  );
  const recBlock = extractFirstBlockAfter(
    text,
    /(?:^|\n)\s*(?:#{1,6}\s*)?recommended_actions\s*:?\s*\n/i,
  );

  const fromBlock = (block: string): ExtractedAiSuggestedAction => ({
    title: extractField(block, "title"),
    description: extractField(block, "description"),
    action_type: extractField(block, "action_type") as ActionType | null,
    risk_level: normalizeRiskLevel(extractField(block, "risk_level")),
    priority: normalizePriority(extractField(block, "priority")),
    verification: extractField(block, "verification"),
  });

  const hasAny = (g: ExtractedAiSuggestedAction): boolean =>
    !!(g.title || g.action_type || g.risk_level || g.priority || g.description);

  if (aqcBlock) {
    const got = fromBlock(aqcBlock);
    if (hasAny(got)) return got;
  }
  if (recBlock) {
    const got = fromBlock(recBlock);
    if (hasAny(got)) return got;
  }

  // 3) Fallback: scan whole text for top-level fields.
  return {
    title: extractField(text, "title"),
    description: extractField(text, "description"),
    action_type: extractField(text, "action_type") as ActionType | null,
    risk_level: normalizeRiskLevel(extractField(text, "risk_level")),
    priority: normalizePriority(extractField(text, "priority")),
    verification: extractField(text, "verification"),
  };
}

export async function createActionFromAgentAiResult(
  runId: string,
): Promise<AutomationAction> {
  const run = await getAgentRun(runId);
  if (!run.ai_result_text) throw new Error("Nessun risultato AI salvato");
  const agent = await getAgent(run.agent_id);
  const preview = run.output_json as Partial<AgentRunPreview>;
  const extracted = extractSuggestedActionFromAiResult(run.ai_result_text);

  // Real risk = AI-declared risk if present, else heuristic, else run.
  const inferredRisk = (extracted.risk_level ??
    preview.suggested_action?.risk_level ??
    run.risk_level ??
    "low") as RiskLevel;
  const agentMaxRisk = (agent.max_risk_level ?? "low") as RiskLevel;
  const exceeds = riskRank(inferredRisk) > riskRank(agentMaxRisk);
  const action_type = (extracted.action_type ??
    preview.suggested_action?.action_type ??
    "agent_recommendation") as ActionType;
  const aiPriority = extracted.priority;
  const priority: PriorityLevel = exceeds ? "high" : (aiPriority ?? "medium");

  const permissionWarning = exceeds
    ? "Il rischio reale stimato supera il livello massimo consentito per questo agente. Richiede revisione manuale."
    : null;

  const baseTitle = extracted.title ?? `AI handoff: ${run.objective}`;
  const title = exceeds ? `⚠️ ${baseTitle}` : baseTitle;

  const action = await createAction({
    source: "agent_center",
    action_type,
    title,
    description: extracted.description ?? run.ai_result_text.slice(0, 2000),
    risk_level: inferredRisk,
    priority,
    brain_id: run.brain_id,
    metadata: {
      agent_run_id: run.id,
      agent_id: agent.id,
      ai_provider: run.ai_provider ?? null,
      ai_handoff_status: "action_created",
      objective: run.objective,
      original_risk_level: inferredRisk,
      agent_max_risk_level: agentMaxRisk,
      risk_exceeds_agent_permission: exceeds,
      risk_clamp_reason: exceeds
        ? "real_risk_preserved_for_transparency"
        : null,
      permission_warning: permissionWarning,
      ai_extracted_priority: aiPriority,
      ai_extracted_verification: extracted.verification,
      ai_extracted_action_type: extracted.action_type,
      ai_extracted_risk_level: extracted.risk_level,
    },
  });

  // Mark run metadata for QA visibility (non-destructive merge).
  const prevMeta = (run.metadata as Record<string, unknown> | null) ?? {};
  await updateAgentRun(runId, {
    suggested_action_id: action.id,
    ai_handoff_status: "action_created" as AiHandoffStatus,
    run_status: "action_created" as AgentRunStatus,
    metadata: {
      ...prevMeta,
      ai_risk_warning: exceeds,
      ai_original_risk_level: inferredRisk,
      ai_agent_max_risk_level: agentMaxRisk,
    },
  });
  await logEvent(
    "agent_ai_action_created",
    "Action creata da risultato AI agente",
    {
      run_id: runId,
      action_id: action.id,
      agent_id: agent.id,
      original_risk_level: inferredRisk,
      agent_max_risk_level: agentMaxRisk,
      risk_exceeds_agent_permission: exceeds,
    },
  );
  if (exceeds) {
    await logEvent(
      "agent_ai_risk_warning_created",
      "Action AI con rischio superiore al max permesso all'agente",
      {
        run_id: runId,
        action_id: action.id,
        agent_id: agent.id,
        original_risk_level: inferredRisk,
        agent_max_risk_level: agentMaxRisk,
      },
    );
  }
  return action;
}

export async function createReviewFromAgentAiResult(
  runId: string,
): Promise<ResultReviewItem> {
  const run = await getAgentRun(runId);
  if (!run.ai_result_text) throw new Error("Nessun risultato AI salvato");
  const agent = await getAgent(run.agent_id);
  const promptPreview = (run.ai_prompt_text ?? "").slice(0, 500);
  const promptHash =
    (run.metadata as Record<string, unknown> | null)?.["ai_prompt_hash"] ??
    null;

  const review = await createReviewItem({
    source_type: "agent_run" as ReviewSourceType,
    source_id: run.id,
    title: `AI handoff: ${run.objective}`,
    result_text: run.ai_result_text,
    brain_id: run.brain_id,
    risk_level: run.risk_level,
    metadata: {
      agent_run_id: run.id,
      agent_id: agent.id,
      ai_provider: run.ai_provider ?? null,
      objective: run.objective,
      prompt_preview: promptPreview,
      prompt_hash: promptHash,
    },
  });

  await updateAgentRun(runId, {
    result_review_item_id: review.id,
    ai_handoff_status: "review_created" as AiHandoffStatus,
    run_status: "review_created" as AgentRunStatus,
  });
  await logEvent(
    "agent_ai_review_created",
    "Review creata da risultato AI agente",
    { run_id: runId, review_id: review.id },
  );
  return review;
}

export async function createNextActionFromAgentAiResult(
  runId: string,
): Promise<AutomationAction> {
  const run = await getAgentRun(runId);
  if (!run.ai_result_text) throw new Error("Nessun risultato AI salvato");
  const agent = await getAgent(run.agent_id);
  const agentMaxRisk = (agent.max_risk_level ?? "low") as RiskLevel;
  const risk: RiskLevel = "low";

  const action = await createAction({
    source: "agent_center",
    action_type: "agent_recommendation" as ActionType,
    title: `Next step (AI): ${run.objective}`,
    description:
      "Prossimo step derivato dal risultato AI dell'agente. Da revisionare manualmente.",
    risk_level: risk,
    priority: "medium",
    brain_id: run.brain_id,
    metadata: {
      agent_run_id: run.id,
      agent_id: agent.id,
      ai_provider: run.ai_provider ?? null,
      derived_from: "agent_ai_result",
      objective: run.objective,
      original_risk_level: risk,
      agent_max_risk_level: agentMaxRisk,
      risk_exceeds_agent_permission: false,
    },
  });

  await logEvent(
    "agent_ai_next_action_created",
    "Next action creata da risultato AI agente",
    { run_id: runId, action_id: action.id },
  );
  return action;
}

export async function getAgentAiHandoffWarnings(
  brainId?: string | null,
): Promise<AgentRunWarning[]> {
  const warnings: AgentRunWarning[] = [];
  const runs = await listAgentRuns(brainId ?? null);
  for (const r of runs) {
    const status = r.ai_handoff_status ?? "not_started";
    if (status === "prompt_copied" && !r.ai_result_text) {
      warnings.push({
        id: `aai-copied-no-result-${r.id}`,
        level: "info",
        title: "Prompt AI copiato senza risultato",
        description: `"${r.objective}": prompt copiato ma nessun risultato AI salvato.`,
        cta: { label: "Apri Run Console", to: "/agent-runs" },
      });
    }
    if (status === "result_received" && !r.result_review_item_id) {
      warnings.push({
        id: `aai-result-no-review-${r.id}`,
        level: "warning",
        title: "Risultato AI senza review",
        description: `"${r.objective}": risultato AI salvato ma nessuna Result Review.`,
        cta: { label: "Apri Run Console", to: "/agent-runs" },
      });
    }
    if (status === "result_received" && !r.suggested_action_id) {
      warnings.push({
        id: `aai-result-no-action-${r.id}`,
        level: "info",
        title: "Risultato AI senza action",
        description: `"${r.objective}": risultato AI salvato ma nessuna action creata.`,
        cta: { label: "Apri Run Console", to: "/agent-runs" },
      });
    }
    const preview = r.output_json as Partial<AgentRunPreview>;
    if (
      r.run_status === "completed" &&
      preview?.suggests_code_handoff &&
      (!status || status === "not_started")
    ) {
      warnings.push({
        id: `aai-suggest-handoff-${r.id}`,
        level: "info",
        title: "Solo output euristico — AI handoff consigliato",
        description: `"${r.objective}": l'agente suggerisce un AI handoff non ancora avviato.`,
        cta: { label: "Apri Run Console", to: "/agent-runs" },
      });
    }
    const meta = (r.metadata as Record<string, unknown> | null) ?? {};
    if (meta["ai_risk_warning"] === true) {
      warnings.push({
        id: `aai-risk-exceeds-${r.id}`,
        level: "warning",
        title: "Action AI oltre il max risk dell'agente",
        description: `"${r.objective}": rischio reale ${String(meta["ai_original_risk_level"] ?? "?")} > permesso ${String(meta["ai_agent_max_risk_level"] ?? "?")}.`,
        cta: { label: "Apri Action Queue", to: "/action-queue" },
      });
    }
  }
  return warnings;
}
