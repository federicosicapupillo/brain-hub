import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ShieldCheck, GitBranch, ExternalLink, FolderKanban, Archive, Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/github-coverage")({
  head: () => ({ meta: [{ title: "GitHub Coverage — iBrain" }] }),
  component: GitHubCoveragePage,
});

type Brain = { id: string; name: string; color: string | null };
type ToolLink = {
  id: string; brain_id: string; tool_name: string;
  connection_status: string | null; url: string | null; repo_url: string | null;
  last_checked_at: string | null;
  metadata: Record<string, unknown> | null;
};
type KSource = {
  id: string; brain_id: string | null; title: string;
  tags: string[] | null; metadata: Record<string, unknown> | null;
};

type DocKey = "readme" | "overview" | "features" | "database" | "flows";
type Coverage = "completa" | "parziale" | "mancante" | "da_verificare";

const DOC_PATTERNS: Record<DocKey, RegExp[]> = {
  readme: [/readme/i],
  overview: [/project[_\s-]*overview/i, /panoramica/i],
  features: [/features[_\s-]*map/i, /mappa[_\s]*funzion/i],
  database: [/database[_\s-]*overview/i, /schema[_\s]*db/i],
  flows: [/user[_\s-]*flows/i, /flussi[_\s]*utente/i],
};

type FilterKey = "all" | "completi" | "parziali" | "mancanti" | "da_verificare" | "with_gh" | "no_gh";
const FILTERS: { value: FilterKey; label: string }[] = [
  { value: "all", label: "Tutti" },
  { value: "completi", label: "Completi" },
  { value: "parziali", label: "Parziali" },
  { value: "mancanti", label: "Mancanti" },
  { value: "da_verificare", label: "Da verificare" },
  { value: "with_gh", label: "Solo con GitHub" },
  { value: "no_gh", label: "Solo senza GitHub" },
];

function parseRepo(url: string | null | undefined) {
  if (!url) return null;
  const m = url.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?]|$)/i);
  return m ? { owner: m[1], name: m[2] } : null;
}

function isGithubSource(s: KSource): boolean {
  const meta = s.metadata ?? {};
  if (meta.source === "github_manual_import") return true;
  if (meta.imported_from_tool === "GitHub") return true;
  if (typeof meta.repo_url === "string" || typeof meta.repository === "string") return true;
  if ((s.tags ?? []).map((t) => t.toLowerCase()).includes("github")) return true;
  if (/^github\s*[—\-:]/i.test(s.title ?? "")) return true;
  return false;
}

function matchDoc(s: KSource, key: DocKey): boolean {
  const meta = s.metadata ?? {};
  const fp = String(meta.file_path ?? "");
  const cat = String(meta.category ?? "");
  const it = String(meta.import_type ?? "");
  const haystack = `${s.title ?? ""} ${fp} ${cat} ${it}`;
  return DOC_PATTERNS[key].some((re) => re.test(haystack));
}

function coverageBadge(c: Coverage) {
  switch (c) {
    case "completa": return <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">Completa</Badge>;
    case "parziale": return <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/30">Parziale</Badge>;
    case "mancante": return <Badge className="bg-rose-500/20 text-rose-300 border border-rose-500/30">Mancante</Badge>;
    case "da_verificare": return <Badge className="bg-sky-500/20 text-sky-300 border border-sky-500/30">Da verificare</Badge>;
  }
}

function GitHubCoveragePage() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["github-coverage"],
    queryFn: async () => {
      const [b, t, k] = await Promise.all([
        supabase.from("brains").select("id,name,color").order("name"),
        supabase.from("project_tool_links").select("*").ilike("tool_name", "github"),
        supabase.from("knowledge_sources").select("id,brain_id,title,tags,metadata"),
      ]);
      if (b.error) throw b.error;
      if (t.error) throw t.error;
      if (k.error) throw k.error;
      return {
        brains: (b.data ?? []) as Brain[],
        links: (t.data ?? []) as ToolLink[],
        sources: (k.data ?? []) as KSource[],
      };
    },
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const linkByBrain = new Map<string, ToolLink>();
    for (const l of data.links) if (!linkByBrain.has(l.brain_id)) linkByBrain.set(l.brain_id, l);
    const ghSourcesByBrain = new Map<string, KSource[]>();
    for (const s of data.sources) {
      if (!s.brain_id || !isGithubSource(s)) continue;
      const arr = ghSourcesByBrain.get(s.brain_id) ?? [];
      arr.push(s);
      ghSourcesByBrain.set(s.brain_id, arr);
    }
    return data.brains.map((br) => {
      const link = linkByBrain.get(br.id) ?? null;
      const ghs = ghSourcesByBrain.get(br.id) ?? [];
      const docs: Record<DocKey, boolean> = {
        readme: ghs.some((s) => matchDoc(s, "readme")),
        overview: ghs.some((s) => matchDoc(s, "overview")),
        features: ghs.some((s) => matchDoc(s, "features")),
        database: ghs.some((s) => matchDoc(s, "database")),
        flows: ghs.some((s) => matchDoc(s, "flows")),
      };
      const meta = (link?.metadata ?? {}) as Record<string, unknown>;
      const checkStatus = String(meta.manual_check_status ?? "");
      const verified = checkStatus === "verificato_manualmente" || checkStatus === "aggiornato_manualmente";
      const repo = parseRepo(link?.repo_url ?? link?.url ?? null);
      const hasRepo = !!(link?.repo_url || link?.url);

      let coverage: Coverage;
      const missing: string[] = [];
      if (!link) {
        coverage = "mancante";
        missing.push("repository non collegato");
      } else if (!hasRepo) {
        coverage = "mancante";
        missing.push("URL repository mancante");
      } else {
        if (!docs.readme) missing.push("README mancante");
        if (!docs.overview) missing.push("Project Overview mancante");
        if (!docs.features) missing.push("Features Map mancante");
        if (!docs.database) missing.push("Database Overview mancante");
        if (!docs.flows) missing.push("User Flows mancante");
        if (ghs.length === 0) missing.push("nessun contenuto GitHub importato");
        const hasCoreDoc = docs.readme || docs.overview;
        if (verified && hasCoreDoc && missing.length <= 3) coverage = "completa";
        else if (!verified) coverage = "da_verificare";
        else coverage = "parziale";
        if (!verified) missing.push("verifica manuale mancante");
      }

      return {
        brain: br, link, repo, hasRepo, docs, ghs, verified,
        checkStatus: checkStatus || "non_impostato",
        coverage, missing,
      };
    });
  }, [data]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (term) {
        const hay = `${r.brain.name} ${r.link?.repo_url ?? ""} ${r.link?.url ?? ""} ${r.repo?.owner ?? ""} ${r.repo?.name ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      switch (filter) {
        case "completi": return r.coverage === "completa";
        case "parziali": return r.coverage === "parziale";
        case "mancanti": return r.coverage === "mancante";
        case "da_verificare": return r.coverage === "da_verificare";
        case "with_gh": return r.hasRepo;
        case "no_gh": return !r.hasRepo;
        default: return true;
      }
    });
  }, [rows, filter, q]);

  const totals = useMemo(() => {
    const totalImports = rows.reduce((a, r) => a + r.ghs.length, 0);
    return {
      total: rows.length,
      withRepo: rows.filter((r) => r.hasRepo).length,
      verified: rows.filter((r) => r.verified).length,
      complete: rows.filter((r) => r.coverage === "completa").length,
      missing: rows.filter((r) => r.coverage === "mancante").length,
      totalImports,
    };
  }, [rows]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="GitHub Coverage"
        subtitle="Stato di copertura GitHub e documentazione importata per ogni progetto in iBrain."
      />

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Progetti" value={totals.total} />
        <StatCard label="Con repository" value={totals.withRepo} />
        <StatCard label="Verificati" value={totals.verified} />
        <StatCard label="Doc. completa" value={totals.complete} />
        <StatCard label="Doc. mancante" value={totals.missing} />
        <StatCard label="Contenuti GitHub importati" value={totals.totalImports} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-sm text-muted-foreground">Filtro:</Label>
        <Select value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
          <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          placeholder="Cerca progetto o repository…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <div className="ml-auto text-sm text-muted-foreground">
          {filtered.length} / {rows.length}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Caricamento…
        </div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nessun progetto corrisponde al filtro.
        </CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r) => (
            <Card key={r.brain.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <Link to="/progetti/$brainId" params={{ brainId: r.brain.id }} className="hover:underline">
                    {r.brain.name}
                  </Link>
                  {coverageBadge(r.coverage)}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono text-xs">
                      {r.repo ? `${r.repo.owner}/${r.repo.name}` : "—"}
                    </span>
                  </div>
                  {(r.link?.repo_url || r.link?.url) && (
                    <a
                      href={r.link.repo_url ?? r.link.url ?? "#"}
                      target="_blank" rel="noreferrer"
                      className="block truncate text-xs text-muted-foreground hover:underline"
                    >
                      {r.link.repo_url ?? r.link.url}
                    </a>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-[10px]">
                      {r.link?.connection_status ?? "non collegato"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      verifica: {r.checkStatus}
                    </Badge>
                    {r.link?.last_checked_at && (
                      <span>ultima: {new Date(r.link.last_checked_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>

                <div className="rounded-md border border-border bg-muted/30 p-2">
                  <div className="mb-1 text-xs font-medium">
                    Documentazione importata · {r.ghs.length} contenuti GitHub
                  </div>
                  <ul className="grid grid-cols-1 gap-0.5 text-xs">
                    <DocRow ok={r.docs.readme} label="README" />
                    <DocRow ok={r.docs.overview} label="Project Overview" />
                    <DocRow ok={r.docs.features} label="Features Map" />
                    <DocRow ok={r.docs.database} label="Database Overview" />
                    <DocRow ok={r.docs.flows} label="User Flows" />
                  </ul>
                </div>

                {r.missing.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Da sistemare: </span>
                    {r.missing.join(" · ")}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/progetti/$brainId" params={{ brainId: r.brain.id }}>
                      <FolderKanban className="mr-2 h-4 w-4" />Apri progetto
                    </Link>
                  </Button>
                  <Button size="sm" variant="outline" disabled={!r.hasRepo} asChild={r.hasRepo}>
                    {r.hasRepo ? (
                      <a href={r.link?.repo_url ?? r.link?.url ?? "#"} target="_blank" rel="noreferrer">
                        <ExternalLink className="mr-2 h-4 w-4" />Repository
                      </a>
                    ) : (
                      <span><ExternalLink className="mr-2 h-4 w-4" />Repository</span>
                    )}
                  </Button>
                  <Button size="sm" variant="secondary" asChild>
                    <Link to="/github-sync">
                      <ShieldCheck className="mr-2 h-4 w-4" />GitHub Sync
                    </Link>
                  </Button>
                  <Button size="sm" variant="secondary" asChild>
                    <Link to="/archivio">
                      <Archive className="mr-2 h-4 w-4" />Archivio
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-semibold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function DocRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={ok ? "text-emerald-400" : "text-rose-400"}>{ok ? "sì" : "no"}</span>
    </li>
  );
}
