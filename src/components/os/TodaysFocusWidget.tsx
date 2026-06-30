// Brain Hub v3.31 — Today's Focus widget
// Reads /api/priority-engine-data. Per-priority DataTrust shown inline.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Flame, Target } from "lucide-react";
import type {
  PrioritySourceKey,
  PriorityItem,
} from "@/lib/priority-engine/priority-engine";
import type {
  DataTrust,
  DataTrustStatus,
  SourceCriticality,
} from "@/lib/data-trust/types";

interface PerSourceEntry {
  status: DataTrustStatus;
  criticality: SourceCriticality;
  freshness: string | null;
  error_safe_message?: string;
}

interface TodaysFocusPayload {
  widget: DataTrust;
  priorities: PriorityItem[];
  per_source: Record<PrioritySourceKey, PerSourceEntry>;
  debug: {
    total_duration_ms: number;
    per_source_duration_ms: Record<PrioritySourceKey, number>;
    slow_source_threshold_ms: number;
    slow_source_warnings: string[];
    source_criticality: Record<PrioritySourceKey, SourceCriticality>;
    session_present: boolean;
  };
}

async function fetchTodaysFocus(): Promise<TodaysFocusPayload> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const res = await fetch("/api/priority-engine-data", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `${res.status}:${(body as { reason?: string }).reason ?? "fetch_failed"}`,
    );
  }
  const env = (await res.json()) as { data: TodaysFocusPayload };
  return env.data;
}

export function TodaysFocusWidget() {
  const q = useQuery({
    queryKey: ["priority-engine-data"],
    queryFn: fetchTodaysFocus,
    staleTime: 30_000,
  });

  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <header className="mb-3 flex items-center gap-2">
        <Target className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-medium">Today&apos;s Focus</h2>
        <StatusBadge
          status={
            q.isLoading
              ? "loading"
              : q.isError
                ? "error"
                : (q.data?.widget.status ?? "unknown")
          }
        />
        {q.data?.widget.confidence != null ? (
          <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            confidence {q.data.widget.confidence}/100
          </span>
        ) : null}
      </header>

      {q.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : q.isError ? (
        <p className="flex items-center gap-1 text-xs text-rose-600">
          <AlertTriangle className="h-3 w-3" /> Priority Engine unavailable.
        </p>
      ) : q.data?.widget.status === "error" ? (
        <div className="space-y-2 text-xs text-rose-600">
          <p className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Una fonte richiesta non è
            disponibile — priorità non calcolabili in modo affidabile.
          </p>
          {q.data?.widget.warnings?.length ? (
            <p className="text-[11px] text-rose-500/80">
              {q.data.widget.warnings.join(" · ")}
            </p>
          ) : null}
        </div>
      ) : q.data && q.data.priorities.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nessuna priorità operativa al momento.
        </p>
      ) : (
        <ul className="space-y-2">
          {q.data?.priorities.map((p) => (
            <li
              key={p.id}
              className="rounded border border-border/40 px-3 py-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm">
                    {p.severity === "high" ? (
                      <Flame className="h-3 w-3 text-rose-500" />
                    ) : null}
                    <span className="truncate font-medium">{p.title}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.reason}
                  </p>
                </div>
                <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {p.rule}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                src: {p.source_key} · conf {p.trust.confidence ?? "—"} ·{" "}
                {p.trust.calculation_method}
              </p>
            </li>
          ))}
        </ul>
      )}

      {q.data?.widget.warnings?.length &&
      q.data.widget.status !== "error" ? (
        <p className="mt-3 text-[10px] text-amber-600">
          warnings: {q.data.widget.warnings.join(" · ")}
        </p>
      ) : null}

      {q.data ? (
        <div className="mt-3 border-t border-border/30 pt-2 text-[10px] text-muted-foreground">
          <div>
            ⏱ {q.data.debug.total_duration_ms}ms total · threshold{" "}
            {q.data.debug.slow_source_threshold_ms}ms
            {q.data.debug.slow_source_warnings.length > 0
              ? ` · slow: ${q.data.debug.slow_source_warnings.join(", ")}`
              : ""}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {Object.entries(q.data.per_source).map(([k, v]) => (
              <span key={k}>
                {k}:{v.status} ({v.criticality})
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function StatusBadge({
  status,
}: {
  status: DataTrustStatus | "loading";
}) {
  const map: Record<DataTrustStatus | "loading", string> = {
    live: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    empty: "bg-muted text-muted-foreground border-border",
    missing:
      "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    unknown:
      "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
    loading: "bg-muted text-muted-foreground border-border",
    error:
      "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  };
  return (
    <span
      className={`ml-auto inline-block rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${map[status]}`}
    >
      {status}
    </span>
  );
}
