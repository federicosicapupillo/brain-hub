import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { connectors } from "@/lib/demo-data";
import * as Icons from "lucide-react";
import { RefreshCw, Settings as Cog } from "lucide-react";

export const Route = createFileRoute("/connettori")({
  head: () => ({ meta: [{ title: "Connettori — AI Brain" }] }),
  component: ConnectorsPage,
});

function ConnectorsPage() {
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Connettori" subtitle="Collega le tue fonti esterne al second brain." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {connectors.map((c) => {
          const Icon = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[c.icon] ?? Icons.Plug;
          const statusBadge =
            c.status === "connected" ? (
              <Badge className="border-emerald-500/40 bg-emerald-500/15 text-emerald-300">collegato</Badge>
            ) : c.status === "error" ? (
              <Badge variant="destructive">errore</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">non collegato</Badge>
            );
          return (
            <Card key={c.id} className="flex flex-col gap-3 border-border/70 bg-card/60 p-4 glass">
              <div className="flex items-start gap-3">
                <div
                  className="grid h-10 w-10 place-items-center rounded-lg"
                  style={{ background: `color-mix(in oklab, ${c.color} 20%, transparent)`, color: c.color }}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate font-medium">{c.name}</div>
                    {statusBadge}
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{c.description}</p>
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Ultimo sync:{" "}
                {c.lastSync ? new Date(c.lastSync).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "—"}
              </div>
              <div className="mt-auto flex gap-2">
                <Button size="sm" variant="outline" className="flex-1">
                  <Cog className="mr-1 h-3.5 w-3.5" /> Configura
                </Button>
                <Button size="sm" className="flex-1 bg-gradient-primary text-primary-foreground">
                  <RefreshCw className="mr-1 h-3.5 w-3.5" /> Sincronizza
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
