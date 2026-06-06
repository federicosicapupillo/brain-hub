import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity } from "lucide-react";
import { toast } from "sonner";
import { listLiveEvents, markLiveEventRead, type LiveEvent } from "@/lib/workspace-api";

export const Route = createFileRoute("/_authenticated/live")({
  head: () => ({ meta: [{ title: "Live — AI Brain" }] }),
  component: LivePage,
});

function LivePage() {
  const [items, setItems] = useState<LiveEvent[]>([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    try { setItems(await listLiveEvents(80)); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Errore"); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); const t = setInterval(reload, 15000); return () => clearInterval(t); }, []);

  async function markRead(id: string) {
    try { await markLiveEventRead(id); reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Errore"); }
  }

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
      <Card className="border-border/70 bg-card/60 p-4 glass">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Activity className="h-4 w-4 text-accent" /> Eventi recenti
        </div>
        {loading ? (
          <p className="p-4 text-center text-sm text-muted-foreground">Caricamento…</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Nessun evento. Crea cervelli, nodi o agenti per popolare lo stream.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((e) => (
              <li key={e.id} className={`flex items-start gap-3 rounded-lg border border-border/60 bg-background/40 p-3 text-sm ${e.is_read ? "opacity-60" : ""}`}>
                <div className="h-2 w-2 translate-y-1.5 rounded-full bg-gradient-primary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{e.title}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(e.created_at).toLocaleString("it-IT")} · {e.event_type}
                  </div>
                </div>
                {!e.is_read && (
                  <Button size="sm" variant="ghost" onClick={() => markRead(e.id)}>Segna letto</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
