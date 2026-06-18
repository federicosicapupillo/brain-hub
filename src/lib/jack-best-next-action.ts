// ============================================================
// Brain Hub v3.19.2 — Jack Best Available Next Action
// + Readiness Details Tool Fix
// ============================================================
// Cascading fallback so Jack never tells Federico "nessuna azione"
// when other Brain Hub modules already surface a clear priority.
//
// Priority order:
//   1. Action Queue (open)
//   2. Daily Brief next_actions
//   3. getEnhancedNextAction (regressed / readiness / critical / warning)
//   4. getBrainHubOperationalHealth.nextAction
//   5. buildOperationalRemediationPlan first open item
//   6. getRemediationClosureSummary (still-open regressed area)
//   7. getLoopReadinessHealthBridge blocked
//   8. fallback: ask to regenerate Daily Brief
//
// v3.19.2: when source = readiness (or operational_health with blocked
// readiness), the response now carries concrete missing step details
// (label, area, why_it_matters, suggested_fix, cta) so Jack can speak
// the top missing steps instead of asking the user for hints.
//
// READ-ONLY: this helper never creates actions, never calls external
// APIs (Codex/Claude/Telegram/Gmail/Drive/Calendar/n8n), never executes
// code, never commits/pushes/PRs, never approves snapshots.
// ============================================================

import { supabase } from "@/integrations/supabase/client";
import {
  getTodayOperatingBrief,
  getAnyTodayOperatingBriefForUser,
  type DailyBriefRow,
  type NextActionItem,
} from "@/lib/daily-operating-brief";
import {
  getEnhancedNextAction,
  buildOperationalRemediationPlan,
  getRemediationClosureSummary,
  getLoopReadinessHealthBridge,
} from "@/lib/loop-remediation";
import {
  getBrainHubOperationalHealth,
  getLoopQaSummary,
  type LoopWarningArea,
  type LoopWarningSeverity,
  type LoopStep,
} from "@/lib/loop-qa";

// ============================================================
// Jack Readiness Details — v3.19.2
// ============================================================

export type JackReadinessStatus = "ready" | "partially_ready" | "blocked";

export type JackReadinessMissingStep = {
  id: string;
  label: string;
  area: LoopWarningArea | "general";
  severity: LoopWarningSeverity;
  why_it_matters: string;
  suggested_fix: string;
  cta_label: string;
  cta_href: string;
};

export type JackReadinessDetails = {
  brain_id: string | null;
  status: JackReadinessStatus;
  ready: boolean;
  missing_count: number;
  missing_steps: JackReadinessMissingStep[];
  top_missing_steps: JackReadinessMissingStep[];
};

function mapStepIdToArea(stepId: string): LoopWarningArea | "general" {
  const s = stepId.toLowerCase();
  if (s.includes("review")) return "code_agent";
  if (s.includes("knowledge")) return "jack";
  if (s.includes("roadmap") || s.includes("action") || s.includes("prompt"))
    return "automation_n8n";
  if (s.includes("snapshot")) return "master_snapshot";
  if (s.includes("telegram")) return "telegram";
  return "general";
}

function severityForStep(step: LoopStep): LoopWarningSeverity {
  // Steps 1-4 are foundational (no action / no review / no decision)
  const m = step.id.match(/^(\d+)/);
  const n = m ? Number(m[1]) : 0;
  if (n > 0 && n <= 4) return "critical";
  return "warning";
}

function whyStepMatters(step: LoopStep): string {
  const id = step.id;
  if (id.startsWith("1_")) return "Senza un'action iniziale il loop non parte.";
  if (id.startsWith("2_"))
    return "Senza action completata non c'è un risultato da rivedere.";
  if (id.startsWith("3_"))
    return "Senza Result Review non si valida l'output e non si apprende.";
  if (id.startsWith("4_"))
    return "Senza decisione sulla review il loop resta sospeso.";
  if (id.startsWith("5_"))
    return "Senza learning suggestions non si genera knowledge nuova.";
  if (id.startsWith("6_"))
    return "Senza suggestion accettata l'apprendimento non si consolida.";
  if (id.startsWith("7_"))
    return "Senza knowledge note il sapere non viene capitalizzato.";
  if (id.startsWith("8_"))
    return "Senza roadmap update il piano operativo non si aggiorna.";
  if (id.startsWith("9_"))
    return "Senza next prompt il prossimo ciclo non è pronto.";
  if (id.startsWith("10_"))
    return "Senza nuova action il loop non si chiude e non riparte.";
  return "Step necessario per chiudere il loop operativo.";
}

function suggestedFixForStep(step: LoopStep): string {
  const cta = step.cta?.label;
  if (cta) return `${cta} e completa lo step "${step.label}".`;
  return `Completa lo step "${step.label}".`;
}

export async function getJackReadinessDetails(
  brainId?: string | null,
): Promise<JackReadinessDetails> {
  const scopedBrain = brainId ?? null;
  const summary = await getLoopQaSummary(scopedBrain);
  const missingSteps = summary.steps.filter((s) => s.status === "missing");
  const ready = missingSteps.length === 0;
  const status: JackReadinessStatus = ready
    ? "ready"
    : missingSteps.length >= 4
      ? "blocked"
      : "partially_ready";

  const mapped: JackReadinessMissingStep[] = missingSteps.map((s) => ({
    id: s.id,
    label: s.label,
    area: mapStepIdToArea(s.id),
    severity: severityForStep(s),
    why_it_matters: whyStepMatters(s),
    suggested_fix: suggestedFixForStep(s),
    cta_label: s.cta?.label ?? "Apri Loop QA",
    cta_href: s.cta?.to ?? "/loop-qa",
  }));

  // Sort: critical first, then by original step order
  const ordered = [...mapped].sort((a, b) => {
    const sevWeight = (sev: LoopWarningSeverity) =>
      sev === "critical" ? 0 : sev === "warning" ? 1 : 2;
    const dw = sevWeight(a.severity) - sevWeight(b.severity);
    if (dw !== 0) return dw;
    return a.id.localeCompare(b.id);
  });

  return {
    brain_id: scopedBrain,
    status,
    ready,
    missing_count: missingSteps.length,
    missing_steps: ordered,
    top_missing_steps: ordered.slice(0, 3),
  };
}

// ============================================================
// Best Next Action
// ============================================================

export type JackBestNextActionSource =
  | "action_queue"
  | "daily_brief"
  | "operational_health"
  | "remediation"
  | "readiness"
  | "fallback";

export type JackBestNextActionMeta = {
  brain_id: string | null;
  action_queue_open_count: number;
  daily_brief_present: boolean;
  warning_id: string | null;
  readiness_status?: JackReadinessStatus;
  missing_steps_count?: number;
  top_missing_steps?: JackReadinessMissingStep[];
  first_missing_step?: JackReadinessMissingStep | null;
  recommended_fix?: string | null;
};

export type JackBestNextAction = {
  source: JackBestNextActionSource;
  title: string;
  description: string;
  reason: string;
  cta_label: string;
  cta_href: string;
  can_create_action: boolean;
  requires_confirmation: boolean;
  meta: JackBestNextActionMeta;
};

type ActionRow = {
  id: string;
  title: string;
  priority: string | null;
  status: string;
};

async function fetchOpenActionQueue(
  brainId: string | null,
): Promise<ActionRow[]> {
  let q = supabase
    .from("automation_actions")
    .select("id,title,priority,status")
    .in("status", [
      "suggested",
      "pending_approval",
      "approved",
      "ready_to_execute",
    ])
    .order("created_at", { ascending: false })
    .limit(5);
  if (brainId) q = q.eq("brain_id", brainId);
  const { data } = await q;
  return (data ?? []) as ActionRow[];
}

async function resolveBriefForBest(
  brainId: string | null,
): Promise<DailyBriefRow | null> {
  const scoped = await getTodayOperatingBrief(brainId);
  if (scoped) return scoped;
  return await getAnyTodayOperatingBriefForUser();
}

function pickDailyBriefNextAction(
  brief: DailyBriefRow | null,
): NextActionItem | null {
  if (!brief) return null;
  const list = Array.isArray(brief.next_actions) ? brief.next_actions : [];
  if (list.length === 0) return null;
  const high = list.find((a) => a.priority === "high");
  if (high) return high;
  const med = list.find((a) => a.priority === "medium");
  if (med) return med;
  return list[0] ?? null;
}

function attachReadinessMeta(
  base: JackBestNextActionMeta,
  details: JackReadinessDetails | null,
): JackBestNextActionMeta {
  if (!details) return base;
  return {
    ...base,
    readiness_status: details.status,
    missing_steps_count: details.missing_count,
    top_missing_steps: details.top_missing_steps,
    first_missing_step: details.top_missing_steps[0] ?? null,
    recommended_fix: details.top_missing_steps[0]?.suggested_fix ?? null,
  };
}

export async function buildJackBestAvailableNextAction(
  brainId?: string | null,
): Promise<JackBestNextAction> {
  const scopedBrain = brainId ?? null;
  const [openActions, brief] = await Promise.all([
    fetchOpenActionQueue(scopedBrain),
    resolveBriefForBest(scopedBrain),
  ]);
  const briefPresent = brief !== null;
  const openCount = openActions.length;

  // 1. Action Queue
  if (openCount > 0) {
    const top = openActions[0];
    return {
      source: "action_queue",
      title: top.title || "Azione in coda",
      description: `${openCount} azioni aperte in Action Queue. La prima è "${top.title}".`,
      reason: "C'è già una action aperta in Action Queue.",
      cta_label: "Apri Action Queue",
      cta_href: "/action-queue",
      can_create_action: false,
      requires_confirmation: true,
      meta: {
        brain_id: scopedBrain,
        action_queue_open_count: openCount,
        daily_brief_present: briefPresent,
        warning_id: null,
      },
    };
  }

  // 2. Daily Brief next_action
  const briefNa = pickDailyBriefNextAction(brief);
  if (briefNa) {
    return {
      source: "daily_brief",
      title: briefNa.title,
      description:
        briefNa.description ||
        `Suggerita dal Daily Brief di oggi (priorità ${briefNa.priority}).`,
      reason:
        briefNa.reason ||
        "Indicata come prossima azione nel Daily Brief di oggi.",
      cta_label: "Apri Daily Brief",
      cta_href: "/daily-brief",
      can_create_action: true,
      requires_confirmation: true,
      meta: {
        brain_id: scopedBrain,
        action_queue_open_count: 0,
        daily_brief_present: true,
        warning_id: null,
      },
    };
  }

  // 3. Enhanced Next Action
  try {
    const enhanced = await getEnhancedNextAction(scopedBrain);
    if (enhanced.source !== "fallback") {
      const isReadiness = enhanced.source === "readiness_blocked";
      const readiness = isReadiness
        ? await getJackReadinessDetails(scopedBrain).catch(() => null)
        : null;
      const baseMeta: JackBestNextActionMeta = {
        brain_id: scopedBrain,
        action_queue_open_count: 0,
        daily_brief_present: briefPresent,
        warning_id: enhanced.warning_id,
      };
      return {
        source: isReadiness ? "readiness" : "remediation",
        title: enhanced.label,
        description: enhanced.reason,
        reason: enhanced.reason,
        cta_label: enhanced.label,
        cta_href: enhanced.to,
        can_create_action: enhanced.warning_id !== null,
        requires_confirmation: true,
        meta: attachReadinessMeta(baseMeta, readiness),
      };
    }
  } catch {
    // best-effort cascade
  }

  // 4. Operational Health
  try {
    const health = await getBrainHubOperationalHealth(scopedBrain);
    if (health.status !== "healthy" && health.nextAction) {
      // If health is driven by readiness, attach details
      const bridge = await getLoopReadinessHealthBridge(scopedBrain).catch(
        () => null,
      );
      const readiness =
        bridge && bridge.status === "blocked"
          ? await getJackReadinessDetails(scopedBrain).catch(() => null)
          : null;
      const baseMeta: JackBestNextActionMeta = {
        brain_id: scopedBrain,
        action_queue_open_count: 0,
        daily_brief_present: briefPresent,
        warning_id: null,
      };
      return {
        source: "operational_health",
        title: health.nextAction.label,
        description: `${health.nextAction.reason} (health score ${health.score}).`,
        reason: health.nextAction.reason,
        cta_label: health.nextAction.label,
        cta_href: health.nextAction.to,
        can_create_action: false,
        requires_confirmation: true,
        meta: attachReadinessMeta(baseMeta, readiness),
      };
    }
  } catch {
    // best-effort
  }

  // 5. Remediation plan first open
  try {
    const plan = await buildOperationalRemediationPlan(scopedBrain);
    const firstOpen = plan.items.find(
      (i) => i.status === "open" || i.status === "regressed",
    );
    if (firstOpen) {
      return {
        source: "remediation",
        title: firstOpen.title,
        description: firstOpen.explanation || firstOpen.title,
        reason: firstOpen.why_it_matters || "Remediation aperta.",
        cta_label: firstOpen.cta_label,
        cta_href: firstOpen.cta_href,
        can_create_action: true,
        requires_confirmation: true,
        meta: {
          brain_id: scopedBrain,
          action_queue_open_count: 0,
          daily_brief_present: briefPresent,
          warning_id: firstOpen.warning_id,
        },
      };
    }
  } catch {
    // best-effort
  }

  // 6. Closure regressed
  try {
    const closure = await getRemediationClosureSummary(scopedBrain);
    if (closure.regressed > 0) {
      return {
        source: "remediation",
        title: "Remediation riemersa",
        description: `${closure.regressed} remediation precedentemente chiuse sono tornate aperte.`,
        reason: "Regressione operativa rilevata da Loop QA.",
        cta_label: "Apri Loop QA",
        cta_href: "/loop-qa",
        can_create_action: false,
        requires_confirmation: true,
        meta: {
          brain_id: scopedBrain,
          action_queue_open_count: 0,
          daily_brief_present: briefPresent,
          warning_id: null,
        },
      };
    }
  } catch {
    // best-effort
  }

  // 7. Readiness bridge blocked
  try {
    const bridge = await getLoopReadinessHealthBridge(scopedBrain);
    if (bridge.status === "blocked") {
      const readiness = await getJackReadinessDetails(scopedBrain).catch(
        () => null,
      );
      const baseMeta: JackBestNextActionMeta = {
        brain_id: scopedBrain,
        action_queue_open_count: 0,
        daily_brief_present: briefPresent,
        warning_id: null,
      };
      return {
        source: "readiness",
        title: "Readiness bloccata",
        description: `${bridge.total_missing} step di readiness mancanti.`,
        reason: "validateLoopReadiness segnala step mancanti.",
        cta_label: "Apri Loop QA",
        cta_href: "/loop-qa",
        can_create_action: false,
        requires_confirmation: true,
        meta: attachReadinessMeta(baseMeta, readiness),
      };
    }
  } catch {
    // best-effort
  }

  // 8. Fallback
  return {
    source: "fallback",
    title: "Aggiorna il Daily Brief",
    description: briefPresent
      ? "Nessuna priorità rilevata: rigenera il Daily Brief per scoprire nuove azioni."
      : "Non c'è ancora un Daily Brief per oggi: generane uno per scoprire le prossime azioni.",
    reason: "Nessuna fonte operativa ha restituito una prossima azione.",
    cta_label: "Apri Daily Brief",
    cta_href: "/daily-brief",
    can_create_action: false,
    requires_confirmation: true,
    meta: {
      brain_id: scopedBrain,
      action_queue_open_count: 0,
      daily_brief_present: briefPresent,
      warning_id: null,
    },
  };
}

function formatReadinessSpeech(best: JackBestNextAction): string {
  const count = best.meta.missing_steps_count ?? 0;
  const top = best.meta.top_missing_steps ?? [];
  if (count === 0 || top.length === 0) {
    return "Vedo che la readiness è bloccata, ma il tool non mi ha restituito i dettagli degli step. Apri Loop QA per vedere la checklist.";
  }
  const bullets = top
    .map((s, i) => `${i + 1}. ${s.label} — ${s.why_it_matters}`)
    .join(" ");
  const first = top[0];
  const tail = first
    ? ` Ti consiglio di partire da "${first.label}". Vuoi che prepari una action suggerita?`
    : "";
  return `Il loop è bloccato: mancano ${count} step. I primi da controllare sono: ${bullets}${tail}`;
}

export function formatJackBestNextActionSpeech(
  best: JackBestNextAction,
): string {
  switch (best.source) {
    case "action_queue":
      return `Hai ${best.meta.action_queue_open_count} azioni aperte in Action Queue. Parti da "${best.title}".`;
    case "daily_brief":
      return `Non hai azioni aperte in Action Queue, però il Daily Brief indica come prossima azione: "${best.title}". Ti consiglio di partire da questa. Vuoi che prepari una action suggerita?`;
    case "readiness":
      return formatReadinessSpeech(best);
    case "operational_health":
      if (best.meta.readiness_status === "blocked") {
        return formatReadinessSpeech(best);
      }
      return `Non hai azioni aperte, ma il sistema operativo segnala questa priorità: "${best.title}". ${best.reason}`;
    case "remediation":
      return `La prossima correzione consigliata è: "${best.title}", perché ${best.reason}. Posso creare una action suggerita solo se confermi.`;
    case "fallback":
    default:
      return best.description;
  }
}
