// Demo data for the Personal AI Brain Dashboard.
// Shape mirrors the future Supabase schema so swapping to live data is straight-forward.

export type BrainOrigin = "manuale" | "obsidian" | "gdrive" | "github" | "supabase" | "altro";
export type BrainKind = "progetto" | "archivio" | "agente" | "documenti" | "prompt" | "business";
export type Visibility = "privato" | "protetto" | "pubblico";

export interface Brain {
  id: string;
  name: string;
  description: string;
  origin: BrainOrigin;
  kind: BrainKind;
  visibility: Visibility;
  color: string; // CSS color token / hex
  nodeCount: number;
  updatedAt: string;
}

export type NodeType =
  | "nota"
  | "documento"
  | "progetto"
  | "task"
  | "agente"
  | "prompt"
  | "roadmap"
  | "fonte";

export interface BrainNode {
  id: string;
  brainId: string;
  label: string;
  type: NodeType;
  origin: BrainOrigin;
  tags: string[];
  summary: string;
  updatedAt: string;
  x: number; // 0..1 normalised position for the demo graph
  y: number;
}

export interface BrainEdge {
  id: string;
  source: string;
  target: string;
  kind?: "link" | "tag" | "project";
}

export type ConnectorStatus = "connected" | "disconnected" | "error";
export interface Connector {
  id: string;
  name: string;
  description: string;
  status: ConnectorStatus;
  lastSync: string | null;
  icon: string; // lucide icon name
  color: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  brainId: string;
  status: "attivo" | "idle" | "errore";
  lastActivity: string;
}

export type TaskStatus = "idee" | "da-fare" | "in-corso" | "da-validare" | "completato";
export interface TaskItem {
  id: string;
  title: string;
  priority: "bassa" | "media" | "alta" | "urgente";
  brainId: string;
  agentId?: string;
  status: TaskStatus;
  due?: string;
  notes?: string;
}

export interface LogEntry {
  id: string;
  type: "documento" | "nodo" | "collegamento" | "sync" | "agente" | "errore";
  message: string;
  at: string;
}

export const brains: Brain[] = [
  { id: "b-pupillo", name: "Pupillo", description: "Brand personale, contenuti e identità", origin: "manuale", kind: "business", visibility: "privato", color: "var(--neon-violet)", nodeCount: 24, updatedAt: "2026-06-05T10:12:00Z" },
  { id: "b-sica", name: "Sica Immobiliare", description: "Agenzia, listing, clienti, contratti", origin: "gdrive", kind: "business", visibility: "protetto", color: "var(--neon-cyan)", nodeCount: 31, updatedAt: "2026-06-05T17:40:00Z" },
  { id: "b-ideapilot", name: "IdeaPilot", description: "Validazione idee SaaS e pipeline prodotto", origin: "github", kind: "progetto", visibility: "protetto", color: "var(--neon-pink)", nodeCount: 19, updatedAt: "2026-06-04T08:22:00Z" },
  { id: "b-obsidian", name: "Obsidian Notes", description: "Vault personale di note e pensieri", origin: "obsidian", kind: "archivio", visibility: "privato", color: "var(--neon-emerald)", nodeCount: 58, updatedAt: "2026-06-06T07:01:00Z" },
  { id: "b-prompts", name: "Prompt Lovable", description: "Libreria prompt per Lovable e affini", origin: "manuale", kind: "prompt", visibility: "pubblico", color: "var(--neon-amber)", nodeCount: 42, updatedAt: "2026-06-03T19:48:00Z" },
  { id: "b-antigravity", name: "Antigravity Workflows", description: "Workflow di automazione e ricerca", origin: "altro", kind: "agente", visibility: "privato", color: "var(--neon-violet)", nodeCount: 14, updatedAt: "2026-06-02T22:05:00Z" },
  { id: "b-runway", name: "Runway Video", description: "Progetti video AI e storyboard", origin: "altro", kind: "progetto", visibility: "privato", color: "var(--neon-cyan)", nodeCount: 11, updatedAt: "2026-06-01T14:30:00Z" },
  { id: "b-stripe", name: "Stripe Payments", description: "Dati pagamenti, abbonamenti, MRR", origin: "supabase", kind: "documenti", visibility: "protetto", color: "var(--neon-emerald)", nodeCount: 9, updatedAt: "2026-06-05T23:11:00Z" },
];

// Helpers to generate deterministic positions in a soft cluster per brain.
function cluster(cx: number, cy: number, n: number, seed: number) {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed;
    const r = 0.08 + ((i * 37 + seed * 11) % 70) / 700;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}

const brainCenters: Record<string, { x: number; y: number }> = {
  "b-pupillo": { x: 0.22, y: 0.30 },
  "b-sica": { x: 0.72, y: 0.28 },
  "b-ideapilot": { x: 0.78, y: 0.70 },
  "b-obsidian": { x: 0.22, y: 0.72 },
  "b-prompts": { x: 0.50, y: 0.18 },
  "b-antigravity": { x: 0.50, y: 0.82 },
  "b-runway": { x: 0.10, y: 0.50 },
  "b-stripe": { x: 0.90, y: 0.50 },
};

function makeNodes(brainId: string, items: Array<{ label: string; type: NodeType; tags: string[]; summary: string }>): BrainNode[] {
  const c = brainCenters[brainId];
  const positions = cluster(c.x, c.y, items.length, brainId.length);
  const brain = brains.find((b) => b.id === brainId)!;
  return items.map((it, i) => ({
    id: `${brainId}-n${i}`,
    brainId,
    label: it.label,
    type: it.type,
    origin: brain.origin,
    tags: it.tags,
    summary: it.summary,
    updatedAt: brain.updatedAt,
    x: positions[i].x,
    y: positions[i].y,
  }));
}

export const nodes: BrainNode[] = [
  ...makeNodes("b-pupillo", [
    { label: "Identità Brand", type: "documento", tags: ["brand", "identità"], summary: "Manifesto, tono di voce e palette ufficiale del brand Pupillo." },
    { label: "Lancio Newsletter", type: "progetto", tags: ["growth", "newsletter"], summary: "Roadmap lancio newsletter settimanale su Substack." },
    { label: "Prompt: post LinkedIn", type: "prompt", tags: ["linkedin", "copy"], summary: "Prompt strutturato per generare post LinkedIn in stile Pupillo." },
    { label: "Idea: corso AI", type: "nota", tags: ["formazione", "idea"], summary: "Bozza per corso AI orientato a imprenditori." },
    { label: "Copywriter AI", type: "agente", tags: ["agente"], summary: "Agente dedicato alla scrittura on-brand." },
  ]),
  ...makeNodes("b-sica", [
    { label: "Listing Catania", type: "documento", tags: ["immobili", "catania"], summary: "Foglio listing aggiornato degli immobili attivi a Catania." },
    { label: "Pipeline Clienti", type: "progetto", tags: ["crm"], summary: "Pipeline qualificazione lead in 5 stage." },
    { label: "Contratto tipo", type: "documento", tags: ["legale"], summary: "Modello standard di mandato a vendere." },
    { label: "Analista Immobiliare AI", type: "agente", tags: ["agente", "immobili"], summary: "Stima rapida valore + comparables di zona." },
    { label: "Roadmap Q3", type: "roadmap", tags: ["roadmap"], summary: "Obiettivi commerciali per Q3." },
  ]),
  ...makeNodes("b-ideapilot", [
    { label: "MVP Spec", type: "documento", tags: ["prodotto"], summary: "Specifica funzionale MVP IdeaPilot." },
    { label: "Validator Score", type: "progetto", tags: ["scoring"], summary: "Algoritmo di scoring idee in base a mercato e fit." },
    { label: "Repo GitHub", type: "fonte", tags: ["repo", "github"], summary: "Mono-repo principale collegato." },
    { label: "Stratega AI", type: "agente", tags: ["agente"], summary: "Analizza posizionamento competitivo." },
    { label: "Roadmap MVP", type: "roadmap", tags: ["roadmap"], summary: "Tappe verso il primo cliente pagante." },
  ]),
  ...makeNodes("b-obsidian", [
    { label: "Daily 2026-06-05", type: "nota", tags: ["daily"], summary: "Nota giornaliera, focus su brain dashboard." },
    { label: "Reading: Second Brain", type: "nota", tags: ["letture"], summary: "Sintesi capitolo 3 del libro di Tiago Forte." },
    { label: "Idea: graph view 3D", type: "nota", tags: ["idea"], summary: "Esplorare visualizzazione 3D nodi." },
    { label: "Prompt template", type: "prompt", tags: ["prompt"], summary: "Template prompt riusabile salvato dal vault." },
  ]),
  ...makeNodes("b-prompts", [
    { label: "Hero Landing", type: "prompt", tags: ["landing", "ui"], summary: "Prompt per generare hero section convertenti." },
    { label: "SaaS One-Pager", type: "prompt", tags: ["saas"], summary: "Prompt one-pager SaaS B2B." },
    { label: "Refactor TS", type: "prompt", tags: ["dev", "typescript"], summary: "Prompt refactor sicuro su TypeScript." },
    { label: "Prompt Engineer AI", type: "agente", tags: ["agente"], summary: "Migliora e versiona i prompt." },
  ]),
  ...makeNodes("b-antigravity", [
    { label: "Workflow Ricerca", type: "progetto", tags: ["ricerca"], summary: "Pipeline ricerca + sintesi automatica." },
    { label: "Ricercatore AI", type: "agente", tags: ["agente"], summary: "Esegue ricerche web e produce report." },
    { label: "Validatore AI", type: "agente", tags: ["agente"], summary: "Verifica fonti e segnala conflitti." },
  ]),
  ...makeNodes("b-runway", [
    { label: "Storyboard Pupillo", type: "documento", tags: ["video"], summary: "Storyboard per spot brand." },
    { label: "Asset library", type: "fonte", tags: ["asset"], summary: "Cartella asset condivisa Runway." },
    { label: "Task: render finale", type: "task", tags: ["render"], summary: "Render finale 4K." },
  ]),
  ...makeNodes("b-stripe", [
    { label: "MRR Snapshot", type: "documento", tags: ["finanza", "mrr"], summary: "Snapshot MRR e churn settimanale." },
    { label: "Webhook Events", type: "fonte", tags: ["stripe", "webhook"], summary: "Stream eventi Stripe degli ultimi 30 giorni." },
    { label: "Project Manager AI", type: "agente", tags: ["agente"], summary: "Monitora pagamenti e segnala anomalie." },
  ]),
];

// Edges: connect agents to their brain nodes, plus cross-brain links via shared tags.
export const edges: BrainEdge[] = (() => {
  const out: BrainEdge[] = [];
  // intra-brain star around the "agente" / "progetto" hub
  for (const brain of brains) {
    const bn = nodes.filter((n) => n.brainId === brain.id);
    const hub = bn.find((n) => n.type === "agente") ?? bn.find((n) => n.type === "progetto") ?? bn[0];
    if (!hub) continue;
    for (const n of bn) {
      if (n.id !== hub.id) out.push({ id: `${hub.id}-${n.id}`, source: hub.id, target: n.id, kind: "project" });
    }
  }
  // cross-brain bridges
  const bridges: Array<[string, string]> = [
    ["b-pupillo-n2", "b-prompts-n0"],
    ["b-ideapilot-n2", "b-obsidian-n2"],
    ["b-sica-n3", "b-stripe-n2"],
    ["b-antigravity-n1", "b-ideapilot-n3"],
    ["b-runway-n0", "b-pupillo-n0"],
    ["b-obsidian-n3", "b-prompts-n0"],
  ];
  for (const [a, b] of bridges) {
    if (nodes.find((n) => n.id === a) && nodes.find((n) => n.id === b)) {
      out.push({ id: `${a}--${b}`, source: a, target: b, kind: "tag" });
    }
  }
  return out;
})();

export const connectors: Connector[] = [
  { id: "obsidian", name: "Obsidian Vault", description: "Sincronizza il tuo vault locale", status: "connected", lastSync: "2026-06-06T06:55:00Z", icon: "BookOpen", color: "var(--neon-violet)" },
  { id: "gdrive", name: "Google Drive", description: "Cartelle e documenti Drive", status: "connected", lastSync: "2026-06-05T22:10:00Z", icon: "HardDrive", color: "var(--neon-cyan)" },
  { id: "github", name: "GitHub", description: "Repo, issue e README", status: "connected", lastSync: "2026-06-05T19:00:00Z", icon: "Github", color: "var(--neon-emerald)" },
  { id: "gmail", name: "Gmail", description: "Email, thread e allegati", status: "disconnected", lastSync: null, icon: "Mail", color: "var(--neon-pink)" },
  { id: "gcal", name: "Google Calendar", description: "Eventi e meeting", status: "disconnected", lastSync: null, icon: "Calendar", color: "var(--neon-cyan)" },
  { id: "supabase", name: "Supabase", description: "Tabelle, edge functions, storage", status: "connected", lastSync: "2026-06-06T05:00:00Z", icon: "Database", color: "var(--neon-emerald)" },
  { id: "whatsapp", name: "WhatsApp", description: "Chat business e media", status: "error", lastSync: "2026-06-04T11:30:00Z", icon: "MessageCircle", color: "var(--neon-emerald)" },
  { id: "stripe", name: "Stripe", description: "Pagamenti e abbonamenti", status: "connected", lastSync: "2026-06-06T00:12:00Z", icon: "CreditCard", color: "var(--neon-violet)" },
  { id: "notion", name: "Notion", description: "Workspace e database", status: "disconnected", lastSync: null, icon: "FileText", color: "var(--neon-amber)" },
  { id: "upload", name: "Upload manuale", description: "Carica file PDF / MD / TXT", status: "connected", lastSync: "2026-06-05T15:22:00Z", icon: "Upload", color: "var(--neon-amber)" },
];

export const agents: Agent[] = [
  { id: "a-pm", name: "Project Manager AI", role: "Coordina task e scadenze", brainId: "b-ideapilot", status: "attivo", lastActivity: "2026-06-06T07:30:00Z" },
  { id: "a-strategy", name: "Stratega AI", role: "Analisi mercato e posizionamento", brainId: "b-ideapilot", status: "idle", lastActivity: "2026-06-05T18:10:00Z" },
  { id: "a-validator", name: "Validatore AI", role: "Verifica fonti e fatti", brainId: "b-antigravity", status: "attivo", lastActivity: "2026-06-06T06:42:00Z" },
  { id: "a-research", name: "Ricercatore AI", role: "Ricerche web approfondite", brainId: "b-antigravity", status: "attivo", lastActivity: "2026-06-06T07:55:00Z" },
  { id: "a-copy", name: "Copywriter AI", role: "Scrittura on-brand", brainId: "b-pupillo", status: "idle", lastActivity: "2026-06-05T20:15:00Z" },
  { id: "a-realestate", name: "Analista Immobiliare AI", role: "Stime e comparables", brainId: "b-sica", status: "attivo", lastActivity: "2026-06-06T08:01:00Z" },
  { id: "a-prompt", name: "Prompt Engineer AI", role: "Versiona e migliora prompt", brainId: "b-prompts", status: "idle", lastActivity: "2026-06-05T22:48:00Z" },
];

export const tasks: TaskItem[] = [
  { id: "t1", title: "Definire pricing IdeaPilot", priority: "alta", brainId: "b-ideapilot", agentId: "a-strategy", status: "in-corso", due: "2026-06-12" },
  { id: "t2", title: "Pubblicare newsletter #1", priority: "media", brainId: "b-pupillo", agentId: "a-copy", status: "da-fare", due: "2026-06-10" },
  { id: "t3", title: "Validare lead immobiliari Catania", priority: "urgente", brainId: "b-sica", agentId: "a-realestate", status: "da-validare", due: "2026-06-08" },
  { id: "t4", title: "Refactor prompt landing", priority: "bassa", brainId: "b-prompts", agentId: "a-prompt", status: "idee" },
  { id: "t5", title: "Sync vault Obsidian", priority: "media", brainId: "b-obsidian", status: "completato" },
  { id: "t6", title: "Spegnere webhook test Stripe", priority: "alta", brainId: "b-stripe", agentId: "a-pm", status: "da-fare", due: "2026-06-07" },
  { id: "t7", title: "Storyboard finale spot", priority: "media", brainId: "b-runway", status: "in-corso", due: "2026-06-15" },
  { id: "t8", title: "Workflow ricerca competitor", priority: "alta", brainId: "b-antigravity", agentId: "a-research", status: "in-corso" },
  { id: "t9", title: "Idea: corso AI per PMI", priority: "bassa", brainId: "b-pupillo", status: "idee" },
  { id: "t10", title: "Validazione MVP con 5 utenti", priority: "urgente", brainId: "b-ideapilot", agentId: "a-validator", status: "da-validare", due: "2026-06-14" },
];

export const logs: LogEntry[] = [
  { id: "l1", type: "sync", message: "Obsidian Vault sincronizzato (12 note aggiornate).", at: "2026-06-06T06:55:00Z" },
  { id: "l2", type: "nodo", message: "Nuovo nodo creato: 'Idea: graph view 3D'.", at: "2026-06-06T05:40:00Z" },
  { id: "l3", type: "agente", message: "Ricercatore AI ha completato 1 ricerca su 'competitor IdeaPilot'.", at: "2026-06-06T07:55:00Z" },
  { id: "l4", type: "collegamento", message: "Collegamento creato tra 'Repo GitHub' e 'Idea: graph view 3D'.", at: "2026-06-06T03:11:00Z" },
  { id: "l5", type: "documento", message: "Documento aggiunto: 'MRR Snapshot' (Stripe).", at: "2026-06-06T00:12:00Z" },
  { id: "l6", type: "errore", message: "WhatsApp connector: token scaduto, riconnessione richiesta.", at: "2026-06-04T11:30:00Z" },
  { id: "l7", type: "sync", message: "Google Drive sincronizzato (3 nuovi documenti).", at: "2026-06-05T22:10:00Z" },
  { id: "l8", type: "agente", message: "Project Manager AI ha aperto 2 task nuovi.", at: "2026-06-06T07:30:00Z" },
];

export function brainById(id: string) {
  return brains.find((b) => b.id === id);
}
export function nodeById(id: string) {
  return nodes.find((n) => n.id === id);
}
export function neighborsOf(nodeId: string) {
  const ns = new Set<string>();
  for (const e of edges) {
    if (e.source === nodeId) ns.add(e.target);
    if (e.target === nodeId) ns.add(e.source);
  }
  return Array.from(ns).map((id) => nodeById(id)).filter(Boolean) as BrainNode[];
}
