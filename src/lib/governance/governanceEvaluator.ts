// Brain Hub v3.27.7 — Governance Foundation: Evaluator service.
// Pure in-memory enforcement chain. No DB reads, no DB writes.

import {
  AGENT_TOOL_CONTRACTS,
  RBAC_PERMISSIONS,
  isRiskWithinLimit,
  type RbacEntityType,
  type RbacRiskLevel,
} from "./rbacModel";
import { evaluateProjectIsolation } from "./projectIsolation";

export interface GovernanceRequest {
  action: string;
  entity: {
    type: RbacEntityType;
    id: string;
  };
  project_id: string;
  context_active_project_id: string;
  cross_project?: boolean;
  risk_level: RbacRiskLevel;
  requires_confirmation: boolean;
}

export type GovernanceCheckStatus = "pass" | "fail" | "skip";

export interface GovernanceChecks {
  project_isolation: GovernanceCheckStatus;
  rbac: GovernanceCheckStatus;
  policy: GovernanceCheckStatus;
  agent_permission: GovernanceCheckStatus;
}

export interface GovernanceAuditRecord {
  action: string;
  entity_type: string;
  entity_id: string;
  project_id: string;
  result: "pass" | "fail";
  checks: GovernanceChecks;
  reason: string;
  timestamp: string;
  cross_project_note?: string;
}

export interface GovernanceResult {
  allowed: boolean;
  reason: string;
  checks: GovernanceChecks;
  requires_confirmation: boolean;
  audit_log_required: boolean;
  audit_record: GovernanceAuditRecord;
}

function buildResult(
  request: GovernanceRequest,
  checks: GovernanceChecks,
  allowed: boolean,
  reason: string,
  cross_project_note?: string,
): GovernanceResult {
  const audit_record: GovernanceAuditRecord = {
    action: request.action,
    entity_type: request.entity.type,
    entity_id: request.entity.id,
    project_id: request.project_id,
    result: allowed ? "pass" : "fail",
    checks,
    reason,
    timestamp: new Date().toISOString(),
    ...(cross_project_note ? { cross_project_note } : {}),
  };
  return {
    allowed,
    reason,
    checks,
    requires_confirmation: allowed ? request.requires_confirmation : false,
    audit_log_required: true,
    audit_record,
  };
}

export function evaluateAction(request: GovernanceRequest): GovernanceResult {
  const checks: GovernanceChecks = {
    project_isolation: "skip",
    rbac: "skip",
    policy: "skip",
    agent_permission: "skip",
  };

  // 1. Project Isolation
  const iso = evaluateProjectIsolation({
    project_id: request.project_id,
    context_active_project_id: request.context_active_project_id,
    cross_project: request.cross_project,
  });
  if (!iso.pass) {
    checks.project_isolation = "fail";
    return buildResult(request, checks, false, iso.reason);
  }
  checks.project_isolation = "pass";

  // 2. RBAC
  const perms = RBAC_PERMISSIONS[request.entity.type];
  if (!perms) {
    checks.rbac = "fail";
    return buildResult(request, checks, false, "rbac_entity_type_unknown");
  }
  if (perms.denied_actions.includes(request.action)) {
    checks.rbac = "fail";
    return buildResult(
      request,
      checks,
      false,
      `rbac_action_denied:${request.action}`,
    );
  }
  if (!perms.allowed_actions.includes(request.action)) {
    checks.rbac = "fail";
    return buildResult(
      request,
      checks,
      false,
      `rbac_action_not_allowed:${request.action}`,
    );
  }
  checks.rbac = "pass";

  // 3. Policy (risk level vs entity max)
  if (!isRiskWithinLimit(request.risk_level, perms.max_risk_level)) {
    checks.policy = "fail";
    return buildResult(
      request,
      checks,
      false,
      `policy_risk_exceeds_max:${request.risk_level}>${perms.max_risk_level}`,
    );
  }
  checks.policy = "pass";

  // 4. Agent Permission
  if (request.entity.type === "agent") {
    const contract = AGENT_TOOL_CONTRACTS[request.entity.id];
    if (!contract) {
      checks.agent_permission = "fail";
      return buildResult(
        request,
        checks,
        false,
        `agent_permission_missing_contract:${request.entity.id}`,
      );
    }
    if (!contract.allowed_tools.includes(request.action)) {
      checks.agent_permission = "fail";
      return buildResult(
        request,
        checks,
        false,
        `agent_permission_tool_not_allowed:${request.action}`,
      );
    }
    checks.agent_permission = "pass";
  } else {
    checks.agent_permission = "skip";
  }

  return buildResult(
    request,
    checks,
    true,
    "allowed",
    iso.cross_project_note,
  );
}
