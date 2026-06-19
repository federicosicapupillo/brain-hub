// ============================================================
// Brain Hub v3.22 — Gmail Intelligence server functions
// ============================================================
// All read-only. RLS-scoped via requireSupabaseAuth.
// No body fetch from Gmail API here; we rely on the metadata
// cached by the existing connector sync (gmail_message_map).
// ============================================================

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  classifyEmailImportance,
  buildDeterministicSummary,
  type ImportanceLevel,
} from "@/lib/gmail-intelligence";
import type { GmailMessageRow } from "@/lib/gmail-connector";

type GmailMessageRowDb = GmailMessageRow & {
  importance_score: number | null;
  importance_level: string | null;
  importance_reason: string | null;
  summary_short: string | null;
  project_guess: string | null;
  summary_generated_at: string | null;
};

async function logEvent(
  supabase: unknown,
  userId: string,
  event: string,
  metadata: Record<string, unknown>,
) {
  try {
    await (
      supabase as {
        from: (t: string) => {
          insert: (v: Record<string, unknown>) => Promise<{ error: unknown }>;
        };
      }
    )
      .from("agent_event_log")
      .insert({ user_id: userId, event_type: event, metadata });
  } catch {
    /* best-effort */
  }
}

// ---------- get_email_brief ----------

export const getEmailBriefFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: unknown) =>
      (d ?? {}) as {
        brain_id?: string | null;
        date_range?: "today" | "7d" | "all";
        unread_only?: boolean;
        important_only?: boolean;
      },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const range = data.date_range ?? "today";
    const since =
      range === "today"
        ? new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
        : range === "7d"
          ? new Date(Date.now() - 7 * 86400000).toISOString()
          : null;

    const { data: connsRaw } = await supabase
      .from("gmail_connection_settings")
      .select("id,status,last_sync_at")
      .order("created_at", { ascending: false });
    const conns = (connsRaw ?? []) as Array<{
      id: string;
      status: string;
      last_sync_at: string | null;
    }>;
    const conn = conns.find((c) => c.status === "connected") ?? conns[0] ?? null;
    if (!conn || conn.status !== "connected") {
      return {
        ok: true,
        connected: false,
        message: "Gmail non collegato. Collegalo da Tool Connections.",
      };
    }

    let totalQ = supabase
      .from("gmail_message_map")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id);
    let unreadQ = supabase
      .from("gmail_message_map")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id)
      .eq("is_unread", true);
    let importantQ = supabase
      .from("gmail_message_map")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id)
      .gte("importance_score", 55);

    if (since) {
      totalQ = totalQ.gte("internal_date", since);
      unreadQ = unreadQ.gte("internal_date", since);
      importantQ = importantQ.gte("internal_date", since);
    }
    if (data.brain_id) {
      totalQ = totalQ.eq("brain_id", data.brain_id);
      unreadQ = unreadQ.eq("brain_id", data.brain_id);
      importantQ = importantQ.eq("brain_id", data.brain_id);
    }

    const [t, u, i] = await Promise.all([totalQ, unreadQ, importantQ]);

    let topQ = supabase
      .from("gmail_message_map")
      .select(
        "id,gmail_message_id,gmail_thread_id,subject,from_email,from_name,internal_date,importance_score,importance_level,importance_reason,project_guess,is_unread,has_attachments",
      )
      .eq("connection_id", conn.id)
      .gte("importance_score", data.important_only === false ? 0 : 30)
      .order("importance_score", { ascending: false })
      .order("internal_date", { ascending: false, nullsFirst: false })
      .limit(5);
    if (since) topQ = topQ.gte("internal_date", since);
    if (data.unread_only) topQ = topQ.eq("is_unread", true);
    if (data.brain_id) topQ = topQ.eq("brain_id", data.brain_id);

    const { data: topRows } = await topQ;
    const top = ((topRows ?? []) as Array<Record<string, unknown>>).map((r, idx) => ({
      selection_index: idx + 1,
      gmail_message_id: String(r.gmail_message_id),
      gmail_thread_id: (r.gmail_thread_id as string | null) ?? null,
      subject: (r.subject as string | null) ?? "(senza oggetto)",
      from:
        (r.from_name as string | null) ??
        (r.from_email as string | null) ??
        "sconosciuto",
      received_at: (r.internal_date as string | null) ?? null,
      importance_score: Number(r.importance_score ?? 0),
      importance_level: (r.importance_level as string | null) ?? "low",
      importance_reason: (r.importance_reason as string | null) ?? null,
      project_guess: (r.project_guess as string | null) ?? null,
      is_unread: Boolean(r.is_unread),
    }));

    void logEvent(supabase, userId, "gmail_email_brief_served", {
      brain_id: data.brain_id ?? null,
      range,
      total: t.count ?? 0,
      unread: u.count ?? 0,
      important: i.count ?? 0,
    });

    return {
      ok: true,
      connected: true,
      range,
      total: t.count ?? 0,
      unread: u.count ?? 0,
      important: i.count ?? 0,
      last_sync_at: conn.last_sync_at,
      top,
    };
  });

// ---------- list_important_emails ----------

export const listImportantEmailsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: unknown) =>
      (d ?? {}) as {
        brain_id?: string | null;
        since?: "today" | "7d" | "30d" | "all";
        project?: string | null;
        limit?: number;
      },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const limit = Math.min(Math.max(data.limit ?? 10, 1), 50);
    const since =
      data.since === "today"
        ? new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
        : data.since === "30d"
          ? new Date(Date.now() - 30 * 86400000).toISOString()
          : data.since === "all"
            ? null
            : new Date(Date.now() - 7 * 86400000).toISOString();

    let q = supabase
      .from("gmail_message_map")
      .select(
        "id,gmail_message_id,gmail_thread_id,subject,from_email,from_name,internal_date,importance_score,importance_level,importance_reason,project_guess,is_unread,has_attachments",
      )
      .gte("importance_score", 55)
      .order("importance_score", { ascending: false })
      .order("internal_date", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (since) q = q.gte("internal_date", since);
    if (data.brain_id) q = q.eq("brain_id", data.brain_id);
    if (data.project) q = q.eq("project_guess", data.project);

    const { data: rows } = await q;
    const items = ((rows ?? []) as Array<Record<string, unknown>>).map(
      (r, idx) => ({
        selection_index: idx + 1,
        gmail_message_id: String(r.gmail_message_id),
        gmail_thread_id: (r.gmail_thread_id as string | null) ?? null,
        subject: (r.subject as string | null) ?? "(senza oggetto)",
        from:
          (r.from_name as string | null) ??
          (r.from_email as string | null) ??
          "sconosciuto",
        received_at: (r.internal_date as string | null) ?? null,
        importance_score: Number(r.importance_score ?? 0),
        importance_level: (r.importance_level as string | null) ?? "low",
        importance_reason: (r.importance_reason as string | null) ?? null,
        project_guess: (r.project_guess as string | null) ?? null,
        is_unread: Boolean(r.is_unread),
      }),
    );
    void logEvent(supabase, userId, "gmail_important_emails_listed", {
      brain_id: data.brain_id ?? null,
      project: data.project ?? null,
      count: items.length,
    });
    return { ok: true, items };
  });

// ---------- summarize_email ----------

async function findMessage(
  supabase: {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (k: string, v: string) => {
          maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
  },
  identifier: string,
): Promise<GmailMessageRowDb | null> {
  const { data } = await supabase
    .from("gmail_message_map")
    .select("*")
    .eq("gmail_message_id", identifier)
    .maybeSingle();
  if (data) return data as GmailMessageRowDb;
  const { data: byId } = await supabase
    .from("gmail_message_map")
    .select("*")
    .eq("id", identifier)
    .maybeSingle();
  return (byId as GmailMessageRowDb | null) ?? null;
}

export const summarizeEmailFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: unknown) =>
      (d ?? {}) as {
        gmail_message_id?: string;
        selection_index?: number;
        brain_id?: string | null;
      },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    let messageRow: GmailMessageRowDb | null = null;

    if (data.gmail_message_id) {
      messageRow = await findMessage(supabase as never, data.gmail_message_id);
    } else if (typeof data.selection_index === "number") {
      // Resolve from latest important list (same query as list_important_emails)
      let q = supabase
        .from("gmail_message_map")
        .select("*")
        .gte("importance_score", 55)
        .order("importance_score", { ascending: false })
        .order("internal_date", { ascending: false, nullsFirst: false })
        .limit(Math.max(data.selection_index, 1));
      if (data.brain_id) q = q.eq("brain_id", data.brain_id);
      const { data: rows } = await q;
      const arr = (rows ?? []) as GmailMessageRowDb[];
      messageRow = arr[data.selection_index - 1] ?? null;
    }

    if (!messageRow) {
      return { ok: false, error: "email_not_found" };
    }

    void logEvent(supabase, userId, "gmail_email_summary_requested", {
      message_id_hash: hash(messageRow.gmail_message_id),
      brain_id: data.brain_id ?? null,
    });

    const summary = buildDeterministicSummary(messageRow);

    // Cache short summary back
    await supabase
      .from("gmail_message_map")
      .update({
        summary_short: summary.short,
        summary_generated_at: new Date().toISOString(),
      } as never)
      .eq("id", messageRow.id);

    void logEvent(supabase, userId, "gmail_email_summary_created", {
      message_id_hash: hash(messageRow.gmail_message_id),
      importance_level: summary.importance_level,
    });

    return {
      ok: true,
      summary,
      gmail_message_id: messageRow.gmail_message_id,
      gmail_thread_id: messageRow.gmail_thread_id,
    };
  });

// ---------- summarize_email_thread ----------

export const summarizeEmailThreadFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: unknown) =>
      (d ?? {}) as { gmail_thread_id?: string; brain_id?: string | null },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!data.gmail_thread_id) {
      return { ok: false, error: "missing_thread_id" };
    }
    let q = supabase
      .from("gmail_message_map")
      .select("*")
      .eq("gmail_thread_id", data.gmail_thread_id)
      .order("internal_date", { ascending: true, nullsFirst: true });
    if (data.brain_id) q = q.eq("brain_id", data.brain_id);
    const { data: rows } = await q;
    const msgs = (rows ?? []) as GmailMessageRowDb[];
    if (msgs.length === 0) return { ok: false, error: "thread_empty" };
    const summaries = msgs.map((m) => buildDeterministicSummary(m));
    const last = summaries[summaries.length - 1]!;
    void logEvent(supabase, userId, "gmail_email_summary_requested", {
      thread_id_hash: hash(data.gmail_thread_id),
      message_count: msgs.length,
    });
    return {
      ok: true,
      gmail_thread_id: data.gmail_thread_id,
      message_count: msgs.length,
      participants: Array.from(
        new Set(msgs.map((m) => m.from_email).filter(Boolean)),
      ),
      last_subject: last.subject,
      messages: summaries.map((s, idx) => ({
        index: idx + 1,
        gmail_message_id: msgs[idx]!.gmail_message_id,
        from: s.from,
        received_at: s.received_at,
        short: s.short,
        key_points: s.key_points,
      })),
    };
  });

// ---------- preview_email_action ----------

export const previewEmailActionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: unknown) =>
      (d ?? {}) as {
        gmail_message_id?: string;
        action_type?: string;
        reason?: string;
        brain_id?: string | null;
      },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!data.gmail_message_id) {
      return { ok: false, error: "missing_gmail_message_id" };
    }
    const messageRow = await findMessage(supabase as never, data.gmail_message_id);
    if (!messageRow) return { ok: false, error: "email_not_found" };

    const cls = classifyEmailImportance(messageRow);
    const actionType = data.action_type ?? cls.suggested_action_type;
    const reason =
      data.reason ??
      `Email importante (${cls.level}, score ${cls.score}): ${cls.reason}`;

    const subject = (messageRow.subject ?? "(senza oggetto)").slice(0, 140);
    const fromLabel = messageRow.from_name
      ? `${messageRow.from_name} <${messageRow.from_email ?? ""}>`
      : (messageRow.from_email ?? "mittente sconosciuto");

    const preview = {
      source: "gmail" as const,
      action_type: actionType,
      title: `Email: ${subject}`,
      description:
        `Da: ${fromLabel}\n` +
        `Importanza: ${cls.level} (score ${cls.score})\n` +
        `Motivo: ${cls.reason}\n` +
        `Snippet: ${(messageRow.snippet ?? "").slice(0, 280)}`,
      reason,
      risk_level: (cls.level === "high" ? "medium" : "low") as "low" | "medium",
      priority: cls.level as ImportanceLevel,
      brain_id: messageRow.brain_id,
      requires_confirmation: true,
      metadata: {
        source_label: "gmail_intelligence",
        gmail_message_id: messageRow.gmail_message_id,
        gmail_thread_id: messageRow.gmail_thread_id,
        from_email_hash: hash(messageRow.from_email ?? ""),
        subject_hash: hash(subject),
        importance_score: cls.score,
        importance_level: cls.level,
        importance_reason: cls.reason,
        project_guess: cls.project_guess,
      },
    };

    void logEvent(supabase, userId, "gmail_email_action_preview_created", {
      message_id_hash: hash(messageRow.gmail_message_id),
      importance_level: cls.level,
      action_type: actionType,
    });

    return { ok: true, preview };
  });

// ---------- helpers ----------

function hash(input: string): string {
  // tiny non-cryptographic hash (FNV-1a 32-bit) for sanitized logs
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
