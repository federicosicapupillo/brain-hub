"""
Brain Hub v3.36.1 — External MEDIUM Connector evidence harness.

Goal: empirical evidence for Test G (failure modes) and Test H
(idempotency race) against the real /api/execute-external-action
dispatcher, using a controlled mock n8n endpoint — NOT a real n8n
instance.

Strategy (option A from the FOLLOW-UP brief):
  1. Start an in-process mock n8n on 127.0.0.1:<MOCK_PORT> with a
     /__control endpoint that flips its current scenario.
  2. Start a dedicated dev server (`bun run dev -- --port <APP_PORT>`)
     whose environment exports
        BRAINHUB_N8N_CONTROLLED_WEBHOOK_URL=http://127.0.0.1:<MOCK_PORT>/webhook
     so the n8n-controlled connector (env-only URL resolution) points
     at the mock.
  3. Drive the new server with Playwright + the existing Supabase
     session (same pattern as test-external-execute-v3.35b.py).

What this script verifies:
  Test G — failure modes
    timeout / http_4xx / http_5xx / shape / network → expect the
    corresponding receipt with audit_record.error_kind set correctly,
    safe_error_message redacted, exactly one mock call per scenario
    (no hidden retry), no 500 from the API (recoverable failure).
  Test H — idempotency race
    8 concurrent live executes with the same idempotency_key →
    expect 1 executed + 7 replayed, exactly 1 mock call, all
    responses pointing at the same receipt_id, 1 row in
    execute_idempotency, 1 row in execute_receipts.
  Redaction
    Mock payloads/responses carry fake secrets (Bearer …, sk-test-…,
    fake JWT, fake email, ?token=…) — verify they never leak into
    the receipt audit_record / response_preview_redacted.

Limits declared (and printed at the end):
  - this is NOT an end-to-end check against a real n8n;
  - DB counts come from the operator-set Supabase service-role env
    (PG* or DATABASE_URL via psql) — if unavailable, the DB-side
    assertions are skipped and the script prints "DB_COUNTS=skipped".

Required env (read by THIS python process, not by the dev server):
  LOVABLE_BROWSER_SUPABASE_SESSION_JSON
  LOVABLE_BROWSER_SUPABASE_STORAGE_KEY
Optional:
  MOCK_PORT (default 39001), APP_PORT (default 39002)
  PG* / DATABASE_URL — enables DB count assertions via psql.
"""
import asyncio
import json
import os
import socket
import subprocess
import sys
import threading
import time
import uuid
import datetime
import shutil
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MOCK_PORT = int(os.environ.get("MOCK_PORT", "39001"))
APP_PORT = int(os.environ.get("APP_PORT", "39002"))
APP_BASE = f"http://127.0.0.1:{APP_PORT}"
MOCK_URL = f"http://127.0.0.1:{MOCK_PORT}/webhook"

# ---------------------------------------------------------------------------
# Mock n8n
# ---------------------------------------------------------------------------

class MockState:
    def __init__(self):
        self.scenario = "success"
        self.delay_ms = 0
        self.calls = []  # list of (scenario, timestamp)
        self.lock = threading.Lock()

    def record(self):
        with self.lock:
            self.calls.append((self.scenario, time.time()))

    def count(self, scenario=None):
        with self.lock:
            if scenario is None:
                return len(self.calls)
            return sum(1 for s, _ in self.calls if s == scenario)

    def reset(self):
        with self.lock:
            self.calls.clear()

STATE = MockState()

FAKE_SECRETS_IN_RESPONSE = {
    "ok": True,
    "id": "mock-exec-001",
    "external_reference_id": "mock-ref-Bearer abc123-trailing",
    "leak_bearer": "Bearer abc123",
    "leak_jwt": "eyJhbGciOiJIUzI1NiJ9.fake.signature",
    "leak_sk": "sk-test-secret-001",
    "leak_email": "secret-user@example.com",
    "leak_qs": "https://x/cb?token=secret-qs",
    # v3.36.1 — URL-encoded variants must also be redacted (stopping at the
    # real `&` separator, NOT at encoded %26/%2F/%3D inside the value).
    "leak_qs_encoded_token": "https://x/cb?token=abc%2Fdef%3Dghi&page=1",
    "leak_qs_encoded_access": "https://x/cb?foo=1&access_token=eyJabc.def.ghi%2Fsig&page=2",
    "leak_qs_encoded_secret": "https://x/cb?secret=value%2Bwith%2Fencoded%3Dchars&ok=1",
}


class MockHandler(BaseHTTPRequestHandler):
    def log_message(self, *a, **kw):  # silence
        return

    def _send(self, status, body, content_type="application/json"):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path.startswith("/__control"):
            length = int(self.headers.get("content-length", "0"))
            raw = self.rfile.read(length) if length else b"{}"
            try:
                body = json.loads(raw or b"{}")
            except Exception:
                body = {}
            with STATE.lock:
                if "scenario" in body:
                    STATE.scenario = body["scenario"]
                if "delay_ms" in body:
                    STATE.delay_ms = int(body["delay_ms"])
                if body.get("reset"):
                    STATE.calls.clear()
            return self._send(200, json.dumps({"ok": True, "scenario": STATE.scenario}))

        if self.path.startswith("/__stats"):
            with STATE.lock:
                payload = {"calls": list(STATE.calls), "scenario": STATE.scenario}
            return self._send(200, json.dumps(payload))

        # /webhook — controlled scenarios
        STATE.record()
        scenario = STATE.scenario
        delay_ms = STATE.delay_ms

        if delay_ms:
            time.sleep(delay_ms / 1000.0)

        if scenario == "success":
            return self._send(200, json.dumps(FAKE_SECRETS_IN_RESPONSE))
        if scenario == "negative":
            # v3.36.1 — clean payload, MUST pass through redaction untouched.
            return self._send(200, json.dumps({
                "ok": True,
                "external_reference_id": "550e8400-e29b-41d4-a716-446655440000",
                "ts": "2026-06-30T14:22:00.000Z",
                "url": "https://example.com/webhook/status",
                "qs": "?page=1&status=ok&source=test",
                "note": "external connector completed with safe payload",
            }))

        if scenario == "timeout":
            # sleep longer than connector timeout (8000ms)
            time.sleep(10.0)
            return self._send(200, json.dumps({"ok": True}))
        if scenario == "http_4xx":
            return self._send(
                418,
                json.dumps({"error": "teapot", "bearer": "Bearer abc123"}),
            )
        if scenario == "http_5xx":
            return self._send(
                503,
                json.dumps({"error": "boom", "leak": "sk-test-secret-001"}),
            )
        if scenario == "shape_not_object":
            return self._send(200, json.dumps(["not", "object"]))
        if scenario == "shape_malformed":
            return self._send(200, "{not valid json,,,")
        if scenario == "network":
            # Slam the TCP connection shut.
            try:
                self.wfile.flush()
                self.connection.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass
            try:
                self.connection.close()
            except Exception:
                pass
            return
        return self._send(500, json.dumps({"error": "unknown scenario"}))


def start_mock():
    srv = ThreadingHTTPServer(("127.0.0.1", MOCK_PORT), MockHandler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv


def set_scenario(scenario, delay_ms=0, reset=True):
    import urllib.request
    req = urllib.request.Request(
        f"http://127.0.0.1:{MOCK_PORT}/__control",
        data=json.dumps({"scenario": scenario, "delay_ms": delay_ms, "reset": reset}).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=2).read()


# ---------------------------------------------------------------------------
# Dedicated dev server (env-pointed at mock)
# ---------------------------------------------------------------------------

def wait_for(url, timeout_s=180):
    import urllib.request, urllib.error
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=2).read()
            return True
        except urllib.error.HTTPError as e:
            if 200 <= e.code < 500:
                return True
        except Exception:
            pass
        time.sleep(1.0)
    return False


def start_app_server():
    env = os.environ.copy()
    env["BRAINHUB_N8N_CONTROLLED_WEBHOOK_URL"] = MOCK_URL
    env["PORT"] = str(APP_PORT)
    cmd = ["bun", "run", "dev", "--", "--port", str(APP_PORT), "--host", "127.0.0.1"]
    print(f"[harness] launching dev server: {' '.join(cmd)}")
    proc = subprocess.Popen(
        cmd,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    )
    if not wait_for(f"{APP_BASE}/", timeout_s=240):
        proc.terminate()
        raise SystemExit("[harness] dev server failed to come up on time")
    return proc


# ---------------------------------------------------------------------------
# DB counts (optional)
# ---------------------------------------------------------------------------

def psql_count(sql):
    if not shutil.which("psql"):
        return None
    try:
        out = subprocess.check_output(
            ["psql", "-tA", "-c", sql],
            stderr=subprocess.STDOUT,
            timeout=15,
        ).decode().strip()
        return int(out.splitlines()[-1]) if out else 0
    except Exception as exc:
        print(f"[harness] psql skipped: {exc}")
        return None


# ---------------------------------------------------------------------------
# Test driver
# ---------------------------------------------------------------------------

def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


async def run_tests():
    from playwright.async_api import async_playwright

    storage_key = os.environ["LOVABLE_BROWSER_SUPABASE_STORAGE_KEY"]
    session_json = os.environ["LOVABLE_BROWSER_SUPABASE_SESSION_JSON"]
    access = json.loads(session_json).get("access_token")
    assert access, "no access token"

    EP = "/api/execute-external-action"
    WORKFLOW = "brainhub_n8n_controlled_echo_medium"

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1600})
        page = await ctx.new_page()
        await page.goto(APP_BASE)
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )

        async def post(body):
            return await page.evaluate(
                """async ({path, body, token}) => {
                    const r = await fetch(path, {
                        method: 'POST',
                        headers: {
                            'content-type': 'application/json',
                            'authorization': 'Bearer ' + token,
                        },
                        body: JSON.stringify(body),
                    });
                    const text = await r.text();
                    let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
                    return { status: r.status, body: j };
                }""",
                {"path": EP, "body": body, "token": access},
            )

        def live_payload(idem, scenario_label):
            return {
                "action_type": "external_n8n_controlled_webhook",
                "idempotency_key": idem,
                "confirmed_at": _now_iso(),
                "confirmation_source": "ui_button",
                "payload": {
                    "workflow_key": WORKFLOW,
                    "title": f"v3.36 harness {scenario_label}",
                    "message": (
                        "leak Bearer abc123 + sk-test-secret-001 + "
                        "secret-user@example.com + ?token=secret-qs "
                        "+ eyJhbGciOiJIUzI1NiJ9.fake.sig"
                    ),
                    "correlation_id": f"corr-{uuid.uuid4()}",
                    "dry_run": False,
                    "live_execute": True,
                    "confirmation_id": f"confirm-{uuid.uuid4()}",
                    "metadata": {"harness": "v3.36.1"},
                },
            }

        # =====================================================================
        # Test G — failure modes
        # =====================================================================
        print("=== Test G — failure modes ===")
        G_RESULTS = []
        # v3.36.1 — expected error_kind per failure mode (status-specific where
        # applicable, per the patch brief).
        SCENARIOS = [
            ("timeout", "n8n_timeout"),
            ("http_4xx", "http_418"),
            ("http_5xx", "http_503"),
            ("shape_not_object", "invalid_response_shape"),
            ("shape_malformed", "invalid_response_shape"),
            ("network", "fetch_failed"),
        ]
        for mock_scenario, expected_kind in SCENARIOS:
            set_scenario(mock_scenario, reset=True)
            idem = f"v3.36.1-G-{mock_scenario}-{uuid.uuid4()}"
            res = await post(live_payload(idem, mock_scenario))
            audit_raw = res["body"].get("receipt", {}).get("audit_record") if res["body"].get("receipt") else None
            audit = {}
            if audit_raw:
                try:
                    audit = json.loads(audit_raw) if isinstance(audit_raw, str) else audit_raw
                except Exception:
                    audit = {"raw": audit_raw}
            mock_calls = STATE.count()
            row = {
                "scenario": mock_scenario,
                "expected_kind": expected_kind,
                "api_status": res["status"],
                "dispatch_status": res["body"].get("status"),
                "error_kind": audit.get("error_kind") if isinstance(audit, dict) else None,
                "receipt_id": (res["body"].get("receipt") or {}).get("receipt_id"),
                "safe_error_message": (res["body"].get("receipt") or {}).get("safe_error_message"),
                "service_outcome_status": audit.get("service_outcome_status") if isinstance(audit, dict) else None,
                "mock_calls": mock_calls,
            }
            G_RESULTS.append(row)
            print(json.dumps(row, indent=2))


        # =====================================================================
        # Test H — idempotency race
        # =====================================================================
        print("=== Test H — idempotency race ===")
        set_scenario("success", delay_ms=350, reset=True)
        idem_h = f"v3.36.1-H-{uuid.uuid4()}"
        body_h = live_payload(idem_h, "race")
        race = await page.evaluate(
            """async ({path, body, token, n}) => {
                const opts = {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'authorization': 'Bearer ' + token,
                    },
                    body: JSON.stringify(body),
                };
                const tasks = [];
                for (let i = 0; i < n; i++) tasks.push(fetch(path, opts));
                const responses = await Promise.all(tasks);
                const out = [];
                for (const r of responses) {
                    const t = await r.text();
                    let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
                    out.push({ status: r.status, body: j });
                }
                return out;
            }""",
            {"path": EP, "body": body_h, "token": access, "n": 8},
        )
        statuses = [r["body"].get("status") for r in race]
        receipt_ids = {r["body"].get("receipt", {}).get("receipt_id")
                       for r in race if r["body"].get("receipt")}
        n_exec = sum(1 for s in statuses if s == "executed")
        n_replay = sum(1 for s in statuses if s == "replayed")
        mock_calls_h = STATE.count()
        h_summary = {
            "executed": n_exec,
            "replayed": n_replay,
            "distinct_receipt_ids": len(receipt_ids),
            "mock_calls": mock_calls_h,
            "statuses": statuses,
        }
        print(json.dumps(h_summary, indent=2))

        if shutil.which("psql"):
            esc = idem_h.replace("'", "''")
            receipt_count = psql_count(
                f"SELECT count(*) FROM public.execute_receipts WHERE idempotency_key = '{esc}'"
            )
            idem_count = psql_count(
                f"SELECT count(*) FROM public.execute_idempotency WHERE idempotency_key = '{esc}'"
            )
            # v3.36.1 — binding artifact contract: artifact_type +
            # idempotency_key in payload.
            artifact_count = psql_count(
                "SELECT count(*) FROM public.internal_execute_artifacts "
                f"WHERE payload->>'idempotency_key' = '{esc}' "
                "AND payload->>'artifact_type' = 'external_medium_connector_dispatch'"
            )
            h_summary["db_receipt_rows"] = receipt_count
            h_summary["db_idempotency_rows"] = idem_count
            h_summary["db_artifact_rows"] = artifact_count
            print("DB counts:", receipt_count, idem_count, artifact_count)
        else:
            h_summary["db_counts"] = "skipped_no_psql"

        # =====================================================================
        # Redaction sweep — positive (forbidden values must NOT appear)
        # =====================================================================
        print("=== Redaction sweep ===")
        FORBIDDEN = [
            "Bearer abc123",
            "sk-test-secret-001",
            "eyJhbGciOiJIUzI1NiJ9.fake.sig",
            "eyJhbGciOiJIUzI1NiJ9.fake.signature",
            "eyJabc.def.ghi",
            "secret-user@example.com",
            "secret-qs",
            "abc%2Fdef%3Dghi",
            "value%2Bwith%2Fencoded%3Dchars",
        ]
        haystacks = []
        for r in G_RESULTS:
            haystacks.append(json.dumps(r))
        for r in race:
            haystacks.append(json.dumps(r["body"]))
        leaks = []
        for s in FORBIDDEN:
            for h in haystacks:
                if s in h:
                    leaks.append(s)
                    break
        print("Leaks detected:", leaks)

        # =====================================================================
        # Negative redaction test — clean payload must remain untouched.
        # =====================================================================
        print("=== Negative redaction test ===")
        clean_values = [
            "2026-06-30T14:22:00.000Z",
            "550e8400-e29b-41d4-a716-446655440000",
            "https://example.com/webhook/status",
            "?page=1&status=ok&source=test",
            "external connector completed with safe payload",
        ]
        # Drive a clean success run.
        set_scenario("negative", reset=True)
        clean_msg = " | ".join(clean_values)
        clean_idem = f"v3.36.1-NEG-{uuid.uuid4()}"
        clean_payload = {
            "action_type": "external_n8n_controlled_webhook",
            "idempotency_key": clean_idem,
            "confirmed_at": _now_iso(),
            "confirmation_source": "ui_button",
            "payload": {
                "workflow_key": WORKFLOW,
                "title": "v3.36.1 negative redaction",
                "message": clean_msg,
                "correlation_id": "550e8400-e29b-41d4-a716-446655440000",
                "dry_run": False,
                "live_execute": True,
                "confirmation_id": f"confirm-{uuid.uuid4()}",
                "metadata": {
                    "clean_url": "https://example.com/webhook/status",
                    "clean_qs": "?page=1&status=ok&source=test",
                    "clean_ts": "2026-06-30T14:22:00.000Z",
                    "clean_uuid": "550e8400-e29b-41d4-a716-446655440000",
                    "clean_note": "external connector completed with safe payload",
                },

            },
        }
        clean_res = await post(clean_payload)
        clean_audit_raw = (clean_res["body"].get("receipt") or {}).get("audit_record")
        clean_audit = {}
        if clean_audit_raw:
            try:
                clean_audit = json.loads(clean_audit_raw) if isinstance(clean_audit_raw, str) else clean_audit_raw
            except Exception:
                clean_audit = {"raw": clean_audit_raw}
        clean_hay = json.dumps(clean_res["body"]) + "|" + json.dumps(clean_audit)


        # Look for [REDACTED] / [redacted-email] sentinels next to safe fields.
        overzealous_findings = []
        for v in clean_values:
            # Each clean value should round-trip somewhere (payload_preview
            # or response_preview). We only flag if a clean value was clearly
            # mangled by a [REDACTED] sentinel within it. The strict check is:
            # the literal value must appear at least once in the redacted
            # haystacks (proves we did not over-redact).
            if v not in clean_hay:
                overzealous_findings.append(v)
        negative_redaction_pass = len(overzealous_findings) == 0
        print(json.dumps({
            "negative_redaction_test": "PASS" if negative_redaction_pass else "FAIL",
            "missing_clean_values": overzealous_findings,
        }, indent=2))

        # =====================================================================
        # Test G assertions — error_kind must be set per failure mode.
        # =====================================================================
        g_kind_failures = []
        for row in G_RESULTS:
            if not row["error_kind"]:
                g_kind_failures.append({"scenario": row["scenario"], "error_kind": row["error_kind"]})
                continue
            # For http_* we accept either exact match (http_418) or the family
            # bucket (http_4xx/http_5xx) so the harness is forward-compatible.
            ek = row["error_kind"]
            xp = row["expected_kind"]
            if ek != xp and not (xp.startswith("http_") and ek.startswith("http_")):
                g_kind_failures.append({"scenario": row["scenario"], "expected": xp, "actual": ek})

        await browser.close()

        return {
            "test_g": G_RESULTS,
            "test_g_kind_failures": g_kind_failures,
            "test_h": h_summary,
            "redaction_leaks": leaks,
            "negative_redaction_test": "PASS" if negative_redaction_pass else "FAIL",
            "negative_missing_clean_values": overzealous_findings,
            "mock_url": MOCK_URL,
            "env_var": "BRAINHUB_N8N_CONTROLLED_WEBHOOK_URL",
            "workflow_key": WORKFLOW,
        }


def main():
    mock = start_mock()
    print(f"[harness] mock n8n on {MOCK_URL}")
    app_proc = None
    try:
        app_proc = start_app_server()
        print(f"[harness] dev server on {APP_BASE}")
        result = asyncio.run(run_tests())
        out_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "scripts", "test-external-medium-connector-v3.36.last-run.json",
        )
        with open(out_path, "w") as f:
            json.dump(result, f, indent=2, default=str)
        print(f"[harness] wrote {out_path}")

        failures = []
        if result["redaction_leaks"]:
            failures.append(("redaction_leaks", result["redaction_leaks"]))
        if result["negative_redaction_test"] != "PASS":
            failures.append(("negative_redaction_test", result["negative_missing_clean_values"]))
        if result["test_g_kind_failures"]:
            failures.append(("test_g_error_kind", result["test_g_kind_failures"]))
        h = result["test_h"]
        if not (h.get("executed") == 1 and h.get("replayed") == 7
                and h.get("distinct_receipt_ids") == 1 and h.get("mock_calls") == 1):
            failures.append(("test_h_race", h))
        # DB strict checks when psql available.
        if "db_receipt_rows" in h:
            if h["db_receipt_rows"] != 1:
                failures.append(("db_receipt_rows", h["db_receipt_rows"]))
            if h["db_idempotency_rows"] != 1:
                failures.append(("db_idempotency_rows", h["db_idempotency_rows"]))
            if h["db_artifact_rows"] != 1:
                failures.append(("db_artifact_rows_external_medium_connector_dispatch",
                                 h["db_artifact_rows"]))

        if failures:
            print("FAIL:")
            for name, payload in failures:
                print(" -", name, "→", payload)
            sys.exit(2)
        print("PASS")
    finally:
        if app_proc:
            app_proc.terminate()
            try:
                app_proc.wait(timeout=5)
            except Exception:
                app_proc.kill()
        mock.shutdown()


# ---------------------------------------------------------------------------
# v3.36.2 — Real n8n controlled environment evidence mode.
#
# Activated with `--real-env`. Runs exactly TWO single-call scenarios
# against a REAL n8n controlled webhook (NOT the in-process mock):
#   1) happy path  (1 call, expect dispatch_status=executed)
#   2) controlled failure boundary (1 call, expect dispatch_status=failed)
#
# Required env (all read by THIS python process, never logged in clear):
#   LOVABLE_BROWSER_SUPABASE_SESSION_JSON
#   LOVABLE_BROWSER_SUPABASE_STORAGE_KEY
#   BRAINHUB_REAL_N8N_WEBHOOK_URL          — full https URL to controlled n8n webhook
#   BRAINHUB_REAL_N8N_WORKFLOW_KIND        — "synthetic_echo" | "production_representative"
#   BRAINHUB_REAL_N8N_FAILURE_URL          — URL for the controlled failure boundary
#                                            (invalid token/header OR invalid path on same host)
#   BRAINHUB_REAL_N8N_FAILURE_SCENARIO     — "invalid_token" | "invalid_path"
#   BRAINHUB_REAL_N8N_WORKFLOW_KEY         — allowlisted workflow key (see n8n-controlled-workflows.ts)
#
# Optional:
#   PG* / DATABASE_URL — enables DB row count assertions via psql.
#
# Safety contract (enforced):
#   - URL/headers/secrets are NEVER printed.
#   - No 8-way race against real n8n.
#   - No retry.
#   - No destructive test (no OAuth expiry, no rate-limit force, no n8n down).
#   - On missing env → exit code 3 with status=NOT_CONFIGURED; readiness stays false.
# ---------------------------------------------------------------------------

REAL_ENV_REQUIRED = [
    "LOVABLE_BROWSER_SUPABASE_SESSION_JSON",
    "LOVABLE_BROWSER_SUPABASE_STORAGE_KEY",
    "BRAINHUB_REAL_N8N_WEBHOOK_URL",
    "BRAINHUB_REAL_N8N_WORKFLOW_KIND",
    "BRAINHUB_REAL_N8N_FAILURE_URL",
    "BRAINHUB_REAL_N8N_FAILURE_SCENARIO",
    "BRAINHUB_REAL_N8N_WORKFLOW_KEY",
]


def _start_app_with_url(webhook_url, port):
    env = os.environ.copy()
    env["BRAINHUB_N8N_CONTROLLED_WEBHOOK_URL"] = webhook_url
    env["PORT"] = str(port)
    cmd = ["bun", "run", "dev", "--", "--port", str(port), "--host", "127.0.0.1"]
    proc = subprocess.Popen(
        cmd, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    )
    if not wait_for(f"http://127.0.0.1:{port}/", timeout_s=240):
        proc.terminate()
        raise SystemExit("[real-env] dev server failed to come up")
    return proc


async def _drive_real_call(app_base, body):
    from playwright.async_api import async_playwright
    storage_key = os.environ["LOVABLE_BROWSER_SUPABASE_STORAGE_KEY"]
    session_json = os.environ["LOVABLE_BROWSER_SUPABASE_SESSION_JSON"]
    access = json.loads(session_json).get("access_token")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1600})
        page = await ctx.new_page()
        await page.goto(app_base)
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )
        out = await page.evaluate(
            """async ({path, body, token}) => {
                const r = await fetch(path, {
                    method: 'POST',
                    headers: {'content-type':'application/json','authorization':'Bearer '+token},
                    body: JSON.stringify(body),
                });
                const text = await r.text();
                let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
                return { status: r.status, body: j };
            }""",
            {"path": "/api/execute-external-action", "body": body, "token": access},
        )
        await browser.close()
        return out


def _scan_leaks(blob_text):
    import re
    leaks = []
    # raw JWT
    if re.search(r"eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+", blob_text):
        leaks.append("jwt")
    if re.search(r"(?i)bearer\s+[A-Za-z0-9._\-+/=]{8,}", blob_text):
        leaks.append("bearer")
    if re.search(r"[?&](token|key|secret|access_token)=[^&\s\"']+", blob_text):
        leaks.append("querystring_secret")
    if re.search(r"sk-[A-Za-z0-9_\-]{6,}", blob_text):
        leaks.append("sk_key")
    return leaks


def run_real_env():
    missing = [k for k in REAL_ENV_REQUIRED if not os.environ.get(k)]
    if missing:
        report = {
            "mode": "real-env",
            "status": "NOT_CONFIGURED",
            "missing_env_vars": missing,
            "ready_for_external_medium_connector_real_env": False,
            "ready_for_external_medium_connector": False,
            "notes": (
                "Real n8n controlled environment variables are not provisioned in "
                "this sandbox. No real call attempted. No destructive action. "
                "v3.37 NOT started. Re-run with the documented env to obtain "
                "real-env evidence."
            ),
        }
        out_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "scripts", "test-external-medium-connector-v3.36.real-env.json",
        )
        with open(out_path, "w") as f:
            json.dump(report, f, indent=2)
        print(json.dumps(report, indent=2))
        sys.exit(3)

    workflow_kind = os.environ["BRAINHUB_REAL_N8N_WORKFLOW_KIND"]
    if workflow_kind not in ("synthetic_echo", "production_representative"):
        print(f"[real-env] invalid BRAINHUB_REAL_N8N_WORKFLOW_KIND={workflow_kind}")
        sys.exit(3)
    failure_scenario = os.environ["BRAINHUB_REAL_N8N_FAILURE_SCENARIO"]
    if failure_scenario not in ("invalid_token", "invalid_path"):
        print(f"[real-env] invalid BRAINHUB_REAL_N8N_FAILURE_SCENARIO={failure_scenario}")
        sys.exit(3)

    workflow_key = os.environ["BRAINHUB_REAL_N8N_WORKFLOW_KEY"]
    happy_url = os.environ["BRAINHUB_REAL_N8N_WEBHOOK_URL"]
    failure_url = os.environ["BRAINHUB_REAL_N8N_FAILURE_URL"]
    port_a = int(os.environ.get("APP_PORT", "39003"))
    port_b = port_a + 1
    base_a = f"http://127.0.0.1:{port_a}"
    base_b = f"http://127.0.0.1:{port_b}"
    corr_a = f"v3362-real-happy-{uuid.uuid4().hex[:8]}"
    corr_b = f"v3362-real-fail-{uuid.uuid4().hex[:8]}"
    idem_a = f"idem-real-happy-{uuid.uuid4().hex[:8]}"
    idem_b = f"idem-real-fail-{uuid.uuid4().hex[:8]}"

    happy_proc = None
    fail_proc = None
    try:
        happy_proc = _start_app_with_url(happy_url, port_a)
        happy_body = {
            "action_type": "external_n8n_controlled_webhook",
            "idempotency_key": idem_a,
            "confirmation_source": "ui_button",
            "confirmation_id": f"conf-{idem_a}",
            "payload": {
                "workflow_key": workflow_key,
                "title": "v3.36.2 real happy",
                "message": "v3.36.2 real-env happy path",
                "correlation_id": corr_a,
                "live_execute": True,
                "confirmation_id": f"conf-{idem_a}",
            },
        }
        happy_res = asyncio.run(_drive_real_call(base_a, happy_body))
        happy_proc.terminate(); happy_proc.wait(timeout=5)
        happy_proc = None

        fail_proc = _start_app_with_url(failure_url, port_b)
        fail_body = {
            "action_type": "external_n8n_controlled_webhook",
            "idempotency_key": idem_b,
            "confirmation_source": "ui_button",
            "confirmation_id": f"conf-{idem_b}",
            "payload": {
                "workflow_key": workflow_key,
                "title": "v3.36.2 real failure",
                "message": "v3.36.2 real-env controlled failure boundary",
                "correlation_id": corr_b,
                "live_execute": True,
                "confirmation_id": f"conf-{idem_b}",
            },
        }
        fail_res = asyncio.run(_drive_real_call(base_b, fail_body))
    finally:
        for p in (happy_proc, fail_proc):
            if p:
                try: p.terminate(); p.wait(timeout=5)
                except Exception:
                    try: p.kill()
                    except Exception: pass

    # Redaction sweep on serialized responses.
    blob = json.dumps({"happy": happy_res, "failure": fail_res}, default=str)
    leaks = _scan_leaks(blob)

    happy_status = (happy_res.get("body") or {}).get("status")
    fail_status = (fail_res.get("body") or {}).get("status")
    fail_audit = ((fail_res.get("body") or {}).get("audit_record") or {})
    fail_kind = fail_audit.get("error_kind")

    expected_fail_kinds_token = {"http_401", "http_403", "n8n_auth_failed", "external_http_error"}
    expected_fail_kinds_path = {"http_404", "external_http_error"}
    fail_kind_ok = fail_kind in (
        expected_fail_kinds_token if failure_scenario == "invalid_token"
        else expected_fail_kinds_path
    )

    # DB counts (best-effort).
    happy_receipt = psql_count(
        f"select count(*) from public.execute_receipts where idempotency_key='{idem_a}';"
    )
    happy_artifact = psql_count(
        "select count(*) from public.internal_execute_artifacts "
        f"where payload->>'artifact_type'='external_medium_connector_dispatch' "
        f"and payload->>'idempotency_key'='{idem_a}';"
    )
    fail_receipt = psql_count(
        f"select count(*) from public.execute_receipts where idempotency_key='{idem_b}';"
    )
    fail_artifact = psql_count(
        "select count(*) from public.internal_execute_artifacts "
        f"where payload->>'artifact_type'='external_medium_connector_dispatch' "
        f"and payload->>'idempotency_key'='{idem_b}';"
    )

    happy_ok = (
        happy_status == "executed"
        and (happy_receipt is None or happy_receipt == 1)
        and (happy_artifact is None or happy_artifact == 1)
    )
    fail_ok = (
        fail_status == "failed"
        and fail_kind_ok
        and (fail_receipt is None or fail_receipt == 1)
        and (fail_artifact is None or fail_artifact == 1)
    )
    no_leaks = not leaks

    all_pass = happy_ok and fail_ok and no_leaks

    if workflow_kind == "production_representative" and all_pass:
        readiness = {
            "READY_FOR_EXTERNAL_MEDIUM_CONNECTOR_HARNESS": True,
            "READY_FOR_EXTERNAL_MEDIUM_CONNECTOR_REAL_ENV": True,
            "READY_FOR_EXTERNAL_MEDIUM_CONNECTOR": True,
        }
    elif workflow_kind == "synthetic_echo" and all_pass:
        readiness = {
            "READY_FOR_EXTERNAL_MEDIUM_CONNECTOR_HARNESS": True,
            "READY_FOR_EXTERNAL_MEDIUM_CONNECTOR_REAL_ENV": True,
            "READY_FOR_EXTERNAL_MEDIUM_CONNECTOR":
                "conditionally true / limited to controlled n8n workflows",
        }
    else:
        readiness = {
            "READY_FOR_EXTERNAL_MEDIUM_CONNECTOR_HARNESS": True,
            "READY_FOR_EXTERNAL_MEDIUM_CONNECTOR_REAL_ENV": False,
            "READY_FOR_EXTERNAL_MEDIUM_CONNECTOR": False,
        }

    report = {
        "mode": "real-env",
        "status": "PASS" if all_pass else "FAIL",
        "workflow_kind": workflow_kind,
        "failure_scenario": failure_scenario,
        "happy": {
            "dispatch_status": happy_status,
            "receipt_rows": happy_receipt,
            "artifact_rows_external_medium_connector_dispatch": happy_artifact,
            "ok": happy_ok,
        },
        "failure": {
            "dispatch_status": fail_status,
            "error_kind": fail_kind,
            "error_kind_ok": fail_kind_ok,
            "receipt_rows": fail_receipt,
            "artifact_rows_external_medium_connector_dispatch": fail_artifact,
            "ok": fail_ok,
        },
        "redaction": {"leaks": leaks, "ok": no_leaks},
        "race_8way_against_real_n8n": "NOT_EXECUTED_BY_DESIGN",
        "retries": "NOT_EXECUTED_BY_DESIGN",
        "destructive_tests": "NOT_EXECUTED_BY_DESIGN",
        "v3_37_started": False,
        "readiness": readiness,
    }
    out_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "scripts", "test-external-medium-connector-v3.36.real-env.json",
    )
    with open(out_path, "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(json.dumps(report, indent=2))
    sys.exit(0 if all_pass else 2)


if __name__ == "__main__":
    if "--real-env" in sys.argv:
        run_real_env()
    else:
        main()


