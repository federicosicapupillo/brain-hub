import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { logs } from "@/lib/demo-data";
import { FileText, GitBranch, RefreshCw, Bot, AlertTriangle, CircleDot } from "lucide-react";

export const Route = createFileRoute("/_authenticated/logs")({
  head: () => ({ meta: [{ title: "Logs — AI Brain" }] }),
  component: LogsPage,
});

const ICONS = {
  documento: FileText,
  nodo: CircleDot,
  collegamento: GitBranch,
  sync: RefreshCw,
  agente: Bot,
  errore: AlertTriangle,
};
const TINT: Record<string, string> = {
  documento: "text-violet-300",
  nodo: "text-cyan-300",
  collegamento: "text-pink-300",
  sync: "text-emerald-300",
  agente: "text-amber-300",
  errore: "text-red-400",
};

function LogsPage() {
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Logs" subtitle="Cronologia delle attività del tuo brain." />
      <div className="overflow-hidden rounded-2xl border border-border bg-card/40 glass">
        <ul className="divide-y divide-border/60">
          {logs.map((l) => {
            const Icon = ICONS[l.type];
            return (
              <li key={l.id} className="flex items-start gap-3 p-3 text-sm">
                <div className={`mt-0.5 ${TINT[l.type]}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{l.message}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(l.at).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" })} · {l.type}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
