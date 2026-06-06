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
import { FileText, Link2, Upload, Trash2, Eye, Library, Plus, Search, Sparkles, RefreshCw, FolderInput } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { importObsidianFiles, type ImportResult } from "@/lib/obsidian-import";
import {
  listKnowledgeSources, deleteKnowledgeSource, createManualSource,
  createUrlSource, uploadFileSource, listKnowledgeChunks, getFileSignedUrl,
  type KnowledgeSource, type KnowledgeChunk,
} from "@/lib/knowledge-api";
import {
  getEmbeddingStatus, generateEmbeddingsForBrain, generateEmbeddingsForSource,
  semanticSearch, friendlyEmbeddingError,
  type EmbeddingStatusCounts, type SemanticSearchResult,
} from "@/lib/semantic-api";
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

  const [status, setStatus] = useState<EmbeddingStatusCounts | null>(null);
  const [embedBusy, setEmbedBusy] = useState(false);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SemanticSearchResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

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

  const reloadStatus = useCallback(async () => {
    try {
      const counts = await getEmbeddingStatus(brainFilter === "all" ? null : brainFilter);
      setStatus(counts);
    } catch { /* silent */ }
  }, [brainFilter]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { reloadStatus(); }, [reloadStatus, sources]);

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

  const runEmbedBrain = async () => {
    if (brainFilter === "all") { toast.error("Seleziona un cervello"); return; }
    setEmbedBusy(true);
    try {
      const res = await generateEmbeddingsForBrain(brainFilter);
      if (res.error) toast.error(friendlyEmbeddingError(res.error));
      else toast.success(`Embeddings: ${res.processed}/${res.total} ok${res.failed ? `, ${res.failed} errori` : ""}`);
      reloadStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore embeddings");
    } finally { setEmbedBusy(false); }
  };

  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true); setSearchError(null);
    try {
      const res = await semanticSearch(query.trim(), {
        brainId: brainFilter === "all" ? null : brainFilter,
        limit: 10, threshold: 0.3,
      });
      if (res.error) {
        setSearchError(friendlyEmbeddingError(res.error));
        setSearchResults([]);
      } else {
        setSearchResults(res.results);
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Errore ricerca");
      setSearchResults([]);
    } finally { setSearching(false); }
  };

  const openSourceById = (sourceId: string) => {
    const src = sources.find((s) => s.id === sourceId);
    if (src) setDetail(src);
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
          <ObsidianImportDialog brains={brains} nodes={nodes} onCreated={reload} />
        </div>
      </div>

      {/* Search + status bar */}
      <div className="rounded-2xl border border-border bg-card/60 p-3 glass">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
              placeholder="Cerca nella memoria…"
              className="pl-8"
            />
          </div>
          <Button onClick={runSearch} disabled={searching || !query.trim()} size="sm">
            {searching ? "Cerco…" : "Cerca"}
          </Button>
          {searchResults !== null && (
            <Button variant="ghost" size="sm" onClick={() => { setSearchResults(null); setQuery(""); setSearchError(null); }}>
              Pulisci
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
            {status && (
              <>
                <Badge variant="outline">{status.total} chunk</Badge>
                <Badge variant="outline" className="text-emerald-400">{status.ready} ready</Badge>
                {status.pending > 0 && <Badge variant="outline" className="text-amber-400">{status.pending} pending</Badge>}
                {status.error > 0 && <Badge variant="outline" className="text-destructive">{status.error} err</Badge>}
              </>
            )}
            <Button size="sm" variant="outline" onClick={runEmbedBrain} disabled={embedBusy || brainFilter === "all"}>
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              {embedBusy ? "Generazione…" : "Genera embeddings"}
            </Button>
          </div>
        </div>
        {brainFilter === "all" && status && status.pending > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">Seleziona un cervello per generare gli embeddings dei chunk pending.</p>
        )}
      </div>

      <div className="min-h-0 flex-1 rounded-2xl border border-border bg-card/40 glass">
        {searchResults !== null ? (
          <SearchResultsView
            results={searchResults} error={searchError}
            brainName={brainName} nodeName={nodeName}
            onOpen={openSourceById}
          />
        ) : loading ? (
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

      <SourceDetailDialog
        source={detail}
        brainName={detail ? brainName(detail.brain_id) : ""}
        nodeLabel={detail?.node_id ? nodeName(detail.node_id) : undefined}
        onClose={() => setDetail(null)}
        onChunksChanged={reloadStatus}
      />
    </div>
  );
}

function SearchResultsView({ results, error, brainName, nodeName, onOpen }: {
  results: SemanticSearchResult[]; error: string | null;
  brainName: (id: string) => string; nodeName: (id: string | null) => string | undefined;
  onOpen: (sourceId: string) => void;
}) {
  if (error) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <Sparkles className="mx-auto h-8 w-8 text-amber-400/70" />
          <div className="mt-2 text-sm font-medium">Ricerca non disponibile</div>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground">
        Nessun risultato. Genera gli embeddings o prova con un'altra query.
      </div>
    );
  }
  return (
    <div className="space-y-2 overflow-y-auto scrollbar-thin p-3">
      {results.map((r) => (
        <div key={r.chunk_id} className="rounded-xl border border-border/70 bg-background/40 p-3 transition hover:border-primary/60">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className="font-medium text-sm text-foreground">{r.source_title}</span>
                <Badge variant="outline" className="capitalize">{r.source_type}</Badge>
                <Badge variant="outline">{brainName(r.brain_id)}</Badge>
                {r.node_id && nodeName(r.node_id) && <Badge variant="outline">↳ {nodeName(r.node_id)}</Badge>}
                {(r.source_tags ?? []).slice(0, 3).map((t) => <Badge key={t} variant="secondary">#{t}</Badge>)}
              </div>
              <p className="mt-1.5 line-clamp-3 text-xs text-muted-foreground">{r.content}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge className="bg-gradient-primary text-primary-foreground">{Math.round(r.similarity * 100)}%</Badge>
              <Button size="sm" variant="ghost" onClick={() => onOpen(r.source_id)}>Apri</Button>
            </div>
          </div>
        </div>
      ))}
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

function SourceDetailDialog({ source, brainName, nodeLabel, onClose, onChunksChanged }: {
  source: KnowledgeSource | null; brainName: string; nodeLabel?: string; onClose: () => void; onChunksChanged?: () => void;
}) {
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [embedding, setEmbedding] = useState(false);

  const reloadChunks = useCallback(async () => {
    if (!source) return;
    try { setChunks(await listKnowledgeChunks(source.id)); } catch { setChunks([]); }
  }, [source]);

  useEffect(() => {
    if (!source) { setChunks([]); setFileUrl(null); return; }
    reloadChunks();
    if (source.file_path) getFileSignedUrl(source.file_path).then(setFileUrl);
  }, [source, reloadChunks]);

  const runEmbed = async () => {
    if (!source) return;
    setEmbedding(true);
    try {
      const res = await generateEmbeddingsForSource(source.id);
      if (res.error) toast.error(friendlyEmbeddingError(res.error));
      else toast.success(`Embeddings: ${res.processed}/${res.total}${res.failed ? ` (${res.failed} errori)` : ""}`);
      await reloadChunks();
      onChunksChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore embeddings");
    } finally { setEmbedding(false); }
  };

  const readyCount = chunks.filter((c) => (c as KnowledgeChunk & { embedding_status?: string }).embedding_status === "ready").length;
  const errCount = chunks.filter((c) => (c as KnowledgeChunk & { embedding_status?: string }).embedding_status === "error").length;

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
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-medium text-muted-foreground">
                      {chunks.length} chunk · <span className="text-emerald-400">{readyCount} ready</span>
                      {errCount > 0 && <> · <span className="text-destructive">{errCount} errori</span></>}
                    </div>
                    <Button size="sm" variant="outline" onClick={runEmbed} disabled={embedding}>
                      {embedding ? <><RefreshCw className="mr-1 h-3 w-3 animate-spin" /> Genero…</> : <><Sparkles className="mr-1 h-3 w-3" /> Genera embeddings</>}
                    </Button>
                  </div>
                  <div className="space-y-1">
                    {chunks.map((c) => {
                      const cs = c as KnowledgeChunk & { embedding_status?: string; embedding_error?: string | null };
                      const st = cs.embedding_status ?? "pending";
                      return (
                        <div key={c.id} className="rounded border border-border/60 bg-background/40 p-2 text-[11px]">
                          <div className="mb-1 flex items-center justify-between text-muted-foreground">
                            <span>#{c.chunk_index} · ~{c.token_estimate} token</span>
                            <Badge variant="outline" className={
                              st === "ready" ? "text-emerald-400" :
                              st === "error" ? "text-destructive" :
                              st === "processing" ? "text-amber-400" : ""
                            }>{st}</Badge>
                          </div>
                          <div className="line-clamp-3">{c.content}</div>
                          {cs.embedding_error && <div className="mt-1 text-destructive text-[10px]">{cs.embedding_error}</div>}
                        </div>
                      );
                    })}
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

function ObsidianImportDialog({ brains, nodes, onCreated }: { brains: Brain[]; nodes: BrainNode[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [tags, setTags] = useState("");
  const [useFilename, setUseFilename] = useState(false);
  const [extractTags, setExtractTags] = useState(true);
  const [detectLinks, setDetectLinks] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const f = useBrainNodeForm(brains);

  const reset = () => {
    setFiles([]); setTags(""); setProgress(null); setResult(null);
  };

  const submit = async () => {
    if (!f.brainId || files.length === 0) return;
    setBusy(true); setProgress(null); setResult(null);
    try {
      const res = await importObsidianFiles(files, {
        brainId: f.brainId,
        nodeId: f.nodeId === "none" ? null : f.nodeId,
        manualTags: parseTags(tags),
        useFilenameAsTitle: useFilename,
        extractObsidianTags: extractTags,
        detectInternalLinks: detectLinks,
      }, (done, total) => setProgress({ done, total }));
      setResult(res);
      toast.success(`Importate ${res.imported} note${res.ignored ? `, ${res.ignored} ignorate` : ""}`);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore import");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={brains.length === 0}>
          <FolderInput className="mr-1 h-3.5 w-3.5" /> Obsidian
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Importa da Obsidian</DialogTitle>
          <DialogDescription>Carica file .md, .txt o un .zip esportato dal tuo vault.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <BrainNodeSelects brains={brains} nodes={nodes} {...f} />
          <div>
            <Label className="text-xs">File (.md, .txt, .zip)</Label>
            <Input type="file" multiple accept=".md,.markdown,.txt,.zip"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            {files.length > 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">{files.length} file selezionati</p>
            )}
          </div>
          <div>
            <Label className="text-xs">Tag aggiuntivi (separati da virgola)</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="obsidian, vault" />
          </div>
          <div className="space-y-2 rounded border border-border bg-background/40 p-2">
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={useFilename} onCheckedChange={(v) => setUseFilename(Boolean(v))} />
              Usa il nome del file come titolo
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={extractTags} onCheckedChange={(v) => setExtractTags(Boolean(v))} />
              Estrai tag Obsidian (#tag e frontmatter)
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={detectLinks} onCheckedChange={(v) => setDetectLinks(Boolean(v))} />
              Riconosci link interni [[...]]
            </label>
          </div>
          {progress && (
            <p className="text-[11px] text-muted-foreground">Processate {progress.done}/{progress.total} note…</p>
          )}
          {result && (
            <div className="rounded border border-border bg-background/40 p-2 text-[11px]">
              <div>Importate: <span className="text-emerald-400">{result.imported}</span></div>
              {result.ignored > 0 && <div>Ignorate: <span className="text-amber-400">{result.ignored}</span></div>}
              {result.errors.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-destructive">{result.errors.length} errori</summary>
                  <ul className="mt-1 max-h-24 overflow-auto pl-4">
                    {result.errors.slice(0, 10).map((e, i) => <li key={i} className="truncate">{e}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Chiudi</Button>
          <Button onClick={submit} disabled={busy || files.length === 0 || !f.brainId}>
            {busy ? "Import…" : "Importa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
