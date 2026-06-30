// Brain Hub v3.35a — Internal Execute Layer: shared types.
// Runtime Risk Model v1.1 — Execute Receipt is the immutable artifact
// produced for every Execute attempt. Read-only actions never produce
// receipts; only mutative Execute does.

import type { RbacRiskLevel } from "@/lib/governance/rbacModel";

/**
 * Internal-only MEDIUM actions (v3.35a). HIGH/external actions are NOT
 * dispatchable through this layer — see v3.35b (External Execute).
 */
export const INTERNAL_ACTION_TYPES = [
  "create_action",
  "update_action",
  "prepare_email_draft",
  "prepare_codex_prompt",
  "create_review",
  "create_project_note",
  "create_snapshot",
  "create_memory_entry",
] as const;
export type InternalActionType = (typeof INTERNAL_ACTION_TYPES)[number];

export function isInternalActionType(t: string): t is InternalActionType {
  return (INTERNAL_ACTION_TYPES as readonly string[]).includes(t);
}

/**
 * Per-action risk classification (Runtime Risk Model v1.1 §"Come un
 * modulo applica questo modello"). Declared explicitly per ADR/RRM.
 * Every action in this layer is MEDIUM — they all mutate internal
 * Brain Hub state without touching external systems. HIGH actions are
 * intentionally not present.
 */
export const INTERNAL_ACTION_RISK: Readonly<Record<InternalActionType, RbacRiskLevel>> =
  Object.freeze({
    create_action: "medium",
    update_action: "medium",
    prepare_email_draft: "medium",
    prepare_codex_prompt: "medium",
    create_review: "medium",
    create_project_note: "medium",
    create_snapshot: "medium",
    create_memory_entry: "medium",
  });

/**
 * Rollback policy per action_type. Documented explicitly so the
 * dispatcher can populate `rollback_available` on every Receipt without
 * guessing, and so the EQG audit can be derived from a single source.
 */
export const INTERNAL_ACTION_ROLLBACK: Readonly<
  Record<InternalActionType, { rollback_available: boolean; note: string }>
> = Object.freeze({
  // Soft-delete via rolled_back_at column on internal_execute_artifacts.
  create_action: { rollback_available: true, note: "soft_delete_via_rolled_back_at" },
  update_action: { rollback_available: true, note: "soft_delete_via_rolled_back_at" },
  prepare_email_draft: { rollback_available: true, note: "soft_delete_via_rolled_back_at" },
  prepare_codex_prompt: { rollback_available: true, note: "soft_delete_via_rolled_back_at" },
  create_review: { rollback_available: true, note: "soft_delete_via_rolled_back_at" },
  create_project_note: { rollback_available: true, note: "soft_delete_via_rolled_back_at" },
  create_memory_entry: { rollback_available: true, note: "soft_delete_via_rolled_back_at" },
  // Snapshots are point-in-time historical records by design — rolling
  // them back would defeat their purpose. Declared explicitly as
  // non-rollbackable in line with runtime-risk-model §5 ("rollback non
  // previsto, dichiarato esplicitamente").
  create_snapshot: { rollback_available: false, note: "historical_record_no_rollback" },
});

export interface ExecuteReceipt {
  receipt_id: string;
  action_id: string; // id of the artifact (or target row) the Execute produced/affected
  action_type: InternalActionType;
  risk_level: RbacRiskLevel;
  requested_by: string;
  approved_by: string | null;
  executed_by: string;
  started_at: string;
  completed_at: string | null;
  result: "success" | "failure" | "partial";
  rollback_available: boolean;
  external_reference: string | null; // always null in v3.35a (internal only)
  audit_record: string; // textual reference to the governance audit_record
  related_receipt_id?: string | null;
  idempotency_key?: string | null;
  safe_error_message?: string | null;
}

/**
 * Dispatcher request shape. The caller is responsible for proving that
 * Confirm happened (Principio 5 / RRM): `confirmed_at` must be ISO and
 * `confirmation_source` must be present. The dispatcher records both on
 * the Receipt; missing/invalid Confirm is a hard failure.
 */
export interface ExecuteDispatchRequest {
  action_type: InternalActionType;
  /** Required to make retries safe. Same key + same owner → same receipt. */
  idempotency_key: string;
  /** Confirm signal — must be present, ISO, and within a sane window. */
  confirmed_at: string;
  confirmation_source: "ui_button" | "voice_confirm" | "keyboard_enter";
  /** Free-form per-action payload, validated by the handler. */
  payload: Record<string, unknown>;
  /** Optional human title for the artifact. Falls back per handler. */
  title?: string;
  /** Optional client-supplied requestedBy label (e.g. "agent:jack"). */
  requested_by_label?: string;
  /** Project scope for governance. Defaults to brainhub-os if omitted. */
  project_id?: string;
}

export interface ExecuteDispatchResponse {
  ok: boolean;
  status:
    | "executed"
    | "replayed" // idempotency hit; pre-existing receipt returned
    | "rejected_governance"
    | "rejected_confirm"
    | "rejected_validation"
    | "rejected_unknown_action"
    | "failed";
  receipt: ExecuteReceipt | null;
  safe_message: string;
}
