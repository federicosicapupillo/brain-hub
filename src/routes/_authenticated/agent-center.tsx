import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  archiveAgent,
  listAgentPermissions,
  upsertAgentPermission,
  getDefaultAgentTemplates,
  createAgentFromTemplate,
  validateAgentSafety,
  getAgentCenterSummary,
  logAgentCenterEvent,
  PERMISSION_LEVEL_LABEL,
  STATUS_LABEL,
  OPERATING_MODE_LABEL,
  TOOL_KEYS,
  TOOL_KEY_LABEL,
  type Agent,
  type AgentStatus,
  type OperatingMode,
  type PermissionLevel,
  type ToolKey,
} from "@/lib/agent-center";
import type { RiskLevel } from "@/lib/action-queue";
import {
  Plus,
  Bot,
  Archive,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/agent-center")({
  head: () => ({
    meta: [
      { title: "Agent Center — Brain Hub" },
      {
        name: "description",
        content:
          "Registro agenti con ruoli, permessi e limiti di rischio. Manual-first, nessuna esecuzione autonoma.",
      },
    ],
  }),
  component: AgentCenterPage,
});

type Brain = { id: string; name: string };

const STATUS_TONE: Record<AgentStatus, string> = {
  draft: "bg-slate-500/10 text-slate-600 border-slate-500/30",
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  paused: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  archived: "bg-zinc-500/10 text-zinc-600 border-zinc-500/30",
};

const RISK_TONE: Record<RiskLevel, string> = {
  low: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  high: "bg-red-500/10 text-red-600 border-red-500/30",
};

function AgentCenterPage() {
  const qc = useQueryClient();
  const [brainId, setBrainId] = useState<string | null>(null);
  const [openTemplates, setOpenTemplates] = useState(false);
  const [openCustom, setOpenCustom] = useState(false);
  const [openDetail, setOpenDetail] = useState<Agent | null>(null);

  useEffect(() => {
    void logAgentCenterEvent("agent_center_viewed", "Agent Center aperto", {});
  }, []);

  const { data: brains = [] } = useQuery({
    queryKey: ["brains-min"],
    queryFn: async (): Promise<Brain[]> => {
      const { data } = await supabase.from("brains").select("id,name").order("name");
      return (data ?? []) as Brain[];
    },
  });

  const agentsQ = useQuery({
    queryKey: ["ac-agents", brainId],
    queryFn: () => listAgents(brainId ?? null),
  });

  const summaryQ = useQuery({
    queryKey: ["ac-summary", brainId],
    queryFn: () => getAgentCenterSummary(brainId ?? null),
  });

  const templates = useMemo(() => getDefaultAgentTemplates(), []);

  async function reload() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["ac-agents"] }),
      qc.invalidateQueries({ queryKey: ["ac-summary"] }),
    ]);
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <PageHeader
        title="Agent Center"
        subtitle="Registro agenti, ruoli e permessi. Manual-first: gli agenti producono solo suggerimenti."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Selettore brain</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-3 items-end flex-wrap">
          <div>
            <Label>Brain</Label>
            <Select
              value={brainId ?? "__all"}
              onValueChange={(v) => setBrainId(v === "__all" ? null : v)}
            >
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Tutti i brain</SelectItem>
                {brains.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => setOpenTemplates(true)}>
            <Sparkles className="w-4 h-4 mr-1" /> Crea da template
          </Button>
          <Button variant="outline" onClick={() => setOpenCustom(true)}>
            <Plus className="w-4 h-4 mr-1" /> Crea agente custom
          </Button>
          <Link to="/action-queue">
            <Button variant="ghost">Action Queue</Button>
          </Link>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <SummaryTile label="Totali" value={summaryQ.data?.total ?? 0} />
        <SummaryTile label="Attivi" value={summaryQ.data?.active ?? 0} tone="active" />
        <SummaryTile label="Bozza" value={summaryQ.data?.draft ?? 0} tone="draft" />
        <SummaryTile label="In pausa" value={summaryQ.data?.paused ?? 0} tone="paused" />
      </div>

      {summaryQ.data?.recommendedNext && (
        <Card>
          <CardContent className="pt-4 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-medium">
                Prossimo agente consigliato: {summaryQ.data.recommendedNext.name}
              </div>
              <div className="text-xs text-muted-foreground">
                {summaryQ.data.recommendedNext.business_summary}
              </div>
            </div>
            <Button
              size="sm"
              onClick={async () => {
                try {
                  await createAgentFromTemplate(
                    summaryQ.data!.recommendedNext!.template_key,
                    brainId,
                  );
                  toast.success("Agente creato in bozza");
                  await reload();
                } catch (e) {
                  toast.error("Errore", { description: (e as Error).message });
                }
              }}
            >
              Crea
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="w-4 h-4" /> Agenti ({agentsQ.data?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {agentsQ.isLoading && (
            <div className="text-sm text-muted-foreground">Caricamento…</div>
          )}
          {agentsQ.data && agentsQ.data.length === 0 && (
            <div className="text-sm text-muted-foreground">
              Nessun agente. Crea da template o custom.
            </div>
          )}
          {agentsQ.data?.map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              onOpen={() => setOpenDetail(a)}
              onArchive={async () => {
                if (!confirm(`Archiviare "${a.name}"?`)) return;
                await archiveAgent(a.id);
                toast.success("Archiviato");
                await reload();
              }}
            />
          ))}
        </CardContent>
      </Card>

      <TemplatesDialog
        open={openTemplates}
        onOpenChange={setOpenTemplates}
        brainId={brainId}
        templates={templates}
        onCreated={reload}
      />

      <CustomAgentDialog
        open={openCustom}
        onOpenChange={setOpenCustom}
        brainId={brainId}
        onCreated={reload}
      />

      <AgentDetailDialog
        agent={openDetail}
        onOpenChange={(open) => !open && setOpenDetail(null)}
        onChanged={reload}
      />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: AgentStatus;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold">{value}</div>
        {tone && (
          <Badge variant="outline" className={`mt-1 ${STATUS_TONE[tone]}`}>
            {STATUS_LABEL[tone]}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

function AgentRow({
  agent,
  onOpen,
  onArchive,
}: {
  agent: Agent;
  onOpen: () => void;
  onArchive: () => void;
}) {
  const safety = useMemo(() => validateAgentSafety(agent), [agent]);
  const hasSafetyIssue = safety.length > 0;

  return (
    <div className="border rounded-lg p-3 flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{agent.name}</span>
          <Badge variant="outline" className={STATUS_TONE[agent.status]}>
            {STATUS_LABEL[agent.status]}
          </Badge>
          <Badge variant="outline" className={RISK_TONE[agent.max_risk_level]}>
            Max {agent.max_risk_level}
          </Badge>
          <Badge variant="secondary">{OPERATING_MODE_LABEL[agent.operating_mode]}</Badge>
          {hasSafetyIssue && (
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
              <AlertTriangle className="w-3 h-3 mr-1" /> {safety.length} warning
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {agent.role} · {agent.description ?? "(nessuna descrizione)"}
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onOpen}>
          Dettaglio
        </Button>
        <Button size="sm" variant="ghost" onClick={onArchive}>
          <Archive className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function TemplatesDialog({
  open,
  onOpenChange,
  brainId,
  templates,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brainId: string | null;
  templates: ReturnType<typeof getDefaultAgentTemplates>;
  onCreated: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Crea agente da template</DialogTitle>
          <DialogDescription>
            Tutti gli agenti vengono creati in stato <code>draft</code> con esecuzione
            disabilitata.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
          {templates.map((t) => (
            <div key={t.template_key} className="border rounded-lg p-3 space-y-2">
              <div className="font-medium text-sm">{t.name}</div>
              <div className="text-xs text-muted-foreground">{t.business_summary}</div>
              <div className="flex flex-wrap gap-1 text-[10px]">
                <Badge variant="outline" className={RISK_TONE[t.max_risk_level]}>
                  Max {t.max_risk_level}
                </Badge>
                {t.recommended_tools.slice(0, 4).map((tk) => (
                  <Badge key={tk} variant="secondary">
                    {TOOL_KEY_LABEL[tk]}
                  </Badge>
                ))}
              </div>
              <div className="text-[11px] text-muted-foreground">
                <div>
                  <strong>Legge:</strong> {t.reads.join(", ")}
                </div>
                <div>
                  <strong>Propone:</strong> {t.can_propose.join(", ")}
                </div>
                <div>
                  <strong>Non può:</strong> {t.cannot_do.join(", ")}
                </div>
              </div>
              <Button
                size="sm"
                disabled={busy === t.template_key}
                onClick={async () => {
                  setBusy(t.template_key);
                  try {
                    await createAgentFromTemplate(t.template_key, brainId);
                    toast.success("Agente creato in bozza");
                    await onCreated();
                  } catch (e) {
                    toast.error("Errore", { description: (e as Error).message });
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Crea
              </Button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Chiudi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CustomAgentDialog({
  open,
  onOpenChange,
  brainId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brainId: string | null;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("custom");
  const [description, setDescription] = useState("");
  const [maxRisk, setMaxRisk] = useState<RiskLevel>("low");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setRole("custom");
      setDescription("");
      setMaxRisk("low");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crea agente custom</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Ruolo</Label>
            <Input value={role} onChange={(e) => setRole(e.target.value)} />
          </div>
          <div>
            <Label>Descrizione</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <Label>Max risk level</Label>
            <Select value={maxRisk} onValueChange={(v) => setMaxRisk(v as RiskLevel)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">low</SelectItem>
                <SelectItem value="medium">medium</SelectItem>
                <SelectItem value="high">high</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await createAgent({
                  brain_id: brainId,
                  name: name.trim(),
                  agent_key: `custom_${Date.now().toString(36)}`,
                  description: description.trim() || null,
                  role: role.trim() || "custom",
                  max_risk_level: maxRisk,
                  status: "draft",
                  operating_mode: "manual",
                  requires_approval: true,
                });
                toast.success("Agente creato");
                onOpenChange(false);
                await onCreated();
              } catch (e) {
                toast.error("Errore", { description: (e as Error).message });
              } finally {
                setBusy(false);
              }
            }}
          >
            Crea
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentDetailDialog({
  agent,
  onOpenChange,
  onChanged,
}: {
  agent: Agent | null;
  onOpenChange: (v: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"info" | "permissions" | "safety">("info");

  const fullQ = useQuery({
    queryKey: ["ac-agent-full", agent?.id],
    queryFn: async () => {
      if (!agent) return null;
      const [full, perms] = await Promise.all([
        getAgent(agent.id),
        listAgentPermissions(agent.id),
      ]);
      return { agent: full, perms };
    },
    enabled: !!agent,
  });

  const current = fullQ.data?.agent ?? agent;
  const perms = fullQ.data?.perms ?? [];

  async function setStatus(status: AgentStatus) {
    if (!current) return;
    try {
      await updateAgent(current.id, { status });
      toast.success(`Stato aggiornato: ${STATUS_LABEL[status]}`);
      await qc.invalidateQueries({ queryKey: ["ac-agent-full"] });
      await onChanged();
    } catch (e) {
      toast.error("Errore", { description: (e as Error).message });
    }
  }

  async function setMode(mode: OperatingMode) {
    if (!current) return;
    try {
      await updateAgent(current.id, { operating_mode: mode });
      await qc.invalidateQueries({ queryKey: ["ac-agent-full"] });
    } catch (e) {
      toast.error("Errore", { description: (e as Error).message });
    }
  }

  async function setPerm(
    toolKey: ToolKey,
    patch: { permission_level?: PermissionLevel; risk_level?: RiskLevel; is_enabled?: boolean; requires_approval?: boolean },
  ) {
    if (!current) return;
    const existing = perms.find((p) => p.tool_key === toolKey);
    try {
      await upsertAgentPermission({
        agent_id: current.id,
        brain_id: current.brain_id,
        tool_key: toolKey,
        permission_level: patch.permission_level ?? existing?.permission_level ?? "read",
        risk_level: patch.risk_level ?? existing?.risk_level ?? "low",
        requires_approval: patch.requires_approval ?? existing?.requires_approval ?? true,
        is_enabled: patch.is_enabled ?? existing?.is_enabled ?? true,
      });
      await qc.invalidateQueries({ queryKey: ["ac-agent-full"] });
    } catch (e) {
      toast.error("Errore", { description: (e as Error).message });
    }
  }

  if (!current) {
    return (
      <Dialog open={!!agent} onOpenChange={onOpenChange}>
        <DialogContent />
      </Dialog>
    );
  }

  const safety = validateAgentSafety(current);

  return (
    <Dialog open={!!agent} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-4 h-4" /> {current.name}
          </DialogTitle>
          <DialogDescription>
            Ruolo: {current.role} ·{" "}
            <Badge variant="outline" className={STATUS_TONE[current.status]}>
              {STATUS_LABEL[current.status]}
            </Badge>{" "}
            <Badge variant="outline" className={RISK_TONE[current.max_risk_level]}>
              Max {current.max_risk_level}
            </Badge>
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 border-b pb-2">
          <Button
            size="sm"
            variant={tab === "info" ? "default" : "ghost"}
            onClick={() => setTab("info")}
          >
            Info
          </Button>
          <Button
            size="sm"
            variant={tab === "permissions" ? "default" : "ghost"}
            onClick={() => setTab("permissions")}
          >
            Permessi
          </Button>
          <Button
            size="sm"
            variant={tab === "safety" ? "default" : "ghost"}
            onClick={() => setTab("safety")}
          >
            <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Safety ({safety.length})
          </Button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto space-y-3">
          {tab === "info" && (
            <div className="space-y-3 text-sm">
              <div className="text-muted-foreground">
                {current.description ?? "(nessuna descrizione)"}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Stato</Label>
                  <Select value={current.status} onValueChange={(v) => void setStatus(v as AgentStatus)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["draft", "active", "paused", "archived"] as AgentStatus[]).map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Modalità operativa</Label>
                  <Select
                    value={current.operating_mode}
                    onValueChange={(v) => void setMode(v as OperatingMode)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        ["manual", "suggest_only", "approval_required", "supervised"] as OperatingMode[]
                      ).map((m) => (
                        <SelectItem key={m} value={m}>
                          {OPERATING_MODE_LABEL[m]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="border rounded p-3 text-xs space-y-1">
                <div className="font-medium">Permessi globali (read-only)</div>
                <Flag label="Crea azioni" value={current.can_create_actions} />
                <Flag label="Esegue tool" value={current.can_execute_tools} disabled />
                <Flag label="Chiama API esterne" value={current.can_call_external_apis} disabled />
                <Flag label="Trigger n8n" value={current.can_trigger_n8n} disabled />
                <Flag label="Invia Telegram" value={current.can_send_telegram} disabled />
                <Flag
                  label="Modifica dati esterni"
                  value={current.can_modify_external_data}
                  disabled
                />
                <div className="text-[11px] text-muted-foreground pt-1">
                  In v3.3 le esecuzioni live sono bloccate via codice anche se modificate.
                </div>
              </div>
            </div>
          )}

          {tab === "permissions" && (
            <div className="space-y-2">
              {TOOL_KEYS.map((tk) => {
                const p = perms.find((x) => x.tool_key === tk);
                const level: PermissionLevel = p?.permission_level ?? "none";
                const risk: RiskLevel = p?.risk_level ?? "low";
                const enabled = p?.is_enabled ?? false;
                const reqApprov = p?.requires_approval ?? true;
                return (
                  <div key={tk} className="border rounded p-2 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="font-medium text-sm">{TOOL_KEY_LABEL[tk]}</div>
                      <Badge variant="outline" className={RISK_TONE[risk]}>
                        {risk}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
                      <div>
                        <Label className="text-xs">Permission</Label>
                        <Select
                          value={level}
                          onValueChange={(v) =>
                            void setPerm(tk, { permission_level: v as PermissionLevel })
                          }
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(
                              [
                                "none",
                                "read",
                                "suggest",
                                "prepare",
                                "request_approval",
                              ] as PermissionLevel[]
                            ).map((lv) => (
                              <SelectItem key={lv} value={lv}>
                                {PERMISSION_LEVEL_LABEL[lv]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Risk</Label>
                        <Select
                          value={risk}
                          onValueChange={(v) =>
                            void setPerm(tk, { risk_level: v as RiskLevel })
                          }
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">low</SelectItem>
                            <SelectItem value="medium">medium</SelectItem>
                            <SelectItem value="high">high</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={reqApprov}
                          onCheckedChange={(v) =>
                            void setPerm(tk, { requires_approval: v })
                          }
                        />
                        <Label className="text-xs">Requires approval</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={enabled}
                          onCheckedChange={(v) => void setPerm(tk, { is_enabled: v })}
                        />
                        <Label className="text-xs">Abilitato</Label>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "safety" && (
            <div className="space-y-2 text-sm">
              {safety.length === 0 && (
                <div className="text-muted-foreground">Nessun warning di sicurezza.</div>
              )}
              {safety.map((s, i) => (
                <div
                  key={i}
                  className={`border rounded p-2 text-xs ${
                    s.severity === "error"
                      ? "bg-red-500/10 border-red-500/30"
                      : "bg-amber-500/10 border-amber-500/30"
                  }`}
                >
                  <strong>{s.severity}</strong>: {s.message}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          {agent?.id && (
            <Button asChild variant="default" className="sm:mr-auto">
              <Link to="/agent-runs" search={{ agent: agent.id, brain: agent.brain_id ?? undefined }}>
                Lancia run manuale
              </Link>
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Chiudi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Flag({
  label,
  value,
  disabled,
}: {
  label: string;
  value: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-block w-2 h-2 rounded-full ${
          value ? "bg-emerald-500" : disabled ? "bg-zinc-400" : "bg-slate-400"
        }`}
      />
      <span>
        {label}: {value ? "yes" : "no"}{" "}
        {disabled && <span className="text-[10px] text-muted-foreground">(bloccato v3.3)</span>}
      </span>
    </div>
  );
}
