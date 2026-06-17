import { supabase } from "@/integrations/supabase/client";
import {
  ResultReviewItem,
  ReviewStatus,
  SOURCE_TYPE_LABEL,
  ReviewSourceType,
  buildNextPromptFromReview,
  sanitize,
} from "@/lib/result-review";

export type SuggestionType =
  | "roadmap_update"
  | "knowledge_note"
  | "next_prompt"
  | "automation_action"
  | "project_decision"
  | "issue_to_fix";

export type SuggestionStatus = "suggested" | "accepted" | "rejected" | "applied";

export const SUGGESTION_TYPE_LABEL: Record<SuggestionType, string> = {
  roadmap_update: "Suggerimento roadmap",
  knowledge_note: "Nota da salvare",
  next_prompt: "Prossimo prompt consigliato",
  automation_action: "Azione consigliata",
  project_decision: "Decisione di progetto",
  issue_to_fix: "Problema da correggere",
};

export const SUGGESTION_STATUS_LABEL: Record<SuggestionStatus, string> = {
  suggested: "Suggerito",
  accepted: "Accettato",
  rejected: "Rifiutato",
  applied: "Applicato",
};

export const SUGGESTION_STATUS_TONE: Record<SuggestionStatus, string> = {
  suggested: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  accepted: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  rejected: "bg-muted text-muted-foreground border-border",
  applied: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
};

export type LearningLoopSuggestion = {
  id: string;
  user_id: string;
  brain_id: string | null;
  project_id: string | null;
  result_review_item_id: string;
  suggestion_type: SuggestionType | string;
  suggestion_status: SuggestionStatus | string;
  title: string;
  description: string | null;
  suggested_payload: Record<string, unknown>;
  applied_object_type: string | null;
  applied_object_id: string | null;
  risk_level: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

async function logEvent(action: string, notes: string, metadata: Record<string, unknown>) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase.from("clipboard_execution_logs").insert({
    user_id: u.user.id,
    clipboard_item_id: null,
    action,
    notes,
    metadata: sanitize(metadata),
  } as never);
}

export type ListSuggestionsFilters = {
  result_review_item_id?: string;
  brain_id?: string | null;
  project_id?: string | null;
  suggestion_type?: SuggestionType | "all";
  suggestion_status?: SuggestionStatus | "all";
};

export async function listLearningSuggestions(
  filters: ListSuggestionsFilters = {},
): Promise<LearningLoopSuggestion[]> {
  let q = supabase
    .from("learning_loop_suggestions" as never)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);
  if (filters.result_review_item_id) q = q.eq("result_review_item_id", filters.result_review_item_id);
  if (filters.brain_id) q = q.eq("brain_id", filters.brain_id);
  if (filters.project_id) q = q.eq("project_id", filters.project_id);
  if (filters.suggestion_type && filters.suggestion_type !== "all")
    q = q.eq("suggestion_type", filters.suggestion_type);
  if (filters.suggestion_status && filters.suggestion_status !== "all")
    q = q.eq("suggestion_status", filters.suggestion_status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as LearningLoopSuggestion[];
}

export type SuggestionsSummary = {
  total: number;
  suggested: number;
  accepted: number;
  rejected: number;
  applied: number;
};

export async function getLearningSuggestionsSummary(
  projectId?: string | null,
  brainId?: string | null,
): Promise<SuggestionsSummary> {
  const items = await listLearningSuggestions({
    project_id: projectId ?? undefined,
    brain_id: brainId ?? undefined,
  });
  const s: SuggestionsSummary = { total: items.length, suggested: 0, accepted: 0, rejected: 0, applied: 0 };
  for (const it of items) {
    const st = it.suggestion_status as SuggestionStatus;
    if (st in s) (s as unknown as Record<string, number>)[st]++;
  }
  return s;
}

type PlannedSuggestion = {
  suggestion_type: SuggestionType;
  title: string;
  description?: string;
  suggested_payload?: Record<string, unknown>;
  risk_level?: string | null;
};

function planSuggestionsForReview(item: ResultReviewItem): PlannedSuggestion[] {
  const status = item.review_status as ReviewStatus;
  const sourceLabel = SOURCE_TYPE_LABEL[item.source_type as ReviewSourceType] ?? item.source_type;
  const baseDesc = `Da review "${item.title}" (${sourceLabel}).`;

  if (status === "approved") {
    return [
      {
        suggestion_type: "knowledge_note",
        title: `Salva conoscenza: ${item.title}`,
        description: `${baseDesc} Cosa salvare nella knowledge base in base al risultato approvato.`,
        suggested_payload: { title: item.title, summary: item.result_text?.slice(0, 800) ?? "" },
      },
      {
        suggestion_type: "roadmap_update",
        title: `Aggiorna roadmap: completamento "${item.title}"`,
        description: `${baseDesc} Considera di marcare un roadmap item come done o di aggiungere uno step di follow-up.`,
        suggested_payload: { proposed_status: "done", note: item.review_note ?? null },
      },
      {
        suggestion_type: "next_prompt",
        title: "Prossimo prompt operativo",
        description: `${baseDesc} Prompt per continuare con il prossimo passo coerente.`,
      },
    ];
  }

  if (status === "needs_fix") {
    return [
      {
        suggestion_type: "issue_to_fix",
        title: `Problema da correggere: ${item.title}`,
        description: `${baseDesc} ${item.review_note ?? item.error_text ?? ""}`.trim(),
        risk_level: item.risk_level ?? "medium",
      },
      {
        suggestion_type: "next_prompt",
        title: "Prompt di correzione",
        description: `${baseDesc} Prompt strutturato per correggere il problema.`,
      },
      {
        suggestion_type: "automation_action",
        title: "Action di verifica post-fix",
        description: `${baseDesc} Action manuale per verificare che la correzione funzioni.`,
        risk_level: "low",
      },
    ];
  }

  if (status === "failed") {
    return [
      {
        suggestion_type: "issue_to_fix",
        title: `Fallimento da analizzare: ${item.title}`,
        description: `${baseDesc} ${item.error_text ?? ""}`.trim(),
        risk_level: "high",
      },
      {
        suggestion_type: "next_prompt",
        title: "Prompt di diagnosi",
        description: `${baseDesc} Prompt per diagnosticare la causa del fallimento.`,
      },
      {
        suggestion_type: "automation_action",
        title: "Controllo manuale stato",
        description: `${baseDesc} Action manuale di verifica.`,
        risk_level: "medium",
      },
    ];
  }

  // ignored / pending_review / next_prompt_created / action_created → nessun suggerimento automatico
  return [];
}

export async function generateSuggestionsFromReview(
  reviewId: string,
  options: { force?: boolean } = {},
): Promise<LearningLoopSuggestion[]> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Non autenticato");

  const { data: reviewData, error: reviewErr } = await supabase
    .from("result_review_items" as never)
    .select("*")
    .eq("id", reviewId)
    .single();
  if (reviewErr) throw reviewErr;
  const review = reviewData as unknown as ResultReviewItem;

  const existing = await listLearningSuggestions({ result_review_item_id: reviewId });
  if (existing.length > 0 && !options.force) return existing;

  const planned = planSuggestionsForReview(review);
  if (planned.length === 0) return existing;

  const rows = planned.map((p) => ({
    user_id: u.user!.id,
    brain_id: review.brain_id,
    project_id: review.project_id,
    result_review_item_id: review.id,
    suggestion_type: p.suggestion_type,
    suggestion_status: "suggested",
    title: p.title,
    description: p.description ?? null,
    suggested_payload: sanitize(p.suggested_payload ?? {}),
    risk_level: p.risk_level ?? review.risk_level ?? null,
    metadata: sanitize({
      review_title: review.title,
      review_status: review.review_status,
      generated_at: new Date().toISOString(),
      regenerated: existing.length > 0,
    }),
  }));

  const { data, error } = await supabase
    .from("learning_loop_suggestions" as never)
    .insert(rows as never)
    .select();
  if (error) throw error;

  await logEvent("learning_loop_suggestions_generated", `Generati ${rows.length} suggerimenti`, {
    review_id: reviewId,
    count: rows.length,
  });

  return (data ?? []) as unknown as LearningLoopSuggestion[];
}

async function patchSuggestion(
  id: string,
  patch: Record<string, unknown>,
): Promise<LearningLoopSuggestion> {
  const { data, error } = await supabase
    .from("learning_loop_suggestions" as never)
    .update(patch as never)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as LearningLoopSuggestion;
}

async function getSuggestion(id: string): Promise<LearningLoopSuggestion> {
  const { data, error } = await supabase
    .from("learning_loop_suggestions" as never)
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as unknown as LearningLoopSuggestion;
}

async function getReviewForSuggestion(s: LearningLoopSuggestion): Promise<ResultReviewItem> {
  const { data, error } = await supabase
    .from("result_review_items" as never)
    .select("*")
    .eq("id", s.result_review_item_id)
    .single();
  if (error) throw error;
  return data as unknown as ResultReviewItem;
}

export async function acceptLearningSuggestion(id: string): Promise<LearningLoopSuggestion> {
  const s = await patchSuggestion(id, { suggestion_status: "accepted" });
  await logEvent("learning_loop_suggestion_accepted", `Suggerimento accettato: ${s.title}`, {
    suggestion_id: id,
    type: s.suggestion_type,
  });
  return s;
}

export async function rejectLearningSuggestion(
  id: string,
  reason?: string,
): Promise<LearningLoopSuggestion> {
  const current = await getSuggestion(id);
  const s = await patchSuggestion(id, {
    suggestion_status: "rejected",
    metadata: sanitize({ ...(current.metadata ?? {}), rejected_reason: reason ?? null }),
  });
  await logEvent("learning_loop_suggestion_rejected", `Suggerimento rifiutato: ${s.title}`, {
    suggestion_id: id,
    reason: reason ?? null,
  });
  return s;
}

async function markApplied(
  id: string,
  appliedObjectType: string,
  appliedObjectId: string | null,
  extraMeta: Record<string, unknown> = {},
): Promise<LearningLoopSuggestion> {
  const current = await getSuggestion(id);
  const s = await patchSuggestion(id, {
    suggestion_status: "applied",
    applied_object_type: appliedObjectType,
    applied_object_id: appliedObjectId,
    metadata: sanitize({ ...(current.metadata ?? {}), ...extraMeta, applied_at: new Date().toISOString() }),
  });
  await logEvent("learning_loop_suggestion_applied", `Suggerimento applicato: ${s.title}`, {
    suggestion_id: id,
    applied_object_type: appliedObjectType,
    applied_object_id: appliedObjectId,
  });
  return s;
}

export async function createKnowledgeNoteFromSuggestion(id: string): Promise<string> {
  const s = await getSuggestion(id);
  const review = await getReviewForSuggestion(s);
  if (!review.brain_id) {
    throw new Error("Brain non disponibile: collega la review a un brain prima di salvare la nota.");
  }
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Non autenticato");

  const summary = (s.suggested_payload?.summary as string) ?? review.result_text ?? "";
  const title = (s.suggested_payload?.title as string) ?? s.title;

  const { data, error } = await supabase
    .from("knowledge_sources" as never)
    .insert({
      user_id: u.user.id,
      brain_id: review.brain_id,
      title,
      source_type: "note",
      status: "ready",
      description: s.description ?? null,
      summary: summary.slice(0, 4000),
      tags: ["learning_loop", "result_review"],
      metadata: sanitize({
        source: "learning_loop",
        suggestion_id: s.id,
        result_review_item_id: review.id,
        review_title: review.title,
        review_status: review.review_status,
        project_id: review.project_id,
        created_at: new Date().toISOString(),
      }),
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  const noteId = (data as { id: string }).id;
  await markApplied(id, "knowledge_source", noteId);
  await logEvent("learning_loop_knowledge_note_created", `Nota knowledge creata: ${title}`, {
    suggestion_id: id,
    knowledge_source_id: noteId,
  });
  return noteId;
}

export async function createRoadmapUpdateFromSuggestion(id: string): Promise<string> {
  const s = await getSuggestion(id);
  const review = await getReviewForSuggestion(s);
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Non autenticato");

  // Conservativo: invece di scrivere direttamente nella roadmap, creiamo una
  // automation action di tipo "review_roadmap_update" in attesa di conferma.
  const { data, error } = await supabase
    .from("automation_actions" as never)
    .insert({
      user_id: u.user.id,
      brain_id: review.brain_id,
      project_id: review.project_id,
      title: `Roadmap update da rivedere: ${s.title}`,
      description: s.description ?? "Aggiornamento roadmap suggerito dal Learning Loop.",
      action_type: "review_roadmap_update",
      source: "system_suggestion",
      risk_level: s.risk_level ?? "low",
      status: "suggested",
      requires_confirmation: true,
      metadata: sanitize({
        source: "learning_loop",
        suggestion_id: s.id,
        result_review_item_id: review.id,
        suggested_payload: s.suggested_payload,
      }),
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  const actionId = (data as { id: string }).id;
  await markApplied(id, "automation_action", actionId, { roadmap_review: true });
  await logEvent("learning_loop_roadmap_update_created", `Roadmap update creato (pending): ${s.title}`, {
    suggestion_id: id,
    action_id: actionId,
  });
  return actionId;
}

export async function createNextPromptFromSuggestion(id: string): Promise<string> {
  const s = await getSuggestion(id);
  const review = await getReviewForSuggestion(s);
  const base = buildNextPromptFromReview(review);
  const prompt = [
    base,
    "",
    "— Learning Loop —",
    `Tipo suggerimento: ${SUGGESTION_TYPE_LABEL[s.suggestion_type as SuggestionType] ?? s.suggestion_type}`,
    s.description ? `Dettaglio: ${s.description}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  await markApplied(id, "next_prompt", null, { next_prompt_preview: prompt.slice(0, 500) });
  await logEvent("learning_loop_next_prompt_created", `Prompt creato da suggerimento: ${s.title}`, {
    suggestion_id: id,
  });
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      /* ignore */
    }
  }
  return prompt;
}

export async function createActionFromSuggestion(id: string): Promise<string> {
  const s = await getSuggestion(id);
  const review = await getReviewForSuggestion(s);
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Non autenticato");

  const isIssue = s.suggestion_type === "issue_to_fix";
  const { data, error } = await supabase
    .from("automation_actions" as never)
    .insert({
      user_id: u.user.id,
      brain_id: review.brain_id,
      project_id: review.project_id,
      title: s.title,
      description: s.description ?? "Action generata dal Learning Loop.",
      action_type: isIssue ? "fix_issue" : "manual_followup",
      source: "system_suggestion",
      risk_level: s.risk_level ?? review.risk_level ?? "medium",
      status: "suggested",
      requires_confirmation: true,
      metadata: sanitize({
        source: "learning_loop",
        suggestion_id: s.id,
        result_review_item_id: review.id,
        suggestion_type: s.suggestion_type,
      }),
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  const actionId = (data as { id: string }).id;
  await markApplied(id, "automation_action", actionId);
  await logEvent("learning_loop_action_created", `Action creata da suggerimento: ${s.title}`, {
    suggestion_id: id,
    action_id: actionId,
  });
  return actionId;
}

export async function applyLearningSuggestion(id: string): Promise<{
  applied_object_type: string;
  applied_object_id: string | null;
  preview?: string;
}> {
  const s = await getSuggestion(id);
  switch (s.suggestion_type as SuggestionType) {
    case "knowledge_note": {
      const noteId = await createKnowledgeNoteFromSuggestion(id);
      return { applied_object_type: "knowledge_source", applied_object_id: noteId };
    }
    case "roadmap_update": {
      const actionId = await createRoadmapUpdateFromSuggestion(id);
      return { applied_object_type: "automation_action", applied_object_id: actionId };
    }
    case "next_prompt": {
      const preview = await createNextPromptFromSuggestion(id);
      return { applied_object_type: "next_prompt", applied_object_id: null, preview };
    }
    case "automation_action":
    case "issue_to_fix": {
      const actionId = await createActionFromSuggestion(id);
      return { applied_object_type: "automation_action", applied_object_id: actionId };
    }
    case "project_decision":
    default: {
      await markApplied(id, "manual", null, { applied_manually: true });
      return { applied_object_type: "manual", applied_object_id: null };
    }
  }
}
