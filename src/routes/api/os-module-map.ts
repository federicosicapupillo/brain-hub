// Brain Hub v3.28 — OS Module Map server endpoint.
// Gated by Governance Evaluator. Returns the 9 OS modules with status
// derived from the architecture audit snapshot. Never imported on client.

import { createFileRoute } from "@tanstack/react-router";
import auditSnapshot from "@/architecture-audit/snapshots/brainhub-os-audit-phase1.json";
import {
  evaluateAction,
  type GovernanceRequest,
} from "@/lib/governance/governanceEvaluator";
import type { RbacEntityType, RbacRiskLevel } from "@/lib/governance/rbacModel";
import { deriveOsModules } from "@/lib/os/os-modules";

const PROJECT_ID = "brainhub-os";

function resolveEntity(url: URL): { type: RbacEntityType; id: string } {
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    const id = url.searchParams.get("entity_id");
    const type = url.searchParams.get("entity_type") as RbacEntityType | null;
    if (id) return { type: type ?? "agent", id };
  }
  return { type: "agent", id: "agent:jack" };
}

export const Route = createFileRoute("/api/os-module-map")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const entity = resolveEntity(url);

        const govRequest: GovernanceRequest = {
          action: "read_os_module_map",
          entity,
          project_id: PROJECT_ID,
          context_active_project_id: PROJECT_ID,
          risk_level: "low" as RbacRiskLevel,
          requires_confirmation: false,
        };
        const result = evaluateAction(govRequest);

        if (!result.allowed) {
          return new Response(
            JSON.stringify({
              error: "forbidden",
              reason: result.reason,
              audit_record: result.audit_record,
            }),
            { status: 403, headers: { "content-type": "application/json" } },
          );
        }

        const modules = deriveOsModules(auditSnapshot);
        return Response.json({
          modules,
          governance: {
            allowed: true,
            checks: result.checks,
            audit_record: result.audit_record,
          },
        });
      },
    },
  },
});
