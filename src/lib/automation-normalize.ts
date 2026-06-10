import { getAutomationRun, type RunStatus, type ItemLike } from "./automation-run";

export const VALID_AUTOMATION_STATUSES = [
  "da_approvare",
  "pronto",
  "copiato",
  "inviato",
  "risultato_salvato",
  "rielaborato",
] as const;

export type ExecutionPackageDetection =
  | "content_type"
  | "metadata"
  | "instructions_fields"
  | null;

export type NormalizedAutomationItem = {
  id: string;
  content_type: string | null;
  original_content_type: string | null;
  normalized_content_type: string | null;
  automation_status: string | null;
  effective_automation_status: string | null;
  run_status: RunStatus;
  package_type: string;
  risk_level: string | null;
  isExecutionPackage: boolean;
  isLegacyPackage: boolean;
  detectionSource: ExecutionPackageDetection;
  isEligibleForRunLedger: boolean;
  isPendingApproval: boolean;
  exclusionReason: string | null;
};

type ItemForNormalize = ItemLike & {
  content_type?: string | null;
  risk_level?: string | null;
  automation_status?: string | null;
  execution_instructions?: string | null;
  expected_output?: string | null;
  success_criteria?: string | null;
};

function hasText(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/** True se l'item è un Execution Package (nativo o legacy). */
export function isExecutionPackageItem(item: ItemForNormalize): boolean {
  if (item.content_type === "execution_package") return true;
  const m = (item.metadata as Record<string, unknown> | null) ?? {};
  if (m.execution_package && typeof m.execution_package === "object") return true;
  if (hasText(item.execution_instructions)) return true;
  if (hasText(item.expected_output)) return true;
  if (hasText(item.success_criteria)) return true;
  return false;
}

export function detectExecutionPackageSource(
  item: ItemForNormalize,
): ExecutionPackageDetection {
  if (item.content_type === "execution_package") return "content_type";
  const m = (item.metadata as Record<string, unknown> | null) ?? {};
  if (m.execution_package && typeof m.execution_package === "object") return "metadata";
  if (
    hasText(item.execution_instructions) ||
    hasText(item.expected_output) ||
    hasText(item.success_criteria)
  ) {
    return "instructions_fields";
  }
  return null;
}

export function normalizeAutomationItem(item: ItemForNormalize): NormalizedAutomationItem {
  const content_type = item.content_type ?? null;
  const automation_status = item.automation_status ?? null;
  const m = (item.metadata as Record<string, unknown> | null) ?? {};
  const pkg = m.execution_package as { package_type?: string } | undefined;
  const package_type = pkg?.package_type ?? "standard";
  const hasRun = !!m.automation_run && typeof m.automation_run === "object";
  const run = getAutomationRun(item);
  const run_status: RunStatus = hasRun ? run.run_status : "draft";

  const detectionSource = detectExecutionPackageSource(item);
  const isExecutionPackage = detectionSource !== null;
  const isLegacyPackage = isExecutionPackage && content_type !== "execution_package";
  const normalized_content_type = isExecutionPackage ? "execution_package" : content_type;

  const validStatus =
    !!automation_status &&
    (VALID_AUTOMATION_STATUSES as readonly string[]).includes(automation_status);

  // Per item legacy: se status manca o non valido, considera "da_approvare" (solo a livello logico, no DB write).
  const effective_automation_status: string | null = validStatus
    ? automation_status
    : isExecutionPackage
      ? "da_approvare"
      : automation_status;

  let exclusionReason: string | null = null;
  if (!isExecutionPackage) exclusionReason = "non è un Execution Package (nessun content_type/metadata/campi)";

  const isEligibleForRunLedger = isExecutionPackage;
  const isPendingApproval =
    isEligibleForRunLedger &&
    (run_status === "draft" || effective_automation_status === "da_approvare");

  return {
    id: item.id,
    content_type,
    original_content_type: content_type,
    normalized_content_type,
    automation_status,
    effective_automation_status,
    run_status,
    package_type,
    risk_level: item.risk_level ?? null,
    isExecutionPackage,
    isLegacyPackage,
    detectionSource,
    isEligibleForRunLedger,
    isPendingApproval,
    exclusionReason,
  };
}
