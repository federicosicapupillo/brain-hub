// Brain Hub v3.23.2 — UI Operator proxy fallback (public).
// Renders a minimal controlled page for the remote runner browser AFTER a
// successful auth handshake. Shows only non-sensitive info about the session
// and the target route. Never lists PII or user data.

import { createFileRoute, useParams, useSearch } from "@tanstack/react-router";
import { ALLOWED_UI_ROUTES, isRouteAllowedForUiOperator } from "@/lib/ui-operator-safety";

export const Route = createFileRoute("/ui-operator-proxy/$sessionId")({
  validateSearch: (s: Record<string, unknown>) => ({
    route: typeof s.route === "string" ? s.route : "",
    tp: typeof s.tp === "string" ? s.tp : "",
  }),
  head: () => ({
    meta: [
      { title: "UI Operator Proxy — Brain Hub" },
      { name: "robots", content: "noindex,nofollow" },
      {
        name: "description",
        content:
          "Proxy controllato per il runner UI Operator. Mostra solo informazioni minime sulla route consentita; nessun dato sensibile.",
      },
    ],
  }),
  component: UiOperatorProxyPage,
  errorComponent: () => (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>UI Operator Proxy</h1>
      <p>Errore nel render della pagina proxy.</p>
    </div>
  ),
  notFoundComponent: () => (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>UI Operator Proxy</h1>
      <p>Sessione non trovata.</p>
    </div>
  ),
});

function UiOperatorProxyPage() {
  const { sessionId } = useParams({ from: "/ui-operator-proxy/$sessionId" });
  const { route, tp } = useSearch({ from: "/ui-operator-proxy/$sessionId" });
  const allowed = isRouteAllowedForUiOperator(route);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 720 }}>
      <h1 style={{ fontSize: "1.2rem", margin: 0 }}>Brain Hub · UI Operator Proxy</h1>
      <p style={{ color: "#555", marginTop: 8 }}>
        Pagina pubblica controllata, generata per il runner UI Operator dopo l'handshake.
        Non contiene dati sensibili. Nessun login automatico viene eseguito.
      </p>

      <section style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <div>
          <strong>Sessione:</strong> <code>{sessionId}</code>
        </div>
        <div>
          <strong>Route richiesta:</strong> <code>{route || "—"}</code>{" "}
          {allowed ? (
            <span style={{ color: "#0a7" }}>(allowlisted)</span>
          ) : (
            <span style={{ color: "#a00" }}>(non consentita)</span>
          )}
        </div>
        <div>
          <strong>Token prefix:</strong> <code>{tp || "—"}</code>
        </div>
        <div>
          <strong>Handshake:</strong>{" "}
          <span style={{ color: "#0a7" }}>verificato e consumato</span>
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: "1rem" }}>Route consentite</h2>
        <ul>
          {ALLOWED_UI_ROUTES.map((r) => (
            <li key={r}>
              <code>{r}</code>
            </li>
          ))}
        </ul>
      </section>

      <p style={{ color: "#777", fontSize: 12, marginTop: 24 }}>
        POC v3.23.2. La sessione utente reale non viene replicata nel browser remoto: nessun
        cookie, nessuna password, nessun OAuth completato lato runner.
      </p>
    </main>
  );
}
