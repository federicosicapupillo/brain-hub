// Security helpers for the external UI Operator Runner.
// Verifies bearer + HMAC, enforces allowlisted routes, blocks forbidden domains.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

export const ALLOWED_ROUTES: ReadonlyArray<string> = [
  "/gmail-connector",
  "/gmail-intelligence",
  "/operating-dashboard",
  "/action-queue",
  "/project-console",
  "/master-snapshot",
  "/loop-qa",
  "/tool-connections",
  "/ui-operator-lab",
];

export const FORBIDDEN_DOMAINS: ReadonlyArray<string> = [
  "accounts.google.com",
  "myaccount.google.com",
  "login.live.com",
  "login.microsoftonline.com",
  "appleid.apple.com",
  "github.com/login",
  "checkout.stripe.com",
  "paypal.com",
  "facebook.com/login",
];

export function isAllowedRoute(route: string): boolean {
  if (typeof route !== "string" || !route.startsWith("/")) return false;
  return ALLOWED_ROUTES.some((r) => route === r || route.startsWith(`${r}/`) || route.startsWith(`${r}?`));
}

export function isAllowedAbsoluteUrl(url: string, brainHubBaseUrl: string): boolean {
  try {
    const u = new URL(url);
    const base = new URL(brainHubBaseUrl);
    if (u.origin !== base.origin) return false;
    if (FORBIDDEN_DOMAINS.some((d) => u.host.includes(d))) return false;
    return isAllowedRoute(u.pathname);
  } catch {
    return false;
  }
}

export function verifyRequestAuth(
  req: Request,
  rawBody: string,
  secret: string,
): { ok: true } | { ok: false; reason: string } {
  const auth = req.header("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (auth.length !== expected.length) return { ok: false, reason: "bad_bearer" };
  const a = Buffer.from(auth);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_bearer" };
  }
  if (req.method === "GET") return { ok: true };
  const sig = req.header("x-brainhub-signature") ?? "";
  const expectedSig = createHmac("sha256", secret).update(rawBody).digest("hex");
  const sa = Buffer.from(sig);
  const sb = Buffer.from(expectedSig);
  if (sa.length !== sb.length || !timingSafeEqual(sa, sb)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true };
}

export function sanitizeError(message: unknown): string {
  const s = typeof message === "string" ? message : String((message as Error)?.message ?? message);
  // Strip tokens / keys / secrets if they ever leak into messages
  return s
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "[redacted]")
    .replace(/bb_[A-Za-z0-9_-]{10,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9_.\-]+/gi, "Bearer [redacted]")
    .slice(0, 300);
}
