// ============================================================
// Brain Hub v3.18/v3.19 — Operational Remediation Planner
// Transforms Loop QA / Operational Health warnings into a guided
// remediation plan, derives closure states and bridges to
// validateLoopReadiness. Read-only diagnostics + manual Action Queue
// integration. No code execution, no external API calls.
// ============================================================

import { supabase } from "@/integrations/supabase/client";
import {
  annotateWarnings,
  getLoopQaSummary,
  logLoopQaEvent,
  validateLoopReadiness,
  type LoopWarning,
  type LoopWarningArea,
  type LoopWarningSeverity,
  type LoopWarningWithMeta,
} from "@/lib/loop-qa";
import type { ActionType, AutomationAction, RiskLevel } from "@/lib/action-queue";

export type RemediationStatus =
  | "open"
  | "action_created"
  | "action_in_progress"
  | "action_completed"
  | "resolved"
  | "regressed"
  | "ignored";

export type RemediationItem = {
  id: string;
  warning_id: string;
  area: LoopWarningArea;
  severity: LoopWarningSeverity;
  priority_score: number;
  title: string;
  explanation: string;
  why_it_matters: string;
  recommended_action: string;
  cta_label: string;
  cta_href: string;
  can_create_action: boolean;
  suggested_action_title: string;
  suggested_action_description: string;
  suggested_action_type: ActionType;
  suggested_action_risk: RiskLevel;
  status: RemediationStatus;
  linked_action_id: string | null;
  linked_action_status: string | null;
};

export type RemediationPlan = {
  brain_id: string | null;
  generated_at: string;
  total: number;
  open: number;
  action_created: number;
  action_in_progress: number;
  action_completed: number;
  resolved: number;
  regressed: number;
  by_area: Record<LoopWarningArea, number>;
  items: RemediationItem[];
  next: RemediationItem | null;
};

// ---------- Priority ranking ----------

const SEVERITY_BASE: Record<LoopWarningSeverity, number> = {
  critical: 1000,
  warning: 500,
  info: 100,
};

const AREA_ORDER: LoopWarningArea[] = [
  "github_registry", // suspect repos / missing repos first (block Code Agent)
  "code_agent",      // transition blocked / E2E blocked
  "master_snapshot",
  "automation_n8n",
  "telegram",
  "drive_calendar_gmail",
  "jack",
  "general",
];

const WARNING_BOOST: Record<string, number> = {
  "github-repository-suspect-records": 80,
  "github-repository-none-valid-for-code-agent": 75,
  "github-repository-active-job-uses-archived-repo": 70,
  "github-repository-duplicate": 50,
  "caj-server-transition-blocked": 65,
  "caj-e2e-blocked-jobs": 60,
  "caj-e2e-result-without-review": 55,
};

export function rankLoopWarningForRemediation(w: LoopWarningWithMeta): number {
  const sev = SEVERITY_BASE[w.severity] ?? 0;
  const idx = AREA_ORDER.indexOf(w.area);
  const areaBonus = idx >= 0 ? (AREA_ORDER.length - idx) * 10 : 0;
  const boost = WARNING_BOOST[w.id] ?? 0;
  return sev + areaBonus + boost;
}

// ---------- Suggestion mapping ----------

type Suggestion = {
  recommended_action: string;
  suggested_action_title: string;
  suggested_action_description: string;
  suggested_action_type: ActionType;
  suggested_action_risk: RiskLevel;
  cta_label?: string;
  cta_href?: string;
  why_it_matters?: string;
  can_create_action?: boolean;
};

function suggestionByArea(area: LoopWarningArea): Suggestion {
  switch (area) {
    case "github_registry":
      return {
        recommended_action: "Apri GitHub Operational e correggi/archivia i repository sospetti.",
        suggested_action_title: "Bonifica GitHub Repository Registry",
        suggested_action_description:
          "Aprire GitHub Operational, validare URL/owner/branch e archiviare i record sospetti.",
        suggested_action_type: "manual_task",
        suggested_action_risk: "medium",
        cta_label: "Apri GitHub Operational",
        cta_href: "/github-operational",
        why_it_matters:
          "Repository non validi bloccano la creazione e l'avvio dei Code Agent Jobs.",
      };
    case "code_agent":
      return {
        recommended_action: "Apri Code Agent QA e sblocca i job nello stato non valido.",
        suggested_action_title: "Sblocca Code Agent Job",
        suggested_action_description:
          "Rivedere il job: verificare repository, approvazione e transizione richiesta.",
        suggested_action_type: "code_review",
        suggested_action_risk: "medium",
        cta_label: "Apri Code Agent QA",
        cta_href: "/code-agent-qa",
        why_it_matters:
          "Job bloccati interrompono il flusso end-to-end prompt → result → review.",
      };
    case "master_snapshot":
      return {
        recommended_action: "Controlla Master Snapshot e risolvi l'incongruenza di versione.",
        suggested_action_title: "Verifica Master Snapshot",
        suggested_action_description:
          "Aprire la pagina Master Snapshot, controllare i warning di integrità versione.",
        suggested_action_type: "review_pending_result",
        suggested_action_risk: "low",
        cta_label: "Apri Master Snapshot",
        cta_href: "/master-snapshot",
        why_it_matters:
          "Versioni inconsistenti compromettono la storia operativa del progetto.",
      };
    case "automation_n8n":
      return {
        recommended_action: "Apri Automation Control e verifica firma HMAC / esecuzioni.",
        suggested_action_title: "Verifica automazione n8n",
        suggested_action_description:
          "Controllare workflow registry, firma HMAC e log di esecuzione recenti.",
        suggested_action_type: "manual_task",
        suggested_action_risk: "medium",
        cta_label: "Apri Automation Control",
        cta_href: "/automation-control",
        why_it_matters:
          "Esecuzioni n8n non firmate o fallite indicano un loop di automazione interrotto.",
      };
    case "telegram":
      return {
        recommended_action: "Apri Telegram Approvals e gestisci le richieste pendenti.",
        suggested_action_title: "Rivedi approvazioni Telegram",
        suggested_action_description:
          "Controllare richieste pendenti, callback ricevuti e timeouts.",
        suggested_action_type: "manual_task",
        suggested_action_risk: "low",
        cta_label: "Apri Telegram Approvals",
        cta_href: "/telegram-approvals",
        why_it_matters: "Richieste Telegram non gestite bloccano azioni che richiedono conferma.",
      };
    case "drive_calendar_gmail":
      return {
        recommended_action: "Apri Connettori e verifica lo stato delle integrazioni Google.",
        suggested_action_title: "Verifica connettori Google",
        suggested_action_description:
          "Controllare Gmail, Drive e Calendar: token, scope e ultimo sync.",
        suggested_action_type: "manual_task",
        suggested_action_risk: "low",
        cta_label: "Apri Connettori",
        cta_href: "/connettori",
        why_it_matters:
          "Connettori interrotti fermano knowledge sync, daily brief e contesto Jack.",
      };
    case "jack":
      return {
        recommended_action: "Apri Jack Memory e verifica fonti/contesto in errore.",
        suggested_action_title: "Verifica Jack memory/context",
        suggested_action_description:
          "Controllare documenti memory, fonti collegate e ultimo refresh contesto.",
        suggested_action_type: "manual_task",
        suggested_action_risk: "low",
        cta_label: "Apri Jack Memory",
        cta_href: "/jack-memory",
        why_it_matters: "Memory incompleta degrada la qualità delle risposte di Jack.",
      };
    case "general":
    default:
      return {
        recommended_action: "Apri Loop QA per i dettagli.",
        suggested_action_title: "Indagine generale",
        suggested_action_description: "Aprire Loop QA per analizzare il warning.",
        suggested_action_type: "manual_task",
        suggested_action_risk: "low",
        cta_label: "Apri Loop QA",
        cta_href: "/loop-qa",
        why_it_matters: "Tenere il loop pulito riduce il rischio di errori a valle.",
      };
  }
}

export function getRemediationSuggestionForWarning(w: LoopWarningWithMeta): Suggestion {
  const base = suggestionByArea(w.area);
  const ctaLabel = w.cta?.label ?? base.cta_label ?? "Apri Loop QA";
  const ctaHref = w.cta?.to ?? base.cta_href ?? "/loop-qa";
  return {
    ...base,
    cta_label: ctaLabel,
    cta_href: ctaHref,
    can_create_action: base.can_create_action ?? true,
  };
}

function explain(w: LoopWarningWithMeta): string {
  if (w.description && w.description.length > 0) return w.description;
  return w.title;
}

// ---------- Plan building ----------

type ActionRow = {
  id: string;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  brain_id: string | null;
};

const OPEN_STATUSES = ["suggested", "pending_approval", "approved", "ready_to_execute"];
const IN_PROGRESS_STATUSES = ["approved", "ready_to_execute"];
const CREATED_STATUSES = ["suggested", "pending_approval"];
const COMPLETED_STATUSES = ["executed"];
const DISMISSED_STATUSES = ["rejected", "failed", "cancelled"];

export type RemediationActionMap = Map<string, ActionRow[]>;

async function fetchAllRemediationActions(
  brainId: string | null,
): Promise<RemediationActionMap> {
  let q = supabase
    .from("automation_actions" as never)
    .select("id,status,metadata,created_at,brain_id")
    .eq("source", "loop_qa")
    .order("created_at", { ascending: false });
  if (brainId) q = q.eq("brain_id", brainId);
  const { data } = await q;
  const rows = (data ?? []) as unknown as ActionRow[];
  const map: RemediationActionMap = new Map();
  for (const r of rows) {
    const md = (r.metadata ?? {}) as Record<string, unknown>;
    const wid = typeof md.source_warning_id === "string" ? md.source_warning_id : null;
    if (!wid) continue;
    const list = map.get(wid) ?? [];
    list.push(r);
    map.set(wid, list);
  }
  return map;
}

export async function getRemediationActionMap(
  brainId?: string | null,
): Promise<RemediationActionMap> {
  return fetchAllRemediationActions(brainId ?? null);
}

function bestActionForWarning(rows: ActionRow[] | undefined): ActionRow | undefined {
  if (!rows || rows.length === 0) return undefined;
  // Priority: completed > in_progress > created > dismissed
  const completed = rows.find((r) => COMPLETED_STATUSES.includes(r.status));
  if (completed) return completed;
  const inProgress = rows.find((r) => IN_PROGRESS_STATUSES.includes(r.status));
  if (inProgress) return inProgress;
  const created = rows.find((r) => CREATED_STATUSES.includes(r.status));
  if (created) return created;
  return rows[0];
}

function deriveStatusFromAction(
  warningPresent: boolean,
  action: ActionRow | undefined,
): RemediationStatus {
  if (!warningPresent) {
    if (!action) return "resolved"; // no warning, no action: not relevant (filtered out)
    return "resolved";
  }
  // warning present
  if (!action) return "open";
  if (COMPLETED_STATUSES.includes(action.status)) return "regressed";
  if (IN_PROGRESS_STATUSES.includes(action.status)) return "action_in_progress";
  if (CREATED_STATUSES.includes(action.status)) return "action_created";
  if (DISMISSED_STATUSES.includes(action.status)) return "open";
  return "open";
}

function toRemediationItem(
  w: LoopWarningWithMeta,
  rows: ActionRow[] | undefined,
): RemediationItem {
  const sug = getRemediationSuggestionForWarning(w);
  const action = bestActionForWarning(rows);
  const status = deriveStatusFromAction(true, action);
  const hasOpenAction = action ? OPEN_STATUSES.includes(action.status) : false;
  return {
    id: `rem-${w.id}`,
    warning_id: w.id,
    area: w.area,
    severity: w.severity,
    priority_score: rankLoopWarningForRemediation(w) + (status === "regressed" ? 200 : 0),
    title: w.title,
    explanation: explain(w),
    why_it_matters: sug.why_it_matters ?? "Migliora la salute operativa di Brain Hub.",
    recommended_action: sug.recommended_action,
    cta_label: sug.cta_label ?? "Apri",
    cta_href: sug.cta_href ?? "/loop-qa",
    can_create_action: sug.can_create_action !== false && !hasOpenAction,
    suggested_action_title: sug.suggested_action_title,
    suggested_action_description: sug.suggested_action_description,
    suggested_action_type: sug.suggested_action_type,
    suggested_action_risk: sug.suggested_action_risk,
    status,
    linked_action_id: action?.id ?? null,
    linked_action_status: action?.status ?? null,
  };
}

function toResolvedItem(
  warningId: string,
  rows: ActionRow[],
): RemediationItem {
  const action = bestActionForWarning(rows);
  // resolved items have no current warning, so we don't have full meta;
  // synthesise the minimum required for UI.
  return {
    id: `rem-${warningId}`,
    warning_id: warningId,
    area: "general",
    severity: "info",
    priority_score: 0,
    title: warningId,
    explanation: "Warning non più rilevato.",
    why_it_matters: "Remediation chiusa con successo.",
    recommended_action: "Nessuna azione richiesta.",
    cta_label: "Apri Action Queue",
    cta_href: "/action-queue",
    can_create_action: false,
    suggested_action_title: "",
    suggested_action_description: "",
    suggested_action_type: "manual_task",
    suggested_action_risk: "low",
    status: "resolved",
    linked_action_id: action?.id ?? null,
    linked_action_status: action?.status ?? null,
  };
}

export function groupRemediationItemsByArea(
  items: RemediationItem[],
): Record<LoopWarningArea, RemediationItem[]> {
  const grouped: Record<LoopWarningArea, RemediationItem[]> = {
    code_agent: [],
    github_registry: [],
    master_snapshot: [],
    automation_n8n: [],
    telegram: [],
    drive_calendar_gmail: [],
    jack: [],
    general: [],
  };
  for (const it of items) grouped[it.area].push(it);
  return grouped;
}

export async function buildOperationalRemediationPlan(
  brainId?: string | null,
): Promise<RemediationPlan> {
  const summary = await getLoopQaSummary(brainId ?? null);
  const annotated = annotateWarnings(summary.warnings);
  const actionMap = await fetchAllRemediationActions(brainId ?? null);

  const currentWarningIds = new Set(annotated.map((w) => w.id));
  const items = annotated.map((w) => toRemediationItem(w, actionMap.get(w.id)));

  // Detect resolved: warning no longer present but action exists
  for (const [wid, rows] of actionMap.entries()) {
    if (currentWarningIds.has(wid)) continue;
    items.push(toResolvedItem(wid, rows));
  }

  items.sort((a, b) => b.priority_score - a.priority_score);

  const byArea = groupRemediationItemsByArea(items);
  const byAreaCount: Record<LoopWarningArea, number> = {
    code_agent: byArea.code_agent.filter((i) => i.status === "open" || i.status === "regressed").length,
    github_registry: byArea.github_registry.filter((i) => i.status === "open" || i.status === "regressed").length,
    master_snapshot: byArea.master_snapshot.filter((i) => i.status === "open" || i.status === "regressed").length,
    automation_n8n: byArea.automation_n8n.filter((i) => i.status === "open" || i.status === "regressed").length,
    telegram: byArea.telegram.filter((i) => i.status === "open" || i.status === "regressed").length,
    drive_calendar_gmail: byArea.drive_calendar_gmail.filter((i) => i.status === "open" || i.status === "regressed").length,
    jack: byArea.jack.filter((i) => i.status === "open" || i.status === "regressed").length,
    general: byArea.general.filter((i) => i.status === "open" || i.status === "regressed").length,
  };

  const count = (s: RemediationStatus) => items.filter((i) => i.status === s).length;
  const open = count("open");
  const actionCreated = count("action_created");
  const actionInProgress = count("action_in_progress");
  const actionCompleted = count("action_completed");
  const resolved = count("resolved");
  const regressed = count("regressed");

  const next =
    items.find((i) => i.status === "regressed") ??
    items.find((i) => i.status === "open") ??
    null;

  const plan: RemediationPlan = {
    brain_id: brainId ?? null,
    generated_at: new Date().toISOString(),
    total: items.length,
    open,
    action_created: actionCreated,
    action_in_progress: actionInProgress,
    action_completed: actionCompleted,
    resolved,
    regressed,
    by_area: byAreaCount,
    items,
    next,
  };

  await logLoopQaEvent("loop_remediation_plan_built", "Piano remediation costruito", {
    brain_id: brainId ?? null,
    total: items.length,
    open,
    action_created: actionCreated,
    action_in_progress: actionInProgress,
    action_completed: actionCompleted,
    resolved,
    regressed,
    next_warning_id: next?.warning_id ?? null,
    next_area: next?.area ?? null,
    next_severity: next?.severity ?? null,
    next_status: next?.status ?? null,
  });

  return plan;
}



export async function getNextRemediationItem(
  brainId?: string | null,
): Promise<RemediationItem | null> {
  const plan = await buildOperationalRemediationPlan(brainId ?? null);
  return plan.next;
}

// ---------- Manual Action Queue creation ----------

export type CreateRemediationActionResult =
  | { ok: true; action: AutomationAction; deduplicated: false }
  | { ok: true; action: AutomationAction; deduplicated: true }
  | { ok: false; error: string };

export async function createRemediationActionForItem(
  item: RemediationItem,
  brainId?: string | null,
): Promise<CreateRemediationActionResult> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) return { ok: false, error: "Non autenticato" };

  // Dedupe check — search any open action linked to the same warning
  const actionMap = await fetchAllRemediationActions(brainId ?? null);
  const rows = actionMap.get(item.warning_id) ?? [];
  const dup = rows.find((r) => OPEN_STATUSES.includes(r.status));
  if (dup) {
    const { data: full } = await supabase
      .from("automation_actions" as never)
      .select("*")
      .eq("id", dup.id)
      .single();
    await logLoopQaEvent(
      "loop_remediation_item_deduplicated",
      "Action remediation già esistente",
      {
        brain_id: brainId ?? null,
        warning_id: item.warning_id,
        existing_action_id: dup.id,
        remediation_item_id: item.id,
      },
    );
    return {
      ok: true,
      action: full as unknown as AutomationAction,
      deduplicated: true,
    };
  }

  const payload = {
    user_id: u.user.id,
    source: "loop_qa",
    action_type: item.suggested_action_type,
    title: item.suggested_action_title,
    description: item.suggested_action_description,
    priority: item.severity === "critical" ? "high" : item.severity === "warning" ? "medium" : "low",
    risk_level: item.suggested_action_risk,
    status: "suggested",
    requires_confirmation: true,
    brain_id: brainId ?? null,
    project_id: null,
    metadata: {
      source_warning_id: item.warning_id,
      remediation_item_id: item.id,
      remediation_area: item.area,
      remediation_severity: item.severity,
      original_cta_href: item.cta_href,
      original_cta_label: item.cta_label,
    },
  };

  const { data, error } = await supabase
    .from("automation_actions" as never)
    .insert(payload as never)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };

  const created = data as unknown as AutomationAction;
  await logLoopQaEvent(
    "loop_remediation_action_created",
    `Action remediation creata: ${created.title}`,
    {
      brain_id: brainId ?? null,
      warning_id: item.warning_id,
      remediation_item_id: item.id,
      area: item.area,
      severity: item.severity,
      action_id: created.id,
      action_type: created.action_type,
      risk_level: created.risk_level,
    },
  );
  return { ok: true, action: created, deduplicated: false };
}

// ---------- Helpers re-exports for UI ----------

export const REMEDIATION_AREA_LABEL: Record<LoopWarningArea, string> = {
  code_agent: "Code Agent",
  github_registry: "GitHub Registry",
  master_snapshot: "Master Snapshot",
  automation_n8n: "Automation / n8n",
  telegram: "Telegram",
  drive_calendar_gmail: "Drive / Calendar / Gmail",
  jack: "Jack",
  general: "General",
};

export const REMEDIATION_SEVERITY_LABEL: Record<LoopWarningSeverity, string> = {
  critical: "Critico",
  warning: "Da fare",
  info: "Informativo",
};

export type { LoopWarning, LoopWarningArea, LoopWarningSeverity };

export const REMEDIATION_STATUS_LABEL: Record<RemediationStatus, string> = {
  open: "Aperta",
  action_created: "Action creata",
  action_in_progress: "In lavorazione",
  action_completed: "Completata",
  resolved: "Risolta",
  regressed: "Riaperta",
  ignored: "Ignorata",
};

// ============================================================
// v3.19 — Closure summary, detection helpers, readiness bridge
// ============================================================

export type RemediationClosureSummary = {
  brain_id: string | null;
  total: number;
  open: number;
  action_created: number;
  action_in_progress: number;
  action_completed: number;
  resolved: number;
  regressed: number;
  progress_pct: number;
  by_area: Record<LoopWarningArea, { open: number; in_action: number; done: number; regressed: number }>;
};

export async function getRemediationClosureSummary(
  brainId?: string | null,
): Promise<RemediationClosureSummary> {
  const plan = await buildOperationalRemediationPlan(brainId ?? null);
  const grouped = groupRemediationItemsByArea(plan.items);
  const by_area: RemediationClosureSummary["by_area"] = {
    code_agent: emptyAreaBucket(),
    github_registry: emptyAreaBucket(),
    master_snapshot: emptyAreaBucket(),
    automation_n8n: emptyAreaBucket(),
    telegram: emptyAreaBucket(),
    drive_calendar_gmail: emptyAreaBucket(),
    jack: emptyAreaBucket(),
    general: emptyAreaBucket(),
  };
  for (const area of Object.keys(grouped) as LoopWarningArea[]) {
    for (const it of grouped[area]) {
      if (it.status === "open") by_area[area].open += 1;
      else if (it.status === "action_created" || it.status === "action_in_progress")
        by_area[area].in_action += 1;
      else if (it.status === "resolved" || it.status === "action_completed")
        by_area[area].done += 1;
      else if (it.status === "regressed") by_area[area].regressed += 1;
    }
  }
  const denom = plan.total === 0 ? 1 : plan.total;
  const progress_pct = Math.round(
    ((plan.resolved + plan.action_completed) / denom) * 100,
  );
  const summary: RemediationClosureSummary = {
    brain_id: brainId ?? null,
    total: plan.total,
    open: plan.open,
    action_created: plan.action_created,
    action_in_progress: plan.action_in_progress,
    action_completed: plan.action_completed,
    resolved: plan.resolved,
    regressed: plan.regressed,
    progress_pct,
    by_area,
  };
  await logLoopQaEvent(
    "loop_remediation_closure_checked",
    "Closure remediation calcolata",
    {
      brain_id: brainId ?? null,
      total: summary.total,
      progress_pct,
      regressed: summary.regressed,
      resolved: summary.resolved,
    },
  );
  return summary;
}

function emptyAreaBucket() {
  return { open: 0, in_action: 0, done: 0, regressed: 0 };
}

export async function detectResolvedRemediations(
  brainId?: string | null,
): Promise<RemediationItem[]> {
  const plan = await buildOperationalRemediationPlan(brainId ?? null);
  const list = plan.items.filter((i) => i.status === "resolved");
  if (list.length > 0) {
    await logLoopQaEvent(
      "loop_remediation_resolved_detected",
      `${list.length} remediation risolte`,
      {
        brain_id: brainId ?? null,
        count: list.length,
        warning_ids: list.map((i) => i.warning_id),
      },
    );
  }
  return list;
}

export async function detectRegressedRemediations(
  brainId?: string | null,
): Promise<RemediationItem[]> {
  const plan = await buildOperationalRemediationPlan(brainId ?? null);
  const list = plan.items.filter((i) => i.status === "regressed");
  if (list.length > 0) {
    await logLoopQaEvent(
      "loop_remediation_regressed_detected",
      `${list.length} remediation riaperte`,
      {
        brain_id: brainId ?? null,
        count: list.length,
        warning_ids: list.map((i) => i.warning_id),
      },
    );
  }
  return list;
}

export type RemediationProgressByArea = Record<
  LoopWarningArea,
  { area: LoopWarningArea; pct: number; open: number; done: number; total: number }
>;

export async function getRemediationProgressByArea(
  brainId?: string | null,
): Promise<RemediationProgressByArea> {
  const summary = await getRemediationClosureSummary(brainId ?? null);
  const out = {} as RemediationProgressByArea;
  for (const area of Object.keys(summary.by_area) as LoopWarningArea[]) {
    const b = summary.by_area[area];
    const total = b.open + b.in_action + b.done + b.regressed;
    const pct = total === 0 ? 100 : Math.round((b.done / total) * 100);
    out[area] = { area, pct, open: b.open, done: b.done, total };
  }
  await logLoopQaEvent(
    "loop_remediation_progress_viewed",
    "Progresso remediation per area letto",
    { brain_id: brainId ?? null },
  );
  return out;
}

// ---------- validateLoopReadiness bridge ----------

export type ReadinessStatus = "ready" | "partially_ready" | "blocked";

export type LoopReadinessHealthBridge = {
  brain_id: string | null;
  ready: boolean;
  status: ReadinessStatus;
  missing: string[];
  missing_by_area: Record<LoopWarningArea, string[]>;
  total_missing: number;
};

function mapMissingLabelToArea(label: string): LoopWarningArea {
  const l = label.toLowerCase();
  if (l.includes("master snapshot")) return "master_snapshot";
  if (l.includes("result review") || l.includes("review")) return "code_agent";
  if (l.includes("telegram")) return "telegram";
  if (l.includes("action")) return "automation_n8n";
  if (l.includes("knowledge")) return "jack";
  if (l.includes("roadmap")) return "automation_n8n";
  if (l.includes("next prompt") || l.includes("learning")) return "code_agent";
  return "general";
}

export function mapReadinessChecksToOperationalAreas(
  missing: string[],
): Record<LoopWarningArea, string[]> {
  const out: Record<LoopWarningArea, string[]> = {
    code_agent: [],
    github_registry: [],
    master_snapshot: [],
    automation_n8n: [],
    telegram: [],
    drive_calendar_gmail: [],
    jack: [],
    general: [],
  };
  for (const m of missing) out[mapMissingLabelToArea(m)].push(m);
  return out;
}

export async function getLoopReadinessHealthBridge(
  brainId?: string | null,
): Promise<LoopReadinessHealthBridge> {
  const r = await validateLoopReadiness(brainId ?? null);
  const total = r.missing.length;
  const status: ReadinessStatus = r.ready
    ? "ready"
    : total >= 4
      ? "blocked"
      : "partially_ready";
  const bridge: LoopReadinessHealthBridge = {
    brain_id: brainId ?? null,
    ready: r.ready,
    status,
    missing: r.missing,
    missing_by_area: mapReadinessChecksToOperationalAreas(r.missing),
    total_missing: total,
  };
  await logLoopQaEvent(
    "loop_readiness_bridge_computed",
    "Bridge readiness calcolato",
    {
      brain_id: brainId ?? null,
      ready: bridge.ready,
      status: bridge.status,
      total_missing: total,
    },
  );
  return bridge;
}

export const READINESS_STATUS_LABEL: Record<ReadinessStatus, string> = {
  ready: "Pronto",
  partially_ready: "Parzialmente pronto",
  blocked: "Bloccato",
};

// ---------- Enhanced next recommended action ----------

export type EnhancedNextAction = {
  label: string;
  to: string;
  reason: string;
  source: "regressed" | "readiness_blocked" | "completed_but_warning" | "critical_open" | "warning_open" | "fallback";
  warning_id: string | null;
};

export async function getEnhancedNextAction(
  brainId?: string | null,
): Promise<EnhancedNextAction> {
  const [plan, bridge] = await Promise.all([
    buildOperationalRemediationPlan(brainId ?? null),
    getLoopReadinessHealthBridge(brainId ?? null),
  ]);

  const regressedCritical = plan.items.find(
    (i) => i.status === "regressed" && i.severity === "critical",
  );
  if (regressedCritical) {
    return {
      label: regressedCritical.cta_label,
      to: regressedCritical.cta_href,
      reason: `Remediation riaperta: ${regressedCritical.title}`,
      source: "regressed",
      warning_id: regressedCritical.warning_id,
    };
  }

  if (bridge.status === "blocked") {
    return {
      label: "Apri Loop QA",
      to: "/loop-qa",
      reason: `Readiness bloccata: ${bridge.total_missing} step mancanti.`,
      source: "readiness_blocked",
      warning_id: null,
    };
  }

  const regressed = plan.items.find((i) => i.status === "regressed");
  if (regressed) {
    return {
      label: regressed.cta_label,
      to: regressed.cta_href,
      reason: `Remediation riaperta: ${regressed.title}`,
      source: "regressed",
      warning_id: regressed.warning_id,
    };
  }

  const criticalOpen = plan.items.find(
    (i) => i.status === "open" && i.severity === "critical",
  );
  if (criticalOpen) {
    return {
      label: criticalOpen.cta_label,
      to: criticalOpen.cta_href,
      reason: criticalOpen.title,
      source: "critical_open",
      warning_id: criticalOpen.warning_id,
    };
  }

  const warningOpen = plan.items.find(
    (i) => i.status === "open" && i.severity === "warning",
  );
  if (warningOpen) {
    return {
      label: warningOpen.cta_label,
      to: warningOpen.cta_href,
      reason: warningOpen.title,
      source: "warning_open",
      warning_id: warningOpen.warning_id,
    };
  }

  return {
    label: "Apri Loop QA",
    to: "/loop-qa",
    reason: "Nessuna remediation prioritaria.",
    source: "fallback",
    warning_id: null,
  };
}
