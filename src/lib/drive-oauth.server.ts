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

// ============================================================
// v2.8.2 — Paginated metadata-only sync
// ============================================================
// Strict safety limit. NOT user-configurable from the frontend.
export const MAX_DRIVE_METADATA_FILES = 1000;
// Hard cap on pagination loops to prevent infinite cycles even if Drive
// keeps returning a nextPageToken with empty pages.
const MAX_DRIVE_PAGE_LOOPS = 20;

export type DriveSyncMetadataResult = {
  files: DriveApiFile[];
  totalFetched: number;
  reachedLimit: boolean;
  nextPageToken: string | null;
  warnings: string[];
};

export async function syncAllDriveFilesMetadata(
  accessToken: string,
  opts: { maxFiles?: number; pageSize?: number } = {},
): Promise<DriveSyncMetadataResult> {
  const maxFiles = Math.min(
    Math.max(opts.maxFiles ?? MAX_DRIVE_METADATA_FILES, 1),
    MAX_DRIVE_METADATA_FILES,
  );
  const pageSize = Math.min(Math.max(opts.pageSize ?? 200, 1), 200);
  const collected: DriveApiFile[] = [];
  const warnings: string[] = [];
  let pageToken: string | null = null;
  let nextPageToken: string | null = null;
  let reachedLimit = false;

  for (let loop = 0; loop < MAX_DRIVE_PAGE_LOOPS; loop++) {
    const remaining = maxFiles - collected.length;
    if (remaining <= 0) {
      reachedLimit = true;
      break;
    }
    const page = await listDriveFilesMetadata(accessToken, {
      pageSize: Math.min(pageSize, remaining),
      pageToken: pageToken ?? undefined,
    });
    if (page.files.length > 0) {
      const take = page.files.slice(0, remaining);
      collected.push(...take);
      if (take.length < page.files.length) {
        reachedLimit = true;
      }
    }
    if (!page.nextPageToken) {
      nextPageToken = null;
      break;
    }
    if (collected.length >= maxFiles) {
      reachedLimit = true;
      nextPageToken = page.nextPageToken;
      break;
    }
    pageToken = page.nextPageToken;
    nextPageToken = page.nextPageToken;
    if (loop === MAX_DRIVE_PAGE_LOOPS - 1) {
      warnings.push(
        "Loop pagination raggiunto: ulteriori file potrebbero non essere stati mappati.",
      );
    }
  }

  if (reachedLimit) {
    warnings.push(
      `Sincronizzati i primi ${collected.length} file. Per Drive molto grandi servirà una sync avanzata.`,
    );
  }

  return {
    files: collected,
    totalFetched: collected.length,
    reachedLimit,
    nextPageToken,
    warnings,
  };
}

// ============================================================
// Simple path reconstruction from a single response batch.
// We only use parent ids already present in `files`. No extra Drive calls.
// Falls back to the file name when no parent chain can be resolved.
// ============================================================
export function buildDrivePathMap(files: DriveApiFile[]): Map<string, string> {
  const nameById = new Map<string, string>();
  for (const f of files) {
    nameById.set(f.id, f.name);
  }
  const out = new Map<string, string>();
  for (const f of files) {
    const segments: string[] = [];
    let cur: DriveApiFile | undefined = f;
    const seen = new Set<string>();
    let depth = 0;
    while (cur && depth < 16) {
      if (seen.has(cur.id)) break;
      seen.add(cur.id);
      segments.unshift(cur.name);
      const parentId: string | null =
        cur.parents && cur.parents.length > 0 ? cur.parents[0] : null;
      if (!parentId) break;
      const parentName = nameById.get(parentId);
      if (!parentName) {
        // Parent not in batch — cannot resolve further without extra Drive calls.
        segments.unshift("…");
        break;
      }
      cur = files.find((x) => x.id === parentId);
      depth += 1;
    }
    out.set(f.id, segments.length > 0 ? segments.join("/") : f.name);
  }
  return out;
}
