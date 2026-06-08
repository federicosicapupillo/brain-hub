import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { GitBranch, RefreshCw, ExternalLink, FolderKanban, AlertTriangle, Network, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAction } from "@/lib/workspace-api";

export const Route = createFileRoute("/_authenticated/allineamento")({
  head: () => ({ meta: [{ title: "Allineamento Progetti — AI Brain" }] }),
  component: AllineamentoPage,
});

// ---------- Types ----------
interface Brain { id: string; name: string; kind: string }
interface ContentItem {
  id: string;
  table: "brain_nodes" | "tasks" | "roadmap_items" | "knowledge_sources";
  title: string;
  tags: string[];
  brain_id: string | null;
}
interface ExistingLink { id: string; brain_id: string; target_brain_id: string | null }

type Confidence = "high" | "medium" | "low";
type SuggestionKind = "move" | "orphan" | "link" | "extra";

interface Suggestion {
  id: string;            // deterministic
  kind: SuggestionKind;
  confidence: Confidence;
  reason: string;
  // content-related
  item?: ContentItem;
  currentBrainName?: string;
  // target
  targetBrainId?: string;
  targetBrainName?: string;
  // link-related
  sourceBrainId?: string;
  sourceBrainName?: string;
}

// ---------- Rules ----------
const KEYWORDS: { name: string; aliases: string[]; words: string[] }[] = [
  { name: "Pupillo", aliases: ["pupillo"], words: ["pupillo", "turni", "ristorazione", "candidature", "crediti ristoratore"] },
  { name: "IdeaPilot IA", aliases: ["ideapilot", "idea pilot"], words: ["ideapilot", "idea pilot"] },
  { name: "Furia Immobiliare", aliases: ["furia"], words: ["furia immobiliare", "lunigiana", "casali", "ville"] },
  { name: "Sica Industrial Radar", aliases: ["industrial radar", "sica industrial"], words: ["industrial radar", "capannoni", "carroponte", "piazzale", "logistica industriale"] },
  { name: "Sica Immobiliare Comunicazione", aliases: ["sica immobiliare comunicazione"], words: ["sica immobiliare comunicazione", "comunicazione immobiliare"] },
  { name: "Brain Hub", aliases: ["brain hub", "brainhub"], words: ["brain hub", "brainhub"] },
];

const REQUIRED_LINKS: { source: string; target: string; reason: string }[] = [
  { source: "Pupillo", target: "IdeaPilot IA", reason: "Pupillo è un esempio concreto di SaaS costruito con prompt e Lovable." },
  { source: "Pupillo", target: "Brain Hub", reason: "Brain Hub archivia materiali e prompt del progetto." },
  { source: "Sica Industrial Radar", target: "Sica Immobiliare Comunicazione", reason: "Radar analizza capannoni, Comunicazione li promuove." },
  { source: "Sica Industrial Radar", target: "Brain Hub", reason: "Brain Hub archivia materiali, prompt e roadmap." },
  { source: "Furia Immobiliare", target: "Brain Hub", reason: "Brain Hub archivia materiali e strategie del progetto." },
  { source: "Sica Immobiliare Comunicazione", target: "Brain Hub", reason: "Brain Hub archivia materiali e contenuti marketing." },
];

const MAIN_PROJECTS = new Set(KEYWORDS.map((k) => k.name.toLowerCase()));

// ---------- LocalStorage (ignored) ----------
const IGNORED_KEY = "alignment.ignored.v1";
function loadIgnored(): Set<string> {
  try {
    const raw = localStorage.getItem(IGNORED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function saveIgnored(set: Set<string>) {
  try {
    localStorage.setItem(IGNORED_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* no-op */
  }
}

// ---------- Matching ----------
function findBrainByName(brains: Brain[], name: string): Brain | undefined {
  const n = name.toLowerCase();
  return brains.find((b) => b.name.toLowerCase() === n)
      ?? brains.find((b) => b.name.toLowerCase().includes(n));
}

function detectTargetProject(item: ContentItem, brains: Brain[]): { brain: Brain; confidence: Confidence; reason: string } | null {
  const hay = `${item.title} ${item.tags.join(" ")}`.toLowerCase();
  for (const rule of KEYWORDS) {
    for (const alias of rule.aliases) {
      const a = alias.toLowerCase();
      if (item.title.toLowerCase().startsWith(`${a} —`) || item.title.toLowerCase().startsWith(`${a} -`)) {
        const b = findBrainByName(brains, rule.name);
        if (b) return { brain: b, confidence: "high", reason: `Titolo inizia con "${alias}".` };
      }
      if (item.title.toLowerCase().includes(a)) {
        const b = findBrainByName(brains, rule.name);
        if (b) return { brain: b, confidence: "high", reason: `Titolo contiene "${alias}".` };
      }
    }
    for (const w of rule.words) {
      if (hay.includes(w.toLowerCase())) {
        const b = findBrainByName(brains, rule.name);
        if (b) return { brain: b, confidence: "medium", reason: `Parola chiave "${w}" rilevata.` };
      }
    }
  }
  return null;
}

// ---------- Page ----------
function AllineamentoPage() {
  const [brains, setBrains] = useState<Brain[]>([]);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [links, setLinks] = useState<ExistingLink[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [ignored, setIgnored] = useState<Set<string>>(() => new Set());
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);

  useEffect(() => { setIgnored(loadIgnored()); }, []);

  async function runScan() {
    setScanning(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) { toast.error("Sessione scaduta."); return; }

      const [bRes, nRes, tRes, rRes, kRes, lRes] = await Promise.all([
        supabase.from("brains").select("id,name,kind").eq("user_id", userId),
        supabase.from("brain_nodes").select("id,label,tags,brain_id").eq("user_id", userId),
        supabase.from("tasks").select("id,title,brain_id").eq("user_id", userId),
        supabase.from("roadmap_items").select("id,title,brain_id").eq("user_id", userId),
        supabase.from("knowledge_sources").select("id,title,tags,brain_id").eq("user_id", userId),
        supabase.from("project_links").select("id,brain_id,target_brain_id").eq("user_id", userId).eq("link_type", "project"),
      ]);
      if (bRes.error || nRes.error || tRes.error || rRes.error || kRes.error || lRes.error) {
        toast.error("Errore durante la scansione.");
        return;
      }
      const bs = (bRes.data ?? []) as Brain[];
      const all: ContentItem[] = [
        ...(nRes.data ?? []).map((r: any) => ({ id: r.id, table: "brain_nodes" as const, title: r.label, tags: r.tags ?? [], brain_id: r.brain_id })),
        ...(tRes.data ?? []).map((r: any) => ({ id: r.id, table: "tasks" as const, title: r.title, tags: [], brain_id: r.brain_id })),
        ...(rRes.data ?? []).map((r: any) => ({ id: r.id, table: "roadmap_items" as const, title: r.title, tags: [], brain_id: r.brain_id })),
        ...(kRes.data ?? []).map((r: any) => ({ id: r.id, table: "knowledge_sources" as const, title: r.title, tags: r.tags ?? [], brain_id: r.brain_id })),
      ];
      const ls = (lRes.data ?? []) as ExistingLink[];
      setBrains(bs);
      setItems(all);
      setLinks(ls);
      setSuggestions(buildSuggestions(bs, all, ls));
      setScanned(true);
    } finally {
      setScanning(false);
    }
  }

  function buildSuggestions(bs: Brain[], all: ContentItem[], ls: ExistingLink[]): Suggestion[] {
    const out: Suggestion[] = [];
    const brainById = new Map(bs.map((b) => [b.id, b] as const));

    // 1) orphan + move
    for (const it of all) {
      const valid = it.brain_id && brainById.has(it.brain_id);
      const currentName = valid ? brainById.get(it.brain_id!)!.name : null;
      const target = detectTargetProject(it, bs);

      if (!valid) {
        out.push({
          id: `orphan:${it.table}:${it.id}`,
          kind: "orphan",
          confidence: target ? target.confidence : "low",
          reason: target ? `Orfano. ${target.reason}` : "Nessun progetto associato.",
          item: it,
          currentBrainName: it.brain_id ? "Progetto inesistente" : "—",
          targetBrainId: target?.brain.id,
          targetBrainName: target?.brain.name,
        });
        continue;
      }
      if (target && target.brain.id !== it.brain_id) {
        out.push({
          id: `move:${it.table}:${it.id}:${target.brain.id}`,
          kind: "move",
          confidence: target.confidence,
          reason: target.reason,
          item: it,
          currentBrainName: currentName!,
          targetBrainId: target.brain.id,
          targetBrainName: target.brain.name,
        });
      }
    }

    // 2) required project-project links
    const linkSet = new Set(ls.map((l) => `${l.brain_id}:${l.target_brain_id}`));
    for (const req of REQUIRED_LINKS) {
      const src = findBrainByName(bs, req.source);
      const tgt = findBrainByName(bs, req.target);
      if (!src || !tgt) continue;
      if (linkSet.has(`${src.id}:${tgt.id}`) || linkSet.has(`${tgt.id}:${src.id}`)) continue;
      out.push({
        id: `link:${src.id}:${tgt.id}`,
        kind: "link",
        confidence: "high",
        reason: req.reason,
        sourceBrainId: src.id,
        sourceBrainName: src.name,
        targetBrainId: tgt.id,
        targetBrainName: tgt.name,
      });
    }

    // 3) extra projects
    for (const b of bs) {
      if (b.kind !== "progetto") continue;
      if (MAIN_PROJECTS.has(b.name.toLowerCase())) continue;
      const count = all.filter((i) => i.brain_id === b.id).length;
      out.push({
        id: `extra:${b.id}`,
        kind: "extra",
        confidence: "low",
        reason: `Progetto secondario con ${count} elementi collegati. Valuta se rinominare, collegare o archiviare.`,
        sourceBrainId: b.id,
        sourceBrainName: b.name,
      });
    }

    return out;
  }

  const visible = useMemo(
    () => suggestions.filter((s) => !ignored.has(s.id)),
    [suggestions, ignored],
  );

  const grouped = useMemo(() => {
    const by = (k: SuggestionKind) => visible.filter((s) => s.kind === k);
    return { move: by("move"), orphan: by("orphan"), link: by("link"), extra: by("extra") };
  }, [visible]);

  const highCount = visible.filter((s) => s.confidence === "high" && (s.kind === "move" || s.kind === "orphan" || s.kind === "link") && s.targetBrainId).length;

  function ignore(id: string) {
    const next = new Set(ignored); next.add(id); setIgnored(next); saveIgnored(next);
    toast.message("Suggerimento ignorato.");
  }

  async function apply(s: Suggestion): Promise<{ undo: () => Promise<void> } | null> {
    if (s.kind === "move" || s.kind === "orphan") {
      if (!s.item || !s.targetBrainId) return null;
      const prevBrain = s.item.brain_id;
      const { error } = await supabase.from(s.item.table).update({ brain_id: s.targetBrainId }).eq("id", s.item.id);
      if (error) { toast.error(`Errore: ${error.message}`); return null; }
      await logAction({
        action: "alignment.move",
        message: `${s.item.table}: "${s.item.title}" → ${s.targetBrainName}`,
        severity: "info",
        brain_id: s.targetBrainId,
        entity_type: s.item.table,
        entity_id: s.item.id,
        metadata: { from: prevBrain, to: s.targetBrainId, reason: s.reason, confidence: s.confidence },
      }).catch(() => {});
      return {
        undo: async () => {
          await supabase.from(s.item!.table).update({ brain_id: prevBrain }).eq("id", s.item!.id);
        },
      };
    }
    if (s.kind === "link") {
      if (!s.sourceBrainId || !s.targetBrainId) return null;
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) return null;
      const { data: ins, error } = await supabase.from("project_links").insert({
        user_id: userId,
        brain_id: s.sourceBrainId,
        link_type: "project",
        relation_type: "related",
        title: s.targetBrainName ?? "Progetto collegato",
        target_brain_id: s.targetBrainId,
        target_table: "brains",
        description: s.reason,
      }).select("id").single();
      if (error) { toast.error(`Errore: ${error.message}`); return null; }
      await logAction({
        action: "alignment.link",
        message: `Collegamento ${s.sourceBrainName} → ${s.targetBrainName}`,
        severity: "info",
        brain_id: s.sourceBrainId,
        entity_type: "project_links",
        entity_id: ins?.id ?? null,
        metadata: { reason: s.reason },
      }).catch(() => {});
      const linkId = ins?.id;
      return {
        undo: async () => {
          if (linkId) await supabase.from("project_links").delete().eq("id", linkId);
        },
      };
    }
    return null;
  }

  async function approve(s: Suggestion) {
    setApplying(s.id);
    try {
      const res = await apply(s);
      if (!res) return;
      setSuggestions((prev) => prev.filter((p) => p.id !== s.id));
      toast.success("Suggerimento applicato.", {
        action: {
          label: "Annulla",
          onClick: async () => {
            await res.undo();
            toast.message("Azione annullata.");
            void runScan();
          },
        },
      });
    } finally {
      setApplying(null);
    }
  }

  async function batchApply() {
    setBatchOpen(false);
    const high = visible.filter((s) => s.confidence === "high" && (s.kind === "move" || s.kind === "orphan" || s.kind === "link") && s.targetBrainId);
    let ok = 0;
    for (const s of high) {
      const res = await apply(s);
      if (res) ok++;
    }
    toast.success(`${ok} modifiche applicate.`);
    void runScan();
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Allineamento Progetti"
        subtitle="Controlla contenuti, prompt, task, roadmap e collegamenti per verificare che ogni elemento sia associato al progetto corretto."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={runScan} disabled={scanning}>
              {scanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {scanning ? "Scansione…" : "Avvia scansione"}
            </Button>
            <Button size="sm" onClick={() => setBatchOpen(true)} disabled={highCount === 0}>
              <Sparkles className="mr-2 h-4 w-4" />
              Applica suggerimenti alta confidenza ({highCount})
            </Button>
          </>
        }
      />

      {!scanned && !scanning && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Clicca <span className="font-medium text-foreground">Avvia scansione</span> per analizzare contenuti e collegamenti.
          </CardContent>
        </Card>
      )}

      {scanned && visible.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nessuna incoerenza critica trovata.
          </CardContent>
        </Card>
      )}

      {scanned && visible.length > 0 && (
        <div className="space-y-6">
          <Section
            title="Da spostare"
            icon={<GitBranch className="h-4 w-4" />}
            items={grouped.move}
            onApprove={approve}
            onIgnore={ignore}
            applying={applying}
          />
          <Section
            title="Orfani"
            icon={<AlertTriangle className="h-4 w-4" />}
            items={grouped.orphan}
            onApprove={approve}
            onIgnore={ignore}
            applying={applying}
          />
          <Section
            title="Da collegare"
            icon={<Network className="h-4 w-4" />}
            items={grouped.link}
            onApprove={approve}
            onIgnore={ignore}
            applying={applying}
          />
          <Section
            title="Progetti extra"
            icon={<FolderKanban className="h-4 w-4" />}
            items={grouped.extra}
            onApprove={approve}
            onIgnore={ignore}
            applying={applying}
          />
        </div>
      )}

      <AlertDialog open={batchOpen} onOpenChange={setBatchOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Applica suggerimenti ad alta confidenza</AlertDialogTitle>
            <AlertDialogDescription>
              Stai per applicare {highCount} modifiche ad alta confidenza. Vuoi continuare?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={batchApply}>Continua</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function confidenceBadge(c: Confidence) {
  const variant = c === "high" ? "default" : c === "medium" ? "secondary" : "outline";
  const label = c === "high" ? "Alta" : c === "medium" ? "Media" : "Da verificare";
  return <Badge variant={variant as any}>{label}</Badge>;
}

function tableLabel(t: ContentItem["table"]) {
  return { brain_nodes: "Nota", tasks: "Task", roadmap_items: "Roadmap", knowledge_sources: "Fonte" }[t];
}

function Section({
  title, icon, items, onApprove, onIgnore, applying,
}: {
  title: string;
  icon: React.ReactNode;
  items: Suggestion[];
  onApprove: (s: Suggestion) => void;
  onIgnore: (id: string) => void;
  applying: string | null;
}) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">{icon}{title}<Badge variant="outline">{items.length}</Badge></CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((s) => (
          <div key={s.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card/60 p-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {s.item && <Badge variant="outline">{tableLabel(s.item.table)}</Badge>}
                {confidenceBadge(s.confidence)}
                <span className="truncate font-medium">{s.item?.title ?? s.sourceBrainName}</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {s.kind === "link" ? (
                  <>Collegamento mancante: <b>{s.sourceBrainName}</b> → <b>{s.targetBrainName}</b>. {s.reason}</>
                ) : s.kind === "extra" ? (
                  <>{s.reason}</>
                ) : (
                  <>Da <b>{s.currentBrainName}</b> → <b>{s.targetBrainName ?? "—"}</b>. {s.reason}</>
                )}
              </div>
            </div>
            <div className="flex flex-shrink-0 flex-wrap gap-2">
              {s.targetBrainId && (s.kind === "move" || s.kind === "orphan" || s.kind === "link") && (
                <Button size="sm" onClick={() => onApprove(s)} disabled={applying === s.id}>
                  {applying === s.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {s.kind === "link" ? "Crea collegamento" : "Approva"}
                </Button>
              )}
              {(s.sourceBrainId || s.targetBrainId || s.item?.brain_id) && (
                <Button size="sm" variant="ghost" asChild>
                  <Link to="/progetti/$brainId" params={{ brainId: (s.sourceBrainId ?? s.targetBrainId ?? s.item?.brain_id)! }}>
                    <ExternalLink className="mr-1 h-3 w-3" /> Apri progetto
                  </Link>
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => onIgnore(s.id)}>Ignora</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
