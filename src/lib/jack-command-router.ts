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
import {
  extractProjectMention,
  resolveProjectAlias,
  type BrainRef,
  type ProjectResolution,
} from "@/lib/project-aliases";
import {
  getJackMemoryContext,
  getCurrentJackMemoryDocument,
  extractProjectAliasesFromMemory,
  buildNaturalIdentityResponse,
  buildNaturalJackRulesResponse,
  buildNaturalProjectMemoryResponse,
  cleanMemoryMarkdownForSpeech,
  detectMemoryIntent,
  extractMemoryEntryFromTranscript,
  createJackMemoryEntry,
  listJackMemoryEntries,
  searchJackMemoryEntries,
  findSimilarMemoryEntries,
  archiveJackMemoryEntry,
} from "@/lib/jack-memory";

export type JackIntent =
  | "daily_status"
  | "next_actions"
  | "email_summary"
  | "warnings_status"
  | "telegram_status"
  | "master_snapshot"
  | "project_status"
  | "project_next_actions"
  | "project_recent_activity"
  | "multi_project_status"
  | "identity"
  | "jack_rules"
  | "memory_save"
  | "memory_forget"
  | "memory_search"
  | "memory_update"
  | "unknown";

export type JackCommandCTA = {
  label: string;
  to: string;
  search?: Record<string, string | undefined>;
};

export type ResolvedProjectInfo = {
  brain: BrainRef | null;
  resolution: ProjectResolution;
  mention: string | null;
};

export type JackCommandResult = {
  intent: JackIntent;
  matched_phrases: string[];
  response_text: string;
  cta: JackCommandCTA | null;
  source: string;
  project?: ResolvedProjectInfo | null;
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
  project_status: [
    "a che punto siamo con",
    "a che punto siamo su",
    "com'è messo",
    "come e messo",
    "com'è messa",
    "come e messa",
    "stato di",
    "stato del",
    "stato della",
    "come va",
  ],
  project_next_actions: [
    "cosa devo fare su",
    "cosa devo fare con",
    "prossime azioni su",
    "prossime azioni di",
    "priorita di",
    "priorità di",
    "cosa manca su",
    "cosa manca a",
  ],
  project_recent_activity: [
    "cosa abbiamo fatto su",
    "cosa abbiamo fatto con",
    "cosa è successo oggi su",
    "cosa e successo oggi su",
    "cosa abbiamo implementato su",
    "attività recenti",
    "attivita recenti",
  ],
  multi_project_status: [
    "tutti i progetti",
    "come sono messi i progetti",
    "fammi il punto di tutti",
    "confronta",
    "confronto tra",
    "quali progetti sono bloccati",
    "stato dei progetti",
  ],
  identity: [
    "chi sono io",
    "chi sono",
    "chi è federico",
    "chi e federico",
    "presentati",
    "chi sei",
    "cosa sai di me",
    "cosa sai su di me",
    "cosa devi sapere di me",
    "memoria jack",
    "che memoria hai",
  ],
  jack_rules: [
    "regole jack",
    "che regole devi seguire",
    "quali regole segui",
    "come devi comportarti",
    "cosa non devi fare",
  ],
  memory_save: [
    "memorizza che",
    "ricorda che",
    "ricordati che",
    "salva questa cosa",
    "salva che",
    "tieni a mente che",
    "annota che",
    "da ora in poi",
    "aggiorna la memoria",
  ],
  memory_forget: [
    "dimentica che",
    "non ricordare piu",
    "non ricordare più",
    "cancella la memoria",
    "rimuovi la memoria",
  ],
  memory_search: [
    "cosa ti ricordi di",
    "cosa ricordi di",
    "che memoria hai di",
    "hai memoria di",
  ],
  memory_update: [
    "aggiorna la memoria con",
    "correggi la memoria",
    "modifica la memoria",
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
    "A che punto siamo con Brain Hub?",
    "Cosa manca su Furia?",
    "Come sono messi tutti i progetti?",
  ];
}

export type JackCommandContext = {
  brainId: string | null;
  currentBrief?: DailyBriefRow | null;
  brains?: BrainRef[];
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
    // Resolve potential project mention (used by project_* intents and as upgrade signal)
    const brains = context.brains ?? [];
    const mention = extractProjectMention(transcript);
    let resolution: ProjectResolution = mention && brains.length > 0
      ? resolveProjectAlias(mention, brains)
      : { kind: "none" };

    // Fallback: try memory-derived aliases if direct resolution failed
    if (resolution.kind === "none" && mention && brains.length > 0) {
      try {
        const memDoc = await getCurrentJackMemoryDocument();
        if (memDoc) {
          const memAliases = extractProjectAliasesFromMemory(memDoc.content_markdown);
          const hit = memAliases.find((a) => mention.toLowerCase().includes(a.alias));
          if (hit) {
            resolution = resolveProjectAlias(hit.target, brains);
          }
        }
      } catch {
        // best-effort
      }
    }

    const projectInfo: ResolvedProjectInfo = {
      brain: resolution.kind === "resolved" ? resolution.brain : null,
      resolution,
      mention,
    };

    // ---- Explicit memory intent detection (wins over pattern match) ----
    const memHit = detectMemoryIntent(transcript);
    let effectiveIntent: JackIntent = intent;
    if (memHit.kind === "save") effectiveIntent = "memory_save";
    else if (memHit.kind === "forget") effectiveIntent = "memory_forget";
    else if (memHit.kind === "search" && intent !== "identity" && intent !== "jack_rules") {
      effectiveIntent = "memory_search";
    }

    // Auto-upgrade generic intents to project_* when a project is mentioned
    if (
      effectiveIntent === intent &&
      resolution.kind !== "none" &&
      resolution.kind !== "ambiguous"
    ) {
      if (intent === "daily_status") effectiveIntent = "project_status";
      else if (intent === "next_actions") effectiveIntent = "project_next_actions";
    }
    if (
      resolution.kind === "ambiguous" &&
      effectiveIntent !== "memory_save" &&
      effectiveIntent !== "memory_forget" &&
      effectiveIntent !== "memory_search"
    ) {
      return respondProjectAmbiguous(projectInfo, matched);
    }

    switch (effectiveIntent) {
      case "memory_save":
      case "memory_update":
        return await respondMemorySave(transcript, projectInfo, matched);
      case "memory_forget":
        return await respondMemoryForget(transcript, matched);
      case "memory_search":
        return await respondMemorySearch(transcript, projectInfo, matched);
      case "project_status":
        return await respondProjectStatus(context, matched, projectInfo);
      case "project_next_actions":
        return await respondProjectNextActions(context, matched, projectInfo);
      case "project_recent_activity":
        return await respondProjectRecentActivity(context, matched, projectInfo);
      case "multi_project_status":
        return await respondMultiProjectStatus(context, matched);
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
      case "identity":
        return await respondIdentity(matched);
      case "jack_rules":
        return await respondJackRules(matched);
      default:
        return {
          intent: "unknown",
          matched_phrases: [],
          response_text:
            "Non ho capito bene. Puoi chiedermi: a che punto siamo, prossime azioni, email di oggi, warning, stato Telegram, oppure indicare un progetto (es. 'a che punto siamo con Brain Hub').",
          cta: null,
          source: "fallback",
          project: projectInfo,
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
  const brief = (await resolveBrief(ctx)).brief;
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
  const brief = (await resolveBrief(ctx)).brief;
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
  const brief = (await resolveBrief(ctx)).brief;
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
  const brief = (await resolveBrief(ctx)).brief;
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

// ---------------- Project-aware responders ----------------

function ctaProjectConsole(): JackCommandCTA {
  return { label: "Apri Project Console", to: "/project-console" };
}

function ctaActionQueueForBrain(brainId: string | null): JackCommandCTA {
  return {
    label: "Apri Action Queue",
    to: "/action-queue",
    search: brainId ? { brain: brainId } : undefined,
  };
}

function ctaDailyForBrain(brainId: string | null): JackCommandCTA {
  return {
    label: "Apri Daily Brief",
    to: "/daily-brief",
    search: brainId ? { brain: brainId } : undefined,
  };
}

function respondProjectAmbiguous(
  info: ResolvedProjectInfo,
  matched: string[],
): JackCommandResult {
  const cands =
    info.resolution.kind === "ambiguous" ? info.resolution.candidates : [];
  const names = cands.map((c) => c.brain.name).slice(0, 3).join(", ");
  void logJackVoiceCommandEvent(
    "jack_project_alias_ambiguous",
    "Ambiguità progetto Jack",
    { mention: info.mention, candidates: cands.map((c) => c.brain.name) },
  );
  return {
    intent: "project_status",
    matched_phrases: matched,
    response_text: `Ho trovato più progetti possibili: ${names}. Quale vuoi controllare?`,
    cta: ctaProjectConsole(),
    source: "project_ambiguous",
    project: info,
  };
}

function respondProjectNone(matched: string[]): JackCommandResult {
  return {
    intent: "project_status",
    matched_phrases: matched,
    response_text:
      "Non trovo ancora un progetto con quel nome. Vuoi aprire la Project Console?",
    cta: ctaProjectConsole(),
    source: "project_not_found",
    project: null,
  };
}

async function getLatestBriefForBrain(
  brainId: string,
): Promise<DailyBriefRow | null> {
  const today = await getTodayOperatingBrief(brainId);
  if (today) return today;
  const { data } = await supabase
    .from("daily_operating_briefs" as never)
    .select("*")
    .eq("brain_id", brainId)
    .order("brief_date", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0] as DailyBriefRow | undefined;
  return row ?? null;
}

type ActionLite = {
  id: string;
  title: string;
  status: string;
  priority: string;
  risk_level: string;
  created_at: string;
};

async function getOpenActionsForBrain(
  brainId: string,
  limit = 5,
): Promise<ActionLite[]> {
  const { data } = await supabase
    .from("automation_actions")
    .select("id,title,status,priority,risk_level,created_at")
    .eq("brain_id", brainId)
    .in("status", ["suggested", "pending_approval", "approved", "ready_to_execute"])
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as ActionLite[];
}

async function getRecentTimelineForBrain(
  brainId: string,
  limit = 5,
): Promise<Array<{ action: string; notes: string | null; created_at: string }>> {
  // brain_id is filtered via metadata->>brain_id when present
  const sinceIso = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data } = await supabase
    .from("clipboard_execution_logs")
    .select("action,notes,metadata,created_at")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = (data ?? []) as Array<{
    action: string;
    notes: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>;
  return rows
    .filter((r) => {
      const m = r.metadata ?? {};
      const bid = (m as Record<string, unknown>).brain_id;
      return typeof bid === "string" && bid === brainId;
    })
    .slice(0, limit)
    .map((r) => ({ action: r.action, notes: r.notes, created_at: r.created_at }));
}

async function getCurrentSnapshotForBrain(
  brainId: string,
): Promise<{ label: string; updated_at: string } | null> {
  const { data } = await supabase
    .from("master_snapshot_versions")
    .select("version_label,version_status,updated_at,created_at")
    .eq("brain_id", brainId)
    .order("created_at", { ascending: false })
    .limit(5);
  const rows = (data ?? []) as Array<{
    version_label: string;
    version_status: string;
    updated_at: string;
  }>;
  const current =
    rows.find((r) => r.version_status === "current") ?? rows[0] ?? null;
  if (!current) return null;
  return { label: current.version_label, updated_at: current.updated_at };
}

async function respondProjectStatus(
  _ctx: JackCommandContext,
  matched: string[],
  info: ResolvedProjectInfo,
): Promise<JackCommandResult> {
  if (!info.brain) return respondProjectNone(matched);
  void logJackVoiceCommandEvent(
    "jack_project_status_requested",
    `Project status: ${info.brain.name}`,
    { brain_id: info.brain.id, mention: info.mention },
  );

  const [brief, actions, snapshot, timeline] = await Promise.all([
    getLatestBriefForBrain(info.brain.id),
    getOpenActionsForBrain(info.brain.id, 5),
    getCurrentSnapshotForBrain(info.brain.id),
    getRecentTimelineForBrain(info.brain.id, 3),
  ]);

  const parts: string[] = [];
  parts.push(`Federico, su ${info.brain.name}`);
  if (brief) {
    const summary =
      brief.voice_summary_text?.trim() ||
      brief.executive_summary?.slice(0, 320) ||
      "il briefing è presente ma vuoto.";
    parts.push(`il briefing dice: ${summary}`);
  } else {
    parts.push("non c'è ancora un Daily Brief generato.");
  }
  if (actions.length > 0) {
    parts.push(
      `Ci sono ${actions.length} azioni aperte, top: ${actions
        .slice(0, 3)
        .map((a) => a.title)
        .join("; ")}.`,
    );
  } else {
    parts.push("Nessuna azione aperta in coda.");
  }
  if (snapshot) {
    parts.push(`Ultimo Master Snapshot: ${snapshot.label}.`);
  }
  if (timeline.length > 0) {
    parts.push(`Ultime attività: ${timeline.map((t) => t.action).join(", ")}.`);
  }

  let text = parts.join(" ");
  if (text.length > 900) text = text.slice(0, 895) + "...";

  void logJackVoiceCommandEvent(
    "jack_project_status_response_generated",
    "Risposta project_status generata",
    { brain_id: info.brain.id, chars: text.length },
  );

  return {
    intent: "project_status",
    matched_phrases: matched,
    response_text: text,
    cta: ctaDailyForBrain(info.brain.id),
    source: "project_status",
    project: info,
  };
}

async function respondProjectNextActions(
  _ctx: JackCommandContext,
  matched: string[],
  info: ResolvedProjectInfo,
): Promise<JackCommandResult> {
  if (!info.brain) return respondProjectNone(matched);
  const actions = await getOpenActionsForBrain(info.brain.id, 5);
  if (actions.length === 0) {
    return {
      intent: "project_next_actions",
      matched_phrases: matched,
      response_text: `Su ${info.brain.name} non ci sono azioni aperte in coda. Puoi generare un Daily Brief per scoprirne di nuove.`,
      cta: ctaDailyForBrain(info.brain.id),
      source: "project_next_actions_empty",
      project: info,
    };
  }
  const top = actions.slice(0, 3);
  const blockers = actions.filter((a) => a.risk_level === "high").length;
  const text =
    `Su ${info.brain.name} ci sono ${actions.length} azioni aperte. ` +
    `Top: ${top.map((a, i) => `${i + 1}. ${a.title}`).join(". ")}.` +
    (blockers > 0 ? ` ${blockers} ad alto rischio.` : "") +
    " Da approvare manualmente in Action Queue.";
  return {
    intent: "project_next_actions",
    matched_phrases: matched,
    response_text: text,
    cta: ctaActionQueueForBrain(info.brain.id),
    source: "project_next_actions",
    project: info,
  };
}

async function respondProjectRecentActivity(
  _ctx: JackCommandContext,
  matched: string[],
  info: ResolvedProjectInfo,
): Promise<JackCommandResult> {
  if (!info.brain) return respondProjectNone(matched);
  const [timeline, brief] = await Promise.all([
    getRecentTimelineForBrain(info.brain.id, 5),
    getLatestBriefForBrain(info.brain.id),
  ]);
  const impl = brief?.implemented_today ?? [];
  if (timeline.length === 0 && impl.length === 0) {
    return {
      intent: "project_recent_activity",
      matched_phrases: matched,
      response_text: `Su ${info.brain.name} non vedo attività recenti registrate.`,
      cta: ctaDailyForBrain(info.brain.id),
      source: "project_recent_empty",
      project: info,
    };
  }
  const parts: string[] = [`Su ${info.brain.name},`];
  if (impl.length > 0) {
    parts.push(
      `oggi completate: ${impl.slice(0, 3).map((i) => i.action).join(", ")}.`,
    );
  }
  if (timeline.length > 0) {
    parts.push(
      `Eventi recenti: ${timeline.slice(0, 3).map((t) => t.action).join(", ")}.`,
    );
  }
  return {
    intent: "project_recent_activity",
    matched_phrases: matched,
    response_text: parts.join(" "),
    cta: ctaDailyForBrain(info.brain.id),
    source: "project_recent_activity",
    project: info,
  };
}

async function respondMultiProjectStatus(
  ctx: JackCommandContext,
  matched: string[],
): Promise<JackCommandResult> {
  void logJackVoiceCommandEvent(
    "jack_multi_project_status_requested",
    "Multi-project status",
    {},
  );
  const brains = ctx.brains ?? [];
  if (brains.length === 0) {
    return {
      intent: "multi_project_status",
      matched_phrases: matched,
      response_text:
        "Non vedo progetti caricati. Apri la Project Console per crearne o gestirli.",
      cta: ctaProjectConsole(),
      source: "no_brains",
    };
  }
  const perBrain = await Promise.all(
    brains.slice(0, 6).map(async (b) => {
      const [actions, brief] = await Promise.all([
        getOpenActionsForBrain(b.id, 3),
        getLatestBriefForBrain(b.id),
      ]);
      const highRisk = actions.filter((a) => a.risk_level === "high").length;
      const warnings = brief?.warnings_summary.total ?? 0;
      let health: "healthy" | "warning" | "blocked" = "healthy";
      if (highRisk > 0 || warnings >= 3) health = "warning";
      if (highRisk >= 2 && warnings >= 3) health = "blocked";
      return { brain: b, actions, health, brief };
    }),
  );
  const lines = perBrain.map((p) => {
    const next = p.actions[0]?.title;
    const tag =
      p.health === "blocked"
        ? "bloccato"
        : p.health === "warning"
          ? "attenzione"
          : "ok";
    return `${p.brain.name}: ${tag}${next ? `, prossima: ${next}` : ""}`;
  });
  let text = `Stato progetti: ${lines.join("; ")}.`;
  if (text.length > 900) text = text.slice(0, 895) + "...";
  return {
    intent: "multi_project_status",
    matched_phrases: matched,
    response_text: text,
    cta: ctaProjectConsole(),
    source: "multi_project_status",
  };
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
  | "jack_voice_command_failed"
  | "jack_project_intent_resolved"
  | "jack_project_status_requested"
  | "jack_project_status_response_generated"
  | "jack_project_alias_ambiguous"
  | "jack_multi_project_status_requested"
  | "jack_memory_natural_response_generated"
  | "jack_memory_forget_requested"
  | "jack_memory_secret_warning"
  | "jack_memory_entry_used";

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

// ---------------- Identity / Rules / Memory intents (Jack Memory) ----------------

const JACK_MEMORY_CTA: JackCommandCTA = { label: "Apri Jack Memory", to: "/jack-memory" };

async function respondIdentity(matched: string[]): Promise<JackCommandResult> {
  try {
    const ctxMem = await getJackMemoryContext({
      scopes: ["identity", "behavior"],
      maxChars: 1200,
    });
    let text = buildNaturalIdentityResponse(ctxMem);
    // v3.13: enrich with active + safe (non-secret) memory entries.
    try {
      const entries = await listJackMemoryEntries({ status: "active", limit: 30 });
      const safe = entries
        .filter((e) => (e.sensitivity ?? "normal") !== "secret")
        .slice(0, 4)
        .map((e) => cleanMemoryMarkdownForSpeech(e.content))
        .filter(Boolean);
      if (safe.length > 0) {
        text = `${text} Inoltre ricordo: ${safe.join("; ")}.`;
        void logJackVoiceCommandEvent(
          "jack_classic_memory_entries_used" as JackVoiceCommandEvent,
          "Entries fuse nella risposta identity",
          { entries: safe.length },
        );
      }
    } catch {
      // entries enrichment best-effort
    }
    void logJackVoiceCommandEvent(
      "jack_memory_natural_response_generated" as JackVoiceCommandEvent,
      "Identity naturale",
      { chars: text.length, status: ctxMem.status },
    );
    return {
      intent: "identity",
      matched_phrases: matched,
      response_text: text,
      cta: JACK_MEMORY_CTA,
      source: ctxMem.status === "missing" ? "jack_memory_missing" : "jack_memory_natural",
    };
  } catch {
    return {
      intent: "identity",
      matched_phrases: matched,
      response_text:
        "Non sono riuscito a leggere la memoria operativa. Apri Jack Memory per verificarla.",
      cta: JACK_MEMORY_CTA,
      source: "error",
    };
  }
}

async function respondJackRules(matched: string[]): Promise<JackCommandResult> {
  try {
    const ctxMem = await getJackMemoryContext({
      scopes: ["behavior"],
      maxChars: 1500,
    });
    const text = buildNaturalJackRulesResponse(ctxMem);
    void logJackVoiceCommandEvent(
      "jack_memory_natural_response_generated" as JackVoiceCommandEvent,
      "Regole naturali",
      { chars: text.length },
    );
    return {
      intent: "jack_rules",
      matched_phrases: matched,
      response_text: text,
      cta: JACK_MEMORY_CTA,
      source: "jack_memory_rules_natural",
    };
  } catch {
    return {
      intent: "jack_rules",
      matched_phrases: matched,
      response_text:
        "Non riesco a leggere le regole operative adesso. Apri Jack Memory per controllare.",
      cta: JACK_MEMORY_CTA,
      source: "error",
    };
  }
}

async function respondMemorySave(
  transcript: string,
  project: ResolvedProjectInfo,
  matched: string[],
): Promise<JackCommandResult> {
  const extracted = extractMemoryEntryFromTranscript(transcript);
  if (!extracted.content || extracted.content.length < 4) {
    return {
      intent: "memory_save",
      matched_phrases: matched,
      response_text:
        "Dimmi cosa devo memorizzare. Per esempio: 'memorizza che Furia e Pupillo devono restare separati'.",
      cta: JACK_MEMORY_CTA,
      source: "memory_save_empty",
      project,
    };
  }
  const projectName = project.brain?.name ?? null;
  try {
    const res = await createJackMemoryEntry({
      content: extracted.content,
      category: extracted.category,
      sensitivity: extracted.sensitivity,
      project_name: projectName,
      brain_id: project.brain?.id ?? null,
      source: "voice_conversation",
    });
    if (res.kind === "needs_confirmation") {
      void logJackVoiceCommandEvent(
        "jack_memory_secret_warning" as JackVoiceCommandEvent,
        "Memoria con possibile segreto: richiesta conferma",
        { category: extracted.category },
      );
      return {
        intent: "memory_save",
        matched_phrases: matched,
        response_text:
          "Aspetta Federico: questa nota sembra contenere una chiave o un segreto. L'ho salvata come suggerimento, ma non la userò finché non la approvi manualmente in Jack Memory.",
        cta: JACK_MEMORY_CTA,
        source: "memory_save_secret_warning",
        project,
      };
    }
    const projectSuffix = projectName
      ? ` Quando parleremo di ${projectName} la terrò in considerazione.`
      : "";
    return {
      intent: "memory_save",
      matched_phrases: matched,
      response_text: `Perfetto Federico, l'ho salvato nella memoria di Jack come ${describeCategory(extracted.category)}.${projectSuffix}`,
      cta: JACK_MEMORY_CTA,
      source: "memory_save_created",
      project,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      intent: "memory_save",
      matched_phrases: matched,
      response_text: `Non sono riuscito a salvare quella memoria: ${msg}. Riprova o aggiungila a mano da Jack Memory.`,
      cta: JACK_MEMORY_CTA,
      source: "error",
      project,
    };
  }
}

function describeCategory(c: string): string {
  switch (c) {
    case "project_rule":
      return "regola operativa di progetto";
    case "preference":
      return "preferenza personale";
    case "communication_style":
      return "regola di stile comunicativo";
    case "safety_rule":
      return "regola di sicurezza";
    case "tooling":
      return "nota sugli strumenti";
    case "business_context":
      return "contesto business";
    case "project_context":
      return "contesto di progetto";
    case "identity":
      return "nota identitaria";
    default:
      return "nota operativa";
  }
}

async function respondMemoryForget(
  transcript: string,
  matched: string[],
): Promise<JackCommandResult> {
  void logJackVoiceCommandEvent(
    "jack_memory_forget_requested" as JackVoiceCommandEvent,
    "Forget requested",
    {},
  );
  const { payload } = detectMemoryIntent(transcript);
  const target = payload.replace(/^che\s+/i, "").trim();
  if (!target) {
    return {
      intent: "memory_forget",
      matched_phrases: matched,
      response_text:
        "Dimmi cosa devo dimenticare. Per esempio: 'dimentica che Furia e Pupillo sono collegati'.",
      cta: JACK_MEMORY_CTA,
      source: "memory_forget_empty",
    };
  }
  try {
    const candidates = await findSimilarMemoryEntries(target);
    if (candidates.length === 0) {
      return {
        intent: "memory_forget",
        matched_phrases: matched,
        response_text:
          "Non trovo nessuna memoria attiva che corrisponda. Controlla nella pagina Jack Memory.",
        cta: JACK_MEMORY_CTA,
        source: "memory_forget_no_match",
      };
    }
    if (candidates.length === 1) {
      await archiveJackMemoryEntry(candidates[0].id);
      return {
        intent: "memory_forget",
        matched_phrases: matched,
        response_text:
          "Ho archiviato quella memoria. Non la userò più nelle risposte operative.",
        cta: JACK_MEMORY_CTA,
        source: "memory_forget_archived",
      };
    }
    const preview = candidates
      .slice(0, 3)
      .map((c, i) => `${i + 1}. ${c.content.slice(0, 80)}`)
      .join("; ");
    return {
      intent: "memory_forget",
      matched_phrases: matched,
      response_text: `Ho trovato ${candidates.length} memorie simili: ${preview}. Quale vuoi che archivi? Puoi farlo direttamente da Jack Memory.`,
      cta: JACK_MEMORY_CTA,
      source: "memory_forget_ambiguous",
    };
  } catch (e) {
    return {
      intent: "memory_forget",
      matched_phrases: matched,
      response_text: `Non sono riuscito ad aggiornare la memoria: ${e instanceof Error ? e.message : String(e)}.`,
      cta: JACK_MEMORY_CTA,
      source: "error",
    };
  }
}

async function respondMemorySearch(
  transcript: string,
  project: ResolvedProjectInfo,
  matched: string[],
): Promise<JackCommandResult> {
  try {
    const ctxMem = await getJackMemoryContext({ scopes: ["all"], maxChars: 1500 });
    if (project.brain) {
      const entries = await listJackMemoryEntries({
        status: ["active", "suggested"],
        project_name: project.brain.name,
      });
      const text = buildNaturalProjectMemoryResponse(project.brain.name, ctxMem, entries);
      void logJackVoiceCommandEvent(
        "jack_memory_entry_used" as JackVoiceCommandEvent,
        "Memoria di progetto richiamata",
        { brain_id: project.brain.id, entries: entries.length },
      );
      return {
        intent: "memory_search",
        matched_phrases: matched,
        response_text: text,
        cta: JACK_MEMORY_CTA,
        source: "memory_search_project",
        project,
      };
    }
    const { payload } = detectMemoryIntent(transcript);
    const q = payload.trim();
    const hits = q ? await searchJackMemoryEntries(q) : [];
    if (hits.length === 0) {
      return {
        intent: "memory_search",
        matched_phrases: matched,
        response_text:
          "Non trovo memorie specifiche su quel tema. Puoi aggiungerne dicendo 'memorizza che…'.",
        cta: JACK_MEMORY_CTA,
        source: "memory_search_empty",
      };
    }
    const text =
      "Ecco cosa ricordo: " +
      hits.slice(0, 5).map((h) => h.content).join("; ");
    return {
      intent: "memory_search",
      matched_phrases: matched,
      response_text: text.slice(0, 900),
      cta: JACK_MEMORY_CTA,
      source: "memory_search_entries",
    };
  } catch (e) {
    return {
      intent: "memory_search",
      matched_phrases: matched,
      response_text: `Non riesco a leggere la memoria: ${e instanceof Error ? e.message : String(e)}.`,
      cta: JACK_MEMORY_CTA,
      source: "error",
    };
  }
}
