// Brain Hub v3.4 — Codex / Claude Code Handoff Console
// Manual-first. NESSUNA API Codex/Claude/GitHub chiamata.
// Nessun commit, push, PR o esecuzione codice automatica.
// Solo prompt manuali, salvataggio risultato, Result Review, Next Action.

import { supabase } from "@/integrations/supabase/client";
import type { LogEventType } from "@/lib/automation-run";
import {
  createAction,
  type ActionType,
  type AutomationAction,
} from "@/lib/action-queue";
import {
  createReviewItem,
  type ResultReviewItem,
} from "@/lib/result-review";

// ============================================================
// Types
// ============================================================

export type HandoffEngine =
  | "codex"
  | "claude_code"
  | "cursor"
  | "github"
  | "manual_developer";

export const ENGINE_LABEL: Record<HandoffEngine, string> = {
  codex: "Codex (OpenAI)",
  claude_code: "Claude Code",
  cursor: "Cursor",
  github: "GitHub",
  manual_developer: "Sviluppatore manuale",
};

export type HandoffStatus =
  | "draft"
  | "ready"
  | "copied"
  | "sent_manually"
  | "result_received"
  | "review_created"
  | "next_action_created"
  | "completed"
  | "failed";

export const HANDOFF_STATUS_LABEL: Record<HandoffStatus, string> = {
  draft: "Bozza",
  ready: "Pronto",
  copied: "Prompt copiato",
  sent_manually: "Inviato manualmente",
  result_received: "Risultato ricevuto",
  review_created: "Review creata",
  next_action_created: "Next action creata",
  completed: "Completato",
  failed: "Fallito",
};

export const HANDOFF_STATUS_TONE: Record<HandoffStatus, string> = {
  draft: "bg-muted text-muted-foreground border-muted",
  ready: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  copied: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  sent_manually: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  result_received: "bg-indigo-500/10 text-indigo-600 border-indigo-500/30",
  review_created: "bg-violet-500/10 text-violet-600 border-violet-500/30",
  next_action_created: "bg-violet-500/10 text-violet-600 border-violet-500/30",
  completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  failed: "bg-red-500/10 text-red-600 border-red-500/30",
};

export type CodeEngineHandoff = {
  id: string;
  user_id: string;
  brain_id: string | null;
  project_id: string | null;
  repository_id: string | null;
  action_id: string | null;
  engine: HandoffEngine | string;
  handoff_status: HandoffStatus | string;
  prompt_text: string;
  prompt_context: Record<string, unknown>;
  result_text: string | null;
  result_metadata: Record<string, unknown>;
  result_review_item_id: string | null;
  next_action_id: string | null;
  copied_at: string | null;
  sent_manually_at: string | null;
  result_received_at: string | null;
  reviewed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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

export async function logCodeEngineHandoffEvent(
  action: LogEventType,
  notes: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await logEvent(action, notes, metadata);
}

// ============================================================
// Repo / Action loaders
// ============================================================

type GithubRepoLite = {
  id: string;
  repository_url: string;
  repository_owner: string | null;
  repository_name: string | null;
  default_branch: string | null;
};

async function loadActionById(actionId: string): Promise<AutomationAction> {
  const { data, error } = await supabase
    .from("automation_actions" as never)
    .select("*")
    .eq("id", actionId)
    .single();
  if (error) throw error;
  return data as unknown as AutomationAction;
}

async function loadRepoById(repoId: string | null): Promise<GithubRepoLite | null> {
  if (!repoId) return null;
  const { data } = await supabase
    .from("github_repository_registry" as never)
    .select("id,repository_url,repository_owner,repository_name,default_branch")
    .eq("id", repoId)
    .maybeSingle();
  return data ? (data as unknown as GithubRepoLite) : null;
}

// ============================================================
// CRUD
// ============================================================

export async function listCodeEngineHandoffs(
  brainId?: string | null,
): Promise<CodeEngineHandoff[]> {
  let q = supabase
    .from("code_engine_handoffs" as never)
    .select("*")
    .order("created_at", { ascending: false });
  if (brainId) q = q.eq("brain_id", brainId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as CodeEngineHandoff[];
}

export async function getCodeEngineHandoff(id: string): Promise<CodeEngineHandoff> {
  const { data, error } = await supabase
    .from("code_engine_handoffs" as never)
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as unknown as CodeEngineHandoff;
}

async function patchHandoff(
  id: string,
  patch: Partial<CodeEngineHandoff>,
): Promise<CodeEngineHandoff> {
  const { data, error } = await supabase
    .from("code_engine_handoffs" as never)
    .update(patch as never)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as CodeEngineHandoff;
}

// ============================================================
// Prompt builders
// ============================================================

export type PromptBuilderInput = {
  engine: HandoffEngine;
  action: AutomationAction;
  repo: GithubRepoLite | null;
  file_path?: string | null;
};

function repoBlock(repo: GithubRepoLite | null): string {
  if (!repo) return "Repository: (non specificato)";
  return [
    `Repository: ${repo.repository_url}`,
    repo.repository_owner && repo.repository_name
      ? `Owner/Name: ${repo.repository_owner}/${repo.repository_name}`
      : null,
    repo.default_branch ? `Branch: ${repo.default_branch}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildCodexHandoffPrompt(input: PromptBuilderInput): string {
  const { action, repo, file_path } = input;
  const meta = action.metadata ?? {};
  const file =
    file_path ??
    (typeof meta.file_path === "string" ? (meta.file_path as string) : null);
  const reason = typeof meta.reason === "string" ? (meta.reason as string) : null;
  return [
    "# Codex — Operational Handoff (Brain Hub)",
    "",
    repoBlock(repo),
    file ? `File coinvolti: ${file}` : "File coinvolti: (da identificare)",
    "",
    `## Action type`,
    action.action_type,
    "",
    `## Obiettivo`,
    action.title,
    "",
    `## Descrizione / contesto`,
    action.description ?? "(nessuna descrizione)",
    reason ? `\n## Motivazione\n${reason}` : "",
    "",
    "## Vincoli",
    "- Manual-first: NESSUN commit automatico.",
    "- NESSUN push o PR.",
    "- Non modificare aree fuori scope.",
    "- Non inventare file/API non presenti nel repository.",
    "- Se il file non esiste, segnalalo invece di crearlo.",
    "",
    "## Cosa NON toccare",
    "- auth, login, signup, sessioni",
    "- policy RLS Supabase",
    "- layout globale, sidebar, route shell",
    "- secrets, env vars",
    "",
    "## Criteri di successo",
    "- Build pulita (no TS errors)",
    "- Nessun errore console",
    "- Comportamento richiesto coerente con obiettivo",
    "",
    "## Output richiesto",
    "1. Riepilogo modifiche (bullet)",
    "2. File toccati (path)",
    "3. Diff/snippet proposti",
    "4. Rischi identificati",
    "5. Test suggeriti",
    "6. Eventuali next step",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildClaudeCodeHandoffPrompt(input: PromptBuilderInput): string {
  const { action, repo, file_path } = input;
  const meta = action.metadata ?? {};
  const file =
    file_path ??
    (typeof meta.file_path === "string" ? (meta.file_path as string) : null);
  return [
    "# Claude Code — Operational Handoff (Brain Hub)",
    "",
    "## Contesto repo",
    repoBlock(repo),
    "",
    "## File target",
    file ?? "(da identificare insieme — non inventare)",
    "",
    "## Task tecnico",
    action.title,
    "",
    action.description ? `### Dettagli\n${action.description}` : "",
    "",
    "## Checklist operativa",
    "- [ ] Leggere i file target prima di modificare",
    "- [ ] Confermare che il file esiste davvero",
    "- [ ] Proporre patch chirurgica (no rewrite di interi file)",
    "- [ ] Spiegare ogni cambiamento",
    "- [ ] Segnalare rischi e regressioni",
    "- [ ] NON eseguire build/test che modificano stato remoto",
    "",
    "## Istruzioni anti-scope-creep",
    "- Non modificare file fuori dalla lista target.",
    "- Non rifattorizzare codice non richiesto.",
    "- Non aggiungere dipendenze senza segnalarlo.",
    "- Non inventare API, hook o file che non esistono nel repo.",
    "",
    "## Richiesta",
    "- Restituisci patch/fix spiegato in formato diff o snippet.",
    "- Aggiungi sezione 'Rischi' e 'Test consigliati'.",
    "- Indica se servono follow-up.",
    "",
    "## Vincoli di sicurezza",
    "- Nessun commit, push o PR automatico.",
    "- Nessuna esecuzione su repository remoto.",
    "- Tutto manual-first: l'utente revisiona prima di applicare.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ============================================================
// Create handoff from action
// ============================================================

export async function createCodeEngineHandoffFromAction(
  actionId: string,
  engine: HandoffEngine,
): Promise<CodeEngineHandoff> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");

  const action = await loadActionById(actionId);
  const meta = action.metadata ?? {};
  const repoId =
    typeof meta.repository_id === "string" ? (meta.repository_id as string) : null;
  const repo = await loadRepoById(repoId);
  const file_path =
    typeof meta.file_path === "string" ? (meta.file_path as string) : null;

  const prompt =
    engine === "claude_code"
      ? buildClaudeCodeHandoffPrompt({ engine, action, repo, file_path })
      : buildCodexHandoffPrompt({ engine, action, repo, file_path });

  const payload = {
    user_id: u.user.id,
    brain_id: action.brain_id,
    project_id: action.project_id,
    repository_id: repoId,
    action_id: action.id,
    engine,
    handoff_status: "ready" as HandoffStatus,
    prompt_text: prompt,
    prompt_context: {
      action_type: action.action_type,
      action_title: action.title,
      file_path,
      repository_id: repoId,
    },
    metadata: { source: "action_queue" },
  };

  const { data, error } = await supabase
    .from("code_engine_handoffs" as never)
    .insert(payload as never)
    .select()
    .single();
  if (error) throw error;
  const h = data as unknown as CodeEngineHandoff;

  await logEvent("code_handoff_created", `Handoff creato per ${engine}`, {
    handoff_id: h.id,
    engine,
    action_id: action.id,
    repository_id: repoId,
  });
  await logEvent(
    engine === "claude_code" ? "claude_code_handoff_created" : "codex_handoff_created",
    `Prompt ${ENGINE_LABEL[engine]} preparato`,
    { handoff_id: h.id, action_id: action.id },
  );
  return h;
}

// ============================================================
// Lifecycle helpers
// ============================================================

export async function copyHandoffPrompt(id: string): Promise<string> {
  const h = await getCodeEngineHandoff(id);
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(h.prompt_text);
    }
  } catch {
    // ignore — return text anyway
  }
  await patchHandoff(id, {
    handoff_status: "copied",
    copied_at: new Date().toISOString(),
  });
  await logEvent("code_handoff_prompt_copied", `Prompt handoff copiato`, {
    handoff_id: id,
    engine: h.engine,
  });
  return h.prompt_text;
}

export async function markHandoffSentManually(id: string): Promise<CodeEngineHandoff> {
  const next = await patchHandoff(id, {
    handoff_status: "sent_manually",
    sent_manually_at: new Date().toISOString(),
  });
  await logEvent("code_handoff_sent_manually", `Handoff segnato come inviato`, {
    handoff_id: id,
    engine: next.engine,
  });
  return next;
}

export async function saveHandoffResult(
  id: string,
  result: { text: string; metadata?: Record<string, unknown> },
): Promise<CodeEngineHandoff> {
  const next = await patchHandoff(id, {
    handoff_status: "result_received",
    result_text: result.text,
    result_metadata: result.metadata ?? {},
    result_received_at: new Date().toISOString(),
  });
  await logEvent("code_handoff_result_saved", `Risultato handoff salvato`, {
    handoff_id: id,
    engine: next.engine,
    length: result.text.length,
  });
  return next;
}

function previewText(text: string, max = 240): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

// Stable FNV-1a hash (not for security; just dedupe identifier)
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export async function createReviewFromHandoff(id: string): Promise<ResultReviewItem> {
  const h = await getCodeEngineHandoff(id);
  if (!h.result_text) {
    throw new Error("Nessun risultato salvato: incolla prima il risultato.");
  }
  const fileFromCtx =
    typeof h.prompt_context.file_path === "string"
      ? (h.prompt_context.file_path as string)
      : null;

  const review = await createReviewItem({
    source_type: "code_engine_handoff" as never,
    source_id: h.id,
    title: `Risultato ${ENGINE_LABEL[(h.engine as HandoffEngine)] ?? h.engine}`,
    result_text: h.result_text,
    brain_id: h.brain_id,
    project_id: h.project_id,
    linked_action_id: h.action_id,
    metadata: {
      origin: "code_engine_handoff",
      handoff_id: h.id,
      engine: h.engine,
      action_id: h.action_id,
      repository_id: h.repository_id,
      file_path: fileFromCtx,
      prompt_preview: previewText(h.prompt_text),
      prompt_hash: fnv1a(h.prompt_text),
    },
  });

  await patchHandoff(id, {
    handoff_status: "review_created",
    result_review_item_id: review.id,
    reviewed_at: new Date().toISOString(),
  });
  await logEvent("code_handoff_review_created", `Review creata da handoff`, {
    handoff_id: id,
    review_id: review.id,
    engine: h.engine,
  });
  return review;
}

const NEXT_ACTION_TYPE_BY_SOURCE: Record<string, ActionType> = {
  code_review: "code_fix",
  code_fix: "code_test",
  code_refactor: "code_test",
  code_test: "code_deploy_check",
  code_deploy_check: "code_review",
  github_issue_draft: "code_review",
};

export async function createNextActionFromHandoff(
  id: string,
): Promise<AutomationAction> {
  const h = await getCodeEngineHandoff(id);
  const actionType: ActionType = (() => {
    const original =
      typeof h.prompt_context.action_type === "string"
        ? (h.prompt_context.action_type as string)
        : "code_review";
    return NEXT_ACTION_TYPE_BY_SOURCE[original] ?? "code_review";
  })();

  const title = `Next: ${actionType} dopo handoff ${ENGINE_LABEL[h.engine as HandoffEngine] ?? h.engine}`;
  const action = await createAction({
    source: "code_repository",
    action_type: actionType,
    title,
    description: previewText(h.result_text ?? "(nessun risultato)", 600),
    priority: "medium",
    brain_id: h.brain_id,
    project_id: h.project_id,
    metadata: {
      origin: "code_engine_handoff",
      handoff_id: h.id,
      engine: h.engine,
      repository_id: h.repository_id,
      file_path: h.prompt_context.file_path ?? null,
      requires_confirmation: true,
    },
  });

  await patchHandoff(id, {
    handoff_status: "next_action_created",
    next_action_id: action.id,
  });
  await logEvent("code_handoff_next_action_created", `Next action creata da handoff`, {
    handoff_id: id,
    next_action_id: action.id,
    engine: h.engine,
  });
  return action;
}

// ============================================================
// Summary + warnings
// ============================================================

export type CodeEngineHandoffSummary = {
  total: number;
  open: number;
  awaitingResult: number;
  awaitingReview: number;
  reviewed: number;
  lastEngine: HandoffEngine | string | null;
};

export async function getCodeEngineHandoffSummary(
  brainId?: string | null,
): Promise<CodeEngineHandoffSummary> {
  const items = await listCodeEngineHandoffs(brainId);
  let open = 0,
    awaitingResult = 0,
    awaitingReview = 0,
    reviewed = 0;
  for (const h of items) {
    if (
      h.handoff_status === "draft" ||
      h.handoff_status === "ready" ||
      h.handoff_status === "copied"
    ) {
      open++;
    }
    if (h.handoff_status === "sent_manually") awaitingResult++;
    if (h.handoff_status === "result_received") awaitingReview++;
    if (
      h.handoff_status === "review_created" ||
      h.handoff_status === "next_action_created" ||
      h.handoff_status === "completed"
    ) {
      reviewed++;
    }
  }
  return {
    total: items.length,
    open,
    awaitingResult,
    awaitingReview,
    reviewed,
    lastEngine: items[0]?.engine ?? null,
  };
}

export type CodeEngineHandoffWarning = {
  id: string;
  level: "warning" | "info" | "error";
  title: string;
  description: string;
  cta?: { label: string; to: string };
};

export async function getCodeEngineHandoffWarnings(
  brainId?: string | null,
): Promise<CodeEngineHandoffWarning[]> {
  const warnings: CodeEngineHandoffWarning[] = [];
  const items = await listCodeEngineHandoffs(brainId);

  // 1) Code action senza handoff
  let qa = supabase
    .from("automation_actions" as never)
    .select("id,title,action_type,created_at,brain_id,status")
    .in("action_type", [
      "code_review",
      "code_fix",
      "code_refactor",
      "code_test",
      "code_deploy_check",
      "github_issue_draft",
    ])
    .in("status", ["suggested", "pending_approval", "approved"])
    .limit(40);
  if (brainId) qa = qa.eq("brain_id", brainId);
  const { data: openActions } = await qa;
  const list = (openActions ?? []) as Array<{
    id: string;
    title: string;
    created_at: string;
  }>;
  const handoffActionIds = new Set(items.map((i) => i.action_id).filter(Boolean));
  for (const a of list) {
    if (!handoffActionIds.has(a.id)) {
      const ageHours = (Date.now() - new Date(a.created_at).getTime()) / 36e5;
      if (ageHours > 24) {
        warnings.push({
          id: `ceh-no-handoff-${a.id}`,
          level: "info",
          title: `Code action senza handoff: ${a.title}`,
          description:
            "Code action senza handoff Codex/Claude Code preparato dopo 24h.",
          cta: { label: "Apri Code Handoffs", to: "/code-handoffs" },
        });
      }
    }
  }

  for (const h of items) {
    const ageHours = (Date.now() - new Date(h.created_at).getTime()) / 36e5;
    if (h.handoff_status === "sent_manually" && ageHours > 24) {
      warnings.push({
        id: `ceh-no-result-${h.id}`,
        level: "warning",
        title: `Handoff inviato senza risultato`,
        description: `Handoff ${ENGINE_LABEL[h.engine as HandoffEngine] ?? h.engine} inviato manualmente da oltre 24h senza risultato salvato.`,
        cta: { label: "Apri handoff", to: "/code-handoffs" },
      });
    }
    if (h.handoff_status === "result_received" && ageHours > 24) {
      warnings.push({
        id: `ceh-no-review-${h.id}`,
        level: "warning",
        title: `Risultato handoff senza Result Review`,
        description: `Risultato ricevuto ma nessuna Result Review collegata da oltre 24h.`,
        cta: { label: "Apri handoff", to: "/code-handoffs" },
      });
    }
    if (h.handoff_status === "failed") {
      warnings.push({
        id: `ceh-failed-${h.id}`,
        level: "error",
        title: `Handoff fallito`,
        description: `Handoff segnato come failed: revisiona prima di rilanciare.`,
        cta: { label: "Apri handoff", to: "/code-handoffs" },
      });
    }
  }

  return warnings;
}
