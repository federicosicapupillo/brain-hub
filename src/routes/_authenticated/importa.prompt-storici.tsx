import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload, FileText, AlertTriangle, CheckCircle2, ExternalLink, Trash2 } from "lucide-react";
import JSZip from "jszip";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

import { fetchAll, createNode } from "@/lib/brains-api";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/importa/prompt-storici")({
  component: ImportPromptStoriciPage,
  errorComponent: ({ error }) => <div className="p-6" role="alert">Errore: {error.message}</div>,
  notFoundComponent: () => <div className="p-6">Pagina non trovata.</div>,
});

const DEFAULT_TAGS = ["pupillo","prompt storico","chatgpt","lovable","sviluppo","marketplace","ristorazione"];
const META_TAGS = [
  "imported_as:prompt_storico_pupillo",
  "used_for:costruzione progetto Pupillo",
  "builder_tool:Lovable",
  "generated_by:ChatGPT",
  "status:usato",
];

type Parsed = {
  id: string;
  fileName: string;
  title: string;
  content: string;
  include: boolean;
  duplicate: boolean;
  duplicateReason?: string;
};

// --- M2: Security limits for client-side import validation ---
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file (single or zip)
const MAX_FILES = 200;                    // max files selected at once
const MAX_ZIP_ENTRIES = 2000;             // max entries inside a single zip
const MAX_ENTRY_BYTES = 5 * 1024 * 1024;  // 5 MB max per decompressed entry
const MAX_TOTAL_DECOMPRESSED = 50 * 1024 * 1024; // 50 MB total decompressed
const ALLOWED_EXT = /\.(md|markdown|txt|zip)$/i;
const ALLOWED_TEXT_EXT = /\.(md|markdown|txt)$/i;

function isSafeEntryName(name: string): boolean {
  if (!name) return false;
  // Reject path traversal, absolute paths, backslashes, and null bytes.
  if (name.includes("..")) return false;
  if (name.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(name)) return false;
  if (name.includes("\\")) return false;
  if (name.includes("\u0000")) return false;
  return true;
}

function isIgnoredEntry(name: string): boolean {
  const base = name.split("/").pop() ?? name;
  if (!base) return true;
  if (base.startsWith(".")) return true;            // .DS_Store, .gitignore, …
  if (name.includes("__MACOSX")) return true;
  return false;
}

function deriveTitle(fileName: string, content: string): string {
  const h1 = content.match(/^\s*#\s+(.+?)\s*$/m);
  if (h1) return h1[1].trim().slice(0, 200);
  const firstLine = content.split("\n").find((l) => l.trim().length > 0);
  if (firstLine && firstLine.length < 120) return firstLine.trim();
  return fileName.replace(/\.(md|txt|markdown)$/i, "").replace(/[-_]+/g, " ").trim();
}

function splitBlocks(content: string): string[] {
  // split on markdown H1 boundaries; fallback to single block
  const parts = content.split(/\n(?=#\s+)/);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

export type ReadResult = {
  files: { name: string; text: string }[];
  warnings: string[];
};

async function readFiles(fileList: FileList | File[]): Promise<ReadResult> {
  const out: { name: string; text: string }[] = [];
  const warnings: string[] = [];
  let totalDecompressed = 0;

  for (const file of Array.from(fileList)) {
    const lower = file.name.toLowerCase();

    if (!ALLOWED_EXT.test(lower)) {
      warnings.push(`"${file.name}": formato non supportato. Usa .md, .txt o .zip.`);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      warnings.push(`"${file.name}": file troppo grande. Limite massimo 25 MB.`);
      continue;
    }

    if (lower.endsWith(".zip")) {
      let zip: JSZip;
      try {
        zip = await JSZip.loadAsync(await file.arrayBuffer());
      } catch {
        warnings.push(`"${file.name}": archivio non valido o potenzialmente pericoloso.`);
        continue;
      }
      const allEntries = Object.values(zip.files);
      if (allEntries.length > MAX_ZIP_ENTRIES) {
        warnings.push(`"${file.name}": lo ZIP contiene troppi file (max ${MAX_ZIP_ENTRIES}).`);
        continue;
      }

      let zipAborted = false;
      for (const entry of allEntries) {
        if (entry.dir) continue;
        if (isIgnoredEntry(entry.name)) continue;
        if (!isSafeEntryName(entry.name)) {
          warnings.push(`"${file.name}": archivio non valido o potenzialmente pericoloso.`);
          zipAborted = true;
          break;
        }
        const en = entry.name.toLowerCase();
        if (!ALLOWED_TEXT_EXT.test(en)) continue; // silently skip non-text entries

        // Read as Uint8Array first so we can enforce size limits before decoding.
        let bytes: Uint8Array;
        try {
          bytes = await entry.async("uint8array");
        } catch {
          warnings.push(`"${file.name}" → "${entry.name}": impossibile leggere l'entry.`);
          continue;
        }
        if (bytes.byteLength > MAX_ENTRY_BYTES) {
          warnings.push(`"${file.name}" → "${entry.name}": un file interno supera il limite di 5 MB.`);
          continue;
        }
        totalDecompressed += bytes.byteLength;
        if (totalDecompressed > MAX_TOTAL_DECOMPRESSED) {
          warnings.push(`ZIP troppo grande o troppo complesso (oltre 50 MB decompressi).`);
          zipAborted = true;
          break;
        }
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        out.push({ name: entry.name.split("/").pop() || entry.name, text });
      }
      if (zipAborted) continue;
    } else {
      // Plain text/markdown
      try {
        const text = await file.text();
        out.push({ name: file.name, text });
      } catch {
        warnings.push(`"${file.name}": impossibile leggere il file.`);
      }
    }
  }
  return { files: out, warnings };
}

function ImportPromptStoriciPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const qc = useQueryClient();
  const { data: brainsData } = useQuery({ queryKey: ["brains-all"], queryFn: fetchAll });
  const brains = brainsData?.brains ?? [];

  const defaultBrainId = useMemo(() => {
    const pup = brains.find((b) => b.name.toLowerCase().includes("pupillo"));
    return pup?.id ?? brains[0]?.id ?? "";
  }, [brains]);

  const [brainId, setBrainId] = useState<string>("");
  const effectiveBrainId = brainId || defaultBrainId;

  const [splitByBlocks, setSplitByBlocks] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [items, setItems] = useState<Parsed[]>([]);

  const selectedBrain = brains.find((b) => b.id === effectiveBrainId);

  function storeFiles(fl: FileList | File[] | null) {
    if (!fl || fl.length === 0) return;
    const arr = Array.from(fl);
    if (arr.length > MAX_FILES) {
      toast.error(`Troppi file selezionati. Massimo ${MAX_FILES}.`);
      return;
    }
    // Upfront extension + size triage so the user sees errors immediately.
    const accepted: File[] = [];
    const rejections: string[] = [];
    for (const f of arr) {
      if (!ALLOWED_EXT.test(f.name)) {
        rejections.push(`"${f.name}": formato non supportato. Usa .md, .txt o .zip.`);
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        rejections.push(`"${f.name}": file troppo grande. Limite massimo 25 MB.`);
        continue;
      }
      accepted.push(f);
    }
    if (rejections.length > 0) {
      toast.warning(rejections.slice(0, 3).join(" · ") + (rejections.length > 3 ? ` (+${rejections.length - 3})` : ""));
    }
    if (accepted.length === 0) {
      setSelectedFiles([]);
      setItems([]);
      setLastImport(null);
      return;
    }
    setSelectedFiles(accepted);
    setItems([]);
    setLastImport(null);
  }

  async function analyzeSelectedFiles() {
    if (selectedFiles.length === 0) { toast.error("Seleziona almeno un file"); return; }
    if (!effectiveBrainId) { toast.error("Seleziona un progetto."); return; }
    setParsing(true);
    try {
      const { files, warnings } = await readFiles(selectedFiles);
      if (warnings.length > 0) {
        for (const w of warnings.slice(0, 5)) toast.warning(w);
        if (warnings.length > 5) toast.warning(`Altri ${warnings.length - 5} avvisi non mostrati.`);
      }
      if (files.length === 0) { toast.warning("Nessun file .md/.txt valido trovato."); return; }

      // Fetch existing prompts in brain to dedup
      const { data: existing } = await supabase
        .from("brain_nodes")
        .select("id,label,summary,tags")
        .eq("brain_id", effectiveBrainId)
        .eq("type", "prompt");
      const existingArr = existing ?? [];

      const parsed: Parsed[] = [];
      for (const f of files) {
        const blocks = splitByBlocks ? splitBlocks(f.text) : [f.text];
        blocks.forEach((blk, idx) => {
          const title = deriveTitle(blocks.length > 1 ? `${f.name} #${idx + 1}` : f.name, blk);
          const fileTag = `file:${f.name}`;
          const normContent = blk.trim().slice(0, 400).toLowerCase();
          const dup = existingArr.find((e) => {
            const t = (e.tags as string[] | null) ?? [];
            if (t.includes(fileTag) && blocks.length === 1) return true;
            if (e.label?.toLowerCase().trim() === title.toLowerCase().trim()) return true;
            if ((e.summary ?? "").trim().slice(0, 400).toLowerCase() === normContent) return true;
            return false;
          });
          parsed.push({
            id: `${f.name}-${idx}-${crypto.randomUUID()}`,
            fileName: f.name,
            title,
            content: blk,
            include: !dup,
            duplicate: !!dup,
            duplicateReason: dup ? `Già presente: "${dup.label}"` : undefined,
          });
        });
      }
      setItems(parsed);
      toast.success(`${parsed.length} prompt rilevati da ${files.length} file.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore parsing file");
    } finally {
      setParsing(false);
    }
  }

  function updateItem(id: string, patch: Partial<Parsed>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  const [lastImport, setLastImport] = useState<{ ok: number; fail: number; skipped: number } | null>(null);

  async function handleImport() {
    if (items.length === 0) { toast.error("Carica almeno un file"); return; }
    if (!effectiveBrainId) { toast.error("Seleziona un progetto"); return; }
    const { data: u, error: ue } = await supabase.auth.getUser();
    if (ue || !u?.user) { toast.error("Devi essere autenticato"); return; }
    const selected = items.filter((i) => i.include);
    if (selected.length === 0) { toast.error("Seleziona almeno un prompt da importare"); return; }

    const toImport = selected.filter((i) => !i.duplicate);
    const skipped = selected.length - toImport.length;
    if (toImport.length === 0) {
      toast.warning(`Tutti i ${skipped} prompt selezionati sono duplicati: nulla da importare.`);
      return;
    }

    setImporting(true);
    let ok = 0, fail = 0;
    const errors: string[] = [];
    for (const it of toImport) {
      try {
        await createNode({
          brain_id: effectiveBrainId,
          label: (it.title || it.fileName).slice(0, 200) || "Prompt senza titolo",
          type: "prompt",
          origin: "importatore",
          tags: [
            ...DEFAULT_TAGS,
            ...META_TAGS,
            `file:${it.fileName}`,
            "tool:ChatGPT",
            "via:Lovable",
            "categoria:prompt storico di costruzione progetto",
          ],
          summary: it.content,
        });
        ok++;
      } catch (e) {
        fail++;
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[prompt-storici] import error", e);
        if (errors.length < 3) errors.push(msg);
      }
    }
    qc.invalidateQueries({ queryKey: ["brains-all"] });
    qc.invalidateQueries({ queryKey: ["progetto", effectiveBrainId] });
    qc.invalidateQueries({ queryKey: ["archivio"] });
    qc.invalidateQueries({ queryKey: ["brain_nodes"] });
    qc.invalidateQueries({ queryKey: ["prompts"] });

    setLastImport({ ok, fail, skipped });
    if (ok > 0) {
      toast.success(
        `Importati ${ok} prompt${skipped ? ` · ${skipped} duplicati saltati` : ""}${fail ? ` · ${fail} errori` : ""}.`
      );
      setItems((prev) => prev.filter((i) => !(i.include && !i.duplicate)));
    } else {
      toast.error(`Import fallito${fail ? `: ${errors[0] ?? "errore sconosciuto"}` : ""}`);
    }
    setImporting(false);
  }

  const canImport =
    items.length > 0 &&
    items.some((i) => i.include && !i.duplicate) &&
    !!effectiveBrainId &&
    !importing;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Importa Prompt Storici"
        subtitle="Carica i prompt ChatGPT usati per costruire Pupillo con Lovable. I file restano come storico operativo del progetto."
      />

      <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-medium text-primary">
        SEI NELL&apos;IMPORTATORE PROMPT STORICI
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Progetto di destinazione</Label>
              <Select value={effectiveBrainId} onValueChange={setBrainId}>
                <SelectTrigger><SelectValue placeholder="Seleziona progetto…" /></SelectTrigger>
                <SelectContent>
                  {brains.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedBrain && (
                <p className="text-xs text-muted-foreground">
                  Default: Pupillo · Tipo: Prompt · Origine: ChatGPT · Strumento: Lovable · Stato: usato
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>File (.md, .txt o .zip)</Label>
              <div
                className="rounded-md border border-dashed border-border bg-background p-4"
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  storeFiles(event.dataTransfer.files);
                }}
              >
                <Input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".md,.markdown,.txt,.zip"
                  onChange={(e) => storeFiles(e.target.files)}
                  disabled={parsing || importing}
                  className="hidden"
                />
                <div className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Upload className="h-4 w-4 text-primary" />
                    <span>Trascina qui file .md, .txt o .zip.</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={parsing || importing}
                    >
                      Seleziona file
                    </Button>
                    <Button
                      type="button"
                      onClick={analyzeSelectedFiles}
                      disabled={selectedFiles.length === 0 || parsing || importing}
                    >
                      {parsing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      Analizza file
                    </Button>
                    <span className="text-xs">
                      {selectedFiles.length > 0
                        ? `${selectedFiles.length} file selezionati`
                        : "Nessun file selezionato"}
                    </span>
                  </div>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={splitByBlocks} onCheckedChange={(v) => setSplitByBlocks(!!v)} />
                Dividi i file in più prompt sui titoli markdown (# H1)
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {DEFAULT_TAGS.map((t) => (
              <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {parsing && (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Lettura file in corso…
        </div>
      )}

      {items.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <strong>{items.filter((i) => i.include).length}</strong> di <strong>{items.length}</strong> prompt selezionati
                {" "}· {items.filter((i) => i.duplicate).length} possibili duplicati
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setItems((p) => p.map((i) => ({ ...i, include: true })))}>
                  Seleziona tutti
                </Button>
                <Button size="sm" variant="outline" onClick={() => setItems((p) => p.map((i) => ({ ...i, include: !i.duplicate })))}>
                  Escludi duplicati
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setItems([])}>
                  <Trash2 className="h-4 w-4 mr-1" /> Svuota
                </Button>
                <Button size="sm" onClick={handleImport} disabled={!canImport}>
                  {importing
                    ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Importazione in corso…</>
                    : <><Upload className="h-4 w-4 mr-1" /> Importa selezionati</>}
                </Button>
                {effectiveBrainId && (
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/progetti/$brainId" params={{ brainId: effectiveBrainId }}>
                      <ExternalLink className="h-4 w-4 mr-1" /> Apri progetto
                    </Link>
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {items.map((it) => (
                <div key={it.id} className="rounded-md border border-border/60 bg-card/40 p-3">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={it.include}
                      onCheckedChange={(v) => updateItem(it.id, { include: !!v })}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <FileText className="h-4 w-4 text-primary shrink-0" />
                        <Input
                          value={it.title}
                          onChange={(e) => updateItem(it.id, { title: e.target.value })}
                          className="h-7 text-sm font-medium flex-1 min-w-[200px]"
                        />
                        <Badge variant="outline" className="text-[10px]">Prompt</Badge>
                        <Badge variant="outline" className="text-[10px]">{selectedBrain?.name ?? "—"}</Badge>
                        <Badge variant="secondary" className="text-[10px]">usato</Badge>
                        {it.duplicate && (
                          <Badge variant="destructive" className="text-[10px] gap-1">
                            <AlertTriangle className="h-3 w-3" /> Possibile duplicato
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        File: {it.fileName}{it.duplicateReason ? ` · ${it.duplicateReason}` : ""}
                      </div>
                      <Textarea
                        value={it.content}
                        onChange={(e) => updateItem(it.id, { content: e.target.value })}
                        rows={4}
                        className="text-xs font-mono"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {lastImport && lastImport.ok > 0 && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <div className="text-sm flex-1">
              Importati <strong>{lastImport.ok}</strong> prompt
              {lastImport.skipped ? ` · ${lastImport.skipped} duplicati saltati` : ""}
              {lastImport.fail ? ` · ${lastImport.fail} errori` : ""}.
            </div>
            {effectiveBrainId && (
              <Button size="sm" variant="outline" asChild>
                <Link to="/progetti/$brainId" params={{ brainId: effectiveBrainId }}>
                  <ExternalLink className="h-4 w-4 mr-1" /> Vai ai prompt di {selectedBrain?.name ?? "Pupillo"}
                </Link>
              </Button>
            )}
            <Button size="sm" onClick={() => { setLastImport(null); setItems([]); }}>
              <Upload className="h-4 w-4 mr-1" /> Importa altri file
            </Button>
          </CardContent>
        </Card>
      )}

      {items.length === 0 && !parsing && !lastImport && (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center text-sm text-muted-foreground space-y-2">
            <CheckCircle2 className="h-6 w-6 mx-auto text-primary" />
            <div>Carica i file dei prompt per vedere l'anteprima prima di importarli.</div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
