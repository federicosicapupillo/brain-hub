import { getAutomationRun, type RunStatus, type ItemLike } from "./automation-run";

export const VALID_AUTOMATION_STATUSES = [
  "da_approvare",
  "pronto",
  "copiato",
  "inviato",
  "risultato_salvato",
  "rielaborato",
] as const;

export type NormalizedAutomationItem = {
  id: string;
  content_type: string | null;
  automation_status: string | null;
  run_status: RunStatus;
  package_type: string;
  risk_level: string | null;
  isExecutionPackage: boolean;
  isEligibleForRunLedger: boolean;
  isPendingApproval: boolean;
  exclusionReason: string | null;
};

type ItemForNormalize = ItemLike & {
  content_type?: string | null;
  risk_level?: string | null;
  automation_status?: string | null;
};

export function normalizeAutomationItem(item: ItemForNormalize): NormalizedAutomationItem {
  const content_type = item.content_type ?? null;
  const automation_status = item.automation_status ?? null;
  const m = (item.metadata as Record<string, unknown> | null) ?? {};
  const pkg = m.execution_package as { package_type?: string } | undefined;
  const package_type = pkg?.package_type ?? "standard";
  const hasRun = !!m.automation_run && typeof m.automation_run === "object";
  const run = getAutomationRun(item);
  const run_status: RunStatus = hasRun ? run.run_status : "draft";

  const isExecutionPackage = content_type === "execution_package";
  const validStatus =
    !!automation_status &&
    (VALID_AUTOMATION_STATUSES as readonly string[]).includes(automation_status);

  let exclusionReason: string | null = null;
  if (!isExecutionPackage) exclusionReason = "content_type non execution_package";
  else if (!validStatus) exclusionReason = `automation_status non valido (${automation_status ?? "null"})`;

  const isEligibleForRunLedger = isExecutionPackage && validStatus;
  const isPendingApproval =
    isEligibleForRunLedger &&
    (run_status === "draft" || automation_status === "da_approvare");

  return {
    id: item.id,
    content_type,
    automation_status,
    run_status,
    package_type,
    risk_level: item.risk_level ?? null,
    isExecutionPackage,
    isEligibleForRunLedger,
    isPendingApproval,
    exclusionReason,
  };
}
