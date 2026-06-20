// Brain Hub v3.23.2 — UI Operator auth handshake (server-only).
// Issues short-lived, one-time tokens the runner can use to open allowlisted
// internal Brain Hub routes without sharing passwords, OAuth tokens or
// browser cookies. Tokens are stored as SHA-256 hashes only.

import { ALLOWED_UI_ROUTES, isRouteAllowedForUiOperator } from "./ui-operator-safety";

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

export type UiOperatorAuthTokenStatus = "active" | "used" | "expired" | "revoked";

export interface UiOperatorAuthTokenRow {
  id: string;
  user_id: string;
  session_id: string;
  token_hash: string;
  status: UiOperatorAuthTokenStatus;
  allowed_routes: string[];
  expires_at: string;
  used_at: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface ValidatedUiOperatorAuthToken {
  ok: boolean;
  status: UiOperatorAuthTokenStatus | "not_found" | "invalid";
  reason: string | null;
  token_id: string | null;
  user_id: string | null;
  session_id: string | null;
  allowed_routes: string[];
  expires_at: string | null;
}

function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashUiOperatorAuthToken(raw: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function safeTokenPrefix(raw: string): string {
  return raw.slice(0, 8);
}

function sanitizeAllowedRoutes(input: unknown): string[] {
  const list = Array.isArray(input) ? input : [];
  const out: string[] = [];
  for (const r of list) {
    if (typeof r === "string" && isRouteAllowedForUiOperator(r)) out.push(r);
  }
  // de-duplicate preserving order
  return Array.from(new Set(out));
}

export interface CreateUiOperatorAuthTokenInput {
  user_id: string;
  session_id: string;
  allowed_routes: string[];
  ttl_ms?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateUiOperatorAuthTokenResult {
  ok: boolean;
  token: string | null;       // raw token, returned ONCE
  token_id: string | null;
  expires_at: string | null;
  allowed_routes: string[];
  error: string | null;
}

export async function createUiOperatorAuthToken(
  input: CreateUiOperatorAuthTokenInput,
): Promise<CreateUiOperatorAuthTokenResult> {
  const allowed = sanitizeAllowedRoutes(
    input.allowed_routes && input.allowed_routes.length > 0
      ? input.allowed_routes
      : ALLOWED_UI_ROUTES,
  );
  if (allowed.length === 0) {
    return {
      ok: false,
      token: null,
      token_id: null,
      expires_at: null,
      allowed_routes: [],
      error: "no_allowed_routes",
    };
  }
  const ttl = Math.max(30_000, Math.min(input.ttl_ms ?? DEFAULT_TTL_MS, 15 * 60 * 1000));
  const raw = randomToken(32);
  const token_hash = await hashUiOperatorAuthToken(raw);
  const expires_at = new Date(Date.now() + ttl).toISOString();

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("ui_operator_auth_tokens")
      .insert({
        user_id: input.user_id,
        session_id: input.session_id,
        token_hash,
        status: "active",
        allowed_routes: allowed,
        expires_at,
        metadata: (input.metadata ?? {}) as never,
      })
      .select("id, expires_at, allowed_routes")
      .maybeSingle();
    if (error || !data) {
      return {
        ok: false,
        token: null,
        token_id: null,
        expires_at: null,
        allowed_routes: allowed,
        error: error?.message ?? "db_error",
      };
    }
    return {
      ok: true,
      token: raw,
      token_id: (data as { id: string }).id,
      expires_at: (data as { expires_at: string }).expires_at,
      allowed_routes: allowed,
      error: null,
    };
  } catch (e) {
    return {
      ok: false,
      token: null,
      token_id: null,
      expires_at: null,
      allowed_routes: allowed,
      error: e instanceof Error ? e.message : "unknown",
    };
  }
}

export async function validateUiOperatorAuthToken(
  rawToken: string,
): Promise<ValidatedUiOperatorAuthToken> {
  if (!rawToken || typeof rawToken !== "string" || rawToken.length < 16) {
    return {
      ok: false, status: "invalid", reason: "malformed_token",
      token_id: null, user_id: null, session_id: null,
      allowed_routes: [], expires_at: null,
    };
  }
  const token_hash = await hashUiOperatorAuthToken(rawToken);
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("ui_operator_auth_tokens")
      .select("id, user_id, session_id, status, allowed_routes, expires_at, used_at")
      .eq("token_hash", token_hash)
      .maybeSingle();
    if (error) {
      return {
        ok: false, status: "invalid", reason: "db_error",
        token_id: null, user_id: null, session_id: null,
        allowed_routes: [], expires_at: null,
      };
    }
    if (!data) {
      return {
        ok: false, status: "not_found", reason: "token_not_found",
        token_id: null, user_id: null, session_id: null,
        allowed_routes: [], expires_at: null,
      };
    }
    const row = data as {
      id: string; user_id: string; session_id: string;
      status: UiOperatorAuthTokenStatus;
      allowed_routes: unknown; expires_at: string; used_at: string | null;
    };
    const allowed_routes = sanitizeAllowedRoutes(row.allowed_routes);
    const expired = new Date(row.expires_at).getTime() < Date.now();
    if (row.status !== "active") {
      return {
        ok: false, status: row.status, reason: `token_${row.status}`,
        token_id: row.id, user_id: row.user_id, session_id: row.session_id,
        allowed_routes, expires_at: row.expires_at,
      };
    }
    if (expired) {
      // mark expired best-effort
      await supabaseAdmin
        .from("ui_operator_auth_tokens")
        .update({ status: "expired" })
        .eq("id", row.id);
      return {
        ok: false, status: "expired", reason: "token_expired",
        token_id: row.id, user_id: row.user_id, session_id: row.session_id,
        allowed_routes, expires_at: row.expires_at,
      };
    }
    return {
      ok: true, status: "active", reason: null,
      token_id: row.id, user_id: row.user_id, session_id: row.session_id,
      allowed_routes, expires_at: row.expires_at,
    };
  } catch (e) {
    return {
      ok: false, status: "invalid",
      reason: e instanceof Error ? e.message : "unknown",
      token_id: null, user_id: null, session_id: null,
      allowed_routes: [], expires_at: null,
    };
  }
}

export async function consumeUiOperatorAuthToken(
  rawToken: string,
): Promise<ValidatedUiOperatorAuthToken> {
  const v = await validateUiOperatorAuthToken(rawToken);
  if (!v.ok || !v.token_id) return v;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("ui_operator_auth_tokens")
      .update({ status: "used", used_at: new Date().toISOString() })
      .eq("id", v.token_id)
      .eq("status", "active");
    if (error) {
      return { ...v, ok: false, status: "invalid", reason: "consume_failed" };
    }
    return v;
  } catch (e) {
    return {
      ...v, ok: false, status: "invalid",
      reason: e instanceof Error ? e.message : "consume_unknown",
    };
  }
}

export function isRouteAuthorizedByToken(
  route: string,
  allowed_routes: string[],
): boolean {
  if (!isRouteAllowedForUiOperator(route)) return false;
  if (!allowed_routes || allowed_routes.length === 0) return false;
  return allowed_routes.some(
    (r) => route === r || route.startsWith(r + "/") || route.startsWith(r + "?"),
  );
}

// ---------- Base URL resolution (v3.23.4) ----------

const FORBIDDEN_BASE_HOST_PATTERNS = [
  /(^|\.)lovable\.dev$/i, // editor host, never the app
];

const FORBIDDEN_BASE_PATH_PATTERNS = [
  /^\/projects(\/|$)/i, // editor path, never the app
];

export function normalizeBrainHubBaseUrl(raw?: string | null): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase();
  if (!host) return null;
  if (FORBIDDEN_BASE_HOST_PATTERNS.some((re) => re.test(host))) return null;
  const path = parsed.pathname.replace(/\/+$/, "");
  if (path && FORBIDDEN_BASE_PATH_PATTERNS.some((re) => re.test(path))) return null;
  return `${parsed.protocol}//${parsed.host}`;
}

export function isValidBrainHubBaseUrl(url: string | null | undefined): boolean {
  return normalizeBrainHubBaseUrl(url ?? null) !== null;
}

export interface BrainHubBaseUrlResolution {
  url: string | null;
  source:
    | "env_BRAIN_HUB_BASE_URL"
    | "env_PUBLIC_SITE_URL"
    | "env_SITE_URL"
    | "fallback_published"
    | "invalid";
  raw: string | null;
  valid: boolean;
}

const FALLBACK_PUBLISHED_BASE = "https://thought-loom-dashboard.lovable.app";

export function resolveBrainHubBaseUrl(): BrainHubBaseUrlResolution {
  const candidates: Array<{
    raw: string | null;
    source: BrainHubBaseUrlResolution["source"];
  }> = [
    { raw: process.env.BRAIN_HUB_BASE_URL ?? null, source: "env_BRAIN_HUB_BASE_URL" },
    { raw: process.env.PUBLIC_SITE_URL ?? null, source: "env_PUBLIC_SITE_URL" },
    { raw: process.env.SITE_URL ?? null, source: "env_SITE_URL" },
    { raw: FALLBACK_PUBLISHED_BASE, source: "fallback_published" },
  ];
  for (const c of candidates) {
    const norm = normalizeBrainHubBaseUrl(c.raw);
    if (norm) return { url: norm, source: c.source, raw: c.raw, valid: true };
  }
  return { url: null, source: "invalid", raw: null, valid: false };
}

/** Returns a guaranteed-safe absolute origin or throws "base_url_invalid". */
export function getBrainHubBaseUrl(): string {
  const res = resolveBrainHubBaseUrl();
  if (!res.url) throw new Error("base_url_invalid");
  return res.url;
}

export interface BuildUiOperatorAuthUrlResult {
  ok: boolean;
  url: string | null;
  base_url: string | null;
  route: string;
  preview: string | null;
  error:
    | "base_url_invalid"
    | "missing_token"
    | "missing_session"
    | "missing_route"
    | null;
}

export function buildUiOperatorAuthUrlSafe(input: {
  baseUrl: string | null;
  token: string;
  session_id: string;
  route: string;
}): BuildUiOperatorAuthUrlResult {
  const base = normalizeBrainHubBaseUrl(input.baseUrl);
  if (!base) {
    return {
      ok: false, url: null, base_url: null,
      route: input.route ?? "", preview: null, error: "base_url_invalid",
    };
  }
  if (!input.token) {
    return { ok: false, url: null, base_url: base, route: input.route ?? "", preview: null, error: "missing_token" };
  }
  if (!input.session_id) {
    return { ok: false, url: null, base_url: base, route: input.route ?? "", preview: null, error: "missing_session" };
  }
  if (!input.route) {
    return { ok: false, url: null, base_url: base, route: "", preview: null, error: "missing_route" };
  }
  const qs = new URLSearchParams({
    token: input.token,
    session_id: input.session_id,
    route: input.route,
  });
  const url = `${base}/api/public/ui-operator-auth?${qs.toString()}`;
  const previewQs = new URLSearchParams({
    token: `${safeTokenPrefix(input.token)}…`,
    session_id: input.session_id,
    route: input.route,
  });
  const preview = `${base}/api/public/ui-operator-auth?${previewQs.toString()}`;
  if (!/^https?:\/\//i.test(url) || /lovable\.dev\/projects\//i.test(url)) {
    return { ok: false, url: null, base_url: base, route: input.route, preview: null, error: "base_url_invalid" };
  }
  return { ok: true, url, base_url: base, route: input.route, preview, error: null };
}

/** Backward-compatible string variant (throws on invalid). */
export function buildUiOperatorAuthUrl(input: {
  baseUrl: string;
  token: string;
  session_id: string;
  route: string;
}): string {
  const res = buildUiOperatorAuthUrlSafe(input);
  if (!res.ok || !res.url) throw new Error(res.error ?? "build_failed");
  return res.url;
}

