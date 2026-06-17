import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Archive,
  CheckCircle2,
  Copy as CopyIcon,
  ListChecks,
  Rocket,
  Sparkles,
  Wand2,
} from "lucide-react";
import {
  MVP_STATUS_LABEL,
  MvpBuildProject,
  MvpInputConstraints,
  MvpInputFeatures,
  MvpInputIntegrations,
  MvpScope,
  approveMvpProject,
  archiveMvpProject,
  createActionsFromMvp,
  createBuildEngineHandoffFromMvp,
  createMvpProject,
  createResultReviewFromMvp,
  generateMvpSpec,
  getMvpProject,
  listMvpProjects,
  logMvpFactoryEvent,
  renderMvpMarkdown,
} from "@/lib/mvp-factory";

type MvpSearch = {
  brain?: string;
  source?: string;
  source_id?: string;
  title?: string;
  description?: string;
};

export const Route = createFileRoute("/_authenticated/mvp-factory")({
  head: () => ({
    meta: [
      { title: "MVP Factory — Brain Hub" },
      {
        name: "description",
        content:
          "Trasforma un'idea aziendale in un MVP strutturato pronto per Build Engine Router.",
      },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): MvpSearch => ({
    brain: typeof s.brain === "string" ? s.brain : undefined,
    source: typeof s.source === "string" ? s.source : undefined,
    source_id: typeof s.source_id === "string" ? s.source_id : undefined,
    title: typeof s.title === "string" ? s.title : undefined,
    description: typeof s.description === "string" ? s.description : undefined,
  }),
  component: MvpFactoryRoute,
});

const FEATURES: { key: keyof MvpInputFeatures; label: string }[] = [
  { key: "auth", label: "Login / Auth" },
  { key: "dashboard", label: "Dashboard" },
  { key: "clients", label: "Gestione clienti" },
  { key: "tasks", label: "Gestione attività" },
  { key: "documents", label: "Gestione documenti" },
  { key: "notifications", label: "Notifiche" },
  { key: "calendar", label: "Calendario" },
  { key: "payments", label: "Pagamenti" },
  { key: "chat", label: "Chat" },
  { key: "reports", label: "Report" },
  { key: "admin_area", label: "Area admin" },
  { key: "approval_workflow", label: "Workflow approvazione" },
  { key: "ai_assistant", label: "AI assistant" },
  { key: "automations", label: "Automazioni" },
];

const INTEGRATIONS: { key: keyof MvpInputIntegrations; label: string }[] = [
  { key: "gmail", label: "Gmail" },
  { key: "google_calendar", label: "Google Calendar" },
  { key: "google_drive", label: "Google Drive" },
  { key: "telegram", label: "Telegram" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "stripe", label: "Stripe" },
  { key: "supabase", label: "Supabase" },
  { key: "github", label: "GitHub" },
  { key: "n8n", label: "n8n" },
  { key: "crm", label: "CRM" },
  { key: "social", label: "Social" },
  { key: "none", label: "Nessuna per MVP" },
];

type BrainRow = { id: string; name: string };

function MvpFactoryRoute() {
  const search = useSearch({ from: "/_authenticated/mvp-factory" });
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [brainId, setBrainId] = useState<string>(search.brain ?? "");
  const [step, setStep] = useState<number>(1);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Wizard state
  const [title, setTitle] = useState(search.title ?? "");
  const [ideaSummary, setIdeaSummary] = useState(search.description ?? "");
  const [mainProblem, setMainProblem] = useState("");
  const [businessGoal, setBusinessGoal] = useState("");
  const [targetUsersText, setTargetUsersText] = useState("");
  const [dailyUsers, setDailyUsers] = useState("");
  const [approvers, setApprovers] = useState("");
  const [features, setFeatures] = useState<MvpInputFeatures>({
    auth: true,
    dashboard: true,
    clients: false,
    tasks: false,
    documents: false,
    notifications: false,
    calendar: false,
    payments: false,
    chat: false,
    reports: false,
    admin_area: true,
    approval_workflow: false,
    ai_assistant: false,
    automations: false,
  });
  const [integrations, setIntegrations] = useState<MvpInputIntegrations>({
    gmail: false,
    google_calendar: false,
    google_drive: false,
    telegram: false,
    whatsapp: false,
    stripe: false,
    supabase: true,
    github: false,
    n8n: false,
    crm: false,
    social: false,
    none: false,
  });
  const [dataEntitiesHint, setDataEntitiesHint] = useState("");
  const [constraints, setConstraints] = useState<MvpInputConstraints>({
    budget_time: "MVP rapido (2-4 settimane)",
    complexity: "medium",
    risk_level: "medium",
    sensitive_data: false,
    mobile_first: false,
    demo_commerciale: false,
    needs_public_deploy: false,
  });

  useEffect(() => {
    void logMvpFactoryEvent("mvp_factory_viewed", "Pagina MVP Factory aperta", {
      brain_id: brainId,
      source: search.source ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: brains = [] } = useQuery({
    queryKey: ["brains-min-mvpfactory"],
    queryFn: async (): Promise<BrainRow[]> => {
      const { data, error } = await supabase.from("brains").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as BrainRow[];
    },
  });

  useEffect(() => {
    if (!brainId && brains[0]) setBrainId(brains[0].id);
  }, [brains, brainId]);

  useEffect(() => {
    if (brainId && brainId !== search.brain) {
      void navigate({
        to: "/mvp-factory",
        search: { ...search, brain: brainId },
        replace: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brainId]);

  const { data: projects = [], refetch } = useQuery({
    queryKey: ["mvp-projects", brainId],
    queryFn: () => listMvpProjects({ brain_id: brainId || undefined }),
    enabled: !!brainId,
  });

  const { data: active } = useQuery({
    queryKey: ["mvp-project", activeId],
    enabled: !!activeId,
    queryFn: () => (activeId ? getMvpProject(activeId) : Promise.resolve(null)),
  });

  function toggleFeature(k: keyof MvpInputFeatures, v: boolean) {
    setFeatures((prev) => ({ ...prev, [k]: v }));
  }
  function toggleIntegration(k: keyof MvpInputIntegrations, v: boolean) {
    setIntegrations((prev) => ({ ...prev, [k]: v }));
  }

  async function handleCreateAndGenerate() {
    if (!title.trim() || !ideaSummary.trim()) {
      toast.error("Titolo e descrizione idea sono obbligatori.");
      return;
    }
    const targetUsers = targetUsersText
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const created = await createMvpProject({
        brain_id: brainId || null,
        title: title.trim(),
        idea_summary: ideaSummary.trim(),
        target_users: targetUsers,
        main_problem: mainProblem.trim() || null,
        value_proposition: businessGoal.trim() || null,
        features,
        integrations,
        constraints,
        daily_users: dailyUsers,
        approvers,
        business_goal: businessGoal,
        data_entities_hint: dataEntitiesHint,
        metadata: {
          source: search.source ?? null,
          source_id: search.source_id ?? null,
        },
      });
      const generated = await generateMvpSpec(created.id);
      const finalId = generated?.id ?? created.id;
      setActiveId(finalId);
      void refetch();
      toast.success("MVP creato e spec generata.");
      setStep(1);
    } catch (e) {
      toast.error("Errore creazione MVP.");
      // eslint-disable-next-line no-console
      console.error(e);
    }
  }

  async function handleRegenerate(id: string) {
    const updated = await generateMvpSpec(id);
    if (updated) {
      void qc.invalidateQueries({ queryKey: ["mvp-project", id] });
      void refetch();
      toast.success("Spec rigenerata.");
    }
  }
  async function handleApprove(id: string) {
    const ok = await approveMvpProject(id);
    if (ok) {
      void qc.invalidateQueries({ queryKey: ["mvp-project", id] });
      void refetch();
      toast.success("MVP approvato.");
    }
  }
  async function handleArchive(id: string) {
    const ok = await archiveMvpProject(id);
    if (ok) {
      void refetch();
      toast.success("MVP archiviato.");
    }
  }
  async function handleHandoff(id: string) {
    const h = await createBuildEngineHandoffFromMvp(id);
    if (h) {
      void qc.invalidateQueries({ queryKey: ["mvp-project", id] });
      toast.success("Handoff Build Engine creato.");
    } else {
      toast.error("Genera prima la spec.");
    }
  }
  async function handleActions(id: string) {
    const n = await createActionsFromMvp(id);
    if (n > 0) toast.success(`Create ${n} action.`);
    else toast.info("Nessuna action creata.");
  }
  async function handleReview(id: string) {
    const r = await createResultReviewFromMvp(id);
    if (r) toast.success("Result review creata.");
    else toast.error("Errore creazione review.");
  }
  async function handleCopy(p: MvpBuildProject) {
    await navigator.clipboard.writeText(renderMvpMarkdown(p));
    toast.success("Spec copiata.");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="MVP Factory"
        subtitle="Trasforma un'idea in MVP strutturato: brief, scope, dati, roadmap, handoff."
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
        <Badge variant="outline">{projects.length} MVP</Badge>
        <Button asChild size="sm" variant="outline">
          <Link to="/build-engines" search={{}}>
            <Rocket className="mr-1 h-3 w-3" /> Apri Build Engines
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to="/action-queue" search={{}}>
            <ListChecks className="mr-1 h-3 w-3" /> Action Queue
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">MVP salvati</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {projects.length === 0 && (
                <p className="text-xs text-muted-foreground">Nessun MVP. Compila il wizard a destra.</p>
              )}
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setActiveId(p.id)}
                  className={`block w-full rounded border p-2 text-left text-xs hover:bg-muted/40 ${
                    activeId === p.id ? "border-primary bg-muted/30" : ""
                  }`}
                >
                  <div className="truncate font-medium">{p.title}</div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{new Date(p.created_at).toLocaleDateString()}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {MVP_STATUS_LABEL[p.status]}
                    </Badge>
                  </div>
                  {p.recommended_engine && (
                    <div className="text-[10px] text-muted-foreground">→ {p.recommended_engine}</div>
                  )}
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {!active && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wand2 className="h-4 w-4" /> Wizard MVP — Step {step} / 7
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {step === 1 && (
                  <div className="space-y-3">
                    <div className="text-xs font-semibold text-muted-foreground">Idea</div>
                    <div>
                      <Label>Titolo MVP</Label>
                      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Es: CRM clienti immobiliari" />
                    </div>
                    <div>
                      <Label>Descrizione idea</Label>
                      <Textarea value={ideaSummary} onChange={(e) => setIdeaSummary(e.target.value)} placeholder="Voglio creare un'app per…" rows={3} />
                    </div>
                    <div>
                      <Label>Problema risolto</Label>
                      <Textarea value={mainProblem} onChange={(e) => setMainProblem(e.target.value)} rows={2} />
                    </div>
                    <div>
                      <Label>Obiettivo business / promessa</Label>
                      <Textarea value={businessGoal} onChange={(e) => setBusinessGoal(e.target.value)} rows={2} />
                    </div>
                  </div>
                )}
                {step === 2 && (
                  <div className="space-y-3">
                    <div className="text-xs font-semibold text-muted-foreground">Utenti</div>
                    <div>
                      <Label>Target utenti (separati da virgola)</Label>
                      <Input value={targetUsersText} onChange={(e) => setTargetUsersText(e.target.value)} placeholder="Es: agenti, clienti, admin" />
                    </div>
                    <div>
                      <Label>Chi usa l'app ogni giorno</Label>
                      <Input value={dailyUsers} onChange={(e) => setDailyUsers(e.target.value)} />
                    </div>
                    <div>
                      <Label>Chi approva / controlla</Label>
                      <Input value={approvers} onChange={(e) => setApprovers(e.target.value)} />
                    </div>
                  </div>
                )}
                {step === 3 && (
                  <div className="space-y-3">
                    <div className="text-xs font-semibold text-muted-foreground">Funzioni</div>
                    <div className="grid grid-cols-2 gap-2">
                      {FEATURES.map((f) => (
                        <label key={f.key} className="flex items-center gap-2 text-xs">
                          <Checkbox checked={features[f.key]} onCheckedChange={(v) => toggleFeature(f.key, !!v)} />
                          {f.label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {step === 4 && (
                  <div className="space-y-3">
                    <div className="text-xs font-semibold text-muted-foreground">Dati</div>
                    <div>
                      <Label>Entità principali (lista, separate da virgola)</Label>
                      <Textarea
                        value={dataEntitiesHint}
                        onChange={(e) => setDataEntitiesHint(e.target.value)}
                        placeholder="es: clienti, progetti, task, documenti"
                        rows={3}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={constraints.sensitive_data}
                        onCheckedChange={(v) => setConstraints((c) => ({ ...c, sensitive_data: !!v }))}
                      />
                      Dati sensibili
                    </label>
                  </div>
                )}
                {step === 5 && (
                  <div className="space-y-3">
                    <div className="text-xs font-semibold text-muted-foreground">Integrazioni</div>
                    <div className="grid grid-cols-2 gap-2">
                      {INTEGRATIONS.map((i) => (
                        <label key={i.key} className="flex items-center gap-2 text-xs">
                          <Checkbox checked={integrations[i.key]} onCheckedChange={(v) => toggleIntegration(i.key, !!v)} />
                          {i.label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {step === 6 && (
                  <div className="space-y-3">
                    <div className="text-xs font-semibold text-muted-foreground">Vincoli</div>
                    <div>
                      <Label>Budget / tempo</Label>
                      <Input
                        value={constraints.budget_time}
                        onChange={(e) => setConstraints((c) => ({ ...c, budget_time: e.target.value }))}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label>Complessità</Label>
                        <Select
                          value={constraints.complexity}
                          onValueChange={(v) =>
                            setConstraints((c) => ({ ...c, complexity: v as "low" | "medium" | "high" }))
                          }
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Bassa</SelectItem>
                            <SelectItem value="medium">Media</SelectItem>
                            <SelectItem value="high">Alta</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Rischio</Label>
                        <Select
                          value={constraints.risk_level}
                          onValueChange={(v) =>
                            setConstraints((c) => ({ ...c, risk_level: v as "low" | "medium" | "high" }))
                          }
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Basso</SelectItem>
                            <SelectItem value="medium">Medio</SelectItem>
                            <SelectItem value="high">Alto</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex items-center gap-2 text-xs">
                        <Checkbox checked={constraints.mobile_first} onCheckedChange={(v) => setConstraints((c) => ({ ...c, mobile_first: !!v }))} />
                        Mobile first
                      </label>
                      <label className="flex items-center gap-2 text-xs">
                        <Checkbox checked={constraints.demo_commerciale} onCheckedChange={(v) => setConstraints((c) => ({ ...c, demo_commerciale: !!v }))} />
                        Demo commerciale
                      </label>
                      <label className="flex items-center gap-2 text-xs">
                        <Checkbox checked={constraints.needs_public_deploy} onCheckedChange={(v) => setConstraints((c) => ({ ...c, needs_public_deploy: !!v }))} />
                        Deploy pubblico
                      </label>
                      <label className="flex items-center gap-2 text-xs">
                        <Checkbox checked={constraints.sensitive_data} onCheckedChange={(v) => setConstraints((c) => ({ ...c, sensitive_data: !!v }))} />
                        Dati sensibili
                      </label>
                    </div>
                  </div>
                )}
                {step === 7 && (
                  <div className="space-y-3 text-sm">
                    <div className="text-xs font-semibold text-muted-foreground">Riepilogo</div>
                    <div className="rounded border p-3 text-xs space-y-1">
                      <div><span className="text-muted-foreground">Titolo:</span> {title || "—"}</div>
                      <div><span className="text-muted-foreground">Idea:</span> {ideaSummary || "—"}</div>
                      <div><span className="text-muted-foreground">Target:</span> {targetUsersText || "—"}</div>
                      <div><span className="text-muted-foreground">Complessità:</span> {constraints.complexity} · rischio {constraints.risk_level}</div>
                    </div>
                    <Button onClick={handleCreateAndGenerate} className="w-full" disabled={!brainId}>
                      <Sparkles className="mr-1 h-4 w-4" /> Genera MVP Spec
                    </Button>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <Button variant="outline" size="sm" disabled={step === 1} onClick={() => setStep((s) => s - 1)}>
                    Indietro
                  </Button>
                  <div className="text-xs text-muted-foreground">Step {step} / 7</div>
                  <Button size="sm" disabled={step === 7} onClick={() => setStep((s) => s + 1)}>
                    Avanti
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {active && <MvpDetail
            project={active}
            onClose={() => setActiveId(null)}
            onApprove={() => handleApprove(active.id)}
            onArchive={() => handleArchive(active.id)}
            onRegenerate={() => handleRegenerate(active.id)}
            onHandoff={() => handleHandoff(active.id)}
            onActions={() => handleActions(active.id)}
            onReview={() => handleReview(active.id)}
            onCopy={() => handleCopy(active)}
          />}
        </div>
      </div>
    </div>
  );
}

function MvpDetail({
  project,
  onClose,
  onApprove,
  onArchive,
  onRegenerate,
  onHandoff,
  onActions,
  onReview,
  onCopy,
}: {
  project: MvpBuildProject;
  onClose: () => void;
  onApprove: () => void;
  onArchive: () => void;
  onRegenerate: () => void;
  onHandoff: () => void;
  onActions: () => void;
  onReview: () => void;
  onCopy: () => void;
}) {
  const scope = project.mvp_scope as MvpScope;
  const must = useMemo(() => (Array.isArray(scope?.must_have) ? scope.must_have : []), [scope]);
  const should = useMemo(() => (Array.isArray(scope?.should_have) ? scope.should_have : []), [scope]);
  const later = useMemo(() => (Array.isArray(scope?.later) ? scope.later : []), [scope]);
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span>{project.title}</span>
            <div className="flex flex-wrap gap-1">
              <Badge variant="outline">{MVP_STATUS_LABEL[project.status]}</Badge>
              {project.recommended_engine && (
                <Badge variant="outline">→ {project.recommended_engine}</Badge>
              )}
              <Button size="sm" variant="outline" onClick={onRegenerate}>
                <Wand2 className="mr-1 h-3 w-3" /> Rigenera
              </Button>
              <Button size="sm" variant="outline" onClick={onCopy}>
                <CopyIcon className="mr-1 h-3 w-3" /> Copia Markdown
              </Button>
              {project.status !== "approved" && (
                <Button size="sm" variant="outline" onClick={onApprove}>
                  <CheckCircle2 className="mr-1 h-3 w-3" /> Approva
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={onHandoff}>
                <Rocket className="mr-1 h-3 w-3" /> Crea handoff Build Engine
              </Button>
              <Button size="sm" variant="outline" onClick={onActions}>
                <ListChecks className="mr-1 h-3 w-3" /> Crea action queue
              </Button>
              <Button size="sm" variant="outline" onClick={onReview}>
                Crea Result Review
              </Button>
              {project.status !== "archived" && (
                <Button size="sm" variant="outline" onClick={onArchive}>
                  <Archive className="mr-1 h-3 w-3" /> Archivia
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={onClose}>
                Chiudi
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div><span className="text-muted-foreground">Idea:</span> {project.idea_summary}</div>
          {project.value_proposition && (
            <div><span className="text-muted-foreground">Promessa:</span> {project.value_proposition}</div>
          )}
          {project.main_problem && (
            <div><span className="text-muted-foreground">Problema:</span> {project.main_problem}</div>
          )}
          {project.target_users.length > 0 && (
            <div><span className="text-muted-foreground">Target:</span> {project.target_users.join(", ")}</div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Must have">
          {must.length === 0 ? <Empty /> : must.map((s, i) => <Li key={i}>{s}</Li>)}
        </Section>
        <Section title="Should have">
          {should.length === 0 ? <Empty /> : should.map((s, i) => <Li key={i}>{s}</Li>)}
        </Section>
        <Section title="Later">
          {later.length === 0 ? <Empty /> : later.map((s, i) => <Li key={i}>{s}</Li>)}
        </Section>
        <Section title="Schermate">
          {project.screens.length === 0 ? <Empty /> : project.screens.map((s, i) => (
            <Li key={i}><strong>{s.name}</strong> — {s.purpose}</Li>
          ))}
        </Section>
        <Section title="Data Model">
          {project.data_model.length === 0 ? <Empty /> : project.data_model.map((e, i) => (
            <Li key={i}>
              <strong>{e.name}</strong>{e.sensitive ? " (sensibile)" : ""} — {e.fields.join(", ")}
            </Li>
          ))}
        </Section>
        <Section title="Ruoli">
          {project.user_roles.length === 0 ? <Empty /> : project.user_roles.map((r, i) => (
            <Li key={i}><strong>{r.name}</strong> — {r.permissions.join(", ")}</Li>
          ))}
        </Section>
        <Section title="Integrazioni">
          {project.integrations.length === 0 ? <Empty /> : project.integrations.map((i, idx) => (
            <Li key={idx}><strong>{i.name}</strong>{i.required_for_mvp ? " (richiesta)" : ""} — {i.reason}</Li>
          ))}
        </Section>
        <Section title="Rischi">
          {project.risks.length === 0 ? <Empty /> : project.risks.map((r, i) => (
            <Li key={i}><strong>{r.category}</strong>: {r.description}</Li>
          ))}
        </Section>
        <Section title="Roadmap">
          {project.roadmap.length === 0 ? <Empty /> : project.roadmap.map((p, i) => (
            <Li key={i}><strong>{p.phase}</strong> — {p.goal}</Li>
          ))}
        </Section>
        <Section title="Criteri di successo">
          {project.success_criteria.length === 0 ? <Empty /> : project.success_criteria.map((s, i) => <Li key={i}>{s}</Li>)}
        </Section>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent><ul className="space-y-1 text-xs">{children}</ul></CardContent>
    </Card>
  );
}
function Li({ children }: { children: React.ReactNode }) {
  return <li className="rounded border bg-background/40 px-2 py-1">{children}</li>;
}
function Empty() {
  return <li className="text-muted-foreground">—</li>;
}
