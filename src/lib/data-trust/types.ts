// Brain Hub v3.31 — Data Trust Model (architecture-principles.md, Principio 1)
// and Partial Failure Pattern / Source Criticality (Principio 2).
//
// Pure types. No runtime. Importable from server and client.

export type DataTrustStatus =
  | "live"
  | "empty"
  | "missing"
  | "unknown"
  | "error"
  | "loading";

export type ConfidenceCalculationMethod =
  | "direct_source"
  | "weighted_average"
  | "minimum_source"
  | "manual_review"
  | "graph_inference_v1"
  | "not_applicable";

export interface DataTrustProvenance {
  source_tables?: string[];
  source_functions?: string[];
  source_events?: string[];
  source_files?: string[];
  source_external_tools?: string[];
}

export interface DataTrust {
  status: DataTrustStatus;
  /** integer 0-100, or null when not calculable. Never use 0 as "missing". */
  confidence: number | null;
  calculation_method: ConfidenceCalculationMethod;
  provenance: DataTrustProvenance;
  /** ISO timestamp or null. Freshness is data, not a verdict. */
  freshness: string | null;
  warnings?: string[];
}

/**
 * Partial Failure Pattern — Source Criticality.
 * Declared per consumer/module. Same source can have different criticality
 * in different consumers (e.g. gmail = optional for Priority Engine but
 * may become required for a future Communication Center).
 */
export type SourceCriticality = "required" | "important" | "optional";
