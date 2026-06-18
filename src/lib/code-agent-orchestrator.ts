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
  | "result_received"
  | "review_created"
  | "completed"
  | "rejected"
  | "failed";

export type CodeAgentApprovalStatus =
  | "pending"
  | "auto_approved"
  | "approved"
  | "rejected"
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

export const CODE_AGENT_STATUS_LABEL: Record<CodeAgentJobStatus, string> = {
  draft: "Bozza",
  pending_approval: "In attesa approvazione",
  ready: "Pronto",
  sent_to_engine: "Inviato a engine",
  result_received: "Risultato ricevuto",
  review_created: "Review creata",
  completed: "Completato",
  rejected: "Rifiutato",
  failed: "Fallito",
};

export const CODE_AGENT_STATUS_TONE: Record<CodeAgentJobStatus, string> = {
  draft: "bg-muted text-muted-foreground border-muted",
  pending_approval: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  ready: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  sent_to_engine: "bg-indigo-500/10 text-indigo-600 border-indigo-500/30",
  result_received: "bg-violet-500/10 text-violet-600 border-violet-500/30",
  review_created: "bg-violet-500/10 text-violet-600 border-violet-500/30",
  completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  rejected: "bg-red-500/10 text-red-600 border-red-500/30",
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

const sb = supabase as unknown as SbAny;

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

  const approvalStatus: CodeAgentApprovalStatus = cls.unsafe_request
    ? "needs_strong_approval"
    : cls.risk_level === "low"
      ? "auto_approved"
      : "pending";

  const status: CodeAgentJobStatus = cls.unsafe_request
    ? "pending_approval"
    : cls.risk_level === "low"
      ? "ready"
      : "pending_approval";

  // Build prompt depending on engine
  const promptJob: PromptJobLike = {
    command_text: commandText,
    job_type: cls.job_type,
    risk_level: cls.risk_level,
    recommended_engine: engine,
    branch_name: null,
    repo_scope: input.repository_hint ? { repo_url: input.repository_hint } : {},
    execution_plan: plan as unknown as Record<string, unknown>,
    allowed_commands: plan.allowed_commands,
    forbidden_paths: plan.forbidden_paths,
    metadata: {
      repository_hint: input.repository_hint ?? null,
    },
  };
  const promptText = engine.startsWith("claude_code")
    ? buildClaudeCodeTaskPrompt(promptJob)
    : buildCodexTaskPrompt(promptJob);

  let jobId: string | null = null;
  try {
    const res = await sb
      .from("code_agent_jobs")
      .insert({
        user_id: userId,
        brain_id: input.brain_id ?? null,
        project_id: input.project_id ?? null,
        repository_id: input.repository_id ?? null,
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
        repo_scope: input.repository_hint ? { repo_url: input.repository_hint } : {},
        branch_name: null,
        prompt_text: promptText,
        execution_plan: plan,
        allowed_commands: plan.allowed_commands,
        forbidden_paths: plan.forbidden_paths,
        metadata: {
          jack_classification: cls,
          repository_hint: input.repository_hint ?? null,
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
    await logJobEvent(jobId, userId, "code_agent_job_created", {
      job_type: cls.job_type,
      engine,
      risk: cls.risk_level,
      unsafe: cls.unsafe_request,
    });
  }

  const safeMessage = cls.unsafe_request
    ? "Ho preparato un job, ma chiedi esecuzione automatica: lo blocco e lo segno come high-risk con approvazione forte richiesta. Non eseguo nulla in autonomia."
    : cls.risk_level === "high"
      ? `Ho creato un job high-risk per ${CODE_AGENT_ENGINE_REGISTRY[engine].label}. Serve approvazione forte prima di qualsiasi azione.`
      : cls.risk_level === "medium"
        ? `Ho preparato un job per ${CODE_AGENT_ENGINE_REGISTRY[engine].label}. Rischio medio: lo mando in approvazione prima dell'handoff.`
        : `Ho preparato un job low-risk per ${CODE_AGENT_ENGINE_REGISTRY[engine].label}. Pronto per handoff manuale.`;

  return {
    ok: jobId !== null,
    job_id: jobId,
    job_type: cls.job_type,
    recommended_engine: engine,
    risk_level: cls.risk_level,
    requires_approval: cls.requires_approval,
    status,
    approval_status: approvalStatus,
    next_step: jobId
      ? "Apri /code-agent-jobs per revisione e approvazione."
      : "Riprova: il job non è stato salvato.",
    safe_message: safeMessage,
    unsafe_request: cls.unsafe_request,
  };
}

// ---------- Approval / readiness / result lifecycle ----------

export async function approveCodeAgentJob(jobId: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) throw new Error("auth_required");
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
  const userId = await currentUserId();
  if (!userId) throw new Error("auth_required");
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
  await logJobEvent(jobId, userId, "code_agent_job_result_received", {
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
  const userId = await currentUserId();
  if (!userId) throw new Error("auth_required");
  const job = await loadJob(jobId, userId);
  if (!job) throw new Error("job_not_found");
  if (!job.result_text) throw new Error("no_result");

  const review = await createReviewItem({
    brain_id: job.brain_id,
    title: `Code Agent: ${CODE_AGENT_JOB_TYPE_LABEL[job.job_type as CodeAgentJobType] ?? job.job_type}`,
    result_text: sanitizeText(job.result_text, 4000),
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
      status: "review_created",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("user_id", userId);
  await logJobEvent(jobId, userId, "code_agent_job_review_created", { review_id: review.id });
  return review;
}

export async function createNextActionFromCodeAgentJob(
  jobId: string,
): Promise<AutomationAction | null> {
  const userId = await currentUserId();
  if (!userId) throw new Error("auth_required");
  const job = await loadJob(jobId, userId);
  if (!job) throw new Error("job_not_found");
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
  const userId = await currentUserId();
  if (!userId) throw new Error("auth_required");
  const job = await loadJob(jobId, userId);
  if (!job) throw new Error("job_not_found");

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

export type CodeAgentJobSummary = {
  total: number;
  open: number;
  awaitingApproval: number;
  awaitingReview: number;
  lastEngine: string | null;
};

export async function getCodeAgentJobSummary(
  brainId?: string | null,
): Promise<CodeAgentJobSummary> {
  const items = await listCodeAgentJobs({ brainId: brainId ?? null });
  const open = items.filter(
    (j) => j.status !== "completed" && j.status !== "rejected" && j.status !== "failed",
  ).length;
  const awaitingApproval = items.filter((j) => j.status === "pending_approval").length;
  const awaitingReview = items.filter((j) => j.status === "result_received").length;
  const lastEngine = items[0]?.recommended_engine ?? null;
  return { total: items.length, open, awaitingApproval, awaitingReview, lastEngine };
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
  for (const j of items) {
    if (
      (j.risk_level === "medium" || j.risk_level === "high") &&
      j.approval_status === "pending" &&
      j.status === "pending_approval"
    ) {
      warns.push({
        id: `caj-pending-${j.id}`,
        level: j.risk_level === "high" ? "error" : "warning",
        title: `Code Agent Job in attesa di approvazione (${j.risk_level})`,
        description: `${CODE_AGENT_JOB_TYPE_LABEL[j.job_type as CodeAgentJobType] ?? j.job_type} su ${CODE_AGENT_ENGINE_REGISTRY[j.recommended_engine as CodeAgentEngine]?.label ?? j.recommended_engine}.`,
        cta: { label: "Apri Code Agent Jobs", to: "/code-agent-jobs" },
      });
    }
    if (j.status === "result_received" && !j.result_review_item_id) {
      warns.push({
        id: `caj-no-review-${j.id}`,
        level: "warning",
        title: "Risultato Code Agent senza Result Review",
        description: "Crea una Result Review per il risultato ricevuto.",
        cta: { label: "Apri Code Agent Jobs", to: "/code-agent-jobs" },
      });
    }
    if (
      j.status === "sent_to_engine" &&
      (j.recommended_engine.includes("codex") || j.recommended_engine.includes("claude")) &&
      !(j.metadata?.tests_acknowledged === true)
    ) {
      warns.push({
        id: `caj-no-tests-${j.id}`,
        level: "info",
        title: "Code Agent senza conferma test",
        description: "Verifica che il risultato includa test eseguiti o motivazione esplicita.",
        cta: { label: "Apri Code Agent Jobs", to: "/code-agent-jobs" },
      });
    }
    if (j.risk_level === "high" && j.approval_status === "needs_strong_approval") {
      warns.push({
        id: `caj-high-strong-${j.id}`,
        level: "error",
        title: "Job high-risk con richiesta esecuzione automatica",
        description: "Bloccato. Serve approvazione forte e handoff manuale.",
        cta: { label: "Apri Code Agent Jobs", to: "/code-agent-jobs" },
      });
    }
    if (j.status === "completed" && !j.master_snapshot_draft_id && j.job_type !== "code_review" && j.job_type !== "documentation_update") {
      warns.push({
        id: `caj-no-snapshot-${j.id}`,
        level: "info",
        title: "Job completato senza aggiornamento Master Snapshot",
        description: "Valuta se proporre una bozza di Master Snapshot per questo job.",
        cta: { label: "Apri Code Agent Jobs", to: "/code-agent-jobs" },
      });
    }
  }
  return warns;
}
