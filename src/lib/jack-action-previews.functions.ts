// ============================================================
// Brain Hub v3.21.6 — Jack Action Previews persistence
// ============================================================
// Persists Jack's pending action proposals in `public.jack_action_previews`
// so they survive route changes, refreshes and transient errors. The model
// has no direct path to these server functions: they're only invoked from
// the UI (button) or the deterministic voice router.
//
// NEVER:
//  - executes external operations
//  - creates an automation_actions row before explicit user confirmation
//  - logs transcripts / audio / prompts / email bodies / secrets
// ============================================================

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import {
  hashJackActionText,
  redactJackIdempotencyKey,
  type PendingJackActionPreview,
} from "@/lib/jack-action-confirmation";

// ---------- Types ----------

export type JackActionPreviewStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "expired";

export type JackActionPreviewRow = {
  id: string;
  user_id: string;
  brain_id: string | null;
  preview_id: string;
  title: string;
  description: string | null;
  action_type: string | null;
  priority: string | null;
  source: string;
  status: JackActionPreviewStatus;
  idempotency_key: string | null;
  preview_payload: Json;
  confirmed_action_id: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  expires_at: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

export type SavedJackActionPreview = {
  id: string;
  preview_id: string;
  status: JackActionPreviewStatus;
  brain_id: string | null;
  title: string;
  description: string | null;
  expires_at: string | null;
  created_at: string;
};

export type RestoredJackActionPreview = SavedJackActionPreview & {
  preview: PendingJackActionPreview;
};

// ---------- Minimal Supabase shapes (no `any`) ----------

type QueryResult<T> = { data: T | null; error: { message: string } | null };
type QueryRows<T> = { data: T[] | null; error: { message: string } | null };

type SingleResult<T> = Promise<QueryResult<T>>;

type Filter<T> = {
  eq: (col: string, val: unknown) => Filter<T>;
  order: (col: string, opts: { ascending: boolean }) => Filter<T>;
  limit: (n: number) => Filter<T>;
  maybeSingle: () => SingleResult<T>;
  single: () => SingleResult<T>;
  select: <U = T>(cols: string) => Filter<U>;
};

type FromTable = {
  select: <T = JackActionPreviewRow>(cols: string) => Filter<T>;
  insert: (row: Record<string, unknown>) => Promise<QueryRows<unknown>> & {
    select: <T = JackActionPreviewRow>(cols: string) => Filter<T>;
  };
  upsert: (
    row: Record<string, unknown>,
    opts: { onConflict: string },
  ) => { select: <T = JackActionPreviewRow>(cols: string) => Filter<T> };
  update: (patch: Record<string, unknown>) => Filter<JackActionPreviewRow>;
};

type SupabaseLike = {
  from: (table: string) => FromTable;
};

function db(supabase: unknown): SupabaseLike {
  return supabase as SupabaseLike;
}

// ---------- Helpers ----------

function sanitizeText(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, max);
}

function safeJsonValue(value: unknown): Json {
  try {
    return JSON.parse(JSON.stringify(value ?? {})) as Json;
  } catch {
    return {} as Json;
  }
}

async function logEvent(
  supabase: unknown,
  userId: string,
  event: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await db(supabase).from("app_logs").insert({
      user_id: userId,
      entity_type: "jack_action_preview",
      action: event,
      message: event,
      severity: "info",
      metadata: safeJsonValue(metadata),
    });
  } catch {
    /* telemetry must never break callers */
  }
}

function isExpired(row: JackActionPreviewRow): boolean {
  if (!row.expires_at) return false;
  return new Date(row.expires_at).getTime() < Date.now();
}

function toSavedPreview(row: JackActionPreviewRow): SavedJackActionPreview {
  return {
    id: row.id,
    preview_id: row.preview_id,
    status: row.status,
    brain_id: row.brain_id,
    title: row.title,
    description: row.description,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

function rowToPendingPreview(row: JackActionPreviewRow): PendingJackActionPreview {
  const payload = (row.preview_payload ?? {}) as Record<string, unknown>;
  return {
    ...(payload as object),
    preview_id: row.preview_id,
    title: row.title,
    description:
      (payload.description as string | undefined) ?? row.description ?? "",
    reason: (payload.reason as string | undefined) ?? "",
    risk_level:
      (payload.risk_level as "low" | "medium" | "high" | undefined) ?? "low",
    source: (payload.source as string | undefined) ?? row.source,
    idempotency_key:
      (payload.idempotency_key as string | undefined) ??
      row.idempotency_key ??
      "",
    brain_id:
      (payload.brain_id as string | null | undefined) ?? row.brain_id ?? null,
    project_id: (payload.project_id as string | null | undefined) ?? null,
    created_at: (payload.created_at as string | undefined) ?? row.created_at,
    generated_at:
      (payload.generated_at as string | undefined) ?? row.created_at,
  } as PendingJackActionPreview;
}

// ============================================================
// saveJackActionPreviewFn
// ============================================================

export type SaveJackActionPreviewInput = {
  preview_id: string;
  title: string;
  description?: string | null;
  action_type?: string | null;
  priority?: string | null;
  source?: string | null;
  idempotency_key?: string | null;
  brain_id?: string | null;
  preview_payload: Record<string, unknown>;
  expires_in_minutes?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type SaveJackActionPreviewResult =
  | { ok: true; preview: SavedJackActionPreview; deduplicated: boolean }
  | { ok: false; reason: string; safe_message: string };

export const saveJackActionPreviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d as SaveJackActionPreviewInput)
  .handler(async ({ data, context }): Promise<SaveJackActionPreviewResult> => {
    const { supabase, userId } = context;
    const previewId = sanitizeText(data.preview_id, 140);
    const title = sanitizeText(data.title, 220);
    if (!previewId || !title) {
      await logEvent(supabase, userId, "jack_action_preview_save_failed", {
        reason: "missing_preview_or_title",
      });
      return {
        ok: false,
        reason: "missing_preview_or_title",
        safe_message: "Preview incompleta: impossibile salvare.",
      };
    }
    const expiresIn = Math.max(1, Math.min(data.expires_in_minutes ?? 60, 1440));
    const expiresAt = new Date(Date.now() + expiresIn * 60_000).toISOString();
    const row = {
      user_id: userId,
      brain_id: data.brain_id ?? null,
      preview_id: previewId,
      title,
      description: sanitizeText(data.description ?? "", 900) || null,
      action_type: data.action_type ? sanitizeText(data.action_type, 80) : null,
      priority: data.priority ? sanitizeText(data.priority, 20) : null,
      source: sanitizeText(data.source ?? "jack", 80) || "jack",
      status: "pending" as const,
      idempotency_key: data.idempotency_key
        ? sanitizeText(data.idempotency_key, 240)
        : null,
      preview_payload: safeJsonValue(data.preview_payload),
      metadata: safeJsonValue(data.metadata ?? {}),
      expires_at: expiresAt,
      confirmed_action_id: null,
      confirmed_at: null,
      cancelled_at: null,
    };
    const res = await db(supabase)
      .from("jack_action_previews")
      .upsert(row, { onConflict: "user_id,preview_id" })
      .select(
        "id,user_id,brain_id,preview_id,title,description,action_type,priority,source,status,idempotency_key,preview_payload,confirmed_action_id,confirmed_at,cancelled_at,expires_at,metadata,created_at,updated_at",
      )
      .single();
    if (res.error || !res.data) {
      await logEvent(supabase, userId, "jack_action_preview_save_failed", {
        preview_id: previewId,
        title_hash: hashJackActionText(title),
        reason: res.error?.message?.slice(0, 120) ?? "upsert_failed",
      });
      return {
        ok: false,
        reason: "upsert_failed",
        safe_message: "Impossibile salvare la preview pendente.",
      };
    }
    const deduplicated = res.data.created_at !== res.data.updated_at;
    await logEvent(supabase, userId, "jack_action_preview_saved", {
      preview_id: previewId,
      title_hash: hashJackActionText(title),
      brain_id: data.brain_id ?? null,
      deduplicated,
      idempotency_key: data.idempotency_key
        ? redactJackIdempotencyKey(data.idempotency_key)
        : null,
    });
    return { ok: true, preview: toSavedPreview(res.data), deduplicated };
  });

// ============================================================
// getPendingJackActionPreviewFn
// ============================================================

export type GetPendingPreviewInput = { brain_id?: string | null };

export type GetPendingPreviewResult =
  | { ok: true; found: false }
  | { ok: true; found: true; preview: RestoredJackActionPreview };

export const getPendingJackActionPreviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => (d ?? {}) as GetPendingPreviewInput)
  .handler(async ({ data, context }): Promise<GetPendingPreviewResult> => {
    const { supabase, userId } = context;
    const brainId = data.brain_id ?? null;
    const baseQuery = db(supabase)
      .from("jack_action_previews")
      .select(
        "id,user_id,brain_id,preview_id,title,description,action_type,priority,source,status,idempotency_key,preview_payload,confirmed_action_id,confirmed_at,cancelled_at,expires_at,metadata,created_at,updated_at",
      )
      .eq("user_id", userId);
    const scoped = brainId
      ? baseQuery.eq("brain_id", brainId)
      : baseQuery.eq("status", "pending");
    const res = brainId
      ? await scoped
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : await scoped
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
    if (res.error) {
      await logEvent(supabase, userId, "jack_action_preview_restore_missing", {
        brain_id: brainId,
        error_code: "query_failed",
      });
      return { ok: true, found: false };
    }
    const row = res.data;
    if (!row) {
      await logEvent(supabase, userId, "jack_action_preview_restore_missing", {
        brain_id: brainId,
        error_code: "no_pending",
      });
      return { ok: true, found: false };
    }
    if (isExpired(row)) {
      try {
        await db(supabase)
          .from("jack_action_previews")
          .update({ status: "expired" })
          .eq("user_id", userId)
          .eq("preview_id", row.preview_id)
          .select("id")
          .maybeSingle();
      } catch {
        /* best effort */
      }
      await logEvent(supabase, userId, "jack_action_preview_restore_missing", {
        brain_id: brainId,
        preview_id: row.preview_id,
        error_code: "expired",
      });
      return { ok: true, found: false };
    }
    await logEvent(supabase, userId, "jack_action_preview_restored", {
      brain_id: brainId,
      preview_id: row.preview_id,
      title_hash: hashJackActionText(row.title),
      status: row.status,
    });
    return {
      ok: true,
      found: true,
      preview: { ...toSavedPreview(row), preview: rowToPendingPreview(row) },
    };
  });

// ============================================================
// cancelJackActionPreviewFn
// ============================================================

export type CancelPreviewInput = { preview_id: string };
export type CancelPreviewResult =
  | { ok: true; status: JackActionPreviewStatus }
  | { ok: false; reason: string; safe_message: string };

export const cancelJackActionPreviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d as CancelPreviewInput)
  .handler(async ({ data, context }): Promise<CancelPreviewResult> => {
    const { supabase, userId } = context;
    const previewId = sanitizeText(data.preview_id, 140);
    if (!previewId) {
      return {
        ok: false,
        reason: "missing_preview_id",
        safe_message: "Preview non valida.",
      };
    }
    const res = await db(supabase)
      .from("jack_action_previews")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("preview_id", previewId)
      .select("status")
      .maybeSingle();
    if (res.error || !res.data) {
      await logEvent(supabase, userId, "jack_action_preview_cancelled", {
        preview_id: previewId,
        error_code: res.error?.message?.slice(0, 120) ?? "not_found",
      });
      return {
        ok: false,
        reason: "not_found",
        safe_message: "Preview non trovata.",
      };
    }
    await logEvent(supabase, userId, "jack_action_preview_cancelled", {
      preview_id: previewId,
      status: res.data.status,
    });
    return { ok: true, status: res.data.status };
  });

// ============================================================
// confirmJackActionPreviewFn — creates the actual suggested action
// ============================================================

type InsertedAction = { id: string; title: string };

export type ConfirmPreviewInput = {
  preview_id: string;
  confirmation_source: "ui_button" | "voice_router";
};

export type ConfirmPreviewResult =
  | {
      ok: true;
      action_id: string;
      preview_id: string;
      title: string;
      deduplicated: boolean;
      verified: boolean;
    }
  | {
      ok: false;
      reason:
        | "missing_preview_id"
        | "invalid_confirmation_source"
        | "preview_not_found"
        | "preview_already_confirmed"
        | "preview_cancelled"
        | "preview_expired"
        | "insert_failed";
      safe_message: string;
      preview_id: string;
      action_id?: string | null;
    };

export const confirmJackActionPreviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d as ConfirmPreviewInput)
  .handler(async ({ data, context }): Promise<ConfirmPreviewResult> => {
    const { supabase, userId } = context;
    const previewId = sanitizeText(data.preview_id, 140);
    const source = data.confirmation_source;
    const baseEvent = { preview_id: previewId, confirmation_source: source };
    if (!previewId) {
      await logEvent(supabase, userId, "jack_action_preview_confirm_failed", {
        ...baseEvent,
        error_code: "missing_preview_id",
      });
      return {
        ok: false,
        reason: "missing_preview_id",
        safe_message: "Preview non valida.",
        preview_id: previewId,
      };
    }
    if (source !== "ui_button" && source !== "voice_router") {
      await logEvent(supabase, userId, "jack_action_preview_confirm_failed", {
        ...baseEvent,
        error_code: "invalid_confirmation_source",
      });
      return {
        ok: false,
        reason: "invalid_confirmation_source",
        safe_message:
          "Conferma non valida: serve un click UI o voice router esplicito.",
        preview_id: previewId,
      };
    }

    await logEvent(supabase, userId, "jack_action_preview_confirm_started", baseEvent);

    const loaded = await db(supabase)
      .from("jack_action_previews")
      .select(
        "id,user_id,brain_id,preview_id,title,description,action_type,priority,source,status,idempotency_key,preview_payload,confirmed_action_id,confirmed_at,cancelled_at,expires_at,metadata,created_at,updated_at",
      )
      .eq("user_id", userId)
      .eq("preview_id", previewId)
      .maybeSingle();

    if (loaded.error || !loaded.data) {
      await logEvent(supabase, userId, "jack_action_preview_confirm_failed", {
        ...baseEvent,
        error_code: "preview_not_found",
      });
      return {
        ok: false,
        reason: "preview_not_found",
        safe_message: "Preview non trovata.",
        preview_id: previewId,
      };
    }

    const row = loaded.data;
    if (row.status === "confirmed" && row.confirmed_action_id) {
      await logEvent(supabase, userId, "jack_action_preview_confirmed", {
        ...baseEvent,
        deduplicated: true,
        action_id: row.confirmed_action_id,
      });
      return {
        ok: true,
        action_id: row.confirmed_action_id,
        preview_id: previewId,
        title: row.title,
        deduplicated: true,
        verified: true,
      };
    }
    if (row.status === "cancelled") {
      await logEvent(supabase, userId, "jack_action_preview_confirm_failed", {
        ...baseEvent,
        error_code: "preview_cancelled",
      });
      return {
        ok: false,
        reason: "preview_cancelled",
        safe_message: "Preview annullata: nessuna action creata.",
        preview_id: previewId,
      };
    }
    if (isExpired(row)) {
      try {
        await db(supabase)
          .from("jack_action_previews")
          .update({ status: "expired" })
          .eq("user_id", userId)
          .eq("preview_id", previewId)
          .select("id")
          .maybeSingle();
      } catch {
        /* noop */
      }
      await logEvent(supabase, userId, "jack_action_preview_confirm_failed", {
        ...baseEvent,
        error_code: "preview_expired",
      });
      return {
        ok: false,
        reason: "preview_expired",
        safe_message: "Preview scaduta: rigenerala prima di confermare.",
        preview_id: previewId,
      };
    }

    const payload = (row.preview_payload ?? {}) as Record<string, unknown>;
    const riskLevel =
      (payload.risk_level as "low" | "medium" | "high" | undefined) ?? "low";
    const metadata = {
      source_module: "jack_voice_controlled",
      jack_preview_id: previewId,
      jack_idempotency_key: row.idempotency_key,
      jack_confirmed: true,
      confirmation_source: source,
      preview_title: row.title,
      jack_reason: (payload.reason as string | undefined) ?? null,
      jack_source: row.source,
    };

    const inserted = await db(supabase)
      .from("automation_actions")
      .insert({
        user_id: userId,
        brain_id: row.brain_id,
        project_id: (payload.project_id as string | null | undefined) ?? null,
        source: "system_suggestion",
        action_type: row.action_type ?? "manual_task",
        title: row.title,
        description: row.description ?? "",
        priority: row.priority ?? (riskLevel === "high" ? "high" : "medium"),
        risk_level: riskLevel,
        status: "suggested",
        requires_confirmation: riskLevel !== "low",
        metadata: safeJsonValue(metadata),
      })
      .select<InsertedAction>("id,title")
      .single();

    if (inserted.error || !inserted.data?.id) {
      await logEvent(supabase, userId, "jack_action_preview_confirm_failed", {
        ...baseEvent,
        error_code: inserted.error?.message?.slice(0, 120) ?? "insert_failed",
      });
      return {
        ok: false,
        reason: "insert_failed",
        safe_message: "La conferma è arrivata, ma l'inserimento è fallito.",
        preview_id: previewId,
      };
    }

    const actionId = inserted.data.id;

    const updated = await db(supabase)
      .from("jack_action_previews")
      .update({
        status: "confirmed",
        confirmed_action_id: actionId,
        confirmed_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("preview_id", previewId)
      .select("status")
      .maybeSingle();

    await logEvent(supabase, userId, "jack_action_preview_confirmed", {
      ...baseEvent,
      action_id: actionId,
      title_hash: hashJackActionText(row.title),
      preview_marked: updated.data?.status ?? null,
      deduplicated: false,
    });

    return {
      ok: true,
      action_id: actionId,
      preview_id: previewId,
      title: inserted.data.title,
      deduplicated: false,
      verified: true,
    };
  });
