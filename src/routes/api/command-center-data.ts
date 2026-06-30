// Brain Hub v3.30.1 — Command Center data endpoint (hardened).
// Each widget carries explicit provenance, timing, and an honest status.
// Partial failures degrade gracefully: one bad source returns status="error"
// for that widget only — never a global 5xx. 500 is reserved for systemic
// failures (e.g. governance evaluator crash); 403 for governance/RBAC fail.

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

// Configurable slow-widget threshold. If changed at runtime via env, the
// effective value is echoed in `debug.slow_widget_threshold_ms`.
export const COMMAND_CENTER_SLOW_WIDGET_THRESHOLD_MS = 1000;

type WidgetStatus = "live" | "empty" | "missing" | "unknown" | "error";

interface WidgetProvenance {
  status: WidgetStatus;
  source_tables: string[];
  source_function: string;
  last_updated: string | null;
  confidence: number | null;
  warnings: string[];
  duration_ms: number;
  error_safe_message?: string;
}

interface Widget<T> extends WidgetProvenance {
  data: T[] | null;
}

interface ConnectorWidget extends WidgetProvenance {
  connected: boolean | null;
}

interface SystemStatusPayload extends WidgetProvenance {
  governance_confidence: number | null;
  modules_active: number;
  modules_partial: number;
  modules_empty: number;
  modules_future: number;
  last_audit_at: string | null;
  last_enforcement_at: string | null;
}

export interface CommandCenterData {
  system_status: SystemStatusPayload;
  projects: Widget<{
    id: string;
    title: string;
    status: string | null;
    link_type: string;
    updated_at: string;
  }>;
  action_queue: Widget<{
    id: string;
    title: string;
    status: string;
    priority: string;
    risk_level: string;
    requires_confirmation: boolean;
    created_at: string;
  }>;
  result_review: Widget<{
    id: string;
    title: string;
    review_status: string;
    source_type: string;
    risk_level: string | null;
    created_at: string;
  }>;
  agent_runs: Widget<{
    id: string;
    objective: string;
    run_status: string;
    run_mode: string;
    risk_level: string;
    created_at: string;
  }>;
  connectors: {
    gmail: ConnectorWidget;
    github: ConnectorWidget;
  };
  debug: {
    total_duration_ms: number;
    per_widget_duration_ms: Record<string, number>;
    slow_widget_threshold_ms: number;
    slow_widget_warnings: string[];
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

function safeErrorMessage(err: unknown): string {
  const msg = (err as { message?: string } | null)?.message ?? "query_failed";
  // Sanitize: drop anything that looks like a token, email, or url path.
  return msg
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+/g, "[redacted-email]")
    .slice(0, 200);
}

async function logAnomaly(
  event: "command_center_widget_error" | "command_center_slow_widget",
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    const { writeJackGptEventLog } = await import("@/lib/jack-gpt-log.server");
    await writeJackGptEventLog({ event, metadata });
  } catch {
    // Telemetry must never bubble.
  }
}

interface RunOpts {
  name: string;
  source_tables: string[];
  source_function: string;
}

async function runWidget<T>(
  opts: RunOpts,
  fn: () => Promise<{ data: T[] | null; error: unknown; last_updated?: string | null }>,
): Promise<Widget<T>> {
  const t0 = Date.now();
  try {
    const res = await fn();
    const duration_ms = Date.now() - t0;
    if (res.error) {
      const safe = safeErrorMessage(res.error);
      await logAnomaly("command_center_widget_error", {
        widget: opts.name,
        source_function: opts.source_function,
        message: safe,
        duration_ms,
      });
      return {
        status: "error",
        source_tables: opts.source_tables,
        source_function: opts.source_function,
        last_updated: null,
        confidence: 0,
        warnings: ["source_query_failed"],
        duration_ms,
        error_safe_message: safe,
        data: null,
      };
    }
    const rows = res.data ?? null;
    if (rows === null) {
      return {
        status: "unknown",
        source_tables: opts.source_tables,
        source_function: opts.source_function,
        last_updated: null,
        confidence: null,
        warnings: ["no_rows_returned_null"],
        duration_ms,
        data: null,
      };
    }
    if (rows.length === 0) {
      return {
        status: "empty",
        source_tables: opts.source_tables,
        source_function: opts.source_function,
        last_updated: null,
        confidence: 1,
        warnings: [],
        duration_ms,
        data: [],
      };
    }
    return {
      status: "live",
      source_tables: opts.source_tables,
      source_function: opts.source_function,
      last_updated: res.last_updated ?? new Date().toISOString(),
      confidence: 1,
      warnings: [],
      duration_ms,
      data: rows,
    };
  } catch (err) {
    const duration_ms = Date.now() - t0;
    const safe = safeErrorMessage(err);
    await logAnomaly("command_center_widget_error", {
      widget: opts.name,
      source_function: opts.source_function,
      message: safe,
      duration_ms,
    });
    return {
      status: "error",
      source_tables: opts.source_tables,
      source_function: opts.source_function,
      last_updated: null,
      confidence: 0,
      warnings: ["source_threw"],
      duration_ms,
      error_safe_message: safe,
      data: null,
    };
  }
}

async function runConnector(
  opts: RunOpts,
  fn: () => Promise<{ data: unknown[] | null; error: unknown }>,
): Promise<ConnectorWidget> {
  const t0 = Date.now();
  try {
    const res = await fn();
    const duration_ms = Date.now() - t0;
    if (res.error) {
      const safe = safeErrorMessage(res.error);
      await logAnomaly("command_center_widget_error", {
        widget: opts.name,
        source_function: opts.source_function,
        message: safe,
        duration_ms,
      });
      return {
        status: "error",
        source_tables: opts.source_tables,
        source_function: opts.source_function,
        last_updated: null,
        confidence: 0,
        warnings: ["connector_query_failed"],
        duration_ms,
        error_safe_message: safe,
        connected: null,
      };
    }
    const rows = res.data ?? null;
    if (rows === null) {
      return {
        status: "unknown",
        source_tables: opts.source_tables,
        source_function: opts.source_function,
        last_updated: null,
        confidence: null,
        warnings: [],
        duration_ms,
        connected: null,
      };
    }
    if (rows.length === 0) {
      return {
        status: "empty",
        source_tables: opts.source_tables,
        source_function: opts.source_function,
        last_updated: null,
        confidence: 1,
        warnings: [],
        duration_ms,
        connected: false,
      };
    }
    return {
      status: "live",
      source_tables: opts.source_tables,
      source_function: opts.source_function,
      last_updated: new Date().toISOString(),
      confidence: 1,
      warnings: [],
      duration_ms,
      connected: true,
    };
  } catch (err) {
    const duration_ms = Date.now() - t0;
    const safe = safeErrorMessage(err);
    await logAnomaly("command_center_widget_error", {
      widget: opts.name,
      source_function: opts.source_function,
      message: safe,
      duration_ms,
    });
    return {
      status: "error",
      source_tables: opts.source_tables,
      source_function: opts.source_function,
      last_updated: null,
      confidence: 0,
      warnings: ["connector_threw"],
      duration_ms,
      error_safe_message: safe,
      connected: null,
    };
  }
}

function computeSystemStatus(): SystemStatusPayload {
  const t0 = Date.now();
  const modules = deriveOsModules(auditSnapshot);
  const counts = { active: 0, partial: 0, empty: 0, future: 0 };
  for (const m of modules) counts[m.status] += 1;
  const snap = auditSnapshot as unknown as {
    generated_at_utc?: { value?: string };
  };
  const generated = snap.generated_at_utc?.value ?? null;
  return {
    status: "live",
    source_tables: [],
    source_function: "deriveOsModules+architecture-audit-phase1",
    last_updated: generated,
    confidence: 1,
    warnings: [],
    duration_ms: Date.now() - t0,
    governance_confidence: null,
    modules_active: counts.active,
    modules_partial: counts.partial,
    modules_empty: counts.empty,
    modules_future: counts.future,
    last_audit_at: generated,
    last_enforcement_at: null,
  };
}

function unknownWidget<T>(opts: RunOpts, reason: string): Widget<T> {
  return {
    status: "unknown",
    source_tables: opts.source_tables,
    source_function: opts.source_function,
    last_updated: null,
    confidence: null,
    warnings: [reason],
    duration_ms: 0,
    data: null,
  };
}

function unknownConnector(opts: RunOpts, reason: string): ConnectorWidget {
  return {
    status: "unknown",
    source_tables: opts.source_tables,
    source_function: opts.source_function,
    last_updated: null,
    confidence: null,
    warnings: [reason],
    duration_ms: 0,
    connected: null,
  };
}

export const Route = createFileRoute("/api/command-center-data")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const t_total = Date.now();
        const url = new URL(request.url);
        const entity = resolveEntity(url);
        // v3.32: `__force_fail` query param removed. See
        // scripts/test-partial-failure.ts for the isolated harness.

        const govRequest: GovernanceRequest = {
          action: "read_command_center_data",
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
          // Systemic governance failure — true 500.
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

        const system_status = computeSystemStatus();

        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

        const widgetSpecs = {
          projects: {
            name: "projects",
            source_tables: ["project_links"],
            source_function: "supabase.project_links.select",
          },
          action_queue: {
            name: "action_queue",
            source_tables: ["automation_actions"],
            source_function: "supabase.automation_actions.select",
          },
          result_review: {
            name: "result_review",
            source_tables: ["result_review_items"],
            source_function: "supabase.result_review_items.select",
          },
          agent_runs: {
            name: "agent_runs",
            source_tables: ["agent_run_logs"],
            source_function: "supabase.agent_run_logs.select",
          },
          gmail: {
            name: "connectors.gmail",
            source_tables: ["gmail_connection_settings"],
            source_function: "supabase.gmail_connection_settings.select",
          },
          github: {
            name: "connectors.github",
            source_tables: ["github_repository_registry"],
            source_function: "supabase.github_repository_registry.select",
          },
        } satisfies Record<string, RunOpts>;

        let payload: CommandCenterData;

        if (!token || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          const reason = !token ? "no_session" : "server_misconfigured";
          payload = {
            system_status,
            projects: unknownWidget(widgetSpecs.projects, reason),
            action_queue: unknownWidget(widgetSpecs.action_queue, reason),
            result_review: unknownWidget(widgetSpecs.result_review, reason),
            agent_runs: unknownWidget(widgetSpecs.agent_runs, reason),
            connectors: {
              gmail: unknownConnector(widgetSpecs.gmail, reason),
              github: unknownConnector(widgetSpecs.github, reason),
            },
            debug: {
              total_duration_ms: 0,
              per_widget_duration_ms: {},
              slow_widget_threshold_ms: COMMAND_CENTER_SLOW_WIDGET_THRESHOLD_MS,
              slow_widget_warnings: [],
            },
          };
        } else {
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

          const shouldFail = (k: string) =>
            isDev && forceFail && forceFail.split(",").includes(k);

          const [projects, action_queue, result_review, agent_runs, gmail, github] =
            await Promise.all([
              runWidget(widgetSpecs.projects, async () => {
                if (shouldFail("projects")) throw new Error("forced_failure");
                return supabase
                  .from("project_links")
                  .select("id,title,status,link_type,updated_at")
                  .eq("link_type", "project")
                  .order("updated_at", { ascending: false })
                  .limit(10);
              }),
              runWidget(widgetSpecs.action_queue, async () => {
                if (shouldFail("action_queue")) throw new Error("forced_failure");
                return supabase
                  .from("automation_actions")
                  .select(
                    "id,title,status,priority,risk_level,requires_confirmation,created_at",
                  )
                  .in("status", ["suggested", "pending", "blocked", "approved"])
                  .order("created_at", { ascending: false })
                  .limit(10);
              }),
              runWidget(widgetSpecs.result_review, async () => {
                if (shouldFail("result_review")) throw new Error("forced_failure");
                return supabase
                  .from("result_review_items")
                  .select(
                    "id,title,review_status,source_type,risk_level,created_at",
                  )
                  .eq("review_status", "pending_review")
                  .order("created_at", { ascending: false })
                  .limit(10);
              }),
              runWidget(widgetSpecs.agent_runs, async () => {
                if (shouldFail("agent_runs")) throw new Error("forced_failure");
                return supabase
                  .from("agent_run_logs")
                  .select(
                    "id,objective,run_status,run_mode,risk_level,created_at",
                  )
                  .order("created_at", { ascending: false })
                  .limit(10);
              }),
              runConnector(widgetSpecs.gmail, async () => {
                if (shouldFail("gmail")) throw new Error("forced_failure");
                return supabase
                  .from("gmail_connection_settings")
                  .select("id")
                  .limit(1);
              }),
              runConnector(widgetSpecs.github, async () => {
                if (shouldFail("github")) throw new Error("forced_failure");
                return supabase
                  .from("github_repository_registry")
                  .select("id")
                  .limit(1);
              }),
            ]);

          payload = {
            system_status,
            projects,
            action_queue,
            result_review,
            agent_runs,
            connectors: { gmail, github },
            debug: {
              total_duration_ms: 0,
              per_widget_duration_ms: {},
              slow_widget_threshold_ms: COMMAND_CENTER_SLOW_WIDGET_THRESHOLD_MS,
              slow_widget_warnings: [],
            },
          };
        }

        // Finalize timing + slow-widget warnings.
        const per: Record<string, number> = {
          system_status: system_status.duration_ms,
          projects: payload.projects.duration_ms,
          action_queue: payload.action_queue.duration_ms,
          result_review: payload.result_review.duration_ms,
          agent_runs: payload.agent_runs.duration_ms,
          "connectors.gmail": payload.connectors.gmail.duration_ms,
          "connectors.github": payload.connectors.github.duration_ms,
        };
        const slow: string[] = [];
        for (const [k, v] of Object.entries(per)) {
          if (v > COMMAND_CENTER_SLOW_WIDGET_THRESHOLD_MS) {
            slow.push(`${k}:${v}ms`);
            await logAnomaly("command_center_slow_widget", {
              widget: k,
              duration_ms: v,
              threshold_ms: COMMAND_CENTER_SLOW_WIDGET_THRESHOLD_MS,
            });
          }
        }
        payload.debug = {
          total_duration_ms: Date.now() - t_total,
          per_widget_duration_ms: per,
          slow_widget_threshold_ms: COMMAND_CENTER_SLOW_WIDGET_THRESHOLD_MS,
          slow_widget_warnings: slow,
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
