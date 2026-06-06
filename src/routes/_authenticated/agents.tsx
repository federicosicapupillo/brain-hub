import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Bot, Play, Pause, Plus } from "lucide-react";
import { toast } from "sonner";
import { listAgents, createAgent, updateAgentStatus, type Agent } from "@/lib/workspace-api";

export const Route = createFileRoute("/_authenticated/agents")({
  head: () => ({ meta: [{ title: "Agents — AI Brain" }] }),
  component: AgentsPage,
});

function AgentsPage() {
  const [items, setItems] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    try { setItems(await listAgents()); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Errore"); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  async function toggle(a: Agent) {
    const next = a.status === "active" ? "idle" : "active";
    try { await updateAgentStatus(a.id, next); reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Errore"); }
  }

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="Agents"
        subtitle="Gestisci gli agenti AI collegati ai tuoi cervelli."
        actions={<NewAgentDialog onCreated={reload} />}
      />
      {loading ? (
        <Empty>Caricamento…</Empty>
      ) : items.length === 0 ? (
        <Empty>Nessun agente. Crea il primo dal pulsante in alto.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((a) => (
            <Card key={a.id} className="flex flex-col gap-3 border-border/70 bg-card/60 p-4 glass">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-primary glow-violet">
                  <Bot className="h-5 w-5 text-primary-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate font-medium">{a.name}</div>
                    {a.status === "active" ? (
                      <Badge className="border-emerald-500/40 bg-emerald-500/15 text-emerald-300">attivo</Badge>
                    ) : (
                      <Badge variant="outline" className="capitalize">{a.status}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{a.role || "—"}</p>
                </div>
              </div>
              {a.description && <p className="line-clamp-2 text-xs text-muted-foreground">{a.description}</p>}
              <div className="mt-auto flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => toggle(a)}>
                  {a.status === "active" ? <><Pause className="mr-1 h-3.5 w-3.5" /> Pausa</> : <><Play className="mr-1 h-3.5 w-3.5" /> Avvia</>}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card/40 p-10 text-sm text-muted-foreground glass">
      {children}
    </div>
  );
}

function NewAgentDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await createAgent({ name, role, description, status: "draft" });
      toast.success("Agente creato");
      setOpen(false); setName(""); setRole(""); setDescription("");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-gradient-primary text-primary-foreground glow-violet"><Plus className="mr-1 h-4 w-4" /> Agente</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="text-gradient-primary">Nuovo agente</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          <div className="grid gap-1.5"><Label>Nome</Label><Input required value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>Ruolo</Label><Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Es. Copywriter AI" /></div>
          <div className="grid gap-1.5"><Label>Descrizione</Label><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <DialogFooter>
            <Button type="submit" disabled={saving} className="bg-gradient-primary text-primary-foreground">{saving ? "Creazione…" : "Crea"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
