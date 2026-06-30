// Brain Hub v3.35d — Execute Console UI: data fetcher (server-only).
//
// Aggregates the already-approved Execute surface for the authenticated
// user. Read-only. NEVER calls a dispatcher, NEVER writes anything,
// NEVER introduces new action_types. Partial failures are isolated per
// source (Principio 2) — a single broken source must not collapse the
// whole payload.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  INTERNAL_ACTION_TYPES,
  INTERNAL_ACTION_RISK,
  INTERNAL_ACTION_ROLLBACK,
} from "@/lib/execute-dispatcher/types";
import { EXTERNAL_ACTION_REGISTRY } from "@/lib/execute-dispatcher/external-registry";
import { getOrphanGateTtlMs } from "@/lib/execute-dispatcher/orphan-gate-reaper.server";
import type {
  ConsoleArtifact,
  ConsoleBlockedAction,
  ConsoleCapability,
  ConsoleEngineStatus,
  ConsoleOrphanState,
  ConsoleReceipt,
  ConsoleSourceMeta,
  ExecuteConsoleData,
  ExecuteScope,
} from "./execute-console-types";

type AdminClient = SupabaseClient<Database>;

const RECEIPT_LIMIT = 50;
const ARTIFACT_LIMIT = 50;
const IDEMP_LIMIT = 100;

function safeMsg(err: unknown): string {
  const m = (err as { message?: string } | null)?.message ?? "query_failed";
  return m
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+/g, "[redacted-email]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-key]")
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, "[redacted-jwt]")
    .slice(0, 200);
}

function previewKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 16) return key;
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

const SENSITIVE_KEYS = new Set([
  "authorization",
  "token",
  "secret",
  "api_key",
  "apikey",
  "password",
  "bearer",
  "access_token",
  "refresh_token",
]);

function redactPayload(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    let s = value;
    s = s.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
    s = s.replace(/sk-[A-Za-z0-9_-]{6,}/g, "[redacted-key]");
    s = s.replace(/eyJ[A-Za-z0-9._-]{20,}/g, "[redacted-jwt]");
    s = s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+/g, "[redacted-email]");
    return s.length > 240 ? `${s.slice(0, 240)}…` : s;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => redactPayload(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = "[redacted]";
    } else {
      out[k] = redactPayload(v, depth + 1);
    }
  }
  return out;
}

function buildCapabilities(): ConsoleCapability[] {
  const caps: ConsoleCapability[] = [];

  // Internal: every type in the registry is MEDIUM, supports live, no dry-run
  for (const t of INTERNAL_ACTION_TYPES) {
    const rollback = INTERNAL_ACTION_ROLLBACK[t];
    caps.push({
      action_type: t,
      scope: "internal",
      risk_level: INTERNAL_ACTION_RISK[t],
      enabled: true,
      supports_dry_run: false,
      supports_live_execute: true,
      supports_rollback: rollback.rollback_available,
      requires_confirmation: true,
      status: "available",
      blocked_reason: null,
      description: rollback.rollback_available
        ? `Internal MEDIUM action — Confirm required, rollback supported (${rollback.note}).`
        : `Internal MEDIUM action — Confirm required, rollback not supported (${rollback.note}).`,
    });
  }

  // External: registry-declared only
  for (const entry of Object.values(EXTERNAL_ACTION_REGISTRY)) {
    caps.push({
      action_type: entry.action_type,
      scope: "external",
      risk_level: entry.risk_level,
      enabled: entry.enabled,
      supports_dry_run: entry.supports_dry_run,
      supports_live_execute: entry.supports_live_execute,
      supports_rollback: entry.supports_rollback,
      requires_confirmation: entry.requires_confirmation,
      status: entry.enabled ? "available" : "blocked",
      blocked_reason: entry.enabled ? null : "registry_entry_disabled",
      description: `External ${entry.risk_level.toUpperCase()} sandbox action (${entry.connector_name}).`,
    });
  }

  return caps;
}

function buildBlocked(): ConsoleBlockedAction[] {
  return [
    {
      action_type: "high_live_actions",
      scope: "unknown",
      reason_kind: "high_live_blocked",
      reason:
        "HIGH live actions are intentionally blocked until v3.37/v3.38 (Prepare/Confirm).",
      risk_level: "high",
    },
    {
      action_type: "external_medium_connector",
      scope: "external",
      reason_kind: "medium_external_connector_not_implemented",
      reason:
        "MEDIUM external connectors are not implemented yet — scheduled for v3.36.",
      risk_level: "medium",
    },
    {
      action_type: "create_snapshot",
      scope: "internal",
      reason_kind: "rollback_not_supported",
      reason:
        "create_snapshot is a historical record; rollback is intentionally not supported.",
      risk_level: "medium",
    },
  ];
}

interface SourceCarrier<T> {
  rows: T[];
  meta: ConsoleSourceMeta;
}

async function safeQuery<T>(
  table: string,
  fn: () => Promise<{ data: T[] | null; error: unknown }>,
): Promise<SourceCarrier<T>> {
  const t0 = Date.now();
  try {
    const res = await fn();
    const duration_ms = Date.now() - t0;
    if (res.error) {
      return {
        rows: [],
        meta: {
          status: "error",
          duration_ms,
          source_table: table,
          error_safe_message: safeMsg(res.error),
          count: 0,
        },
      };
    }
    const rows = res.data ?? [];
    return {
      rows,
      meta: {
        status: rows.length === 0 ? "empty" : "live",
        duration_ms,
        source_table: table,
        count: rows.length,
      },
    };
  } catch (err) {
    return {
      rows: [],
      meta: {
        status: "error",
        duration_ms: Date.now() - t0,
        source_table: table,
        error_safe_message: safeMsg(err),
        count: 0,
      },
    };
  }
}

interface ReceiptRow {
  receipt_id: string;
  action_type: string;
  risk_level: string;
  result: string;
  started_at: string;
  completed_at: string | null;
  idempotency_key: string | null;
  related_receipt_id: string | null;
  rollback_available: boolean;
  external_reference: string | null;
  audit_record: unknown;
  safe_error_message: string | null;
}

interface ArtifactRow {
  id: string;
  action_type: string;
  risk_level: string;
  title: string;
  created_at: string;
  rolled_back_at: string | null;
  payload: unknown;
}

interface IdemRow {
  idempotency_key: string;
  action_type: string;
  receipt_id: string | null;
  created_at: string;
}

function scopeFor(action_type: string): ExecuteScope | "unknown" {
  if ((INTERNAL_ACTION_TYPES as readonly string[]).includes(action_type))
    return "internal";
  if (EXTERNAL_ACTION_REGISTRY[action_type]) return "external";
  return "unknown";
}

function riskFor(action_type: string): "low" | "medium" | "high" | "critical" | "unknown" {
  if ((INTERNAL_ACTION_TYPES as readonly string[]).includes(action_type)) {
    return INTERNAL_ACTION_RISK[action_type as keyof typeof INTERNAL_ACTION_RISK];
  }
  const ext = EXTERNAL_ACTION_REGISTRY[action_type];
  if (ext) return ext.risk_level;
  return "unknown";
}

function mapReceipt(row: ReceiptRow): ConsoleReceipt {
  const audit = (row.audit_record ?? {}) as Record<string, unknown>;
  const recovery = audit.recovery_decision as string | undefined;
  const requires_manual_review =
    audit.requires_manual_review === true ||
    recovery === "orphaned_unknown_requires_manual_review";
  let outcome_kind: ConsoleReceipt["outcome_kind"] = "other";
  if (recovery === "orphaned_failed") outcome_kind = "orphaned_failed";
  else if (recovery === "orphaned_unknown_requires_manual_review")
    outcome_kind = "orphaned_unknown_requires_manual_review";
  else if (row.result === "rolled_back") outcome_kind = "rolled_back";
  else if (row.result === "failure") outcome_kind = "failed";
  else if (row.result === "success") outcome_kind = "executed";
  // Audit may also flag dry-run / replayed via metadata
  if (audit.replayed === true) outcome_kind = "replayed";

  let audit_record_preview = "";
  try {
    audit_record_preview = JSON.stringify(redactPayload(audit)).slice(0, 240);
  } catch {
    audit_record_preview = "[unserializable]";
  }

  return {
    receipt_id: row.receipt_id,
    action_type: row.action_type,
    scope: scopeFor(row.action_type),
    risk_level: row.risk_level,
    result: row.result,
    outcome_kind,
    started_at: row.started_at,
    completed_at: row.completed_at,
    idempotency_key_preview: previewKey(row.idempotency_key),
    related_receipt_id: row.related_receipt_id,
    rollback_available: row.rollback_available,
    external_reference: row.external_reference,
    audit_record_preview,
    safe_error_message: row.safe_error_message ? safeMsg(row.safe_error_message) : null,
    requires_manual_review,
  };
}

function mapArtifact(row: ArtifactRow): ConsoleArtifact {
  const payloadObj =
    row.payload && typeof row.payload === "object"
      ? (row.payload as Record<string, unknown>)
      : {};
  const exec_scope: ExecuteScope =
    (payloadObj.execute_scope as string) === "external" ? "external" : "internal";
  const redacted = redactPayload(payloadObj) as Record<string, unknown>;
  return {
    id: row.id,
    action_type: row.action_type,
    execute_scope: exec_scope,
    risk_level: row.risk_level,
    title: row.title,
    created_at: row.created_at,
    rolled_back_at: row.rolled_back_at,
    payload_preview: redacted,
  };
}

function mapOrphan(row: IdemRow, ttl_ms: number): ConsoleOrphanState {
  const created = Date.parse(row.created_at);
  const age = Number.isFinite(created) ? Date.now() - created : null;
  const risk = riskFor(row.action_type);
  const isOrphan = age !== null && age >= ttl_ms;
  const highOrUnknown = risk === "high" || risk === "critical" || risk === "unknown";
  let decision: ConsoleOrphanState["decision"] = "pending";
  let requires_manual_review = false;
  if (isOrphan) {
    if (highOrUnknown) {
      decision = "orphaned_unknown_requires_manual_review";
      requires_manual_review = true;
    } else {
      decision = "orphaned_failed";
    }
  }
  return {
    idempotency_key_preview: previewKey(row.idempotency_key) ?? "",
    action_type: row.action_type,
    scope: scopeFor(row.action_type),
    risk_level: risk,
    decision,
    retry_allowed: !highOrUnknown && isOrphan,
    requires_manual_review,
    auto_reexecuted: false,
    receipt_id: row.receipt_id,
    gate_age_ms: age,
    created_at: row.created_at,
  };
}

export interface ExecuteConsoleFetchEnv {
  admin: AdminClient;
  userId: string;
}

export async function fetchExecuteConsoleData(
  env: ExecuteConsoleFetchEnv,
): Promise<ExecuteConsoleData> {
  const t0 = Date.now();
  const { admin, userId } = env;

  const [receiptsR, artifactsR, idemR] = await Promise.all([
    safeQuery<ReceiptRow>("execute_receipts", async () =>
      admin
        .from("execute_receipts")
        .select(
          "receipt_id,action_type,risk_level,result,started_at,completed_at,idempotency_key,related_receipt_id,rollback_available,external_reference,audit_record,safe_error_message",
        )
        .eq("owner_id", userId)
        .order("started_at", { ascending: false })
        .limit(RECEIPT_LIMIT),
    ),
    safeQuery<ArtifactRow>("internal_execute_artifacts", async () =>
      admin
        .from("internal_execute_artifacts")
        .select("id,action_type,risk_level,title,created_at,rolled_back_at,payload")
        .eq("owner_id", userId)
        .order("created_at", { ascending: false })
        .limit(ARTIFACT_LIMIT),
    ),
    safeQuery<IdemRow>("execute_idempotency", async () =>
      admin
        .from("execute_idempotency")
        .select("idempotency_key,action_type,receipt_id,created_at")
        .eq("owner_id", userId)
        .order("created_at", { ascending: false })
        .limit(IDEMP_LIMIT),
    ),
  ]);

  const recent_receipts = receiptsR.rows.map(mapReceipt);
  const recent_artifacts = artifactsR.rows.map(mapArtifact);

  const ttl_ms = getOrphanGateTtlMs();
  const pendingGates = idemR.rows.filter((r) => r.receipt_id === null);
  const orphan_states = pendingGates.map((r) => mapOrphan(r, ttl_ms));

  // Manual review = receipts flagged + orphan states needing review
  const manual_review_items = recent_receipts.filter((r) => r.requires_manual_review);

  // Rollback candidates: artifacts not yet rolled back AND whose action_type
  // is rollback-supported (internal only — sandbox external has no rollback).
  const rollback_candidates = recent_artifacts.filter((a) => {
    if (a.rolled_back_at) return false;
    if (a.execute_scope !== "internal") return false;
    const t = a.action_type as keyof typeof INTERNAL_ACTION_ROLLBACK;
    const rb = INTERNAL_ACTION_ROLLBACK[t];
    return rb?.rollback_available === true;
  });

  const available_actions = buildCapabilities();
  const blocked_actions = buildBlocked();

  const last_receipt = recent_receipts[0] ?? null;
  const last_orphan_recovery =
    recent_receipts.find((r) =>
      r.outcome_kind === "orphaned_failed" ||
      r.outcome_kind === "orphaned_unknown_requires_manual_review",
    ) ?? null;

  const warnings: string[] = [];
  if (receiptsR.meta.status === "error")
    warnings.push(`receipts_source_error: ${receiptsR.meta.error_safe_message}`);
  if (artifactsR.meta.status === "error")
    warnings.push(`artifacts_source_error: ${artifactsR.meta.error_safe_message}`);
  if (idemR.meta.status === "error")
    warnings.push(`idempotency_source_error: ${idemR.meta.error_safe_message}`);
  if (orphan_states.some((o) => o.requires_manual_review))
    warnings.push("manual_review_required_present");

  // v3.36 — detect whether the MEDIUM external connector is registered
  // AND its required env var is configured. This is the only place that
  // flips `medium_external_connector_available` to true.
  let mediumConnectorAvailable = false;
  let mediumConnectorStatus: "available" | "missing_env" | "disabled" = "disabled";
  const n8nEntry = EXTERNAL_ACTION_REGISTRY.external_n8n_controlled_webhook;
  if (n8nEntry?.enabled) {
    try {
      const { N8N_CONTROLLED_WORKFLOWS } = await import(
        "@/lib/execute-dispatcher/n8n-controlled-workflows"
      );
      const envs = Object.values(N8N_CONTROLLED_WORKFLOWS).map(
        (w) => w.endpoint_env_var,
      );
      const anyConfigured = envs.some(
        (v) => typeof (process.env as Record<string, string | undefined>)[v] === "string",
      );
      mediumConnectorAvailable = anyConfigured;
      mediumConnectorStatus = anyConfigured ? "available" : "missing_env";
      if (!anyConfigured) warnings.push("medium_external_connector_env_missing");
    } catch {
      mediumConnectorStatus = "disabled";
    }
  }

  const engine_status: ConsoleEngineStatus = {
    internal_execute_enabled: true,
    external_sandbox_execute_enabled: true,
    orphan_gate_reaper_enabled: true,
    high_live_actions_blocked: true,
    medium_external_connector_available: mediumConnectorAvailable,
    medium_external_connector_status: mediumConnectorStatus,
    last_receipt_at: last_receipt?.started_at ?? null,
    last_orphan_recovery_at: last_orphan_recovery?.started_at ?? null,
    warnings,
  };

  const total_ms = Date.now() - t0;
  return {
    engine_status,
    available_actions,
    blocked_actions,
    recent_receipts,
    recent_artifacts,
    orphan_states,
    rollback_candidates,
    manual_review_items,
    capabilities: {
      internal_action_count: INTERNAL_ACTION_TYPES.length,
      external_action_count: Object.keys(EXTERNAL_ACTION_REGISTRY).length,
      rollbackable_action_count: available_actions.filter((a) => a.supports_rollback)
        .length,
    },
    warnings,
    source_status: {
      receipts: receiptsR.meta,
      artifacts: artifactsR.meta,
      idempotency: idemR.meta,
    },
    timings: {
      total_ms,
      per_source_ms: {
        receipts: receiptsR.meta.duration_ms,
        artifacts: artifactsR.meta.duration_ms,
        idempotency: idemR.meta.duration_ms,
      },
    },
    provenance: {
      generated_at: new Date().toISOString(),
      project_id: "brainhub-os",
      user_scoped: true,
    },
  };
}

// ---------------------------------------------------------------------------
// v3.36 — ServiceOutcome wrapper (Principio 3 — Service Layer Pattern)
// ---------------------------------------------------------------------------
// `fetchExecuteConsoleData` was originally written as a route helper that
// returned a plain object plus an inline `{ ok }` wrapper at the HTTP
// boundary. v3.36 enforces ADR-003 / Principle 3: every public service
// called directly by a route must return `ServiceOutcome<T>`.
//
// We DO NOT delete the existing function: internal callers (tests,
// scripts) still rely on the rich payload shape. Instead, the route
// imports `fetchExecuteConsoleDataOutcome` and projects the outcome onto
// the HTTP response. Partial source failures are reported via `trust`
// without collapsing the payload (Principio 2).

import {
  type ServiceOutcome,
  errorOutcome,
  liveOutcome,
} from "@/lib/service-outcome";
import type { DataTrust as _DataTrust } from "@/lib/data-trust/types";

export async function fetchExecuteConsoleDataOutcome(
  env: ExecuteConsoleFetchEnv,
): Promise<ServiceOutcome<ExecuteConsoleData>> {
  const t0 = Date.now();
  const meta = {
    source_tables: [
      "execute_receipts",
      "internal_execute_artifacts",
      "execute_idempotency",
    ],
    source_function: "fetchExecuteConsoleData",
  };
  try {
    const data = await fetchExecuteConsoleData(env);
    const duration_ms = Date.now() - t0;
    const sources = [
      data.source_status.receipts.status,
      data.source_status.artifacts.status,
      data.source_status.idempotency.status,
    ];
    const allLive = sources.every((s) => s === "live" || s === "empty");
    if (allLive) return liveOutcome(data, meta, duration_ms);
    const allFailed = sources.every((s) => s === "error" || s === "missing");
    if (allFailed) {
      return errorOutcome<ExecuteConsoleData>(
        meta,
        duration_ms,
        "all_execute_console_sources_failed",
        "execute_console_all_sources_error",
      );
    }
    // Partial: at least one source live, at least one degraded. We
    // still return the (best-effort) data, but mark trust with reduced
    // confidence and explicit warnings so the UI can render a degraded
    // badge. The enum has no "partial" status — use "live" + confidence
    // < 1 + warnings (the established Brain Hub convention).
    const partialTrust: _DataTrust = {
      status: "live",
      confidence: 0.5,
      calculation_method: "direct_source",
      provenance: {
        source_tables: meta.source_tables,
        source_functions: [meta.source_function],
      },
      freshness: new Date().toISOString(),
      warnings:
        data.warnings.length > 0
          ? ["execute_console_partial", ...data.warnings]
          : ["execute_console_partial"],
    };
    return { data, trust: partialTrust, duration_ms };
  } catch (err) {
    const duration_ms = Date.now() - t0;
    const msg =
      (err as { message?: string } | null)?.message ?? "execute_console_failed";
    return errorOutcome<ExecuteConsoleData>(
      meta,
      duration_ms,
      msg.slice(0, 240),
      "execute_console_unhandled",
    );
  }
}
