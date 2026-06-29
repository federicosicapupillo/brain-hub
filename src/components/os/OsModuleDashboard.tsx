// Brain Hub v3.28 — OS dashboard shared components (read-only).

import { useQuery } from "@tanstack/react-query";
import type { OsModuleDerived, OsModuleStatus } from "@/lib/os/os-modules";

export interface OsModuleMapResponse {
  modules: OsModuleDerived[];
}

export function useOsModuleMap() {
  return useQuery<OsModuleMapResponse>({
    queryKey: ["os-module-map"],
    queryFn: async () => {
      const res = await fetch("/api/os-module-map");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          `governance_denied:${res.status}:${(body as { reason?: string }).reason ?? "unknown"}`,
        );
      }
      return (await res.json()) as OsModuleMapResponse;
    },
    staleTime: 60_000,
  });
}

export function OsStatusBadge({ status }: { status: OsModuleStatus }) {
  const map: Record<OsModuleStatus, { label: string; cls: string }> = {
    active: {
      label: "active",
      cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    },
    partial: {
      label: "partial",
      cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    },
    empty: {
      label: "empty",
      cls: "bg-muted text-muted-foreground border-border",
    },
    future: {
      label: "future",
      cls: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
    },
  };
  const m = map[status];
  return (
    <span
      className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${m.cls}`}
    >
      {m.label}
    </span>
  );
}

export function OsModuleDashboard({ moduleId }: { moduleId: string }) {
  const q = useOsModuleMap();

  if (q.isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading module…</div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="p-6 text-sm text-rose-600">
        Module map unavailable: {(q.error as Error | undefined)?.message ?? "unknown error"}
      </div>
    );
  }

  const mod = q.data.modules.find((m) => m.id === moduleId);
  if (!mod) {
    return (
      <div className="p-6 text-sm text-rose-600">Module {moduleId} not found.</div>
    );
  }

  const isFuture = mod.status === "future" || mod.status === "empty";

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{mod.name}</h1>
          <OsStatusBadge status={mod.status} />
        </div>
        <p className="text-sm text-muted-foreground">{mod.description}</p>
        {mod.target_layer ? (
          <p className="text-xs text-muted-foreground">
            OS target layer: <span className="font-mono">{mod.target_layer}</span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Nessun layer in os_target_map: status default <span className="font-mono">future</span>.
          </p>
        )}
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <RegistryCard title="Routes" items={mod.routes} />
        <RegistryCard title="Services" items={mod.services} />
        <RegistryCard title="Tables" items={mod.tables} />
      </div>

      {isFuture ? (
        <section className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4">
          <h2 className="text-sm font-medium">Coming in future patches</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Questo modulo è {mod.status === "future" ? "pianificato" : "vuoto"} secondo
            l'audit corrente. Le funzionalità saranno aggregate qui appena
            disponibili nei registry.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function RegistryCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nessun elemento censito.</p>
      ) : (
        <ul className="space-y-1">
          {items.slice(0, 30).map((it) => (
            <li key={it} className="truncate font-mono text-xs">
              {it}
            </li>
          ))}
          {items.length > 30 ? (
            <li className="text-xs text-muted-foreground">
              +{items.length - 30} altri…
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
