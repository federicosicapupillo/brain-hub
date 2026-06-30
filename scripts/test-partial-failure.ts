// Brain Hub v3.32 — Partial-failure harness (standalone, no HTTP).
//
// Replaces the deprecated `__force_fail` query param previously exposed by
// /api/command-center-data and /api/priority-engine-data. Asserts the
// criticality-aware widget envelope in computePriorities by feeding
// synthetic SourceOutcome values directly.
//
// Run with:  bun run scripts/test-partial-failure.ts

import {
  computePriorities,
  type PriorityEngineInputs,
} from "../src/lib/priority-engine/priority-engine";
import type { DataTrustStatus } from "../src/lib/data-trust/types";

function source<T>(status: DataTrustStatus, rows: T[] = []) {
  return {
    status,
    rows,
    freshness: status === "live" ? new Date().toISOString() : null,
    error_safe_message: status === "error" ? "synthetic_failure" : undefined,
  };
}

function baseInputs(): PriorityEngineInputs {
  return {
    action_queue: source("live", []),
    result_review: source("live", []),
    projects: source("live", []),
    agent_runs: source("live", []),
    gmail: source("live", []),
    github: source("live", []),
  };
}

function assert(name: string, cond: boolean, detail?: unknown) {
  if (!cond) {
    console.error(`✗ ${name}`, detail ?? "");
    process.exit(1);
  }
  console.log(`✓ ${name}`);
}

// Case 1: required source (action_queue) fails → widget.status === "error"
{
  const inputs = baseInputs();
  inputs.action_queue = source("error", []);
  const r = computePriorities(inputs);
  assert(
    "required source failure → widget.status === 'error'",
    r.widget.status === "error" && r.widget.confidence === null,
    r.widget,
  );
  assert(
    "rule_metadata exposes confidence_reason on required failure",
    typeof r.widget.rule_metadata?.confidence_reason === "string" &&
      r.widget.rule_metadata.confidence_reason.includes("required"),
    r.widget.rule_metadata,
  );
}

// Case 2: important source (result_review) fails → confidence === 60
{
  const inputs = baseInputs();
  inputs.result_review = source("error", []);
  const r = computePriorities(inputs);
  assert(
    "important source failure → confidence === 60",
    r.widget.status !== "error" && r.widget.confidence === 60,
    r.widget,
  );
}

// Case 3: optional source (gmail) fails with no priorities → empty branch wins
{
  const inputs = baseInputs();
  inputs.gmail = source("error", []);
  const r = computePriorities(inputs);
  assert(
    "optional-only failure + no priorities → empty + confidence 100, optional warning recorded",
    r.widget.status === "empty" &&
      r.widget.confidence === 100 &&
      (r.widget.warnings ?? []).includes("optional_source_gmail_error"),
    r.widget,
  );
}

// Case 4: all live, no rows → widget.status === "empty", confidence 100
{
  const r = computePriorities(baseInputs());
  assert(
    "all live + no rows → widget.status === 'empty' & confidence 100",
    r.widget.status === "empty" && r.widget.confidence === 100,
    r.widget,
  );
}

// Case 5: calculation_method must always be rule_based_score now
{
  const r = computePriorities(baseInputs());
  assert(
    "widget.calculation_method === 'rule_based_score'",
    r.widget.calculation_method === "rule_based_score",
    r.widget.calculation_method,
  );
  assert(
    "widget.rule_metadata exposes all 4 required fields",
    !!r.widget.rule_metadata &&
      Array.isArray(r.widget.rule_metadata.rules_used) &&
      Array.isArray(r.widget.rule_metadata.input_sources) &&
      typeof r.widget.rule_metadata.source_criticality === "object" &&
      typeof r.widget.rule_metadata.confidence_reason === "string",
    r.widget.rule_metadata,
  );
}

console.log("\nAll partial-failure harness assertions passed.");
