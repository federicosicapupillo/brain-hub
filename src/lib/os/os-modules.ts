// Brain Hub v3.28 — OS Navigation & Module Map
// Pure module catalog + status derivation. No DB, no client/server coupling.

export type OsModuleStatus = "active" | "partial" | "empty" | "future";

export interface OsModuleDefinition {
  id: string;
  name: string;
  route: string;
  icon: string;
  description: string;
  // Keyword patterns matched (substring, case-insensitive) against the
  // audit registries. A module owns a route/service/table if any pattern
  // matches its file path / module name / table name.
  route_patterns: string[];
  service_patterns: string[];
  table_patterns: string[];
  // Names of os_target_map.modules entries that map into this OS module.
  // Used to decide `future` (no link) vs `empty` (linked but no audit
  // elements matched).
  linked_target_modules: string[];
}

export const OS_MODULES: OsModuleDefinition[] = [
  {
    id: "command-center",
    name: "Command Center",
    route: "/os/command-center",
    icon: "LayoutDashboard",
    description:
      "Plancia operativa: brief giornalieri, dashboard, master snapshot.",
    route_patterns: [
      "operating-dashboard",
      "daily-brief",
      "master-snapshot",
      "company-home",
    ],
    service_patterns: [
      "daily-operating-brief",
      "master-snapshot",
      "company-simple-home",
    ],
    table_patterns: ["master_snapshot", "daily_brief", "operating"],
    linked_target_modules: ["master-snapshot"],
  },
  {
    id: "project-center",
    name: "Project Center",
    route: "/os/project-center",
    icon: "FolderKanban",
    description:
      "Progetti, brain graph, link e stato dei singoli progetti.",
    route_patterns: [
      "progetti",
      "project-console",
      "project-state",
      "project-loop",
      "company-blueprint",
      "company-os",
    ],
    service_patterns: [
      "project-console",
      "project-state-sync",
      "project-aliases",
      "project-links-api",
      "projects-meta",
      "company-blueprint",
      "company-os",
      "brains-api",
    ],
    table_patterns: ["project", "brain", "company_"],
    linked_target_modules: [],
  },
  {
    id: "communication-center",
    name: "Communication Center",
    route: "/os/communication-center",
    icon: "Send",
    description:
      "Canali in entrata e in uscita: Gmail, Telegram, Calendar.",
    route_patterns: [
      "gmail-connector",
      "gmail-console",
      "gmail-intelligence",
      "email-daily-brief",
      "telegram-approvals",
      "calendar-knowledge",
    ],
    service_patterns: [
      "gmail",
      "telegram",
      "calendar-oauth",
      "calendar-knowledge",
    ],
    table_patterns: ["gmail_", "telegram_", "calendar_"],
    linked_target_modules: [
      "gmail-connector",
      "calendar-knowledge",
      "telegram-connections",
    ],
  },
  {
    id: "knowledge-center",
    name: "Knowledge Center",
    route: "/os/knowledge-center",
    icon: "BookOpen",
    description:
      "Memoria semantica, embeddings, Drive e mappa della conoscenza.",
    route_patterns: [
      "knowledge-map",
      "drive-knowledge",
      "jack-memory",
      "fonti",
      "archivio",
      "importa",
    ],
    service_patterns: [
      "knowledge-api",
      "knowledge-map",
      "drive-knowledge",
      "semantic-api",
      "embeddings",
      "jack-memory",
      "jack-memory-persistence",
      "obsidian",
    ],
    table_patterns: ["knowledge_", "embedding", "jack_memory", "semantic_"],
    linked_target_modules: [
      "knowledge-api",
      "semantic-api",
      "embeddings",
      "jack-memory-persistence",
      "drive-knowledge",
    ],
  },
  {
    id: "development-center",
    name: "Development Center",
    route: "/os/development-center",
    icon: "GitBranch",
    description:
      "Code Agent, GitHub, handoff e build engines.",
    route_patterns: [
      "code-agent",
      "code-handoffs",
      "github-",
      "build-engines",
      "mvp-factory",
    ],
    service_patterns: [
      "code-agent",
      "code-engine-handoff",
      "github-",
      "build-engines",
      "mvp-factory",
    ],
    table_patterns: ["code_agent", "github_", "build_"],
    linked_target_modules: [],
  },
  {
    id: "automation-center",
    name: "Automation Center",
    route: "/os/automation-center",
    icon: "Play",
    description:
      "Action queue, automazioni, n8n e UI Operator.",
    route_patterns: [
      "action-queue",
      "automation-control",
      "automation-readiness",
      "n8n-workflows",
      "ui-operator-lab",
      "tool-connections",
      "connector-hub",
    ],
    service_patterns: [
      "action-queue",
      "automation-run",
      "automation-normalize",
      "automation-readiness",
      "n8n",
      "ui-operator",
      "tool-connections",
      "connector-hub",
    ],
    table_patterns: [
      "action_queue",
      "automation_",
      "n8n_",
      "ui_operator_",
      "tool_connection",
      "connector_",
    ],
    linked_target_modules: [
      "action-queue",
      "automation-run",
      "ui-operator",
      "n8n-real-execution",
    ],
  },
  {
    id: "agent-center",
    name: "Agent Center",
    route: "/os/agent-center",
    icon: "Bot",
    description:
      "Agenti, run, orchestrazione e azioni controllate.",
    route_patterns: [
      "agent-center",
      "agent-runs",
      "agents",
    ],
    service_patterns: [
      "agent-center",
      "agent-runs",
      "jack-controlled-actions",
      "jack-command-router",
      "jack-deterministic-command-router",
      "jack-action-confirmation",
    ],
    table_patterns: ["agent_", "jack_action"],
    linked_target_modules: ["jack-controlled-actions"],
  },
  {
    id: "ai-core",
    name: "AI Core",
    route: "/os/ai-core",
    icon: "Brain",
    description:
      "Jack GPT, voice, realtime e contesto naturale.",
    route_patterns: [
      "live",
      "clipboard-ai",
    ],
    service_patterns: [
      "jack-gpt",
      "jack-voice",
      "jack-natural-context",
      "jack-gmail-voice-response",
      "jack-voice-tool-gate",
      "openai-realtime",
    ],
    table_patterns: ["jack_gpt", "jack_voice", "openai_"],
    linked_target_modules: ["jack-natural-context", "jack-memory"],
  },
  {
    id: "governance",
    name: "Governance & Security",
    route: "/os/governance",
    icon: "ShieldCheck",
    description:
      "Evaluator, RBAC, approvals, audit e architecture audit.",
    route_patterns: [
      "architecture-audit",
      "telegram-approvals",
      "health-check",
      "logs",
    ],
    service_patterns: [
      "governance",
      "rbacModel",
      "projectIsolation",
      "governanceEvaluator",
      "telegram-approvals",
      "jack-action-confirmation",
    ],
    table_patterns: [
      "agent_tool_contracts",
      "governance_",
      "architecture_audit_",
      "agent_permission_matrix",
      "telegram_approval",
    ],
    linked_target_modules: [
      "telegram-approvals",
      "jack-action-confirmation",
      "agent_permission_matrix",
    ],
  },
];

export interface OsModuleDerived {
  id: string;
  name: string;
  route: string;
  icon: string;
  description: string;
  status: OsModuleStatus;
  routes: string[];
  services: string[];
  tables: string[];
  target_layer: string | null;
}

interface SnapshotShape {
  route_registry: {
    routes: Array<{ file: { value: string }; route_path: { value: string } }>;
  };
  service_registry: {
    services: Array<{ file: { value: string }; module: { value: string } }>;
  };
  data_registry: {
    tables: Array<{ table_name: { value: string } }>;
  };
  os_target_map: {
    layers: Array<{
      layer: { value: string };
      modules: { value: string[] };
    }>;
  };
}

function matches(value: string, patterns: string[]): boolean {
  const v = value.toLowerCase();
  return patterns.some((p) => v.includes(p.toLowerCase()));
}

export function deriveOsModules(snapshot: unknown): OsModuleDerived[] {
  const snap = snapshot as SnapshotShape;
  const routes = snap.route_registry.routes.map((r) => ({
    file: r.file.value,
    path: r.route_path.value,
  }));
  const services = snap.service_registry.services.map((s) => ({
    file: s.file.value,
    module: s.module.value,
  }));
  const tables = snap.data_registry.tables.map((t) => t.table_name.value);

  // Build target-module → layer lookup.
  const targetIndex = new Map<string, string>();
  for (const layer of snap.os_target_map.layers) {
    for (const m of layer.modules.value) {
      targetIndex.set(m, layer.layer.value);
    }
  }

  return OS_MODULES.map((mod): OsModuleDerived => {
    const matchedRoutes = routes
      .filter(
        (r) =>
          matches(r.path, mod.route_patterns) ||
          matches(r.file, mod.route_patterns),
      )
      .map((r) => r.path);
    const matchedServices = services
      .filter(
        (s) =>
          matches(s.module, mod.service_patterns) ||
          matches(s.file, mod.service_patterns),
      )
      .map((s) => s.module);
    const matchedTables = tables.filter((t) => matches(t, mod.table_patterns));

    // Resolve linked target layer (first match wins).
    let target_layer: string | null = null;
    for (const tm of mod.linked_target_modules) {
      const layer = targetIndex.get(tm);
      if (layer) {
        target_layer = layer;
        break;
      }
    }

    let status: OsModuleStatus;
    const hasRoutes = matchedRoutes.length > 0;
    const hasServices = matchedServices.length > 0;
    const hasTables = matchedTables.length > 0;
    if (mod.linked_target_modules.length === 0 && !target_layer) {
      // Not present in os_target_map → future, regardless of opportunistic matches.
      status = "future";
    } else if (!hasRoutes && !hasServices && !hasTables) {
      status = "empty";
    } else if (hasRoutes && hasServices && hasTables) {
      status = "active";
    } else if (hasRoutes || hasServices) {
      status = "partial";
    } else {
      status = "empty";
    }

    return {
      id: mod.id,
      name: mod.name,
      route: mod.route,
      icon: mod.icon,
      description: mod.description,
      status,
      routes: matchedRoutes,
      services: matchedServices,
      tables: matchedTables,
      target_layer,
    };
  });
}
