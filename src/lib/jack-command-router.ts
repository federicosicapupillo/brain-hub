// ============================================================
// Brain Hub v3.10 — Jack Voice Command MVP — Intent Router
// ============================================================
// READ-ONLY. No email/Telegram/n8n/Drive/Calendar/GitHub modification.
// No automatic action creation. No audio storage. Transcript only.
// ============================================================

import { supabase } from "@/integrations/supabase/client";
import {
  getTodayOperatingBrief,
  getAnyTodayOperatingBriefForUser,
  type DailyBriefRow,
} from "@/lib/daily-operating-brief";

export type JackIntent =
  | "daily_status"
  | "next_actions"
  | "email_summary"
  | "warnings_status"
  | "telegram_status"
  | "master_snapshot"
  | "unknown";

export type JackCommandCTA = {
  label: string;
  to: string;
  search?: Record<string, string | undefined>;
};

export type JackCommandResult = {
  intent: JackIntent;
  matched_phrases: string[];
  response_text: string;
  cta: JackCommandCTA | null;
  source: string;
};

const INTENT_PATTERNS: Record<Exclude<JackIntent, "unknown">, string[]> = {
  daily_status: [
    "a che punto siamo",
    "fammi il riassunto",
    "riassunto della giornata",
    "riassunto",
    "cosa è successo oggi",
    "cosa e successo oggi",
    "cosa abbiamo implementato",
    "com'è messa",
    "come e messa",
    "stato brain hub",
    "status",
  ],
  next_actions: [
    "cosa devo fare",
    "prossime azioni",
    "prossima azione",
    "qual è il prossimo passo",
    "qual e il prossimo passo",
    "priorita di oggi",
    "priorità di oggi",
    "next",
  ],
  email_summary: [
    "email di oggi",
    "riepilogo email",
    "mail importanti",
    "gmail",
    "email ricevute",
    "posta",
    "email",
    "mail",
  ],
  warnings_status: [
    "ci sono problemi",
    "warning",
    "loop qa",
    "cosa è bloccato",
    "cosa e bloccato",
    "progetti bloccati",
    "errori",
    "problemi",
  ],
  telegram_status: [
    "telegram",
    "approvazioni telegram",
    "cosa è stato approvato",
    "cosa e stato approvato",
    "cosa è stato rifiutato",
    "cosa e stato rifiutato",
    "approvazioni",
  ],
  master_snapshot: [
    "master snapshot",
    "aggiorna snapshot",
    "stato memoria progetto",
    "cosa abbiamo salvato",
    "snapshot",
    "memoria",
  ],
};

function normalize(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[?!.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseJackCommand(transcript: string): {
  intent: JackIntent;
  matched: string[];
} {
  const text = normalize(transcript);
  if (!text) return { intent: "unknown", matched: [] };

  let bestIntent: JackIntent = "unknown";
  let bestScore = 0;
  let bestMatched: string[] = [];

  for (const [intent, phrases] of Object.entries(INTENT_PATTERNS) as Array<
    [Exclude<JackIntent, "unknown">, string[]]
  >) {
    const matched = phrases.filter((p) => text.includes(normalize(p)));
    if (matched.length === 0) continue;
    // Prefer longer phrase matches
    const score = matched.reduce((acc, p) => acc + p.length, 0);
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
      bestMatched = matched;
    }
  }

  return { intent: bestIntent, matched: bestMatched };
}

export function getJackCommandSuggestions(): string[] {
  return [
    "A che punto siamo?",
    "Cosa devo fare oggi?",
    "Email di oggi",
    "Ci sono warning?",
    "Stato Telegram",
    "Master snapshot",
  ];
}

export type JackCommandContext = {
  brainId: string | null;
  currentBrief?: DailyBriefRow | null;
};

export type ResolvedBrief = {
  brief: DailyBriefRow | null;
  source: "current" | "query" | "fallback" | "missing";
};

async function resolveBrief(ctx: JackCommandContext): Promise<ResolvedBrief> {
  if (ctx.currentBrief) {
    return { brief: ctx.currentBrief, source: "current" };
  }
  const scoped = await getTodayOperatingBrief(ctx.brainId);
  if (scoped) return { brief: scoped, source: "query" };
  const fallback = await getAnyTodayOperatingBriefForUser();
  if (fallback) return { brief: fallback, source: "fallback" };
  return { brief: null, source: "missing" };
}

export async function resolveJackCommandIntent(input: {
  transcript: string;
  context: JackCommandContext;
}): Promise<JackCommandResult> {
  const { transcript, context } = input;
  const { intent, matched } = parseJackCommand(transcript);

  try {
    switch (intent) {
      case "daily_status":
        return await respondDailyStatus(context, matched);
      case "next_actions":
        return await respondNextActions(context, matched);
      case "email_summary":
        return await respondEmailSummary(context, matched);
      case "warnings_status":
        return await respondWarnings(context, matched);
      case "telegram_status":
        return await respondTelegram(context, matched);
      case "master_snapshot":
        return await respondMasterSnapshot(context, matched);
      default:
        return {
          intent: "unknown",
          matched_phrases: [],
          response_text:
            "Non ho capito bene. Puoi chiedermi: a che punto siamo, prossime azioni, email di oggi, warning o stato Telegram.",
          cta: null,
          source: "fallback",
        };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      intent,
      matched_phrases: matched,
      response_text: `Non sono riuscito a leggere i dati: ${msg}. Riprova tra poco.`,
      cta: null,
      source: "error",
    };
  }
}

// ---------------- Per-intent responders ----------------

async function respondDailyStatus(
  ctx: JackCommandContext,
  matched: string[],
): Promise<JackCommandResult> {
  const { brief, source } = await resolveBrief(ctx);
  if (!brief) {
    return {
      intent: "daily_status",
      matched_phrases: matched,
      response_text:
        "Non c'è ancora un briefing per oggi. Apri il Daily Brief e clicca Genera per crearlo.",
      cta: ctaDaily(ctx),
      source: "daily_brief_missing",
    };
  }
  const text =
    brief.voice_summary_text?.trim() ||
    summarizeBriefShort(brief) ||
    brief.executive_summary?.slice(0, 600) ||
    "Briefing presente ma vuoto.";
  return {
    intent: "daily_status",
    matched_phrases: matched,
    response_text: text,
    cta: ctaDaily(ctx),
    source: `daily_operating_brief:${source}`,
  };
}

function summarizeBriefShort(b: DailyBriefRow): string {
  const parts: string[] = [];
  parts.push(`Oggi: ${b.implemented_today.length} azioni completate.`);
  parts.push(
    `${b.open_actions_summary.suggested + b.open_actions_summary.pending} action aperte, ${b.open_actions_summary.high_risk} ad alto rischio.`,
  );
  if (b.email_summary.available) {
    parts.push(
      `${b.email_summary.total_today} email oggi, ${b.email_summary.high_priority_today} ad alta priorità.`,
    );
  }
  if (b.warnings_summary.total > 0) {
    parts.push(
      `${b.warnings_summary.error} errori e ${b.warnings_summary.warning} warning attivi.`,
    );
  }
  return parts.join(" ");
}

async function respondNextActions(
  ctx: JackCommandContext,
  matched: string[],
): Promise<JackCommandResult> {
  const brief = await getTodayOperatingBrief(ctx.brainId);
  if (brief && brief.next_actions.length > 0) {
    const top = brief.next_actions.slice(0, 3);
    const text =
      `Prossime ${top.length} azioni: ` +
      top.map((a, i) => `${i + 1}. ${a.title}`).join(". ") +
      ". Devi approvarle manualmente in Action Queue.";
    return {
      intent: "next_actions",
      matched_phrases: matched,
      response_text: text,
      cta: { label: "Apri Action Queue", to: "/action-queue" },
      source: "daily_brief.next_actions",
    };
  }
  // Fallback: action queue diretta
  try {
    let q = supabase
      .from("automation_actions")
      .select("title,priority,status")
      .in("status", ["suggested", "pending_approval", "approved"])
      .order("created_at", { ascending: false })
      .limit(3);
    if (ctx.brainId) q = q.eq("brain_id", ctx.brainId);
    const { data } = await q;
    const rows = (data ?? []) as Array<{ title: string }>;
    if (rows.length === 0) {
      return {
        intent: "next_actions",
        matched_phrases: matched,
        response_text:
          "Non vedo prossime azioni aperte. Puoi generare un nuovo Daily Brief per scoprirne di nuove.",
        cta: ctaDaily(ctx),
        source: "empty",
      };
    }
    const text =
      `Hai ${rows.length} azioni in coda: ` +
      rows.map((r, i) => `${i + 1}. ${r.title}`).join(". ") +
      ". Da approvare manualmente.";
    return {
      intent: "next_actions",
      matched_phrases: matched,
      response_text: text,
      cta: { label: "Apri Action Queue", to: "/action-queue" },
      source: "action_queue",
    };
  } catch {
    return {
      intent: "next_actions",
      matched_phrases: matched,
      response_text: "Non riesco a leggere la coda azioni adesso.",
      cta: { label: "Apri Action Queue", to: "/action-queue" },
      source: "error",
    };
  }
}

async function respondEmailSummary(
  ctx: JackCommandContext,
  matched: string[],
): Promise<JackCommandResult> {
  const brief = await getTodayOperatingBrief(ctx.brainId);
  const cta: JackCommandCTA = {
    label: "Apri Gmail Connector",
    to: "/gmail-connector",
    search: { brain: ctx.brainId ?? undefined },
  };
  if (brief && brief.email_summary.available) {
    const e = brief.email_summary;
    const text =
      `Oggi ${e.total_today} email su ${e.account ?? "Gmail"}. ` +
      `${e.high_priority_today} ad alta priorità, ${e.with_action_today} con action suggerita, ${e.without_action_today} ancora da valutare.`;
    return {
      intent: "email_summary",
      matched_phrases: matched,
      response_text: text,
      cta,
      source: "daily_brief.email_summary",
    };
  }
  return {
    intent: "email_summary",
    matched_phrases: matched,
    response_text:
      "Gmail non risulta collegato o non c'è ancora un briefing di oggi. Apri il Gmail Connector per verificare.",
    cta,
    source: "gmail_missing",
  };
}

async function respondWarnings(
  ctx: JackCommandContext,
  matched: string[],
): Promise<JackCommandResult> {
  const brief = await getTodayOperatingBrief(ctx.brainId);
  const cta: JackCommandCTA = { label: "Apri Loop QA", to: "/loop-qa" };
  if (brief) {
    const w = brief.warnings_summary;
    if (w.total === 0) {
      return {
        intent: "warnings_status",
        matched_phrases: matched,
        response_text: "Tutto pulito: nessun warning attivo in Loop QA.",
        cta,
        source: "loop_qa.empty",
      };
    }
    const top = w.top.slice(0, 3);
    const text =
      `Ci sono ${w.error} errori, ${w.warning} warning e ${w.info} info. ` +
      (top.length > 0
        ? "I principali: " +
          top.map((t, i) => `${i + 1}. ${t.title}`).join(". ") +
          "."
        : "");
    return {
      intent: "warnings_status",
      matched_phrases: matched,
      response_text: text,
      cta,
      source: "daily_brief.warnings",
    };
  }
  return {
    intent: "warnings_status",
    matched_phrases: matched,
    response_text:
      "Non c'è ancora un briefing di oggi. Genera il Daily Brief per vedere i warning aggregati.",
    cta,
    source: "missing",
  };
}

async function respondTelegram(
  ctx: JackCommandContext,
  matched: string[],
): Promise<JackCommandResult> {
  const brief = await getTodayOperatingBrief(ctx.brainId);
  const cta: JackCommandCTA = {
    label: "Apri Telegram Approvals",
    to: "/telegram-approvals",
  };
  if (brief) {
    const a = brief.automation_summary;
    const text = `Telegram oggi: ${a.telegram_approved_today} approvate, ${a.telegram_rejected_today} rifiutate, ${a.telegram_pending} in attesa, ${a.telegram_failed} fallite.`;
    return {
      intent: "telegram_status",
      matched_phrases: matched,
      response_text: text,
      cta,
      source: "daily_brief.automation",
    };
  }
  return {
    intent: "telegram_status",
    matched_phrases: matched,
    response_text:
      "Non c'è ancora un briefing di oggi. Apri Telegram Approvals per vedere lo stato.",
    cta,
    source: "missing",
  };
}

async function respondMasterSnapshot(
  ctx: JackCommandContext,
  matched: string[],
): Promise<JackCommandResult> {
  const cta: JackCommandCTA = {
    label: "Apri Master Snapshot",
    to: "/master-snapshot",
  };
  try {
    let q = supabase
      .from("master_snapshot_versions")
      .select("version_label,version_status,reason,updated_at,created_at")
      .order("created_at", { ascending: false })
      .limit(5);
    if (ctx.brainId) q = q.eq("brain_id", ctx.brainId);
    const { data } = await q;
    const rows = (data ?? []) as Array<{
      version_label: string;
      version_status: string;
      reason: string | null;
      updated_at: string;
    }>;
    const current =
      rows.find((r) => r.version_status === "current") ?? rows[0] ?? null;
    if (!current) {
      return {
        intent: "master_snapshot",
        matched_phrases: matched,
        response_text:
          "Non trovo nessun Master Snapshot per questo contesto. Puoi crearne uno dal pannello dedicato.",
        cta,
        source: "empty",
      };
    }
    const when = new Date(current.updated_at).toLocaleString();
    const text = `Ultimo Master Snapshot: ${current.version_label}, stato ${current.version_status}, aggiornato il ${when}.`;
    return {
      intent: "master_snapshot",
      matched_phrases: matched,
      response_text: text,
      cta,
      source: "master_snapshot",
    };
  } catch {
    return {
      intent: "master_snapshot",
      matched_phrases: matched,
      response_text: "Non riesco a leggere il Master Snapshot adesso.",
      cta,
      source: "error",
    };
  }
}

function ctaDaily(ctx: JackCommandContext): JackCommandCTA {
  return {
    label: "Apri Daily Brief",
    to: "/daily-brief",
    search: { brain: ctx.brainId ?? undefined },
  };
}

export function buildJackCommandResponse(
  intent: JackIntent,
  text: string,
  cta: JackCommandCTA | null = null,
): JackCommandResult {
  return {
    intent,
    matched_phrases: [],
    response_text: text,
    cta,
    source: "manual",
  };
}

// ---------------- Event log ----------------

export type JackVoiceCommandEvent =
  | "jack_voice_command_opened"
  | "jack_voice_listening_started"
  | "jack_voice_listening_stopped"
  | "jack_voice_transcript_received"
  | "jack_voice_intent_resolved"
  | "jack_voice_response_generated"
  | "jack_voice_response_spoken"
  | "jack_voice_command_failed";

function redactTranscript(t: string): string {
  return t
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "[redacted]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]")
    .slice(0, 160);
}

export async function logJackVoiceCommandEvent(
  event: JackVoiceCommandEvent,
  notes: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (!userId) return;
    const safeMeta: Record<string, unknown> = { ...metadata };
    if (typeof safeMeta.transcript === "string") {
      safeMeta.transcript_preview = redactTranscript(safeMeta.transcript);
      delete safeMeta.transcript;
    }
    await supabase.from("clipboard_execution_logs").insert({
      user_id: userId,
      clipboard_item_id: null,
      action: event as never,
      notes,
      metadata: safeMeta,
    } as never);
  } catch {
    // non-blocking
  }
}
