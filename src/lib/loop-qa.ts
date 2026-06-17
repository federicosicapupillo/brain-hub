import { supabase } from "@/integrations/supabase/client";
import { getN8nRealExecutionWarnings } from "@/lib/n8n-real-execution";
import { getDriveKnowledgeWarnings } from "@/lib/drive-knowledge";
import { getCalendarKnowledgeWarnings } from "@/lib/calendar-knowledge";
import { getGithubOperationalWarnings } from "@/lib/github-operational";
import { getAgentCenterWarnings } from "@/lib/agent-center";




export type StepStatus = "ok" | "missing" | "warning" | "na";

export type LoopStep = {
  id: string;
  label: string;
  status: StepStatus;
  count: number;
  lastAt: string | null;
  cta?: { label: string; to: string };
  note?: string;
};

export type LoopWarning = {
  id: string;
  level: "warning" | "info" | "error";
  title: string;
  description: string;
  cta?: { label: string; to: string };
};

export type LoopChainNode =
  | { kind: "action"; id: string; title: string; status: string; created_at: string }
  | { kind: "review"; id: string; title: string; status: string; created_at: string; brain_id: string | null }
  | { kind: "suggestion"; id: string; title: string; type: string; status: string; created_at: string }
  | { kind: "knowledge"; id: string; title: string; created_at: string }
  | { kind: "automation_action"; id: string; title: string; status: string; created_at: string }
  | { kind: "next_prompt"; preview: string; created_at: string }
  | { kind: "telegram"; id: string; status: string; created_at: string };

export type LoopChain = {
  startedFrom: "action" | "review" | "none";
  nodes: LoopChainNode[];
  missing: string[];
};

export type LoopMultiChain = LoopChain & {
  id: string;
  title: string;
  reviewId: string | null;
  reviewStatus: string | null;
  suggestionsCount: number;
  createdObjectKind: "knowledge" | "automation_action" | "next_prompt" | null;
  stopStep: string | null;
  createdAt: string;
};

export type LoopSummary = {
  health: "healthy" | "incomplete" | "warning";
  steps: LoopStep[];
  warnings: LoopWarning[];
  chain: LoopChain;
  chains: LoopMultiChain[];
  counters: {
    actions: number;
    reviews: number;
    suggestions: number;
    suggestionsApplied: number;
    knowledgeNotes: number;
    roadmapUpdateActions: number;
    nextPromptCreated: number;
    incompleteChains: number;
  };
};

const REVIEW_PENDING_HOURS = 48;
const SUGGESTION_PENDING_HOURS = 48;

function hoursAgo(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}

async function fetchLatest<T>(
  table: string,
  filters: Array<[string, string]>,
  limit = 50,
): Promise<T[]> {
  let q = supabase.from(table as never).select("*").order("created_at", { ascending: false }).limit(limit);
  for (const [k, v] of filters) q = q.eq(k, v);
  const { data } = await q;
  return (data ?? []) as unknown as T[];
}

type ActionRow = {
  id: string;
  title: string;
  status: string;
  risk_level: string | null;
  brain_id: string | null;
  result_text: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  approved_at: string | null;
  executed_at: string | null;
  action_type?: string | null;
};
type ReviewRow = {
  id: string;
  title: string;
  review_status: string;
  brain_id: string | null;
  source_id: string | null;
  source_type: string | null;
  linked_action_id: string | null;
  created_at: string;
};
type SuggestionRow = {
  id: string;
  title: string;
  suggestion_type: string;
  suggestion_status: string;
  result_review_item_id: string;
  applied_object_type: string | null;
  applied_object_id: string | null;
  brain_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};
type KnowledgeRow = {
  id: string;
  title: string;
  brain_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type TelegramRow = {
  id: string;
  automation_action_id: string | null;
  status: string;
  created_at: string;
  brain_id: string | null;
};

export async function getLoopQaSummary(brainId?: string | null): Promise<LoopSummary> {
  const filters: Array<[string, string]> = brainId ? [["brain_id", brainId]] : [];


  const [actions, reviews, suggestions, knowledge, telegram] = await Promise.all([
    fetchLatest<ActionRow>("automation_actions", filters, 100),
    fetchLatest<ReviewRow>("result_review_items", filters, 100),
    fetchLatest<SuggestionRow>("learning_loop_suggestions", filters, 100),
    fetchLatest<KnowledgeRow>("knowledge_sources", filters, 100),
    fetchLatest<TelegramRow>("telegram_approval_requests", filters, 100),
  ]);

  const reviewsByStatus = (s: string) => reviews.filter((r) => r.review_status === s);
  const suggestionsByStatus = (s: string) => suggestions.filter((x) => x.suggestion_status === s);

  const actionsCompleted = actions.filter(
    (a) => a.status === "completed" || a.status === "done" || a.executed_at || a.result_text,
  );
  const knowledgeFromLoop = knowledge.filter(
    (k) => (k.metadata as { source?: string } | null)?.source === "learning_loop",
  );
  const roadmapActions = actions.filter((a) => a.action_type === "review_roadmap_update");
  const newActionsFromLoop = actions.filter(
    (a) => (a.metadata as { source?: string } | null)?.source === "learning_loop",
  );
  const nextPromptApplied = suggestions.filter(
    (s) => s.suggestion_type === "next_prompt" && s.suggestion_status === "applied",
  );

  const last = <T extends { created_at: string }>(arr: T[]): string | null =>
    arr.length > 0 ? arr[0].created_at : null;

  const mkStep = (
    id: string,
    label: string,
    arr: Array<{ created_at: string }>,
    cta?: LoopStep["cta"],
    note?: string,
  ): LoopStep => ({
    id,
    label,
    status: arr.length > 0 ? "ok" : "missing",
    count: arr.length,
    lastAt: last(arr),
    cta,
    note,
  });

  const steps: LoopStep[] = [
    mkStep("1_action_created", "1. Action creata", actions, {
      label: "Apri Action Queue",
      to: "/action-queue",
    }),
    mkStep("2_action_completed", "2. Action completata o risultato disponibile", actionsCompleted, {
      label: "Apri Action Queue",
      to: "/action-queue",
    }),
    mkStep("3_review_created", "3. Result Review creata", reviews, {
      label: "Apri Result Review",
      to: "/result-review",
    }),
    mkStep(
      "4_review_decided",
      "4. Review approvata / da correggere / fallita",
      reviews.filter((r) => ["approved", "needs_fix", "failed"].includes(r.review_status)),
      { label: "Apri Result Review", to: "/result-review" },
    ),
    mkStep("5_suggestions_generated", "5. Learning suggestions generate", suggestions, {
      label: "Apri Result Review",
      to: "/result-review",
    }),
    mkStep(
      "6_suggestion_accepted",
      "6. Suggestion accettata o applicata",
      [...suggestionsByStatus("accepted"), ...suggestionsByStatus("applied")],
      { label: "Apri Result Review", to: "/result-review" },
    ),
    mkStep("7_knowledge_note", "7. Knowledge note creata (da Learning Loop)", knowledgeFromLoop, {
      label: "Apri Knowledge Map",
      to: "/knowledge-map",
    }),
    mkStep("8_roadmap_update", "8. Roadmap update action creata", roadmapActions, {
      label: "Apri Action Queue",
      to: "/action-queue",
    }),
    mkStep("9_next_prompt", "9. Next prompt generato", nextPromptApplied, {
      label: "Apri Result Review",
      to: "/result-review",
    }),
    mkStep("10_new_action", "10. Nuova action creata da Learning Loop", newActionsFromLoop, {
      label: "Apri Action Queue",
      to: "/action-queue",
    }),
  ];

  // Warnings
  const warnings: LoopWarning[] = [];
  const oldPending = reviewsByStatus("pending_review").filter((r) => hoursAgo(r.created_at) > REVIEW_PENDING_HOURS);
  if (oldPending.length > 0) {
    warnings.push({
      id: "old_pending_reviews",
      level: "warning",
      title: `${oldPending.length} review pending da oltre ${REVIEW_PENDING_HOURS}h`,
      description: "Alcune review aspettano una decisione da troppo tempo.",
      cta: { label: "Apri Result Review", to: "/result-review" },
    });
  }
  const oldSuggestions = suggestionsByStatus("suggested").filter(
    (s) => hoursAgo(s.created_at) > SUGGESTION_PENDING_HOURS,
  );
  if (oldSuggestions.length > 0) {
    warnings.push({
      id: "old_suggestions",
      level: "warning",
      title: `${oldSuggestions.length} suggerimenti mai applicati`,
      description: "Sono stati generati suggerimenti che non sono mai stati accettati o applicati.",
      cta: { label: "Apri Result Review", to: "/result-review" },
    });
  }
  const pendingLoopActions = newActionsFromLoop.filter(
    (a) => a.status === "suggested" || a.status === "pending",
  );
  if (pendingLoopActions.length > 0) {
    warnings.push({
      id: "pending_loop_actions",
      level: "info",
      title: `${pendingLoopActions.length} action da Learning Loop in attesa`,
      description: "Sono state create da suggerimenti ma non ancora approvate.",
      cta: { label: "Apri Action Queue", to: "/action-queue" },
    });
  }
  const reviewsWithoutBrain = reviews.filter((r) => !r.brain_id);
  if (reviewsWithoutBrain.length > 0) {
    warnings.push({
      id: "reviews_no_brain",
      level: "info",
      title: `${reviewsWithoutBrain.length} review senza brain collegato`,
      description: "Knowledge note non potranno essere create da queste review.",
      cta: { label: "Apri Result Review", to: "/result-review" },
    });
  }
  const reviewsWithoutSource = reviews.filter((r) => !r.source_id && r.source_type !== "manual");
  if (reviewsWithoutSource.length > 0) {
    warnings.push({
      id: "reviews_no_source",
      level: "info",
      title: `${reviewsWithoutSource.length} review senza source_id`,
      description: "Catena origine difficile da ricostruire.",
    });
  }
  const knowledgeWithoutBrain = knowledgeFromLoop.filter((k) => !k.brain_id);
  if (knowledgeWithoutBrain.length > 0) {
    warnings.push({
      id: "knowledge_no_brain",
      level: "warning",
      title: `${knowledgeWithoutBrain.length} knowledge note senza brain`,
      description: "Note salvate ma non collegate a un cervello.",
      cta: { label: "Apri Knowledge Map", to: "/knowledge-map" },
    });
  }
  const needsFix = reviewsByStatus("needs_fix");
  if (needsFix.length >= 5) {
    warnings.push({
      id: "many_needs_fix",
      level: "warning",
      title: `${needsFix.length} review in "Da correggere"`,
      description: "Concentrazione alta di problemi: rivedi prima di proseguire.",
      cta: { label: "Apri Result Review", to: "/result-review" },
    });
  }
  // High-risk Telegram approval check (v1.9.2): inspect both metadata
  // and telegram_approval_requests rows linked via automation_action_id.
  const APPROVED_STATUSES = new Set(["approved", "sent_manually"]);
  const PENDING_STATUSES = new Set(["prepared", "draft", "requested", "pending"]);
  const telegramByAction = new Map<string, TelegramRow[]>();
  for (const t of telegram) {
    if (!t.automation_action_id) continue;
    const list = telegramByAction.get(t.automation_action_id) ?? [];
    list.push(t);
    telegramByAction.set(t.automation_action_id, list);
  }
  const highRiskActions = actions.filter(
    (a) =>
      a.risk_level === "high" &&
      (a.status === "suggested" || a.status === "pending"),
  );
  let highRiskNoTelegram = 0;
  let highRiskPendingTelegram = 0;
  for (const a of highRiskActions) {
    const meta = a.metadata as { telegram_approval_id?: string } | null;
    const linked = telegramByAction.get(a.id) ?? [];
    // latest first (already ordered desc, but be defensive)
    linked.sort((x, y) => y.created_at.localeCompare(x.created_at));
    const latest = linked[0];
    const hasAny = Boolean(meta?.telegram_approval_id) || linked.length > 0;
    if (!hasAny) {
      highRiskNoTelegram++;
    } else if (latest && !APPROVED_STATUSES.has(latest.status)) {
      // pending / rejected / failed / expired => not yet approved
      highRiskPendingTelegram++;
    }
  }
  if (highRiskNoTelegram > 0) {
    warnings.push({
      id: "high_risk_no_telegram",
      level: "warning",
      title: `${highRiskNoTelegram} action high risk senza richiesta Telegram`,
      description: "Nessuna richiesta di approvazione Telegram trovata per queste action.",
      cta: { label: "Apri Telegram Approvals", to: "/telegram-approvals" },
    });
  }
  if (highRiskPendingTelegram > 0) {
    warnings.push({
      id: "high_risk_pending_telegram",
      level: "info",
      title: `${highRiskPendingTelegram} action high risk con approvazione Telegram non ancora approvata`,
      description: "Richiesta presente ma non approved (potrebbe essere pending, rejected, failed o expired).",
      cta: { label: "Apri Telegram Approvals", to: "/telegram-approvals" },
    });
  }

  // n8n real execution warnings (v2.7.1)
  try {
    const n8nWarnings = await getN8nRealExecutionWarnings(brainId ?? null);
    for (const w of n8nWarnings) {
      warnings.push({
        id: w.id,
        level: w.level,
        title: w.title,
        description: w.description,
        cta: w.cta,
      });
    }
  } catch {
    // non-blocking
  }

  // Drive Knowledge warnings (v2.8)
  try {
    const driveWarnings = await getDriveKnowledgeWarnings(brainId ?? null);
    for (const w of driveWarnings) {
      warnings.push({
        id: w.id,
        level: w.level,
        title: w.title,
        description: w.description,
        cta: w.cta,
      });
    }
  } catch {
    // non-blocking
  }

  // Calendar warnings (v3.0)
  try {
    const calWarnings = await getCalendarKnowledgeWarnings(brainId ?? null);
    for (const w of calWarnings) {
      warnings.push({
        id: w.id,
        level: w.level,
        title: w.title,
        description: w.description,
        cta: w.cta,
      });
    }
  } catch {
    // non-blocking
  }

  // GitHub operational warnings (v3.2)
  try {
    const ghWarnings = await getGithubOperationalWarnings(brainId ?? null);
    for (const w of ghWarnings) {
      warnings.push({
        id: w.id,
        level: w.level,
        title: w.title,
        description: w.description,
        cta: w.cta,
      });
    }
  } catch {
    // non-blocking
  }





  // Single chain (legacy) + multi-chain history (v1.9.2)
  const chain = buildChain(actions, reviews, suggestions, knowledge, telegram);
  const chains = buildRecentChains(actions, reviews, suggestions, knowledge, telegram, 5);
  const incompleteChains = chains.filter((c) => c.stopStep !== null).length;

  // Health
  const missingSteps = steps.filter((s) => s.status === "missing").length;
  const health: LoopSummary["health"] =
    warnings.some((w) => w.level === "warning" || w.level === "error")
      ? "warning"
      : missingSteps >= 4
        ? "incomplete"
        : "healthy";

  return {
    health,
    steps,
    warnings,
    chain,
    chains,
    counters: {
      actions: actions.length,
      reviews: reviews.length,
      suggestions: suggestions.length,
      suggestionsApplied: suggestionsByStatus("applied").length,
      knowledgeNotes: knowledgeFromLoop.length,
      roadmapUpdateActions: roadmapActions.length,
      nextPromptCreated: nextPromptApplied.length,
      incompleteChains,
    },
  };
}

function buildChain(
  actions: ActionRow[],
  reviews: ReviewRow[],
  suggestions: SuggestionRow[],
  knowledge: KnowledgeRow[],
  telegram: TelegramRow[] = [],
): LoopChain {
  const missing: string[] = [];
  const nodes: LoopChainNode[] = [];

  // Try latest review with linked action first
  const latestReview = reviews[0];
  if (!latestReview) {
    if (actions[0]) {
      nodes.push({
        kind: "action",
        id: actions[0].id,
        title: actions[0].title,
        status: actions[0].status,
        created_at: actions[0].created_at,
      });
      missing.push("Result Review per questa action");
    }
    return { startedFrom: actions[0] ? "action" : "none", nodes, missing };
  }

  // Find source action
  let originAction: ActionRow | undefined;
  if (latestReview.source_type === "automation_action" && latestReview.source_id) {
    originAction = actions.find((a) => a.id === latestReview.source_id);
  }
  if (originAction) {
    nodes.push({
      kind: "action",
      id: originAction.id,
      title: originAction.title,
      status: originAction.status,
      created_at: originAction.created_at,
    });
    const linkedTg = telegram
      .filter((t) => t.automation_action_id === originAction!.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (linkedTg) {
      nodes.push({
        kind: "telegram",
        id: linkedTg.id,
        status: linkedTg.status,
        created_at: linkedTg.created_at,
      });
    }
  } else if (latestReview.source_type !== "manual") {
    missing.push("Action origine della review");
  }

  nodes.push({
    kind: "review",
    id: latestReview.id,
    title: latestReview.title,
    status: latestReview.review_status,
    created_at: latestReview.created_at,
    brain_id: latestReview.brain_id,
  });

  const chainSuggestions = suggestions.filter((s) => s.result_review_item_id === latestReview.id);
  if (chainSuggestions.length === 0) {
    if (["approved", "needs_fix", "failed"].includes(latestReview.review_status)) {
      missing.push("Learning suggestions per questa review");
    }
  }
  for (const s of chainSuggestions) {
    nodes.push({
      kind: "suggestion",
      id: s.id,
      title: s.title,
      type: s.suggestion_type,
      status: s.suggestion_status,
      created_at: s.created_at,
    });
    if (s.suggestion_status === "applied" && s.applied_object_id) {
      if (s.applied_object_type === "knowledge_source") {
        const k = knowledge.find((x) => x.id === s.applied_object_id);
        if (k) nodes.push({ kind: "knowledge", id: k.id, title: k.title, created_at: k.created_at });
      } else if (s.applied_object_type === "automation_action") {
        const a = actions.find((x) => x.id === s.applied_object_id);
        if (a)
          nodes.push({
            kind: "automation_action",
            id: a.id,
            title: a.title,
            status: a.status,
            created_at: a.created_at,
          });
      }
    } else if (s.suggestion_type === "next_prompt" && s.suggestion_status === "applied") {
      const preview = ((s.metadata as { next_prompt_preview?: string } | null)?.next_prompt_preview) ?? "";
      nodes.push({ kind: "next_prompt", preview, created_at: s.created_at });
    }
  }

  return {
    startedFrom: originAction ? "action" : "review",
    nodes,
    missing,
  };
}

function buildRecentChains(
  actions: ActionRow[],
  reviews: ReviewRow[],
  suggestions: SuggestionRow[],
  knowledge: KnowledgeRow[],
  telegram: TelegramRow[],
  limit: number,
): LoopMultiChain[] {
  const out: LoopMultiChain[] = [];
  const seedReviews = reviews.slice(0, limit);
  for (const r of seedReviews) {
    const subset: ReviewRow[] = [r];
    const chain = buildChain(actions, subset, suggestions, knowledge, telegram);
    const reviewSuggestions = suggestions.filter((s) => s.result_review_item_id === r.id);
    const appliedSuggestion = reviewSuggestions.find((s) => s.suggestion_status === "applied");
    const createdObjectKind: LoopMultiChain["createdObjectKind"] = appliedSuggestion
      ? appliedSuggestion.applied_object_type === "knowledge_source"
        ? "knowledge"
        : appliedSuggestion.applied_object_type === "automation_action"
          ? "automation_action"
          : appliedSuggestion.suggestion_type === "next_prompt"
            ? "next_prompt"
            : null
      : null;
    let stopStep: string | null = null;
    if (!["approved", "needs_fix", "failed"].includes(r.review_status)) {
      stopStep = "Review non ancora decisa";
    } else if (reviewSuggestions.length === 0) {
      stopStep = "Nessun learning suggestion generato";
    } else if (!reviewSuggestions.some((s) => s.suggestion_status === "applied" || s.suggestion_status === "accepted")) {
      stopStep = "Nessun suggerimento accettato o applicato";
    } else if (!appliedSuggestion) {
      stopStep = "Suggerimenti accettati ma non applicati";
    }
    out.push({
      ...chain,
      id: r.id,
      title: r.title,
      reviewId: r.id,
      reviewStatus: r.review_status,
      suggestionsCount: reviewSuggestions.length,
      createdObjectKind,
      stopStep,
      createdAt: r.created_at,
    });
  }
  // If no reviews, surface a single action-only chain
  if (out.length === 0 && actions[0]) {
    const a = actions[0];
    const chain = buildChain(actions, [], suggestions, knowledge, telegram);
    out.push({
      ...chain,
      id: a.id,
      title: a.title,
      reviewId: null,
      reviewStatus: null,
      suggestionsCount: 0,
      createdObjectKind: null,
      stopStep: "Result Review non ancora creata",
      createdAt: a.created_at,
    });
  }
  return out;
}

export async function getLatestLoopChain(brainId?: string | null): Promise<LoopChain> {
  const s = await getLoopQaSummary(brainId);
  return s.chain;
}

export async function getRecentLoopChains(
  brainId?: string | null,
  limit = 5,
): Promise<LoopMultiChain[]> {
  const s = await getLoopQaSummary(brainId);
  return s.chains.slice(0, limit);
}

export async function validateLoopReadiness(brainId?: string | null): Promise<{
  ready: boolean;
  missing: string[];
}> {
  const s = await getLoopQaSummary(brainId);
  const missing = s.steps.filter((st) => st.status === "missing").map((st) => st.label);
  return { ready: missing.length === 0, missing };
}

export async function getLoopWarnings(brainId?: string | null): Promise<LoopWarning[]> {
  const s = await getLoopQaSummary(brainId);
  return s.warnings;
}

export async function logLoopQaEvent(
  action:
    | "loop_qa_viewed"
    | "loop_qa_warning_opened"
    | "loop_qa_related_section_opened"
    | "drive_warning_opened_from_loop_qa",
  notes: string,
  metadata: Record<string, unknown> = {},
) {
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
