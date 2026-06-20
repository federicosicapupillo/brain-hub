// Express bootstrap for the external UI Operator Runner.
// Verifies bearer + HMAC on every request before reaching handlers.

import express from "express";
import {
  handleExecute,
  handleHealth,
  handleObserve,
  handleOpenRoute,
  handlePropose,
  handleStart,
  handleStop,
} from "./routes.js";
import { verifyRequestAuth } from "./security.js";

const app = express();
const PORT = Number(process.env.PORT ?? 8787);
const SECRET = process.env.UI_OPERATOR_RUNNER_SECRET ?? "";

if (!SECRET) {
  // Don't crash — let /health respond, but every signed endpoint will 401.
  console.warn("[ui-operator-runner] UI_OPERATOR_RUNNER_SECRET not set.");
}

// Capture raw body for HMAC verification.
app.use(
  express.json({
    limit: "256kb",
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody: string }).rawBody = buf.toString("utf8");
    },
  }),
);

app.get("/health", handleHealth);

app.use((req, res, next) => {
  const raw = (req as unknown as { rawBody?: string }).rawBody ?? "";
  const result = verifyRequestAuth(req, raw, SECRET);
  if (!result.ok) {
    res.status(401).json({
      ok: false,
      status: "unauthorized",
      error_code: result.reason,
      safe_message: "Richiesta non autorizzata.",
      data: null,
    });
    return;
  }
  next();
});

app.post("/session/start", handleStart);
app.post("/session/open-route", handleOpenRoute);
app.post("/session/observe", handleObserve);
app.post("/action/propose", handlePropose);
app.post("/action/execute", handleExecute);
app.post("/session/stop", handleStop);

app.listen(PORT, () => {
  console.log(`[ui-operator-runner] listening on :${PORT}`);
});
