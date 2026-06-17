import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Stethoscope, AlertTriangle, AlertOctagon, CheckCircle2, Copy as CopyIcon,
  FolderKanban, ListChecks, Archive, Inbox, ShieldCheck, GitBranch, ExternalLink, Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/health-check")({
  head: () => ({ meta: [{ title: "Health Check — iBrain" }] }),
  component: HealthCheckPage,
});

type Brain = {
  id: string; name: string; description: string | null;
  kind: string | null; visibility: string | null; color: string | null;
  created_at: string; updated_at: string;
};
type Node = {
  id: string; brain_id: string; label: string; type: string | null;
  tags: string[] | null; summary: string | null;
};
type KSource = {
  id: string; brain_id: string | null; title: string | null;
  source_type: string | null; status: string | null; url: string | null;
  file_path: string | null; tags: string[] | null;
  metadata: Record<string, unknown> | null;
};
type Task = {
  id: string; brain_id: string | null; title: string;
  status: string | null; priority: string | null; due_date: string | null;
};
type Roadmap = {
  id: string; brain_id: string | null; title: string;
  status: string | null; phase: string | null; priority: string | null;
};
type Tool = {
  id: string; brain_id: string; tool_name: string;
  connection_status: string | null; url: string | null; repo_url: string | null;
  metadata: Record<string, unknown> | null;
};
type Plink = {
  id: string; brain_id: string | null; tool: string | null;
  title: string | null; url: string | null; status: string | null;
};

type Health = "sano" | "da_completare" | "attenzione" | "critico";

const OPEN_TASK = new Set(["todo", "in_progress", "in progress", "open", "doing", "wip"]);
const OPEN_ROADMAP = new Set(["todo", "planned", "in_progress", "in progress", "doing", "wip", "open"]);
const REVIEW_STATUS = new Set([
  "da_revisionare", "da revisionare", "review", "to_review",
  "bozza", "draft", "incompleto", "incomplete",
  "importato", "imported", "non_classificato", "uncategorized",
]);
const GENERIC_TITLES = [/^untitled$/i, /^nuovo\s+documento$/i, /^prompt$/i, /^test$/i, /^senza\s+titolo$/i];

function isOpenTask(s: string | null) { return OPEN_TASK.has((s ?? "").toLowerCase()); }
function isOpenRoadmap(s: string | null) { return OPEN_ROADMAP.has((s ?? "").toLowerCase()); }
function isReview(s: string | null) { return REVIEW_STATUS.has((s ?? "").toLowerCase()); }
function isGenericTitle(t: string | null) {
  const v = (t ?? "").trim();
  if (!v) return true;
  return GENERIC_TITLES.some((re) => re.test(v));
}
function normTitle(t: string | null) {
  return (t ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function badge(h: Health) {
  const map: Record<Health, string> = {
    sano: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    da_completare: "bg-sky-500/20 text-sky-300 border-sky-500/30",
    attenzione: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    critico: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  };
  const labels: Record<Health, string> = {
    sano: "Sano", da_completare: "Da completare", attenzione: "Attenzione", critico: "Critico",
  };
  return <Badge className={`border ${map[h]}`}>{labels[h]}</Badge>;
}

type FilterKey =
  | "all" | "critici" | "attenzione" | "da_completare" | "sani"
  | "attivi" | "review" | "duplicati" | "links" | "github" | "no_next";

const FILTERS: { value: FilterKey; label: string }[] = [
  { value: "all", label: "Tutti" },
  { value: "critici", label: "Critici" },
  { value: "attenzione", label: "Attenzione" },
  { value: "da_completare", label: "Da completare" },
  { value: "sani", label: "Sani" },
  { value: "attivi", label: "Solo progetti attivi" },
  { value: "review", label: "Solo contenuti da revisionare" },
  { value: "duplicati", label: "Solo duplicati" },
  { value: "links", label: "Solo collegamenti" },
  { value: "github", label: "Solo GitHub" },
  { value: "no_next", label: "Solo senza prossima azione" },
];

function HealthCheckPage() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["health-check"],
    queryFn: async () => {
      const safe = async <T,>(p: Promise<{ data: T[] | null; error: unknown }>): Promise<T[]> => {
        try { const r = await p; return (r.data ?? []) as T[]; } catch { return []; }
      };
      const [brains, nodes, sources, tasks, roadmap, tools, plinks] = await Promise.all([
        safe<Brain>(supabase.from("brains").select("id,name,description,kind,visibility,color,created_at,updated_at").order("name") as never),
        safe<Node>(supabase.from("brain_nodes").select("id,brain_id,label,type,tags,summary") as never),
        safe<KSource>(supabase.from("knowledge_sources").select("id,brain_id,title,source_type,status,url,file_path,tags,metadata") as never),
        safe<Task>(supabase.from("tasks").select("id,brain_id,title,status,priority,due_date") as never),
        safe<Roadmap>(supabase.from("roadmap_items").select("id,brain_id,title,status,phase,priority") as never),
        safe<Tool>(supabase.from("project_tool_links").select("id,brain_id,tool_name,connection_status,url,repo_url,metadata") as never),
        safe<Plink>(supabase.from("project_links").select("id,brain_id,tool,title,url,status") as never),
      ]);
      return { brains, nodes, sources, tasks, roadmap, tools, plinks };
    },
  });

  const model = useMemo(() => {
    if (!data) return null;
    const { brains, nodes, sources, tasks, roadmap, tools, plinks } = data;

    const byBrain = <T extends { brain_id: string | null }>(arr: T[]): Map<string, T[]> => {
      const m = new Map<string, T[]>();
      for (const it of arr) {
        if (!it.brain_id) continue;
        const cur = m.get(it.brain_id) ?? [];
        cur.push(it);
        m.set(it.brain_id, cur);
      }
      return m;
    };
    const nodesByB = byBrain<Node>(nodes);
    const sourcesByB = byBrain<KSource>(sources);
    const tasksByB = byBrain<Task>(tasks);
    const roadByB = byBrain<Roadmap>(roadmap);
    const toolsByB = new Map<string, Tool[]>();
    for (const t of tools) (toolsByB.get(t.brain_id) ?? toolsByB.set(t.brain_id, []).get(t.brain_id)!).push(t);

    const rows = brains.map((br) => {
      const ns = nodesByB.get(br.id) ?? [];
      const ks = sourcesByB.get(br.id) ?? [];
      const ts = tasksByB.get(br.id) ?? [];
      const rs = roadByB.get(br.id) ?? [];
      const tls = toolsByB.get(br.id) ?? [];

      const openTasks = ts.filter((t) => isOpenTask(t.status));
      const openRoad = rs.filter((r) => isOpenRoadmap(r.status));
      const prompts = ns.filter((n) => (n.type ?? "").toLowerCase().includes("prompt")).length
        + ks.filter((s) => (s.source_type ?? "").toLowerCase().includes("prompt")).length;
      const contentCount = ns.length + ks.length;

      // "Next action": prefer the first open task by priority, else first open roadmap
      const nextAction = openTasks[0]?.title ?? openRoad[0]?.title ?? null;
      const hasNext = !!nextAction;

      const ghTool = tls.find((t) => (t.tool_name ?? "").toLowerCase() === "github");
      const sbTool = tls.find((t) => (t.tool_name ?? "").toLowerCase().includes("supabase"));
      const lvTool = tls.find((t) => (t.tool_name ?? "").toLowerCase().includes("lovable"));
      const ghMeta = (ghTool?.metadata ?? {}) as Record<string, unknown>;
      const ghVerified = ["verificato_manualmente", "aggiornato_manualmente"].includes(String(ghMeta.manual_check_status ?? ""));

      let health: Health;
      if (contentCount === 0 || (!hasNext && openTasks.length === 0 && openRoad.length === 0)) {
        health = "critico";
      } else if (contentCount > 0 && !hasNext) {
        health = "attenzione";
      } else if (openRoad.length === 0 || openTasks.length === 0) {
        health = "da_completare";
      } else {
        health = "sano";
      }

      return {
        brain: br, ns, ks, tls,
        openTasks: openTasks.length, openRoad: openRoad.length,
        contentCount, prompts, nextAction, hasNext,
        ghTool, sbTool, lvTool, ghVerified, health,
        active: openTasks.length + openRoad.length > 0 || hasNext,
      };
    });

    // Duplicates
    const dupKeys = new Map<string, KSource[]>();
    const push = (k: string, s: KSource) => {
      if (!k) return;
      const arr = dupKeys.get(k) ?? [];
      arr.push(s); dupKeys.set(k, arr);
    };
    for (const s of sources) {
      const meta = (s.metadata ?? {}) as Record<string, unknown>;
      const fp = (s.file_path ?? (meta.file_path as string) ?? "").toLowerCase().trim();
      const repo = String(meta.repository ?? meta.repo_url ?? "").toLowerCase().trim();
      const t = normTitle(s.title);
      const type = (s.source_type ?? "").toLowerCase();
      const bid = s.brain_id ?? "_none_";
      if (t) push(`title::${bid}::${type}::${t}`, s);
      if (s.url) push(`url::${s.url.toLowerCase()}`, s);
      if (fp) push(`fp::${bid}::${fp}`, s);
      if (repo && fp) push(`repofp::${repo}::${fp}`, s);
    }
    const dupGroups = [...dupKeys.entries()].filter(([, v]) => v.length > 1);

    // Review queue
    const reviewItems = sources.filter((s) => isReview(s.status));

    // Quality alerts
    const orphanContent = sources.filter((s) => !s.brain_id).concat(
      nodes.filter((n) => !n.brain_id) as never,
    ) as KSource[];
    const noTag = sources.filter((s) => !s.tags || s.tags.length === 0);
    const noType = sources.filter((s) => !s.source_type);
    const generic = sources.filter((s) => isGenericTitle(s.title));
    const noOrigin = sources.filter((s) => {
      const m = (s.metadata ?? {}) as Record<string, unknown>;
      return !s.source_type && !m.source && !m.imported_from_tool && !s.url;
    });

    // Suggestions
    type Sug = { id: string; title: string; reason: string; brainName?: string; brainId?: string; priority: "alta"|"media"|"bassa"; to?: string };
    const sug: Sug[] = [];
    for (const r of rows) {
      if (r.active && !r.hasNext) sug.push({ id: `next-${r.brain.id}`, title: `Aggiungi prossima azione a "${r.brain.name}"`, reason: "Progetto attivo senza prossima azione", brainName: r.brain.name, brainId: r.brain.id, priority: "alta", to: "/prossime-azioni" });
      if (r.ghTool && !r.ghVerified) sug.push({ id: `ghv-${r.brain.id}`, title: `Verifica repository GitHub di "${r.brain.name}"`, reason: "Repo collegato ma non verificato", brainName: r.brain.name, brainId: r.brain.id, priority: "alta", to: "/github-coverage" });
      if (r.contentCount === 0) sug.push({ id: `doc-${r.brain.id}`, title: `Importa contenuti per "${r.brain.name}"`, reason: "Progetto senza documentazione/contenuti", brainName: r.brain.name, brainId: r.brain.id, priority: "alta", to: "/importa" });
      if (r.openRoad === 0) sug.push({ id: `rm-${r.brain.id}`, title: `Pianifica roadmap per "${r.brain.name}"`, reason: "Nessuna roadmap aperta", brainName: r.brain.name, brainId: r.brain.id, priority: "media", to: "/roadmap" });
      if (r.openTasks === 0) sug.push({ id: `tk-${r.brain.id}`, title: `Crea task per "${r.brain.name}"`, reason: "Nessun task aperto", brainName: r.brain.name, brainId: r.brain.id, priority: "media", to: "/tasks" });
      if (!r.ghTool) sug.push({ id: `ghm-${r.brain.id}`, title: `Collega GitHub a "${r.brain.name}"`, reason: "Strumento GitHub mancante", brainName: r.brain.name, brainId: r.brain.id, priority: "media", to: "/strumenti-progetti" });
    }
    if (dupGroups.length > 0) sug.push({ id: "dup", title: `${dupGroups.length} possibili duplicati da rivedere`, reason: "Contenuti con titolo/URL/file_path identici", priority: "alta", to: "/archivio" });
    if (orphanContent.length > 0) sug.push({ id: "orphan", title: `${orphanContent.length} contenuti senza progetto`, reason: "Mancano i collegamenti a un progetto", priority: "alta", to: "/archivio" });
    if (noTag.length > 0) sug.push({ id: "notag", title: `${noTag.length} contenuti senza tag`, reason: "Qualità archivio", priority: "media", to: "/fonti" });
    if (generic.length > 0) sug.push({ id: "generic", title: `${generic.length} titoli generici`, reason: '"Untitled", "Test", "Prompt"…', priority: "bassa", to: "/archivio" });
    sug.sort((a, b) => ({ alta: 0, media: 1, bassa: 2 }[a.priority] - { alta: 0, media: 1, bassa: 2 }[b.priority]));

    const totals = {
      total: rows.length,
      active: rows.filter((r) => r.active).length,
      noNext: rows.filter((r) => !r.hasNext).length,
      noRoadmap: rows.filter((r) => r.openRoad === 0).length,
      noTasks: rows.filter((r) => r.openTasks === 0).length,
      orphanContent: orphanContent.length,
      duplicates: dupGroups.length,
      ghMissingOrUnverified: rows.filter((r) => !r.ghTool || !r.ghVerified).length,
      review: reviewItems.length,
      alerts: 0,
    };
    totals.alerts =
      totals.noNext + totals.orphanContent + totals.duplicates +
      totals.ghMissingOrUnverified + totals.review;

    return { rows, totals, dupGroups, reviewItems, orphanContent, noTag, noType, generic, noOrigin, sug };
  }, [data]);

  const filteredRows = useMemo(() => {
    if (!model) return [];
    const term = q.trim().toLowerCase();
    return model.rows.filter((r) => {
      if (term) {
        const hay = `${r.brain.name} ${r.tls.map((t) => t.tool_name).join(" ")} ${r.tls.map((t) => t.repo_url ?? t.url ?? "").join(" ")} ${r.ns.map((n) => (n.tags ?? []).join(" ")).join(" ")} ${r.ks.map((s) => s.title ?? "").join(" ")}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      switch (filter) {
        case "critici": return r.health === "critico";
        case "attenzione": return r.health === "attenzione";
        case "da_completare": return r.health === "da_completare";
        case "sani": return r.health === "sano";
        case "attivi": return r.active;
        case "github": return !!r.ghTool;
        case "no_next": return !r.hasNext;
        default: return true;
      }
    });
  }, [model, filter, q]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Health Check"
        subtitle="Stato operativo di iBrain: alert, mancanze, duplicati, suggerimenti."
      />

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" asChild><Link to="/progetti" search={{}}><FolderKanban className="mr-2 h-4 w-4" />Progetti</Link></Button>
        <Button size="sm" variant="outline" asChild><Link to="/archivio" search={{}}><Archive className="mr-2 h-4 w-4" />Archivio</Link></Button>
        <Button size="sm" variant="outline" asChild><Link to="/prossime-azioni" search={{}}><ListChecks className="mr-2 h-4 w-4" />Prossime Azioni</Link></Button>
        <Button size="sm" variant="outline" asChild><Link to="/github-coverage" search={{}}><ShieldCheck className="mr-2 h-4 w-4" />GitHub Coverage</Link></Button>
        <Button size="sm" variant="outline" asChild><Link to="/github-sync" search={{}}><GitBranch className="mr-2 h-4 w-4" />GitHub Sync</Link></Button>
        <Button size="sm" variant="default" asChild><Link to="/importa" search={{}}><Inbox className="mr-2 h-4 w-4" />Importa</Link></Button>
      </div>

      {isLoading || !model ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Caricamento…
        </div>
      ) : (
        <>
          {/* Totals */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Stat label="Progetti" value={model.totals.total} />
            <Stat label="Progetti attivi" value={model.totals.active} />
            <Stat label="Senza prossima azione" value={model.totals.noNext} />
            <Stat label="Senza roadmap" value={model.totals.noRoadmap} />
            <Stat label="Senza task aperti" value={model.totals.noTasks} />
            <Stat label="Contenuti senza progetto" value={model.totals.orphanContent} />
            <Stat label="Possibili duplicati" value={model.totals.duplicates} />
            <Stat label="GitHub mancante/da verificare" value={model.totals.ghMissingOrUnverified} />
            <Stat label="Da revisionare" value={model.totals.review} />
            <Stat label="Alert totali" value={model.totals.alerts} highlight />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-sm text-muted-foreground">Filtro:</Label>
            <Select value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
              <SelectTrigger className="w-[240px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Cerca progetto, contenuto, tool, repo, tag…"
              value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
            <div className="ml-auto text-sm text-muted-foreground">{filteredRows.length} / {model.rows.length}</div>
          </div>

          {/* Suggerimenti */}
          <Section icon={<Stethoscope className="h-4 w-4" />} title="Suggerimenti prioritari">
            {model.sug.length === 0 ? (
              <Empty>Nessun suggerimento. Tutto in ordine.</Empty>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {model.sug.slice(0, 24).map((s) => (
                  <Card key={s.id} className="border-border">
                    <CardContent className="space-y-2 p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium">{s.title}</div>
                        <PriorityBadge p={s.priority} />
                      </div>
                      <div className="text-xs text-muted-foreground">{s.reason}</div>
                      {s.to && (
                        <Button asChild size="sm" variant="outline">
                          <Link to={s.to}>Apri</Link>
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </Section>

          {/* Stato progetti */}
          <Section icon={<FolderKanban className="h-4 w-4" />} title="Stato progetti">
            {(filter === "duplicati" || filter === "review" || filter === "links") ? (
              <Empty>Filtro attivo non applicato a questa sezione.</Empty>
            ) : filteredRows.length === 0 ? (
              <Empty>Nessun progetto.</Empty>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filteredRows.map((r) => (
                  <Card key={r.brain.id}>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between gap-2 text-base">
                        <Link to="/progetti/$brainId" params={{ brainId: r.brain.id }} className="hover:underline">
                          {r.brain.name}
                        </Link>
                        {badge(r.health)}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px]">{r.brain.kind ?? "progetto"}</Badge>
                        <Badge variant="outline" className="text-[10px]">{r.brain.visibility ?? "privato"}</Badge>
                      </div>
                      <ul className="grid grid-cols-2 gap-1 text-xs">
                        <Li>contenuti</Li><Val>{r.contentCount}</Val>
                        <Li>prompt</Li><Val>{r.prompts}</Val>
                        <Li>task aperti</Li><Val>{r.openTasks}</Val>
                        <Li>roadmap aperte</Li><Val>{r.openRoad}</Val>
                      </ul>
                      <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
                        <span className="font-medium">Prossima azione: </span>
                        {r.nextAction ?? <span className="text-muted-foreground">— non impostata —</span>}
                      </div>
                      <div className="flex flex-wrap gap-1 text-[10px]">
                        <Badge variant={r.ghTool ? "default" : "outline"}>GitHub {r.ghTool ? (r.ghVerified ? "✓" : "?") : "—"}</Badge>
                        <Badge variant={r.sbTool ? "default" : "outline"}>Supabase {r.sbTool ? "✓" : "—"}</Badge>
                        <Badge variant={r.lvTool ? "default" : "outline"}>Lovable {r.lvTool ? "✓" : "—"}</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <Button size="sm" variant="outline" asChild>
                          <Link to="/progetti/$brainId" params={{ brainId: r.brain.id }}>Apri</Link>
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <Link to="/prossime-azioni" search={{}}>Prossime azioni</Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </Section>

          {/* Senza prossima azione */}
          <Section icon={<AlertOctagon className="h-4 w-4" />} title="Progetti senza prossima azione">
            {model.rows.filter((r) => !r.hasNext).length === 0 ? (
              <Empty>Tutti i progetti hanno una prossima azione.</Empty>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {model.rows.filter((r) => !r.hasNext).map((r) => (
                  <Card key={r.brain.id}>
                    <CardContent className="space-y-2 p-3 text-sm">
                      <div className="font-medium">{r.brain.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.contentCount} contenuti · {r.openTasks} task · {r.openRoad} roadmap
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" asChild><Link to="/progetti/$brainId" params={{ brainId: r.brain.id }}>Apri</Link></Button>
                        <Button size="sm" variant="outline" asChild><Link to="/prossime-azioni" search={{}}>Prossime azioni</Link></Button>
                        <Button size="sm" variant="outline" asChild><Link to="/importa" search={{}}>Importa</Link></Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </Section>

          {/* Contenuti da revisionare */}
          <Section icon={<AlertTriangle className="h-4 w-4" />} title="Contenuti da revisionare">
            {model.reviewItems.length === 0 ? (
              <Empty>Nessun contenuto in stato di revisione.</Empty>
            ) : (
              <ListWrap>
                {model.reviewItems.slice(0, 50).map((s) => (
                  <li key={s.id} className="flex items-center justify-between border-b border-border/60 py-2 text-sm last:border-0">
                    <span className="truncate">{s.title || "(senza titolo)"}</span>
                    <Badge variant="outline" className="text-[10px]">{s.status ?? "—"}</Badge>
                  </li>
                ))}
              </ListWrap>
            )}
          </Section>

          {/* Duplicati */}
          <Section icon={<CopyIcon className="h-4 w-4" />} title="Possibili duplicati">
            {model.dupGroups.length === 0 ? (
              <Empty>Nessun duplicato rilevato.</Empty>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {model.dupGroups.slice(0, 30).map(([k, items]) => (
                  <Card key={k}>
                    <CardContent className="space-y-1 p-3 text-xs">
                      <div className="font-mono text-[10px] text-muted-foreground">{k}</div>
                      <ul className="space-y-0.5">
                        {items.map((s) => (
                          <li key={s.id} className="flex items-center justify-between">
                            <span className="truncate">{s.title || "(senza titolo)"}</span>
                            <Badge variant="outline" className="text-[10px]">{s.source_type ?? "—"}</Badge>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </Section>

          {/* Collegamenti e strumenti */}
          <Section icon={<ExternalLink className="h-4 w-4" />} title="Collegamenti e strumenti">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {model.rows.map((r) => {
                const dupTools = new Set<string>();
                const seen = new Set<string>();
                for (const t of r.tls) {
                  const k = (t.tool_name ?? "").toLowerCase();
                  if (seen.has(k)) dupTools.add(k); else seen.add(k);
                }
                return (
                  <Card key={r.brain.id}>
                    <CardContent className="space-y-2 p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{r.brain.name}</div>
                        {!r.ghTool && <Badge variant="outline" className="text-[10px] text-rose-300 border-rose-500/30">no GitHub</Badge>}
                      </div>
                      <div className="flex flex-wrap gap-1 text-[10px]">
                        {r.tls.length === 0 ? (
                          <span className="text-xs text-muted-foreground">Nessuno strumento collegato.</span>
                        ) : r.tls.map((t) => (
                          <Badge key={t.id} variant="outline">
                            {t.tool_name} · {t.connection_status ?? "—"}
                          </Badge>
                        ))}
                      </div>
                      {dupTools.size > 0 && (
                        <div className="text-xs text-amber-300">Strumenti duplicati: {[...dupTools].join(", ")}</div>
                      )}
                      {r.ghTool && !r.ghVerified && (
                        <div className="text-xs text-amber-300">Repository GitHub non verificato manualmente.</div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </Section>

          {/* Qualità archivio */}
          <Section icon={<AlertTriangle className="h-4 w-4" />} title="Qualità archivio">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Stat label="Senza tag" value={model.noTag.length} />
              <Stat label="Senza tipo" value={model.noType.length} />
              <Stat label="Senza progetto" value={model.orphanContent.length} />
              <Stat label="Titoli generici" value={model.generic.length} />
              <Stat label="Senza fonte/origine" value={model.noOrigin.length} />
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <Card className={highlight ? "border-primary/40" : ""}>
      <CardContent className="p-4">
        <div className="text-2xl font-semibold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">{icon}{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">{children}</CardContent></Card>;
}

function ListWrap({ children }: { children: React.ReactNode }) {
  return <Card><CardContent className="p-3"><ul>{children}</ul></CardContent></Card>;
}

function Li({ children }: { children: React.ReactNode }) {
  return <li className="text-muted-foreground">{children}</li>;
}
function Val({ children }: { children: React.ReactNode }) {
  return <li className="text-right font-medium">{children}</li>;
}

function PriorityBadge({ p }: { p: "alta" | "media" | "bassa" }) {
  const map = {
    alta: "bg-rose-500/20 text-rose-300 border-rose-500/30",
    media: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    bassa: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  };
  return <Badge className={`border ${map[p]}`}><CheckCircle2 className="mr-1 h-3 w-3" />{p}</Badge>;
}
