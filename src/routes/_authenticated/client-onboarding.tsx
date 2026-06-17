import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Sparkles,
  Home,
  LayoutDashboard,
} from "lucide-react";
import {
  getClientOnboardingSummary,
  logClientOnboardingEvent,
  type ClientOnboardingStep,
} from "@/lib/client-onboarding";

type ClientOnboardingSearch = { brain?: string };

export const Route = createFileRoute("/_authenticated/client-onboarding")({
  validateSearch: (s: Record<string, unknown>): ClientOnboardingSearch => ({
    brain: typeof s.brain === "string" ? s.brain : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Percorso Guidato — Brain Hub" },
      {
        name: "description",
        content:
          "Percorso guidato per imprenditori: configura Brain Hub passo dopo passo e arriva al primo risultato operativo.",
      },
    ],
  }),
  component: ClientOnboardingRoute,
});

function stepIcon(status: ClientOnboardingStep["status"]) {
  if (status === "done") return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
  if (status === "warning") return <AlertTriangle className="h-5 w-5 text-amber-500" />;
  return <Circle className="h-5 w-5 text-muted-foreground" />;
}

function stepBadge(status: ClientOnboardingStep["status"]) {
  if (status === "done")
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
        Completato
      </Badge>
    );
  if (status === "warning")
    return (
      <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
        Attenzione
      </Badge>
    );
  return <Badge variant="outline">Da fare</Badge>;
}

function ClientOnboardingRoute() {
  const { brain: brainParam } = useSearch({
    from: "/_authenticated/client-onboarding",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["client-onboarding-summary", brainParam ?? null],
    queryFn: () => getClientOnboardingSummary(brainParam ?? null),
  });

  useEffect(() => {
    void logClientOnboardingEvent(
      "client_onboarding_viewed",
      "Percorso guidato aperto",
      { brain: brainParam ?? null },
    );
  }, [brainParam]);

  const brainId = data?.brainId ?? brainParam ?? null;
  const linkSearch = { brain: brainId ?? undefined };

  if (isLoading || !data) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title="Percorso Guidato" subtitle="Caricamento…" />
      </div>
    );
  }

  const { steps, progress, nextStep, companyName } = data;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <PageHeader
        title={companyName ? `Percorso guidato — ${companyName}` : "Percorso guidato"}
        subtitle="Configura Brain Hub passo dopo passo e arriva al primo risultato operativo"
        actions={
          <>
            <Button
              asChild
              size="sm"
              variant="outline"
              onClick={() =>
                void logClientOnboardingEvent(
                  "client_onboarding_home_opened",
                  "Ritorno alla Home Azienda",
                  { brain: brainId },
                )
              }
            >
              <Link to="/company-home" search={linkSearch}>
                <Home className="mr-1 h-3 w-3" />
                Torna alla Home Azienda
              </Link>
            </Button>
          </>
        }
      />

      {/* Progress */}
      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Avanzamento
              </div>
              <div className="text-2xl font-semibold">{progress.percent}%</div>
            </div>
            <div className="text-right text-sm text-muted-foreground">
              <div>
                {progress.done} di {progress.total} completati
              </div>
              {progress.warning > 0 && (
                <div className="text-amber-600 dark:text-amber-400">
                  {progress.warning} da rivedere
                </div>
              )}
            </div>
          </div>
          <Progress value={progress.percent} />
        </CardContent>
      </Card>

      {/* Next step */}
      {nextStep && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="grid gap-4 p-6 md:grid-cols-[1fr_auto] md:items-center">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Prossimo passo consigliato — Passo {nextStep.order}
                </span>
              </div>
              <h2 className="text-xl font-semibold">{nextStep.title}</h2>
              <p className="text-sm text-muted-foreground">{nextStep.description}</p>
              <div className="text-xs text-muted-foreground">
                Genera: <span className="font-medium">{nextStep.output}</span>
              </div>
            </div>
            <Button
              asChild
              size="lg"
              onClick={() =>
                void logClientOnboardingEvent(
                  "client_onboarding_next_step_clicked",
                  `Next step: ${nextStep.id}`,
                  { step: nextStep.id, to: nextStep.ctaTo, brain: brainId },
                )
              }
            >
              <Link to={nextStep.ctaTo} search={linkSearch}>
                {nextStep.ctaLabel} <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Steps list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tutti i passi</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {steps.map((step) => (
              <li
                key={step.id}
                className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex items-start gap-3">
                  <div className="pt-1">{stepIcon(step.status)}</div>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        Passo {step.order}
                      </span>
                      {stepBadge(step.status)}
                    </div>
                    <div className="text-sm font-semibold">{step.title}</div>
                    <p className="text-xs text-muted-foreground">{step.description}</p>
                    <div className="text-[11px] text-muted-foreground">
                      Genera: <span className="font-medium">{step.output}</span>
                    </div>
                  </div>
                </div>
                <Button
                  asChild
                  size="sm"
                  variant={step.status === "done" ? "ghost" : "outline"}
                  onClick={() => {
                    void logClientOnboardingEvent(
                      "client_onboarding_step_opened",
                      `Step aperto: ${step.id}`,
                      { step: step.id, to: step.ctaTo, brain: brainId },
                    );
                    if (step.id === "documents") {
                      void logClientOnboardingEvent(
                        "drive_opened_from_client_onboarding",
                        "Apertura Drive Knowledge dal percorso guidato",
                        { brain: brainId },
                      );
                    }
                  }}
                >
                  <Link to={step.ctaTo} search={linkSearch}>
                    {step.ctaLabel} <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <Button
          asChild
          variant="ghost"
          size="sm"
          onClick={() =>
            void logClientOnboardingEvent(
              "client_onboarding_home_opened",
              "Ritorno alla Home Azienda (footer)",
              { brain: brainId },
            )
          }
        >
          <Link to="/company-home" search={linkSearch}>
            <Home className="mr-1 h-3 w-3" />
            Torna alla Home Azienda
          </Link>
        </Button>
        <Link
          to="/operating-dashboard"
          search={linkSearch}
          className="inline-flex items-center text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() =>
            void logClientOnboardingEvent(
              "client_onboarding_expert_mode_opened",
              "Apertura modalità esperto dal percorso guidato",
              { brain: brainId },
            )
          }
        >
          <LayoutDashboard className="mr-1 h-3 w-3" />
          Apri modalità esperto →
        </Link>
      </div>
    </div>
  );
}
