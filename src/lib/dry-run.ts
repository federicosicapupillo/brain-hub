import { supabase } from "@/integrations/supabase/client";
import {
  computeCallbackHash,
  getAutomationRun,
  updateAutomationRun,
  type AutomationRun,
  type DryRunMeta,
  type ItemLike,
  type LogEventType,
  type PreviousStateSnapshot,
} from "./automation-run";

export type DryRunScenario =
  | "success_complete"
  | "success_warning"
  | "build_failed"
  | "partial"
  | "protected_areas"
  | "invalid_callback";

export const DRY_RUN_SCENARIO_LABELS: Record<DryRunScenario, string> = {
  success_complete: "Successo completo",
  success_warning: "Successo con warning",
  build_failed: "Fallimento build",
  partial: "Risultato parziale",
  protected_areas: "Aree protette toccate",
  invalid_callback: "Callback non valida",
};

export type DryRunResult = {
  ok: boolean;
  result: DryRunMeta["result"];
  scenario: DryRunScenario;
  notes: string;
  finalRunStatus: AutomationRun["run_status"];
  suggestedNextAction: "approved" | "next_prompt" | "fix_prompt" | "block_loop" | "retry" | "none";
};

type SimCallback = {
  status: "completed" | "failed";
  build_status: "ok" | "failed" | "not_verified";
  console_errors: boolean;
  modified_files: string[];
  protected_areas_touched?: boolean;
  result_summary?: string;
  summary: string;
  notes: string;
  raw_output: string;
  invalid?: { reason: string; run_id_override?: string };
};

function buildSimCallback(scenario: DryRunScenario, item: ItemLike): SimCallback {
  const title = item.title || "(senza titolo)";
  switch (scenario) {
    case "success_complete":
      return {
        status: "completed",
        build_status: "ok",
        console_errors: false,
        modified_files: ["src/example/Component.tsx"],
        summary: `Dry run OK — ${title}`,
        notes: "Tutti i criteri soddisfatti",
        raw_output: `Risultato simulato (success_complete) per ${title}`,
      };
    case "success_warning":
      return {
        status: "completed",
        build_status: "ok",
        console_errors: true,
        modified_files: ["src/example/Component.tsx"],
        summary: `Build ok ma warning console — ${title}`,
        notes: "Warning console rilevati: verifica logs",
        raw_output: `Risultato simulato (success_warning) per ${title}`,
      };
    case "build_failed":
      return {
        status: "failed",
        build_status: "failed",
        console_errors: true,
        modified_files: [],
        summary: `Build fallita — ${title}`,
        notes: "Errore di compilazione simulato",
        raw_output: `TypeError: example failure in ${title}`,
      };
    case "partial":
      return {
        status: "completed",
        build_status: "ok",
        console_errors: false,
        modified_files: ["src/example/Partial.tsx"],
        result_summary: "modifica_incompleta",
        summary: `Modifica parziale — ${title}`,
        notes: "Solo parte dei requisiti implementata",
        raw_output: `Risultato simulato (partial) per ${title}`,
      };
    case "protected_areas":
      return {
        status: "completed",
        build_status: "ok",
        console_errors: false,
        modified_files: ["src/integrations/supabase/client.ts", "src/components/AppSidebar.tsx"],
        protected_areas_touched: true,
        summary: `Aree protette toccate — ${title}`,
        notes: "Lovable ha modificato file in aree protette",
        raw_output: `Risultato simulato (protected_areas) per ${title}`,
      };
    case "invalid_callback":
      return {
        status: "completed",
        build_status: "not_verified",
        console_errors: false,
        modified_files: [],
        summary: "",
        notes: "",
        raw_output: "",
        invalid: { reason: "run_id non corrisponde alla run corrente", run_id_override: "run_invalid_xxx" },
      };
  }
}

async function insertLog(
  item: ItemLike,
  action: LogEventType,
  notes: string,
  extra: Record<string, unknown> = {},
  status?: { previous?: string | null; new?: string | null },
) {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) throw new Error("Non autenticato");
  const { error } = await supabase.from("clipboard_execution_logs").insert({
    user_id: userData.user.id,
    clipboard_item_id: item.id,
    action,
    previous_status: status?.previous ?? null,
    new_status: status?.new ?? null,
    notes,
    metadata: {
      clipboard_item_id: item.id,
      brain_id: item.brain_id,
      dry_run: true,
      ...extra,
    },
  } as never);
  if (error) throw error;
}

async function refreshItem(id: string): Promise<ItemLike & { output_result: string | null }> {
  const { data, error } = await supabase
    .from("clipboard_items")
    .select("id,brain_id,title,content,content_type,target_tool,automation_status,risk_level,metadata,output_result")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as ItemLike & { output_result: string | null };
}

/**
 * Detect if an item already holds a "real" (non-simulated) result that a dry run would overwrite.
 */
export function hasRealResult(item: ItemLike & { output_result?: string | null }): {
  hasReal: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const meta = (item.metadata as Record<string, unknown> | null) ?? {};
  const rm = meta.result_meta as { source?: string; is_simulated?: boolean } | undefined;
  const run = getAutomationRun(item);
  const review = meta.post_execution_review as { review_status?: string } | undefined;
  const output = (item.output_result ?? "").trim();
  if (output && rm?.source && rm.source !== "dry_run" && rm.is_simulated !== true) {
    reasons.push("output_result reale già presente");
  } else if (output && !rm) {
    reasons.push("output_result presente senza marcatura simulazione");
  }
  if (rm?.source && rm.source !== "dry_run" && rm.is_simulated !== true) {
    reasons.push(`result_meta.source = "${rm.source}"`);
  }
  if (run.run_status === "completed" && rm?.source !== "dry_run" && rm?.is_simulated !== true) {
    reasons.push("run_status = completed (reale)");
  }
  if (review?.review_status === "approved") {
    reasons.push("post_execution_review = approved");
  }
  return { hasReal: reasons.length > 0, reasons };
}

/**
 * Execute a fully internal automation cycle for an execution package.
 * No external calls. Respects single-run-per-item idempotency.
 */
export async function runDryRunScenario(
  itemArg: ItemLike,
  scenario: DryRunScenario,
  opts: { allowRecentDup?: boolean; allowOverwriteReal?: boolean } = {},
): Promise<DryRunResult> {
  if (itemArg.content_type !== "execution_package") {
    throw new Error("Solo gli Execution Package supportano il dry run");
  }
  let item = await refreshItem(itemArg.id);
  let run = getAutomationRun(item);

  // Block if a real run is running
  if (run.run_status === "running") {
    await insertLog(item, "automation_dry_run_blocked", "Run reale in esecuzione: dry run bloccato", {
      scenario,
      run_id: run.run_id,
    });
    return {
      ok: false,
      result: "blocked",
      scenario,
      notes: "Run in esecuzione, dry run bloccato",
      finalRunStatus: run.run_status,
      suggestedNextAction: "none",
    };
  }

  // Strong confirmation: existing real / approved result
  const realCheck = hasRealResult(item);
  if (realCheck.hasReal && !opts.allowOverwriteReal) {
    throw new Error(
      `OVERWRITE_REAL: Questo item ha già un risultato reale o approvato (${realCheck.reasons.join(", ")}). Il dry run potrebbe sovrascrivere dati reali. Confermi?`,
    );
  }

  // Idempotency on recent dry run
  const meta = (item.metadata as Record<string, unknown> | null) ?? {};
  const prevDry = (meta.dry_run_last as DryRunMeta | undefined) ?? (run as unknown as { dry_run?: DryRunMeta }).dry_run;
  if (prevDry?.executed_at && !opts.allowRecentDup) {
    const ageMs = Date.now() - new Date(prevDry.executed_at).getTime();
    if (ageMs < 10 * 60 * 1000) {
      throw new Error(`Dry run recente (${DRY_RUN_SCENARIO_LABELS[prevDry.scenario as DryRunScenario] ?? prevDry.scenario}) eseguito ${Math.round(ageMs / 1000)}s fa. Conferma per rieseguirlo.`);
    }
  }

  // Capture snapshot BEFORE any mutation
  const snapshot: PreviousStateSnapshot = {
    run_status: run.run_status,
    output_result: item.output_result ?? null,
    result_meta: (meta.result_meta as Record<string, unknown> | null) ?? null,
    post_execution_review: (meta.post_execution_review as Record<string, unknown> | null) ?? null,
    captured_at: new Date().toISOString(),
  };


  const startedAt = new Date().toISOString();
  await insertLog(item, "automation_dry_run_started", `Dry run ${DRY_RUN_SCENARIO_LABELS[scenario]} avviato`, {
    scenario,
    run_id: run.run_id,
  });

  // Bring run to "running": approve → queue → start (only if not already there)
  if (run.run_status === "draft") {
    run = await updateAutomationRun(
      item,
      { run_status: "approved", approved_by_user: true, approved_at: startedAt },
      "automation_approved",
      { notes: "Dry run: approvazione automatica" },
    );
    item = await refreshItem(item.id);
  }
  if (run.run_status === "approved") {
    run = await updateAutomationRun(item, { run_status: "queued", queued_at: new Date().toISOString() }, "automation_queued", {
      notes: "Dry run: messa in coda",
    });
    item = await refreshItem(item.id);
  }
  if (run.run_status === "queued" || run.run_status === "failed" || run.run_status === "cancelled" || run.run_status === "blocked" || run.run_status === "completed") {
    // For retry-from-terminal-state, increment retry counter
    const isRetry = ["failed", "cancelled", "blocked", "completed"].includes(run.run_status);
    if (isRetry) {
      run = await updateAutomationRun(
        item,
        { run_status: "queued", queued_at: new Date().toISOString(), retry_count: run.retry_count + 1, last_error: null },
        "automation_retried",
        { notes: "Dry run: retry" },
      );
      item = await refreshItem(item.id);
    }
    run = await updateAutomationRun(item, { run_status: "running", started_at: new Date().toISOString() }, "automation_started", {
      notes: "Dry run: in esecuzione",
    });
    item = await refreshItem(item.id);
  }

  // Build simulated callback
  const sim = buildSimCallback(scenario, item);

  // Invalid callback short-circuit
  if (sim.invalid) {
    await insertLog(
      item,
      "automation_dry_run_failed",
      `Callback non valida: ${sim.invalid.reason}`,
      { scenario, run_id: run.run_id, callback_run_id: sim.invalid.run_id_override, reason: sim.invalid.reason },
    );
    // Persist dry_run meta without touching run_status
    const fresh = (item.metadata as Record<string, unknown> | null) ?? {};
    const dryMeta: DryRunMeta = {
      enabled: true,
      scenario,
      executed_at: startedAt,
      result: "failed",
      notes: `Callback rifiutata: ${sim.invalid.reason}`,
    };
    await supabase
      .from("clipboard_items")
      .update({
        metadata: {
          ...fresh,
          dry_run_last: dryMeta,
          automation_run: { ...(fresh.automation_run as object ?? {}), dry_run: dryMeta },
        },
      } as never)
      .eq("id", item.id);
    return {
      ok: false,
      result: "failed",
      scenario,
      notes: dryMeta.notes,
      finalRunStatus: run.run_status,
      suggestedNextAction: "none",
    };
  }

  // Compute callback_hash + result_meta
  const callbackHash = computeCallbackHash({
    execution_package_id: item.id,
    run_id: run.run_id,
    status: sim.status,
    build_status: sim.build_status,
    summary: sim.summary,
    raw_output: sim.raw_output,
  });
  const now = new Date().toISOString();
  const prevMeta = (item.metadata as Record<string, unknown> | null) ?? {};
  const prevResultMeta = (prevMeta.result_meta as Record<string, unknown> | undefined) ?? {};
  const resultMeta = {
    ...prevResultMeta,
    build_status: sim.build_status,
    console_errors: sim.console_errors,
    modified_files: sim.modified_files,
    summary: sim.summary,
    notes: sim.notes,
    external_result_reference: `dry_run:${scenario}:${run.run_id}`,
    callback_hash: callbackHash,
    source: "dry_run",
    is_simulated: true,
    dry_run_scenario: scenario,
    received_at: now,
    protected_areas_touched: sim.protected_areas_touched ?? false,
    result_summary: sim.result_summary ?? null,
  };

  // callback_received log (mirrors Callback Inbox shape)
  await insertLog(
    item,
    "automation_callback_received",
    sim.summary || `Dry run callback ${sim.status}`,
    {
      source: "dry_run",
      scenario,
      run_id: run.run_id,
      build_status: sim.build_status,
      console_errors: sim.console_errors,
      modified_files: sim.modified_files,
      callback_hash: callbackHash,
      status: sim.status,
      protected_areas_touched: sim.protected_areas_touched ?? false,
    },
    { new: sim.status },
  );

  // Persist result_meta + output
  const baseUpdate: Record<string, unknown> = {
    metadata: { ...prevMeta, result_meta: resultMeta },
  };
  if (sim.status === "completed") baseUpdate.output_result = sim.raw_output || sim.summary;
  const { error: upErr } = await supabase.from("clipboard_items").update(baseUpdate as never).eq("id", item.id);
  if (upErr) throw upErr;
  item = await refreshItem(item.id);

  // Ledger transition
  if (sim.status === "completed") {
    run = await updateAutomationRun(
      item,
      {
        run_status: "completed",
        completed_at: now,
        external_result_reference: resultMeta.external_result_reference,
        execution_notes: sim.notes || sim.summary,
      },
      "automation_completed",
      { notes: sim.summary || "Dry run completato" },
    );
  } else {
    run = await updateAutomationRun(
      item,
      {
        run_status: "failed",
        failed_at: now,
        last_error: sim.summary || sim.notes || "Dry run fallito",
        execution_notes: sim.notes,
      },
      "automation_failed",
      { notes: sim.summary || "Dry run fallito" },
    );
  }
  item = await refreshItem(item.id);

  // Decide result kind + suggested next action
  let resultKind: DryRunMeta["result"];
  let suggested: DryRunResult["suggestedNextAction"];
  let dryNotes: string;
  switch (scenario) {
    case "success_complete":
      resultKind = "success";
      suggested = "next_prompt";
      dryNotes = "Pronto per next prompt";
      break;
    case "success_warning":
      resultKind = "warning";
      suggested = "fix_prompt";
      dryNotes = "Build ok ma warning: suggerito fix prompt";
      break;
    case "build_failed":
      resultKind = "failed";
      suggested = "fix_prompt";
      dryNotes = "Build fallita: riprova o fix prompt";
      break;
    case "partial":
      resultKind = "warning";
      suggested = "fix_prompt";
      dryNotes = "Risultato parziale: fix prompt consigliato";
      break;
    case "protected_areas":
      resultKind = "failed";
      suggested = "block_loop";
      dryNotes = "Aree protette toccate: bloccare il loop o fix prompt";
      break;
    default:
      resultKind = "failed";
      suggested = "none";
      dryNotes = "";
  }

  // Persist dry_run meta (both at metadata.dry_run_last and inside automation_run.dry_run)
  const finalMeta = (item.metadata as Record<string, unknown> | null) ?? {};
  const dryMeta: DryRunMeta = {
    enabled: true,
    scenario,
    executed_at: startedAt,
    result: resultKind,
    notes: dryNotes,
  };
  const finalRun = { ...((finalMeta.automation_run as object) ?? {}), dry_run: dryMeta };
  await supabase
    .from("clipboard_items")
    .update({
      metadata: { ...finalMeta, dry_run_last: dryMeta, automation_run: finalRun },
    } as never)
    .eq("id", item.id);

  const closingEvent: LogEventType =
    resultKind === "failed" ? "automation_dry_run_failed" : "automation_dry_run_completed";
  await insertLog(item, closingEvent, dryNotes, {
    scenario,
    run_id: run.run_id,
    result: resultKind,
    suggested_next_action: suggested,
  });

  return {
    ok: resultKind !== "failed",
    result: resultKind,
    scenario,
    notes: dryNotes,
    finalRunStatus: run.run_status,
    suggestedNextAction: suggested,
  };
}

/** Eligibility: execution_package with run not currently running. */
export function isDryRunEligible(item: ItemLike): boolean {
  if (item.content_type !== "execution_package") return false;
  const run = getAutomationRun(item);
  return ["draft", "approved", "queued", "failed", "cancelled", "blocked", "completed"].includes(run.run_status);
}
