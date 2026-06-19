// ============================================================
// Brain Hub v3.22 — Gmail Read-Only Intelligence (client helpers)
// ============================================================
// Read-only operations. Heuristic importance classifier + helpers
// for listing important emails and shaping summary previews.
// No body fetch happens here; data is read from the existing
// `gmail_message_map` table populated by the Gmail Connector sync.
// ============================================================

import { supabase } from "@/integrations/supabase/client";
import type { GmailMessageRow } from "@/lib/gmail-connector";

export type ImportanceLevel = "low" | "medium" | "high";

export type ImportanceResult = {
  score: number; // 0..100
  level: ImportanceLevel;
  reason: string;
  project_guess: string | null;
  suggested_action_type:
    | "email_review"
    | "email_followup"
    | "email_reply_draft_internal";
};

const RX_URGENT =
  /\b(urgente|urgent|scadenza|entro\s+oggi|asap|overdue|problema|errore|critical|importante)\b/i;
const RX_REQUEST =
  /\b(richiesta|preventivo|contratto|pagamento|fattura|documento|appuntamento|conferma|conferm[ao]|disponibilit[aà])\b/i;
const RX_LEGAL =
  /\b(notaio|commercialista|avvocato|studio\s+legale|atto|rogito|compromesso)\b/i;
const RX_RE_ESTATE =
  /\b(idealista|immobiliare|immobile|capannone|villa|appartamento|sopralluogo|visita)\b/i;
const RX_NEWSLETTER =
  /\b(newsletter|unsubscribe|promo|promozione|offerta|sconto|social\s+update)\b/i;
const RX_NOREPLY = /^(no[-_.]?reply|noreply|do[-_.]?not[-_.]?reply)@/i;

const PROJECT_HINTS: { name: string; rx: RegExp }[] = [
  { name: "Brain Hub", rx: /\bbrain\s*hub\b/i },
  { name: "Furia Immobiliare", rx: /\bfuria|furia\s*immobiliare\b/i },
  { name: "Sica Industrial Radar", rx: /\bsica|industrial\s*radar\b/i },
  { name: "Pupillo", rx: /\bpupillo\b/i },
  { name: "Studio Nikla", rx: /\bnikla\b/i },
  { name: "Retail AI", rx: /\bretail\s*ai\b/i },
];

function guessProject(text: string): string | null {
  for (const p of PROJECT_HINTS) if (p.rx.test(text)) return p.name;
  return null;
}

export function classifyEmailImportance(input: {
  subject: string | null;
  snippet: string | null;
  body_preview?: string | null;
  from_email: string | null;
  from_name?: string | null;
  to_emails?: string[] | null;
  is_unread?: boolean;
  has_attachments?: boolean;
  label_ids?: string[] | null;
}): ImportanceResult {
  const subject = (input.subject ?? "").toLowerCase();
  const snippet = (input.snippet ?? "").toLowerCase();
  const body = (input.body_preview ?? "").toLowerCase();
  const text = `${subject}\n${snippet}\n${body}`;
  const from = (input.from_email ?? "").toLowerCase();
  const labels = (input.label_ids ?? []).map((l) => l.toLowerCase());

  let score = 0;
  const reasons: string[] = [];

  if (input.is_unread) {
    score += 10;
    reasons.push("non letta");
  }
  if (RX_URGENT.test(text)) {
    score += 35;
    reasons.push("parole d'urgenza");
  }
  if (RX_REQUEST.test(text)) {
    score += 20;
    reasons.push("richiesta/conferma");
  }
  if (RX_LEGAL.test(text)) {
    score += 15;
    reasons.push("contesto legale/fiscale");
  }
  if (RX_RE_ESTATE.test(text)) {
    score += 15;
    reasons.push("contesto immobiliare");
  }
  if (input.has_attachments) {
    score += 5;
    reasons.push("allegati");
  }
  if (labels.includes("important")) {
    score += 10;
    reasons.push("etichetta IMPORTANT");
  }
  if (labels.includes("category_promotions")) {
    score -= 25;
    reasons.push("promozioni");
  }
  if (labels.includes("category_social")) {
    score -= 20;
    reasons.push("social");
  }
  if (labels.includes("category_updates")) {
    score -= 10;
    reasons.push("updates");
  }
  if (RX_NEWSLETTER.test(text)) {
    score -= 20;
    reasons.push("newsletter");
  }
  if (RX_NOREPLY.test(from)) {
    score -= 25;
    reasons.push("mittente noreply");
  }

  score = Math.max(0, Math.min(100, score));

  const level: ImportanceLevel =
    score >= 55 ? "high" : score >= 30 ? "medium" : "low";

  const project_guess = guessProject(text);
  const suggested_action_type =
    level === "high"
      ? "email_followup"
      : level === "medium"
        ? "email_reply_draft_internal"
        : "email_review";

  return {
    score,
    level,
    reason: reasons.length ? reasons.join(", ") : "nessun segnale",
    project_guess,
    suggested_action_type,
  };
}

// ---------- Read helpers ----------

export type ImportantEmail = {
  id: string;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  subject: string | null;
  from_email: string | null;
  from_name: string | null;
  internal_date: string | null;
  importance_score: number;
  importance_level: ImportanceLevel;
  importance_reason: string | null;
  project_guess: string | null;
  is_unread: boolean;
  has_attachments: boolean;
  snippet: string | null;
};

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString();
}

/**
 * Returns rows ordered by importance_score (DESC). If rows have no
 * computed importance yet, the caller can run `recomputeImportance`.
 */
export async function listImportantEmails(opts: {
  brainId?: string | null;
  range?: "today" | "7d" | "all";
  project?: string | null;
  limit?: number;
  minScore?: number;
}): Promise<ImportantEmail[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const minScore = opts.minScore ?? 30;

  let q = supabase
    .from("gmail_message_map")
    .select(
      "id,gmail_message_id,gmail_thread_id,subject,from_email,from_name,internal_date,importance_score,importance_level,importance_reason,project_guess,is_unread,has_attachments,snippet",
    )
    .gte("importance_score", minScore)
    .order("importance_score", { ascending: false })
    .order("internal_date", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (opts.brainId) q = q.eq("brain_id", opts.brainId);
  if (opts.range === "today") q = q.gte("internal_date", startOfTodayIso());
  else if (opts.range === "7d") q = q.gte("internal_date", isoDaysAgo(7));
  if (opts.project) q = q.eq("project_guess", opts.project);

  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    gmail_message_id: String(r.gmail_message_id),
    gmail_thread_id: (r.gmail_thread_id as string | null) ?? null,
    subject: (r.subject as string | null) ?? null,
    from_email: (r.from_email as string | null) ?? null,
    from_name: (r.from_name as string | null) ?? null,
    internal_date: (r.internal_date as string | null) ?? null,
    importance_score: Number(r.importance_score ?? 0),
    importance_level: ((r.importance_level as ImportanceLevel | null) ??
      "low") as ImportanceLevel,
    importance_reason: (r.importance_reason as string | null) ?? null,
    project_guess: (r.project_guess as string | null) ?? null,
    is_unread: Boolean(r.is_unread),
    has_attachments: Boolean(r.has_attachments),
    snippet: (r.snippet as string | null) ?? null,
  }));
}

/**
 * Recompute importance for messages that still have score=0 and were synced
 * by the existing Gmail Connector. Limited batch, idempotent.
 */
export async function recomputeImportance(opts: {
  brainId?: string | null;
  limit?: number;
}): Promise<{ updated: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);

  let q = supabase
    .from("gmail_message_map")
    .select(
      "id,subject,snippet,body_preview,from_email,from_name,to_emails,is_unread,has_attachments,label_ids",
    )
    .eq("importance_score", 0)
    .order("internal_date", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (opts.brainId) q = q.eq("brain_id", opts.brainId);

  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []) as GmailMessageRow[];
  let updated = 0;
  for (const row of rows) {
    const cls = classifyEmailImportance(row);
    const { error: uErr } = await supabase
      .from("gmail_message_map")
      .update({
        importance_score: cls.score,
        importance_level: cls.level,
        importance_reason: cls.reason,
        project_guess: cls.project_guess,
      } as never)
      .eq("id", row.id);
    if (!uErr) updated += 1;
  }
  return { updated };
}

// ---------- Brief ----------

export type GmailBrief = {
  connected: boolean;
  today_total: number;
  today_unread: number;
  important_today: number;
  important_7d: number;
  top: ImportantEmail[];
  last_sync_at: string | null;
};

export async function getGmailBrief(
  brainId?: string | null,
): Promise<GmailBrief> {
  // Connection check via gmail_connection_settings
  const { data: conns } = await supabase
    .from("gmail_connection_settings")
    .select("id,status,last_sync_at,brain_id")
    .order("created_at", { ascending: false });
  const conn =
    (conns ?? []).find((c) => c.status === "connected") ?? (conns ?? [])[0] ?? null;
  const connected = !!conn && conn.status === "connected";
  if (!connected || !conn) {
    return {
      connected: false,
      today_total: 0,
      today_unread: 0,
      important_today: 0,
      important_7d: 0,
      top: [],
      last_sync_at: null,
    };
  }

  const todayIso = startOfTodayIso();

  const [tToday, tUnread, iToday, i7d, top] = await Promise.all([
    supabase
      .from("gmail_message_map")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id)
      .gte("internal_date", todayIso),
    supabase
      .from("gmail_message_map")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id)
      .gte("internal_date", todayIso)
      .eq("is_unread", true),
    supabase
      .from("gmail_message_map")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id)
      .gte("internal_date", todayIso)
      .gte("importance_score", 55),
    supabase
      .from("gmail_message_map")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id)
      .gte("internal_date", isoDaysAgo(7))
      .gte("importance_score", 55),
    listImportantEmails({ brainId: brainId ?? null, range: "7d", limit: 5 }),
  ]);

  return {
    connected: true,
    today_total: tToday.count ?? 0,
    today_unread: tUnread.count ?? 0,
    important_today: iToday.count ?? 0,
    important_7d: i7d.count ?? 0,
    top,
    last_sync_at: conn.last_sync_at ?? null,
  };
}

// ---------- Deterministic summary (no LLM) ----------

const RX_DATE =
  /\b(lun|mar|mer|gio|ven|sab|dom|gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)\w*\s+\d{1,2}|(\b\d{1,2}[\/-]\d{1,2}([\/-]\d{2,4})?\b)|\b\d{1,2}:\d{2}\b/gi;

export type EmailSummary = {
  subject: string;
  from: string;
  received_at: string | null;
  short: string;
  key_points: string[];
  requested: string[];
  dates_mentioned: string[];
  has_attachments: boolean;
  suggested_action_type: string;
  importance_level: ImportanceLevel;
  importance_reason: string;
};

export function buildDeterministicSummary(row: GmailMessageRow): EmailSummary {
  const cls = classifyEmailImportance(row);
  const subject = row.subject ?? "(senza oggetto)";
  const fromLabel = row.from_name
    ? `${row.from_name} <${row.from_email ?? ""}>`
    : (row.from_email ?? "mittente sconosciuto");

  const body = `${row.snippet ?? ""}\n${row.body_preview ?? ""}`.slice(0, 2000);
  const sentences = body
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  const key_points = sentences.slice(0, 3);
  const requested = sentences
    .filter((s) => /\?|\b(potresti|puoi|chiedo|conferma|invia|manda|riprova|risposta)\b/i.test(s))
    .slice(0, 3);
  const dates = Array.from(body.matchAll(RX_DATE)).map((m) => m[0]).slice(0, 5);

  const short =
    sentences[0]?.slice(0, 220) ?? (row.snippet ?? "").slice(0, 220);

  return {
    subject,
    from: fromLabel,
    received_at: row.internal_date,
    short,
    key_points,
    requested,
    dates_mentioned: dates,
    has_attachments: row.has_attachments,
    suggested_action_type: cls.suggested_action_type,
    importance_level: cls.level,
    importance_reason: cls.reason,
  };
}
