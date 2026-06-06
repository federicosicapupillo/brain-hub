import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ExternalLink,
  MessageSquare,
  ListPlus,
  Link2,
  Brain as BrainIcon,
  FileText,
  Clock,
  Sparkles,
} from "lucide-react";
import type { Brain, BrainNode, BrainEdge } from "@/lib/demo-data";

interface Props {
  node?: BrainNode;
  brains: Brain[];
  nodes: BrainNode[];
  edges: BrainEdge[];
  onSelect: (id: string) => void;
}

function fmt(d: string) {
  return new Date(d).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" });
}

export function NodeDetailPanel({ node, brains, nodes, edges, onSelect }: Props) {
  if (!node) return <OverviewPanel brains={brains} nodes={nodes} />;
  const brain = brains.find((b) => b.id === node.brainId);
  const neighborIds = new Set<string>();
  edges.forEach((e) => {
    if (e.source === node.id) neighborIds.add(e.target);
    if (e.target === node.id) neighborIds.add(e.source);
  });
  const links = nodes.filter((n) => neighborIds.has(n.id));

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto scrollbar-thin p-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: brain?.color }}
          />
          {brain?.name}
          <span>·</span>
          <span className="capitalize">{node.type}</span>
        </div>
        <h2 className="mt-1 text-lg font-semibold leading-tight">{node.label}</h2>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Info label="Origine" value={node.origin} />
        <Info label="Aggiornato" value={fmt(node.updatedAt)} />
      </div>

      <div className="rounded-lg border border-border bg-card/60 p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-accent">
          <Sparkles className="h-3.5 w-3.5" /> Riassunto AI
        </div>
        <p className="text-sm leading-relaxed text-foreground/90">{node.summary}</p>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Tag</div>
        <div className="flex flex-wrap gap-1">
          {node.tags.map((t) => (
            <Badge key={t} variant="secondary" className="capitalize">
              {t}
            </Badge>
          ))}
        </div>
      </div>

      <Separator />

      <div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Collegamenti principali</div>
        <div className="flex flex-col gap-1">
          {links.length === 0 && (
            <div className="text-xs text-muted-foreground">Nessun collegamento.</div>
          )}
          {links.slice(0, 8).map((l) => (
            <button
              key={l.id}
              onClick={() => onSelect(l.id)}
              className="flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-2 py-1.5 text-left text-sm hover:border-primary/60 hover:bg-primary/10"
            >
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">{l.label}</span>
              <span className="ml-auto text-[10px] capitalize text-muted-foreground">{l.type}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-auto grid grid-cols-2 gap-2 pt-2">
        <Button variant="default" className="bg-gradient-primary text-primary-foreground">
          <ExternalLink className="mr-1 h-4 w-4" /> Apri
        </Button>
        <Button variant="outline">
          <MessageSquare className="mr-1 h-4 w-4" /> Chiedi all'agente
        </Button>
        <Button variant="outline">
          <ListPlus className="mr-1 h-4 w-4" /> Crea task
        </Button>
        <Button variant="outline">
          <Link2 className="mr-1 h-4 w-4" /> Collega
        </Button>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-card/40 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate text-sm capitalize">{value}</div>
    </div>
  );
}

function OverviewPanel({ brains, nodes }: { brains: Brain[]; nodes: BrainNode[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const updatedToday = nodes.filter((n) => n.updatedAt?.startsWith(today)).length;
  const totalDocs = nodes.filter((n) => n.type === "documento").length;
  const totalWeight = nodes.length * 1.4;
  const lastUpdate = nodes.map((n) => n.updatedAt).sort().at(-1) ?? new Date().toISOString();

  const byType = nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto scrollbar-thin p-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <BrainIcon className="h-3.5 w-3.5" /> Panoramica cervello
        </div>
        <h2 className="mt-1 text-lg font-semibold">Il tuo Second Brain</h2>
        <p className="text-xs text-muted-foreground">
          Seleziona un nodo nel grafo per esplorarne i dettagli.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Neuroni" value={nodes.length.toString()} accent="violet" />
        <Stat label="Documenti" value={totalDocs.toString()} accent="cyan" />
        <Stat label="Peso totale" value={`${totalWeight.toFixed(1)} MB`} accent="pink" />
        <Stat label="Aggiornati oggi" value={updatedToday.toString()} accent="emerald" />
      </div>

      <div className="rounded-lg border border-border bg-card/60 p-3 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
          <Clock className="h-3.5 w-3.5" /> Ultimo update
        </div>
        <div className="mt-1 text-sm">{fmt(lastUpdate)}</div>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Cervelli collegati</div>
        <div className="flex flex-col gap-1">
          {brains.map((b) => (
            <div
              key={b.id}
              className="flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-2 py-1.5 text-sm"
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />
              <span className="truncate">{b.name}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">{b.nodeCount} nodi</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Distribuzione per tipo</div>
        <div className="space-y-1.5">
          {Object.entries(byType).map(([k, v]) => {
            const pct = (v / nodes.length) * 100;
            return (
              <div key={k}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="capitalize">{k}</span>
                  <span className="text-muted-foreground">{v}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-gradient-primary" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: "violet" | "cyan" | "pink" | "emerald" }) {
  const color =
    accent === "violet"
      ? "var(--neon-violet)"
      : accent === "cyan"
      ? "var(--neon-cyan)"
      : accent === "pink"
      ? "var(--neon-pink)"
      : "var(--neon-emerald)";
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
