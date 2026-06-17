// ============================================================
// Brain Hub v3.0 — Google Calendar OAuth (server-only helpers)
// ============================================================
// READ-ONLY. Never creates, edits, deletes or invites.
// No access/refresh tokens are persisted: re-sync = re-OAuth.
// Scope chosen: calendar.readonly — needed to list calendars
// (calendar names + colors) and read events from each.
// `calendar.events.readonly` would only give events on the primary
// calendar; we want multi-calendar coverage in read mode.
// ============================================================

export const CALENDAR_OAUTH_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";

export type GoogleCalendarOauthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function getGoogleCalendarOauthConfig(): GoogleCalendarOauthConfig | null {
  const clientId =
    process.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret =
    process.env.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  // Calendar-specific redirect preferred; fall back to the generic Google one.
  const redirectUri =
    process.env.GOOGLE_CALENDAR_OAUTH_REDIRECT_URL ??
    process.env.GOOGLE_OAUTH_REDIRECT_URL ??
    process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function buildGoogleCalendarAuthUrl(state: string): string | null {
  const cfg = getGoogleCalendarOauthConfig();
  if (!cfg) return null;
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: CALENDAR_OAUTH_SCOPE,
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
  return text
    .replace(/"access_token"\s*:\s*"[^"]+"/g, '"access_token":"***"')
    .replace(/"refresh_token"\s*:\s*"[^"]+"/g, '"refresh_token":"***"')
    .replace(/"id_token"\s*:\s*"[^"]+"/g, '"id_token":"***"')
    .slice(0, 500);
}

export async function exchangeCalendarCodeForTokens(
  code: string,
): Promise<GoogleTokenResponse> {
  const cfg = getGoogleCalendarOauthConfig();
  if (!cfg) throw new Error("Google Calendar OAuth non configurato");
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
      `Token exchange fallito (${res.status}): ${sanitizeGoogleError(txt)}`,
    );
  }
  const json = (await res.json()) as GoogleTokenResponse;
  if (!json.access_token) throw new Error("Risposta OAuth senza access_token");
  return json;
}

// ============================================================
// Read-only Calendar API helpers
// ============================================================

export type CalendarListEntry = {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
  accessRole?: string;
};

export async function listUserCalendarsReadOnly(
  accessToken: string,
): Promise<CalendarListEntry[]> {
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?fields=items(id,summary,primary,backgroundColor,accessRole)",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `Calendar list errore (${res.status}): ${sanitizeGoogleError(txt)}`,
    );
  }
  const json = (await res.json()) as { items?: CalendarListEntry[] };
  return json.items ?? [];
}

export type CalendarApiEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  eventType?: string;
  attendees?: { email?: string }[];
};

export const MAX_CALENDAR_EVENTS_PER_CAL = 200;
const MAX_CALENDAR_PAGE_LOOPS = 5;

export type CalendarEventsBatch = {
  calendarId: string;
  calendarName: string;
  events: CalendarApiEvent[];
  warnings: string[];
};

// READ ONLY: only GET requests, no insert/patch/delete.
export async function listCalendarEventsReadOnly(
  accessToken: string,
  calendarId: string,
  opts: { timeMinIso?: string; maxResults?: number } = {},
): Promise<{ events: CalendarApiEvent[]; warnings: string[] }> {
  const timeMin = opts.timeMinIso ?? new Date().toISOString();
  const perPage = Math.min(Math.max(opts.maxResults ?? 200, 1), 250);
  const collected: CalendarApiEvent[] = [];
  const warnings: string[] = [];
  let pageToken: string | null = null;

  for (let loop = 0; loop < MAX_CALENDAR_PAGE_LOOPS; loop++) {
    const params = new URLSearchParams({
      timeMin,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(perPage),
      fields:
        "nextPageToken,items(id,status,summary,description,location,htmlLink,hangoutLink,start,end,eventType,attendees(email))",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        calendarId,
      )}/events?${params.toString()}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      warnings.push(
        `Errore lettura eventi calendario ${calendarId}: ${res.status} ${sanitizeGoogleError(
          txt,
        ).slice(0, 120)}`,
      );
      break;
    }
    const json = (await res.json()) as {
      items?: CalendarApiEvent[];
      nextPageToken?: string;
    };
    if (json.items) collected.push(...json.items);
    if (!json.nextPageToken || collected.length >= MAX_CALENDAR_EVENTS_PER_CAL) {
      if (json.nextPageToken && collected.length >= MAX_CALENDAR_EVENTS_PER_CAL) {
        warnings.push(
          `Calendario ${calendarId}: limite ${MAX_CALENDAR_EVENTS_PER_CAL} eventi raggiunto.`,
        );
      }
      break;
    }
    pageToken = json.nextPageToken;
    if (loop === MAX_CALENDAR_PAGE_LOOPS - 1) {
      warnings.push(`Calendario ${calendarId}: loop pagination raggiunto.`);
    }
  }
  return { events: collected, warnings };
}

export function startDateOfEvent(e: CalendarApiEvent): string | null {
  return e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : null);
}
export function endDateOfEvent(e: CalendarApiEvent): string | null {
  return e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00Z` : null);
}

export function sanitizeEventText(input: string | null | undefined, max = 400): string | null {
  if (!input) return null;
  return input.replace(/\s+/g, " ").trim().slice(0, max);
}
