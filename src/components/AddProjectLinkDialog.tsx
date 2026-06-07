import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, FolderKanban, FileText, Sparkles, Map as MapIcon, ListChecks, Wrench, LinkIcon } from "lucide-react";
import { createProjectLink, type LinkType } from "@/lib/project-links-api";
import { createRoadmapItem, createTask } from "@/lib/workspace-api";

const RELATION_OPTIONS = [
  "collegato a", "dipende da", "usa come esempio", "contiene",
  "genera contenuti per", "supporta", "marketing collegato", "sviluppo collegato",
];
const PROMPT_TOOLS = [
  "Lovable", "Antigravity", "ChatGPT", "Claude", "Perplexity", "Runway",
  "Midjourney", "ElevenLabs", "D-ID", "altro",
];
const FILE_CATEGORIES = [
  "markdown", "documento", "immagine", "link esterno",
  "repository GitHub", "cartella Obsidian", "export progetto",
];
const PROMPT_STATUSES = ["bozza", "usato", "approvato", "da correggere"];
const TASK_PRIORITIES = ["bassa", "media", "alta", "critica"];
const TASK_STATUSES = ["da fare", "in corso", "fatto", "bloccato"];

type Mode = LinkType | null;

export function AddProjectLinkDialog({ brainId }: { brainId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => { setMode(null); };
  const onClose = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  const afterSave = async (msg: string) => {
    toast.success(msg);
    await qc.invalidateQueries({ queryKey: ["progetto", brainId] });
    await qc.invalidateQueries({ queryKey: ["progetti-hub"] });
    await qc.invalidateQueries({ queryKey: ["project-links-bi", brainId] });
    await qc.invalidateQueries({ queryKey: ["project-links-counts"] });
    onClose(false);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1">
          <Plus className="h-4 w-4" />Aggiungi collegamento
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Aggiungi collegamento</DialogTitle>
          <DialogDescription>
            {mode ? "Compila i campi e salva." : "Scegli che cosa collegare a questo progetto."}
          </DialogDescription>
        </DialogHeader>

        {!mode && (
          <div className="grid grid-cols-2 gap-2">
            <PickerButton icon={FolderKanban} label="Collega progetto" onClick={() => setMode("project")} />
            <PickerButton icon={FileText} label="Collega file" onClick={() => setMode("file")} />
            <PickerButton icon={Sparkles} label="Collega prompt" onClick={() => setMode("prompt")} />
            <PickerButton icon={MapIcon} label="Collega roadmap" onClick={() => setMode("roadmap")} />
            <PickerButton icon={ListChecks} label="Collega task" onClick={() => setMode("task")} />
            <PickerButton icon={Wrench} label="Collega strumento AI" onClick={() => setMode("tool")} />
            <PickerButton icon={LinkIcon} label="Aggiungi link esterno" onClick={() => setMode("external")} className="col-span-2" />
          </div>
        )}

        {mode === "project" && <ProjectForm brainId={brainId} busy={busy} setBusy={setBusy} onSaved={() => afterSave("Progetto collegato")} onBack={reset} />}
        {mode === "file" && <FileForm brainId={brainId} busy={busy} setBusy={setBusy} onSaved={() => afterSave("File collegato")} onBack={reset} />}
        {mode === "prompt" && <PromptForm brainId={brainId} busy={busy} setBusy={setBusy} onSaved={() => afterSave("Prompt collegato")} onBack={reset} />}
        {mode === "roadmap" && <RoadmapForm brainId={brainId} busy={busy} setBusy={setBusy} onSaved={() => afterSave("Roadmap collegata")} onBack={reset} />}
        {mode === "task" && <TaskForm brainId={brainId} busy={busy} setBusy={setBusy} onSaved={() => afterSave("Task collegato")} onBack={reset} />}
        {mode === "tool" && <ToolForm brainId={brainId} busy={busy} setBusy={setBusy} onSaved={() => afterSave("Strumento collegato")} onBack={reset} />}
        {mode === "external" && <ExternalForm brainId={brainId} busy={busy} setBusy={setBusy} onSaved={() => afterSave("Link esterno aggiunto")} onBack={reset} />}
      </DialogContent>
    </Dialog>
  );
}

function PickerButton({ icon: Icon, label, onClick, className }: { icon: React.ElementType; label: string; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md border border-border bg-card/40 px-3 py-2 text-left text-sm hover:bg-card/80 ${className ?? ""}`}
    >
      <Icon className="h-4 w-4 text-primary" />
      <span>{label}</span>
    </button>
  );
}

type FormProps = {
  brainId: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onSaved: () => void;
  onBack: () => void;
};

function FormFooter({ onBack, busy, label = "Salva collegamento" }: { onBack: () => void; busy: boolean; label?: string }) {
  return (
    <DialogFooter className="mt-4 gap-2">
      <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>Indietro</Button>
      <Button type="submit" disabled={busy}>{busy ? "Salvataggio…" : label}</Button>
    </DialogFooter>
  );
}

function ProjectForm({ brainId, busy, setBusy, onSaved, onBack }: FormProps) {
  const { data: brains = [] } = useQuery({
    queryKey: ["brains-picker"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brains").select("id,name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [targetId, setTargetId] = useState("");
  const [relation, setRelation] = useState(RELATION_OPTIONS[0]);
  const [note, setNote] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetId) return toast.error("Seleziona un progetto");
    const target = brains.find((b) => b.id === targetId);
    if (!target) return;
    setBusy(true);
    try {
      await createProjectLink({
        brain_id: brainId, link_type: "project", title: target.name,
        relation_type: relation, notes: note || undefined,
        target_brain_id: targetId, target_table: "brains", target_id: targetId,
      });
      onSaved();
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Progetto da collegare">
        <Select value={targetId} onValueChange={setTargetId}>
          <SelectTrigger><SelectValue placeholder="Seleziona…" /></SelectTrigger>
          <SelectContent>
            {brains.filter((b) => b.id !== brainId).map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Tipo relazione">
        <Select value={relation} onValueChange={setRelation}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {RELATION_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Nota relazione (opzionale)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>
      <FormFooter onBack={onBack} busy={busy} />
    </form>
  );
}

function FileForm({ brainId, busy, setBusy, onSaved, onBack }: FormProps) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState(FILE_CATEGORIES[0]);
  const [description, setDescription] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return toast.error("Titolo richiesto");
    setBusy(true);
    try {
      await createProjectLink({
        brain_id: brainId, link_type: "file", title: title.trim(),
        url: url || undefined, category, description: description || undefined,
      });
      onSaved();
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Titolo"><Input value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
      <Field label="URL / percorso"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… oppure path Obsidian" /></Field>
      <Field label="Categoria">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {FILE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Descrizione"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></Field>
      <FormFooter onBack={onBack} busy={busy} />
    </form>
  );
}

function PromptForm({ brainId, busy, setBusy, onSaved, onBack }: FormProps) {
  const [title, setTitle] = useState("");
  const [tool, setTool] = useState(PROMPT_TOOLS[0]);
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState(PROMPT_STATUSES[0]);
  const [notes, setNotes] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return toast.error("Titolo richiesto");
    setBusy(true);
    try {
      await createProjectLink({
        brain_id: brainId, link_type: "prompt", title: title.trim(),
        tool, status, category: category || undefined,
        description: text || undefined, notes: notes || undefined,
      });
      onSaved();
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Titolo prompt"><Input value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Strumento">
          <Select value={tool} onValueChange={setTool}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PROMPT_TOOLS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Stato">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PROMPT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Categoria (opzionale)"><Input value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
      <Field label="Testo prompt"><Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} /></Field>
      <Field label="Note"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
      <FormFooter onBack={onBack} busy={busy} />
    </form>
  );
}

function RoadmapForm({ brainId, busy, setBusy, onSaved, onBack }: FormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return toast.error("Titolo richiesto");
    setBusy(true);
    try {
      const item = await createRoadmapItem({
        title: title.trim(), description, priority, brain_id: brainId,
      });
      await createProjectLink({
        brain_id: brainId, link_type: "roadmap", title: title.trim(),
        description: description || undefined,
        target_table: "roadmap_items", target_id: item.id,
      });
      onSaved();
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Titolo"><Input value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
      <Field label="Descrizione"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></Field>
      <Field label="Priorità">
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Bassa</SelectItem>
            <SelectItem value="medium">Media</SelectItem>
            <SelectItem value="high">Alta</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <FormFooter onBack={onBack} busy={busy} label="Crea e collega" />
    </form>
  );
}

function TaskForm({ brainId, busy, setBusy, onSaved, onBack }: FormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>("media");
  const [status, setStatus] = useState<string>("da fare");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return toast.error("Titolo richiesto");
    setBusy(true);
    try {
      const task = await createTask({
        title: title.trim(), description, priority, status, brain_id: brainId,
      });
      await createProjectLink({
        brain_id: brainId, link_type: "task", title: title.trim(),
        description: description || undefined, status, category: priority,
        target_table: "tasks", target_id: task.id,
      });
      onSaved();
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Titolo task"><Input value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
      <Field label="Descrizione"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Priorità">
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Stato">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      <FormFooter onBack={onBack} busy={busy} label="Crea e collega" />
    </form>
  );
}

function ToolForm({ brainId, busy, setBusy, onSaved, onBack }: FormProps) {
  const [tool, setTool] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tool.trim()) return toast.error("Nome strumento richiesto");
    setBusy(true);
    try {
      await createProjectLink({
        brain_id: brainId, link_type: "tool", title: tool.trim(),
        tool: tool.trim(), url: url || undefined, notes: notes || undefined,
      });
      onSaved();
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Strumento AI"><Input value={tool} onChange={(e) => setTool(e.target.value)} placeholder="es. ChatGPT, Midjourney…" required /></Field>
      <Field label="URL (opzionale)"><Input value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
      <Field label="Note"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
      <FormFooter onBack={onBack} busy={busy} />
    </form>
  );
}

function ExternalForm({ brainId, busy, setBusy, onSaved, onBack }: FormProps) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [tool, setTool] = useState("");
  const [notes, setNotes] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !url.trim()) return toast.error("Titolo e URL richiesti");
    setBusy(true);
    try {
      await createProjectLink({
        brain_id: brainId, link_type: "external", title: title.trim(),
        url: url.trim(), description: description || undefined,
        category: category || undefined, tool: tool || undefined, notes: notes || undefined,
      });
      onSaved();
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Titolo"><Input value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
      <Field label="URL"><Input value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://…" /></Field>
      <Field label="Descrizione"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Categoria"><Input value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
        <Field label="Strumento collegato"><Input value={tool} onChange={(e) => setTool(e.target.value)} /></Field>
      </div>
      <Field label="Note"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
      <FormFooter onBack={onBack} busy={busy} />
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
