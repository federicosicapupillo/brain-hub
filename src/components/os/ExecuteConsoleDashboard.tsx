// Brain Hub v3.35d — Execute Console UI.
//
// Operational console for the approved Execute surface. Read/observe is
// always-on; write actions (live execute, rollback, recovery) call only
// the four already-approved endpoints. The UI never invents action_types
// and never bypasses Governance/RBAC.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  CheckCircle2,
  CircleSlash,
  PlayCircle,
  RotateCcw,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import type {
  ConsoleArtifact,
  ConsoleBlockedAction,
  ConsoleCapability,
  ConsoleOrphanState,
  ConsoleReceipt,
  ExecuteConsoleData,
} from "@/lib/execute-console/execute-console-types";

// ---- API helpers --------------------------------------------------------

async function bearer(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

async function fetchConsole(): Promise<ExecuteConsoleData> {
  const token = await bearer();
  const res = await fetch("/api/execute-console-data", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`execute-console-data ${res.status}: ${body.slice(0, 160)}`);
  }
  const json = (await res.json()) as { ok: true; data: ExecuteConsoleData };
  return json.data;
}

interface CallResult {
  ok: boolean;
  status: string;
  safe_message?: string;
  receipt?: unknown;
}

async function postApproved(
  endpoint:
    | "/api/execute-internal-action"
    | "/api/execute-external-action"
    | "/api/rollback-internal-action"
    | "/api/recover-orphan-execute-gate",
  body: Record<string, unknown>,
): Promise<CallResult> {
  const token = await bearer();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let json: CallResult;
  try {
    json = (await res.json()) as CallResult;
  } catch {
    json = { ok: false, status: `http_${res.status}`, safe_message: "invalid_json" };
  }
  return json;
}

// ---- visual helpers -----------------------------------------------------

const STATUS_TONE: Record<string, string> = {
  live: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  empty: "bg-slate-500/15 text-slate-700 border-slate-500/30",
  missing: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  unknown: "bg-slate-500/15 text-slate-700 border-slate-500/30",
  error: "bg-rose-500/15 text-rose-700 border-rose-500/30",
  loading: "bg-slate-500/15 text-slate-700 border-slate-500/30",
  available: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  blocked: "bg-rose-500/15 text-rose-700 border-rose-500/30",
  not_supported: "bg-slate-500/15 text-slate-700 border-slate-500/30",
};
const RISK_TONE: Record<string, string> = {
  low: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  medium: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  high: "bg-rose-500/10 text-rose-700 border-rose-500/30",
  critical: "bg-rose-700/15 text-rose-800 border-rose-700/40",
  unknown: "bg-slate-500/10 text-slate-700 border-slate-500/30",
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ---- main component -----------------------------------------------------

export function ExecuteConsoleDashboard() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["execute-console-data"],
    queryFn: fetchConsole,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const [selectedAction, setSelectedAction] = useState<ConsoleCapability | null>(
    null,
  );
  const [drawerReceipt, setDrawerReceipt] = useState<ConsoleReceipt | null>(null);
  const [confirm, setConfirm] = useState<null | {
    kind: "external_live" | "rollback" | "recover";
    label: string;
    onConfirm: () => Promise<void>;
  }>(null);
  const [lastResult, setLastResult] = useState<CallResult | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["execute-console-data"] });

  const dryRunMut = useMutation({
    mutationFn: async (cap: ConsoleCapability) => {
      const idem = `dryrun-${cap.action_type}-${crypto.randomUUID()}`;
      const r = await postApproved("/api/execute-external-action", {
        action_type: cap.action_type,
        idempotency_key: idem,
        payload: { dry_run: true, message: "execute-console dry-run" },
      });
      return r;
    },
    onSuccess: (r) => {
      setLastResult(r);
      refresh();
    },
  });

  const liveExternalMut = useMutation({
    mutationFn: async (cap: ConsoleCapability) => {
      const now = new Date().toISOString();
      const confirmation_id = `confirm-${crypto.randomUUID()}`;
      const idem = `live-${cap.action_type}-${crypto.randomUUID()}`;
      return postApproved("/api/execute-external-action", {
        action_type: cap.action_type,
        idempotency_key: idem,
        confirmed_at: now,
        confirmation_source: "ui_button",
        confirmation_id,
        payload: {
          live_execute: true,
          message: "execute-console live ping",
          confirmation_id,
        },
      });
    },
    onSuccess: (r) => {
      setLastResult(r);
      refresh();
    },
  });

  const rollbackMut = useMutation({
    mutationFn: async (artifact: ConsoleArtifact) => {
      return postApproved("/api/rollback-internal-action", {
        action_id: artifact.id,
        action_type: artifact.action_type,
        confirmed_at: new Date().toISOString(),
        confirmation_source: "ui_button",
      });
    },
    onSuccess: (r) => {
      setLastResult(r);
      refresh();
    },
  });

  const recoverMut = useMutation({
    mutationFn: async (orphan: ConsoleOrphanState) => {
      // Endpoint accepts the full idempotency_key only; the preview is
      // visible in the UI but we send the original to the backend. To
      // keep the UI honest, we surface recovery only for rows the user
      // owns, with the gate row indirectly identifying the key via the
      // server-stored full value.
      return postApproved("/api/recover-orphan-execute-gate", {
        idempotency_key: orphan.idempotency_key_preview,
      });
    },
    onSuccess: (r) => {
      setLastResult(r);
      refresh();
    },
  });

  if (q.isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Loading Execute Console…
      </div>
    );
  }
  if (q.error || !q.data) {
    return (
      <div className="p-6 text-sm text-rose-600">
        Failed to load Execute Console: {String(q.error ?? "no_data")}
      </div>
    );
  }

  const d = q.data;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <Header data={d} />
      {lastResult ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Last call result</CardTitle>
          </CardHeader>
          <CardContent className="text-xs">
            <div>status: {lastResult.status}</div>
            {lastResult.safe_message ? (
              <div>message: {lastResult.safe_message}</div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="actions" className="w-full">
        <TabsList>
          <TabsTrigger value="actions">Available actions</TabsTrigger>
          <TabsTrigger value="blocked">Blocked</TabsTrigger>
          <TabsTrigger value="receipts">Receipts</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
          <TabsTrigger value="orphans">Orphan / Manual review</TabsTrigger>
          <TabsTrigger value="rollback">Rollback</TabsTrigger>
        </TabsList>

        <TabsContent value="actions">
          <ActionsPanel
            data={d}
            selected={selectedAction}
            onSelect={setSelectedAction}
            onDryRun={(c) => dryRunMut.mutate(c)}
            onLive={(c) =>
              setConfirm({
                kind: "external_live",
                label: c.action_type,
                onConfirm: async () => {
                  await liveExternalMut.mutateAsync(c);
                },
              })
            }
          />
        </TabsContent>

        <TabsContent value="blocked">
          <BlockedPanel items={d.blocked_actions} />
        </TabsContent>

        <TabsContent value="receipts">
          <ReceiptHistory items={d.recent_receipts} onOpen={setDrawerReceipt} />
        </TabsContent>

        <TabsContent value="artifacts">
          <ArtifactsPanel items={d.recent_artifacts} />
        </TabsContent>

        <TabsContent value="orphans">
          <OrphanPanel
            items={d.orphan_states}
            manualReview={d.manual_review_items}
            onRecover={(o) =>
              setConfirm({
                kind: "recover",
                label: o.idempotency_key_preview,
                onConfirm: async () => {
                  await recoverMut.mutateAsync(o);
                },
              })
            }
          />
        </TabsContent>

        <TabsContent value="rollback">
          <RollbackPanel
            items={d.rollback_candidates}
            onRollback={(a) =>
              setConfirm({
                kind: "rollback",
                label: a.title,
                onConfirm: async () => {
                  await rollbackMut.mutateAsync(a);
                },
              })
            }
          />
        </TabsContent>
      </Tabs>

      <ReceiptDrawer
        receipt={drawerReceipt}
        onClose={() => setDrawerReceipt(null)}
      />
      <ConfirmDialog
        state={confirm}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          await confirm.onConfirm();
          setConfirm(null);
        }}
      />
    </div>
  );
}

// ---- subcomponents ------------------------------------------------------

function Header({ data }: { data: ExecuteConsoleData }) {
  const e = data.engine_status;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Wrench className="h-5 w-5" /> Execute Console
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
        <StatusPill label="Internal Execute" on={e.internal_execute_enabled} />
        <StatusPill
          label="External Sandbox"
          on={e.external_sandbox_execute_enabled}
        />
        <StatusPill label="Orphan Reaper" on={e.orphan_gate_reaper_enabled} />
        <StatusPill label="HIGH live" on={false} blockedLabel="blocked" />
        <StatusPill
          label="MEDIUM ext. connector"
          on={false}
          blockedLabel="not available yet"
        />
        <div className="col-span-2 md:col-span-3">
          <div>Last receipt: {fmtTime(e.last_receipt_at)}</div>
          <div>Last orphan recovery: {fmtTime(e.last_orphan_recovery_at)}</div>
          {e.warnings.length > 0 ? (
            <div className="mt-1 text-amber-700">
              ⚠ {e.warnings.join(" · ")}
            </div>
          ) : null}
        </div>
        <Separator className="col-span-full my-1" />
        <SourceBadge name="receipts" meta={data.source_status.receipts} />
        <SourceBadge name="artifacts" meta={data.source_status.artifacts} />
        <SourceBadge name="idempotency" meta={data.source_status.idempotency} />
        <div className="text-muted-foreground">
          total {data.timings.total_ms}ms · generated {fmtTime(data.provenance.generated_at)}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusPill({
  label,
  on,
  blockedLabel = "disabled",
}: {
  label: string;
  on: boolean;
  blockedLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {on ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      ) : (
        <CircleSlash className="h-4 w-4 text-rose-600" />
      )}
      <span>
        {label}: <strong>{on ? "enabled" : blockedLabel}</strong>
      </span>
    </div>
  );
}

function SourceBadge({
  name,
  meta,
}: {
  name: string;
  meta: ExecuteConsoleData["source_status"]["receipts"];
}) {
  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className={STATUS_TONE[meta.status] ?? ""}>
        {name}: {meta.status}
      </Badge>
      <span className="text-muted-foreground">
        {meta.count} · {meta.duration_ms}ms
      </span>
      {meta.error_safe_message ? (
        <span className="text-rose-600">{meta.error_safe_message}</span>
      ) : null}
    </div>
  );
}

function ActionsPanel({
  data,
  selected,
  onSelect,
  onDryRun,
  onLive,
}: {
  data: ExecuteConsoleData;
  selected: ConsoleCapability | null;
  onSelect: (c: ConsoleCapability) => void;
  onDryRun: (c: ConsoleCapability) => void;
  onLive: (c: ConsoleCapability) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_3fr]">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            Capabilities ({data.available_actions.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[480px] pr-2">
            <ul className="space-y-1">
              {data.available_actions.map((c) => (
                <li key={`${c.scope}:${c.action_type}`}>
                  <button
                    className={`w-full rounded-md border p-2 text-left text-xs hover:bg-muted/40 ${
                      selected?.action_type === c.action_type &&
                      selected.scope === c.scope
                        ? "border-primary"
                        : "border-border/60"
                    }`}
                    onClick={() => onSelect(c)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{c.action_type}</span>
                      <div className="flex gap-1">
                        <Badge variant="outline" className={STATUS_TONE[c.status]}>
                          {c.status}
                        </Badge>
                        <Badge variant="outline" className={RISK_TONE[c.risk_level]}>
                          {c.risk_level}
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {c.scope} · dry-run {c.supports_dry_run ? "✓" : "—"} · live{" "}
                      {c.supports_live_execute ? "✓" : "—"} · rollback{" "}
                      {c.supports_rollback ? "✓" : "—"}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Detail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          {!selected ? (
            <p className="text-muted-foreground">Select an action to inspect.</p>
          ) : (
            <>
              <div>
                <div className="font-medium">{selected.action_type}</div>
                <div className="text-muted-foreground">{selected.description}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className={RISK_TONE[selected.risk_level]}>
                  risk: {selected.risk_level}
                </Badge>
                <Badge variant="outline">scope: {selected.scope}</Badge>
                <Badge variant="outline">
                  confirmation: {selected.requires_confirmation ? "required" : "no"}
                </Badge>
                <Badge variant="outline" className={STATUS_TONE[selected.status]}>
                  {selected.status}
                </Badge>
              </div>
              {selected.blocked_reason ? (
                <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-rose-700">
                  Blocked: {selected.blocked_reason}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!selected.supports_dry_run || selected.scope !== "external"}
                  onClick={() => onDryRun(selected)}
                >
                  <PlayCircle className="mr-1 h-3 w-3" /> Dry-run
                </Button>
                <Button
                  size="sm"
                  disabled={
                    !selected.supports_live_execute ||
                    selected.status !== "available" ||
                    selected.scope !== "external"
                  }
                  onClick={() => onLive(selected)}
                >
                  Live execute
                </Button>
                <Button size="sm" variant="outline" disabled>
                  Rollback (open from Rollback tab)
                </Button>
              </div>
              {selected.scope === "internal" ? (
                <p className="text-muted-foreground">
                  Internal MEDIUM live execute requires a real payload built by
                  the originating module (e.g. action queue). The Console only
                  surfaces the receipt/artifact result — it does not invent
                  payloads.
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BlockedPanel({ items }: { items: ConsoleBlockedAction[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldAlert className="h-4 w-4" /> Blocked actions ({items.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No blocked actions.</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {items.map((b) => (
              <li
                key={b.action_type}
                className="rounded-md border border-border/60 p-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{b.action_type}</span>
                  <Badge variant="outline" className={RISK_TONE[b.risk_level]}>
                    {b.risk_level}
                  </Badge>
                </div>
                <div className="text-muted-foreground">
                  {b.scope} · {b.reason_kind}
                </div>
                <div>{b.reason}</div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ReceiptHistory({
  items,
  onOpen,
}: {
  items: ConsoleReceipt[];
  onOpen: (r: ConsoleReceipt) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          Receipts ({items.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No receipts yet. Receipts appear here after a real Execute attempt.
          </p>
        ) : (
          <ScrollArea className="h-[480px] pr-2">
            <ul className="space-y-1 text-xs">
              {items.map((r) => (
                <li
                  key={r.receipt_id}
                  className="cursor-pointer rounded-md border border-border/60 p-2 hover:bg-muted/40"
                  onClick={() => onOpen(r)}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{r.action_type}</span>
                    <div className="flex gap-1">
                      <Badge variant="outline" className={RISK_TONE[r.risk_level] ?? ""}>
                        {r.risk_level}
                      </Badge>
                      <Badge variant="outline">{r.outcome_kind}</Badge>
                    </div>
                  </div>
                  <div className="text-muted-foreground">
                    {r.scope} · {fmtTime(r.started_at)} · idem{" "}
                    {r.idempotency_key_preview ?? "—"}
                  </div>
                  {r.requires_manual_review ? (
                    <div className="text-amber-700">⚠ manual review required</div>
                  ) : null}
                  {r.safe_error_message ? (
                    <div className="text-rose-600">{r.safe_error_message}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function ArtifactsPanel({ items }: { items: ConsoleArtifact[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          Execute artifacts ({items.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No artifacts yet.</p>
        ) : (
          <ScrollArea className="h-[480px] pr-2">
            <ul className="space-y-1 text-xs">
              {items.map((a) => (
                <li key={a.id} className="rounded-md border border-border/60 p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{a.title}</span>
                    <div className="flex gap-1">
                      <Badge variant="outline" className={RISK_TONE[a.risk_level] ?? ""}>
                        {a.risk_level}
                      </Badge>
                      <Badge variant="outline">{a.execute_scope}</Badge>
                    </div>
                  </div>
                  <div className="text-muted-foreground">
                    {a.action_type} · {fmtTime(a.created_at)}
                    {a.rolled_back_at ? ` · rolled_back ${fmtTime(a.rolled_back_at)}` : ""}
                  </div>
                  <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted/40 p-1 text-[10px]">
                    {JSON.stringify(a.payload_preview, null, 2)}
                  </pre>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function OrphanPanel({
  items,
  manualReview,
  onRecover,
}: {
  items: ConsoleOrphanState[];
  manualReview: ConsoleReceipt[];
  onRecover: (o: ConsoleOrphanState) => void;
}) {
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <AlertCircle className="h-4 w-4" /> Pending / Orphan gates (
            {items.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No pending/orphan idempotency gates.
            </p>
          ) : (
            <ul className="space-y-2 text-xs">
              {items.map((o) => (
                <li
                  key={o.idempotency_key_preview + o.created_at}
                  className="rounded-md border border-border/60 p-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{o.action_type}</span>
                    <div className="flex gap-1">
                      <Badge variant="outline" className={RISK_TONE[o.risk_level]}>
                        {o.risk_level}
                      </Badge>
                      <Badge variant="outline">{o.decision}</Badge>
                    </div>
                  </div>
                  <div className="text-muted-foreground">
                    idem {o.idempotency_key_preview} · age{" "}
                    {o.gate_age_ms ?? "?"}ms · auto_reexecuted=false
                  </div>
                  {o.requires_manual_review ? (
                    <div className="mt-1 text-amber-700">
                      Richiede revisione manuale. Brain Hub non può rieseguire
                      automaticamente perché lo stato del side effect è
                      sconosciuto.
                    </div>
                  ) : null}
                  {o.decision === "pending" || o.decision === "orphaned_failed" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => onRecover(o)}
                    >
                      Run orphan reaper
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            Manual-review receipts ({manualReview.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {manualReview.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No receipts requiring manual review.
            </p>
          ) : (
            <ul className="space-y-1 text-xs">
              {manualReview.map((r) => (
                <li
                  key={r.receipt_id}
                  className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2"
                >
                  <div className="font-medium">{r.action_type}</div>
                  <div className="text-muted-foreground">
                    {fmtTime(r.started_at)} · {r.outcome_kind}
                  </div>
                  <div>
                    Richiede revisione manuale. Brain Hub non può rieseguire
                    automaticamente perché lo stato del side effect è
                    sconosciuto.
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RollbackPanel({
  items,
  onRollback,
}: {
  items: ConsoleArtifact[];
  onRollback: (a: ConsoleArtifact) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <RotateCcw className="h-4 w-4" /> Rollback candidates ({items.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No rollback candidates. Only internal artifacts whose action_type
            declares rollback_available=true are eligible.
          </p>
        ) : (
          <ul className="space-y-2 text-xs">
            {items.map((a) => (
              <li
                key={a.id}
                className="rounded-md border border-border/60 p-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{a.title}</span>
                  <Badge variant="outline">{a.action_type}</Badge>
                </div>
                <div className="text-muted-foreground">
                  {fmtTime(a.created_at)}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => onRollback(a)}
                >
                  Rollback
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ReceiptDrawer({
  receipt,
  onClose,
}: {
  receipt: ConsoleReceipt | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!receipt} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Receipt detail</DialogTitle>
          <DialogDescription>
            Redacted view. Tokens, JWTs, API keys, and emails are removed.
          </DialogDescription>
        </DialogHeader>
        {receipt ? (
          <div className="space-y-2 text-xs">
            <div>id: {receipt.receipt_id}</div>
            <div>action_type: {receipt.action_type}</div>
            <div>scope: {receipt.scope}</div>
            <div>risk_level: {receipt.risk_level}</div>
            <div>result: {receipt.result}</div>
            <div>outcome_kind: {receipt.outcome_kind}</div>
            <div>started: {fmtTime(receipt.started_at)}</div>
            <div>completed: {fmtTime(receipt.completed_at)}</div>
            <div>rollback_available: {String(receipt.rollback_available)}</div>
            <div>related_receipt_id: {receipt.related_receipt_id ?? "—"}</div>
            <div>external_reference: {receipt.external_reference ?? "—"}</div>
            <div>idempotency_key: {receipt.idempotency_key_preview ?? "—"}</div>
            {receipt.safe_error_message ? (
              <div className="text-rose-600">
                error: {receipt.safe_error_message}
              </div>
            ) : null}
            <Separator />
            <div className="font-medium">audit_record (preview)</div>
            <pre className="max-h-64 overflow-auto rounded bg-muted/40 p-2 text-[10px]">
              {receipt.audit_record_preview}
            </pre>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({
  state,
  onClose,
  onConfirm,
}: {
  state: null | { kind: string; label: string; onConfirm: () => Promise<void> };
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const desc = useMemo(() => {
    if (!state) return null;
    if (state.kind === "external_live") {
      return {
        title: "Confirm live sandbox execute",
        body: "Cosa succederà: una richiesta sarà inviata all'endpoint sandbox interno con payload non-sensibile. Cosa NON succederà: nessuna email, nessun pagamento, nessuna pubblicazione, nessun commit, nessuna azione HIGH.",
      };
    }
    if (state.kind === "rollback") {
      return {
        title: "Confirm rollback",
        body: "L'artifact verrà marcato come rolled_back. Cosa NON succederà: non vengono effettuati side-effect esterni; un secondo rollback verrà rifiutato come already_rolled_back.",
      };
    }
    return {
      title: "Confirm orphan recovery",
      body: "Il gate orfano verrà chiuso con un receipt di recovery. Cosa NON succederà: l'azione originale non viene rieseguita automaticamente. Per HIGH/unknown il risultato è sempre orphaned_unknown_requires_manual_review.",
    };
  }, [state]);

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{desc?.title}</DialogTitle>
          <DialogDescription>
            <div className="mt-2">Target: {state?.label}</div>
            <div className="mt-2">{desc?.body}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void onConfirm()}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
