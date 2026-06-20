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
// Strong newsletter heuristic: must contain explicit marketing/unsubscribe
// vocabulary, not just an occurrence of "offerta" inside a personal message.
const NEWSLETTER_STRONG_RX =
  /\b(unsubscribe|disiscriviti|cancellati|newsletter|digest|marketing|promo(?:zione)?|coupon)\b/i;
const NOREPLY_RX = /^(no[-_.]?reply|noreply|newsletter|news|marketing|mailer|notification|notifiche)@/i;
const PERSONAL_DOMAIN_RX =
  /@(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|protonmail|pm|libero|tin|alice|fastwebnet|aruba|virgilio)\./i;

const NEWSLETTER_DETECTED_CATEGORIES = new Set([
  "newsletter",
  "promotions",
  "promo",
  "updates",
  "social",
  "forums",
  "marketing",
]);

export type EmailClassification = {
  category: string;
  is_newsletter: boolean;
  is_filtered: boolean;
  is_inbox_primary: boolean;
  is_unknown_personal: boolean;
};

export function classifyMail(row: {
  label_ids?: string[] | null;
  detected_category?: string | null;
  from_email?: string | null;
  subject?: string | null;
  snippet?: string | null;
}): EmailClassification {
  const labels = Array.isArray(row.label_ids) ? row.label_ids : [];
  const upper = labels.map((l) => String(l).toUpperCase());
  const hasInbox = upper.includes("INBOX");
  const newsletterLabel = upper.find((l) => NEWSLETTER_CATEGORY_LABELS.has(l));
  const detected = (row.detected_category ?? "").toLowerCase();
  const fromLc = (row.from_email ?? "").toLowerCase();
  const text = `${row.subject ?? ""} ${row.snippet ?? ""}`;

  const strongHeuristic =
    NEWSLETTER_STRONG_RX.test(text) || NOREPLY_RX.test(fromLc);
  const detectedNewsletter = NEWSLETTER_DETECTED_CATEGORIES.has(detected);

  // Newsletter ONLY when there's a strong signal. Missing labels alone never
  // imply newsletter — otherwise personal mail (Federico → fedestic01@gmail.com)
  // would get hidden in the filtered bucket.
  const isNewsletter =
    Boolean(newsletterLabel) || detectedNewsletter || strongHeuristic;

  const senderLooksPersonal =
    !!fromLc && PERSONAL_DOMAIN_RX.test(fromLc) && !NOREPLY_RX.test(fromLc);

  const labelsMissing = upper.length === 0;
  // Unknown when we can't decide: no INBOX label, not classified as newsletter,
  // and either labels are missing or sender looks personal.
  const isUnknownPersonal =
    !isNewsletter && !hasInbox && (labelsMissing || senderLooksPersonal);

  const isPrimary = !isNewsletter && (hasInbox || senderLooksPersonal);
  // Filtered = anything we'd hide from the primary inbox view.
  const isFiltered = isNewsletter || (!isPrimary && !isUnknownPersonal);

  const category = newsletterLabel
    ? newsletterLabel.replace("CATEGORY_", "").toLowerCase()
    : isNewsletter
      ? "newsletter"
      : isPrimary
        ? "primary"
        : isUnknownPersonal
          ? "unknown_personal"
          : detected || "other";

  return {
    category,
    is_newsletter: isNewsletter,
    is_filtered: isFiltered,
    is_inbox_primary: isPrimary,
    is_unknown_personal: isUnknownPersonal,
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
  category: string;
  is_newsletter: boolean;
  is_filtered: boolean;
  is_unknown_personal: boolean;
  is_inbox_primary: boolean;
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

function previewText(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const compact = String(text).replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

type SupabaseReadClient = { from: (table: string) => any };

type GmailConnectionCandidate = {
  id: string;
  status: string;
  google_email: string | null;
  last_sync_at: string | null;
  updated_at: string | null;
  messages_today_count: number;
  latest_message_at: string | null;
};

type ConnectionCandidateDiagnostic = {
  id_hash: string;
  status: string;
  email_preview?: string | null;
  last_sync_at?: string | null;
  messages_today_count: number;
};

type DebugTodayRawEntry = {
  local_id: string;
  gmail_message_id_hash?: string;
  from_preview?: string | null;
  from_domain?: string | null;
  subject_preview?: string | null;
  snippet_preview?: string | null;
  internal_date?: string | null;
  label_ids?: string[];
  detected_category?: string | null;
  is_unread?: boolean;
  has_attachments?: boolean;
  classified_as?: string;
  included_in_buckets?: string[];
};

async function getRawTodayMessagesForDebug(
  supabase: SupabaseReadClient,
  opts: {
    connectionId: string;
    startIso: string;
    endIso: string;
    limit?: number;
  },
): Promise<{ rows: Array<Record<string, unknown>>; rawCount: number }> {
  const { data, count } = await supabase
    .from("gmail_message_map")
    .select(EMAIL_SELECT_COLS, { count: "exact" })
    .eq("connection_id", opts.connectionId)
    .gte("internal_date", opts.startIso)
    .lt("internal_date", opts.endIso)
    .order("internal_date", { ascending: false, nullsFirst: false })
    .limit(opts.limit ?? 200);

  return {
    rows: (data ?? []) as Array<Record<string, unknown>>,
    rawCount: count ?? ((data ?? []) as unknown[]).length,
  };
}

function syncMayBeStale(input: {
  lastSyncAt: string | null;
  partialSync: boolean;
  rawTodayCount: number;
  connected: boolean;
}): boolean {
  if (!input.connected) return false;
  if (!input.lastSyncAt) return true;
  const lastSyncMs = new Date(input.lastSyncAt).getTime();
  if (!Number.isFinite(lastSyncMs) || lastSyncMs <= 0) return true;
  if (Date.now() - lastSyncMs > 10 * 60 * 1000) return true;
  if (input.partialSync) return true;
  if (input.rawTodayCount === 0) return true;
  return false;
}

async function buildConnectionCandidates(
  supabase: SupabaseReadClient,
  conns: Array<{
    id: string;
    status: string;
    google_email?: string | null;
    last_sync_at?: string | null;
    updated_at?: string | null;
  }>,
  todayStart: string,
  todayEnd: string,
): Promise<GmailConnectionCandidate[]> {
  return await Promise.all(
    conns.map(async (conn) => {
      const [{ count }, latestRes] = await Promise.all([
        supabase
          .from("gmail_message_map")
          .select("id", { count: "exact", head: true })
          .eq("connection_id", conn.id)
          .gte("internal_date", todayStart)
          .lt("internal_date", todayEnd),
        supabase
          .from("gmail_message_map")
          .select("internal_date")
          .eq("connection_id", conn.id)
          .order("internal_date", { ascending: false, nullsFirst: false })
          .limit(1),
      ]);
      const latestRow = ((latestRes.data ?? []) as Array<{ internal_date?: string | null }>)[0];
      return {
        id: conn.id,
        status: conn.status,
        google_email: conn.google_email ?? null,
        last_sync_at: conn.last_sync_at ?? null,
        updated_at: conn.updated_at ?? null,
        messages_today_count: count ?? 0,
        latest_message_at: latestRow?.internal_date ?? null,
      };
    }),
  );
}

function pickActiveConnection(
  candidates: GmailConnectionCandidate[],
): GmailConnectionCandidate | null {
  const active = candidates.filter(
    (c) => c.status === "connected" || c.status === "active",
  );
  active.sort((a, b) => {
    const aDate = new Date(
      a.latest_message_at ?? a.last_sync_at ?? a.updated_at ?? 0,
    ).getTime();
    const bDate = new Date(
      b.latest_message_at ?? b.last_sync_at ?? b.updated_at ?? 0,
    ).getTime();
    if (b.messages_today_count !== a.messages_today_count) {
      return b.messages_today_count - a.messages_today_count;
    }
    return (Number.isFinite(bDate) ? bDate : 0) - (Number.isFinite(aDate) ? aDate : 0);
  });
  return active[0] ?? null;
}

function mapEmailRow(r: Record<string, unknown>, idx: number): EmailBriefItem {
  const fromEmail = (r.from_email as string | null) ?? null;
  const labels = Array.isArray(r.label_ids) ? (r.label_ids as string[]) : [];
  const subject = (r.subject as string | null) ?? null;
  const snippet = ((r.snippet as string | null) ?? "").slice(0, 280) || null;
  const cls = classifyMail({
    label_ids: labels,
    detected_category: (r.detected_category as string | null) ?? null,
    from_email: fromEmail,
    subject,
    snippet,
  });
  return {
    local_id: String(r.id),
    selection_index: idx + 1,
    gmail_message_id: String(r.gmail_message_id),
    gmail_thread_id: (r.gmail_thread_id as string | null) ?? null,
    from_name: (r.from_name as string | null) ?? null,
    from_email: fromEmail,
    from_domain: domainOf(fromEmail),
    subject,
    snippet,
    received_at: (r.internal_date as string | null) ?? null,
    unread: Boolean(r.is_unread),
    importance_score: Number(r.importance_score ?? 0),
    importance_level: (r.importance_level as string | null) ?? "low",
    importance_reason: (r.importance_reason as string | null) ?? null,
    project_guess: (r.project_guess as string | null) ?? null,
    has_attachments: Boolean(r.has_attachments),
    labels,
    category: cls.category,
    is_newsletter: cls.is_newsletter,
    is_filtered: cls.is_filtered,
    is_unknown_personal: cls.is_unknown_personal,
    is_inbox_primary: cls.is_inbox_primary,
  };
}

const EMAIL_SELECT_COLS =
  "id,gmail_message_id,gmail_thread_id,subject,from_email,from_name,internal_date,importance_score,importance_level,importance_reason,project_guess,is_unread,has_attachments,snippet,body_preview,label_ids,detected_category";


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
    const todayStart = romeStartOfDayIso(0);
    const todayEnd = romeStartOfDayIso(1);
    const yesterdayStart = romeStartOfDayIso(-1);
    const since =
      range === "today"
        ? todayStart
        : range === "7d"
          ? romeStartOfDayIso(-6)
          : null;

    const { data: connsRaw } = await supabase
      .from("gmail_connection_settings")
      .select("id,status,google_email,last_sync_at,updated_at")
      .eq("user_id", userId)
      .order("last_sync_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false });
    const conns = (connsRaw ?? []) as Array<{
      id: string;
      status: string;
      google_email: string | null;
      last_sync_at: string | null;
      updated_at: string | null;
    }>;
    const connectionCandidates = await buildConnectionCandidates(
      supabase as SupabaseReadClient,
      conns,
      todayStart,
      todayEnd,
    );
    const connectionCandidateDiagnostics: ConnectionCandidateDiagnostic[] =
      connectionCandidates.map((c) => ({
        id_hash: hash(c.id),
        status: c.status,
        email_preview: redactEmailForLog(c.google_email),
        last_sync_at: c.last_sync_at,
        messages_today_count: c.messages_today_count,
      }));
    const conn = pickActiveConnection(connectionCandidates);
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
        timezone: ROME_TZ,
        last_sync_at: null,
        counts: emptyCounts(),
        inbox_today: [] as EmailBriefItem[],
        newsletters_today: [] as EmailBriefItem[],
        unread_previous: [] as EmailBriefItem[],
        newsletters_previous: [] as EmailBriefItem[],
        all_today: [] as EmailBriefItem[],
        unknown_today: [] as EmailBriefItem[],
        sync_freshness: {
          last_sync_at: null,
          latest_message_seen_at: null,
          possibly_stale: true,
        },
        debug_today_raw: [] as DebugTodayRawEntry[],
        diagnostics: {
          active_connection_id_hash: "",
          active_connection_email_preview: null,
          last_sync_at: null,
          today_range_rome: { start: todayStart, end: todayEnd },
          raw_today_count: 0,
          raw_today_unread_count: 0,
          raw_today_newsletter_count: 0,
          raw_today_inbox_candidate_count: 0,
          all_today_count: 0,
          inbox_today_count: 0,
          newsletters_today_count: 0,
          unknown_today_count: 0,
          missing_expected_mail_possible: true,
          sync_may_be_stale: true,
        },
        connection_candidates: connectionCandidateDiagnostics,
        label_scope: "unknown" as const,
        metadata_missing: false,
        partial_sync: false,
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
        timezone: ROME_TZ,
        last_sync_at: conn.last_sync_at,
        counts: emptyCounts(),
        inbox_today: [] as EmailBriefItem[],
        newsletters_today: [] as EmailBriefItem[],
        unread_previous: [] as EmailBriefItem[],
        newsletters_previous: [] as EmailBriefItem[],
        all_today: [] as EmailBriefItem[],
        unknown_today: [] as EmailBriefItem[],
        sync_freshness: {
          last_sync_at: conn.last_sync_at,
          latest_message_seen_at: null,
          possibly_stale: true,
        },
        debug_today_raw: [] as DebugTodayRawEntry[],
        label_scope: "unknown" as const,
        metadata_missing: false,
        partial_sync: true,
        total_today: 0,
        unread_today: 0,
        important_today: 0,
        emails: [] as EmailBriefItem[],
        message:
          "Gmail è collegato, ma non trovo email sincronizzate. Apri Gmail Connector e avvia la sync.",
      };
    }

    let todayQ = supabase
      .from("gmail_message_map")
      .select(EMAIL_SELECT_COLS)
      .eq("connection_id", conn.id)
      .gte("internal_date", todayStart)
      .order("internal_date", { ascending: false, nullsFirst: false })
      .limit(50);
    let yesterdayQ = supabase
      .from("gmail_message_map")
      .select(EMAIL_SELECT_COLS)
      .eq("connection_id", conn.id)
      .gte("internal_date", yesterdayStart)
      .lt("internal_date", todayStart)
      .order("internal_date", { ascending: false, nullsFirst: false })
      .limit(50);
    let prevUnreadQ = supabase
      .from("gmail_message_map")
      .select(EMAIL_SELECT_COLS)
      .eq("connection_id", conn.id)
      .lt("internal_date", todayStart)
      .eq("is_unread", true)
      .order("internal_date", { ascending: false, nullsFirst: false })
      .limit(25);
    if (data.brain_id) {
      todayQ = todayQ.eq("brain_id", data.brain_id);
      yesterdayQ = yesterdayQ.eq("brain_id", data.brain_id);
      prevUnreadQ = prevUnreadQ.eq("brain_id", data.brain_id);
    }

    const [todayRes, yesterdayRes, prevUnreadRes, totalUnreadRes, unreadTodayRes] =
      await Promise.all([
        todayQ,
        yesterdayQ,
        prevUnreadQ,
        supabase
          .from("gmail_message_map")
          .select("id", { count: "exact", head: true })
          .eq("connection_id", conn.id)
          .eq("is_unread", true),
        supabase
          .from("gmail_message_map")
          .select("id", { count: "exact", head: true })
          .eq("connection_id", conn.id)
          .eq("is_unread", true)
          .gte("internal_date", todayStart),
      ]);

    const todayRows = (todayRes.data ?? []) as Array<Record<string, unknown>>;
    const yesterdayRows = (yesterdayRes.data ?? []) as Array<Record<string, unknown>>;
    const prevUnreadRows = (prevUnreadRes.data ?? []) as Array<Record<string, unknown>>;

    const todayEmails = todayRows.map((r, idx) => mapEmailRow(r, idx));
    const yesterdayEmails = yesterdayRows.map((r, idx) => mapEmailRow(r, idx));
    const prevUnreadEmails = prevUnreadRows.map((r, idx) => mapEmailRow(r, idx));

    // v3.22.1 — anti-disappearance bucketing:
    // Every today email lands in `all_today` no matter what; primary,
    // newsletter, and unknown buckets are derived from it. A mail can NEVER
    // exist only in `newsletters_today` while being absent from `all_today`.
    const allToday = todayEmails;
    const inboxToday = todayEmails.filter(
      (e) => e.is_inbox_primary === true && !e.is_newsletter,
    );
    const newslettersToday = todayEmails.filter((e) => e.is_newsletter);
    const unknownToday = todayEmails.filter(
      (e) => !e.is_newsletter && !e.is_inbox_primary,
    );
    const unreadPreviousList = prevUnreadEmails.filter((e) => !e.is_newsletter);
    const newslettersPreviousList = yesterdayEmails.filter((e) => e.is_newsletter);

    const totalUnread = totalUnreadRes.count ?? 0;
    const unreadToday = unreadTodayRes.count ?? 0;
    const previousUnread = Math.max(0, totalUnread - unreadToday);

    const counts = {
      today_total_all: allToday.length,
      today_inbox_total: inboxToday.length,
      today_inbox_unread: inboxToday.filter((e) => e.unread).length,
      today_newsletter_total: newslettersToday.length,
      today_newsletter_unread: newslettersToday.filter((e) => e.unread).length,
      today_unknown_total: unknownToday.length,
      today_unknown_unread: unknownToday.filter((e) => e.unread).length,
      previous_unread_total: previousUnread,
      total_unread: totalUnread,
      newsletter_yesterday_total: newslettersPreviousList.length,
    };

    const status: "connected_with_today_emails" | "connected_no_today_emails" =
      allToday.length > 0
        ? "connected_with_today_emails"
        : "connected_no_today_emails";

    const metadataMissing =
      allToday.length > 0 &&
      allToday.every((e) => !e.subject && !e.from_email && !e.snippet);

    const labelScope = deriveLabelScope([
      ...todayRows,
      ...yesterdayRows,
      ...prevUnreadRows,
    ]);

    const lastSyncAt = conn.last_sync_at;
    const latestMessageSeenAt = allToday[0]?.received_at ?? null;
    const lastSyncMs = lastSyncAt ? new Date(lastSyncAt).getTime() : 0;
    const latestMsgMs = latestMessageSeenAt
      ? new Date(latestMessageSeenAt).getTime()
      : 0;
    const partialSync =
      !lastSyncAt ||
      Date.now() - lastSyncMs > 6 * 3600 * 1000;
    const possiblyStale =
      partialSync ||
      (latestMsgMs > 0 && lastSyncMs > 0 && lastSyncMs < latestMsgMs);
    const syncFreshness = {
      last_sync_at: lastSyncAt,
      latest_message_seen_at: latestMessageSeenAt,
      possibly_stale: possiblyStale,
    };

    // Sanitized debug for today's raw rows. No body, no full email address.
    const debugTodayRaw = todayEmails.map((e) => ({
      local_id: e.local_id,
      from_domain: e.from_domain,
      from_preview: redactEmailForLog(e.from_email),
      subject_preview: e.subject ? e.subject.slice(0, 80) : null,
      snippet_preview: e.snippet ? e.snippet.slice(0, 120) : null,
      received_at: e.received_at,
      label_ids: e.labels,
      detected_category: e.category,
      is_unread: e.unread,
      classified_as: e.is_newsletter
        ? "newsletter"
        : e.is_unknown_personal
          ? "unknown_personal"
          : "inbox_primary",
      is_newsletter: e.is_newsletter,
      is_filtered: e.is_filtered,
    }));

    void logEvent(supabase, userId, "jack_email_brief_served", {
      connected: true,
      status,
      range,
      timezone: ROME_TZ,
      counts,
      label_scope: labelScope,
      metadata_missing: metadataMissing,
      partial_sync: partialSync,
    });
    void logEvent(supabase, userId, "jack_email_today_raw_bucketed", {
      total_all: counts.today_total_all,
      inbox: counts.today_inbox_total,
      newsletter: counts.today_newsletter_total,
      unknown: counts.today_unknown_total,
    });
    if (counts.today_unknown_total > 0) {
      void logEvent(supabase, userId, "jack_email_unknown_today_detected", {
        unknown_count: counts.today_unknown_total,
        sample_domains: Array.from(
          new Set(unknownToday.map((e) => e.from_domain).filter(Boolean)),
        ).slice(0, 5),
      });
    }
    // If labels were missing/empty and we recovered a mail into all_today
    // that previously would have been filtered out, emit a recovery event.
    const recovered = todayEmails.filter(
      (e) => e.labels.length === 0 && !e.is_newsletter,
    );
    if (recovered.length > 0) {
      void logEvent(supabase, userId, "jack_email_inbox_missing_recovered", {
        count: recovered.length,
      });
    }
    if (metadataMissing) {
      void logEvent(supabase, userId, "jack_email_metadata_missing", {
        range,
        list_count: allToday.length,
      });
    }
    if (partialSync) {
      void logEvent(supabase, userId, "jack_gmail_partial_sync_detected", {
        last_sync_at: lastSyncAt,
      });
    }
    if (possiblyStale && !partialSync) {
      void logEvent(supabase, userId, "jack_email_possible_sync_stale", {
        last_sync_at: lastSyncAt,
        latest_message_seen_at: latestMessageSeenAt,
      });
    }
    void logEvent(supabase, userId, "jack_gmail_count_reconciled", {
      timezone: ROME_TZ,
      today_inbox: counts.today_inbox_total,
      today_newsletter: counts.today_newsletter_total,
      today_unknown: counts.today_unknown_total,
      total_unread: counts.total_unread,
      previous_unread: counts.previous_unread_total,
    });

    // Legacy flat `emails` list kept for backward compatibility consumers.
    const baseFlat = since
      ? allToday
      : [...allToday, ...yesterdayEmails].slice(0, limit);
    let flat = baseFlat;
    if (data.unread_only) flat = flat.filter((e) => e.unread);
    if (data.important_only === true) flat = flat.filter((e) => e.importance_score >= 55);
    flat = flat.slice(0, limit);

    return {
      ok: true,
      connected: true,
      status,
      range,
      timezone: ROME_TZ,
      last_sync_at: lastSyncAt,
      counts,
      inbox_today: inboxToday,
      newsletters_today: newslettersToday,
      unread_previous: unreadPreviousList,
      newsletters_previous: newslettersPreviousList,
      all_today: allToday,
      unknown_today: unknownToday,
      sync_freshness: syncFreshness,
      debug_today_raw: debugTodayRaw,
      label_scope: labelScope,
      metadata_missing: metadataMissing,
      metadata_missing_hint: metadataMissing
        ? "Il sync Gmail attuale non sta persistendo subject/from/snippet. Apri Gmail Connector e rilancia la sync."
        : null,
      partial_sync: partialSync,
      // legacy aliases
      total_today: counts.today_total_all,
      unread_today:
        counts.today_inbox_unread +
        counts.today_newsletter_unread +
        counts.today_unknown_unread,
      important_today: allToday.filter((e) => e.importance_score >= 55).length,
      total: counts.today_total_all,
      unread: counts.total_unread,
      important: allToday.filter((e) => e.importance_score >= 55).length,
      emails: flat,
      top: flat.slice(0, 5),
      message:
        status === "connected_with_today_emails"
          ? `Oggi ${counts.today_inbox_total} mail normali, ${counts.today_newsletter_total} newsletter${counts.today_unknown_total > 0 ? `, ${counts.today_unknown_total} non classificate` : ""}; non lette totali ${counts.total_unread} (${counts.today_inbox_unread + counts.today_newsletter_unread + counts.today_unknown_unread} oggi, ${counts.previous_unread_total} precedenti).`
          : "Gmail è collegato, ma non trovo email di oggi.",
    };
  });

function emptyCounts() {
  return {
    today_total_all: 0,
    today_inbox_total: 0,
    today_inbox_unread: 0,
    today_newsletter_total: 0,
    today_newsletter_unread: 0,
    today_unknown_total: 0,
    today_unknown_unread: 0,
    previous_unread_total: 0,
    total_unread: 0,
    newsletter_yesterday_total: 0,
  };
}


// ---------- search_emails ----------

export const searchEmailsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: unknown) =>
      (d ?? {}) as {
        query?: string;
        date_range?: "today" | "yesterday" | "week" | "all";
        include_newsletters?: boolean;
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
    const includeNewsletters = data.include_newsletters !== false;
    const todayStart = romeStartOfDayIso(0);
    const yesterdayStart = romeStartOfDayIso(-1);
    const weekStart = romeStartOfDayIso(-6);
    const since =
      range === "today"
        ? todayStart
        : range === "yesterday"
          ? yesterdayStart
          : range === "week"
            ? weekStart
            : null;
    const until = range === "yesterday" ? todayStart : null;

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
      .limit(limit * 2); // fetch extra to allow filtering
    if (since) query = query.gte("internal_date", since);
    if (until) query = query.lt("internal_date", until);
    if (data.brain_id) query = query.eq("brain_id", data.brain_id);

    const { data: rows, error } = await query;
    if (error) {
      return { ok: false, error: "search_failed", emails: [] as EmailBriefItem[] };
    }
    let emails = ((rows ?? []) as Array<Record<string, unknown>>).map(
      (r, idx) => mapEmailRow(r, idx),
    );
    if (!includeNewsletters) emails = emails.filter((e) => !e.is_newsletter);
    emails = emails.slice(0, limit).map((e, idx) => ({ ...e, selection_index: idx + 1 }));

    void logEvent(supabase, userId, "jack_email_search_served", {
      query_length: q.length,
      range,
      include_newsletters: includeNewsletters,
      result_count: emails.length,
    });
    void logEvent(
      supabase,
      userId,
      emails.length > 0
        ? "jack_email_followup_resolved"
        : "jack_email_followup_unresolved",
      { range, result_count: emails.length },
    );

    return {
      ok: true,
      connected: true,
      status: "connected_with_today_emails" as const,
      query: q,
      range,
      include_newsletters: includeNewsletters,
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
      category: classifyMail(row).category,
      is_newsletter: classifyMail(row).is_newsletter,
      is_filtered: classifyMail(row).is_filtered,
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
