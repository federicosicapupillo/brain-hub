// Brain Hub v3.30.1 — Command Center dashboard (read-only).
// All data comes from /api/command-center-data with explicit per-widget
// provenance (status, source_tables, source_function, last_updated,
// confidence, warnings, duration_ms). Partial failures degrade per widget.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Inbox,
  ListChecks,
  PlugZap,
  ShieldCheck,
  Bot,
  FolderKanban,
} from "lucide-react";
import type { ReactNode } from "react";

type WidgetStatus = "live" | "empty" | "missing" | "unknown" | "error";
type WidgetState = WidgetStatus | "loading";

interface WidgetProvenance {
  status: WidgetStatus;
  source_tables: string[];
  source_function: string;
  last_updated: string | null;
  confidence: number | null;
  warnings: string[];
  duration_ms: number;
  error_safe_message?: string;
}

interface Widget<T> extends WidgetProvenance {
  data: T[] | null;
}

interface ConnectorWidget extends WidgetProvenance {
  connected: boolean | null;
}

interface SystemStatus extends WidgetProvenance {
  governance_confidence: number | null;
  modules_active: number;
  modules_partial: number;
  modules_empty: number;
  modules_future: number;
  last_audit_at: string | null;
  last_enforcement_at: string | null;
}

interface CommandCenterData {
  system_status: SystemStatus;
  projects: Widget<{
    id: string;
    title: string;
    status: string | null;
    link_type: string;
    updated_at: string;
  }>;
  action_queue: Widget<{
    id: string;
    title: string;
    status: string;
    priority: string;
    risk_level: string;
    requires_confirmation: boolean;
    created_at: string;
  }>;
  result_review: Widget<{
    id: string;
    title: string;
    review_status: string;
    source_type: string;
    risk_level: string | null;
    created_at: string;
  }>;
  agent_runs: Widget<{
    id: string;
    objective: string;
    run_status: string;
    run_mode: string;
    risk_level: string;
    created_at: string;
  }>;
  connectors: { gmail: ConnectorWidget; github: ConnectorWidget };
  debug: {
    total_duration_ms: number;
    per_widget_duration_ms: Record<string, number>;
    slow_widget_threshold_ms: number;
    slow_widget_warnings: string[];
  };
}

interface Envelope {
  data: CommandCenterData;
}

async function fetchCommandCenter(): Promise<CommandCenterData> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const res = await fetch("/api/command-center-data", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `${res.status}:${(body as { reason?: string }).reason ?? "fetch_failed"}`,
    );
  }
  const env = (await res.json()) as Envelope;
  return env.data;
}

export function CommandCenterDashboard() {
  const q = useQuery({
    queryKey: ["command-center-data"],
    queryFn: fetchCommandCenter,
    staleTime: 30_000,
  });

  const loading = q.isLoading;
  const globalError = q.isError;
  const d = q.data;

  const widgetState = (w?: WidgetProvenance): WidgetState =>
    loading ? "loading" : globalError ? "error" : (w?.status ?? "unknown");

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Command Center</h1>
        <p className="text-sm text-muted-foreground">
          Cosa sta succedendo e cosa devi fare ora. Tutti i dati sono read-only
          e passano dal Governance Evaluator.
        </p>
      </header>

      <SystemStatusCard
        state={widgetState(d?.system_status)}
        status={d?.system_status}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <WidgetCard
          title="Projects Overview"
          icon={<FolderKanban className="h-4 w-4" />}
          state={widgetState(d?.projects)}
          provenance={d?.projects}
          empty="No projects yet"
          missing="Projects module not connected"
          unknown="Projects data not verified"
        >
          {d?.projects.data?.map((p) => (
            <Row
              key={p.id}
              left={p.title}
              right={p.status ?? "—"}
              meta={new Date(p.updated_at).toLocaleString()}
            />
          ))}
        </WidgetCard>

        <WidgetCard
          title="Action Queue"
          icon={<ListChecks className="h-4 w-4" />}
          state={widgetState(d?.action_queue)}
          provenance={d?.action_queue}
          empty="No pending actions"
          missing="Action Queue not connected"
          unknown="Action Queue data not verified"
        >
          {d?.action_queue.data?.map((a) => (
            <Row
              key={a.id}
              left={a.title}
              right={`${a.status} · ${a.priority}`}
              meta={`risk ${a.risk_level}${a.requires_confirmation ? " · confirm" : ""}`}
            />
          ))}
        </WidgetCard>

        <WidgetCard
          title="Result Review"
          icon={<Inbox className="h-4 w-4" />}
          state={widgetState(d?.result_review)}
          provenance={d?.result_review}
          empty="No results to review"
          missing="Result Review not connected"
          unknown="Result Review data not verified"
        >
          {d?.result_review.data?.map((r) => (
            <Row
              key={r.id}
              left={r.title}
              right={r.review_status}
              meta={`${r.source_type}${r.risk_level ? ` · ${r.risk_level}` : ""}`}
            />
          ))}
        </WidgetCard>

        <WidgetCard
          title="Agent Activity"
          icon={<Bot className="h-4 w-4" />}
          state={widgetState(d?.agent_runs)}
          provenance={d?.agent_runs}
          empty="No agent activity yet"
          missing="Agent Center not connected"
          unknown="Agent activity data not verified"
        >
          {d?.agent_runs.data?.map((r) => (
            <Row
              key={r.id}
              left={r.objective}
              right={`${r.run_status} · ${r.run_mode}`}
              meta={`risk ${r.risk_level}`}
            />
          ))}
        </WidgetCard>
      </div>

      <ConnectorsCard
        loading={loading}
        globalError={globalError}
        gmail={d?.connectors.gmail}
        github={d?.connectors.github}
      />

      {d?.debug ? (
        <p className="text-[10px] text-muted-foreground">
          ⏱ {d.debug.total_duration_ms}ms total · threshold{" "}
          {d.debug.slow_widget_threshold_ms}ms
          {d.debug.slow_widget_warnings.length > 0
            ? ` · slow: ${d.debug.slow_widget_warnings.join(", ")}`
            : ""}
        </p>
      ) : null}
    </div>
  );
}

function SystemStatusCard({
  state,
  status,
}: {
  state: WidgetState;
  status?: SystemStatus;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <header className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-emerald-500" />
        <h2 className="text-sm font-medium">System Status</h2>
        <StateBadge state={state} />
      </header>
      {state === "loading" ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : state === "error" || !status ? (
        <p className="text-xs text-rose-600">
          {status?.error_safe_message ?? "System status unavailable."}
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric
              label="Governance"
              value={
                status.governance_confidence != null
                  ? `${Math.round(status.governance_confidence * 100)}%`
                  : "—"
              }
            />
            <Metric label="Active" value={String(status.modules_active)} />
            <Metric label="Partial" value={String(status.modules_partial)} />
            <Metric label="Empty" value={String(status.modules_empty)} />
            <Metric label="Future" value={String(status.modules_future)} />
            <Metric
              label="Last audit"
              value={
                status.last_audit_at
                  ? new Date(status.last_audit_at).toLocaleDateString()
                  : "—"
              }
            />
          </div>
          <ProvenanceFooter w={status} />
        </>
      )}
    </section>
  );
}

function ConnectorsCard({
  loading,
  globalError,
  gmail,
  github,
}: {
  loading: boolean;
  globalError: boolean;
  gmail?: ConnectorWidget;
  github?: ConnectorWidget;
}) {
  const resolve = (w?: ConnectorWidget): WidgetState =>
    loading ? "loading" : globalError ? "error" : (w?.status ?? "unknown");
  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <header className="mb-3 flex items-center gap-2">
        <PlugZap className="h-4 w-4" />
        <h2 className="text-sm font-medium">Connectors Status</h2>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        <ConnectorRow label="Gmail" status={gmail} state={resolve(gmail)} />
        <ConnectorRow label="GitHub" status={github} state={resolve(github)} />
      </div>
    </section>
  );
}

function ConnectorRow({
  label,
  status,
  state,
}: {
  label: string;
  status?: ConnectorWidget;
  state: WidgetState;
}) {
  let text = "Unknown";
  let tone = "text-muted-foreground";
  if (state === "loading") text = "Loading…";
  else if (state === "error") {
    text = status?.error_safe_message ?? "Error";
    tone = "text-rose-600";
  } else if (status?.connected === true) {
    text = "Connected";
    tone = "text-emerald-600";
  } else if (status?.connected === false) {
    text = "Not connected";
    tone = "text-amber-600";
  }
  return (
    <div className="rounded border border-border/60 px-3 py-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="flex items-center gap-2">
          <StateBadge state={state} />
          <span className={`text-xs ${tone}`}>{text}</span>
        </span>
      </div>
      {status ? <ProvenanceFooter w={status} /> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function Row({
  left,
  right,
  meta,
}: {
  left: string;
  right: string;
  meta?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/40 py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-sm">{left}</p>
        {meta ? (
          <p className="truncate text-xs text-muted-foreground">{meta}</p>
        ) : null}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{right}</span>
    </div>
  );
}

function WidgetCard({
  title,
  icon,
  state,
  provenance,
  empty,
  missing,
  unknown,
  children,
}: {
  title: string;
  icon: ReactNode;
  state: WidgetState;
  provenance?: WidgetProvenance;
  empty: string;
  missing: string;
  unknown: string;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <header className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-medium">{title}</h2>
        <StateBadge state={state} />
      </header>
      {state === "loading" ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : state === "error" ? (
        <p className="flex items-center gap-1 text-xs text-rose-600">
          <AlertTriangle className="h-3 w-3" />{" "}
          {provenance?.error_safe_message ?? "Fetch error"}
        </p>
      ) : state === "empty" ? (
        <EmptyHint icon="check" text={empty} />
      ) : state === "missing" ? (
        <EmptyHint icon="dash" text={missing} />
      ) : state === "unknown" ? (
        <EmptyHint icon="warn" text={unknown} />
      ) : (
        <div className="space-y-0.5">{children}</div>
      )}
      {provenance && state !== "loading" ? (
        <ProvenanceFooter w={provenance} />
      ) : null}
    </section>
  );
}

function ProvenanceFooter({ w }: { w: WidgetProvenance }) {
  return (
    <p className="mt-3 border-t border-border/30 pt-2 text-[10px] text-muted-foreground">
      src: {w.source_function} · tables:{" "}
      {w.source_tables.length > 0 ? w.source_tables.join(",") : "—"} ·
      confidence: {w.confidence == null ? "—" : w.confidence.toFixed(2)} · ⏱{" "}
      {w.duration_ms}ms · updated:{" "}
      {w.last_updated ? new Date(w.last_updated).toLocaleString() : "—"}
      {w.warnings.length > 0 ? ` · warn: ${w.warnings.join(",")}` : ""}
    </p>
  );
}

function EmptyHint({
  icon,
  text,
}: {
  icon: "check" | "dash" | "warn";
  text: string;
}) {
  const I =
    icon === "check"
      ? CheckCircle2
      : icon === "warn"
        ? AlertTriangle
        : CircleDashed;
  const tone =
    icon === "check"
      ? "text-emerald-600"
      : icon === "warn"
        ? "text-amber-600"
        : "text-muted-foreground";
  return (
    <p className={`flex items-center gap-2 text-xs ${tone}`}>
      <I className="h-3 w-3" /> {text}
    </p>
  );
}

function StateBadge({ state }: { state: WidgetState }) {
  const map: Record<WidgetState, { label: string; cls: string }> = {
    live: {
      label: "live",
      cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    },
    empty: {
      label: "empty",
      cls: "bg-muted text-muted-foreground border-border",
    },
    missing: {
      label: "missing",
      cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    },
    unknown: {
      label: "unknown",
      cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
    },
    loading: {
      label: "loading",
      cls: "bg-muted text-muted-foreground border-border",
    },
    error: {
      label: "error",
      cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
    },
  };
  const m = map[state];
  return (
    <span
      className={`ml-auto inline-block rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${m.cls}`}
    >
      {m.label}
    </span>
  );
}
