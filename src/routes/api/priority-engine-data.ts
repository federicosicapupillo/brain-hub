// Brain Hub v3.31 — Priority Engine endpoint ("Today's Focus")
// Follows the v3.30.1 hardening contract:
//   - HTTP 200 on governance pass even with required source failures
//     (failure is expressed in the payload, never in the HTTP status);
//   - HTTP 403 only for governance/RBAC fail;
//   - HTTP 500 only for systemic failures (e.g. evaluator crash);
//   - Per-source isolation via runSource (Partial Failure Pattern).
//
// Reuses the v3.30.1 `__force_fail` dev-only switch — no new mechanism.
// Reuses the v3.30.1 logging pattern with the
// priority_engine_source_error / priority_engine_slow_widget events.
//
// The slow-widget threshold mirrors the Command Center one; surfaced
// explicitly in `debug.slow_source_threshold_ms`.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import {
  evaluateAction,
  type GovernanceRequest,
} from "@/lib/governance/governanceEvaluator";
import type { RbacEntityType, RbacRiskLevel } from "@/lib/governance/rbacModel";
import {
  PRIORITY_SOURCE_CRITICALITY,
  PRIORITY_SOURCE_KEYS,
  computePriorities,
  type PriorityEngineInputs,
  type PrioritySourceKey,
} from "@/lib/priority-engine/priority-engine";
import type { DataTrustStatus } from "@/lib/data-trust/types";
import type { Database } from "@/integrations/supabase/types";

const PROJECT_ID = "brainhub-os";
export const PRIORITY_ENGINE_SLOW_SOURCE_THRESHOLD_MS = 1000;

type SupabaseLike = ReturnType<typeof createClient<Database>>;

function resolveEntity(url: URL): { type: RbacEntityType; id: string } {
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    const id = url.searchParams.get("entity_id");
    const type = url.searchParams.get("entity_type") as RbacEntityType | null;
    if (id) return { type: type ?? "agent", id };
  }
  return { type: "agent", id: "agent:jack" };
}

function safeErrorMessage(err: unknown): string {
  const msg = (err as { message?: string } | null)?.message ?? "query_failed";
  return msg
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+/g, "[redacted-email]")
    .slice(0, 200);
}

async function logAnomaly(
  event: "priority_engine_source_error" | "priority_engine_slow_source",
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    const { writeJackGptEventLog } = await import("@/lib/jack-gpt-log.server");
    await writeJackGptEventLog({ event, metadata });
  } catch {
    // Telemetry must never bubble.
  }
}

interface RawSourceResult<T> {
  status: DataTrustStatus;
  rows: T[];
  freshness: string | null;
  error_safe_message?: string;
  duration_ms: number;
}

async function runSource<T>(
  key: PrioritySourceKey,
  fn: () => Promise<{ data: T[] | null; error: unknown }>,
): Promise<RawSourceResult<T>> {
  const t0 = Date.now();
  try {
    const res = await fn();
    const duration_ms = Date.now() - t0;
    if (res.error) {
      const safe = safeErrorMessage(res.error);
      await logAnomaly("priority_engine_source_error", {
        source: key,
        message: safe,
        duration_ms,
      });
      return {
        status: "error",
        rows: [],
        freshness: null,
        error_safe_message: safe,
        duration_ms,
      };
    }
    const rows = res.data ?? null;
    if (rows === null) {
      return { status: "unknown", rows: [], freshness: null, duration_ms };
    }
    if (rows.length === 0) {
      return { status: "empty", rows: [], freshness: null, duration_ms };
    }
    return {
      status: "live",
      rows,
      freshness: new Date().toISOString(),
      duration_ms,
    };
  } catch (err) {
    const duration_ms = Date.now() - t0;
    const safe = safeErrorMessage(err);
    await logAnomaly("priority_engine_source_error", {
      source: key,
      message: safe,
      duration_ms,
    });
    return {
      status: "error",
      rows: [],
      freshness: null,
      error_safe_message: safe,
      duration_ms,
    };
  }
}

function missingSource<T>(): RawSourceResult<T> {
  return { status: "missing", rows: [], freshness: null, duration_ms: 0 };
}

async function loadInputs(
  supabase: SupabaseLike | null,
  shouldFail: (k: string) => boolean,
): Promise<{
  inputs: PriorityEngineInputs;
  per_source_timing: Record<PrioritySourceKey, number>;
}> {
  if (!supabase) {
    const empty = missingSource();
    return {
      inputs: {
        action_queue: empty,
        result_review: empty,
        projects: empty,
        agent_runs: empty,
        gmail: empty,
        github: empty,
      } as PriorityEngineInputs,
      per_source_timing: {
        action_queue: 0,
        result_review: 0,
        projects: 0,
        agent_runs: 0,
        gmail: 0,
        github: 0,
      },
    };
  }

  const [action_queue, result_review, projects, agent_runs, gmail, github] =
    await Promise.all([
      runSource("action_queue", async () => {
        if (shouldFail("action_queue")) throw new Error("forced_failure");
        return supabase
          .from("automation_actions")
          .select("id,title,status,priority,risk_level,created_at")
          .in("status", ["blocked", "failed"])
          .order("created_at", { ascending: false })
          .limit(20);
      }),
      runSource("result_review", async () => {
        if (shouldFail("result_review")) throw new Error("forced_failure");
        return supabase
          .from("result_review_items")
          .select("id,title,review_status,risk_level,source_type,created_at")
          .eq("review_status", "pending_review")
          .order("created_at", { ascending: false })
          .limit(20);
      }),
      runSource("projects", async () => {
        if (shouldFail("projects")) throw new Error("forced_failure");
        return supabase
          .from("project_links")
          .select("id,title,status,updated_at")
          .eq("link_type", "project")
          .order("updated_at", { ascending: false })
          .limit(20);
      }),
      runSource("agent_runs", async () => {
        if (shouldFail("agent_runs")) throw new Error("forced_failure");
        return supabase
          .from("agent_run_logs")
          .select("id,objective,run_status,risk_level,created_at")
          .order("created_at", { ascending: false })
          .limit(20);
      }),
      runSource("gmail", async () => {
        if (shouldFail("gmail")) throw new Error("forced_failure");
        return supabase
          .from("gmail_message_map")
          .select(
            "id,subject,from_email,importance_score,is_important,is_unread,internal_date",
          )
          .eq("is_unread", true)
          .eq("is_trashed", false)
          .order("internal_date", { ascending: false })
          .limit(20);
      }),
      runSource("github", async () => {
        if (shouldFail("github")) throw new Error("forced_failure");
        return supabase
          .from("github_repository_registry")
          .select("id")
          .limit(1);
      }),
    ]);

  return {
    inputs: {
      action_queue,
      result_review,
      projects,
      agent_runs,
      gmail,
      github,
    } as PriorityEngineInputs,
    per_source_timing: {
      action_queue: action_queue.duration_ms,
      result_review: result_review.duration_ms,
      projects: projects.duration_ms,
      agent_runs: agent_runs.duration_ms,
      gmail: gmail.duration_ms,
      github: github.duration_ms,
    },
  };
}

export const Route = createFileRoute("/api/priority-engine-data")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const t_total = Date.now();
        const url = new URL(request.url);
        const entity = resolveEntity(url);
        const forceFail = url.searchParams.get("__force_fail");
        const isDev = process.env.NODE_ENV !== "production";

        const govRequest: GovernanceRequest = {
          action: "read_priority_engine_data",
          entity,
          project_id: PROJECT_ID,
          context_active_project_id: PROJECT_ID,
          risk_level: "low" as RbacRiskLevel,
          requires_confirmation: false,
        };

        let gov;
        try {
          gov = evaluateAction(govRequest);
        } catch (err) {
          return new Response(
            JSON.stringify({
              error: "governance_evaluator_crash",
              message: safeErrorMessage(err),
            }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }

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

        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

        let supabase: SupabaseLike | null = null;
        if (token && SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
          supabase = createClient<Database>(
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
        }

        const shouldFail = (k: string) =>
          isDev && !!forceFail && forceFail.split(",").includes(k);

        const { inputs, per_source_timing } = await loadInputs(
          supabase,
          shouldFail,
        );
        const engine = computePriorities(inputs);

        const slow: string[] = [];
        for (const k of PRIORITY_SOURCE_KEYS) {
          const v = per_source_timing[k];
          if (v > PRIORITY_ENGINE_SLOW_SOURCE_THRESHOLD_MS) {
            slow.push(`${k}:${v}ms`);
            await logAnomaly("priority_engine_slow_source", {
              source: k,
              duration_ms: v,
              threshold_ms: PRIORITY_ENGINE_SLOW_SOURCE_THRESHOLD_MS,
            });
          }
        }

        return Response.json({
          data: {
            widget: engine.widget,
            priorities: engine.priorities,
            per_source: engine.per_source,
            debug: {
              total_duration_ms: Date.now() - t_total,
              per_source_duration_ms: per_source_timing,
              slow_source_threshold_ms: PRIORITY_ENGINE_SLOW_SOURCE_THRESHOLD_MS,
              slow_source_warnings: slow,
              source_criticality: PRIORITY_SOURCE_CRITICALITY,
              session_present: !!supabase,
            },
          },
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
