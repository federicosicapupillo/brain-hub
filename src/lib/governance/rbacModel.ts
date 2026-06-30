// Brain Hub v3.27.7 — Governance Foundation: RBAC seed model (static).
// No DB reads. Default deny when not explicitly declared.

export type RbacEntityType = "agent" | "module" | "user";
export type RbacRiskLevel = "low" | "medium" | "high" | "critical";

export interface RbacPermissionSet {
  allowed_actions: string[];
  denied_actions: string[];
  requires_confirmation: string[];
  max_risk_level: RbacRiskLevel;
}

export const RBAC_PERMISSIONS: Record<RbacEntityType, RbacPermissionSet> = {
  agent: {
    allowed_actions: [
      "read",
      "suggest",
      "prepare",
      "read_architecture_audit_snapshot",
      "read_os_module_map",
      "read_command_center_data",
      "read_command_center_v2_data",
      "read_priority_engine_data",
    ],
    denied_actions: ["delete", "send", "execute"],
    requires_confirmation: ["prepare"],
    max_risk_level: "medium",
  },
  module: {
    allowed_actions: [
      "read",
      "suggest",
      "prepare",
      "execute",
      "read_architecture_audit_snapshot",
      "read_os_module_map",
      "read_command_center_data",
      "read_command_center_v2_data",
      "read_priority_engine_data",
    ],
    denied_actions: ["delete", "send"],
    requires_confirmation: ["execute"],
    max_risk_level: "high",
  },

  // The `user` entity represents an authenticated end-user acting via
  // the UI. v3.35a — Internal Execute Layer: users may execute the 8
  // MEDIUM internal actions through the Execute Dispatcher. The
  // dispatcher itself enforces the per-action_type allowlist (in
  // src/lib/execute-dispatcher/types.ts) and Confirm gating — RBAC only
  // sees the umbrella action name and the declared risk_level.
  user: {
    allowed_actions: [
      "execute_internal_action",
      "execute_external_action",
      // v3.35c — Orphan Gate Reaper: never invokes a handler, only
      // writes a recovery receipt and stamps the orphaned gate.
      "recover_orphan_execute_gate",
      // v3.35d — Execute Console UI: read-only aggregate of the
      // already-approved Execute surface (capabilities, receipts,
      // artifacts, orphan/manual-review state). No write power.
      "read_execute_console_data",
    ],
    denied_actions: ["delete", "send"],
    requires_confirmation: ["execute_internal_action", "execute_external_action"],
    max_risk_level: "medium",
  },
};

export const AGENT_TOOL_CONTRACTS: Record<string, { allowed_tools: string[] }> = {
  "agent:jack": {
    allowed_tools: [
      "read",
      "suggest",
      "prepare",
      "read_architecture_audit_snapshot",
      "read_os_module_map",
      "read_command_center_data",
      "read_command_center_v2_data",
      "read_priority_engine_data",
    ],
  },
};


const RISK_RANK: Record<RbacRiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function isRiskWithinLimit(
  risk: RbacRiskLevel,
  max: RbacRiskLevel,
): boolean {
  return RISK_RANK[risk] <= RISK_RANK[max];
}
