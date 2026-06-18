// ============================================================
// Brain Hub v3.19.3 — Jack Confirmation Gate helpers
// ============================================================
// Pure utilities (no DB, no side effects) used by:
//  - jack-controlled-actions.functions.ts (server confirmation gate)
//  - jack-gpt-tools.ts (preview vs create separation, write dedup)
// Manual-first invariant: Jack proposes, the user confirms, only
// then a write tool may run.
// ============================================================

export type PendingJackActionPreview = {
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
