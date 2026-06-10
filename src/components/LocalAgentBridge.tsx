import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Bot,
  Copy,
  Download,
  Terminal,
  PlayCircle,
  XCircle,
  ShieldCheck,
  Info,
} from "lucide-react";
import {
  buildAutomationPayload,
  getAutomationRun,
  RUN_STATUS_LABELS,
  type ItemLike,
  type LogEventType,
} from "@/lib/automation-run";
import { CANONICAL_LOVABLE_URLS } from "@/components/LovableHandoffConnector";

type LocalAgentStatus =
  | "not_prepared"
  | "job_prepared"
  | "downloaded"
  | "copied"
  | "started_manually"
  | "callback_received"
  | "failed"
  | "cancelled";

type LocalAgentMeta = {
  agent_type: "playwright_local";
  agent_status: LocalAgentStatus;
  job_id: string | null;
  job_prepared_at: string | null;
  job_downloaded_at: string | null;
  job_copied_at: string | null;
  started_manually_at: string | null;
  callback_received_at: string | null;
  last_error: string | null;
  notes: string;
  updated_at: string;
};

const DEFAULT_AGENT: LocalAgentMeta = {
  agent_type: "playwright_local",
  agent_status: "not_prepared",
  job_id: null,
  job_prepared_at: null,
  job_downloaded_at: null,
  job_copied_at: null,
  started_manually_at: null,
  callback_received_at: null,
  last_error: null,
  notes: "",
  updated_at: new Date(0).toISOString(),
};

type ClipItem = ItemLike & {
  content: string | null;
  content_type: string | null;
  target_tool: string | null;
  automation_status: string | null;
  risk_level: string | null;
  output_result: string | null;
  updated_at: string;
};

type Brain = { id: string; name: string };
type LovableLinkRow = { id: string; brain_id: string; url: string | null };

async function fetchData() {
  const [itemsRes, brainsRes, linksRes] = await Promise.all([
    supabase
      .from("clipboard_items")
      .select(
        "id,brain_id,project_id,title,content,content_type,target_tool,automation_status,risk_level,output_result,success_criteria,expected_output,execution_instructions,metadata,updated_at",
      )
      .eq("content_type", "execution_package")
      .order("updated_at", { ascending: false })
      .limit(300),
    supabase.from("brains").select("id,name"),
    supabase
      .from("project_links")
      .select("id,brain_id,url")
      .eq("link_type", "external")
      .eq("tool", "lovable"),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (brainsRes.error) throw brainsRes.error;
  if (linksRes.error) throw linksRes.error;
  return {
    items: (itemsRes.data ?? []) as ClipItem[],
    brains: (brainsRes.data ?? []) as Brain[],
    lovableLinks: (linksRes.data ?? []) as LovableLinkRow[],
  };
}

function getAgent(item: ClipItem): LocalAgentMeta {
  const m = (item.metadata as Record<string, unknown> | null) ?? {};
  const a = m.local_agent as Partial<LocalAgentMeta> | undefined;
  if (!a || typeof a !== "object") return { ...DEFAULT_AGENT };
  return { ...DEFAULT_AGENT, ...a };
}

function getHandoffStatus(item: ClipItem): string {
  const m = (item.metadata as Record<string, unknown> | null) ?? {};
  const h = m.lovable_handoff as { handoff_status?: string } | undefined;
  return h?.handoff_status ?? "—";
}

function reviewStatus(i: ClipItem): string | null {
  const m = (i.metadata as Record<string, unknown> | null) ?? {};
  const r = m.post_execution_review as { review_status?: string } | undefined;
  return r?.review_status ?? null;
}

function canonicalUrlForBrainName(name: string | null | undefined): string | null {
  if (!name) return null;
  return CANONICAL_LOVABLE_URLS[name.trim().toLowerCase()] ?? null;
}

const AGENT_STATUS_META: Record<LocalAgentStatus, { label: string; cls: string }> = {
  not_prepared: { label: "non preparato", cls: "bg-muted text-muted-foreground border-border" },
  job_prepared: { label: "job preparato", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  downloaded: { label: "scaricato", cls: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30" },
  copied: { label: "copiato", cls: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30" },
  started_manually: {
    label: "avviato manualmente",
    cls: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  },
  callback_received: {
    label: "callback ricevuta",
    cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  },
  failed: { label: "fallito", cls: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  cancelled: { label: "annullato", cls: "bg-muted text-muted-foreground border-border" },
};

const CALLBACK_PATH = "/api/public/n8n-pilot-callback";
const AGENT_COMMAND = "node brainhub-lovable-agent.js --job ./agent-job.json";

export function LocalAgentBridge() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["local-agent-bridge"],
    queryFn: fetchData,
    refetchInterval: 30000,
  });

  const [busyId, setBusyId] = useState<string | null>(null);

  const items = data?.items ?? [];
  const brains = data?.brains ?? [];
  const brainMap = useMemo(() => new Map(brains.map((b) => [b.id, b])), [brains]);
  const linkByBrain = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of data?.lovableLinks ?? []) {
      if (l.brain_id && l.url) m.set(l.brain_id, l.url);
    }
    return m;
  }, [data?.lovableLinks]);

  function resolveUrl(item: ClipItem): string {
    const m = (item.metadata as Record<string, unknown> | null) ?? {};
    const h = m.lovable_handoff as { lovable_project_url?: string } | undefined;
    const fromHandoff = (h?.lovable_project_url ?? "").trim();
    if (fromHandoff) return fromHandoff;
    if (item.brain_id) {
      const stored = linkByBrain.get(item.brain_id);
      if (stored) return stored.trim();
      const b = brainMap.get(item.brain_id);
      return canonicalUrlForBrainName(b?.name) ?? "";
    }
    return "";
  }

  function isEligible(i: ClipItem): boolean {
    if (i.content_type !== "execution_package") return false;
    const run = getAutomationRun(i);
    const tool = (i.target_tool ?? "").toLowerCase();
    const target = (run.target ?? "").toLowerCase();
    if (tool !== "lovable" && target !== "lovable") return false;
    if (!["approved", "queued"].includes(run.run_status)) return false;
    if (!resolveUrl(i)) return false;
    const dry = (run as unknown as { dry_run?: { enabled?: boolean } }).dry_run;
    if (dry?.enabled === true) return false;
    if (reviewStatus(i) === "approvato") return false;
    return true;
  }

  const eligible = useMemo(() => items.filter(isEligible), [items, brainMap, linkByBrain]);

  // Stats across ALL items (not only eligible) for dashboard counters
  const stats = useMemo(() => {
    const s = { prepared: 0, copiedOrDownloaded: 0, started: 0, callback: 0, failedOrCancelled: 0 };
    for (const i of items) {
      const a = getAgent(i);
      if (a.agent_status === "job_prepared") s.prepared++;
      if (a.agent_status === "copied" || a.agent_status === "downloaded") s.copiedOrDownloaded++;
      if (a.agent_status === "started_manually") s.started++;
      if (a.agent_status === "callback_received") s.callback++;
      if (a.agent_status === "failed" || a.agent_status === "cancelled") s.failedOrCancelled++;
    }
    return s;
  }, [items]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["local-agent-bridge"] });
    qc.invalidateQueries({ queryKey: ["automation-control"] });
    qc.invalidateQueries({ queryKey: ["automation-run-panel"] });
    qc.invalidateQueries({ queryKey: ["lovable-handoff"] });
    qc.invalidateQueries({ queryKey: ["project-loop"] });
  }

  async function logEvent(
    item: ClipItem,
    action: LogEventType,
    notes: string,
    extra?: Record<string, unknown>,
  ) {
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return;
    await supabase.from("clipboard_execution_logs").insert({
      user_id: u.user.id,
      clipboard_item_id: item.id,
      action,
      notes,
      metadata: {
        clipboard_item_id: item.id,
        brain_id: item.brain_id,
        connector: "local_agent_bridge",
        ...(extra ?? {}),
      },
    } as never);
  }

  async function persistAgent(item: ClipItem, patch: Partial<LocalAgentMeta>): Promise<LocalAgentMeta> {
    const prevMeta = (item.metadata as Record<string, unknown> | null) ?? {};
    const prev = getAgent(item);
    const next: LocalAgentMeta = {
      ...prev,
      ...patch,
      agent_type: "playwright_local",
      updated_at: new Date().toISOString(),
    };
    const { error: e } = await supabase
      .from("clipboard_items")
      .update({ metadata: { ...prevMeta, local_agent: next } } as never)
      .eq("id", item.id);
    if (e) throw e;
    return next;
  }

  async function persistAgentAndRun(
    item: ClipItem,
    agentPatch: Partial<LocalAgentMeta>,
    runPatch: Partial<ReturnType<typeof getAutomationRun>>,
  ) {
    const prevMeta = (item.metadata as Record<string, unknown> | null) ?? {};
    const prev = getAgent(item);
    const prevRun = getAutomationRun(item);
    const nowIso = new Date().toISOString();
    const nextAgent: LocalAgentMeta = {
      ...prev,
      ...agentPatch,
      agent_type: "playwright_local",
      updated_at: nowIso,
    };
    const nextRun = { ...prevRun, ...runPatch, updated_at: nowIso };
    const { error: e } = await supabase
      .from("clipboard_items")
      .update({
        metadata: { ...prevMeta, local_agent: nextAgent, automation_run: nextRun },
      } as never)
      .eq("id", item.id);
    if (e) throw e;
  }

  function buildJobPack(item: ClipItem, jobId: string) {
    const url = resolveUrl(item);
    const brain = item.brain_id ? brainMap.get(item.brain_id) ?? null : null;
    const run = getAutomationRun(item);
    const payload = buildAutomationPayload(item, {
      project_id: item.project_id ?? null,
      brain_name: brain?.name ?? null,
      project_name: brain?.name ?? null,
    });
    return {
      job_id: jobId,
      execution_package_id: item.id,
      run_id: run.run_id,
      project_id: payload.project_id ?? null,
      brain_id: item.brain_id ?? null,
      project_name: payload.project_name ?? null,
      target: "lovable",
      lovable_project_url: url,
      prompt: payload.prompt ?? "",
      success_criteria: payload.success_criteria ?? "",
      expected_output: payload.expected_output ?? "",
      protected_areas: payload.protected_areas ?? "",
      callback: {
        url: CALLBACK_PATH,
        method: "POST",
        schema_version: 1,
        requires_secret_header: true,
        secret_header_name: "x-brainhub-callback-secret",
      },
      instructions: [
        "Aprire il progetto Lovable indicato",
        "Incollare il prompt nella chat del progetto",
        "Inviare il prompt",
        "Attendere il risultato",
        "Restituire una callback JSON compatibile con Brain Hub",
      ],
      safety: {
        do_not_modify_auth: true,
        do_not_store_credentials: true,
        use_existing_browser_session: true,
        human_supervision_required: true,
      },
      created_at: new Date().toISOString(),
    };
  }

  const prepareMut = useMutation({
    mutationFn: async (item: ClipItem) => {
      if (item.risk_level === "alto") {
        const ok = window.confirm(
          "Item ad alto rischio. Confermi la preparazione del job per l'agente locale?",
        );
        if (!ok) throw new Error("Annullato");
      }
      const jobId = `agent_job_${Date.now()}`;
      const next = await persistAgent(item, {
        agent_status: "job_prepared",
        job_id: jobId,
        job_prepared_at: new Date().toISOString(),
        last_error: null,
      });
      await logEvent(item, "local_agent_job_prepared", "Job Playwright preparato", {
        job_id: jobId,
      });
      return next;
    },
    onSuccess: () => {
      toast.success("Job Playwright preparato");
      invalidate();
    },
    onError: (e: Error) => {
      if (e.message !== "Annullato") toast.error(e.message);
    },
    onSettled: () => setBusyId(null),
  });

  async function copyJob(item: ClipItem) {
    const a = getAgent(item);
    const jobId = a.job_id ?? `agent_job_${Date.now()}`;
    const pack = buildJobPack(item, jobId);
    const text = JSON.stringify(pack, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast.error("Impossibile copiare negli appunti");
      return;
    }
    await persistAgent(item, {
      agent_status: a.agent_status === "started_manually" ? a.agent_status : "copied",
      job_id: jobId,
      job_copied_at: new Date().toISOString(),
    });
    await logEvent(item, "local_agent_job_copied", "Job JSON copiato negli appunti", { job_id: jobId });
    invalidate();
    toast.success("Job JSON copiato");
  }

  async function downloadJob(item: ClipItem) {
    const a = getAgent(item);
    const jobId = a.job_id ?? `agent_job_${Date.now()}`;
    const pack = buildJobPack(item, jobId);
    const text = JSON.stringify(pack, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${jobId}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    await persistAgent(item, {
      agent_status: a.agent_status === "started_manually" ? a.agent_status : "downloaded",
      job_id: jobId,
      job_downloaded_at: new Date().toISOString(),
    });
    await logEvent(item, "local_agent_job_downloaded", "Job JSON scaricato", { job_id: jobId });
    invalidate();
    toast.success("Job JSON scaricato");
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(AGENT_COMMAND);
      toast.success("Comando agente copiato");
    } catch {
      toast.error("Impossibile copiare il comando");
    }
  }

  const startedMut = useMutation({
    mutationFn: async (item: ClipItem) => {
      const a = getAgent(item);
      const run = getAutomationRun(item);
      const canRun = run.run_status === "approved" || run.run_status === "queued";
      await persistAgentAndRun(
        item,
        {
          agent_status: "started_manually",
          started_manually_at: new Date().toISOString(),
        },
        canRun
          ? {
              run_status: "running",
              started_at: run.started_at ?? new Date().toISOString(),
            }
          : {},
      );
      await logEvent(item, "local_agent_job_started_manually", "Job consegnato all'agente locale", {
        job_id: a.job_id,
      });
    },
    onSuccess: () => {
      toast.success("Job segnato come consegnato all'agente");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setBusyId(null),
  });

  const cancelMut = useMutation({
    mutationFn: async (item: ClipItem) => {
      const a = getAgent(item);
      await persistAgent(item, { agent_status: "cancelled" });
      await logEvent(item, "local_agent_job_cancelled", "Job agente locale annullato", {
        job_id: a.job_id,
      });
    },
    onSuccess: () => {
      toast.success("Job annullato");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setBusyId(null),
  });

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Caricamento Local Agent Bridge…</div>
    );
  }
  if (error) {
    return <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-4 w-4" /> Local Agent Bridge
          <Badge variant="outline" className="ml-2 text-[10px]">
            playwright_local · preview
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats dashboard */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <StatBox label="Job preparati" value={stats.prepared} />
          <StatBox label="Copiati / scaricati" value={stats.copiedOrDownloaded} />
          <StatBox label="Consegnati all'agente" value={stats.started} />
          <StatBox label="Callback ricevute" value={stats.callback} />
          <StatBox label="Falliti / annullati" value={stats.failedOrCancelled} />
        </div>

        {/* Safety / instructions card */}
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <div className="mb-1 flex items-center gap-2 text-amber-300">
            <ShieldCheck className="h-4 w-4" />
            <span className="font-semibold">Istruzioni agente locale</span>
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            <li>L'agente deve essere eseguito sul Mac dell'utente.</li>
            <li>Userà una sessione browser già loggata su Lovable.</li>
            <li>Non deve salvare password o token.</li>
            <li>Non deve inviare dati non autorizzati a terze parti.</li>
            <li>Lavora su un solo Execution Package alla volta.</li>
            <li>Deve restituire il risultato tramite callback compatibile Brain Hub.</li>
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded bg-muted px-2 py-1 font-mono text-[11px]">{AGENT_COMMAND}</code>
            <Button size="sm" variant="outline" onClick={copyCommand}>
              <Terminal className="mr-1 h-3 w-3" /> Copia comando futuro agente
            </Button>
          </div>
          <div className="mt-2 flex items-start gap-2 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              Nessuna automazione browser viene eseguita dal frontend. Questa sezione genera solo un job
              pack JSON sicuro, da consegnare manualmente a un futuro agente Playwright locale.
            </span>
          </div>
        </div>

        {/* Eligible list */}
        {eligible.length === 0 && (
          <div className="rounded-md border border-border/60 p-3 text-sm text-muted-foreground">
            Nessun Execution Package idoneo. Servono: target Lovable, run approvata o in coda, URL
            Lovable configurato, nessun dry run attivo.
          </div>
        )}

        <div className="space-y-3">
          {eligible.map((item) => {
            const a = getAgent(item);
            const run = getAutomationRun(item);
            const url = resolveUrl(item);
            const brain = item.brain_id ? brainMap.get(item.brain_id) : null;
            const meta = AGENT_STATUS_META[a.agent_status];
            const handoff = getHandoffStatus(item);
            const m = (item.metadata as Record<string, unknown> | null) ?? {};
            const pkg = (m.execution_package as { package_type?: string } | undefined) ?? {};
            const busy = busyId === item.id;
            return (
              <div key={item.id} className="rounded-md border border-border/60 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{item.title || "(senza titolo)"}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {brain?.name ?? "—"}
                    </div>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-[11px] text-sky-400 underline"
                    >
                      {url}
                    </a>
                  </div>
                  <div className="flex flex-wrap shrink-0 items-center gap-1">
                    <Badge variant="outline" className="text-[10px]">
                      run: {RUN_STATUS_LABELS[run.run_status]}
                    </Badge>
                    {item.risk_level && (
                      <Badge variant="outline" className="text-[10px]">
                        risk: {item.risk_level}
                      </Badge>
                    )}
                    {pkg.package_type && (
                      <Badge variant="outline" className="text-[10px]">
                        pkg: {pkg.package_type}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px]">
                      handoff: {handoff}
                    </Badge>
                    <Badge className={`text-[10px] border ${meta.cls}`}>agent: {meta.label}</Badge>
                  </div>
                </div>

                {a.job_id && (
                  <div className="mt-2 font-mono text-[10px] text-muted-foreground">
                    job_id: {a.job_id}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    disabled={busy || prepareMut.isPending}
                    onClick={() => {
                      setBusyId(item.id);
                      prepareMut.mutate(item);
                    }}
                  >
                    <Bot className="mr-1 h-3 w-3" /> Prepara job Playwright
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={a.agent_status === "not_prepared"}
                    onClick={() => void copyJob(item)}
                  >
                    <Copy className="mr-1 h-3 w-3" /> Copia job JSON
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={a.agent_status === "not_prepared"}
                    onClick={() => void downloadJob(item)}
                  >
                    <Download className="mr-1 h-3 w-3" /> Scarica job JSON
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busy ||
                      startedMut.isPending ||
                      a.agent_status === "not_prepared" ||
                      a.agent_status === "started_manually" ||
                      a.agent_status === "callback_received"
                    }
                    onClick={() => {
                      setBusyId(item.id);
                      startedMut.mutate(item);
                    }}
                  >
                    <PlayCircle className="mr-1 h-3 w-3" /> Segna job consegnato all'agente
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={
                      busy ||
                      cancelMut.isPending ||
                      a.agent_status === "not_prepared" ||
                      a.agent_status === "cancelled"
                    }
                    onClick={() => {
                      if (!window.confirm("Annullare il job per l'agente locale?")) return;
                      setBusyId(item.id);
                      cancelMut.mutate(item);
                    }}
                  >
                    <XCircle className="mr-1 h-3 w-3" /> Annulla job agente
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/60 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
