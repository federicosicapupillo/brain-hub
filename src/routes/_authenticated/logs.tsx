import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Activity } from "lucide-react";
import { toast } from "sonner";
import { listLogs, type AppLog } from "@/lib/workspace-api";

export const Route = createFileRoute("/_authenticated/logs")({
  head: () => ({ meta: [{ title: "Logs — AI Brain" }] }),
  component: LogsPage,
});

const SEVERITY_TINT: Record<string, string> = {
  info: "text-cyan-300", warning: "text-amber-300", error: "text-red-400", success: "text-emerald-300",
};

function LogsPage() {
  const [items, setItems] = useState<AppLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { setItems(await listLogs(200)); }
      catch (e) { toast.error(e instanceof Error ? e.message : "Errore"); }
      finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Logs" subtitle="Cronologia delle attività del tuo brain." />
      {loading ? (
        <Empty>Caricamento…</Empty>
      ) : items.length === 0 ? (
        <Empty>Nessun log ancora. Le azioni che farai compariranno qui.</Empty>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card/40 glass">
          <ul className="divide-y divide-border/60">
            {items.map((l) => (
              <li key={l.id} className="flex items-start gap-3 p-3 text-sm">
                <div className={`mt-0.5 ${SEVERITY_TINT[l.severity] ?? "text-muted-foreground"}`}>
                  <Activity className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{l.message}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(l.created_at).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" })} · {l.action}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card/40 p-10 text-sm text-muted-foreground glass">{children}</div>;
}
