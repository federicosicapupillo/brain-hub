import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { agents, brainById } from "@/lib/demo-data";
import { Bot, Play, Pause, MessageSquare } from "lucide-react";

export const Route = createFileRoute("/agents")({
  head: () => ({ meta: [{ title: "Agents — AI Brain" }] }),
  component: AgentsPage,
});

function AgentsPage() {
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Agents" subtitle="Gestisci gli agenti AI collegati ai tuoi cervelli." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => {
          const brain = brainById(a.brainId);
          return (
            <Card key={a.id} className="flex flex-col gap-3 border-border/70 bg-card/60 p-4 glass">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-primary glow-violet">
                  <Bot className="h-5 w-5 text-primary-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate font-medium">{a.name}</div>
                    {a.status === "attivo" ? (
                      <Badge className="border-emerald-500/40 bg-emerald-500/15 text-emerald-300">attivo</Badge>
                    ) : a.status === "errore" ? (
                      <Badge variant="destructive">errore</Badge>
                    ) : (
                      <Badge variant="outline">idle</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{a.role}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ background: brain?.color }} />
                {brain?.name}
                <span className="ml-auto">
                  {new Date(a.lastActivity).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </div>
              <div className="mt-auto flex gap-2">
                <Button size="sm" variant="outline" className="flex-1">
                  <MessageSquare className="mr-1 h-3.5 w-3.5" /> Chiedi
                </Button>
                <Button size="sm" className="flex-1 bg-gradient-primary text-primary-foreground">
                  {a.status === "attivo" ? <><Pause className="mr-1 h-3.5 w-3.5" /> Pausa</> : <><Play className="mr-1 h-3.5 w-3.5" /> Avvia</>}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
