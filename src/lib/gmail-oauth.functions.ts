// ============================================================
// Brain Hub v3.8 — Gmail OAuth (client-callable server fns)
// ============================================================
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type GmailOauthStatus = {
  configured: boolean;
  redirectUri: string | null;
  scope: string;
};

export const getGmailOauthStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<GmailOauthStatus> => {
    const { getGmailOauthConfig, GMAIL_OAUTH_SCOPE } = await import(
      "@/lib/gmail-oauth.server"
    );
    const cfg = getGmailOauthConfig();
    return {
      configured: !!cfg,
      redirectUri: cfg?.redirectUri ?? null,
      scope: GMAIL_OAUTH_SCOPE,
    };
  });

export type StartGmailOAuthInput = {
  brain_id?: string | null;
  redirect_path?: string | null;
};

export type StartGmailOAuthResult =
  | { ok: true; authUrl: string }
  | { ok: false; reason: string };

export const startGmailOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: StartGmailOAuthInput) => ({
    brain_id:
      data && typeof data.brain_id === "string" && data.brain_id
        ? data.brain_id
        : null,
    redirect_path:
      data &&
      typeof data.redirect_path === "string" &&
      data.redirect_path.startsWith("/")
        ? data.redirect_path
        : null,
  }))
  .handler(async ({ data, context }): Promise<StartGmailOAuthResult> => {
    const { supabase, userId } = context;
    const { getGmailOauthConfig, buildGmailAuthUrl, GMAIL_OAUTH_SCOPE } =
      await import("@/lib/gmail-oauth.server");
    const cfg = getGmailOauthConfig();
    if (!cfg) {
      return {
        ok: false,
        reason:
          "Gmail OAuth non configurato. Verifica GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e redirect URI Google.",
      };
    }

    // Upsert a connection in 'not_connected' state for this user/brain
    let existingQ = supabase
      .from("gmail_connection_settings")
      .select("id")
      .eq("user_id", userId);
    existingQ = data.brain_id
      ? existingQ.eq("brain_id", data.brain_id)
      : existingQ.is("brain_id", null);
    const { data: existing } = await existingQ.maybeSingle();
    let connectionId: string | null =
      (existing as { id: string } | null)?.id ?? null;
    if (!connectionId) {
      const { data: ins, error: insErr } = await supabase
        .from("gmail_connection_settings")
        .insert({
          user_id: userId,
          brain_id: data.brain_id,
          status: "not_connected",
          scopes: [GMAIL_OAUTH_SCOPE],
        } as never)
        .select("id")
        .single();
      if (insErr) return { ok: false, reason: "Impossibile creare connessione Gmail" };
      connectionId = (ins as { id: string }).id;
    }

    const stateToken = crypto.randomUUID() + "." + crypto.randomUUID();
    const { error: stErr } = await supabase
      .from("gmail_oauth_states")
      .insert({
        user_id: userId,
        brain_id: data.brain_id,
        connection_id: connectionId,
        state_token: stateToken,
        redirect_path: data.redirect_path,
      } as never);
    if (stErr) return { ok: false, reason: "Impossibile creare state OAuth Gmail" };

    const authUrl = buildGmailAuthUrl(stateToken);
    if (!authUrl) return { ok: false, reason: "Configurazione OAuth Gmail incompleta" };
    return { ok: true, authUrl };
  });

export type DisconnectGmailInput = { connectionId: string };
export type DisconnectGmailResult = { ok: boolean; reason?: string };

export const disconnectGmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: DisconnectGmailInput) => {
    if (!data?.connectionId || typeof data.connectionId !== "string") {
      throw new Error("connectionId richiesto");
    }
    return { connectionId: data.connectionId };
  })
  .handler(async ({ data, context }): Promise<DisconnectGmailResult> => {
    const { supabase, userId } = context;
    const { data: conn } = await supabase
      .from("gmail_connection_settings")
      .select("id,user_id")
      .eq("id", data.connectionId)
      .maybeSingle();
    if (!conn) return { ok: false, reason: "Connessione non trovata" };
    if ((conn as { user_id: string }).user_id !== userId) {
      return { ok: false, reason: "Connessione non autorizzata" };
    }
    const { error } = await supabase
      .from("gmail_connection_settings")
      .update({
        status: "disconnected",
        disconnected_at: new Date().toISOString(),
      } as never)
      .eq("id", data.connectionId);
    if (error) return { ok: false, reason: "Impossibile disconnettere" };
    return { ok: true };
  });

// ---------------- Sync (manual, OAuth-bound) ----------------
// Sync funziona solo subito dopo OAuth: il callback fa una sync iniziale.
// Una sync manuale successiva richiede un nuovo OAuth (no refresh token persistito).
// Esponiamo comunque la fn per riavviare il flusso.

export type SyncGmailInput = {
  brain_id?: string | null;
  max_results?: number;
  query?: string | null;
};

export type SyncGmailResult =
  | { ok: false; reason: string; requires_reauth?: boolean }
  | { ok: true; requires_reauth: true; authUrl: string };

export const syncGmailMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: SyncGmailInput) => ({
    brain_id:
      data && typeof data.brain_id === "string" && data.brain_id
        ? data.brain_id
        : null,
    max_results:
      typeof data?.max_results === "number"
        ? Math.min(Math.max(data.max_results, 1), 50)
        : 20,
    query:
      typeof data?.query === "string" && data.query.trim().length > 0
        ? data.query.trim().slice(0, 500)
        : null,
  }))
  .handler(async ({ data, context }): Promise<SyncGmailResult> => {
    const { supabase, userId } = context;
    const { getGmailOauthConfig, buildGmailAuthUrl, GMAIL_OAUTH_SCOPE } =
      await import("@/lib/gmail-oauth.server");
    const cfg = getGmailOauthConfig();
    if (!cfg) {
      return {
        ok: false,
        reason: "Gmail OAuth non configurato.",
      };
    }
    // Locate or create connection
    let existingQ = supabase
      .from("gmail_connection_settings")
      .select("id")
      .eq("user_id", userId);
    existingQ = data.brain_id
      ? existingQ.eq("brain_id", data.brain_id)
      : existingQ.is("brain_id", null);
    const { data: existing } = await existingQ.maybeSingle();
    let connectionId =
      (existing as { id: string } | null)?.id ?? null;
    if (!connectionId) {
      const { data: ins } = await supabase
        .from("gmail_connection_settings")
        .insert({
          user_id: userId,
          brain_id: data.brain_id,
          status: "not_connected",
          scopes: [GMAIL_OAUTH_SCOPE],
        } as never)
        .select("id")
        .single();
      connectionId = (ins as { id: string }).id;
    }

    const stateToken = crypto.randomUUID() + "." + crypto.randomUUID();
    await supabase.from("gmail_oauth_states").insert({
      user_id: userId,
      brain_id: data.brain_id,
      connection_id: connectionId,
      state_token: stateToken,
      redirect_path: "/gmail-connector",
      metadata: { sync_max: data.max_results, sync_query: data.query },
    } as never);
    const authUrl = buildGmailAuthUrl(stateToken);
    if (!authUrl) return { ok: false, reason: "Configurazione OAuth incompleta" };
    return { ok: true, requires_reauth: true, authUrl };
  });

export type CreateGmailActionInput = { message_map_id: string };
export type CreateGmailActionResult =
  | { ok: true; action_id: string }
  | { ok: false; reason: string };

export const createGmailActionFromMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: CreateGmailActionInput) => {
    if (!data?.message_map_id) throw new Error("message_map_id richiesto");
    return { message_map_id: data.message_map_id };
  })
  .handler(
    async ({ data, context }): Promise<CreateGmailActionResult> => {
      const { supabase, userId } = context;
      const { data: row } = await supabase
        .from("gmail_message_map")
        .select("*")
        .eq("id", data.message_map_id)
        .maybeSingle();
      if (!row) return { ok: false, reason: "Email non trovata" };
      const r = row as {
        id: string;
        user_id: string;
        brain_id: string | null;
        from_email: string | null;
        from_name: string | null;
        subject: string | null;
        snippet: string | null;
        detected_category: string | null;
        detected_priority: string | null;
        gmail_message_id: string;
        gmail_thread_id: string | null;
      };
      if (r.user_id !== userId)
        return { ok: false, reason: "Non autorizzato" };

      const category = r.detected_category ?? "general";
      const actionType: "email_review" | "email_followup" | "email_reply_draft_internal" =
        category === "urgent" || category === "finance" || category === "lead"
          ? "email_followup"
          : category === "reply_needed" || category === "meeting"
            ? "email_reply_draft_internal"
            : "email_review";
      const risk = actionType === "email_review" ? "low" : "medium";
      const requires_confirmation = risk !== "low";
      const status = requires_confirmation ? "pending_approval" : "suggested";

      const subject = (r.subject ?? "(nessun oggetto)").slice(0, 140);
      const fromLabel = r.from_name
        ? `${r.from_name} <${r.from_email ?? ""}>`
        : (r.from_email ?? "mittente sconosciuto");

      const { data: ins, error } = await supabase
        .from("automation_actions")
        .insert({
          user_id: userId,
          source: "user_manual",
          action_type: actionType,
          title: `Email: ${subject}`,
          description:
            `Da: ${fromLabel}\nCategoria: ${category} · Priorità: ${r.detected_priority ?? "low"}\n` +
            `Snippet: ${(r.snippet ?? "").slice(0, 280)}`,
          priority: r.detected_priority ?? "medium",
          risk_level: risk,
          status,
          requires_confirmation,
          brain_id: r.brain_id,
          metadata: {
            source_label: "gmail_connector",
            gmail_message_map_id: r.id,
            gmail_message_id: r.gmail_message_id,
            gmail_thread_id: r.gmail_thread_id,
            from_email: r.from_email,
            subject: r.subject,
            detected_category: r.detected_category,
            detected_priority: r.detected_priority,
          },
        } as never)
        .select("id")
        .single();
      if (error) return { ok: false, reason: error.message };
      const actionId = (ins as { id: string }).id;

      await supabase
        .from("gmail_message_map")
        .update({
          linked_action_id: actionId,
          suggested_action_type: actionType,
        } as never)
        .eq("id", r.id);

      return { ok: true, action_id: actionId };
    },
  );
