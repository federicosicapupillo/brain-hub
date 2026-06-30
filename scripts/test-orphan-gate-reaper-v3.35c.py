#!/usr/bin/env python3
"""Brain Hub v3.35c — Orphan Gate Reaper crash-injection harness.

Simulates a winner-crash by directly inserting a stale
`execute_idempotency` row (receipt_id=NULL, created_at backdated past
TTL) and then exercises the recovery endpoint at
POST /api/recover-orphan-execute-gate.

Requires:
  - PG* env vars (psql) for crash-injection
  - LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN + SUPABASE_SESSION_JSON for the
    authenticated bearer token
  - Dev server reachable at http://localhost:8080

Covers tests A..J from the v3.35c spec.
"""
from __future__ import annotations
import json, os, subprocess, sys, time, uuid, urllib.request

BASE = "http://localhost:8080"
ENDPOINT = f"{BASE}/api/recover-orphan-execute-gate"
EXEC_EXTERNAL = f"{BASE}/api/execute-external-action"
TOKEN = os.environ["LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN"]
SESSION = json.loads(os.environ["LOVABLE_BROWSER_SUPABASE_SESSION_JSON"])
OWNER = SESSION["user"]["id"]
TTL_TEST_MS = 1000  # short TTL for tests

def psql(sql: str) -> str:
    r = subprocess.run(["psql", "-At", "-c", sql], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"psql failed: {r.stderr}")
    return r.stdout.strip()

def inject_gate(action_type: str, age_seconds: int) -> str:
    key = f"v335c-{action_type}-{uuid.uuid4()}"
    psql(
        f"INSERT INTO public.execute_idempotency"
        f"(owner_id, idempotency_key, receipt_id, action_type, created_at)"
        f" VALUES ('{OWNER}', '{key}', NULL, '{action_type}',"
        f" now() - interval '{age_seconds} seconds')"
    )
    return key

def post_recover(key: str, ttl_ms: int | None = TTL_TEST_MS) -> dict:
    body: dict = {"idempotency_key": key}
    if ttl_ms is not None:
        body["ttl_ms"] = ttl_ms
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "authorization": f"Bearer {TOKEN}"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())

def count_receipts(key: str) -> int:
    return int(psql(
        f"SELECT count(*) FROM public.execute_receipts"
        f" WHERE owner_id='{OWNER}' AND idempotency_key='{key}'"
    ))

def gate_receipt_id(key: str) -> str | None:
    out = psql(
        f"SELECT coalesce(receipt_id::text,'')"
        f" FROM public.execute_idempotency"
        f" WHERE owner_id='{OWNER}' AND idempotency_key='{key}'"
    )
    return out or None

def fetch_receipt_audit(key: str) -> dict:
    out = psql(
        f"SELECT audit_record::text FROM public.execute_receipts"
        f" WHERE owner_id='{OWNER}' AND idempotency_key='{key}'"
        f" ORDER BY started_at DESC LIMIT 1"
    )
    return json.loads(out) if out else {}

def cleanup(_key: str) -> None:
    # psql in this sandbox is SELECT/INSERT only — no DELETE allowed.
    # Unique UUID keys guarantee no cross-test interference, so rows are
    # left behind intentionally and the test harness stays read-safe.
    return

results: list[tuple[str, bool, str]] = []
def check(name: str, cond: bool, detail: str = "") -> None:
    results.append((name, cond, detail))
    flag = "PASS" if cond else "FAIL"
    print(f"[{flag}] {name}: {detail}")

# ------------------------------------------------------------------
# Test A — Pending non scaduto
# ------------------------------------------------------------------
print("\n=== A. Pending non scaduto ===")
key = inject_gate("external_webhook_test_ping", 0)
r = post_recover(key, ttl_ms=60_000)
check("A.decision=not_orphaned_pending", r["decision"] == "not_orphaned_pending", json.dumps(r))
check("A.no_receipt_written", count_receipts(key) == 0, f"count={count_receipts(key)}")
check("A.auto_reexecuted_false", r["auto_reexecuted"] is False, "")
cleanup(key)

# ------------------------------------------------------------------
# Test B — LOW orphan expired (external sandbox LOW used as LOW)
# ------------------------------------------------------------------
print("\n=== B. LOW orphan expired ===")
key = inject_gate("external_webhook_test_ping", 5)
r = post_recover(key, ttl_ms=TTL_TEST_MS)
check("B.decision=orphaned_failed", r["decision"] == "orphaned_failed", json.dumps(r))
check("B.receipt_written", count_receipts(key) == 1, f"count={count_receipts(key)}")
check("B.gate_stamped", gate_receipt_id(key) == r["receipt_id"], gate_receipt_id(key) or "")
audit = fetch_receipt_audit(key)
check("B.audit.orphan_gate_status", audit.get("orphan_gate_status") == "orphaned_failed", str(audit.get("orphan_gate_status")))
check("B.audit.auto_reexecuted_false", audit.get("auto_reexecuted") is False, "")
check("B.audit.retry_allowed_false", audit.get("retry_allowed") is False, "")
B_key = key  # keep for idempotency test H

# ------------------------------------------------------------------
# Test C — External LOW sandbox orphan (no live call to sandbox target)
# ------------------------------------------------------------------
print("\n=== C. External LOW sandbox orphan ===")
key = inject_gate("external_webhook_test_ping", 5)
r = post_recover(key, ttl_ms=TTL_TEST_MS)
check("C.scope=external", r["scope"] == "external", str(r["scope"]))
check("C.risk_level=low", r["risk_level"] == "low", str(r["risk_level"]))
check("C.auto_reexecuted_false", r["auto_reexecuted"] is False, "")
audit = fetch_receipt_audit(key)
check("C.audit.execute_scope=external", audit.get("execute_scope") == "external", str(audit.get("execute_scope")))
cleanup(key)

# ------------------------------------------------------------------
# Test D — HIGH orphan expired (simulated via synthetic action_type
# not present in any registry → reaper treats as unknown / manual review)
# ------------------------------------------------------------------
print("\n=== D. HIGH/unknown orphan expired ===")
key = inject_gate("v335c_simulated_high_action", 5)
r = post_recover(key, ttl_ms=TTL_TEST_MS)
check("D.decision=manual_review",
      r["decision"] == "orphaned_unknown_requires_manual_review", json.dumps(r))
check("D.retry_allowed_false", r["retry_allowed"] is False, "")
check("D.auto_reexecuted_false", r["auto_reexecuted"] is False, "")
audit = fetch_receipt_audit(key)
check("D.audit.requires_manual_review=true",
      audit.get("requires_manual_review") is True, str(audit.get("requires_manual_review")))
cleanup(key)

# ------------------------------------------------------------------
# Test E — Unknown risk: covered by D (synthetic action_type → unknown)
# Re-assert distinct.
# ------------------------------------------------------------------
print("\n=== E. Unknown risk orphan ===")
key = inject_gate("v335c_totally_unknown_action_xyz", 5)
r = post_recover(key, ttl_ms=TTL_TEST_MS)
check("E.risk_unknown_or_high", r["risk_level"] in ("unknown", "high"), str(r["risk_level"]))
check("E.decision=manual_review",
      r["decision"] == "orphaned_unknown_requires_manual_review", r["decision"])
cleanup(key)

# ------------------------------------------------------------------
# Test F — Already completed
# ------------------------------------------------------------------
print("\n=== F. Already completed ===")
# Insert a normal recovery first then call again → already_completed.
key = inject_gate("external_webhook_test_ping", 5)
r1 = post_recover(key, ttl_ms=TTL_TEST_MS)
rid1 = r1["receipt_id"]
r2 = post_recover(key, ttl_ms=TTL_TEST_MS)
check("F.first_was_orphaned_failed", r1["decision"] == "orphaned_failed", r1["decision"])
check("F.second_no_new_receipt", count_receipts(key) == 1, f"count={count_receipts(key)}")
check("F.second_returns_stable", r2["decision"] in ("already_completed", "orphaned_recovered"), r2["decision"])
check("F.same_receipt_id",
      r2.get("receipt_id") == rid1 or r2.get("existing_receipt_id") == rid1,
      f"{r2.get('receipt_id')} vs {rid1}")
F_key = key

# ------------------------------------------------------------------
# Test G — Cross-user protection
# ------------------------------------------------------------------
print("\n=== G. Cross-user protection ===")
other_owner = "00000000-0000-0000-0000-000000000001"
other_key = f"v335c-cross-{uuid.uuid4()}"
psql(
    f"INSERT INTO public.execute_idempotency"
    f"(owner_id, idempotency_key, receipt_id, action_type, created_at)"
    f" VALUES ('{other_owner}', '{other_key}', NULL,"
    f" 'external_webhook_test_ping', now() - interval '5 seconds')"
)
r = post_recover(other_key, ttl_ms=TTL_TEST_MS)
check("G.not_found_for_other_owner", r["decision"] == "not_found", r["decision"])
# Confirm the foreign row was not mutated.
foreign_state = psql(
    f"SELECT coalesce(receipt_id::text,'NULL') FROM public.execute_idempotency"
    f" WHERE owner_id='{other_owner}' AND idempotency_key='{other_key}'"
)
check("G.foreign_gate_unchanged", foreign_state == "NULL", foreign_state)
psql(f"DELETE FROM public.execute_idempotency WHERE owner_id='{other_owner}' AND idempotency_key='{other_key}'")

# ------------------------------------------------------------------
# Test H — Idempotency of the reaper (using F_key)
# ------------------------------------------------------------------
print("\n=== H. Reaper idempotency ===")
check("H.exactly_one_receipt", count_receipts(F_key) == 1, f"count={count_receipts(F_key)}")
r3 = post_recover(F_key, ttl_ms=TTL_TEST_MS)
check("H.third_call_no_dup", count_receipts(F_key) == 1, f"count={count_receipts(F_key)}")
check("H.third_decision_stable", r3["decision"] in ("already_completed", "orphaned_recovered"), r3["decision"])
cleanup(F_key)
cleanup(B_key)

# ------------------------------------------------------------------
# Test I — Redaction
# ------------------------------------------------------------------
print("\n=== I. Redaction in receipt ===")
key = inject_gate("v335c_simulated_high_action", 5)
r = post_recover(key, ttl_ms=TTL_TEST_MS)
audit_raw = psql(
    f"SELECT audit_record::text FROM public.execute_receipts"
    f" WHERE owner_id='{OWNER}' AND idempotency_key='{key}'"
)
bad = any(tok in audit_raw.lower() for tok in ["bearer ey", "authorization:", "sk-live_", "@gmail.com"])
check("I.no_sensitive_strings", not bad, audit_raw[:120])
cleanup(key)

# ------------------------------------------------------------------
# Test J — Regression: external sandbox LOW concurrency still 1+7
# ------------------------------------------------------------------
print("\n=== J. v3.35b regression — 8 concurrent identical requests ===")
import concurrent.futures
key = f"v335c-regr-{uuid.uuid4()}"
confirmed_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
body = {
    "action_type": "external_webhook_test_ping",
    "idempotency_key": key,
    "confirmed_at": confirmed_at,
    "confirmation_source": "ui_button",
    "confirmation_id": "regression-j",
    "payload": {
        "message": "hi",
        "correlation_id": key[:32],
        "live_execute": True,
        "dry_run": False,
    },
}
def fire():
    req = urllib.request.Request(
        EXEC_EXTERNAL,
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "authorization": f"Bearer {TOKEN}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        return {"ok": False, "status": "error", "error": str(e)}

with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
    fired = list(ex.map(lambda _: fire(), range(8)))
statuses = [f.get("status") for f in fired]
executed = statuses.count("executed")
replayed = statuses.count("replayed")
n_receipts = int(psql(
    f"SELECT count(*) FROM public.execute_receipts"
    f" WHERE owner_id='{OWNER}' AND idempotency_key='{key}'"
))
n_idem = int(psql(
    f"SELECT count(*) FROM public.execute_idempotency"
    f" WHERE owner_id='{OWNER}' AND idempotency_key='{key}'"
))
check("J.exactly_1_executed", executed == 1, f"executed={executed} statuses={statuses}")
check("J.exactly_7_replayed", replayed == 7, f"replayed={replayed}")
check("J.exactly_1_receipt", n_receipts == 1, f"receipts={n_receipts}")
check("J.exactly_1_idempotency_row", n_idem == 1, f"idem_rows={n_idem}")
# cleanup
psql(f"DELETE FROM public.execute_idempotency WHERE owner_id='{OWNER}' AND idempotency_key='{key}'")
psql(f"DELETE FROM public.internal_execute_artifacts WHERE owner_id='{OWNER}'"
     f" AND payload->>'idempotency_key_hint'='{key}'")  # harmless
psql(f"DELETE FROM public.execute_receipts WHERE owner_id='{OWNER}' AND idempotency_key='{key}'")

# ------------------------------------------------------------------
# Final summary
# ------------------------------------------------------------------
total = len(results)
passed = sum(1 for _, ok, _ in results if ok)
print(f"\n=========== RESULT: {passed}/{total} PASS ===========")
if passed != total:
    for name, ok, detail in results:
        if not ok:
            print(f"  FAIL {name}: {detail}")
    sys.exit(1)
print("READY_FOR_ORPHAN_GATE_REAPER candidate = true (pending B-review)")
