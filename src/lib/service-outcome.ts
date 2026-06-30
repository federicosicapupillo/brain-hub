// Brain Hub v3.33 — Service Layer Pattern (ADR-003, Principio 3).
//
// ServiceOutcome<T> is the public contract of the Service Layer. Every
// public service (called directly from a route API handler) returns
// ServiceOutcome<T>. Internal helpers may keep working on pure models.
//
// DataTrust remains the single source of truth for status/confidence/
// provenance/freshness (ADR-001). ServiceOutcome only adds the orthogonal
// concerns a route needs at the boundary: timing and a safe error message.
//
// UI envelopes (e.g. WidgetProvenance for the Command Center) MUST be
// derived from ServiceOutcome via the pure projections below, not built
// independently from raw rows.

import type {
  DataTrust,
  DataTrustStatus,
  DataTrustProvenance,
} from "@/lib/data-trust/types";

export interface ServiceOutcome<T> {
  data: T | null;
  trust: DataTrust;
  error_safe_message?: string;
  duration_ms: number;
}

export interface ServiceProvenanceMeta {
  source_tables: string[];
  source_function: string;
}

// -- Constructors ---------------------------------------------------------

function buildTrust(
  status: DataTrustStatus,
  meta: ServiceProvenanceMeta,
  opts: {
    confidence: number | null;
    warnings?: string[];
    freshness?: string | null;
  },
): DataTrust {
  const provenance: DataTrustProvenance = {
    source_tables: meta.source_tables,
    source_functions: [meta.source_function],
  };
  return {
    status,
    confidence: opts.confidence,
    calculation_method: "direct_source",
    provenance,
    freshness: opts.freshness ?? null,
    warnings: opts.warnings && opts.warnings.length > 0 ? opts.warnings : undefined,
  };
}

export function liveOutcome<T>(
  data: T,
  meta: ServiceProvenanceMeta,
  duration_ms: number,
  freshness: string = new Date().toISOString(),
): ServiceOutcome<T> {
  return {
    data,
    trust: buildTrust("live", meta, { confidence: 1, freshness }),
    duration_ms,
  };
}

export function emptyOutcome<T>(
  emptyValue: T,
  meta: ServiceProvenanceMeta,
  duration_ms: number,
): ServiceOutcome<T> {
  return {
    data: emptyValue,
    trust: buildTrust("empty", meta, { confidence: 1, freshness: null }),
    duration_ms,
  };
}

export function unknownOutcome<T>(
  meta: ServiceProvenanceMeta,
  duration_ms: number,
  warnings: string[] = [],
): ServiceOutcome<T> {
  return {
    data: null,
    trust: buildTrust("unknown", meta, {
      confidence: null,
      warnings,
      freshness: null,
    }),
    duration_ms,
  };
}

export function missingOutcome<T>(
  meta: ServiceProvenanceMeta,
  reason: string,
): ServiceOutcome<T> {
  return {
    data: null,
    trust: buildTrust("missing", meta, {
      confidence: null,
      warnings: [reason],
      freshness: null,
    }),
    duration_ms: 0,
  };
}

export function errorOutcome<T>(
  meta: ServiceProvenanceMeta,
  duration_ms: number,
  error_safe_message: string,
  warning: string = "source_query_failed",
): ServiceOutcome<T> {
  return {
    data: null,
    trust: buildTrust("error", meta, {
      confidence: 0,
      warnings: [warning],
      freshness: null,
    }),
    error_safe_message,
    duration_ms,
  };
}

// -- Pure projections -----------------------------------------------------

export interface WidgetProvenanceProjection {
  status: DataTrustStatus;
  source_tables: string[];
  source_function: string;
  last_updated: string | null;
  confidence: number | null;
  warnings: string[];
  duration_ms: number;
  error_safe_message?: string;
}

/**
 * Pure projection: ServiceOutcome → legacy WidgetProvenance envelope used
 * by the Command Center payload. No I/O, no logic — only re-shapes fields.
 */
export function toWidgetProvenance<T>(
  outcome: ServiceOutcome<T>,
): WidgetProvenanceProjection {
  const trust = outcome.trust;
  const source_function =
    trust.provenance.source_functions?.[0] ?? "unknown.service";
  const projection: WidgetProvenanceProjection = {
    status: trust.status,
    source_tables: trust.provenance.source_tables ?? [],
    source_function,
    last_updated: trust.freshness,
    confidence: trust.confidence,
    warnings: trust.warnings ?? [],
    duration_ms: outcome.duration_ms,
  };
  if (outcome.error_safe_message) {
    projection.error_safe_message = outcome.error_safe_message;
  }
  return projection;
}
