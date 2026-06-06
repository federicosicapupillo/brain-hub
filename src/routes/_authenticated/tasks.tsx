import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { listTasks, createTask, setTaskStatus, type Task } from "@/lib/workspace-api";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({ meta: [{ title: "Tasks — AI Brain" }] }),
  component: TasksPage,
});

const STATUSES = ["todo", "doing", "review", "done"];
const PRIORITY_TINT: Record<string, string> = {
  urgent: "border-red-500/40 bg-red-500/15 text-red-300",
  high: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  medium: "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
  low: "border-muted-foreground/40 bg-muted text-muted-foreground",
};

function TasksPage() {
  const [items, setItems] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    try { setItems(await listTasks()); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Errore"); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  async function complete(id: string) {
    try { await setTaskStatus(id, "done"); reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Errore"); }
  }

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Tasks" subtitle="Lista operativa di tutti i task attivi." actions={<NewTask onCreated={reload} />} />
      {loading ? (
        <Empty>Caricamento…</Empty>
      ) : items.length === 0 ? (
        <Empty>Nessun task. Creane uno per iniziare.</Empty>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card/40 glass">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Titolo</TableHead>
                <TableHead>Priorità</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead>Scadenza</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.title}</TableCell>
                  <TableCell><Badge variant="outline" className={`capitalize ${PRIORITY_TINT[t.priority] ?? ""}`}>{t.priority}</Badge></TableCell>
                  <TableCell>
                    <Select value={t.status} onValueChange={async (v) => { try { await setTaskStatus(t.id, v); reload(); } catch (e) { toast.error(e instanceof Error ? e.message : "Errore"); } }}>
                      <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.due_date ?? "—"}</TableCell>
                  <TableCell>
                    {t.status !== "done" && (
                      <Button size="sm" variant="ghost" onClick={() => complete(t.id)}><Check className="h-4 w-4" /></Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card/40 p-10 text-sm text-muted-foreground glass">{children}</div>;
}

function NewTask({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true);
    try { await createTask({ title, priority }); toast.success("Task creato"); setOpen(false); setTitle(""); onCreated(); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Errore"); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-gradient-primary text-primary-foreground glow-violet"><Plus className="mr-1 h-4 w-4" /> Task</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="text-gradient-primary">Nuovo task</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          <div className="grid gap-1.5"><Label>Titolo</Label><Input required value={title} onChange={(e) => setTitle(e.target.value)} /></div>
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
          <DialogFooter><Button type="submit" disabled={saving} className="bg-gradient-primary text-primary-foreground">{saving ? "Creazione…" : "Crea"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
