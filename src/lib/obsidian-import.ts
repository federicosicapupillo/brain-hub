import { unzipSync, strFromU8 } from "fflate";
import { supabase } from "@/integrations/supabase/client";
import { chunkText } from "@/lib/knowledge-api";
import { logAction, pushLiveEvent } from "@/lib/workspace-api";

const MAX_ZIP_SIZE = 20 * 1024 * 1024; // 20 MB
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per note

export interface ParsedNote {
  title: string;
  content: string;
  tags: string[];
  links: string[];
  frontmatter: Record<string, unknown> | null;
  path?: string;
}

export interface ImportOptions {
  brainId: string;
  nodeId: string | null;
  manualTags: string[];
  useFilenameAsTitle: boolean;
  extractObsidianTags: boolean;
  detectInternalLinks: boolean;
}

export interface ImportResult {
  imported: number;
  ignored: number;
  errors: string[];
  edgesCreated: number;
  chunksGenerated: number;
}

// ============ Parsing ============

function parseFrontmatter(text: string): { frontmatter: Record<string, unknown> | null; body: string } {
  if (!text.startsWith("---")) return { frontmatter: null, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: null, body: text };
  const yaml = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, "");
  const fm: Record<string, unknown> = {};
  let currentKey: string | null = null;
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem && currentKey) {
      const arr = (fm[currentKey] as unknown[]) ?? [];
      arr.push(stripQuotes(listItem[1]));
      fm[currentKey] = arr;
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (kv) {
      const [, k, v] = kv;
      currentKey = k;
      if (v.trim() === "") {
        fm[k] = [];
      } else {
        fm[k] = parseScalar(v.trim());
      }
    }
  }
  return { frontmatter: fm, body };
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function parseScalar(v: string): unknown {
  if (v.startsWith("[") && v.endsWith("]")) {
    return v.slice(1, -1).split(",").map((p) => stripQuotes(p)).filter(Boolean);
  }
  return stripQuotes(v);
}

function extractH1(body: string): string | null {
  const m = body.match(/^\s*#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

function extractInlineTags(body: string): string[] {
  const tags = new Set<string>();
  const re = /(?:^|[\s(])#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    tags.add(m[1]);
  }
  return [...tags];
}

function extractFrontmatterTags(fm: Record<string, unknown> | null): string[] {
  if (!fm) return [];
  const raw = fm.tags ?? fm.tag;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x)).filter(Boolean);
  if (typeof raw === "string") {
    return raw.split(/[,\s]+/).filter(Boolean);
  }
  return [];
}

function extractInternalLinks(body: string): string[] {
  const links = new Set<string>();
  const re = /\[\[([^\]\n|]+)(?:\|[^\]\n]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const name = m[1].trim();
    if (name) links.add(name);
  }
  return [...links];
}

export function parseObsidianNote(
  rawText: string,
  fileName: string,
  opts: { useFilenameAsTitle: boolean; extractTags: boolean; detectLinks: boolean },
): ParsedNote {
  const { frontmatter, body } = parseFrontmatter(rawText);
  const baseName = fileName.replace(/\.(md|markdown|txt)$/i, "");

  let title = baseName;
  if (!opts.useFilenameAsTitle) {
    const h1 = extractH1(body);
    if (h1) title = h1;
  }

  const tags: string[] = [];
  if (opts.extractTags) {
    tags.push(...extractFrontmatterTags(frontmatter));
    tags.push(...extractInlineTags(body));
  }

  const links = opts.detectLinks ? extractInternalLinks(body) : [];

  return {
    title: title.slice(0, 200),
    content: body.trim(),
    tags: [...new Set(tags)],
    links,
    frontmatter,
  };
}

// ============ ZIP handling ============

export async function extractNotesFromZip(file: File): Promise<{ notes: { name: string; path: string; text: string }[]; ignored: number; errors: string[] }> {
  if (file.size > MAX_ZIP_SIZE) {
    throw new Error(`ZIP troppo grande (max ${MAX_ZIP_SIZE / 1024 / 1024} MB)`);
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(buf, {
    filter: (f) => {
      const n = f.name;
      if (n.endsWith("/")) return false;
      if (n.split("/").some((p) => p.startsWith("."))) return false;
      return /\.(md|markdown|txt)$/i.test(n);
    },
  });
  const notes: { name: string; path: string; text: string }[] = [];
  const errors: string[] = [];
  let ignored = 0;
  for (const [path, data] of Object.entries(entries)) {
    try {
      if (data.length > MAX_FILE_SIZE) { ignored++; continue; }
      const text = strFromU8(data);
      const parts = path.split("/");
      const name = parts[parts.length - 1];
      notes.push({ name, path, text });
    } catch (e) {
      errors.push(`${path}: ${e instanceof Error ? e.message : "parse error"}`);
    }
  }
  return { notes, ignored, errors };
}

// ============ Import ============

async function getUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error ?? new Error("Non autenticato");
  return data.user.id;
}

async function insertSource(input: {
  user_id: string; brain_id: string; node_id: string | null;
  title: string; tags: string[]; content: string;
  metadata: Record<string, unknown>;
}): Promise<{ id: string }> {
  const { data, error } = await supabase.from("knowledge_sources").insert({
    user_id: input.user_id,
    brain_id: input.brain_id,
    node_id: input.node_id,
    title: input.title,
    source_type: "import",
    status: "ready",
    extracted_text: input.content,
    tags: input.tags,
    metadata: input.metadata as never,
  }).select("id").single();
  if (error) throw error;
  return data as { id: string };
}

async function insertChunks(user_id: string, source: { id: string; brain_id: string; node_id: string | null }, content: string): Promise<void> {
  const pieces = chunkText(content);
  if (pieces.length === 0) return;
  const rows = pieces.map((c, idx) => ({
    user_id,
    brain_id: source.brain_id,
    source_id: source.id,
    node_id: source.node_id,
    chunk_index: idx,
    content: c,
    token_estimate: Math.ceil(c.length / 4),
    metadata: {},
  }));
  const { error } = await supabase.from("knowledge_chunks").insert(rows);
  if (error) throw error;
}

export async function importObsidianFiles(
  files: File[],
  options: ImportOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const user_id = await getUserId();
  if (!options.brainId) throw new Error("Cervello non selezionato");

  // 1. Expand files -> notes
  const notes: ParsedNote[] = [];
  const errors: string[] = [];
  let ignored = 0;

  for (const f of files) {
    const lower = f.name.toLowerCase();
    try {
      if (lower.endsWith(".zip")) {
        const { notes: zipNotes, ignored: zi, errors: zerr } = await extractNotesFromZip(f);
        ignored += zi;
        errors.push(...zerr);
        for (const zn of zipNotes) {
          const parsed = parseObsidianNote(zn.text, zn.name, {
            useFilenameAsTitle: options.useFilenameAsTitle,
            extractTags: options.extractObsidianTags,
            detectLinks: options.detectInternalLinks,
          });
          parsed.path = zn.path;
          notes.push(parsed);
        }
      } else if (/\.(md|markdown|txt)$/i.test(f.name)) {
        if (f.size > MAX_FILE_SIZE) { ignored++; continue; }
        const text = await f.text();
        const parsed = parseObsidianNote(text, f.name, {
          useFilenameAsTitle: options.useFilenameAsTitle,
          extractTags: options.extractObsidianTags,
          detectLinks: options.detectInternalLinks,
        });
        notes.push(parsed);
      } else {
        ignored++;
      }
    } catch (e) {
      errors.push(`${f.name}: ${e instanceof Error ? e.message : "errore"}`);
    }
  }

  if (notes.length === 0) {
    throw new Error("Nessun file valido (.md, .txt o .zip con note)");
  }

  // 2. Create import job
  const { data: jobRow, error: jobErr } = await supabase.from("import_jobs").insert({
    user_id,
    brain_id: options.brainId,
    source_type: "obsidian",
    status: "processing",
    total_items: notes.length,
    processed_items: 0,
    metadata: { ignored, errors: errors.length } as never,
  }).select("id").single();
  if (jobErr) throw jobErr;
  const jobId = (jobRow as { id: string }).id;

  await logAction({
    action: "obsidian_import_started",
    message: `Import Obsidian avviato: ${notes.length} note`,
    entity_type: "import_job", entity_id: jobId, brain_id: options.brainId,
  });
  await pushLiveEvent({
    event_type: "import", title: `Import Obsidian avviato (${notes.length} note)`,
    brain_id: options.brainId,
  });

  // 3. Insert sources + chunks
  const createdByTitle = new Map<string, { id: string; brain_id: string; node_id: string | null }>();
  let imported = 0;

  for (const note of notes) {
    try {
      const tags = [...new Set([...note.tags, ...options.manualTags])];
      const metadata: Record<string, unknown> = {
        origin: "obsidian",
      };
      if (note.path) metadata.obsidian_path = note.path;
      if (note.links.length > 0) metadata.obsidian_links = note.links;
      if (note.frontmatter) metadata.frontmatter = note.frontmatter;

      const src = await insertSource({
        user_id, brain_id: options.brainId, node_id: options.nodeId,
        title: note.title, tags, content: note.content, metadata,
      });
      const ref = { id: src.id, brain_id: options.brainId, node_id: options.nodeId };
      createdByTitle.set(note.title.toLowerCase(), ref);
      if (note.content.trim()) {
        try { await insertChunks(user_id, ref, note.content); } catch (e) {
          errors.push(`${note.title}: chunk error`);
          void e;
        }
      }
      imported++;
      await supabase.from("import_jobs").update({ processed_items: imported }).eq("id", jobId);
      onProgress?.(imported, notes.length);
    } catch (e) {
      errors.push(`${note.title}: ${e instanceof Error ? e.message : "insert error"}`);
    }
  }

  // 4. Finalize job
  const finalStatus = imported > 0 ? "ready" : "error";
  await supabase.from("import_jobs").update({
    status: finalStatus,
    processed_items: imported,
    error_message: errors.length > 0 ? errors.slice(0, 5).join(" | ") : null,
    metadata: { ignored, errors: errors.length, total_notes: notes.length } as never,
  }).eq("id", jobId);

  await logAction({
    action: finalStatus === "ready" ? "obsidian_import_completed" : "obsidian_import_failed",
    message: `Import Obsidian: ${imported}/${notes.length} note importate${ignored ? `, ${ignored} ignorate` : ""}`,
    severity: finalStatus === "ready" ? "info" : "error",
    entity_type: "import_job", entity_id: jobId, brain_id: options.brainId,
  });
  await pushLiveEvent({
    event_type: "import",
    title: `Import Obsidian: ${imported} note`,
    brain_id: options.brainId,
  });

  return { imported, ignored, errors, edgesCreated: 0 };
}
