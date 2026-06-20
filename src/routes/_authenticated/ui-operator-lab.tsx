import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShieldCheck, AlertTriangle, Bot } from "lucide-react";
import {
  getUiOperatorConfigFn,
  getUiOperatorRunnerHealthFn,
  startUiOperatorSessionFn,
  openUiOperatorRouteFn,
  observeUiOperatorScreenFn,
  proposeUiOperatorActionFn,
  confirmUiOperatorActionFn,
  executeConfirmedUiOperatorActionFn,
  stopUiOperatorSessionFn,
  listUiOperatorActionsFn,
} from "@/lib/ui-operator.functions";
import { ALLOWED_UI_ROUTES } from "@/lib/ui-operator-safety";
import type {
  UiOperatorAction,
  UiOperatorObservation,
  UiOperatorSession,
} from "@/lib/ui-operator-types";

export const Route = createFileRoute("/_authenticated/ui-operator-lab")({
  head: () => ({
    meta: [
      { title: "Jack UI Operator Lab — Brain Hub" },
      {
        name: "description",
        content:
          "Laboratorio Jack UI Operator: navigazione controllata dentro Brain Hub con Stagehand + Browserbase. Sempre confermato dall'utente, mai controllo libero.",
      },
    ],
  }),
  component: UiOperatorLabRoute,
});

function riskTone(risk: string): string {
  if (risk === "forbidden") return "bg-destructive/15 text-destructive border-destructive/30";
  if (risk === "high") return "bg-red-500/10 text-red-600 border-red-500/30";
  if (risk === "medium") return "bg-amber-500/10 text-amber-600 border-amber-500/30";
  return "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";
}

function UiOperatorLabRoute() {
  const [session, setSession] = useState<UiOperatorSession | null>(null);
  const [route, setRoute] = useState<string>("/gmail-connector");
  const [goal, setGoal] = useState<string>("Controllare lo stato Gmail e proporre Sincronizza");
  const [observation, setObservation] = useState<UiOperatorObservation | null>(null);
  const [proposed, setProposed] = useState<UiOperatorAction | null>(null);

  const configFn = useServerFn(getUiOperatorConfigFn);
  const healthFn = useServerFn(getUiOperatorRunnerHealthFn);
  const startFn = useServerFn(startUiOperatorSessionFn);
  const openFn = useServerFn(openUiOperatorRouteFn);
  const observeFn = useServerFn(observeUiOperatorScreenFn);
  const proposeFn = useServerFn(proposeUiOperatorActionFn);
  const confirmFn = useServerFn(confirmUiOperatorActionFn);
  const executeFn = useServerFn(executeConfirmedUiOperatorActionFn);
  const stopFn = useServerFn(stopUiOperatorSessionFn);
  const listActionsFn = useServerFn(listUiOperatorActionsFn);

  const cfg = useQuery({
    queryKey: ["ui-operator-config"],
    queryFn: () => configFn({ data: {} }),
  });

  const health = useQuery({
    queryKey: ["ui-operator-runner-health"],
    queryFn: () => healthFn({ data: {} }),
    enabled: !!cfg.data?.runner_configured,
    refetchInterval: false,
  });

  const actions = useQuery({
    queryKey: ["ui-operator-actions", session?.id ?? null],
    queryFn: () => listActionsFn({ data: { session_id: session?.id ?? null } }),
    enabled: !!session,
    refetchInterval: session ? 4000 : false,
  });

  async function handleStart() {
    const res = await startFn({ data: { target_route: route, brain_id: null } });
    if (!res.ok || !res.session) {
      toast.error(res.message);
      return;
    }
    setSession(res.session);
    toast.success(res.message);
  }

  async function handleOpen() {
    if (!session) return;
    const res = await openFn({ data: { session_id: session.id, route } });
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(res.message);
  }

  async function handleObserve() {
    if (!session) return;
    const res = await observeFn({ data: { session_id: session.id, route } });
    if (!res.ok || !res.observation) {
      toast.error(res.message);
      return;
    }
    setObservation(res.observation);
  }

  async function handlePropose() {
    if (!session) return;
    const res = await proposeFn({
      data: { session_id: session.id, route, goal, brain_id: null },
    });
    if (!res.action) {
      toast.error(res.message);
      return;
    }
    setProposed(res.action);
    if (res.ok) toast.success("Proposta registrata.");
    else toast.error(res.message);
  }

  async function handleConfirm() {
    if (!proposed) return;
    const res = await confirmFn({ data: { action_id: proposed.id } });
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    if (res.action) setProposed(res.action);
    toast.success("Azione confermata.");
  }

  async function handleExecute() {
    if (!proposed) return;
    const res = await executeFn({ data: { action_id: proposed.id } });
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    if (res.action) setProposed(res.action);
    toast.success(res.message);
  }

  async function handleStop() {
    if (!session) return;
    await stopFn({ data: { session_id: session.id } });
    setSession(null);
    setObservation(null);
    setProposed(null);
    toast.success("Sessione chiusa.");
  }

  const mode = cfg.data?.mode ?? "mock";
  const configured = !!cfg.data?.configured;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="Jack UI Operator Lab"
        subtitle="Navigazione controllata dentro Brain Hub. Solo route consentite. Niente click senza la tua conferma. Non gestisce password né completa OAuth esterni."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4" /> Stato configurazione
          </CardTitle>
          <CardDescription>
            Browserbase: {cfg.data?.has_browserbase_api_key ? "✅" : "❌"} · Project ID:{" "}
            {cfg.data?.has_browserbase_project_id ? "✅" : "❌"} · Model key:{" "}
            {cfg.data?.has_model_key ? "✅" : "❌"} · Model: {cfg.data?.model ?? "—"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge variant={configured ? "default" : "outline"}>
            Mode: {mode === "real" ? "reale" : "mock"}
          </Badge>
          <Badge variant="outline">
            Route consentite: {cfg.data?.allowed_routes.length ?? ALLOWED_UI_ROUTES.length}
          </Badge>
          {!configured ? (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Mock attivo: aggiungi
              BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID e OPENAI_API_KEY per il browser reale.
            </span>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Bot className="h-4 w-4" /> Controlli sessione
          </CardTitle>
          <CardDescription>
            Workflow: observe → propose → confirm → execute. Niente click diretto.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px]">
              <label className="text-xs text-muted-foreground">Route target</label>
              <Select value={route} onValueChange={setRoute}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(cfg.data?.allowed_routes ?? ALLOWED_UI_ROUTES).map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[260px]">
              <label className="text-xs text-muted-foreground">Goal</label>
              <Input value={goal} onChange={(e) => setGoal(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleStart} disabled={!!session}>Avvia sessione</Button>
            <Button variant="secondary" onClick={handleOpen} disabled={!session}>
              Apri route
            </Button>
            <Button variant="secondary" onClick={handleObserve} disabled={!session}>
              Osserva schermata
            </Button>
            <Button variant="secondary" onClick={handlePropose} disabled={!session}>
              Proponi azione
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!proposed || proposed.status !== "proposed"}
            >
              Conferma azione
            </Button>
            <Button
              variant="default"
              onClick={handleExecute}
              disabled={!proposed || proposed.status !== "confirmed"}
            >
              Esegui confermata
            </Button>
            <Button variant="outline" onClick={handleStop} disabled={!session}>
              Ferma sessione
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Sessione corrente</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {session ? (
              <>
                <div>ID: <code className="text-xs">{session.id}</code></div>
                <div>Provider: {session.provider}</div>
                <div>Status: {session.status}</div>
                <div>Route: {session.target_route ?? "—"}</div>
              </>
            ) : (
              <p className="text-muted-foreground">Nessuna sessione attiva.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Osservazione</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {observation ? (
              <>
                <div className="font-medium">{observation.page_title ?? observation.route}</div>
                <p className="text-muted-foreground">{observation.summary}</p>
                <div className="flex flex-wrap gap-1">
                  {observation.available_actions.map((a, i) => (
                    <Badge key={i} variant="outline" className={riskTone(a.risk_level)}>
                      {a.title}
                    </Badge>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">Premi "Osserva schermata".</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Azione proposta</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          {proposed ? (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={riskTone(proposed.risk_level)}>
                  rischio: {proposed.risk_level}
                </Badge>
                <Badge variant="outline">stato: {proposed.status}</Badge>
                {proposed.requires_confirmation ? <Badge>conferma richiesta</Badge> : null}
              </div>
              <div className="font-medium">{proposed.title}</div>
              <p className="text-muted-foreground">{proposed.description ?? ""}</p>
              {proposed.safety_reason ? (
                <p className="text-destructive text-xs">
                  Safety: {proposed.safety_reason}
                </p>
              ) : null}
              {proposed.result_text ? (
                <p className="text-emerald-600 text-xs">Risultato: {proposed.result_text}</p>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground">Nessuna proposta.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Storico azioni</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {actions.data?.actions && actions.data.actions.length > 0 ? (
            actions.data.actions.map((a) => (
              <div key={a.id} className="rounded border p-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={riskTone(a.risk_level)}>
                    {a.risk_level}
                  </Badge>
                  <Badge variant="outline">{a.status}</Badge>
                  <span className="text-xs text-muted-foreground">{a.action_type}</span>
                </div>
                <div className="font-medium">{a.title}</div>
                {a.safety_reason ? (
                  <div className="text-xs text-destructive">{a.safety_reason}</div>
                ) : null}
                {a.result_text ? (
                  <div className="text-xs text-emerald-600">{a.result_text}</div>
                ) : null}
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">Nessuna azione ancora registrata.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
