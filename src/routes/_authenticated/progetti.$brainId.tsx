import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, ExternalLink, FileText, Link2, ListChecks, Map as MapIcon, Sparkles, Wrench, Trash2, FolderKanban, LinkIcon } from "lucide-react";
import { findMeta, priorityColor, priorityLabel, PROJECT_META } from "@/lib/projects-meta";
import { AddProjectLinkDialog } from "@/components/AddProjectLinkDialog";
import { EditProjectLinkDialog } from "@/components/EditProjectLinkDialog";
import { deleteProjectLink, listProjectLinksBidirectional, type DirectedProjectLink, type LinkType, type ProjectLink } from "@/lib/project-links-api";
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
        <div className="ml-auto"><AddProjectLinkDialog brainId={brain.id} /></div>
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
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="File collegati" value={sources.length} />
                <Stat label="Task aperti" value={openTasks.length} />
                <Stat label="Roadmap" value={roadmap.length} />
                <Stat label="Prompt" value={promptNodes.length} />
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
          {promptNodes.length === 0 ? (
            <Empty
              title="Nessun prompt collegato"
              hint="Crea un nodo di tipo 'prompt' dalla pagina Cervelli per raccogliere i tuoi prompt operativi."
              action={<Button asChild size="sm" variant="outline"><Link to="/">Vai ai Cervelli</Link></Button>}
            />
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {promptNodes.map((n) => (
                <Card key={n.id} className="glass">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2">
                      <Wrench className="h-4 w-4 text-primary" />
                      <div className="truncate text-sm font-medium">{n.label}</div>
                    </div>
                    {n.summary && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{n.summary}</p>}
                    {Array.isArray(n.tags) && n.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(n.tags as string[]).map((t) => (
                          <Badge key={t} variant="secondary" className="text-[10px] font-normal">{t}</Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
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
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Collegamenti tra progetti</div>
                {connectionsByName.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nessun collegamento dichiarato verso altri progetti.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {connectionsByName.map(({ name, target }) => target ? (
                      <Button key={name} asChild size="sm" variant="outline" className="gap-1">
                        <Link to="/progetti/$brainId" params={{ brainId: target.id }}>
                          <Link2 className="h-3 w-3" />{name}
                          <span className="ml-1 text-[10px] text-muted-foreground">· collegato a</span>
                        </Link>
                      </Button>
                    ) : (
                      <Badge key={name} variant="outline" className="text-[11px] text-muted-foreground">
                        {name} · non ancora creato
                      </Badge>
                    ))}
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
          Questo progetto non corrisponde a uno dei {PROJECT_META.length} progetti principali. Categoria, priorità e strumenti consigliati non sono disponibili — puoi comunque collegare file, task, roadmap e prompt.
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
      await qc.invalidateQueries({ queryKey: ["project-links-bi", brainId] });
      await qc.invalidateQueries({ queryKey: ["progetto", brainId] });
      await qc.invalidateQueries({ queryKey: ["progetti-hub"] });
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


