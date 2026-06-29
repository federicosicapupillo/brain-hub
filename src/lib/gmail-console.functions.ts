// ============================================================
// Brain Hub v3.27 — Gmail Console server functions
// ============================================================
// Brain Hub diventa il controller deterministico di Gmail.
// Tutte le query lavorano sulla cache (`gmail_message_map`).
// Le azioni distruttive sono delegate a `executeEmailActionFn`
// (Controlled Action Layer + UI confirm).
//
// Bozze e risposte AI restano LOCALI (`gmail_console_drafts`):
// l'attuale scope OAuth è `gmail.modify` (no send/compose) e
// la v3.27 non altera lo scope. L'invio reale richiederà un
// upgrade scope esplicito in una versione successiva.
// ============================================================

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------------- Types ----------------

export type GmailConsoleStatus = {
  connected: boolean;
  google_email: string | null;
  last_sync_at: string | null;
  requires_reauth: boolean;
  counts: {
    total: number;
    unread: number;
    today: number;
    inbox: number;
    trashed: number;
    drafts_local: number;
  };
  last_error: string | null;
};

export type GmailConsoleMessage = {
  local_id: string;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  subject: string | null;
  from_name: string | null;
  from_email: string | null;
  to_emails: string[];
  snippet: string | null;
  internal_date: string | null;
  is_unread: boolean;
  is_important: boolean;
  is_trashed: boolean;
  has_attachments: boolean;
  labels: string[];
  detected_category: string | null;
  detected_priority: string | null;
  importance_score: number;
  importance_level: string;
  in_inbox: boolean;
};

export type GmailConsoleLabel = {
  label: string;
  count: number;
};

export type GmailConsoleDraft = {
  id: string;
  in_reply_to_gmail_message_id: string | null;
  in_reply_to_gmail_thread_id: string | null;
  forward_of_gmail_message_id: string | null;
  to_emails: string[];
  cc_emails: string[];
  bcc_emails: string[];
  subject: string | null;
  body: string | null;
  generated_by_ai: boolean;
  status: string;
  created_at: string;
  updated_at: string;
};

export type GmailConsoleFilter =
  | "inbox"
  | "today"
  | "unread"
  | "important"
  | "starred"
  | "promotions"
  | "social"
  | "updates"
  | "spam"
  | "trash"
  | "all";

const FILTER_VALUES: GmailConsoleFilter[] = [
  "inbox",
  "today",
  "unread",
  "important",
  "starred",
  "promotions",
  "social",
  "updates",
  "spam",
  "trash",
  "all",
];

function isFilter(value: unknown): value is GmailConsoleFilter {
  return typeof value === "string" && (FILTER_VALUES as string[]).includes(value);
}

// ---------------- Logging (sanitized) ----------------

function hashId(input: string): string {
  let h = 0xcbf29ce4 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

type SupaLike = {
  from: (table: string) => {
    insert: (v: Record<string, unknown>) => Promise<{ error: unknown }>;
  };
};

async function logConsoleEvent(
  supabase: unknown,
  userId: string,
  event: string,
  metadata: Record<string, unknown>,
) {
  try {
    await (supabase as SupaLike)
      .from("agent_event_log")
      .insert({ user_id: userId, event_type: event, metadata });
  } catch {
    /* best-effort */
  }
}

// ---------------- Active connection ----------------

type ActiveConnection = {
  id: string;
  google_email: string | null;
  last_sync_at: string | null;
  status: string;
};

async function getActiveConnection(
  supabase: {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, v: string) => {
          order: (col: string, opts: { ascending: boolean; nullsFirst?: boolean }) => {
            order: (col: string, opts: { ascending: boolean }) => {
              limit: (n: number) => Promise<{
                data: ActiveConnection[] | null;
                error: unknown;
              }>;
            };
          };
        };
      };
    };
  },
  userId: string,
): Promise<ActiveConnection | null> {
  const { data } = await supabase
    .from("gmail_connection_settings")
    .select("id,google_email,last_sync_at,status")
    .eq("user_id", userId)
    .order("last_sync_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0];
  if (!row) return null;
  return row;
}

// ---------------- get_status ----------------

export const getGmailConsoleStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }): Promise<GmailConsoleStatus> => {
    const { supabase, userId } = context;
    const conn = await getActiveConnection(
      supabase as unknown as Parameters<typeof getActiveConnection>[0],
      userId,
    );
    if (!conn) {
      const { count: draftsCount } = await supabase
        .from("gmail_console_drafts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);
      return {
        connected: false,
        google_email: null,
        last_sync_at: null,
        requires_reauth: false,
        counts: {
          total: 0,
          unread: 0,
          today: 0,
          inbox: 0,
          trashed: 0,
          drafts_local: draftsCount ?? 0,
        },
        last_error: null,
      };
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();
    const head = (col: string, fn: (q: unknown) => unknown) => fn(
      supabase
        .from("gmail_message_map")
        .select(col, { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("connection_id", conn.id),
    );
    const [
      totalR,
      unreadR,
      todayR,
      inboxR,
      trashedR,
      draftsR,
    ] = await Promise.all([
      head("id", (q) => q),
      head("id", (q) =>
        (q as { eq: (c: string, v: boolean) => unknown }).eq("is_unread", true),
      ),
      head("id", (q) =>
        (q as { gte: (c: string, v: string) => unknown }).gte("internal_date", todayIso),
      ),
      head("id", (q) =>
        (q as { eq: (c: string, v: boolean) => unknown }).eq("inbox", true),
      ),
      head("id", (q) =>
        (q as { eq: (c: string, v: boolean) => unknown }).eq("is_trashed", true),
      ),
      supabase
        .from("gmail_console_drafts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
    ]);

    const c = (r: unknown) =>
      ((r as { count?: number | null } | null)?.count ?? 0) as number;
    return {
      connected: conn.status === "connected",
      google_email: conn.google_email,
      last_sync_at: conn.last_sync_at,
      requires_reauth: conn.status === "reauth_required",
      counts: {
        total: c(await totalR),
        unread: c(await unreadR),
        today: c(await todayR),
        inbox: c(await inboxR),
        trashed: c(await trashedR),
        drafts_local: c(await draftsR),
      },
      last_error: null,
    };
  });

// ---------------- list_messages (search + filter on cache) ----------------

const CONSOLE_SELECT_COLS =
  "id,gmail_message_id,gmail_thread_id,subject,from_email,from_name,to_emails,snippet,internal_date,is_unread,is_important,is_trashed,has_attachments,label_ids,detected_category,detected_priority,importance_score,importance_level,inbox";

export const listGmailConsoleMessagesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: unknown) =>
      (d ?? {}) as {
        filter?: GmailConsoleFilter;
        search?: string;
        label?: string;
        limit?: number;
        offset?: number;
      },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const conn = await getActiveConnection(
      supabase as unknown as Parameters<typeof getActiveConnection>[0],
      userId,
    );
    if (!conn) {
      return {
        ok: true as const,
        connected: false,
        messages: [] as GmailConsoleMessage[],
      };
    }
    const filter: GmailConsoleFilter = isFilter(data.filter) ? data.filter : "inbox";
    const limit = Math.min(Math.max(data.limit ?? 50, 1), 200);
    const offset = Math.max(data.offset ?? 0, 0);

    let q = supabase
      .from("gmail_message_map")
      .select(CONSOLE_SELECT_COLS)
      .eq("user_id", userId)
      .eq("connection_id", conn.id)
      .order("internal_date", { ascending: false, nullsFirst: false });

    switch (filter) {
      case "inbox":
        q = q.eq("inbox", true).eq("is_trashed", false);
        break;
      case "today": {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        q = q.gte("internal_date", today.toISOString()).eq("is_trashed", false);
        break;
      }
      case "unread":
        q = q.eq("is_unread", true).eq("is_trashed", false);
        break;
      case "important":
        q = q.eq("is_important", true).eq("is_trashed", false);
        break;
      case "starred":
        q = q.contains("label_ids", ["STARRED"]).eq("is_trashed", false);
        break;
      case "promotions":
        q = q.contains("label_ids", ["CATEGORY_PROMOTIONS"]).eq("is_trashed", false);
        break;
      case "social":
        q = q.contains("label_ids", ["CATEGORY_SOCIAL"]).eq("is_trashed", false);
        break;
      case "updates":
        q = q.contains("label_ids", ["CATEGORY_UPDATES"]).eq("is_trashed", false);
        break;
      case "spam":
        q = q.contains("label_ids", ["SPAM"]);
        break;
      case "trash":
        q = q.eq("is_trashed", true);
        break;
      case "all":
      default:
        break;
    }

    if (data.label && /^[A-Za-z0-9_\-]{1,80}$/.test(data.label)) {
      q = q.contains("label_ids", [data.label]);
    }

    const search = (data.search ?? "").trim();
    if (search.length >= 2) {
      const safe = search.replace(/[%_\\]/g, "\\$&");
      const pat = `%${safe}%`;
      q = q.or(
        `subject.ilike.${pat},from_email.ilike.${pat},from_name.ilike.${pat},snippet.ilike.${pat},body_preview.ilike.${pat}`,
      );
    }

    q = q.range(offset, offset + limit - 1);
    const { data: rows, error } = await q;
    if (error) {
      return {
        ok: false as const,
        error: "query_failed",
        messages: [] as GmailConsoleMessage[],
      };
    }
    const messages: GmailConsoleMessage[] = ((rows ?? []) as Array<Record<string, unknown>>).map(
      (r) => ({
        local_id: String(r.id),
        gmail_message_id: String(r.gmail_message_id),
        gmail_thread_id: (r.gmail_thread_id as string | null) ?? null,
        subject: (r.subject as string | null) ?? null,
        from_name: (r.from_name as string | null) ?? null,
        from_email: (r.from_email as string | null) ?? null,
        to_emails: Array.isArray(r.to_emails) ? (r.to_emails as string[]) : [],
        snippet: ((r.snippet as string | null) ?? "").slice(0, 280) || null,
        internal_date: (r.internal_date as string | null) ?? null,
        is_unread: Boolean(r.is_unread),
        is_important: Boolean(r.is_important),
        is_trashed: Boolean(r.is_trashed),
        has_attachments: Boolean(r.has_attachments),
        labels: Array.isArray(r.label_ids) ? (r.label_ids as string[]) : [],
        detected_category: (r.detected_category as string | null) ?? null,
        detected_priority: (r.detected_priority as string | null) ?? null,
        importance_score: Number(r.importance_score ?? 0),
        importance_level: (r.importance_level as string | null) ?? "low",
        in_inbox: Boolean(r.inbox),
      }),
    );

    void logConsoleEvent(supabase, userId, "gmail_console_search", {
      filter,
      has_search: search.length >= 2,
      result_count: messages.length,
    });

    return {
      ok: true as const,
      connected: true,
      filter,
      messages,
    };
  });

// ---------------- list_labels (aggregated from cache) ----------------

export const listGmailConsoleLabelsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }): Promise<{ labels: GmailConsoleLabel[] }> => {
    const { supabase, userId } = context;
    const conn = await getActiveConnection(
      supabase as unknown as Parameters<typeof getActiveConnection>[0],
      userId,
    );
    if (!conn) return { labels: [] };
    const { data } = await supabase
      .from("gmail_message_map")
      .select("label_ids")
      .eq("user_id", userId)
      .eq("connection_id", conn.id)
      .limit(2000);
    const counts = new Map<string, number>();
    for (const row of (data ?? []) as Array<{ label_ids?: string[] | null }>) {
      const labels = Array.isArray(row.label_ids) ? row.label_ids : [];
      for (const l of labels) {
        if (typeof l !== "string") continue;
        counts.set(l, (counts.get(l) ?? 0) + 1);
      }
    }
    return {
      labels: Array.from(counts.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 100),
    };
  });

// ---------------- Drafts CRUD (local) ----------------

function sanitizeEmailList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const v of input) {
    if (typeof v !== "string") continue;
    const t = v.trim().slice(0, 320);
    if (!t) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) continue;
    out.push(t);
    if (out.length >= 20) break;
  }
  return out;
}

export const saveGmailConsoleDraftFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: unknown) =>
      (d ?? {}) as {
        id?: string;
        in_reply_to_gmail_message_id?: string | null;
        in_reply_to_gmail_thread_id?: string | null;
        forward_of_gmail_message_id?: string | null;
        to_emails?: string[];
        cc_emails?: string[];
        bcc_emails?: string[];
        subject?: string | null;
        body?: string | null;
        generated_by_ai?: boolean;
        status?: "draft" | "ready" | "discarded";
      },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const row = {
      user_id: userId,
      in_reply_to_gmail_message_id: data.in_reply_to_gmail_message_id ?? null,
      in_reply_to_gmail_thread_id: data.in_reply_to_gmail_thread_id ?? null,
      forward_of_gmail_message_id: data.forward_of_gmail_message_id ?? null,
      to_emails: sanitizeEmailList(data.to_emails),
      cc_emails: sanitizeEmailList(data.cc_emails),
      bcc_emails: sanitizeEmailList(data.bcc_emails),
      subject: (data.subject ?? "").slice(0, 500) || null,
      body: (data.body ?? "").slice(0, 50000) || null,
      generated_by_ai: Boolean(data.generated_by_ai),
      status: data.status ?? "draft",
      updated_at: new Date().toISOString(),
    };
    if (data.id) {
      const { data: updated, error } = await supabase
        .from("gmail_console_drafts")
        .update(row)
        .eq("id", data.id)
        .eq("user_id", userId)
        .select("id")
        .maybeSingle();
      if (error) return { ok: false as const, error: "update_failed" };
      void logConsoleEvent(supabase, userId, "gmail_console_draft_updated", {
        draft_id_hash: hashId(String(updated?.id ?? data.id)),
        in_reply_to: data.in_reply_to_gmail_message_id
          ? hashId(data.in_reply_to_gmail_message_id)
          : null,
        ai: row.generated_by_ai,
      });
      return { ok: true as const, id: updated?.id ?? data.id };
    }
    const { data: inserted, error } = await supabase
      .from("gmail_console_drafts")
      .insert(row)
      .select("id")
      .maybeSingle();
    if (error || !inserted?.id) {
      return { ok: false as const, error: "insert_failed" };
    }
    void logConsoleEvent(supabase, userId, "gmail_console_draft_created", {
      draft_id_hash: hashId(String(inserted.id)),
      ai: row.generated_by_ai,
    });
    return { ok: true as const, id: String(inserted.id) };
  });

export const listGmailConsoleDraftsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }): Promise<{ drafts: GmailConsoleDraft[] }> => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("gmail_console_drafts")
      .select(
        "id,in_reply_to_gmail_message_id,in_reply_to_gmail_thread_id,forward_of_gmail_message_id,to_emails,cc_emails,bcc_emails,subject,body,generated_by_ai,status,created_at,updated_at",
      )
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(100);
    const drafts: GmailConsoleDraft[] = ((data ?? []) as Array<Record<string, unknown>>).map(
      (r) => ({
        id: String(r.id),
        in_reply_to_gmail_message_id:
          (r.in_reply_to_gmail_message_id as string | null) ?? null,
        in_reply_to_gmail_thread_id:
          (r.in_reply_to_gmail_thread_id as string | null) ?? null,
        forward_of_gmail_message_id:
          (r.forward_of_gmail_message_id as string | null) ?? null,
        to_emails: Array.isArray(r.to_emails) ? (r.to_emails as string[]) : [],
        cc_emails: Array.isArray(r.cc_emails) ? (r.cc_emails as string[]) : [],
        bcc_emails: Array.isArray(r.bcc_emails) ? (r.bcc_emails as string[]) : [],
        subject: (r.subject as string | null) ?? null,
        body: (r.body as string | null) ?? null,
        generated_by_ai: Boolean(r.generated_by_ai),
        status: (r.status as string | null) ?? "draft",
        created_at: String(r.created_at ?? ""),
        updated_at: String(r.updated_at ?? ""),
      }),
    );
    return { drafts };
  });

export const deleteGmailConsoleDraftFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => (d ?? {}) as { id?: string })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!data.id) return { ok: false as const, error: "missing_id" };
    const { error } = await supabase
      .from("gmail_console_drafts")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) return { ok: false as const, error: "delete_failed" };
    void logConsoleEvent(supabase, userId, "gmail_console_draft_deleted", {
      draft_id_hash: hashId(data.id),
    });
    return { ok: true as const };
  });

// ---------------- AI reply generator (Lovable AI Gateway) ----------------

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-2.5-flash";

export const generateGmailConsoleReplyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: unknown) =>
      (d ?? {}) as {
        gmail_message_id?: string;
        instruction?: string;
        tone?: "neutro" | "cordiale" | "formale" | "diretto";
      },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!data.gmail_message_id) {
      return { ok: false as const, error: "missing_gmail_message_id" };
    }
    const { data: row } = await supabase
      .from("gmail_message_map")
      .select(
        "gmail_message_id,gmail_thread_id,subject,from_name,from_email,to_emails,snippet,body_preview",
      )
      .eq("user_id", userId)
      .eq("gmail_message_id", data.gmail_message_id)
      .maybeSingle();
    if (!row) return { ok: false as const, error: "email_not_found" };

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return { ok: false as const, error: "ai_gateway_not_configured" };
    }

    const tone = data.tone ?? "cordiale";
    const userInstruction = (data.instruction ?? "").slice(0, 800);
    const messageBlock = [
      `Da: ${(row as { from_name?: string | null; from_email?: string | null }).from_name ?? ""} <${(row as { from_email?: string | null }).from_email ?? ""}>`,
      `Oggetto: ${(row as { subject?: string | null }).subject ?? "(senza oggetto)"}`,
      "",
      ((row as { body_preview?: string | null }).body_preview ??
        (row as { snippet?: string | null }).snippet ??
        "").slice(0, 4000),
    ].join("\n");

    const sys =
      "Sei un assistente che scrive bozze di risposte email professionali in italiano. " +
      "Tono: " +
      tone +
      ". Non inventare informazioni che non sono nella email. Se mancano dati, " +
      "usa placeholder espliciti tipo [DA COMPLETARE]. Restituisci SOLO il corpo della risposta, " +
      "senza intestazioni, senza oggetto, senza firma generica.";
    const userPrompt =
      (userInstruction
        ? `Istruzioni dell'utente:\n${userInstruction}\n\n`
        : "") +
      `Email originale:\n${messageBlock}\n\nScrivi la bozza di risposta.`;

    let res: Response;
    try {
      res = await fetch(AI_GATEWAY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: userPrompt },
          ],
        }),
      });
    } catch {
      return { ok: false as const, error: "ai_gateway_unreachable" };
    }
    if (!res.ok) {
      if (res.status === 402) {
        return { ok: false as const, error: "ai_credits_exhausted" };
      }
      if (res.status === 429) {
        return { ok: false as const, error: "ai_rate_limited" };
      }
      return { ok: false as const, error: `ai_error_${res.status}` };
    }
    const json = (await res.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string } }> }
      | null;
    const draft = json?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!draft) {
      return { ok: false as const, error: "ai_empty_response" };
    }

    const subject =
      (row as { subject?: string | null }).subject &&
      !/^re:/i.test((row as { subject?: string | null }).subject ?? "")
        ? `Re: ${(row as { subject?: string | null }).subject}`
        : ((row as { subject?: string | null }).subject ?? "Re:");

    void logConsoleEvent(supabase, userId, "gmail_console_reply_draft_generated", {
      message_id_hash: hashId(data.gmail_message_id),
      tone,
      has_user_instruction: userInstruction.length > 0,
      draft_chars: draft.length,
    });

    return {
      ok: true as const,
      draft_body: draft,
      suggested_subject: subject,
      suggested_to: (row as { from_email?: string | null }).from_email
        ? [(row as { from_email?: string | null }).from_email as string]
        : [],
      in_reply_to_gmail_message_id: (row as { gmail_message_id?: string | null })
        .gmail_message_id as string,
      in_reply_to_gmail_thread_id:
        (row as { gmail_thread_id?: string | null }).gmail_thread_id ?? null,
    };
  });
