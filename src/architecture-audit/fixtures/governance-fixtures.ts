// Brain Hub v3.27.7 — Governance Foundation: verification fixtures.
// In-memory only. Run with: bun run src/architecture-audit/fixtures/governance-fixtures.ts

import {
  evaluateAction,
  type GovernanceRequest,
  type GovernanceResult,
} from "@/lib/governance/governanceEvaluator";

interface Fixture {
  name: string;
  request: GovernanceRequest;
  expect: {
    allowed: boolean;
    check?: keyof GovernanceResult["checks"];
    check_value?: "pass" | "fail" | "skip";
  };
}

const PROJECT = "proj_alpha";

const FIXTURES: Fixture[] = [
  {
    name: "PASS — agent jack, read, low risk, same project",
    request: {
      action: "read",
      entity: { type: "agent", id: "agent:jack" },
      project_id: PROJECT,
      context_active_project_id: PROJECT,
      risk_level: "low",
      requires_confirmation: false,
    },
    expect: { allowed: true },
  },
  {
    name: "FAIL — Project Isolation (project mismatch, no cross_project)",
    request: {
      action: "read",
      entity: { type: "agent", id: "agent:jack" },
      project_id: "proj_other",
      context_active_project_id: PROJECT,
      risk_level: "low",
      requires_confirmation: false,
    },
    expect: { allowed: false, check: "project_isolation", check_value: "fail" },
  },
  {
    name: "FAIL — RBAC (agent attempts delete)",
    request: {
      action: "delete",
      entity: { type: "agent", id: "agent:jack" },
      project_id: PROJECT,
      context_active_project_id: PROJECT,
      risk_level: "low",
      requires_confirmation: false,
    },
    expect: { allowed: false, check: "rbac", check_value: "fail" },
  },
  {
    name: "FAIL — Risk Level (prepare with critical risk > medium max)",
    request: {
      action: "prepare",
      entity: { type: "agent", id: "agent:jack" },
      project_id: PROJECT,
      context_active_project_id: PROJECT,
      risk_level: "critical",
      requires_confirmation: true,
    },
    expect: { allowed: false, check: "policy", check_value: "fail" },
  },
  {
    name: "FAIL — Agent Permission (unknown agent not in AGENT_TOOL_CONTRACTS)",
    request: {
      action: "read",
      entity: { type: "agent", id: "agent:unknown" },
      project_id: PROJECT,
      context_active_project_id: PROJECT,
      risk_level: "low",
      requires_confirmation: false,
    },
    expect: { allowed: false, check: "agent_permission", check_value: "fail" },
  },
];

export function runGovernanceFixtures(): {
  passed: number;
  failed: number;
  records: GovernanceResult["audit_record"][];
} {
  let passed = 0;
  let failed = 0;
  const records: GovernanceResult["audit_record"][] = [];

  for (const fx of FIXTURES) {
    const result = evaluateAction(fx.request);
    records.push(result.audit_record);

    const allowedOk = result.allowed === fx.expect.allowed;
    const checkOk =
      !fx.expect.check ||
      result.checks[fx.expect.check] === fx.expect.check_value;
    const ok = allowedOk && checkOk;

    // eslint-disable-next-line no-console
    console.log(
      `[${ok ? "OK" : "MISMATCH"}] ${fx.name}\n  result=${JSON.stringify(
        {
          allowed: result.allowed,
          reason: result.reason,
          checks: result.checks,
        },
      )}\n  audit_record=${JSON.stringify(result.audit_record)}`,
    );

    if (ok) passed += 1;
    else failed += 1;
  }

  // eslint-disable-next-line no-console
  console.log(
    `\nGovernance Fixtures Summary: ${passed} passed, ${failed} failed (of ${FIXTURES.length})`,
  );

  return { passed, failed, records };
}

// Runtime fixtures — hit the real server endpoint to verify server-side enforcement.
export async function runGovernanceRuntimeFixtures(
  baseUrl: string = process.env.GOVERNANCE_FIXTURE_BASE_URL ??
    "http://localhost:8080",
): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  async function check(name: string, path: string, expected: number) {
    try {
      const res = await fetch(`${baseUrl}${path}`);
      const body = await res.json().catch(() => null);
      const ok = res.status === expected;
      // eslint-disable-next-line no-console
      console.log(
        `[${ok ? "OK" : "MISMATCH"}] ${name} → status=${res.status} expected=${expected}`,
        body && typeof body === "object" && "governance" in body
          ? { checks: (body as { governance?: { checks?: unknown } }).governance?.checks }
          : body,
      );
      if (ok) passed += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.log(`[ERROR] ${name}`, err);
    }
  }

  await check(
    "Runtime PASS — agent:jack → 200",
    "/api/architecture-audit-snapshot",
    200,
  );
  await check(
    "Runtime FAIL — agent:unknown → 403",
    "/api/architecture-audit-snapshot?entity_id=agent:unknown",
    403,
  );

  // eslint-disable-next-line no-console
  console.log(
    `\nGovernance Runtime Fixtures Summary: ${passed} passed, ${failed} failed`,
  );
  return { passed, failed };
}

// Auto-run when executed directly (bun run ...)
declare const require: { main?: unknown } | undefined;
declare const module: unknown;
if (typeof require !== "undefined" && require.main === module) {
  runGovernanceFixtures();
}
