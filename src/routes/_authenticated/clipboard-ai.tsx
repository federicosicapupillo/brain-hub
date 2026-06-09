import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Clipboard, Copy, Edit2, Archive, CheckCircle2, Sparkles, Plus, Search,
  Trash2, Loader2, ExternalLink, ListChecks, Map as MapIcon, Zap,
  ShieldCheck, RotateCcw, Ban, Plug, Power, PowerOff,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/clipboard-ai")({
  head: () => ({ meta: [{ title: "Clipboard AI — iBrain" }] }),
  component: ClipboardAIPage,
});

type ClipboardItem = {
  id: string;
  brain_id: string | null;
  project_id: string | null;
  project_tool_link_id: string | null;
  title: string;
  content: string;
  source_tool: string;
  target_tool: string;
  content_type: string;
  status: string;
  tags: string[];
  notes: string;
  next_action: string;
  source_url: string;
  output_result: string;
  execution_instructions: string | null;
  expected_output: string | null;
  success_criteria: string | null;
  risk_level: string | null;
  requires_approval: boolean | null;
  automation_status: string;
  automation_target: string;
  automation_connector_id: string | null;
  automation_last_run_at: string | null;
  automation_attempts: number;
  automation_last_error: string | null;
  automation_completed_at: string | null;
  human_review_required: boolean;
  approval_status: string;
  approved_at: string | null;
  blocked_reason: string | null;
  approval_notes: string | null;
  metadata: Record<string, unknown>;
  copied_count: number;
  last_copied_at: string | null;
  created_at: string;
  updated_at: string;
};

const TOOLS = [
  "ChatGPT", "Claude", "Lovable", "Codex", "Antigravity",
  "Runway", "Gmail", "Browser", "Obsidian", "Notion", "Altro",
];
const CONTENT_TYPES = [
  { v: "prompt", l: "Prompt" },
  { v: "ai_response", l: "Risposta AI" },
  { v: "code", l: "Codice" },
  { v: "note", l: "Appunto" },
  { v: "email", l: "Email" },
  { v: "idea", l: "Idea" },
  { v: "task", l: "Task" },
  { v: "media_prompt", l: "Media Prompt" },
];
const STATUSES = [
  { v: "saved", l: "Salvato", color: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  { v: "to_classify", l: "Da classificare", color: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  { v: "ready", l: "Pronto da usare", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  { v: "used", l: "Usato", color: "bg-violet-500/10 text-violet-400 border-violet-500/30" },
  { v: "archived", l: "Archiviato", color: "bg-muted text-muted-foreground border-muted" },
];
const AUTOMATION_STATUSES = [
  { v: "manual", l: "Manuale" },
  { v: "ready_for_automation", l: "Pronto per automazione" },
  { v: "queued", l: "In coda" },
  { v: "running", l: "In esecuzione" },
  { v: "done", l: "Completata" },
  { v: "failed", l: "Errore" },
];
const APPROVAL_STATUSES: Record<string, { l: string; color: string }> = {
  pending: { l: "In attesa", color: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  approved: { l: "Approvato", color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  revision_needed: { l: "Da rivedere", color: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  blocked: { l: "Bloccato", color: "bg-red-500/15 text-red-300 border-red-500/30" },
};
const RISK_LEVELS = [
  { v: "low", l: "Basso", color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  { v: "medium", l: "Medio", color: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  { v: "high", l: "Alto", color: "bg-orange-500/15 text-orange-300 border-orange-500/30" },
  { v: "critical", l: "Critico", color: "bg-red-500/15 text-red-300 border-red-500/30 animate-pulse" },
];
const CONNECTOR_TYPES = [
  { v: "n8n_webhook", l: "n8n Webhook" },
  { v: "browser_automation", l: "Browser Automation" },
  { v: "manual_copy", l: "Copia Manuale" },
  { v: "api_connector", l: "API Connector" },
];

type AutomationConnector = {
  id: string;
  name: string;
  type: string;
  target_tool: string;
  webhook_url: string | null;
  browser_profile: string | null;
  is_active: boolean;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type ConnectorForm = {
  id?: string;
  name: string;
  type: string;
  target_tool: string;
  webhook_url: string;
  browser_profile: string;
  is_active: boolean;
};
const EMPTY_CONNECTOR: ConnectorForm = {
  name: "", type: "n8n_webhook", target_tool: "",
  webhook_url: "", browser_profile: "", is_active: false,
};

const TOOL_COLOR: Record<string, string> = {
  ChatGPT: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Claude: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  Lovable: "bg-pink-500/15 text-pink-300 border-pink-500/30",
  Codex: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  Antigravity: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  Runway: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  Gmail: "bg-red-500/15 text-red-300 border-red-500/30",
};

function toolBadge(name: string) {
  if (!name) return null;
  const cls = TOOL_COLOR[name] ?? "bg-muted text-muted-foreground border-border";
  return <Badge variant="outline" className={cls}>{name}</Badge>;
}
function statusBadge(v: string) {
  const s = STATUSES.find((x) => x.v === v);
  if (!s) return <Badge variant="outline">{v}</Badge>;
  return <Badge variant="outline" className={s.color}>{s.l}</Badge>;
}

type FormState = {
  id?: string;
  title: string; content: string;
  brain_id: string | null; project_id: string | null;
  project_tool_link_id: string | null;
  source_tool: string; target_tool: string;
  content_type: string; status: string;
  tags: string; notes: string;
  next_action: string; source_url: string; output_result: string;
  execution_instructions: string; expected_output: string; success_criteria: string;
  risk_level: string; requires_approval: boolean;
  automation_status: string; automation_target: string;
  automation_connector_id: string | null;
};
const EMPTY_FORM: FormState = {
  title: "", content: "",
  brain_id: null, project_id: null, project_tool_link_id: null,
  source_tool: "", target_tool: "",
  content_type: "prompt", status: "saved",
  tags: "", notes: "",
  next_action: "", source_url: "", output_result: "",
  execution_instructions: "", expected_output: "", success_criteria: "",
  risk_level: "medium", requires_approval: true,
  automation_status: "manual", automation_target: "",
  automation_connector_id: null,
};

type ViewKey = "all" | "to_lovable" | "responses_to_rework" | "automation_queue" | "approval_center" | "connectors";
const QUEUE_STATUSES = ["ready_for_automation", "queued", "running", "failed"];

function ClipboardAIPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [fProject, setFProject] = useState<string>("all");
  const [fTool, setFTool] = useState<string>("all");
  const [fType, setFType] = useState<string>("all");
  const [fStatus, setFStatus] = useState<string>("all");
  const [fTag, setFTag] = useState<string>("all");
  const [view, setView] = useState<ViewKey>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const itemsQ = useQuery({
    queryKey: ["clipboard_items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clipboard_items")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ClipboardItem[];
    },
  });

  type ExecLog = {
    id: string;
    clipboard_item_id: string;
    action: string;
    previous_status: string | null;
    new_status: string | null;
    notes: string | null;
    created_at: string;
  };
  const logsQ = useQuery({
    queryKey: ["clipboard_execution_logs"],
    queryFn: async () => {
      const { data, error } = await (supabase as never as {
        from: (t: string) => {
          select: (s: string) => {
            order: (c: string, o: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data: ExecLog[] | null; error: Error | null }>;
            };
          };
        };
      })
        .from("clipboard_execution_logs")
        .select("id,clipboard_item_id,action,previous_status,new_status,notes,created_at")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as ExecLog[];
    },
  });
  const logsByItem = useMemo(() => {
    const m: Record<string, ExecLog[]> = {};
    for (const l of logsQ.data ?? []) {
      (m[l.clipboard_item_id] ??= []).push(l);
    }
    return m;
  }, [logsQ.data]);

  const logExecution = async (vars: {
    clipboard_item_id: string;
    action: string;
    previous_status?: string | null;
    new_status?: string | null;
    notes?: string | null;
  }) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await (supabase as never as { from: (t: string) => { insert: (r: unknown) => Promise<{ error: Error | null }> } })
      .from("clipboard_execution_logs")
      .insert({
        user_id: u.user.id,
        clipboard_item_id: vars.clipboard_item_id,
        action: vars.action,
        previous_status: vars.previous_status ?? null,
        new_status: vars.new_status ?? null,
        notes: vars.notes ?? null,
      });
  };

  const brainsQ = useQuery({
    queryKey: ["brains_min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brains").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
  const projectsQ = useQuery({
    queryKey: ["project_links_min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_links").select("id,title,brain_id").order("title");
      if (error) throw error;
      return (data ?? []) as { id: string; title: string; brain_id: string | null }[];
    },
  });
  const toolLinksQ = useQuery({
    queryKey: ["project_tool_links_min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_tool_links")
        .select("id,tool_name,tool_category,brain_id,url")
        .order("tool_name");
      if (error) throw error;
      return (data ?? []) as { id: string; tool_name: string; tool_category: string | null; brain_id: string | null; url: string | null }[];
    },
  });

  const items = itemsQ.data ?? [];
  const allTags = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => i.tags?.forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (view === "to_lovable") {
        if (i.target_tool !== "Lovable") return false;
        if (i.status === "used" || i.status === "archived") return false;
      } else if (view === "responses_to_rework") {
        if (i.content_type !== "ai_response" && i.status !== "to_classify") return false;
        if (i.status === "used" || i.status === "archived") return false;
      } else if (view === "automation_queue") {
        if (!QUEUE_STATUSES.includes(i.automation_status)) return false;
      } else if (view === "approval_center") {
        const inReview = ["pending", "revision_needed", "blocked"].includes(i.approval_status ?? "pending");
        if (!inReview) return false;
        if (!i.human_review_required) return false;
        if (i.status === "archived") return false;
      }
      if (q && !(`${i.title} ${i.content} ${i.notes} ${i.next_action} ${i.tags.join(" ")}`.toLowerCase().includes(q))) return false;
      if (fProject !== "all" && i.project_id !== fProject) return false;
      if (fTool !== "all" && i.source_tool !== fTool && i.target_tool !== fTool) return false;
      if (fType !== "all" && i.content_type !== fType) return false;
      if (fStatus !== "all" && i.status !== fStatus) return false;
      if (fTag !== "all" && !i.tags.includes(fTag)) return false;
      return true;
    });
  }, [items, search, fProject, fTool, fType, fStatus, fTag, view]);

  const viewCounts = useMemo(() => ({
    all: items.length,
    to_lovable: items.filter((i) => i.target_tool === "Lovable" && i.status !== "used" && i.status !== "archived").length,
    responses_to_rework: items.filter((i) =>
      (i.content_type === "ai_response" || i.status === "to_classify") &&
      i.status !== "used" && i.status !== "archived").length,
    automation_queue: items.filter((i) => QUEUE_STATUSES.includes(i.automation_status)).length,
    approval_center: items.filter((i) =>
      ["pending", "revision_needed", "blocked"].includes(i.approval_status ?? "pending") &&
      i.human_review_required &&
      i.status !== "archived").length,
  }), [items]);

  const saveMut = useMutation({
    mutationFn: async (f: FormState) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Non autenticato");
      const payload = {
        user_id: u.user.id,
        brain_id: f.brain_id,
        project_id: f.project_id,
        project_tool_link_id: f.project_tool_link_id,
        title: f.title.trim() || f.content.slice(0, 60),
        content: f.content,
        source_tool: f.source_tool,
        target_tool: f.target_tool,
        content_type: f.content_type,
        status: f.status,
        tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
        notes: f.notes,
        next_action: f.next_action,
        source_url: f.source_url,
        output_result: f.output_result,
        execution_instructions: f.execution_instructions,
        expected_output: f.expected_output,
        success_criteria: f.success_criteria,
        risk_level: f.risk_level,
        requires_approval: f.requires_approval,
        automation_status: f.automation_status,
        automation_target: f.automation_target,
        automation_connector_id: f.automation_connector_id,
      };
      if (f.id) {
        const { error } = await supabase.from("clipboard_items").update(payload).eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("clipboard_items").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clipboard_items"] });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      toast.success("Contenuto salvato");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchMut = useMutation({
    mutationFn: async (vars: { id: string; status: string }) => {
      const { error } = await supabase.from("clipboard_items").update({ status: vars.status }).eq("id", vars.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clipboard_items"] }),
  });

  const automationMut = useMutation({
    mutationFn: async (vars: {
      id: string;
      action: "queue" | "unqueue" | "running" | "done" | "failed" | "retry";
      currentAttempts: number;
      errorMessage?: string;
    }) => {
      const now = new Date().toISOString();
      type AutoPatch = {
        automation_status?: string;
        automation_last_error?: string | null;
        automation_last_run_at?: string;
        automation_completed_at?: string;
        automation_attempts?: number;
      };
      let patch: AutoPatch = {};
      switch (vars.action) {
        case "queue":
          patch = { automation_status: "queued", automation_last_error: null };
          break;
        case "unqueue":
          patch = { automation_status: "ready_for_automation" };
          break;
        case "running":
          patch = { automation_status: "running", automation_last_run_at: now };
          break;
        case "done":
          patch = { automation_status: "done", automation_completed_at: now, automation_last_error: null };
          break;
        case "failed":
          patch = {
            automation_status: "failed",
            automation_attempts: vars.currentAttempts + 1,
            automation_last_error: vars.errorMessage ?? "Errore non specificato",
          };
          break;
        case "retry":
          patch = {
            automation_status: "queued",
            automation_attempts: vars.currentAttempts + 1,
            automation_last_error: null,
          };
          break;
      }
      const prev = items.find((i) => i.id === vars.id)?.automation_status ?? null;
      const { error } = await supabase.from("clipboard_items").update(patch).eq("id", vars.id);
      if (error) throw error;
      const actionLabels: Record<string, string> = {
        queue: "Metti in coda", unqueue: "Rimuovi dalla coda",
        running: "Segna running", done: "Segna completato",
        failed: "Segna fallito", retry: "Riprova",
      };
      await logExecution({
        clipboard_item_id: vars.id,
        action: actionLabels[vars.action] ?? vars.action,
        previous_status: prev,
        new_status: patch.automation_status ?? null,
        notes: vars.errorMessage ?? null,
      });
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["clipboard_items"] });
      qc.invalidateQueries({ queryKey: ["clipboard_execution_logs"] });
      const labels: Record<string, string> = {
        queue: "In coda", unqueue: "Rimosso dalla coda",
        running: "Segnato come running", done: "Completato",
        failed: "Segnato come fallito", retry: "Rimesso in coda",
      };
      toast.success(labels[vars.action]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const prepareAutoMut = useMutation({
    mutationFn: async (item: ClipboardItem) => {
      const forceReview = item.risk_level === "high" || item.risk_level === "critical";
      const prev = item.automation_status;
      const { error } = await supabase.from("clipboard_items").update({
        automation_status: "ready_for_automation",
        human_review_required: forceReview ? true : (item.requires_approval ?? true),
      }).eq("id", item.id);
      if (error) throw error;
      await logExecution({
        clipboard_item_id: item.id,
        action: "Prepara per automazione",
        previous_status: prev,
        new_status: "ready_for_automation",
        notes: forceReview ? "Revisione forzata per rischio elevato" : null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clipboard_items"] });
      qc.invalidateQueries({ queryKey: ["clipboard_execution_logs"] });
      toast.success("Preparato per automazione");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approvalMut = useMutation({
    mutationFn: async (vars: { id: string; action: "approve" | "review" | "block"; notes?: string; reason?: string }) => {
      let patch: Record<string, unknown> = {};
      if (vars.action === "approve") {
        patch = {
          approval_status: "approved",
          approved_at: new Date().toISOString(),
          human_review_required: false,
          automation_status: "queued",
          blocked_reason: null,
        };
      } else if (vars.action === "review") {
        patch = {
          approval_status: "revision_needed",
          human_review_required: true,
          automation_status: "ready_for_automation",
          approval_notes: vars.notes ?? null,
        };
      } else if (vars.action === "block") {
        patch = {
          approval_status: "blocked",
          human_review_required: true,
          automation_status: "failed",
          blocked_reason: vars.reason ?? null,
        };
      }
      const prev = items.find((i) => i.id === vars.id);
      const prevApproval = prev?.approval_status ?? null;
      const newApproval = (patch.approval_status as string) ?? null;
      const { error } = await supabase.from("clipboard_items").update(patch as never).eq("id", vars.id);
      if (error) throw error;
      const actionLabels = { approve: "Approva per automazione", review: "Rimanda in revisione", block: "Blocca item" };
      await logExecution({
        clipboard_item_id: vars.id,
        action: actionLabels[vars.action],
        previous_status: prevApproval,
        new_status: newApproval,
        notes: vars.notes ?? vars.reason ?? null,
      });
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["clipboard_items"] });
      qc.invalidateQueries({ queryKey: ["clipboard_execution_logs"] });
      const labels = { approve: "Approvato per automazione", review: "Rimandato in revisione", block: "Item bloccato" };
      toast.success(labels[vars.action]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Automation Connectors (configuration only — no real automation is triggered)
  const connectorsQ = useQuery({
    queryKey: ["automation_connectors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_connectors")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AutomationConnector[];
    },
  });
  const connectors = connectorsQ.data ?? [];

  const [connectorDialogOpen, setConnectorDialogOpen] = useState(false);
  const [connectorForm, setConnectorForm] = useState<ConnectorForm>(EMPTY_CONNECTOR);

  const saveConnectorMut = useMutation({
    mutationFn: async (f: ConnectorForm) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Non autenticato");
      const payload = {
        user_id: u.user.id,
        name: f.name.trim(),
        type: f.type,
        target_tool: f.target_tool.trim(),
        webhook_url: f.webhook_url.trim() || null,
        browser_profile: f.browser_profile.trim() || null,
        is_active: f.is_active,
      };
      if (f.id) {
        const { error } = await supabase.from("automation_connectors").update(payload).eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("automation_connectors").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation_connectors"] });
      setConnectorDialogOpen(false);
      setConnectorForm(EMPTY_CONNECTOR);
      toast.success("Connector salvato");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleConnectorMut = useMutation({
    mutationFn: async (c: AutomationConnector) => {
      const { error } = await supabase.from("automation_connectors")
        .update({ is_active: !c.is_active }).eq("id", c.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automation_connectors"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteConnectorMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("automation_connectors").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation_connectors"] });
      toast.success("Connector eliminato");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openEditConnector(c: AutomationConnector) {
    setConnectorForm({
      id: c.id, name: c.name, type: c.type, target_tool: c.target_tool,
      webhook_url: c.webhook_url ?? "", browser_profile: c.browser_profile ?? "",
      is_active: c.is_active,
    });
    setConnectorDialogOpen(true);
  }



  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clipboard_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clipboard_items"] });
      toast.success("Eliminato");
    },
  });

  const duplicateMut = useMutation({
    mutationFn: async (item: ClipboardItem) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Non autenticato");
      const { error } = await supabase.from("clipboard_items").insert({
        user_id: u.user.id,
        brain_id: item.brain_id, project_id: item.project_id,
        project_tool_link_id: item.project_tool_link_id,
        title: `${item.title} (copia)`, content: item.content,
        source_tool: item.source_tool, target_tool: item.target_tool,
        content_type: item.content_type, status: "saved",
        tags: item.tags, notes: item.notes,
        next_action: item.next_action, source_url: item.source_url,
        output_result: "", automation_status: "manual",
        automation_target: item.automation_target,
        automation_connector_id: item.automation_connector_id,
        execution_instructions: item.execution_instructions,
        expected_output: item.expected_output,
        success_criteria: item.success_criteria,
        risk_level: item.risk_level ?? "medium",
        requires_approval: item.requires_approval ?? true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clipboard_items"] });
      toast.success("Duplicato");
    },
  });

  const createTaskMut = useMutation({
    mutationFn: async (item: ClipboardItem) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Non autenticato");
      const title = item.next_action?.trim() || `Usa prompt: ${item.title || item.content.slice(0, 50)}`;
      const desc = [
        item.next_action && `Prossima azione: ${item.next_action}`,
        item.target_tool && `Tool destinazione: ${item.target_tool}`,
        item.source_url && `Origine: ${item.source_url}`,
        `\n--- Contenuto ---\n${item.content}`,
      ].filter(Boolean).join("\n");
      const { error } = await supabase.from("tasks").insert({
        user_id: u.user.id, brain_id: item.brain_id,
        title, description: desc, status: "todo", priority: "medium",
      });
      if (error) throw error;
    },
    onSuccess: () => toast.success("Task creato"),
    onError: (e: Error) => toast.error(e.message),
  });

  const createRoadmapMut = useMutation({
    mutationFn: async (item: ClipboardItem) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Non autenticato");
      const title = item.next_action?.trim() || item.title || item.content.slice(0, 60);
      const { error } = await supabase.from("roadmap_items").insert({
        user_id: u.user.id, brain_id: item.brain_id,
        title, description: item.content, status: "todo", priority: "medium",
      });
      if (error) throw error;
    },
    onSuccess: () => toast.success("Roadmap item creato"),
    onError: (e: Error) => toast.error(e.message),
  });

  async function copyContent(item: ClipboardItem) {
    try {
      await navigator.clipboard.writeText(item.content);
      await supabase.from("clipboard_items")
        .update({ copied_count: item.copied_count + 1, last_copied_at: new Date().toISOString() })
        .eq("id", item.id);
      qc.invalidateQueries({ queryKey: ["clipboard_items"] });
      toast.success("Copiato negli appunti");
    } catch {
      toast.error("Impossibile copiare");
    }
  }

  function openEdit(item: ClipboardItem) {
    setForm({
      id: item.id,
      title: item.title, content: item.content,
      brain_id: item.brain_id, project_id: item.project_id,
      project_tool_link_id: item.project_tool_link_id,
      source_tool: item.source_tool, target_tool: item.target_tool,
      content_type: item.content_type, status: item.status,
      tags: item.tags.join(", "), notes: item.notes,
      next_action: item.next_action ?? "", source_url: item.source_url ?? "",
      output_result: item.output_result ?? "",
      execution_instructions: item.execution_instructions ?? "",
      expected_output: item.expected_output ?? "",
      success_criteria: item.success_criteria ?? "",
      risk_level: item.risk_level ?? "medium",
      requires_approval: item.requires_approval ?? true,
      automation_status: item.automation_status ?? "manual",
      automation_target: item.automation_target ?? "",
      automation_connector_id: item.automation_connector_id ?? null,
    });
    setDialogOpen(true);
  }

  function generateNextPrompt(item: ClipboardItem) {
    const next =
      `# Prossimo prompt (da: ${item.title || "contenuto"})\n\n` +
      `Contesto precedente:\n"""\n${item.content.slice(0, 800)}\n"""\n\n` +
      (item.next_action ? `Prossima azione richiesta: ${item.next_action}\n\n` : "") +
      `Obiettivo successivo: \n` +
      `Vincoli: \n` +
      `Output atteso: \n`;
    setForm({
      ...EMPTY_FORM,
      title: `Next: ${item.title || "prompt"}`,
      content: next,
      brain_id: item.brain_id, project_id: item.project_id,
      project_tool_link_id: item.project_tool_link_id,
      source_tool: item.target_tool || item.source_tool,
      target_tool: item.target_tool,
      content_type: "prompt", status: "to_classify",
      tags: item.tags.join(", "),
    });
    setDialogOpen(true);
  }

  const counts = useMemo(() => {
    const by = (s: string) => items.filter((i) => i.status === s).length;
    return {
      total: items.length, ready: by("ready"), toClassify: by("to_classify"),
      used: by("used"), archived: by("archived"),
    };
  }, [items]);

  const availableToolLinks = (toolLinksQ.data ?? [])
    .filter((t) => !form.brain_id || t.brain_id === form.brain_id);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <PageHeader
        title="Clipboard AI"
        subtitle="Centro operativo: salva, riusa, trasforma in task o roadmap, predisposto per automazione."
        actions={
          <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setForm(EMPTY_FORM); }}>
            <DialogTrigger asChild>
              <Button onClick={() => setForm(EMPTY_FORM)}>
                <Plus className="h-4 w-4 mr-2" /> Aggiungi contenuto
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{form.id ? "Modifica contenuto" : "Nuovo contenuto"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Titolo</Label>
                  <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Lasciato vuoto = generato dal contenuto" />
                </div>
                <div>
                  <Label>Contenuto *</Label>
                  <Textarea rows={8} value={form.content}
                    onChange={(e) => setForm({ ...form, content: e.target.value })}
                    placeholder="Incolla qui il prompt, la risposta, il codice…" />
                </div>
                <div>
                  <Label>URL di origine</Label>
                  <Input type="url" value={form.source_url}
                    onChange={(e) => setForm({ ...form, source_url: e.target.value })}
                    placeholder="https://chat.openai.com/... o thread Claude, link Gmail…" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Cervello</Label>
                    <Select value={form.brain_id ?? "none"}
                      onValueChange={(v) => setForm({ ...form, brain_id: v === "none" ? null : v, project_id: null, project_tool_link_id: null })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {(brainsQ.data ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Progetto</Label>
                    <Select value={form.project_id ?? "none"}
                      onValueChange={(v) => setForm({ ...form, project_id: v === "none" ? null : v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {(projectsQ.data ?? [])
                          .filter((p) => !form.brain_id || p.brain_id === form.brain_id)
                          .map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label>Strumento del progetto (project_tool_links)</Label>
                    <Select value={form.project_tool_link_id ?? "none"}
                      onValueChange={(v) => setForm({ ...form, project_tool_link_id: v === "none" ? null : v })}>
                      <SelectTrigger><SelectValue placeholder="Seleziona uno strumento collegato al progetto" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {availableToolLinks.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.tool_name}{t.tool_category ? ` · ${t.tool_category}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Tool origine</Label>
                    <Select value={form.source_tool || "none"} onValueChange={(v) => setForm({ ...form, source_tool: v === "none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {TOOLS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Tool destinazione</Label>
                    <Select value={form.target_tool || "none"} onValueChange={(v) => setForm({ ...form, target_tool: v === "none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {TOOLS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Tipo contenuto</Label>
                    <Select value={form.content_type} onValueChange={(v) => setForm({ ...form, content_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CONTENT_TYPES.map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Stato</Label>
                    <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Tag (separati da virgola)</Label>
                  <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}
                    placeholder="es. landing, brief, gpt5" />
                </div>
                <div>
                  <Label>Prossima azione (next_action)</Label>
                  <Input value={form.next_action} onChange={(e) => setForm({ ...form, next_action: e.target.value })}
                    placeholder="es. Inviare a Lovable per generare la sezione hero" />
                </div>
                <div>
                  <Label>Risultato / output ottenuto</Label>
                  <Textarea rows={4} value={form.output_result}
                    onChange={(e) => setForm({ ...form, output_result: e.target.value })}
                    placeholder="Incolla qui la risposta ottenuta dopo aver usato il prompt" />
                </div>
                <div>
                  <Label>Note</Label>
                  <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
                <div className="rounded-md border border-primary/20 p-4 space-y-4 bg-primary/5">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Sparkles className="h-4 w-4 text-primary" /> Execution Package
                  </div>
                  <div>
                    <Label>Istruzioni di esecuzione</Label>
                    <Textarea rows={3} value={form.execution_instructions}
                      onChange={(e) => setForm({ ...form, execution_instructions: e.target.value })}
                      placeholder="Passo-passo per eseguire questo prompt: dove incollarlo, come interpretare la risposta, parametri da sostituire…" />
                  </div>
                  <div>
                    <Label>Output atteso</Label>
                    <Textarea rows={2} value={form.expected_output}
                      onChange={(e) => setForm({ ...form, expected_output: e.target.value })}
                      placeholder="Cosa ci si aspetta di ricevere dopo l'esecuzione" />
                  </div>
                  <div>
                    <Label>Criteri di successo</Label>
                    <Textarea rows={2} value={form.success_criteria}
                      onChange={(e) => setForm({ ...form, success_criteria: e.target.value })}
                      placeholder="Come verificare che il risultato sia valido" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Livello rischio</Label>
                      <Select value={form.risk_level} onValueChange={(v) => setForm({ ...form, risk_level: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {RISK_LEVELS.map((r) => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-3 pt-6">
                      <input
                        id="requires_approval"
                        type="checkbox"
                        checked={form.requires_approval}
                        onChange={(e) => setForm({ ...form, requires_approval: e.target.checked })}
                        className="h-4 w-4 rounded border-border accent-primary"
                      />
                      <Label htmlFor="requires_approval" className="text-sm cursor-pointer">Richiede approvazione umana</Label>
                    </div>
                  </div>
                </div>
                <div className="rounded-md border border-dashed p-3 space-y-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Zap className="h-3.5 w-3.5" /> Predisposizione automazione esterna (n8n / Playwright) — non ancora attiva
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Stato automazione</Label>
                      <Select value={form.automation_status} onValueChange={(v) => setForm({ ...form, automation_status: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {AUTOMATION_STATUSES.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Target automazione</Label>
                      <Input value={form.automation_target}
                        onChange={(e) => setForm({ ...form, automation_target: e.target.value })}
                        placeholder="es. n8n:webhook-lovable, playwright:chatgpt" />
                  </div>
                  <div>
                    <Label className="text-xs">Connector (opzionale — solo associazione, nessuna esecuzione)</Label>
                    <Select
                      value={form.automation_connector_id ?? "none"}
                      onValueChange={(v) => setForm({ ...form, automation_connector_id: v === "none" ? null : v })}
                    >
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {connectors.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name} · {CONNECTOR_TYPES.find((t) => t.v === c.type)?.l ?? c.type}
                            {c.is_active ? " · attivo" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Annulla</Button>
                <Button onClick={() => saveMut.mutate(form)} disabled={saveMut.isPending || !form.content.trim()}>
                  {saveMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Salva
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { l: "Totali", v: counts.total, c: "text-foreground" },
          { l: "Pronti", v: counts.ready, c: "text-emerald-400" },
          { l: "Da classificare", v: counts.toClassify, c: "text-amber-400" },
          { l: "Usati", v: counts.used, c: "text-violet-400" },
          { l: "Archiviati", v: counts.archived, c: "text-muted-foreground" },
        ].map((s) => (
          <Card key={s.l}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{s.l}</div>
              <div className={`text-2xl font-semibold ${s.c}`}>{s.v}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Views */}
      <Tabs value={view} onValueChange={(v) => setView(v as ViewKey)}>
        <TabsList>
          <TabsTrigger value="all">Tutti · {viewCounts.all}</TabsTrigger>
          <TabsTrigger value="to_lovable">
            <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Da inviare a Lovable · {viewCounts.to_lovable}
          </TabsTrigger>
          <TabsTrigger value="responses_to_rework">
            Risposte da rielaborare · {viewCounts.responses_to_rework}
          </TabsTrigger>
          <TabsTrigger value="automation_queue">
            <Zap className="h-3.5 w-3.5 mr-1.5" /> Automation Queue · {viewCounts.automation_queue}
          </TabsTrigger>
          <TabsTrigger value="approval_center">
            <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Approval Center · {viewCounts.approval_center}
          </TabsTrigger>
          <TabsTrigger value="connectors">
            <Plug className="h-3.5 w-3.5 mr-1.5" /> Connectors · {connectors.length}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {view !== "connectors" && (<>
      {/* Filters */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Cerca per titolo, contenuto, next action, tag, note…"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Select value={fProject} onValueChange={setFProject}>
              <SelectTrigger><SelectValue placeholder="Progetto" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i progetti</SelectItem>
                {(projectsQ.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fTool} onValueChange={setFTool}>
              <SelectTrigger><SelectValue placeholder="Tool" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i tool</SelectItem>
                {TOOLS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fType} onValueChange={setFType}>
              <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i tipi</SelectItem>
                {CONTENT_TYPES.map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fStatus} onValueChange={setFStatus}>
              <SelectTrigger><SelectValue placeholder="Stato" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti gli stati</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fTag} onValueChange={setFTag}>
              <SelectTrigger><SelectValue placeholder="Tag" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i tag</SelectItem>
                {allTags.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Items */}
      {itemsQ.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-12 text-center text-muted-foreground">
          <Clipboard className="h-10 w-10 mx-auto mb-3 opacity-50" />
          Nessun contenuto in questa vista.
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((item) => {
            const project = (projectsQ.data ?? []).find((p) => p.id === item.project_id);
            const toolLink = (toolLinksQ.data ?? []).find((t) => t.id === item.project_tool_link_id);
            const connector = connectors.find((c) => c.id === item.automation_connector_id);
            const autoLabel = AUTOMATION_STATUSES.find((s) => s.v === item.automation_status)?.l;
            return (
              <Card key={item.id} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base line-clamp-2">{item.title || "(senza titolo)"}</CardTitle>
                    {statusBadge(item.status)}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {toolBadge(item.source_tool)}
                    {item.target_tool && item.target_tool !== item.source_tool && (
                      <>
                        <span className="text-xs text-muted-foreground self-center">→</span>
                        {toolBadge(item.target_tool)}
                      </>
                    )}
                    <Badge variant="secondary" className="text-xs">
                      {CONTENT_TYPES.find((t) => t.v === item.content_type)?.l ?? item.content_type}
                    </Badge>
                    {project && <Badge variant="outline" className="text-xs">{project.title}</Badge>}
                    {toolLink && (
                      <Badge variant="outline" className="text-xs bg-primary/10 border-primary/30">
                        🔗 {toolLink.tool_name}
                      </Badge>
                    )}
                    {item.risk_level && item.risk_level !== "low" && (() => {
                      const r = RISK_LEVELS.find((x) => x.v === item.risk_level);
                      if (!r) return null;
                      return (
                        <Badge variant="outline" className={`text-xs font-medium ${r.color}`}>
                          ⚠ {r.l}
                        </Badge>
                      );
                    })()}
                    {item.human_review_required && ["pending", "revision_needed", "blocked"].includes(item.approval_status ?? "pending") && (
                      <Badge variant="outline" className="text-xs bg-violet-500/15 text-violet-300 border-violet-500/30 font-medium">
                        <ShieldCheck className="h-3 w-3 mr-1" /> Da approvare
                      </Badge>
                    )}
                    {item.approval_status && APPROVAL_STATUSES[item.approval_status] && (
                      <Badge variant="outline" className={`text-xs font-medium ${APPROVAL_STATUSES[item.approval_status].color}`}>
                        {APPROVAL_STATUSES[item.approval_status].l}
                      </Badge>
                    )}
                    {item.automation_status && item.automation_status !== "manual" && (() => {
                      const cls: Record<string, string> = {
                        ready_for_automation: "bg-sky-500/20 text-sky-300 border-sky-500/40",
                        queued: "bg-amber-500/20 text-amber-300 border-amber-500/40",
                        running: "bg-blue-500/20 text-blue-300 border-blue-500/40 animate-pulse",
                        done: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
                        failed: "bg-red-500/20 text-red-300 border-red-500/40",
                      };
                      return (
                        <Badge variant="outline" className={`text-xs font-medium ${cls[item.automation_status] ?? "bg-muted"}`}>
                          <Zap className="h-3 w-3 mr-1" />{autoLabel}
                          {item.automation_attempts > 0 && ` · ${item.automation_attempts}x`}
                        </Badge>
                      );
                    })()}
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col gap-3">
                  <pre className="text-xs bg-muted/40 rounded-md p-3 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono">
                    {item.content}
                  </pre>
                  {item.next_action && (
                    <div className="text-xs flex items-start gap-2 bg-emerald-500/5 border border-emerald-500/20 rounded-md p-2">
                      <ListChecks className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                      <div><span className="text-emerald-400 font-medium">Prossima azione:</span> {item.next_action}</div>
                    </div>
                  )}
                  {(item.execution_instructions || item.expected_output || item.success_criteria || item.risk_level) && (
                    <details className="text-xs rounded-md border border-primary/20 bg-primary/5">
                      <summary className="cursor-pointer p-2 font-medium text-foreground hover:text-primary flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5" /> Execution Package
                        {item.risk_level && item.risk_level !== "low" && (
                          <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded border ${RISK_LEVELS.find((r) => r.v === item.risk_level)?.color}`}>
                            {RISK_LEVELS.find((r) => r.v === item.risk_level)?.l}
                          </span>
                        )}
                      </summary>
                      <div className="p-3 space-y-2 border-t border-primary/10">
                        {item.execution_instructions && (
                          <div>
                            <span className="text-muted-foreground font-medium">Istruzioni:</span>
                            <pre className="mt-1 bg-muted/30 rounded p-2 whitespace-pre-wrap font-mono">{item.execution_instructions}</pre>
                          </div>
                        )}
                        {item.expected_output && (
                          <div>
                            <span className="text-muted-foreground font-medium">Output atteso:</span>
                            <pre className="mt-1 bg-muted/30 rounded p-2 whitespace-pre-wrap font-mono">{item.expected_output}</pre>
                          </div>
                        )}
                        {item.success_criteria && (
                          <div>
                            <span className="text-muted-foreground font-medium">Criteri di successo:</span>
                            <pre className="mt-1 bg-muted/30 rounded p-2 whitespace-pre-wrap font-mono">{item.success_criteria}</pre>
                          </div>
                        )}
                        <div className="flex gap-x-4 text-muted-foreground">
                          <span>Rischio: <span className="text-foreground">{RISK_LEVELS.find((r) => r.v === item.risk_level)?.l ?? item.risk_level ?? "—"}</span></span>
                          <span>Approvazione: <span className="text-foreground">{item.requires_approval ? "Sì" : "No"}</span></span>
                        </div>
                      </div>
                    </details>
                  )}
                  {item.automation_status && item.automation_status !== "manual" && (
                    <div className="text-xs rounded-md border border-border bg-muted/30 p-2 space-y-1">
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                        <span>Tentativi: <span className="text-foreground font-medium">{item.automation_attempts}</span></span>
                        {item.automation_target && <span>Target: <span className="text-foreground">{item.automation_target}</span></span>}
                        {item.automation_last_run_at && (
                          <span>Ultima esecuzione: <span className="text-foreground">{new Date(item.automation_last_run_at).toLocaleString("it-IT")}</span></span>
                        )}
                        {item.automation_completed_at && (
                          <span>Completato: <span className="text-emerald-400">{new Date(item.automation_completed_at).toLocaleString("it-IT")}</span></span>
                        )}
                      </div>
                      {item.automation_last_error && (
                        <div className="text-red-400 break-words">
                          <span className="font-medium">Ultimo errore:</span> {item.automation_last_error}
                        </div>
                      )}
                    </div>
                  )}
                  {(item.approved_at || item.blocked_reason || item.approval_notes) && (
                    <div className="text-xs rounded-md border border-violet-500/20 bg-violet-500/5 p-2 space-y-1">
                      {item.approved_at && (
                        <div className="text-emerald-400">
                          <span className="font-medium">Approvato il:</span> {new Date(item.approved_at).toLocaleString("it-IT")}
                        </div>
                      )}
                      {item.blocked_reason && (
                        <div className="text-red-400 break-words">
                          <span className="font-medium">Motivo blocco:</span> {item.blocked_reason}
                        </div>
                      )}
                      {item.approval_notes && (
                        <div className="text-muted-foreground break-words">
                          <span className="font-medium text-foreground">Note revisione:</span> {item.approval_notes}
                        </div>
                      )}
                    </div>
                  )}
                  {(logsByItem[item.id]?.length ?? 0) > 0 && (
                    <details className="text-xs rounded-md border border-border bg-muted/20">
                      <summary className="cursor-pointer p-2 font-medium text-foreground hover:text-primary flex items-center gap-2">
                        📜 Execution Log <span className="text-muted-foreground">({logsByItem[item.id].length})</span>
                      </summary>
                      <div className="p-2 space-y-1.5 border-t border-border max-h-48 overflow-y-auto">
                        {logsByItem[item.id].slice(0, 5).map((l) => (
                          <div key={l.id} className="border-l-2 border-primary/30 pl-2">
                            <div className="text-muted-foreground">
                              {new Date(l.created_at).toLocaleString("it-IT")}
                            </div>
                            <div className="text-foreground font-medium">{l.action}</div>
                            {(l.previous_status || l.new_status) && (
                              <div className="text-muted-foreground">
                                <span className="text-foreground">{l.previous_status ?? "—"}</span>
                                {" → "}
                                <span className="text-foreground">{l.new_status ?? "—"}</span>
                              </div>
                            )}
                            {l.notes && <div className="text-muted-foreground italic break-words">{l.notes}</div>}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {item.output_result && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Mostra output ottenuto
                      </summary>
                      <pre className="mt-2 bg-muted/40 rounded-md p-2 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono">{item.output_result}</pre>
                    </details>
                  )}
                  {item.source_url && (
                    <a href={item.source_url} target="_blank" rel="noopener noreferrer"
                       className="text-xs inline-flex items-center gap-1 text-primary hover:underline truncate">
                      <ExternalLink className="h-3 w-3" /> {item.source_url}
                    </a>
                  )}
                  {item.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {item.tags.map((t) => <Badge key={t} variant="outline" className="text-[10px]">#{t}</Badge>)}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{new Date(item.created_at).toLocaleString("it-IT")}</span>
                    {item.copied_count > 0 && <span>Copiato {item.copied_count}×</span>}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1 border-t">
                    <Button size="sm" onClick={() => copyContent(item)}>
                      <Copy className="h-3.5 w-3.5 mr-1.5" /> Copia
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(item)}>
                      <Edit2 className="h-3.5 w-3.5 mr-1.5" /> Modifica
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => duplicateMut.mutate(item)}>
                      Duplica
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => createTaskMut.mutate(item)}
                      disabled={createTaskMut.isPending}>
                      <ListChecks className="h-3.5 w-3.5 mr-1.5" /> Crea task
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => createRoadmapMut.mutate(item)}
                      disabled={createRoadmapMut.isPending}>
                      <MapIcon className="h-3.5 w-3.5 mr-1.5" /> Roadmap
                    </Button>
                    {item.status !== "used" && (
                      <Button size="sm" variant="outline"
                        onClick={() => patchMut.mutate({ id: item.id, status: "used" })}>
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Usato
                      </Button>
                    )}
                    {item.status !== "archived" && (
                      <Button size="sm" variant="outline"
                        onClick={() => patchMut.mutate({ id: item.id, status: "archived" })}>
                        <Archive className="h-3.5 w-3.5 mr-1.5" /> Archivia
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => generateNextPrompt(item)}>
                      <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Prossimo prompt
                    </Button>

                    {/* Prepare for automation */}
                    {item.automation_status === "manual" && (
                      <Button size="sm" variant="outline" className="border-primary/40 text-primary"
                        onClick={() => prepareAutoMut.mutate(item)}
                        disabled={prepareAutoMut.isPending}>
                        <Zap className="h-3.5 w-3.5 mr-1.5" /> Prepara per automazione
                      </Button>
                    )}

                    {/* Approval Center actions */}
                    {item.human_review_required && ["pending", "revision_needed", "blocked"].includes(item.approval_status ?? "pending") && (
                      <>
                        <Button size="sm" variant="outline" className="border-emerald-500/40 text-emerald-300"
                          onClick={() => approvalMut.mutate({ id: item.id, action: "approve" })}
                          disabled={approvalMut.isPending}>
                          <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Approva
                        </Button>
                        <Button size="sm" variant="outline"
                          onClick={() => {
                            const notes = window.prompt("Note per la revisione (opzionale):", item.approval_notes ?? "");
                            if (notes === null) return;
                            approvalMut.mutate({ id: item.id, action: "review", notes: notes.trim() || undefined });
                          }}
                          disabled={approvalMut.isPending}>
                          <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Rimanda in revisione
                        </Button>
                        <Button size="sm" variant="outline" className="border-red-500/40 text-red-300"
                          onClick={() => {
                            const reason = window.prompt("Motivo del blocco:", item.blocked_reason ?? "");
                            if (reason === null) return;
                            if (!reason.trim()) { toast.error("Motivo richiesto"); return; }
                            approvalMut.mutate({ id: item.id, action: "block", reason: reason.trim() });
                          }}
                          disabled={approvalMut.isPending}>
                          <Ban className="h-3.5 w-3.5 mr-1.5" /> Blocca
                        </Button>
                      </>
                    )}

                    {/* Automation Queue actions */}
                    {(item.automation_status === "manual" || item.automation_status === "ready_for_automation") && (
                      <Button size="sm" variant="outline" className="border-amber-500/40 text-amber-300"
                        onClick={() => automationMut.mutate({ id: item.id, action: "queue", currentAttempts: item.automation_attempts })}>
                        <Zap className="h-3.5 w-3.5 mr-1.5" /> Metti in coda
                      </Button>
                    )}
                    {item.automation_status === "queued" && (
                      <>
                        <Button size="sm" variant="outline"
                          onClick={() => automationMut.mutate({ id: item.id, action: "unqueue", currentAttempts: item.automation_attempts })}>
                          Rimuovi dalla coda
                        </Button>
                        <Button size="sm" variant="outline" className="border-blue-500/40 text-blue-300"
                          onClick={() => automationMut.mutate({ id: item.id, action: "running", currentAttempts: item.automation_attempts })}>
                          Segna running
                        </Button>
                      </>
                    )}
                    {item.automation_status === "running" && (
                      <>
                        <Button size="sm" variant="outline" className="border-emerald-500/40 text-emerald-300"
                          onClick={() => automationMut.mutate({ id: item.id, action: "done", currentAttempts: item.automation_attempts })}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Completato
                        </Button>
                        <Button size="sm" variant="outline" className="border-red-500/40 text-red-300"
                          onClick={() => {
                            const msg = window.prompt("Descrivi l'errore:");
                            if (msg && msg.trim()) {
                              automationMut.mutate({ id: item.id, action: "failed", currentAttempts: item.automation_attempts, errorMessage: msg.trim() });
                            }
                          }}>
                          Segna fallito
                        </Button>
                      </>
                    )}
                    {item.automation_status === "failed" && (
                      <Button size="sm" variant="outline" className="border-amber-500/40 text-amber-300"
                        onClick={() => automationMut.mutate({ id: item.id, action: "retry", currentAttempts: item.automation_attempts })}>
                        <Zap className="h-3.5 w-3.5 mr-1.5" /> Riprova
                      </Button>
                    )}

                    <Button size="sm" variant="ghost" className="text-destructive ml-auto"
                      onClick={() => { if (confirm("Eliminare definitivamente?")) deleteMut.mutate(item.id); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      </>)}

      {view === "connectors" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Plug className="h-4 w-4" /> Connectors di automazione
              <span className="text-xs font-normal text-muted-foreground">
                (solo configurazione — nessuna esecuzione reale)
              </span>
            </CardTitle>
            <Dialog
              open={connectorDialogOpen}
              onOpenChange={(o) => { setConnectorDialogOpen(o); if (!o) setConnectorForm(EMPTY_CONNECTOR); }}
            >
              <DialogTrigger asChild>
                <Button size="sm" onClick={() => setConnectorForm(EMPTY_CONNECTOR)}>
                  <Plus className="h-4 w-4 mr-2" /> Nuovo connector
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>{connectorForm.id ? "Modifica connector" : "Nuovo connector"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Nome *</Label>
                    <Input value={connectorForm.name}
                      onChange={(e) => setConnectorForm({ ...connectorForm, name: e.target.value })}
                      placeholder="es. n8n Lovable webhook" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Tipo *</Label>
                      <Select value={connectorForm.type}
                        onValueChange={(v) => setConnectorForm({ ...connectorForm, type: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CONNECTOR_TYPES.map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Target tool *</Label>
                      <Input value={connectorForm.target_tool}
                        onChange={(e) => setConnectorForm({ ...connectorForm, target_tool: e.target.value })}
                        placeholder="es. Lovable, ChatGPT, Runway" />
                    </div>
                  </div>
                  <div>
                    <Label>Webhook URL</Label>
                    <Input value={connectorForm.webhook_url}
                      onChange={(e) => setConnectorForm({ ...connectorForm, webhook_url: e.target.value })}
                      placeholder="https://… (opzionale, non viene chiamato)" />
                  </div>
                  <div>
                    <Label>Browser profile</Label>
                    <Input value={connectorForm.browser_profile}
                      onChange={(e) => setConnectorForm({ ...connectorForm, browser_profile: e.target.value })}
                      placeholder="es. default, work (opzionale)" />
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      id="connector_active"
                      type="checkbox"
                      checked={connectorForm.is_active}
                      onChange={(e) => setConnectorForm({ ...connectorForm, is_active: e.target.checked })}
                      className="h-4 w-4 rounded border-border accent-primary"
                    />
                    <Label htmlFor="connector_active" className="text-sm cursor-pointer">
                      Attivo (predisposto per uso futuro)
                    </Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setConnectorDialogOpen(false)}>Annulla</Button>
                  <Button
                    onClick={() => saveConnectorMut.mutate(connectorForm)}
                    disabled={
                      saveConnectorMut.isPending ||
                      !connectorForm.name.trim() ||
                      !connectorForm.target_tool.trim()
                    }
                  >
                    {saveConnectorMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Salva
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {connectorsQ.isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : connectors.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                Nessun connector configurato. Creane uno per poter associare item ad automazioni future.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {connectors.map((c) => (
                  <div key={c.id} className="rounded-md border border-border p-3 space-y-2 bg-card">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{c.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {CONNECTOR_TYPES.find((t) => t.v === c.type)?.l ?? c.type} · {c.target_tool}
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          c.is_active
                            ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                            : "bg-muted text-muted-foreground border-border"
                        }
                      >
                        {c.is_active ? "Attivo" : "Inattivo"}
                      </Badge>
                    </div>
                    {c.webhook_url && (
                      <div className="text-xs text-muted-foreground truncate">
                        🔗 {c.webhook_url}
                      </div>
                    )}
                    {c.browser_profile && (
                      <div className="text-xs text-muted-foreground">
                        Profilo: {c.browser_profile}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button size="sm" variant="outline" onClick={() => openEditConnector(c)}>
                        <Edit2 className="h-3.5 w-3.5 mr-1.5" /> Modifica
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleConnectorMut.mutate(c)}
                        disabled={toggleConnectorMut.isPending}
                      >
                        {c.is_active
                          ? <><PowerOff className="h-3.5 w-3.5 mr-1.5" /> Disattiva</>
                          : <><Power className="h-3.5 w-3.5 mr-1.5" /> Attiva</>}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive ml-auto"
                        onClick={() => { if (confirm("Eliminare connector?")) deleteConnectorMut.mutate(c.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
