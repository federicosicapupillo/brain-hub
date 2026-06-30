// Brain Hub v3.29 — Command Center data endpoint.
// Server-side enforced via Governance Evaluator. Returns availability +
// data for each source, honest about empty / missing / unknown states.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import auditSnapshot from "@/architecture-audit/snapshots/brainhub-os-audit-phase1.json";
import {
  evaluateAction,
  type GovernanceRequest,
} from "@/lib/governance/governanceEvaluator";
import type {
  RbacEntityType,
  RbacRiskLevel,
} from "@/lib/governance/rbacModel";
import { deriveOsModules } from "@/lib/os/os-modules";
import type { Database } from "@/integrations/supabase/types";

const PROJECT_ID = "brainhub-os";

type Availability = "live" | "empty" | "missing" | "unknown";

interface Source<T> {
  availability: Availability;
  data: T[] | null;
  error?: string;
}

interface ConnectorStatus {
  availability: Availability;
  connected: boolean | null;
  detail?: string;
}

interface SystemStatus {
  governance_confidence: number | null;
  modules_active: number;
  modules_partial: number;
  modules_empty: number;
  modules_future: number;
  last_audit_at: string | null;
  last_enforcement_at: string | null;
}

export interface CommandCenterData {
  system_status: SystemStatus;
  projects: Source<{
    id: string;
    title: string;
    status: string | null;
    link_type: string;
    updated_at: string;
  }>;
  action_queue: Source<{
    id: string;
    title: string;
    status: string;
    priority: string;
    risk_level: string;
    requires_confirmation: boolean;
    created_at: string;
  }>;
  result_review: Source<{
    id: string;
    title: string;
    review_status: string;
    source_type: string;
    risk_level: string | null;
    created_at: string;
  }>;
  agent_runs: Source<{
    id: string;
    objective: string;
    run_status: string;
    run_mode: string;
    risk_level: string;
    created_at: string;
  }>;
  connectors: {
    gmail: ConnectorStatus;
    github: ConnectorStatus;
  };
}

function resolveEntity(url: URL): { type: RbacEntityType; id: string } {
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    const id = url.searchParams.get("entity_id");
    const type = url.searchParams.get("entity_type") as RbacEntityType | null;
    if (id) return { type: type ?? "agent", id };
  }
  return { type: "agent", id: "agent:jack" };
}

function emptyOrLive<T>(rows: T[] | null, error: unknown): Source<T> {
  if (error) {
    return {
      availability: "unknown",
      data: null,
      error: (error as { message?: string }).message ?? "query_failed",
    };
  }
  if (!rows) return { availability: "unknown", data: null };
  if (rows.length === 0) return { availability: "empty", data: [] };
  return { availability: "live", data: rows };
}

function computeSystemStatus(): SystemStatus {
  const modules = deriveOsModules(auditSnapshot);
  const counts = { active: 0, partial: 0, empty: 0, future: 0 };
  for (const m of modules) counts[m.status] += 1;

  const snap = auditSnapshot as unknown as {
    governance_confidence?: { value?: number };
    generated_at?: { value?: string } | string;
  };
  const conf =
    typeof snap.governance_confidence?.value === "number"
      ? snap.governance_confidence.value
      : null;
  const generated =
    typeof snap.generated_at === "string"
      ? snap.generated_at
      : snap.generated_at?.value ?? null;

  return {
    governance_confidence: conf,
    modules_active: counts.active,
    modules_partial: counts.partial,
    modules_empty: counts.empty,
    modules_future: counts.future,
    last_audit_at: generated,
    last_enforcement_at: null,
  };
}

export const Route = createFileRoute("/api/command-center-data")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const entity = resolveEntity(url);

        const govRequest: GovernanceRequest = {
          action: "read_command_center_data",
          entity,
          project_id: PROJECT_ID,
          context_active_project_id: PROJECT_ID,
          risk_level: "low" as RbacRiskLevel,
          requires_confirmation: false,
        };
        const gov = evaluateAction(govRequest);

        if (!gov.allowed) {
          return new Response(
            JSON.stringify({
              error: "forbidden",
              reason: gov.reason,
              audit_record: gov.audit_record,
            }),
            { status: 403, headers: { "content-type": "application/json" } },
          );
        }

        const system_status = computeSystemStatus();

        // Authenticate user via bearer token (RLS-scoped reads).
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

        if (!token || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          // No user session: return only honest unknown states.
          const unknownSrc = { availability: "unknown" as const, data: null };
          const payload: CommandCenterData = {
            system_status,
            projects: unknownSrc,
            action_queue: unknownSrc,
            result_review: unknownSrc,
            agent_runs: unknownSrc,
            connectors: {
              gmail: {
                availability: "unknown",
                connected: null,
                detail: "no_session",
              },
              github: {
                availability: "unknown",
                connected: null,
                detail: "no_session",
              },
            },
          };
          return Response.json({
            data: payload,
            governance: {
              allowed: true,
              checks: gov.checks,
              audit_record: gov.audit_record,
            },
          });
        }

        const supabase = createClient<Database>(
          SUPABASE_URL,
          SUPABASE_PUBLISHABLE_KEY,
          {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: {
              storage: undefined,
              persistSession: false,
              autoRefreshToken: false,
            },
          },
        );

        const [
          projectsRes,
          actionsRes,
          reviewRes,
          runsRes,
          gmailRes,
          githubRes,
        ] = await Promise.all([
          supabase
            .from("project_links")
            .select("id,title,status,link_type,updated_at")
            .eq("link_type", "project")
            .order("updated_at", { ascending: false })
            .limit(10),
          supabase
            .from("automation_actions")
            .select(
              "id,title,status,priority,risk_level,requires_confirmation,created_at",
            )
            .in("status", ["suggested", "pending", "blocked", "approved"])
            .order("created_at", { ascending: false })
            .limit(10),
          supabase
            .from("result_review_items")
            .select(
              "id,title,review_status,source_type,risk_level,created_at",
            )
            .eq("review_status", "pending_review")
            .order("created_at", { ascending: false })
            .limit(10),
          supabase
            .from("agent_run_logs")
            .select(
              "id,objective,run_status,run_mode,risk_level,created_at",
            )
            .order("created_at", { ascending: false })
            .limit(10),
          supabase
            .from("gmail_connection_settings")
            .select("id")
            .limit(1),
          supabase
            .from("github_repository_registry")
            .select("id")
            .limit(1),
        ]);

        function connector(
          res: { data: unknown[] | null; error: unknown },
        ): ConnectorStatus {
          if (res.error) {
            return {
              availability: "unknown",
              connected: null,
              detail: (res.error as { message?: string }).message ?? "error",
            };
          }
          if (!res.data) {
            return { availability: "unknown", connected: null };
          }
          if (res.data.length === 0) {
            return { availability: "empty", connected: false };
          }
          return { availability: "live", connected: true };
        }

        const payload: CommandCenterData = {
          system_status,
          projects: emptyOrLive(projectsRes.data, projectsRes.error),
          action_queue: emptyOrLive(actionsRes.data, actionsRes.error),
          result_review: emptyOrLive(reviewRes.data, reviewRes.error),
          agent_runs: emptyOrLive(runsRes.data, runsRes.error),
          connectors: {
            gmail: connector(gmailRes),
            github: connector(githubRes),
          },
        };

        return Response.json({
          data: payload,
          governance: {
            allowed: true,
            checks: gov.checks,
            audit_record: gov.audit_record,
          },
        });
      },
    },
  },
});
