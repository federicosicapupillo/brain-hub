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
      "read_priority_engine_data",
    ],
    denied_actions: ["delete", "send"],
    requires_confirmation: ["execute"],
    max_risk_level: "high",
  },

  user: {
    allowed_actions: [],
    denied_actions: [],
    requires_confirmation: [],
    max_risk_level: "critical",
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
