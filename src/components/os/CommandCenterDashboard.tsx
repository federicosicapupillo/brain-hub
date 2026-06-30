// Brain Hub v3.29 — Command Center dashboard (read-only).
// All data comes from /api/command-center-data, gated by the Governance
// Evaluator. Each widget displays an honest WidgetState.

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

type Availability = "live" | "empty" | "missing" | "unknown";
type WidgetState = Availability | "loading" | "error";

interface Source<T> {
  availability: Availability;
  data: T[] | null;
  error?: string;
}

interface ConnectorStatus {
  availability: Availability;
  connected: boolean | null;
  detail?: string;
}

interface SystemStatus {
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
  projects: Source<{
    id: string;
    title: string;
    status: string | null;
    link_type: string;
    updated_at: string;
  }>;
  action_queue: Source<{
    id: string;
    title: string;
    status: string;
    priority: string;
    risk_level: string;
    requires_confirmation: boolean;
    created_at: string;
  }>;
  result_review: Source<{
    id: string;
    title: string;
    review_status: string;
    source_type: string;
    risk_level: string | null;
    created_at: string;
  }>;
  agent_runs: Source<{
    id: string;
    objective: string;
    run_status: string;
    run_mode: string;
    risk_level: string;
    created_at: string;
  }>;
  connectors: {
    gmail: ConnectorStatus;
    github: ConnectorStatus;
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

  const state: WidgetState = q.isLoading
    ? "loading"
    : q.isError
      ? "error"
      : "live";

  const d = q.data;

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Command Center</h1>
        <p className="text-sm text-muted-foreground">
          Cosa sta succedendo e cosa devi fare ora. Tutti i dati sono read-only
          e passano dal Governance Evaluator.
        </p>
      </header>

      <SystemStatusCard state={state} status={d?.system_status} />

      <div className="grid gap-4 lg:grid-cols-2">
        <WidgetCard
          title="Projects Overview"
          icon={<FolderKanban className="h-4 w-4" />}
          state={state === "live" ? d!.projects.availability : state}
          empty="No projects yet"
          missing="Projects module not connected"
          unknown="Projects data not verified"
          error={q.error instanceof Error ? q.error.message : undefined}
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
          state={state === "live" ? d!.action_queue.availability : state}
          empty="No pending actions"
          missing="Action Queue not connected"
          unknown="Action Queue data not verified"
          error={q.error instanceof Error ? q.error.message : undefined}
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
          state={state === "live" ? d!.result_review.availability : state}
          empty="No results to review"
          missing="Result Review not connected"
          unknown="Result Review data not verified"
          error={q.error instanceof Error ? q.error.message : undefined}
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
          state={state === "live" ? d!.agent_runs.availability : state}
          empty="No agent activity yet"
          missing="Agent Center not connected"
          unknown="Agent activity data not verified"
          error={q.error instanceof Error ? q.error.message : undefined}
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
        state={state}
        gmail={d?.connectors.gmail}
        github={d?.connectors.github}
      />
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
        <p className="text-xs text-rose-600">System status unavailable.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Governance" value={status.governance_confidence != null ? `${Math.round(status.governance_confidence * 100)}%` : "—"} />
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
      )}
    </section>
  );
}

function ConnectorsCard({
  state,
  gmail,
  github,
}: {
  state: WidgetState;
  gmail?: ConnectorStatus;
  github?: ConnectorStatus;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <header className="mb-3 flex items-center gap-2">
        <PlugZap className="h-4 w-4" />
        <h2 className="text-sm font-medium">Connectors Status</h2>
        <StateBadge state={state} />
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        <ConnectorRow label="Gmail" status={gmail} state={state} />
        <ConnectorRow label="GitHub" status={github} state={state} />
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
  status?: ConnectorStatus;
  state: WidgetState;
}) {
  let text = "Unknown";
  let tone = "text-muted-foreground";
  if (state === "loading") text = "Loading…";
  else if (state === "error" || !status) {
    text = "Unknown";
  } else if (status.connected === true) {
    text = "Connected";
    tone = "text-emerald-600";
  } else if (status.connected === false) {
    text = "Not connected";
    tone = "text-amber-600";
  }
  return (
    <div className="flex items-center justify-between rounded border border-border/60 px-3 py-2 text-sm">
      <span className="font-medium">{label}</span>
      <span className={`text-xs ${tone}`}>{text}</span>
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
  empty,
  missing,
  unknown,
  error,
  children,
}: {
  title: string;
  icon: ReactNode;
  state: WidgetState;
  empty: string;
  missing: string;
  unknown: string;
  error?: string;
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
          <AlertTriangle className="h-3 w-3" /> {error ?? "Fetch error"}
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
    </section>
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
