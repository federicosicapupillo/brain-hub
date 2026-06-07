import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

import { fetchAll, createNode } from "@/lib/brains-api";
import { supabase } from "@/integrations/supabase/client";
import { createManualSource, createUrlSource } from "@/lib/knowledge-api";
import { createTask, createRoadmapItem, logAction, pushLiveEvent } from "@/lib/workspace-api";

export const Route = createFileRoute("/_authenticated/importa")({
  component: ImportaPage,
  errorComponent: ({ error }) => (
    <div className="p-6" role="alert">Errore: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6">Pagina non trovata.</div>,
});

type ContentType =
  | "file" | "prompt" | "task" | "roadmap"
  | "note" | "external" | "rule" | "log" | "strategy";

const CONTENT_TYPES: { value: ContentType; label: string }[] = [
  { value: "file", label: "File / Documento" },
  { value: "prompt", label: "Prompt" },
  { value: "task", label: "Task" },
  { value: "roadmap", label: "Roadmap" },
  { value: "note", label: "Nota" },
  { value: "external", label: "Link esterno" },
  { value: "rule", label: "Regola progetto" },
  { value: "log", label: "Log operativo" },
  { value: "strategy", label: "Appunto strategico" },
];

const TOOLS = [
  "Lovable","Antigravity","ChatGPT","Claude","Perplexity","Runway",
  "Midjourney","ElevenLabs","D-ID","Supabase","GitHub","Obsidian","Altro",
];

const STATUSES = ["bozza","importato","pronto","da revisionare","approvato","archiviato"];

function ImportaPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: brainsData } = useQuery({
    queryKey: ["brains-all"],
    queryFn: fetchAll,
  });
  const brains = brainsData?.brains ?? [];

  const [brainId, setBrainId] = useState<string>("");
  const [contentType, setContentType] = useState<ContentType>("note");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [tool, setTool] = useState<string>("");
  const [status, setStatus] = useState<string>("importato");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<{ brainId: string; brainName: string } | null>(null);
  const [duplicateConfirm, setDuplicateConfirm] = useState(false);

  const selectedBrain = useMemo(
    () => brains.find((b) => b.id === brainId),
    [brains, brainId],
  );

  const tagList = useMemo(
    () => tags.split(",").map((t) => t.trim()).filter(Boolean),
    [tags],
  );

  const resetForm = () => {
    setTitle(""); setContent(""); setUrl(""); setTags("");
    setStatus("importato"); setTool(""); setDuplicateConfirm(false);
  };

  const checkDuplicate = async (): Promise<boolean> => {
    // Same title + brain + type → warn
    if (contentType === "task") {
      const { data } = await supabase.from("tasks").select("id")
        .eq("brain_id", brainId).eq("title", title).limit(1);
      return (data?.length ?? 0) > 0;
    }
    if (contentType === "roadmap") {
      const { data } = await supabase.from("roadmap_items").select("id")
        .eq("brain_id", brainId).eq("title", title).limit(1);
      return (data?.length ?? 0) > 0;
    }
    if (contentType === "prompt" || contentType === "external") {
      const lt = contentType === "prompt" ? "prompt" : "external";
      const { data } = await supabase.from("project_links").select("id")
        .eq("brain_id", brainId).eq("link_type", lt).eq("title", title).limit(1);
      return (data?.length ?? 0) > 0;
    }
    const { data } = await supabase.from("knowledge_sources").select("id")
      .eq("brain_id", brainId).eq("title", title).limit(1);
    return (data?.length ?? 0) > 0;
  };

  const handleSave = async (overrideType?: ContentType) => {
    const type = overrideType ?? contentType;
    if (!brainId) { toast.error("Seleziona un progetto di destinazione."); return; }
    if (!title.trim()) { toast.error("Il titolo è obbligatorio."); return; }
    if (type === "external" && !url.trim()) { toast.error("Inserisci l'URL del link esterno."); return; }
    if (type !== "external" && !content.trim() && !url.trim()) {
      toast.error("Inserisci il contenuto.");
      return;
    }

    setSaving(true);
    try {
      if (!duplicateConfirm) {
        const dup = await checkDuplicate();
        if (dup) {
          setDuplicateConfirm(true);
          toast.warning("Contenuto simile già presente. Premi di nuovo per salvarlo comunque.");
          setSaving(false);
          return;
        }
      }

      const metaCategory: Record<ContentType, string> = {
        file: "file", prompt: "prompt", task: "task", roadmap: "roadmap",
        note: "nota", external: "link", rule: "regola", log: "log", strategy: "strategia",
      };

      const desc = [tool && `Strumento: ${tool}`, status && `Stato: ${status}`]
        .filter(Boolean).join(" · ") || undefined;

      if (type === "task") {
        await createTask({
          brain_id: brainId, title: title.trim(),
          description: content.trim(), status: "todo",
        });
      } else if (type === "roadmap") {
        await createRoadmapItem({
          brain_id: brainId, title: title.trim(),
          description: content.trim(), status: "todo",
        });
      } else if (type === "prompt") {
        const { data: u } = await supabase.auth.getUser();
        const { error } = await supabase.from("project_links").insert({
          user_id: u.user!.id, brain_id: brainId, link_type: "prompt",
          relation_type: "prompt", title: title.trim(),
          notes: content.trim() || null, url: url.trim() || null,
          tool: tool || null, status: status || null, description: desc ?? null,
          category: tagList.length ? tagList.join(",") : null,
        });
        if (error) throw error;
        await logAction({ action: "prompt_imported", message: `Prompt importato: ${title}`, entity_type: "project_link", brain_id: brainId });
        await pushLiveEvent({ event_type: "import", title: `Prompt importato: ${title}`, brain_id: brainId });
      } else if (type === "external") {
        const { data: u } = await supabase.auth.getUser();
        const { error } = await supabase.from("project_links").insert({
          user_id: u.user!.id, brain_id: brainId, link_type: "external",
          relation_type: "collegato a", title: title.trim(),
          url: url.trim(), notes: content.trim() || null,
          tool: tool || null, status: status || null, description: desc ?? null,
          category: tagList.length ? tagList.join(",") : null,
        });
        if (error) throw error;
        await logAction({ action: "external_imported", message: `Link esterno: ${title}`, entity_type: "project_link", brain_id: brainId });
        await pushLiveEvent({ event_type: "import", title: `Link importato: ${title}`, brain_id: brainId });
      } else if (url.trim() && !content.trim()) {
        await createUrlSource({
          brain_id: brainId, title: title.trim(), url: url.trim(),
          description: desc, tags: [...tagList, metaCategory[type]],
        });
      } else {
        await createManualSource({
          brain_id: brainId, title: title.trim(),
          content: content.trim() || url.trim(),
          description: desc, tags: [...tagList, metaCategory[type]],
        });
      }

      qc.invalidateQueries({ queryKey: ["brains-all"] });
      qc.invalidateQueries({ queryKey: ["project-links"] });
      qc.invalidateQueries({ queryKey: ["project-links-bi"] });
      qc.invalidateQueries({ queryKey: ["project-links-counts"] });
      qc.invalidateQueries({ queryKey: ["knowledge-sources"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["roadmap"] });

      const brainName = selectedBrain?.name ?? "progetto";
      toast.success(`Contenuto salvato e collegato a ${brainName}.`);
      setLastSaved({ brainId, brainName });
      resetForm();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Errore durante il salvataggio";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Importatore Manuale"
        subtitle="Incolla prompt, note, export, link o testi e collegali al progetto corretto."
      />

      {lastSaved && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-4 flex flex-wrap items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <div className="flex-1 text-sm">
              Contenuto salvato e collegato a <strong>{lastSaved.brainName}</strong>.
            </div>
            <Button size="sm" variant="outline" asChild>
              <Link to="/progetti/$brainId" params={{ brainId: lastSaved.brainId }}>
                <ExternalLink className="h-4 w-4 mr-1" /> Apri progetto
              </Link>
            </Button>
            <Button size="sm" onClick={() => setLastSaved(null)}>
              Importa nuovo contenuto
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Progetto di destinazione *</Label>
              <Select value={brainId} onValueChange={setBrainId}>
                <SelectTrigger><SelectValue placeholder="Seleziona un progetto…" /></SelectTrigger>
                <SelectContent>
                  {brains.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo contenuto *</Label>
              <Select value={contentType} onValueChange={(v) => setContentType(v as ContentType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Titolo *</Label>
            <Input value={title} onChange={(e) => { setTitle(e.target.value); setDuplicateConfirm(false); }} placeholder="Titolo del contenuto" />
          </div>

          <div className="space-y-2">
            <Label>Contenuto</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                content || title
                  ? "Incolla qui prompt, note, markdown, export…"
                  : "Incolla qui il primo contenuto da collegare al tuo progetto."
              }
              rows={10}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>URL (opzionale)</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </div>
            <div className="space-y-2">
              <Label>Strumento collegato (opzionale)</Label>
              <Select value={tool} onValueChange={setTool}>
                <SelectTrigger><SelectValue placeholder="Nessuno" /></SelectTrigger>
                <SelectContent>
                  {TOOLS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Stato</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tag (separati da virgola)</Label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="es. marketing, brief, v2" />
            </div>
          </div>

          {duplicateConfirm && (
            <div className="text-sm rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              Contenuto simile già presente. Premi di nuovo "Salva" per confermare.
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={() => handleSave()} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salva contenuto
            </Button>
            <Button variant="secondary" onClick={() => handleSave()} disabled={saving}>
              Salva e collega al progetto
            </Button>
            <Button variant="outline" onClick={() => handleSave("prompt")} disabled={saving}>
              Salva come prompt
            </Button>
            <Button variant="outline" onClick={() => handleSave("task")} disabled={saving}>
              Salva come task
            </Button>
            <Button variant="outline" onClick={() => handleSave("roadmap")} disabled={saving}>
              Salva come roadmap
            </Button>
            <Button variant="ghost" onClick={() => { resetForm(); navigate({ to: "/progetti" }); }} disabled={saving}>
              Annulla
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
