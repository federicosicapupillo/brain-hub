// Express route handlers. Each handler returns the contract shape expected
// by Brain Hub's `ui-operator-runner-client.server.ts`.

import type { Request, Response } from "express";
import {
  getSession,
  sessionAgeMs,
  stagehandIsReady,
  startSession,
  stopSession,
  trackAction,
} from "./stagehand.js";
import { isAllowedAbsoluteUrl, isAllowedRoute, sanitizeError } from "./security.js";

const SESSION_TIMEOUT_MS = Number(process.env.SESSION_TIMEOUT_MS ?? 600_000);
const MAX_ACTIONS_PER_SESSION = Number(process.env.MAX_ACTIONS_PER_SESSION ?? 40);
const BRAIN_HUB_BASE_URL = process.env.BRAIN_HUB_BASE_URL ?? "";

function fail(res: Response, status: string, code: string, msg: string, http = 200) {
  res.status(http).json({
    ok: false,
    status,
    error_code: code,
    safe_message: msg,
    data: null,
  });
}

export async function handleHealth(_req: Request, res: Response) {
  const stagehand_ready = await stagehandIsReady();
  res.json({
    ok: true,
    status: "ok",
    safe_message: "runner up",
    data: {
      runner_version: "0.1.0",
      browserbase_configured: Boolean(
        process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID,
      ),
      stagehand_ready,
    },
  });
}

export async function handleStart(req: Request, res: Response) {
  const { session_id, initial_route } = req.body ?? {};
  if (typeof session_id !== "string" || typeof initial_route !== "string") {
    return fail(res, "error", "bad_request", "session_id e initial_route obbligatori.", 400);
  }
  const r = await startSession(session_id, initial_route);
  if (!r.ok) return fail(res, r.errorCode, r.errorCode, r.safeMessage);
  res.json({
    ok: true,
    status: "started",
    data: {
      runner_session_id: r.runnerSessionId,
      browserbase_session_id: r.browserbaseSessionId,
      execution_mode: "real_runner",
    },
  });
}

function requireLiveSession(sessionId: string, res: Response): boolean {
  const s = getSession(sessionId);
  if (!s) {
    fail(res, "error", "session_not_found", "Sessione runner non trovata.");
    return false;
  }
  if (sessionAgeMs(sessionId) > SESSION_TIMEOUT_MS) {
    fail(res, "timeout", "session_timeout", "Sessione runner scaduta.");
    return false;
  }
  const guard = trackAction(sessionId, MAX_ACTIONS_PER_SESSION);
  if (!guard.ok) {
    fail(res, "error", guard.reason ?? "guard", "Limite azioni raggiunto.");
    return false;
  }
  return true;
}

export async function handleOpenRoute(req: Request, res: Response) {
  const { session_id, route } = req.body ?? {};
  if (typeof session_id !== "string" || typeof route !== "string") {
    return fail(res, "error", "bad_request", "session_id e route obbligatori.", 400);
  }
  if (!isAllowedRoute(route)) return fail(res, "route_blocked", "route_blocked", "Route non consentita.");
  if (!requireLiveSession(session_id, res)) return;
  const s = getSession(session_id)!;
  try {
    const target = new URL(route, BRAIN_HUB_BASE_URL).toString();
    if (!isAllowedAbsoluteUrl(target, BRAIN_HUB_BASE_URL)) {
      return fail(res, "route_blocked", "route_blocked", "URL non consentita.");
    }
    await s.stagehand.page.goto(target);
    const title = await s.stagehand.page.title().catch(() => "");
    res.json({
      ok: true,
      status: "navigated",
      data: { current_url: target, page_title: title || null },
    });
  } catch (err) {
    fail(res, "browserbase_error", "navigate_failed", sanitizeError(err));
  }
}

export async function handleObserve(req: Request, res: Response) {
  const { session_id, route } = req.body ?? {};
  if (typeof session_id !== "string" || typeof route !== "string") {
    return fail(res, "error", "bad_request", "session_id e route obbligatori.", 400);
  }
  if (!isAllowedRoute(route)) return fail(res, "route_blocked", "route_blocked", "Route non consentita.");
  if (!requireLiveSession(session_id, res)) return;
  const s = getSession(session_id)!;
  try {
    const observed = await s.stagehand.page.observe("Lista i pulsanti e le CTA principali visibili.");
    const title = await s.stagehand.page.title().catch(() => "");
    res.json({
      ok: true,
      status: "observed",
      data: {
        observation: {
          route,
          current_url: route,
          page_title: title || null,
          summary: `Osservazione reale. ${observed.length} elementi rilevati.`,
          detected_state: null,
          available_actions: observed.slice(0, 8).map((o) => ({
            action_type: "read_state",
            title: (o.description ?? "elemento").slice(0, 120),
            selector_hint: o.selector ?? null,
            risk_level: "low",
          })),
          screenshot_hash: null,
          captured_at: new Date().toISOString(),
          mock: false,
        },
      },
    });
  } catch (err) {
    fail(res, "stagehand_error", "observe_failed", sanitizeError(err));
  }
}

export async function handlePropose(req: Request, res: Response) {
  const { session_id, route, goal } = req.body ?? {};
  if (typeof session_id !== "string" || typeof route !== "string" || typeof goal !== "string") {
    return fail(res, "error", "bad_request", "session_id, route, goal obbligatori.", 400);
  }
  if (!isAllowedRoute(route)) return fail(res, "route_blocked", "route_blocked", "Route non consentita.");
  if (!requireLiveSession(session_id, res)) return;
  res.json({
    ok: true,
    status: "proposed",
    data: {
      action_type: "click_sync",
      title: `Proposta: ${goal}`.slice(0, 160),
      description: `Sul runner reale propongo un'azione coerente con: ${goal}.`,
      selector_hint: null,
      risk_level: "medium",
      requires_confirmation: true,
    },
  });
}

export async function handleExecute(req: Request, res: Response) {
  const { session_id, route, action_type, confirmed } = req.body ?? {};
  if (typeof session_id !== "string" || typeof route !== "string" || typeof action_type !== "string") {
    return fail(res, "error", "bad_request", "Payload incompleto.", 400);
  }
  if (confirmed !== true) return fail(res, "blocked", "not_confirmed", "Azione non confermata.");
  if (!isAllowedRoute(route)) return fail(res, "route_blocked", "route_blocked", "Route non consentita.");
  if (!requireLiveSession(session_id, res)) return;
  const s = getSession(session_id)!;
  try {
    await s.stagehand.page.act(`Esegui l'azione "${action_type}" coerente con la pagina ${route}.`);
    res.json({
      ok: true,
      status: "executed",
      data: {
        result_text: `Azione '${action_type}' eseguita su ${route}.`,
        post_observation: null,
      },
    });
  } catch (err) {
    fail(res, "stagehand_error", "execute_failed", sanitizeError(err));
  }
}

export async function handleStop(req: Request, res: Response) {
  const { session_id } = req.body ?? {};
  if (typeof session_id !== "string") {
    return fail(res, "error", "bad_request", "session_id obbligatorio.", 400);
  }
  await stopSession(session_id);
  res.json({ ok: true, status: "stopped", data: { closed: true } });
}
