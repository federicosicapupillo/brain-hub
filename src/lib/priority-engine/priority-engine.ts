// Brain Hub v3.31 — Priority Engine ("Today's Focus")
// Pure rule-based prioritization. NO generative AI.
//
// Builds at most 5 priorities from heterogeneous sources using a fixed
// rule hierarchy (see PRIORITY_RULES below). Each priority carries its
// own DataTrust envelope so consumers can trace exactly which rule and
// which rows produced it (architecture-principles.md, Principio 1).
//
// Source Criticality (architecture-principles.md, Principio 2) is
// declared as PRIORITY_SOURCE_CRITICALITY and actually used by
// `aggregatePriorities` to decide widget-level status + confidence.

import type {
  DataTrust,
  DataTrustStatus,
  SourceCriticality,
} from "@/lib/data-trust/types";

// -- Source Criticality (decision of THIS consumer; do not globalize) --
export const PRIORITY_SOURCE_KEYS = [
  "action_queue",
  "result_review",
  "projects",
  "agent_runs",
  "gmail",
  "github",
] as const;
export type PrioritySourceKey = (typeof PRIORITY_SOURCE_KEYS)[number];

export const PRIORITY_SOURCE_CRITICALITY: Readonly<
  Record<PrioritySourceKey, SourceCriticality>
> = Object.freeze({
  action_queue: "required",
  result_review: "important",
  projects: "important",
  agent_runs: "optional",
  gmail: "optional",
  github: "optional",
});

// -- Rule taxonomy (ordered) --
export const PRIORITY_RULES = [
  "review_pending",
  "action_blocked",
  "automation_failed",
  "agent_waiting",
  "important_email",
] as const;
export type PriorityRule = (typeof PRIORITY_RULES)[number];

export type PrioritySeverity = "high" | "medium" | "low";

export interface PriorityItem {
  id: string;
  rule: PriorityRule;
  severity: PrioritySeverity;
  title: string;
  reason: string;
  source_id: string;
  source_key: PrioritySourceKey;
  trust: DataTrust;
}

// -- Per-source fetch outcome (inputs to the engine) --
export interface SourceOutcome<TRow> {
  status: DataTrustStatus; // "live" | "empty" | "error" | "missing" | "unknown"
  rows: TRow[];
  freshness: string | null;
  error_safe_message?: string;
}

export interface PriorityEngineInputs {
  action_queue: SourceOutcome<{
    id: string;
    title: string;
    status: string;
    priority: string | null;
    risk_level: string | null;
    created_at: string;
  }>;
  result_review: SourceOutcome<{
    id: string;
    title: string;
    review_status: string;
    risk_level: string | null;
    source_type: string | null;
    created_at: string;
  }>;
  projects: SourceOutcome<{
    id: string;
    title: string;
    status: string | null;
    updated_at: string;
  }>;
  agent_runs: SourceOutcome<{
    id: string;
    objective: string;
    run_status: string;
    risk_level: string | null;
    created_at: string;
  }>;
  gmail: SourceOutcome<{
    id: string;
    subject: string | null;
    from_email: string | null;
    importance_score: number;
    is_important: boolean;
    is_unread: boolean;
    internal_date: string | null;
  }>;
  github: SourceOutcome<{ id: string }>;
}

// -- Rule helpers (each returns priorities with explicit DataTrust) --

const RULE_TABLES: Record<PriorityRule, string[]> = {
  review_pending: ["result_review_items"],
  action_blocked: ["automation_actions"],
  automation_failed: ["automation_actions", "agent_run_logs"],
  agent_waiting: ["agent_run_logs"],
  important_email: ["gmail_message_map"],
};

// Per-rule confidence is a fixed score assigned by the rule branch (not a
// 1:1 column read), so it qualifies as rule_based_score per
// architecture-principles v1.1. Severity itself is also rule-derived
// (e.g. risk_level → high/medium), confirming the classification.
const RULE_SOURCE_KEY: Record<PriorityRule, PrioritySourceKey> = {
  review_pending: "result_review",
  action_blocked: "action_queue",
  automation_failed: "action_queue",
  agent_waiting: "agent_runs",
  important_email: "gmail",
};

function trustFor(
  rule: PriorityRule,
  freshness: string | null,
  confidence: number,
  confidence_reason: string,
  warnings: string[] = [],
): DataTrust {
  const sourceKey = RULE_SOURCE_KEY[rule];
  return {
    status: "live",
    confidence,
    calculation_method: "rule_based_score",
    provenance: {
      source_tables: RULE_TABLES[rule],
      source_functions: ["priority-engine.computePriorities"],
    },
    freshness,
    warnings: warnings.length > 0 ? warnings : undefined,
    rule_metadata: {
      rules_used: [`rule:${rule}`],
      input_sources: [sourceKey],
      source_criticality: {
        [sourceKey]: PRIORITY_SOURCE_CRITICALITY[sourceKey],
      },
      confidence_reason,
    },
  };
}

function emitReviewPending(
  input: PriorityEngineInputs["result_review"],
): PriorityItem[] {
  if (input.status !== "live") return [];
  return input.rows.slice(0, 5).map((r) => ({
    id: `review:${r.id}`,
    rule: "review_pending",
    severity:
      r.risk_level === "high" || r.risk_level === "critical"
        ? "high"
        : "medium",
    title: r.title || "Pending review",
    reason: `Review pendente (${r.source_type ?? "unknown"})`,
    source_id: r.id,
    source_key: "result_review",
    trust: trustFor(
      "review_pending",
      input.freshness,
      95,
      "rule:review_pending → fixed score 95 (review pendente in result_review_items, severity derivata da risk_level)",
    ),
  }));
}

function emitActionBlocked(
  input: PriorityEngineInputs["action_queue"],
): PriorityItem[] {
  if (input.status !== "live") return [];
  return input.rows
    .filter((a) => a.status === "blocked")
    .slice(0, 5)
    .map((a) => ({
      id: `action-blocked:${a.id}`,
      rule: "action_blocked",
      severity: a.priority === "high" ? "high" : "medium",
      title: a.title || "Blocked action",
      reason: `Action bloccata (priority ${a.priority ?? "—"})`,
      source_id: a.id,
      source_key: "action_queue",
      trust: trustFor(
        "action_blocked",
        input.freshness,
        100,
        "rule:action_blocked → fixed score 100 (status=blocked letto direttamente da automation_actions)",
      ),
    }));
}

function emitAutomationFailed(
  actions: PriorityEngineInputs["action_queue"],
  runs: PriorityEngineInputs["agent_runs"],
): PriorityItem[] {
  const out: PriorityItem[] = [];
  if (actions.status === "live") {
    for (const a of actions.rows) {
      if (a.status === "failed") {
        out.push({
          id: `automation-failed:action:${a.id}`,
          rule: "automation_failed",
          severity: "high",
          title: a.title || "Failed automation",
          reason: "Automation fallita (action_queue)",
          source_id: a.id,
          source_key: "action_queue",
          trust: trustFor(
            "automation_failed",
            actions.freshness,
            100,
            "rule:automation_failed (action_queue) → fixed score 100 (status=failed in automation_actions)",
          ),
        });
      }
    }
  }
  if (runs.status === "live") {
    for (const r of runs.rows) {
      if (r.run_status === "failed" || r.run_status === "error") {
        out.push({
          id: `automation-failed:run:${r.id}`,
          rule: "automation_failed",
          severity: "high",
          title: r.objective || "Failed agent run",
          reason: "Run agente fallita",
          source_id: r.id,
          source_key: "agent_runs",
          trust: trustFor("automation_failed", runs.freshness, 100),
        });
      }
    }
  }
  return out.slice(0, 5);
}

const AGENT_WAITING_STATUSES = new Set([
  "waiting",
  "queued",
  "pending",
  "awaiting_approval",
  "blocked",
]);

function emitAgentWaiting(
  input: PriorityEngineInputs["agent_runs"],
): PriorityItem[] {
  if (input.status !== "live") return [];
  return input.rows
    .filter((r) => AGENT_WAITING_STATUSES.has(r.run_status))
    .slice(0, 5)
    .map((r) => ({
      id: `agent-waiting:${r.id}`,
      rule: "agent_waiting",
      severity: "medium",
      title: r.objective || "Agent waiting",
      reason: `Agente in attesa (${r.run_status})`,
      source_id: r.id,
      source_key: "agent_runs",
      trust: trustFor("agent_waiting", input.freshness, 90),
    }));
}

function emitImportantEmail(
  input: PriorityEngineInputs["gmail"],
): PriorityItem[] {
  if (input.status !== "live") return [];
  return input.rows
    .filter((e) => e.is_unread && (e.is_important || e.importance_score >= 70))
    .slice(0, 5)
    .map((e) => ({
      id: `email:${e.id}`,
      rule: "important_email",
      severity: e.importance_score >= 85 ? "high" : "medium",
      title: e.subject || "(no subject)",
      reason: `Email importante non letta${
        e.from_email ? ` da ${e.from_email}` : ""
      }`,
      source_id: e.id,
      source_key: "gmail",
      trust: trustFor("important_email", input.freshness, 80),
    }));
}

// -- Aggregation: rule order + criticality-aware widget envelope --

const SEVERITY_RANK: Record<PrioritySeverity, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const RULE_ORDER: Record<PriorityRule, number> = {
  review_pending: 1,
  action_blocked: 2,
  automation_failed: 3,
  agent_waiting: 4,
  important_email: 5,
};

export interface PriorityEngineResult {
  widget: DataTrust;
  priorities: PriorityItem[];
  per_source: Record<
    PrioritySourceKey,
    {
      status: DataTrustStatus;
      criticality: SourceCriticality;
      freshness: string | null;
      error_safe_message?: string;
    }
  >;
}

export function computePriorities(
  inputs: PriorityEngineInputs,
  opts: { maxItems?: number } = {},
): PriorityEngineResult {
  const max = opts.maxItems ?? 5;
  const all: PriorityItem[] = [
    ...emitReviewPending(inputs.result_review),
    ...emitActionBlocked(inputs.action_queue),
    ...emitAutomationFailed(inputs.action_queue, inputs.agent_runs),
    ...emitAgentWaiting(inputs.agent_runs),
    ...emitImportantEmail(inputs.gmail),
  ];

  all.sort((a, b) => {
    const r = RULE_ORDER[a.rule] - RULE_ORDER[b.rule];
    if (r !== 0) return r;
    return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  });

  const priorities = all.slice(0, max);

  // Per-source bookkeeping.
  const per_source = {} as PriorityEngineResult["per_source"];
  const sourceStatus: Record<PrioritySourceKey, DataTrustStatus> = {
    action_queue: inputs.action_queue.status,
    result_review: inputs.result_review.status,
    projects: inputs.projects.status,
    agent_runs: inputs.agent_runs.status,
    gmail: inputs.gmail.status,
    github: inputs.github.status,
  };
  for (const k of PRIORITY_SOURCE_KEYS) {
    const outcome =
      k === "action_queue"
        ? inputs.action_queue
        : k === "result_review"
          ? inputs.result_review
          : k === "projects"
            ? inputs.projects
            : k === "agent_runs"
              ? inputs.agent_runs
              : k === "gmail"
                ? inputs.gmail
                : inputs.github;
    per_source[k] = {
      status: outcome.status,
      criticality: PRIORITY_SOURCE_CRITICALITY[k],
      freshness: outcome.freshness,
      error_safe_message: outcome.error_safe_message,
    };
  }

  // Criticality-aware widget envelope.
  const warnings: string[] = [];
  let widgetStatus: DataTrustStatus = "live";
  let widgetConfidence: number | null = 95;

  let requiredFailed = false;
  let importantFailed = false;

  for (const k of PRIORITY_SOURCE_KEYS) {
    const s = sourceStatus[k];
    const c = PRIORITY_SOURCE_CRITICALITY[k];
    const isFail = s === "error" || s === "missing" || s === "unknown";
    if (!isFail) continue;
    if (c === "required") {
      requiredFailed = true;
      warnings.push(`required_source_${k}_${s}`);
    } else if (c === "important") {
      importantFailed = true;
      warnings.push(`important_source_${k}_${s}`);
    } else {
      warnings.push(`optional_source_${k}_${s}`);
    }
  }

  if (requiredFailed) {
    widgetStatus = "error";
    widgetConfidence = null;
  } else if (importantFailed) {
    widgetConfidence = 60;
  } else if (priorities.length === 0) {
    widgetStatus = "empty";
    widgetConfidence = 100;
  }

  const freshness =
    [
      inputs.action_queue.freshness,
      inputs.result_review.freshness,
      inputs.projects.freshness,
      inputs.agent_runs.freshness,
      inputs.gmail.freshness,
      inputs.github.freshness,
    ]
      .filter((x): x is string => !!x)
      .sort()
      .pop() ?? null;

  const widget: DataTrust = {
    status: widgetStatus,
    confidence: widgetConfidence,
    calculation_method: "weighted_average",
    provenance: {
      source_tables: [
        "result_review_items",
        "automation_actions",
        "agent_run_logs",
        "gmail_message_map",
        "project_links",
        "github_repository_registry",
      ],
      source_functions: ["priority-engine.computePriorities"],
    },
    freshness,
    warnings: warnings.length > 0 ? warnings : undefined,
  };

  return { widget, priorities, per_source };
}
