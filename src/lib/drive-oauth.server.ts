// ============================================================
// Brain Hub v2.8.1 — Google Drive OAuth (server-only helpers)
// ============================================================
// Strict read-only metadata scope. No file content is ever fetched.
// No access/refresh tokens are persisted: re-sync = re-OAuth.
// ============================================================

export const DRIVE_OAUTH_SCOPE =
  "https://www.googleapis.com/auth/drive.metadata.readonly";

export type GoogleOauthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function getGoogleOauthConfig(): GoogleOauthConfig | null {
  const clientId =
    process.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret =
    process.env.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URL ??
    process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function buildGoogleAuthUrl(state: string): string | null {
  const cfg = getGoogleOauthConfig();
  if (!cfg) return null;
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: DRIVE_OAUTH_SCOPE,
    access_type: "online",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
};

function sanitizeGoogleError(text: string): string {
  // Never echo tokens or codes back to the client.
  return text
    .replace(/"access_token"\s*:\s*"[^"]+"/g, '"access_token":"***"')
    .replace(/"refresh_token"\s*:\s*"[^"]+"/g, '"refresh_token":"***"')
    .replace(/"id_token"\s*:\s*"[^"]+"/g, '"id_token":"***"')
    .slice(0, 500);
}

export async function exchangeCodeForTokens(
  code: string,
): Promise<GoogleTokenResponse> {
  const cfg = getGoogleOauthConfig();
  if (!cfg) throw new Error("Google OAuth non configurato");
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
    throw new Error(`Token exchange fallito (${res.status}): ${sanitizeGoogleError(txt)}`);
  }
  const json = (await res.json()) as GoogleTokenResponse;
  if (!json.access_token) throw new Error("Risposta OAuth senza access_token");
  return json;
}

export type DriveApiFile = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  iconLink?: string;
  size?: string;
  modifiedTime?: string;
  parents?: string[];
};

export async function listDriveFilesMetadata(
  accessToken: string,
  opts: { pageSize?: number; pageToken?: string } = {},
): Promise<{ files: DriveApiFile[]; nextPageToken: string | null }> {
  const params = new URLSearchParams({
    pageSize: String(Math.min(Math.max(opts.pageSize ?? 100, 1), 200)),
    fields:
      "nextPageToken,files(id,name,mimeType,webViewLink,iconLink,size,modifiedTime,parents)",
    orderBy: "modifiedTime desc",
  });
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `Drive API errore (${res.status}): ${sanitizeGoogleError(txt)}`,
    );
  }
  const json = (await res.json()) as {
    files?: DriveApiFile[];
    nextPageToken?: string;
  };
  return {
    files: json.files ?? [],
    nextPageToken: json.nextPageToken ?? null,
  };
}
