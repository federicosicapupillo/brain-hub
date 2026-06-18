// ============================================================
// Brain Hub v3.14 — Jack Controlled Actions (server functions)
// ============================================================
// Turns voice commands into auditable suggested actions.
// NEVER executes external operations: it only writes
//   - automation_actions (status='suggested')
//   - master_snapshot_versions (status='draft_update')
//   - telegram_approval_requests (status='draft' / 'ready_to_send')
// All payloads are sanitized; OPENAI_API_KEY etc. stay server-only.
// ============================================================

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  classifyJackCommand,
  planControlledJackAction,
  type JackCommandContextHint,
  type JackControlledPlan,
} from "@/lib/jack-command-intents";
import {
  buildJackActionIdempotencyKey,
  type PendingJackActionPreview,
} from "@/lib/jack-action-confirmation";

// ---------- Types ----------

export type CreateControlledActionInput = {
  command_text: string;
  brain_id?: string | null;
  project_id?: string | null;
  delivery_preference?: "telegram" | "ui_only" | null;
  notes?: string | null;
  // v3.19.3 — confirmation gate
  confirmed?: boolean;
  source_warning_id?: string | null;
  idempotency_key?: string | null;
};

export type CreateControlledActionResult = {
  ok: boolean;
  blocked?: boolean;
  reason?: string;
  preview?: PendingJackActionPreview | null;
  deduplicated?: boolean;
  action_id: string | null;
  intent: string;
  secondary_intent: string | null;
  risk_level: string;
  requires_approval: boolean;
  recommended_tool: string;
  next_step: string;
  safe_message: string;
  master_snapshot_draft_id: string | null;
  telegram_delivery_id: string | null;
  research_handoff: boolean;
  missing_information: string[];
  unsafe_request: boolean;
  idempotency_key?: string;
};

export type PrepareMasterSnapshotInput = {
  brain_id?: string | null;
  reason?: string | null;
  summary?: string | null;
};

export type PrepareMasterSnapshotResult = {
  ok: boolean;
  draft_id: string | null;
  cta_path: string;
  action_id: string | null;
  missing_information: string[];
  safe_message: string;
};

// ---------- Helpers ----------

type Sb = {
  from: (t: string) => {
    select: (cols?: string) => unknown;
    insert: (v: unknown) => unknown;
    update?: (v: unknown) => unknown;
  };
};

function sanitizeText(input: string, max = 800): string {
  let out = input ?? "";
  out = out.replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED]");
  out = out.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED]");
  out = out.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]");
  out = out.replace(/\b\d{9,}:[A-Za-z0-9_-]{30,}\b/g, "[REDACTED]");
  if (out.length > max) out = out.slice(0, max - 1) + "…";
  return out;
}

async function hasTelegramConnector(
  supabase: unknown,
  userId: string,
): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const res = await sb
      .from("telegram_connection_settings")
      .select("id,is_enabled")
      .eq("user_id", userId)
      .eq("is_enabled", true)
      .limit(1);
    const rows = (res?.data ?? []) as Array<{ id: string }>;
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function insertAction(
  supabase: unknown,
  userId: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const res = await sb
      .from("automation_actions")
      .insert({ ...payload, user_id: userId })
      .select("id")
      .single();
    return (res?.data?.id as string) ?? null;
  } catch {
    return null;
  }
}



async function findExistingActionByIdempotencyKey(
  supabase: unknown,
  userId: string,
  brainId: string | null,
  idempotencyKey: string,
): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    let q = sb
      .from("automation_actions")
      .select("id,status,metadata")
      .eq("user_id", userId)
      .eq("metadata->>jack_idempotency_key", idempotencyKey)
      .not("status", "in", "(completed,cancelled,failed,rejected,archived)")
      .limit(1);
    if (brainId) q = q.eq("brain_id", brainId);
    const res = await q;
    const rows = (res?.data ?? []) as Array<{ id: string }>;
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function logSanitizedEvent(
  supabase: unknown,
  userId: string,
  event: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from("agent_event_log")
      .insert({ user_id: userId, event_type: event, metadata });
  } catch {
    // best-effort
  }
}


async function insertTelegramApproval(
  supabase: unknown,
  userId: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const res = await sb
      .from("telegram_approval_requests")
      .insert({ ...payload, user_id: userId })
      .select("id")
      .single();
    return (res?.data?.id as string) ?? null;
  } catch {
    return null;
  }
}

async function readLatestDailyBrief(
  supabase: unknown,
  userId: string,
  brainId: string | null,
): Promise<{
  brief_date: string | null;
  executive_summary: string | null;
  next_actions: unknown;
} | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    let q = sb
      .from("daily_operating_briefs")
      .select("brief_date,executive_summary,next_actions")
      .eq("user_id", userId)
      .order("brief_date", { ascending: false })
      .limit(1);
    if (brainId) q = q.eq("brain_id", brainId);
    const res = await q;
    const row = ((res?.data ?? []) as Array<{
      brief_date: string;
      executive_summary: string | null;
      next_actions: unknown;
    }>)[0];
    return row ?? null;
  } catch {
    return null;
  }
}

async function readCurrentMasterSnapshot(
  supabase: unknown,
  userId: string,
  brainId: string | null,
): Promise<{
  id: string;
  title: string;
  version_label: string;
  markdown_content: string;
} | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    let q = sb
      .from("master_snapshot_versions")
      .select("id,title,version_label,markdown_content,brain_id")
      .eq("user_id", userId)
      .eq("version_status", "current")
      .order("created_at", { ascending: false })
      .limit(1);
    if (brainId) q = q.eq("brain_id", brainId);
    const res = await q;
    const row = ((res?.data ?? []) as Array<{
      id: string;
      title: string;
      version_label: string;
      markdown_content: string;
    }>)[0];
    return row ?? null;
  } catch {
    return null;
  }
}

function nextDraftLabel(current: string | null): string {
  if (!current) return "1.0-draft";
  const m = current.match(/^(\d+)\.(\d+)$/);
  if (!m) return `${current}.1-draft`;
  return `${m[1]}.${Number(m[2]) + 1}-draft`;
}

async function createMasterSnapshotDraft(
  supabase: unknown,
  userId: string,
  brainId: string | null,
  reason: string,
  summary: string,
  daily: { brief_date: string | null; executive_summary: string | null; next_actions: unknown } | null,
): Promise<string | null> {
  const current = await readCurrentMasterSnapshot(supabase, userId, brainId);
  const base = current?.markdown_content ?? "# Brain Hub — Master Project Snapshot\n\n_Documento iniziale._\n";
  const today = new Date().toISOString().slice(0, 10);
  const appendBlock = [
    "",
    "",
    `## Aggiornamento ${today} (proposto da Jack Voice)`,
    "",
    `**Motivo:** ${sanitizeText(reason, 200)}`,
    summary ? `\n**Riepilogo richiesto:** ${sanitizeText(summary, 400)}` : "",
    daily?.executive_summary
      ? `\n**Daily Brief (${daily.brief_date ?? today}):** ${sanitizeText(daily.executive_summary, 400)}`
      : "\n**Daily Brief:** non disponibile.",
    "",
    "_Bozza — non promossa a corrente. Approvazione manuale richiesta._",
    "",
  ].join("\n");
  const markdown = base + appendBlock;
  const versionLabel = nextDraftLabel(current?.version_label ?? null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const res = await sb
      .from("master_snapshot_versions")
      .insert({
        user_id: userId,
        brain_id: brainId,
        title: current?.title ?? "Brain Hub — Master Project Snapshot",
        version_label: versionLabel,
        version_status: "draft_update",
        markdown_content: markdown,
        summary: sanitizeText(summary, 400),
        reason: sanitizeText(reason, 200),
        source: "manual",
        previous_version_id: current?.id ?? null,
        changes: {
          what_changed: "Bozza proposta da Jack Voice (controlled)",
          next_step: "Review manuale in /master-snapshot",
        },
        metadata: { source_module: "jack_voice_controlled" },
      })
      .select("id")
      .single();
    return (res?.data?.id as string) ?? null;
  } catch {
    return null;
  }
}

// ---------- Tool: create_controlled_action ----------

export const createControlledJackAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d as CreateControlledActionInput)
  .handler(async ({ data, context }): Promise<CreateControlledActionResult> => {
    const { supabase, userId } = context;
    const commandText = sanitizeText(String(data.command_text ?? "").trim(), 1200);
    const brainId = data.brain_id ?? null;
    const projectId = data.project_id ?? null;

    const tgConfigured = await hasTelegramConnector(supabase, userId);
    const hint: JackCommandContextHint = {
      brainId,
      hasTelegramConnector: tgConfigured,
      hasPerplexityConnector: false, // no live integration yet
    };

    const plan: JackControlledPlan = planControlledJackAction(commandText, hint);
    const c = plan.classification;

    // ---------- v3.19.3 Confirmation Gate ----------
    const idempotencyKey =
      data.idempotency_key ??
      buildJackActionIdempotencyKey({
        userId,
        brainId,
        source: "jack_voice_controlled",
        sourceWarningId: data.source_warning_id ?? null,
        title: c.action_candidate.title,
      });

    const preview: PendingJackActionPreview = {
      intent: "create_controlled_action",
      title: c.action_candidate.title,
      description: sanitizeText(c.action_candidate.description, 600),
      source: "jack_voice_controlled",
      reason: plan.safe_message,
      risk_level: (["low", "medium", "high"].includes(c.risk_level)
        ? c.risk_level
        : "medium") as "low" | "medium" | "high",
      requires_confirmation: true,
      confirmation_status: "pending",
      idempotency_key: idempotencyKey,
      brain_id: brainId,
      project_id: projectId,
      command_preview: sanitizeText(commandText, 280),
      generated_at: new Date().toISOString(),
    };

    if (data.confirmed !== true) {
      await logSanitizedEvent(supabase, userId, "jack_action_preview_created", {
        brain_id: brainId,
        source: "jack_voice_controlled",
        risk_level: preview.risk_level,
        idempotency_key_preview: idempotencyKey.slice(0, 32),
        intent: c.intent,
      });
      await logSanitizedEvent(supabase, userId, "jack_action_confirmation_required", {
        brain_id: brainId,
        idempotency_key_preview: idempotencyKey.slice(0, 32),
      });
      await logSanitizedEvent(
        supabase,
        userId,
        "jack_action_creation_blocked_missing_confirmation",
        {
          brain_id: brainId,
          reason: "confirmation_required",
          idempotency_key_preview: idempotencyKey.slice(0, 32),
        },
      );
      return {
        ok: false,
        blocked: true,
        reason: "confirmation_required",
        preview,
        action_id: null,
        intent: c.intent,
        secondary_intent: c.secondary_intent,
        risk_level: c.risk_level,
        requires_approval: c.requires_approval,
        recommended_tool: c.recommended_tool,
        next_step: plan.next_step,
        safe_message:
          "Ti propongo una action. Conferma esplicitamente (es. 'sì, confermo, creala') per crearla in Action Queue.",
        master_snapshot_draft_id: null,
        telegram_delivery_id: null,
        research_handoff: c.intent === "market_research",
        missing_information: c.missing_information,
        unsafe_request: c.unsafe_request,
        idempotency_key: idempotencyKey,
      };
    }

    await logSanitizedEvent(supabase, userId, "jack_action_confirmation_received", {
      brain_id: brainId,
      idempotency_key_preview: idempotencyKey.slice(0, 32),
    });

    // Idempotency check: reuse existing open action with same key.
    const existingId = await findExistingActionByIdempotencyKey(
      supabase,
      userId,
      brainId,
      idempotencyKey,
    );
    if (existingId) {
      await logSanitizedEvent(supabase, userId, "jack_write_tool_duplicate_prevented", {
        brain_id: brainId,
        tool_name: "create_controlled_action",
        idempotency_key_preview: idempotencyKey.slice(0, 32),
        action_id: existingId,
      });
      return {
        ok: true,
        deduplicated: true,
        action_id: existingId,
        intent: c.intent,
        secondary_intent: c.secondary_intent,
        risk_level: c.risk_level,
        requires_approval: c.requires_approval,
        recommended_tool: c.recommended_tool,
        next_step: plan.next_step,
        safe_message: "Action già esistente in coda: nessuna duplicata creata.",
        master_snapshot_draft_id: null,
        telegram_delivery_id: null,
        research_handoff: c.intent === "market_research",
        missing_information: c.missing_information,
        unsafe_request: c.unsafe_request,
        idempotency_key: idempotencyKey,
      };
    }

    // Always create the main suggested action.
    const metadata: Record<string, unknown> = {
      source_module: "jack_voice_controlled",
      jack_intent: c.intent,
      jack_secondary_intent: c.secondary_intent,
      jack_risk_level: c.risk_level,
      jack_requires_approval: c.requires_approval,
      jack_recommended_tool: c.recommended_tool,
      jack_recommended_flow: c.recommended_flow,
      jack_delivery: c.delivery,
      jack_unsafe_request: c.unsafe_request,
      jack_missing_information: c.missing_information,
      jack_action_type_semantic: c.action_candidate.action_type,
      jack_plan_steps: plan.steps,
      jack_research_brief: plan.research_brief ?? null,
      jack_master_snapshot_hint: plan.master_snapshot_draft_hint ?? null,
      jack_telegram_hint: plan.telegram_delivery_hint ?? null,
      jack_command_preview: sanitizeText(commandText, 280),
      jack_safe_message: plan.safe_message,
      jack_next_step: plan.next_step,
      jack_notes: data.notes ? sanitizeText(data.notes, 280) : null,
      jack_idempotency_key: idempotencyKey,
      jack_source_warning_id: data.source_warning_id ?? null,
      jack_confirmed: true,
    };

    const actionId = await insertAction(supabase, userId, {
      brain_id: brainId,
      project_id: projectId,
      source: "system_suggestion",
      action_type: "manual_task",
      title: c.action_candidate.title,
      description: sanitizeText(c.action_candidate.description, 600),
      priority: c.action_candidate.priority,
      risk_level: c.risk_level,
      status: "suggested",
      requires_confirmation: c.requires_approval,
      metadata,
    });

    if (actionId) {
      await logSanitizedEvent(supabase, userId, "jack_controlled_action_created", {
        brain_id: brainId,
        action_id: actionId,
        risk_level: c.risk_level,
        intent: c.intent,
        idempotency_key_preview: idempotencyKey.slice(0, 32),
      });
    }



    // Optional Telegram delivery handoff (never sends, only prepares).
    let telegramId: string | null = null;
    if (c.intent === "telegram_delivery" || c.secondary_intent === "telegram_delivery") {
      if (tgConfigured) {
        telegramId = await insertTelegramApproval(supabase, userId, {
          brain_id: brainId,
          project_id: projectId,
          automation_action_id: actionId,
          approval_type: "manual_action",
          title: `Jack Voice → ${c.action_candidate.title}`,
          message_preview: sanitizeText(plan.telegram_delivery_hint?.message_preview ?? commandText, 280),
          risk_level: c.risk_level,
          status: "draft",
          metadata: {
            source_module: "jack_voice_controlled",
            jack_intent: c.intent,
          },
        });
      } else {
        // create a separate "configure telegram" action
        await insertAction(supabase, userId, {
          brain_id: brainId,
          project_id: projectId,
          source: "system_suggestion",
          action_type: "manual_task",
          title: "Configura Telegram delivery",
          description:
            "Jack ha rilevato una richiesta di delivery Telegram ma il connettore non è configurato. Attiva il connettore Telegram per abilitare l'approval flow.",
          priority: "medium",
          risk_level: "medium",
          status: "suggested",
          requires_confirmation: true,
          metadata: {
            source_module: "jack_voice_controlled",
            jack_intent: "telegram_delivery",
            jack_blocking_reason: "telegram_connector_missing",
            parent_action_id: actionId,
          },
        });
      }
    }

    // Master Snapshot draft path: never approves.
    let snapshotDraftId: string | null = null;
    if (c.intent === "master_snapshot_update") {
      const daily = await readLatestDailyBrief(supabase, userId, brainId);
      snapshotDraftId = await createMasterSnapshotDraft(
        supabase,
        userId,
        brainId,
        plan.master_snapshot_draft_hint?.reason ?? "Aggiornamento da Jack Voice",
        plan.master_snapshot_draft_hint?.summary ?? commandText,
        daily,
      );
      if (snapshotDraftId && actionId) {
        // best-effort link via metadata patch
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any)
            .from("automation_actions")
            .update({
              metadata: {
                ...metadata,
                master_snapshot_draft_id: snapshotDraftId,
              },
            })
            .eq("id", actionId);
        } catch { /* noop */ }
      }
    }

    return {
      ok: actionId !== null,
      action_id: actionId,
      intent: c.intent,
      secondary_intent: c.secondary_intent,
      risk_level: c.risk_level,
      requires_approval: c.requires_approval,
      recommended_tool: c.recommended_tool,
      next_step: plan.next_step,
      safe_message: plan.safe_message,
      master_snapshot_draft_id: snapshotDraftId,
      telegram_delivery_id: telegramId,
      research_handoff: c.intent === "market_research",
      missing_information: c.missing_information,
      unsafe_request: c.unsafe_request,
    };
  });

// ---------- Tool: prepare_master_snapshot_update ----------

export const prepareJackMasterSnapshotUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d as PrepareMasterSnapshotInput)
  .handler(async ({ data, context }): Promise<PrepareMasterSnapshotResult> => {
    const { supabase, userId } = context;
    const brainId = data.brain_id ?? null;
    const reason = sanitizeText(data.reason ?? "Aggiornamento da Jack Voice", 200);
    const summary = sanitizeText(data.summary ?? "", 400);

    const daily = await readLatestDailyBrief(supabase, userId, brainId);
    const missing: string[] = [];
    if (!daily) missing.push("daily_brief_assente");
    if (!summary) missing.push("riepilogo_attivita_oggi");

    const draftId = await createMasterSnapshotDraft(
      supabase,
      userId,
      brainId,
      reason,
      summary,
      daily,
    );

    let actionId: string | null = null;
    if (!draftId) {
      // Fallback: create a "prepare master snapshot update" suggested action.
      actionId = await insertAction(supabase, userId, {
        brain_id: brainId,
        source: "system_suggestion",
        action_type: "manual_task",
        title: "Preparare aggiornamento Master Snapshot",
        description:
          "Jack non è riuscito a creare la bozza automatica. Controlla che ci sia un daily brief e che il Master Snapshot corrente sia disponibile.",
        priority: "medium",
        risk_level: "medium",
        status: "suggested",
        requires_confirmation: true,
        metadata: {
          source_module: "jack_voice_controlled",
          jack_intent: "master_snapshot_update",
          jack_blocking_reason: "draft_creation_failed",
          jack_missing_information: missing,
        },
      });
    }

    return {
      ok: draftId !== null,
      draft_id: draftId,
      cta_path: "/master-snapshot",
      action_id: actionId,
      missing_information: missing,
      safe_message: draftId
        ? "Bozza Master Snapshot creata. Resta in attesa di approvazione manuale: non l'ho promossa a corrente."
        : "Non sono riuscito a creare la bozza: ho creato una action suggerita per prepararla manualmente.",
    };
  });

// ============================================================
// v3.19.6 — createControlledJackActionFromPreview
// ============================================================
// Confirmed UI bridge. Called ONLY from:
//   - UI button "Conferma creazione action" (confirmation_source = "ui_button")
//   - Deterministic voice router after validating the real user transcript
//     with isExplicitJackConfirmation (confirmation_source = "voice_router")
// The model has NO direct path to invoke this server function: the write
// tool is removed from the GPT tool schema and the dispatcher hard-blocks
// the legacy name. confirmed:true sent by the model alone is meaningless
// here because the server validates confirmation_source.
// ============================================================

export type CreateActionFromPreviewInput = {
  preview: PendingJackActionPreview;
  idempotency_key: string;
  brain_id?: string | null;
  confirmation_source: "ui_button" | "voice_router";
  user_transcript?: string | null;
};

export const createControlledJackActionFromPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d as CreateActionFromPreviewInput)
  .handler(async ({ data, context }): Promise<CreateControlledActionResult> => {
    const { supabase, userId } = context;
    const preview = data.preview;
    const confirmationSource = data.confirmation_source;

    if (
      confirmationSource !== "ui_button" &&
      confirmationSource !== "voice_router"
    ) {
      await logSanitizedEvent(
        supabase,
        userId,
        "jack_action_confirmation_rejected_no_pending_preview",
        {
          reason: "invalid_confirmation_source",
          brain_id: data.brain_id ?? null,
        },
      );
      return {
        ok: false,
        blocked: true,
        reason: "invalid_confirmation_source",
        action_id: null,
        intent: "controlled_action",
        secondary_intent: null,
        risk_level: preview?.risk_level ?? "low",
        requires_approval: true,
        recommended_tool: "ui",
        next_step: "Conferma richiesta tramite UI o voice router.",
        safe_message:
          "Conferma non valida: la creazione richiede un click sul pulsante UI o conferma vocale chiara.",
        master_snapshot_draft_id: null,
        telegram_delivery_id: null,
        research_handoff: false,
        missing_information: [],
        unsafe_request: false,
      };
    }

    if (!preview || !preview.title || !preview.idempotency_key) {
      await logSanitizedEvent(
        supabase,
        userId,
        "jack_action_confirmation_rejected_no_pending_preview",
        {
          reason: "missing_pending_preview",
          confirmation_source: confirmationSource,
          brain_id: data.brain_id ?? null,
        },
      );
      return {
        ok: false,
        blocked: true,
        reason: "missing_pending_preview",
        action_id: null,
        intent: "controlled_action",
        secondary_intent: null,
        risk_level: "low",
        requires_approval: true,
        recommended_tool: "ui",
        next_step: "Genera una preview prima di confermare.",
        safe_message: "Non ho una proposta pendente da confermare.",
        master_snapshot_draft_id: null,
        telegram_delivery_id: null,
        research_handoff: false,
        missing_information: ["pending_preview"],
        unsafe_request: false,
      };
    }

    if (data.idempotency_key !== preview.idempotency_key) {
      await logSanitizedEvent(
        supabase,
        userId,
        "jack_action_confirmation_rejected_no_pending_preview",
        {
          reason: "idempotency_mismatch",
          confirmation_source: confirmationSource,
          brain_id: data.brain_id ?? null,
        },
      );
      return {
        ok: false,
        blocked: true,
        reason: "idempotency_mismatch",
        action_id: null,
        intent: "controlled_action",
        secondary_intent: null,
        risk_level: preview.risk_level,
        requires_approval: true,
        recommended_tool: "ui",
        next_step: "Rigenera la preview e riprova.",
        safe_message: "Idempotency key non corrisponde alla preview pendente.",
        master_snapshot_draft_id: null,
        telegram_delivery_id: null,
        research_handoff: false,
        missing_information: [],
        unsafe_request: false,
      };
    }

    if (
      confirmationSource === "voice_router" &&
      !isExplicitJackConfirmationLocal(data.user_transcript)
    ) {
      await logSanitizedEvent(
        supabase,
        userId,
        "jack_action_confirmation_rejected_no_pending_preview",
        {
          reason: "voice_router_transcript_not_confirmation",
          confirmation_source: confirmationSource,
          brain_id: data.brain_id ?? null,
        },
      );
      return {
        ok: false,
        blocked: true,
        reason: "voice_router_transcript_not_confirmation",
        action_id: null,
        intent: "controlled_action",
        secondary_intent: null,
        risk_level: preview.risk_level,
        requires_approval: true,
        recommended_tool: "ui",
        next_step: "Attendo conferma esplicita.",
        safe_message:
          "Non ho rilevato una conferma chiara: nessuna action creata.",
        master_snapshot_draft_id: null,
        telegram_delivery_id: null,
        research_handoff: false,
        missing_information: [],
        unsafe_request: false,
      };
    }

    await logSanitizedEvent(
      supabase,
      userId,
      confirmationSource === "ui_button"
        ? "jack_action_confirmed_by_ui"
        : "jack_action_confirmed_by_voice_router",
      {
        brain_id: data.brain_id ?? null,
        source: preview.source,
        risk_level: preview.risk_level,
        idempotency_key_preview: preview.idempotency_key.slice(0, 32),
        confirmation_source: confirmationSource,
      },
    );

    const commandText =
      (preview.command_preview && preview.command_preview.trim()) || preview.title;

    const res = await createControlledJackAction({
      data: {
        command_text: commandText,
        brain_id: data.brain_id ?? preview.brain_id ?? null,
        project_id: preview.project_id ?? null,
        delivery_preference: null,
        notes: null,
        source_warning_id: preview.source_warning_id ?? null,
        idempotency_key: preview.idempotency_key,
        confirmed: true,
      },
    });

    if (res.ok && res.action_id) {
      await logSanitizedEvent(
        supabase,
        userId,
        "jack_controlled_action_created_from_preview",
        {
          brain_id: data.brain_id ?? null,
          action_id: res.action_id,
          confirmation_source: confirmationSource,
          source: preview.source,
          risk_level: preview.risk_level,
          idempotency_key_preview: preview.idempotency_key.slice(0, 32),
          deduplicated: Boolean(res.deduplicated),
        },
      );
    }

    return res;
  });

// Local guard mirror of isExplicitJackConfirmation. Re-implemented to keep
// this module's dependency surface narrow at runtime (the same heuristic
// lives in jack-action-confirmation.ts for the client router).
function isExplicitJackConfirmationLocal(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  if (!t) return false;
  const ambiguous = [
    /\bforse\b/i,
    /\bvediamo\b/i,
    /\bspiegami\b/i,
    /\bfammi\s+vedere\b/i,
    /\bpreparame?la\b/i,
    /\bdimmi\b/i,
    /\bmagari\b/i,
    /\bpenso\b/i,
  ];
  if (ambiguous.some((r) => r.test(t))) return false;
  const explicit = [
    /\bs[iì]\s*,?\s*conferm[oa]\b/i,
    /\bconferm[oa]\b/i,
    /\bprocedi(?:amo)?\b/i,
    /\bcreala\b/i,
    /\bcrea\s+l['’]?\s*action\b/i,
    /\bs[iì]\s*,?\s*crea\b/i,
    /\bok\s*,?\s*crea\b/i,
    /\bvai\s*,?\s*crea\b/i,
    /\bcrea\s+pure\b/i,
  ];
  return explicit.some((r) => r.test(t));
}

// v3.19.6 — also export under canonical name; UI uses isExplicitJackConfirmation
// from jack-action-confirmation.ts directly for the client router.

