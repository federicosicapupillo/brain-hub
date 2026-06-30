// Brain Hub v3.35c — Orphan Gate Reaper.
//
// Closes the inherited v3.35a.1 / v3.35b debt: a "winner" request that
// inserts an execute_idempotency row (receipt_id=NULL) and then crashes
// before stamping the canonical receipt leaves the gate orphaned.
// Without recovery, peers see a pending key forever and the action's
// real side-effect status is unknown.
//
// SAFETY PRINCIPLE
//   A gate orfano non autorizza mai una riesecuzione automatica.
//   `auto_reexecuted` è SEMPRE `false` in v3.35c. Per risk_level HIGH /
//   CRITICAL / unknown la decisione è sempre `orphaned_unknown_requires_
//   manual_review`. Solo LOW/MEDIUM ricevono un receipt esplicito di
//   `orphaned_failed` (gate chiuso ma azione NON ritentata).
//
// SCHEMA NOTE — no migration introduced. Lo stato del gate è
// rappresentato indirettamente: `execute_idempotency.receipt_id` viene
// puntato a un receipt di recovery con `result='failure'` e con
// `audit_record.orphan_gate_status` + `audit_record.recovery_decision`
// + `audit_record.requires_manual_review`. Questo riusa il vincolo CHECK
// esistente di `execute_receipts.result` senza estenderlo.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  INTERNAL_ACTION_RISK,
  isInternalActionType,
  type InternalActionType,
} from "./types";
import { getExternalAction } from "./external-registry";
import type { RbacRiskLevel } from "@/lib/governance/rbacModel";

type AdminClient = SupabaseClient<Database>;

/**
 * Default TTL after which a still-pending idempotency row is considered
 * orphaned. Override via env `EXECUTE_ORPHAN_GATE_TTL_MS` for test
 * harnesses. Kept conservative for production: a real winner finishes
 * the receipt write in ~tens of ms, so 60s eliminates every honest
 * in-flight peer.
 */
export const EXECUTE_ORPHAN_GATE_TTL_MS_DEFAULT = 60_000;

export function getOrphanGateTtlMs(): number {
  const raw = process.env.EXECUTE_ORPHAN_GATE_TTL_MS;
  if (!raw) return EXECUTE_ORPHAN_GATE_TTL_MS_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : EXECUTE_ORPHAN_GATE_TTL_MS_DEFAULT;
}

export type OrphanGateDecision =
  | "not_orphaned_pending"
  | "not_found"
  | "already_completed"
  | "orphaned_failed"
  | "orphaned_recovered"
  | "orphaned_unknown_requires_manual_review";

export type ExecuteScope = "internal" | "external" | "unknown";
export type SideEffectStatus =
  | "known_absent"
  | "known_completed"
  | "unknown"
  | "requires_manual_review";

export interface OrphanGateReapInput {
  owner_id: string;
  idempotency_key: string;
  /** Override TTL for tests; falls back to env / default. */
  ttl_ms?: number;
  /** Label of the caller (endpoint, dispatcher-inline, harness). */
  invoked_by?: string;
}

export interface OrphanGateReapResult {
  ok: boolean;
  decision: OrphanGateDecision;
  receipt_id: string | null;
  /** Existing receipt for already_completed / not_orphaned_pending. */
  existing_receipt_id: string | null;
  scope: ExecuteScope;
  risk_level: RbacRiskLevel | "unknown";
  side_effect_status: SideEffectStatus;
  retry_allowed: boolean;
  auto_reexecuted: false; // invariant — never true in v3.35c
  safe_message: string;
  gate_age_ms: number | null;
  ttl_ms: number;
}

interface IdemRow {
  owner_id: string;
  idempotency_key: string;
  receipt_id: string | null;
  action_type: string;
  created_at: string;
}

function classifyAction(action_type: string): {
  scope: ExecuteScope;
  risk_level: RbacRiskLevel | "unknown";
} {
  if (isInternalActionType(action_type)) {
    return { scope: "internal", risk_level: INTERNAL_ACTION_RISK[action_type as InternalActionType] };
  }
  const ext = getExternalAction(action_type);
  if (ext) return { scope: "external", risk_level: ext.risk_level };
  return { scope: "unknown", risk_level: "unknown" };
}

function isHighOrUnknown(risk: RbacRiskLevel | "unknown"): boolean {
  return risk === "high" || risk === "critical" || risk === "unknown";
}

function safeMsg(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+/g, "[redacted-email]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-key]")
    .slice(0, 240);
}

async function loadGate(
  admin: AdminClient,
  owner_id: string,
  idempotency_key: string,
): Promise<IdemRow | null> {
  const { data, error } = await admin
    .from("execute_idempotency")
    .select("owner_id, idempotency_key, receipt_id, action_type, created_at")
    .eq("owner_id", owner_id)
    .eq("idempotency_key", idempotency_key)
    .maybeSingle();
  if (error || !data) return null;
  return data as IdemRow;
}

async function loadReceiptAudit(
  admin: AdminClient,
  receipt_id: string,
): Promise<{ audit: Record<string, unknown> } | null> {
  const { data, error } = await admin
    .from("execute_receipts")
    .select("audit_record")
    .eq("receipt_id", receipt_id)
    .maybeSingle();
  if (error || !data) return null;
  const audit =
    typeof data.audit_record === "string"
      ? safeParse(data.audit_record)
      : ((data.audit_record as Record<string, unknown>) ?? {});
  return { audit };
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Pure detection — does NOT mutate. Returns the decision a reaper would
 * make if invoked right now. Used by tests and by dispatchers that want
 * to inspect before recovering.
 */
export async function detectOrphanExecuteGate(
  admin: AdminClient,
  input: OrphanGateReapInput,
): Promise<OrphanGateReapResult> {
  const ttl_ms = input.ttl_ms ?? getOrphanGateTtlMs();
  const gate = await loadGate(admin, input.owner_id, input.idempotency_key);
  if (!gate) {
    return {
      ok: true,
      decision: "not_found",
      receipt_id: null,
      existing_receipt_id: null,
      scope: "unknown",
      risk_level: "unknown",
      side_effect_status: "unknown",
      retry_allowed: false,
      auto_reexecuted: false,
      safe_message: "gate_not_found",
      gate_age_ms: null,
      ttl_ms,
    };
  }
  const { scope, risk_level } = classifyAction(gate.action_type);
  const age_ms = Date.now() - Date.parse(gate.created_at);

  if (gate.receipt_id) {
    // Distinguish prior recovery from healthy completion.
    const audit = await loadReceiptAudit(admin, gate.receipt_id);
    const recoveryDecision = audit?.audit?.recovery_decision as string | undefined;
    if (recoveryDecision) {
      const isManual = recoveryDecision === "orphaned_unknown_requires_manual_review";
      return {
        ok: true,
        decision: isManual ? "orphaned_unknown_requires_manual_review" : "orphaned_recovered",
        receipt_id: gate.receipt_id,
        existing_receipt_id: gate.receipt_id,
        scope,
        risk_level,
        side_effect_status: isManual ? "requires_manual_review" : "unknown",
        retry_allowed: false,
        auto_reexecuted: false,
        safe_message: "already_recovered",
        gate_age_ms: age_ms,
        ttl_ms,
      };
    }
    return {
      ok: true,
      decision: "already_completed",
      receipt_id: gate.receipt_id,
      existing_receipt_id: gate.receipt_id,
      scope,
      risk_level,
      side_effect_status: "known_completed",
      retry_allowed: false,
      auto_reexecuted: false,
      safe_message: "gate_already_completed",
      gate_age_ms: age_ms,
      ttl_ms,
    };
  }

  if (age_ms < ttl_ms) {
    return {
      ok: true,
      decision: "not_orphaned_pending",
      receipt_id: null,
      existing_receipt_id: null,
      scope,
      risk_level,
      side_effect_status: "unknown",
      retry_allowed: false,
      auto_reexecuted: false,
      safe_message: "pending_within_ttl",
      gate_age_ms: age_ms,
      ttl_ms,
    };
  }

  // Expired.
  const target_decision: OrphanGateDecision = isHighOrUnknown(risk_level)
    ? "orphaned_unknown_requires_manual_review"
    : "orphaned_failed";
  return {
    ok: true,
    decision: target_decision,
    receipt_id: null,
    existing_receipt_id: null,
    scope,
    risk_level,
    side_effect_status:
      target_decision === "orphaned_unknown_requires_manual_review"
        ? "requires_manual_review"
        : "unknown",
    retry_allowed: false,
    auto_reexecuted: false,
    safe_message: "orphan_candidate_pending_recovery",
    gate_age_ms: age_ms,
    ttl_ms,
  };
}

/**
 * Detect → write recovery receipt → stamp gate. Owner-scoped.
 * SAFETY: never invokes any external handler. Side effect status is
 * stamped as `unknown` for LOW/MEDIUM and `requires_manual_review` for
 * HIGH/unknown — the system NEVER assumes a side effect didn't happen.
 */
export async function recoverOrphanExecuteGate(
  admin: AdminClient,
  input: OrphanGateReapInput,
): Promise<OrphanGateReapResult> {
  const detect = await detectOrphanExecuteGate(admin, input);
  // Pass-through decisions that require no write.
  if (
    detect.decision === "not_found" ||
    detect.decision === "not_orphaned_pending" ||
    detect.decision === "already_completed" ||
    detect.decision === "orphaned_recovered" ||
    (detect.decision === "orphaned_unknown_requires_manual_review" &&
      detect.existing_receipt_id !== null)
  ) {
    return detect;
  }

  // We need a fresh load of the gate to write the recovery receipt with
  // honest metadata.
  const gate = await loadGate(admin, input.owner_id, input.idempotency_key);
  if (!gate) {
    return { ...detect, decision: "not_found", safe_message: "gate_vanished_during_recovery" };
  }
  if (gate.receipt_id) {
    // Lost a race with another recoverer — re-detect to return canonical
    // outcome instead of a duplicate.
    return detectOrphanExecuteGate(admin, input);
  }

  const ttl_ms = input.ttl_ms ?? getOrphanGateTtlMs();
  const { scope, risk_level } = classifyAction(gate.action_type);
  const orphan_detected_at = new Date().toISOString();
  const target_decision: OrphanGateDecision = isHighOrUnknown(risk_level)
    ? "orphaned_unknown_requires_manual_review"
    : "orphaned_failed";
  const requires_manual_review = target_decision === "orphaned_unknown_requires_manual_review";

  const audit_record = {
    execute_scope: scope,
    idempotency_key: gate.idempotency_key,
    action_type: gate.action_type,
    original_pending_gate_created_at: gate.created_at,
    orphan_detected_at,
    orphan_ttl_ms: ttl_ms,
    risk_level,
    orphan_gate_status: target_decision,
    recovery_decision: target_decision,
    recovery_reason: requires_manual_review
      ? "high_or_unknown_risk_side_effect_status_indeterminate"
      : "low_or_medium_risk_no_handler_invocation",
    side_effect_status: requires_manual_review ? "requires_manual_review" : "unknown",
    requires_manual_review,
    retry_allowed: false,
    auto_reexecuted: false,
    recovered_by: "orphan_gate_reaper",
    invoked_by: safeMsg(input.invoked_by ?? "unknown"),
    original_receipt_id: null,
    events: [
      "execute_orphan_gate_detected",
      requires_manual_review
        ? "execute_orphan_gate_manual_review_required"
        : "execute_orphan_gate_failed",
    ],
  };

  const now = new Date().toISOString();
  const { data: rec, error: recErr } = await admin
    .from("execute_receipts")
    .insert({
      owner_id: input.owner_id,
      action_id: null,
      action_type: gate.action_type,
      risk_level: risk_level === "unknown" ? "high" : risk_level,
      requested_by: `user:${input.owner_id}`,
      approved_by: null,
      executed_by: "system:orphan-gate-reaper",
      started_at: gate.created_at,
      completed_at: now,
      result: "failure",
      rollback_available: false,
      external_reference: null,
      audit_record,
      related_receipt_id: null,
      idempotency_key: gate.idempotency_key,
      safe_error_message: requires_manual_review
        ? "orphaned_unknown_requires_manual_review"
        : "orphaned_failed",
    } as never)
    .select("receipt_id")
    .single();

  if (recErr || !rec) {
    return {
      ...detect,
      ok: false,
      receipt_id: null,
      safe_message: safeMsg(recErr?.message ?? "recovery_receipt_write_failed"),
    };
  }

  const recoveryReceiptId = (rec as { receipt_id: string }).receipt_id;

  // Stamp the gate. Use a guarded UPDATE so a parallel reaper that
  // already stamped wins and we don't overwrite.
  const { data: upd, error: updErr } = await admin
    .from("execute_idempotency")
    .update({ receipt_id: recoveryReceiptId } as never)
    .eq("owner_id", input.owner_id)
    .eq("idempotency_key", input.idempotency_key)
    .is("receipt_id", null)
    .select("receipt_id");

  if (updErr) {
    return {
      ...detect,
      ok: false,
      receipt_id: recoveryReceiptId,
      safe_message: safeMsg(updErr.message),
    };
  }
  if (!upd || upd.length === 0) {
    // A peer stamped first — return their canonical outcome.
    return detectOrphanExecuteGate(admin, input);
  }

  return {
    ok: true,
    decision: target_decision,
    receipt_id: recoveryReceiptId,
    existing_receipt_id: null,
    scope,
    risk_level,
    side_effect_status: requires_manual_review ? "requires_manual_review" : "unknown",
    retry_allowed: false,
    auto_reexecuted: false,
    safe_message: requires_manual_review
      ? "orphaned_unknown_requires_manual_review"
      : "orphaned_failed",
    gate_age_ms: detect.gate_age_ms,
    ttl_ms,
  };
}
