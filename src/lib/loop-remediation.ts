// ============================================================
// Brain Hub v3.18 — Operational Remediation Planner
// Transforms Loop QA / Operational Health warnings into a guided
// remediation plan. Read-only diagnostics + manual Action Queue
// integration. No code execution, no external API calls.
// ============================================================

import { supabase } from "@/integrations/supabase/client";
import {
  annotateWarnings,
  getLoopQaSummary,
  logLoopQaEvent,
  type LoopWarning,
  type LoopWarningArea,
  type LoopWarningSeverity,
  type LoopWarningWithMeta,
} from "@/lib/loop-qa";
import type { ActionType, AutomationAction, RiskLevel } from "@/lib/action-queue";

export type RemediationStatus = "open" | "action_created" | "resolved" | "ignored";

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
};

export type RemediationPlan = {
  brain_id: string | null;
  generated_at: string;
  total: number;
  open: number;
  action_created: number;
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
};

async function fetchExistingRemediationActions(
  brainId: string | null,
): Promise<Map<string, ActionRow>> {
  const openStatuses = ["suggested", "pending_approval", "approved", "ready_to_execute"];
  let q = supabase
    .from("automation_actions" as never)
    .select("id,status,metadata")
    .eq("source", "loop_qa")
    .in("status", openStatuses);
  if (brainId) q = q.eq("brain_id", brainId);
  const { data } = await q;
  const rows = (data ?? []) as unknown as ActionRow[];
  const map = new Map<string, ActionRow>();
  for (const r of rows) {
    const md = (r.metadata ?? {}) as Record<string, unknown>;
    const wid = typeof md.source_warning_id === "string" ? md.source_warning_id : null;
    if (wid && !map.has(wid)) map.set(wid, r);
  }
  return map;
}

function toRemediationItem(
  w: LoopWarningWithMeta,
  existing: ActionRow | undefined,
): RemediationItem {
  const sug = getRemediationSuggestionForWarning(w);
  const status: RemediationStatus = existing ? "action_created" : "open";
  return {
    id: `rem-${w.id}`,
    warning_id: w.id,
    area: w.area,
    severity: w.severity,
    priority_score: rankLoopWarningForRemediation(w),
    title: w.title,
    explanation: explain(w),
    why_it_matters: sug.why_it_matters ?? "Migliora la salute operativa di Brain Hub.",
    recommended_action: sug.recommended_action,
    cta_label: sug.cta_label ?? "Apri",
    cta_href: sug.cta_href ?? "/loop-qa",
    can_create_action: sug.can_create_action !== false && !existing,
    suggested_action_title: sug.suggested_action_title,
    suggested_action_description: sug.suggested_action_description,
    suggested_action_type: sug.suggested_action_type,
    suggested_action_risk: sug.suggested_action_risk,
    status,
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
  const existing = await fetchExistingRemediationActions(brainId ?? null);

  const items = annotated
    .map((w) => toRemediationItem(w, existing.get(w.id)))
    .sort((a, b) => b.priority_score - a.priority_score);

  const byArea = groupRemediationItemsByArea(items);
  const byAreaCount: Record<LoopWarningArea, number> = {
    code_agent: byArea.code_agent.filter((i) => i.status === "open").length,
    github_registry: byArea.github_registry.filter((i) => i.status === "open").length,
    master_snapshot: byArea.master_snapshot.filter((i) => i.status === "open").length,
    automation_n8n: byArea.automation_n8n.filter((i) => i.status === "open").length,
    telegram: byArea.telegram.filter((i) => i.status === "open").length,
    drive_calendar_gmail: byArea.drive_calendar_gmail.filter((i) => i.status === "open").length,
    jack: byArea.jack.filter((i) => i.status === "open").length,
    general: byArea.general.filter((i) => i.status === "open").length,
  };

  const open = items.filter((i) => i.status === "open").length;
  const actionCreated = items.filter((i) => i.status === "action_created").length;
  const next = items.find((i) => i.status === "open") ?? null;

  const plan: RemediationPlan = {
    brain_id: brainId ?? null,
    generated_at: new Date().toISOString(),
    total: items.length,
    open,
    action_created: actionCreated,
    by_area: byAreaCount,
    items,
    next,
  };

  await logLoopQaEvent("loop_remediation_plan_built", "Piano remediation costruito", {
    brain_id: brainId ?? null,
    total: items.length,
    open,
    action_created: actionCreated,
    next_warning_id: next?.warning_id ?? null,
    next_area: next?.area ?? null,
    next_severity: next?.severity ?? null,
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

  // Dedupe check
  const existing = await fetchExistingRemediationActions(brainId ?? null);
  const dup = existing.get(item.warning_id);
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
