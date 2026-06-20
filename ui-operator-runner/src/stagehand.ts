// Thin wrapper around @browserbasehq/stagehand. Kept in its own file so the
// HTTP layer stays small and so that swapping driver is local.
//
// NOTE: this file targets Node 20+. It is NEVER bundled into Brain Hub.

import { isAllowedAbsoluteUrl, isAllowedRoute, sanitizeError } from "./security.js";

// We import Stagehand lazily so the runner can boot (and /health respond)
// even before Stagehand/Browserbase are reachable.
type StagehandLike = {
  init: () => Promise<void>;
  page: {
    goto: (url: string) => Promise<unknown>;
    title: () => Promise<string>;
    observe: (instruction?: string) => Promise<Array<{ description?: string; selector?: string }>>;
    act: (instruction: string) => Promise<unknown>;
  };
  close: () => Promise<void>;
  browserbaseSessionID?: string;
};

interface RunnerSession {
  id: string;
  brainHubSessionId: string;
  stagehand: StagehandLike;
  browserbaseSessionId: string | null;
  createdAt: number;
  actionsUsed: number;
}

const sessions = new Map<string, RunnerSession>();

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`missing_env:${name}`);
  return v;
}

async function importStagehand(): Promise<{
  Stagehand: new (opts: Record<string, unknown>) => StagehandLike;
} | null> {
  try {
    // Optional dep — runner can boot without it for /health
    const mod = (await import("@browserbasehq/stagehand")) as unknown as {
      Stagehand: new (opts: Record<string, unknown>) => StagehandLike;
    };
    return mod;
  } catch {
    return null;
  }
}

export async function startSession(
  brainHubSessionId: string,
  initialRoute: string,
): Promise<
  | { ok: true; runnerSessionId: string; browserbaseSessionId: string | null }
  | { ok: false; errorCode: string; safeMessage: string }
> {
  if (!isAllowedRoute(initialRoute)) {
    return { ok: false, errorCode: "route_blocked", safeMessage: "Route iniziale non consentita." };
  }
  let baseUrl: string;
  try {
    baseUrl = requireEnv("BRAIN_HUB_BASE_URL");
    requireEnv("BROWSERBASE_API_KEY");
    requireEnv("BROWSERBASE_PROJECT_ID");
    requireEnv("OPENAI_API_KEY");
  } catch (err) {
    return {
      ok: false,
      errorCode: "not_configured",
      safeMessage: sanitizeError(err),
    };
  }
  const mod = await importStagehand();
  if (!mod) {
    return {
      ok: false,
      errorCode: "stagehand_error",
      safeMessage: "Stagehand non installato sul runner.",
    };
  }
  try {
    const stagehand = new mod.Stagehand({
      env: "BROWSERBASE",
      apiKey: env("BROWSERBASE_API_KEY"),
      projectId: env("BROWSERBASE_PROJECT_ID"),
      modelName: env("STAGEHAND_MODEL") ?? "gpt-4o-mini",
      modelClientOptions: { apiKey: env("OPENAI_API_KEY") },
    });
    await stagehand.init();
    const target = new URL(initialRoute, baseUrl).toString();
    if (!isAllowedAbsoluteUrl(target, baseUrl)) {
      await stagehand.close().catch(() => {});
      return { ok: false, errorCode: "route_blocked", safeMessage: "URL non consentita." };
    }
    await stagehand.page.goto(target);
    const session: RunnerSession = {
      id: brainHubSessionId,
      brainHubSessionId,
      stagehand,
      browserbaseSessionId: stagehand.browserbaseSessionID ?? null,
      createdAt: Date.now(),
      actionsUsed: 0,
    };
    sessions.set(brainHubSessionId, session);
    return {
      ok: true,
      runnerSessionId: brainHubSessionId,
      browserbaseSessionId: session.browserbaseSessionId,
    };
  } catch (err) {
    return {
      ok: false,
      errorCode: "browserbase_error",
      safeMessage: sanitizeError(err),
    };
  }
}

export function getSession(id: string): RunnerSession | undefined {
  return sessions.get(id);
}

export async function stopSession(id: string): Promise<void> {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  try {
    await s.stagehand.close();
  } catch {
    // best effort
  }
}

export function trackAction(id: string, max: number): { ok: boolean; reason?: string } {
  const s = sessions.get(id);
  if (!s) return { ok: false, reason: "session_not_found" };
  if (s.actionsUsed >= max) return { ok: false, reason: "max_actions_reached" };
  s.actionsUsed += 1;
  return { ok: true };
}

export function sessionAgeMs(id: string): number {
  const s = sessions.get(id);
  return s ? Date.now() - s.createdAt : Infinity;
}

export async function stagehandIsReady(): Promise<boolean> {
  const mod = await importStagehand();
  return !!mod;
}
