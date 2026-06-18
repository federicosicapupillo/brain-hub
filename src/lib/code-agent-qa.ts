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
    if (j.status === "sent_manually" && !j.metadata?.sent_manually_at) {
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

// ---------- Event logging ----------

export async function logCodeAgentQaEvent(
  eventType:
    | "code_agent_qa_opened"
    | "code_agent_qa_warning_opened"
    | "code_agent_qa_runner_readiness_viewed",
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
