// ============================================================
// Brain Hub v3.8 — Gmail OAuth (server-only helpers)
// ============================================================
// READ-ONLY: scope strict to gmail.readonly. No send / modify /
// compose / delete / label changes. Tokens NEVER logged or returned
// to the client. Refresh tokens not persisted in this version.
// ============================================================

export const GMAIL_OAUTH_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";

const FORBIDDEN_SCOPES = [
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.insert",
  "https://www.googleapis.com/auth/gmail.labels",
];

export function hasForbiddenGmailScope(scopes: string[]): boolean {
  return scopes.some((s) => FORBIDDEN_SCOPES.includes(s));
}

export type GmailOauthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function getGmailOauthConfig(): GmailOauthConfig | null {
  const clientId =
    process.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret =
    process.env.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri =
    process.env.GMAIL_OAUTH_REDIRECT_URL ??
    process.env.GOOGLE_OAUTH_REDIRECT_URL ??
    process.env.GOOGLE_OAUTH_REDIRECT_URI ??
    null;
  if (!clientId || !clientSecret || !redirectUri) return null;
  // Force the Gmail callback path even if reusing the shared Google redirect.
  try {
    const u = new URL(redirectUri);
    u.pathname = "/api/public/gmail-oauth/callback";
    return { clientId, clientSecret, redirectUri: u.toString() };
  } catch {
    return { clientId, clientSecret, redirectUri };
  }
}

export function buildGmailAuthUrl(state: string): string | null {
  const cfg = getGmailOauthConfig();
  if (!cfg) return null;
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: GMAIL_OAUTH_SCOPE,
    access_type: "online",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export type GmailTokenResponse = {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
};

function sanitizeGoogleError(text: string): string {
  return text
    .replace(/"access_token"\s*:\s*"[^"]+"/g, '"access_token":"***"')
    .replace(/"refresh_token"\s*:\s*"[^"]+"/g, '"refresh_token":"***"')
    .replace(/"id_token"\s*:\s*"[^"]+"/g, '"id_token":"***"')
    .slice(0, 500);
}

export async function exchangeGmailCodeForTokens(
  code: string,
): Promise<GmailTokenResponse> {
  const cfg = getGmailOauthConfig();
  if (!cfg) throw new Error("Gmail OAuth non configurato");
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `Token exchange Gmail fallito (${res.status}): ${sanitizeGoogleError(txt)}`,
    );
  }
  const json = (await res.json()) as GmailTokenResponse;
  if (!json.access_token)
    throw new Error("Risposta OAuth Gmail senza access_token");
  return json;
}

// ---------------- Gmail API helpers ----------------

export type GmailProfile = {
  emailAddress: string;
  messagesTotal?: number;
  threadsTotal?: number;
};

export async function fetchGmailProfile(
  accessToken: string,
): Promise<GmailProfile> {
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `Gmail profile errore (${res.status}): ${sanitizeGoogleError(txt)}`,
    );
  }
  return (await res.json()) as GmailProfile;
}

export type GmailMessageHeader = { name: string; value: string };
export type GmailMessagePart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailMessageHeader[];
  body?: { size?: number; data?: string };
  parts?: GmailMessagePart[];
};
export type GmailMessageFull = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
};

export async function listGmailMessageIds(
  accessToken: string,
  opts: { maxResults?: number; query?: string } = {},
): Promise<string[]> {
  const params = new URLSearchParams({
    maxResults: String(Math.min(Math.max(opts.maxResults ?? 20, 1), 100)),
  });
  if (opts.query && opts.query.trim().length > 0) {
    params.set("q", opts.query.trim().slice(0, 500));
  }
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `Gmail list errore (${res.status}): ${sanitizeGoogleError(txt)}`,
    );
  }
  const json = (await res.json()) as {
    messages?: Array<{ id: string; threadId: string }>;
  };
  return (json.messages ?? []).map((m) => m.id);
}

export async function getGmailMessageFull(
  accessToken: string,
  messageId: string,
): Promise<GmailMessageFull> {
  // metadata + body text only, no attachments
  const params = new URLSearchParams({ format: "full" });
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
      messageId,
    )}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `Gmail get errore (${res.status}): ${sanitizeGoogleError(txt)}`,
    );
  }
  return (await res.json()) as GmailMessageFull;
}

// ---------------- Parsing helpers ----------------

export function getHeader(
  headers: GmailMessageHeader[] | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  const lower = name.toLowerCase();
  const h = headers.find((x) => x.name.toLowerCase() === lower);
  return h?.value ?? null;
}

export function parseAddressList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => {
      const m = s.match(/<([^>]+)>/);
      return (m ? m[1] : s).trim();
    })
    .filter((s) => s.length > 0 && s.length < 320)
    .slice(0, 20);
}

export function parseFrom(raw: string | null): {
  email: string | null;
  name: string | null;
} {
  if (!raw) return { email: null, name: null };
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) {
    return { name: m[1].trim() || null, email: m[2].trim() };
  }
  return { email: raw.trim(), name: null };
}

function base64UrlDecode(data: string): string {
  try {
    const norm = data.replace(/-/g, "+").replace(/_/g, "/");
    const pad = norm.length % 4 === 0 ? norm : norm + "===".slice(norm.length % 4 - 1);
    if (typeof atob === "function") return atob(pad);
    return Buffer.from(pad, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function redactSensitive(text: string): string {
  return text
    .replace(/\b(?:password|api[_-]?key|token|secret)\s*[:=]\s*\S+/gi, "$& [REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]{20,}/g, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[JWT_REDACTED]");
}

export type GmailBodyExtract = {
  bodyPreview: string;
  hasAttachments: boolean;
};

export function extractBodyPreview(
  payload: GmailMessagePart | undefined,
): GmailBodyExtract {
  if (!payload) return { bodyPreview: "", hasAttachments: false };
  let bestText: string | null = null;
  let bestHtml: string | null = null;
  let hasAttachments = false;
  const walk = (p: GmailMessagePart) => {
    const mt = (p.mimeType ?? "").toLowerCase();
    const filename = p.filename ?? "";
    if (filename && filename.length > 0 && !mt.startsWith("text/")) {
      hasAttachments = true;
    }
    if (mt === "text/plain" && p.body?.data && !bestText) {
      bestText = base64UrlDecode(p.body.data);
    } else if (mt === "text/html" && p.body?.data && !bestHtml) {
      bestHtml = base64UrlDecode(p.body.data);
    }
    if (p.parts) p.parts.forEach(walk);
  };
  walk(payload);
  const raw = bestText ?? (bestHtml ? stripHtml(bestHtml) : "");
  const cleaned = redactSensitive(raw).slice(0, 1500);
  return { bodyPreview: cleaned, hasAttachments };
}
