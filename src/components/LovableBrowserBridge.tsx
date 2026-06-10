import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Chrome,
  Copy,
  Download,
  Puzzle,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buildZip, downloadBlob } from "@/lib/export-utils";
import {
  getAutomationRun,
  type ItemLike,
  type LogEventType,
} from "@/lib/automation-run";
import { CANONICAL_LOVABLE_URLS } from "@/components/LovableHandoffConnector";

type ClipItem = ItemLike & {
  content: string | null;
  content_type: string | null;
  target_tool: string | null;
  risk_level: string | null;
  updated_at: string;
};
type Brain = { id: string; name: string };

const MANIFEST_JSON = `{
  "manifest_version": 3,
  "name": "Brain Hub · Lovable Browser Bridge",
  "version": "0.2.0",
  "description": "Inserisce un prompt preparato in Brain Hub nella chat Lovable del Chrome gia' loggato. Invio automatico solo dopo conferma esplicita. Nessun login automatico, nessuna credenziale.",
  "permissions": ["activeTab", "scripting", "storage", "clipboardWrite"],
  "host_permissions": ["https://lovable.dev/*"],
  "action": { "default_popup": "popup.html", "default_title": "Brain Hub Bridge" },
  "content_scripts": [
    {
      "matches": ["https://lovable.dev/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
`;

const CONTENT_JS = `// content.js  v0.2.0
// Attivo SOLO su https://lovable.dev/*. Nessuna chiamata esterna.
// Niente login automatico. Niente password. Niente token. Niente lettura cookie.
// Niente chiamate API private Lovable.

const SELECTORS = [
  'textarea[placeholder*="Ask" i]',
  'textarea[placeholder*="Message" i]',
  'textarea[placeholder*="prompt" i]',
  'textarea[placeholder*="chat" i]',
  'div[contenteditable="true"][role="textbox"]',
  'div[contenteditable="true"][aria-label*="message" i]',
  'div[contenteditable="true"][aria-label*="chat" i]',
  'div[contenteditable="true"][aria-label*="prompt" i]',
  'div[contenteditable="true"]',
  'textarea',
  'input[type="text"][placeholder*="Ask" i]',
  'input[type="text"][placeholder*="Message" i]'
];

function isVisible(el) {
  if (!el) return false;
  if (el.offsetParent !== null) return true;
  const r = el.getClientRects();
  return r && r.length > 0;
}

function findChatInput() {
  for (const sel of SELECTORS) {
    const list = document.querySelectorAll(sel);
    for (const el of list) {
      if (isVisible(el)) return el;
    }
  }
  return null;
}

function findSubmitButton() {
  const candidates = document.querySelectorAll(
    'button[type="submit"], button[aria-label*="send" i], button[title*="send" i], button[aria-label*="invia" i], button[title*="invia" i]'
  );
  for (const b of candidates) {
    if (!b.disabled && isVisible(b)) return b;
  }
  return null;
}

async function insertPrompt(prompt) {
  const el = findChatInput();
  if (!el) {
    return {
      ok: false,
      reason:
        "Input chat non trovato. Clicca nel campo chat Lovable e riprova."
    };
  }

  el.focus();
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, prompt);
    else el.value = prompt;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    el.innerText = "";
    document.execCommand("insertText", false, prompt);
  }
  return { ok: true };
}

async function submitPrompt() {
  const el = findChatInput();
  if (!el) {
    return {
      ok: false,
      reason:
        "Input chat non trovato. Clicca nel campo chat Lovable e riprova."
    };
  }
  el.focus();

  // Try Enter first
  const ev = new KeyboardEvent("keydown", {
    key: "Enter", code: "Enter", which: 13, keyCode: 13, bubbles: true
  });
  el.dispatchEvent(ev);

  // Fallback: submit button
  const btn = findSubmitButton();
  if (btn) btn.click();
  return { ok: true };
}

function getPageInfo() {
  return {
    url: location.href,
    host: location.host,
    isLovable: location.host.endsWith("lovable.dev"),
    isProject: /\\/projects\\//.test(location.pathname),
    hasInput: !!findChatInput()
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (!location.host.endsWith("lovable.dev")) {
      sendResponse({ ok: false, reason: "Estensione attiva solo su lovable.dev" });
      return;
    }
    if (msg?.type === "BH_PAGE_INFO") {
      sendResponse({ ok: true, info: getPageInfo() });
      return;
    }
    if (msg?.type === "BH_INSERT_PROMPT") {
      const r = await insertPrompt(String(msg.prompt ?? ""));
      sendResponse(r);
      return;
    }
    if (msg?.type === "BH_SUBMIT") {
      const r = await submitPrompt();
      sendResponse(r);
      return;
    }
    sendResponse({ ok: false, reason: "Messaggio non riconosciuto" });
  })();
  return true;
});
`;

const POPUP_HTML = `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <title>Brain Hub Bridge</title>
  <style>
    body { font-family: system-ui, sans-serif; width: 380px; padding: 12px; }
    h1 { font-size: 14px; margin: 0 0 8px; }
    textarea { width: 100%; min-height: 140px; font-family: ui-monospace, monospace; font-size: 12px; }
    button { margin-top: 6px; padding: 6px 10px; cursor: pointer; }
    .row { display: flex; gap: 6px; flex-wrap: wrap; }
    .warn { font-size: 11px; color: #b45309; background: #fffbeb; padding: 6px; border-radius: 4px; margin-top: 8px; }
    .info { font-size: 11px; color: #1e3a8a; background: #eff6ff; padding: 6px; border-radius: 4px; margin-top: 8px; }
    .ok { font-size: 11px; color: #047857; margin-top: 6px; }
    .err { font-size: 11px; color: #b91c1c; margin-top: 6px; }
    .preview { font-family: ui-monospace, monospace; font-size: 10px; background: #f3f4f6; padding: 6px; border-radius: 4px; margin-top: 6px; max-height: 90px; overflow: auto; white-space: pre-wrap; }
    label { font-size: 12px; display: flex; align-items: center; gap: 6px; margin-top: 8px; }
    .url { font-family: ui-monospace, monospace; font-size: 10px; word-break: break-all; }
    .muted { color: #6b7280; font-size: 11px; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 10px 0; }
  </style>
</head>
<body>
  <h1>Brain Hub · Lovable Browser Bridge <span class="muted">v0.2</span></h1>

  <div id="tabinfo" class="info">Tab attivo: <span id="taburl" class="url">…</span></div>

  <textarea id="prompt" placeholder="Incolla qui il prompt copiato da Brain Hub"></textarea>

  <div class="muted">Anteprima primi 300 caratteri:</div>
  <div id="preview" class="preview"></div>

  <hr />

  <div class="row">
    <button id="insert">Inserisci prompt</button>
    <button id="insertSend">Inserisci e invia con conferma</button>
  </div>

  <label><input type="checkbox" id="autosend" /> Invia automaticamente dopo inserimento (opt-in)</label>
  <div class="warn">
    L'invio automatico richiede sempre conferma esplicita. Controlla che il progetto
    Lovable aperto sia quello corretto. Dopo conferma il prompt verra' inviato.
  </div>

  <div id="status"></div>

  <script src="popup.js"></script>
</body>
</html>
`;

const POPUP_JS = `// popup.js v0.2.0
const $ = (id) => document.getElementById(id);

function setStatus(kind, text) {
  const s = $("status");
  s.className = kind || "";
  s.textContent = text || "";
}

async function getActiveLovableTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function getPageInfo(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "BH_PAGE_INFO" });
  } catch (e) {
    return { ok: false, reason: "Content script non caricato. Ricarica la pagina lovable.dev." };
  }
}

function refreshPreview() {
  const p = $("prompt").value || "";
  $("preview").textContent = p.slice(0, 300) + (p.length > 300 ? "…" : "");
}

async function refreshTab() {
  const tab = await getActiveLovableTab();
  $("taburl").textContent = tab?.url || "(nessun tab)";
}

document.addEventListener("DOMContentLoaded", async () => {
  const saved = await chrome.storage.local.get(["bh_last_prompt"]);
  if (saved?.bh_last_prompt) $("prompt").value = saved.bh_last_prompt;
  refreshPreview();
  refreshTab();
  $("prompt").addEventListener("input", refreshPreview);

  // "Inserisci prompt" — solo insert, niente invio
  $("insert").addEventListener("click", async () => {
    setStatus("", "");
    const prompt = $("prompt").value.trim();
    if (!prompt) { setStatus("err", "Prompt vuoto."); return; }

    const tab = await getActiveLovableTab();
    if (!tab?.url || !tab.url.startsWith("https://lovable.dev/")) {
      setStatus("err", "Apri prima la chat Lovable nel tab attivo.");
      return;
    }

    await chrome.storage.local.set({ bh_last_prompt: prompt });
    const r = await chrome.tabs.sendMessage(tab.id, { type: "BH_INSERT_PROMPT", prompt });
    if (!r?.ok) { setStatus("err", "Errore: " + (r?.reason ?? "sconosciuto")); return; }

    setStatus("ok", "Prompt inserito. Controlla Lovable e invia a mano.");

    // checkbox opt-in: comportamento legacy con conferma
    if ($("autosend").checked) {
      const ok = confirm(
        "Confermi di voler inviare questo prompt al progetto Lovable aperto?\\n\\n" + (tab.url || "")
      );
      if (!ok) return;
      const send = await chrome.tabs.sendMessage(tab.id, { type: "BH_SUBMIT" });
      if (!send?.ok) { setStatus("err", "Inserito, ma invio fallito: " + (send?.reason ?? "?")); return; }
      await emitReceipt(tab.url, prompt);
      setStatus("ok", "Prompt inviato a Lovable. Torna in Brain Hub e segna inviato manualmente.");
    }
  });

  // "Inserisci e invia con conferma" — flusso completo con doppia protezione
  $("insertSend").addEventListener("click", async () => {
    setStatus("", "");
    const prompt = $("prompt").value.trim();
    if (!prompt) { setStatus("err", "Prompt vuoto."); return; }

    const tab = await getActiveLovableTab();
    if (!tab?.url || !tab.url.startsWith("https://lovable.dev/")) {
      setStatus("err", "Tab attivo non e' su lovable.dev. Blocco.");
      return;
    }

    const info = await getPageInfo(tab.id);
    if (!info?.ok || !info?.info?.isLovable) {
      setStatus("err", info?.reason || "Pagina non valida.");
      return;
    }
    if (!info.info.hasInput) {
      setStatus("err", "Input chat non trovato. Clicca nel campo chat Lovable e riprova.");
      return;
    }

    if (!info.info.isProject) {
      const proceed = confirm(
        "ATTENZIONE: l'URL attivo non sembra un progetto Lovable (/projects/...).\\n\\n" +
        "URL: " + tab.url + "\\n\\n" +
        "Procedere comunque?"
      );
      if (!proceed) { setStatus("err", "Operazione annullata."); return; }
    }

    await chrome.storage.local.set({ bh_last_prompt: prompt });

    // Insert first
    const ins = await chrome.tabs.sendMessage(tab.id, { type: "BH_INSERT_PROMPT", prompt });
    if (!ins?.ok) { setStatus("err", "Errore inserimento: " + (ins?.reason ?? "?")); return; }

    // Strong confirm
    const preview = prompt.slice(0, 300) + (prompt.length > 300 ? "…" : "");
    const ok = confirm(
      "Confermi di voler inviare questo prompt al progetto Lovable aperto?\\n\\n" +
      "URL: " + tab.url + "\\n\\n" +
      "Anteprima prompt:\\n" + preview
    );
    if (!ok) {
      setStatus("ok", "Prompt inserito ma NON inviato. Conferma annullata.");
      return;
    }

    const send = await chrome.tabs.sendMessage(tab.id, { type: "BH_SUBMIT" });
    if (!send?.ok) { setStatus("err", "Invio fallito: " + (send?.reason ?? "?")); return; }

    await emitReceipt(tab.url, prompt);
    setStatus("ok", "Prompt inviato a Lovable. Torna in Brain Hub e segna inviato manualmente.");
  });
});

async function emitReceipt(url, prompt) {
  const receipt = {
    source: "lovable_browser_bridge",
    status: "sent",
    sent_at: new Date().toISOString(),
    lovable_url: url || "",
    prompt_preview: (prompt || "").slice(0, 300)
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(receipt, null, 2));
  } catch (_) {
    // best effort
  }
}
`;

const README_MD = `# Brain Hub · Lovable Browser Bridge (estensione Chrome) v0.2

Estensione locale che inserisce un prompt preparato in Brain Hub nella chat
Lovable, usando il **tuo Chrome normale gia' loggato**. La v0.2 aggiunge la
modalita' "Inserisci e invia con conferma" con doppia protezione.

Niente login automatici, niente password, niente token, niente lettura cookie,
niente chiamate API private Lovable, niente chiamate di rete esterne. Attiva
solo su \`https://lovable.dev/*\`.

## Quando usarla

Quando il Playwright Local Agent non riesce ad accedere perche' Lovable o il
provider di login bloccano il browser automatizzato.

## Installazione

1. Scarica la cartella estensione dal Brain Hub (bottone "Scarica estensione Browser Bridge").
2. Scompatta lo ZIP in una cartella locale.
3. Apri Chrome normale.
4. Vai su \`chrome://extensions\`.
5. Attiva "Modalita' sviluppatore" (toggle in alto a destra).
6. Clicca "Carica estensione non pacchettizzata".
7. Seleziona la cartella \`lovable-browser-bridge\`.

## Uso

1. Apri Lovable nel **tuo Chrome normale**, vai nel **progetto giusto**, fai login se serve.
2. In Brain Hub, sull'Execution Package, clicca "Copia prompt per Browser Bridge".
3. Clicca l'icona dell'estensione nella barra di Chrome.
4. Incolla il prompt nella textarea del popup. Vedrai l'URL attivo del tab e l'anteprima dei primi 300 caratteri.
5. Scegli una delle due azioni:
   - **Inserisci prompt** — inserisce e basta, invio manuale da te.
   - **Inserisci e invia con conferma** — inserisce, mostra conferma forte con URL e anteprima, e invia solo se confermi.

### Protezioni attive

- Se il tab attivo non e' \`lovable.dev\`, blocca.
- Se non trova l'input chat, mostra errore: "Input chat non trovato. Clicca nel campo chat Lovable e riprova."
- Se il prompt e' vuoto, blocca.
- Se l'URL non contiene \`/projects/\`, mostra warning forte e richiede conferma extra.
- Conferma esplicita prima di ogni invio.

### Receipt

Dopo invio riuscito, l'estensione copia negli appunti un piccolo receipt JSON:

\`\`\`json
{
  "source": "lovable_browser_bridge",
  "status": "sent",
  "sent_at": "2026-06-10T12:00:00.000Z",
  "lovable_url": "https://lovable.dev/projects/...",
  "prompt_preview": "…"
}
\`\`\`

Puoi incollarlo in Brain Hub come traccia manuale.

## Sicurezza

- Nessuna credenziale Lovable viene salvata.
- Nessun token viene salvato.
- Nessun cookie viene letto.
- Nessuna chiamata di rete esterna.
- Nessuna chiamata ad API private Lovable.
- \`host_permissions\` limitato a \`https://lovable.dev/*\`.
- Il login a Lovable e' sempre manuale, fatto da te nel tuo Chrome.
- L'invio automatico e' opt-in e richiede sempre conferma esplicita.

## Cosa NON fa

- Non automatizza il login Google/GitHub/email.
- Non legge ne' salva password o cookie.
- Non comunica con server esterni.
- Non cattura automaticamente la risposta di Lovable.
- Non invia callback automatiche a Brain Hub.
- Non fa scraping aggressivo.
- Non agisce su siti diversi da lovable.dev.
`;

type KitFile = { name: string; content: string };

const EXT_FILES: KitFile[] = [
  { name: "manifest.json", content: MANIFEST_JSON },
  { name: "content.js", content: CONTENT_JS },
  { name: "popup.html", content: POPUP_HTML },
  { name: "popup.js", content: POPUP_JS },
  { name: "README_EXTENSION.md", content: README_MD },
];

function canonicalUrlForBrainName(name: string | null | undefined): string | null {
  if (!name) return null;
  return CANONICAL_LOVABLE_URLS[name.trim().toLowerCase()] ?? null;
}

async function fetchData() {
  const [itemsRes, brainsRes] = await Promise.all([
    supabase
      .from("clipboard_items")
      .select(
        "id,brain_id,project_id,title,content,content_type,target_tool,automation_status,risk_level,success_criteria,expected_output,execution_instructions,metadata,updated_at",
      )
      .eq("content_type", "execution_package")
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase.from("brains").select("id,name"),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (brainsRes.error) throw brainsRes.error;
  return {
    items: (itemsRes.data ?? []) as ClipItem[],
    brains: (brainsRes.data ?? []) as Brain[],
  };
}

function buildCleanPrompt(item: ClipItem): string {
  const m = (item.metadata as Record<string, unknown> | null) ?? {};
  const pkg = (m.execution_package as Record<string, unknown> | undefined) ?? {};
  const p = (pkg.promptOnly as string | undefined)?.trim();
  if (p) return p;
  return (item.content ?? "").trim();
}

function isEligible(i: ClipItem): boolean {
  if (i.content_type !== "execution_package") return false;
  const run = getAutomationRun(i);
  const tool = (i.target_tool ?? "").toLowerCase();
  const target = (run.target ?? "").toLowerCase();
  if (tool !== "lovable" && target !== "lovable") return false;
  return ["approved", "queued", "running", "draft"].includes(run.run_status);
}

async function logEvent(itemId: string | null, action: LogEventType, notes: string) {
  try {
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return;
    await supabase.from("clipboard_execution_logs").insert({
      user_id: u.user.id,
      clipboard_item_id: itemId,
      action,
      notes,
      metadata: { connector: "lovable_browser_bridge" },
    } as never);
  } catch {
    // best effort
  }
}

export function LovableBrowserBridge() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["lovable-browser-bridge"],
    queryFn: fetchData,
    refetchInterval: 30000,
  });
  const [openFile, setOpenFile] = useState<string | null>("popup.js");

  const items = data?.items ?? [];
  const brains = data?.brains ?? [];
  const brainMap = useMemo(() => new Map(brains.map((b) => [b.id, b])), [brains]);
  const eligible = useMemo(() => items.filter(isEligible), [items]);

  async function copyPromptForBridge(item: ClipItem) {
    const prompt = buildCleanPrompt(item);
    if (!prompt) {
      toast.error("Prompt vuoto");
      return;
    }
    if (item.risk_level === "alto") {
      const ok = window.confirm("Item ad alto rischio. Confermi la copia del prompt?");
      if (!ok) return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      toast.error("Copia non riuscita");
      return;
    }
    toast.success("Prompt copiato. Incollalo nel popup dell'estensione.");
    await logEvent(item.id, "lovable_browser_bridge_prompt_copied", `Prompt copiato per Browser Bridge: ${item.title}`);
    // Pre-traccia: l'estensione non puo' notificare automaticamente.
    // Logghiamo "prompt_inserted" come intent operativo dell'utente quando
    // copia il prompt per il flusso Browser Bridge — futura integrazione receipt.
    await logEvent(
      item.id,
      "lovable_browser_bridge_prompt_inserted",
      `Intent: inserimento prompt via Browser Bridge per ${item.title} (conferma e invio rimangono manuali nell'estensione).`,
    );
  }

  async function markBridgeSent(item: ClipItem) {
    const ok = window.confirm(
      "Confermi che hai inviato manualmente il prompt a Lovable tramite Browser Bridge?",
    );
    if (!ok) return;
    await logEvent(
      item.id,
      "lovable_browser_bridge_prompt_sent_confirmed",
      `Invio confermato manualmente via Browser Bridge: ${item.title}`,
    );
    toast.success("Invio Browser Bridge registrato nel ledger");
  }

  async function copyFile(file: KitFile) {
    try {
      await navigator.clipboard.writeText(file.content);
      toast.success(`${file.name} copiato`);
    } catch {
      toast.error("Copia non riuscita");
    }
  }

  function downloadFile(file: KitFile) {
    downloadBlob(new Blob([file.content], { type: "text/plain;charset=utf-8" }), file.name);
    void logEvent(null, "lovable_browser_bridge_extension_downloaded", `File ${file.name} scaricato`);
  }

  function downloadExtensionZip() {
    const blob = buildZip(
      EXT_FILES.map((f) => ({ path: `lovable-browser-bridge/${f.name}`, data: f.content })),
    );
    downloadBlob(blob, "lovable-browser-bridge.zip");
    toast.success("Estensione Browser Bridge v0.2 scaricata");
    void logEvent(null, "lovable_browser_bridge_extension_downloaded", "Estensione ZIP v0.2 scaricata");
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Puzzle className="h-4 w-4 text-orange-400" /> Lovable Browser Bridge
            <Badge variant="outline" className="ml-1 text-[10px]">v0.2</Badge>
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="bg-orange-500/10 text-orange-300 border-orange-500/30 gap-1">
              <Chrome className="h-3 w-3" /> Chrome normale gia' loggato
            </Badge>
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 gap-1">
              <ShieldCheck className="h-3 w-3" /> Invio solo con conferma
            </Badge>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Modalita' "Inserisci e invia con conferma": l'estensione verifica il tab
          Lovable, inserisce il prompt nella chat, mostra URL + anteprima e invia
          SOLO dopo conferma esplicita. Nessun login automatico, nessuna password,
          nessun token, nessun cookie letto, nessuna chiamata esterna.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={downloadExtensionZip}>
            <Download className="mr-1 h-3 w-3" /> Scarica estensione Browser Bridge v0.2
          </Button>
        </div>

        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="text-xs leading-relaxed text-amber-200">
            L'estensione e' attiva solo su <code className="rounded bg-amber-500/20 px-1">https://lovable.dev/*</code>.
            Controlla che il progetto Lovable aperto nel Chrome sia quello corretto
            prima di inserire o inviare il prompt. Dopo conferma, il prompt verra' inviato.
          </div>
        </div>

        <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
          <div className="mb-1 font-medium text-foreground">Flusso operativo (aggiornato)</div>
          <ol className="list-decimal space-y-0.5 pl-4">
            <li>Apri il progetto Lovable corretto nel tuo Chrome normale.</li>
            <li>In Brain Hub clicca "Copia prompt per Browser Bridge" sull'item.</li>
            <li>Apri l'estensione dalla barra di Chrome.</li>
            <li>Per un test sicuro usa "Inserisci prompt" (nessun invio).</li>
            <li>Solo dopo verifica, usa "Inserisci e invia con conferma".</li>
            <li>Quando hai inviato, torna qui e clicca "Segna inviato (Browser Bridge)".</li>
          </ol>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Execution Package Lovable idonei ({eligible.length})
          </div>
          {isLoading && <div className="text-sm text-muted-foreground">Caricamento…</div>}
          {error && <div className="text-sm text-destructive">{(error as Error).message}</div>}
          {!isLoading && eligible.length === 0 && (
            <div className="rounded-md border border-border/60 p-3 text-sm text-muted-foreground">
              Nessun Execution Package Lovable approvato/in corso.
            </div>
          )}
          {eligible.map((it) => {
            const brain = it.brain_id ? brainMap.get(it.brain_id) : null;
            const url = canonicalUrlForBrainName(brain?.name);
            return (
              <div
                key={it.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 p-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{it.title || "(senza titolo)"}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {brain?.name ?? "—"}
                    {url ? ` · ${url}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {it.risk_level && (
                    <Badge variant="outline" className="text-[10px]">
                      {it.risk_level}
                    </Badge>
                  )}
                  <Button size="sm" variant="outline" onClick={() => copyPromptForBridge(it)}>
                    <Copy className="mr-1 h-3 w-3" /> Copia prompt per Browser Bridge
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => markBridgeSent(it)}>
                    Segna inviato (Browser Bridge)
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">File estensione (v0.2)</div>
          {EXT_FILES.map((f) => {
            const open = openFile === f.name;
            return (
              <div key={f.name} className="rounded-md border border-border/60">
                <div className="flex flex-wrap items-center justify-between gap-2 p-2">
                  <button
                    type="button"
                    onClick={() => setOpenFile(open ? null : f.name)}
                    className="min-w-0 flex-1 truncate text-left font-mono text-sm hover:underline"
                  >
                    {f.name}
                  </button>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => copyFile(f)}>
                      <Copy className="mr-1 h-3 w-3" /> Copia
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => downloadFile(f)}>
                      <Download className="mr-1 h-3 w-3" /> Scarica
                    </Button>
                  </div>
                </div>
                {open && (
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-border/60 bg-background/40 p-3 font-mono text-[11px] leading-relaxed">
                    {f.content}
                  </pre>
                )}
              </div>
            );
          })}
        </div>

        <div className="text-[11px] leading-relaxed text-muted-foreground">
          Sicurezza: nessuna credenziale, token o cookie viene salvato o letto;
          nessuna chiamata esterna; nessuna chiamata ad API private Lovable;
          host_permissions limitato a <code className="rounded bg-muted px-1">https://lovable.dev/*</code>;
          invio automatico opt-in con conferma esplicita; il login a Lovable resta
          sempre manuale nel tuo Chrome.
        </div>
      </CardContent>
    </Card>
  );
}
