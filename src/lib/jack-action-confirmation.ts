// ============================================================
// Brain Hub v3.19.3 — Jack Confirmation Gate helpers
// + v3.19.5 — Preview robustness helpers
// ============================================================
// Pure utilities (no DB, no side effects) used by:
//  - jack-controlled-actions.functions.ts (server confirmation gate)
//  - jack-gpt-tools.ts (preview vs create separation, write dedup,
//    robust preview construction)
// Manual-first invariant: Jack proposes, the user confirms, only
// then a write tool may run.
// ============================================================

export type PendingJackActionPreview = {
  preview_id: string;
  created_at: string;
  intent: "create_controlled_action";
  title: string;
  description: string;
  source: string;
  reason: string;
  risk_level: "low" | "medium" | "high";
  requires_confirmation: true;
  confirmation_status: "pending";
  idempotency_key: string;
  brain_id: string | null;
  project_id: string | null;
  command_preview: string;
  generated_at: string;
  // v3.19.5 — optional display/source metadata
  source_warning_id?: string | null;
  readiness_step_id?: string | null;
  cta_label?: string | null;
  cta_href?: string | null;
};

// ---------- Confirmation phrase detection ----------

const EXPLICIT_PATTERNS: RegExp[] = [
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

const AMBIGUOUS_BLOCKLIST: RegExp[] = [
  /\bforse\b/i,
  /\bvediamo\b/i,
  /\bspiegami\b/i,
  /\bfammi\s+vedere\b/i,
  /\bpreparame?la\b/i,
  /\bdimmi\b/i,
  /\bmagari\b/i,
  /\bpenso\b/i,
];

/**
 * True ONLY for unambiguous, explicit confirmation phrases.
 * Pure heuristic, no model call, no DB.
 */
export function isExplicitJackConfirmation(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (AMBIGUOUS_BLOCKLIST.some((r) => r.test(t))) return false;
  return EXPLICIT_PATTERNS.some((r) => r.test(t));
}

// ---------- Idempotency key ----------

function tinyHash(s: string): string {
  // FNV-1a, base36, deterministic; not cryptographic.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function hashJackActionText(input: string): string {
  return tinyHash(input.trim().toLowerCase());
}

export function redactJackIdempotencyKey(idempotencyKey: string): string {
  const trimmed = idempotencyKey.trim();
  return `${tinyHash(trimmed)}:${trimmed.slice(0, 24)}`;
}

export function buildJackPreviewId(idempotencyKey: string, createdAt: string): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `jack_preview:${randomId}`;
  return `jack_preview:${tinyHash(`${idempotencyKey}:${createdAt}:${Math.random()}`)}`;
}

export type IdempotencyKeyParts = {
  userId: string;
  brainId: string | null;
  source: string;
  sourceWarningId: string | null;
  title: string;
};

export function buildJackActionIdempotencyKey(parts: IdempotencyKeyParts): string {
  const brain = parts.brainId ?? "no_brain";
  const warn = parts.sourceWarningId ?? "no_warn";
  const titleHash = tinyHash(parts.title.trim().toLowerCase());
  return `jack_controlled_action:${parts.userId}:${brain}:${parts.source}:${warn}:${titleHash}`;
}

// ============================================================
// v3.19.5 — Preview robustness helpers
// ============================================================

const RISK_LEVELS = new Set<"low" | "medium" | "high">(["low", "medium", "high"]);

export type PreviewInput = {
  brain_id?: string | null;
  project_id?: string | null;
  source?: string | null;
  title?: string | null;
  description?: string | null;
  reason?: string | null;
  risk_level?: string | null;
  source_warning_id?: string | null;
  readiness_step_id?: string | null;
  cta_label?: string | null;
  cta_href?: string | null;
  command_text?: string | null;
  notes?: string | null;
};

export type NormalizedPreviewInput = {
  brain_id: string | null;
  project_id: string | null;
  source: string;
  title: string | null;
  description: string | null;
  reason: string | null;
  risk_level: "low" | "medium" | "high";
  source_warning_id: string | null;
  readiness_step_id: string | null;
  cta_label: string | null;
  cta_href: string | null;
  command_text: string | null;
  notes: string | null;
};

function trimOrNull(v: unknown, max = 600): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function normalizePreviewInput(raw: unknown): NormalizedPreviewInput {
  const r = (raw && typeof raw === "object" ? raw : {}) as PreviewInput;
  const rl = typeof r.risk_level === "string" ? r.risk_level.toLowerCase() : "";
  const risk: "low" | "medium" | "high" = RISK_LEVELS.has(
    rl as "low" | "medium" | "high",
  )
    ? (rl as "low" | "medium" | "high")
    : "low";
  return {
    brain_id: trimOrNull(r.brain_id, 80),
    project_id: trimOrNull(r.project_id, 80),
    source: trimOrNull(r.source, 80) ?? "jack_voice_controlled",
    title: trimOrNull(r.title, 200),
    description: trimOrNull(r.description, 600),
    reason: trimOrNull(r.reason, 400),
    risk_level: risk,
    source_warning_id: trimOrNull(r.source_warning_id, 120),
    readiness_step_id: trimOrNull(r.readiness_step_id, 120),
    cta_label: trimOrNull(r.cta_label, 120),
    cta_href: trimOrNull(r.cta_href, 200),
    command_text: trimOrNull(r.command_text, 1200),
    notes: trimOrNull(r.notes, 400),
  };
}

export type PreviewBuildContext = {
  userId: string;
  bestNextAction?: {
    source: string;
    title: string;
    reason: string;
    description?: string;
    cta_label?: string;
    cta_href?: string;
  } | null;
  readinessTopStep?: {
    id: string;
    label: string;
    why_it_matters: string;
    suggested_fix: string;
    cta_label: string;
    cta_href: string;
  } | null;
};

const STATIC_FALLBACK = {
  title: "Sbloccare readiness loop creando la prima action operativa",
  description:
    "Il loop operativo è bloccato perché manca una action iniziale da completare e poi revisionare. Creare una prima action permette di far ripartire il loop e generare un risultato da rivedere.",
  reason:
    "Senza un'action iniziale il loop non parte e nessun altro step (Result Review, Learning) può essere chiuso.",
  cta_label: "Apri Action Queue",
  cta_href: "/action-queue",
};

export type BuildPreviewResult =
  | { ok: true; preview: PendingJackActionPreview; missing_fields: string[] }
  | {
      ok: false;
      blocked: true;
      reason: "preview_data_missing";
      message: string;
      required_fields: string[];
      fallback_cta: string;
    };

export function buildPendingJackActionPreview(
  input: NormalizedPreviewInput,
  ctx: PreviewBuildContext,
): BuildPreviewResult {
  const missing: string[] = [];
  let title = input.title;
  let description = input.description;
  let reason = input.reason;
  let cta_label = input.cta_label;
  let cta_href = input.cta_href;

  // Layer 1: readiness top step (most specific)
  if ((!title || !description || !reason) && ctx.readinessTopStep) {
    const s = ctx.readinessTopStep;
    if (!title) {
      title = `Sbloccare readiness: ${s.label}`;
      missing.push("title");
    }
    if (!description) {
      description = `${s.suggested_fix} Step di readiness mancante: "${s.label}".`;
      missing.push("description");
    }
    if (!reason) {
      reason = s.why_it_matters;
      missing.push("reason");
    }
    if (!cta_label) cta_label = s.cta_label;
    if (!cta_href) cta_href = s.cta_href;
  }

  // Layer 2: best next action
  if ((!title || !description || !reason) && ctx.bestNextAction) {
    const b = ctx.bestNextAction;
    if (!title) {
      title = b.title;
      missing.push("title");
    }
    if (!description) {
      description = b.description || b.reason;
      missing.push("description");
    }
    if (!reason) {
      reason = b.reason;
      missing.push("reason");
    }
    if (!cta_label && b.cta_label) cta_label = b.cta_label;
    if (!cta_href && b.cta_href) cta_href = b.cta_href;
  }

  // Layer 3: static safe fallback
  if (!title) {
    title = STATIC_FALLBACK.title;
    missing.push("title");
  }
  if (!description) {
    description = STATIC_FALLBACK.description;
    missing.push("description");
  }
  if (!reason) {
    reason = STATIC_FALLBACK.reason;
    missing.push("reason");
  }
  if (!cta_label) cta_label = STATIC_FALLBACK.cta_label;
  if (!cta_href) cta_href = STATIC_FALLBACK.cta_href;

  // Final safety: should always be filled by now.
  if (!title || !description || !reason) {
    return {
      ok: false,
      blocked: true,
      reason: "preview_data_missing",
      message: "Non ho abbastanza dati per preparare una preview sicura.",
      required_fields: ["title", "description", "reason"].filter(
        (f) =>
          (f === "title" && !title) ||
          (f === "description" && !description) ||
          (f === "reason" && !reason),
      ),
      fallback_cta: "/action-queue",
    };
  }

  const idempotency_key = buildJackActionIdempotencyKey({
    userId: ctx.userId,
    brainId: input.brain_id,
    source: input.source,
    sourceWarningId: input.source_warning_id ?? input.readiness_step_id ?? null,
    title,
  });

  const createdAt = new Date().toISOString();
  const preview: PendingJackActionPreview = {
    preview_id: buildJackPreviewId(idempotency_key, createdAt),
    created_at: createdAt,
    intent: "create_controlled_action",
    title,
    description,
    source: input.source,
    reason,
    risk_level: input.risk_level,
    requires_confirmation: true,
    confirmation_status: "pending",
    idempotency_key,
    brain_id: input.brain_id,
    project_id: input.project_id,
    command_preview: input.command_text ?? "",
    generated_at: createdAt,
    source_warning_id: input.source_warning_id,
    readiness_step_id: input.readiness_step_id,
    cta_label,
    cta_href,
  };

  return { ok: true, preview, missing_fields: missing };
}

/**
 * Build a preview oriented to unblocking readiness using only a readiness
 * top step. Used when no user input is available beyond brain_id.
 */
export function buildReadinessActionPreview(
  ctx: PreviewBuildContext & { brain_id?: string | null },
): BuildPreviewResult {
  const input = normalizePreviewInput({
    brain_id: ctx.brain_id ?? null,
    source: "jack_readiness_unblock",
    risk_level: "low",
    readiness_step_id: ctx.readinessTopStep?.id ?? null,
  });
  return buildPendingJackActionPreview(input, ctx);
}

/**
 * Display-time validation. Returns true if the preview has the minimum
 * fields Jack must read out loud (title, reason, risk_level).
 */
export function validatePreviewForDisplay(
  preview: PendingJackActionPreview | null | undefined,
): preview is PendingJackActionPreview {
  if (!preview) return false;
  if (!preview.title || preview.title.trim().length < 3) return false;
  if (!preview.reason || preview.reason.trim().length < 3) return false;
  if (!RISK_LEVELS.has(preview.risk_level)) return false;
  return true;
}
