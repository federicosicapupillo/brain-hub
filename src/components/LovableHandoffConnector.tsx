import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Rocket,
  Copy,
  ExternalLink,
  Send,
  Save,
  AlertTriangle,
  ShieldCheck,
  Info,
} from "lucide-react";
import {
  getAutomationRun,
  RUN_STATUS_LABELS,
  type ItemLike,
  type LogEventType,
} from "@/lib/automation-run";

export type LovableHandoffStatus =
  | "draft"
  | "prepared"
  | "opened"
  | "copied"
  | "sent_manually"
  | "result_pending"
  | "result_saved"
  | "failed";

export type LovableHandoffMeta = {
  lovable_project_url: string;
  handoff_status: LovableHandoffStatus;
  prompt_copied_at: string | null;
  lovable_opened_at: string | null;
  sent_manually_at: string | null;
  result_saved_at: string | null;
  last_error: string | null;
  notes: string;
  future_automation_mode: "manual_copy" | "playwright_local" | "browser_use" | "external_agent";
  updated_at: string;
};

const DEFAULT_HANDOFF: LovableHandoffMeta = {
  lovable_project_url: "",
  handoff_status: "draft",
  prompt_copied_at: null,
  lovable_opened_at: null,
  sent_manually_at: null,
  result_saved_at: null,
  last_error: null,
  notes: "",
  future_automation_mode: "manual_copy",
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

export const CANONICAL_LOVABLE_URLS: Record<string, string> = {
  "sica industrial radar": "https://lovable.dev/projects/eee33a88-bfe7-4e07-a872-6ea47a89e641",
  "furia immobiliare": "https://lovable.dev/projects/c4e1d01b-1e1d-4552-90f5-6a8dbe4cbb6d",
  "brain hub": "https://lovable.dev/projects/1680bc9b-5bc8-47f2-9477-f4fa60593f9c",
};

function canonicalUrlForBrainName(name: string | null | undefined): string | null {
  if (!name) return null;
  return CANONICAL_LOVABLE_URLS[name.trim().toLowerCase()] ?? null;
}

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

function getHandoff(item: ClipItem): LovableHandoffMeta {
  const m = (item.metadata as Record<string, unknown> | null) ?? {};
  const h = m.lovable_handoff as Partial<LovableHandoffMeta> | undefined;
  if (!h || typeof h !== "object") return { ...DEFAULT_HANDOFF };
  return { ...DEFAULT_HANDOFF, ...h };
}

function reviewStatus(i: ClipItem): string | null {
  const m = (i.metadata as Record<string, unknown> | null) ?? {};
  const r = m.post_execution_review as { review_status?: string } | undefined;
  return r?.review_status ?? null;
}

function resultMeta(i: ClipItem): Record<string, unknown> | null {
  const m = (i.metadata as Record<string, unknown> | null) ?? {};
  return (m.result_meta as Record<string, unknown> | null) ?? null;
}

function isLovableTarget(i: ClipItem): boolean {
  const run = getAutomationRun(i);
  const tool = (i.target_tool ?? "").toLowerCase();
  const target = (run.target ?? "").toLowerCase();
  return tool === "lovable" || target === "lovable";
}

function isEligible(i: ClipItem): { ok: boolean; reason?: string } {
  if (i.content_type !== "execution_package") return { ok: false, reason: "non execution_package" };
  if (!isLovableTarget(i)) return { ok: false, reason: "target non Lovable" };
  const run = getAutomationRun(i);
  if (!["approved", "queued", "running"].includes(run.run_status))
    return { ok: false, reason: `run_status: ${run.run_status}` };
  const dryRunMeta = (run as unknown as { dry_run?: { enabled?: boolean } }).dry_run;
  if (dryRunMeta?.enabled === true && run.run_status === "running")
    return { ok: false, reason: "dry run attivo" };
  if (reviewStatus(i) === "approvato") return { ok: false, reason: "risultato già approvato" };
  return { ok: true };
}

function buildLovablePrompt(item: ClipItem): string {
  const m = (item.metadata as Record<string, unknown> | null) ?? {};
  const pkg = (m.execution_package as Record<string, unknown> | undefined) ?? {};
  const promptOnly = (pkg.promptOnly as string | undefined)?.trim();
  if (promptOnly) return promptOnly;
  return (item.content ?? "").trim();
}

type SaveDialogState = {
  item: ClipItem;
  text: string;
  buildOk: "ok" | "failed" | "not_verified";
  consoleErrors: "yes" | "no" | "not_verified";
  files: string;
  notes: string;
};

type InstructionsDialogState = {
  item: ClipItem;
};

export function LovableHandoffConnector() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["lovable-handoff"],
    queryFn: fetchData,
    refetchInterval: 30000,
  });

  const [urlEdits, setUrlEdits] = useState<Record<string, string>>({});
  const [saveDlg, setSaveDlg] = useState<SaveDialogState | null>(null);
  const [instructionsDlg, setInstructionsDlg] = useState<InstructionsDialogState | null>(null);

  const items = data?.items ?? [];
  const brains = data?.brains ?? [];
  const brainMap = useMemo(() => new Map(brains.map((b) => [b.id, b])), [brains]);
  const lovableLinkByBrain = useMemo(() => {
    const m = new Map<string, LovableLinkRow>();
    for (const l of data?.lovableLinks ?? []) {
      if (l.brain_id) m.set(l.brain_id, l);
    }
    return m;
  }, [data?.lovableLinks]);

  /** project-level Lovable URL: stored row first, else canonical mapping by brain name */
  const projectUrlForBrain = (brainId: string | null | undefined): string => {
    if (!brainId) return "";
    const stored = lovableLinkByBrain.get(brainId)?.url?.trim();
    if (stored) return stored;
    const b = brainMap.get(brainId);
    return canonicalUrlForBrainName(b?.name) ?? "";
  };

  /** Sync canonical URLs into project_links once per dataset load. */
  const syncedRef = useRef<string>("");
  useEffect(() => {
    if (!data) return;
    const sig = `${brains.length}:${data.lovableLinks.length}`;
    if (syncedRef.current === sig) return;
    syncedRef.current = sig;
    void (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) return;
      for (const b of brains) {
        const canonical = canonicalUrlForBrainName(b.name);
        if (!canonical) continue;
        const existing = lovableLinkByBrain.get(b.id);
        if (existing) {
          if ((existing.url ?? "").trim() !== canonical) {
            await supabase
              .from("project_links")
              .update({ url: canonical, updated_at: new Date().toISOString() } as never)
              .eq("id", existing.id);
          }
        } else {
          await supabase.from("project_links").insert({
            user_id: userData.user.id,
            brain_id: b.id,
            link_type: "external",
            tool: "lovable",
            title: `Lovable · ${b.name}`,
            url: canonical,
            relation_type: "lovable_project",
            notes: "URL Lovable progetto (auto-mappato)",
          } as never);
        }
      }
      qc.invalidateQueries({ queryKey: ["lovable-handoff"] });
    })();
  }, [data, brains, lovableLinkByBrain, qc]);

  const eligible = useMemo(
    () => items.map((i) => ({ item: i, info: isEligible(i) })).filter((x) => x.info.ok),
    [items],
  );


  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["lovable-handoff"] });
    qc.invalidateQueries({ queryKey: ["automation-control"] });
    qc.invalidateQueries({ queryKey: ["automation-run-panel"] });
    qc.invalidateQueries({ queryKey: ["project-loop"] });
  };

  async function logEvent(
    item: ClipItem,
    action: LogEventType,
    notes: string,
    extra?: Record<string, unknown>,
  ) {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return;
    await supabase.from("clipboard_execution_logs").insert({
      user_id: userData.user.id,
      clipboard_item_id: item.id,
      action,
      notes,
      metadata: {
        clipboard_item_id: item.id,
        brain_id: item.brain_id,
        connector: "lovable_handoff",
        ...(extra ?? {}),
      },
    } as never);
  }

  async function persistHandoff(item: ClipItem, patch: Partial<LovableHandoffMeta>) {
    const prevMeta = (item.metadata as Record<string, unknown> | null) ?? {};
    const prev = getHandoff(item);
    const next: LovableHandoffMeta = {
      ...prev,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    const { error: upErr } = await supabase
      .from("clipboard_items")
      .update({ metadata: { ...prevMeta, lovable_handoff: next } } as never)
      .eq("id", item.id);
    if (upErr) throw upErr;
    return next;
  }

  const saveUrlMut = useMutation({
    mutationFn: async ({ item, url }: { item: ClipItem; url: string }) => {
      const clean = url.trim();
      if (clean && !/^https?:\/\//i.test(clean)) {
        throw new Error("URL deve iniziare con http:// o https://");
      }
      await persistHandoff(item, { lovable_project_url: clean });
      return { id: item.id };
    },
    onSuccess: ({ id }) => {
      toast.success("URL Lovable salvato");
      setUrlEdits((s) => {
        const n = { ...s };
        delete n[id];
        return n;
      });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function copyPromptOnly(item: ClipItem) {
    const prompt = buildLovablePrompt(item);
    if (!prompt) {
      toast.error("Prompt vuoto");
      return;
    }
    if (item.risk_level === "alto") {
      const ok = window.confirm("Item ad alto rischio. Confermi la preparazione invio a Lovable?");
      if (!ok) return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      toast.error("Impossibile copiare negli appunti");
      return;
    }
    await persistHandoff(item, {
      handoff_status: "copied",
      prompt_copied_at: new Date().toISOString(),
    });
    await logEvent(item, "lovable_prompt_copied", "Prompt Lovable copiato negli appunti");
    invalidate();
    toast.success("Prompt Lovable copiato. Apri Lovable e incollalo nella chat del progetto.");
  }

  async function openLovableOnly(item: ClipItem) {
    const h = getHandoff(item);
    if (!h.lovable_project_url) {
      toast.error("Salva prima l'URL del progetto Lovable");
      return;
    }
    window.open(h.lovable_project_url, "_blank", "noopener,noreferrer");
    await persistHandoff(item, {
      handoff_status: h.handoff_status === "copied" ? "copied" : "opened",
      lovable_opened_at: new Date().toISOString(),
    });
    await logEvent(item, "lovable_project_opened", "Progetto Lovable aperto in nuova tab");
    invalidate();
  }

  async function openAndCopy(item: ClipItem) {
    const h = getHandoff(item);
    if (!h.lovable_project_url) {
      toast.error("Salva prima l'URL del progetto Lovable");
      return;
    }
    const prompt = buildLovablePrompt(item);
    if (!prompt) {
      toast.error("Prompt vuoto");
      return;
    }
    if (item.risk_level === "alto") {
      const ok = window.confirm("Item ad alto rischio. Confermi l'apertura e la copia del prompt?");
      if (!ok) return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      toast.error("Impossibile copiare negli appunti");
      return;
    }
    window.open(h.lovable_project_url, "_blank", "noopener,noreferrer");
    const now = new Date().toISOString();
    await persistHandoff(item, {
      handoff_status: "copied",
      prompt_copied_at: now,
      lovable_opened_at: now,
    });
    await logEvent(item, "lovable_project_opened", "Progetto Lovable aperto in nuova tab");
    await logEvent(item, "lovable_prompt_copied", "Prompt Lovable copiato negli appunti");
    invalidate();
    setInstructionsDlg({ item });
  }

  const sentManuallyMut = useMutation({
    mutationFn: async (item: ClipItem) => {
      const prevMeta = (item.metadata as Record<string, unknown> | null) ?? {};
      const prevRun = getAutomationRun(item);
      const nextRun = {
        ...prevRun,
        run_status:
          prevRun.run_status === "approved" || prevRun.run_status === "queued"
            ? ("running" as const)
            : prevRun.run_status,
        started_at: prevRun.started_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const prevHandoff = getHandoff(item);
      const nextHandoff: LovableHandoffMeta = {
        ...prevHandoff,
        handoff_status: "sent_manually",
        sent_manually_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { error: upErr } = await supabase
        .from("clipboard_items")
        .update({
          metadata: { ...prevMeta, automation_run: nextRun, lovable_handoff: nextHandoff },
        } as never)
        .eq("id", item.id);
      if (upErr) throw upErr;
      await logEvent(item, "lovable_prompt_sent_manually", "Prompt Lovable segnato come inviato");
    },
    onSuccess: () => {
      toast.success("Segnato come inviato manualmente");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveResultMut = useMutation({
    mutationFn: async (st: SaveDialogState) => {
      const text = st.text.trim();
      if (!text) throw new Error("Inserisci il risultato Lovable");
      const item = st.item;
      const prevMeta = (item.metadata as Record<string, unknown> | null) ?? {};
      const prevRun = getAutomationRun(item);
      const nowIso = new Date().toISOString();
      const files = st.files
        .split(/\r?\n|,/)
        .map((s) => s.trim())
        .filter(Boolean);
      const nextRun = {
        ...prevRun,
        run_status: "completed" as const,
        completed_at: nowIso,
        updated_at: nowIso,
      };
      const result_meta = {
        ...(prevMeta.result_meta as Record<string, unknown> | undefined),
        source: "lovable_manual",
        is_simulated: false,
        build_status: st.buildOk,
        console_errors: st.consoleErrors,
        modified_files: files,
        notes: st.notes,
        received_at: nowIso,
      };
      const prevHandoff = getHandoff(item);
      const nextHandoff: LovableHandoffMeta = {
        ...prevHandoff,
        handoff_status: "result_saved",
        result_saved_at: nowIso,
        updated_at: nowIso,
      };
      const { error: upErr } = await supabase
        .from("clipboard_items")
        .update({
          output_result: text,
          metadata: {
            ...prevMeta,
            automation_run: nextRun,
            result_meta,
            lovable_handoff: nextHandoff,
          },
        } as never)
        .eq("id", item.id);
      if (upErr) throw upErr;
      await logEvent(item, "lovable_result_saved", "Risultato Lovable salvato", {
        build_status: st.buildOk,
        console_errors: st.consoleErrors,
        modified_files_count: files.length,
      });
    },
    onSuccess: () => {
      toast.success("Risultato Lovable salvato");
      setSaveDlg(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Caricamento Lovable Handoff…</div>;
  if (error) return <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Rocket className="h-4 w-4" /> Lovable Handoff
          <Badge variant="outline" className="ml-2 text-[10px]">semi-automatico · no browser automation</Badge>
          <Badge variant="outline" className="text-[10px]">{eligible.length} eligibili</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs space-y-1">
          <div className="flex items-center gap-1 font-medium">
            <ShieldCheck className="h-3 w-3 text-emerald-400" /> Modalità sicura
          </div>
          <p className="text-muted-foreground">
            Il connettore prepara il prompt e l&apos;apertura del progetto Lovable. Nessuna credenziale, nessun token, nessuna automazione browser viene eseguita dal frontend.
          </p>
        </div>

        <details className="rounded-md border border-blue-500/40 bg-blue-500/5 p-3">
          <summary className="cursor-pointer text-sm font-medium flex items-center gap-2">
            <Info className="h-3 w-3 text-blue-400" /> Futura automazione Playwright
          </summary>
          <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
            <div><span className="font-medium text-foreground">Modalità attuale:</span> manual_copy</div>
            <div><span className="font-medium text-foreground">Modalità futura:</span> playwright_local / browser_use</div>
            <div><span className="font-medium text-foreground">Automazione reale:</span> non attiva</div>
            <p className="pt-1">
              L&apos;incollaggio automatico reale in Lovable richiederà un agente locale o browser automation controllata (Playwright / Browser Use), eseguito fuori dal frontend. Questa sezione resterà manuale finché quell&apos;agente non sarà disponibile.
            </p>
          </div>
        </details>

        {eligible.length === 0 && (
          <div className="rounded-md border border-border/60 p-4 text-sm text-muted-foreground">
            Nessun Execution Package Lovable eleggibile (richiede target Lovable, run_status approved/queued/running, nessun dry run attivo, nessun risultato già approvato).
          </div>
        )}

        <div className="space-y-2">
          {eligible.map(({ item }) => {
            const run = getAutomationRun(item);
            const brain = item.brain_id ? brainMap.get(item.brain_id) : null;
            const pkg =
              ((item.metadata as Record<string, unknown> | null)?.execution_package as
                | { package_type?: string }
                | undefined)?.package_type ?? "standard";
            const h = getHandoff(item);
            const editing = urlEdits[item.id];
            const urlValue = editing ?? h.lovable_project_url ?? "";
            const hasUrl = h.lovable_project_url.trim().length > 0;
            const rm = resultMeta(item);
            const alreadySavedLovable =
              h.handoff_status === "result_saved" || rm?.source === "lovable_manual";
            return (
              <div key={item.id} className="rounded-md border border-border/60 p-3 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{item.title || "(senza titolo)"}</div>
                    <div className="text-xs text-muted-foreground">
                      {brain?.name ?? "—"} · {pkg} · target: {run.target}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      copiato: {h.prompt_copied_at ? new Date(h.prompt_copied_at).toLocaleString() : "—"}
                      {" · "}aperto: {h.lovable_opened_at ? new Date(h.lovable_opened_at).toLocaleString() : "—"}
                      {" · "}inviato: {h.sent_manually_at ? new Date(h.sent_manually_at).toLocaleString() : "—"}
                      {" · "}salvato: {h.result_saved_at ? new Date(h.result_saved_at).toLocaleString() : "—"}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {item.risk_level && (
                      <Badge variant="outline" className="text-[10px]">risk: {item.risk_level}</Badge>
                    )}
                    <Badge variant="secondary" className="text-[10px]">pkg: {item.automation_status}</Badge>
                    <Badge className="bg-blue-500/15 text-blue-300 text-[10px]">
                      run: {RUN_STATUS_LABELS[run.run_status]}
                    </Badge>
                    <Badge className="bg-fuchsia-500/15 text-fuchsia-300 text-[10px]">
                      handoff: {h.handoff_status}
                    </Badge>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <div className="text-[11px] text-muted-foreground shrink-0">URL progetto Lovable:</div>
                  <Input
                    className="h-7 text-xs flex-1 min-w-[240px]"
                    placeholder="https://lovable.dev/projects/..."
                    value={urlValue}
                    onChange={(e) =>
                      setUrlEdits((s) => ({ ...s, [item.id]: e.target.value }))
                    }
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saveUrlMut.isPending || editing === undefined}
                    onClick={() => saveUrlMut.mutate({ item, url: urlValue })}
                  >
                    Salva URL
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => copyPromptOnly(item)}>
                    <Copy className="mr-1 h-3 w-3" /> Prepara invio a Lovable
                  </Button>
                  <Button size="sm" variant="outline" disabled={!hasUrl} onClick={() => openLovableOnly(item)}>
                    <ExternalLink className="mr-1 h-3 w-3" /> Apri Lovable
                  </Button>
                  <Button size="sm" variant="outline" disabled={!hasUrl} onClick={() => openAndCopy(item)}>
                    <Rocket className="mr-1 h-3 w-3" /> Apri Lovable + Copia prompt
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => sentManuallyMut.mutate(item)}
                    disabled={sentManuallyMut.isPending}
                  >
                    <Send className="mr-1 h-3 w-3" /> Segna inviato manualmente
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() =>
                      setSaveDlg({
                        item,
                        text: "",
                        buildOk: "not_verified",
                        consoleErrors: "not_verified",
                        files: "",
                        notes: "",
                      })
                    }
                  >
                    <Save className="mr-1 h-3 w-3" /> Salva risultato Lovable
                  </Button>
                  {alreadySavedLovable && (
                    <Badge className="bg-emerald-500/15 text-emerald-300 text-[10px]">risultato salvato</Badge>
                  )}
                </div>

                {!hasUrl && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-amber-300">
                    <AlertTriangle className="inline h-3 w-3 mr-1" />
                    Salva l&apos;URL del progetto Lovable per abilitare l&apos;apertura in nuova tab.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>

      {/* Instructions modal (after open + copy) */}
      <Dialog open={!!instructionsDlg} onOpenChange={(o) => !o && setInstructionsDlg(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Istruzioni handoff Lovable</DialogTitle>
          </DialogHeader>
          <ol className="list-decimal pl-5 text-sm space-y-1">
            <li>Incolla il prompt nella chat Lovable</li>
            <li>Avvia la modifica</li>
            <li>Copia il risultato restituito da Lovable</li>
            <li>Torna nel Brain Hub</li>
            <li>Clicca &quot;Salva risultato Lovable&quot;</li>
          </ol>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInstructionsDlg(null)}>
              Ho capito
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save result modal */}
      <Dialog open={!!saveDlg} onOpenChange={(o) => !o && setSaveDlg(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Salva risultato Lovable — {saveDlg?.item.title}</DialogTitle>
          </DialogHeader>
          {saveDlg && (
            <div className="space-y-3 text-sm">
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Risultato Lovable</div>
                <Textarea
                  rows={8}
                  value={saveDlg.text}
                  onChange={(e) => setSaveDlg({ ...saveDlg, text: e.target.value })}
                  placeholder="Incolla qui il risultato restituito da Lovable"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Build</div>
                  <div className="flex gap-2 text-xs">
                    {(["ok", "failed", "not_verified"] as const).map((v) => (
                      <label key={v} className="flex items-center gap-1">
                        <input
                          type="radio"
                          name="buildOk"
                          checked={saveDlg.buildOk === v}
                          onChange={() => setSaveDlg({ ...saveDlg, buildOk: v })}
                        />
                        {v}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Console errors</div>
                  <div className="flex gap-2 text-xs">
                    {(["yes", "no", "not_verified"] as const).map((v) => (
                      <label key={v} className="flex items-center gap-1">
                        <input
                          type="radio"
                          name="consoleErrors"
                          checked={saveDlg.consoleErrors === v}
                          onChange={() => setSaveDlg({ ...saveDlg, consoleErrors: v })}
                        />
                        {v}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">File modificati (uno per riga o separati da virgola)</div>
                <Textarea
                  rows={3}
                  value={saveDlg.files}
                  onChange={(e) => setSaveDlg({ ...saveDlg, files: e.target.value })}
                  placeholder="src/components/Foo.tsx, src/lib/bar.ts"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Note</div>
                <Textarea
                  rows={2}
                  value={saveDlg.notes}
                  onChange={(e) => setSaveDlg({ ...saveDlg, notes: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDlg(null)}>Annulla</Button>
            <Button
              onClick={() => saveDlg && saveResultMut.mutate(saveDlg)}
              disabled={saveResultMut.isPending}
            >
              <Save className="mr-1 h-3 w-3" /> Salva risultato
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
