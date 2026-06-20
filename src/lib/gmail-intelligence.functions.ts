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

// ---------- Rome timezone helpers (v3.22 — Today Reader) ----------

const ROME_TZ = "Europe/Rome";

export function romeStartOfDayIso(offsetDays = 0): string {
  // Compute Rome midnight for (today + offsetDays), then convert to UTC ISO.
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ROME_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  const utcMidnight = new Date(`${y}-${m}-${d}T00:00:00Z`).getTime();
  const romeWall = new Date(now.toLocaleString("en-US", { timeZone: ROME_TZ }));
  const utcWall = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMs = romeWall.getTime() - utcWall.getTime();
  const target = utcMidnight - offsetMs + offsetDays * 86400000;
  return new Date(target).toISOString();
}

// ---------- Inbox / Newsletter classification ----------

const NEWSLETTER_CATEGORY_LABELS = new Set([
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
]);
const NEWSLETTER_RX =
  /\b(newsletter|unsubscribe|disiscriviti|cancellati|promo|promozione|offerta|sconto|deal)\b/i;
const NOREPLY_RX = /^(no[-_.]?reply|noreply|newsletter|news|info|marketing)@/i;

export type EmailClassification = {
  category: string;
  is_newsletter: boolean;
  is_filtered: boolean;
  is_inbox_primary: boolean;
};

export function classifyMail(row: {
  label_ids?: string[] | null;
  detected_category?: string | null;
  from_email?: string | null;
  subject?: string | null;
  snippet?: string | null;
}): EmailClassification {
  const labels = Array.isArray(row.label_ids) ? row.label_ids : [];
  const upper = labels.map((l) => l.toUpperCase());
  const hasInbox = upper.includes("INBOX");
  const newsletterLabel = upper.find((l) => NEWSLETTER_CATEGORY_LABELS.has(l));
  const detected = (row.detected_category ?? "").toLowerCase();
  const heuristicNewsletter =
    NEWSLETTER_RX.test(`${row.subject ?? ""} ${row.snippet ?? ""}`) ||
    NOREPLY_RX.test((row.from_email ?? "").toLowerCase());
  const isNewsletter =
    Boolean(newsletterLabel) ||
    ["newsletter", "promotions", "promo", "updates", "social"].includes(detected) ||
    heuristicNewsletter;
  const isPrimary = hasInbox && !newsletterLabel && !isNewsletter;
  const isFiltered = !isPrimary;
  const category = newsletterLabel
    ? newsletterLabel.replace("CATEGORY_", "").toLowerCase()
    : isNewsletter
      ? "newsletter"
      : isPrimary
        ? "primary"
        : detected || "other";
  return {
    category,
    is_newsletter: isNewsletter,
    is_filtered: isFiltered,
    is_inbox_primary: isPrimary,
  };
}

function deriveLabelScope(rows: Array<{ label_ids?: string[] | null }>): string {
  if (!rows.length) return "unknown";
  let inboxOnly = 0;
  let newsletterOnly = 0;
  let mixed = 0;
  for (const r of rows) {
    const labels = (r.label_ids ?? []).map((l) => l.toUpperCase());
    const hasInbox = labels.includes("INBOX");
    const hasNewsletter = labels.some((l) => NEWSLETTER_CATEGORY_LABELS.has(l));
    if (hasInbox && !hasNewsletter) inboxOnly += 1;
    else if (!hasInbox && hasNewsletter) newsletterOnly += 1;
    else mixed += 1;
  }
  if (newsletterOnly === 0 && mixed === 0) return "inbox";
  if (inboxOnly === 0 && mixed === 0) return "newsletter";
  return "mixed";
}



// ---------- get_email_brief ----------

type EmailBriefItem = {
  local_id: string;
  selection_index: number;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  from_name: string | null;
  from_email: string | null;
  from_domain: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string | null;
  unread: boolean;
  importance_score: number;
  importance_level: string;
  importance_reason: string | null;
  project_guess: string | null;
  has_attachments: boolean;
  labels: string[];
};

function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : null;
}

function redactEmailForLog(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at < 1) return "[redacted]";
  return `${email[0]}***@${email.slice(at + 1)}`;
}

function mapEmailRow(r: Record<string, unknown>, idx: number): EmailBriefItem {
  const fromEmail = (r.from_email as string | null) ?? null;
  return {
    local_id: String(r.id),
    selection_index: idx + 1,
    gmail_message_id: String(r.gmail_message_id),
    gmail_thread_id: (r.gmail_thread_id as string | null) ?? null,
    from_name: (r.from_name as string | null) ?? null,
    from_email: fromEmail,
    from_domain: domainOf(fromEmail),
    subject: (r.subject as string | null) ?? null,
    snippet: ((r.snippet as string | null) ?? "").slice(0, 280) || null,
    received_at: (r.internal_date as string | null) ?? null,
    unread: Boolean(r.is_unread),
    importance_score: Number(r.importance_score ?? 0),
    importance_level: (r.importance_level as string | null) ?? "low",
    importance_reason: (r.importance_reason as string | null) ?? null,
    project_guess: (r.project_guess as string | null) ?? null,
    has_attachments: Boolean(r.has_attachments),
    labels: Array.isArray(r.label_ids) ? (r.label_ids as string[]) : [],
  };
}

const EMAIL_SELECT_COLS =
  "id,gmail_message_id,gmail_thread_id,subject,from_email,from_name,internal_date,importance_score,importance_level,importance_reason,project_guess,is_unread,has_attachments,snippet,label_ids";

export const getEmailBriefFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: unknown) =>
      (d ?? {}) as {
        brain_id?: string | null;
        date_range?: "today" | "7d" | "all";
        unread_only?: boolean;
        important_only?: boolean;
        limit?: number;
      },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const range = data.date_range ?? "today";
    const limit = Math.min(Math.max(data.limit ?? 10, 1), 25);
    const since =
      range === "today"
        ? new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
        : range === "7d"
          ? new Date(Date.now() - 7 * 86400000).toISOString()
          : null;

    const { data: connsRaw } = await supabase
      .from("gmail_connection_settings")
      .select("id,status,last_sync_at,updated_at")
      .order("updated_at", { ascending: false });
    const conns = (connsRaw ?? []) as Array<{
      id: string;
      status: string;
      last_sync_at: string | null;
    }>;
    const conn =
      conns.find((c) => c.status === "connected" || c.status === "active") ??
      null;
    if (!conn) {
      void logEvent(supabase, userId, "jack_email_brief_served", {
        connected: false,
        status: "not_connected",
        range,
      });
      return {
        ok: true,
        connected: false,
        status: "not_connected" as const,
        total_today: 0,
        unread_today: 0,
        important_today: 0,
        emails: [] as EmailBriefItem[],
        message: "Gmail non è collegato.",
      };
    }

    const { count: totalAll } = await supabase
      .from("gmail_message_map")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id);

    if ((totalAll ?? 0) === 0) {
      void logEvent(supabase, userId, "jack_email_brief_served", {
        connected: true,
        status: "connected_no_sync",
        range,
      });
      return {
        ok: true,
        connected: true,
        status: "connected_no_sync" as const,
        total_today: 0,
        unread_today: 0,
        important_today: 0,
        emails: [] as EmailBriefItem[],
        last_sync_at: conn.last_sync_at,
        message:
          "Gmail è collegato, ma non trovo email sincronizzate. Apri Gmail Connector e avvia la sync.",
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

    // List emails by date desc — "leggimi le mail di oggi" must return the
    // actual recent emails, not only the important ones.
    let listQ = supabase
      .from("gmail_message_map")
      .select(EMAIL_SELECT_COLS)
      .eq("connection_id", conn.id)
      .order("internal_date", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (since) listQ = listQ.gte("internal_date", since);
    if (data.unread_only) listQ = listQ.eq("is_unread", true);
    if (data.important_only === true) listQ = listQ.gte("importance_score", 55);
    if (data.brain_id) listQ = listQ.eq("brain_id", data.brain_id);

    const { data: listRows } = await listQ;
    const emails = ((listRows ?? []) as Array<Record<string, unknown>>).map(
      (r, idx) => mapEmailRow(r, idx),
    );

    const totalToday = t.count ?? 0;
    const status: "connected_with_today_emails" | "connected_no_today_emails" =
      emails.length > 0 || totalToday > 0
        ? "connected_with_today_emails"
        : "connected_no_today_emails";

    const metadataMissing =
      emails.length > 0 &&
      emails.every((e) => !e.subject && !e.from_email && !e.snippet);

    void logEvent(supabase, userId, "jack_email_brief_served", {
      connected: true,
      status,
      range,
      total_today: totalToday,
      unread_today: u.count ?? 0,
      important_today: i.count ?? 0,
      list_count: emails.length,
      metadata_missing: metadataMissing,
    });
    if (metadataMissing) {
      void logEvent(supabase, userId, "jack_email_metadata_missing", {
        range,
        list_count: emails.length,
      });
    }

    return {
      ok: true,
      connected: true,
      status,
      range,
      total_today: totalToday,
      unread_today: u.count ?? 0,
      important_today: i.count ?? 0,
      // legacy aliases
      total: totalToday,
      unread: u.count ?? 0,
      important: i.count ?? 0,
      last_sync_at: conn.last_sync_at,
      emails,
      top: emails.slice(0, 5),
      metadata_missing: metadataMissing,
      metadata_missing_hint: metadataMissing
        ? "Il sync Gmail attuale non sta persistendo subject/from/snippet. Apri Gmail Connector e rilancia la sync."
        : null,
      message:
        status === "connected_with_today_emails"
          ? `${totalToday} email nel range ${range}, ${u.count ?? 0} non lette, ${i.count ?? 0} importanti.`
          : "Gmail è collegato, ma non trovo email nel range richiesto.",
    };
  });

// ---------- search_emails ----------

export const searchEmailsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: unknown) =>
      (d ?? {}) as {
        query?: string;
        date_range?: "today" | "week" | "all";
        limit?: number;
        brain_id?: string | null;
      },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const q = (data.query ?? "").trim();
    if (q.length < 2) {
      return { ok: false, error: "query_too_short", emails: [] as EmailBriefItem[] };
    }
    const limit = Math.min(Math.max(data.limit ?? 10, 1), 25);
    const range = data.date_range ?? "week";
    const since =
      range === "today"
        ? new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
        : range === "week"
          ? new Date(Date.now() - 7 * 86400000).toISOString()
          : null;

    const { data: connsRaw } = await supabase
      .from("gmail_connection_settings")
      .select("id,status,last_sync_at,updated_at")
      .order("updated_at", { ascending: false });
    const conns = (connsRaw ?? []) as Array<{
      id: string;
      status: string;
      last_sync_at: string | null;
    }>;
    const conn =
      conns.find((c) => c.status === "connected" || c.status === "active") ??
      null;
    if (!conn) {
      return {
        ok: true,
        connected: false,
        status: "not_connected" as const,
        emails: [] as EmailBriefItem[],
        message: "Gmail non è collegato.",
      };
    }

    const safe = q.replace(/[%_\\]/g, "\\$&");
    const pattern = `%${safe}%`;
    let query = supabase
      .from("gmail_message_map")
      .select(EMAIL_SELECT_COLS)
      .eq("connection_id", conn.id)
      .or(
        `subject.ilike.${pattern},from_email.ilike.${pattern},from_name.ilike.${pattern},snippet.ilike.${pattern}`,
      )
      .order("internal_date", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (since) query = query.gte("internal_date", since);
    if (data.brain_id) query = query.eq("brain_id", data.brain_id);

    const { data: rows, error } = await query;
    if (error) {
      return { ok: false, error: "search_failed", emails: [] as EmailBriefItem[] };
    }
    const emails = ((rows ?? []) as Array<Record<string, unknown>>).map(
      (r, idx) => mapEmailRow(r, idx),
    );

    void logEvent(supabase, userId, "jack_email_search_served", {
      query_length: q.length,
      range,
      result_count: emails.length,
    });

    return {
      ok: true,
      connected: true,
      status: "connected_with_today_emails" as const,
      query: q,
      range,
      emails,
      match_count: emails.length,
    };
  });

// ---------- get_email_detail ----------

export const getEmailDetailFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: unknown) =>
      (d ?? {}) as {
        local_id?: string;
        gmail_message_id?: string;
      },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!data.local_id && !data.gmail_message_id) {
      return { ok: false, error: "missing_identifier" };
    }
    let row: GmailMessageRowDb | null = null;
    if (data.gmail_message_id) {
      const { data: byMsg } = await supabase
        .from("gmail_message_map")
        .select("*")
        .eq("gmail_message_id", data.gmail_message_id)
        .maybeSingle();
      row = (byMsg as GmailMessageRowDb | null) ?? null;
    }
    if (!row && data.local_id) {
      const { data: byId } = await supabase
        .from("gmail_message_map")
        .select("*")
        .eq("id", data.local_id)
        .maybeSingle();
      row = (byId as GmailMessageRowDb | null) ?? null;
    }
    if (!row) {
      return { ok: false, error: "email_not_found" };
    }

    const summary = buildDeterministicSummary(row);
    const hasFullBody = Boolean(row.body_preview && row.body_preview.length > 0);
    const safeBodyPreview = hasFullBody
      ? (row.body_preview ?? "").slice(0, 1200)
      : null;

    void logEvent(supabase, userId, "jack_email_detail_served", {
      message_id_hash: hash(row.gmail_message_id),
      has_body_preview: hasFullBody,
      importance_level: summary.importance_level,
    });

    return {
      ok: true,
      local_id: row.id,
      gmail_message_id: row.gmail_message_id,
      gmail_thread_id: row.gmail_thread_id,
      subject: row.subject ?? null,
      from_name: row.from_name ?? null,
      from_email: row.from_email ?? null,
      from_domain: domainOf(row.from_email ?? null),
      received_at: row.internal_date ?? null,
      unread: Boolean(row.is_unread),
      has_attachments: Boolean(row.has_attachments),
      labels: Array.isArray(row.label_ids) ? row.label_ids : [],
      snippet: row.snippet ?? null,
      safe_body_preview: safeBodyPreview,
      summary_text: summary.short,
      key_points: summary.key_points,
      requested: summary.requested,
      dates_mentioned: summary.dates_mentioned,
      importance_score: row.importance_score ?? 0,
      importance_level: summary.importance_level,
      importance_reason: summary.importance_reason,
      partial_summary: !hasFullBody,
      partial_summary_reason: hasFullBody
        ? null
        : "Body completo non disponibile: riepilogo basato su subject + snippet.",
      from_email_redacted: redactEmailForLog(row.from_email ?? null),
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
