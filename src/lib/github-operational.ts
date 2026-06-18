// Brain Hub v3.2 — GitHub / Codex Operational Connector
// Manual-first. No commits, no pushes, no PRs, no automatic GitHub calls.
// Solo registry, mappa file, prompt preparati e action suggerite.

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

export type GithubRepository = {
  id: string;
  user_id: string;
  brain_id: string | null;
  project_id: string | null;
  repository_url: string;
  repository_owner: string | null;
  repository_name: string | null;
  default_branch: string | null;
  connected_status: string;
  provider: string;
  last_sync_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type CodeFile = {
  id: string;
  user_id: string;
  brain_id: string | null;
  project_id: string | null;
  repository_id: string | null;
  file_path: string;
  file_type: string | null;
  importance: string | null;
  area: string | null;
  status: string;
  summary: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type CodeActionSuggestion = {
  id: string;
  repository_id: string;
  action_type: Extract<
    ActionType,
    | "code_review"
    | "code_fix"
    | "code_refactor"
    | "code_test"
    | "code_deploy_check"
    | "github_issue_draft"
  >;
  title: string;
  description: string;
  file_path?: string | null;
  reason: string;
};

export type SupportedEngine =
  | "codex"
  | "claude_code"
  | "cursor"
  | "github"
  | "manual_developer";

export const ENGINE_LABEL: Record<SupportedEngine, string> = {
  codex: "Codex (OpenAI)",
  claude_code: "Claude Code",
  cursor: "Cursor",
  github: "GitHub",
  manual_developer: "Sviluppatore manuale",
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

export async function logGithubOperationalEvent(
  action: LogEventType,
  notes: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await logEvent(action, notes, metadata);
}

// ============================================================
// Repository registry
// ============================================================

import {
  parseGithubRepositoryInput,
  type GithubRepositoryParseErrorCode,
} from "./github-repository-parse";

export type CreateRepositoryInput = {
  brain_id?: string | null;
  project_id?: string | null;
  repository_url: string;
  repository_owner?: string | null;
  repository_name?: string | null;
  default_branch?: string | null;
  metadata?: Record<string, unknown>;
};

export class GithubRepositoryRegistryError extends Error {
  constructor(
    public code:
      | "github_repository_url_invalid"
      | "github_repository_already_exists"
      | "not_authenticated",
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "GithubRepositoryRegistryError";
  }
}

export type ListRepositoriesOptions = {
  includeArchived?: boolean;
};

export async function listGithubRepositories(
  brainId?: string | null,
  options: ListRepositoriesOptions = {},
): Promise<GithubRepository[]> {
  let q = supabase
    .from("github_repository_registry" as never)
    .select("*")
    .order("created_at", { ascending: false });
  if (brainId) q = q.eq("brain_id", brainId);
  if (!options.includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as unknown) as GithubRepository[];
}

function previewForLog(value: string | null | undefined): string {
  if (!value) return "";
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 80 ? compact.slice(0, 80) + "…" : compact;
}

export async function createGithubRepository(
  input: CreateRepositoryInput,
): Promise<GithubRepository> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) {
    throw new GithubRepositoryRegistryError(
      "not_authenticated",
      "Non autenticato",
    );
  }

  // Server-side normalization: ignore client owner/name, derive from URL.
  const parsed = parseGithubRepositoryInput(input.repository_url);
  if (!parsed.isValid) {
    await logEvent(
      "github_repository_input_rejected",
      `Input rifiutato: ${parsed.errorCode}`,
      { error_code: parsed.errorCode, input_preview: previewForLog(input.repository_url) },
    );
    throw new GithubRepositoryRegistryError(
      "github_repository_url_invalid",
      `URL repository non valido (${parsed.errorCode})`,
      { error_code: parsed.errorCode },
    );
  }

  // Application-level dedup: find non-archived record with same normalized URL.
  const { data: existing, error: dupErr } = await supabase
    .from("github_repository_registry" as never)
    .select("id,archived_at")
    .eq("user_id", u.user.id)
    .eq("normalized_repository_url" as never, parsed.normalizedUrl)
    .is("archived_at" as never, null)
    .maybeSingle();
  if (dupErr && dupErr.code !== "PGRST116") {
    // fall through if not-found, otherwise surface
    throw dupErr;
  }
  if (existing) {
    await logEvent(
      "github_repository_duplicate_detected",
      `Repository già presente: ${parsed.url}`,
      { repository_url: parsed.url },
    );
    throw new GithubRepositoryRegistryError(
      "github_repository_already_exists",
      "Repository già presente",
      { repository_url: parsed.url },
    );
  }

  const payload = {
    user_id: u.user.id,
    brain_id: input.brain_id ?? null,
    project_id: input.project_id ?? null,
    repository_url: parsed.url,
    normalized_repository_url: parsed.normalizedUrl,
    repository_owner: parsed.owner,
    repository_name: parsed.name,
    default_branch: (input.default_branch ?? "main").trim() || "main",
    connected_status: "manual",
    provider: "github",
    metadata: input.metadata ?? {},
  };

  const { data, error } = await supabase
    .from("github_repository_registry" as never)
    .insert(payload as never)
    .select()
    .single();
  if (error) throw error;
  const repo = (data as unknown) as GithubRepository;
  await logEvent(
    "github_repository_input_normalized",
    `Repo aggiunto: ${parsed.url}`,
    { repository_id: repo.id, brain_id: repo.brain_id },
  );
  return repo;
}

export async function updateGithubRepository(
  id: string,
  patch: Partial<CreateRepositoryInput> & { connected_status?: string },
): Promise<GithubRepository> {
  const { data, error } = await supabase
    .from("github_repository_registry" as never)
    .update(patch as never)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  const repo = (data as unknown) as GithubRepository;
  await logEvent("github_repository_updated", `Repo aggiornato: ${repo.repository_url}`, {
    repository_id: repo.id,
  });
  return repo;
}

export async function archiveGithubRepository(
  id: string,
  reason: string = "manual",
): Promise<void> {
  const { error } = await supabase
    .from("github_repository_registry" as never)
    .update({
      connected_status: "archived",
      archived_at: new Date().toISOString(),
      archived_reason: reason,
    } as never)
    .eq("id", id);
  if (error) throw error;
  await logEvent("github_repository_archived", `Repo archiviato (${reason})`, {
    repository_id: id,
    reason,
  });
}

/**
 * Try to normalize a suspect record: if its repository_url field contains
 * (somewhere) a valid github URL, rewrite url/owner/name and clear suspicion.
 * Returns updated repo or null if normalization is not possible.
 */
export async function normalizeSuspectRepository(
  id: string,
  rawUrlField: string,
): Promise<GithubRepository | null> {
  const parsed = parseGithubRepositoryInput(rawUrlField);
  if (!parsed.isValid) return null;
  const { data, error } = await supabase
    .from("github_repository_registry" as never)
    .update({
      repository_url: parsed.url,
      normalized_repository_url: parsed.normalizedUrl,
      repository_owner: parsed.owner,
      repository_name: parsed.name,
    } as never)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  const repo = (data as unknown) as GithubRepository;
  await logEvent(
    "github_repository_normalized_from_garbage",
    `Repo normalizzato: ${parsed.url}`,
    { repository_id: repo.id },
  );
  return repo;
}

export type { GithubRepositoryParseErrorCode };


// ============================================================
// Code file map
// ============================================================

export type CodeFileFilters = {
  brain_id?: string | null;
  repository_id?: string | null;
  area?: string | null;
};

export type CreateCodeFileInput = {
  brain_id?: string | null;
  project_id?: string | null;
  repository_id?: string | null;
  file_path: string;
  file_type?: string | null;
  importance?: string | null;
  area?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown>;
};

export async function listCodeFileMap(
  filters: CodeFileFilters = {},
): Promise<CodeFile[]> {
  let q = supabase
    .from("code_file_map" as never)
    .select("*")
    .order("created_at", { ascending: false });
  if (filters.brain_id) q = q.eq("brain_id", filters.brain_id);
  if (filters.repository_id) q = q.eq("repository_id", filters.repository_id);
  if (filters.area) q = q.eq("area", filters.area);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as unknown) as CodeFile[];
}

export async function addCodeFileToMap(input: CreateCodeFileInput): Promise<CodeFile> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");
  const payload = {
    user_id: u.user.id,
    brain_id: input.brain_id ?? null,
    project_id: input.project_id ?? null,
    repository_id: input.repository_id ?? null,
    file_path: input.file_path,
    file_type: input.file_type ?? null,
    importance: input.importance ?? null,
    area: input.area ?? null,
    summary: input.summary ?? null,
    status: "mapped",
    metadata: input.metadata ?? {},
  };
  const { data, error } = await supabase
    .from("code_file_map" as never)
    .insert(payload as never)
    .select()
    .single();
  if (error) throw error;
  const file = (data as unknown) as CodeFile;
  await logEvent("code_file_mapped", `File mappato: ${file.file_path}`, {
    file_id: file.id,
    repository_id: file.repository_id,
    area: file.area,
  });
  return file;
}

export async function updateCodeFileMap(
  id: string,
  patch: Partial<CreateCodeFileInput> & { status?: string },
): Promise<CodeFile> {
  const { data, error } = await supabase
    .from("code_file_map" as never)
    .update(patch as never)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return (data as unknown) as CodeFile;
}

// ============================================================
// Suggestions
// ============================================================

const SUGGESTION_TEMPLATES: Array<{
  action_type: CodeActionSuggestion["action_type"];
  title: string;
  description: string;
  reason: string;
}> = [
  {
    action_type: "code_review",
    title: "Code review iniziale del repository",
    description:
      "Esegui una review manuale dei file critici (entry point, configurazione, sicurezza, RLS).",
    reason: "Repository appena collegato senza review registrate.",
  },
  {
    action_type: "code_test",
    title: "Verifica copertura test esistente",
    description:
      "Identifica componenti senza test e suggerisci aree dove aggiungere copertura.",
    reason: "Nessun riferimento esplicito a test nella mappa file.",
  },
  {
    action_type: "code_deploy_check",
    title: "Verifica readiness deployment",
    description:
      "Controlla build, env vars, migration pendenti, e configurazione produzione.",
    reason: "Repository connesso ma nessun deployment check registrato.",
  },
];

export async function suggestCodeActionsForRepository(
  repositoryId: string,
): Promise<CodeActionSuggestion[]> {
  const suggestions: CodeActionSuggestion[] = SUGGESTION_TEMPLATES.map((t, i) => ({
    id: `${repositoryId}-${t.action_type}-${i}`,
    repository_id: repositoryId,
    action_type: t.action_type,
    title: t.title,
    description: t.description,
    reason: t.reason,
  }));

  // Aggiungi suggerimenti puntuali su file marcati high importance senza review
  const files = await listCodeFileMap({ repository_id: repositoryId });
  for (const f of files) {
    if (f.importance === "high") {
      suggestions.push({
        id: `${repositoryId}-file-${f.id}`,
        repository_id: repositoryId,
        action_type: "code_review",
        title: `Review file critico: ${f.file_path}`,
        description: f.summary ?? "File marcato come ad alta importanza.",
        file_path: f.file_path,
        reason: "File con importance=high senza review collegata.",
      });
    }
  }

  await logEvent(
    "code_action_suggested",
    `Suggerimenti generati per repo`,
    { repository_id: repositoryId, count: suggestions.length },
  );
  return suggestions;
}

export async function createCodeActionFromSuggestion(
  suggestion: CodeActionSuggestion,
  opts: { brain_id?: string | null; project_id?: string | null } = {},
): Promise<AutomationAction> {
  const action = await createAction({
    source: "github_operational",
    action_type: suggestion.action_type,
    title: suggestion.title,
    description: suggestion.description,
    priority: "medium",
    brain_id: opts.brain_id ?? null,
    project_id: opts.project_id ?? null,
    metadata: {
      repository_id: suggestion.repository_id,
      file_path: suggestion.file_path ?? null,
      suggestion_id: suggestion.id,
      reason: suggestion.reason,
      requires_confirmation: true,
    },
  });
  await logEvent("code_action_created", `Code action creata: ${action.title}`, {
    action_id: action.id,
    repository_id: suggestion.repository_id,
  });
  return action;
}

// ============================================================
// Prompt / Issue draft builders (manual handoff)
// ============================================================

async function loadActionForPrompt(actionId: string): Promise<AutomationAction> {
  const { data, error } = await supabase
    .from("automation_actions" as never)
    .select("*")
    .eq("id", actionId)
    .single();
  if (error) throw error;
  return (data as unknown) as AutomationAction;
}

async function loadRepoMaybe(meta: Record<string, unknown>): Promise<GithubRepository | null> {
  const rid = typeof meta.repository_id === "string" ? meta.repository_id : null;
  if (!rid) return null;
  const { data } = await supabase
    .from("github_repository_registry" as never)
    .select("*")
    .eq("id", rid)
    .maybeSingle();
  return data ? ((data as unknown) as GithubRepository) : null;
}

function repoHeader(repo: GithubRepository | null): string {
  if (!repo) return "Repository: (non specificato)";
  return [
    `Repository: ${repo.repository_url}`,
    repo.default_branch ? `Branch: ${repo.default_branch}` : null,
    repo.repository_owner && repo.repository_name
      ? `Owner/Name: ${repo.repository_owner}/${repo.repository_name}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function buildCodexPromptForAction(actionId: string): Promise<string> {
  const a = await loadActionForPrompt(actionId);
  const repo = await loadRepoMaybe(a.metadata);
  const file = typeof a.metadata.file_path === "string" ? a.metadata.file_path : null;
  const prompt = [
    "# Codex Operational Prompt",
    "",
    repoHeader(repo),
    file ? `File: ${file}` : null,
    "",
    `## Task`,
    a.title,
    "",
    `## Descrizione`,
    a.description ?? "(nessuna descrizione)",
    "",
    "## Regole",
    "- NON eseguire commit automatici.",
    "- NON aprire PR automaticamente.",
    "- Proponi le modifiche come diff o snippet da revisionare manualmente.",
    "- Spiega ogni cambiamento.",
  ]
    .filter(Boolean)
    .join("\n");
  await logEvent("codex_prompt_built", `Prompt Codex preparato per action`, {
    action_id: a.id,
    repository_id: repo?.id ?? null,
  });
  return prompt;
}

export async function buildClaudeCodePromptForAction(actionId: string): Promise<string> {
  const a = await loadActionForPrompt(actionId);
  const repo = await loadRepoMaybe(a.metadata);
  const file = typeof a.metadata.file_path === "string" ? a.metadata.file_path : null;
  const prompt = [
    "# Claude Code Operational Prompt",
    "",
    repoHeader(repo),
    file ? `File: ${file}` : null,
    "",
    `## Obiettivo`,
    a.title,
    "",
    `## Contesto`,
    a.description ?? "(nessun contesto specificato)",
    "",
    "## Vincoli",
    "- Modalità manual-first: nessun commit, push o PR automatici.",
    "- Restituisci diff proposti e spiegazione.",
    "- Segnala rischi e file impattati.",
  ]
    .filter(Boolean)
    .join("\n");
  await logEvent("claude_code_prompt_built", `Prompt Claude Code preparato`, {
    action_id: a.id,
    repository_id: repo?.id ?? null,
  });
  return prompt;
}

export async function buildGithubIssueDraftForAction(actionId: string): Promise<{
  title: string;
  body: string;
}> {
  const a = await loadActionForPrompt(actionId);
  const repo = await loadRepoMaybe(a.metadata);
  const file = typeof a.metadata.file_path === "string" ? a.metadata.file_path : null;
  const draft = {
    title: `[Brain Hub] ${a.title}`,
    body: [
      repoHeader(repo),
      file ? `File: ${file}` : null,
      "",
      "## Descrizione",
      a.description ?? "(nessuna descrizione)",
      "",
      "## Origine",
      "Bozza generata da Brain Hub — GitHub Operational. Da revisionare prima di aprire l'issue.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
  await logEvent("github_issue_draft_built", `Bozza issue GitHub preparata`, {
    action_id: a.id,
    repository_id: repo?.id ?? null,
  });
  return draft;
}

// ============================================================
// Result Review integration
// ============================================================

export async function createGithubOperationalReview(input: {
  action_id: string;
  repository_id: string | null;
  engine: SupportedEngine;
  prompt: string;
  file_path?: string | null;
  brain_id?: string | null;
  project_id?: string | null;
  title?: string;
}): Promise<ResultReviewItem> {
  const review = await createReviewItem({
    source_type: "automation_action",
    source_id: input.action_id,
    title: input.title ?? `Review handoff codice (${ENGINE_LABEL[input.engine]})`,
    brain_id: input.brain_id ?? null,
    project_id: input.project_id ?? null,
    linked_action_id: input.action_id,
    metadata: {
      origin: "github_operational",
      repository_id: input.repository_id,
      engine: input.engine,
      file_path: input.file_path ?? null,
      prompt: input.prompt,
    },
  });
  await logEvent("github_operational_review_created", `Review creata per handoff codice`, {
    review_id: review.id,
    repository_id: input.repository_id,
    engine: input.engine,
  });
  return review;
}

// ============================================================
// Loop QA warnings
// ============================================================

export type GithubOperationalWarning = {
  id: string;
  level: "warning" | "info" | "error";
  title: string;
  description: string;
  cta?: { label: string; to: string };
};

export async function getGithubOperationalWarnings(
  brainId?: string | null,
): Promise<GithubOperationalWarning[]> {
  const warnings: GithubOperationalWarning[] = [];
  const repos = await listGithubRepositories(brainId ?? null);

  if (brainId && repos.length === 0) {
    warnings.push({
      id: `gho-no-repo-${brainId}`,
      level: "info",
      title: "Nessun repository collegato",
      description: "Il brain corrente non ha repository GitHub mappati.",
      cta: { label: "Apri GitHub Operational", to: "/github-operational" },
    });
  }

  for (const repo of repos) {
    const files = await listCodeFileMap({ repository_id: repo.id });
    if (files.length === 0) {
      warnings.push({
        id: `gho-no-files-${repo.id}`,
        level: "info",
        title: `Repo senza file mappati: ${repo.repository_url}`,
        description: "Aggiungi almeno un file importante alla mappa.",
        cta: { label: "Apri repo", to: "/github-operational" },
      });
    }
  }

  // Code action senza review
  const { data: openActions } = await supabase
    .from("automation_actions" as never)
    .select("id,title,status,source,created_at")
    .eq("source", "github_operational")
    .in("status", ["suggested", "pending_approval"])
    .limit(20);

  const list = (openActions ?? []) as Array<{
    id: string;
    title: string;
    status: string;
    source: string;
    created_at: string;
  }>;
  for (const a of list) {
    const ageHours = (Date.now() - new Date(a.created_at).getTime()) / 36e5;
    if (ageHours > 48) {
      warnings.push({
        id: `gho-stale-action-${a.id}`,
        level: "warning",
        title: `Code action non revisionata: ${a.title}`,
        description: "Azione codice suggerita ma non ancora revisionata dopo 48h.",
        cta: { label: "Apri Action Queue", to: "/action-queue" },
      });
    }
  }

  return warnings;
}
