import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Inbox, CheckCircle2, AlertTriangle, ShieldAlert } from "lucide-react";
import {
  computeCallbackHash,
  getAutomationRun,
  updateAutomationRun,
  type AutomationRun,
  type ItemLike,
} from "@/lib/automation-run";

const callbackSchema = z.object({
  execution_package_id: z.string().min(1, "execution_package_id mancante"),
  run_id: z.string().optional().nullable(),
  status: z.enum(["completed", "failed"]),
  build_status: z.enum(["ok", "failed", "not_verified"]).optional(),
  console_errors: z.boolean().optional(),
  modified_files: z.array(z.string()).optional(),
  summary: z.string().max(5000).optional(),
  notes: z.string().max(5000).optional(),
  external_result_reference: z.string().max(500).optional().nullable(),
  raw_output: z.string().max(20000).optional(),
});

export type CallbackPayload = z.infer<typeof callbackSchema>;

type ClipItem = ItemLike & {
  content: string | null;
  content_type: string | null;
  output_result: string | null;
  metadata: Record<string, unknown> | null;
};

type ValidationOk = {
  ok: true;
  payload: CallbackPayload;
  item: ClipItem;
  run: AutomationRun;
  warnings: string[];
};
type ValidationErr = { ok: false; errors: string[] };

export type CallbackPrefill = Partial<CallbackPayload>;

async function fetchInboxItems() {
  const { data, error } = await supabase
    .from("clipboard_items")
    .select("id,brain_id,title,content,content_type,target_tool,automation_status,risk_level,output_result,metadata,updated_at")
    .eq("content_type", "execution_package")
    .order("updated_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return (data ?? []) as ClipItem[];
}

export function CallbackInboxSection({ prefill, onConsumePrefill }: { prefill: CallbackPrefill | null; onConsumePrefill: () => void }) {
  const qc = useQueryClient();
  const [raw, setRaw] = useState("");
  const [validation, setValidation] = useState<ValidationOk | ValidationErr | null>(null);
  const [forceOverwrite, setForceOverwrite] = useState(false);

  const { data: items = [] } = useQuery({ queryKey: ["callback-inbox-items"], queryFn: fetchInboxItems, refetchInterval: 30000 });
  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  useEffect(() => {
    if (prefill) {
      const body = {
        execution_package_id: prefill.execution_package_id ?? "",
        run_id: prefill.run_id ?? "",
        status: prefill.status ?? "completed",
        build_status: prefill.build_status ?? "not_verified",
        console_errors: prefill.console_errors ?? false,
        modified_files: prefill.modified_files ?? [],
        summary: prefill.summary ?? "",
        notes: prefill.notes ?? "",
        external_result_reference: prefill.external_result_reference ?? "",
        raw_output: prefill.raw_output ?? "",
      };
      setRaw(JSON.stringify(body, null, 2));
      setValidation(null);
      setForceOverwrite(false);
      onConsumePrefill();
    }
  }, [prefill, onConsumePrefill]);

  function validate() {
    setForceOverwrite(false);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      setValidation({ ok: false, errors: [`JSON non valido: ${(e as Error).message}`] });
      return;
    }
    const r = callbackSchema.safeParse(parsed);
    if (!r.success) {
      setValidation({ ok: false, errors: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) });
      return;
    }
    const payload = r.data;
    const item = itemsById.get(payload.execution_package_id);
    if (!item) {
      setValidation({ ok: false, errors: [`Execution Package ${payload.execution_package_id} non trovato`] });
      return;
    }
    if (item.content_type !== "execution_package") {
      setValidation({ ok: false, errors: ["Item esiste ma non è un execution_package"] });
      return;
    }
    const run = getAutomationRun(item);
    const warnings: string[] = [];
    if (payload.run_id && payload.run_id !== run.run_id) {
      setValidation({
        ok: false,
        errors: [`Mismatch run_id: callback=${payload.run_id} · ledger=${run.run_id}`],
      });
      return;
    }
    if (!payload.run_id) {
      warnings.push("run_id assente nel JSON, uso la run corrente dell'item");
    }
    const prevResultMeta = (item.metadata as Record<string, unknown> | null)?.result_meta as
      | { external_result_reference?: string | null; callback_hash?: string | null }
      | undefined;
    if (
      payload.external_result_reference &&
      prevResultMeta?.external_result_reference &&
      prevResultMeta.external_result_reference === payload.external_result_reference
    ) {
      warnings.push("Callback già applicata (external_result_reference identica). Servirà conferma per sovrascrivere.");
    }
    const incomingHash = computeCallbackHash({
      execution_package_id: payload.execution_package_id,
      run_id: payload.run_id ?? run.run_id,
      status: payload.status,
      build_status: payload.build_status ?? null,
      summary: payload.summary ?? null,
      raw_output: payload.raw_output ?? null,
    });
    if (prevResultMeta?.callback_hash && prevResultMeta.callback_hash === incomingHash) {
      warnings.push(`Callback già applicata (callback_hash identico: ${incomingHash}). Servirà conferma per sovrascrivere.`);
    }
    if (["completed", "failed", "cancelled"].includes(run.run_status) && payload.external_result_reference) {
      warnings.push(`Run già in stato ${run.run_status}. Applicare sovrascriverà i dati.`);
    }
    setValidation({ ok: true, payload, item, run, warnings });
  }

  const applyMut = useMutation({
    mutationFn: async (v: ValidationOk) => {
      const { payload, item } = v;
      const prevMeta = (item.metadata as Record<string, unknown> | null) ?? {};
      const prevResultMeta = (prevMeta.result_meta as Record<string, unknown> | undefined) ?? {};
      const alreadyApplied =
        !!payload.external_result_reference &&
        prevResultMeta.external_result_reference === payload.external_result_reference;
      if (alreadyApplied && !forceOverwrite) {
        throw new Error("Callback già applicata a questa run");
      }
      const now = new Date().toISOString();
      const resultMeta = {
        ...prevResultMeta,
        build_status: payload.build_status ?? "not_verified",
        console_errors: payload.console_errors ?? false,
        modified_files: payload.modified_files ?? [],
        summary: payload.summary ?? "",
        notes: payload.notes ?? "",
        external_result_reference: payload.external_result_reference ?? null,
        source: "callback_inbox",
        received_at: now,
      };

      // Apply ledger transition (this also persists metadata + writes log)
      if (payload.status === "completed") {
        const output = (payload.raw_output ?? payload.summary ?? "").toString();
        // Persist output_result and result_meta first
        const { error: upErr } = await supabase
          .from("clipboard_items")
          .update({
            output_result: output,
            metadata: { ...prevMeta, result_meta: resultMeta },
          } as never)
          .eq("id", item.id);
        if (upErr) throw upErr;
        // Refresh item for ledger update (it merges metadata fresh from arg)
        const refreshed = { ...item, metadata: { ...prevMeta, result_meta: resultMeta } } as ItemLike;
        await updateAutomationRun(
          refreshed,
          {
            run_status: "completed",
            completed_at: now,
            external_result_reference: payload.external_result_reference ?? null,
            execution_notes: payload.notes ?? payload.summary ?? "",
          },
          "automation_completed",
          { notes: payload.summary || "Callback completed" },
        );
      } else {
        const errMsg = payload.summary || payload.notes || "Run fallita via callback";
        const { error: upErr } = await supabase
          .from("clipboard_items")
          .update({ metadata: { ...prevMeta, result_meta: resultMeta } } as never)
          .eq("id", item.id);
        if (upErr) throw upErr;
        const refreshed = { ...item, metadata: { ...prevMeta, result_meta: resultMeta } } as ItemLike;
        await updateAutomationRun(
          refreshed,
          {
            run_status: "failed",
            failed_at: now,
            last_error: errMsg,
            execution_notes: payload.notes ?? "",
          },
          "automation_failed",
          { notes: errMsg },
        );
      }

      // Generic "callback_received" event for the timeline
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user) {
        await supabase.from("clipboard_execution_logs").insert({
          user_id: userData.user.id,
          clipboard_item_id: item.id,
          action: "automation_callback_received",
          notes: payload.summary || payload.notes || `Callback ${payload.status}`,
          new_status: payload.status,
          metadata: {
            clipboard_item_id: item.id,
            brain_id: item.brain_id,
            source: "callback_inbox",
            build_status: payload.build_status ?? "not_verified",
            console_errors: payload.console_errors ?? false,
            modified_files: payload.modified_files ?? [],
            external_result_reference: payload.external_result_reference ?? null,
            status: payload.status,
          },
        } as never);
      }
    },
    onSuccess: (_d, v) => {
      toast.success(`Callback applicata: ${v.payload.status}`);
      setRaw("");
      setValidation(null);
      setForceOverwrite(false);
      qc.invalidateQueries({ queryKey: ["callback-inbox-items"] });
      qc.invalidateQueries({ queryKey: ["automation-run-panel"] });
      qc.invalidateQueries({ queryKey: ["automation-control"] });
      qc.invalidateQueries({ queryKey: ["project-loop"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function apply() {
    if (!validation || !validation.ok) {
      toast.error("Valida prima il JSON");
      return;
    }
    const needsConfirm = validation.warnings.some((w) => w.includes("già applicata")) && !forceOverwrite;
    if (needsConfirm) {
      const ok = window.confirm("Callback già applicata. Vuoi sovrascrivere?");
      if (!ok) return;
      setForceOverwrite(true);
      // Re-trigger after state set
      setTimeout(() => applyMut.mutate(validation), 0);
      return;
    }
    applyMut.mutate(validation);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="h-4 w-4" /> Callback Inbox
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          Incolla manualmente il JSON risultato di una run. Nessuna chiamata esterna, solo simulazione locale.
        </div>
        <Textarea
          rows={10}
          className="font-mono text-xs"
          placeholder={`{\n  "execution_package_id": "...",\n  "run_id": "...",\n  "status": "completed",\n  "build_status": "ok",\n  "console_errors": false,\n  "modified_files": [],\n  "summary": "...",\n  "notes": "...",\n  "external_result_reference": "...",\n  "raw_output": "..."\n}`}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={validate} disabled={!raw.trim()}>
            <ShieldAlert className="mr-1 h-3 w-3" /> Valida callback
          </Button>
          <Button
            size="sm"
            onClick={apply}
            disabled={!validation?.ok || applyMut.isPending}
          >
            <CheckCircle2 className="mr-1 h-3 w-3" /> Applica risultato
          </Button>
        </div>

        {validation && !validation.ok && (
          <div className="rounded-md border border-red-500/40 bg-red-500/5 p-3 text-xs text-red-300">
            <div className="mb-1 flex items-center gap-1 font-medium">
              <AlertTriangle className="h-3 w-3" /> Validazione fallita
            </div>
            <ul className="list-disc pl-4">
              {validation.errors.map((e, idx) => <li key={idx}>{e}</li>)}
            </ul>
          </div>
        )}

        {validation?.ok && (
          <div className="space-y-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[10px]">{validation.payload.status}</Badge>
              <Badge variant="outline" className="text-[10px]">build: {validation.payload.build_status ?? "not_verified"}</Badge>
              <Badge variant="outline" className="text-[10px]">
                console_errors: {String(validation.payload.console_errors ?? false)}
              </Badge>
              <span className="text-muted-foreground">item: {validation.item.title || validation.item.id}</span>
              <span className="text-muted-foreground">run: {validation.run.run_id}</span>
            </div>
            {validation.warnings.length > 0 && (
              <ul className="list-disc pl-4 text-amber-300">
                {validation.warnings.map((w, idx) => <li key={idx}>{w}</li>)}
              </ul>
            )}
            {validation.payload.summary && (
              <div><span className="text-muted-foreground">summary:</span> {validation.payload.summary}</div>
            )}
            {validation.payload.notes && (
              <div><span className="text-muted-foreground">notes:</span> {validation.payload.notes}</div>
            )}
            {validation.payload.modified_files && validation.payload.modified_files.length > 0 && (
              <div>
                <span className="text-muted-foreground">modified_files:</span>{" "}
                {validation.payload.modified_files.join(", ")}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
