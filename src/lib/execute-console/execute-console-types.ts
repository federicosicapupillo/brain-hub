// Brain Hub v3.35d — Execute Console UI: shared types.
//
// Pure types + capability descriptors. NO new action_type, NO new
// connector. Mirrors the approved Internal/External dispatchers and the
// Orphan Gate Reaper output. The UI never invents a capability — if it
// is not declared here as available, the UI must show it as blocked /
// not_supported.

import type { RbacRiskLevel } from "@/lib/governance/rbacModel";

export type ExecuteScope = "internal" | "external";

export type ConsoleSourceStatus =
  | "live"
  | "empty"
  | "missing"
  | "error"
  | "loading"
  | "unknown";

export interface ConsoleSourceMeta {
  status: ConsoleSourceStatus;
  duration_ms: number;
  source_table: string;
  error_safe_message?: string;
  count: number;
}

export interface ConsoleCapability {
  action_type: string;
  scope: ExecuteScope;
  risk_level: RbacRiskLevel;
  enabled: boolean;
  supports_dry_run: boolean;
  supports_live_execute: boolean;
  supports_rollback: boolean;
  requires_confirmation: boolean;
  status: "available" | "blocked" | "not_supported";
  blocked_reason: string | null;
  description: string;
}

export interface ConsoleBlockedAction {
  action_type: string;
  scope: ExecuteScope | "unknown";
  reason_kind:
    | "high_live_blocked"
    | "medium_external_connector_not_implemented"
    | "unknown_action_type"
    | "rollback_not_supported"
    | "manual_review_required";
  reason: string;
  risk_level: RbacRiskLevel | "unknown";
}

export interface ConsoleReceipt {
  receipt_id: string;
  action_type: string;
  scope: ExecuteScope | "unknown";
  risk_level: string;
  result: string; // success | failure | rolled_back | partial
  outcome_kind:
    | "executed"
    | "replayed"
    | "rolled_back"
    | "failed"
    | "orphaned_failed"
    | "orphaned_unknown_requires_manual_review"
    | "manual_review_required"
    | "other";
  started_at: string;
  completed_at: string | null;
  idempotency_key_preview: string | null;
  related_receipt_id: string | null;
  rollback_available: boolean;
  external_reference: string | null;
  audit_record_preview: string;
  safe_error_message: string | null;
  requires_manual_review: boolean;
}

export interface ConsoleArtifact {
  id: string;
  action_type: string;
  execute_scope: ExecuteScope; // "external" if payload.execute_scope === "external"
  risk_level: string;
  title: string;
  created_at: string;
  rolled_back_at: string | null;
  payload_preview: Record<string, unknown>;
}

export interface ConsoleOrphanState {
  idempotency_key_preview: string;
  action_type: string;
  scope: ExecuteScope | "unknown";
  risk_level: RbacRiskLevel | "unknown";
  decision:
    | "orphaned_failed"
    | "orphaned_unknown_requires_manual_review"
    | "pending";
  retry_allowed: boolean;
  requires_manual_review: boolean;
  auto_reexecuted: false;
  receipt_id: string | null;
  gate_age_ms: number | null;
  created_at: string;
}

export interface ConsoleEngineStatus {
  internal_execute_enabled: boolean;
  external_sandbox_execute_enabled: boolean;
  orphan_gate_reaper_enabled: boolean;
  high_live_actions_blocked: true;
  medium_external_connector_available: false;
  last_receipt_at: string | null;
  last_orphan_recovery_at: string | null;
  warnings: string[];
}

export interface ExecuteConsoleData {
  engine_status: ConsoleEngineStatus;
  available_actions: ConsoleCapability[];
  blocked_actions: ConsoleBlockedAction[];
  recent_receipts: ConsoleReceipt[];
  recent_artifacts: ConsoleArtifact[];
  orphan_states: ConsoleOrphanState[];
  rollback_candidates: ConsoleArtifact[];
  manual_review_items: ConsoleReceipt[];
  capabilities: {
    internal_action_count: number;
    external_action_count: number;
    rollbackable_action_count: number;
  };
  warnings: string[];
  source_status: {
    receipts: ConsoleSourceMeta;
    artifacts: ConsoleSourceMeta;
    idempotency: ConsoleSourceMeta;
  };
  timings: {
    total_ms: number;
    per_source_ms: Record<string, number>;
  };
  provenance: {
    generated_at: string;
    project_id: string;
    user_scoped: true;
  };
}
