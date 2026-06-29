// Brain Hub v3.27.7 — Governance Foundation: Project Isolation check.

export interface ProjectIsolationInput {
  project_id: string;
  context_active_project_id: string;
  cross_project?: boolean;
}

export interface ProjectIsolationResult {
  pass: boolean;
  reason: string;
  cross_project_note?: string;
}

export function evaluateProjectIsolation(
  input: ProjectIsolationInput,
): ProjectIsolationResult {
  if (!input.project_id || input.project_id.trim() === "") {
    return { pass: false, reason: "project_id_missing" };
  }
  if (input.project_id !== input.context_active_project_id) {
    if (input.cross_project === true) {
      return {
        pass: true,
        reason: "cross_project_allowed",
        cross_project_note: `cross_project access: ${input.project_id} from context ${input.context_active_project_id}`,
      };
    }
    return { pass: false, reason: "project_isolation_violation" };
  }
  return { pass: true, reason: "project_match" };
}
