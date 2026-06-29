// Brain Hub v3.27.8 — Governance Runtime Enforcement
// Server endpoint: gates access to the architecture audit snapshot
// through the in-memory Governance Evaluator (server-side enforcement).

import { createFileRoute } from "@tanstack/react-router";
import auditSnapshot from "@/architecture-audit/snapshots/brainhub-os-audit-phase1.json";
import {
  evaluateAction,
  type GovernanceRequest,
} from "@/lib/governance/governanceEvaluator";
import type { RbacEntityType, RbacRiskLevel } from "@/lib/governance/rbacModel";

const DEFAULT_PROJECT_ID = "brainhub-os";

function resolveEntity(url: URL): { type: RbacEntityType; id: string } {
  // DEV-ONLY: allow `entity_id` and `entity_type` overrides via query string so
  // the fixture suite can exercise the runtime FAIL path. In a real runtime
  // the entity MUST be resolved server-side from the authenticated session.
  // Do NOT promote this pattern to production trust boundaries.
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    const id = url.searchParams.get("entity_id");
    const type = url.searchParams.get("entity_type") as RbacEntityType | null;
    if (id) {
      return { type: type ?? "agent", id };
    }
  }
  return { type: "agent", id: "agent:jack" };
}

async function persistAuditRecord(
  record: Record<string, unknown>,
): Promise<void> {
  try {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    // Best-effort write into architecture_audit_runs. The existing schema is
    // shaped for snapshot summaries, not governance records; mismatches are
    // expected and must NOT block the read or the v3.28 checkpoint.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabaseAdmin as any)
      .from("architecture_audit_runs")
      .insert({
        snapshot_id: `governance:${record.action}`,
        phase: String(record.result),
        routes_count: 0,
        services_count: 0,
        tables_count: 0,
        dependencies_count: 0,
        low_confidence_count: 0,
        limits: record,
      });
    if (error) {
      // eslint-disable-next-line no-console
      console.error(
        "[governance.audit] persistence_failed (non-blocking)",
        error.message,
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      "[governance.audit] persistence_exception (non-blocking)",
      err,
    );
  }
}

export const Route = createFileRoute("/api/architecture-audit-snapshot")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const entity = resolveEntity(url);
        const projectId =
          url.searchParams.get("project_id") ?? DEFAULT_PROJECT_ID;

        const govRequest: GovernanceRequest = {
          action: "read_architecture_audit_snapshot",
          entity,
          project_id: projectId,
          context_active_project_id: projectId,
          risk_level: "low" as RbacRiskLevel,
          requires_confirmation: false,
        };

        const result = evaluateAction(govRequest);

        // Fire-and-forget audit persistence (do not block the response).
        void persistAuditRecord(
          result.audit_record as unknown as Record<string, unknown>,
        );

        if (!result.allowed) {
          return new Response(
            JSON.stringify({
              error: "forbidden",
              reason: result.reason,
              audit_record: result.audit_record,
            }),
            {
              status: 403,
              headers: { "content-type": "application/json" },
            },
          );
        }

        return Response.json({
          snapshot: auditSnapshot,
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
