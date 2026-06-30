import asyncio, json, os, uuid
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"

async def main():
    storage_key = os.environ["LOVABLE_BROWSER_SUPABASE_STORAGE_KEY"]
    session_json = os.environ["LOVABLE_BROWSER_SUPABASE_SESSION_JSON"]

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        await page.goto(BASE)
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )
        # Reload so app picks the session up (not strictly required for fetch).
        access = json.loads(session_json).get("access_token")
        assert access, "no access token"

        async def post(path, body):
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

        # ------- TEST A: rollback end-to-end ----------------------------
        idem_a = f"rb-test-{uuid.uuid4()}"
        exec_req = {
            "action_type": "create_project_note",
            "idempotency_key": idem_a,
            "confirmed_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
            "confirmation_source": "ui_button",
            "payload": {"project_id": "brainhub-os", "note": "v3.35a.1 rollback test"},
        }
        exec_resp = await post("/api/execute-internal-action", exec_req)
        print("EXEC:", json.dumps(exec_resp, indent=2))
        receipt_id = exec_resp["body"]["receipt"]["receipt_id"]
        action_id = exec_resp["body"]["receipt"]["action_id"]
        original_started = exec_resp["body"]["receipt"]["started_at"]
        original_result = exec_resp["body"]["receipt"]["result"]

        rb_resp = await post("/api/rollback-internal-action", {"receipt_id": receipt_id})
        print("ROLLBACK:", json.dumps(rb_resp, indent=2))

        # second rollback should be rejected
        rb_again = await post("/api/rollback-internal-action", {"receipt_id": receipt_id})
        print("ROLLBACK_AGAIN:", json.dumps(rb_again, indent=2))

        # ------- TEST B: concurrency / idempotency ----------------------
        idem_b = f"race-test-{uuid.uuid4()}"
        confirmed_at = __import__("datetime").datetime.utcnow().isoformat() + "Z"
        race_body = {
            "action_type": "create_project_note",
            "idempotency_key": idem_b,
            "confirmed_at": confirmed_at,
            "confirmation_source": "ui_button",
            "payload": {"project_id": "brainhub-os", "note": "v3.35a.1 race test"},
        }
        race_results = await page.evaluate(
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
            {"path": "/api/execute-internal-action", "body": race_body, "token": access, "n": 8},
        )
        print("RACE_RESULTS:")
        for r in race_results:
            rec = r["body"].get("receipt") or {}
            print(f"  http={r['status']} status={r['body'].get('status')} receipt_id={rec.get('receipt_id')} action_id={rec.get('action_id')}")

        # Aggregate verification via direct fetch through Data API (RLS scoped to current user).
        verify = await page.evaluate(
            """async ({token, idem_a, idem_b, receipt_id, action_id}) => {
                const SBURL = window.__SB_URL || (window.localStorage.getItem('SB_URL'));
                return { note: 'aggregation done via /api summarize route absent — using JS results above', idem_a, idem_b, receipt_id, action_id };
            }""",
            {"token": access, "idem_a": idem_a, "idem_b": idem_b, "receipt_id": receipt_id, "action_id": action_id},
        )
        print("KEYS:", json.dumps(verify, indent=2))
        print("ORIGINAL_PRESERVED_CHECK:")
        print(f"  original_result={original_result}  original_started_at={original_started}")
        print(f"  rolled_back_receipt.related_receipt_id={rb_resp['body'].get('receipt', {}).get('related_receipt_id')}")
        await browser.close()

asyncio.run(main())
