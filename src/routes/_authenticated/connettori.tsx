import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  Github, Database, HardDrive, BookOpen, Sparkles, Bot, Search, Mail,
  Calendar, Film, Image as ImageIcon, Mic, UserCircle, Wand2, Info,
  Inbox, FolderOpen, Settings2, AlertTriangle, CheckCircle2, ArrowRight,
  Link2, Plug,
} from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";


import { supabase } from "@/integrations/supabase/client";
import { listConnectors, type Connector } from "@/lib/workspace-api";

export const Route = createFileRoute("/_authenticated/connettori")({
  head: () => ({
    meta: [
      { title: "Connettori — iBrain" },
      {
        name: "description",
        content:
          "Dashboard dei connettori iBrain: cosa è manuale, cosa è collegabile e cosa potrà sincronizzarsi automaticamente.",
      },
    ],
  }),
  component: ConnectorsPage,
  errorComponent: ({ error }) => (
    <div className="p-6" role="alert">Errore: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6">Pagina non trovata.</div>,
});

// -------- Catalog ------------------------------------------------------------

type ConnStatus =
  | "manuale"
  | "da_collegare"
  | "collegato"
  | "sincronizzato"
  | "errore"
  | "non_disponibile";

type Category =
  | "AI" | "Sviluppo" | "File" | "Email" | "Calendario" | "Creatività"
  | "Note" | "Database" | "Ricerca" | "App builder" | "Automazione";


type CatalogItem = {
  key: string;                 // matches "tool" field used elsewhere
  name: string;
  category: Category;
  initial: ConnStatus;
  icon: React.ComponentType<{ className?: string }>;
  short: string;
  canImport: string[];
  canWrite: string[];
  privacy: string;
  nextAction: string;
  manualOnly?: boolean;        // true → status cannot become "collegato" automatically
};

const CATALOG: CatalogItem[] = [
  {
    key: "GitHub", name: "GitHub", category: "Sviluppo", initial: "da_collegare", icon: Github,
    short: "Repository, README, file markdown, issue e changelog di progetto.",
    canImport: ["Repository", "README", "File markdown", "Commit", "Issue", "Changelog"],
    canWrite: [],
    privacy: "Lettura repository. Nessuna scrittura. Usa OAuth GitHub: token sempre in Secrets, mai nel codice.",
    nextAction: "Collega il repository del progetto per permettere a iBrain di leggere README, changelog e file markdown.",
  },
  {
    key: "Supabase", name: "Supabase", category: "Database", initial: "da_collegare", icon: Database,
    short: "Schema, tabelle, migrazioni, storage e log del backend.",
    canImport: ["Schema", "Tabelle", "Migrazioni", "Bucket storage", "Log"],
    canWrite: [],
    privacy: "Solo lettura metadati. Service role key esclusivamente lato server.",
    nextAction: "Collega un progetto Supabase per leggere schema e stato del backend.",
  },
  {
    key: "Google Drive", name: "Google Drive", category: "File", initial: "da_collegare", icon: HardDrive,
    short: "Documenti, PDF, immagini e cartelle di progetto.",
    canImport: ["Documenti", "PDF", "Immagini", "Cartelle progetto", "Export"],
    canWrite: [],
    privacy: "Lettura file selezionati via OAuth Google. Nessuna modifica ai file originali.",
    nextAction: "Connetti l'account Google e seleziona le cartelle dei progetti.",
  },
  {
    key: "Obsidian", name: "Obsidian", category: "Note", initial: "manuale", icon: BookOpen,
    manualOnly: true,
    short: "Vault locale: import markdown manuale o tramite ponte cloud.",
    canImport: ["File markdown", "Cartelle vault", "Note progetto"],
    canWrite: [],
    privacy: "Obsidian è locale: iBrain non vi accede direttamente. Niente token salvati.",
    nextAction: "Sincronizza il vault tramite GitHub o Drive, oppure importa manualmente file markdown.",
  },
  {
    key: "Lovable", name: "Lovable", category: "App builder", initial: "manuale", icon: Wand2,
    manualOnly: true,
    short: "Riepiloghi progetto, prompt, changelog. Via GitHub o manuale.",
    canImport: ["Riepiloghi progetto", "Prompt", "Changelog", "Stato sviluppo"],
    canWrite: [],
    privacy: "Nessuna API pubblica diretta. Percorso consigliato: Lovable → GitHub → iBrain.",
    nextAction: "Esporta o copia i riepiloghi progetto oppure collega il repository GitHub generato da Lovable.",
  },
  {
    key: "Antigravity", name: "Antigravity", category: "Sviluppo", initial: "manuale", icon: Sparkles,
    manualOnly: true,
    short: "Stato progetto, codice, prompt e workflow AI coding.",
    canImport: ["Stato progetto", "File / codice", "Prompt", "Workflow"],
    canWrite: [],
    privacy: "Import manuale o tramite repository GitHub collegato.",
    nextAction: "Esporta workflow o collega il repository GitHub del progetto.",
  },
  {
    key: "ChatGPT", name: "ChatGPT", category: "AI", initial: "manuale", icon: Bot,
    manualOnly: true,
    short: "Riassunti, prompt, strategie e decisioni dalle conversazioni.",
    canImport: ["Riassunti", "Prompt", "Strategie", "Decisioni"],
    canWrite: [],
    privacy: "Nessun accesso diretto alla cronologia. Solo testo che incolli o esporti.",
    nextAction: "Importa manualmente riassunti, prompt o export delle conversazioni.",
  },
  {
    key: "Claude", name: "Claude", category: "AI", initial: "manuale", icon: Bot,
    manualOnly: true,
    short: "Analisi, prompt, documenti e ragionamenti.",
    canImport: ["Analisi", "Prompt", "Documenti", "Ragionamenti"],
    canWrite: [],
    privacy: "Nessun accesso diretto. Solo contenuti incollati manualmente.",
    nextAction: "Incolla analisi e prompt nell'Importatore.",
  },
  {
    key: "Perplexity", name: "Perplexity", category: "Ricerca", initial: "manuale", icon: Search,
    manualOnly: true,
    short: "Ricerche, fonti, link, sintesi.",
    canImport: ["Ricerche", "Fonti", "Link", "Sintesi"],
    canWrite: [],
    privacy: "Solo testo e link che incolli.",
    nextAction: "Salva manualmente sintesi e link delle ricerche più utili.",
  },
  {
    key: "Gmail", name: "Gmail", category: "Email", initial: "da_collegare", icon: Mail,
    short: "Email importanti, task estratti, conversazioni collegate a progetti.",
    canImport: ["Email", "Task da email", "Allegati"],
    canWrite: [],
    privacy: "Richiede OAuth reale. Nessuna lettura prima dell'autorizzazione esplicita.",
    nextAction: "Richiede connessione OAuth prima di poter leggere email.",
  },
  {
    key: "Google Calendar", name: "Google Calendar", category: "Calendario", initial: "da_collegare", icon: Calendar,
    short: "Appuntamenti, scadenze, eventi progetto.",
    canImport: ["Eventi", "Scadenze", "Inviti"],
    canWrite: [],
    privacy: "Richiede OAuth Google. Solo lettura.",
    nextAction: "Connetti Google Calendar tramite OAuth.",
  },
  {
    key: "Runway", name: "Runway", category: "Creatività", initial: "manuale", icon: Film,
    manualOnly: true,
    short: "Prompt video, asset video, note creative.",
    canImport: ["Prompt video", "Asset video", "Note creative"],
    canWrite: [],
    privacy: "Solo materiali che salvi manualmente.",
    nextAction: "Importa manualmente prompt e link agli asset.",
  },
  {
    key: "Midjourney", name: "Midjourney", category: "Creatività", initial: "manuale", icon: ImageIcon,
    manualOnly: true,
    short: "Prompt immagini, riferimenti visual, asset.",
    canImport: ["Prompt immagini", "Riferimenti visual", "Asset"],
    canWrite: [],
    privacy: "Nessun accesso al server Discord. Salva manualmente prompt e link.",
    nextAction: "Salva manualmente prompt e link alle immagini generate.",
  },
  {
    key: "ElevenLabs", name: "ElevenLabs", category: "Creatività", initial: "manuale", icon: Mic,
    manualOnly: true,
    short: "Script voce, voiceover, prompt audio.",
    canImport: ["Script voce", "Voiceover", "Prompt audio"],
    canWrite: [],
    privacy: "Solo contenuti salvati manualmente.",
    nextAction: "Importa script e prompt audio nell'archivio.",
  },
  {
    key: "D-ID", name: "D-ID", category: "Creatività", initial: "manuale", icon: UserCircle,
    manualOnly: true,
    short: "Script avatar, video generati, prompt.",
    canImport: ["Script avatar", "Video generati", "Prompt"],
    canWrite: [],
    privacy: "Solo contenuti che salvi manualmente.",
    nextAction: "Importa manualmente script e link ai video avatar.",
  },
  {
    key: "n8n", name: "n8n", category: "Automazione", initial: "da_collegare", icon: Plug,
    short: "Workflow automation, webhook, orchestrazione prompt e callback verso Brain Hub.",
    canImport: ["Webhook payload", "Risultati workflow", "Callback automazioni"],
    canWrite: ["Trigger webhook n8n"],
    privacy: "URL webhook salvato in automation_connectors (per utente). Nessuna chiamata da questa pagina.",
    nextAction: "Configura un webhook n8n per abilitare invio payload verificato da /automation-control.",
  },
];


const STATUS_META: Record<ConnStatus, { label: string; cls: string }> = {
  manuale:         { label: "Manuale",         cls: "border-amber-500/40 bg-amber-500/10 text-amber-600" },
  da_collegare:    { label: "Da collegare",    cls: "border-sky-500/40 bg-sky-500/10 text-sky-500" },
  collegato:       { label: "Collegato",       cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500" },
  sincronizzato:   { label: "Sincronizzato",   cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-400" },
  errore:          { label: "Errore",          cls: "border-destructive/40 bg-destructive/10 text-destructive" },
  non_disponibile: { label: "Non disponibile", cls: "border-border bg-muted/40 text-muted-foreground" },
};

const CATEGORIES: Category[] = [
  "AI", "Sviluppo", "File", "Email", "Calendario", "Creatività",
  "Note", "Database", "Ricerca", "App builder", "Automazione",
];


// -------- Data hooks ---------------------------------------------------------

type ToolUsage = {
  total: number;
  brainIds: Set<string>;
  lastAt: string | null;
};

async function loadToolUsage(): Promise<Record<string, ToolUsage>> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return {};

  const [nodes, sources, links] = await Promise.all([
    supabase.from("brain_nodes").select("brain_id,tags,created_at").eq("user_id", uid),
    supabase.from("knowledge_sources").select("brain_id,description,created_at").eq("user_id", uid),
    supabase.from("project_links").select("brain_id,tool,created_at").eq("user_id", uid),
  ]);

  const out: Record<string, ToolUsage> = {};
  const bump = (key: string, brain: string | null, at: string | null) => {
    const k = key.trim();
    if (!k) return;
    const slot = out[k] ?? { total: 0, brainIds: new Set<string>(), lastAt: null };
    slot.total += 1;
    if (brain) slot.brainIds.add(brain);
    if (at && (!slot.lastAt || at > slot.lastAt)) slot.lastAt = at;
    out[k] = slot;
  };

  for (const n of nodes.data ?? []) {
    for (const t of (n.tags ?? []) as string[]) {
      if (CATALOG.some((c) => c.key.toLowerCase() === t.toLowerCase())) {
        bump(t, n.brain_id, n.created_at);
      }
    }
  }
  for (const s of sources.data ?? []) {
    const m = /Strumento:\s*([^·]+)/i.exec(s.description ?? "");
    if (m) bump(m[1].trim(), s.brain_id, s.created_at);
  }
  for (const l of links.data ?? []) {
    if (l.tool) bump(l.tool, l.brain_id, l.created_at);
  }
  return out;
}

// -------- Page ---------------------------------------------------------------

function ConnectorsPage() {
  const navigate = useNavigate();

  const { data: connectorsRows = [] } = useQuery<Connector[]>({
    queryKey: ["connectors-rows"],
    queryFn: listConnectors,
  });
  const { data: usage = {} } = useQuery({
    queryKey: ["connectors-usage"],
    queryFn: loadToolUsage,
  });

  const qc = useQueryClient();
  const { data: n8nConnector = null } = useQuery({
    queryKey: ["automation-connector-n8n"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return null;
      const { data, error } = await supabase
        .from("automation_connectors")
        .select("*")
        .eq("user_id", uid)
        .eq("type", "n8n_webhook")
        .eq("target_tool", "Lovable")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const [n8nOpen, setN8nOpen] = useState(false);


  const byName = useMemo(() => {
    const m = new Map<string, Connector>();
    for (const c of connectorsRows) m.set(c.name.toLowerCase(), c);
    return m;
  }, [connectorsRows]);

  const enriched = useMemo(() => {
    return CATALOG.map((c) => {
      const row = byName.get(c.name.toLowerCase());
      let status: ConnStatus = c.initial;
      if (!c.manualOnly && row) {
        if (row.status === "error") status = "errore";
        else if (row.is_enabled && row.last_sync_at) status = "sincronizzato";
        else if (row.is_enabled) status = "collegato";
      }
      const use = usage[c.key];
      return {
        ...c,
        status,
        lastSyncAt: row?.last_sync_at ?? null,
        total: use?.total ?? 0,
        brainCount: use?.brainIds.size ?? 0,
        lastImportAt: use?.lastAt ?? null,
      };
    });
  }, [byName, usage]);

  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState<string>("all");
  const [fCat, setFCat] = useState<string>("all");
  const [detail, setDetail] = useState<(CatalogItem & { status: ConnStatus; total: number; brainCount: number; lastSyncAt: string | null; lastImportAt: string | null }) | null>(null);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return enriched.filter((c) => {
      if (fStatus !== "all" && c.status !== fStatus) return false;
      if (fCat !== "all" && c.category !== fCat) return false;
      if (ql) {
        const hay = [c.name, c.category, c.short, ...c.canImport].join(" ").toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [enriched, q, fStatus, fCat]);

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <PageHeader
        title="Connettori"
        subtitle="Cosa è manuale, cosa è collegabile e cosa potrà sincronizzarsi automaticamente."
      />

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4 flex gap-3 items-start text-sm">
          <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            iBrain può salvare contenuti manualmente già da ora. Le sincronizzazioni automatiche
            richiedono connettori reali tramite API, OAuth, GitHub, Drive o altri sistemi autorizzati.
            Questa pagina mostra cosa è già <strong>manuale</strong>, cosa è <strong>collegabile</strong>{" "}
            e cosa potrà essere <strong>sincronizzato</strong>. Nessuna integrazione viene dichiarata
            attiva se non esiste una connessione reale.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca strumento, categoria…" />
          <Select value={fStatus} onValueChange={setFStatus}>
            <SelectTrigger><SelectValue placeholder="Stato" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti gli stati</SelectItem>
              {(Object.keys(STATUS_META) as ConnStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={fCat} onValueChange={setFCat}>
            <SelectTrigger><SelectValue placeholder="Categoria" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutte le categorie</SelectItem>
              {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground self-center">
            {filtered.length} su {enriched.length} connettori
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((c) => {
          const Icon = c.icon;
          const meta = STATUS_META[c.status];
          return (
            <Card key={c.key} className="flex flex-col border-border/70 bg-card/60 glass">
              <CardContent className="p-4 flex-1 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-primary glow-violet shrink-0">
                    <Icon className="h-5 w-5 text-primary-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate font-medium">{c.name}</div>
                      <Badge variant="outline" className={meta.cls}>{meta.label}</Badge>
                    </div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{c.category}</div>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">{c.short}</p>

                <div className="flex flex-wrap gap-1">
                  {c.canImport.slice(0, 4).map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px] font-normal">{t}</Badge>
                  ))}
                  {c.canImport.length > 4 && (
                    <Badge variant="outline" className="text-[10px]">+{c.canImport.length - 4}</Badge>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 rounded-md border border-border/60 bg-background/40 p-2 text-center text-[11px]">
                  <Stat label="Modalità" value={c.manualOnly ? "Solo manuale" : c.status === "manuale" ? "Manuale" : "Possibile API"} />
                  <Stat label="Importati" value={String(c.total)} />
                  <Stat label="Progetti" value={String(c.brainCount)} />
                </div>

                <div className="text-[11px] text-muted-foreground">
                  Ultima sincronizzazione: {c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleString("it-IT") : "—"}
                  {c.lastImportAt && (
                    <> · Ultimo import: {new Date(c.lastImportAt).toLocaleString("it-IT")}</>
                  )}
                </div>
              </CardContent>

              <div className="flex flex-wrap gap-1 border-t p-2">
                <Button size="sm" variant="outline" onClick={() => setDetail(c)}>
                  <Settings2 className="h-3.5 w-3.5 mr-1" /> Configura
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate({ to: "/importa", search: { tool: c.key } as never })}
                >
                  <Inbox className="h-3.5 w-3.5 mr-1" /> Importa manualmente
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  asChild
                  disabled={c.total === 0}
                >
                  <Link to="/archivio" search={{ tool: c.key } as never}>
                    <FolderOpen className="h-3.5 w-3.5 mr-1" /> Vedi contenuti
                  </Link>
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      <ConnectorDetailDialog
        item={detail}
        onClose={() => setDetail(null)}
        onImport={(key) => { setDetail(null); navigate({ to: "/importa", search: { tool: key } as never }); }}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-semibold text-foreground truncate max-w-full">{value}</div>
    </div>
  );
}

function ConnectorDetailDialog({
  item, onClose, onImport,
}: {
  item: (CatalogItem & { status: ConnStatus; total: number; brainCount: number; lastSyncAt: string | null; lastImportAt: string | null }) | null;
  onClose: () => void;
  onImport: (key: string) => void;
}) {
  if (!item) return null;
  const meta = STATUS_META[item.status];
  const Icon = item.icon;
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" /> {item.name}
            <Badge variant="outline" className={`ml-2 ${meta.cls}`}>{meta.label}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="text-muted-foreground">{item.short}</div>

          <Section title="Stato attuale">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={meta.cls}>{meta.label}</Badge>
              {item.manualOnly && (
                <Badge variant="outline" className="text-amber-500 border-amber-500/40">
                  <AlertTriangle className="h-3 w-3 mr-1" /> Solo manuale
                </Badge>
              )}
              {item.status === "collegato" && (
                <Badge variant="outline" className="text-emerald-500 border-emerald-500/40">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Connessione attiva
                </Badge>
              )}
            </div>
          </Section>

          <Section title="Cosa può leggere">
            <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
              {item.canImport.map((t) => <li key={t}>{t}</li>)}
            </ul>
          </Section>

          <Section title="Cosa può scrivere">
            {item.canWrite.length === 0 ? (
              <div className="text-muted-foreground">Nessuna scrittura prevista.</div>
            ) : (
              <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                {item.canWrite.map((t) => <li key={t}>{t}</li>)}
              </ul>
            )}
          </Section>

          <Section title="Privacy e rischi">
            <p className="text-muted-foreground">{item.privacy}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Le credenziali eventualmente necessarie verranno salvate solo nei Secrets lato server e mai nel codice.
            </p>
          </Section>

          <Section title="Contenuti già importati">
            <div className="flex flex-wrap gap-3 text-xs">
              <Badge variant="secondary">{item.total} contenuti</Badge>
              <Badge variant="secondary">{item.brainCount} progetti</Badge>
              {item.lastImportAt && (
                <Badge variant="outline">
                  Ultimo: {new Date(item.lastImportAt).toLocaleString("it-IT")}
                </Badge>
              )}
            </div>
          </Section>

          <Section title="Prossima azione consigliata">
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
              {item.nextAction}
            </div>
          </Section>
        </div>

        <DialogFooter className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onImport(item.key)}>
            <Inbox className="h-4 w-4 mr-1" /> Importa manualmente
          </Button>
          {item.total > 0 && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/archivio" search={{ tool: item.key } as never} onClick={onClose}>
                <FolderOpen className="h-4 w-4 mr-1" /> Vedi contenuti
                <ArrowRight className="h-3 w-3 ml-1" />
              </Link>
            </Button>
          )}
          <Button size="sm" onClick={onClose}>Chiudi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Link2 className="h-3 w-3 opacity-50" /> {title}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
