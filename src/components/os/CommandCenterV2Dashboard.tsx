// Brain Hub v3.34 — Command Center v2 dashboard.
//
// Operational core view: Today's Focus → Suggested → Prepared →
// Waiting Confirmation → Recent Executions, plus a separate Blocked
// panel that is as prominent as the operational columns (Principio 4 —
// Honest State). Pure presentation: every shape is decided by
// /api/command-center-v2-data.

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  CommandCenterV2Data,
  ColumnEnvelope,
  PreparedAction,
  WaitingConfirmation,
  ExecutedItem,
} from "@/routes/api/command-center-v2-data";
import type { SuggestedAction } from "@/lib/command-center-v2/suggested-actions";
import type { BlockedItem } from "@/lib/command-center-v2/suggested-actions";
import type { PriorityItem } from "@/lib/priority-engine/priority-engine";
import type { RiskLevel } from "@/lib/command-center-v2/risk-model";
import type { DataTrust } from "@/lib/data-trust/types";

const STATUS_TONE: Record<string, string> = {
  live: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  empty: "bg-slate-500/15 text-slate-700 border-slate-500/30",
  missing: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  unknown: "bg-slate-500/15 text-slate-700 border-slate-500/30",
  error: "bg-rose-500/15 text-rose-700 border-rose-500/30",
};
const RISK_TONE: Record<RiskLevel, string> = {
  low: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  medium: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  high: "bg-rose-500/10 text-rose-700 border-rose-500/30",
  critical: "bg-rose-700/15 text-rose-800 border-rose-700/40",
};

async function fetchV2(): Promise<CommandCenterV2Data> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token ?? "";
  const res = await fetch("/api/command-center-v2-data", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`command-center-v2-data ${res.status}: ${body.slice(0, 160)}`);
  }
  const json = (await res.json()) as { data: CommandCenterV2Data };
  return json.data;
}

function useCommandCenterV2() {
  return useQuery({
    queryKey: ["command-center-v2-data"],
    queryFn: fetchV2,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

function Provenance({ env }: { env: ColumnEnvelope<unknown> }) {
  return (
    <div className="mt-2 border-t border-border/50 pt-2 text-[10px] text-muted-foreground">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        <span>status: {env.status}</span>
        <span>confidence: {env.confidence ?? "n/a"}</span>
        <span>{env.duration_ms}ms</span>
      </div>
      <div className="truncate">src: {env.source_function}</div>
      {env.error_safe_message ? (
        <div className="text-rose-600">err: {env.error_safe_message}</div>
      ) : null}
    </div>
  );
}

function ColumnCard<T>({
  title,
  env,
  empty,
  render,
}: {
  title: string;
  env: ColumnEnvelope<T>;
  empty: string;
  render: (item: T) => React.ReactNode;
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>{title}</span>
          <Badge variant="outline" className={STATUS_TONE[env.status] ?? ""}>
            {env.status}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 space-y-2">
        {env.items.length === 0 ? (
          <p className="text-xs text-muted-foreground">{empty}</p>
        ) : (
          <ul className="space-y-2">
            {env.items.map((it, i) => (
              <li
                key={i}
                className="rounded-md border border-border/60 bg-background/40 p-2 text-xs"
              >
                {render(it)}
              </li>
            ))}
          </ul>
        )}
        <Provenance env={env} />
      </CardContent>
    </Card>
  );
}

function TrustLine({ trust }: { trust: DataTrust | null | undefined }) {
  if (!trust) return null;
  return (
    <span className="text-[10px] text-muted-foreground">
      {trust.status} · {trust.confidence}
    </span>
  );
}

export function CommandCenterV2Dashboard() {
  const q = useCommandCenterV2();

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Command Center v2</h1>
          <p className="text-xs text-muted-foreground">
            Read → Suggest → Prepare → Confirm → Execute. Real Execute per MEDIUM/HIGH è
            fuori scope in v3.34.
          </p>
        </div>
        <Link to="/os/command-center" className="text-xs underline text-muted-foreground">
          v1 (legacy)
        </Link>
      </div>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      ) : q.isError ? (
        <p className="text-sm text-rose-600">
          Errore: {(q.error as Error).message}
        </p>
      ) : !q.data ? null : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <ColumnCard<PriorityItem>
              title="Today's Focus"
              env={q.data.todays_focus}
              empty="Nessuna priorità."
              render={(p) => (
                <>
                  <div className="font-medium">{p.title}</div>
                  <div className="text-muted-foreground">{p.reason}</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span>{p.rule}</span>
                    <TrustLine trust={p.trust} />
                  </div>
                </>
              )}
            />
            <ColumnCard<SuggestedAction>
              title="Suggested Actions"
              env={q.data.suggested_actions}
              empty="Nessuna azione suggerita."
              render={(s) => (
                <>
                  <div className="font-medium">{s.title}</div>
                  <div className="text-muted-foreground">{s.reason}</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span>{s.action_type}</span>
                    <Badge variant="outline" className={RISK_TONE[s.risk_level]}>
                      {s.risk_level}
                    </Badge>
                  </div>
                </>
              )}
            />
            <ColumnCard<PreparedAction>
              title="Prepared Actions"
              env={q.data.prepared_actions}
              empty="Nessuna azione preparata."
              render={(p) => (
                <>
                  <div className="font-medium">{p.title}</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span>{p.action_type}</span>
                    <Badge variant="outline" className={RISK_TONE[p.risk_level]}>
                      {p.risk_level}
                    </Badge>
                  </div>
                </>
              )}
            />
            <ColumnCard<WaitingConfirmation>
              title="Waiting Confirmation"
              env={q.data.waiting_confirmation}
              empty="Nessuna azione in attesa di conferma."
              render={(w) => (
                <>
                  <div className="font-medium">{w.title}</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span>{w.action_type}</span>
                    <Badge variant="outline" className={RISK_TONE[w.risk_level]}>
                      {w.risk_level}
                    </Badge>
                  </div>
                  <div className="mt-1 text-[10px] text-amber-700">
                    Execute reale fuori scope v3.34
                  </div>
                </>
              )}
            />
            <ColumnCard<ExecutedItem>
              title="Recent Executions"
              env={q.data.recent_executions}
              empty="Nessuna esecuzione recente."
              render={(e) => (
                <>
                  <div className="font-medium">{e.title}</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span>
                      {e.kind} · {e.status}
                    </span>
                    <Badge variant="outline" className={RISK_TONE[e.risk_level]}>
                      {e.risk_level}
                    </Badge>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {e.executed_at ?? "—"}
                  </div>
                </>
              )}
            />
          </div>

          {/* Blocked panel — same visual prominence (Principio 4) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>Blocked</span>
                <Badge variant="outline" className={STATUS_TONE[q.data.blocked.status]}>
                  {q.data.blocked.status} · {q.data.blocked.items.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {q.data.blocked.items.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nessun blocco rilevato.
                </p>
              ) : (
                <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {q.data.blocked.items.map((b: BlockedItem) => (
                    <li
                      key={b.id}
                      className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{b.title}</span>
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/30">
                          {b.reason_kind}
                        </Badge>
                      </div>
                      <div className="text-muted-foreground">{b.detail}</div>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">
                          {b.source_key}
                          {b.source_id ? ` · ${b.source_id}` : ""}
                        </span>
                        <TrustLine trust={b.trust} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <Provenance env={q.data.blocked} />
            </CardContent>
          </Card>

          {/* Debug / performance bar */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Performance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-[11px] text-muted-foreground">
              <div>
                total: {q.data.debug.total_duration_ms}ms · threshold:{" "}
                {q.data.debug.slow_source_threshold_ms}ms · session:{" "}
                {q.data.debug.session_present ? "yes" : "no"}
              </div>
              {q.data.debug.slow_source_warnings.length > 0 ? (
                <div className="text-amber-700">
                  slow: {q.data.debug.slow_source_warnings.join(", ")}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-x-3">
                {Object.entries(q.data.debug.per_source_duration_ms).map(([k, v]) => (
                  <span key={k}>
                    {k}: {v}ms
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
