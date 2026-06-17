import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, ArrowRight, Sparkles, Wrench, BookMarked, ListChecks, LayoutDashboard } from "lucide-react";
import {
  DEPARTMENTS,
  PAIN_POINTS,
  MODULES,
  TOOLS,
  PRESETS,
  type Department,
  type PainPoint,
  type BrainModule,
  type CompanyOsProfile,
  recommendModules,
  getRecommendedActions,
  getCompanyProfile,
  upsertCompanyProfile,
  createRecommendedActionsForProfile,
  logCompanyOsEvent,
} from "@/lib/company-os";

export const Route = createFileRoute("/_authenticated/company-os")({
  head: () => ({
    meta: [
      { title: "Company OS — Brain Hub" },
      {
        name: "description",
        content:
          "Il cervello operativo della tua azienda: reparti, obiettivi, strumenti, dashboard e prossimi passi.",
      },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    brain: typeof s.brain === "string" ? s.brain : undefined,
  }),
  component: CompanyOsRoute,
});

type BrainRow = { id: string; name: string };

function CompanyOsRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [brainId, setBrainId] = useState<string | null>(null);

  useEffect(() => {
    void logCompanyOsEvent("company_os_viewed", "Pagina Company OS aperta", {});
  }, []);

  const { data: brains = [] } = useQuery({
    queryKey: ["brains-min-companyos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brains").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as BrainRow[];
    },
  });

  useEffect(() => {
    if (!brainId && brains[0]) setBrainId(brains[0].id);
  }, [brains, brainId]);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["company-os-profile", brainId],
    queryFn: () => (brainId ? getCompanyProfile(brainId) : Promise.resolve(null)),
    enabled: Boolean(brainId),
  });

  const refreshProfile = () => {
    void queryClient.invalidateQueries({ queryKey: ["company-os-profile", brainId] });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Company OS"
        subtitle="Il cervello operativo della tua azienda. Configura aree, obiettivi e moduli."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select value={brainId ?? ""} onValueChange={(v) => setBrainId(v || null)}>
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Seleziona azienda / brain" />
          </SelectTrigger>
          <SelectContent>
            {brains.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {profile && <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Company OS configurato</Badge>}
      </div>

      {!brainId ? (
        <p className="text-sm text-muted-foreground">Seleziona un brain per iniziare.</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Caricamento profilo aziendale…</p>
      ) : profile ? (
        <CompanyDashboard profile={profile} onEdit={refreshProfile} />
      ) : (
        <CompanyWizard brainId={brainId} onSaved={refreshProfile} />
      )}
    </div>
  );

  void navigate; // type-only guard, navigate consumed via Link
}

// ============== Wizard ==============
function CompanyWizard({ brainId, onSaved }: { brainId: string; onSaved: () => void }) {
  const [step, setStep] = useState(1);
  const [presetId, setPresetId] = useState<string>("custom");
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [size, setSize] = useState("");
  const [mainGoal, setMainGoal] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [pain, setPain] = useState<PainPoint[]>([]);
  const [modules, setModules] = useState<BrainModule[]>([]);
  const [saving, setSaving] = useState(false);

  const applyPreset = (id: string) => {
    setPresetId(id);
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setDepartments(p.departments);
    setPain(p.painPoints);
    setModules(p.modules);
  };

  const recommendedModules = useMemo(() => recommendModules(departments, pain), [departments, pain]);
  useEffect(() => {
    if (step === 4 && modules.length === 0) setModules(recommendedModules);
  }, [step, recommendedModules, modules.length]);

  const toggle = <T extends string>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const save = async () => {
    if (!companyName.trim()) {
      toast.error("Inserisci il nome azienda");
      setStep(1);
      return;
    }
    setSaving(true);
    const profile = await upsertCompanyProfile({
      brain_id: brainId,
      company_name: companyName.trim(),
      industry: industry || null,
      company_size: size || null,
      main_goal: mainGoal || null,
      pain_points: pain,
      active_departments: departments,
      preferred_modules: modules,
      preset: presetId,
    });
    setSaving(false);
    if (!profile) {
      toast.error("Errore salvataggio profilo");
      return;
    }
    void logCompanyOsEvent("company_os_profile_created", "Profilo Company OS creato", {
      brain_id: brainId,
      preset: presetId,
    });
    toast.success("Company OS salvato");
    onSaved();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" /> Setup Company OS — Step {step} di 5
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 1 && (
          <div className="space-y-3">
            <div>
              <Label>Preset</Label>
              <Select value={presetId} onValueChange={applyPreset}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Nome azienda *</Label>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={120} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Settore</Label>
                <Input value={industry} onChange={(e) => setIndustry(e.target.value)} maxLength={120} />
              </div>
              <div>
                <Label>Dimensione</Label>
                <Select value={size} onValueChange={setSize}>
                  <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1-5">1-5 persone</SelectItem>
                    <SelectItem value="6-20">6-20 persone</SelectItem>
                    <SelectItem value="21-50">21-50 persone</SelectItem>
                    <SelectItem value="51-200">51-200 persone</SelectItem>
                    <SelectItem value="200+">200+ persone</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Obiettivo principale</Label>
              <Textarea value={mainGoal} onChange={(e) => setMainGoal(e.target.value)} maxLength={500} rows={3} />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-2">
            <Label>Aree da controllare</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {DEPARTMENTS.map((d) => (
                <label key={d.id} className="flex items-center gap-2 rounded border p-2">
                  <Checkbox
                    checked={departments.includes(d.id)}
                    onCheckedChange={() => setDepartments((p) => toggle(p, d.id))}
                  />
                  <span className="text-sm">{d.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-2">
            <Label>Problemi da risolvere</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {PAIN_POINTS.map((p) => (
                <label key={p.id} className="flex items-center gap-2 rounded border p-2">
                  <Checkbox
                    checked={pain.includes(p.id)}
                    onCheckedChange={() => setPain((prev) => toggle(prev, p.id))}
                  />
                  <span className="text-sm">{p.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-2">
            <Label>Moduli Brain Hub consigliati</Label>
            <p className="text-xs text-muted-foreground">
              Selezione iniziale basata su aree e problemi. Modificala se vuoi.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {MODULES.map((m) => (
                <label key={m.id} className="flex items-center gap-2 rounded border p-2">
                  <Checkbox
                    checked={modules.includes(m.id)}
                    onCheckedChange={() => setModules((prev) => toggle(prev, m.id))}
                  />
                  <span className="text-sm">{m.label}</span>
                  {recommendedModules.includes(m.id) && (
                    <Badge variant="outline" className="ml-auto text-[10px]">consigliato</Badge>
                  )}
                </label>
              ))}
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-3 text-sm">
            <div className="rounded border p-3">
              <div className="font-medium">{companyName || "Azienda senza nome"}</div>
              <div className="text-xs text-muted-foreground">
                {industry || "—"} · {size || "—"}
              </div>
              {mainGoal && <div className="mt-2 text-xs">Obiettivo: {mainGoal}</div>}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <SummaryBox label="Aree operative" items={departments.map((d) => DEPARTMENTS.find((x) => x.id === d)?.label ?? d)} />
              <SummaryBox label="Problemi" items={pain.map((p) => PAIN_POINTS.find((x) => x.id === p)?.label ?? p)} />
              <SummaryBox label="Moduli attivi" items={modules.map((m) => MODULES.find((x) => x.id === m)?.label ?? m)} />
              <SummaryBox label="Azioni di avvio" items={getRecommendedActions(departments).map((a) => a.title)} />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" disabled={step === 1} onClick={() => setStep((s) => s - 1)}>
            Indietro
          </Button>
          {step < 5 ? (
            <Button onClick={() => setStep((s) => s + 1)}>
              Avanti <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          ) : (
            <Button onClick={save} disabled={saving}>
              {saving ? "Salvataggio…" : "Salva Company OS"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryBox({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="rounded border p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">—</div>
      ) : (
        <ul className="ml-4 list-disc text-xs">
          {items.map((i, idx) => (
            <li key={idx}>{i}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============== Dashboard ==============
function CompanyDashboard({ profile, onEdit }: { profile: CompanyOsProfile; onEdit: () => void }) {
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void logCompanyOsEvent("company_os_dashboard_opened", "Dashboard aziendale aperta", {
      profile_id: profile.id,
    });
  }, [profile.id]);

  if (editing) {
    return <CompanyWizard brainId={profile.brain_id} onSaved={() => { setEditing(false); onEdit(); }} />;
  }

  const departmentsActive = profile.active_departments as Department[];
  const modulesActive = profile.preferred_modules as BrainModule[];
  const recommendedActions = getRecommendedActions(departmentsActive);
  const presetTools = PRESETS.find((p) => p.id === profile.preset)?.recommendedTools ?? [];
  const recommendedRunbooks = PRESETS.find((p) => p.id === profile.preset)?.recommendedRunbooks ?? [];

  const createActions = async () => {
    setCreating(true);
    const n = await createRecommendedActionsForProfile(profile);
    setCreating(false);
    if (n > 0) {
      toast.success(`${n} action di avvio create`);
      void logCompanyOsEvent("company_os_recommended_actions_created", `Create ${n} azioni`, {
        profile_id: profile.id,
        count: n,
      });
    } else {
      toast.error("Nessuna action creata");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" /> Company Snapshot
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-lg font-semibold">{profile.company_name}</div>
          <div className="text-xs text-muted-foreground">
            {profile.industry || "—"} · {profile.company_size || "—"} · preset: {profile.preset || "custom"}
          </div>
          {profile.main_goal && <div className="text-sm">Obiettivo: {profile.main_goal}</div>}
          <div className="flex gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Modifica
            </Button>
            <Button size="sm" onClick={createActions} disabled={creating}>
              {creating ? "Creazione…" : "Crea prime action consigliate"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Aree operative attive</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {departmentsActive.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nessuna area selezionata.</p>
            ) : (
              departmentsActive.map((d) => (
                <Badge key={d} variant="outline">{DEPARTMENTS.find((x) => x.id === d)?.label ?? d}</Badge>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Moduli Brain Hub attivi</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {modulesActive.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nessun modulo abilitato.</p>
            ) : (
              modulesActive.map((m) => {
                const mod = MODULES.find((x) => x.id === m);
                if (!mod) return null;
                return (
                  <Badge key={m} variant="outline">{mod.label}</Badge>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Wrench className="h-4 w-4" /> Strumenti da collegare
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {TOOLS.map((t) => {
                const isReco = presetTools.includes(t.id);
                return (
                  <Badge
                    key={t.id}
                    variant="outline"
                    className={isReco ? "border-emerald-500/40 bg-emerald-500/5" : ""}
                  >
                    {t.label} {isReco && "★"}
                  </Badge>
                );
              })}
            </div>
            <Button asChild size="sm" variant="outline" onClick={() => void logCompanyOsEvent("company_os_tool_recommendation_opened", "Apertura Tool Connections", { profile_id: profile.id })}>
              <Link to="/tool-connections" search={{}}>Apri Tool Connections</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <BookMarked className="h-4 w-4" /> Runbook consigliati
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recommendedRunbooks.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nessun runbook consigliato per questo preset.</p>
            ) : (
              <ul className="ml-4 list-disc text-sm">
                {recommendedRunbooks.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
            <Button asChild size="sm" variant="outline">
              <Link to="/runbooks" search={{}}>Apri Runbooks</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ListChecks className="h-4 w-4" /> Azioni di avvio consigliate
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recommendedActions.length === 0 ? (
              <p className="text-xs text-muted-foreground">Seleziona almeno un'area operativa per ricevere suggerimenti.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {recommendedActions.map((a, i) => (
                  <li key={i} className="rounded border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{a.title}</span>
                      <Badge variant="outline" className="text-[10px]">{a.department}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{a.description}</div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <LayoutDashboard className="h-4 w-4" /> Stato operativo
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/operating-dashboard" search={{}}>Operating Dashboard</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/project-console" search={{}}>Project Console</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/action-queue" search={{}}>Action Queue</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/loop-qa" search={{}}>Loop QA</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/knowledge-map" search={{}}>Knowledge Map</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/company-blueprint" search={{}}>Genera Company Blueprint</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/company-blueprint" search={{}}>Apri Blueprint</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link
                to="/build-engines"
                search={{
                  brain: profile.brain_id ?? undefined,
                  source: "company_os",
                  source_id: profile.id,
                  task_type: "new_mvp",
                  title: `Sviluppo strumenti operativi per ${profile.company_name}`,
                  description: [
                    profile.main_goal ? `Obiettivo: ${profile.main_goal}.` : "",
                    departmentsActive.length
                      ? `Aree attive: ${departmentsActive.join(", ")}.`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined,
                }}
                onClick={() => {
                  void logCompanyOsEvent(
                    "company_os_tool_recommendation_opened",

                    "Apertura Build Engines da Company OS",
                    { profile_id: profile.id },
                  );
                  void import("@/lib/build-engines").then((m) =>
                    m.logBuildEngineEvent(
                      "build_engine_opened_from_company_os",
                      "Apertura Build Engines da Company OS",
                      { profile_id: profile.id },
                    ),
                  );
                }}
              >
                Scegli motore di sviluppo
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link
                to="/build-engines"
                search={{ brain: profile.brain_id ?? undefined }}
              >
                Apri Build Engines
              </Link>
            </Button>

          </CardContent>
        </Card>
      </div>
    </div>
  );
}
