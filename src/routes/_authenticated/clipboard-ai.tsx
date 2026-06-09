import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Clipboard, Copy, Edit2, Archive, CheckCircle2, Sparkles, Plus, Search,
  Trash2, Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/clipboard-ai")({
  head: () => ({ meta: [{ title: "Clipboard AI — iBrain" }] }),
  component: ClipboardAIPage,
});

type ClipboardItem = {
  id: string;
  brain_id: string | null;
  project_id: string | null;
  title: string;
  content: string;
  source_tool: string;
  target_tool: string;
  content_type: string;
  status: string;
  tags: string[];
  notes: string;
  metadata: Record<string, unknown>;
  copied_count: number;
  last_copied_at: string | null;
  created_at: string;
  updated_at: string;
};

const TOOLS = [
  "ChatGPT", "Claude", "Lovable", "Codex", "Antigravity",
  "Runway", "Gmail", "Browser", "Obsidian", "Notion", "Altro",
];
const CONTENT_TYPES = [
  { v: "prompt", l: "Prompt" },
  { v: "ai_response", l: "Risposta AI" },
  { v: "code", l: "Codice" },
  { v: "note", l: "Appunto" },
  { v: "email", l: "Email" },
  { v: "idea", l: "Idea" },
  { v: "task", l: "Task" },
  { v: "media_prompt", l: "Media Prompt" },
];
const STATUSES = [
  { v: "saved", l: "Salvato", color: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  { v: "to_classify", l: "Da classificare", color: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  { v: "ready", l: "Pronto da usare", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  { v: "used", l: "Usato", color: "bg-violet-500/10 text-violet-400 border-violet-500/30" },
  { v: "archived", l: "Archiviato", color: "bg-muted text-muted-foreground border-muted" },
];

const TOOL_COLOR: Record<string, string> = {
  ChatGPT: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Claude: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  Lovable: "bg-pink-500/15 text-pink-300 border-pink-500/30",
  Codex: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  Antigravity: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  Runway: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  Gmail: "bg-red-500/15 text-red-300 border-red-500/30",
};

function toolBadge(name: string) {
  if (!name) return null;
  const cls = TOOL_COLOR[name] ?? "bg-muted text-muted-foreground border-border";
  return <Badge variant="outline" className={cls}>{name}</Badge>;
}
function statusBadge(v: string) {
  const s = STATUSES.find((x) => x.v === v);
  if (!s) return <Badge variant="outline">{v}</Badge>;
  return <Badge variant="outline" className={s.color}>{s.l}</Badge>;
}

type FormState = {
  id?: string;
  title: string; content: string;
  brain_id: string | null; project_id: string | null;
  source_tool: string; target_tool: string;
  content_type: string; status: string;
  tags: string; notes: string;
};
const EMPTY_FORM: FormState = {
  title: "", content: "",
  brain_id: null, project_id: null,
  source_tool: "", target_tool: "",
  content_type: "prompt", status: "saved",
  tags: "", notes: "",
};

function ClipboardAIPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [fProject, setFProject] = useState<string>("all");
  const [fTool, setFTool] = useState<string>("all");
  const [fType, setFType] = useState<string>("all");
  const [fStatus, setFStatus] = useState<string>("all");
  const [fTag, setFTag] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const itemsQ = useQuery({
    queryKey: ["clipboard_items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clipboard_items")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ClipboardItem[];
    },
  });

  const brainsQ = useQuery({
    queryKey: ["brains_min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brains").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
  const projectsQ = useQuery({
    queryKey: ["project_links_min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_links")
        .select("id,title,brain_id")
        .order("title");
      if (error) throw error;
      return (data ?? []) as { id: string; title: string; brain_id: string | null }[];
    },
  });

  const items = itemsQ.data ?? [];
  const allTags = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => i.tags?.forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (q && !(`${i.title} ${i.content} ${i.notes} ${i.tags.join(" ")}`.toLowerCase().includes(q))) return false;
      if (fProject !== "all" && i.project_id !== fProject) return false;
      if (fTool !== "all" && i.source_tool !== fTool && i.target_tool !== fTool) return false;
      if (fType !== "all" && i.content_type !== fType) return false;
      if (fStatus !== "all" && i.status !== fStatus) return false;
      if (fTag !== "all" && !i.tags.includes(fTag)) return false;
      return true;
    });
  }, [items, search, fProject, fTool, fType, fStatus, fTag]);

  const saveMut = useMutation({
    mutationFn: async (f: FormState) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Non autenticato");
      const payload = {
        user_id: u.user.id,
        brain_id: f.brain_id,
        project_id: f.project_id,
        title: f.title.trim() || f.content.slice(0, 60),
        content: f.content,
        source_tool: f.source_tool,
        target_tool: f.target_tool,
        content_type: f.content_type,
        status: f.status,
        tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
        notes: f.notes,
      };
      if (f.id) {
        const { error } = await supabase.from("clipboard_items").update(payload).eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("clipboard_items").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clipboard_items"] });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      toast.success("Contenuto salvato");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchMut = useMutation({
    mutationFn: async (vars: { id: string; status: string }) => {
      const { error } = await supabase.from("clipboard_items").update({ status: vars.status }).eq("id", vars.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clipboard_items"] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clipboard_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clipboard_items"] });
      toast.success("Eliminato");
    },
  });

  const duplicateMut = useMutation({
    mutationFn: async (item: ClipboardItem) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Non autenticato");
      const { error } = await supabase.from("clipboard_items").insert({
        user_id: u.user.id,
        brain_id: item.brain_id, project_id: item.project_id,
        title: `${item.title} (copia)`, content: item.content,
        source_tool: item.source_tool, target_tool: item.target_tool,
        content_type: item.content_type, status: "saved",
        tags: item.tags, notes: item.notes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clipboard_items"] });
      toast.success("Duplicato");
    },
  });

  async function copyContent(item: ClipboardItem) {
    try {
      await navigator.clipboard.writeText(item.content);
      await supabase
        .from("clipboard_items")
        .update({
          copied_count: item.copied_count + 1,
          last_copied_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      qc.invalidateQueries({ queryKey: ["clipboard_items"] });
      toast.success("Copiato negli appunti");
    } catch {
      toast.error("Impossibile copiare");
    }
  }

  function openEdit(item: ClipboardItem) {
    setForm({
      id: item.id,
      title: item.title, content: item.content,
      brain_id: item.brain_id, project_id: item.project_id,
      source_tool: item.source_tool, target_tool: item.target_tool,
      content_type: item.content_type, status: item.status,
      tags: item.tags.join(", "), notes: item.notes,
    });
    setDialogOpen(true);
  }

  function generateNextPrompt(item: ClipboardItem) {
    const next =
      `# Prossimo prompt (da: ${item.title || "contenuto"})\n\n` +
      `Contesto precedente:\n"""\n${item.content.slice(0, 800)}\n"""\n\n` +
      `Obiettivo successivo: \n` +
      `Vincoli: \n` +
      `Output atteso: \n`;
    setForm({
      ...EMPTY_FORM,
      title: `Next: ${item.title || "prompt"}`,
      content: next,
      brain_id: item.brain_id, project_id: item.project_id,
      source_tool: item.target_tool || item.source_tool,
      target_tool: item.target_tool,
      content_type: "prompt", status: "to_classify",
      tags: item.tags.join(", "),
    });
    setDialogOpen(true);
  }

  const counts = useMemo(() => {
    const by = (s: string) => items.filter((i) => i.status === s).length;
    return {
      total: items.length,
      ready: by("ready"),
      toClassify: by("to_classify"),
      used: by("used"),
      archived: by("archived"),
    };
  }, [items]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <PageHeader
        title="Clipboard AI"
        subtitle="Salva, organizza e riutilizza prompt e testi copiati da qualsiasi piattaforma."
        actions={
          <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setForm(EMPTY_FORM); }}>
            <DialogTrigger asChild>
              <Button onClick={() => setForm(EMPTY_FORM)}>
                <Plus className="h-4 w-4 mr-2" /> Aggiungi contenuto
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{form.id ? "Modifica contenuto" : "Nuovo contenuto"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Titolo</Label>
                  <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Lasciato vuoto = generato dal contenuto" />
                </div>
                <div>
                  <Label>Contenuto *</Label>
                  <Textarea rows={8} value={form.content}
                    onChange={(e) => setForm({ ...form, content: e.target.value })}
                    placeholder="Incolla qui il prompt, la risposta, il codice…" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Cervello</Label>
                    <Select value={form.brain_id ?? "none"}
                      onValueChange={(v) => setForm({ ...form, brain_id: v === "none" ? null : v, project_id: null })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {(brainsQ.data ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Progetto</Label>
                    <Select value={form.project_id ?? "none"}
                      onValueChange={(v) => setForm({ ...form, project_id: v === "none" ? null : v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {(projectsQ.data ?? [])
                          .filter((p) => !form.brain_id || p.brain_id === form.brain_id)
                          .map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Tool origine</Label>
                    <Select value={form.source_tool || "none"} onValueChange={(v) => setForm({ ...form, source_tool: v === "none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {TOOLS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Tool destinazione</Label>
                    <Select value={form.target_tool || "none"} onValueChange={(v) => setForm({ ...form, target_tool: v === "none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {TOOLS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Tipo contenuto</Label>
                    <Select value={form.content_type} onValueChange={(v) => setForm({ ...form, content_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CONTENT_TYPES.map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Stato</Label>
                    <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Tag (separati da virgola)</Label>
                  <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}
                    placeholder="es. landing, brief, gpt5" />
                </div>
                <div>
                  <Label>Note</Label>
                  <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Annulla</Button>
                <Button onClick={() => saveMut.mutate(form)} disabled={saveMut.isPending || !form.content.trim()}>
                  {saveMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Salva
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { l: "Totali", v: counts.total, c: "text-foreground" },
          { l: "Pronti", v: counts.ready, c: "text-emerald-400" },
          { l: "Da classificare", v: counts.toClassify, c: "text-amber-400" },
          { l: "Usati", v: counts.used, c: "text-violet-400" },
          { l: "Archiviati", v: counts.archived, c: "text-muted-foreground" },
        ].map((s) => (
          <Card key={s.l}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{s.l}</div>
              <div className={`text-2xl font-semibold ${s.c}`}>{s.v}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Cerca per titolo, contenuto, tag, note…"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Select value={fProject} onValueChange={setFProject}>
              <SelectTrigger><SelectValue placeholder="Progetto" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i progetti</SelectItem>
                {(projectsQ.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fTool} onValueChange={setFTool}>
              <SelectTrigger><SelectValue placeholder="Tool" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i tool</SelectItem>
                {TOOLS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fType} onValueChange={setFType}>
              <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i tipi</SelectItem>
                {CONTENT_TYPES.map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fStatus} onValueChange={setFStatus}>
              <SelectTrigger><SelectValue placeholder="Stato" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti gli stati</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fTag} onValueChange={setFTag}>
              <SelectTrigger><SelectValue placeholder="Tag" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i tag</SelectItem>
                {allTags.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Items */}
      {itemsQ.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-12 text-center text-muted-foreground">
          <Clipboard className="h-10 w-10 mx-auto mb-3 opacity-50" />
          Nessun contenuto. Aggiungi il primo prompt o testo.
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((item) => {
            const project = (projectsQ.data ?? []).find((p) => p.id === item.project_id);
            return (
              <Card key={item.id} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base line-clamp-2">{item.title || "(senza titolo)"}</CardTitle>
                    {statusBadge(item.status)}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {toolBadge(item.source_tool)}
                    {item.target_tool && item.target_tool !== item.source_tool && (
                      <>
                        <span className="text-xs text-muted-foreground self-center">→</span>
                        {toolBadge(item.target_tool)}
                      </>
                    )}
                    <Badge variant="secondary" className="text-xs">
                      {CONTENT_TYPES.find((t) => t.v === item.content_type)?.l ?? item.content_type}
                    </Badge>
                    {project && <Badge variant="outline" className="text-xs">{project.title}</Badge>}
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col gap-3">
                  <pre className="text-xs bg-muted/40 rounded-md p-3 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono">
                    {item.content}
                  </pre>
                  {item.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {item.tags.map((t) => <Badge key={t} variant="outline" className="text-[10px]">#{t}</Badge>)}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{new Date(item.created_at).toLocaleString("it-IT")}</span>
                    {item.copied_count > 0 && <span>Copiato {item.copied_count}×</span>}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1 border-t">
                    <Button size="sm" onClick={() => copyContent(item)}>
                      <Copy className="h-3.5 w-3.5 mr-1.5" /> Copia
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(item)}>
                      <Edit2 className="h-3.5 w-3.5 mr-1.5" /> Modifica
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => duplicateMut.mutate(item)}>
                      Duplica
                    </Button>
                    {item.status !== "used" && (
                      <Button size="sm" variant="outline"
                        onClick={() => patchMut.mutate({ id: item.id, patch: { status: "used" } })}>
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Usato
                      </Button>
                    )}
                    {item.status !== "archived" && (
                      <Button size="sm" variant="outline"
                        onClick={() => patchMut.mutate({ id: item.id, patch: { status: "archived" } })}>
                        <Archive className="h-3.5 w-3.5 mr-1.5" /> Archivia
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => generateNextPrompt(item)}>
                      <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Prossimo prompt
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive ml-auto"
                      onClick={() => { if (confirm("Eliminare definitivamente?")) deleteMut.mutate(item.id); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
