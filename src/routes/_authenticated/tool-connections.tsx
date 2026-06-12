import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Pencil,
  Plug,
  PlusCircle,
  PowerOff,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  CONNECTION_TYPE_LABEL,
  ConnectionType,
  PRESET_RECOMMENDED_TOOLS,
  TOOL_CATALOG,
  TOOL_CATEGORY_LABEL,
  TOOL_STATUS_LABEL,
  TOOL_STATUS_TONE,
  ToolCategory,
  ToolLink,
  ToolStatus,
  createToolLink,
  deleteToolLink,
  listToolLinks,
  logRecommendedIgnored,
  logToolOpened,
  markManualCheck,
  normalizeStatus,
  recommendedToolsForPreset,
  setToolStatus,
  summarizeTools,
  updateToolLink,
} from "@/lib/tool-connections";
import { loadConfigForBrain, PRESETS } from "@/lib/project-console";

export const Route = createFileRoute("/_authenticated/tool-connections")({
  head: () => ({
    meta: [
      { title: "Tool Connection Center — Brain Hub" },
      {
        name: "description",
        content:
          "Gestisci i tool collegati per ogni progetto: stato, tipo collegamento, suggerimenti per preset.",
      },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    brain: typeof s.brain === "string" ? s.brain : undefined,
  }),
  component: ToolConnectionsRoute,
});

type BrainRow = { id: string; name: string; color: string };

function ToolConnectionsRoute() {
  const search = useSearch({ from: "/_authenticated/tool-connections" });
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: brains = [] } = useQuery({
    queryKey: ["brains-min"],
    queryFn: async (): Promise<BrainRow[]> => {
      const { data, error } = await supabase
        .from("brains")
        .select("id,name,color")
        .order("name");
      if (error) throw error;
      return (data ?? []) as BrainRow[];
    },
  });

  const [brainId, setBrainId] = useState<string>(search.brain ?? "");
  useEffect(() => {
    if (!brainId && brains.length > 0) setBrainId(brains[0].id);
  }, [brains, brainId]);
  useEffect(() => {
    if (brainId && brainId !== search.brain) {
      void navigate({ to: "/tool-connections", search: { brain: brainId }, replace: true });
    }
  }, [brainId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: config } = useQuery({
    queryKey: ["tool-connections-config", brainId],
    enabled: !!brainId,
    queryFn: () => (brainId ? loadConfigForBrain(brainId) : Promise.resolve(null)),
  });

  const { data: links = [] } = useQuery<ToolLink[]>({
    queryKey: ["tool-connections", brainId],
    enabled: !!brainId,
    queryFn: () => listToolLinks(brainId),
  });

  const recommended = useMemo(
    () => recommendedToolsForPreset(config?.preset),
    [config],
  );
  const summary = useMemo(() => summarizeTools(links, recommended), [links, recommended]);

  const [editing, setEditing] = useState<ToolLink | null>(null);
  const [adding, setAdding] = useState<{ name?: string } | null>(null);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["tool-connections", brainId] });
    qc.invalidateQueries({ queryKey: ["tool-connections-block", brainId] });
    qc.invalidateQueries({ queryKey: ["operating-dashboard-tools", brainId] });
  }

  async function handleStatus(link: ToolLink, status: ToolStatus) {
    try {
      await setToolStatus(link, status);
      toast.success(`Stato aggiornato: ${TOOL_STATUS_LABEL[status]}`);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore aggiornamento stato");
    }
  }

  async function handleManualCheck(link: ToolLink) {
    try {
      await markManualCheck(link);
      toast.success("Verifica registrata");
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore verifica");
    }
  }

  async function handleDelete(link: ToolLink) {
    if (!window.confirm(`Rimuovere il collegamento "${link.tool_name}"?`)) return;
    try {
      await deleteToolLink(link);
      toast.success("Collegamento rimosso");
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore rimozione");
    }
  }

  function handleOpenTool(link: ToolLink) {
    if (!link.url) return;
    void logToolOpened(link);
    window.open(link.url, "_blank", "noreferrer");
  }

  async function handleIgnoreRecommended(toolName: string) {
    try {
      await logRecommendedIgnored(brainId, toolName);
      toast.success("Suggerimento ignorato (registrato)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  const presetLabel = config?.preset && PRESETS[config.preset]?.label;
  const brainName = brains.find((b) => b.id === brainId)?.name ?? "—";

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Tool Connection Center"
        subtitle="Gestisci i tool collegati a ogni progetto"
        actions={
          <>
            <Badge variant="outline" className="text-[10px]">v1.1</Badge>
            <Button asChild size="sm" variant="outline">
              <Link to="/operating-dashboard" search={{ brain: brainId || undefined }}>
                Operating Dashboard <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/project-console">Project Console</Link>
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Select value={brainId} onValueChange={setBrainId}>
            <SelectTrigger className="w-[260px]">
              <SelectValue placeholder="Seleziona progetto/cervello" />
            </SelectTrigger>
            <SelectContent>
              {brains.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {config?.project_priority && (
            <Badge variant="outline" className="text-xs">
              Priorità: {config.project_priority}
            </Badge>
          )}
          {presetLabel && (
            <Badge variant="secondary" className="text-xs">
              Preset: {presetLabel}
            </Badge>
          )}
          <div className="ml-auto text-xs text-muted-foreground">{brainName}</div>
        </CardContent>
      </Card>

      {!brainId ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Seleziona un progetto per gestire i tool.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary */}
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            <SummaryTile label="Totale" value={summary.total} />
            <SummaryTile label="Collegati" value={summary.connected} tone="green" />
            <SummaryTile label="Mancanti" value={summary.missing} />
            <SummaryTile label="Da configurare" value={summary.needs_setup} tone="amber" />
            <SummaryTile label="Problemi" value={summary.broken} tone="red" />
            <SummaryTile
              label="Consigliati mancanti"
              value={summary.recommended_missing.length}
              tone="amber"
            />
          </div>

          {/* Recommended missing */}
          {summary.recommended_missing.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4" /> Tool consigliati mancanti
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {summary.recommended_missing.map((name) => (
                    <div
                      key={name}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-sm"
                    >
                      <div className="font-medium">{name}</div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => setAdding({ name })}>
                          <PlusCircle className="mr-1 h-3 w-3" /> Aggiungi collegamento
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleIgnoreRecommended(name)}
                        >
                          Ignora
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Grid */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                  <Plug className="h-4 w-4" /> Tool collegati ({links.length})
                </span>
                <Button size="sm" onClick={() => setAdding({})}>
                  <PlusCircle className="mr-1 h-3 w-3" /> Aggiungi tool
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {links.length === 0 ? (
                <div className="rounded border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  Nessun tool collegato a questo progetto.
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {links.map((l) => (
                    <ToolCard
                      key={l.id}
                      link={l}
                      isRecommended={recommended.includes(l.tool_name)}
                      onEdit={() => setEditing(l)}
                      onOpen={() => handleOpenTool(l)}
                      onStatus={(s) => handleStatus(l, s)}
                      onManualCheck={() => handleManualCheck(l)}
                      onDelete={() => handleDelete(l)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <ToolDialog
        open={!!adding}
        brainId={brainId}
        initialName={adding?.name}
        onClose={() => setAdding(null)}
        onSaved={invalidate}
      />
      <ToolDialog
        open={!!editing}
        brainId={brainId}
        existing={editing ?? undefined}
        onClose={() => setEditing(null)}
        onSaved={invalidate}
      />
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
  tone?: "green" | "amber" | "red";
}) {
  const cls =
    tone === "green"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : tone === "amber"
      ? "border-amber-500/30 bg-amber-500/5"
      : tone === "red"
      ? "border-red-500/30 bg-red-500/5"
      : "border-border/60 bg-background/40";
  return (
    <div className={`rounded border p-3 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

function ToolCard({
  link,
  isRecommended,
  onEdit,
  onOpen,
  onStatus,
  onManualCheck,
  onDelete,
}: {
  link: ToolLink;
  isRecommended: boolean;
  onEdit: () => void;
  onOpen: () => void;
  onStatus: (s: ToolStatus) => void;
  onManualCheck: () => void;
  onDelete: () => void;
}) {
  const status = normalizeStatus(link.connection_status);
  const ct = (link.connection_type ?? "custom") as ConnectionType;
  const cat = (link.tool_category as ToolCategory) ?? "custom";
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-card/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Plug className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <div className="truncate font-semibold">{link.tool_name}</div>
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {TOOL_CATEGORY_LABEL[cat] ?? link.tool_category}
          </div>
        </div>
        <Badge
          className={`border text-[10px] ${TOOL_STATUS_TONE[status]}`}
          variant="outline"
        >
          {TOOL_STATUS_LABEL[status]}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1">
        <Badge variant="outline" className="text-[10px]">
          {CONNECTION_TYPE_LABEL[ct] ?? ct}
        </Badge>
        {link.is_required && (
          <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-[10px] text-red-600">
            <ShieldAlert className="mr-0.5 h-2.5 w-2.5" /> Obbligatorio
          </Badge>
        )}
        {(link.is_recommended || isRecommended) && (
          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-600">
            <Sparkles className="mr-0.5 h-2.5 w-2.5" /> Consigliato
          </Badge>
        )}
      </div>

      {link.notes && (
        <div className="text-[11px] text-muted-foreground line-clamp-2">{link.notes}</div>
      )}
      {link.last_manual_check_at && (
        <div className="text-[10px] text-muted-foreground">
          Ultima verifica: {new Date(link.last_manual_check_at).toLocaleString()}
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-1 pt-1">
        {link.url && (
          <Button size="sm" variant="outline" onClick={onOpen}>
            <ExternalLink className="mr-1 h-3 w-3" /> Apri
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Pencil className="mr-1 h-3 w-3" /> Modifica
        </Button>
        <Button size="sm" variant="outline" onClick={() => onStatus("connected")}>
          <CheckCircle2 className="mr-1 h-3 w-3" /> Collegato
        </Button>
        <Button size="sm" variant="outline" onClick={() => onStatus("needs_setup")}>
          Da configurare
        </Button>
        <Button size="sm" variant="outline" onClick={() => onStatus("inactive")}>
          <PowerOff className="mr-1 h-3 w-3" /> Disattiva
        </Button>
        <Button size="sm" variant="outline" onClick={onManualCheck}>
          <ShieldCheck className="mr-1 h-3 w-3" /> Verificato
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          <Trash2 className="h-3 w-3 text-red-500" />
        </Button>
      </div>
    </div>
  );
}

const STATUS_OPTIONS: ToolStatus[] = [
  "connected",
  "missing",
  "needs_setup",
  "inactive",
  "broken",
  "unknown",
];
const CT_OPTIONS: ConnectionType[] = [
  "link_only",
  "api_key_required",
  "oauth_required",
  "manual_workflow",
  "browser_bridge",
  "future_integration",
  "external_app",
  "custom",
];
const CAT_OPTIONS = Object.keys(TOOL_CATEGORY_LABEL) as ToolCategory[];

function ToolDialog({
  open,
  brainId,
  existing,
  initialName,
  onClose,
  onSaved,
}: {
  open: boolean;
  brainId: string;
  existing?: ToolLink;
  initialName?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!existing;
  const catalog = useMemo(() => TOOL_CATALOG.find((c) => c.name === (existing?.tool_name ?? initialName)), [existing, initialName]);

  const [name, setName] = useState("");
  const [category, setCategory] = useState<ToolCategory>("custom");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<ToolStatus>("missing");
  const [ctype, setCtype] = useState<ConnectionType>("link_only");
  const [required, setRequired] = useState(false);
  const [recommended, setRecommended] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setName(existing.tool_name);
      setCategory((existing.tool_category as ToolCategory) ?? "custom");
      setUrl(existing.url ?? "");
      setStatus(normalizeStatus(existing.connection_status));
      setCtype(((existing.connection_type as ConnectionType) ?? "link_only"));
      setRequired(existing.is_required);
      setRecommended(existing.is_recommended);
      setNotes(existing.notes ?? "");
    } else {
      const preset = catalog;
      setName(initialName ?? preset?.name ?? "");
      setCategory(preset?.category ?? "custom");
      setUrl(preset?.default_url ?? "");
      setStatus("missing");
      setCtype(preset?.default_connection_type ?? "link_only");
      setRequired(false);
      setRecommended(!!initialName);
      setNotes("");
    }
  }, [open, existing, initialName, catalog]);

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Il nome del tool è obbligatorio");
      return;
    }
    setSaving(true);
    try {
      if (existing) {
        await updateToolLink(
          existing.id,
          {
            tool_name: name.trim(),
            tool_category: category,
            url: url.trim() || null,
            connection_status: status,
            connection_type: ctype,
            is_required: required,
            is_recommended: recommended,
            notes: notes.trim() || null,
          },
          existing,
        );
      } else {
        await createToolLink({
          brain_id: brainId,
          tool_name: name.trim(),
          tool_category: category,
          url: url.trim() || null,
          connection_status: status,
          connection_type: ctype,
          is_required: required,
          is_recommended: recommended,
          notes: notes.trim() || null,
        });
      }
      toast.success(isEdit ? "Tool aggiornato" : "Tool aggiunto");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore salvataggio");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Modifica tool" : "Aggiungi tool"}</DialogTitle>
          <DialogDescription>
            Nessuna API key viene salvata. Solo metadati di collegamento.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nome tool</Label>
            {isEdit ? (
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            ) : (
              <Select value={name} onValueChange={(v) => {
                setName(v);
                const c = TOOL_CATALOG.find((t) => t.name === v);
                if (c) {
                  setCategory(c.category);
                  setCtype(c.default_connection_type);
                  if (c.default_url && !url) setUrl(c.default_url);
                }
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona o digita…" />
                </SelectTrigger>
                <SelectContent>
                  {TOOL_CATALOG.map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {!isEdit && (
              <Input
                className="mt-2"
                placeholder="…oppure nome custom"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Categoria</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as ToolCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CAT_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {TOOL_CATEGORY_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Tipo collegamento</Label>
              <Select value={ctype} onValueChange={(v) => setCtype(v as ConnectionType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CT_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CONNECTION_TYPE_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">URL</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div>
            <Label className="text-xs">Stato</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ToolStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {TOOL_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={required} onCheckedChange={setRequired} />
              Obbligatorio
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={recommended} onCheckedChange={setRecommended} />
              Consigliato
            </label>
          </div>
          <div>
            <Label className="text-xs">Note</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Promemoria, link doc, istruzioni…"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Annulla
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvataggio…" : isEdit ? "Salva" : "Aggiungi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Keep PRESET_RECOMMENDED_TOOLS export referenced to avoid tree-shake warnings on unused import.
void PRESET_RECOMMENDED_TOOLS;
