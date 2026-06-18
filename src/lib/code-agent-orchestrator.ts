// ============================================================
// Brain Hub v3.15 — Code Agent Orchestrator
// ============================================================
// Classifies a natural-language code-related command, picks a
// recommended engine (Codex / Claude Code / GitHub Action / manual),
// builds a prompt and an execution plan, and persists everything as
// a `code_agent_jobs` row.
//
// CRITICAL: this module NEVER executes code, never calls Codex/Claude
// APIs, never opens a PR, never commits, never deploys. It only
// prepares jobs, requests approval and records pasted results.
// ============================================================

import { supabase } from "@/integrations/supabase/client";
import {
  createReviewItem,
  type ResultReviewItem,
} from "@/lib/result-review";
import { createAction, type AutomationAction } from "@/lib/action-queue";

// ---------- Types ----------

export type CodeAgentEngine =
  | "codex_cloud"
  | "codex_cli"
  | "codex_github_action"
  | "claude_code_cli"
  | "claude_code_github_action"
  | "manual_developer"
  | "lovable"
  | "custom";

export type CodeAgentJobType =
  | "code_fix"
  | "code_review"
  | "code_refactor"
  | "typecheck_fix"
  | "build_fix"
  | "test_generation"
  | "test_run"
  | "bug_investigation"
  | "feature_implementation"
  | "documentation_update"
  | "security_review"
  | "dependency_check"
  | "prompt_generation"
  | "manual_handoff";

export type CodeAgentRiskLevel = "low" | "medium" | "high";

export type CodeAgentJobStatus =
  | "draft"
  | "pending_approval"
  | "ready"
  | "sent_to_engine"
  | "sent_manually"
  | "result_received"
  | "review_created"
  | "review_ready"
  | "reviewed"
  | "completed"
  | "rejected"
  | "cancelled"
  | "failed";

export type CodeAgentApprovalStatus =
  | "not_required"
  | "auto_approved"
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "failed"
  | "needs_strong_approval";

export type CodeAgentExecutionMode =
  | "manual"
  | "github_action"
  | "local_runner"
  | "codex_cloud";

export type CodeAgentJob = {
  id: string;
  user_id: string;
  brain_id: string | null;
  project_id: string | null;
  repository_id: string | null;
  action_id: string | null;
  source: string;
  command_text: string;
  job_type: CodeAgentJobType | string;
  recommended_engine: CodeAgentEngine | string;
  selected_engine: CodeAgentEngine | string | null;
  risk_level: CodeAgentRiskLevel | string;
  requires_approval: boolean;
  status: CodeAgentJobStatus | string;
  approval_status: CodeAgentApprovalStatus | string;
  execution_mode: CodeAgentExecutionMode | string;
  repo_scope: Record<string, unknown>;
  branch_name: string | null;
  prompt_text: string | null;
  execution_plan: Record<string, unknown>;
  allowed_commands: string[] | null;
  forbidden_paths: string[] | null;
  result_text: string | null;
  result_metadata: Record<string, unknown>;
  result_review_item_id: string | null;
  next_action_id: string | null;
  master_snapshot_draft_id: string | null;
  telegram_approval_id: string | null;
  runner_status: string | null;
  external_task_url: string | null;
  external_pr_url: string | null;
  external_run_id: string | null;
  metadata: Record<string, unknown>;
  sent_manually_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CodeAgentEngineDescriptor = {
  id: CodeAgentEngine;
  label: string;
  capabilities: string[];
  risk_fit: CodeAgentRiskLevel[];
  connection_status: "available" | "manual_only" | "future";
  requires_local_runner: boolean;
  supports_branch: boolean;
  supports_pr: boolean;
  supports_tests: boolean;
  supports_auto_execution: boolean;
  safety_notes: string;
};

export const CODE_AGENT_ENGINE_REGISTRY: Record<CodeAgentEngine, CodeAgentEngineDescriptor> = {
  codex_cloud: {
    id: "codex_cloud",
    label: "Codex Cloud (OpenAI)",
    capabilities: ["fix", "refactor", "tests", "investigation"],
    risk_fit: ["low", "medium"],
    connection_status: "manual_only",
    requires_local_runner: false,
    supports_branch: true,
    supports_pr: true,
    supports_tests: true,
    supports_auto_execution: false,
    safety_notes: "Esecuzione su workspace OpenAI. In questa versione: handoff manuale del prompt.",
  },
  codex_cli: {
    id: "codex_cli",
    label: "Codex CLI",
    capabilities: ["fix", "refactor", "tests"],
    risk_fit: ["low", "medium"],
    connection_status: "manual_only",
    requires_local_runner: true,
    supports_branch: true,
    supports_pr: false,
    supports_tests: true,
    supports_auto_execution: false,
    safety_notes: "Richiede runner locale autorizzato. Nessun runner in questa versione.",
  },
  codex_github_action: {
    id: "codex_github_action",
    label: "Codex (GitHub Action)",
    capabilities: ["fix", "tests", "build_fix"],
    risk_fit: ["low", "medium"],
    connection_status: "future",
    requires_local_runner: false,
    supports_branch: true,
    supports_pr: true,
    supports_tests: true,
    supports_auto_execution: false,
    safety_notes: "Workflow GitHub Action separato. Niente push su main: solo PR.",
  },
  claude_code_cli: {
    id: "claude_code_cli",
    label: "Claude Code CLI",
    capabilities: ["fix", "refactor", "review", "tests"],
    risk_fit: ["low", "medium"],
    connection_status: "manual_only",
    requires_local_runner: true,
    supports_branch: true,
    supports_pr: false,
    supports_tests: true,
    supports_auto_execution: false,
    safety_notes: "Esecuzione manuale locale, niente esecuzione automatica.",
  },
  claude_code_github_action: {
    id: "claude_code_github_action",
    label: "Claude Code (GitHub Action)",
    capabilities: ["fix", "review", "tests"],
    risk_fit: ["low", "medium"],
    connection_status: "future",
    requires_local_runner: false,
    supports_branch: true,
    supports_pr: true,
    supports_tests: true,
    supports_auto_execution: false,
    safety_notes: "Workflow Action separato. Sempre PR, mai push diretto su main.",
  },
  manual_developer: {
    id: "manual_developer",
    label: "Sviluppatore umano",
    capabilities: ["fix", "review", "refactor", "investigation", "feature"],
    risk_fit: ["low", "medium", "high"],
    connection_status: "available",
    requires_local_runner: false,
    supports_branch: true,
    supports_pr: true,
    supports_tests: true,
    supports_auto_execution: false,
    safety_notes: "Handoff a sviluppatore umano. Sempre sicuro per task high-risk.",
  },
  lovable: {
    id: "lovable",
    label: "Lovable (manual prompt)",
    capabilities: ["feature", "ui", "fix"],
    risk_fit: ["low", "medium"],
    connection_status: "manual_only",
    requires_local_runner: false,
    supports_branch: false,
    supports_pr: false,
    supports_tests: false,
    supports_auto_execution: false,
    safety_notes: "Prompt da incollare in Lovable. Nessuna esecuzione automatica.",
  },
  custom: {
    id: "custom",
    label: "Custom / altro",
    capabilities: [],
    risk_fit: ["low", "medium"],
    connection_status: "manual_only",
    requires_local_runner: false,
    supports_branch: false,
    supports_pr: false,
    supports_tests: false,
    supports_auto_execution: false,
    safety_notes: "Engine personalizzato, manual-first.",
  },
};

export const CODE_AGENT_JOB_TYPE_LABEL: Record<CodeAgentJobType, string> = {
  code_fix: "Code fix",
  code_review: "Code review",
  code_refactor: "Refactor",
  typecheck_fix: "Typecheck fix",
  build_fix: "Build fix",
  test_generation: "Generazione test",
  test_run: "Esecuzione test",
  bug_investigation: "Bug investigation",
  feature_implementation: "Feature implementation",
  documentation_update: "Documentazione",
  security_review: "Security review",
  dependency_check: "Dependency check",
  prompt_generation: "Generazione prompt",
  manual_handoff: "Manual handoff",
};

export const CODE_AGENT_STATUS_LABEL: Record<string, string> = {
  draft: "Bozza",
  pending_approval: "In attesa approvazione",
  ready: "Pronto",
  sent_to_engine: "Inviato a engine",
  sent_manually: "Inviato manualmente",
  result_received: "Risultato ricevuto",
  review_created: "Review creata",
  review_ready: "Review pronta",
  reviewed: "Revisionato",
  completed: "Completato",
  rejected: "Rifiutato",
  cancelled: "Annullato",
  failed: "Fallito",
};

export const CODE_AGENT_STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-muted",
  pending_approval: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  ready: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  sent_to_engine: "bg-indigo-500/10 text-indigo-600 border-indigo-500/30",
  sent_manually: "bg-indigo-500/10 text-indigo-600 border-indigo-500/30",
  result_received: "bg-violet-500/10 text-violet-600 border-violet-500/30",
  review_created: "bg-violet-500/10 text-violet-600 border-violet-500/30",
  review_ready: "bg-violet-500/10 text-violet-600 border-violet-500/30",
  reviewed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  rejected: "bg-red-500/10 text-red-600 border-red-500/30",
  cancelled: "bg-muted text-muted-foreground border-muted",
  failed: "bg-red-500/10 text-red-600 border-red-500/30",
};

export const CODE_AGENT_RISK_TONE: Record<CodeAgentRiskLevel, string> = {
  low: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  high: "bg-red-500/10 text-red-600 border-red-500/30",
};

// Future runner contract (NOT executed in this version).
export type CodeAgentRunnerRequest = {
  job_id: string;
  repo_url: string;
  branch_name: string;
  engine: CodeAgentEngine;
  prompt_text: string;
  allowed_commands: string[];
  forbidden_paths: string[];
  max_runtime_seconds: number;
};

export type CodeAgentRunnerResult = {
  job_id: string;
  success: boolean;
  summary: string;
  changed_files: string[];
  test_output: string | null;
  diff_summary: string | null;
  pr_url: string | null;
  errors: string[];
  artifacts: Array<{ name: string; url: string }>;
};

// ---------- Sanitization ----------

function sanitizeText(input: string, max = 4000): string {
  let out = input ?? "";
  out = out.replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED]");
  out = out.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED]");
  out = out.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]");
  out = out.replace(/\b\d{9,}:[A-Za-z0-9_-]{30,}\b/g, "[REDACTED]");
  out = out.replace(/(?:password|secret|api[_-]?key|token)\s*[:=]\s*\S+/gi, "$&".split(/[:=]/)[0] + ": [REDACTED]");
  if (out.length > max) out = out.slice(0, max - 1) + "…";
  return out;
}

// ---------- Classification ----------

export type CodeAgentCommandContext = {
  brainId?: string | null;
  projectId?: string | null;
  repositoryId?: string | null;
  preferredEngine?: CodeAgentEngine | null;
  repositoryHint?: string | null;
  riskHint?: CodeAgentRiskLevel | null;
};

export type CodeAgentClassification = {
  job_type: CodeAgentJobType;
  risk_level: CodeAgentRiskLevel;
  requires_approval: boolean;
  unsafe_request: boolean;
  rationale: string;
  matched_keywords: string[];
};

const KW_HIGH_RISK = [
  "produzione",
  "production",
  "main branch",
  "su main",
  "deploy",
  "rilascia",
  "rilascio",
  "merge automatic",
  "cancella",
  "drop table",
  "delete from",
  "rotate key",
  "ruota chiave",
  "secret",
  "password",
  "rls",
  "policy",
  "migrazione db",
  "payments",
  "stripe live",
  "auth",
];

const KW_AUTO_EXEC = [
  "fai tutto da solo",
  "fallo in autonomia",
  "esegui da solo",
  "esegui ora",
  "manda in produzione",
  "deploya tu",
  "fai il deploy",
  "fai commit",
  "fai push",
  "fai merge",
  "fai la PR e merge",
];

function matchAny(text: string, kws: string[]): string[] {
  const lower = text.toLowerCase();
  return kws.filter((k) => lower.includes(k));
}

export function classifyCodeAgentCommand(
  input: string,
  context: CodeAgentCommandContext = {},
): CodeAgentClassification {
  const text = (input ?? "").trim();
  const lower = text.toLowerCase();
  const matched: string[] = [];

  let jobType: CodeAgentJobType = "manual_handoff";
  if (/(review|revision|controlla il codice|fai una review|code review)/.test(lower)) {
    jobType = "code_review";
    matched.push("review");
  } else if (/(typecheck|tsc|tipi rotti|errore di tipo)/.test(lower)) {
    jobType = "typecheck_fix";
    matched.push("typecheck");
  } else if (/(build fix|build rotta|compilazione fallita|build error)/.test(lower)) {
    jobType = "build_fix";
    matched.push("build_fix");
  } else if (/(refactor|riorganizza|pulisci il codice)/.test(lower)) {
    jobType = "code_refactor";
    matched.push("refactor");
  } else if (/(genera test|scrivi i test|aggiungi test|crea test)/.test(lower)) {
    jobType = "test_generation";
    matched.push("test_generation");
  } else if (/(esegui i test|lancia i test|run tests?)/.test(lower)) {
    jobType = "test_run";
    matched.push("test_run");
  } else if (/(investiga|indaga|capisci perché|root cause|debug)/.test(lower)) {
    jobType = "bug_investigation";
    matched.push("investigation");
  } else if (/(implementa|crea la feature|aggiungi la feature|nuova feature)/.test(lower)) {
    jobType = "feature_implementation";
    matched.push("feature");
  } else if (/(documenta|readme|scrivi documentazione|aggiorna doc)/.test(lower)) {
    jobType = "documentation_update";
    matched.push("documentation");
  } else if (/(security review|controllo sicurezza|audit sicurezza|vulnerab)/.test(lower)) {
    jobType = "security_review";
    matched.push("security");
  } else if (/(dipendenz|dependency|aggiorna pacchett|outdated|cve)/.test(lower)) {
    jobType = "dependency_check";
    matched.push("dependency");
  } else if (/(prepara il prossimo prompt|genera prompt|crea prompt)/.test(lower)) {
    jobType = "prompt_generation";
    matched.push("prompt_generation");
  } else if (/(fix|bug|correggi|sistema il bug|risolvi)/.test(lower)) {
    jobType = "code_fix";
    matched.push("fix");
  }

  // Risk inference
  let risk: CodeAgentRiskLevel = "medium";
  const high = matchAny(text, KW_HIGH_RISK);
  const autoExec = matchAny(text, KW_AUTO_EXEC);
  if (high.length > 0 || autoExec.length > 0) {
    risk = "high";
    matched.push(...high, ...autoExec);
  } else if (
    jobType === "documentation_update" ||
    jobType === "prompt_generation" ||
    jobType === "code_review" ||
    jobType === "bug_investigation" ||
    jobType === "security_review" ||
    jobType === "dependency_check"
  ) {
    risk = "low";
  }

  if (context.riskHint) risk = context.riskHint;

  const unsafe = autoExec.length > 0;
  const requiresApproval = risk !== "low" || unsafe;

  return {
    job_type: jobType,
    risk_level: risk,
    requires_approval: requiresApproval,
    unsafe_request: unsafe,
    rationale: unsafe
      ? "Richiesta di esecuzione automatica rilevata: bloccata, serve approvazione forte."
      : risk === "high"
        ? "Comando classificato come high-risk (auth/RLS/secrets/produzione)."
        : risk === "medium"
          ? "Comando code fix/refactor: serve approvazione prima dell'handoff."
          : "Task read-only o documentale: può essere preparato senza approvazione.",
    matched_keywords: Array.from(new Set(matched)),
  };
}

// ---------- Engine selection ----------

export function selectCodeEngine(
  cls: CodeAgentClassification,
  ctx: CodeAgentCommandContext = {},
): CodeAgentEngine {
  if (cls.unsafe_request || cls.risk_level === "high") return "manual_developer";
  if (ctx.preferredEngine) return ctx.preferredEngine;

  switch (cls.job_type) {
    case "code_review":
    case "security_review":
      return "claude_code_cli";
    case "documentation_update":
    case "prompt_generation":
      return "lovable";
    case "test_generation":
    case "test_run":
    case "typecheck_fix":
    case "build_fix":
      return "codex_cloud";
    case "feature_implementation":
      return "lovable";
    case "manual_handoff":
      return "manual_developer";
    default:
      return "codex_cloud";
  }
}

// ---------- Execution plan ----------

export type CodeAgentExecutionPlanInput = {
  classification: CodeAgentClassification;
  engine: CodeAgentEngine;
  context: CodeAgentCommandContext;
  commandText: string;
};

export type CodeAgentExecutionPlan = {
  steps: string[];
  allowed_commands: string[];
  forbidden_paths: string[];
  success_criteria: string[];
  execution_mode: CodeAgentExecutionMode;
};

const DEFAULT_FORBIDDEN_PATHS = [
  ".env",
  ".env.*",
  "src/integrations/supabase/client.ts",
  "src/integrations/supabase/types.ts",
  "supabase/config.toml",
];

export function buildCodeAgentExecutionPlan(
  input: CodeAgentExecutionPlanInput,
): CodeAgentExecutionPlan {
  const allowed: string[] = ["read", "edit_non_protected_files"];
  const forbidden = [...DEFAULT_FORBIDDEN_PATHS];

  if (input.classification.risk_level !== "high") {
    allowed.push("run_typecheck", "run_tests", "open_pull_request");
  }

  const steps: string[] = [
    "Analizzare il contesto repo e i file coinvolti.",
    "Eseguire la modifica richiesta restando nello scope.",
    "Eseguire typecheck/test rilevanti se possibile.",
    "Aprire una PR (mai push diretto su main).",
    "Riportare diff, file modificati, test e rischi.",
  ];

  const success: string[] = [
    "Obiettivo del task soddisfatto.",
    "Nessuna modifica fuori scope.",
    "Nessun secret in commit/diff/log.",
    "PR aperta con descrizione chiara, mai merge automatico.",
  ];

  const mode: CodeAgentExecutionMode =
    input.engine === "manual_developer" || input.engine === "lovable"
      ? "manual"
      : input.engine.endsWith("github_action")
        ? "github_action"
        : input.engine === "codex_cloud"
          ? "codex_cloud"
          : "local_runner";

  return {
    steps,
    allowed_commands: allowed,
    forbidden_paths: forbidden,
    success_criteria: success,
    execution_mode: mode,
  };
}

// ---------- Prompt builders ----------

type PromptJobLike = {
  command_text: string;
  job_type: string;
  risk_level: string;
  recommended_engine: string;
  branch_name: string | null;
  repo_scope: Record<string, unknown>;
  execution_plan: Record<string, unknown>;
  allowed_commands: string[] | null;
  forbidden_paths: string[] | null;
  metadata: Record<string, unknown>;
};

function repoLine(scope: Record<string, unknown>, hint: string | null): string {
  const url = (scope?.repo_url as string | undefined) ?? hint ?? "(repository non specificato)";
  return `Repository: ${sanitizeText(url, 200)}`;
}

export function buildCodexTaskPrompt(job: PromptJobLike): string {
  const branch = job.branch_name ?? "(da creare)";
  const allowed = (job.allowed_commands ?? []).join(", ") || "read, edit_non_protected_files";
  const forbidden = (job.forbidden_paths ?? DEFAULT_FORBIDDEN_PATHS).join(", ");
  const steps = ((job.execution_plan?.steps as string[] | undefined) ?? []).map((s, i) => `${i + 1}. ${s}`).join("\n");
  const success = ((job.execution_plan?.success_criteria as string[] | undefined) ?? []).map((s) => `- ${s}`).join("\n");
  return [
    `# Codex Task — ${CODE_AGENT_JOB_TYPE_LABEL[job.job_type as CodeAgentJobType] ?? job.job_type}`,
    "",
    `Obiettivo: ${sanitizeText(job.command_text, 600)}`,
    `Risk level: ${job.risk_level}`,
    "",
    "## Contesto",
    repoLine(job.repo_scope, (job.metadata?.repository_hint as string | undefined) ?? null),
    `Branch richiesto: ${branch}`,
    job.metadata?.brain_label ? `Brain: ${job.metadata.brain_label}` : "",
    job.metadata?.project_label ? `Progetto: ${job.metadata.project_label}` : "",
    "",
    "## Piano consigliato",
    steps || "1. Analisi\n2. Modifica\n3. Test\n4. Diff/PR",
    "",
    "## Vincoli",
    `- Comandi ammessi: ${allowed}`,
    `- Path vietati: ${forbidden}`,
    "- Niente commit/push su main. Solo branch + PR.",
    "- Niente deploy. Niente modifica di secrets/.env.",
    "- Niente API key o token nel prompt/log/diff.",
    "",
    "## Success criteria",
    success || "- Obiettivo raggiunto\n- Nessuna modifica fuori scope",
    "",
    "## Output richiesto",
    "- Riepilogo modifica",
    "- File modificati",
    "- Diff / link PR",
    "- Test eseguiti",
    "- Rischi rilevati",
    "- Next step suggerito",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildClaudeCodeTaskPrompt(job: PromptJobLike): string {
  const branch = job.branch_name ?? "(da creare)";
  const forbidden = (job.forbidden_paths ?? DEFAULT_FORBIDDEN_PATHS).join(", ");
  return [
    `# Claude Code Task — ${CODE_AGENT_JOB_TYPE_LABEL[job.job_type as CodeAgentJobType] ?? job.job_type}`,
    "",
    `Task tecnico: ${sanitizeText(job.command_text, 600)}`,
    `Risk level: ${job.risk_level}`,
    "",
    "## Contesto repo",
    repoLine(job.repo_scope, (job.metadata?.repository_hint as string | undefined) ?? null),
    `Branch: ${branch}`,
    "",
    "## Istruzioni operative",
    "- Mantieni lo scope: non toccare file fuori dal task.",
    "- Non inventare file, funzioni o API che non esistono nel repo.",
    "- Esegui typecheck e/o build/test rilevanti se possibile.",
    "- Genera un diff spiegato file per file.",
    "- Segnala rischi (sicurezza, regressioni, dipendenze).",
    "",
    "## Vincoli",
    `- Path vietati: ${forbidden}`,
    "- Niente push diretto su main. Solo branch + PR.",
    "- Niente modifica di secrets/.env/integrazioni auto-generate.",
    "- Niente esecuzione shell distruttiva (rm -rf, drop, force-push).",
    "",
    "## Output richiesto",
    "- Riepilogo dell'intervento",
    "- File modificati con motivazione",
    "- Diff spiegato",
    "- Test eseguiti / da eseguire",
    "- Rischi e mitigazioni",
  ].join("\n");
}

// ---------- Persistence ----------

type SbAny = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (t: string) => any;
};

// v3.15.4 — Server boundary resolver.
// Lets server functions inject an authenticated Supabase client + userId
// scoped via AsyncLocalStorage (server-only). Defaults to browser client.
export type CodeAgentRuntimeResolver = {
  getSb: () => SbAny | null;
  getUserId: () => string | null;
};
let _resolver: CodeAgentRuntimeResolver | null = null;
export function setCodeAgentRuntimeResolver(
  resolver: CodeAgentRuntimeResolver | null,
): void {
  _resolver = resolver;
}

const sb: SbAny = new Proxy({} as SbAny, {
  get(_t, prop) {
    const client = (_resolver?.getSb() ?? (supabase as unknown as SbAny)) as Record<
      string | symbol,
      unknown
    >;
    const v = client[prop];
    return typeof v === "function" ? (v as (...args: unknown[]) => unknown).bind(client) : v;
  },
});

async function logJobEvent(
  jobId: string,
  userId: string,
  eventType: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  try {
    await sb.from("code_agent_job_events").insert({
      user_id: userId,
      job_id: jobId,
      event_type: eventType,
      event_data: JSON.parse(sanitizeText(JSON.stringify(data), 4000)),
    });
  } catch {
    // best-effort
  }
}

async function currentUserId(): Promise<string | null> {
  const overridden = _resolver?.getUserId();
  if (overridden) return overridden;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}


// ---------- Create job from Jack command ----------

export type CreateCodeAgentJobInput = {
  command_text: string;
  preferred_engine?: CodeAgentEngine | null;
  repository_hint?: string | null;
  risk_hint?: CodeAgentRiskLevel | null;
  project_id?: string | null;
  brain_id?: string | null;
  repository_id?: string | null;
  source?: string;
  notes?: string | null;
};

export type CreateCodeAgentJobResult = {
  ok: boolean;
  job_id: string | null;
  job_type: CodeAgentJobType;
  recommended_engine: CodeAgentEngine;
  risk_level: CodeAgentRiskLevel;
  requires_approval: boolean;
  status: CodeAgentJobStatus;
  approval_status: CodeAgentApprovalStatus;
  next_step: string;
  safe_message: string;
  unsafe_request: boolean;
};

export async function createCodeAgentJobFromJackCommand(
  input: CreateCodeAgentJobInput,
): Promise<CreateCodeAgentJobResult> {
  const userId = await currentUserId();
  if (!userId) {
    return {
      ok: false,
      job_id: null,
      job_type: "manual_handoff",
      recommended_engine: "manual_developer",
      risk_level: "medium",
      requires_approval: true,
      status: "draft",
      approval_status: "pending",
      next_step: "Login richiesto.",
      safe_message: "Non sono autenticato, non posso creare il job.",
      unsafe_request: false,
    };
  }
  const res = await createCodeAgentJobUnified(sb, userId, {
    ...input,
    source: input.source ?? "jack",
  });
  return {
    ok: res.ok,
    job_id: res.job_id,
    job_type: res.job_type,
    recommended_engine: res.recommended_engine,
    risk_level: res.risk_level,
    requires_approval: res.requires_approval,
    status: res.status,
    approval_status: res.approval_status,
    next_step: res.next_step,
    safe_message: res.safe_message,
    unsafe_request: res.unsafe_request,
  };
}

// v3.15.6 — Jack-specific sanitized audit event (no transcript / no prompt).
export async function emitCodeAgentJackJobCreatedEvent(
  jobId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!jobId) return;
  const userId = await currentUserId();
  if (!userId) return;
  await logJobEvent(jobId, userId, "code_agent_jack_job_created", payload);
}

// ---------- Approval / readiness / result lifecycle ----------

/**
 * v3.15.3 — Server-side transition enforcement.
 * Loads the job fresh from DB, runs assertCodeAgentTransitionAllowed,
 * and emits sanitized blocked/allowed events for audit.
 */
async function enforceTransition(
  jobId: string,
  actionName:
    | "approve"
    | "reject"
    | "sync_approval"
    | "send_manually"
    | "save_result"
    | "create_review"
    | "create_snapshot"
    | "create_next_action",
  targetStatus: CodeAgentJobStatus | "no_change",
): Promise<{ userId: string; job: CodeAgentJob }> {
  const userId = await currentUserId();
  if (!userId) {
    throw new CodeAgentTransitionError(
      "code_agent_user_scope_required",
      "Login richiesto per modificare i Code Agent Jobs.",
    );
  }
  const job = await loadJob(jobId, userId);
  if (!job) {
    throw new CodeAgentTransitionError(
      "code_agent_job_not_found",
      "Code Agent Job non trovato (o non accessibile).",
    );
  }
  try {
    assertCodeAgentTransitionAllowed(job, (targetStatus === "no_change" ? (job.status as CodeAgentJobStatus) : targetStatus), actionName);
  } catch (e) {
    const err =
      e instanceof CodeAgentTransitionError
        ? e
        : new CodeAgentTransitionError(
            "code_agent_transition_not_allowed",
            (e as Error).message ?? "Transizione non ammessa",
          );
    await logJobEvent(jobId, userId, "code_agent_transition_blocked", {
      current_status: job.status,
      current_approval_status: job.approval_status,
      requested_action: actionName,
      target_status: targetStatus,
      reason: err.code,
      message: err.message.slice(0, 200),
      has_repository: !!job.repository_id,
      repository_resolution_status:
        ((job.metadata?.repository_resolution as { status?: string } | undefined)?.status) ??
        null,
      risk_level: job.risk_level,
      requires_approval: job.risk_level === "medium" || job.risk_level === "high",
    });
    throw err;
  }
  await logJobEvent(jobId, userId, "code_agent_transition_allowed", {
    previous_status: job.status,
    next_status: targetStatus,
    action: actionName,
    approval_status: job.approval_status,
    has_repository: !!job.repository_id,
    engine: job.recommended_engine,
  });
  return { userId, job };
}

export async function approveCodeAgentJob(jobId: string): Promise<void> {
  const { userId } = await enforceTransition(jobId, "approve", "ready");
  const { error } = await sb
    .from("code_agent_jobs")
    .update({
      approval_status: "approved",
      status: "ready",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  await logJobEvent(jobId, userId, "code_agent_job_approved", {});
}

export async function markCodeAgentJobReady(
  jobId: string,
  selectedEngine: CodeAgentEngine | null = null,
): Promise<void> {
  const userId = await currentUserId();
  if (!userId) throw new Error("auth_required");
  const patch: Record<string, unknown> = {
    status: "sent_to_engine",
    updated_at: new Date().toISOString(),
  };
  if (selectedEngine) patch.selected_engine = selectedEngine;
  const { error } = await sb
    .from("code_agent_jobs")
    .update(patch)
    .eq("id", jobId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  await logJobEvent(jobId, userId, "code_agent_job_sent_to_engine", { selectedEngine });
}

export type CodeAgentJobResultInput = {
  text: string;
  metadata?: Record<string, unknown>;
};

export async function saveCodeAgentJobResult(
  jobId: string,
  result: CodeAgentJobResultInput,
): Promise<void> {
  const { userId } = await enforceTransition(jobId, "save_result", "result_received");
  const text = sanitizeText(result.text, 8000);
  const { error } = await sb
    .from("code_agent_jobs")
    .update({
      result_text: text,
      result_metadata: result.metadata ?? {},
      status: "result_received",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  await logJobEvent(jobId, userId, "code_agent_result_received", {
    chars: text.length,
  });
}

async function loadJob(jobId: string, userId: string): Promise<CodeAgentJob | null> {
  const { data } = await sb
    .from("code_agent_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .single();
  return (data as CodeAgentJob | null) ?? null;
}

export async function createReviewFromCodeAgentJob(
  jobId: string,
): Promise<ResultReviewItem | null> {
  const { userId, job } = await enforceTransition(jobId, "create_review", "review_ready");

  const review = await createReviewItem({
    brain_id: job.brain_id,
    title: `Code Agent: ${CODE_AGENT_JOB_TYPE_LABEL[job.job_type as CodeAgentJobType] ?? job.job_type}`,
    result_text: sanitizeText(job.result_text ?? "", 4000),
    source_type: "code_engine_handoff",
    source_id: job.id,
    risk_level: job.risk_level,
    metadata: {
      engine: job.recommended_engine,
      risk_level: job.risk_level,
      job_id: job.id,
      code_agent_orchestrator: true,
    },
  });

  await sb
    .from("code_agent_jobs")
    .update({
      result_review_item_id: review.id,
      status: "review_ready",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("user_id", userId);
  await logJobEvent(jobId, userId, "code_agent_review_ready", { review_id: review.id });
  return review;
}

export async function createNextActionFromCodeAgentJob(
  jobId: string,
): Promise<AutomationAction | null> {
  const { userId, job } = await enforceTransition(
    jobId,
    "create_next_action",
    "no_change",
  );
  const action = await createAction({
    brain_id: job.brain_id,
    project_id: job.project_id,
    source: "system_suggestion",
    action_type: "manual_task",
    title: `Verifica risultato Code Agent: ${CODE_AGENT_JOB_TYPE_LABEL[job.job_type as CodeAgentJobType] ?? job.job_type}`,
    description: sanitizeText(
      job.result_text ?? "Nessun risultato salvato. Verifica manuale.",
      600,
    ),
    priority: job.risk_level === "high" ? "high" : "medium",
    risk_level: (job.risk_level as "low" | "medium" | "high"),
    metadata: {
      source_module: "code_agent_orchestrator",
      code_agent_job_id: job.id,
      engine: job.recommended_engine,
    },
  });
  await sb
    .from("code_agent_jobs")
    .update({
      next_action_id: action.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("user_id", userId);
  await logJobEvent(jobId, userId, "code_agent_job_next_action_created", {
    action_id: action.id,
  });
  return action;
}

export async function createMasterSnapshotDraftFromCodeAgentJob(
  jobId: string,
): Promise<string | null> {
  const { userId, job } = await enforceTransition(
    jobId,
    "create_snapshot",
    "no_change",
  );


  // Look up current snapshot (best effort).
  let baseMd = "# Brain Hub — Master Project Snapshot\n";
  let prevId: string | null = null;
  let title = "Brain Hub — Master Project Snapshot";
  let versionLabel = "1.0-draft";
  try {
    let q = sb
      .from("master_snapshot_versions")
      .select("id,title,version_label,markdown_content,brain_id")
      .eq("user_id", userId)
      .eq("version_status", "current")
      .order("created_at", { ascending: false })
      .limit(1);
    if (job.brain_id) q = q.eq("brain_id", job.brain_id);
    const r = await q;
    const row = (r?.data?.[0] ?? null) as {
      id: string;
      title: string;
      version_label: string;
      markdown_content: string;
    } | null;
    if (row) {
      baseMd = row.markdown_content;
      prevId = row.id;
      title = row.title;
      const m = row.version_label.match(/^(\d+)\.(\d+)/);
      versionLabel = m ? `${m[1]}.${Number(m[2]) + 1}-draft` : `${row.version_label}.1-draft`;
    }
  } catch {
    // ignore
  }

  const today = new Date().toISOString().slice(0, 10);
  const append = [
    "",
    "",
    `## Aggiornamento ${today} (Code Agent Job)`,
    "",
    `**Job:** ${CODE_AGENT_JOB_TYPE_LABEL[job.job_type as CodeAgentJobType] ?? job.job_type}`,
    `**Engine:** ${CODE_AGENT_ENGINE_REGISTRY[job.recommended_engine as CodeAgentEngine]?.label ?? job.recommended_engine}`,
    `**Risk level:** ${job.risk_level}`,
    "",
    `**Comando originale:** ${sanitizeText(job.command_text, 400)}`,
    job.result_text ? `\n**Risultato (sintesi):** ${sanitizeText(job.result_text, 800)}` : "",
    "",
    "_Bozza generata dal Code Agent Orchestrator — non promossa a corrente, approvazione manuale richiesta._",
    "",
  ].join("\n");

  let draftId: string | null = null;
  try {
    const ins = await sb
      .from("master_snapshot_versions")
      .insert({
        user_id: userId,
        brain_id: job.brain_id,
        title,
        version_label: versionLabel,
        version_status: "draft_update",
        markdown_content: baseMd + append,
        summary: sanitizeText(job.command_text, 280),
        reason: "Aggiornamento da Code Agent Job",
        source: "code_agent_orchestrator",
        previous_version_id: prevId,
        changes: {
          what_changed: "Bozza proposta dal Code Agent Orchestrator",
          next_step: "Review manuale in /master-snapshot",
        },
        metadata: { source_module: "code_agent_orchestrator", code_agent_job_id: job.id },
      })
      .select("id")
      .single();
    draftId = (ins?.data?.id as string) ?? null;
  } catch {
    draftId = null;
  }

  if (draftId) {
    await sb
      .from("code_agent_jobs")
      .update({
        master_snapshot_draft_id: draftId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", userId);
    await logJobEvent(jobId, userId, "code_agent_job_master_snapshot_draft_created", {
      draft_id: draftId,
    });
  }
  return draftId;
}

// ---------- Queries ----------

export type CodeAgentJobListFilters = {
  brainId?: string | null;
  status?: CodeAgentJobStatus | null;
  engine?: CodeAgentEngine | null;
  risk?: CodeAgentRiskLevel | null;
};

export async function listCodeAgentJobs(
  filters: CodeAgentJobListFilters = {},
): Promise<CodeAgentJob[]> {
  let q = sb
    .from("code_agent_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (filters.brainId) q = q.eq("brain_id", filters.brainId);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.engine) q = q.eq("recommended_engine", filters.engine);
  if (filters.risk) q = q.eq("risk_level", filters.risk);
  const { data } = await q;
  return (data as CodeAgentJob[] | null) ?? [];
}

export async function getCodeAgentJob(id: string): Promise<CodeAgentJob | null> {
  const { data } = await sb
    .from("code_agent_jobs")
    .select("*")
    .eq("id", id)
    .single();
  return (data as CodeAgentJob | null) ?? null;
}

export type CodeAgentJobSummaryBuckets = {
  draft: number;
  missing_repository: number;
  ambiguous_repository: number;
  pending_approval: number;
  ready_to_send: number;
  sent_without_result: number;
  result_to_review: number;
  reviewed: number;
  failed_or_cancelled: number;
};

export type CodeAgentJobSummary = {
  total: number;
  open: number;
  awaitingApproval: number;
  awaitingReview: number;
  lastEngine: string | null;
  buckets: CodeAgentJobSummaryBuckets;
};

export async function getCodeAgentJobSummary(
  brainId?: string | null,
): Promise<CodeAgentJobSummary> {
  const items = await listCodeAgentJobs({ brainId: brainId ?? null });
  const buckets: CodeAgentJobSummaryBuckets = {
    draft: 0,
    missing_repository: 0,
    ambiguous_repository: 0,
    pending_approval: 0,
    ready_to_send: 0,
    sent_without_result: 0,
    result_to_review: 0,
    reviewed: 0,
    failed_or_cancelled: 0,
  };
  for (const j of items) {
    const res = ((j.metadata?.repository_resolution as { status?: string } | undefined)?.status) ?? null;
    const requiresRepo = CODE_JOB_TYPES_REQUIRING_REPO.includes(j.job_type as CodeAgentJobType);
    if (requiresRepo && !j.repository_id && res === "missing") buckets.missing_repository++;
    if (requiresRepo && !j.repository_id && res === "ambiguous") buckets.ambiguous_repository++;
    if (j.status === "draft") buckets.draft++;
    if (j.status === "pending_approval") buckets.pending_approval++;
    if (j.status === "ready") buckets.ready_to_send++;
    if ((j.status === "sent_manually" || j.status === "sent_to_engine") && !j.result_text) buckets.sent_without_result++;
    if (j.status === "result_received" && !j.result_review_item_id) buckets.result_to_review++;
    if (j.status === "reviewed" || j.status === "review_ready") buckets.reviewed++;
    if (j.status === "failed" || j.status === "cancelled" || j.status === "rejected") buckets.failed_or_cancelled++;
  }
  const open = items.filter(
    (j) => !CODE_AGENT_TERMINAL_STATUSES.includes(j.status as CodeAgentJobStatus) && j.status !== "completed",
  ).length;
  const awaitingApproval = items.filter((j) => j.status === "pending_approval").length;
  const awaitingReview = items.filter((j) => j.status === "result_received").length;
  const lastEngine = items[0]?.recommended_engine ?? null;
  return { total: items.length, open, awaitingApproval, awaitingReview, lastEngine, buckets };
}

// ---------- Loop QA warnings ----------

export type CodeAgentJobWarning = {
  id: string;
  level: "warning" | "info" | "error";
  title: string;
  description: string;
  cta?: { label: string; to: string };
};

export async function getCodeAgentJobWarnings(
  brainId?: string | null,
): Promise<CodeAgentJobWarning[]> {
  const items = await listCodeAgentJobs({ brainId: brainId ?? null });
  const warns: CodeAgentJobWarning[] = [];
  const now = Date.now();
  const cta = { label: "Apri Code Agent Jobs", to: "/code-agent-jobs" } as const;
  for (const j of items) {
    if (!(CODE_AGENT_JOB_STATUSES as readonly string[]).includes(j.status)) {
      warns.push({
        id: `caj-invalid-status-${j.id}`,
        level: "error",
        title: "Status code agent non riconosciuto",
        description: `Stato "${j.status}" fuori dalla state machine.`,
        cta,
      });
    }
    if (!(CODE_AGENT_APPROVAL_STATUSES as readonly string[]).includes(j.approval_status)) {
      warns.push({
        id: `caj-invalid-approval-status-${j.id}`,
        level: "error",
        title: "Approval status non riconosciuto",
        description: `Approval "${j.approval_status}" fuori dalla state machine.`,
        cta,
      });
    }
    const requiresRepo = CODE_JOB_TYPES_REQUIRING_REPO.includes(j.job_type as CodeAgentJobType);
    const resolution = ((j.metadata?.repository_resolution as { status?: string } | undefined)?.status) ?? null;
    if (requiresRepo && !j.repository_id && resolution === "missing") {
      warns.push({
        id: `caj-blocked-missing-repo-${j.id}`,
        level: "warning",
        title: "Job code agent bloccato: repository mancante",
        description: "Seleziona un repository prima di approvare o inviare.",
        cta,
      });
    }
    if (requiresRepo && !j.repository_id && resolution === "ambiguous") {
      warns.push({
        id: `caj-blocked-ambiguous-repo-${j.id}`,
        level: "warning",
        title: "Job code agent bloccato: repository ambiguo",
        description: "Più candidati trovati: scegli quello corretto.",
        cta,
      });
    }
    if (
      j.status === "ready" &&
      (j.risk_level === "medium" || j.risk_level === "high") &&
      !approvalGranted(j as unknown as StateJobLike)
    ) {
      warns.push({
        id: `caj-ready-but-approval-missing-${j.id}`,
        level: "warning",
        title: "Job ready ma approvazione mancante",
        description: "Job medium/high pronto ma approvazione non concessa.",
        cta,
      });
    }
    if (
      (j.risk_level === "medium" || j.risk_level === "high") &&
      !j.telegram_approval_id &&
      !isCodeAgentJobTerminal(j as unknown as StateJobLike)
    ) {
      warns.push({
        id: `caj-no-telegram-${j.id}`,
        level: "warning",
        title: "Code Agent Job senza approvazione Telegram",
        description: "Job medium/high risk senza richiesta Telegram collegata.",
        cta,
      });
    }
    const updatedMs = new Date(j.updated_at).getTime();
    const ageHours = (now - updatedMs) / 3_600_000;
    if (j.status === "ready" && ageHours > 24) {
      warns.push({
        id: `caj-ready-not-sent-${j.id}`,
        level: "info",
        title: "Job ready ma mai inviato",
        description: `Pronto da ${Math.round(ageHours)}h, ancora non inviato a engine.`,
        cta,
      });
    }
    if (
      (j.status === "sent_to_engine" || j.status === "sent_manually") &&
      ageHours > 48 &&
      !j.result_text
    ) {
      warns.push({
        id: `caj-sent-no-result-${j.id}`,
        level: "warning",
        title: "Job inviato senza risultato",
        description: `Inviato da ${Math.round(ageHours)}h, nessun risultato registrato.`,
        cta,
      });
    }
    if (j.status === "result_received" && !j.result_review_item_id) {
      warns.push({
        id: `caj-result-no-review-${j.id}`,
        level: "warning",
        title: "Risultato senza Result Review",
        description: "Crea una Result Review per il risultato ricevuto.",
        cta,
      });
    }
    if (j.status === "review_ready" && ageHours > 48) {
      warns.push({
        id: `caj-review-ready-not-reviewed-${j.id}`,
        level: "info",
        title: "Review pronta ma non completata",
        description: `Review aperta da ${Math.round(ageHours)}h.`,
        cta,
      });
    }
    if (j.master_snapshot_draft_id && !j.result_review_item_id) {
      warns.push({
        id: `caj-snapshot-before-review-${j.id}`,
        level: "warning",
        title: "Master Snapshot draft prima della review",
        description: "Snapshot draft creato senza Result Review completa.",
        cta,
      });
    }
    if (j.risk_level === "high" && j.approval_status === "needs_strong_approval") {
      warns.push({
        id: `caj-high-strong-${j.id}`,
        level: "error",
        title: "Job high-risk con richiesta esecuzione automatica",
        description: "Bloccato. Serve approvazione forte e handoff manuale.",
        cta,
      });
    }
  }

  // v3.15.3 — surface recent server-side transition blocks and bulk-sync errors.
  // v3.15.4 — best-effort brain scoping (filters events by jobs of this brain).
  try {
    const sinceIso = new Date(now - 24 * 3_600_000).toISOString();
    let jobIdsForBrain: string[] | null = null;
    let scopeNote = "";
    if (brainId) {
      // v3.15.5: lightweight ID-only query (limit 1000) instead of reusing
      // the 200-row payload list above.
      jobIdsForBrain = await listCodeAgentJobIdsForBrain(brainId, 1000);
      scopeNote = " (scope brain)";
    }
    let q = sb
      .from("code_agent_job_events")
      .select("event_type,event_data,created_at,job_id")
      .in("event_type", [
        "code_agent_transition_blocked",
        "code_agent_bulk_approval_sync_error",
        "code_agent_jack_job_create_blocked",
      ])
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(100);
    if (jobIdsForBrain && jobIdsForBrain.length > 0) {
      q = q.in("job_id", jobIdsForBrain);
    } else if (jobIdsForBrain && jobIdsForBrain.length === 0) {
      // No jobs in this brain → skip query entirely.
      q = null as unknown as typeof q;
    }
    const { data: events } = q ? await q : { data: [] as unknown[] };
    const rows = (events as Array<{
      event_type: string;
      event_data: Record<string, unknown> | null;
    }> | null) ?? [];
    const blocked = rows.filter((r) => r.event_type === "code_agent_transition_blocked");
    const bulkErrors = rows.filter(
      (r) => r.event_type === "code_agent_bulk_approval_sync_error",
    );
    if (blocked.length > 0) {
      const reasons = Array.from(
        new Set(
          blocked
            .map((r) => (r.event_data?.reason as string | undefined) ?? "unknown")
            .slice(0, 3),
        ),
      ).join(", ");
      warns.push({
        id: "caj-server-transition-blocked",
        level: "warning",
        title: "Transizioni server bloccate di recente",
        description: `${blocked.length} transizioni bloccate nelle ultime 24h${scopeNote} (${reasons}).`,
        cta,
      });
    }
    if (bulkErrors.length > 0) {
      warns.push({
        id: "caj-bulk-sync-errors",
        level: "warning",
        title: "Bulk sync approval con errori",
        description: `${bulkErrors.length} errori durante la sync approval di massa nelle ultime 24h${scopeNote}.`,
        cta,
      });
    }
    const jackBlocked = rows.filter(
      (r) => r.event_type === "code_agent_jack_job_create_blocked",
    );
    if (jackBlocked.length > 0) {
      warns.push({
        id: "caj-jack-create-blocked",
        level: "info",
        title: "Creazione Jack → Code Agent bloccata di recente",
        description: `${jackBlocked.length} tentativi Jack bloccati nelle ultime 24h${scopeNote}.`,
        cta,
      });
    }
  } catch {
    // best-effort
  }


  // v3.16 — best-effort end-to-end QA warning (brain-scoped).
  try {
    const qa = await import("@/lib/code-agent-qa");
    const [bl, inc] = await Promise.all([
      qa.getCodeAgentBlockedJobs(brainId ?? null),
      qa.getCodeAgentInconsistentJobs(brainId ?? null),
    ]);
    if (bl.length + inc.length >= 5) {
      warns.push({
        id: "caj-end-to-end-incomplete",
        level: "info",
        title: "Ciclo Code Agent end-to-end incompleto",
        description: `${bl.length} job bloccati, ${inc.length} job incoerenti. Apri Code Agent QA per la diagnosi.`,
        cta: { label: "Apri Code Agent QA", to: "/code-agent-qa" },
      });
    }
  } catch {
    // best-effort
  }

  return warns;
}


// ============================================================
// v3.15.1 — Repo Resolver, Unified Create, Approval Sync,
// Manual Handoff, Reject, Telegram Approval Wiring
// ============================================================

export type RepoResolutionStatus = "resolved" | "ambiguous" | "missing";

export type RepoCandidate = {
  repository_id: string;
  repository_name: string | null;
  repository_url: string;
  source: "explicit" | "hint_match" | "project_link" | "brain_link" | "recent";
};

export type RepoResolutionResult = {
  status: RepoResolutionStatus;
  repository_id: string | null;
  repository_name: string | null;
  repo_url: string | null;
  candidates: RepoCandidate[];
  reason: string;
};

type SbLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (t: string) => any;
};

export type ResolveRepoInput = {
  repository_id?: string | null;
  repository_hint?: string | null;
  project_id?: string | null;
  brain_id?: string | null;
};

export async function resolveRepositoryForCodeAgentJob(
  sb: SbLike,
  userId: string,
  input: ResolveRepoInput,
): Promise<RepoResolutionResult> {
  const collected: RepoCandidate[] = [];

  const toCandidate = (
    r: { id: string; repository_name: string | null; repository_url: string },
    source: RepoCandidate["source"],
  ): RepoCandidate => ({
    repository_id: r.id,
    repository_name: r.repository_name,
    repository_url: r.repository_url,
    source,
  });

  // 1) explicit
  if (input.repository_id) {
    try {
      const { data } = await sb
        .from("github_repository_registry")
        .select("id,repository_name,repository_url")
        .eq("user_id", userId)
        .eq("id", input.repository_id)
        .single();
      if (data) {
        return {
          status: "resolved",
          repository_id: data.id,
          repository_name: data.repository_name,
          repo_url: data.repository_url,
          candidates: [toCandidate(data, "explicit")],
          reason: "Repository fornito esplicitamente.",
        };
      }
    } catch {
      /* ignore */
    }
  }

  // load workspace repos once
  let repos: Array<{ id: string; repository_name: string | null; repository_url: string; project_id: string | null; brain_id: string | null; last_sync_at: string | null }> = [];
  try {
    const { data } = await sb
      .from("github_repository_registry")
      .select("id,repository_name,repository_url,project_id,brain_id,last_sync_at")
      .eq("user_id", userId)
      .order("last_sync_at", { ascending: false })
      .limit(200);
    repos = (data ?? []) as typeof repos;
  } catch {
    repos = [];
  }

  // 2) hint
  if (input.repository_hint) {
    const hint = input.repository_hint.toLowerCase();
    const hits = repos.filter(
      (r) =>
        r.repository_url.toLowerCase().includes(hint) ||
        (r.repository_name ?? "").toLowerCase().includes(hint),
    );
    for (const r of hits) collected.push(toCandidate(r, "hint_match"));
  }

  // 3) project link
  if (input.project_id) {
    for (const r of repos.filter((r) => r.project_id === input.project_id)) {
      if (!collected.find((c) => c.repository_id === r.id)) {
        collected.push(toCandidate(r, "project_link"));
      }
    }
  }

  // 4) brain link
  if (input.brain_id) {
    for (const r of repos.filter((r) => r.brain_id === input.brain_id)) {
      if (!collected.find((c) => c.repository_id === r.id)) {
        collected.push(toCandidate(r, "brain_link"));
      }
    }
  }

  // 5) recent for brain/project
  if (collected.length === 0 && (input.brain_id || input.project_id)) {
    const recent = repos.find(
      (r) =>
        (input.brain_id && r.brain_id === input.brain_id) ||
        (input.project_id && r.project_id === input.project_id),
    );
    if (recent) collected.push(toCandidate(recent, "recent"));
  }

  if (collected.length === 0) {
    return {
      status: "missing",
      repository_id: null,
      repository_name: null,
      repo_url: null,
      candidates: [],
      reason: "Nessun repository collegato a brain/progetto. Scegli repository.",
    };
  }
  if (collected.length === 1) {
    const c = collected[0];
    return {
      status: "resolved",
      repository_id: c.repository_id,
      repository_name: c.repository_name,
      repo_url: c.repository_url,
      candidates: collected,
      reason: `Risolto da ${c.source}.`,
    };
  }
  return {
    status: "ambiguous",
    repository_id: null,
    repository_name: null,
    repo_url: null,
    candidates: collected.slice(0, 10),
    reason: `Trovati ${collected.length} repository candidati. Selezione manuale richiesta.`,
  };
}

// ---------- Unified create (shared by Jack + UI) ----------

export type UnifiedCreateCodeAgentJobInput = CreateCodeAgentJobInput & {
  delivery_preference?: "manual" | "telegram" | null;
};

export type UnifiedCreateCodeAgentJobResult = CreateCodeAgentJobResult & {
  repository_id: string | null;
  repository_resolution: RepoResolutionResult;
  telegram_approval_id: string | null;
  selected_engine: CodeAgentEngine | null;
};

const CODE_JOB_TYPES_REQUIRING_REPO: CodeAgentJobType[] = [
  "code_fix",
  "code_refactor",
  "typecheck_fix",
  "build_fix",
  "test_generation",
  "test_run",
  "feature_implementation",
  "dependency_check",
];

export async function createCodeAgentJobUnified(
  sb: SbLike,
  userId: string,
  input: UnifiedCreateCodeAgentJobInput,
): Promise<UnifiedCreateCodeAgentJobResult> {
  const commandText = sanitizeText(String(input.command_text ?? "").trim(), 1500);
  const ctx: CodeAgentCommandContext = {
    brainId: input.brain_id ?? null,
    projectId: input.project_id ?? null,
    repositoryId: input.repository_id ?? null,
    preferredEngine: input.preferred_engine ?? null,
    repositoryHint: input.repository_hint ?? null,
    riskHint: input.risk_hint ?? null,
  };
  const cls = classifyCodeAgentCommand(commandText, ctx);
  const engine = selectCodeEngine(cls, ctx);
  const plan = buildCodeAgentExecutionPlan({
    classification: cls,
    engine,
    context: ctx,
    commandText,
  });

  // Repo resolution
  const repoRes = await resolveRepositoryForCodeAgentJob(sb, userId, {
    repository_id: input.repository_id ?? null,
    repository_hint: input.repository_hint ?? null,
    project_id: input.project_id ?? null,
    brain_id: input.brain_id ?? null,
  });

  const repoRequired = CODE_JOB_TYPES_REQUIRING_REPO.includes(cls.job_type);
  const repoBlocking = repoRequired && repoRes.status !== "resolved";

  const approvalStatus: CodeAgentApprovalStatus = cls.unsafe_request
    ? "needs_strong_approval"
    : cls.risk_level === "low"
      ? "auto_approved"
      : "pending";

  let status: CodeAgentJobStatus;
  if (repoBlocking) {
    status = "draft";
  } else if (cls.unsafe_request) {
    status = "pending_approval";
  } else if (cls.risk_level === "low") {
    status = "ready";
  } else {
    status = "pending_approval";
  }

  const promptJob: PromptJobLike = {
    command_text: commandText,
    job_type: cls.job_type,
    risk_level: cls.risk_level,
    recommended_engine: engine,
    branch_name: null,
    repo_scope: repoRes.repo_url
      ? { repo_url: repoRes.repo_url, repository_id: repoRes.repository_id }
      : input.repository_hint
        ? { repo_url: input.repository_hint }
        : {},
    execution_plan: plan as unknown as Record<string, unknown>,
    allowed_commands: plan.allowed_commands,
    forbidden_paths: plan.forbidden_paths,
    metadata: {
      repository_hint: input.repository_hint ?? null,
      repository_resolution: repoRes.status,
    },
  };
  const promptText = engine.startsWith("claude_code")
    ? buildClaudeCodeTaskPrompt(promptJob)
    : buildCodexTaskPrompt(promptJob);

  const missingInfo: string[] = [];
  if (repoBlocking) {
    missingInfo.push(repoRes.status === "ambiguous" ? "Scegli repository tra i candidati" : "Scegli repository");
  }

  let jobId: string | null = null;
  try {
    const res = await sb
      .from("code_agent_jobs")
      .insert({
        user_id: userId,
        brain_id: input.brain_id ?? null,
        project_id: input.project_id ?? null,
        repository_id: repoRes.repository_id,
        source: input.source ?? "jack",
        command_text: commandText,
        job_type: cls.job_type,
        recommended_engine: engine,
        selected_engine: null,
        risk_level: cls.risk_level,
        requires_approval: cls.requires_approval,
        status,
        approval_status: approvalStatus,
        execution_mode: plan.execution_mode,
        repo_scope: promptJob.repo_scope,
        branch_name: null,
        prompt_text: promptText,
        execution_plan: plan,
        allowed_commands: plan.allowed_commands,
        forbidden_paths: plan.forbidden_paths,
        metadata: {
          jack_classification: cls,
          repository_hint: input.repository_hint ?? null,
          repository_resolution: {
            status: repoRes.status,
            reason: repoRes.reason,
            candidate_count: repoRes.candidates.length,
          },
          delivery_preference: input.delivery_preference ?? null,
          missing_information: missingInfo,
          notes: input.notes ? sanitizeText(input.notes, 280) : null,
        },
      })
      .select("id")
      .single();
    jobId = (res?.data?.id as string) ?? null;
  } catch {
    jobId = null;
  }

  if (jobId) {
    await logJobEvent(jobId, userId, "code_agent_job_server_created", {
      source: input.source ?? "jack",
      engine,
      job_type: cls.job_type,
      risk: cls.risk_level,
    });
    if (repoRes.status === "resolved") {
      await logJobEvent(jobId, userId, "code_agent_repository_resolved", {
        repository_id: repoRes.repository_id,
        source: repoRes.candidates[0]?.source ?? null,
      });
    } else if (repoRes.status === "ambiguous") {
      await logJobEvent(jobId, userId, "code_agent_repository_ambiguous", {
        candidate_count: repoRes.candidates.length,
      });
    } else {
      await logJobEvent(jobId, userId, "code_agent_repository_missing", {});
    }
  }

  // Telegram approval draft for medium/high risk or requires_approval
  let telegramApprovalId: string | null = null;
  if (
    jobId &&
    !repoBlocking &&
    (cls.risk_level === "medium" || cls.risk_level === "high" || cls.requires_approval)
  ) {
    try {
      const insRes = await sb
        .from("telegram_approval_requests")
        .insert({
          user_id: userId,
          brain_id: input.brain_id ?? null,
          project_id: input.project_id ?? null,
          approval_type: "manual_action",
          title: `Code Agent Job — ${CODE_AGENT_JOB_TYPE_LABEL[cls.job_type] ?? cls.job_type}`,
          message_preview: sanitizeText(commandText, 400),
          payload_preview: {
            job_id: jobId,
            recommended_engine: engine,
            repo_url: repoRes.repo_url,
            repository_name: repoRes.repository_name,
            allowed_commands: plan.allowed_commands,
            forbidden_paths: plan.forbidden_paths,
            will_not_do: [
              "Niente esecuzione automatica",
              "Niente commit/push/PR/merge/deploy",
              "Solo handoff manuale del prompt",
            ],
            link: "/code-agent-jobs",
          },
          risk_level: cls.risk_level,
          status: "draft",
          metadata: {
            source_module: "code_agent_orchestrator",
            code_agent_job_id: jobId,
            action_type: "code_agent_job",
          },
        })
        .select("id")
        .single();
      telegramApprovalId = (insRes?.data?.id as string) ?? null;
      await sb
        .from("code_agent_jobs")
        .update({
          telegram_approval_id: telegramApprovalId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .eq("user_id", userId);
      await logJobEvent(jobId, userId, "code_agent_telegram_approval_created", {
        approval_id: telegramApprovalId,
        risk: cls.risk_level,
      });
    } catch {
      telegramApprovalId = null;
    }
  }

  const engineLabel = CODE_AGENT_ENGINE_REGISTRY[engine].label;
  const safeMessage = repoBlocking
    ? `Ho preparato il job ma serve scegliere il repository (${repoRes.status}). Apri /code-agent-jobs per selezionarlo.`
    : cls.unsafe_request
      ? "Job preparato ma chiedi esecuzione automatica: lo blocco e segno come high-risk con approvazione forte."
      : cls.risk_level === "high"
        ? `Job high-risk per ${engineLabel}. Approvazione forte richiesta.`
        : cls.risk_level === "medium"
          ? `Job per ${engineLabel}. Rischio medio: approvazione richiesta prima dell'handoff.`
          : `Job low-risk per ${engineLabel}. Pronto per handoff manuale.`;

  return {
    ok: jobId !== null,
    job_id: jobId,
    job_type: cls.job_type,
    recommended_engine: engine,
    selected_engine: null,
    risk_level: cls.risk_level,
    requires_approval: cls.requires_approval,
    status,
    approval_status: approvalStatus,
    next_step: jobId
      ? repoBlocking
        ? "Apri /code-agent-jobs e seleziona il repository."
        : telegramApprovalId
          ? "Job creato. Approvazione Telegram in bozza."
          : "Apri /code-agent-jobs per revisione e approvazione."
      : "Riprova: job non salvato.",
    safe_message: safeMessage,
    unsafe_request: cls.unsafe_request,
    repository_id: repoRes.repository_id,
    repository_resolution: repoRes,
    telegram_approval_id: telegramApprovalId,
  };
}

// ---------- Browser wrapper for UI ----------
// v3.15.5: prefer server function `createCodeAgentJobFromBrowserFn`. This
// wrapper remains for internal/non-UI callers; it throws typed
// CodeAgentTransitionError so the UI/SSR boundary can serialize it.

export async function createCodeAgentJobFromBrowser(
  input: UnifiedCreateCodeAgentJobInput,
): Promise<UnifiedCreateCodeAgentJobResult> {
  const userId = await currentUserId();
  if (!userId) {
    throw new CodeAgentTransitionError(
      "code_agent_user_scope_required",
      "Devi essere autenticato per creare un Code Agent Job.",
    );
  }
  const commandText = String(input?.command_text ?? "").trim();
  if (!commandText) {
    throw new CodeAgentTransitionError(
      "code_agent_invalid_creation_input",
      "Dati insufficienti per creare il job: comando vuoto.",
    );
  }
  return createCodeAgentJobUnified(sb, userId, input);
}

// ---------- Update repository on job ----------
// v3.15.5: typed errors + nullable repository (clearing). Server-enforced via
// `updateCodeAgentJobRepositoryFn`; never accept user_id from the caller.

const CODE_AGENT_REPO_UPDATABLE_STATUSES: CodeAgentJobStatus[] = [
  "draft",
  "pending_approval",
  "ready",
];

export function canUpdateCodeAgentJobRepository(job: StateJobLike): boolean {
  if (isCodeAgentJobTerminal(job)) return false;
  const s = normalizeCodeAgentJobStatus(job.status as string);
  return CODE_AGENT_REPO_UPDATABLE_STATUSES.includes(s);
}

export async function updateCodeAgentJobRepository(
  jobId: string,
  repositoryId: string | null,
): Promise<void> {
  const userId = await currentUserId();
  if (!userId) {
    throw new CodeAgentTransitionError(
      "code_agent_user_scope_required",
      "Devi essere autenticato.",
    );
  }
  const current = await loadJob(jobId, userId);
  if (!current) {
    throw new CodeAgentTransitionError(
      "code_agent_job_not_found",
      "Job non trovato o non accessibile.",
    );
  }
  if (isCodeAgentJobTerminal(current as unknown as StateJobLike)) {
    throw new CodeAgentTransitionError(
      "code_agent_terminal_status",
      "Job in stato finale: repository non modificabile.",
    );
  }
  if (!canUpdateCodeAgentJobRepository(current as unknown as StateJobLike)) {
    throw new CodeAgentTransitionError(
      "code_agent_repository_update_not_allowed",
      "Non puoi modificare il repository di un job già inviato o completato.",
    );
  }

  await logJobEvent(jobId, userId, "code_agent_repository_update_started", {
    previous_repository_id: !!current.repository_id,
    new_repository_id: !!repositoryId,
    status: current.status,
    approval_status: current.approval_status,
  });

  const meta = current.metadata ?? {};
  const repoRequired = CODE_JOB_TYPES_REQUIRING_REPO.includes(
    current.job_type as CodeAgentJobType,
  );

  let repoRow: { id: string; repository_url: string } | null = null;
  if (repositoryId) {
    const { data: repo } = await sb
      .from("github_repository_registry")
      .select("id,repository_name,repository_url,user_id")
      .eq("id", repositoryId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!repo) {
      await logJobEvent(jobId, userId, "code_agent_repository_update_blocked", {
        reason: "code_agent_repository_not_found",
        status: current.status,
      });
      throw new CodeAgentTransitionError(
        "code_agent_repository_not_found",
        "Repository non trovato o non accessibile.",
      );
    }
    repoRow = { id: repo.id as string, repository_url: repo.repository_url as string };
  }

  let newStatus: CodeAgentJobStatus = current.status as CodeAgentJobStatus;
  let resolution: { status: RepoResolutionStatus; reason: string };
  let missingInfo = ((meta.missing_information as string[] | undefined) ?? []).slice();

  if (repoRow) {
    resolution = { status: "resolved", reason: "Selezione manuale UI" };
    missingInfo = missingInfo.filter((s) => !s.toLowerCase().includes("repository"));
    if (current.status === "draft" && repoRequired) {
      newStatus = current.risk_level === "low" ? "ready" : "pending_approval";
    }
  } else {
    resolution = { status: "missing", reason: "Repository rimosso manualmente" };
    if (repoRequired && !missingInfo.some((s) => s.toLowerCase().includes("repository"))) {
      missingInfo.push("Repository mancante");
    }
    if (repoRequired) newStatus = "draft";
  }

  const { error } = await sb
    .from("code_agent_jobs")
    .update({
      repository_id: repoRow?.id ?? null,
      repo_scope: repoRow
        ? { repo_url: repoRow.repository_url, repository_id: repoRow.id }
        : null,
      status: newStatus,
      metadata: {
        ...meta,
        repository_resolution: resolution,
        missing_information: missingInfo,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("user_id", userId);
  if (error) {
    await logJobEvent(jobId, userId, "code_agent_repository_update_blocked", {
      reason: "db_update_error",
      status: current.status,
    });
    throw new Error(error.message);
  }
  await logJobEvent(jobId, userId, "code_agent_repository_updated", {
    previous_repository_id: !!current.repository_id,
    new_repository_id: !!repoRow,
    repository_resolution_status: resolution.status,
    status: newStatus,
  });
}

// ---------- Lightweight brain-scoped job ID query (for QA warnings) ----------
// v3.15.5: avoids loading 200 full payloads in loop-qa; fetches IDs only.

export async function listCodeAgentJobIdsForBrain(
  brainId: string | null,
  limit = 1000,
): Promise<string[]> {
  try {
    let q = sb
      .from("code_agent_jobs")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (brainId) q = q.eq("brain_id", brainId);
    const { data } = await q;
    return ((data as Array<{ id: string }> | null) ?? []).map((r) => r.id);
  } catch {
    return [];
  }
}

// ---------- Reject ----------

export async function rejectCodeAgentJob(
  jobId: string,
  reason: string | null = null,
): Promise<void> {
  const { userId } = await enforceTransition(jobId, "reject", "cancelled");
  const { error } = await sb
    .from("code_agent_jobs")
    .update({
      approval_status: "rejected",
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  await logJobEvent(jobId, userId, "code_agent_job_rejected", {
    reason: reason ? sanitizeText(reason, 200) : null,
  });
}

// ---------- Mark sent manually ----------

export async function markCodeAgentJobSentManually(
  jobId: string,
  engine: CodeAgentEngine,
): Promise<void> {
  const { userId } = await enforceTransition(jobId, "send_manually", "sent_manually");
  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from("code_agent_jobs")
    .update({
      selected_engine: engine,
      status: "sent_manually",
      sent_manually_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", jobId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  await logJobEvent(jobId, userId, "code_agent_marked_sent_manually", {
    engine,
    status: "sent_manually",
    has_sent_manually_at: true,
    sent_at: nowIso,
  });
}

// ---------- Approval sync ----------

export type ApprovalSyncResult = {
  job_id: string;
  approval_status: CodeAgentApprovalStatus | string;
  status: CodeAgentJobStatus | string;
  telegram_status: string | null;
  skipped?: boolean;
  skip_reason?: string;
};

export async function syncCodeAgentJobApprovalStatus(
  jobId: string,
): Promise<ApprovalSyncResult> {
  const userId = await currentUserId();
  if (!userId) {
    throw new CodeAgentTransitionError(
      "code_agent_user_scope_required",
      "Login richiesto per sincronizzare l'approvazione.",
    );
  }
  const job = await loadJob(jobId, userId);
  if (!job) {
    throw new CodeAgentTransitionError(
      "code_agent_job_not_found",
      "Code Agent Job non trovato.",
    );
  }

  if (isCodeAgentJobTerminal(job)) {
    await logJobEvent(jobId, userId, "code_agent_transition_blocked", {
      current_status: job.status,
      current_approval_status: job.approval_status,
      requested_action: "sync_approval",
      target_status: "no_change",
      reason: "code_agent_terminal_status",
      risk_level: job.risk_level,
    });
    return {
      job_id: jobId,
      approval_status: job.approval_status,
      status: job.status,
      telegram_status: null,
      skipped: true,
      skip_reason: "code_agent_terminal_status",
    };
  }

  let nextApproval = job.approval_status;
  let nextStatus = job.status;
  let telegramStatus: string | null = null;

  if (job.telegram_approval_id) {
    try {
      const { data } = await sb
        .from("telegram_approval_requests")
        .select("status")
        .eq("id", job.telegram_approval_id)
        .single();
      telegramStatus = (data?.status as string) ?? null;
      if (telegramStatus === "approved") {
        nextApproval = "approved";
        nextStatus = "ready";
      } else if (telegramStatus === "rejected") {
        nextApproval = "rejected";
        nextStatus = "cancelled";
      } else if (telegramStatus === "expired" || telegramStatus === "failed") {
        nextStatus = "failed";
      }
    } catch {
      /* ignore */
    }
  }

  // Low-risk auto-policy
  if (job.risk_level === "low" && job.approval_status === "auto_approved" && job.status === "draft") {
    nextStatus = "ready";
  }

  // Block: medium/high cannot move to ready without real approval.
  if (
    nextStatus === "ready" &&
    (job.risk_level === "medium" || job.risk_level === "high") &&
    nextApproval !== "approved" &&
    nextApproval !== "auto_approved"
  ) {
    await logJobEvent(jobId, userId, "code_agent_transition_blocked", {
      current_status: job.status,
      current_approval_status: job.approval_status,
      requested_action: "sync_approval",
      target_status: "ready",
      reason: "code_agent_approval_required",
      risk_level: job.risk_level,
    });
    return {
      job_id: jobId,
      approval_status: job.approval_status,
      status: job.status,
      telegram_status: telegramStatus,
      skipped: true,
      skip_reason: "code_agent_approval_required",
    };
  }

  // Block: don't move to ready if repository missing/ambiguous on repo-required job.
  if (nextStatus === "ready" && repoBlocking(job as unknown as StateJobLike)) {
    await logJobEvent(jobId, userId, "code_agent_transition_blocked", {
      current_status: job.status,
      current_approval_status: job.approval_status,
      requested_action: "sync_approval",
      target_status: "ready",
      reason: "code_agent_repository_required",
      risk_level: job.risk_level,
    });
    return {
      job_id: jobId,
      approval_status: job.approval_status,
      status: job.status,
      telegram_status: telegramStatus,
      skipped: true,
      skip_reason: "code_agent_repository_required",
    };
  }

  if (nextApproval !== job.approval_status || nextStatus !== job.status) {
    await sb
      .from("code_agent_jobs")
      .update({
        approval_status: nextApproval,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", userId);
    await logJobEvent(jobId, userId, "code_agent_transition_allowed", {
      previous_status: job.status,
      next_status: nextStatus,
      action: "sync_approval",
      approval_status: nextApproval,
      has_repository: !!job.repository_id,
      engine: job.recommended_engine,
    });
    await logJobEvent(jobId, userId, "code_agent_approval_synced", {
      from_status: job.status,
      to_status: nextStatus,
      from_approval: job.approval_status,
      to_approval: nextApproval,
      telegram_status: telegramStatus,
    });
  }

  return {
    job_id: jobId,
    approval_status: nextApproval,
    status: nextStatus,
    telegram_status: telegramStatus,
  };
}

// ============================================================
// v3.15.2 — State Machine & Approval Reliability
// ============================================================

export const CODE_AGENT_JOB_STATUSES = [
  "draft",
  "pending_approval",
  "ready",
  "sent_to_engine",
  "sent_manually",
  "result_received",
  "review_created",
  "review_ready",
  "reviewed",
  "completed",
  "rejected",
  "cancelled",
  "failed",
] as const;

export const CODE_AGENT_APPROVAL_STATUSES = [
  "not_required",
  "auto_approved",
  "draft",
  "pending",
  "approved",
  "rejected",
  "expired",
  "failed",
  "needs_strong_approval",
] as const;

export const CODE_AGENT_TERMINAL_STATUSES: CodeAgentJobStatus[] = [
  "reviewed",
  "completed",
  "rejected",
  "cancelled",
  "failed",
];

export const CODE_AGENT_ACTIVE_STATUSES: CodeAgentJobStatus[] = [
  "draft",
  "pending_approval",
  "ready",
  "sent_to_engine",
  "sent_manually",
  "result_received",
  "review_created",
  "review_ready",
];

const APPROVAL_FINAL: string[] = ["approved", "rejected", "expired", "failed"];

export type CodeAgentTransition = {
  from: CodeAgentJobStatus;
  to: CodeAgentJobStatus;
};

export type CodeAgentNextStep = {
  code:
    | "select_repository"
    | "wait_telegram_approval"
    | "approve_or_reject"
    | "send_manually"
    | "save_result"
    | "create_review"
    | "complete_review"
    | "create_snapshot"
    | "terminal"
    | "blocked"
    | "idle";
  label: string;
  message: string;
};

export type CodeAgentBlockedAction = {
  action: string;
  reason: string;
};

export type CodeAgentAvailableActions = {
  canApprove: boolean;
  canReject: boolean;
  canSyncApproval: boolean;
  canSendManually: boolean;
  canSaveResult: boolean;
  canCreateReview: boolean;
  canCreateNextAction: boolean;
  canCreateSnapshot: boolean;
  blocked: CodeAgentBlockedAction[];
};

type StateJobLike = Pick<
  CodeAgentJob,
  | "status"
  | "approval_status"
  | "risk_level"
  | "job_type"
  | "repository_id"
  | "telegram_approval_id"
  | "result_text"
  | "result_review_item_id"
  | "master_snapshot_draft_id"
  | "metadata"
>;

export function normalizeCodeAgentJobStatus(
  status: string | null,
): CodeAgentJobStatus {
  if (!status) return "draft";
  return (CODE_AGENT_JOB_STATUSES as readonly string[]).includes(status)
    ? (status as CodeAgentJobStatus)
    : "draft";
}

export function normalizeCodeAgentApprovalStatus(
  status: string | null,
): CodeAgentApprovalStatus {
  if (!status) return "pending";
  return (CODE_AGENT_APPROVAL_STATUSES as readonly string[]).includes(status)
    ? (status as CodeAgentApprovalStatus)
    : "pending";
}

export function isCodeAgentJobTerminal(job: StateJobLike): boolean {
  return CODE_AGENT_TERMINAL_STATUSES.includes(
    normalizeCodeAgentJobStatus(job.status as string),
  );
}

function repoResolutionStatus(job: StateJobLike): RepoResolutionStatus | null {
  const meta = job.metadata ?? {};
  const r = (meta.repository_resolution as { status?: string } | undefined)?.status ?? null;
  if (r === "resolved" || r === "ambiguous" || r === "missing") return r;
  return null;
}

function repoRequired(job: StateJobLike): boolean {
  return CODE_JOB_TYPES_REQUIRING_REPO.includes(job.job_type as CodeAgentJobType);
}

function repoBlocking(job: StateJobLike): boolean {
  if (!repoRequired(job)) return false;
  if (job.repository_id) return false;
  const res = repoResolutionStatus(job);
  return res === "missing" || res === "ambiguous" || res === null;
}

function approvalRequired(job: StateJobLike): boolean {
  return job.risk_level === "medium" || job.risk_level === "high";
}

function approvalGranted(job: StateJobLike): boolean {
  const a = normalizeCodeAgentApprovalStatus(job.approval_status as string);
  return a === "approved" || a === "auto_approved" || a === "not_required";
}

export function isCodeAgentJobBlocked(job: StateJobLike): boolean {
  if (isCodeAgentJobTerminal(job)) return false;
  if (repoBlocking(job)) return true;
  if (approvalRequired(job) && !approvalGranted(job)) return true;
  return false;
}

export function canApproveCodeAgentJob(job: StateJobLike): boolean {
  if (isCodeAgentJobTerminal(job)) return false;
  if (job.status !== "pending_approval" && job.status !== "draft") return false;
  if (repoBlocking(job)) return false;
  const a = normalizeCodeAgentApprovalStatus(job.approval_status as string);
  return a === "pending" || a === "draft" || a === "needs_strong_approval";
}

export function canRejectCodeAgentJob(job: StateJobLike): boolean {
  if (isCodeAgentJobTerminal(job)) return false;
  if (job.status === "reviewed") return false;
  return true;
}

export function canSyncCodeAgentApproval(job: StateJobLike): boolean {
  if (!job.telegram_approval_id) return false;
  if (isCodeAgentJobTerminal(job)) return false;
  const a = normalizeCodeAgentApprovalStatus(job.approval_status as string);
  if (APPROVAL_FINAL.includes(a) && a !== "pending") {
    // Already final, but allow if status didn't catch up
    return false;
  }
  return true;
}

export function canSendCodeAgentJobManually(job: StateJobLike): boolean {
  if (isCodeAgentJobTerminal(job)) return false;
  if (repoBlocking(job)) return false;
  if (approvalRequired(job) && !approvalGranted(job)) return false;
  return job.status === "ready" || job.status === "sent_manually";
}

export function canSaveCodeAgentJobResult(job: StateJobLike): boolean {
  if (isCodeAgentJobTerminal(job)) return false;
  if (job.result_text) return false;
  return (
    job.status === "ready" ||
    job.status === "sent_to_engine" ||
    job.status === "sent_manually"
  );
}

export function canCreateReviewFromCodeAgentJob(job: StateJobLike): boolean {
  if (isCodeAgentJobTerminal(job)) return false;
  if (!job.result_text) return false;
  if (job.result_review_item_id) return false;
  return true;
}

export function canCreateMasterSnapshotFromCodeAgentJob(job: StateJobLike): boolean {
  if (!job.result_text) return false;
  if (job.master_snapshot_draft_id) return false;
  return true;
}

export function canCreateNextActionFromCodeAgentJob(job: StateJobLike): boolean {
  if (isCodeAgentJobTerminal(job)) return false;
  return !!job.result_text;
}

export function getCodeAgentJobPhase(job: StateJobLike): string {
  if (isCodeAgentJobTerminal(job)) return "terminal";
  if (repoBlocking(job)) return "blocked_repository";
  if (job.status === "pending_approval") return "awaiting_approval";
  if (job.status === "ready") return "ready_to_send";
  if (job.status === "sent_to_engine" || job.status === "sent_manually")
    return job.result_text ? "result_pending_review" : "awaiting_result";
  if (job.status === "result_received") return "result_to_review";
  if (job.status === "review_ready" || job.status === "review_created")
    return "review_in_progress";
  return job.status as string;
}

export function getCodeAgentNextStep(job: StateJobLike): CodeAgentNextStep {
  if (isCodeAgentJobTerminal(job)) {
    return { code: "terminal", label: "Stato terminale", message: "Nessuna azione necessaria." };
  }
  if (repoBlocking(job)) {
    const res = repoResolutionStatus(job);
    return {
      code: "select_repository",
      label: "Scegli repository",
      message:
        res === "ambiguous"
          ? "Più repository possibili: scegli quello giusto prima di proseguire."
          : "Repository mancante: collega un repo prima di approvare o inviare.",
    };
  }
  if (approvalRequired(job) && !approvalGranted(job)) {
    if (job.telegram_approval_id) {
      return {
        code: "wait_telegram_approval",
        label: "Attendi approvazione Telegram",
        message: "Serve approvazione Telegram prima dell'invio manuale.",
      };
    }
    return {
      code: "approve_or_reject",
      label: "Approva o rifiuta",
      message: "Approva o rifiuta il job prima di proseguire.",
    };
  }
  if (job.status === "ready") {
    return {
      code: "send_manually",
      label: "Invia manualmente",
      message: "Pronto per invio manuale a Codex/Claude Code.",
    };
  }
  if ((job.status === "sent_manually" || job.status === "sent_to_engine") && !job.result_text) {
    return {
      code: "save_result",
      label: "Salva risultato",
      message: "Incolla il risultato ricevuto dall'engine.",
    };
  }
  if (job.status === "result_received" && !job.result_review_item_id) {
    return {
      code: "create_review",
      label: "Crea Result Review",
      message: "Risultato ricevuto: crea una Result Review.",
    };
  }
  if (job.status === "review_ready") {
    return {
      code: "complete_review",
      label: "Completa review",
      message: "Review pronta: completa la revisione prima dello snapshot.",
    };
  }
  if (job.result_text && !job.master_snapshot_draft_id) {
    return {
      code: "create_snapshot",
      label: "Master Snapshot draft",
      message: "Puoi proporre una bozza Master Snapshot (solo dopo review).",
    };
  }
  return { code: "idle", label: "Nessuna azione consigliata", message: "" };
}

export function getCodeAgentAvailableActions(
  job: StateJobLike,
): CodeAgentAvailableActions {
  const blocked: CodeAgentBlockedAction[] = [];
  const repoOk = !repoBlocking(job);
  if (!repoOk) blocked.push({ action: "send_manually", reason: "Scegli repository prima di proseguire" });
  if (approvalRequired(job) && !approvalGranted(job)) {
    blocked.push({
      action: "send_manually",
      reason: "Serve approvazione Telegram prima dell'invio manuale",
    });
  }
  if (!job.result_text) {
    blocked.push({ action: "create_review", reason: "Manca il risultato" });
    blocked.push({ action: "create_snapshot", reason: "Manca il risultato" });
  }
  if (isCodeAgentJobTerminal(job)) {
    blocked.push({ action: "approve", reason: "Job in stato terminale" });
  }
  return {
    canApprove: canApproveCodeAgentJob(job),
    canReject: canRejectCodeAgentJob(job),
    canSyncApproval: canSyncCodeAgentApproval(job),
    canSendManually: canSendCodeAgentJobManually(job),
    canSaveResult: canSaveCodeAgentJobResult(job),
    canCreateReview: canCreateReviewFromCodeAgentJob(job),
    canCreateNextAction: canCreateNextActionFromCodeAgentJob(job),
    canCreateSnapshot: canCreateMasterSnapshotFromCodeAgentJob(job),
    blocked,
  };
}

export class CodeAgentTransitionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CodeAgentTransitionError";
  }
}

export function assertCodeAgentTransitionAllowed(
  job: StateJobLike,
  targetStatus: CodeAgentJobStatus,
  actionName: string,
): void {
  if (isCodeAgentJobTerminal(job)) {
    throw new CodeAgentTransitionError(
      "code_agent_terminal_status",
      `Azione "${actionName}" non ammessa: job in stato terminale (${job.status}).`,
    );
  }
  switch (actionName) {
    case "approve":
      if (!canApproveCodeAgentJob(job)) {
        if (repoBlocking(job))
          throw new CodeAgentTransitionError(
            "code_agent_repository_required",
            "Approvazione bloccata: scegli repository prima.",
          );
        throw new CodeAgentTransitionError(
          "code_agent_transition_not_allowed",
          `Approva non ammessa nello stato ${job.status}/${job.approval_status}.`,
        );
      }
      break;
    case "reject":
      if (!canRejectCodeAgentJob(job))
        throw new CodeAgentTransitionError(
          "code_agent_transition_not_allowed",
          `Rifiuta non ammesso nello stato ${job.status}.`,
        );
      break;
    case "sync_approval":
      if (!job.telegram_approval_id)
        throw new CodeAgentTransitionError(
          "code_agent_transition_not_allowed",
          "Nessuna richiesta Telegram collegata al job.",
        );
      break;
    case "send_manually":
      if (repoBlocking(job))
        throw new CodeAgentTransitionError(
          "code_agent_repository_required",
          "Invio manuale bloccato: repository mancante o ambiguo.",
        );
      if (approvalRequired(job) && !approvalGranted(job))
        throw new CodeAgentTransitionError(
          "code_agent_approval_required",
          "Invio manuale bloccato: serve approvazione per job medium/high.",
        );
      if (!canSendCodeAgentJobManually(job))
        throw new CodeAgentTransitionError(
          "code_agent_transition_not_allowed",
          `Invio manuale non ammesso nello stato ${job.status}.`,
        );
      break;
    case "save_result":
      if (!canSaveCodeAgentJobResult(job))
        throw new CodeAgentTransitionError(
          "code_agent_transition_not_allowed",
          `Salvataggio risultato non ammesso (status=${job.status}, result già presente?).`,
        );
      break;
    case "create_review":
      if (!job.result_text)
        throw new CodeAgentTransitionError(
          "code_agent_result_required",
          "Risultato mancante: non posso creare Result Review.",
        );
      break;
    case "create_snapshot":
      if (!job.result_text)
        throw new CodeAgentTransitionError(
          "code_agent_result_required",
          "Risultato mancante: non posso creare bozza Master Snapshot.",
        );
      break;
    case "create_next_action":
      if (!job.result_text)
        throw new CodeAgentTransitionError(
          "code_agent_result_required",
          "Risultato mancante: non posso creare Next Action.",
        );
      break;
    default:
      break;
  }
  void targetStatus;
}

// ---------- Bulk approval sync ----------

export type CodeAgentBulkApprovalSyncResult = {
  checked: number;
  approved: number;
  rejected: number;
  expired: number;
  failed: number;
  unchanged: number;
  skipped: number;
  errors: Array<{ job_id: string; code: string; message: string }>;
};

export async function syncPendingCodeAgentApprovals(
  brainId?: string | null,
): Promise<CodeAgentBulkApprovalSyncResult> {
  const userId = await currentUserId();
  const summary: CodeAgentBulkApprovalSyncResult = {
    checked: 0,
    approved: 0,
    rejected: 0,
    expired: 0,
    failed: 0,
    unchanged: 0,
    skipped: 0,
    errors: [],
  };
  if (!userId) return summary;
  const items = await listCodeAgentJobs({ brainId: brainId ?? null });
  // Pre-filter: require telegram_approval_id, ignore terminal jobs, ignore
  // already-final approval, ignore repo-blocked medium/high.
  const targets = items.filter((j) => {
    if (!j.telegram_approval_id) return false;
    if (isCodeAgentJobTerminal(j)) return false;
    if (
      APPROVAL_FINAL.includes(
        normalizeCodeAgentApprovalStatus(j.approval_status as string),
      )
    ) {
      return false;
    }
    if (
      (j.risk_level === "medium" || j.risk_level === "high") &&
      repoBlocking(j as unknown as StateJobLike)
    ) {
      return false;
    }
    return true;
  });
  if (targets.length === 0) return summary;
  await logJobEvent(targets[0].id, userId, "code_agent_bulk_approval_sync_started", {
    target_count: targets.length,
    brain_id: brainId ?? null,
  });
  for (const j of targets) {
    summary.checked++;
    try {
      const r = await syncCodeAgentJobApprovalStatus(j.id);
      if (r.skipped) {
        summary.skipped++;
        continue;
      }
      const ts = r.telegram_status;
      if (ts === "approved") summary.approved++;
      else if (ts === "rejected") summary.rejected++;
      else if (ts === "expired") summary.expired++;
      else if (ts === "failed") summary.failed++;
      else summary.unchanged++;
    } catch (e) {
      const err = e instanceof CodeAgentTransitionError
        ? { code: e.code, message: e.message }
        : { code: "sync_failed", message: ((e as Error)?.message ?? "unknown").slice(0, 200) };
      summary.failed++;
      summary.errors.push({ job_id: j.id, ...err });
      try {
        await logJobEvent(j.id, userId, "code_agent_bulk_approval_sync_error", {
          code: err.code,
          message: err.message.slice(0, 200),
        });
      } catch {
        /* best-effort */
      }
    }
  }
  await logJobEvent(targets[0].id, userId, "code_agent_bulk_approval_sync_completed", {
    checked: summary.checked,
    approved: summary.approved,
    rejected: summary.rejected,
    expired: summary.expired,
    failed: summary.failed,
    unchanged: summary.unchanged,
    skipped: summary.skipped,
    error_count: summary.errors.length,
  });
  return summary;
}
