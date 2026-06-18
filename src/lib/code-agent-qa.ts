// ============================================================
// Brain Hub v3.16 — Code Agent End-to-End QA Console
// ============================================================
// Read-only QA helpers: lifecycle checklist, blocked/inconsistent
// jobs, next-step suggestions, recent audit events, runner
// readiness. NEVER mutates jobs, NEVER triggers runners, NEVER
// calls Codex/Claude APIs, NEVER sends Telegram messages.
// ============================================================

import { supabase } from "@/integrations/supabase/client";
import {
  listCodeAgentJobs,
  type CodeAgentJob,
  type CodeAgentJobStatus,
  type CodeAgentJobType,
} from "@/lib/code-agent-orchestrator";
import { isSuspectRepositoryRecord } from "@/lib/github-repository-parse";

type ChecklistStatus = "done" | "warning" | "missing" | "not_applicable";

export type CodeAgentLifecycleChecklistItem = {
  id: string;
  label: string;
  status: ChecklistStatus;
  detail?: string;
};

export type CodeAgentBlockedJob = {
  id: string;
  title: string;
  status: string;
  approval_status: string;
  risk_level: string;
  repository_resolution_status: string | null;
  category: string;
  next_step: string;
  cta: { label: string; to: string };
};

export type CodeAgentInconsistentJob = {
  id: string;
  title: string;
  status: string;
  reason: string;
  cta: { label: string; to: string };
};

export type CodeAgentNextStepSuggestion = {
  id: string;
  count: number;
  label: string;
  suggestion: string;
  cta: { label: string; to: string };
};

export type CodeAgentRecentAuditEvent = {
  id: string;
  created_at: string;
  event_type: string;
  job_id_short: string;
  job_title: string | null;
  reason: string | null;
  code: string | null;
  status: string | null;
  risk_level: string | null;
  source: string | null;
};

export type CodeAgentRunnerReadinessStatus =
  | "not_ready"
  | "almost_ready"
  | "ready_for_design_only";

export type CodeAgentRunnerReadinessCriterion = {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
};

export type CodeAgentRunnerReadiness = {
  status: CodeAgentRunnerReadinessStatus;
  criteria: CodeAgentRunnerReadinessCriterion[];
  note: string;
};

export type CodeAgentQaSummary = {
  total: number;
  open: number;
  blocked: number;
  inconsistent: number;
  awaitingApproval: number;
  awaitingReview: number;
  transitionBlocked24h: number;
  bulkSyncErrors24h: number;
};

const REPO_REQUIRED_TYPES: CodeAgentJobType[] = [
  "code_fix",
  "code_review",
  "code_refactor",
  "typecheck_fix",
  "build_fix",
  "test_generation",
  "test_run",
  "bug_investigation",
  "feature_implementation",
  "security_review",
  "dependency_check",
];

const TERMINAL_STATUSES: CodeAgentJobStatus[] = [
  "completed",
  "rejected",
  "cancelled",
  "failed",
];

const CTA_JOBS = { label: "Apri Code Agent Jobs", to: "/code-agent-jobs" } as const;

function jobTitle(j: CodeAgentJob): string {
  const txt = (j.command_text || "").trim();
  if (!txt) return `Job ${j.id.slice(0, 8)}`;
  return txt.length > 80 ? `${txt.slice(0, 80)}…` : txt;
}

function repoResolution(j: CodeAgentJob): string | null {
  const meta = j.metadata?.repository_resolution as { status?: string } | undefined;
  return meta?.status ?? null;
}

function requiresRepo(j: CodeAgentJob): boolean {
  return REPO_REQUIRED_TYPES.includes(j.job_type as CodeAgentJobType);
}

function approvalGranted(j: CodeAgentJob): boolean {
  return j.approval_status === "approved" || j.approval_status === "auto_approved";
}

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

// ---------- Public helpers ----------

export async function getCodeAgentBlockedJobs(
  brainId?: string | null,
): Promise<CodeAgentBlockedJob[]> {
  const items = await listCodeAgentJobs({ brainId: brainId ?? null });
  const out: CodeAgentBlockedJob[] = [];
  for (const j of items) {
    const res = repoResolution(j);
    const needsRepo = requiresRepo(j);
    const push = (category: string, next_step: string) => {
      out.push({
        id: j.id,
        title: jobTitle(j),
        status: j.status,
        approval_status: j.approval_status,
        risk_level: j.risk_level,
        repository_resolution_status: res,
        category,
        next_step,
        cta: CTA_JOBS,
      });
    };
    if (needsRepo && !j.repository_id && res === "missing") {
      push("repository_missing", "Collega repository");
      continue;
    }
    if (needsRepo && !j.repository_id && res === "ambiguous") {
      push("repository_ambiguous", "Risolvi repository ambiguo");
      continue;
    }
    if (j.status === "pending_approval") {
      const age = hoursSince(j.updated_at);
      push(
        age > 24 ? "approval_pending_too_long" : "approval_required",
        "Richiedi/controlla approvazione Telegram",
      );
      continue;
    }
    if (
      (j.status === "sent_manually" || j.status === "sent_to_engine") &&
      !j.result_text
    ) {
      push("sent_without_result", "Incolla risultato Codex/Claude");
      continue;
    }
    if (j.status === "result_received" && !j.result_review_item_id) {
      push("result_without_review", "Crea Result Review");
      continue;
    }
    if (j.status === "review_ready" && !j.next_action_id) {
      push("review_without_next_action", "Crea Next Action");
      continue;
    }
    if (j.status === "failed") {
      push("job_failed", "Investiga e ripianifica");
      continue;
    }
    if (j.status === "cancelled") {
      push("job_cancelled", "Verifica se ripianificare");
      continue;
    }
  }
  return out;
}

export async function getCodeAgentInconsistentJobs(
  brainId?: string | null,
): Promise<CodeAgentInconsistentJob[]> {
  const items = await listCodeAgentJobs({ brainId: brainId ?? null });
  const out: CodeAgentInconsistentJob[] = [];
  const push = (j: CodeAgentJob, reason: string) =>
    out.push({
      id: j.id,
      title: jobTitle(j),
      status: j.status,
      reason,
      cta: CTA_JOBS,
    });
  for (const j of items) {
    const res = repoResolution(j);
    const needsRepo = requiresRepo(j);
    if (j.status === "ready" && needsRepo && !j.repository_id) {
      push(j, "Status ready ma repository richiesto mancante");
    }
    if (j.status === "sent_manually" && !j.sent_manually_at) {
      push(j, "Status sent_manually senza sent_manually_at");
    }
    if (j.status === "result_received" && !j.result_text) {
      push(j, "Status result_received senza result_text");
    }
    if (j.status === "review_ready" && !j.result_review_item_id) {
      push(j, "Status review_ready senza result_review_item_id");
    }
    if (
      TERMINAL_STATUSES.includes(j.status as CodeAgentJobStatus) &&
      j.approval_status === "pending"
    ) {
      push(j, "Status terminale ma approvazione ancora pendente");
    }
    if (
      (j.risk_level === "medium" || j.risk_level === "high") &&
      !j.telegram_approval_id &&
      !TERMINAL_STATUSES.includes(j.status as CodeAgentJobStatus) &&
      j.approval_status !== "auto_approved"
    ) {
      push(j, "Risk medium/high senza telegram_approval_id");
    }
    if (res === "resolved" && !j.repository_id) {
      push(j, "Repository resolved ma repository_id nullo");
    }
    if (res === "missing" && j.repository_id) {
      push(j, "Repository marked missing ma repository_id valorizzato");
    }
    if (j.status === "sent_manually" && j.result_text) {
      push(j, "Risultato presente ma status ancora sent_manually");
    }
  }
  return out;
}

export async function getCodeAgentNextStepSuggestions(
  brainId?: string | null,
): Promise<CodeAgentNextStepSuggestion[]> {
  const blocked = await getCodeAgentBlockedJobs(brainId ?? null);
  const counts = new Map<string, number>();
  for (const b of blocked) counts.set(b.category, (counts.get(b.category) ?? 0) + 1);
  const map: Record<string, { label: string; suggestion: string }> = {
    repository_missing: {
      label: "Repository mancante",
      suggestion: "Collega repository ai job interessati.",
    },
    repository_ambiguous: {
      label: "Repository ambiguo",
      suggestion: "Scegli il repository corretto fra i candidati.",
    },
    approval_required: {
      label: "Approvazione richiesta",
      suggestion: "Richiedi o controlla approvazione Telegram.",
    },
    approval_pending_too_long: {
      label: "Approvazione pendente da troppo tempo",
      suggestion: "Solleciti o sincronizza approval pendenti.",
    },
    sent_without_result: {
      label: "Inviato senza risultato",
      suggestion: "Incolla il risultato Codex/Claude e segna ricevuto.",
    },
    result_without_review: {
      label: "Risultato senza review",
      suggestion: "Crea Result Review per ogni risultato pendente.",
    },
    review_without_next_action: {
      label: "Review senza next action",
      suggestion: "Crea Next Action o Master Snapshot draft.",
    },
    job_failed: {
      label: "Job falliti",
      suggestion: "Investiga blocchi e ripianifica.",
    },
    job_cancelled: {
      label: "Job annullati",
      suggestion: "Decidi se riproporre il job o archiviarlo.",
    },
  };
  const out: CodeAgentNextStepSuggestion[] = [];
  for (const [cat, count] of counts) {
    const meta = map[cat] ?? { label: cat, suggestion: "Controlla i job." };
    out.push({
      id: cat,
      count,
      label: meta.label,
      suggestion: meta.suggestion,
      cta: CTA_JOBS,
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

export async function getCodeAgentLifecycleChecklist(
  brainId?: string | null,
): Promise<CodeAgentLifecycleChecklistItem[]> {
  const items = await listCodeAgentJobs({ brainId: brainId ?? null });
  const inconsistent = await getCodeAgentInconsistentJobs(brainId ?? null);
  const recentBlocks = await fetchAuditCounts(brainId ?? null);

  const has = (pred: (j: CodeAgentJob) => boolean) => items.some(pred);
  const count = (pred: (j: CodeAgentJob) => boolean) => items.filter(pred).length;

  const check = (
    cond: boolean,
    label: string,
    id: string,
    detail?: string,
    warnOnFalse = false,
  ): CodeAgentLifecycleChecklistItem => ({
    id,
    label,
    status: cond ? "done" : warnOnFalse ? "warning" : "missing",
    detail,
  });

  return [
    check(
      has((j) => (j.source ?? "").toLowerCase().includes("browser") || j.source === "ui"),
      "Job creato da browser",
      "browser-created",
    ),
    check(
      has((j) => (j.source ?? "").toLowerCase().includes("jack")),
      "Job creato da Jack",
      "jack-created",
      undefined,
      true,
    ),
    check(
      has((j) => !!j.repository_id),
      "Repository collegato almeno a un job",
      "repo-linked",
    ),
    check(
      !items.some((j) => requiresRepo(j) && !j.repository_id && repoResolution(j) !== null),
      "Repository ownership verificata",
      "repo-ownership",
      "Nessun job repo-required senza ownership.",
      true,
    ),
    check(
      has((j) => (j.risk_level === "medium" || j.risk_level === "high") && !!j.telegram_approval_id) ||
        !has((j) => j.risk_level === "medium" || j.risk_level === "high"),
      "Approval richiesta per medium/high risk",
      "approval-required",
      undefined,
      true,
    ),
    check(
      has((j) => approvalGranted(j)) || !has((j) => j.risk_level === "medium" || j.risk_level === "high"),
      "Approval approvata o job low-risk pronto",
      "approval-granted",
      undefined,
      true,
    ),
    check(
      has((j) => j.status === "ready" || !!j.prompt_text),
      "Prompt / manual handoff pronto",
      "prompt-ready",
      undefined,
      true,
    ),
    check(
      has((j) => j.status === "sent_manually" || j.status === "sent_to_engine"),
      "Job segnato come inviato manualmente",
      "sent-manual",
      undefined,
      true,
    ),
    check(
      has((j) => !!j.result_text),
      "Risultato ricevuto",
      "result-received",
      undefined,
      true,
    ),
    check(
      has((j) => !!j.result_review_item_id),
      "Result Review creata",
      "review-created",
      undefined,
      true,
    ),
    check(
      has((j) => !!j.next_action_id),
      "Next Action creata",
      "next-action",
      undefined,
      true,
    ),
    check(
      has((j) => !!j.master_snapshot_draft_id),
      "Master Snapshot draft creato (se rilevante)",
      "snapshot-draft",
      undefined,
      true,
    ),
    {
      id: "no-recent-blocks",
      label: "Nessuna transizione bloccata nelle ultime 24h",
      status: recentBlocks.transitionBlocked === 0 ? "done" : "warning",
      detail: `${recentBlocks.transitionBlocked} transition_blocked in 24h`,
    },
    {
      id: "no-inconsistent",
      label: "Nessun job in stato incoerente",
      status: inconsistent.length === 0 ? "done" : "warning",
      detail: `${inconsistent.length} job incoerenti rilevati`,
    },
    {
      id: "open-jobs",
      label: "Job aperti monitorati",
      status: count((j) => !TERMINAL_STATUSES.includes(j.status as CodeAgentJobStatus)) > 0
        ? "done"
        : "not_applicable",
      detail: `${count((j) => !TERMINAL_STATUSES.includes(j.status as CodeAgentJobStatus))} job aperti`,
    },
  ];
}

async function fetchAuditCounts(
  brainId: string | null,
): Promise<{ transitionBlocked: number; bulkSyncErrors: number }> {
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  try {
    let jobIds: string[] | null = null;
    if (brainId) {
      const { data } = await supabase
        .from("code_agent_jobs")
        .select("id")
        .eq("brain_id", brainId)
        .limit(1000);
      jobIds = (data ?? []).map((r) => (r as { id: string }).id);
      if (jobIds.length === 0) return { transitionBlocked: 0, bulkSyncErrors: 0 };
    }
    let q = supabase
      .from("code_agent_job_events")
      .select("event_type")
      .in("event_type", [
        "code_agent_transition_blocked",
        "code_agent_bulk_approval_sync_error",
      ])
      .gte("created_at", since)
      .limit(500);
    if (jobIds) q = q.in("job_id", jobIds);
    const { data } = await q;
    const rows = (data ?? []) as Array<{ event_type: string }>;
    return {
      transitionBlocked: rows.filter((r) => r.event_type === "code_agent_transition_blocked").length,
      bulkSyncErrors: rows.filter((r) => r.event_type === "code_agent_bulk_approval_sync_error").length,
    };
  } catch {
    return { transitionBlocked: 0, bulkSyncErrors: 0 };
  }
}

export async function getCodeAgentRecentAuditEvents(
  brainId?: string | null,
  limit = 10,
): Promise<CodeAgentRecentAuditEvent[]> {
  try {
    let jobIds: string[] | null = null;
    const titleMap = new Map<string, string>();
    if (brainId) {
      const { data } = await supabase
        .from("code_agent_jobs")
        .select("id,command_text")
        .eq("brain_id", brainId)
        .limit(1000);
      const rows = (data ?? []) as Array<{ id: string; command_text: string | null }>;
      jobIds = rows.map((r) => r.id);
      for (const r of rows) titleMap.set(r.id, (r.command_text ?? "").slice(0, 60));
      if (jobIds.length === 0) return [];
    }
    let q = supabase
      .from("code_agent_job_events")
      .select("id,event_type,event_data,created_at,job_id")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (jobIds) q = q.in("job_id", jobIds);
    const { data } = await q;
    const rows = (data ?? []) as Array<{
      id: string;
      event_type: string;
      event_data: Record<string, unknown> | null;
      created_at: string;
      job_id: string;
    }>;
    return rows.map((r) => {
      const ed = r.event_data ?? {};
      const pick = (k: string): string | null => {
        const v = (ed as Record<string, unknown>)[k];
        return typeof v === "string" ? v.slice(0, 80) : null;
      };
      return {
        id: r.id,
        created_at: r.created_at,
        event_type: r.event_type,
        job_id_short: r.job_id.slice(0, 8),
        job_title: titleMap.get(r.job_id) ?? null,
        reason: pick("reason"),
        code: pick("code"),
        status: pick("status") ?? pick("target_status"),
        risk_level: pick("risk_level"),
        source: pick("source"),
      };
    });
  } catch {
    return [];
  }
}

export async function getCodeAgentQaSummary(
  brainId?: string | null,
): Promise<CodeAgentQaSummary> {
  const items = await listCodeAgentJobs({ brainId: brainId ?? null });
  const blocked = await getCodeAgentBlockedJobs(brainId ?? null);
  const inconsistent = await getCodeAgentInconsistentJobs(brainId ?? null);
  const audit = await fetchAuditCounts(brainId ?? null);
  return {
    total: items.length,
    open: items.filter(
      (j) => !TERMINAL_STATUSES.includes(j.status as CodeAgentJobStatus),
    ).length,
    blocked: blocked.length,
    inconsistent: inconsistent.length,
    awaitingApproval: items.filter((j) => j.status === "pending_approval").length,
    awaitingReview: items.filter(
      (j) => j.status === "result_received" && !j.result_review_item_id,
    ).length,
    transitionBlocked24h: audit.transitionBlocked,
    bulkSyncErrors24h: audit.bulkSyncErrors,
  };
}

export async function getCodeAgentRunnerReadiness(
  brainId?: string | null,
): Promise<CodeAgentRunnerReadiness> {
  const summary = await getCodeAgentQaSummary(brainId ?? null);
  const criteria: CodeAgentRunnerReadinessCriterion[] = [
    { id: "server-boundary", label: "Server function boundary completo", ok: true },
    { id: "state-machine", label: "State machine attiva server-side", ok: true },
    { id: "repo-ownership", label: "Repository ownership verificata", ok: true },
    { id: "approval-required", label: "Approval Telegram per medium/high", ok: true },
    { id: "review-required", label: "Review obbligatoria dopo risultato", ok: true },
    { id: "audit-log", label: "Audit log eventi presente", ok: true },
    { id: "no-runner", label: "Nessun runner reale attivo", ok: true },
    { id: "no-frontend-secrets", label: "Nessun segreto nel frontend", ok: true },
    {
      id: "inconsistent-under-threshold",
      label: "Job incoerenti sotto soglia (<5)",
      ok: summary.inconsistent < 5,
      detail: `${summary.inconsistent} incoerenti`,
    },
    {
      id: "transition-blocked-under-threshold",
      label: "Transition blocked recenti sotto soglia (<10/24h)",
      ok: summary.transitionBlocked24h < 10,
      detail: `${summary.transitionBlocked24h} negli ultimi 24h`,
    },
  ];
  const failed = criteria.filter((c) => !c.ok).length;
  let status: CodeAgentRunnerReadinessStatus;
  if (failed === 0) status = "ready_for_design_only";
  else if (failed <= 2) status = "almost_ready";
  else status = "not_ready";
  return {
    status,
    criteria,
    note:
      "Anche se la checklist risulta verde, significa solo che il sistema è pronto per progettare un runner. NON significa che un runner reale sia attivo o debba essere attivato automaticamente.",
  };
}

// ---------- v3.16.2 — Loop QA named warnings ----------

export type CodeAgentLoopQaWarning = {
  id:
    | "caj-ui-only-guard-risk"
    | "caj-server-transition-blocked"
    | "caj-bulk-sync-errors"
    | "caj-transition-enforcement-missing"
    | "caj-e2e-no-ready-job"
    | "caj-e2e-blocked-jobs"
    | "caj-e2e-result-without-review"
    | "caj-e2e-review-without-next-action"
    | "caj-e2e-snapshot-ready";
  severity: "info" | "warning" | "critical";
  label: string;
  detail: string;
};

// Static marker: enumerates orchestrator functions that MUST go through
// assertCodeAgentTransitionAllowed. The list is co-located with the qa
// module so the QA report can tell if v3.16.2 enforcement is in place.
// (Real static analysis happens at PR review; here we expose the marker.)
export const CODE_AGENT_PROTECTED_MUTATIONS: ReadonlyArray<string> = [
  "approveCodeAgentJob",
  "rejectCodeAgentJob",
  "markCodeAgentJobSentManually",
  "saveCodeAgentJobResult",
  "createReviewFromCodeAgentJob",
  "createNextActionFromCodeAgentJob",
  "createMasterSnapshotDraftFromCodeAgentJob",
  "syncCodeAgentJobApprovalStatus",
];

export const CODE_AGENT_TRANSITION_ENFORCEMENT_VERSION = "v3.16.2";

export async function getCodeAgentLoopQaWarnings(
  brainId?: string | null,
): Promise<CodeAgentLoopQaWarning[]> {
  const audit = await fetchAuditCounts(brainId ?? null);
  const warnings: CodeAgentLoopQaWarning[] = [];

  // caj-ui-only-guard-risk: emitted only if the server-side enforcement
  // marker is missing. v3.16.2 sets it, so this should normally not fire.
  if (CODE_AGENT_TRANSITION_ENFORCEMENT_VERSION !== "v3.16.2") {
    warnings.push({
      id: "caj-ui-only-guard-risk",
      severity: "critical",
      label: "UI-only state machine",
      detail:
        "Le mutation non sembrano applicare assertCodeAgentTransitionAllowed lato server.",
    });
  }

  // caj-server-transition-blocked: surface recent server-side blocks.
  if (audit.transitionBlocked > 0) {
    warnings.push({
      id: "caj-server-transition-blocked",
      severity: audit.transitionBlocked >= 10 ? "critical" : "warning",
      label: "Transizioni bloccate (24h)",
      detail: `${audit.transitionBlocked} transition_blocked nelle ultime 24h.`,
    });
  }

  // caj-bulk-sync-errors: surface recent bulk approval sync errors.
  if (audit.bulkSyncErrors > 0) {
    warnings.push({
      id: "caj-bulk-sync-errors",
      severity: audit.bulkSyncErrors >= 5 ? "critical" : "warning",
      label: "Errori bulk approval sync (24h)",
      detail: `${audit.bulkSyncErrors} bulk sync error nelle ultime 24h.`,
    });
  }

  // caj-transition-enforcement-missing: defensive check — the marker list
  // must include all critical mutations. Surfaces as info when matches v3.16.2.
  const expected = [
    "approveCodeAgentJob",
    "rejectCodeAgentJob",
    "markCodeAgentJobSentManually",
    "saveCodeAgentJobResult",
    "createReviewFromCodeAgentJob",
    "createMasterSnapshotDraftFromCodeAgentJob",
    "syncCodeAgentJobApprovalStatus",
  ];
  const missing = expected.filter(
    (name) => !CODE_AGENT_PROTECTED_MUTATIONS.includes(name),
  );
  if (missing.length > 0) {
    warnings.push({
      id: "caj-transition-enforcement-missing",
      severity: "critical",
      label: "Enforcement state machine incompleto",
      detail: `Mutation non protette: ${missing.join(", ")}.`,
    });
  }

  // v3.16.3 — E2E manual flow warnings
  try {
    const e2e = await getCodeAgentEndToEndSummary(brainId ?? null);
    if (e2e.ready_for_manual_test === 0) {
      warnings.push({
        id: "caj-e2e-no-ready-job" as CodeAgentLoopQaWarning["id"],
        severity: "info",
        label: "Nessun job pronto per test manuale",
        detail: "Crea un Code Agent Job pronto per il flusso end-to-end.",
      });
    }
    if (e2e.blocked_repository + e2e.blocked_approval > 0) {
      warnings.push({
        id: "caj-e2e-blocked-jobs" as CodeAgentLoopQaWarning["id"],
        severity: "warning",
        label: "Job bloccati nel flusso end-to-end",
        detail: `${e2e.blocked_repository} repo, ${e2e.blocked_approval} approval.`,
      });
    }
    if (e2e.result_without_review > 0) {
      warnings.push({
        id: "caj-e2e-result-without-review" as CodeAgentLoopQaWarning["id"],
        severity: "warning",
        label: "Risultati senza Result Review",
        detail: `${e2e.result_without_review} job con result_text e senza review.`,
      });
    }
    if (e2e.completed > 0 && e2e.ready_for_snapshot > 0) {
      warnings.push({
        id: "caj-e2e-snapshot-ready" as CodeAgentLoopQaWarning["id"],
        severity: "info",
        label: "Master Snapshot draft proponibile",
        detail: `${e2e.ready_for_snapshot} job pronti per bozza snapshot.`,
      });
    }
    // review-without-next-action: result_review item present ma next_action mancante non
    // sempre rilevabile lato job; approssimiamo con review_ready senza next_action.
    const items = await listCodeAgentJobs({ brainId: brainId ?? null });
    const reviewNoAction = items.filter(
      (j) => j.status === "review_ready" && !j.next_action_id,
    ).length;
    if (reviewNoAction > 0) {
      warnings.push({
        id: "caj-e2e-review-without-next-action" as CodeAgentLoopQaWarning["id"],
        severity: "warning",
        label: "Review senza Next Action",
        detail: `${reviewNoAction} job in review_ready senza next_action.`,
      });
    }
  } catch {
    /* best-effort */
  }

  return warnings;
}

// ============================================================
// v3.16.3 — End-to-end manual flow QA helpers
// ============================================================

export type CodeAgentE2EStepStatus =
  | "done"
  | "warning"
  | "blocked"
  | "pending"
  | "not_applicable";

export type CodeAgentEndToEndStep = {
  id: string;
  label: string;
  status: CodeAgentE2EStepStatus;
  reason: string;
  nextActionLabel: string | null;
  nextActionTarget: string | null;
};

export type CodeAgentEndToEndFlow = {
  jobId: string;
  jobTitle: string;
  status: string;
  approval_status: string;
  risk_level: string;
  has_repository: boolean;
  steps: CodeAgentEndToEndStep[];
  overall:
    | "ready_for_manual_test"
    | "in_progress"
    | "blocked"
    | "completed"
    | "failed";
};

export type CodeAgentEndToEndSummary = {
  total: number;
  ready_for_manual_test: number;
  blocked_repository: number;
  blocked_approval: number;
  sent_without_result: number;
  result_without_review: number;
  ready_for_snapshot: number;
  completed: number;
  failed_or_cancelled: number;
};

const E2E_TARGETS = {
  repo: "/github-operational",
  jobs: "/code-agent-jobs",
  review: "/result-review",
  snapshot: "/master-snapshot",
} as const;

type RepoRow = {
  id: string;
  repository_url: string | null;
  repository_owner: string | null;
  repository_name: string | null;
  archived_at: string | null;
};

async function fetchRepoForJob(repoId: string | null): Promise<RepoRow | null> {
  if (!repoId) return null;
  try {
    const { data } = await supabase
      .from("github_repository_registry")
      .select("id,repository_url,repository_owner,repository_name,archived_at")
      .eq("id", repoId)
      .maybeSingle();
    return (data as RepoRow | null) ?? null;
  } catch {
    return null;
  }
}

function mkStep(
  id: string,
  label: string,
  status: CodeAgentE2EStepStatus,
  reason: string,
  nextActionLabel: string | null = null,
  nextActionTarget: string | null = null,
): CodeAgentEndToEndStep {
  return { id, label, status, reason, nextActionLabel, nextActionTarget };
}

function buildSteps(
  job: CodeAgentJob,
  repo: RepoRow | null,
): CodeAgentEndToEndStep[] {
  const needsRepo = requiresRepo(job);
  const res = repoResolution(job);
  const isTerminal = TERMINAL_STATUSES.includes(job.status as CodeAgentJobStatus);
  const needsApproval =
    job.risk_level === "medium" || job.risk_level === "high";
  const approvalOk =
    approvalGranted(job) || job.approval_status === "not_required";

  const steps: CodeAgentEndToEndStep[] = [];
  steps.push(mkStep("created", "Job creato", "done", `id=${job.id.slice(0, 8)}`));

  if (!needsRepo) {
    steps.push(mkStep("repo-present", "Repository presente", "not_applicable", "Job non richiede repository"));
    steps.push(mkStep("repo-clean", "Repository non sospetto", "not_applicable", "—"));
    steps.push(mkStep("repo-active", "Repository non archiviato", "not_applicable", "—"));
  } else if (!job.repository_id) {
    steps.push(
      mkStep(
        "repo-present",
        "Repository presente",
        "blocked",
        res === "ambiguous" ? "Repository ambiguo" : "Repository mancante",
        "Apri GitHub Operational",
        E2E_TARGETS.repo,
      ),
    );
    steps.push(mkStep("repo-clean", "Repository non sospetto", "pending", "Manca repository"));
    steps.push(mkStep("repo-active", "Repository non archiviato", "pending", "Manca repository"));
  } else {
    steps.push(mkStep("repo-present", "Repository presente", "done", "Repository collegato"));
    if (!repo) {
      steps.push(mkStep("repo-clean", "Repository non sospetto", "warning", "Repository non leggibile"));
      steps.push(mkStep("repo-active", "Repository non archiviato", "warning", "Stato sconosciuto"));
    } else {
      const suspect = isSuspectRepositoryRecord({
        repository_url: repo.repository_url,
        repository_owner: repo.repository_owner,
        repository_name: repo.repository_name,
      });
      steps.push(
        mkStep(
          "repo-clean",
          "Repository non sospetto",
          suspect ? "warning" : "done",
          suspect ? "Record sospetto/non normalizzato" : "Owner/name validi",
          suspect ? "Normalizza repo" : null,
          suspect ? E2E_TARGETS.repo : null,
        ),
      );
      steps.push(
        mkStep(
          "repo-active",
          "Repository non archiviato",
          repo.archived_at ? "blocked" : "done",
          repo.archived_at ? "Repository archiviato" : "Repository attivo",
          repo.archived_at ? "Apri GitHub Operational" : null,
          repo.archived_at ? E2E_TARGETS.repo : null,
        ),
      );
    }
  }

  if (!needsApproval) {
    steps.push(mkStep("approval-required", "Approval non richiesta", "not_applicable", "Risk low"));
    steps.push(mkStep("approval-granted", "Approval approvata se richiesta", "not_applicable", "—"));
  } else {
    steps.push(
      mkStep(
        "approval-required",
        "Approval presente",
        job.telegram_approval_id ? "done" : "warning",
        job.telegram_approval_id ? "Telegram approval linkata" : "Manca telegram_approval_id",
        job.telegram_approval_id ? null : "Apri Code Agent Jobs",
        job.telegram_approval_id ? null : E2E_TARGETS.jobs,
      ),
    );
    steps.push(
      mkStep(
        "approval-granted",
        "Approval approvata",
        approvalOk ? "done" : "blocked",
        `approval=${job.approval_status}`,
        approvalOk ? null : "Apri Code Agent Jobs",
        approvalOk ? null : E2E_TARGETS.jobs,
      ),
    );
  }

  steps.push(
    mkStep(
      "prompt-ready",
      "Prompt Codex/Claude disponibile",
      job.prompt_text ? "done" : "warning",
      job.prompt_text ? `${job.prompt_text.length} char` : "Nessun prompt generato",
      job.prompt_text ? null : "Apri Code Agent Jobs",
      job.prompt_text ? null : E2E_TARGETS.jobs,
    ),
  );

  const canSend =
    !isTerminal &&
    (!needsRepo || !!job.repository_id) &&
    approvalOk &&
    (job.status === "ready" || job.status === "sent_manually");
  steps.push(
    mkStep(
      "sendable-manually",
      "Job inviabile manualmente",
      canSend ? "done" : isTerminal ? "not_applicable" : "pending",
      canSend ? "Pronto per handoff manuale" : `status=${job.status}`,
      canSend ? "Apri Code Agent Jobs" : null,
      canSend ? E2E_TARGETS.jobs : null,
    ),
  );

  const sent =
    job.status === "sent_manually" ||
    job.status === "sent_to_engine" ||
    job.status === "result_received" ||
    job.status === "review_created" ||
    job.status === "review_ready" ||
    job.status === "reviewed" ||
    job.status === "completed";
  steps.push(
    mkStep(
      "sent-manually",
      "Job inviato manualmente",
      sent ? "done" : isTerminal ? "not_applicable" : "pending",
      sent ? `status=${job.status}` : "Non ancora inviato",
      sent ? null : "Apri Code Agent Jobs",
      sent ? null : E2E_TARGETS.jobs,
    ),
  );

  steps.push(
    mkStep(
      "result-present",
      "Result text presente",
      job.result_text ? "done" : sent ? "pending" : "not_applicable",
      job.result_text
        ? `${(job.result_text ?? "").length} char`
        : sent
          ? "Incolla risultato Codex/Claude"
          : "Non ancora inviato",
      job.result_text ? null : sent ? "Apri Code Agent Jobs" : null,
      job.result_text ? null : sent ? E2E_TARGETS.jobs : null,
    ),
  );

  const canCreateReview = !!job.result_text && !job.result_review_item_id && !isTerminal;
  steps.push(
    mkStep(
      "review-creatable",
      "Result Review creabile",
      job.result_review_item_id
        ? "done"
        : canCreateReview
          ? "pending"
          : "not_applicable",
      job.result_review_item_id
        ? "Review già creata"
        : canCreateReview
          ? "Pronta da creare"
          : "Manca result_text",
      canCreateReview ? "Apri Code Agent Jobs" : null,
      canCreateReview ? E2E_TARGETS.jobs : null,
    ),
  );
  steps.push(
    mkStep(
      "review-created",
      "Result Review creata",
      job.result_review_item_id ? "done" : "pending",
      job.result_review_item_id
        ? `id=${job.result_review_item_id.slice(0, 8)}`
        : "Non ancora creata",
      job.result_review_item_id ? "Apri Result Review" : null,
      job.result_review_item_id ? E2E_TARGETS.review : null,
    ),
  );

  const canCreateNextAction = !!job.result_text && !isTerminal;
  steps.push(
    mkStep(
      "next-action-creatable",
      "Next Action creabile",
      job.next_action_id
        ? "done"
        : canCreateNextAction
          ? "pending"
          : "not_applicable",
      job.next_action_id
        ? "Next Action già creata"
        : canCreateNextAction
          ? "Pronta da creare"
          : "Manca result_text",
      canCreateNextAction && !job.next_action_id ? "Apri Code Agent Jobs" : null,
      canCreateNextAction && !job.next_action_id ? E2E_TARGETS.jobs : null,
    ),
  );

  steps.push(
    mkStep(
      "snapshot-allowed",
      "Master Snapshot draft consentito",
      job.result_text ? "done" : "not_applicable",
      job.result_text ? "Risultato presente" : "Serve risultato salvato",
    ),
  );
  steps.push(
    mkStep(
      "snapshot-created",
      "Master Snapshot draft creato",
      job.master_snapshot_draft_id ? "done" : "pending",
      job.master_snapshot_draft_id
        ? `id=${job.master_snapshot_draft_id.slice(0, 8)}`
        : "Nessuna bozza ancora",
      job.master_snapshot_draft_id ? "Apri Master Snapshot" : null,
      job.master_snapshot_draft_id ? E2E_TARGETS.snapshot : null,
    ),
  );

  return steps;
}

function computeOverall(
  job: CodeAgentJob,
  steps: CodeAgentEndToEndStep[],
): CodeAgentEndToEndFlow["overall"] {
  if (job.status === "failed" || job.status === "cancelled") return "failed";
  if (job.status === "reviewed" || job.status === "completed") return "completed";
  if (steps.some((s) => s.status === "blocked")) return "blocked";
  const sendable = steps.find((s) => s.id === "sendable-manually");
  if (sendable?.status === "done" && job.status === "ready") return "ready_for_manual_test";
  return "in_progress";
}

export async function getCodeAgentEndToEndFlow(
  jobId: string,
): Promise<CodeAgentEndToEndFlow | null> {
  if (!jobId) return null;
  try {
    const { data } = await supabase
      .from("code_agent_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();
    const job = data as CodeAgentJob | null;
    if (!job) return null;
    const repo = await fetchRepoForJob(job.repository_id);
    const steps = buildSteps(job, repo);
    return {
      jobId: job.id,
      jobTitle: jobTitle(job),
      status: job.status,
      approval_status: job.approval_status,
      risk_level: job.risk_level,
      has_repository: !!job.repository_id,
      steps,
      overall: computeOverall(job, steps),
    };
  } catch {
    return null;
  }
}

export async function getCodeAgentEndToEndSummary(
  brainId?: string | null,
): Promise<CodeAgentEndToEndSummary> {
  const items = await listCodeAgentJobs({ brainId: brainId ?? null });
  const summary: CodeAgentEndToEndSummary = {
    total: items.length,
    ready_for_manual_test: 0,
    blocked_repository: 0,
    blocked_approval: 0,
    sent_without_result: 0,
    result_without_review: 0,
    ready_for_snapshot: 0,
    completed: 0,
    failed_or_cancelled: 0,
  };
  for (const j of items) {
    const needsRepo = requiresRepo(j);
    const needsApproval = j.risk_level === "medium" || j.risk_level === "high";
    const isTerminal = TERMINAL_STATUSES.includes(j.status as CodeAgentJobStatus);
    if (j.status === "failed" || j.status === "cancelled") {
      summary.failed_or_cancelled++;
      continue;
    }
    if (j.status === "reviewed" || j.status === "completed") {
      summary.completed++;
      continue;
    }
    if (isTerminal) continue;
    if (needsRepo && !j.repository_id) summary.blocked_repository++;
    else if (needsApproval && !approvalGranted(j) && j.approval_status !== "not_required")
      summary.blocked_approval++;
    else if (j.status === "ready") summary.ready_for_manual_test++;
    if (
      (j.status === "sent_manually" || j.status === "sent_to_engine") &&
      !j.result_text
    )
      summary.sent_without_result++;
    if (j.result_text && !j.result_review_item_id) summary.result_without_review++;
    if (j.result_text && !j.master_snapshot_draft_id) summary.ready_for_snapshot++;
  }
  return summary;
}

// ---------- Event logging ----------

export async function logCodeAgentQaEvent(
  eventType:
    | "code_agent_qa_opened"
    | "code_agent_qa_warning_opened"
    | "code_agent_qa_runner_readiness_viewed"
    | "code_agent_e2e_qa_viewed"
    | "code_agent_e2e_job_checked"
    | "code_agent_e2e_blocker_detected"
    | "code_agent_e2e_ready_for_manual_test"
    | "code_agent_e2e_flow_completed",
  payload: Record<string, unknown>,
  jobId?: string | null,
): Promise<void> {
  if (!jobId) return; // table requires job_id NOT NULL → skip silently
  try {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;
    await supabase.from("code_agent_job_events").insert({
      user_id: user.user.id,
      job_id: jobId,
      event_type: eventType,
      event_data: JSON.parse(JSON.stringify(payload)),
    });
  } catch {
    // best-effort
  }
}


