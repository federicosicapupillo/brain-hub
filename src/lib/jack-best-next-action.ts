// ============================================================
// Brain Hub v3.19.1 — Jack Best Available Next Action
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
import { getBrainHubOperationalHealth } from "@/lib/loop-qa";

export type JackBestNextActionSource =
  | "action_queue"
  | "daily_brief"
  | "operational_health"
  | "remediation"
  | "readiness"
  | "fallback";

export type JackBestNextAction = {
  source: JackBestNextActionSource;
  title: string;
  description: string;
  reason: string;
  cta_label: string;
  cta_href: string;
  can_create_action: boolean;
  requires_confirmation: boolean;
  meta: {
    brain_id: string | null;
    action_queue_open_count: number;
    daily_brief_present: boolean;
    warning_id: string | null;
  };
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
  // Prefer high priority, then medium, then first.
  const high = list.find((a) => a.priority === "high");
  if (high) return high;
  const med = list.find((a) => a.priority === "medium");
  if (med) return med;
  return list[0] ?? null;
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

  // 3. Enhanced Next Action (regressed / readiness / critical / warning)
  try {
    const enhanced = await getEnhancedNextAction(scopedBrain);
    if (enhanced.source !== "fallback") {
      return {
        source:
          enhanced.source === "readiness_blocked" ? "readiness" : "remediation",
        title: enhanced.label,
        description: enhanced.reason,
        reason: enhanced.reason,
        cta_label: enhanced.label,
        cta_href: enhanced.to,
        can_create_action: enhanced.warning_id !== null,
        requires_confirmation: true,
        meta: {
          brain_id: scopedBrain,
          action_queue_open_count: 0,
          daily_brief_present: briefPresent,
          warning_id: enhanced.warning_id,
        },
      };
    }
  } catch {
    // best-effort cascade
  }

  // 4. Operational Health next action
  try {
    const health = await getBrainHubOperationalHealth(scopedBrain);
    if (health.status !== "healthy" && health.nextAction) {
      return {
        source: "operational_health",
        title: health.nextAction.label,
        description: `${health.nextAction.reason} (health score ${health.score}).`,
        reason: health.nextAction.reason,
        cta_label: health.nextAction.label,
        cta_href: health.nextAction.to,
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

  // 5. Remediation Plan first open item
  try {
    const plan = await buildOperationalRemediationPlan(scopedBrain);
    const firstOpen = plan.items.find(
      (i) => i.status === "open" || i.status === "regressed",
    );
    if (firstOpen) {
      return {
        source: "remediation",
        title: firstOpen.title,
        description: firstOpen.description ?? firstOpen.title,
        reason: firstOpen.reason ?? "Remediation aperta.",
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

  // 6. Remediation closure summary regressed
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
      return {
        source: "readiness",
        title: "Readiness bloccata",
        description: `${bridge.total_missing} step di readiness mancanti.`,
        reason: "validateLoopReadiness segnala step mancanti.",
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

export function formatJackBestNextActionSpeech(
  best: JackBestNextAction,
): string {
  switch (best.source) {
    case "action_queue":
      return `Hai ${best.meta.action_queue_open_count} azioni aperte in Action Queue. Parti da "${best.title}".`;
    case "daily_brief":
      return `Non hai azioni aperte in Action Queue, però il Daily Brief indica come prossima azione: "${best.title}". Ti consiglio di partire da questa. Vuoi che prepari una action suggerita?`;
    case "operational_health":
      return `Non hai azioni aperte, ma il sistema operativo segnala questa priorità: "${best.title}". ${best.reason}`;
    case "remediation":
      return `La prossima correzione consigliata è: "${best.title}", perché ${best.reason}. Posso creare una action suggerita solo se confermi.`;
    case "readiness":
      return `Non hai azioni aperte, ma la readiness del loop è bloccata: ${best.description}`;
    case "fallback":
    default:
      return best.description;
  }
}
