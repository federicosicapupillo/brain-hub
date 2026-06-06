import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plug, Plus } from "lucide-react";
import { toast } from "sonner";
import { listConnectors, upsertConnector, toggleConnector, type Connector } from "@/lib/workspace-api";

export const Route = createFileRoute("/_authenticated/connettori")({
  head: () => ({ meta: [{ title: "Connettori — AI Brain" }] }),
  component: ConnectorsPage,
});

function ConnectorsPage() {
  const [items, setItems] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    try { setItems(await listConnectors()); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Errore"); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  async function toggle(c: Connector) {
    try { await toggleConnector(c.id, !c.is_enabled); reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Errore"); }
  }

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Connettori" subtitle="Collega le tue fonti esterne al second brain." actions={<NewConnector onCreated={reload} />} />
      {loading ? (
        <Empty>Caricamento…</Empty>
      ) : items.length === 0 ? (
        <Empty>Nessun connettore. Aggiungine uno per iniziare a tracciare le integrazioni.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((c) => (
            <Card key={c.id} className="flex flex-col gap-3 border-border/70 bg-card/60 p-4 glass">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-primary glow-violet">
                  <Plug className="h-5 w-5 text-primary-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate font-medium">{c.name}</div>
                    {c.is_enabled ? (
                      <Badge className="border-emerald-500/40 bg-emerald-500/15 text-emerald-300">attivo</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">inattivo</Badge>
                    )}
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{c.description || c.type}</p>
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Ultimo sync: {c.last_sync_at ? new Date(c.last_sync_at).toLocaleString("it-IT") : "—"}
              </div>
              <div className="mt-auto flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => toggle(c)}>
                  {c.is_enabled ? "Disattiva" : "Attiva"}
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
  return <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card/40 p-10 text-sm text-muted-foreground glass">{children}</div>;
}

function NewConnector({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("obsidian");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true);
    try { await upsertConnector({ name, type, description }); toast.success("Connettore creato"); setOpen(false); setName(""); setDescription(""); onCreated(); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Errore"); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-gradient-primary text-primary-foreground glow-violet"><Plus className="mr-1 h-4 w-4" /> Connettore</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="text-gradient-primary">Nuovo connettore</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          <div className="grid gap-1.5"><Label>Nome</Label><Input required value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>Tipo</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="obsidian">Obsidian</SelectItem>
                <SelectItem value="gdrive">Google Drive</SelectItem>
                <SelectItem value="github">GitHub</SelectItem>
                <SelectItem value="notion">Notion</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="gmail">Gmail</SelectItem>
                <SelectItem value="stripe">Stripe</SelectItem>
                <SelectItem value="custom">Altro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5"><Label>Descrizione</Label><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <p className="text-[11px] text-muted-foreground">Nessun token o chiave verrà salvato nel database. Le chiavi vanno nei Secrets.</p>
          <DialogFooter><Button type="submit" disabled={saving} className="bg-gradient-primary text-primary-foreground">{saving ? "Creazione…" : "Crea"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
