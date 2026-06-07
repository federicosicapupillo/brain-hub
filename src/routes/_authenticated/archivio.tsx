import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive, ExternalLink, Pencil, Trash2, FolderOpen, Inbox, Eye, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/brains-api";

export const Route = createFileRoute("/_authenticated/archivio")({
  component: ArchivioPage,
  errorComponent: ({ error }) => (
    <div className="p-6" role="alert">Errore: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6">Pagina non trovata.</div>,
});

type Source = "brain" | "node" | "task" | "roadmap" | "source" | "link";

type Item = {
  id: string;
  source: Source;
  brain_id: string | null;
  title: string;
  type_label: string;
  type_key: string; // for filtering
  status: string | null;
  tool: string | null;
  tags: string[];
  preview: string;
  content: string; // full content for view modal
  url: string | null;
  created_at: string;
  updated_at: string | null;
};

const TYPE_OPTIONS = [
  { value: "all", label: "Tutti" },
  { value: "scheda", label: "Scheda madre" },
  { value: "file", label: "File / Documento" },
  { value: "prompt", label: "Prompt" },
  { value: "task", label: "Task" },
  { value: "roadmap", label: "Roadmap" },
  { value: "nota", label: "Nota" },
  { value: "strategia", label: "Appunto strategico" },
  { value: "regola", label: "Regola progetto" },
  { value: "log", label: "Log operativo" },
  { value: "external", label: "Link esterno" },
];

const TOOLS = ["all", "ChatGPT", "Lovable", "Antigravity", "Claude", "Perplexity", "Runway", "Midjourney", "ElevenLabs", "D-ID", "Supabase", "GitHub", "Obsidian", "Altro"];
const STATUSES = ["all", "bozza", "importato", "pronto", "da revisionare", "approvato", "archiviato", "fatto", "in corso", "bloccato", "todo", "done"];

async function loadAll(): Promise<Item[]> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return [];

  const [brains, nodes, tasks, roadmap, sources, links] = await Promise.all([
    supabase.from("brains").select("*").eq("user_id", uid),
    supabase.from("brain_nodes").select("*").eq("user_id", uid),
    supabase.from("tasks").select("*").eq("user_id", uid),
    supabase.from("roadmap_items").select("*").eq("user_id", uid),
    supabase.from("knowledge_sources").select("*").eq("user_id", uid),
    supabase.from("project_links").select("*").eq("user_id", uid),
  ]);

  const items: Item[] = [];

  for (const b of brains.data ?? []) {
    const desc = b.description ?? "";
    items.push({
      id: `brain:${b.id}`, source: "brain", brain_id: b.id,
      title: `Scheda madre ${b.name}`, type_label: "Scheda madre", type_key: "scheda",
      status: null, tool: null, tags: [],
      preview: desc, content: desc,
      url: null, created_at: b.created_at, updated_at: b.updated_at,
    });
  }

  for (const n of nodes.data ?? []) {
    const t = (n.type ?? "nota").toLowerCase();
    const isPrompt = t === "prompt";
    const body = n.summary ?? "";
    items.push({
      id: `node:${n.id}`, source: "node", brain_id: n.brain_id,
      title: n.label,
      type_label: isPrompt ? "Prompt" : (t.charAt(0).toUpperCase() + t.slice(1)),
      type_key: isPrompt ? "prompt" : (t === "regola" ? "regola" : (t === "strategia" ? "strategia" : "nota")),
      status: (n.tags ?? []).find((x: string) => STATUSES.includes(x)) ?? null,
      tool: (n.tags ?? []).find((x: string) => TOOLS.includes(x)) ?? null,
      tags: n.tags ?? [],
      preview: body, content: body,
      url: null, created_at: n.created_at, updated_at: n.updated_at,
    });
  }

  for (const t of tasks.data ?? []) {
    const body = t.description ?? "";
    items.push({
      id: `task:${t.id}`, source: "task", brain_id: t.brain_id,
      title: t.title, type_label: "Task", type_key: "task",
      status: t.status, tool: null, tags: [],
      preview: body, content: body,
      url: null, created_at: t.created_at, updated_at: t.updated_at,
    });
  }

  for (const r of roadmap.data ?? []) {
    const body = r.description ?? "";
    items.push({
      id: `roadmap:${r.id}`, source: "roadmap", brain_id: r.brain_id,
      title: r.title, type_label: "Roadmap", type_key: "roadmap",
      status: r.status, tool: null, tags: [],
      preview: body, content: body,
      url: null, created_at: r.created_at, updated_at: r.updated_at,
    });
  }

  for (const s of sources.data ?? []) {
    const tagSet = new Set(s.tags ?? []);
    let typeKey = "file";
    if (tagSet.has("prompt")) typeKey = "prompt";
    else if (tagSet.has("nota")) typeKey = "nota";
    else if (tagSet.has("strategia")) typeKey = "strategia";
    else if (tagSet.has("regola")) typeKey = "regola";
    else if (tagSet.has("log")) typeKey = "log";
    else if (s.source_type === "url") typeKey = "external";

    const typeLabel = TYPE_OPTIONS.find((o) => o.value === typeKey)?.label ?? "File / Documento";
    const desc = s.description ?? "";
    const tool = /Strumento:\s*([^·]+)/i.exec(desc)?.[1]?.trim() ?? null;
    const body = s.extracted_text ?? s.description ?? "";
    items.push({
      id: `source:${s.id}`, source: "source", brain_id: s.brain_id,
      title: s.title, type_label: typeLabel, type_key: typeKey,
      status: s.status, tool, tags: s.tags ?? [],
      preview: body, content: body,
      url: s.url, created_at: s.created_at, updated_at: s.updated_at,
    });
  }

  for (const l of links.data ?? []) {
    if (l.link_type !== "external") continue;
    const body = l.notes ?? l.description ?? "";
    items.push({
      id: `link:${l.id}`, source: "link", brain_id: l.brain_id,
      title: l.title, type_label: "Link esterno", type_key: "external",
      status: l.status, tool: l.tool, tags: l.category ? l.category.split(",") : [],
      preview: body, content: body,
      url: l.url, created_at: l.created_at, updated_at: l.updated_at,
    });
  }


  return items;
}

function ArchivioPage() {
  const qc = useQueryClient();
  const { data: brainsData } = useQuery({ queryKey: ["brains-all"], queryFn: fetchAll });
  const brains = brainsData?.brains ?? [];
  const brainMap = useMemo(() => new Map(brains.map((b) => [b.id, b.name])), [brains]);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["archivio-items"],
    queryFn: loadAll,
  });

  const [q, setQ] = useState("");
  const [fBrain, setFBrain] = useState("all");
  const [fType, setFType] = useState("all");
  const [fTool, setFTool] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [sort, setSort] = useState("recent");
  const [onlyDup, setOnlyDup] = useState(false);

  const [viewItem, setViewItem] = useState<Item | null>(null);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [delItem, setDelItem] = useState<Item | null>(null);

  // Duplicate detection: same brain + same type + same normalized title,
  // OR same brain + same type + very similar preview prefix.
  const dupIds = useMemo(() => {
    const norm = (s: string) =>
      s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
    const buckets = new Map<string, Item[]>();
    for (const it of items) {
      if (it.source === "brain") continue;
      const key = `${it.brain_id ?? "-"}|${it.type_key}|${norm(it.title)}`;
      const arr = buckets.get(key) ?? [];
      arr.push(it);
      buckets.set(key, arr);
    }
    const dup = new Set<string>();
    for (const arr of buckets.values()) {
      if (arr.length > 1) arr.forEach((x) => dup.add(x.id));
    }
    // similar content prefix within same brain+type
    const byBT = new Map<string, Item[]>();
    for (const it of items) {
      if (it.source === "brain") continue;
      const k = `${it.brain_id ?? "-"}|${it.type_key}`;
      const a = byBT.get(k) ?? []; a.push(it); byBT.set(k, a);
    }
    for (const arr of byBT.values()) {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = norm(arr[i].preview).slice(0, 80);
          const b = norm(arr[j].preview).slice(0, 80);
          if (a && a === b) { dup.add(arr[i].id); dup.add(arr[j].id); }
        }
      }
    }
    return dup;
  }, [items]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let list = items.filter((it) => {
      if (fBrain !== "all" && it.brain_id !== fBrain) return false;
      if (fType !== "all" && it.type_key !== fType) return false;
      if (fTool !== "all" && it.tool !== fTool) return false;
      if (fStatus !== "all" && it.status !== fStatus) return false;
      if (onlyDup && !dupIds.has(it.id)) return false;
      if (ql) {
        const brainName = brainMap.get(it.brain_id ?? "") ?? "";
        const hay = [
          it.title, it.preview, it.tool, it.type_label,
          brainName, ...(it.tags ?? []),
        ].join(" ").toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      switch (sort) {
        case "old": return a.created_at.localeCompare(b.created_at);
        case "title": return a.title.localeCompare(b.title);
        case "brain": return (brainMap.get(a.brain_id ?? "") ?? "").localeCompare(brainMap.get(b.brain_id ?? "") ?? "");
        case "type": return a.type_label.localeCompare(b.type_label);
        default: return b.created_at.localeCompare(a.created_at);
      }
    });
    return list;
  }, [items, q, fBrain, fType, fTool, fStatus, sort, brainMap, onlyDup, dupIds]);


  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["archivio-items"] });
    qc.invalidateQueries({ queryKey: ["brains-all"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["roadmap"] });
    qc.invalidateQueries({ queryKey: ["project-links-counts"] });
    qc.invalidateQueries({ queryKey: ["project-links-bi"] });
    qc.invalidateQueries({ queryKey: ["knowledge-sources"] });
  };

  const archive = async (it: Item) => {
    try {
      const [src, id] = it.id.split(":");
      if (src === "task" || src === "roadmap") {
        const table = src === "task" ? "tasks" : "roadmap_items";
        const { error } = await supabase.from(table).update({ status: "archiviato" }).eq("id", id);
        if (error) throw error;
      } else if (src === "source") {
        const { error } = await supabase.from("knowledge_sources").update({ status: "archiviato" }).eq("id", id);
        if (error) throw error;
      } else if (src === "link") {
        const { error } = await supabase.from("project_links").update({ status: "archiviato" }).eq("id", id);
        if (error) throw error;
      } else if (src === "node") {
        const newTags = Array.from(new Set([...(it.tags ?? []), "archiviato"]));
        const { error } = await supabase.from("brain_nodes").update({ tags: newTags }).eq("id", id);
        if (error) throw error;
      } else {
        toast.error("Le schede madri non si possono archiviare.");
        return;
      }
      toast.success("Contenuto archiviato.");
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (it: Item) => {
    try {
      const [src, id] = it.id.split(":");
      const table = src === "node" ? "brain_nodes"
        : src === "task" ? "tasks"
        : src === "roadmap" ? "roadmap_items"
        : src === "source" ? "knowledge_sources"
        : src === "link" ? "project_links"
        : null;
      if (!table) { toast.error("Non eliminabile da qui."); return; }
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) throw error;
      toast.success("Contenuto eliminato.");
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Archivio contenuti"
        subtitle="Tutti i file, prompt, task, roadmap, note e collegamenti salvati nei tuoi progetti."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/importa"><Inbox className="h-4 w-4 mr-1" /> Vai a Importa</Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca per titolo, contenuto, tag, progetto…" />
          </div>
          <Select value={fBrain} onValueChange={setFBrain}>
            <SelectTrigger><SelectValue placeholder="Progetto" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i progetti</SelectItem>
              {brains.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fType} onValueChange={setFType}>
            <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fTool} onValueChange={setFTool}>
            <SelectTrigger><SelectValue placeholder="Strumento" /></SelectTrigger>
            <SelectContent>
              {TOOLS.map((t) => <SelectItem key={t} value={t}>{t === "all" ? "Tutti gli strumenti" : t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fStatus} onValueChange={setFStatus}>
            <SelectTrigger><SelectValue placeholder="Stato" /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s === "all" ? "Tutti gli stati" : s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger><SelectValue placeholder="Ordina" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Più recenti</SelectItem>
              <SelectItem value="old">Meno recenti</SelectItem>
              <SelectItem value="title">Titolo A-Z</SelectItem>
              <SelectItem value="brain">Progetto</SelectItem>
              <SelectItem value="type">Tipo contenuto</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Caricamento…</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <Archive className="h-10 w-10 mx-auto text-muted-foreground" />
            <div className="text-sm text-muted-foreground">
              Nessun contenuto ancora. Usa Importa per aggiungere il primo file, prompt, task o appunto strategico.
            </div>
            <Button asChild>
              <Link to="/importa">Vai a Importa</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((it) => {
            const brainName = brainMap.get(it.brain_id ?? "") ?? "—";
            return (
              <Card key={it.id} className="flex flex-col">
                <CardContent className="p-4 flex-1 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate" title={it.title}>{it.title}</div>
                      <div className="text-xs text-muted-foreground truncate">{brainName}</div>
                    </div>
                    <Badge variant="secondary" className="shrink-0">{it.type_label}</Badge>
                  </div>
                  {it.preview && (
                    <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{it.preview}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {it.status && <Badge variant="outline">{it.status}</Badge>}
                    {it.tool && <Badge variant="outline">{it.tool}</Badge>}
                    {(it.tags ?? []).slice(0, 4).map((t) => (
                      <Badge key={t} variant="outline" className="opacity-70">{t}</Badge>
                    ))}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(it.created_at).toLocaleString()}
                  </div>
                </CardContent>
                <div className="flex flex-wrap gap-1 border-t p-2">
                  {it.brain_id && (
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/progetti/$brainId" params={{ brainId: it.brain_id }}>
                        <FolderOpen className="h-3.5 w-3.5 mr-1" /> Apri progetto
                      </Link>
                    </Button>
                  )}
                  {it.url && (
                    <Button asChild size="sm" variant="ghost">
                      <a href={it.url} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5 mr-1" /> Apri
                      </a>
                    </Button>
                  )}
                  {it.source !== "brain" && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setEditItem(it)}>
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Modifica
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => archive(it)}>
                        <Archive className="h-3.5 w-3.5 mr-1" /> Archivia
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDelItem(it)}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Elimina
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <EditDialog
        item={editItem}
        onClose={() => setEditItem(null)}
        onSaved={() => { setEditItem(null); invalidate(); }}
      />

      <AlertDialog open={!!delItem} onOpenChange={(o) => !o && setDelItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare definitivamente?</AlertDialogTitle>
            <AlertDialogDescription>
              "{delItem?.title}" verrà eliminato. Operazione non reversibile. Considera "Archivia" se vuoi conservarlo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => { if (delItem) { await remove(delItem); setDelItem(null); } }}
            >Elimina</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditDialog({
  item, onClose, onSaved,
}: { item: Item | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  // sync when item changes
  useMemo(() => {
    if (item) {
      setTitle(item.title);
      setBody(item.preview);
      setStatus(item.status ?? "");
    }
  }, [item]);

  if (!item) return null;

  const save = async () => {
    setSaving(true);
    try {
      const [src, id] = item.id.split(":");
      if (src === "task") {
        const { error } = await supabase.from("tasks").update({
          title, description: body, ...(status ? { status } : {}),
        }).eq("id", id);
        if (error) throw error;
      } else if (src === "roadmap") {
        const { error } = await supabase.from("roadmap_items").update({
          title, description: body, ...(status ? { status } : {}),
        }).eq("id", id);
        if (error) throw error;
      } else if (src === "node") {
        const { error } = await supabase.from("brain_nodes").update({
          label: title, summary: body,
        }).eq("id", id);
        if (error) throw error;
      } else if (src === "source") {
        const { error } = await supabase.from("knowledge_sources").update({
          title, extracted_text: body, ...(status ? { status } : {}),
        }).eq("id", id);
        if (error) throw error;
      } else if (src === "link") {
        const { error } = await supabase.from("project_links").update({
          title, notes: body, ...(status ? { status } : {}),
        }).eq("id", id);
        if (error) throw error;
      }
      toast.success("Contenuto aggiornato.");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Modifica contenuto</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Titolo</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Contenuto</Label>
            <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Stato</Label>
            <Input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="bozza, pronto, archiviato…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Annulla</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvataggio…" : "Salva"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
