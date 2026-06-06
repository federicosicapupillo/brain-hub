import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { createEdge } from "@/lib/brains-api";
import type { BrainNode } from "@/lib/demo-data";

export function CreateEdgeDialog({
  nodes,
  fromNode,
  onCreated,
}: {
  nodes: BrainNode[];
  fromNode: BrainNode;
  onCreated?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const candidates = nodes.filter((n) => n.id !== fromNode.id && n.brainId === fromNode.brainId);
  const [target, setTarget] = useState(candidates[0]?.id ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setSaving(true);
    try {
      await createEdge({ brain_id: fromNode.brainId, source: fromNode.id, target });
      toast.success("Collegamento creato");
      setOpen(false);
      onCreated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={candidates.length === 0}>
        <Link2 className="mr-1 h-4 w-4" /> Collega
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-gradient-primary">Collega "{fromNode.label}"</DialogTitle>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={handleSubmit}>
          <div className="grid gap-1.5">
            <Label>Nodo di destinazione</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger><SelectValue placeholder="Seleziona nodo" /></SelectTrigger>
              <SelectContent>
                {candidates.map((n) => (
                  <SelectItem key={n.id} value={n.id}>{n.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving || !target} className="bg-gradient-primary text-primary-foreground">
              {saving ? "Creazione…" : "Collega"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
