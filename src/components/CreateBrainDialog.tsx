import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createBrain } from "@/lib/brains-api";

const COLORS = ["var(--neon-violet)", "var(--neon-cyan)", "var(--neon-pink)", "var(--neon-emerald)", "var(--neon-amber)"];

export function CreateBrainDialog({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [origin, setOrigin] = useState("manuale");
  const [kind, setKind] = useState("progetto");
  const [visibility, setVisibility] = useState("privato");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await createBrain({ name, description, origin, kind, visibility, color });
      toast.success("Cervello creato");
      setOpen(false);
      setName(""); setDescription("");
      onCreated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore nella creazione");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-gradient-primary text-primary-foreground glow-violet">
          <Plus className="mr-1 h-4 w-4" /> Cervello
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-gradient-primary">Nuovo cervello</DialogTitle>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={handleSubmit}>
          <div className="grid gap-1.5">
            <Label htmlFor="name">Nome cervello</Label>
            <Input id="name" required placeholder="Es. Pupillo" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="desc">Descrizione</Label>
            <Textarea id="desc" rows={2} placeholder="A cosa serve questo cervello?" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>Origine</Label>
              <Select value={origin} onValueChange={setOrigin}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manuale">Manuale</SelectItem>
                  <SelectItem value="obsidian">Obsidian</SelectItem>
                  <SelectItem value="gdrive">Google Drive</SelectItem>
                  <SelectItem value="github">GitHub</SelectItem>
                  <SelectItem value="supabase">Supabase</SelectItem>
                  <SelectItem value="altro">Altro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Tipo</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="progetto">Progetto</SelectItem>
                  <SelectItem value="archivio">Archivio</SelectItem>
                  <SelectItem value="agente">Agente</SelectItem>
                  <SelectItem value="documenti">Documenti</SelectItem>
                  <SelectItem value="prompt">Prompt</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Visibilità</Label>
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="privato">Privato</SelectItem>
                  <SelectItem value="protetto">Protetto</SelectItem>
                  <SelectItem value="pubblico">Pubblico</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Colore identificativo</Label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-full border-2 transition ${color === c ? "border-foreground scale-110" : "border-transparent"}`}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving} className="bg-gradient-primary text-primary-foreground">
              {saving ? "Creazione…" : "Crea cervello"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
