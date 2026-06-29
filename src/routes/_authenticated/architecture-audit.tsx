import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import auditSnapshot from "@/architecture-audit/snapshots/brainhub-os-audit-phase1.json";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/architecture-audit")({
  head: () => ({
    meta: [{ title: "Architecture Audit — Brain Hub OS" }],
  }),
  component: ArchitectureAuditPage,
});

type Snapshot = typeof auditSnapshot;

const LIVE_TABLES = [
  "agent_tool_contracts",
  "governance_action_levels",
  "brain_graph_relation_candidates",
  "architecture_audit_runs",
] as const;

function useTableCount(table: (typeof LIVE_TABLES)[number]) {
  return useQuery({
    queryKey: ["arch-audit-table-count", table],
    queryFn: async () => {
      const { count, error } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 30_000,
  });
}

function LiveTableRow({ table }: { table: (typeof LIVE_TABLES)[number] }) {
  const q = useTableCount(table);
  return (
    <tr className="border-b border-border/40">
      <td className="py-2 px-3 font-mono text-sm">{table}</td>
      <td className="py-2 px-3 text-sm">
        {q.isLoading ? "…" : q.isError ? "error" : q.data}
      </td>
      <td className="py-2 px-3 text-xs text-muted-foreground">
        live · supabase
      </td>
    </tr>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const tone =
    value >= 90
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : value >= 70
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "bg-rose-500/10 text-rose-700 dark:text-rose-300";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${tone}`}>
      {value}
    </span>
  );
}

function ArchitectureAuditPage() {
  const snap = auditSnapshot as unknown as Snapshot;

  return (
    <div className="container mx-auto max-w-6xl space-y-8 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Architecture Audit · Phase 1</h1>
        <p className="text-sm text-muted-foreground">
          Snapshot statico read-only. Nessun dato viene rigenerato da questa
          pagina. Principio: {snap.principle}
        </p>
      </header>

      <section className="rounded-lg border border-border/60 bg-card p-4">
        <h2 className="mb-3 text-lg font-medium">Snapshot summary</h2>
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <Metric label="Routes" value={snap.route_registry.count.value} />
          <Metric label="Services" value={snap.service_registry.count.value} />
          <Metric label="Tables" value={snap.data_registry.count.value} />
          <Metric
            label="Route→lib edges"
            value={snap.dependency_map.route_to_lib.length}
          />
        </div>
      </section>

      <section className="rounded-lg border border-border/60 bg-card p-4">
        <h2 className="mb-3 text-lg font-medium">Foundation tables (live)</h2>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border/60 text-xs uppercase text-muted-foreground">
              <th className="py-2 px-3">Table</th>
              <th className="py-2 px-3">Rows</th>
              <th className="py-2 px-3">Source</th>
            </tr>
          </thead>
          <tbody>
            {LIVE_TABLES.map((t) => (
              <LiveTableRow key={t} table={t} />
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-border/60 bg-card p-4">
        <h2 className="mb-3 text-lg font-medium">Limits of audit</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {snap.limits_of_audit.map((l: string) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-border/60 bg-card p-4">
        <h2 className="mb-3 text-lg font-medium">OS Target Map (inferred)</h2>
        <div className="space-y-3">
          {snap.os_target_map.layers.map((layer) => (
            <div
              key={layer.layer.value as string}
              className="rounded border border-border/40 p-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm">
                  {layer.layer.value as string}
                </span>
                <ConfidenceBadge value={layer.layer.confidence} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {layer.layer.note ?? layer.layer.source}
              </p>
              <p className="mt-2 text-xs">
                modules:{" "}
                <span className="font-mono">
                  {(layer.modules.value as string[]).join(", ")}
                </span>
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border/60 bg-card p-4">
        <h2 className="mb-3 text-lg font-medium">Snapshot JSON</h2>
        <pre className="max-h-96 overflow-auto rounded bg-muted/40 p-3 text-xs">
          {JSON.stringify(snap, null, 2)}
        </pre>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border border-border/40 p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{String(value)}</div>
    </div>
  );
}
