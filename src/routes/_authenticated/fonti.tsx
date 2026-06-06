import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { FileText, Link2, Upload, Trash2, Eye, Library, Plus } from "lucide-react";
import {
  listKnowledgeSources, deleteKnowledgeSource, createManualSource,
  createUrlSource, uploadFileSource, listKnowledgeChunks, getFileSignedUrl,
  type KnowledgeSource, type KnowledgeChunk,
} from "@/lib/knowledge-api";
import { fetchAll } from "@/lib/brains-api";
import type { Brain, BrainNode } from "@/lib/demo-data";

export const Route = createFileRoute("/_authenticated/fonti")({
  head: () => ({
    meta: [
      { title: "Fonti — Personal AI Brain Dashboard" },
      { name: "description", content: "Carica e gestisci la memoria del tuo cervello digitale: note, link e file." },
    ],
  }),
  component: FontiPage,
});

function FontiPage() {
  const [brains, setBrains] = useState<Brain[]>([]);
  const [nodes, setNodes] = useState<BrainNode[]>([]);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [brainFilter, setBrainFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<KnowledgeSource | null>(null);

  const reload = useCallback(async () => {
    try {
      const [data, list] = await Promise.all([fetchAll(), listKnowledgeSources()]);
      setBrains(data.brains);
      setNodes(data.nodes);
      setSources(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore caricamento fonti");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const filtered = useMemo(
    () => sources.filter((s) => brainFilter === "all" || s.brain_id === brainFilter),
    [sources, brainFilter],
  );

  const brainName = (id: string) => brains.find((b) => b.id === id)?.name ?? "—";
  const nodeName = (id: string | null) => nodes.find((n) => n.id === id)?.label;

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Eliminare la fonte "${title}"?`)) return;
    try {
      await deleteKnowledgeSource(id);
      toast.success("Fonte eliminata");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore eliminazione");
    }
  };

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-3 p-3 lg:p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-gradient-primary">Fonti</h1>
        <Badge variant="secondary" className="font-mono text-[10px]">{filtered.length} memoria</Badge>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={brainFilter} onValueChange={setBrainFilter}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Tutti i cervelli" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i cervelli</SelectItem>
              {brains.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <ManualSourceDialog brains={brains} nodes={nodes} onCreated={reload} />
          <UrlSourceDialog brains={brains} nodes={nodes} onCreated={reload} />
          <FileSourceDialog brains={brains} nodes={nodes} onCreated={reload} />
        </div>
      </div>

      <div className="min-h-0 flex-1 rounded-2xl border border-border bg-card/40 glass">
        {loading ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">Caricamento…</div>
        ) : brains.length === 0 ? (
          <EmptyState message="Crea prima un cervello dalla pagina Cervelli per aggiungere fonti." />
        ) : filtered.length === 0 ? (
          <EmptyState message="Nessuna fonte ancora. Aggiungi una nota, un link o un file." brains={brains} nodes={nodes} onCreated={reload} />
        ) : (
          <div className="grid gap-3 overflow-y-auto scrollbar-thin p-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((s) => (
              <div key={s.id} className="group flex flex-col gap-2 rounded-xl border border-border/70 bg-background/40 p-4 transition hover:border-primary/60 hover:shadow-[0_0_24px_-8px_var(--primary)]">
                <div className="flex items-start gap-2">
                  <SourceIcon type={s.source_type} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{s.title}</div>
                    <div className="line-clamp-2 text-xs text-muted-foreground">
                      {s.description || s.url || s.file_name || (s.extracted_text?.slice(0, 120) ?? "—")}
                    </div>
                  </div>
                  <StatusDot status={s.status} />
                </div>
                <div className="flex flex-wrap items-center gap-1 text-[10px]">
                  <Badge variant="outline" className="capitalize">{s.source_type}</Badge>
                  <Badge variant="outline">{brainName(s.brain_id)}</Badge>
                  {s.node_id && nodeName(s.node_id) && <Badge variant="outline">↳ {nodeName(s.node_id)}</Badge>}
                  {s.tags.slice(0, 3).map((t) => <Badge key={t} variant="secondary" className="text-[10px]">#{t}</Badge>)}
                </div>
                <div className="mt-auto flex items-center justify-between pt-2 text-xs">
                  <span className="text-muted-foreground">{new Date(s.created_at).toLocaleDateString()}</span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setDetail(s)}>
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(s.id, s.title)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <SourceDetailDialog source={detail} brainName={detail ? brainName(detail.brain_id) : ""} nodeLabel={detail?.node_id ? nodeName(detail.node_id) : undefined} onClose={() => setDetail(null)} />
    </div>
  );
}

function SourceIcon({ type }: { type: string }) {
  const cls = "h-4 w-4 mt-0.5 text-primary";
  if (type === "url") return <Link2 className={cls} />;
  if (type === "file") return <Upload className={cls} />;
  return <FileText className={cls} />;
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    ready: "bg-emerald-400",
    processing: "bg-amber-400 animate-pulse",
    pending: "bg-muted",
    error: "bg-destructive",
  };
  return <span className={`h-2 w-2 rounded-full ${map[status] ?? "bg-muted"}`} title={status} />;
}

function EmptyState({ message, brains, nodes, onCreated }: { message: string; brains?: Brain[]; nodes?: BrainNode[]; onCreated?: () => void }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div>
        <Library className="mx-auto h-10 w-10 text-primary/60" />
        <div className="mt-3 text-lg font-semibold text-gradient-primary">Memoria vuota</div>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{message}</p>
        {brains && brains.length > 0 && onCreated && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <ManualSourceDialog brains={brains} nodes={nodes ?? []} onCreated={onCreated} />
            <UrlSourceDialog brains={brains} nodes={nodes ?? []} onCreated={onCreated} />
            <FileSourceDialog brains={brains} nodes={nodes ?? []} onCreated={onCreated} />
          </div>
        )}
      </div>
    </div>
  );
}

// ============ Dialogs ============
function useBrainNodeForm(brains: Brain[]) {
  const [brainId, setBrainId] = useState<string>(brains[0]?.id ?? "");
  useEffect(() => { if (!brainId && brains[0]) setBrainId(brains[0].id); }, [brains, brainId]);
  const [nodeId, setNodeId] = useState<string>("none");
  return { brainId, setBrainId, nodeId, setNodeId };
}

function BrainNodeSelects({ brains, nodes, brainId, setBrainId, nodeId, setNodeId }: {
  brains: Brain[]; nodes: BrainNode[]; brainId: string; setBrainId: (s: string) => void; nodeId: string; setNodeId: (s: string) => void;
}) {
  const brainNodes = nodes.filter((n) => n.brainId === brainId);
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <Label className="text-xs">Cervello</Label>
        <Select value={brainId} onValueChange={setBrainId}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{brains.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Nodo (opzionale)</Label>
        <Select value={nodeId} onValueChange={setNodeId}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— Nessuno —</SelectItem>
            {brainNodes.map((n) => <SelectItem key={n.id} value={n.id}>{n.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function parseTags(v: string): string[] {
  return v.split(",").map((t) => t.trim()).filter(Boolean);
}

function ManualSourceDialog({ brains, nodes, onCreated }: { brains: Brain[]; nodes: BrainNode[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const f = useBrainNodeForm(brains);

  const submit = async () => {
    if (!title.trim() || !f.brainId) return;
    setBusy(true);
    try {
      await createManualSource({
        brain_id: f.brainId, node_id: f.nodeId === "none" ? null : f.nodeId,
        title: title.trim(), content, tags: parseTags(tags),
      });
      toast.success("Nota salvata");
      setOpen(false); setTitle(""); setContent(""); setTags("");
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore salvataggio");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={brains.length === 0}>
          <FileText className="mr-1 h-3.5 w-3.5" /> Nota
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuova nota</DialogTitle>
          <DialogDescription>Salva un testo manuale nella memoria del cervello.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <BrainNodeSelects brains={brains} nodes={nodes} {...f} />
          <div><Label className="text-xs">Titolo</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Es. Note riunione progetto" /></div>
          <div><Label className="text-xs">Testo</Label><Textarea rows={8} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Scrivi qui il contenuto…" /></div>
          <div><Label className="text-xs">Tag (separati da virgola)</Label><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="idea, progetto" /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Annulla</Button>
          <Button onClick={submit} disabled={busy || !title.trim()}>{busy ? "Salvataggio…" : "Salva"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UrlSourceDialog({ brains, nodes, onCreated }: { brains: Brain[]; nodes: BrainNode[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [desc, setDesc] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const f = useBrainNodeForm(brains);

  const submit = async () => {
    if (!title.trim() || !url.trim() || !f.brainId) return;
    setBusy(true);
    try {
      await createUrlSource({
        brain_id: f.brainId, node_id: f.nodeId === "none" ? null : f.nodeId,
        title: title.trim(), url: url.trim(), description: desc, tags: parseTags(tags),
      });
      toast.success("Link salvato");
      setOpen(false); setTitle(""); setUrl(""); setDesc(""); setTags("");
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore salvataggio");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={brains.length === 0}>
          <Link2 className="mr-1 h-3.5 w-3.5" /> Link
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuovo link</DialogTitle>
          <DialogDescription>Salva un riferimento web nella memoria.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <BrainNodeSelects brains={brains} nodes={nodes} {...f} />
          <div><Label className="text-xs">Titolo</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><Label className="text-xs">URL</Label><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></div>
          <div><Label className="text-xs">Descrizione (opzionale)</Label><Textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <div><Label className="text-xs">Tag</Label><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="ref, articolo" /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Annulla</Button>
          <Button onClick={submit} disabled={busy || !title.trim() || !url.trim()}>{busy ? "Salvataggio…" : "Salva"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FileSourceDialog({ brains, nodes, onCreated }: { brains: Brain[]; nodes: BrainNode[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const f = useBrainNodeForm(brains);

  const submit = async () => {
    if (!file || !f.brainId) return;
    setBusy(true);
    try {
      await uploadFileSource({
        brain_id: f.brainId, node_id: f.nodeId === "none" ? null : f.nodeId,
        title: title || file.name, file, tags: parseTags(tags),
      });
      toast.success("File caricato");
      setOpen(false); setFile(null); setTitle(""); setTags("");
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore upload");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={brains.length === 0}>
          <Plus className="mr-1 h-3.5 w-3.5" /> File
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Carica file</DialogTitle>
          <DialogDescription>Max 20 MB. Formati: txt, md, csv, json, pdf, docx.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <BrainNodeSelects brains={brains} nodes={nodes} {...f} />
          <div>
            <Label className="text-xs">File</Label>
            <Input type="file" accept=".txt,.md,.csv,.json,.pdf,.docx" onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setFile(file);
              if (file && !title) setTitle(file.name);
            }} />
          </div>
          <div><Label className="text-xs">Titolo</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><Label className="text-xs">Tag</Label><Input value={tags} onChange={(e) => setTags(e.target.value)} /></div>
          <p className="text-[11px] text-muted-foreground">
            PDF e DOCX vengono salvati ma il testo verrà estratto in una fase successiva.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Annulla</Button>
          <Button onClick={submit} disabled={busy || !file}>{busy ? "Caricamento…" : "Carica"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SourceDetailDialog({ source, brainName, nodeLabel, onClose }: {
  source: KnowledgeSource | null; brainName: string; nodeLabel?: string; onClose: () => void;
}) {
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!source) { setChunks([]); setFileUrl(null); return; }
    listKnowledgeChunks(source.id).then(setChunks).catch(() => setChunks([]));
    if (source.file_path) getFileSignedUrl(source.file_path).then(setFileUrl);
  }, [source]);

  return (
    <Dialog open={!!source} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden">
        {source && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <SourceIcon type={source.source_type} /> {source.title}
              </DialogTitle>
              <DialogDescription>
                <span className="capitalize">{source.source_type}</span> · stato: {source.status} · {new Date(source.created_at).toLocaleString()}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 overflow-y-auto scrollbar-thin pr-2">
              <div className="flex flex-wrap gap-1 text-[10px]">
                <Badge variant="outline">{brainName}</Badge>
                {nodeLabel && <Badge variant="outline">↳ {nodeLabel}</Badge>}
                {source.tags.map((t) => <Badge key={t} variant="secondary">#{t}</Badge>)}
              </div>
              {source.description && <p className="text-sm text-muted-foreground">{source.description}</p>}
              {source.url && (
                <a href={source.url} target="_blank" rel="noreferrer" className="block break-all rounded border border-border bg-background/50 p-2 text-xs text-primary hover:underline">
                  {source.url}
                </a>
              )}
              {source.file_name && (
                <div className="rounded border border-border bg-background/50 p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{source.file_name} {source.file_size ? `· ${(source.file_size / 1024).toFixed(1)} KB` : ""}</span>
                    {fileUrl && <a href={fileUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">Apri</a>}
                  </div>
                </div>
              )}
              {source.extracted_text && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Testo estratto</div>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border bg-background/50 p-2 text-xs">{source.extracted_text.slice(0, 4000)}</pre>
                </div>
              )}
              {chunks.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">{chunks.length} chunk generati</div>
                  <div className="space-y-1">
                    {chunks.map((c) => (
                      <div key={c.id} className="rounded border border-border/60 bg-background/40 p-2 text-[11px]">
                        <div className="mb-1 text-muted-foreground">#{c.chunk_index} · ~{c.token_estimate} token</div>
                        <div className="line-clamp-3">{c.content}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
