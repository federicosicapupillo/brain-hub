// Brain Hub v3.25 — Deterministic Voice Command Router.
// Pure, side-effect-free. Maps a noisy Italian transcript to a sensitive
// Brain Hub voice action (sync_gmail / open_gmail_connector / ask_email_brief).
// The Realtime model must NOT execute these directly: Brain Hub renders a
// confirmation button and a deterministic executor handles the call.

export type VoiceCommandIntent =
  | "ask_email_brief"
  | "sync_gmail"
  | "open_gmail_connector"
  | "cancel"
  | "confirm_pending"
  | "capability_question"
  | "unknown";

export type VoiceCommandConfidence = "high" | "medium" | "low";

export type VoiceActionType =
  | "sync_gmail"
  | "open_gmail_connector"
  | "ask_email_brief";

export type VoiceActionStatus =
  | "proposed"
  | "executing"
  | "executed"
  | "failed"
  | "cancelled"
  | "expired";

export type VoiceActionRiskLevel = "low" | "medium" | "high";

export type VoiceActionPreview = {
  type: VoiceActionType;
  title: string;
  description: string;
  button_label: string;
  cancel_label: string;
  risk_level: VoiceActionRiskLevel;
  payload: Record<string, unknown>;
};

export type VoiceCommandRouterResult = {
  intent: VoiceCommandIntent;
  confidence: VoiceCommandConfidence;
  requires_confirmation: boolean;
  action_preview: VoiceActionPreview | null;
  safe_message: string;
  matched_terms: string[];
};

export type PendingVoiceActionLite = {
  id: string;
  type: VoiceActionType;
  createdAt: number;
  expiresAt: number;
};

export type VoiceCommandRouterContext = {
  transcript: string;
  lastAssistantText: string | null;
  hasPendingAssistantQuestion: boolean;
  pendingVoiceAction: PendingVoiceActionLite | null;
  now: number;
};

// ---------- Normalization ----------

const TYPO_FIXES: ReadonlyArray<[RegExp, string]> = [
  [/\bgmial\b/g, "gmail"],
  [/\bg[\s-]?mail\b/g, "gmail"],
  [/\bincronizz/g, "sincronizz"],
  [/\bsincronizare\b/g, "sincronizzare"],
  [/\bsincronizando\b/g, "sincronizzando"],
  [/\bsaisincronizando\b/g, "sincronizzando"],
  [/\bsincroniza\b/g, "sincronizza"],
  [/\bemai\b/g, "email"],
  [/\bmial\b/g, "mail"],
];

export function normalizeRouterText(text: string): string {
  let t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿¡!?.,;:"'`«»()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [rx, repl] of TYPO_FIXES) t = t.replace(rx, repl);
  return t.replace(/\s+/g, " ").trim();
}

// ---------- Lexicon ----------

const GMAIL_NOUNS = ["gmail", "mail", "email", "posta", "inbox", "casella"];
const SYNC_VERBS = [
  "sincronizz", // sincronizza, sincronizzazione, sincronizzare
  "aggiorn", // aggiorna, aggiornamento, aggiornare
  "refresh",
  "fai sync",
  "fai la sync",
  "fai il sync",
  "fai sincronizz",
];
const OPEN_VERBS = ["apri", "aprila", "aprilo", "vai su", "mostrami", "portami"];
const CONNECTOR_TERMS = ["gmail connector", "connettore gmail", "connettore di gmail"];
const READ_EMAIL_PHRASES = [
  "controlla le mail",
  "controlla le email",
  "controlla la posta",
  "quali mail",
  "quali email",
  "leggimi le mail",
  "leggimi le email",
  "leggi le mail",
  "leggi le email",
  "ci sono mail",
  "ci sono email",
  "ho mail",
  "ho email",
  "che mail",
  "che email",
  "mail di oggi",
  "email di oggi",
  "posta di oggi",
  "qualcosa di nuovo",
];
const CANCEL_TERMS = [
  "annulla",
  "lascia stare",
  "lascia perdere",
  "non importa",
  "no grazie",
  "fermati",
  "stop",
  "ferma",
  "cancella",
];
const CONFIRM_TERMS = [
  "si",
  "si grazie",
  "si conferma",
  "si confermo",
  "confermo",
  "conferma",
  "procedi",
  "vai",
  "fallo",
  "ok",
  "okay",
  "va bene",
  "perfetto",
  "daje",
  "dai",
];

function containsAny(text: string, terms: ReadonlyArray<string>): string[] {
  const hits: string[] = [];
  for (const t of terms) if (text.includes(t)) hits.push(t);
  return hits;
}

function hasGmailNoun(text: string): string[] {
  return containsAny(text, GMAIL_NOUNS);
}

function hasSyncVerb(text: string): string[] {
  return SYNC_VERBS.filter((v) => text.includes(v));
}

function hasOpenVerb(text: string): string[] {
  return OPEN_VERBS.filter((v) => text.includes(v));
}

// Capability/meta questions: user is asking whether Jack CAN do something,
// not commanding him to do it. Must NOT trigger sensitive tools and must
// NOT count as a confirmation of any pending action.
const CAPABILITY_QUESTION_PATTERNS: ReadonlyArray<RegExp> = [
  /\bnon\s+puoi\b/,
  /\bpuoi\s+(farlo|fare|sincronizzarl|aprirl|leggerl)/,
  /\bperche\s+non\s+(lo\s+)?fai\b/,
  /\bperche\s+non\s+(lo\s+)?puoi\b/,
  /\bnon\s+riesci\b/,
  /\bcome\s+(faccio|si\s+fa)\b/,
  /\briesci\s+(a|tu)\b/,
  /\bsei\s+capace\b/,
];

function detectCapabilityQuestion(normalized: string): string[] {
  const hits: string[] = [];
  for (const rx of CAPABILITY_QUESTION_PATTERNS) {
    const m = normalized.match(rx);
    if (m) hits.push(m[0]);
  }
  return hits;
}


// ---------- Public API ----------

const SAFE_FALLBACK =
  "Non sono sicuro di aver capito. Vuoi che sincronizzi Gmail, apra il Gmail Connector o legga le mail?";

export function routeVoiceCommand(
  ctx: VoiceCommandRouterContext,
): VoiceCommandRouterResult {
  const normalized = normalizeRouterText(ctx.transcript);
  if (!normalized || normalized.length < 2) {
    return unknown();
  }
  const rawTrimmed = ctx.transcript.trim();
  const endsWithQuestionMark = /[?¿]\s*$/.test(rawTrimmed);

  // 1. Cancel always wins.
  const cancelHits = containsAny(normalized, CANCEL_TERMS);
  if (cancelHits.length > 0) {
    return {
      intent: "cancel",
      confidence: "high",
      requires_confirmation: false,
      action_preview: null,
      safe_message: "Ok, annullo.",
      matched_terms: cancelHits,
    };
  }

  // 1b. Capability questions ("non puoi farlo tu?", "puoi farlo?", "perché non…")
  // must NEVER be treated as confirmations or sync commands.
  const capabilityHits = detectCapabilityQuestion(normalized);
  if (capabilityHits.length > 0) {
    return {
      intent: "capability_question",
      confidence: "high",
      requires_confirmation: false,
      action_preview: null,
      safe_message:
        "Posso farlo solo dopo una tua conferma esplicita, perché è un'azione operativa. Usa il pulsante o dimmi 'sì, sincronizza Gmail'.",
      matched_terms: capabilityHits,
    };
  }

  // 2. Confirm pending action if any is active and user said a confirm term.
  const confirmHits = containsAny(normalized, CONFIRM_TERMS);
  if (
    ctx.pendingVoiceAction &&
    ctx.pendingVoiceAction.expiresAt > ctx.now &&
    confirmHits.length > 0
  ) {
    return {
      intent: "confirm_pending",
      confidence: "high",
      requires_confirmation: false,
      action_preview: null,
      safe_message: "Confermato, procedo.",
      matched_terms: confirmHits,
    };
  }



  const gmailHits = hasGmailNoun(normalized);
  const syncHits = hasSyncVerb(normalized);
  const openHits = hasOpenVerb(normalized);
  const connectorHits = containsAny(normalized, CONNECTOR_TERMS);
  const readHits = containsAny(normalized, READ_EMAIL_PHRASES);

  // 3. Open Gmail Connector
  if (connectorHits.length > 0 || (openHits.length > 0 && gmailHits.length > 0)) {
    return {
      intent: "open_gmail_connector",
      confidence: connectorHits.length > 0 ? "high" : "medium",
      requires_confirmation: true,
      action_preview: previewOpenGmailConnector(),
      safe_message: "Posso aprire il Gmail Connector: confermi col pulsante?",
      matched_terms: [...connectorHits, ...openHits, ...gmailHits],
    };
  }

  // 4. Sync Gmail
  if (syncHits.length > 0 && (gmailHits.length > 0 || /\bfai sync\b/.test(normalized))) {
    return {
      intent: "sync_gmail",
      confidence: "high",
      requires_confirmation: true,
      action_preview: previewSyncGmail(),
      safe_message: "Posso sincronizzare Gmail in sola lettura: confermi col pulsante?",
      matched_terms: [...syncHits, ...gmailHits],
    };
  }
  // Sync verb alone (no noun) – medium confidence, only if last assistant turn
  // mentioned Gmail/email or there is a pending Gmail-related question.
  if (
    syncHits.length > 0 &&
    ctx.hasPendingAssistantQuestion &&
    (ctx.lastAssistantText ?? "").toLowerCase().match(/gmail|mail|posta|email/)
  ) {
    return {
      intent: "sync_gmail",
      confidence: "medium",
      requires_confirmation: true,
      action_preview: previewSyncGmail(),
      safe_message:
        "Mi sembra che tu voglia sincronizzare Gmail: confermi col pulsante?",
      matched_terms: syncHits,
    };
  }

  // 5. Ask email brief (read intent)
  if (
    readHits.length > 0 ||
    (gmailHits.length > 0 && /\b(quali|che|cosa|c[oe] e|nuove?)\b/.test(normalized))
  ) {
    return {
      intent: "ask_email_brief",
      confidence: "high",
      requires_confirmation: false,
      action_preview: null,
      safe_message: "Controllo le mail recenti.",
      matched_terms: [...readHits, ...gmailHits],
    };
  }

  return unknown();
}

function unknown(): VoiceCommandRouterResult {
  return {
    intent: "unknown",
    confidence: "low",
    requires_confirmation: false,
    action_preview: null,
    safe_message: SAFE_FALLBACK,
    matched_terms: [],
  };
}

function previewSyncGmail(): VoiceActionPreview {
  return {
    type: "sync_gmail",
    title: "Sincronizzare Gmail?",
    description:
      "Posso aggiornare i metadati Gmail recenti in modalità sola lettura. Nessuna modifica alla tua casella.",
    button_label: "Sì, sincronizza Gmail",
    cancel_label: "Annulla",
    risk_level: "medium",
    payload: { mode: "today", reason: "user_requested" },
  };
}

function previewOpenGmailConnector(): VoiceActionPreview {
  return {
    type: "open_gmail_connector",
    title: "Aprire il Gmail Connector?",
    description:
      "Apro la schermata Gmail Connector dentro Brain Hub per controllare lo stato di connessione.",
    button_label: "Sì, apri Gmail Connector",
    cancel_label: "Annulla",
    risk_level: "low",
    payload: { route: "/gmail-connector" },
  };
}

export const VOICE_ACTION_DEFAULT_TTL_MS = 60_000;

export function buildPendingVoiceAction(
  type: VoiceActionType,
  now: number,
  ttlMs: number = VOICE_ACTION_DEFAULT_TTL_MS,
): PendingVoiceActionLite {
  return {
    id: `voiceact_${now}_${Math.random().toString(36).slice(2, 10)}`,
    type,
    createdAt: now,
    expiresAt: now + ttlMs,
  };
}
