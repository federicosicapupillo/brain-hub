// Brain Hub v3.34 — Command Center v2 data endpoint.
//
// Reorganizes existing capabilities into the operational flow
// Read → Suggest → Prepare → Confirm → Execute, applying the
// Runtime Risk Model. Conforms to:
//   - Principio 1 (Data Trust)        — every column carries DataTrust
//   - Principio 2 (Partial Failure)   — per-source isolation, reuses
//     PRIORITY_SOURCE_CRITICALITY (no new criticality policy)
//   - Principio 3 (Service Layer)     — ServiceOutcome<T> reused, not
//     duplicated
//   - Principio 4 (Honest State)      — Blocked panel returns explicit
//     reason_kind for every reason an item cannot move forward
//   - Principio 5 (R→S→P→C→E)         — only Read/Suggest/Prepare/Confirm
//     are populated. Execute for MEDIUM/HIGH is OUT OF SCOPE in this
//     patch (see EQG A6).
//
// NO new data source. NO second decision engine. NO new real Execute.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import {
  evaluateAction,
  type GovernanceRequest,
} from "@/lib/governance/governanceEvaluator";
import type {
  RbacEntityType,
  RbacRiskLevel,
} from "@/lib/governance/rbacModel";
import type { Database } from "@/integrations/supabase/types";
import {
  type ServiceOutcome,
  type ServiceProvenanceMeta,
  emptyOutcome,
  errorOutcome,
  liveOutcome,
  missingOutcome,
  toWidgetProvenance,
  unknownOutcome,
} from "@/lib/service-outcome";
import {
  PRIORITY_SOURCE_CRITICALITY,
  PRIORITY_SOURCE_KEYS,
  computePriorities,
  type PriorityEngineInputs,
  type PriorityItem,
  type PrioritySourceKey,
  type SourceOutcome,
} from "@/lib/priority-engine/priority-engine";
import {
  projectSuggestedActions,
  type BlockedItem,
  type SuggestedAction,
} from "@/lib/command-center-v2/suggested-actions";
import {
  ACTION_RISK,
  type ActionType,
  type RiskLevel,
} from "@/lib/command-center-v2/risk-model";
import type { DataTrust } from "@/lib/data-trust/types";

const PROJECT_ID = "brainhub-os";
export const CC_V2_SLOW_SOURCE_THRESHOLD_MS = 1000;

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
  event: "cc_v2_source_error" | "cc_v2_slow_source",
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    const { writeJackGptEventLog } = await import("@/lib/jack-gpt-log.server");
    await writeJackGptEventLog({ event, metadata });
  } catch {
    // Telemetry must never bubble.
  }
}

const PE_SOURCE_META: Record<PrioritySourceKey, ServiceProvenanceMeta> = {
  action_queue: {
    source_tables: ["automation_actions"],
    source_function: "supabase.automation_actions.select",
  },
  result_review: {
    source_tables: ["result_review_items"],
    source_function: "supabase.result_review_items.select",
  },
  projects: {
    source_tables: ["project_links"],
    source_function: "supabase.project_links.select",
  },
  agent_runs: {
    source_tables: ["agent_run_logs"],
    source_function: "supabase.agent_run_logs.select",
  },
  gmail: {
    source_tables: ["gmail_message_map"],
    source_function: "supabase.gmail_message_map.select",
  },
  github: {
    source_tables: ["github_repository_registry"],
    source_function: "supabase.github_repository_registry.select",
  },
};

const PREPARED_META: ServiceProvenanceMeta = {
  source_tables: ["automation_actions"],
  source_function: "supabase.automation_actions.select(status=approved)",
};
const WAITING_META: ServiceProvenanceMeta = {
  source_tables: ["automation_actions"],
  source_function:
    "supabase.automation_actions.select(requires_confirmation=true)",
};
const EXEC_AUTO_META: ServiceProvenanceMeta = {
  source_tables: ["automation_actions"],
  source_function: "supabase.automation_actions.select(executed_at!=null)",
};
const EXEC_RUNS_META: ServiceProvenanceMeta = {
  source_tables: ["agent_run_logs"],
  source_function: "supabase.agent_run_logs.select(run_status=completed)",
};
const CONN_GMAIL_META: ServiceProvenanceMeta = {
  source_tables: ["gmail_connection_settings"],
  source_function: "supabase.gmail_connection_settings.select",
};
const CONN_GITHUB_META: ServiceProvenanceMeta = {
  source_tables: ["github_repository_registry"],
  source_function: "supabase.github_repository_registry.select",
};

async function runSource<T>(
  name: string,
  meta: ServiceProvenanceMeta,
  fn: () => Promise<{ data: T[] | null; error: unknown }>,
): Promise<ServiceOutcome<T[]>> {
  const t0 = Date.now();
  try {
    const res = await fn();
    const duration_ms = Date.now() - t0;
    if (res.error) {
      const safe = safeErrorMessage(res.error);
      await logAnomaly("cc_v2_source_error", { source: name, message: safe, duration_ms });
      return errorOutcome<T[]>(meta, duration_ms, safe);
    }
    const rows = res.data ?? null;
    if (rows === null) return unknownOutcome<T[]>(meta, duration_ms);
    if (rows.length === 0) return emptyOutcome<T[]>([], meta, duration_ms);
    return liveOutcome<T[]>(rows, meta, duration_ms);
  } catch (err) {
    const duration_ms = Date.now() - t0;
    const safe = safeErrorMessage(err);
    await logAnomaly("cc_v2_source_error", { source: name, message: safe, duration_ms });
    return errorOutcome<T[]>(meta, duration_ms, safe);
  }
}

async function runConnector(
  name: string,
  meta: ServiceProvenanceMeta,
  fn: () => Promise<{ data: unknown[] | null; error: unknown }>,
): Promise<ServiceOutcome<boolean>> {
  const t0 = Date.now();
  try {
    const res = await fn();
    const duration_ms = Date.now() - t0;
    if (res.error) {
      const safe = safeErrorMessage(res.error);
      await logAnomaly("cc_v2_source_error", { source: name, message: safe, duration_ms });
      return errorOutcome<boolean>(meta, duration_ms, safe);
    }
    const rows = res.data ?? null;
    if (rows === null) return unknownOutcome<boolean>(meta, duration_ms);
    if (rows.length === 0) return emptyOutcome<boolean>(false, meta, duration_ms);
    return liveOutcome<boolean>(true, meta, duration_ms);
  } catch (err) {
    const duration_ms = Date.now() - t0;
    const safe = safeErrorMessage(err);
    await logAnomaly("cc_v2_source_error", { source: name, message: safe, duration_ms });
    return errorOutcome<boolean>(meta, duration_ms, safe);
  }
}

function toEngineSource<T>(outcome: ServiceOutcome<T[]>): SourceOutcome<T> {
  const proj: SourceOutcome<T> = {
    status: outcome.trust.status,
    rows: outcome.data ?? [],
    freshness: outcome.trust.freshness,
  };
  if (outcome.error_safe_message) proj.error_safe_message = outcome.error_safe_message;
  return proj;
}

// -- Payload shape --------------------------------------------------------

export interface PreparedAction {
  id: string;
  action_type: ActionType;
  risk_level: RiskLevel;
  title: string;
  status: string;
  trust: DataTrust;
}

export interface WaitingConfirmation extends PreparedAction {
  requires_confirmation: true;
}

export interface ExecutedItem {
  id: string;
  kind: "automation_action" | "agent_run";
  title: string;
  status: string;
  executed_at: string | null;
  risk_level: RiskLevel;
  trust: DataTrust;
}

export interface ColumnEnvelope<T> {
  status: DataTrust["status"];
  confidence: number | null;
  source_tables: string[];
  source_function: string;
  last_updated: string | null;
  warnings: string[];
  duration_ms: number;
  error_safe_message?: string;
  items: T[];
}

export interface CommandCenterV2Data {
  todays_focus: ColumnEnvelope<PriorityItem>;
  suggested_actions: ColumnEnvelope<SuggestedAction>;
  prepared_actions: ColumnEnvelope<PreparedAction>;
  waiting_confirmation: ColumnEnvelope<WaitingConfirmation>;
  recent_executions: ColumnEnvelope<ExecutedItem>;
  blocked: ColumnEnvelope<BlockedItem>;
  debug: {
    total_duration_ms: number;
    per_source_duration_ms: Record<string, number>;
    slow_source_threshold_ms: number;
    slow_source_warnings: string[];
    source_criticality: typeof PRIORITY_SOURCE_CRITICALITY;
    session_present: boolean;
  };
}

function columnFromOutcome<T>(
  outcome: ServiceOutcome<unknown>,
  items: T[],
): ColumnEnvelope<T> {
  const p = toWidgetProvenance(outcome);
  const env: ColumnEnvelope<T> = {
    status: p.status,
    confidence: p.confidence,
    source_tables: p.source_tables,
    source_function: p.source_function,
    last_updated: p.last_updated,
    warnings: p.warnings,
    duration_ms: p.duration_ms,
    items,
  };
  if (p.error_safe_message) env.error_safe_message = p.error_safe_message;
  return env;
}

function classifyAutomationAction(row: {
  action_type: string;
}): ActionType {
  // Best-effort mapping from existing free-form action_type to v3.34
  // ActionType. Unknown values default to a MEDIUM internal write.
  const t = row.action_type.toLowerCase();
  if (t.includes("send_email") || t.includes("email_send")) return "send_email";
  if (t.includes("draft")) return "draft_email_reply";
  if (t.includes("codex") || t.includes("prompt")) return "prepare_codex_prompt";
  if (t.includes("git_push") || t.includes("push")) return "git_push";
  if (t.includes("telegram")) return "telegram_send";
  if (t.includes("n8n")) return "n8n_live";
  if (t.includes("delete")) return "delete_data";
  if (t.includes("publish")) return "publish_post";
  return "create_action_queue_item";
}

function actionTrust(meta: ServiceProvenanceMeta, freshness: string | null): DataTrust {
  return {
    status: "live",
    confidence: 100,
    calculation_method: "direct_source",
    provenance: {
      source_tables: meta.source_tables,
      source_functions: [meta.source_function],
    },
    freshness,
  };
}

export const Route = createFileRoute("/api/command-center-v2-data")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const t_total = Date.now();
        const url = new URL(request.url);
        const entity = resolveEntity(url);

        const govRequest: GovernanceRequest = {
          action: "read_command_center_v2_data",
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
          supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: {
              storage: undefined,
              persistSession: false,
              autoRefreshToken: false,
            },
          });
        }

        // ---- Priority Engine inputs (reused, single decision engine) ----
        const peTiming: Record<PrioritySourceKey, number> = {
          action_queue: 0,
          result_review: 0,
          projects: 0,
          agent_runs: 0,
          gmail: 0,
          github: 0,
        };

        let peOutcomes: Record<PrioritySourceKey, ServiceOutcome<unknown[]>>;
        let preparedOutcome: ServiceOutcome<unknown[]>;
        let waitingOutcome: ServiceOutcome<unknown[]>;
        let execAutoOutcome: ServiceOutcome<unknown[]>;
        let execRunsOutcome: ServiceOutcome<unknown[]>;
        let gmailConn: ServiceOutcome<boolean>;
        let githubConn: ServiceOutcome<boolean>;
        const extraTiming: Record<string, number> = {};

        if (!supabase) {
          const reason = !token ? "no_session" : "server_misconfigured";
          peOutcomes = {
            action_queue: missingOutcome<unknown[]>(PE_SOURCE_META.action_queue, reason),
            result_review: missingOutcome<unknown[]>(PE_SOURCE_META.result_review, reason),
            projects: missingOutcome<unknown[]>(PE_SOURCE_META.projects, reason),
            agent_runs: missingOutcome<unknown[]>(PE_SOURCE_META.agent_runs, reason),
            gmail: missingOutcome<unknown[]>(PE_SOURCE_META.gmail, reason),
            github: missingOutcome<unknown[]>(PE_SOURCE_META.github, reason),
          };
          preparedOutcome = missingOutcome<unknown[]>(PREPARED_META, reason);
          waitingOutcome = missingOutcome<unknown[]>(WAITING_META, reason);
          execAutoOutcome = missingOutcome<unknown[]>(EXEC_AUTO_META, reason);
          execRunsOutcome = missingOutcome<unknown[]>(EXEC_RUNS_META, reason);
          gmailConn = missingOutcome<boolean>(CONN_GMAIL_META, reason);
          githubConn = missingOutcome<boolean>(CONN_GITHUB_META, reason);
        } else {
          const [
            aq, rr, prj, ar, gm, gh,
            prepared, waiting, execAuto, execRuns, gmailC, githubC,
          ] = await Promise.all([
            runSource("pe.action_queue", PE_SOURCE_META.action_queue, async () =>
              supabase
                .from("automation_actions")
                .select("id,title,status,priority,risk_level,created_at")
                .in("status", ["blocked", "failed"])
                .order("created_at", { ascending: false })
                .limit(20),
            ),
            runSource("pe.result_review", PE_SOURCE_META.result_review, async () =>
              supabase
                .from("result_review_items")
                .select("id,title,review_status,risk_level,source_type,created_at")
                .eq("review_status", "pending_review")
                .order("created_at", { ascending: false })
                .limit(20),
            ),
            runSource("pe.projects", PE_SOURCE_META.projects, async () =>
              supabase
                .from("project_links")
                .select("id,title,status,updated_at")
                .eq("link_type", "project")
                .order("updated_at", { ascending: false })
                .limit(20),
            ),
            runSource("pe.agent_runs", PE_SOURCE_META.agent_runs, async () =>
              supabase
                .from("agent_run_logs")
                .select("id,objective,run_status,risk_level,created_at")
                .order("created_at", { ascending: false })
                .limit(20),
            ),
            runSource("pe.gmail", PE_SOURCE_META.gmail, async () =>
              supabase
                .from("gmail_message_map")
                .select(
                  "id,subject,from_email,importance_score,is_important,is_unread,internal_date",
                )
                .eq("is_unread", true)
                .eq("is_trashed", false)
                .order("internal_date", { ascending: false })
                .limit(20),
            ),
            runSource("pe.github", PE_SOURCE_META.github, async () =>
              supabase.from("github_repository_registry").select("id").limit(1),
            ),
            runSource("prepared", PREPARED_META, async () =>
              supabase
                .from("automation_actions")
                .select("id,title,status,action_type,risk_level,updated_at")
                .eq("status", "approved")
                .is("executed_at", null)
                .order("updated_at", { ascending: false })
                .limit(10),
            ),
            runSource("waiting_confirmation", WAITING_META, async () =>
              supabase
                .from("automation_actions")
                .select(
                  "id,title,status,action_type,risk_level,requires_confirmation,updated_at",
                )
                .eq("requires_confirmation", true)
                .in("status", ["suggested", "pending"])
                .order("updated_at", { ascending: false })
                .limit(10),
            ),
            runSource("recent.automation", EXEC_AUTO_META, async () =>
              supabase
                .from("automation_actions")
                .select("id,title,status,action_type,risk_level,executed_at")
                .not("executed_at", "is", null)
                .order("executed_at", { ascending: false })
                .limit(10),
            ),
            runSource("recent.agent_runs", EXEC_RUNS_META, async () =>
              supabase
                .from("agent_run_logs")
                .select("id,objective,run_status,risk_level,created_at")
                .in("run_status", ["completed", "succeeded", "success", "done"])
                .order("created_at", { ascending: false })
                .limit(10),
            ),
            runConnector("conn.gmail", CONN_GMAIL_META, async () =>
              supabase.from("gmail_connection_settings").select("id").limit(1),
            ),
            runConnector("conn.github", CONN_GITHUB_META, async () =>
              supabase.from("github_repository_registry").select("id").limit(1),
            ),
          ]);

          peOutcomes = {
            action_queue: aq as ServiceOutcome<unknown[]>,
            result_review: rr as ServiceOutcome<unknown[]>,
            projects: prj as ServiceOutcome<unknown[]>,
            agent_runs: ar as ServiceOutcome<unknown[]>,
            gmail: gm as ServiceOutcome<unknown[]>,
            github: gh as ServiceOutcome<unknown[]>,
          };
          preparedOutcome = prepared as ServiceOutcome<unknown[]>;
          waitingOutcome = waiting as ServiceOutcome<unknown[]>;
          execAutoOutcome = execAuto as ServiceOutcome<unknown[]>;
          execRunsOutcome = execRuns as ServiceOutcome<unknown[]>;
          gmailConn = gmailC;
          githubConn = githubC;

          peTiming.action_queue = aq.duration_ms;
          peTiming.result_review = rr.duration_ms;
          peTiming.projects = prj.duration_ms;
          peTiming.agent_runs = ar.duration_ms;
          peTiming.gmail = gm.duration_ms;
          peTiming.github = gh.duration_ms;

          extraTiming.prepared = prepared.duration_ms;
          extraTiming.waiting_confirmation = waiting.duration_ms;
          extraTiming["recent.automation"] = execAuto.duration_ms;
          extraTiming["recent.agent_runs"] = execRuns.duration_ms;
          extraTiming["conn.gmail"] = gmailC.duration_ms;
          extraTiming["conn.github"] = githubC.duration_ms;
        }

        // -- Compute Today's Focus from Priority Engine (single engine) --
        const inputs = {
          action_queue: toEngineSource(peOutcomes.action_queue),
          result_review: toEngineSource(peOutcomes.result_review),
          projects: toEngineSource(peOutcomes.projects),
          agent_runs: toEngineSource(peOutcomes.agent_runs),
          gmail: toEngineSource(peOutcomes.gmail),
          github: toEngineSource(peOutcomes.github),
        } as PriorityEngineInputs;
        const engine = computePriorities(inputs);

        const todays_focus: ColumnEnvelope<PriorityItem> = {
          status: engine.widget.status,
          confidence: engine.widget.confidence,
          source_tables: engine.widget.provenance.source_tables ?? [],
          source_function: "priority-engine.computePriorities",
          last_updated: engine.widget.freshness,
          warnings: engine.widget.warnings ?? [],
          duration_ms: Object.values(peTiming).reduce((a, b) => a + b, 0),
          items: engine.priorities,
        };

        // -- Suggested Actions (pure projection of the priorities) -------
        const { suggested, blocked_from_priorities } = projectSuggestedActions(
          engine.priorities,
        );
        const suggested_actions: ColumnEnvelope<SuggestedAction> = {
          status: engine.widget.status,
          confidence: engine.widget.confidence,
          source_tables: ["priority-engine"],
          source_function: "suggested-actions.projectSuggestedActions",
          last_updated: engine.widget.freshness,
          warnings: engine.widget.warnings ?? [],
          duration_ms: 0,
          items: suggested,
        };

        // -- Prepared / Waiting Confirmation / Recent Executions ---------
        const preparedRows = (preparedOutcome.data ?? []) as Array<{
          id: string;
          title: string;
          status: string;
          action_type: string;
          risk_level: string | null;
          updated_at: string;
        }>;
        const prepared_actions = columnFromOutcome<PreparedAction>(
          preparedOutcome,
          preparedRows.map((r) => {
            const action_type = classifyAutomationAction(r);
            return {
              id: r.id,
              action_type,
              risk_level: ACTION_RISK[action_type],
              title: r.title,
              status: r.status,
              trust: actionTrust(PREPARED_META, r.updated_at),
            };
          }),
        );

        const waitingRows = (waitingOutcome.data ?? []) as Array<{
          id: string;
          title: string;
          status: string;
          action_type: string;
          risk_level: string | null;
          requires_confirmation: boolean;
          updated_at: string;
        }>;
        const waiting_confirmation = columnFromOutcome<WaitingConfirmation>(
          waitingOutcome,
          waitingRows.map((r) => {
            const action_type = classifyAutomationAction(r);
            return {
              id: r.id,
              action_type,
              risk_level: ACTION_RISK[action_type],
              title: r.title,
              status: r.status,
              requires_confirmation: true,
              trust: actionTrust(WAITING_META, r.updated_at),
            };
          }),
        );

        const execAutoRows = (execAutoOutcome.data ?? []) as Array<{
          id: string;
          title: string;
          status: string;
          action_type: string;
          risk_level: string | null;
          executed_at: string | null;
        }>;
        const execRunsRows = (execRunsOutcome.data ?? []) as Array<{
          id: string;
          objective: string;
          run_status: string;
          risk_level: string | null;
          created_at: string;
        }>;
        const executedItems: ExecutedItem[] = [
          ...execAutoRows.map<ExecutedItem>((r) => {
            const action_type = classifyAutomationAction(r);
            return {
              id: `auto:${r.id}`,
              kind: "automation_action",
              title: r.title,
              status: r.status,
              executed_at: r.executed_at,
              risk_level: ACTION_RISK[action_type],
              trust: actionTrust(EXEC_AUTO_META, r.executed_at),
            };
          }),
          ...execRunsRows.map<ExecutedItem>((r) => ({
            id: `run:${r.id}`,
            kind: "agent_run",
            title: r.objective,
            status: r.run_status,
            executed_at: r.created_at,
            risk_level: "low",
            trust: actionTrust(EXEC_RUNS_META, r.created_at),
          })),
        ]
          .sort((a, b) => (b.executed_at ?? "").localeCompare(a.executed_at ?? ""))
          .slice(0, 10);

        // Recent Executions envelope: best-of the two underlying outcomes.
        const recentBaseOutcome: ServiceOutcome<unknown[]> =
          execAutoOutcome.trust.status === "error" ? execAutoOutcome : execRunsOutcome;
        const recent_executions = columnFromOutcome<ExecutedItem>(
          recentBaseOutcome,
          executedItems,
        );
        recent_executions.source_tables = ["automation_actions", "agent_run_logs"];
        recent_executions.source_function =
          "supabase.automation_actions+agent_run_logs (executed)";

        // -- Blocked panel (Honest State, Principio 4) -------------------
        const blockedItems: BlockedItem[] = [...blocked_from_priorities];

        // Connector / source-level reasons (reuse Source Criticality):
        for (const k of PRIORITY_SOURCE_KEYS) {
          const o = peOutcomes[k];
          const s = o.trust.status;
          if (s !== "error" && s !== "missing") continue;
          const crit = PRIORITY_SOURCE_CRITICALITY[k];
          // optional sources do NOT block — they just degrade
          if (crit === "optional") continue;
          blockedItems.push({
            id: `blocked:source:${k}`,
            reason_kind:
              s === "missing"
                ? "missing_data"
                : k === "gmail" || k === "github"
                  ? "connector_offline"
                  : "missing_data",
            title: `Sorgente ${k} non disponibile`,
            detail: o.error_safe_message ?? `status=${s}, criticality=${crit}`,
            source_key: k,
            source_id: null,
            trust: o.trust,
          });
        }

        // Connector explicit checks (gmail, github) — connector_offline
        if (gmailConn.trust.status === "error" || gmailConn.data === false) {
          blockedItems.push({
            id: "blocked:connector:gmail",
            reason_kind: "connector_offline",
            title: "Gmail connector non collegato",
            detail:
              gmailConn.error_safe_message ?? "Nessuna gmail_connection_settings.",
            source_key: "connector",
            source_id: null,
            trust: gmailConn.trust,
          });
        }
        if (githubConn.trust.status === "error" || githubConn.data === false) {
          blockedItems.push({
            id: "blocked:connector:github",
            reason_kind: "connector_offline",
            title: "GitHub registry vuoto",
            detail:
              githubConn.error_safe_message ?? "Nessun github_repository_registry.",
            source_key: "connector",
            source_id: null,
            trust: githubConn.trust,
          });
        }

        const blockedBaseOutcome: ServiceOutcome<unknown[]> =
          blockedItems.length > 0
            ? liveOutcome<unknown[]>([], {
                source_tables: ["priority-engine", "gmail_connection_settings", "github_repository_registry"],
                source_function: "command-center-v2.blocked",
              }, 0)
            : emptyOutcome<unknown[]>([], {
                source_tables: ["priority-engine", "gmail_connection_settings", "github_repository_registry"],
                source_function: "command-center-v2.blocked",
              }, 0);
        const blocked = columnFromOutcome<BlockedItem>(blockedBaseOutcome, blockedItems);

        // -- Debug / slow source warnings --------------------------------
        const per_source_duration_ms: Record<string, number> = {
          ...Object.fromEntries(
            Object.entries(peTiming).map(([k, v]) => [`pe.${k}`, v]),
          ),
          ...extraTiming,
        };
        const slow: string[] = [];
        for (const [k, v] of Object.entries(per_source_duration_ms)) {
          if (v > CC_V2_SLOW_SOURCE_THRESHOLD_MS) {
            slow.push(`${k}:${v}ms`);
            await logAnomaly("cc_v2_slow_source", {
              source: k,
              duration_ms: v,
              threshold_ms: CC_V2_SLOW_SOURCE_THRESHOLD_MS,
            });
          }
        }

        const payload: CommandCenterV2Data = {
          todays_focus,
          suggested_actions,
          prepared_actions,
          waiting_confirmation,
          recent_executions,
          blocked,
          debug: {
            total_duration_ms: Date.now() - t_total,
            per_source_duration_ms,
            slow_source_threshold_ms: CC_V2_SLOW_SOURCE_THRESHOLD_MS,
            slow_source_warnings: slow,
            source_criticality: PRIORITY_SOURCE_CRITICALITY,
            session_present: !!supabase,
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
