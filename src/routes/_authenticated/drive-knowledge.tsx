import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ExternalLink,
  FolderTree,
  Link2,
  LogOut,
  Plug,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  createDriveConnection,
  createKnowledgeSourceFromDriveFile,
  DRIVE_CATEGORY_LABEL,
  DRIVE_CONNECTION_STATUS_LABEL,
  DRIVE_CONNECTION_STATUS_TONE,
  type DriveConnection,
  type DriveFile,
  type DriveFileCategory,
  getDriveConnections,
  getDriveKnowledgeSummary,
  importManualDriveLink,
  listDriveFileMap,
  logDriveKnowledgeEvent,
  suggestDriveOrganization,
  syncDriveMetadata,
} from "@/lib/drive-knowledge";
import {
  disconnectGoogleDrive,
  getGoogleDriveOauthStatus,
  startGoogleDriveOAuth,
} from "@/lib/drive-oauth.functions";

type DriveKnowledgeSearch = {
  oauth?: "success" | "error";
  message?: string;
  brain?: string;
};

export const Route = createFileRoute("/_authenticated/drive-knowledge")({
  validateSearch: (s: Record<string, unknown>): DriveKnowledgeSearch => ({
    oauth:
      s.oauth === "success" || s.oauth === "error" ? (s.oauth as "success" | "error") : undefined,
    message: typeof s.message === "string" ? s.message : undefined,
    brain: typeof s.brain === "string" ? s.brain : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Google Drive Knowledge — Brain Hub" },
      {
        name: "description",
        content:
          "Mappa documenti Google Drive via OAuth read-only (metadata-only) e collegali alla Knowledge Map di Brain Hub.",
      },
    ],
  }),
  component: DriveKnowledgeRoute,
});

type Brain = { id: string; name: string };

function DriveKnowledgeRoute() {
  const qc = useQueryClient();
  const navigate = useNavigate({ from: "/drive-knowledge" });
  const routeSearch = Route.useSearch();
  const [brainId, setBrainId] = useState<string>(routeSearch.brain ?? "");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [mimeFilter, setMimeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null);

  const [openConnect, setOpenConnect] = useState(false);
  const [connectLabel, setConnectLabel] = useState("Google Drive");

  const [openManualLink, setOpenManualLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkName, setLinkName] = useState("");
  const [linkConnectionId, setLinkConnectionId] = useState<string>("");

  useEffect(() => {
    void logDriveKnowledgeEvent("drive_connection_opened", "Drive Knowledge aperto");
  }, []);

  useEffect(() => {
    if (!routeSearch.oauth) return;
    if (routeSearch.oauth === "success") {
      toast.success("Google Drive collegato correttamente");
    } else {
      const msg = routeSearch.message?.slice(0, 200) || "Errore OAuth Google Drive";
      toast.error(msg);
    }
    void qc.invalidateQueries({ queryKey: ["drive-knowledge"] });
    void navigate({
      search: (prev: DriveKnowledgeSearch) => ({ ...prev, oauth: undefined, message: undefined }),
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSearch.oauth]);

  const { data: brains = [] } = useQuery({
    queryKey: ["drive-knowledge", "brains"],
    queryFn: async (): Promise<Brain[]> => {
      const { data, error } = await supabase
        .from("brains")
        .select("id, name")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Brain[];
    },
  });

  const brainFilter = brainId && brainId !== "__all__" ? brainId : null;

  const { data: connections = [], isLoading: loadingConnections } = useQuery({
    queryKey: ["drive-knowledge", "connections", brainFilter],
    queryFn: () => getDriveConnections(brainFilter),
  });

  const { data: files = [], isLoading: loadingFiles } = useQuery({
    queryKey: [
      "drive-knowledge",
      "files",
      brainFilter,
      categoryFilter,
      mimeFilter,
      statusFilter,
      search,
    ],
    queryFn: () =>
      listDriveFileMap({
        brainId: brainFilter,
        category: categoryFilter === "all" ? null : (categoryFilter as DriveFileCategory),
        mimePrefix: mimeFilter === "all" ? null : mimeFilter,
        status:
          statusFilter === "all"
            ? null
            : (statusFilter as DriveFile["status"]),
        search: search.trim() || null,
      }),
  });

  const { data: summary } = useQuery({
    queryKey: ["drive-knowledge", "summary", brainFilter],
    queryFn: () => getDriveKnowledgeSummary(brainFilter),
  });

  const { data: oauthStatus } = useQuery({
    queryKey: ["drive-knowledge", "oauth-status"],
    queryFn: () => getGoogleDriveOauthStatus(),
  });

  const { data: organization = [] } = useQuery({
    queryKey: ["drive-knowledge", "organization", brainFilter],
    queryFn: () => suggestDriveOrganization(brainFilter),
  });

  const categories = useMemo(
    () => Object.entries(DRIVE_CATEGORY_LABEL) as Array<[DriveFileCategory, string]>,
    [],
  );

  async function handleCreateConnection() {
    try {
      await createDriveConnection({
        label: connectLabel || "Google Drive",
        brainId: brainFilter,
        connectionStatus: "not_configured",
        metadata: { note: "OAuth non configurato — usa import manuale" },
      });
      toast.success("Connessione Drive creata (OAuth non configurato).");
      setOpenConnect(false);
      setConnectLabel("Google Drive");
      await qc.invalidateQueries({ queryKey: ["drive-knowledge"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore";
      toast.error(msg);
    }
  }

  async function handleManualLink() {
    try {
      await importManualDriveLink({
        url: linkUrl,
        name: linkName || undefined,
        brainId: brainFilter,
        connectionId: linkConnectionId || null,
      });
      toast.success("Link Drive importato");
      setOpenManualLink(false);
      setLinkUrl("");
      setLinkName("");
      setLinkConnectionId("");
      await qc.invalidateQueries({ queryKey: ["drive-knowledge"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore";
      toast.error(msg);
    }
  }

  async function handleSync(connection: DriveConnection) {
    if (busyConnectionId) return;
    setBusyConnectionId(connection.id);
    try {
      const res = await syncDriveMetadata(connection.id);
      if (res.ok) {
        toast.success("Sync metadata Drive completato");
      } else if (res.authUrl) {
        toast.info("Reindirizzamento a Google per consenso read-only…");
        window.location.href = res.authUrl;
        return;
      } else {
        toast.error(res.reason ?? "Sync metadata fallito");
      }
      await qc.invalidateQueries({ queryKey: ["drive-knowledge"] });
    } finally {
      setBusyConnectionId(null);
    }
  }

  async function handleAuthorize(connection: DriveConnection) {
    if (busyConnectionId) return;
    if (!oauthStatus?.configured) {
      toast.error(
        "Google OAuth non configurato. Aggiungi GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_OAUTH_REDIRECT_URL server-side.",
      );
      return;
    }
    setBusyConnectionId(connection.id);
    try {
      const res = await startGoogleDriveOAuth({
        data: { connectionId: connection.id, returnTo: "/drive-knowledge?oauth=success" },
      });
      if (res.ok) {
        window.location.href = res.authUrl;
      } else {
        toast.error(res.reason);
      }
    } finally {
      setBusyConnectionId(null);
    }
  }

  async function handleDisconnect(connection: DriveConnection) {
    if (busyConnectionId) return;
    setBusyConnectionId(connection.id);
    try {
      const res = await disconnectGoogleDrive({ data: { connectionId: connection.id } });
      if (res.ok) {
        toast.success("Drive disconnesso. I file su Google Drive non sono stati toccati.");
        await qc.invalidateQueries({ queryKey: ["drive-knowledge"] });
      } else {
        toast.error(res.reason ?? "Disconnessione fallita");
      }
    } finally {
      setBusyConnectionId(null);
    }
  }


  async function handleCreateKnowledge(file: DriveFile) {
    const targetBrain = file.brain_id ?? brainFilter ?? brains[0]?.id ?? null;
    if (!targetBrain) {
      toast.error("Seleziona prima un progetto/cervello.");
      return;
    }
    try {
      await createKnowledgeSourceFromDriveFile(file.id, { brainId: targetBrain });
      toast.success("Knowledge source creata da file Drive");
      await qc.invalidateQueries({ queryKey: ["drive-knowledge"] });
      await qc.invalidateQueries({ queryKey: ["knowledge-sources"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore";
      toast.error(msg);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <PageHeader
        title="Google Drive Knowledge"
        subtitle="OAuth read-only · metadata-only. Brain Hub non scarica contenuti, non modifica e non cancella nulla."
        actions={
          <>
            <Badge variant="outline" className="text-[10px]">
              v2.8.1 OAuth read-only
            </Badge>
            <Button asChild size="sm" variant="outline">
              <Link to="/knowledge-map">Knowledge Map</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/tool-connections">Tool Connections</Link>
            </Button>
          </>
        }
      />

      <OauthStatusBanner
        configured={oauthStatus?.configured ?? false}
        scope={oauthStatus?.scope}
        hasError={routeSearch.oauth === "error"}
        errorMessage={routeSearch.message}
        anyConnected={connections.some((c) => c.connection_status === "connected")}
        anyConnectionExists={connections.length > 0}
        lastSyncAt={summary?.lastSyncAt ?? null}
        lastSyncFileCount={summary?.lastSyncFileCount ?? null}
        lastSyncReachedLimit={summary?.lastSyncReachedLimit ?? false}
        lastSyncStatus={summary?.lastSyncStatus ?? "never"}
        lastSyncWarnings={summary?.lastSyncWarnings ?? []}
      />

      <HowToConnectBox configured={oauthStatus?.configured ?? false} />



      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Select value={brainId} onValueChange={setBrainId}>
            <SelectTrigger className="w-[260px]">
              <SelectValue placeholder="Tutti i progetti/cervelli" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Tutti</SelectItem>
              {brains.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="default" onClick={() => setOpenConnect(true)}>
            <Plug className="mr-1 h-3 w-3" /> Collega Google Drive
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOpenManualLink(true)}>
            <Link2 className="mr-1 h-3 w-3" /> Aggiungi link manuale
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryTile label="Connessioni" value={summary?.connections ?? 0} />
        <SummaryTile
          label="Configurate"
          value={summary?.configuredConnections ?? 0}
          hint={summary?.hasNeverSynced ? "Mai sincronizzata" : undefined}
        />
        <SummaryTile label="File mappati" value={summary?.totalFiles ?? 0} />
        <SummaryTile
          label="Knowledge source"
          value={summary?.knowledgeSourcesCreated ?? 0}
          tone={summary?.lastSyncFailed ? "warning" : "default"}
          hint={summary?.lastSyncFailed ? "Ultimo sync fallito" : undefined}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plug className="h-4 w-4" /> Connessioni Drive ({connections.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingConnections ? (
            <p className="text-sm text-muted-foreground">Caricamento…</p>
          ) : connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nessuna connessione Drive. Usa "Collega Google Drive" per creare un connettore,
              poi "Autorizza" per completare l'OAuth read-only. In alternativa puoi importare
              link Drive manualmente.
            </p>
          ) : (
            <ul className="divide-y">
              {connections.map((c) => {
                const isConnected = c.connection_status === "connected";
                const isBusy = busyConnectionId === c.id;
                const oauthConfigured = oauthStatus?.configured ?? false;
                const needsAuth = oauthConfigured && !isConnected;
                return (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{c.label}</span>
                        <Badge
                          className={
                            DRIVE_CONNECTION_STATUS_TONE[c.connection_status] ??
                            "bg-muted text-muted-foreground border-border"
                          }
                        >
                          {DRIVE_CONNECTION_STATUS_LABEL[c.connection_status] ?? c.connection_status}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {c.last_sync_at
                          ? `Ultimo sync: ${new Date(c.last_sync_at).toLocaleString()}`
                          : isConnected
                            ? "Collegato, metadata non ancora sincronizzati"
                            : "Non autorizzato"}
                        {c.root_folder_name ? ` · Root: ${c.root_folder_name}` : ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!isConnected ? (
                        <Button
                          size="sm"
                          variant={needsAuth ? "default" : "outline"}
                          disabled={isBusy || !oauthConfigured}
                          onClick={() => handleAuthorize(c)}
                          title={
                            oauthConfigured
                              ? "Avvia consenso OAuth read-only"
                              : "Google OAuth non configurato server-side"
                          }
                        >
                          <ShieldCheck className="mr-1 h-3 w-3" /> Autorizza Google Drive
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isBusy}
                          onClick={() => {
                            if (window.confirm("Disconnettere questa connessione Drive? I file Drive non vengono toccati.")) {
                              void handleDisconnect(c);
                            }
                          }}
                        >
                          <LogOut className="mr-1 h-3 w-3" /> Disconnetti
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => handleSync(c)}
                      >
                        <RefreshCw className="mr-1 h-3 w-3" /> Sincronizza metadata
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground">
            Brain Hub legge solo metadata dei file (scope <code>drive.metadata.readonly</code>).
            Non scarica contenuti, non modifica file, non cancella nulla. I token OAuth non
            vengono mai salvati nel database.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FolderTree className="h-4 w-4" /> File mappati ({files.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-4">
            <Input
              placeholder="Cerca per nome…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte le categorie</SelectItem>
                {categories.map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={mimeFilter} onValueChange={setMimeFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Tipo file" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i tipi</SelectItem>
                <SelectItem value="application/pdf">PDF</SelectItem>
                <SelectItem value="image/">Immagini</SelectItem>
                <SelectItem value="video/">Video</SelectItem>
                <SelectItem value="application/vnd.google-apps.folder">Cartelle</SelectItem>
                <SelectItem value="application/vnd.google-apps.document">Docs</SelectItem>
                <SelectItem value="application/vnd.google-apps.spreadsheet">Sheets</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti gli status</SelectItem>
                <SelectItem value="mapped">Mappato</SelectItem>
                <SelectItem value="linked">Linked a knowledge</SelectItem>
                <SelectItem value="archived">Archiviato</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loadingFiles ? (
            <p className="text-sm text-muted-foreground">Caricamento…</p>
          ) : files.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nessun file mappato. Importa un link manuale o sincronizza metadata.
            </p>
          ) : (
            <ul className="divide-y">
              {files.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate max-w-md">{f.name}</span>
                      {f.category && (
                        <Badge variant="outline" className="text-[10px]">
                          {DRIVE_CATEGORY_LABEL[f.category]}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">
                        {f.status}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {f.mime_type ?? "—"}
                      {f.modified_time
                        ? ` · ${new Date(f.modified_time).toLocaleString()}`
                        : ""}
                      {f.path ? ` · ${f.path}` : ""}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {f.web_url && (
                      <Button asChild size="sm" variant="ghost">
                        <a href={f.web_url} target="_blank" rel="noreferrer">
                          <ExternalLink className="mr-1 h-3 w-3" /> Apri file
                        </a>
                      </Button>
                    )}
                    {f.status !== "linked" && (
                      <Button size="sm" variant="outline" onClick={() => handleCreateKnowledge(f)}>
                        <Plus className="mr-1 h-3 w-3" /> Crea knowledge source
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Suggerimenti di organizzazione
          </CardTitle>
        </CardHeader>
        <CardContent>
          {organization.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nessun suggerimento. Mappa più file per ricevere raggruppamenti per categoria.
            </p>
          ) : (
            <ul className="divide-y">
              {organization.map((s) => (
                <li key={s.category} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <span className="font-medium">
                      {DRIVE_CATEGORY_LABEL[s.category]} ({s.count})
                    </span>
                    <div className="text-[11px] text-muted-foreground">{s.recommendation}</div>
                  </div>
                  {s.filesWithoutKnowledge > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      {s.filesWithoutKnowledge} senza KS
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-start gap-2 p-4 text-[11px] text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-3 w-3" />
          <p>
            Brain Hub v2.8.1 è read-only e usa lo scope <code>drive.metadata.readonly</code>:
            legge solo metadata (id, nome, mimeType, modifiedTime, webViewLink). Nessun contenuto
            file viene scaricato; nessun file viene creato, spostato o cancellato su Google Drive.
            I token OAuth non vengono mai salvati nel database né mostrati al frontend.
          </p>
        </CardContent>
      </Card>

      {/* Connect dialog */}
      <Dialog open={openConnect} onOpenChange={setOpenConnect}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Collega Google Drive</DialogTitle>
            <DialogDescription>
              Crea un connettore Drive. Dopo la creazione, usa "Autorizza Google Drive" per
              completare l'OAuth read-only (scope <code>drive.metadata.readonly</code>). In
              alternativa puoi sempre importare link Drive manualmente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="dk-label">Etichetta connessione</Label>
            <Input
              id="dk-label"
              value={connectLabel}
              onChange={(e) => setConnectLabel(e.target.value)}
              placeholder="Es. Google Drive — Azienda"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenConnect(false)}>
              Annulla
            </Button>
            <Button onClick={handleCreateConnection}>Crea connessione</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual link dialog */}
      <Dialog open={openManualLink} onOpenChange={setOpenManualLink}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aggiungi link Drive manuale</DialogTitle>
            <DialogDescription>
              Incolla un link Google Drive (file o cartella). Brain Hub salva solo metadata e
              link, non scarica contenuti.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="dk-link-url">URL Drive *</Label>
              <Input
                id="dk-link-url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://drive.google.com/file/d/…"
              />
            </div>
            <div>
              <Label htmlFor="dk-link-name">Nome (opzionale)</Label>
              <Input
                id="dk-link-name"
                value={linkName}
                onChange={(e) => setLinkName(e.target.value)}
                placeholder="Nome file/cartella"
              />
            </div>
            <div>
              <Label htmlFor="dk-link-conn">Connessione (opzionale)</Label>
              <Select value={linkConnectionId} onValueChange={setLinkConnectionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Nessuna connessione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Nessuna</SelectItem>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenManualLink(false)}>
              Annulla
            </Button>
            <Button onClick={handleManualLink}>Importa link</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "default" | "warning";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div
          className={
            tone === "warning"
              ? "text-2xl font-semibold text-amber-600"
              : "text-2xl font-semibold"
          }
        >
          {value}
        </div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function OauthStatusBanner({
  configured,
  scope,
  hasError,
  errorMessage,
  anyConnected,
  anyConnectionExists,
  lastSyncAt,
  lastSyncFileCount,
  lastSyncReachedLimit,
  lastSyncStatus,
  lastSyncWarnings,
}: {
  configured: boolean;
  scope?: string;
  hasError: boolean;
  errorMessage?: string;
  anyConnected: boolean;
  anyConnectionExists: boolean;
  lastSyncAt?: string | null;
  lastSyncFileCount?: number | null;
  lastSyncReachedLimit?: boolean;
  lastSyncStatus?: "never" | "completed" | "completed_with_warnings" | "failed";
  lastSyncWarnings?: string[];
}) {
  let title: string;
  let body: string;
  let tone: "ok" | "warn" | "info" | "err";

  if (hasError) {
    title = "Errore OAuth";
    body = errorMessage?.slice(0, 200) || "Il consenso OAuth non è andato a buon fine. Riprova.";
    tone = "err";
  } else if (!configured) {
    title = "OAuth non configurato";
    body =
      "Brain Hub è predisposto per Google Drive, ma manca la configurazione Google OAuth server-side. Aggiungi GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_OAUTH_REDIRECT_URL per abilitare il collegamento reale. Nel frattempo puoi importare link Drive manualmente.";
    tone = "warn";
  } else if (anyConnected) {
    if (lastSyncAt) {
      title = "Google Drive collegato e sincronizzato";
      body = `Scope attivo: ${scope ?? "drive.metadata.readonly"}. Solo metadata, nessun contenuto file scaricato.`;
      tone = lastSyncStatus === "completed_with_warnings" || lastSyncReachedLimit ? "warn" : "ok";
    } else {
      title = "Google Drive collegato";
      body = `Account collegato ma metadata non ancora sincronizzati. Clicca "Sincronizza metadata" per leggere l'elenco file/cartelle. Scope: ${scope ?? "drive.metadata.readonly"}.`;
      tone = "info";
    }
  } else if (anyConnectionExists) {
    title = "Pronto per autorizzazione";
    body = `Connessione creata ma l'account Google Drive non è ancora autorizzato. Clicca "Autorizza Google Drive" per completare il consenso read-only (scope ${scope ?? "drive.metadata.readonly"}).`;
    tone = "info";
  } else {
    title = "Pronto per il collegamento";
    body = `OAuth server-side configurato. Crea una connessione con "Collega Google Drive" e poi premi "Autorizza Google Drive" (scope ${scope ?? "drive.metadata.readonly"}).`;
    tone = "info";
  }

  const toneClass =
    tone === "ok"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100"
      : tone === "err"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : tone === "warn"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100"
          : "border-sky-500/40 bg-sky-500/10 text-sky-900 dark:text-sky-100";

  const statusLabel: Record<string, string> = {
    completed: "completato",
    completed_with_warnings: "completato con warning",
    failed: "fallito",
    never: "mai eseguito",
  };
  const showSync = anyConnected && lastSyncAt;

  return (
    <Card className={toneClass}>
      <CardContent className="flex items-start gap-2 p-4 text-xs">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <div className="font-medium">{title}</div>
          <p>{body}</p>
          {showSync && (
            <p className="opacity-80">
              Ultimo sync: {new Date(lastSyncAt!).toLocaleString()}
              {typeof lastSyncFileCount === "number" ? ` · ${lastSyncFileCount} file` : ""}
              {` · stato: ${statusLabel[lastSyncStatus ?? "completed"]}`}
              {lastSyncReachedLimit ? " · limite raggiunto" : ""}
            </p>
          )}
          {lastSyncWarnings && lastSyncWarnings.length > 0 && (
            <p className="opacity-80">⚠ {lastSyncWarnings.slice(0, 2).join(" · ").slice(0, 240)}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function HowToConnectBox({ configured }: { configured: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Plug className="h-4 w-4" /> Come collegare Google Drive
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs text-muted-foreground">
        <ol className="list-decimal pl-4 space-y-1.5">
          <li className={configured ? "text-emerald-600 dark:text-emerald-400 font-medium" : ""}>
            Configura secrets Google server-side (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URL).
            {!configured && (
              <span className="block text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                ⚠ Manca questa configurazione.
              </span>
            )}
          </li>
          <li>Inserisci il redirect URL in Google Cloud Console.</li>
          <li>Torna in Brain Hub.</li>
          <li>Clicca "Collega Google Drive" per creare una connessione.</li>
          <li>Clicca "Autorizza Google Drive" e approva il consenso read-only da Google.</li>
          <li>Brain Hub sincronizza solo metadata (id, nome, mimeType, webViewLink) — nessun contenuto file.</li>
        </ol>
        <div className="border-t pt-2 mt-2 space-y-1">
          <p className="text-[11px]">
            <strong>Non devi incollare un link Drive per collegare l'account.</strong> Il link manuale serve solo per mappare singoli file/cartelle senza OAuth.
          </p>
          <p className="text-[11px]">
            <strong>Brain Hub non scarica contenuti, non modifica e non cancella file.</strong> Legge solo metadata. I token OAuth non vengono mai salvati nel database.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
