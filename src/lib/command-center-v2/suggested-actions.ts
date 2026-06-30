// Brain Hub v3.34 — Suggested Actions: pure projection of Priority Engine
// output into operational action candidates.
//
// This is NOT a second decision engine: the set of priorities is decided
// by `priority-engine.computePriorities`. Here we only translate each
// priority into the concrete first action a user can take, attaching
// risk_level (Runtime Risk Model) and inherited DataTrust (Principio 1).
//
// Not every priority yields a Suggested Action:
//   - review_pending     → open_review_item      (LOW)
//   - action_blocked     → none (goes to Blocked panel)
//   - automation_failed  → none (goes to Blocked panel)
//   - agent_waiting      → open_agent_run        (LOW)
//   - important_email    → draft_email_reply     (MEDIUM)

import type {
  PriorityItem,
  PrioritySourceKey,
} from "@/lib/priority-engine/priority-engine";
import type { DataTrust } from "@/lib/data-trust/types";
import {
  type ActionType,
  type OperationalStage,
  type RiskLevel,
  riskFor,
} from "./risk-model";

export interface SuggestedAction {
  id: string;
  action_type: ActionType;
  risk_level: RiskLevel;
  stage: OperationalStage; // always "suggested" here
  title: string;
  reason: string;
  source_priority_id: string;
  source_key: PrioritySourceKey;
  source_id: string;
  trust: DataTrust; // inherited from priority
}

export interface BlockedItem {
  id: string;
  reason_kind:
    | "action_blocked"
    | "automation_failed"
    | "governance_fail"
    | "connector_offline"
    | "missing_permissions"
    | "missing_data"
    | "waiting_sync";
  title: string;
  detail: string;
  source_key: PrioritySourceKey | "governance" | "connector";
  source_id: string | null;
  trust: DataTrust | null;
}

export interface SuggestedActionsProjection {
  suggested: SuggestedAction[];
  blocked_from_priorities: BlockedItem[];
}

export function projectSuggestedActions(
  priorities: PriorityItem[],
): SuggestedActionsProjection {
  const suggested: SuggestedAction[] = [];
  const blocked_from_priorities: BlockedItem[] = [];

  for (const p of priorities) {
    switch (p.rule) {
      case "review_pending": {
        suggested.push(makeSuggested(p, "open_review_item"));
        break;
      }
      case "agent_waiting": {
        suggested.push(makeSuggested(p, "open_agent_run"));
        break;
      }
      case "important_email": {
        suggested.push(makeSuggested(p, "draft_email_reply"));
        break;
      }
      case "action_blocked": {
        blocked_from_priorities.push({
          id: `blocked:${p.id}`,
          reason_kind: "action_blocked",
          title: p.title,
          detail: p.reason,
          source_key: p.source_key,
          source_id: p.source_id,
          trust: p.trust,
        });
        break;
      }
      case "automation_failed": {
        blocked_from_priorities.push({
          id: `blocked:${p.id}`,
          reason_kind: "automation_failed",
          title: p.title,
          detail: p.reason,
          source_key: p.source_key,
          source_id: p.source_id,
          trust: p.trust,
        });
        break;
      }
    }
  }

  return { suggested, blocked_from_priorities };
}

function makeSuggested(
  p: PriorityItem,
  action_type: ActionType,
): SuggestedAction {
  return {
    id: `suggested:${action_type}:${p.id}`,
    action_type,
    risk_level: riskFor(action_type),
    stage: "suggested",
    title: p.title,
    reason: p.reason,
    source_priority_id: p.id,
    source_key: p.source_key,
    source_id: p.source_id,
    trust: p.trust,
  };
}
