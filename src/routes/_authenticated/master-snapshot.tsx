import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FileText, CheckCircle2, X, Clock, History, ExternalLink, FileUp, Lock } from "lucide-react";
import { MasterSnapshotUpdateButton } from "@/components/MasterSnapshotUpdateButton";
import {
  listMasterSnapshots,
  approveMasterSnapshotUpdate,
  rejectMasterSnapshotUpdate,
  createInitialMasterSnapshot,
  createDraftFromMarkdown,
  normalizeSnapshotMarkdownVersion,
  logMasterSnapshotEvent,
  getSnapshotVersionLabel,
  getMasterSnapshotVersionWarnings,
  isLegacyVersionLabel,
  computeNextVersionLabel,
  type MasterSnapshotVersion,
  type MasterSnapshotStatus,
} from "@/lib/master-snapshot";

export const Route = createFileRoute("/_authenticated/master-snapshot")({
  head: () => ({
    meta: [
      { title: "Master Snapshot — Brain Hub" },
      {
        name: "description",
        content:
          "Fonte di verità versionata del progetto Brain Hub: stato corrente, bozze, storico aggiornamenti.",
      },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    draft: typeof s.draft === "string" ? s.draft : undefined,
    brain: typeof s.brain === "string" ? s.brain : undefined,
  }),
  component: MasterSnapshotRoute,
});

const STATUS_LABEL: Record<MasterSnapshotStatus, string> = {
  current: "Corrente",
  archived: "Archiviata",
  draft_update: "Bozza",
  approved_update: "Approvata",
};

const STATUS_TONE: Record<MasterSnapshotStatus, string> = {
  current: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  archived: "bg-muted text-muted-foreground",
  draft_update: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  approved_update: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
};

const INITIAL_TEMPLATE = `# Brain Hub — Master Project Snapshot

**Versione documento:** 1.0
**Stato:** Documento iniziale

## 1. Sintesi esecutiva

Brain Hub è un AI Project Operating System.

## 2. Stato moduli

_Da popolare al primo aggiornamento approvato._
`;

function MasterSnapshotRoute() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { draft: draftFromUrl } = Route.useSearch();

  useEffect(() => {
    void logMasterSnapshotEvent("master_snapshot_opened", "Pagina Master Snapshot aperta");
  }, []);

  const { data: versions = [], isLoading } = useQuery({
    queryKey: ["master-snapshots"],
    queryFn: () => listMasterSnapshots(),
  });

  const current = useMemo(
    () => versions.find((v) => v.version_status === "current") ?? null,
    [versions],
  );
  const drafts = useMemo(
    () => versions.filter((v) => v.version_status === "draft_update"),
    [versions],
  );
  const archived = useMemo(
    () =>
      versions
        .filter(
          (v) => v.version_status === "archived" || v.version_status === "approved_update",
        )
        .slice()
        .sort((a, b) => {
          const ax = a.approved_at ?? a.created_at;
          const bx = b.approved_at ?? b.created_at;
          return bx.localeCompare(ax);
        }),
    [versions],
  );
  const warnings = useMemo(() => getMasterSnapshotVersionWarnings(versions), [versions]);
  const expectedNext = useMemo(() => computeNextVersionLabel(versions), [versions]);

  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(draftFromUrl ?? null);
  useEffect(() => {
    if (draftFromUrl && draftFromUrl !== selectedDraftId) {
      setSelectedDraftId(draftFromUrl);
    }
  }, [draftFromUrl, selectedDraftId]);
  const selectedDraft = useMemo(
    () => drafts.find((d) => d.id === selectedDraftId) ?? drafts[0] ?? null,
    [drafts, selectedDraftId],
  );

  const [editor, setEditor] = useState("");
  useEffect(() => {
    setEditor(selectedDraft?.markdown_content ?? "");
  }, [selectedDraft?.id, selectedDraft?.markdown_content]);

  async function handleApprove() {
    if (!selectedDraft) return;
    try {
      const saved = await approveMasterSnapshotUpdate(selectedDraft.id, editor);
      toast.success(`Master Snapshot salvato come v${saved.version_label}`);
      await qc.invalidateQueries({ queryKey: ["master-snapshots"] });
      setSelectedDraftId(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Errore";
      toast.error(msg);
    }
  }

  async function handleReject() {
    if (!selectedDraft) return;
    try {
      await rejectMasterSnapshotUpdate(selectedDraft.id);
      toast.success("Proposta rifiutata");
      await qc.invalidateQueries({ queryKey: ["master-snapshots"] });
      setSelectedDraftId(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Errore";
      toast.error(msg);
    }
  }

  async function handleCreateInitial() {
    try {
      await createInitialMasterSnapshot(INITIAL_TEMPLATE);
      toast.success("Master Snapshot iniziale creato");
      await qc.invalidateQueries({ queryKey: ["master-snapshots"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Errore";
      toast.error(msg);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <PageHeader
        title="Master Snapshot"
        subtitle="Fonte di verità versionata del progetto Brain Hub"
        actions={
          <div className="flex flex-wrap gap-2">
            <ImportMarkdownButton
              onCreated={async (draftId) => {
                await qc.invalidateQueries({ queryKey: ["master-snapshots"] });
                setSelectedDraftId(draftId);
                try {
                  await navigate({ to: "/master-snapshot", search: { draft: draftId } });
                } catch (e) {
                  console.error("[MasterSnapshot] navigate failed", e);
                }
              }}
            />
            <MasterSnapshotUpdateButton
              source="manual"
              defaultReason="Aggiornamento manuale"
              variant="default"
            />
          </div>
        }
      />

      {draftFromUrl && selectedDraft && (
        <div className="rounded-md border border-amber-400/40 bg-amber-500/10 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">Stai modificando una bozza</div>
              <div className="text-xs text-muted-foreground">
                v{getSnapshotVersionLabel(selectedDraft)} · {selectedDraft.reason ?? "—"}
              </div>
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link to="/master-snapshot" search={{}}>
                Torna alla panoramica
              </Link>
            </Button>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Avvisi integrità versione ({warnings.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {warnings.map((w) => (
              <div
                key={w.id}
                className={`rounded-md border p-2 text-xs ${
                  w.level === "warning"
                    ? "border-amber-400/40 bg-amber-500/10"
                    : "border-sky-400/30 bg-sky-500/10"
                }`}
              >
                <div className="font-medium">{w.title}</div>
                <div className="text-muted-foreground">{w.description}</div>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">
              Prossima versione attesa all'approvazione: v{expectedNext}.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Current version */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Lock className="h-4 w-4 text-muted-foreground" />
              Versione corrente — sola lettura
            </CardTitle>
            {current && (
              <div className="flex items-center gap-2">
                {isLegacyVersionLabel(current.version_label) && (
                  <Badge variant="outline" className="text-[10px]">legacy label</Badge>
                )}
                <Badge className={STATUS_TONE.current}>v{getSnapshotVersionLabel(current)}</Badge>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Caricamento…</p>
          ) : !current ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Nessun Master Snapshot corrente. Crea la versione iniziale.
              </p>
              <Button size="sm" onClick={handleCreateInitial}>
                Crea Master Snapshot iniziale
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>
                  Ultimo aggiornamento: {new Date(current.updated_at).toLocaleString()}
                </span>
                {current.reason && <span>· Motivo: {current.reason}</span>}
                <span>· Sorgente: {current.source}</span>
              </div>
              <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                {normalizeSnapshotMarkdownVersion(current.markdown_content)}
              </pre>
              <p className="text-xs text-muted-foreground">
                La versione ufficiale è quella mostrata nella scheda del Master Snapshot
                (v{current.version_label}). Eventuali righe "Versione documento" nel
                markdown vengono normalizzate per evitare disallineamenti.
              </p>
              <p className="text-xs text-muted-foreground">
                Per modificare il Master Snapshot crea una bozza e approvala. Le versioni
                precedenti restano nello storico.
              </p>
            </div>
          )}
        </CardContent>
      </Card>


      {/* Drafts */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Proposte di aggiornamento ({drafts.length})
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nessuna proposta pendente. Usa "Aggiorna Master Snapshot" in Result Review, Action
              Queue, Build Engines o Project Console.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-2 md:grid-cols-2">
                {drafts.map((d) => (
                  <div
                    key={d.id}
                    className={`rounded-md border p-3 transition hover:bg-muted/50 ${
                      selectedDraft?.id === d.id ? "border-primary" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedDraftId(d.id)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between">
                        <Badge className={STATUS_TONE.draft_update}>v{getSnapshotVersionLabel(d)}</Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(d.created_at).toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-1 text-sm font-medium">{d.reason ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">Sorgente: {d.source}</div>
                    </button>
                    <div className="mt-2 flex justify-end">
                      <Button asChild size="sm" variant="ghost">
                        <Link
                          to="/master-snapshot"
                          search={{ draft: d.id }}
                          onClick={() => setSelectedDraftId(d.id)}
                        >
                          <ExternalLink className="mr-1 h-3 w-3" />
                          Apri bozza
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {selectedDraft && (
                <DraftDetail
                  draft={selectedDraft}
                  editor={editor}
                  setEditor={setEditor}
                  onApprove={handleApprove}
                  onReject={handleReject}
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" />
            Storico versioni ({archived.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {archived.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessuna versione archiviata.</p>
          ) : (
            <ul className="divide-y">
              {archived.map((v) => (
                <li key={v.id} className="flex items-center justify-between py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge className={STATUS_TONE[v.version_status]}>
                      v{getSnapshotVersionLabel(v)}
                    </Badge>
                    {isLegacyVersionLabel(v.version_label) && (
                      <Badge variant="outline" className="text-[10px]">legacy</Badge>
                    )}
                    <span>{v.reason ?? "—"}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(v.approved_at ?? v.created_at).toLocaleString()} · {v.source}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DraftDetail({
  draft,
  editor,
  setEditor,
  onApprove,
  onReject,
}: {
  draft: MasterSnapshotVersion;
  editor: string;
  setEditor: (v: string) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const c = draft.changes;
  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Bozza v{getSnapshotVersionLabel(draft)}</div>
          <div className="text-xs text-muted-foreground">{draft.reason}</div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onReject}>
            <X className="mr-1 h-3 w-3" /> Rifiuta
          </Button>
          <Button size="sm" onClick={onApprove}>
            <CheckCircle2 className="mr-1 h-3 w-3" /> Approva e salva versione
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 text-xs">
        {c.what_changed && (
          <Section title="Cosa è cambiato">{c.what_changed}</Section>
        )}
        {c.modules_completed?.length ? (
          <Section title="Moduli completati">
            <ListBlock items={c.modules_completed} />
          </Section>
        ) : null}
        {c.files_modified?.length ? (
          <Section title="File modificati">
            <ListBlock items={c.files_modified} />
          </Section>
        ) : null}
        {c.migrations?.length ? (
          <Section title="Migration">
            <ListBlock items={c.migrations} />
          </Section>
        ) : null}
        {(c.typecheck_status || c.build_status) && (
          <Section title="Verifica">
            {c.typecheck_status && <div>typecheck: {c.typecheck_status}</div>}
            {c.build_status && <div>build: {c.build_status}</div>}
          </Section>
        )}
        {c.residual_risks?.length ? (
          <Section title="Rischi residui">
            <ListBlock items={c.residual_risks} />
          </Section>
        ) : null}
        {c.residual_limits?.length ? (
          <Section title="Limiti residui">
            <ListBlock items={c.residual_limits} />
          </Section>
        ) : null}
        {c.sections_updated?.length ? (
          <Section title="Sezioni Master Snapshot aggiornate">
            <ListBlock items={c.sections_updated} />
          </Section>
        ) : null}
        {c.next_step && <Section title="Prossimo step">{c.next_step}</Section>}
      </div>

      <div>
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          <FileText className="h-3 w-3" />
          Contenuto Master Snapshot (modificabile prima dell'approvazione)
        </div>
        <Textarea
          rows={14}
          value={editor}
          onChange={(e) => setEditor(e.target.value)}
          className="font-mono text-xs"
        />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border bg-muted/30 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function ListBlock({ items }: { items: string[] }) {
  return (
    <ul className="list-disc pl-4">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

function ImportMarkdownButton({ onCreated }: { onCreated: (draftId: string) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("Import markdown");
  const [summary, setSummary] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (!reason.trim()) {
      toast.error("Inserisci un motivo");
      return;
    }
    if (!markdown.trim()) {
      toast.error("Incolla il contenuto markdown");
      return;
    }
    setBusy(true);
    try {
      const draft = await createDraftFromMarkdown({
        reason: reason.trim(),
        summary: summary.trim() || undefined,
        markdown,
      });
      toast.success("Bozza markdown creata");
      setOpen(false);
      setMarkdown("");
      setSummary("");
      await onCreated(draft.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Errore";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileUp className="mr-1 h-3 w-3" />
          Importa Markdown
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Crea bozza da Markdown</DialogTitle>
          <DialogDescription>
            Incolla il contenuto completo di un file .md. Verrà creata una nuova bozza —
            la versione corrente resta invariata finché non approvi. Eventuali righe
            "Versione documento" verranno normalizzate: la versione ufficiale è quella
            gestita da Brain Hub e mostrata nella scheda del Master Snapshot.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="im-reason">Motivo aggiornamento *</Label>
            <Input id="im-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="im-summary">Sintesi</Label>
            <Textarea id="im-summary" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="im-md">Contenuto markdown *</Label>
            <Textarea
              id="im-md"
              rows={16}
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              placeholder="# Brain Hub — Master Project Snapshot..."
              className="font-mono text-xs"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {markdown.length} caratteri
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Annulla
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? "Creazione…" : "Crea bozza da Markdown"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
