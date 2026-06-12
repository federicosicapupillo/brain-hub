import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { RoadmapIntelligence } from "@/components/RoadmapIntelligence";
import { ProjectHealthCheck } from "@/components/ProjectHealthCheck";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Copy as CopyIcon,
  LayoutDashboard,
  RotateCcw,
  Save,
} from "lucide-react";
import {
  ALL_BLOCKS,
  BlockId,
  ConsoleConfig,
  PRESETS,
  PRIORITIES,
  defaultConfig,
  listConfigs,
  loadConfigForBrain,
  upsertConfig,
} from "@/lib/project-console";

export const Route = createFileRoute("/_authenticated/project-console")({
  head: () => ({
    meta: [
      { title: "Configurable Project Console — Brain Hub" },
      {
        name: "description",
        content:
          "Console configurabile per progetto/cervello: blocchi, ordine, priorità, preset e dashboard personalizzata.",
      },
    ],
  }),
  component: ProjectConsoleRoute,
});

type BrainRow = { id: string; name: string; color: string };

function ProjectConsoleRoute() {
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
  const { data: allConfigs = [] } = useQuery({
    queryKey: ["project-console-configs"],
    queryFn: listConfigs,
  });

  const [brainId, setBrainId] = useState<string>("");
  useEffect(() => {
    if (!brainId && brains.length > 0) setBrainId(brains[0].id);
  }, [brains, brainId]);

  const { data: existing } = useQuery({
    queryKey: ["project-console-config", brainId],
    queryFn: () => (brainId ? loadConfigForBrain(brainId) : Promise.resolve(null)),
    enabled: !!brainId,
  });

  const [draft, setDraft] = useState<ConsoleConfig>(() => defaultConfig(null));
  useEffect(() => {
    if (!brainId) return;
    setDraft(existing ?? defaultConfig(brainId));
  }, [existing, brainId]);

  const visibleSet = useMemo(() => new Set(draft.visible_blocks), [draft.visible_blocks]);
  const orderedBlocks = useMemo(() => {
    const seen = new Set<BlockId>();
    const out: BlockId[] = [];
    for (const b of draft.block_order) {
      if (visibleSet.has(b) && !seen.has(b)) {
        out.push(b);
        seen.add(b);
      }
    }
    for (const b of draft.visible_blocks) {
      if (!seen.has(b)) {
        out.push(b);
        seen.add(b);
      }
    }
    return out;
  }, [draft.block_order, draft.visible_blocks, visibleSet]);

  function toggleBlock(id: BlockId, on: boolean) {
    setDraft((d) => {
      const next = new Set(d.visible_blocks);
      if (on) next.add(id);
      else next.delete(id);
      const visible = ALL_BLOCKS.map((b) => b.id).filter((b) => next.has(b));
      const order = d.block_order.filter((b) => next.has(b));
      for (const v of visible) if (!order.includes(v)) order.push(v);
      return { ...d, visible_blocks: visible, block_order: order };
    });
  }

  function move(id: BlockId, dir: -1 | 1) {
    setDraft((d) => {
      const arr = [...orderedBlocks];
      const i = arr.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return d;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...d, block_order: arr };
    });
  }

  function applyPreset(key: string) {
    const p = PRESETS[key];
    if (!p) return;
    setDraft((d) => ({
      ...d,
      preset: key,
      project_priority: p.priority,
      visible_blocks: [...p.blocks],
      block_order: [...p.blocks],
    }));
  }

  async function handleSave() {
    if (!brainId) {
      toast.error("Seleziona un progetto");
      return;
    }
    try {
      await upsertConfig({
        brain_id: brainId,
        console_name: draft.console_name || "Console",
        preset: draft.preset,
        project_priority: draft.project_priority,
        visible_blocks: draft.visible_blocks,
        block_order: draft.block_order,
      });
      toast.success("Configurazione salvata");
      qc.invalidateQueries({ queryKey: ["project-console-config", brainId] });
      qc.invalidateQueries({ queryKey: ["project-console-configs"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore salvataggio");
    }
  }

  function handleReset() {
    applyPreset(draft.preset || "sviluppo_app");
    toast("Preset ripristinato (non salvato)");
  }

  async function handleDuplicateFrom(sourceBrainId: string) {
    const src = allConfigs.find((c) => c.brain_id === sourceBrainId);
    if (!src) return;
    setDraft((d) => ({
      ...d,
      preset: src.preset,
      project_priority: src.project_priority,
      visible_blocks: [...src.visible_blocks],
      block_order: [...src.block_order],
    }));
    toast("Configurazione importata (ricordati di salvare)");
  }

  return (
    <div className="min-h-[calc(100vh-3rem)] p-4 lg:p-6 space-y-4">
      <PageHeader
        title="Configurable Project Console"
        subtitle="Configura cosa vedere per ogni progetto. Ogni cervello può avere una dashboard diversa."
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <LayoutDashboard className="h-4 w-4" /> Console configurabile
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={handleReset}>
              <RotateCcw className="mr-1 h-3 w-3" /> Ripristina preset
            </Button>
            <Button size="sm" onClick={handleSave}>
              <Save className="mr-1 h-3 w-3" /> Salva
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Progetto / cervello</label>
              <Select value={brainId} onValueChange={setBrainId}>
                <SelectTrigger><SelectValue placeholder="Seleziona…" /></SelectTrigger>
                <SelectContent>
                  {brains.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Nome console</label>
              <Input
                value={draft.console_name}
                onChange={(e) => setDraft((d) => ({ ...d, console_name: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Preset</label>
              <Select value={draft.preset} onValueChange={applyPreset}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PRESETS).map(([key, p]) => (
                    <SelectItem key={key} value={key}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Priorità progetto</label>
              <Select
                value={draft.project_priority}
                onValueChange={(v) => setDraft((d) => ({ ...d, project_priority: v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {allConfigs.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-background/40 p-2">
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <CopyIcon className="h-3 w-3" /> Duplica da:
              </span>
              {allConfigs
                .filter((c) => c.brain_id && c.brain_id !== brainId)
                .slice(0, 8)
                .map((c) => {
                  const name = brains.find((b) => b.id === c.brain_id)?.name ?? "—";
                  return (
                    <Button
                      key={c.id}
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[11px]"
                      onClick={() => handleDuplicateFrom(c.brain_id!)}
                    >
                      {name}
                    </Button>
                  );
                })}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-semibold text-muted-foreground">Blocchi visibili</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {ALL_BLOCKS.map((b) => (
                  <label
                    key={b.id}
                    className="flex items-start justify-between gap-2 rounded-md border border-border/60 bg-background/40 p-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm">{b.label}</div>
                      <div className="text-[11px] text-muted-foreground">{b.hint}</div>
                    </div>
                    <Switch
                      checked={visibleSet.has(b.id)}
                      onCheckedChange={(v) => toggleBlock(b.id, v)}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold text-muted-foreground">Ordine blocchi</div>
              {orderedBlocks.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  Nessun blocco attivo. Attiva almeno un blocco dalla colonna a sinistra.
                </div>
              ) : (
                <ol className="space-y-1">
                  {orderedBlocks.map((id, i) => {
                    const meta = ALL_BLOCKS.find((b) => b.id === id);
                    return (
                      <li
                        key={id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 px-2 py-1.5"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="outline" className="text-[10px]">{i + 1}</Badge>
                          <span className="truncate text-sm">{meta?.label ?? id}</span>
                        </div>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => move(id, -1)}>
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => move(id, 1)}>
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project Console — anteprima</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {orderedBlocks.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Nessun blocco selezionato. Configura la console qui sopra.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {orderedBlocks.map((id) => (
                <BlockPreview key={id} id={id} brainId={brainId} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BlockPreview({ id, brainId }: { id: BlockId; brainId: string }) {
  const meta = ALL_BLOCKS.find((b) => b.id === id);
  const empty = useEmptyStateLabel(id);
  if (id === "roadmap_intelligence" && brainId) {
    return (
      <div className="md:col-span-2">
        <RoadmapIntelligence brainId={brainId} />
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{meta?.label ?? id}</div>
        <Badge variant="secondary" className="text-[10px]">{id}</Badge>
      </div>
      <div className="text-[11px] text-muted-foreground">{meta?.hint}</div>
      <div className="mt-2 rounded border border-dashed border-border/70 p-3 text-center text-xs text-muted-foreground">
        {empty}
        {brainId ? "" : " · seleziona un progetto"}
      </div>
    </div>
  );
}

function useEmptyStateLabel(id: BlockId): string {
  switch (id) {
    case "roadmap":
    case "tasks":
    case "checklist_operative":
      return "Crea primo elemento";
    case "execution_tracking":
    case "next_prompt_generator":
      return "Genera primo prompt";
    case "browser_bridge":
      return "Avvia Browser Bridge da Automation Control";
    case "roadmap_intelligence":
    case "prossimo_step_consigliato":
      return "Nessun suggerimento disponibile";
    case "problemi_da_risolvere":
    case "build_status":
      return "Nessun problema rilevato";
    case "file_documenti":
      return "Collega una fonte";
    case "lead_contatti":
    case "annunci_immobili":
    case "opportunita":
      return "Importa dati";
    case "kpi":
      return "Nessun dato disponibile";
    case "log_attivita":
      return "Nessuna attività recente";
    default:
      return "Nessun dato disponibile";
  }
}
