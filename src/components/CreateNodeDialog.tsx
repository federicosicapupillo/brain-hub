import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createNode } from "@/lib/brains-api";
import type { Brain } from "@/lib/demo-data";

const TYPES = ["nota", "documento", "progetto", "task", "agente", "prompt", "roadmap", "fonte"];

export function CreateNodeDialog({
  brains,
  defaultBrainId,
  onCreated,
}: {
  brains: Brain[];
  defaultBrainId?: string;
  onCreated?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState("nota");
  const [brainId, setBrainId] = useState(defaultBrainId ?? brains[0]?.id ?? "");
  const [tags, setTags] = useState("");
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!brainId) {
      toast.error("Crea prima un cervello");
      return;
    }
    setSaving(true);
    try {
      await createNode({
        brain_id: brainId,
        label,
        type,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        summary,
      });
      toast.success("Nodo creato");
      setOpen(false);
      setLabel(""); setTags(""); setSummary("");
      onCreated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="mr-1 h-4 w-4" /> Nodo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-gradient-primary">Nuovo nodo</DialogTitle>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={handleSubmit}>
          <div className="grid gap-1.5">
            <Label>Cervello</Label>
            <Select value={brainId} onValueChange={setBrainId}>
              <SelectTrigger><SelectValue placeholder="Seleziona cervello" /></SelectTrigger>
              <SelectContent>
                {brains.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="nlabel">Titolo</Label>
              <Input id="nlabel" required value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Tipo</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ntags">Tag (separati da virgola)</Label>
            <Input id="ntags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="ai, idea, draft" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nsum">Riassunto</Label>
            <Textarea id="nsum" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving} className="bg-gradient-primary text-primary-foreground">
              {saving ? "Creazione…" : "Crea nodo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
