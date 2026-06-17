import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
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
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Sparkles,
  Building2,
  BookMarked,
  ListChecks,
  CheckSquare,
  RefreshCw,
  Plug,
  BookOpen,
  Activity,
  LayoutDashboard,
} from "lucide-react";
import {
  getCompanyHomeSummary,
  getCompanyNextBestAction,
  getCompanyProgressSteps,
  getCompanySimpleHealth,
  getCompanyHomeCards,
  listCompanyHomeOptions,
  logCompanyHomeEvent,
  type SimpleHomeCard,
  type SimpleProgressStep,
} from "@/lib/company-simple-home";
import { CalendarUpcomingPreview } from "@/components/CalendarUpcomingPreview";

type CompanyHomeSearch = { brain?: string };

export const Route = createFileRoute("/_authenticated/company-home")({
  validateSearch: (s: Record<string, unknown>): CompanyHomeSearch => ({
    brain: typeof s.brain === "string" ? s.brain : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Home Azienda — Brain Hub" },
      {
        name: "description",
        content:
          "Dashboard semplice per imprenditori e manager: piano, progetti, azioni e risultati in un colpo d'occhio.",
      },
    ],
  }),
  component: CompanyHomeRoute,
});

const cardIcons: Record<SimpleHomeCard["id"], typeof BookMarked> = {
  plan: BookMarked,
  mvp: Sparkles,
  actions: ListChecks,
  results: CheckSquare,
  improvements: RefreshCw,
  tools: Plug,
  knowledge: BookOpen,
  system: Activity,
};

function toneClasses(tone: SimpleHomeCard["tone"]): string {
  switch (tone) {
    case "ok":
      return "border-emerald-500/30 bg-emerald-500/5";
    case "warn":
      return "border-amber-500/40 bg-amber-500/5";
    default:
      return "border-border";
  }
}

function stepIcon(status: SimpleProgressStep["status"]) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

function CompanyHomeRoute() {
  const { brain: brainParam } = useSearch({ from: "/_authenticated/company-home" });
  const navigate = useNavigate({ from: "/_authenticated/company-home" });

  const { data: options } = useQuery({
    queryKey: ["company-home-options"],
    queryFn: () => listCompanyHomeOptions(),
  });

  const { data: summary, isLoading } = useQuery({
    queryKey: ["company-home-summary", brainParam ?? null],
    queryFn: () => getCompanyHomeSummary(brainParam ?? null),
  });

  useEffect(() => {
    void logCompanyHomeEvent("company_home_viewed", "Home Azienda aperta", {
      brain: brainParam ?? null,
    });
  }, [brainParam]);

  const brainId = summary?.brainId ?? brainParam ?? null;
  const linkSearch = { brain: brainId ?? undefined };

  // Empty state: nessun brain disponibile
  if (!isLoading && (!options || options.length === 0)) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <PageHeader title="Home Azienda" subtitle="Inizia configurando la tua azienda" />
        <Card>
          <CardContent className="space-y-4 p-8 text-center">
            <Building2 className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="text-xl font-semibold">Configura la tua prima azienda</h2>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              Per iniziare, crea il profilo aziendale: da lì Brain Hub potrà generare piano
              operativo, MVP, azioni e risultati da controllare.
            </p>
            <Button
              asChild
              size="lg"
              onClick={() =>
                void logCompanyHomeEvent(
                  "company_home_empty_state_opened",
                  "Empty state aperto verso Company OS",
                )
              }
            >
              <Link to="/company-os" search={{}}>
                Configura Company OS <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !summary) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title="Home Azienda" subtitle="Caricamento…" />
      </div>
    );
  }

  const next = getCompanyNextBestAction(summary);
  const steps = getCompanyProgressSteps(summary);
  const health = getCompanySimpleHealth(summary);
  const cards = getCompanyHomeCards(summary);
  const doneSteps = steps.filter((s) => s.status === "done").length;
  const progressPct = Math.round((doneSteps / steps.length) * 100);

  const healthLabel =
    health.status === "healthy"
      ? "In ordine"
      : health.status === "attention"
        ? "Attenzione"
        : "Da completare";
  const healthTone =
    health.status === "healthy"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : health.status === "attention"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
        : "bg-muted text-muted-foreground";

  const headerTitle =
    summary.companyName ??
    options?.find((o) => o.brainId === brainId)?.brainName ??
    "Home Azienda";

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <PageHeader
        title={headerTitle}
        subtitle="Una vista semplice del tuo sistema operativo aziendale"
        actions={
          <Button asChild size="sm" variant="ghost">
            <Link
              to="/operating-dashboard"
              search={linkSearch}
              onClick={() =>
                void logCompanyHomeEvent(
                  "company_home_expert_mode_opened",
                  "Apertura modalità esperto",
                )
              }
            >
              <LayoutDashboard className="mr-1 h-3 w-3" />
              Apri modalità esperto
            </Link>
          </Button>
        }
      />

      {/* Selettore azienda/brain */}
      {options && options.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Azienda
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Scegli l'azienda da visualizzare in questa home.
              </div>
            </div>
            <div className="w-full sm:w-72">
              <Select
                value={brainId ?? undefined}
                onValueChange={(v) => {
                  void logCompanyHomeEvent(
                    "company_home_brain_selected",
                    "Brain selezionato dalla Home Azienda",
                    { brain: v },
                  );
                  void navigate({
                    to: "/company-home",
                    search: { brain: v },
                    replace: true,
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona azienda…" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o.brainId} value={o.brainId}>
                      <span className="flex items-center gap-2">
                        <span>{o.companyName ?? o.brainName}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {o.hasProfile ? "Configurata" : "Da configurare"}
                        </Badge>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hero: stato generale + prossima azione */}
      <Card className="overflow-hidden">
        <CardContent className="grid gap-4 p-6 md:grid-cols-[1fr_auto] md:items-center">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge className={healthTone}>Stato: {healthLabel}</Badge>
              <Badge variant="outline" className="text-[10px]">
                Avanzamento {progressPct}%
              </Badge>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Cosa fare oggi
              </div>
              <h2 className="mt-1 text-2xl font-semibold">{next.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{next.description}</p>
            </div>
          </div>
          <Button
            asChild
            size="lg"
            onClick={() =>
              void logCompanyHomeEvent(
                "company_home_next_action_clicked",
                `Next action: ${next.key}`,
                { key: next.key, to: next.cta.to, brain: brainId },
              )
            }
          >
          <Link to={next.cta.to} search={linkSearch}>
              {next.cta.label} <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
        <div className="border-t bg-muted/30 px-6 py-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/client-onboarding" search={linkSearch}>
              <Sparkles className="mr-1 h-3 w-3" />
              Apri percorso guidato
              <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
      </Card>

      {/* Agenti AI (v3.3) */}
      <AgentiAiBlock brainId={brainId} linkSearch={linkSearch} />

      {/* Percorso guidato */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Percorso guidato</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 md:grid-cols-2">
            {steps.map((step, idx) => (
              <li
                key={step.id}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div className="flex items-center gap-3">
                  {stepIcon(step.status)}
                  <div>
                    <div className="text-xs text-muted-foreground">Passo {idx + 1}</div>
                    <div className="text-sm font-medium">{step.label}</div>
                  </div>
                </div>
                <Button asChild size="sm" variant="ghost">
                  <Link to={step.cta.to} search={linkSearch}>
                    {step.cta.label} <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* Card principali */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const Icon = cardIcons[card.id] ?? Building2;
          return (
            <Card key={card.id} className={toneClasses(card.tone)}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xl font-semibold">{card.metric}</div>
                <p className="text-xs text-muted-foreground">{card.hint}</p>
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    void logCompanyHomeEvent(
                      "company_home_card_opened",
                      `Card aperta: ${card.id}`,
                      { card: card.id, to: card.cta.to, brain: brainId },
                    );
                    if (card.id === "knowledge") {
                      void logCompanyHomeEvent(
                        "drive_opened_from_company_home",
                        "Apertura Drive Knowledge da Home Azienda",
                        { brain: brainId, files: summary.driveFilesMapped },
                      );
                    }
                  }}
                >
                  <Link to={card.cta.to} search={linkSearch}>
                    {card.cta.label} <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}

        {/* Card Stato del sistema */}
        <Card className={toneClasses(health.status === "healthy" ? "ok" : "warn")}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Stato del sistema</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xl font-semibold">{healthLabel}</div>
            {health.reasons.length === 0 ? (
              <p className="text-xs text-muted-foreground">Tutto sotto controllo.</p>
            ) : (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {health.reasons.slice(0, 3).map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
              </ul>
            )}
            <Button asChild size="sm" variant="outline" className="w-full">
              <Link to="/loop-qa" search={linkSearch}>
                Controlla stato <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Calendar preview */}
        <CalendarUpcomingPreview brainId={brainId} compact />
      </div>

      <div className="pt-2 text-center">
        <Link
          to="/operating-dashboard"
          search={linkSearch}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() =>
            void logCompanyHomeEvent(
              "company_home_expert_mode_opened",
              "Apertura modalità esperto (footer)",
            )
          }
        >
          Apri modalità esperto →
        </Link>
      </div>
    </div>
  );
}

function AgentiAiBlock({
  brainId,
  linkSearch,
}: {
  brainId: string | null;
  linkSearch: { brain?: string };
}) {
  const { data } = useQuery({
    queryKey: ["company-home-agents", brainId],
    queryFn: async () => {
      const { getAgentCenterSummary } = await import("@/lib/agent-center");
      return getAgentCenterSummary(brainId);
    },
  });
  const total = data?.total ?? 0;
  const active = data?.active ?? 0;
  const recommended = data?.recommendedNext?.name ?? null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Agenti AI</CardTitle>
          <Sparkles className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Ruoli configurati</div>
            <div className="text-lg font-semibold">{total}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Assistenti attivi</div>
            <div className="text-lg font-semibold">{active}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Prossimo consigliato</div>
            <div className="truncate text-sm font-medium">{recommended ?? "—"}</div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Assistenti AI interni con permessi controllati e nessuna esecuzione autonoma.
        </p>
        <Button
          asChild
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => {
            void import("@/lib/agent-center").then(({ logAgentCenterEvent }) =>
              logAgentCenterEvent("agent_center_viewed", "Apertura da Home Azienda", { brain: brainId }),
            );
          }}
        >
          <Link to="/agent-center" search={linkSearch}>
            Configura agenti <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
