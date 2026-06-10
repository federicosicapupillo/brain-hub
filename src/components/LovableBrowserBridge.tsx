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
  "version": "0.1.0",
  "description": "Inserisce un prompt preparato in Brain Hub nella chat Lovable del Chrome gia' loggato dall'utente. Nessun login automatico, nessuna credenziale.",
  "permissions": ["activeTab", "scripting", "storage"],
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

const CONTENT_JS = `// content.js
// Attivo SOLO su https://lovable.dev/*. Nessuna chiamata esterna.
// Niente login automatico. Niente password. Niente token.

const SELECTORS = [
  'textarea[placeholder*="Ask" i]',
  'textarea[placeholder*="Message" i]',
  'textarea[placeholder*="prompt" i]',
  'textarea[placeholder*="chat" i]',
  'div[contenteditable="true"][role="textbox"]',
  'div[contenteditable="true"]',
  'textarea'
];

function findChatInput() {
  for (const sel of SELECTORS) {
    const el = document.querySelector(sel);
    if (el && (el.offsetParent !== null || el.getClientRects().length > 0)) return el;
  }
  return null;
}

async function insertPrompt(prompt) {
  const el = findChatInput();
  if (!el) return { ok: false, reason: "Chat Lovable non trovata. Apri la chat del progetto." };

  el.focus();
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, prompt);
    else el.value = prompt;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    // contenteditable
    el.innerText = "";
    document.execCommand("insertText", false, prompt);
  }
  return { ok: true };
}

async function submitPrompt() {
  const el = findChatInput();
  if (!el) return { ok: false, reason: "Chat Lovable non trovata." };
  // Try Enter
  el.focus();
  const ev = new KeyboardEvent("keydown", {
    key: "Enter", code: "Enter", which: 13, keyCode: 13, bubbles: true
  });
  el.dispatchEvent(ev);
  // Fallback: submit button
  const btn = document.querySelector('button[type="submit"], button[aria-label*="send" i], button[title*="send" i]');
  if (btn) btn.click();
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (!location.host.endsWith("lovable.dev")) {
      sendResponse({ ok: false, reason: "Estensione attiva solo su lovable.dev" });
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
    body { font-family: system-ui, sans-serif; width: 360px; padding: 12px; }
    h1 { font-size: 14px; margin: 0 0 8px; }
    textarea { width: 100%; min-height: 140px; font-family: ui-monospace, monospace; font-size: 12px; }
    button { margin-top: 8px; padding: 6px 10px; cursor: pointer; }
    .warn { font-size: 11px; color: #b45309; background: #fffbeb; padding: 6px; border-radius: 4px; margin-top: 8px; }
    .ok { font-size: 11px; color: #047857; margin-top: 6px; }
    .err { font-size: 11px; color: #b91c1c; margin-top: 6px; }
    label { font-size: 12px; display: flex; align-items: center; gap: 6px; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>Brain Hub · Lovable Browser Bridge</h1>
  <textarea id="prompt" placeholder="Incolla qui il prompt copiato da Brain Hub"></textarea>
  <label><input type="checkbox" id="autosend" /> Invia automaticamente dopo inserimento</label>
  <div class="warn">Usa invio automatico solo dopo aver verificato il progetto Lovable aperto.</div>
  <button id="insert">Inserisci prompt in Lovable</button>
  <div id="status"></div>
  <script src="popup.js"></script>
</body>
</html>
`;

const POPUP_JS = `// popup.js
const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  const saved = await chrome.storage.local.get(["bh_last_prompt"]);
  if (saved?.bh_last_prompt) $("prompt").value = saved.bh_last_prompt;

  $("insert").addEventListener("click", async () => {
    const prompt = $("prompt").value.trim();
    const status = $("status");
    status.className = "";
    status.textContent = "";

    if (!prompt) { status.className = "err"; status.textContent = "Prompt vuoto."; return; }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !tab.url.startsWith("https://lovable.dev/")) {
      status.className = "err";
      status.textContent = "Apri prima la chat Lovable nel tab attivo.";
      return;
    }

    await chrome.storage.local.set({ bh_last_prompt: prompt });

    const insertRes = await chrome.tabs.sendMessage(tab.id, { type: "BH_INSERT_PROMPT", prompt });
    if (!insertRes?.ok) {
      status.className = "err";
      status.textContent = "Errore: " + (insertRes?.reason ?? "sconosciuto");
      return;
    }

    if ($("autosend").checked) {
      const confirmSend = confirm(
        "Confermi invio automatico del prompt nel progetto Lovable attualmente aperto?\\n\\nVerifica che sia il progetto giusto."
      );
      if (confirmSend) {
        const sendRes = await chrome.tabs.sendMessage(tab.id, { type: "BH_SUBMIT" });
        if (!sendRes?.ok) {
          status.className = "err";
          status.textContent = "Inserito, ma invio fallito: " + (sendRes?.reason ?? "?");
          return;
        }
        status.className = "ok";
        status.textContent = "Prompt inserito e inviato.";
        return;
      }
    }

    status.className = "ok";
    status.textContent = "Prompt inserito. Controlla Lovable e invia a mano.";
  });
});
`;

const README_MD = `# Brain Hub · Lovable Browser Bridge (estensione Chrome)

Estensione locale che inserisce un prompt preparato in Brain Hub nella chat
Lovable, usando il **tuo Chrome normale gia' loggato**. Niente login automatici,
niente password, niente token, niente chiamate esterne. Attiva solo su
\`https://lovable.dev/*\`.

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
4. Incolla il prompt nella textarea del popup.
5. Clicca "Inserisci prompt in Lovable".
6. Controlla la chat Lovable e invia tu il prompt.

### Invio automatico (opzionale)

Il popup ha una checkbox "Invia automaticamente dopo inserimento".
Usala SOLO dopo aver verificato a mano almeno una volta il flusso.
Chiede sempre conferma prima di premere invio.

## Sicurezza

- Nessuna credenziale Lovable viene salvata.
- Nessun token viene salvato.
- Nessuna chiamata di rete esterna.
- L'estensione e' attiva esclusivamente su \`https://lovable.dev/*\`.
- Il login a Lovable e' sempre manuale, fatto da te nel tuo Chrome.
- L'invio automatico e' disattivato di default e richiede conferma.

## Cosa NON fa

- Non automatizza il login Google/GitHub/email.
- Non legge ne' salva password.
- Non comunica con server esterni.
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
  const [openFile, setOpenFile] = useState<string | null>("content.js");

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
    toast.success("Estensione Browser Bridge scaricata");
    void logEvent(null, "lovable_browser_bridge_extension_downloaded", "Estensione ZIP scaricata");
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Puzzle className="h-4 w-4 text-orange-400" /> Lovable Browser Bridge
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="bg-orange-500/10 text-orange-300 border-orange-500/30 gap-1">
              <Chrome className="h-3 w-3" /> Chrome normale gia' loggato
            </Badge>
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 gap-1">
              <ShieldCheck className="h-3 w-3" /> Nessuna credenziale salvata
            </Badge>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Usa questa modalita' quando Playwright/Chrome automatizzato non riesce ad accedere a Lovable.
          Funziona nel Chrome normale gia' loggato: l'estensione locale incolla il prompt nella chat
          Lovable aperta. Nessun login automatico, nessuna password, nessun token, nessuna chiamata esterna.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={downloadExtensionZip}>
            <Download className="mr-1 h-3 w-3" /> Scarica estensione Browser Bridge
          </Button>
        </div>

        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="text-xs leading-relaxed text-amber-200">
            L'estensione e' attiva solo su <code className="rounded bg-amber-500/20 px-1">https://lovable.dev/*</code>.
            L'invio automatico e' disattivato di default e richiede conferma. Verifica sempre che il
            progetto Lovable aperto nel Chrome sia quello corretto prima di inserire o inviare il prompt.
          </div>
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
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
          <div className="mb-1 font-medium text-foreground">Installazione rapida</div>
          <ol className="list-decimal space-y-0.5 pl-4">
            <li>Scarica e scompatta lo ZIP dell'estensione.</li>
            <li>Apri Chrome e vai su <code className="rounded bg-muted px-1">chrome://extensions</code>.</li>
            <li>Attiva "Modalita' sviluppatore".</li>
            <li>Clicca "Carica estensione non pacchettizzata" e seleziona la cartella.</li>
            <li>Apri Lovable nel progetto corretto, poi clicca l'icona estensione.</li>
            <li>Incolla il prompt copiato da Brain Hub e clicca "Inserisci prompt".</li>
          </ol>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">File estensione</div>
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
          Sicurezza: nessuna credenziale o token viene salvato dall'estensione; nessuna chiamata esterna;
          host_permissions limitato a <code className="rounded bg-muted px-1">https://lovable.dev/*</code>;
          invio automatico opt-in con conferma; il login a Lovable resta sempre manuale nel tuo Chrome.
        </div>
      </CardContent>
    </Card>
  );
}
