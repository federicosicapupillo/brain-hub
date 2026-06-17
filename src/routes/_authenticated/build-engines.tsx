import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Checkbox } from "@/components/ui/checkbox";
import { ExternalLink, Wand2, Copy, CheckCircle2, Cpu } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  BuildEngine,
  BuildEngineHandoff,
  CONNECTION_MODE_LABEL,
  ENGINE_TYPE_LABEL,
  STATUS_LABEL,
  TASK_TYPE_LABEL,
  TaskType,
  RiskLevel,
  RouterInput,
  buildEnginePrompt,
  createBuildEngineHandoff,
  getBuildEngine,
  listBuildEngines,
  listBuildEngineHandoffs,
  logBuildEngineEvent,
  scoreBuildEngines,
  updateHandoffStatus,
} from "@/lib/build-engines";
import { createAction } from "@/lib/action-queue";
import { createReviewItem } from "@/lib/result-review";

export const Route = createFileRoute("/_authenticated/build-engines")({
  head: () => ({
    meta: [
      { title: "Build Engines — Brain Hub" },
      {
        name: "description",
        content:
          "Routing tool-agnostic dei task verso Lovable, Claude Code, Codex, Cursor, v0 e altri motori di sviluppo.",
      },
    ],
  }),
  component: BuildEnginesPage,
});

type Brain = { id: string; name: string };

function BuildEnginesPage() {
  const qc = useQueryClient();
  const [brainId, setBrainId] = useState<string | null>(null);

  useEffect(() => {
    void logBuildEngineEvent("build_engines_viewed", "Apertura Build Engines");
  }, []);

  const { data: brains = [] } = useQuery({
    queryKey: ["build-engines-brains"],
    queryFn: async (): Promise<Brain[]> => {
      const { data } = await supabase
        .from("brains")
        .select("id,name")
        .order("name", { ascending: true });
      return (data ?? []) as Brain[];
    },
  });

  useEffect(() => {
    if (!brainId && brains.length > 0) setBrainId(brains[0].id);
  }, [brains, brainId]);

  const { data: engines = [] } = useQuery({
    queryKey: ["build-engines", brainId],
    queryFn: () => listBuildEngines(brainId),
  });

  const { data: handoffs = [] } = useQuery({
    queryKey: ["build-engine-handoffs", brainId],
    queryFn: () => listBuildEngineHandoffs(brainId),
  });

  // ---- Router form state ----
  const [form, setForm] = useState<RouterInput>({
    brain_id: null,
    task_title: "",
    task_description: "",
    task_type: "new_mvp",
    complexity: "medium",
    needs_backend: false,
    needs_database: false,
    needs_existing_codebase: false,
    needs_ui: true,
    needs_deploy: false,
    risk_level: "low",
    preferred_engine: null,
  });

  useEffect(() => {
    setForm((f) => ({ ...f, brain_id: brainId }));
  }, [brainId]);

  const scored = useMemo(
    () => (form.task_title.trim() ? scoreBuildEngines(form, engines) : []),
    [form, engines],
  );
  const top = scored[0] ?? null;
  const previewPrompt = useMemo(
    () => (top ? buildEnginePrompt(top.engine_key, form) : ""),
    [top, form],
  );

  const onSuggest = async () => {
    if (!form.task_title.trim()) {
      toast.error("Inserisci un titolo task");
      return;
    }
    await logBuildEngineEvent("build_engine_recommended", `Suggerito: ${top?.engine_key ?? "n/a"}`, {
      engine_key: top?.engine_key,
      task_type: form.task_type,
    });
    toast.success(top ? `Consigliato: ${top.engine_name}` : "Nessun engine consigliato");
  };

  const onCreateHandoff = async (engineKey: string) => {
    try {
      const handoff = await createBuildEngineHandoff({
        brain_id: brainId,
        engine_key: engineKey,
        task_type: form.task_type,
        title: form.task_title || "Handoff senza titolo",
        description: form.task_description,
        router_input: form,
        risk_level: form.risk_level ?? null,
        metadata: { source: "build_engine_router" },
      });
      await updateHandoffStatus(handoff.id, "ready");
      void qc.invalidateQueries({ queryKey: ["build-engine-handoffs"] });
      toast.success(`Handoff creato per ${engineKey}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore creazione handoff");
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Build Engines"
        description="Scegli il motore migliore per ogni task. Routing manuale e controllato."
        icon={Cpu}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Label className="text-xs">Brain</Label>
          <Select value={brainId ?? ""} onValueChange={(v) => setBrainId(v || null)}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Seleziona brain" /></SelectTrigger>
            <SelectContent>
              {brains.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto text-xs text-muted-foreground">
            {engines.length} motori · {handoffs.length} handoff
          </div>
        </CardContent>
      </Card>

      {/* Router */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wand2 className="h-4 w-4" /> Scegli il motore migliore
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Titolo task</Label>
              <Input
                value={form.task_title}
                onChange={(e) => setForm({ ...form, task_title: e.target.value })}
                placeholder="Es. Nuova dashboard analytics"
              />
            </div>
            <div className="space-y-1">
              <Label>Tipo task</Label>
              <Select
                value={form.task_type}
                onValueChange={(v) => setForm({ ...form, task_type: v as TaskType })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TASK_TYPE_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Descrizione</Label>
            <Textarea
              value={form.task_description ?? ""}
              onChange={(e) => setForm({ ...form, task_description: e.target.value })}
              rows={3}
              placeholder="Cosa deve fare il task, vincoli, dipendenze..."
            />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Complessità</Label>
              <Select
                value={form.complexity ?? "medium"}
                onValueChange={(v) => setForm({ ...form, complexity: v as "low" | "medium" | "high" })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Bassa</SelectItem>
                  <SelectItem value="medium">Media</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Rischio</Label>
              <Select
                value={form.risk_level ?? "low"}
                onValueChange={(v) => setForm({ ...form, risk_level: v as RiskLevel })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Basso</SelectItem>
                  <SelectItem value="medium">Medio</SelectItem>
                  <SelectItem value="high">Alto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Engine preferito</Label>
              <Select
                value={form.preferred_engine ?? "__none"}
                onValueChange={(v) => setForm({ ...form, preferred_engine: v === "__none" ? null : v })}
              >
                <SelectTrigger><SelectValue placeholder="Nessuno" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Nessuno</SelectItem>
                  {engines.map((e) => (
                    <SelectItem key={e.engine_key} value={e.engine_key}>{e.engine_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            {[
              { k: "needs_ui", l: "Serve UI" },
              { k: "needs_backend", l: "Serve backend" },
              { k: "needs_database", l: "Serve database" },
              { k: "needs_existing_codebase", l: "Codebase esistente" },
              { k: "needs_deploy", l: "Serve deploy" },
            ].map((c) => (
              <label key={c.k} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={(form as unknown as Record<string, boolean>)[c.k] ?? false}
                  onCheckedChange={(v) =>
                    setForm({ ...form, [c.k]: !!v } as RouterInput)
                  }
                />
                {c.l}
              </label>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={onSuggest}><Wand2 className="mr-2 h-4 w-4" /> Suggerisci motore</Button>
            {top && (
              <Button variant="outline" onClick={() => onCreateHandoff(top.engine_key)}>
                Crea handoff per {top.engine_name}
              </Button>
            )}
          </div>

          {scored.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Perché questo motore
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {scored.slice(0, 4).map((s, i) => (
                  <div key={s.engine_key} className={`rounded border p-3 ${i === 0 ? "border-primary" : ""}`}>
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{s.engine_name}</div>
                      <Badge variant="outline">score {s.score}</Badge>
                    </div>
                    {s.reasons.length > 0 && (
                      <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                        {s.reasons.map((r, j) => (<li key={j}>{r}</li>))}
                      </ul>
                    )}
                    {s.warnings.length > 0 && (
                      <ul className="mt-1 list-disc pl-4 text-xs text-amber-600">
                        {s.warnings.map((r, j) => (<li key={j}>⚠ {r}</li>))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {top && previewPrompt && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Prompt per il motore
              </div>
              <Textarea readOnly value={previewPrompt} rows={10} className="font-mono text-xs" />
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(previewPrompt);
                  await logBuildEngineEvent("build_engine_handoff_copied", "Prompt copiato (preview)", {
                    engine_key: top.engine_key,
                  });
                  toast.success("Prompt copiato");
                }}
              >
                <Copy className="mr-2 h-4 w-4" /> Copia prompt
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Engine cards */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {engines.map((e) => (
          <EngineCard
            key={e.engine_key}
            engine={e}
            onUse={() => setForm({ ...form, preferred_engine: e.engine_key })}
          />
        ))}
      </div>

      {/* Handoffs list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Handoff recenti</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {handoffs.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nessun handoff ancora.</p>
          ) : (
            handoffs.map((h) => <HandoffRow key={h.id} handoff={h} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EngineCard({ engine, onUse }: { engine: BuildEngine; onUse: () => void }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span>{engine.engine_name}</span>
          <Badge variant="outline">{STATUS_LABEL[engine.status]}</Badge>
        </CardTitle>
        <div className="flex flex-wrap gap-1 text-[11px]">
          <Badge variant="secondary">{ENGINE_TYPE_LABEL[engine.engine_type]}</Badge>
          <Badge variant="outline">{CONNECTION_MODE_LABEL[engine.connection_mode]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div>
          <div className="font-semibold">Best for</div>
          <ul className="list-disc pl-4 text-muted-foreground">
            {engine.best_for.map((b, i) => (<li key={i}>{b}</li>))}
          </ul>
        </div>
        <div>
          <div className="font-semibold">Limiti</div>
          <ul className="list-disc pl-4 text-muted-foreground">
            {engine.limitations.map((b, i) => (<li key={i}>{b}</li>))}
          </ul>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={onUse}>Usa per un task</Button>
          {engine.tool_url && (
            <Button asChild size="sm" variant="ghost">
              <a href={engine.tool_url} target="_blank" rel="noopener noreferrer">
                Apri tool <ExternalLink className="ml-1 h-3 w-3" />
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function HandoffRow({ handoff }: { handoff: BuildEngineHandoff }) {
  const qc = useQueryClient();
  const engine = getBuildEngine(handoff.engine_key);
  const onCopy = async () => {
    await navigator.clipboard.writeText(handoff.generated_prompt);
    await updateHandoffStatus(handoff.id, "copied");
    await logBuildEngineEvent("build_engine_handoff_copied", `Prompt copiato: ${handoff.title}`, {
      handoff_id: handoff.id,
      engine_key: handoff.engine_key,
    });
    void qc.invalidateQueries({ queryKey: ["build-engine-handoffs"] });
    toast.success("Prompt copiato");
  };
  const onMarkSent = async () => {
    await updateHandoffStatus(handoff.id, "sent_manually");
    void qc.invalidateQueries({ queryKey: ["build-engine-handoffs"] });
    toast.success("Segnato come inviato");
  };
  const onMarkResult = async () => {
    await updateHandoffStatus(handoff.id, "result_received");
    void qc.invalidateQueries({ queryKey: ["build-engine-handoffs"] });
    toast.success("Risultato ricevuto");
  };
  const onCreateAction = async () => {
    try {
      await createAction({
        source: "system_suggestion",
        action_type: "manual_task",
        title: `Build Engine → ${engine?.engine_name ?? handoff.engine_key}: ${handoff.title}`,
        description: handoff.description ?? null,
        risk_level: (handoff.risk_level as RiskLevel) ?? "medium",
        priority: "medium",
        brain_id: handoff.brain_id ?? null,
        project_id: handoff.project_id ?? null,
        metadata: {
          source: "build_engine_router",
          action_type_alias: "build_engine_handoff",
          build_engine_handoff_id: handoff.id,
          engine_key: handoff.engine_key,
          task_type: handoff.task_type,
        },
      });
      await logBuildEngineEvent(
        "build_engine_action_created",
        `Action creata da handoff: ${handoff.title}`,
        { handoff_id: handoff.id, engine_key: handoff.engine_key },
      );
      toast.success("Action creata in Action Queue");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore creazione action");
    }
  };
  const onCreateReview = async () => {
    try {
      const review = await createReviewItem({
        source_type: "manual",
        title: `Result review: ${handoff.title}`,
        brain_id: handoff.brain_id ?? null,
        project_id: handoff.project_id ?? null,
        risk_level: handoff.risk_level ?? null,
        metadata: {
          source: "build_engine_router",
          source_type_alias: "build_engine_handoff",
          build_engine_handoff_id: handoff.id,
          engine_key: handoff.engine_key,
        },
      });
      await updateHandoffStatus(handoff.id, "reviewed");
      void qc.invalidateQueries({ queryKey: ["build-engine-handoffs"] });
      await logBuildEngineEvent(
        "build_engine_result_review_created",
        `Review creata da handoff: ${handoff.title}`,
        { handoff_id: handoff.id, review_id: review.id, engine_key: handoff.engine_key },
      );
      toast.success("Result Review creata");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore creazione review");
    }
  };

  return (
    <div className="space-y-2 rounded border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{handoff.title}</span>
        <Badge variant="outline">{engine?.engine_name ?? handoff.engine_key}</Badge>
        <Badge variant="outline">{handoff.task_type}</Badge>
        <Badge variant="outline">{handoff.handoff_status}</Badge>
        {handoff.risk_level && <Badge variant="outline">rischio {handoff.risk_level}</Badge>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onCopy}><Copy className="mr-1 h-3 w-3" /> Copia prompt</Button>
        <Button size="sm" variant="outline" onClick={onMarkSent}>Segna inviato manualmente</Button>
        <Button size="sm" variant="outline" onClick={onMarkResult}><CheckCircle2 className="mr-1 h-3 w-3" /> Risultato ricevuto</Button>
        <Button size="sm" variant="outline" onClick={onCreateAction}>Crea action da handoff</Button>
        <Button size="sm" variant="outline" onClick={onCreateReview}>Crea review risultato</Button>
      </div>
    </div>
  );
}
