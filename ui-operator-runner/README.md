# Brain Hub UI Operator Runner

External Node service that runs **Stagehand + Browserbase** for Brain Hub's
Jack UI Operator. It is intentionally **outside** the Brain Hub Worker bundle
because `@browserbasehq/stagehand` is Node-only.

```
Brain Hub server functions
  → signed HTTP request (Bearer + HMAC SHA-256)
  → this runner
  → Stagehand + Browserbase
  → real browser session
  → sanitized result
  → Brain Hub DB/log
```

## Deploy targets

- Railway
- Render
- Fly.io
- VPS (systemd/Docker)
- Any private Node host reachable from Brain Hub

Do **not** deploy this inside Lovable / the Brain Hub project.

## Environment variables

| Name | Purpose |
| --- | --- |
| `UI_OPERATOR_RUNNER_SECRET` | Shared secret with Brain Hub. Used for `Authorization: Bearer` and `X-BrainHub-Signature` HMAC-SHA256 of the raw body. |
| `BROWSERBASE_API_KEY` | Browserbase API key. |
| `BROWSERBASE_PROJECT_ID` | Browserbase project id. |
| `OPENAI_API_KEY` | Used by Stagehand for natural-language DOM steering. |
| `STAGEHAND_MODEL` | Optional, defaults to `gpt-4o-mini`. |
| `BRAIN_HUB_BASE_URL` | Base URL of the Brain Hub app the runner is allowed to open (e.g. `https://thought-loom-dashboard.lovable.app`). |
| `PORT` | HTTP port. |

Copy `.env.example` to `.env` and fill it in.

## Endpoints

All POST endpoints (except `/health`) require:

- `Authorization: Bearer <UI_OPERATOR_RUNNER_SECRET>`
- `X-BrainHub-Signature: <hex HMAC-SHA256 of raw body>`

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`  | `/health` | Liveness + capability check. |
| `POST` | `/session/start` | Create a Browserbase session, open `BRAIN_HUB_BASE_URL + initial_route`. |
| `POST` | `/session/open-route` | Navigate to another allowlisted route. |
| `POST` | `/session/observe` | Run Stagehand `page.observe()` and return a sanitized summary. |
| `POST` | `/action/propose` | Ask Stagehand for the next sensible action toward a goal. |
| `POST` | `/action/execute` | Execute a previously confirmed action (Brain Hub gates confirmation). |
| `POST` | `/session/stop` | Close the Browserbase session. |

## Security rules enforced inside the runner

- Reject any request without a valid bearer token AND matching HMAC signature.
- Only navigate to URLs that start with `BRAIN_HUB_BASE_URL` + an allowlisted route prefix.
- Block known forbidden domains (Google/Apple/Microsoft login, payment hosts, etc.).
- Never accept arbitrary URLs from the model.
- Hard per-session timeout and max actions per session.
- Never echo bearer/HMAC/Browserbase keys in responses or logs.
- Screenshots are not returned raw; only sanitized text summaries.

## Local dev

```
cp .env.example .env
npm install
npm run dev
```
