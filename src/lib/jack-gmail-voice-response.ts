// Brain Hub v3.25.4 — Gmail Brief Response Stabilizer.
// Deterministic, length-bounded voice responses for Gmail brief tool output.
// Brain Hub owns the wording for simple Gmail questions so Jack does not
// paraphrase, lengthen, or trail off mid-sentence.

export type GmailBriefMode =
  | "count_only"
  | "list_summary"
  | "latest_only"
  | "unread_only"
  | "detail_requested";

export type GmailBriefVoiceItem = {
  from_name?: string | null;
  from_email?: string | null;
  subject?: string | null;
  snippet?: string | null;
  received_at?: string | null;
  unread?: boolean | null;
  is_newsletter?: boolean | null;
};

export type GmailBriefVoicePayload = {
  ok?: boolean;
  connected?: boolean;
  status?: string | null;
  last_sync_at?: string | null;
  timezone?: string | null;
  counts?: {
    today_total?: number | null;
    today_unread?: number | null;
    today_newsletters?: number | null;
    today_inbox?: number | null;
    [k: string]: unknown;
  } | null;
  inbox_today?: GmailBriefVoiceItem[] | null;
  newsletters_today?: GmailBriefVoiceItem[] | null;
  all_today?: GmailBriefVoiceItem[] | null;
  unread_previous?: GmailBriefVoiceItem[] | null;
};

const MAX_LEN: Record<GmailBriefMode, number> = {
  count_only: 180,
  latest_only: 280,
  unread_only: 280,
  list_summary: 500,
  detail_requested: 700,
};

const MODE_PATTERNS: ReadonlyArray<[GmailBriefMode, RegExp]> = [
  ["detail_requested", /\b(leggimela|leggimelo|leggila|leggilo|apri\s+il\s+dettaglio|riassumi\s+quest[ao]\s+mail|dimmi\s+di\s+pi[uù]|fammi\s+il\s+dettaglio|dettaglio)\b/],
  ["unread_only", /\bnon\s+lett[ei]\b/],
  ["latest_only", /\b(ultim[ao])\s+(mail|email|arrivat|messaggio)|qual\s*[èe']?\s*l['\s]?ultim/],
  ["count_only", /\b(quant[ie])\s+(mail|email|ne\s+sono|messaggi)\b|\bnumero\s+(di\s+)?(mail|email)\b|\bci\s+sono\s+(mail|email|messaggi)\b/],
  ["list_summary", /\b(quali|che)\s+(mail|email|messaggi)\b|\b(fammi\s+(l['\s]?)?elenco|elenco\s+mail|elenco\s+email|lista\s+(mail|email))\b/],
];

export function normalizeGmailQuery(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿¡!?.,;:"'`«»()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectGmailBriefMode(userUtterance: string | null): GmailBriefMode {
  if (!userUtterance) return "list_summary";
  const norm = normalizeGmailQuery(userUtterance);
  for (const [mode, rx] of MODE_PATTERNS) {
    if (rx.test(norm)) return mode;
  }
  return "list_summary";
}

function formatItalianTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function senderLabel(item: GmailBriefVoiceItem): string {
  const name = (item.from_name ?? "").trim();
  if (name) return name;
  const email = (item.from_email ?? "").trim();
  if (email) {
    const at = email.indexOf("@");
    return at > 0 ? email.slice(0, at) : email;
  }
  return "mittente sconosciuto";
}

function shortSubject(item: GmailBriefVoiceItem, max = 60): string {
  const s = (item.subject ?? "").trim();
  if (!s) return "senza oggetto";
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function pickItems(payload: GmailBriefVoicePayload): GmailBriefVoiceItem[] {
  const all = payload.all_today ?? null;
  if (all && all.length > 0) return all;
  const merged: GmailBriefVoiceItem[] = [];
  if (payload.inbox_today) merged.push(...payload.inbox_today);
  if (payload.newsletters_today) merged.push(...payload.newsletters_today);
  return merged;
}

function sortByReceivedDesc(items: GmailBriefVoiceItem[]): GmailBriefVoiceItem[] {
  return [...items].sort((a, b) => {
    const ta = a.received_at ? Date.parse(a.received_at) : 0;
    const tb = b.received_at ? Date.parse(b.received_at) : 0;
    return tb - ta;
  });
}

function safeCounts(payload: GmailBriefVoicePayload): {
  total: number;
  unread: number;
  newsletters: number;
  inbox: number;
} {
  const c = payload.counts ?? {};
  const total = typeof c.today_total === "number" ? c.today_total : pickItems(payload).length;
  const unread = typeof c.today_unread === "number" ? c.today_unread : 0;
  const newsletters =
    typeof c.today_newsletters === "number"
      ? c.today_newsletters
      : (payload.newsletters_today?.length ?? 0);
  const inbox =
    typeof c.today_inbox === "number"
      ? c.today_inbox
      : (payload.inbox_today?.length ?? Math.max(0, total - newsletters));
  return { total, unread, newsletters, inbox };
}

function isStale(payload: GmailBriefVoicePayload, now: number): boolean {
  const iso = payload.last_sync_at;
  if (!iso) return true;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return true;
  return now - t > 30 * 60 * 1000; // > 30 min
}

function staleSuffix(payload: GmailBriefVoicePayload, now: number): string {
  if (!isStale(payload, now)) return "";
  const hhmm = formatItalianTime(payload.last_sync_at);
  if (!hhmm) return "";
  return ` I dati sono sincronizzati alle ${hhmm}.`;
}

export type BuildGmailVoiceResponseInput = {
  mode: GmailBriefMode;
  brief: GmailBriefVoicePayload;
  userName?: string | null;
  now?: number;
};

export type BuildGmailVoiceResponseOutput = {
  text: string;
  shouldAskFollowup: boolean;
  truncated: boolean;
  length: number;
  mode: GmailBriefMode;
};

function disconnectedResponse(name: string): string {
  return `${name}, Gmail non risulta collegato a Brain Hub. Vuoi aprire il Gmail Connector?`;
}

function buildCountOnly(p: GmailBriefVoicePayload, name: string): string {
  const c = safeCounts(p);
  if (c.total === 0) return `${name}, oggi non risultano email nuove.`;
  const parts: string[] = [];
  if (c.inbox > 0) parts.push(`${c.inbox} ${c.inbox === 1 ? "normale" : "normali"}`);
  if (c.newsletters > 0) parts.push(`${c.newsletters} ${c.newsletters === 1 ? "newsletter" : "newsletter"}`);
  const detail = parts.length > 0 ? `: ${parts.join(" e ")}.` : ".";
  return `${name}, oggi risultano ${c.total} ${c.total === 1 ? "email" : "email"}${detail}`;
}

function buildUnreadOnly(p: GmailBriefVoicePayload, name: string): string {
  const c = safeCounts(p);
  if (c.unread === 0) return `${name}, oggi non ci sono email non lette.`;
  const items = sortByReceivedDesc(pickItems(p).filter((i) => i.unread === true)).slice(0, 2);
  if (items.length === 0) {
    return `${name}, oggi risultano ${c.unread} ${c.unread === 1 ? "email non letta" : "email non lette"}.`;
  }
  const samples = items
    .map((i) => `${senderLabel(i)} su "${shortSubject(i, 40)}"`)
    .join("; ");
  return `${name}, oggi ${c.unread === 1 ? "c'è 1 email non letta" : `ci sono ${c.unread} email non lette`}: ${samples}.`;
}

function buildLatestOnly(p: GmailBriefVoicePayload, name: string): string {
  const items = sortByReceivedDesc(pickItems(p));
  const latest = items[0];
  if (!latest) return `${name}, oggi non risultano email recenti.`;
  const hhmm = formatItalianTime(latest.received_at);
  const sender = senderLabel(latest);
  const subj = shortSubject(latest, 50);
  const when = hhmm ? ` alle ${hhmm}` : "";
  return `${name}, l'ultima email è di ${sender}${when}, oggetto: "${subj}".`;
}

function buildListSummary(p: GmailBriefVoicePayload, name: string): string {
  const items = sortByReceivedDesc(pickItems(p)).slice(0, 3);
  if (items.length === 0) return `${name}, oggi non risultano email da elencare.`;
  const c = safeCounts(p);
  const head = `${name}, oggi ${c.total === 1 ? "c'è 1 email" : `ci sono ${c.total} email`}. Le più recenti:`;
  const lines = items.map((i) => {
    const hhmm = formatItalianTime(i.received_at);
    const when = hhmm ? ` (${hhmm})` : "";
    return `${senderLabel(i)} — ${shortSubject(i, 45)}${when}`;
  });
  return `${head} ${lines.join("; ")}.`;
}

function buildDetailRequested(p: GmailBriefVoicePayload, name: string): string {
  const items = sortByReceivedDesc(pickItems(p));
  const latest = items[0];
  if (!latest) return `${name}, non ho una email da approfondire.`;
  const hhmm = formatItalianTime(latest.received_at);
  const sender = senderLabel(latest);
  const subj = shortSubject(latest, 70);
  const snippet = (latest.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 280);
  const when = hhmm ? ` ricevuta alle ${hhmm}` : "";
  const body = snippet ? ` Estratto: ${snippet}` : "";
  return `${name}, dettaglio email da ${sender}${when}. Oggetto: "${subj}".${body}`;
}

function truncateSafe(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  // cut at last sentence/punctuation boundary
  const slice = text.slice(0, max);
  const lastStop = Math.max(
    slice.lastIndexOf("."),
    slice.lastIndexOf(";"),
    slice.lastIndexOf("!"),
    slice.lastIndexOf("?"),
  );
  const cut = lastStop > max * 0.5 ? slice.slice(0, lastStop + 1) : slice.trimEnd() + "…";
  return { text: `${cut} Vuoi che continui?`, truncated: true };
}

export function buildGmailVoiceResponse(
  input: BuildGmailVoiceResponseInput,
): BuildGmailVoiceResponseOutput {
  const now = input.now ?? Date.now();
  const name = (input.userName ?? "").trim() || "Fede";
  const p = input.brief ?? {};

  if (p.connected === false || p.status === "not_connected") {
    const text = disconnectedResponse(name);
    return { text, shouldAskFollowup: true, truncated: false, length: text.length, mode: input.mode };
  }

  let raw: string;
  switch (input.mode) {
    case "count_only":
      raw = buildCountOnly(p, name);
      break;
    case "unread_only":
      raw = buildUnreadOnly(p, name);
      break;
    case "latest_only":
      raw = buildLatestOnly(p, name);
      break;
    case "detail_requested":
      raw = buildDetailRequested(p, name);
      break;
    case "list_summary":
    default:
      raw = buildListSummary(p, name);
      break;
  }

  const withStale = raw + staleSuffix(p, now);
  const { text, truncated } = truncateSafe(withStale, MAX_LEN[input.mode]);
  return {
    text,
    shouldAskFollowup: truncated,
    truncated,
    length: text.length,
    mode: input.mode,
  };
}

// ---------- Barge-in guard helpers ----------

const SHORT_NOISE_TOKENS = new Set([
  "mhm", "mh", "hmm", "uhm", "uh", "ah", "eh", "ehm",
  "ok", "okay", "si", "sì", "no", "boh", "ahah",
]);

const STRONG_INTERRUPT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bfermati\b/,
  /\bstop\b/,
  /\baspetta\b/,
  /\bcambia\s+(domanda|argomento)\b/,
  /\bzitto\b/,
  /\bbasta\b/,
];

export type BargeInDecision = {
  ignore: boolean;
  reason:
    | "assistant_speaking_and_short_noise"
    | "assistant_just_finished_and_short_noise"
    | "strong_interrupt"
    | "not_during_speech"
    | "allow";
};

export function shouldIgnoreBargeIn(input: {
  transcript: string;
  assistantSpeaking: boolean;
  lastAssistantSpeechEndedAt: number | null;
  now: number;
  postSpeechGuardMs?: number;
}): BargeInDecision {
  const guardMs = input.postSpeechGuardMs ?? 1200;
  const t = input.transcript.trim();
  const norm = normalizeGmailQuery(t);
  const within =
    input.lastAssistantSpeechEndedAt !== null &&
    input.now - input.lastAssistantSpeechEndedAt < guardMs;

  if (!input.assistantSpeaking && !within) {
    return { ignore: false, reason: "not_during_speech" };
  }

  for (const rx of STRONG_INTERRUPT_PATTERNS) {
    if (rx.test(norm)) return { ignore: false, reason: "strong_interrupt" };
  }

  const tokens = norm.split(/\s+/).filter(Boolean);
  const isShort =
    tokens.length < 3 ||
    (tokens.length === 1 && SHORT_NOISE_TOKENS.has(tokens[0])) ||
    (tokens.length <= 2 && tokens.every((tok) => SHORT_NOISE_TOKENS.has(tok)));

  if (!isShort) return { ignore: false, reason: "allow" };

  return {
    ignore: true,
    reason: input.assistantSpeaking
      ? "assistant_speaking_and_short_noise"
      : "assistant_just_finished_and_short_noise",
  };
}
