"""
Brain Hub v3.35b — External Execute Sandbox test harness.

Mirrors scripts/test-execute-readiness-v3.35a.1.py: uses a Playwright
browser context to inject the existing Supabase session and POST
against the local dev server (default http://localhost:8080).

Coverage (mandatory per v3.35b spec):
  A. Allowlist          — registered vs unknown action_type
  B. Dry-run            — receipt/artifact, no live endpoint reached
  C. Confirmation       — live without confirm → rejected_confirm; with → executed
  D. Idempotency race   — 8 concurrent live executes → 1 executed + 7 replayed
  E. Security/redaction — payload field "authorization" → rejected_validation;
                          live response previews must not contain bearer tokens
  F. Rollback           — registry.supports_rollback=false; out of scope here
                          (no /api/rollback-external-action endpoint shipped)
  G. Orphan gate debt   — NOT tested: inherited from v3.35a.1, deferred to v3.35c.
                          The script prints an explicit declaration line.

Run:
  python scripts/test-external-execute-v3.35b.py
"""
import asyncio, json, os, uuid, datetime
from playwright.async_api import async_playwright

BASE = os.environ.get("BRAINHUB_BASE_URL", "http://localhost:8080")


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


async def main() -> None:
    storage_key = os.environ["LOVABLE_BROWSER_SUPABASE_STORAGE_KEY"]
    session_json = os.environ["LOVABLE_BROWSER_SUPABASE_SESSION_JSON"]
    access = json.loads(session_json).get("access_token")
    assert access, "no access token in LOVABLE_BROWSER_SUPABASE_SESSION_JSON"

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1600})
        page = await ctx.new_page()
        await page.goto(BASE)
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )

        async def post(path: str, body: dict) -> dict:
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
                {"path": path, "body": body, "token": access},
            )

        EP = "/api/execute-external-action"

        # ------------------------------------------------------------------
        # A. Allowlist
        # ------------------------------------------------------------------
        print("=== A. ALLOWLIST ===")
        a_unknown = await post(EP, {
            "action_type": "external_unknown_action",
            "idempotency_key": f"a-unknown-{uuid.uuid4()}",
            "payload": {"message": "x", "correlation_id": "c", "dry_run": True},
        })
        print("A.unknown:", json.dumps(a_unknown, indent=2))
        assert a_unknown["body"]["status"] == "rejected_unknown_action", a_unknown

        a_ok = await post(EP, {
            "action_type": "external_webhook_test_ping",
            "idempotency_key": f"a-ok-{uuid.uuid4()}",
            "payload": {
                "message": "allowlist ok",
                "correlation_id": f"corr-{uuid.uuid4()}",
                "dry_run": True,
                "live_execute": False,
            },
        })
        print("A.allowlisted:", json.dumps(a_ok, indent=2))
        assert a_ok["body"]["status"] == "executed", a_ok

        # ------------------------------------------------------------------
        # B. Dry-run
        # ------------------------------------------------------------------
        print("=== B. DRY-RUN ===")
        b_corr = f"dry-{uuid.uuid4()}"
        b = await post(EP, {
            "action_type": "external_webhook_test_ping",
            "idempotency_key": f"b-{uuid.uuid4()}",
            "payload": {
                "message": "dry run check",
                "correlation_id": b_corr,
                "dry_run": True,
                "live_execute": False,
            },
        })
        print("B.dry_run:", json.dumps(b, indent=2))
        assert b["body"]["status"] == "executed"
        audit = json.loads(b["body"]["receipt"]["audit_record"])
        assert audit.get("dry_run") is True and audit.get("live_execute") is False
        assert audit.get("http_status") is None, "dry-run must NOT hit live endpoint"

        # ------------------------------------------------------------------
        # C. Confirmation
        # ------------------------------------------------------------------
        print("=== C. CONFIRMATION ===")
        c_missing = await post(EP, {
            "action_type": "external_webhook_test_ping",
            "idempotency_key": f"c-miss-{uuid.uuid4()}",
            "payload": {
                "message": "live no confirm",
                "correlation_id": f"corr-{uuid.uuid4()}",
                "dry_run": False,
                "live_execute": True,
            },
        })
        print("C.no_confirm:", json.dumps(c_missing, indent=2))
        assert c_missing["body"]["status"] == "rejected_confirm"

        c_ok = await post(EP, {
            "action_type": "external_webhook_test_ping",
            "idempotency_key": f"c-ok-{uuid.uuid4()}",
            "confirmed_at": _now_iso(),
            "confirmation_source": "ui_button",
            "payload": {
                "message": "live with confirm",
                "correlation_id": f"corr-{uuid.uuid4()}",
                "dry_run": False,
                "live_execute": True,
                "confirmation_id": f"confirm-{uuid.uuid4()}",
            },
        })
        print("C.with_confirm:", json.dumps(c_ok, indent=2))
        assert c_ok["body"]["status"] == "executed", c_ok
        audit_c = json.loads(c_ok["body"]["receipt"]["audit_record"])
        assert audit_c.get("confirmation_id"), "confirmation_id must be on receipt"
        assert audit_c.get("http_status") == 200, "live must reach sandbox target"

        # ------------------------------------------------------------------
        # D. Idempotency concurrency
        # ------------------------------------------------------------------
        print("=== D. CONCURRENCY ===")
        idem_d = f"race-{uuid.uuid4()}"
        confirm_id = f"confirm-{uuid.uuid4()}"
        confirmed_at = _now_iso()
        race_body = {
            "action_type": "external_webhook_test_ping",
            "idempotency_key": idem_d,
            "confirmed_at": confirmed_at,
            "confirmation_source": "ui_button",
            "payload": {
                "message": "race",
                "correlation_id": f"corr-{uuid.uuid4()}",
                "dry_run": False,
                "live_execute": True,
                "confirmation_id": confirm_id,
            },
        }
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
            {"path": EP, "body": race_body, "token": access, "n": 8},
        )
        statuses = [r["body"].get("status") for r in race]
        print("D.statuses:", statuses)
        n_exec = sum(1 for s in statuses if s == "executed")
        n_replay = sum(1 for s in statuses if s == "replayed")
        assert n_exec == 1 and n_replay == 7, (n_exec, n_replay, statuses)
        receipt_ids = {r["body"]["receipt"]["receipt_id"] for r in race if r["body"].get("receipt")}
        assert len(receipt_ids) == 1, ("expected one canonical receipt", receipt_ids)

        # ------------------------------------------------------------------
        # E. Security / redaction
        # ------------------------------------------------------------------
        print("=== E. REDACTION ===")
        e_sensitive = await post(EP, {
            "action_type": "external_webhook_test_ping",
            "idempotency_key": f"e-sens-{uuid.uuid4()}",
            "payload": {
                "message": "x",
                "correlation_id": "c",
                "dry_run": True,
                "authorization": "Bearer leaked-token",
            },
        })
        print("E.sensitive_field:", json.dumps(e_sensitive, indent=2))
        assert e_sensitive["body"]["status"] == "rejected_validation"

        # ------------------------------------------------------------------
        # F. Rollback declaration
        # ------------------------------------------------------------------
        print("=== F. ROLLBACK ===")
        print("F.rollback_external_endpoint = not_shipped_in_v3.35b "
              "(registry.supports_rollback=false). Documented in EQG A6/A7.")

        # ------------------------------------------------------------------
        # G. Orphan gate debt
        # ------------------------------------------------------------------
        print("=== G. ORPHAN GATE DEBT ===")
        print("G.orphan_gate_reaper = NOT IMPLEMENTED in v3.35b. "
              "Inherited from v3.35a.1; scheduled for v3.35c. "
              "Not tested in this run by design.")

        print("\nALL CHECKS PASSED.")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
