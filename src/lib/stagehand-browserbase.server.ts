// Brain Hub v3.23 — Stagehand + Browserbase adapter (server-only).
// Only loaded inside server function handlers. Never imported by client code.

import type {
  UiOperatorObservation,
  UiOperatorActionType,
} from "./ui-operator-types";
import { isExternalDomainForbidden, isRouteAllowedForUiOperator } from "./ui-operator-safety";

export interface StagehandConfig {
  configured: boolean;
  has_browserbase_api_key: boolean;
  has_browserbase_project_id: boolean;
  has_model_key: boolean;
  model: string;
}

export function getStagehandBrowserbaseConfig(): StagehandConfig {
  const has_browserbase_api_key = Boolean(process.env.BROWSERBASE_API_KEY);
  const has_browserbase_project_id = Boolean(process.env.BROWSERBASE_PROJECT_ID);
  const has_model_key = Boolean(process.env.OPENAI_API_KEY);
  const model = process.env.STAGEHAND_MODEL ?? "gpt-4o-mini";
  return {
    configured: has_browserbase_api_key && has_browserbase_project_id && has_model_key,
    has_browserbase_api_key,
    has_browserbase_project_id,
    has_model_key,
    model,
  };
}

// In a future iteration this will hold real Stagehand instances. For now the
// adapter never bundles `@browserbasehq/stagehand` (which is Node-only) and
// always reports stagehand_unavailable when called. The mock adapter in
// `ui-operator-browser.server.ts` is responsible for the working flow.
export async function stagehandStartSession(_input: {
  baseUrl: string;
  initialRoute: string;
}): Promise<{ ok: false; reason: "stagehand_unavailable" }> {
  return { ok: false, reason: "stagehand_unavailable" };
}

export async function stagehandObserve(_input: {
  browserbaseSessionId: string;
  route: string;
}): Promise<{ ok: false; reason: "stagehand_unavailable" }> {
  return { ok: false, reason: "stagehand_unavailable" };
}

export function stagehandIsRouteAllowed(route: string): boolean {
  return isRouteAllowedForUiOperator(route);
}

export function stagehandIsUrlForbidden(url: string): boolean {
  return isExternalDomainForbidden(url);
}

// Helper kept here so the real implementation can later swap mock observations
// for Stagehand `page.observe()` calls without changing the public adapter.
export function buildEmptyObservation(
  route: string,
  reason: string,
): UiOperatorObservation {
  return {
    route,
    current_url: route,
    page_title: null,
    summary: `Osservazione non disponibile: ${reason}`,
    detected_state: null,
    available_actions: [],
    screenshot_hash: null,
    captured_at: new Date().toISOString(),
    mock: true,
  };
}

export function inferActionTypeFromGoal(goal: string): UiOperatorActionType {
  const g = goal.toLowerCase();
  if (/sincroniz|sync|refresh/.test(g)) return "click_sync";
  if (/disconnett|rimuovi|elimina/.test(g)) return "disconnect_connection";
  if (/approva|approv/.test(g)) return "approve_action_queue";
  if (/esegui n8n|run n8n/.test(g)) return "execute_n8n";
  if (/snapshot/.test(g)) return "update_master_snapshot";
  if (/apri dialog|apri modale|connetti|ricollega/.test(g)) return "open_dialog";
  if (/scorri|scroll/.test(g)) return "scroll";
  if (/tab|filtro/.test(g)) return "change_tab";
  if (/dettagl|apri.*mail|apri.*email/.test(g)) return "open_detail";
  if (/leggi stato|stato/.test(g)) return "read_state";
  if (/osserva|guarda|controlla/.test(g)) return "observe_screen";
  return "observe_screen";
}
