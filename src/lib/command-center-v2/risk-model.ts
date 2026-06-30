// Brain Hub v3.34 — Command Center v2 — Runtime Risk Model bindings.
//
// Applies docs/runtime/runtime-risk-model.md to the action types handled
// by Command Center v2. This file contains NO logic — only the mapping
// table and the minimal types that consumers need. Adding a new
// action_type requires adding a row here AND updating A3 in the EQG
// report.

export type RiskLevel = "low" | "medium" | "high" | "critical";

/**
 * Operational stage in the Read → Suggest → Prepare → Confirm → Execute
 * flow. LOW actions collapse stages (read → execute immediate). MEDIUM
 * actions go suggested → prepared → executed (execute = write inside
 * Brain Hub, not external). HIGH actions stop at waiting_confirmation in
 * this patch (real execute is out of scope for v3.34).
 */
export type OperationalStage =
  | "suggested"
  | "prepared"
  | "waiting_confirmation"
  | "executed"
  | "blocked";

export type ActionType =
  // LOW — navigation / pure read
  | "open_review_item"
  | "open_agent_run"
  | "open_email"
  | "open_project"
  // MEDIUM — write internal to Brain Hub (draft / prepare, not external)
  | "draft_email_reply"
  | "prepare_codex_prompt"
  | "create_action_queue_item"
  // HIGH — external / irreversible effect (execute out of scope in v3.34)
  | "send_email"
  | "publish_post"
  | "git_push"
  | "telegram_send"
  | "n8n_live"
  | "delete_data";

export const ACTION_RISK: Readonly<Record<ActionType, RiskLevel>> = Object.freeze({
  open_review_item: "low",
  open_agent_run: "low",
  open_email: "low",
  open_project: "low",
  draft_email_reply: "medium",
  prepare_codex_prompt: "medium",
  create_action_queue_item: "medium",
  send_email: "high",
  publish_post: "high",
  git_push: "high",
  telegram_send: "high",
  n8n_live: "high",
  delete_data: "high",
});

export function riskFor(action: ActionType): RiskLevel {
  return ACTION_RISK[action];
}
