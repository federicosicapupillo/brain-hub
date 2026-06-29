// ============================================================
// Brain Hub v3.27 — Gmail Console route
// ============================================================
// Single deterministic surface for Gmail inside Brain Hub.
// Lavora sulla cache sincronizzata da Gmail Connector e usa
// `executeEmailActionFn` (Controlled Action Layer) per ogni
// modifica. Le bozze restano locali (vedi gmail-console.functions).
// ============================================================

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Archive,
  CheckCircle2,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  MailPlus,
  RefreshCw,
  Reply,
  RotateCcw,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";

import {
  getGmailConsoleStatusFn,
  listGmailConsoleMessagesFn,
  listGmailConsoleLabelsFn,
  saveGmailConsoleDraftFn,
  listGmailConsoleDraftsFn,
  deleteGmailConsoleDraftFn,
  generateGmailConsoleReplyFn,
  type GmailConsoleFilter,
  type GmailConsoleMessage,
} from "@/lib/gmail-console.functions";
import { executeEmailActionFn } from "@/lib/gmail-intelligence.functions";
import { logGmailConnectorEvent } from "@/lib/gmail-connector";

export const Route = createFileRoute("/_authenticated/gmail-console")({
  head: () => ({
    meta: [
      { title: "Gmail Console — Brain Hub" },
      {
        name: "description",
        content:
          "Controller deterministico Gmail: stato, ricerca, filtri rapidi, azioni controllate e bozze AI. Brain Hub è la source of truth.",
      },
    ],
  }),
  component: GmailConsoleRoute,
});

const FILTERS: { id: GmailConsoleFilter; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "today", label: "Oggi" },
  { id: "unread", label: "Non lette" },
  { id: "important", label: "Importanti" },
  { id: "starred", label: "Starred" },
  { id: "promotions", label: "Promo" },
  { id: "social", label: "Social" },
  { id: "updates", label: "Updates" },
  { id: "spam", label: "Spam" },
  { id: "trash", label: "Cestino" },
  { id: "all", label: "Tutte" },
];

const DESTRUCTIVE_ACTIONS = new Set(["trash", "archive"]);

type ActionKind =
  | "archive"
  | "mark_read"
  | "mark_unread"
  | "trash"
  | "restore";

function GmailConsoleRoute() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<GmailConsoleFilter>("inbox");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    action: ActionKind;
    msg: GmailConsoleMessage;
  } | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composer, setComposer] = useState<{
    id?: string;
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    body: string;
    inReplyToGmailMessageId?: string | null;
    inReplyToGmailThreadId?: string | null;
    forwardOfGmailMessageId?: string | null;
    generatedByAi?: boolean;
  }>({ to: "", cc: "", bcc: "", subject: "", body: "" });
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiTone, setAiTone] = useState<"neutro" | "cordiale" | "formale" | "diretto">("cordiale");

  // Debounce search
  useMemo(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Server fns
  const statusFn = useServerFn(getGmailConsoleStatusFn);
  const listFn = useServerFn(listGmailConsoleMessagesFn);
  const labelsFn = useServerFn(listGmailConsoleLabelsFn);
  const draftsFn = useServerFn(listGmailConsoleDraftsFn);
  const saveDraftFn = useServerFn(saveGmailConsoleDraftFn);
  const deleteDraftFn = useServerFn(deleteGmailConsoleDraftFn);
  const replyAiFn = useServerFn(generateGmailConsoleReplyFn);
  const actionFn = useServerFn(executeEmailActionFn);

  const statusQ = useQuery({
    queryKey: ["gmail-console-status"],
    queryFn: () => statusFn({ data: {} }),
    refetchInterval: 60_000,
  });

  const listQ = useQuery({
    queryKey: ["gmail-console-list", filter, debouncedSearch],
    queryFn: () =>
      listFn({
        data: { filter, search: debouncedSearch, limit: 100 },
      }),
  });

  const labelsQ = useQuery({
    queryKey: ["gmail-console-labels"],
    queryFn: () => labelsFn({ data: {} }),
  });

  const draftsQ = useQuery({
    queryKey: ["gmail-console-drafts"],
    queryFn: () => draftsFn({ data: {} }),
  });

  const messages: GmailConsoleMessage[] =
    (listQ.data && "messages" in listQ.data && listQ.data.messages) || [];
  const selected = messages.find((m) => m.local_id === selectedId) ?? null;

  // ---------------- Actions ----------------

  const actionMut = useMutation({
    mutationFn: async (input: {
      action: ActionKind | string;
      msg: GmailConsoleMessage;
    }) => {
      const res = await actionFn({
        data: {
          gmail_message_id: input.msg.gmail_message_id,
          action_type: input.action,
        },
      });
      return { res, input };
    },
    onSuccess: async ({ res, input }) => {
      if (!res.ok) {
        toast.error(`Azione fallita: ${res.error ?? "errore sconosciuto"}`);
        return;
      }
      toast.success(`Azione eseguita: ${input.action}`);
      void logGmailConnectorEvent(
        `gmail_${input.action}`,
        `Azione Gmail Console: ${input.action}`,
        { source: "ui_button" },
      );
      await qc.invalidateQueries({ queryKey: ["gmail-console-list"] });
      await qc.invalidateQueries({ queryKey: ["gmail-console-status"] });
    },
  });

  function requestAction(action: ActionKind, msg: GmailConsoleMessage) {
    if (DESTRUCTIVE_ACTIONS.has(action)) {
      setConfirm({ action, msg });
      return;
    }
    actionMut.mutate({ action, msg });
  }

  function confirmDestructive() {
    if (!confirm) return;
    actionMut.mutate({ action: confirm.action, msg: confirm.msg });
    setConfirm(null);
  }

  // ---------------- Composer ----------------

  function openReply(msg: GmailConsoleMessage) {
    setComposer({
      to: msg.from_email ?? "",
      cc: "",
      bcc: "",
      subject:
        msg.subject && !/^re:/i.test(msg.subject)
          ? `Re: ${msg.subject}`
          : msg.subject ?? "Re:",
      body: "",
      inReplyToGmailMessageId: msg.gmail_message_id,
      inReplyToGmailThreadId: msg.gmail_thread_id,
    });
    setComposerOpen(true);
    void logGmailConnectorEvent("gmail_reply_draft", "Apertura composer reply", {
      source: "ui_button",
    });
  }

  function openForward(msg: GmailConsoleMessage) {
    setComposer({
      to: "",
      cc: "",
      bcc: "",
      subject:
        msg.subject && !/^fwd:/i.test(msg.subject)
          ? `Fwd: ${msg.subject}`
          : msg.subject ?? "Fwd:",
      body: `\n\n---\nInoltro: ${msg.subject ?? "(senza oggetto)"}\nDa: ${msg.from_name ?? ""} <${msg.from_email ?? ""}>\n\n${msg.snippet ?? ""}`,
      forwardOfGmailMessageId: msg.gmail_message_id,
    });
    setComposerOpen(true);
    void logGmailConnectorEvent("gmail_forward", "Apertura composer forward", {
      source: "ui_button",
    });
  }

  function openNew() {
    setComposer({ to: "", cc: "", bcc: "", subject: "", body: "" });
    setComposerOpen(true);
  }

  function parseList(v: string): string[] {
    return v
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function saveDraft(asReady = false) {
    const payload = {
      id: composer.id,
      in_reply_to_gmail_message_id: composer.inReplyToGmailMessageId ?? null,
      in_reply_to_gmail_thread_id: composer.inReplyToGmailThreadId ?? null,
      forward_of_gmail_message_id: composer.forwardOfGmailMessageId ?? null,
      to_emails: parseList(composer.to),
      cc_emails: parseList(composer.cc),
      bcc_emails: parseList(composer.bcc),
      subject: composer.subject,
      body: composer.body,
      generated_by_ai: Boolean(composer.generatedByAi),
      status: (asReady ? "ready" : "draft") as "ready" | "draft",
    };
    const res = await saveDraftFn({ data: payload });
    if (!res.ok) {
      toast.error("Salvataggio bozza fallito");
      return;
    }
    toast.success(asReady ? "Bozza marcata pronta" : "Bozza salvata");
    setComposer((c) => ({ ...c, id: res.id }));
    await qc.invalidateQueries({ queryKey: ["gmail-console-drafts"] });
    await qc.invalidateQueries({ queryKey: ["gmail-console-status"] });
  }

  async function generateAi() {
    if (!composer.inReplyToGmailMessageId) {
      toast.error("La risposta AI richiede una mail di origine.");
      return;
    }
    const res = await replyAiFn({
      data: {
        gmail_message_id: composer.inReplyToGmailMessageId,
        instruction: aiInstruction,
        tone: aiTone,
      },
    });
    if (!res.ok) {
      toast.error(`AI: ${res.error}`);
      return;
    }
    setComposer((c) => ({
      ...c,
      body: res.draft_body,
      subject: c.subject || res.suggested_subject,
      to: c.to || (res.suggested_to ?? []).join(", "),
      generatedByAi: true,
    }));
    toast.success("Bozza AI generata. Modifica prima di salvare.");
  }

  // ---------------- Render ----------------

  const status = statusQ.data;
  const counts = status?.counts;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="Gmail Console"
        subtitle="Brain Hub è il controller di Gmail. Tutte le azioni passano dal Controlled Action Layer; le bozze AI restano locali finché non confermi l'invio."
      />

      {/* Status */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="h-4 w-4" /> Stato connessione
            </CardTitle>
            <CardDescription>
              {status?.connected
                ? `Account: ${status.google_email ?? "?"} · Ultima sync: ${
                    status.last_sync_at
                      ? new Date(status.last_sync_at).toLocaleString()
                      : "—"
                  }`
                : "Gmail non collegato"}
              {status?.requires_reauth ? " · Richiede ri-autenticazione" : ""}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/gmail-connector">Gmail Connector</Link>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void qc.invalidateQueries({ queryKey: ["gmail-console-status"] });
                void qc.invalidateQueries({ queryKey: ["gmail-console-list"] });
              }}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <Stat label="Totali" value={counts?.total ?? 0} />
            <Stat label="Inbox" value={counts?.inbox ?? 0} />
            <Stat label="Non lette" value={counts?.unread ?? 0} tone="high" />
            <Stat label="Oggi" value={counts?.today ?? 0} />
            <Stat label="Cestino" value={counts?.trashed ?? 0} />
            <Stat label="Bozze AI" value={counts?.drafts_local ?? 0} tone="accent" />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="inbox" className="w-full">
        <TabsList>
          <TabsTrigger value="inbox">Posta</TabsTrigger>
          <TabsTrigger value="drafts">Bozze ({counts?.drafts_local ?? 0})</TabsTrigger>
          <TabsTrigger value="labels">Etichette</TabsTrigger>
        </TabsList>

        {/* ---------- Inbox tab ---------- */}
        <TabsContent value="inbox" className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Input
              placeholder="Cerca mittente, oggetto, testo…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <Button size="sm" variant="outline" onClick={openNew}>
              <MailPlus className="mr-1 h-3 w-3" /> Nuova bozza
            </Button>
            {listQ.isFetching ? (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> caricamento…
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <Button
                key={f.id}
                size="sm"
                variant={filter === f.id ? "default" : "outline"}
                onClick={() => {
                  setFilter(f.id);
                  setSelectedId(null);
                  void logGmailConnectorEvent(
                    "gmail_console_open",
                    "Cambio filtro Gmail Console",
                    { filter: f.id },
                  );
                }}
              >
                {f.label}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
            {/* List */}
            <Card className="lg:col-span-2">
              <CardHeader className="py-3">
                <CardTitle className="text-sm">
                  {messages.length} messagg{messages.length === 1 ? "io" : "i"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 max-h-[70vh] overflow-y-auto">
                {messages.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nessun messaggio per questo filtro.
                  </p>
                ) : (
                  messages.map((m) => (
                    <button
                      key={m.local_id}
                      onClick={() => {
                        setSelectedId(m.local_id);
                        void logGmailConnectorEvent(
                          "gmail_message_open",
                          "Apertura messaggio dalla console",
                          { has_attachments: m.has_attachments },
                        );
                      }}
                      className={`w-full text-left border rounded-md p-2 hover:bg-muted/50 transition ${
                        selectedId === m.local_id ? "border-primary bg-muted/40" : ""
                      } ${m.is_unread ? "font-medium" : ""}`}
                    >
                      <div className="flex items-center gap-1 flex-wrap text-xs">
                        {m.is_unread ? (
                          <Badge variant="default" className="h-4 px-1 text-[10px]">
                            NEW
                          </Badge>
                        ) : null}
                        {m.has_attachments ? (
                          <Badge variant="outline" className="h-4 px-1 text-[10px]">
                            📎
                          </Badge>
                        ) : null}
                        {m.importance_level === "high" ? (
                          <Star className="h-3 w-3 text-amber-500" />
                        ) : null}
                        <span className="text-muted-foreground ml-auto">
                          {m.internal_date
                            ? new Date(m.internal_date).toLocaleString()
                            : ""}
                        </span>
                      </div>
                      <div className="truncate text-sm">
                        {m.from_name ?? m.from_email ?? "?"}
                      </div>
                      <div className="truncate text-sm">
                        {m.subject ?? "(senza oggetto)"}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {m.snippet}
                      </div>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Detail */}
            <Card className="lg:col-span-3">
              <CardHeader className="py-3">
                <CardTitle className="text-sm">
                  {selected ? selected.subject ?? "(senza oggetto)" : "Seleziona un messaggio"}
                </CardTitle>
                {selected ? (
                  <CardDescription>
                    Da {selected.from_name ?? selected.from_email} ·{" "}
                    {selected.internal_date
                      ? new Date(selected.internal_date).toLocaleString()
                      : "—"}
                  </CardDescription>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-3 max-h-[70vh] overflow-y-auto">
                {selected ? (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {selected.labels.slice(0, 12).map((l) => (
                        <Badge key={l} variant="outline" className="text-[10px]">
                          {l}
                        </Badge>
                      ))}
                    </div>

                    <p className="text-sm whitespace-pre-wrap">
                      {selected.snippet ?? "(nessuna anteprima disponibile)"}
                    </p>

                    <div className="flex flex-wrap gap-2 pt-2 border-t">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => requestAction("archive", selected)}
                      >
                        <Archive className="mr-1 h-3 w-3" /> Archivia
                      </Button>
                      {selected.is_unread ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => requestAction("mark_read", selected)}
                        >
                          <MailOpen className="mr-1 h-3 w-3" /> Segna letta
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => requestAction("mark_unread", selected)}
                        >
                          <Mail className="mr-1 h-3 w-3" /> Segna non letta
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openReply(selected)}
                      >
                        <Reply className="mr-1 h-3 w-3" /> Rispondi
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openForward(selected)}
                      >
                        Inoltra
                      </Button>
                      {selected.is_trashed ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => requestAction("restore", selected)}
                        >
                          <RotateCcw className="mr-1 h-3 w-3" /> Ripristina
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => requestAction("trash", selected)}
                        >
                          <Trash2 className="mr-1 h-3 w-3" /> Cestina
                        </Button>
                      )}
                    </div>

                    <div className="rounded-md border bg-muted/40 p-2 text-[11px] text-muted-foreground">
                      <p>
                        Brain Hub mostra l'anteprima cache (snippet). Il corpo completo si
                        legge dalla mail originale in Gmail. Nessun contenuto è loggato.
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Seleziona un messaggio dalla lista per vedere dettagli e azioni.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ---------- Drafts tab ---------- */}
        <TabsContent value="drafts">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Bozze locali</CardTitle>
              <CardDescription>
                Le bozze restano in Brain Hub. L'invio reale via Gmail richiede un
                upgrade dello scope OAuth (non incluso in v3.27).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(draftsQ.data?.drafts ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">Nessuna bozza.</p>
              ) : (
                (draftsQ.data?.drafts ?? []).map((d) => (
                  <div
                    key={d.id}
                    className="border rounded-md p-2 flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <Badge variant="outline">{d.status}</Badge>
                        {d.generated_by_ai ? (
                          <Badge variant="secondary" className="gap-1">
                            <Sparkles className="h-3 w-3" /> AI
                          </Badge>
                        ) : null}
                        <span className="text-muted-foreground ml-auto">
                          {new Date(d.updated_at).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-sm truncate font-medium">
                        {d.subject ?? "(senza oggetto)"}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        A: {d.to_emails.join(", ") || "—"}
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-2">
                        {d.body}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setComposer({
                            id: d.id,
                            to: d.to_emails.join(", "),
                            cc: d.cc_emails.join(", "),
                            bcc: d.bcc_emails.join(", "),
                            subject: d.subject ?? "",
                            body: d.body ?? "",
                            inReplyToGmailMessageId: d.in_reply_to_gmail_message_id,
                            inReplyToGmailThreadId: d.in_reply_to_gmail_thread_id,
                            forwardOfGmailMessageId: d.forward_of_gmail_message_id,
                            generatedByAi: d.generated_by_ai,
                          });
                          setComposerOpen(true);
                        }}
                      >
                        Modifica
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          const r = await deleteDraftFn({ data: { id: d.id } });
                          if (r.ok) {
                            toast.success("Bozza eliminata");
                            await qc.invalidateQueries({
                              queryKey: ["gmail-console-drafts"],
                            });
                            await qc.invalidateQueries({
                              queryKey: ["gmail-console-status"],
                            });
                          }
                        }}
                      >
                        Elimina
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- Labels tab ---------- */}
        <TabsContent value="labels">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Etichette osservate in cache</CardTitle>
              <CardDescription>
                Aggregato dei label_ids presenti nei messaggi sincronizzati.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {(labelsQ.data?.labels ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">Nessuna etichetta.</p>
              ) : (
                (labelsQ.data?.labels ?? []).map((l) => (
                  <Badge key={l.label} variant="outline">
                    {l.label} · {l.count}
                  </Badge>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Confirm dialog (destructive) */}
      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conferma azione</DialogTitle>
            <DialogDescription>
              {confirm?.action === "trash"
                ? "Spostare la mail nel cestino di Gmail?"
                : "Archiviare la mail (la rimuove dalla Inbox)?"}
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm">
            <p>
              <strong>{confirm?.msg.subject ?? "(senza oggetto)"}</strong>
            </p>
            <p className="text-xs text-muted-foreground">
              Da {confirm?.msg.from_name ?? confirm?.msg.from_email}
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Annulla
            </Button>
            <Button
              variant={confirm?.action === "trash" ? "destructive" : "default"}
              onClick={confirmDestructive}
            >
              <CheckCircle2 className="mr-1 h-3 w-3" /> Conferma
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Composer dialog */}
      <Dialog open={composerOpen} onOpenChange={setComposerOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {composer.inReplyToGmailMessageId
                ? "Bozza risposta"
                : composer.forwardOfGmailMessageId
                  ? "Bozza inoltro"
                  : "Nuova bozza"}
            </DialogTitle>
            <DialogDescription>
              Le bozze restano in Brain Hub. Invio reale via Gmail non disponibile in v3.27.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-3">
                <Label className="text-xs">A</Label>
                <Input
                  value={composer.to}
                  onChange={(e) => setComposer({ ...composer, to: e.target.value })}
                  placeholder="destinatario@dominio.com, …"
                />
              </div>
              <div>
                <Label className="text-xs">Cc</Label>
                <Input
                  value={composer.cc}
                  onChange={(e) => setComposer({ ...composer, cc: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">Bcc</Label>
                <Input
                  value={composer.bcc}
                  onChange={(e) => setComposer({ ...composer, bcc: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">Tono AI</Label>
                <Select
                  value={aiTone}
                  onValueChange={(v) =>
                    setAiTone(v as "neutro" | "cordiale" | "formale" | "diretto")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cordiale">Cordiale</SelectItem>
                    <SelectItem value="neutro">Neutro</SelectItem>
                    <SelectItem value="formale">Formale</SelectItem>
                    <SelectItem value="diretto">Diretto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Oggetto</Label>
              <Input
                value={composer.subject}
                onChange={(e) =>
                  setComposer({ ...composer, subject: e.target.value })
                }
              />
            </div>
            {composer.inReplyToGmailMessageId ? (
              <div>
                <Label className="text-xs">Istruzione per la risposta AI (opzionale)</Label>
                <Input
                  value={aiInstruction}
                  onChange={(e) => setAiInstruction(e.target.value)}
                  placeholder="es. accetta la proposta e chiedi una call lunedì"
                />
              </div>
            ) : null}
            <div>
              <Label className="text-xs">Corpo</Label>
              <Textarea
                rows={10}
                value={composer.body}
                onChange={(e) => setComposer({ ...composer, body: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter className="flex-wrap gap-2">
            {composer.inReplyToGmailMessageId ? (
              <Button variant="secondary" onClick={generateAi}>
                <Sparkles className="mr-1 h-3 w-3" /> Genera con AI
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => void saveDraft(false)}>
              Salva bozza
            </Button>
            <Button onClick={() => void saveDraft(true)}>
              <CheckCircle2 className="mr-1 h-3 w-3" /> Segna pronta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "high" | "accent";
}) {
  const cls =
    tone === "high"
      ? "border-red-500/30"
      : tone === "accent"
        ? "border-primary/30"
        : "";
  return (
    <div className={`rounded-md border p-2 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function Inbox_unused() {
  // keep icon import linted
  return <Inbox className="hidden" />;
}
void Inbox_unused;
