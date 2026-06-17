import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Archive,
  CheckCircle2,
  Copy as CopyIcon,
  ExternalLink,
  FileText,
  ListChecks,
  Sparkles,
} from "lucide-react";
import {
  BlueprintBundle,
  BlueprintContent,
  CompanyBlueprintRow,
  approveCompanyBlueprint,
  archiveCompanyBlueprint,
  copyCompanyBlueprint,
  createActionsFromBlueprint,
  generateCompanyBlueprint,
  listCompanyBlueprints,
  logCompanyBlueprintEvent,
  saveCompanyBlueprint,
} from "@/lib/company-blueprint";
import { getCompanyProfile } from "@/lib/company-os";

export const Route = createFileRoute("/_authenticated/company-blueprint")({
  head: () => ({
    meta: [
      { title: "Company Blueprint — Brain Hub" },
      {
        name: "description",
        content:
          "Genera il Blueprint operativo aziendale: fotografia, problemi, aree operative, tool, knowledge, piano 30/60/90.",
      },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    brain: typeof s.brain === "string" ? s.brain : undefined,
  }),
  component: CompanyBlueprintRoute,
});

type BrainRow = { id: string; name: string };

function CompanyBlueprintRoute() {
  const { brain } = useSearch({ from: "/_authenticated/company-blueprint" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [brainId, setBrainId] = useState<string>(brain ?? "");
  const [bundle, setBundle] = useState<BlueprintBundle | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    void logCompanyBlueprintEvent("company_blueprint_viewed", "Pagina Company Blueprint aperta", {
      brain_id: brainId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: brains = [] } = useQuery({
    queryKey: ["brains-min-blueprint"],
    queryFn: async (): Promise<BrainRow[]> => {
      const { data, error } = await supabase.from("brains").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as BrainRow[];
    },
  });

  useEffect(() => {
    if (!brainId && brains.length > 0) setBrainId(brains[0].id);
  }, [brains, brainId]);

  useEffect(() => {
    if (brainId && brainId !== brain) {
      void navigate({
        to: "/company-blueprint",
        search: { brain: brainId },
        replace: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brainId]);

  const { data: profile } = useQuery({
    queryKey: ["company-os-profile-blueprint", brainId],
    enabled: !!brainId,
    queryFn: () => getCompanyProfile(brainId),
  });

  const { data: blueprints = [], refetch: refetchList } = useQuery({
    queryKey: ["company-blueprints", brainId],
    enabled: !!brainId,
    queryFn: () => listCompanyBlueprints(brainId),
  });

  const activeRow: CompanyBlueprintRow | null = activeId
    ? blueprints.find((b) => b.id === activeId) ?? null
    : null;

  const currentContent: BlueprintContent | null = bundle?.content ?? activeRow?.blueprint_json ?? null;
  const currentMarkdown: string = bundle?.markdown ?? activeRow?.markdown_content ?? "";
  const currentTitle: string = bundle?.title ?? activeRow?.title ?? "Blueprint operativo aziendale";

  async function handleGenerate() {
    if (!brainId) return;
    setIsGenerating(true);
    try {
      const b = await generateCompanyBlueprint(brainId);
      if (!b.profile || !b.content) {
        toast.error("Profilo Company OS non configurato per questo brain.");
        return;
      }
      setBundle(b);
      setActiveId(null);
      void logCompanyBlueprintEvent("company_blueprint_generated", "Blueprint generato", {
        brain_id: brainId,
      });
      toast.success("Blueprint generato.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSave() {
    if (!brainId || !bundle) return;
    const saved = await saveCompanyBlueprint(brainId, bundle, "generated");
    if (!saved) {
      toast.error("Impossibile salvare il blueprint.");
      return;
    }
    await refetchList();
    setActiveId(saved.id);
    setBundle(null);
    void logCompanyBlueprintEvent("company_blueprint_saved", "Snapshot blueprint salvato", {
      blueprint_id: saved.id,
      brain_id: brainId,
    });
    toast.success("Snapshot salvato.");
  }

  async function handleCopy() {
    let md = currentMarkdown;
    if (!md && activeRow) md = await copyCompanyBlueprint(activeRow.id);
    if (!md) {
      toast.error("Nessun contenuto da copiare.");
      return;
    }
    await navigator.clipboard.writeText(md);
    void logCompanyBlueprintEvent("company_blueprint_copied", "Blueprint copiato negli appunti", {
      blueprint_id: activeRow?.id ?? null,
    });
    toast.success("Blueprint copiato.");
  }

  async function handleApprove() {
    if (!activeRow) return;
    const ok = await approveCompanyBlueprint(activeRow.id);
    if (!ok) {
      toast.error("Errore approvazione.");
      return;
    }
    await refetchList();
    void logCompanyBlueprintEvent("company_blueprint_approved", "Blueprint approvato", {
      blueprint_id: activeRow.id,
    });
    toast.success("Blueprint approvato.");
  }

  async function handleArchive() {
    if (!activeRow) return;
    const ok = await archiveCompanyBlueprint(activeRow.id);
    if (!ok) {
      toast.error("Errore archiviazione.");
      return;
    }
    await refetchList();
    void logCompanyBlueprintEvent("company_blueprint_archived", "Blueprint archiviato", {
      blueprint_id: activeRow.id,
    });
    toast.success("Blueprint archiviato.");
  }

  async function handleCreateActions() {
    if (!activeRow) return;
    const n = await createActionsFromBlueprint(activeRow.id);
    void logCompanyBlueprintEvent(
      "company_blueprint_actions_created",
      `Action create dal Blueprint: ${n}`,
      { blueprint_id: activeRow.id, count: n },
    );
    void qc.invalidateQueries({ queryKey: ["action-queue"] });
    if (n === 0) {
      toast.info("Nessuna action creata.");
    } else {
      toast.success(`Create ${n} action consigliate.`);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Company Blueprint"
        subtitle="Trasforma il Company OS in un blueprint operativo aziendale: chiaro, leggibile, vendibile."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select value={brainId} onValueChange={setBrainId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Seleziona un brain" />
          </SelectTrigger>
          <SelectContent>
            {brains.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge
          variant="outline"
          className={
            profile
              ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
              : "bg-amber-500/10 text-amber-600 border-amber-500/30"
          }
        >
          Company OS: {profile ? "configurato" : "non configurato"}
        </Badge>
        <Button onClick={handleGenerate} disabled={!brainId || !profile || isGenerating}>
          <Sparkles className="mr-1 h-4 w-4" />
          {isGenerating ? "Generazione…" : "Genera Blueprint"}
        </Button>
        <Button asChild variant="outline">
          <Link to="/company-os" search={{}}>
            <ExternalLink className="mr-1 h-3 w-3" />
            Apri Company OS
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/action-queue" search={{}}>
            <ListChecks className="mr-1 h-3 w-3" />
            Apri Action Queue
          </Link>
        </Button>
      </div>

      {!profile && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            Per generare un blueprint, configura prima il profilo aziendale in{" "}
            <Link to="/company-os" search={{}} className="underline">
              Company OS
            </Link>
            .
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" /> Blueprint salvati
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {blueprints.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nessun blueprint salvato.</p>
            ) : (
              blueprints.map((b) => (
                <button
                  key={b.id}
                  onClick={() => {
                    setActiveId(b.id);
                    setBundle(null);
                  }}
                  className={`block w-full rounded border p-2 text-left text-xs hover:bg-muted/40 ${
                    activeId === b.id ? "border-primary bg-muted/30" : ""
                  }`}
                >
                  <div className="truncate font-medium">{b.title}</div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{new Date(b.created_at).toLocaleString()}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {b.blueprint_status}
                    </Badge>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-3">
          {currentContent ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                    <span>{currentTitle}</span>
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="outline" onClick={handleCopy}>
                        <CopyIcon className="mr-1 h-3 w-3" /> Copia Blueprint
                      </Button>
                      {bundle && (
                        <Button size="sm" onClick={handleSave}>
                          Salva Snapshot
                        </Button>
                      )}
                      {activeRow && activeRow.blueprint_status !== "approved" && (
                        <Button size="sm" variant="outline" onClick={handleApprove}>
                          <CheckCircle2 className="mr-1 h-3 w-3" /> Approva
                        </Button>
                      )}
                      {activeRow && activeRow.blueprint_status !== "archived" && (
                        <Button size="sm" variant="outline" onClick={handleArchive}>
                          <Archive className="mr-1 h-3 w-3" /> Archivia
                        </Button>
                      )}
                      {activeRow && (
                        <Button size="sm" variant="outline" onClick={handleCreateActions}>
                          <ListChecks className="mr-1 h-3 w-3" /> Crea action dal Blueprint
                        </Button>
                      )}
                    </div>
                  </CardTitle>
                </CardHeader>
              </Card>

              <BlueprintPreview content={currentContent} />
            </>
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                Nessun blueprint attivo. Genera un nuovo blueprint o seleziona uno snapshot salvato.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">{children}</CardContent>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-wrap gap-1">
      <span className="text-muted-foreground">{k}:</span>
      <span className="font-medium">{v || "—"}</span>
    </div>
  );
}

function BlueprintPreview({ content }: { content: BlueprintContent }) {
  return (
    <>
      <Section title="Executive Summary">
        <Row k="Azienda" v={content.executiveSummary.companyName} />
        <Row k="Settore" v={content.executiveSummary.industry} />
        <Row k="Obiettivo principale" v={content.executiveSummary.mainGoal} />
        <Row k="Fotografia operativa" v={content.executiveSummary.operatingSnapshot} />
        <Row k="Principale criticità" v={content.executiveSummary.mainCriticality} />
        <Row k="Promessa Brain Hub" v={content.executiveSummary.brainHubPromise} />
      </Section>

      <Section title="Company Snapshot">
        <Row k="Dimensione" v={content.companySnapshot.size} />
        <Row k="Modello operativo" v={content.companySnapshot.operatingModel} />
        <div className="flex flex-wrap gap-1">
          {content.companySnapshot.activeAreas.map((a) => (
            <Badge key={a} variant="outline">
              {a}
            </Badge>
          ))}
        </div>
        <Row k="Preset" v={content.companySnapshot.preset ?? "—"} />
        <div className="flex flex-wrap gap-1">
          {content.companySnapshot.recommendedModules.map((m) => (
            <Badge key={m} variant="secondary">
              {m}
            </Badge>
          ))}
        </div>
      </Section>

      <Section title="Problemi rilevati">
        {content.problems.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nessun problema selezionato.</p>
        ) : (
          content.problems.map((p) => (
            <div key={p.id} className="rounded border p-2">
              <div className="text-sm font-semibold">{p.problem}</div>
              <div className="text-xs text-muted-foreground">{p.impact}</div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">{p.module}</Badge>
                <span className="text-muted-foreground">Prima azione: {p.firstAction}</span>
              </div>
            </div>
          ))
        )}
      </Section>

      <Section title="Aree operative">
        {content.departments.map((d) => (
          <div key={d.id} className="rounded border p-2">
            <div className="text-sm font-semibold">{d.label}</div>
            <Row k="Obiettivo" v={d.goal} />
            <Row k="Monitorare" v={d.monitor} />
            <Row k="Strumenti" v={d.recommendedTools.join(", ")} />
            <Row k="Runbook" v={d.recommendedRunbook} />
            <Row k="Prima action" v={d.firstAction} />
          </div>
        ))}
      </Section>

      <Section title="Tool Map">
        <Row
          k="Collegati"
          v={content.toolMap.connected.map((t) => `${t.name} (${t.status})`).join(", ")}
        />
        <Row k="Consigliati" v={content.toolMap.recommended.join(", ")} />
        <Row k="Mancanti" v={content.toolMap.missing.join(", ")} />
        <Row k="Priorità di collegamento" v={content.toolMap.priorityConnections.join(", ")} />
      </Section>

      <Section title="Knowledge Map Setup">
        <Row
          k="Già presente"
          v={content.knowledge.existing.map((k) => k.title).join(", ")}
        />
        <Row k="Da caricare" v={content.knowledge.toUpload.join(", ")} />
        <Row k="Categorie" v={content.knowledge.categories.join(", ")} />
      </Section>

      <Section title="Automation Readiness">
        <Row k="Possibili" v={content.automation.possible.join(", ")} />
        <Row k="Da NON fare subito" v={content.automation.doNotYet.join(", ")} />
        <Row k="Con approvazione" v={content.automation.needsApproval.join(", ")} />
        <Row k="Livello rischio" v={content.automation.riskLevel} />
      </Section>

      <Section title="Piano operativo 30 / 60 / 90 giorni">
        <div className="grid gap-2 md:grid-cols-3">
          <div>
            <div className="text-xs font-semibold uppercase">30 giorni</div>
            <ul className="ml-4 list-disc text-xs">
              {content.plan.thirty.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase">60 giorni</div>
            <ul className="ml-4 list-disc text-xs">
              {content.plan.sixty.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase">90 giorni</div>
            <ul className="ml-4 list-disc text-xs">
              {content.plan.ninety.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section title="Prossime azioni consigliate">
        {content.nextActions.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nessuna azione consigliata.</p>
        ) : (
          content.nextActions.map((a, i) => (
            <div key={i} className="rounded border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-semibold">{a.title}</div>
                <Badge variant="outline">{a.department}</Badge>
                <Badge variant="outline">priorità {a.priority}</Badge>
                <Badge variant="outline">rischio {a.risk_level}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">{a.reason}</div>
            </div>
          ))
        )}
        <div className="pt-2">
          <Button asChild size="sm" variant="outline">
            <Link
              to="/build-engines"
              search={{}}
              onClick={() => {
                void import("@/lib/build-engines").then((m) =>
                  m.logBuildEngineEvent(
                    "build_engine_opened_from_company_blueprint",
                    "Apertura Build Engines da Company Blueprint",
                  ),
                );
              }}
            >
              Prepara con Build Engine
            </Link>
          </Button>
        </div>
      </Section>

      <Section title="Conclusione">
        <Row k="Brain Hub controlla" v={content.conclusion.controlled} />
        <Row k="Cosa configurare" v={content.conclusion.toConfigure} />
        <Row k="Prossimo passo" v={content.conclusion.nextStep} />
      </Section>
    </>
  );
}
