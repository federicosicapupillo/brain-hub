import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { listRoadmap, createRoadmapItem, moveRoadmapItem, type RoadmapItem } from "@/lib/workspace-api";

export const Route = createFileRoute("/_authenticated/roadmap")({
  head: () => ({ meta: [{ title: "Roadmap — AI Brain" }] }),
  component: RoadmapPage,
});

const COLUMNS = [
  { id: "ideas", label: "Idee", tint: "var(--neon-cyan)" },
  { id: "todo", label: "Da fare", tint: "var(--neon-violet)" },
  { id: "doing", label: "In corso", tint: "var(--neon-amber)" },
  { id: "review", label: "Da validare", tint: "var(--neon-pink)" },
  { id: "done", label: "Completato", tint: "var(--neon-emerald)" },
];

function RoadmapPage() {
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    try { setItems(await listRoadmap()); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Errore"); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Roadmap" subtitle="Visualizza i flussi di lavoro per ogni cervello." actions={<NewItem onCreated={reload} />} />
      {loading ? (
        <Empty>Caricamento…</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {COLUMNS.map((col) => {
            const colItems = items.filter((t) => t.status === col.id);
            return (
              <div key={col.id} className="flex min-h-[320px] flex-col rounded-2xl border border-border bg-card/40 p-3 glass">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="h-2 w-2 rounded-full" style={{ background: col.tint }} />
                    {col.label}
                  </div>
                  <Badge variant="secondary" className="font-mono text-[10px]">{colItems.length}</Badge>
                </div>
                <div className="flex flex-col gap-2">
                  {colItems.map((t) => (
                    <div key={t.id} className="rounded-lg border border-border/70 bg-background/50 p-2.5 text-sm">
                      <div className="font-medium leading-snug">{t.title}</div>
                      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="capitalize">{t.priority}</span>
                        <Select
                          value={t.status}
                          onValueChange={async (v) => {
                            try { await moveRoadmapItem(t.id, v); reload(); }
                            catch (e) { toast.error(e instanceof Error ? e.message : "Errore"); }
                          }}
                        >
                          <SelectTrigger className="ml-auto h-6 w-24 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {COLUMNS.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ))}
                  {colItems.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border/60 p-3 text-center text-[11px] text-muted-foreground">
                      Vuoto
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card/40 p-10 text-sm text-muted-foreground glass">{children}</div>;
}

function NewItem({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("todo");
  const [priority, setPriority] = useState("medium");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true);
    try {
      await createRoadmapItem({ title, description, status, priority });
      toast.success("Item creato"); setOpen(false); setTitle(""); setDescription(""); onCreated();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Errore"); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-gradient-primary text-primary-foreground glow-violet"><Plus className="mr-1 h-4 w-4" /> Item</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="text-gradient-primary">Nuovo item roadmap</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          <div className="grid gap-1.5"><Label>Titolo</Label><Input required value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>Descrizione</Label><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Stato</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{COLUMNS.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label>Priorità</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Bassa</SelectItem>
                  <SelectItem value="medium">Media</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="urgent">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button type="submit" disabled={saving} className="bg-gradient-primary text-primary-foreground">{saving ? "Creazione…" : "Crea"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
