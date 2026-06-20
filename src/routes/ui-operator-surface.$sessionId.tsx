// Brain Hub v3.23.3 — UI Operator Controlled Surface (public page).
// Renders only minimal, sanitized state for the runner browser. Does NOT
// require Supabase session in the browser. All data fetched via public,
// session-scoped endpoints. No user PII beyond what the surface needs.

import { createFileRoute, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";

type SurfaceState = {
  surface: string;
  connection_status: string;
  last_sync_at: string | null;
  sync_status: string | null;
  last_sync_error_code: string | null;
  last_sync_error_safe: string | null;
  auto_sync_enabled: boolean;
  today_count: number | null;
  warning: string | null;
  available_actions: Array<{
    key: string;
    title: string;
    risk: string;
    requires_confirmation: boolean;
  }>;
};

type ActionResponse = {
  ok: boolean;
  status: string;
  action_key?: string;
  confirmation_action_id?: string | null;
  result?: Record<string, unknown> | null;
  message?: string;
};

export const Route = createFileRoute("/ui-operator-surface/$sessionId")({
  validateSearch: (s: Record<string, unknown>) => ({
    surface: typeof s.surface === "string" ? s.surface : "gmail_connector",
    tp: typeof s.tp === "string" ? s.tp : "",
  }),
  head: () => ({
    meta: [
      { title: "UI Operator Controlled Surface — Brain Hub" },
      { name: "robots", content: "noindex,nofollow" },
      {
        name: "description",
        content:
          "Superficie controllata UI Operator: mostra solo azioni allowlisted e dati minimi sanitizzati per il runner remoto.",
      },
    ],
  }),
  component: UiOperatorSurfacePage,
});

function UiOperatorSurfacePage() {
  const { sessionId } = useParams({ from: "/ui-operator-surface/$sessionId" });
  const { surface, tp } = useSearch({ from: "/ui-operator-surface/$sessionId" });
  const [state, setState] = useState<SurfaceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<ActionResponse | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/public/ui-operator-surface-state?session_id=${encodeURIComponent(
          sessionId,
        )}&surface=${encodeURIComponent(surface)}`,
        { headers: { accept: "application/json" } },
      );
      const json = (await res.json()) as { ok: boolean; state?: SurfaceState; reason?: string };
      if (!json.ok || !json.state) {
        setError(json.reason ?? `HTTP ${res.status}`);
        setState(null);
      } else {
        setState(json.state);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch_error");
    } finally {
      setLoading(false);
    }
  }, [sessionId, surface]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  async function runAction(action_key: string, confirmation_action_id?: string) {
    setActionBusy(action_key);
    try {
      const res = await fetch("/api/public/ui-operator-surface-action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          action_key,
          confirmation_action_id: confirmation_action_id ?? null,
        }),
      });
      const json = (await res.json()) as ActionResponse;
      setLastAction(json);
      // refresh state after any action
      fetchState();
    } catch (e) {
      setLastAction({
        ok: false,
        status: "client_error",
        message: e instanceof Error ? e.message : "fetch_error",
      });
    } finally {
      setActionBusy(null);
    }
  }

  const baseStyle: React.CSSProperties = {
    padding: 24,
    fontFamily: "system-ui",
    maxWidth: 760,
    color: "#111",
  };

  return (
    <main style={baseStyle}>
      <h1 style={{ fontSize: "1.2rem", margin: 0 }}>
        Brain Hub · {labelFor(surface)} Operator Surface
      </h1>
      <p style={{ color: "#555", marginTop: 8 }}>
        Superficie controllata generata per il runner UI Operator. Mostra solo
        stato minimo e azioni allowlisted. Nessun token, nessun cookie utente,
        nessun corpo email.
      </p>

      <section style={cardStyle}>
        <div><strong>Sessione:</strong> <code>{sessionId}</code></div>
        <div><strong>Surface:</strong> <code>{surface}</code></div>
        <div><strong>Token prefix:</strong> <code>{tp || "—"}</code></div>
      </section>

      {loading ? (
        <p>Caricamento stato…</p>
      ) : error ? (
        <section style={{ ...cardStyle, borderColor: "#a00" }}>
          <strong style={{ color: "#a00" }}>Errore:</strong> {error}
        </section>
      ) : state ? (
        <>
          <section style={cardStyle}>
            <h2 style={h2Style}>Stato Gmail</h2>
            <div>Connessione: <code>{state.connection_status}</code></div>
            <div>Ultima sync: <code>{state.last_sync_at ?? "—"}</code></div>
            <div>Sync status: <code>{state.sync_status ?? "—"}</code></div>
            <div>Auto-sync abilitato: <code>{state.auto_sync_enabled ? "sì" : "no"}</code></div>
            <div>Mail oggi: <code>{state.today_count ?? "—"}</code></div>
            {state.last_sync_error_safe ? (
              <div style={{ color: "#a60" }}>
                {state.last_sync_error_safe}
              </div>
            ) : null}
            {state.warning ? (
              <div style={{ color: "#a00", marginTop: 8 }}>
                ⚠ {state.warning}
              </div>
            ) : null}
          </section>

          <section style={cardStyle}>
            <h2 style={h2Style}>Azioni disponibili</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {state.available_actions.map((a) => (
                <button
                  key={a.key}
                  onClick={() => runAction(a.key)}
                  disabled={actionBusy === a.key}
                  style={btnStyle(a.risk)}
                >
                  {a.title}{" "}
                  <span style={{ fontSize: 11, color: "#666" }}>
                    ({a.risk}
                    {a.requires_confirmation ? " · conferma richiesta" : ""})
                  </span>
                </button>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {lastAction ? (
        <section style={cardStyle}>
          <h2 style={h2Style}>Ultimo risultato</h2>
          <div>Status: <code>{lastAction.status}</code></div>
          {lastAction.message ? <div>{lastAction.message}</div> : null}
          {lastAction.confirmation_action_id ? (
            <div style={{ marginTop: 8 }}>
              <div>
                Confirmation action id:{" "}
                <code>{lastAction.confirmation_action_id}</code>
              </div>
              <div style={{ fontSize: 12, color: "#666" }}>
                Conferma in Brain Hub (UI Operator Lab) e poi riprova qui.
              </div>
              {lastAction.action_key ? (
                <button
                  style={{ ...btnStyle("medium"), marginTop: 6 }}
                  onClick={() =>
                    runAction(
                      lastAction.action_key as string,
                      lastAction.confirmation_action_id as string,
                    )
                  }
                >
                  Riprova con conferma
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <p style={{ fontSize: 12, color: "#777", marginTop: 24 }}>
        POC v3.23.3 · Controlled Surface · read-mostly · azioni allowlisted.
      </p>
    </main>
  );
}

const cardStyle: React.CSSProperties = {
  marginTop: 16,
  padding: 12,
  border: "1px solid #ddd",
  borderRadius: 8,
};
const h2Style: React.CSSProperties = { fontSize: "1rem", margin: "0 0 8px 0" };
function btnStyle(risk: string): React.CSSProperties {
  const color =
    risk === "high" ? "#a00" : risk === "medium" ? "#a60" : "#0a7";
  return {
    padding: "8px 12px",
    borderRadius: 6,
    border: `1px solid ${color}`,
    background: "white",
    color,
    cursor: "pointer",
    textAlign: "left",
  };
}
function labelFor(surface: string): string {
  if (surface === "gmail_connector") return "Gmail Connector";
  return surface;
}
