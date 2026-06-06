import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { logs, agents, brainById } from "@/lib/demo-data";
import { Card } from "@/components/ui/card";
import { Activity } from "lucide-react";

export const Route = createFileRoute("/_authenticated/live")({
  head: () => ({ meta: [{ title: "Live — AI Brain" }] }),
  component: LivePage,
});

function LivePage() {
  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="Live"
        subtitle="Cosa sta facendo il tuo brain in questo momento."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse-glow rounded-full bg-emerald-400 text-emerald-400" />
            Streaming attivo
          </span>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card className="border-border/70 bg-card/60 p-4 glass">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Activity className="h-4 w-4 text-accent" /> Eventi recenti
          </div>
          <ul className="space-y-2">
            {logs.slice(0, 12).map((l) => (
              <li key={l.id} className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/40 p-3 text-sm">
                <div className="h-2 w-2 translate-y-1.5 rounded-full bg-gradient-primary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{l.message}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(l.at).toLocaleString("it-IT")}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="border-border/70 bg-card/60 p-4 glass">
          <div className="mb-3 text-sm font-medium">Agenti attivi</div>
          <ul className="space-y-2">
            {agents.filter((a) => a.status === "attivo").map((a) => {
              const brain = brainById(a.brainId);
              return (
                <li key={a.id} className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 p-3 text-sm">
                  <span className="h-2 w-2 animate-pulse-glow rounded-full" style={{ background: brain?.color, color: brain?.color }} />
                  <div className="min-w-0">
                    <div className="truncate text-sm">{a.name}</div>
                    <div className="text-[11px] text-muted-foreground">{a.role}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}
