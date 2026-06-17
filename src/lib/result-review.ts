import { supabase } from "@/integrations/supabase/client";

export type ReviewStatus =
  | "pending_review"
  | "approved"
  | "needs_fix"
  | "failed"
  | "ignored"
  | "next_prompt_created"
  | "action_created";

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  pending_review: "Da rivedere",
  approved: "Approvato",
  needs_fix: "Da correggere",
  failed: "Fallito",
  ignored: "Ignorato",
  next_prompt_created: "Prossimo prompt creato",
  action_created: "Azione creata",
};

export const REVIEW_STATUS_TONE: Record<ReviewStatus, string> = {
  pending_review: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  approved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  needs_fix: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  failed: "bg-red-500/10 text-red-600 border-red-500/30",
  ignored: "bg-muted text-muted-foreground border-border",
  next_prompt_created: "bg-indigo-500/10 text-indigo-600 border-indigo-500/30",
  action_created: "bg-sky-500/10 text-sky-600 border-sky-500/30",
};

export type ReviewSourceType =
  | "prompt_execution_log"
  | "clipboard_execution_log"
  | "n8n_execution_log"
  | "automation_action"
  | "runbook_step"
  | "manual";

export const SOURCE_TYPE_LABEL: Record<ReviewSourceType, string> = {
  prompt_execution_log: "Prompt execution",
  clipboard_execution_log: "Clipboard execution",
  n8n_execution_log: "n8n execution",
  automation_action: "Automation action",
  runbook_step: "Runbook step",
  manual: "Manuale",
};

export type ResultReviewItem = {
  id: string;
  user_id: string;
  brain_id: string | null;
  project_id: string | null;
  source_type: ReviewSourceType | string;
  source_id: string | null;
  title: string;
  result_text: string | null;
  error_text: string | null;
  review_status: ReviewStatus;
  risk_level: string | null;
  linked_action_id: string | null;
  linked_workflow_id: string | null;
  linked_runbook_instance_id: string | null;
  linked_roadmap_item_id: string | null;
  linked_next_prompt_id: string | null;
  review_note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

const SENSITIVE_KEYS = [
  "token",
  "apikey",
  "api_key",
  "secret",
  "password",
  "authorization",
  "bearer",
  "webhook_secret",
];

export function sanitize<T = unknown>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => sanitize(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s))) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = sanitize(v);
      }
    }
    return out as unknown as T;
  }
  return value;
}

function sanitizeText(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  let out = text;
  for (const key of SENSITIVE_KEYS) {
    const re = new RegExp(`(${key}["']?\\s*[:=]\\s*["']?)([^"'\\s,}]+)`, "gi");
    out = out.replace(re, "$1[REDACTED]");
  }
  return out;
}

async function logEvent(action: string, notes: string, metadata: Record<string, unknown>) {
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

export type ListFilters = {
  brain_id?: string | null;
  project_id?: string | null;
  source_type?: ReviewSourceType | "all";
  review_status?: ReviewStatus | "all";
  risk_level?: string | "all";
  since?: string | null;
};

export async function listResultReviewItems(filters: ListFilters = {}): Promise<ResultReviewItem[]> {
  let q = supabase
    .from("result_review_items" as never)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);
  if (filters.brain_id) q = q.eq("brain_id", filters.brain_id);
  if (filters.project_id) q = q.eq("project_id", filters.project_id);
  if (filters.source_type && filters.source_type !== "all") q = q.eq("source_type", filters.source_type);
  if (filters.review_status && filters.review_status !== "all") q = q.eq("review_status", filters.review_status);
  if (filters.risk_level && filters.risk_level !== "all") q = q.eq("risk_level", filters.risk_level);
  if (filters.since) q = q.gte("created_at", filters.since);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as ResultReviewItem[];
}

export type ReviewSummary = {
  total: number;
  pending: number;
  approved: number;
  needs_fix: number;
  failed: number;
  next_prompt_created: number;
  action_created: number;
  ignored: number;
};

export function summarizeReviews(items: ResultReviewItem[]): ReviewSummary {
  const s: ReviewSummary = {
    total: items.length,
    pending: 0,
    approved: 0,
    needs_fix: 0,
    failed: 0,
    next_prompt_created: 0,
    action_created: 0,
    ignored: 0,
  };
  for (const it of items) {
    switch (it.review_status) {
      case "pending_review": s.pending++; break;
      case "approved": s.approved++; break;
      case "needs_fix": s.needs_fix++; break;
      case "failed": s.failed++; break;
      case "next_prompt_created": s.next_prompt_created++; break;
      case "action_created": s.action_created++; break;
      case "ignored": s.ignored++; break;
    }
  }
  return s;
}

export async function getResultReviewSummary(brainId?: string | null): Promise<ReviewSummary> {
  const items = await listResultReviewItems({ brain_id: brainId ?? undefined });
  return summarizeReviews(items);
}

export type CreateReviewInput = {
  source_type: ReviewSourceType;
  source_id?: string | null;
  title: string;
  result_text?: string | null;
  error_text?: string | null;
  brain_id?: string | null;
  project_id?: string | null;
  risk_level?: string | null;
  linked_action_id?: string | null;
  linked_workflow_id?: string | null;
  linked_runbook_instance_id?: string | null;
  linked_roadmap_item_id?: string | null;
  metadata?: Record<string, unknown>;
};

export async function createReviewItem(input: CreateReviewInput): Promise<ResultReviewItem> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");
  const payload = {
    user_id: u.user.id,
    source_type: input.source_type,
    source_id: input.source_id ?? null,
    title: input.title,
    result_text: sanitizeText(input.result_text ?? null),
    error_text: sanitizeText(input.error_text ?? null),
    brain_id: input.brain_id ?? null,
    project_id: input.project_id ?? null,
    risk_level: input.risk_level ?? null,
    linked_action_id: input.linked_action_id ?? null,
    linked_workflow_id: input.linked_workflow_id ?? null,
    linked_runbook_instance_id: input.linked_runbook_instance_id ?? null,
    linked_roadmap_item_id: input.linked_roadmap_item_id ?? null,
    review_status: "pending_review",
    metadata: sanitize(input.metadata ?? {}),
  };
  const { data, error } = await supabase
    .from("result_review_items" as never)
    .insert(payload as never)
    .select()
    .single();
  if (error) throw error;
  const item = data as unknown as ResultReviewItem;
  await logEvent("result_review_item_created", `Review creata: ${item.title}`, {
    review_id: item.id,
    source_type: item.source_type,
    source_id: item.source_id,
  });
  return item;
}

export async function findReviewForSource(
  sourceType: ReviewSourceType,
  sourceId: string,
): Promise<ResultReviewItem | null> {
  const { data, error } = await supabase
    .from("result_review_items" as never)
    .select("*")
    .eq("source_type", sourceType)
    .eq("source_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data ?? null) as unknown as ResultReviewItem | null;
}

export async function createReviewItemFromSource(
  sourceType: ReviewSourceType,
  sourceId: string,
): Promise<ResultReviewItem> {
  const existing = await findReviewForSource(sourceType, sourceId);
  if (existing) return existing;

  let input: CreateReviewInput = {
    source_type: sourceType,
    source_id: sourceId,
    title: `Review ${SOURCE_TYPE_LABEL[sourceType] ?? sourceType}`,
  };

  try {
    if (sourceType === "automation_action") {
      const { data } = await supabase
        .from("automation_actions" as never)
        .select("*")
        .eq("id", sourceId)
        .maybeSingle();
      const a = data as Record<string, unknown> | null;
      if (a) {
        input = {
          ...input,
          title: (a.title as string) ?? input.title,
          brain_id: (a.brain_id as string) ?? null,
          project_id: (a.project_id as string) ?? null,
          risk_level: (a.risk_level as string) ?? null,
          result_text: (a.output_result as string) ?? null,
          error_text: (a.error_message as string) ?? null,
          linked_action_id: sourceId,
        };
      }
    } else if (sourceType === "n8n_execution_log") {
      const { data } = await supabase
        .from("n8n_execution_logs" as never)
        .select("*")
        .eq("id", sourceId)
        .maybeSingle();
      const l = data as Record<string, unknown> | null;
      if (l) {
        input = {
          ...input,
          title: `n8n: ${(l.workflow_name as string) ?? sourceId.slice(0, 8)}`,
          brain_id: (l.brain_id as string) ?? null,
          project_id: (l.project_id as string) ?? null,
          result_text: typeof l.response_body === "string"
            ? (l.response_body as string)
            : JSON.stringify(l.response_body ?? {}, null, 2),
          error_text: (l.error_message as string) ?? null,
          linked_workflow_id: (l.workflow_id as string) ?? null,
          linked_action_id: (l.automation_action_id as string) ?? null,
        };
      }
    }
  } catch {
    /* fall back to defaults */
  }

  return createReviewItem(input);
}

async function updateStatus(
  id: string,
  status: ReviewStatus,
  patch: Record<string, unknown> = {},
  event?: { action: string; notes: string; metadata?: Record<string, unknown> },
): Promise<ResultReviewItem> {
  const { data, error } = await supabase
    .from("result_review_items" as never)
    .update({ review_status: status, ...patch } as never)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  if (event) await logEvent(event.action, event.notes, { review_id: id, ...(event.metadata ?? {}) });
  return data as unknown as ResultReviewItem;
}

export const approveReviewItem = (id: string) =>
  updateStatus(id, "approved", {}, {
    action: "result_review_approved",
    notes: "Review approvata",
  });

export const markReviewItemNeedsFix = (id: string, note?: string) =>
  updateStatus(id, "needs_fix", { review_note: note ?? null }, {
    action: "result_review_needs_fix",
    notes: `Review da correggere${note ? `: ${note}` : ""}`,
  });

export const markReviewItemFailed = (id: string, reason?: string) =>
  updateStatus(id, "failed", { review_note: reason ?? null }, {
    action: "result_review_failed",
    notes: `Review fallita${reason ? `: ${reason}` : ""}`,
  });

export const ignoreReviewItem = (id: string) =>
  updateStatus(id, "ignored", {}, {
    action: "result_review_ignored",
    notes: "Review ignorata",
  });

export async function createActionFromReviewItem(item: ResultReviewItem): Promise<string | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data, error } = await supabase
    .from("automation_actions" as never)
    .insert({
      user_id: u.user.id,
      brain_id: item.brain_id,
      project_id: item.project_id,
      title: `Follow-up: ${item.title}`,
      description: item.review_note ?? item.error_text ?? "Azione generata da Result Review",
      action_type: "manual_followup",
      risk_level: item.risk_level ?? "medium",
      status: "pending",
      metadata: { from_review_id: item.id, source_type: item.source_type },
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  const actionId = (data as { id: string }).id;
  await updateStatus(item.id, "action_created", { linked_action_id: actionId }, {
    action: "result_review_action_created",
    notes: `Azione creata da review: ${item.title}`,
    metadata: { action_id: actionId },
  });
  return actionId;
}

export function buildNextPromptFromReview(item: ResultReviewItem): string {
  const obj =
    item.review_status === "needs_fix"
      ? "Correggere il problema riscontrato e riprovare in modo controllato."
      : item.review_status === "failed"
        ? "Diagnosticare la causa del fallimento e proporre una soluzione."
        : "Continuare con il prossimo passo coerente con il risultato approvato.";
  const lines = [
    "Contesto: Brain Hub — Result Review",
    `Origine: ${SOURCE_TYPE_LABEL[item.source_type as ReviewSourceType] ?? item.source_type}`,
    item.brain_id ? `Brain: ${item.brain_id}` : null,
    item.project_id ? `Progetto: ${item.project_id}` : null,
    "",
    "Cosa è stato fatto:",
    item.title,
    "",
    "Risultato ottenuto:",
    sanitizeText(item.result_text) ?? "(nessun output testuale)",
    "",
    item.error_text ? `Problema riscontrato:\n${sanitizeText(item.error_text)}` : null,
    item.review_note ? `Nota review:\n${item.review_note}` : null,
    "",
    `Obiettivo del prossimo prompt: ${obj}`,
    "",
    "Cosa NON toccare: auth, RLS, schema DB esistente, altre feature stabili di Brain Hub.",
    "",
    "Output richiesto: modifiche minime, focalizzate, con build pulita e nessun errore TypeScript.",
  ].filter(Boolean) as string[];
  return lines.join("\n");
}

export async function createNextPromptFromReviewItem(item: ResultReviewItem): Promise<string> {
  const prompt = buildNextPromptFromReview(item);
  await updateStatus(item.id, "next_prompt_created", {
    metadata: { ...(item.metadata ?? {}), next_prompt_preview: prompt.slice(0, 500) },
  }, {
    action: "result_review_next_prompt_created",
    notes: `Prossimo prompt generato per: ${item.title}`,
  });
  return prompt;
}

export async function copyReviewResult(item: ResultReviewItem): Promise<string> {
  const text = sanitizeText(item.result_text) ?? "";
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  }
  return text;
}

export async function logSourceOpened(item: ResultReviewItem) {
  await logEvent("result_review_source_opened", `Sorgente aperta: ${item.title}`, {
    review_id: item.id,
    source_type: item.source_type,
    source_id: item.source_id,
  });
}
