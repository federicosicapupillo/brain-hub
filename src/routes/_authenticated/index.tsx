import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import { BrainGraph } from "@/components/BrainGraph";
import { NodeDetailPanel } from "@/components/NodeDetailPanel";
import { CreateBrainDialog } from "@/components/CreateBrainDialog";
import { CreateNodeDialog } from "@/components/CreateNodeDialog";
import { CreateEdgeDialog } from "@/components/CreateEdgeDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Brain, BrainEdge, BrainNode, BrainOrigin } from "@/lib/demo-data";
import { fetchAll } from "@/lib/brains-api";
import { Grid3x3, List, Box, LayoutGrid, Globe, Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Cervelli — Personal AI Brain Dashboard" },
      { name: "description", content: "Visualizza, organizza e interroga tutti i tuoi cervelli AI da un'unica dashboard." },
    ],
  }),
  component: BrainsPage,
});

type View = "grafo" | "lista";
type Visibility = "tutti" | "pubbliche" | "protette";
type OriginFilter = "tutti" | BrainOrigin;

const ORIGINS: { id: OriginFilter; label: string }[] = [
  { id: "tutti", label: "Tutti i cervelli" },
  { id: "obsidian", label: "Obsidian" },
  { id: "gdrive", label: "Google Drive" },
  { id: "github", label: "GitHub" },
  { id: "manuale", label: "Manuale" },
  { id: "supabase", label: "Supabase" },
  { id: "altro", label: "Altro" },
];

function BrainsPage() {
  const [brains, setBrains] = useState<Brain[]>([]);
  const [nodes, setNodes] = useState<BrainNode[]>([]);
  const [edges, setEdges] = useState<BrainEdge[]>([]);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<string | undefined>();
  const [view, setView] = useState<View>("grafo");
  const [graphMode, setGraphMode] = useState<"2d" | "3d">("2d");
  const [visibility, setVisibility] = useState<Visibility>("tutti");
  const [origin, setOrigin] = useState<OriginFilter>("tutti");

  const reload = useCallback(async () => {
    try {
      const data = await fetchAll();
      setBrains(data.brains);
      setNodes(data.nodes);
      setEdges(data.edges);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore caricamento dati");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const filteredBrains = useMemo(() => brains.filter((b) => {
    if (visibility === "pubbliche" && b.visibility !== "pubblico") return false;
    if (visibility === "protette" && b.visibility !== "protetto") return false;
    if (origin !== "tutti" && b.origin !== origin) return false;
    return true;
  }), [brains, visibility, origin]);

  const brainIds = useMemo(() => new Set(filteredBrains.map((b) => b.id)), [filteredBrains]);
  const filteredNodes = useMemo(() => nodes.filter((n) => brainIds.has(n.brainId)), [nodes, brainIds]);
  const nodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);
  const filteredEdges = useMemo(
    () => edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)),
    [edges, nodeIds],
  );

  const selectedNode = selected ? filteredNodes.find((n) => n.id === selected) : undefined;

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-3 p-3 lg:p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-gradient-primary">Cervelli</h1>
        <Badge variant="secondary" className="font-mono text-[10px]">
          {filteredBrains.length} attivi
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <CreateNodeDialog brains={brains} defaultBrainId={selectedNode?.brainId} onCreated={reload} />
          <CreateBrainDialog onCreated={reload} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={visibility} onChange={(v) => setVisibility(v as Visibility)} items={[
          { id: "tutti", label: "Tutti" },
          { id: "pubbliche", label: "Pubbliche", icon: <Globe className="h-3 w-3" /> },
          { id: "protette", label: "Protette", icon: <ShieldCheck className="h-3 w-3" /> },
        ]} />
        <Segmented value={view} onChange={(v) => setView(v as View)} items={[
          { id: "grafo", label: "Grafo", icon: <Grid3x3 className="h-3 w-3" /> },
          { id: "lista", label: "Lista", icon: <List className="h-3 w-3" /> },
        ]} />
        <Segmented value={graphMode} onChange={(v) => setGraphMode(v as "2d" | "3d")} items={[
          { id: "2d", label: "2D", icon: <LayoutGrid className="h-3 w-3" /> },
          { id: "3d", label: "3D", icon: <Box className="h-3 w-3" /> },
        ]} />
        <div className="ml-auto flex flex-wrap gap-1.5">
          {ORIGINS.map((o) => (
            <button key={o.id} onClick={() => setOrigin(o.id)} className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
              origin === o.id ? "border-primary/60 bg-primary/15 text-foreground"
              : "border-border bg-card/50 text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}>{o.label}</button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
        <div className="min-h-[420px]">
          {loading ? (
            <div className="grid h-full place-items-center rounded-2xl border border-border bg-card/40 text-sm text-muted-foreground glass">Caricamento…</div>
          ) : brains.length === 0 ? (
            <EmptyState onReload={reload} />
          ) : view === "lista" ? (
            <BrainsListView filteredBrains={filteredBrains} nodes={nodes} onSelect={setSelected} />
          ) : (
            <BrainGraph nodes={filteredNodes} edges={filteredEdges} brains={filteredBrains}
              selectedId={selected} onSelect={setSelected} mode={graphMode} />
          )}
        </div>
        <aside className="hidden min-h-0 rounded-2xl border border-border bg-card/60 glass lg:block">
          <NodeDetailPanel node={selectedNode} brains={brains} nodes={nodes} edges={edges} onSelect={setSelected} />
          {selectedNode && (
            <div className="border-t border-border/60 p-3">
              <CreateEdgeDialog nodes={nodes} fromNode={selectedNode} onCreated={reload} />
            </div>
          )}
        </aside>
      </div>

      {selectedNode && (
        <div className="rounded-2xl border border-border bg-card/60 glass lg:hidden">
          <NodeDetailPanel node={selectedNode} brains={brains} nodes={nodes} edges={edges} onSelect={setSelected} />
          <div className="flex gap-2 p-3">
            <CreateEdgeDialog nodes={nodes} fromNode={selectedNode} onCreated={reload} />
            <Button variant="ghost" onClick={() => setSelected(undefined)}>Chiudi</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ onReload }: { onReload: () => void }) {
  const [creating, setCreating] = useState(false);
  async function handleStarter() {
    setCreating(true);
    try {
      const { createStarterWorkspace } = await import("@/lib/starter-api");
      await createStarterWorkspace();
      toast.success("Workspace iniziale creato.");
      onReload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Errore";
      if (msg === "ALREADY_EXISTS") {
        toast("Hai già un workspace attivo.");
        onReload();
      } else {
        toast.error(msg);
      }
    } finally {
      setCreating(false);
    }
  }
  return (
    <div className="grid h-full place-items-center rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center glass">
      <div className="max-w-md">
        <div className="text-lg font-semibold text-gradient-primary">Nessun cervello ancora</div>
        <p className="mt-2 text-sm text-muted-foreground">
          Il tuo spazio è collegato ai dati reali, ma non hai ancora creato nessun cervello. I dati demo sono stati rimossi.
        </p>
        <p className="mt-2 text-xs text-muted-foreground/80">
          Usa il pulsante "+ Cervello" in alto a destra per crearne uno, oppure genera un workspace iniziale di esempio.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button
            onClick={handleStarter}
            disabled={creating}
            className="bg-gradient-primary text-primary-foreground"
          >
            {creating ? "Creazione…" : "Crea workspace iniziale"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Segmented({ value, onChange, items }: {
  value: string; onChange: (v: string) => void;
  items: { id: string; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div className="flex rounded-md border border-border bg-card/50 p-0.5 text-xs">
      {items.map((it) => (
        <button key={it.id} onClick={() => onChange(it.id)}
          className={`flex items-center gap-1 rounded px-2.5 py-1 transition ${
            value === it.id ? "bg-gradient-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}>
          {it.icon}{it.label}
        </button>
      ))}
    </div>
  );
}

function BrainsListView({ filteredBrains, nodes, onSelect }: {
  filteredBrains: Brain[]; nodes: BrainNode[]; onSelect: (id: string) => void;
}) {
  return (
    <div className="grid h-full grid-cols-1 gap-3 overflow-y-auto scrollbar-thin rounded-2xl border border-border bg-card/40 p-3 glass sm:grid-cols-2 xl:grid-cols-3">
      {filteredBrains.map((b) => {
        const brainNodes = nodes.filter((n) => n.brainId === b.id);
        return (
          <div key={b.id} className="group flex flex-col gap-2 rounded-xl border border-border/70 bg-background/40 p-4 transition hover:border-primary/60 hover:shadow-[0_0_24px_-8px_var(--primary)]">
            <div className="flex items-start gap-2">
              <span className="mt-1 h-3 w-3 rounded-full animate-pulse-glow" style={{ background: b.color, color: b.color }} />
              <div className="min-w-0">
                <div className="truncate font-medium">{b.name}</div>
                <div className="line-clamp-2 text-xs text-muted-foreground">{b.description}</div>
              </div>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Badge variant="outline" className="capitalize">{b.kind}</Badge>
              <Badge variant="outline" className="capitalize">{b.origin}</Badge>
              <Badge variant="outline" className="capitalize">
                {b.visibility === "privato" ? <Lock className="mr-0.5 h-3 w-3" /> : b.visibility === "pubblico" ? <Globe className="mr-0.5 h-3 w-3" /> : <ShieldCheck className="mr-0.5 h-3 w-3" />}
                {b.visibility}
              </Badge>
            </div>
            <div className="mt-auto flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{b.nodeCount} nodi</span>
              <Button size="sm" variant="ghost" onClick={() => onSelect(brainNodes[0]?.id ?? "")}>Apri →</Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
