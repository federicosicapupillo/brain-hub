import { zipSync, strToU8 } from "fflate";

export function slugify(s: string | null | undefined): string {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "senza-titolo";
}

/** Trigger a download. On mobile browsers where this may be blocked, opens in a new tab as fallback. */
export function downloadBlob(blob: Blob, fileName: string): void {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch {
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

export interface ExportableItem {
  title: string;
  brainName?: string | null;
  type?: string | null;
  status?: string | null;
  tool?: string | null;
  tags?: string[] | null;
  url?: string | null;
  content?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export function itemToMarkdown(it: ExportableItem): string {
  const fm: string[] = ["---"];
  fm.push(`title: ${JSON.stringify(it.title ?? "")}`);
  if (it.brainName) fm.push(`progetto: ${JSON.stringify(it.brainName)}`);
  if (it.type) fm.push(`tipo: ${it.type}`);
  if (it.status) fm.push(`stato: ${it.status}`);
  if (it.tool) fm.push(`strumento: ${it.tool}`);
  if (it.tags && it.tags.length) fm.push(`tag: [${it.tags.map((t) => JSON.stringify(t)).join(", ")}]`);
  if (it.url) fm.push(`url: ${it.url}`);
  if (it.created_at) fm.push(`creato: ${it.created_at}`);
  if (it.updated_at) fm.push(`aggiornato: ${it.updated_at}`);
  fm.push("---", "");
  let body = fm.join("\n");
  body += `# ${it.title ?? "Senza titolo"}\n\n`;
  if (it.content) body += `${it.content}\n`;
  return body;
}

export function fileNameForItem(it: ExportableItem, ext = "md"): string {
  const project = slugify(it.brainName ?? "ibrain");
  const type = slugify(it.type ?? "contenuto");
  const title = slugify(it.title);
  return `${project}--${type}--${title}.${ext}`;
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : Array.isArray(v) ? v.join("; ") : String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function itemsToCsv(items: ExportableItem[]): string {
  const cols: (keyof ExportableItem)[] = [
    "title", "brainName", "type", "status", "tool", "tags", "url",
    "created_at", "updated_at", "content",
  ];
  const header = cols.join(",");
  const rows = items.map((it) => cols.map((c) => csvEscape(it[c])).join(","));
  return [header, ...rows].join("\n");
}

export function itemsToJson(items: ExportableItem[]): string {
  return JSON.stringify(items, null, 2);
}

export interface ZipEntry { path: string; data: string }

export function buildZip(entries: ZipEntry[]): Blob {
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const e of entries) {
    let p = e.path;
    if (used.has(p)) {
      const dot = p.lastIndexOf(".");
      const base = dot > 0 ? p.slice(0, dot) : p;
      const ext = dot > 0 ? p.slice(dot) : "";
      let i = 2;
      while (used.has(`${base}-${i}${ext}`)) i++;
      p = `${base}-${i}${ext}`;
    }
    used.add(p);
    files[p] = strToU8(e.data);
  }
  const zipped = zipSync(files, { level: 6 });
  const ab = new ArrayBuffer(zipped.byteLength);
  new Uint8Array(ab).set(zipped);
  return new Blob([ab], { type: "application/zip" });
}

export function downloadMarkdown(it: ExportableItem): void {
  const md = itemToMarkdown(it);
  downloadBlob(new Blob([md], { type: "text/markdown;charset=utf-8" }), fileNameForItem(it, "md"));
}

export function downloadItemsAsMdZip(items: ExportableItem[], zipName: string): void {
  const entries: ZipEntry[] = items.map((it) => ({
    path: fileNameForItem(it, "md"),
    data: itemToMarkdown(it),
  }));
  downloadBlob(buildZip(entries), zipName);
}

export function downloadItemsAsCsv(items: ExportableItem[], fileName: string): void {
  downloadBlob(new Blob([itemsToCsv(items)], { type: "text/csv;charset=utf-8" }), fileName);
}

export function downloadItemsAsJson(items: ExportableItem[], fileName: string): void {
  downloadBlob(new Blob([itemsToJson(items)], { type: "application/json;charset=utf-8" }), fileName);
}

export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
