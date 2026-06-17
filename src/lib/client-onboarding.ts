import { supabase } from "@/integrations/supabase/client";
import {
  getCompanyHomeSummary,
  type CompanyHomeSummary,
} from "@/lib/company-simple-home";
import { getCalendarKnowledgeSummary } from "@/lib/calendar-knowledge";

export type ClientOnboardingStepId =
  | "profile"
  | "blueprint"
  | "documents"
  | "calendar"
  | "mvp"
  | "engine"
  | "actions"
  | "results"
  | "improvements"
  | "system";

export type ClientOnboardingStepStatus = "done" | "todo" | "warning";

export type ClientOnboardingStep = {
  id: ClientOnboardingStepId;
  order: number;
  title: string;
  description: string;
  output: string;
  status: ClientOnboardingStepStatus;
  ctaLabel: string;
  ctaTo: string;
};

export type ClientOnboardingProgress = {
  total: number;
  done: number;
  todo: number;
  warning: number;
  percent: number;
};

export type ClientOnboardingSummary = {
  brainId: string | null;
  companyName: string | null;
  steps: ClientOnboardingStep[];
  progress: ClientOnboardingProgress;
  nextStep: ClientOnboardingStep | null;
};

export type ClientOnboardingEvent =
  | "client_onboarding_viewed"
  | "client_onboarding_step_opened"
  | "client_onboarding_next_step_clicked"
  | "client_onboarding_home_opened"
  | "client_onboarding_expert_mode_opened"
  | "drive_opened_from_client_onboarding";

type CalendarStepInput = {
  connections: number;
  hasNeverSynced: boolean;
  lastSyncFailed: boolean;
};

function buildSteps(
  s: CompanyHomeSummary,
  cal: CalendarStepInput,
): ClientOnboardingStep[] {
  const profileDone = s.hasProfile;
  const blueprintDone = s.hasBlueprint;
  const mvpDone = s.mvpCount > 0;
  const engineDone = s.handoffsActive > 0;
  const actionsStatus: ClientOnboardingStepStatus =
    s.pendingActions === 0 ? "done" : s.highRiskActions > 0 ? "warning" : "todo";
  const resultsStatus: ClientOnboardingStepStatus =
    s.pendingResults === 0 && s.needsFixResults === 0
      ? "done"
      : s.needsFixResults > 0
        ? "warning"
        : "todo";
  const improvementsStatus: ClientOnboardingStepStatus =
    s.pendingSuggestions === 0 ? "done" : "todo";
  // System overall: warning if anything pending/fix
  const systemStatus: ClientOnboardingStepStatus =
    !profileDone || !blueprintDone
      ? "todo"
      : s.highRiskActions > 0 || s.needsFixResults > 0
        ? "warning"
        : "done";

  return [
    {
      id: "profile",
      order: 1,
      title: "Configura il profilo aziendale",
      description:
        "Imposta settore, obiettivi, aree operative e problemi principali.",
      output: "Profilo operativo aziendale",
      status: profileDone ? "done" : "todo",
      ctaLabel: "Configura azienda",
      ctaTo: "/company-os",
    },
    {
      id: "blueprint",
      order: 2,
      title: "Genera il piano operativo",
      description:
        "Brain Hub crea una fotografia dell'azienda e un piano 30/60/90 giorni.",
      output: "Company Blueprint",
      status: blueprintDone ? "done" : "todo",
      ctaLabel: "Genera piano",
      ctaTo: "/company-blueprint",
    },
    {
      id: "documents",
      order: 3,
      title: "Collega documenti e conoscenza",
      description:
        s.driveStatus === "knowledge_ready"
          ? `Drive collegato: ${s.driveFilesMapped} file mappati e ${s.driveKnowledgeCount} knowledge create.`
          : s.driveStatus === "mapped"
            ? `Drive collegato: ${s.driveFilesMapped} file mappati. Crea knowledge per usarli nel sistema.`
            : s.driveStatus === "configured"
              ? "Drive configurato ma nessun file ancora mappato. Importa un link per iniziare."
              : "Collega Google Drive (read-only) o importa link manuali per mappare i documenti aziendali.",
      output: "Drive Knowledge Map",
      status:
        s.driveStatus === "knowledge_ready"
          ? "done"
          : s.driveStatus === "mapped"
            ? "warning"
            : "todo",
      ctaLabel: "Collega documenti",
      ctaTo: "/drive-knowledge",
    },
    {
      id: "calendar",
      order: 4,
      title: "Collega Google Calendar",
      description:
        cal.connections === 0
          ? "Collega Google Calendar (read-only) per mappare riunioni e scadenze nel sistema."
          : cal.hasNeverSynced
            ? "Calendar configurato ma mai sincronizzato. Avvia il primo sync per popolare la mappa eventi."
            : cal.lastSyncFailed
              ? "L'ultima sincronizzazione Calendar è fallita. Riprova dal pannello Calendar."
              : "Google Calendar collegato e sincronizzato. Brain Hub non crea, modifica o cancella eventi.",
      output: "Calendar Map",
      status:
        cal.connections === 0
          ? "todo"
          : cal.hasNeverSynced || cal.lastSyncFailed
            ? "warning"
            : "done",
      ctaLabel: "Collega calendario",
      ctaTo: "/calendar-knowledge",
    },
    {
      id: "mvp",
      order: 5,
      title: "Crea il primo progetto o MVP",
      description:
        "Trasforma una priorità aziendale in una specifica MVP pronta da costruire.",
      output: "MVP Spec",
      status: mvpDone ? "done" : "todo",
      ctaLabel: "Crea MVP",
      ctaTo: "/mvp-factory",
    },
    {
      id: "engine",
      order: 6,
      title: "Scegli il motore di sviluppo",
      description:
        "Brain Hub suggerisce se usare Lovable, Codex, Claude Code o un altro motore.",
      output: "Build Engine Handoff",
      status: engineDone ? "done" : "todo",
      ctaLabel: "Scegli motore",
      ctaTo: "/build-engines",
    },
    {
      id: "actions",
      order: 7,
      title: "Approva le prime azioni",
      description:
        "Controlla cosa Brain Hub propone prima di far partire qualsiasi attività.",
      output: "Action Queue",
      status: actionsStatus,
      ctaLabel: "Apri azioni",
      ctaTo: "/action-queue",
    },
    {
      id: "results",
      order: 8,
      title: "Controlla i risultati",
      description:
        "Ogni risultato viene verificato prima di diventare parte del sistema.",
      output: "Result Review",
      status: resultsStatus,
      ctaLabel: "Controlla risultati",
      ctaTo: "/result-review",
    },
    {
      id: "improvements",
      order: 9,
      title: "Applica i miglioramenti",
      description:
        "Brain Hub trasforma i risultati approvati in nuovi suggerimenti e prossimi passi.",
      output: "Learning Loop",
      status: improvementsStatus,
      ctaLabel: "Apri miglioramenti",
      ctaTo: "/result-review",
    },
    {
      id: "system",
      order: 10,
      title: "Verifica il ciclo operativo",
      description:
        "Controlla se il lavoro si è fermato o se il sistema è completo.",
      output: "Loop QA",
      status: systemStatus,
      ctaLabel: "Controlla stato",
      ctaTo: "/loop-qa",
    },
  ];
}

function computeProgress(steps: ClientOnboardingStep[]): ClientOnboardingProgress {
  const total = steps.length;
  const done = steps.filter((s) => s.status === "done").length;
  const todo = steps.filter((s) => s.status === "todo").length;
  const warning = steps.filter((s) => s.status === "warning").length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return { total, done, todo, warning, percent };
}

function pickNextStep(steps: ClientOnboardingStep[]): ClientOnboardingStep | null {
  return (
    steps.find((s) => s.status === "warning") ??
    steps.find((s) => s.status === "todo") ??
    null
  );
}

export async function getClientOnboardingSummary(
  brainId?: string | null,
): Promise<ClientOnboardingSummary> {
  const home = await getCompanyHomeSummary(brainId);
  let cal: CalendarStepInput = {
    connections: 0,
    hasNeverSynced: false,
    lastSyncFailed: false,
  };
  try {
    const cs = await getCalendarKnowledgeSummary(brainId ?? null);
    cal = {
      connections: cs.connections,
      hasNeverSynced: cs.hasNeverSynced,
      lastSyncFailed: cs.lastSyncFailed,
    };
  } catch {
    // calendar non disponibile: lasciamo stato 'todo'
  }
  const steps = buildSteps(home, cal);
  return {
    brainId: home.brainId,
    companyName: home.companyName,
    steps,
    progress: computeProgress(steps),
    nextStep: pickNextStep(steps),
  };
}

export async function getClientOnboardingSteps(
  brainId?: string | null,
): Promise<ClientOnboardingStep[]> {
  return (await getClientOnboardingSummary(brainId)).steps;
}

export async function getClientOnboardingProgress(
  brainId?: string | null,
): Promise<ClientOnboardingProgress> {
  return (await getClientOnboardingSummary(brainId)).progress;
}

export async function getClientOnboardingNextStep(
  brainId?: string | null,
): Promise<ClientOnboardingStep | null> {
  return (await getClientOnboardingSummary(brainId)).nextStep;
}

export async function logClientOnboardingEvent(
  action: ClientOnboardingEvent,
  notes: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase.from("clipboard_execution_logs").insert({
    user_id: u.user.id,
    clipboard_item_id: null,
    action,
    notes,
    metadata,
  } as never);
}
