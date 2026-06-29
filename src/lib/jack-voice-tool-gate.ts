// Brain Hub v3.24.2 — Jack Voice tool gate, STT echo guard, gmail failure clarity.
// Pure, side-effect-free helpers. No DB, no fetch, no browser APIs.
// Used by JackGptVoiceMode client to decide whether a model-issued tool call
// is allowed in the current conversational state.

export type VoiceToolBlockedReason =
  | "ambiguous_or_echo"
  | "no_explicit_gmail_sync_command"
  | "no_explicit_open_screen_confirmation"
  | "tool_called_after_assistant_question_without_user_reply"
  | "no_valid_user_utterance_yet"
  | "no_explicit_email_intent"
  | "no_email_intent_no_context"
  | "email_followup_context_resolved"
  | "gmail_sync_context_resumed"
  | "gmail_tool_blocked_missing_context"
  | "gmail_sync_resume_blocked_non_email_intent";

// v3.26.3 — diagnostic reasons surfaced when the gate ALLOWS a gated tool.
export type VoiceToolAllowedReason =
  | "email_intent_explicit"
  | "email_followup_with_recent_context"
  | "gmail_sync_resume_allowed_email_intent"
  | "gmail_sync_resume_allowed_followup"
  | "open_screen_confirmation_after_question"
  | "open_screen_explicit_command"
  | "gmail_sync_explicit_command"
  | "tool_not_gated";

export type VoiceToolGateStatus = "allowed" | "blocked";

export type GmailVoiceSyncStatus =
  | "synced"
  | "skipped_recent"
  | "already_in_progress"
  | "reauth_required"
  | "not_connected"
  | "config_missing"
  | "migration_missing"
  | "google_api_error"
  | "db_error"
  | "failed"
  | "cache_stale"
  | "token_refresh_failed";

export type IgnoredUtteranceReason =
  | "suspected_echo"
  | "too_short_ambiguous"
  | "low_confidence";

// Tools that require an explicit user command / confirmation before running.
export const GATED_VOICE_TOOLS: ReadonlySet<string> = new Set([
  "refresh_gmail_sync",
  "open_brainhub_screen",
  "observe_brainhub_screen",
  "propose_ui_action",
  "confirm_ui_action",
  "execute_confirmed_ui_action",
]);

// v3.25.3 — Read-only Gmail tools gated by explicit email intent in the
// user's last valid utterance. The model is instructed not to call these at
// session start, but this is the programmatic guarantee.
export const READ_GATED_VOICE_TOOLS: ReadonlySet<string> = new Set([
  "get_email_brief",
  "get_gmail_summary",
]);

const EMAIL_INTENT_KEYWORDS = [
  "mail",
  "email",
  "gmail",
  "posta",
  "inbox",
  "messaggi",
  "brief",
  "arrivate",
  "leggi",
  "leggimi",
  "non lette",
  "ultime",
];

// v3.26.2 — follow-up phrases that only make sense if a recent Gmail
// conversation context exists. They MUST NOT match when there is no context.
const EMAIL_FOLLOWUP_PHRASES = [
  "mittenti",
  "mittente",
  "quali sono",
  "dimmi quali",
  "leggimele",
  "leggimi",
  "dimmele",
  "apri la prima",
  "apri quella",
  "ripeti",
  "e oggi",
  "e in tutto",
  "anche oggi",
  "e le altre",
];

export function hasExplicitEmailIntent(text: string): boolean {
  if (!text) return false;
  const n = normalizeVoiceText(text);
  if (!n) return false;
  return EMAIL_INTENT_KEYWORDS.some((k) => n.includes(k));
}

export function looksLikeEmailFollowup(text: string): boolean {
  if (!text) return false;
  const n = normalizeVoiceText(text);
  if (!n) return false;
  return EMAIL_FOLLOWUP_PHRASES.some((k) => n.includes(k));
}



export function normalizeVoiceText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GENERIC_AMBIGUOUS_PHRASES: ReadonlyArray<string> = [
  "dimmi tu",
  "ok",
  "okay",
  "si",
  "sì",
  "vai",
  "certo",
  "va bene",
  "dimmi",
  "dimmi pure",
  "fammi",
  "boh",
  "uhm",
  "ehm",
];

export function isGenericAmbiguous(normalized: string): boolean {
  if (!normalized) return true;
  if (normalized.length <= 3) return true;
  return GENERIC_AMBIGUOUS_PHRASES.includes(normalized);
}

/**
 * Echo guard: detect when the user-transcript is most likely an STT echo
 * of what the assistant just said (or a short substring of it). Conservative:
 * only flags when the assistant spoke very recently AND there is strong
 * overlap.
 */
export function isSuspectedEcho(input: {
  userText: string;
  assistantText: string | null;
  assistantSpokeAt: number | null;
  now: number;
  windowMs?: number;
}): boolean {
  const { userText, assistantText, assistantSpokeAt, now } = input;
  const windowMs = input.windowMs ?? 2000;
  if (!assistantText || !assistantSpokeAt) return false;
  if (now - assistantSpokeAt > windowMs) return false;
  const u = normalizeVoiceText(userText);
  const a = normalizeVoiceText(assistantText);
  if (!u || !a) return false;
  if (u.length < 3) return true;
  if (a.includes(u)) return true;
  // Token overlap ratio
  const uTokens = u.split(" ").filter(Boolean);
  if (uTokens.length === 0) return false;
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const overlap = uTokens.filter((t) => aTokens.has(t)).length;
  return overlap / uTokens.length >= 0.8 && uTokens.length <= 5;
}

export type UserUtteranceClassification =
  | { valid: true }
  | { valid: false; reason: IgnoredUtteranceReason };

export function classifyUserUtterance(input: {
  text: string;
  assistantText: string | null;
  assistantSpokeAt: number | null;
  now: number;
  hasPendingConfirmation: boolean;
}): UserUtteranceClassification {
  const normalized = normalizeVoiceText(input.text);
  if (
    isSuspectedEcho({
      userText: input.text,
      assistantText: input.assistantText,
      assistantSpokeAt: input.assistantSpokeAt,
      now: input.now,
    })
  ) {
    return { valid: false, reason: "suspected_echo" };
  }
  if (isGenericAmbiguous(normalized) && !input.hasPendingConfirmation) {
    return { valid: false, reason: "too_short_ambiguous" };
  }
  return { valid: true };
}

const ASSISTANT_QUESTION_RX =
  /(\?|\bvuoi\s+che\b|\bdevo\s+aprire\b|\bprocedo\b|\bconfermi\b|\bposso\s+\w+\b|\bti\s+va\s+bene\b)/i;

export function isAssistantQuestion(text: string): boolean {
  if (!text) return false;
  return ASSISTANT_QUESTION_RX.test(text);
}

const GMAIL_SYNC_CMD_RX =
  /\b(sincronizz\w*|aggiorn\w*|refresh|fai\s+sync|fai\s+il\s+sync)\b.*\b(gmail|email|mail|posta)\b|\b(gmail|email|mail|posta)\b.*\b(sincronizz\w*|aggiorn\w*|refresh)\b/i;

export function isExplicitGmailSyncCommand(text: string): boolean {
  if (!text) return false;
  return GMAIL_SYNC_CMD_RX.test(text);
}

const OPEN_SCREEN_CONFIRM_RX =
  /\b(si|sì|ok|okay|va\s+bene|apri|aprilo|aprila|controlla|controlliamo|procedi|vai|fallo|conferm\w*)\b/i;

export function isExplicitOpenScreenConfirmation(text: string): boolean {
  if (!text) return false;
  return OPEN_SCREEN_CONFIRM_RX.test(text);
}

export type GateDecisionInput = {
  toolName: string;
  lastValidUserUtterance: string | null;
  lastValidUserUtteranceAt: number | null;
  lastAssistantQuestionAt: number | null;
  lastAssistantQuestionText: string | null;
  now: number;
  // v3.26.2 — short-lived Gmail conversation context. When present,
  // the gate allows follow-up tool calls referencing the prior context.
  hasRecentGmailContext?: boolean;
  recentSyncResumeContext?: boolean;
};

export type GateDecision =
  | { status: "allowed"; reason: VoiceToolAllowedReason }
  | {
      status: "blocked";
      reason: VoiceToolBlockedReason;
      safe_message: string;
    };

const ANSWER_WINDOW_MS = 30_000;

export function decideVoiceToolGate(input: GateDecisionInput): GateDecision {
  // v3.25.3 / v3.26.3 — read-gated tools (get_email_brief / get_gmail_summary).
  if (READ_GATED_VOICE_TOOLS.has(input.toolName)) {
    const utterance = input.lastValidUserUtterance ?? "";
    const validAt = input.lastValidUserUtteranceAt ?? 0;
    const fresh = Boolean(utterance) && input.now - validAt <= ANSWER_WINDOW_MS;
    const hasEmailIntent = fresh && hasExplicitEmailIntent(utterance);
    const isFollowup =
      fresh && Boolean(input.hasRecentGmailContext) && looksLikeEmailFollowup(utterance);

    if (hasEmailIntent) {
      // v3.26.3 — explicit email intent wins, regardless of sync resume window.
      return {
        status: "allowed",
        reason: input.recentSyncResumeContext
          ? "gmail_sync_resume_allowed_email_intent"
          : "email_intent_explicit",
      };
    }
    if (isFollowup) {
      return {
        status: "allowed",
        reason: input.recentSyncResumeContext
          ? "gmail_sync_resume_allowed_followup"
          : "email_followup_with_recent_context",
      };
    }
    // v3.26.3 — sync just completed but utterance has no email intent and
    // no recognized Gmail follow-up: do NOT bypass. Block to prevent Jack
    // from auto-briefing on unrelated requests (weather, calendar, ...).
    if (input.recentSyncResumeContext) {
      return {
        status: "blocked",
        reason: "gmail_sync_resume_blocked_non_email_intent",
        safe_message:
          "Ho sincronizzato Gmail. Se vuoi un riepilogo dimmi 'leggimi le mail non lette' o 'mittenti'.",
      };
    }
    return {
      status: "blocked",
      reason: input.hasRecentGmailContext
        ? "gmail_tool_blocked_missing_context"
        : "no_email_intent_no_context",
      safe_message:
        "Posso leggere le mail solo se me lo chiedi esplicitamente, ad esempio 'leggimi le mail di oggi'.",
    };
  }

  if (!GATED_VOICE_TOOLS.has(input.toolName))
    return { status: "allowed", reason: "tool_not_gated" };


  // If assistant asked a question and there is no fresher valid user reply,
  // block any gated tool until the user actually answers.
  const askedAt = input.lastAssistantQuestionAt ?? 0;
  const validAt = input.lastValidUserUtteranceAt ?? 0;
  if (askedAt > 0 && validAt <= askedAt) {
    return {
      status: "blocked",
      reason: "tool_called_after_assistant_question_without_user_reply",
      safe_message:
        "Prima di procedere ho bisogno della tua risposta esplicita alla domanda appena fatta.",
    };
  }

  const utterance = input.lastValidUserUtterance ?? "";
  if (!utterance) {
    return {
      status: "blocked",
      reason: "no_valid_user_utterance_yet",
      safe_message:
        "Non ho ricevuto un comando esplicito chiaro. Puoi ripetere cosa vuoi che faccia?",
    };
  }
  // Stale utterance (too old) — be conservative and block.
  if (input.now - validAt > ANSWER_WINDOW_MS) {
    return {
      status: "blocked",
      reason: "no_valid_user_utterance_yet",
      safe_message:
        "Non ho un comando recente abbastanza esplicito per procedere.",
    };
  }

  if (input.toolName === "refresh_gmail_sync") {
    if (!isExplicitGmailSyncCommand(utterance)) {
      return {
        status: "blocked",
        reason: "no_explicit_gmail_sync_command",
        safe_message:
          "Posso sincronizzare Gmail solo se me lo chiedi esplicitamente, ad esempio 'sincronizza Gmail'.",
      };
    }
    return { status: "allowed", reason: "gmail_sync_explicit_command" };
  }

  if (
    input.toolName === "open_brainhub_screen" ||
    input.toolName === "observe_brainhub_screen" ||
    input.toolName === "propose_ui_action" ||
    input.toolName === "confirm_ui_action" ||
    input.toolName === "execute_confirmed_ui_action"
  ) {
    // Require either an explicit confirmation right after an assistant question,
    // or an explicit open/controllo command.
    const recentlyAsked =
      askedAt > 0 && input.now - askedAt < ANSWER_WINDOW_MS;
    if (recentlyAsked && isExplicitOpenScreenConfirmation(utterance)) {
      return { status: "allowed", reason: "open_screen_confirmation_after_question" };
    }
    if (/\b(apri|controlla|controlliamo|vai\s+su)\b/i.test(utterance)) {
      return { status: "allowed", reason: "open_screen_explicit_command" };
    }
    return {
      status: "blocked",
      reason: "no_explicit_open_screen_confirmation",
      safe_message:
        "Prima di aprire una schermata di Brain Hub ho bisogno di una conferma esplicita.",
    };
  }

  return { status: "allowed", reason: "tool_not_gated" };
}

  if (
    input.toolName === "open_brainhub_screen" ||
    input.toolName === "observe_brainhub_screen" ||
    input.toolName === "propose_ui_action" ||
    input.toolName === "confirm_ui_action" ||
    input.toolName === "execute_confirmed_ui_action"
  ) {
    // Require either an explicit confirmation right after an assistant question,
    // or an explicit open/controllo command.
    const recentlyAsked =
      askedAt > 0 && input.now - askedAt < ANSWER_WINDOW_MS;
    if (recentlyAsked && isExplicitOpenScreenConfirmation(utterance)) {
      return { status: "allowed" };
    }
    if (/\b(apri|controlla|controlliamo|vai\s+su)\b/i.test(utterance)) {
      return { status: "allowed" };
    }
    return {
      status: "blocked",
      reason: "no_explicit_open_screen_confirmation",
      safe_message:
        "Prima di aprire una schermata di Brain Hub ho bisogno di una conferma esplicita.",
    };
  }

  return { status: "allowed" };
}

export function buildBlockedToolPayload(reason: VoiceToolBlockedReason, safe_message: string) {
  return {
    ok: false as const,
    status: "confirmation_required" as const,
    blocked: true as const,
    reason,
    safe_message,
    requires_user_confirmation: true,
    should_not_retry_tool: true,
  };
}
