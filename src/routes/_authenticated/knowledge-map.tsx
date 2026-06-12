import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ArrowRight,
  BookOpen,
  ExternalLink,
  Plus,
  RefreshCw,
  Trash2,
  Wrench,
  Pencil,
  Archive,
  CheckCircle2,
  AlertTriangle,
  Link2,
} from "lucide-react";
import {
  CATEGORIES,
  CreateKnowledgeInput,
  IMPORTANCE,
  KCategory,
  KImportance,
  KStatus,
  KSourceType,
  KnowledgeSourceRow,
  RECOMMENDED_BY_PRESET,
  SOURCE_TYPE_LABEL,
  STATUS_LABEL,
  createKnowledgeSource,
  deleteKnowledgeSource,
  listKnowledgeSources,
  setKnowledgeStatus,
  summarizeKnowledge,
  updateKnowledgeSource,
} from "@/lib/knowledge-map";
import { loadConfigForBrain, PRESETS } from "@/lib/project-console";

export const Route = createFileRoute("/_authenticated/knowledge-map")({
  head: () => ({
    meta: [
      { title: "Knowledge Map — Brain Hub" },
      {
        name: "description",
        content:
          "Mappa centrale dei materiali di progetto: link, repository, cartelle, documenti e asset collegati a roadmap, tool e runbook.",
      },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    brain: typeof s.brain === "string" ? s.brain : undefined,
  }),
  component: KnowledgeMapRoute,
});

type BrainRow = { id: string; name: string; color: string };

function KnowledgeMapRoute() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { brain: brainSearch } = useSearch({ from: "/_authenticated/knowledge-map" });
  const [brainId, setBrainId] = useState<string>(brainSearch ?? "");

  const { data: brains = [] } = useQuery({
    queryKey: ["brains-min"],
    queryFn: async (): Promise<BrainRow[]> => {
      const { data, error } = await supabase.from("brains").select("id,name,color").order("name");
      if (error) throw error;
      return (data ?? []) as BrainRow[];
    },
  });

  useEffect(() => {
    if (!brainId && brains.length > 0) setBrainId(brains[0].id);
  }, [brainId, brains]);

  const { data: config } = useQuery({
    queryKey: ["knowledge-map-config", brainId],
    enabled: !!brainId,
    queryFn: () => loadConfigForBrain(brainId),
  });

  const { data: rows = [], refetch } = useQuery({
    queryKey: ["knowledge-sources", brainId],
    enabled: !!brainId,
    queryFn: () => listKnowledgeSources(brainId),
  });

  const summary = useMemo(() => summarizeKnowledge(rows, config?.preset), [rows, config]);

  const [filter, setFilter] = useState<string>("all");
  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "unlinked")
      return rows.filter(
        (r) =>
          !r.roadmap_item_id &&
          !r.task_id &&
          !r.prompt_execution_log_id &&
          !r.runbook_instance_id &&
          !r.tool_link_id,
      );
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["knowledge-sources", brainId] });
    void refetch();
  };

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title="Knowledge Map"
        subtitle="Project Knowledge & File Map — mappa dei materiali, link e riferimenti del progetto"
        icon={<BookOpen className="h-5 w-5" />}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-[220px]">
            <Label className="mb-1 block text-xs text-muted-foreground">Progetto / Cervello</Label>
            <Select
              value={brainId}
              onValueChange={(v) => {
                setBrainId(v);
                navigate({ to: "/knowledge-map", search: { brain: v } });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleziona…" />
              </SelectTrigger>
              <SelectContent>
                {brains.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {config && (
            <div className="flex flex-wrap gap-1">
              <Badge variant="outline">{PRESETS[config.preset]?.label ?? config.preset}</Badge>
              <Badge variant="secondary">{config.project_priority}</Badge>
            </div>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/operating-dashboard" search={{ brain: brainId }}>
                Operating Dashboard <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/project-console">
                Project Console <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/tool-connections" search={{ brain: brainId }}>
                Tool Connections <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
            <Button size="sm" variant="ghost" onClick={refreshAll}>
              <RefreshCw className="h-3 w-3" />
            </Button>
            <AddSourceDialog brainId={brainId} onSaved={refreshAll} />
          </div>
        </CardContent>
      </Card>

      {brainId && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-7">
            <SummaryTile label="Totale" value={summary.total} />
            <SummaryTile label="Attive" value={summary.active} tone="green" />
            <SummaryTile
              label="Da verificare"
              value={summary.needs_review}
              tone={summary.needs_review > 0 ? "amber" : undefined}
            />
            <SummaryTile
              label="Mancanti"
              value={summary.missing}
              tone={summary.missing > 0 ? "red" : undefined}
            />
            <SummaryTile
              label="Obsolete"
              value={summary.outdated}
              tone={summary.outdated > 0 ? "amber" : undefined}
            />
            <SummaryTile
              label="Scollegate"
              value={summary.unlinked}
              tone={summary.unlinked > 0 ? "amber" : undefined}
            />
            <SummaryTile label="Critiche" value={summary.critical} tone="red" />
          </div>

          {/* Recommended missing */}
          {summary.recommended_missing.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Fonti consigliate mancanti per preset
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {summary.recommended_missing.map((r) => (
                  <Button
                    key={r.title}
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await createKnowledgeSource({
                          brain_id: brainId,
                          title: r.title,
                          source_type: r.source_type,
                          category: r.category,
                          importance: r.importance,
                          status: "missing",
                        });
                        toast.success("Fonte aggiunta come mancante");
                        refreshAll();
                      } catch (e) {
                        toast.error("Errore", { description: (e as Error).message });
                      }
                    }}
                  >
                    <Plus className="mr-1 h-3 w-3" /> {r.title}
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      {r.category}
                    </Badge>
                  </Button>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-1">
            {(["all", "active", "needs_review", "missing", "outdated", "duplicate", "archived", "unlinked"] as const).map(
              (f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={filter === f ? "default" : "outline"}
                  onClick={() => setFilter(f)}
                >
                  {f === "all"
                    ? "Tutte"
                    : f === "unlinked"
                    ? "Scollegate"
                    : STATUS_LABEL[f as KStatus]}
                </Button>
              ),
            )}
          </div>

          {/* Grid */}
          {filtered.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                Nessuna fonte. Aggiungine una per iniziare la mappa.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map((row) => (
                <SourceCard key={row.id} row={row} onChanged={refreshAll} brainId={brainId} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "red" | "amber" | "green";
}) {
  return (
    <div
      className={`rounded border p-2 ${
        tone === "red"
          ? "border-red-500/30 bg-red-500/5"
          : tone === "amber"
          ? "border-amber-500/30 bg-amber-500/5"
          : tone === "green"
          ? "border-green-500/30 bg-green-500/5"
          : "border-border/60 bg-background/40"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function SourceCard({
  row,
  onChanged,
  brainId,
}: {
  row: KnowledgeSourceRow;
  onChanged: () => void;
  brainId: string;
}) {
  const href = row.source_url || (row.local_path ? `file://${row.local_path}` : null);
  const isLinked =
    row.roadmap_item_id ||
    row.task_id ||
    row.prompt_execution_log_id ||
    row.runbook_instance_id ||
    row.tool_link_id;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold leading-tight">{row.title}</CardTitle>
          <Badge variant="outline" className="text-[10px]">
            {row.importance}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1 text-[10px]">
          <Badge variant="secondary">{SOURCE_TYPE_LABEL[row.source_type]}</Badge>
          <Badge variant="outline">{row.category}</Badge>
          <Badge
            variant="outline"
            className={
              row.status === "active"
                ? "border-green-500/40 text-green-600"
                : row.status === "missing"
                ? "border-red-500/40 text-red-600"
                : row.status === "needs_review" || row.status === "outdated"
                ? "border-amber-500/40 text-amber-600"
                : ""
            }
          >
            {STATUS_LABEL[row.status]}
          </Badge>
          {isLinked && (
            <Badge variant="outline" className="border-violet-500/40 text-violet-600">
              <Link2 className="mr-1 h-2.5 w-2.5" /> Collegata
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {row.description && (
          <div className="text-xs text-muted-foreground line-clamp-2">{row.description}</div>
        )}
        {(row.source_url || row.local_path || row.external_drive_name) && (
          <div className="rounded border border-border/60 bg-background/40 p-2 text-[11px] font-mono break-all">
            {row.source_url || row.local_path || row.external_drive_name}
          </div>
        )}
        {row.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {row.tags.map((t) => (
              <Badge key={t} variant="outline" className="text-[10px]">
                {t}
              </Badge>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1 pt-1">
          {href && (
            <Button asChild size="sm" variant="outline">
              <a href={href} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1 h-3 w-3" /> Apri
              </a>
            </Button>
          )}
          <EditSourceDialog row={row} onSaved={onChanged} />
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await setKnowledgeStatus(row.id, "active");
              toast.success("Segnata attiva");
              onChanged();
            }}
            title="Segna attiva"
          >
            <CheckCircle2 className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await setKnowledgeStatus(row.id, "needs_review");
              toast.message("Segnata da verificare");
              onChanged();
            }}
            title="Da verificare"
          >
            <AlertTriangle className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await setKnowledgeStatus(row.id, "archived");
              toast.message("Archiviata");
              onChanged();
            }}
            title="Archivia"
          >
            <Archive className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (!confirm("Eliminare questa fonte?")) return;
              await deleteKnowledgeSource(row.id);
              toast.success("Eliminata");
              onChanged();
            }}
            title="Elimina"
          >
            <Trash2 className="h-3 w-3 text-red-500" />
          </Button>
        </div>
        {brainId && void 0}
      </CardContent>
    </Card>
  );
}

// ---- Dialogs ----

function AddSourceDialog({ brainId, onSaved }: { brainId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={!brainId}>
          <Plus className="mr-1 h-3 w-3" /> Aggiungi fonte
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Aggiungi fonte</DialogTitle>
        </DialogHeader>
        <SourceForm
          brainId={brainId}
          onCancel={() => setOpen(false)}
          onSubmit={async (input) => {
            try {
              await createKnowledgeSource(input);
              toast.success("Fonte creata");
              setOpen(false);
              onSaved();
            } catch (e) {
              toast.error("Errore", { description: (e as Error).message });
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function EditSourceDialog({
  row,
  onSaved,
}: {
  row: KnowledgeSourceRow;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" title="Modifica">
          <Pencil className="h-3 w-3" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Modifica fonte</DialogTitle>
        </DialogHeader>
        <SourceForm
          brainId={row.brain_id ?? ""}
          initial={row}
          onCancel={() => setOpen(false)}
          onSubmit={async (input) => {
            try {
              await updateKnowledgeSource(row.id, input);
              toast.success("Fonte aggiornata");
              setOpen(false);
              onSaved();
            } catch (e) {
              toast.error("Errore", { description: (e as Error).message });
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function SourceForm({
  brainId,
  initial,
  onSubmit,
  onCancel,
}: {
  brainId: string;
  initial?: KnowledgeSourceRow;
  onSubmit: (input: CreateKnowledgeInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [source_type, setSourceType] = useState<KSourceType>(initial?.source_type ?? "website_url");
  const [category, setCategory] = useState<KCategory>(initial?.category ?? "Altro");
  const [source_url, setSourceUrl] = useState(initial?.source_url ?? "");
  const [local_path, setLocalPath] = useState(initial?.local_path ?? "");
  const [external_drive_name, setExternal] = useState(initial?.external_drive_name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [status, setStatus] = useState<KStatus>(initial?.status ?? "active");
  const [importance, setImportance] = useState<KImportance>(initial?.importance ?? "media");
  const [tagsText, setTagsText] = useState((initial?.tags ?? []).join(", "));

  return (
    <div className="space-y-3">
      <div>
        <Label>Titolo *</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Tipo fonte</Label>
          <Select value={source_type} onValueChange={(v) => setSourceType(v as KSourceType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              {(Object.keys(SOURCE_TYPE_LABEL) as KSourceType[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {SOURCE_TYPE_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Categoria</Label>
          <Select value={category} onValueChange={(v) => setCategory(v as KCategory)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label>URL</Label>
        <Input value={source_url} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Percorso locale</Label>
          <Input value={local_path} onChange={(e) => setLocalPath(e.target.value)} placeholder="/Users/…" />
        </div>
        <div>
          <Label>Nome disco esterno</Label>
          <Input value={external_drive_name} onChange={(e) => setExternal(e.target.value)} />
        </div>
      </div>
      <div>
        <Label>Descrizione</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Stato</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as KStatus)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STATUS_LABEL) as KStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Importanza</Label>
          <Select value={importance} onValueChange={(v) => setImportance(v as KImportance)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IMPORTANCE.map((i) => (
                <SelectItem key={i} value={i}>
                  {i}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label>Tag (separati da virgola)</Label>
        <Input value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Annulla
        </Button>
        <Button
          onClick={() =>
            onSubmit({
              brain_id: brainId,
              title: title.trim(),
              source_type,
              category,
              source_url: source_url.trim() || null,
              local_path: local_path.trim() || null,
              external_drive_name: external_drive_name.trim() || null,
              description: description.trim() || null,
              status,
              importance,
              tags: tagsText
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          disabled={!title.trim() || !brainId}
        >
          Salva
        </Button>
      </DialogFooter>
    </div>
  );
}
