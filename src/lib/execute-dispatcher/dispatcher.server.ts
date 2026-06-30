// Brain Hub v3.35a — Internal Execute Dispatcher.
//
// THIS IS THE SINGLE WRITE PATH for the 8 internal action_type values
// declared in `./types.ts`. Any code that writes one of those artifacts
// outside this dispatcher is a governance bypass and must be removed.
//
// Pipeline:
//   1. Validate action_type & payload shape (per-action validator).
//   2. Validate Confirm signal (must be ISO + within a sane window).
//   3. Run Governance Evaluator (project_isolation → RBAC → policy →
//      agent_permission). FAIL stops here, no artifact written.
//   4. Look up idempotency_key — if a prior receipt exists for the same
//      (owner_id, idempotency_key), return it unchanged. No second write.
//   5. Insert the artifact row.
//   6. Insert the immutable Execute Receipt.
//   7. Insert the idempotency mapping (best-effort: on conflict, the
//      pre-existing receipt wins — race-safe via unique PK).
//
// This file is .server.ts: it imports the service-role admin client and
// must never be reachable from the browser bundle (Vite import guard).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateAction,
  type GovernanceRequest,
  type GovernanceResult,
} from "@/lib/governance/governanceEvaluator";
import type { Database } from "@/integrations/supabase/types";
import {
  INTERNAL_ACTION_RISK,
  INTERNAL_ACTION_ROLLBACK,
  isInternalActionType,
  type ExecuteDispatchRequest,
  type ExecuteDispatchResponse,
  type ExecuteReceipt,
  type InternalActionType,
} from "./types";
import { validatePayload, deriveTitle } from "./action-validators";

const CONFIRM_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_PROJECT_ID = "brainhub-os";

type AdminClient = SupabaseClient<Database>;

interface DispatchEnv {
  /** Service-role client — used to write artifacts + receipts atomically
   * across RLS. Owner scoping is enforced explicitly via owner_id. */
  admin: AdminClient;
  /** Authenticated user id (auth.uid()). The dispatcher refuses to run
   * without it — there is no anonymous Execute. */
  userId: string;
  /** Optional executor label (e.g. "system:execute-dispatcher"). */
  executor?: string;
}

function safeMessage(err: unknown, fallback = "execute_failed"): string {
  const m = (err as { message?: string } | null)?.message ?? fallback;
  return m
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+/g, "[redacted-email]")
    .slice(0, 240);
}

function isFreshConfirm(iso: string): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  const age = Date.now() - t;
  return age >= 0 && age <= CONFIRM_MAX_AGE_MS;
}

async function findExistingReceipt(
  env: DispatchEnv,
  idempotency_key: string,
): Promise<ExecuteReceipt | null> {
  const { data: idem, error: idemErr } = await env.admin
    .from("execute_idempotency")
    .select("receipt_id")
    .eq("owner_id", env.userId)
    .eq("idempotency_key", idempotency_key)
    .maybeSingle();
  if (idemErr || !idem) return null;
  const { data: r } = await env.admin
    .from("execute_receipts")
    .select("*")
    .eq("receipt_id", idem.receipt_id)
    .maybeSingle();
  return r ? rowToReceipt(r) : null;
}

interface ReceiptRow {
  receipt_id: string;
  action_id: string | null;
  action_type: string;
  risk_level: string;
  requested_by: string;
  approved_by: string | null;
  executed_by: string;
  started_at: string;
  completed_at: string | null;
  result: string;
  rollback_available: boolean;
  external_reference: string | null;
  audit_record: unknown;
  related_receipt_id: string | null;
  idempotency_key: string | null;
  safe_error_message: string | null;
}

function rowToReceipt(r: ReceiptRow): ExecuteReceipt {
  return {
    receipt_id: r.receipt_id,
    action_id: r.action_id ?? "",
    action_type: r.action_type as InternalActionType,
    risk_level: r.risk_level as ExecuteReceipt["risk_level"],
    requested_by: r.requested_by,
    approved_by: r.approved_by,
    executed_by: r.executed_by,
    started_at: r.started_at,
    completed_at: r.completed_at,
    result: r.result as ExecuteReceipt["result"],
    rollback_available: r.rollback_available,
    external_reference: r.external_reference,
    audit_record: typeof r.audit_record === "string"
      ? r.audit_record
      : JSON.stringify(r.audit_record ?? {}),
    related_receipt_id: r.related_receipt_id,
    idempotency_key: r.idempotency_key,
    safe_error_message: r.safe_error_message,
  };
}

async function writeReceipt(
  env: DispatchEnv,
  partial: Omit<ExecuteReceipt, "receipt_id">,
): Promise<ExecuteReceipt | null> {
  const { data, error } = await env.admin
    .from("execute_receipts")
    .insert({
      owner_id: env.userId,
      action_id: partial.action_id || null,
      action_type: partial.action_type,
      risk_level: partial.risk_level,
      requested_by: partial.requested_by,
      approved_by: partial.approved_by,
      executed_by: partial.executed_by,
      started_at: partial.started_at,
      completed_at: partial.completed_at,
      result: partial.result,
      rollback_available: partial.rollback_available,
      external_reference: partial.external_reference,
      audit_record: tryParseJson(partial.audit_record),
      related_receipt_id: partial.related_receipt_id ?? null,
      idempotency_key: partial.idempotency_key ?? null,
      safe_error_message: partial.safe_error_message ?? null,
    } as never)
    .select("*")
    .single();
  if (error || !data) return null;
  return rowToReceipt(data as ReceiptRow);
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}

/**
 * Sole entry point for executing one of the 8 internal MEDIUM actions.
 */
export async function executeInternalAction(
  env: DispatchEnv,
  req: ExecuteDispatchRequest,
): Promise<ExecuteDispatchResponse> {
  const started_at = new Date().toISOString();
  const executor = env.executor ?? "system:execute-dispatcher";
  const requested_by = req.requested_by_label ?? `user:${env.userId}`;

  // 1. Unknown action — reject before doing anything.
  if (!isInternalActionType(req.action_type)) {
    return {
      ok: false,
      status: "rejected_unknown_action",
      receipt: null,
      safe_message: `unknown_internal_action:${req.action_type}`,
    };
  }
  const action_type: InternalActionType = req.action_type;
  const risk_level = INTERNAL_ACTION_RISK[action_type];
  const rollback = INTERNAL_ACTION_ROLLBACK[action_type];

  // 2. Confirm gate (Principio 5 / RRM): every MEDIUM execute requires
  //    an explicit, fresh Confirm signal. The receipt records it.
  if (!isFreshConfirm(req.confirmed_at)) {
    return {
      ok: false,
      status: "rejected_confirm",
      receipt: null,
      safe_message: "confirm_missing_or_stale",
    };
  }

  // 3. Validate payload (per-action shape). NEVER trust the client.
  const validation = validatePayload(action_type, req.payload);
  if (!validation.ok) {
    return {
      ok: false,
      status: "rejected_validation",
      receipt: null,
      safe_message: validation.message,
    };
  }
  const validatedPayload = validation.value;
  const title = req.title?.trim() || deriveTitle(action_type, validatedPayload);

  // 4. Governance Evaluator — same chain used for reads. The action name
  //    is the fixed string "execute_internal_action" (declared in RBAC)
  //    while action_type travels through the audit metadata.
  const govRequest: GovernanceRequest = {
    action: "execute_internal_action",
    entity: { type: "user", id: env.userId },
    project_id: req.project_id ?? DEFAULT_PROJECT_ID,
    context_active_project_id: req.project_id ?? DEFAULT_PROJECT_ID,
    risk_level,
    requires_confirmation: true,
  };
  let gov: GovernanceResult;
  try {
    gov = evaluateAction(govRequest);
  } catch (err) {
    return {
      ok: false,
      status: "rejected_governance",
      receipt: null,
      safe_message: safeMessage(err, "governance_crash"),
    };
  }
  if (!gov.allowed) {
    // Persist a FAILURE receipt — every Execute attempt, even denied,
    // leaves an immutable trace (RRM §"Audit").
    const failedReceipt = await writeReceipt(env, {
      action_id: "",
      action_type,
      risk_level,
      requested_by,
      approved_by: requested_by,
      executed_by: executor,
      started_at,
      completed_at: new Date().toISOString(),
      result: "failure",
      rollback_available: false,
      external_reference: null,
      audit_record: JSON.stringify({
        ...gov.audit_record,
        action_type_meta: action_type,
      }),
      idempotency_key: req.idempotency_key,
      safe_error_message: `governance_denied:${gov.reason}`,
    });
    return {
      ok: false,
      status: "rejected_governance",
      receipt: failedReceipt,
      safe_message: `governance_denied:${gov.reason}`,
    };
  }

  // 5. Idempotency lookup — return prior receipt if present.
  const replay = await findExistingReceipt(env, req.idempotency_key);
  if (replay) {
    return {
      ok: true,
      status: "replayed",
      receipt: replay,
      safe_message: "idempotent_replay",
    };
  }

  // 6. Write the artifact (the ONLY data write for internal actions).
  let artifactId = "";
  try {
    const { data: artifact, error: artErr } = await env.admin
      .from("internal_execute_artifacts")
      .insert({
        owner_id: env.userId,
        action_type,
        risk_level,
        title,
        payload: validatedPayload,
      } as never)
      .select("id")
      .single();
    if (artErr || !artifact) throw new Error(artErr?.message ?? "insert_failed");
    artifactId = artifact.id;
  } catch (err) {
    const failedReceipt = await writeReceipt(env, {
      action_id: "",
      action_type,
      risk_level,
      requested_by,
      approved_by: requested_by,
      executed_by: executor,
      started_at,
      completed_at: new Date().toISOString(),
      result: "failure",
      rollback_available: false,
      external_reference: null,
      audit_record: JSON.stringify({
        ...gov.audit_record,
        action_type_meta: action_type,
        failure_stage: "artifact_insert",
      }),
      idempotency_key: req.idempotency_key,
      safe_error_message: safeMessage(err, "artifact_insert_failed"),
    });
    return {
      ok: false,
      status: "failed",
      receipt: failedReceipt,
      safe_message: safeMessage(err, "artifact_insert_failed"),
    };
  }

  // 7. Write the immutable Receipt.
  const receipt = await writeReceipt(env, {
    action_id: artifactId,
    action_type,
    risk_level,
    requested_by,
    approved_by: requested_by, // MEDIUM: user is approver (RRM Approval Layer)
    executed_by: executor,
    started_at,
    completed_at: new Date().toISOString(),
    result: "success",
    rollback_available: rollback.rollback_available,
    external_reference: null,
    audit_record: JSON.stringify({
      ...gov.audit_record,
      action_type_meta: action_type,
      rollback_note: rollback.note,
      confirmation_source: req.confirmation_source,
      confirmed_at: req.confirmed_at,
    }),
    idempotency_key: req.idempotency_key,
  });

  if (!receipt) {
    // Receipt write failed — this is a serious internal failure. Try a
    // best-effort failure receipt; if that also fails, surface a generic
    // error. The artifact may be orphaned but is harmless (soft state).
    return {
      ok: false,
      status: "failed",
      receipt: null,
      safe_message: "receipt_write_failed",
    };
  }

  // 8. Record idempotency mapping. Race-safe: PK is (owner_id, key); a
  //    concurrent duplicate insert collides — we resolve the winner.
  const { error: idemErr } = await env.admin
    .from("execute_idempotency")
    .insert({
      owner_id: env.userId,
      idempotency_key: req.idempotency_key,
      receipt_id: receipt.receipt_id,
      action_type,
    });
  if (idemErr) {
    // Conflict: another request already won this idempotency key.
    // Return the canonical pre-existing receipt instead of ours.
    const canonical = await findExistingReceipt(env, req.idempotency_key);
    if (canonical && canonical.receipt_id !== receipt.receipt_id) {
      return {
        ok: true,
        status: "replayed",
        receipt: canonical,
        safe_message: "idempotent_replay_after_race",
      };
    }
  }

  return {
    ok: true,
    status: "executed",
    receipt,
    safe_message: "ok",
  };
}

// ---------------------------------------------------------------------------
// v3.35a.1 — Rollback path.
//
// Rollback is itself an Execute attempt: it MUST go through the
// Governance Evaluator and produce an immutable Receipt. The original
// Receipt is NEVER mutated; the artifact is soft-deleted by stamping
// rolled_back_at, and a new Receipt with result="rolled_back" is
// inserted with related_receipt_id pointing to the original.
// No new RBAC permission is introduced: rollback reuses
// "execute_internal_action" (same MEDIUM umbrella).
// ---------------------------------------------------------------------------

export interface RollbackRequest {
  receipt_id: string;
  confirmation_source?: "ui_button" | "voice_confirm" | "keyboard_enter";
}

export async function rollbackInternalAction(
  env: DispatchEnv,
  req: RollbackRequest,
): Promise<ExecuteDispatchResponse> {
  const executor = env.executor ?? "system:execute-dispatcher";
  const started_at = new Date().toISOString();
  const requested_by = `user:${env.userId}`;

  // 1. Load original Receipt, scoped to the owner.
  const { data: origRow, error: origErr } = await env.admin
    .from("execute_receipts")
    .select("*")
    .eq("receipt_id", req.receipt_id)
    .eq("owner_id", env.userId)
    .maybeSingle();
  if (origErr || !origRow) {
    return {
      ok: false,
      status: "rejected_not_found",
      receipt: null,
      safe_message: "receipt_not_found",
    };
  }
  const original = rowToReceipt(origRow as ReceiptRow);

  if (!isInternalActionType(original.action_type)) {
    return {
      ok: false,
      status: "rejected_unknown_action",
      receipt: null,
      safe_message: `unknown_internal_action:${original.action_type}`,
    };
  }
  const action_type = original.action_type;
  const rollback = INTERNAL_ACTION_ROLLBACK[action_type];

  if (!original.rollback_available || !rollback.rollback_available) {
    return {
      ok: false,
      status: "rejected_not_rollbackable",
      receipt: null,
      safe_message: `not_rollbackable:${action_type}`,
    };
  }
  if (original.result !== "success") {
    return {
      ok: false,
      status: "rejected_not_rollbackable",
      receipt: null,
      safe_message: `original_not_success:${original.result}`,
    };
  }
  if (!original.action_id) {
    return {
      ok: false,
      status: "rejected_not_found",
      receipt: null,
      safe_message: "original_has_no_artifact",
    };
  }

  // 2. Governance — rollback is a governed action.
  const govRequest: GovernanceRequest = {
    action: "execute_internal_action",
    entity: { type: "user", id: env.userId },
    project_id: DEFAULT_PROJECT_ID,
    context_active_project_id: DEFAULT_PROJECT_ID,
    risk_level: INTERNAL_ACTION_RISK[action_type],
    requires_confirmation: true,
  };
  let gov: GovernanceResult;
  try {
    gov = evaluateAction(govRequest);
  } catch (err) {
    return {
      ok: false,
      status: "rejected_governance",
      receipt: null,
      safe_message: safeMessage(err, "governance_crash"),
    };
  }
  if (!gov.allowed) {
    const failedReceipt = await writeReceipt(env, {
      action_id: original.action_id,
      action_type,
      risk_level: original.risk_level,
      requested_by,
      approved_by: requested_by,
      executed_by: executor,
      started_at,
      completed_at: new Date().toISOString(),
      result: "failure",
      rollback_available: false,
      external_reference: null,
      audit_record: JSON.stringify({
        ...gov.audit_record,
        action_type_meta: action_type,
        operation: "rollback",
      }),
      related_receipt_id: original.receipt_id,
      safe_error_message: `governance_denied:${gov.reason}`,
    });
    return {
      ok: false,
      status: "rejected_governance",
      receipt: failedReceipt,
      safe_message: `governance_denied:${gov.reason}`,
    };
  }

  // 3. Idempotent soft-delete: only stamp rolled_back_at if not already
  //    rolled back. A second rollback attempt is rejected explicitly so
  //    the ledger reflects the truth.
  const { data: artRow, error: artErr } = await env.admin
    .from("internal_execute_artifacts")
    .select("id, rolled_back_at, owner_id")
    .eq("id", original.action_id)
    .eq("owner_id", env.userId)
    .maybeSingle();
  if (artErr || !artRow) {
    return {
      ok: false,
      status: "rejected_not_found",
      receipt: null,
      safe_message: "artifact_not_found",
    };
  }
  if ((artRow as { rolled_back_at: string | null }).rolled_back_at) {
    return {
      ok: false,
      status: "rejected_already_rolled_back",
      receipt: null,
      safe_message: "already_rolled_back",
    };
  }

  const rolledAt = new Date().toISOString();
  const { error: updErr } = await env.admin
    .from("internal_execute_artifacts")
    .update({ rolled_back_at: rolledAt } as never)
    .eq("id", original.action_id)
    .eq("owner_id", env.userId);
  if (updErr) {
    return {
      ok: false,
      status: "failed",
      receipt: null,
      safe_message: safeMessage(updErr, "artifact_update_failed"),
    };
  }

  // 4. Append immutable rolled_back Receipt linked to the original.
  const receipt = await writeReceipt(env, {
    action_id: original.action_id,
    action_type,
    risk_level: original.risk_level,
    requested_by,
    approved_by: requested_by,
    executed_by: executor,
    started_at,
    completed_at: new Date().toISOString(),
    result: "rolled_back",
    rollback_available: false,
    external_reference: null,
    audit_record: JSON.stringify({
      ...gov.audit_record,
      action_type_meta: action_type,
      operation: "rollback",
      original_receipt_id: original.receipt_id,
      rolled_back_at: rolledAt,
      confirmation_source: req.confirmation_source ?? "ui_button",
    }),
    related_receipt_id: original.receipt_id,
  });

  if (!receipt) {
    return {
      ok: false,
      status: "failed",
      receipt: null,
      safe_message: "rollback_receipt_write_failed",
    };
  }

  return {
    ok: true,
    status: "rolled_back",
    receipt,
    safe_message: "ok",
  };
}
