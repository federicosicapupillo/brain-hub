import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  logCompanyHomeEvent,
  type SimpleHomeCard,
  type SimpleProgressStep,
} from "@/lib/company-simple-home";

export const Route = createFileRoute("/_authenticated/company-home")({
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
  const { data: summary, isLoading } = useQuery({
    queryKey: ["company-home-summary"],
    queryFn: () => getCompanyHomeSummary(),
  });

  useEffect(() => {
    void logCompanyHomeEvent("company_home_viewed", "Home Azienda aperta");
  }, []);

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

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <PageHeader
        title={summary.companyName ?? "Home Azienda"}
        subtitle="Una vista semplice del tuo sistema operativo aziendale"
        actions={
          <Button asChild size="sm" variant="ghost">
            <Link
              to="/operating-dashboard"
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
                { key: next.key, to: next.cta.to },
              )
            }
          >
            <Link to={next.cta.to}>
              {next.cta.label} <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>

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
                  <Link to={step.cta.to}>
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
                  onClick={() =>
                    void logCompanyHomeEvent(
                      "company_home_card_opened",
                      `Card aperta: ${card.id}`,
                      { card: card.id, to: card.cta.to },
                    )
                  }
                >
                  <Link to={card.cta.to}>
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
              <Link to="/loop-qa">
                Controlla stato <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="pt-2 text-center">
        <Link
          to="/operating-dashboard"
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
