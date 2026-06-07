import { useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, ExternalLink, FileText, Link2, ListChecks, Map as MapIcon, Sparkles, Wrench, Trash2, FolderKanban, LinkIcon, Download } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  buildZip, downloadBlob, downloadItemsAsMdZip, itemToMarkdown, fileNameForItem,
  slugify, todayStamp, type ExportableItem, type ZipEntry,
} from "@/lib/export-utils";
import { findMeta, priorityColor, priorityLabel } from "@/lib/projects-meta";
import { AddProjectLinkDialog } from "@/components/AddProjectLinkDialog";
import { EditProjectLinkDialog } from "@/components/EditProjectLinkDialog";
import { deleteProjectLink, listProjectLinksBidirectional, type DirectedProjectLink, type LinkType } from "@/lib/project-links-api";
import { toast } from "sonner";


export const Route = createFileRoute("/_authenticated/progetti/$brainId")({
  head: () => ({
    meta: [
      { title: "Dettaglio progetto — Brain Hub" },
      { name: "description", content: "Overview, file, prompt, roadmap, task, strumenti AI e connessioni del progetto." },
    ],
  }),
  component: ProjectDetailPage,
});

async function loadProject(brainId: string) {
  const [b, sources, tasks, roadmap, nodes, edges, brainsAll] = await Promise.all([
    supabase.from("brains").select("*").eq("id", brainId).maybeSingle(),
    supabase.from("knowledge_sources").select("*").eq("brain_id", brainId).order("created_at", { ascending: false }),
    supabase.from("tasks").select("*").eq("brain_id", brainId).order("created_at", { ascending: false }),
    supabase.from("roadmap_items").select("*").eq("brain_id", brainId).order("order_index", { ascending: true }),
    supabase.from("brain_nodes").select("*").eq("brain_id", brainId),
    supabase.from("brain_edges").select("*").eq("brain_id", brainId),
    supabase.from("brains").select("id,name,color"),
  ]);
  if (b.error) throw b.error;
  return {
    brain: b.data,
    sources: sources.data ?? [],
    tasks: tasks.data ?? [],
    roadmap: roadmap.data ?? [],
    nodes: nodes.data ?? [],
    edges: edges.data ?? [],
    brainsAll: brainsAll.data ?? [],
  };
}

function ProjectDetailPage() {
  const { brainId } = useParams({ from: "/_authenticated/progetti/$brainId" });
  const { data, isLoading } = useQuery({ queryKey: ["progetto", brainId], queryFn: () => loadProject(brainId) });
  const { allLinks } = useBrainLinks(brainId);
  const linksCount = allLinks.length;

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Caricamento progetto…</div>;
  }
  if (!data?.brain) {
    return (
      <div className="p-6">
        <Button asChild variant="ghost"><Link to="/progetti"><ArrowLeft className="mr-2 h-4 w-4" />Progetti</Link></Button>
        <div className="mt-6 text-sm text-muted-foreground">Progetto non trovato.</div>
      </div>
    );
  }

  const { brain, sources, tasks, roadmap, nodes, edges, brainsAll } = data;
  const meta = findMeta(brain.name);
  const promptNodes = nodes.filter((n) => n.type === "prompt");
  const openTasks = tasks.filter((t) => t.status !== "done" && t.status !== "completato");

  // Resolve connections: find brain ids whose name appears in meta.connections.
  const connectionsByName = (meta?.connections ?? []).map((name) => {
    const target = brainsAll.find((x) => x.name?.toLowerCase() === name.toLowerCase());
    return { name, target };
  });

  return (
    <div className="min-h-[calc(100vh-3rem)] p-4 lg:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="h-7 px-2">
          <Link to="/progetti"><ArrowLeft className="mr-1 h-4 w-4" />Progetti</Link>
        </Button>
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: brain.color }} />
        <h1 className="text-2xl font-semibold tracking-tight text-gradient-primary">{brain.name}</h1>
        {meta && (
          <Badge variant="outline" className={`text-[10px] ${priorityColor(meta.priority)}`}>
            {priorityLabel(meta.priority)}
          </Badge>
        )}
        {meta && (
          <Badge variant="secondary" className="text-[10px]">{meta.category}</Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ExportProjectMenu
            brainName={brain.name ?? "progetto"}
            sources={sources}
            tasks={tasks}
            roadmap={roadmap}
            nodes={nodes}
            allLinks={allLinks}
          />
          <AddProjectLinkDialog brainId={brain.id} />
        </div>
      </div>

      <RecentLinksSection brainId={brain.id} />


      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="files">File ({sources.length})</TabsTrigger>
          <TabsTrigger value="prompts">Prompt ({promptNodes.length})</TabsTrigger>
          <TabsTrigger value="roadmap">Roadmap ({roadmap.length})</TabsTrigger>
          <TabsTrigger value="tasks">Task ({openTasks.length})</TabsTrigger>
          <TabsTrigger value="tools">Strumenti AI</TabsTrigger>
          <TabsTrigger value="connections">Connessioni</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card className="glass">
            <CardContent className="space-y-4 p-5 text-sm">
              <Section label="Descrizione">
                <p className="text-foreground/90">{meta?.description ?? brain.description ?? "—"}</p>
              </Section>
              {meta && (
                <>
                  <Section label="Stato attuale"><p>{meta.status}</p></Section>
                  <Section label="Prossima azione consigliata">
                    <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-foreground/90">
                      <Sparkles className="mr-1 inline h-3.5 w-3.5 text-primary" />
                      {meta.nextAction}
                    </div>
                  </Section>
                </>
              )}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Stat label="File collegati" value={sources.length} />
                <Stat label="Task aperti" value={openTasks.length} />
                <Stat label="Roadmap" value={roadmap.length} />
                <Stat label="Prompt" value={promptNodes.length} />
                <Stat label="Collegamenti" value={linksCount} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="files" className="mt-4">
          {sources.length === 0 ? (
            <Empty title="Nessun file collegato" hint="Aggiungi documenti, link o file dalla pagina Fonti." action={
              <Button asChild size="sm" variant="outline"><Link to="/fonti">Vai a Fonti</Link></Button>
            } />
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {sources.map((s) => (
                <Card key={s.id} className="glass">
                  <CardContent className="flex items-start gap-3 p-3">
                    <FileText className="mt-0.5 h-4 w-4 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{s.title}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {s.source_type} · {s.status}
                      </div>
                      {s.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.description}</p>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="prompts" className="mt-4">
          <PromptsTab nodes={promptNodes} brainId={brainId} brainName={brain.name ?? "progetto"} />
        </TabsContent>

        <TabsContent value="roadmap" className="mt-4">
          {roadmap.length === 0 ? (
            <Empty
              title="Nessuna voce di roadmap"
              hint="Aggiungi idee, attività in corso e milestone dalla pagina Roadmap."
              action={<Button asChild size="sm" variant="outline"><Link to="/roadmap">Vai a Roadmap</Link></Button>}
            />
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {roadmap.map((r) => (
                <div key={r.id} className="flex items-center gap-3 rounded-md border border-border/60 bg-card/40 p-3 text-sm glass">
                  <MapIcon className="h-4 w-4 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.title}</div>
                    {r.description && <div className="line-clamp-1 text-xs text-muted-foreground">{r.description}</div>}
                  </div>
                  <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{r.priority}</Badge>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          {tasks.length === 0 ? (
            <Empty
              title="Nessun task operativo"
              hint="Crea task con priorità e stato dalla pagina Tasks."
              action={<Button asChild size="sm" variant="outline"><Link to="/tasks">Vai a Tasks</Link></Button>}
            />
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {tasks.map((t) => (
                <div key={t.id} className="flex items-center gap-3 rounded-md border border-border/60 bg-card/40 p-3 text-sm glass">
                  <ListChecks className="h-4 w-4 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{t.title}</div>
                    {t.description && <div className="line-clamp-1 text-xs text-muted-foreground">{t.description}</div>}
                  </div>
                  <Badge variant="outline" className="text-[10px]">{t.status}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{t.priority}</Badge>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tools" className="mt-4">
          <Card className="glass">
            <CardContent className="p-5">
              {meta?.tools && meta.tools.length > 0 ? (
                <>
                  <div className="mb-2 text-xs text-muted-foreground">
                    Strumenti AI e operativi associati a questo progetto. I collegamenti reali (OAuth/API) sono gestiti dalla pagina Connettori; qui sono indicati come riferimento manuale.
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {meta.tools.map((t) => (
                      <Badge key={t} variant="outline" className="border-primary/30 bg-primary/5 text-foreground">
                        {t}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-4">
                    <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-[11px]">
                      <Link to="/connettori"><ExternalLink className="mr-1 h-3 w-3" />Gestisci connettori reali</Link>
                    </Button>
                  </div>
                </>
              ) : (
                <Empty title="Nessuno strumento associato" hint="Aggiungi questo progetto ai progetti suggeriti per popolare gli strumenti." />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="connections" className="mt-4">
          <Card className="glass">
            <CardContent className="space-y-4 p-5">
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Collegamenti tra progetti ({allLinks.filter((l) => l.link_type === "project").length})
                </div>
                {allLinks.filter((l) => l.link_type === "project").length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nessun collegamento verso altri progetti.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {allLinks.filter((l) => l.link_type === "project").map((l) => {
                      const rel = l.relation_type ?? "collegato a";
                      const label = l.direction === "in" ? `collegato da · ${rel}` : rel;
                      return l.target_brain_id ? (
                        <Button
                          key={`${l.direction}:${l.id}`}
                          asChild
                          size="sm"
                          variant="outline"
                          className="justify-start gap-2"
                        >
                          <Link to="/progetti/$brainId" params={{ brainId: l.target_brain_id }}>
                            <Link2 className="h-3 w-3" />
                            <span className="font-medium">{l.title}</span>
                            <span className="text-[11px] text-muted-foreground">— {label}</span>
                          </Link>
                        </Button>
                      ) : (
                        <Badge key={l.id} variant="outline" className="text-[11px] text-muted-foreground">
                          {l.title} · {label}
                        </Badge>
                      );
                    })}
                  </div>
                )}
                {connectionsByName.some(({ target }) => !target) && (
                  <div className="mt-3">
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Suggeriti dai metadati</div>
                    <div className="flex flex-wrap gap-2">
                      {connectionsByName.filter(({ target }) => !target).map(({ name }) => (
                        <Badge key={name} variant="outline" className="text-[11px] text-muted-foreground">
                          {name} · non ancora creato
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Collegamenti interni ({edges.length})
                </div>
                {edges.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nessun collegamento tra i nodi di questo progetto.</p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {edges.length} collegamenti tra {nodes.length} nodi. Vedi il grafo dalla pagina Cervelli.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>


      {!findMeta(brain.name) && (
        <div className="mt-6 rounded-md border border-dashed border-border bg-card/30 p-3 text-xs text-muted-foreground">
          Progetto extra o archivio secondario: puoi collegarlo manualmente a uno dei progetti principali usando "Aggiungi collegamento".
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-3 text-center">
      <div className="text-2xl font-semibold text-gradient-primary">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Empty({ title, hint, action }: { title: string; hint: string; action?: React.ReactNode }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card/30 p-8 text-center glass">
      <div className="max-w-md">
        <div className="text-sm font-semibold">{title}</div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

const LINK_ICON: Record<LinkType, React.ElementType> = {
  project: FolderKanban,
  file: FileText,
  prompt: Sparkles,
  roadmap: MapIcon,
  task: ListChecks,
  tool: Wrench,
  external: LinkIcon,
};

const LINK_LABEL: Record<LinkType, string> = {
  project: "Progetto", file: "File", prompt: "Prompt",
  roadmap: "Roadmap", task: "Task", tool: "Strumento AI", external: "Link esterno",
};

/**
 * Build bidirectional + virtual links for a brain. Exported as a hook so the
 * detail page and the section share the same query/cache.
 */
function useBrainLinks(brainId: string) {
  const { data: progetto } = useQuery({
    queryKey: ["progetto", brainId],
    queryFn: () => loadProject(brainId),
  });
  const brainsAll = progetto?.brainsAll ?? [];
  const nameById = new Map(brainsAll.map((b) => [b.id, b.name ?? ""]));
  const { data: links = [], isLoading } = useQuery({
    queryKey: ["project-links-bi", brainId, brainsAll.length],
    queryFn: () => listProjectLinksBidirectional(brainId, nameById),
    enabled: !!progetto,
  });

  const virtualLinks: DirectedProjectLink[] = (() => {
    if (!progetto?.brain) return [];
    const meta = findMeta(progetto.brain.name);
    if (!meta) return [];
    const existing = new Set(
      links.filter((l) => l.link_type === "project").map((l) => l.target_brain_id),
    );
    const out: DirectedProjectLink[] = [];
    for (const name of meta.connections) {
      const target = brainsAll.find((x) => x.name?.toLowerCase() === name.toLowerCase());
      if (!target || existing.has(target.id)) continue;
      out.push({
        id: `virtual:${target.id}`,
        user_id: "",
        brain_id: brainId,
        link_type: "project",
        relation_type: "collegato a",
        title: target.name ?? name,
        url: null,
        description: null,
        category: null,
        tool: null,
        status: null,
        notes: null,
        target_brain_id: target.id,
        target_table: "brains",
        target_id: target.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        direction: "out",
      });
    }
    return out;
  })();

  return { links, virtualLinks, allLinks: [...links, ...virtualLinks], isLoading };
}

function RecentLinksSection({ brainId }: { brainId: string }) {
  const qc = useQueryClient();
  const { allLinks, isLoading } = useBrainLinks(brainId);

  const onDelete = async (id: string) => {
    try {
      await deleteProjectLink(id, brainId);
      toast.success("Collegamento rimosso");
      await qc.invalidateQueries({ queryKey: ["project-links-bi"] });
      await qc.invalidateQueries({ queryKey: ["progetto", brainId] });
      await qc.invalidateQueries({ queryKey: ["progetti-hub"] });
      await qc.invalidateQueries({ queryKey: ["project-links-counts"] });
    } catch (e) { toast.error((e as Error).message); }
  };

  if (isLoading) return null;
  if (allLinks.length === 0) {
    return (
      <Card className="glass mb-4">
        <CardContent className="p-4 text-xs text-muted-foreground">
          Nessun collegamento ancora. Usa "Aggiungi collegamento" per collegare progetti, file, prompt, roadmap, task o strumenti.
        </CardContent>
      </Card>
    );
  }

  const recent = allLinks.slice(0, 6);

  return (
    <Card className="glass mb-4">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Collegamenti recenti ({allLinks.length})
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {recent.map((l) => (
            <LinkRow
              key={`${l.direction}:${l.id}`}
              link={l}
              currentBrainId={brainId}
              onDelete={l.id.startsWith("virtual:") || l.direction === "in" ? undefined : () => onDelete(l.id)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function LinkRow({
  link, currentBrainId, onDelete,
}: { link: DirectedProjectLink; currentBrainId: string; onDelete?: () => void }) {
  const Icon = LINK_ICON[link.link_type];
  const isVirtual = link.id.startsWith("virtual:");
  const date = isVirtual ? null : new Date(link.created_at).toLocaleDateString();
  const openHref = link.url ?? (link.target_brain_id ? `/progetti/${link.target_brain_id}` : null);
  const baseRelation = link.relation_type ?? "collegato a";
  const relation = link.direction === "in" ? `collegato da · ${baseRelation}` : baseRelation;
  // Editing inbound links would mutate the OTHER project's row from this view —
  // allowed, but we set the "current" context to the link's real brain_id so the
  // upsert/update writes back to the original source row.
  const canEdit = !isVirtual || !!link.target_brain_id;
  void currentBrainId;
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/60 bg-card/40 p-2 text-sm">
      <Icon className="mt-0.5 h-4 w-4 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate font-medium">{link.title}</div>
          <Badge variant="outline" className="text-[10px]">{LINK_LABEL[link.link_type]}</Badge>
          {link.direction === "in" && (
            <Badge variant="secondary" className="text-[10px]">inbound</Badge>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {relation}{date ? ` · ${date}` : ""}
        </div>
        {link.notes && (
          <div className="mt-1 line-clamp-2 text-[11px] text-foreground/70">{link.notes}</div>
        )}
      </div>
      {openHref && (
        openHref.startsWith("/") ? (
          <Button asChild size="icon" variant="ghost" className="h-7 w-7">
            <a href={openHref}><ExternalLink className="h-3.5 w-3.5" /></a>
          </Button>
        ) : (
          <Button asChild size="icon" variant="ghost" className="h-7 w-7">
            <a href={openHref} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
          </Button>
        )
      )}
      {canEdit && <EditProjectLinkDialog link={link} />}
      {onDelete && (
        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

type PromptNode = {
  id: string;
  label: string;
  summary?: string | null;
  tags?: string[] | null;
  origin?: string | null;
};

const PROMPT_FILTERS: { id: string; label: string; match: (n: PromptNode) => boolean }[] = [
  { id: "all", label: "Tutti", match: () => true },
  { id: "storico", label: "Storici", match: (n) => (n.tags ?? []).some((t) => t.toLowerCase().includes("prompt storico") || t.toLowerCase().includes("prompt_storico")) },
  { id: "lovable", label: "Lovable", match: (n) => (n.tags ?? []).some((t) => /lovable/i.test(t)) },
  { id: "chatgpt", label: "ChatGPT", match: (n) => (n.tags ?? []).some((t) => /chatgpt/i.test(t)) },
  { id: "usato", label: "Usati", match: (n) => (n.tags ?? []).some((t) => /(^|:)usato$/i.test(t) || t.toLowerCase() === "usato") },
  { id: "approvato", label: "Approvati", match: (n) => (n.tags ?? []).some((t) => /approvato/i.test(t)) },
  { id: "revisionare", label: "Da revisionare", match: (n) => (n.tags ?? []).some((t) => /revision/i.test(t)) },
];

function PromptsTab({ nodes, brainId, brainName }: { nodes: PromptNode[]; brainId: string; brainName: string }) {
  const [filter, setFilter] = useState<string>("all");
  const [onlyStorici, setOnlyStorici] = useState(false);

  const filtered = nodes.filter((n) => {
    const f = PROMPT_FILTERS.find((x) => x.id === filter) ?? PROMPT_FILTERS[0];
    if (!f.match(n)) return false;
    if (onlyStorici && !PROMPT_FILTERS.find((x) => x.id === "storico")!.match(n)) return false;
    return true;
  });

  if (nodes.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border/60 p-8 text-center">
        <div className="text-sm font-semibold">Nessun prompt collegato</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Carica i prompt storici dall'importatore massivo o crea un nodo di tipo "prompt".
        </p>
        <div className="mt-3 flex justify-center gap-2">
          <Button asChild size="sm" variant="outline"><Link to="/importa/prompt-storici">Importa prompt storici</Link></Button>
          <Button asChild size="sm" variant="ghost"><Link to="/">Vai ai Cervelli</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {PROMPT_FILTERS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={filter === f.id ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setFilter(f.id)}
          >
            {f.label} ({nodes.filter(f.match).length})
          </Button>
        ))}
        <label className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyStorici}
            onChange={(e) => setOnlyStorici(e.target.checked)}
          />
          Solo prompt storici
        </label>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={filtered.length === 0}
            onClick={() => {
              const items: ExportableItem[] = filtered.map((n) => ({
                title: n.label,
                brainName,
                type: "prompt",
                tags: n.tags ?? [],
                content: n.summary ?? "",
              }));
              downloadItemsAsMdZip(items, `${slugify(brainName)}-prompt-${todayStamp()}.zip`);
              toast.success(`Esportati ${items.length} prompt.`);
            }}
          >
            <Download className="h-4 w-4 mr-1" /> Esporta prompt ({filtered.length})
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/importa/prompt-storici">Importa prompt storici</Link>
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-xs text-muted-foreground p-4">Nessun prompt corrisponde al filtro.</div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {filtered.map((n) => {
            const tags = n.tags ?? [];
            const isStorico = PROMPT_FILTERS.find((x) => x.id === "storico")!.match(n);
            return (
              <Card key={n.id} className="glass">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-primary" />
                    <div className="truncate text-sm font-medium flex-1">{n.label}</div>
                    {isStorico && <Badge variant="default" className="text-[10px]">Storico</Badge>}
                  </div>
                  {n.summary && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground whitespace-pre-wrap">{n.summary}</p>}
                  {tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tags.slice(0, 8).map((t) => (
                        <Badge key={t} variant="secondary" className="text-[10px] font-normal">{t}</Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {/* brainId reserved for future inline actions */}
      <span className="hidden">{brainId}</span>
    </div>
  );
}




type AnyRow = Record<string, unknown>;

function ExportProjectMenu({
  brainName, sources, tasks, roadmap, nodes, allLinks,
}: {
  brainName: string;
  sources: AnyRow[];
  tasks: AnyRow[];
  roadmap: AnyRow[];
  nodes: AnyRow[];
  allLinks: DirectedProjectLink[];
}) {
  const stamp = todayStamp();
  const slug = slugify(brainName);

  const promptNodes = nodes.filter((n) => (n.type as string) === "prompt");

  const promptEntries = (): ZipEntry[] => promptNodes.map((n) => {
    const item: ExportableItem = {
      title: (n.label as string) ?? "prompt",
      brainName,
      type: "prompt",
      tags: (n.tags as string[]) ?? [],
      content: (n.summary as string) ?? "",
      created_at: n.created_at as string,
      updated_at: n.updated_at as string,
    };
    return { path: `prompt/${fileNameForItem(item, "md")}`, data: itemToMarkdown(item) };
  });

  const fileEntries = (): ZipEntry[] => sources.map((s) => {
    const item: ExportableItem = {
      title: (s.title as string) ?? "file",
      brainName,
      type: (s.source_type as string) ?? "file",
      status: (s.status as string) ?? null,
      tags: (s.tags as string[]) ?? [],
      url: (s.url as string) ?? null,
      content: (s.extracted_text as string) ?? (s.description as string) ?? "",
      created_at: s.created_at as string,
      updated_at: s.updated_at as string,
    };
    return { path: `file/${fileNameForItem(item, "md")}`, data: itemToMarkdown(item) };
  });

  const taskEntries = (): ZipEntry[] => tasks.map((t) => {
    const item: ExportableItem = {
      title: (t.title as string) ?? "task",
      brainName,
      type: "task",
      status: (t.status as string) ?? null,
      content: (t.description as string) ?? "",
      created_at: t.created_at as string,
      updated_at: t.updated_at as string,
    };
    return { path: `task/${fileNameForItem(item, "md")}`, data: itemToMarkdown(item) };
  });

  const roadmapEntries = (): ZipEntry[] => roadmap.map((r) => {
    const item: ExportableItem = {
      title: (r.title as string) ?? "roadmap",
      brainName,
      type: "roadmap",
      status: (r.status as string) ?? null,
      content: (r.description as string) ?? "",
      created_at: r.created_at as string,
      updated_at: r.updated_at as string,
    };
    return { path: `roadmap/${fileNameForItem(item, "md")}`, data: itemToMarkdown(item) };
  });

  const linkEntries = (): ZipEntry[] => allLinks.map((l) => {
    const item: ExportableItem = {
      title: l.title ?? "link",
      brainName,
      type: l.link_type,
      tool: l.tool ?? null,
      url: l.url ?? null,
      content: l.notes ?? "",
      created_at: l.created_at,
      updated_at: l.updated_at,
    };
    return { path: `collegamenti/${fileNameForItem(item, "md")}`, data: itemToMarkdown(item) };
  });

  const metadataEntry = (counts: Record<string, number>): ZipEntry => ({
    path: "metadata/progetto.json",
    data: JSON.stringify({
      progetto: brainName,
      esportato_il: new Date().toISOString(),
      conteggi: counts,
    }, null, 2),
  });

  const exportZip = (kind: "all" | "prompts" | "files" | "tasks" | "roadmap" | "links") => {
    let entries: ZipEntry[] = [];
    let counts: Record<string, number> = {};
    if (kind === "all" || kind === "prompts") {
      const e = promptEntries(); entries = entries.concat(e); counts.prompt = e.length;
    }
    if (kind === "all" || kind === "files") {
      const e = fileEntries(); entries = entries.concat(e); counts.file = e.length;
    }
    if (kind === "all" || kind === "tasks") {
      const e = taskEntries(); entries = entries.concat(e); counts.task = e.length;
    }
    if (kind === "all" || kind === "roadmap") {
      const e = roadmapEntries(); entries = entries.concat(e); counts.roadmap = e.length;
    }
    if (kind === "all" || kind === "links") {
      const e = linkEntries(); entries = entries.concat(e); counts.collegamenti = e.length;
    }
    entries.push(metadataEntry(counts));
    if (entries.length <= 1) {
      toast.error("Nessun contenuto da esportare.");
      return;
    }
    const suffix = kind === "all" ? "completo" : kind;
    downloadBlob(buildZip(entries), `${slug}-${suffix}-${stamp}.zip`);
    toast.success(`Esportato ${slug} (${entries.length - 1} file).`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <Download className="h-4 w-4 mr-1" /> Esporta progetto
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => exportZip("all")}>Tutto il progetto (.zip)</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => exportZip("prompts")}>Solo Prompt ({promptNodes.length})</DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportZip("files")}>Solo File ({sources.length})</DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportZip("tasks")}>Solo Task ({tasks.length})</DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportZip("roadmap")}>Solo Roadmap ({roadmap.length})</DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportZip("links")}>Solo Collegamenti ({allLinks.length})</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
