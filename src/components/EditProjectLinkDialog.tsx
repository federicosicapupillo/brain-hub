import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Pencil } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  updateProjectLink, upsertProjectProjectLink, type ProjectLink,
} from "@/lib/project-links-api";

export function EditProjectLinkDialog({ link }: { link: ProjectLink }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [relation, setRelation] = useState(link.relation_type ?? "collegato a");
  const [notes, setNotes] = useState(link.notes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setRelation(link.relation_type ?? "collegato a");
      setNotes(link.notes ?? "");
    }
  }, [open, link]);

  const isVirtual = link.id.startsWith("virtual:");
  const canSave = isVirtual ? !!link.target_brain_id : true;

  const onSave = async () => {
    setSaving(true);
    try {
      const finalRelation = relation.trim() || "collegato a";
      if (isVirtual) {
        if (!link.target_brain_id) throw new Error("Target progetto mancante");
        await upsertProjectProjectLink({
          brain_id: link.brain_id,
          target_brain_id: link.target_brain_id,
          target_title: link.title,
          relation_type: finalRelation,
          notes: notes.trim() || null,
        });
      } else {
        await updateProjectLink(link.id, {
          relation_type: finalRelation,
          notes: notes.trim() || null,
        });
      }
      toast.success("Collegamento aggiornato");
      await qc.invalidateQueries({ queryKey: ["project-links-bi"] });
      await qc.invalidateQueries({ queryKey: ["progetti-hub"] });
      await qc.invalidateQueries({ queryKey: ["project-links-counts"] });
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7" title="Modifica collegamento">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Modifica collegamento</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Verso: <span className="font-medium text-foreground">{link.title}</span>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="relation">Tipo relazione</Label>
            <Input
              id="relation"
              value={relation}
              onChange={(e) => setRelation(e.target.value)}
              placeholder="collegato a"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Nota</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Descrivi la relazione tra i due progetti…"
              rows={4}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            Annulla
          </Button>
          <Button onClick={onSave} disabled={saving || !canSave}>
            {saving ? "Salvataggio…" : "Salva"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
