import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Copy, Download, Package, ShieldCheck, Terminal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buildZip, downloadBlob } from "@/lib/export-utils";
import type { LogEventType } from "@/lib/automation-run";

const PACKAGE_JSON = `{
  "name": "brainhub-lovable-agent",
  "version": "0.2.0",
  "description": "Local Playwright agent that connects to a user-launched Google Chrome (CDP) and pastes a Brain Hub prompt into Lovable. No credentials are stored. Manual supervision required.",
  "type": "module",
  "private": true,
  "scripts": {
    "start": "node brainhub-lovable-agent.js --job ./agent-job.json --connect-cdp"
  },
  "dependencies": {
    "playwright": "^1.47.0"
  }
}
`;

const ENV_EXAMPLE = `# Optional configuration for the local agent.
# Nothing here is required. NEVER put Lovable passwords or tokens.

# CDP endpoint of your already-open Chrome (default: http://127.0.0.1:9222)
AGENT_CDP_URL=http://127.0.0.1:9222

# Milliseconds to wait for Lovable UI before giving up (default: 45000)
AGENT_WAIT_MS=45000

# Legacy-only: path to the persistent browser profile when using --legacy-browser
AGENT_PROFILE_DIR=./browser-profile
`;

const CHROME_LAUNCH_CMD = `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \\
  --remote-debugging-port=9222 \\
  --user-data-dir="/Volumes/Privato/Brain Hub/chrome-profile-lovable" \\
  --no-first-run \\
  --no-default-browser-check`;

const AGENT_JS = `#!/usr/bin/env node
/**
 * brainhub-lovable-agent.js  (v0.2 - Chrome CDP robust mode)
 *
 * Recommended usage (robust mode):
 *   1. Launch Google Chrome with remote debugging (see README_AGENT.md).
 *   2. Login to Lovable manually in that Chrome window (one time).
 *   3. Run:
 *        node brainhub-lovable-agent.js --job ./agent-job.json --connect-cdp
 *
 * Optional auto-send (use only after verifying the flow):
 *        node brainhub-lovable-agent.js --job ./agent-job.json --connect-cdp --send
 *
 * Legacy mode (bundled Chromium / installed Chrome channel, may be blocked
 * by Google "browser not secure"):
 *        node brainhub-lovable-agent.js --job ./agent-job.json --legacy-browser
 *
 * Security:
 *   - never stores Lovable passwords or tokens
 *   - never automates Google login
 *   - never bypasses any security
 *   - does NOT send the prompt unless --send is explicitly passed
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const args = process.argv.slice(2);

function getArg(flag) {
  const i = args.indexOf(flag);
  if (i === -1) return null;
  return args[i + 1] ?? null;
}

const jobPath = getArg("--job");
const cdpUrlArg = getArg("--cdp-url");
const sendMode = args.includes("--send");
const useCdp = args.includes("--connect-cdp");
const legacyMode = args.includes("--legacy-browser");

if (!jobPath) {
  console.error("Missing --job <path-to-agent-job.json>");
  process.exit(1);
}

if (!useCdp && !legacyMode) {
  console.error("");
  console.error("Per evitare blocchi login Google, usa la modalita' robusta:");
  console.error("  node brainhub-lovable-agent.js --job ./agent-job.json --connect-cdp");
  console.error("");
  console.error("(Modalita' legacy disponibile come opt-in con --legacy-browser, ma puo' essere bloccata da Google.)");
  process.exit(1);
}

const absJobPath = path.resolve(process.cwd(), jobPath);
if (!fs.existsSync(absJobPath)) {
  console.error("Job file not found:", absJobPath);
  process.exit(1);
}

let job;
try {
  job = JSON.parse(fs.readFileSync(absJobPath, "utf-8"));
} catch (e) {
  console.error("Invalid JSON in job file:", e.message);
  process.exit(1);
}

const required = ["job_id", "execution_package_id", "run_id", "lovable_project_url", "prompt"];
const missing = required.filter((k) => !job[k] || String(job[k]).trim() === "");
if (missing.length > 0) {
  console.error("Job file is missing required fields:", missing.join(", "));
  process.exit(1);
}

if (!String(job.lovable_project_url).includes("lovable.dev/projects/")) {
  console.error("lovable_project_url non sembra un URL Lovable valido:", job.lovable_project_url);
  process.exit(1);
}

const cdpUrl = cdpUrlArg || process.env.AGENT_CDP_URL || "http://127.0.0.1:9222";
const waitMs = Number(process.env.AGENT_WAIT_MS || 45000);

console.log("=== Brain Hub Lovable Agent ===");
console.log("Mode:                 ", useCdp ? "CDP (robust)" : "LEGACY (bundled)");
console.log("Job ID:               ", job.job_id);
console.log("Execution Package ID: ", job.execution_package_id);
console.log("Run ID:               ", job.run_id);
console.log("Lovable Project URL:  ", job.lovable_project_url);
if (useCdp) console.log("CDP URL:              ", cdpUrl);
console.log("Send mode:            ", sendMode ? "AUTO SEND (--send)" : "MANUAL (default)");
console.log();

async function getContextAndPage() {
  if (useCdp) {
    let browser;
    try {
      browser = await chromium.connectOverCDP(cdpUrl);
    } catch (e) {
      console.error("Chrome non raggiungibile su " + cdpUrl + ".");
      console.error("Apri prima Chrome con il comando remote debugging (vedi README_AGENT.md).");
      console.error("Dettaglio:", e?.message || e);
      process.exit(1);
    }
    const contexts = browser.contexts();
    const context = contexts[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    return { context, page };
  }

  // Legacy mode
  const profileDir = process.env.AGENT_PROFILE_DIR || "./browser-profile";
  const absProfileDir = path.resolve(process.cwd(), profileDir);
  let context;
  try {
    context = await chromium.launchPersistentContext(absProfileDir, {
      channel: "chrome",
      headless: false,
      viewport: null,
      args: ["--start-maximized"],
    });
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg.toLowerCase().includes("chrome")) {
      console.error("Google Chrome non trovato. Installa Chrome oppure usa --connect-cdp.");
    } else {
      console.error("Failed to launch browser:", msg);
    }
    process.exit(1);
  }
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page };
}

(async () => {
  const { page } = await getContextAndPage();

  try {
    await page.goto(job.lovable_project_url, { waitUntil: "domcontentloaded", timeout: waitMs });
  } catch (e) {
    console.error("Failed to open Lovable project URL:", e.message);
    console.error("Se non sei loggato, fai login manuale nella finestra Chrome e rilancia.");
    return;
  }

  await page.waitForTimeout(4000);

  const currentUrl = page.url();
  if (!currentUrl.includes("lovable.dev/projects/")) {
    console.warn("WARNING: la pagina aperta non sembra un progetto Lovable: " + currentUrl);
    console.warn("Verifica login Lovable e rilancia. Non invio nulla.");
    return;
  }
  if (!currentUrl.includes(extractProjectId(job.lovable_project_url))) {
    console.warn("WARNING: il progetto aperto non corrisponde all'URL del job.");
    console.warn("Atteso:", job.lovable_project_url);
    console.warn("Aperto:", currentUrl);
    console.warn("Non invio nulla per sicurezza.");
    return;
  }

  const candidateSelectors = [
    'textarea[placeholder*="Ask" i]',
    'textarea[placeholder*="message" i]',
    'textarea[placeholder*="prompt" i]',
    'textarea[placeholder*="chat" i]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea',
  ];

  let input = null;
  let usedSelector = null;
  for (const sel of candidateSelectors) {
    const el = await page.$(sel);
    if (el) {
      input = el;
      usedSelector = sel;
      break;
    }
  }

  if (!input) {
    console.error("Input chat non trovato. Apri manualmente la chat Lovable e rilancia.");
    console.error("Prompt copiato qui sotto per riferimento:");
    console.error("---");
    console.error(job.prompt);
    console.error("---");
    return;
  }

  console.log("Chat input trovato con selector:", usedSelector);

  try {
    await input.click();
    await input.fill("");
    await input.type(job.prompt, { delay: 0 });
  } catch (e) {
    console.error("Failed to type prompt into chat input:", e.message);
    return;
  }

  console.log();
  console.log("Prompt incollato correttamente. Controlla Lovable. Per inviare automaticamente usa solo --send.");

  if (!sendMode) return;

  // --send mode
  try {
    await input.press("Enter");
    console.log("Prompt inviato con --send (Enter).");
  } catch {
    const submit = await page.$('button[type="submit"], button[aria-label*="send" i]');
    if (submit) {
      await submit.click();
      console.log("Prompt inviato con --send (click submit).");
    } else {
      console.warn("WARNING: bottone submit non trovato. Invia manualmente.");
    }
  }
})().catch((e) => {
  console.error("Agent failed:", e.message);
  process.exit(1);
});

function extractProjectId(url) {
  const m = String(url).match(/lovable\\.dev\\/projects\\/([a-zA-Z0-9-]+)/);
  return m ? m[1] : "";
}
`;

const README_MD = `# Brain Hub Lovable Local Agent (v0.2)

Agente Playwright locale che si collega a **Google Chrome reale** gia' aperto
in modalita' remote debugging, apre il progetto Lovable indicato nel job e
incolla il prompt. Niente login automatici, niente credenziali salvate.

## Modalita' robusta consigliata: Chrome reale + CDP

Questo flusso evita il messaggio Google "Questo browser o questa app
potrebbero non essere sicuri", perche' usa il **tuo Chrome reale**, non un
browser controllato direttamente da Playwright.

### 1. Installazione

\`\`\`bash
npm install
npx playwright install chromium
\`\`\`

(\`playwright install chromium\` serve solo come dipendenza interna del pacchetto.
In modalita' robusta non viene usato Chromium bundled per navigare.)

### 2. Avvia Chrome reale con remote debugging

\`\`\`bash
${CHROME_LAUNCH_CMD}
\`\`\`

Cosa fa questo comando:
- apre il tuo Chrome reale (non Chromium bundled)
- usa un profilo dedicato sull'HD esterno (\`/Volumes/Privato/Brain Hub/chrome-profile-lovable\`)
- espone CDP su \`http://127.0.0.1:9222\`

### 3. Login manuale a Lovable

Nella finestra Chrome che si e' aperta, fai login a Lovable **a mano una sola volta**.
La sessione resta nel profilo dedicato. Lo script non legge mai password
ne' token.

### 4. Avvia l'agente (senza invio automatico)

\`\`\`bash
node brainhub-lovable-agent.js --job ./agent-job.json --connect-cdp
\`\`\`

L'agente:
- si collega al tuo Chrome via CDP
- apre il progetto Lovable del job
- incolla il prompt nella chat
- **non invia** nulla
- ti dice: "Prompt incollato correttamente. Controlla Lovable."

### 5. Avvio con invio automatico opzionale

\`\`\`bash
node brainhub-lovable-agent.js --job ./agent-job.json --connect-cdp --send
\`\`\`

Solo con \`--send\` l'agente prova a premere Enter o cliccare il bottone
submit. Usalo **solo** dopo aver verificato il flusso piu' volte a mano.

### Override CDP URL

\`\`\`bash
node brainhub-lovable-agent.js --job ./agent-job.json --connect-cdp --cdp-url http://127.0.0.1:9222
\`\`\`

## Modalita' legacy (sconsigliata)

\`\`\`bash
node brainhub-lovable-agent.js --job ./agent-job.json --legacy-browser
\`\`\`

Apre Google Chrome installato con profilo persistente locale. Google puo'
bloccare il login con "browser non sicuro". Usa solo se sai cosa stai facendo.

## Cosa NON fa
- non salva password Lovable
- non salva token
- non gestisce login automatico
- non usa API private di Lovable
- non bypassa nessuna sicurezza
- non invia il prompt senza il flag esplicito \`--send\`
- non procede se il progetto aperto non corrisponde a quello del job

## Sicurezza
- Nessuna credenziale viene salvata dallo script.
- La sessione Lovable vive solo nel profilo Chrome dedicato sul tuo Mac.
- Sei tu il supervisore: tieni Chrome aperto durante l'esecuzione.
`;

const TERMINAL_INSTRUCTIONS_INSTALL = `npm install
npx playwright install chromium`;

const TERMINAL_INSTRUCTIONS_AGENT = `node brainhub-lovable-agent.js --job ./agent-job.json --connect-cdp`;

const TERMINAL_INSTRUCTIONS_AGENT_SEND = `node brainhub-lovable-agent.js --job ./agent-job.json --connect-cdp --send`;

type KitFile = { name: string; language: string; content: string };

const FILES: KitFile[] = [
  { name: "package.json", language: "json", content: PACKAGE_JSON },
  { name: "brainhub-lovable-agent.js", language: "javascript", content: AGENT_JS },
  { name: ".env.example", language: "env", content: ENV_EXAMPLE },
  { name: "README_AGENT.md", language: "markdown", content: README_MD },
];

async function logEvent(action: LogEventType, notes: string) {
  try {
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return;
    await supabase.from("clipboard_execution_logs").insert({
      user_id: u.user.id,
      clipboard_item_id: null,
      action,
      notes,
      metadata: { connector: "playwright_starter_kit" },
    } as never);
  } catch {
    // best effort
  }
}

export function PlaywrightStarterKit() {
  const [openFile, setOpenFile] = useState<string | null>("brainhub-lovable-agent.js");

  async function copyText(text: string, label: string, logAction?: LogEventType) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiato negli appunti`);
      if (logAction) await logEvent(logAction, `${label} copiato`);
    } catch {
      toast.error("Copia non riuscita");
    }
  }

  function downloadFile(file: KitFile) {
    downloadBlob(new Blob([file.content], { type: "text/plain;charset=utf-8" }), file.name);
    void logEvent("local_agent_starter_kit_downloaded", `File ${file.name} scaricato`);
  }

  function downloadZip() {
    const blob = buildZip(
      FILES.map((f) => ({ path: `brainhub-lovable-agent/${f.name}`, data: f.content })),
    );
    downloadBlob(blob, "brainhub-lovable-agent-starter-kit.zip");
    toast.success("Starter kit scaricato");
    void logEvent("local_agent_starter_kit_downloaded", "Starter kit ZIP scaricato");
  }

  return (
    <Card className="mt-4 border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4 text-violet-400" />
            Playwright Local Agent Starter Kit
          </CardTitle>
          <div className="flex gap-2 flex-wrap">
            <Badge variant="outline" className="bg-sky-500/10 text-sky-300 border-sky-500/30">
              Modalita' consigliata: Chrome reale + CDP
            </Badge>
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 gap-1">
              <ShieldCheck className="h-3 w-3" /> Nessuna credenziale salvata
            </Badge>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Apri Google Chrome reale con remote debugging, fai login a Lovable a mano, poi l'agente si
          collega via CDP e incolla il prompt. Niente login automatici, niente Chromium bundled.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={downloadZip}>
            <Download className="mr-1 h-3 w-3" /> Scarica starter kit agente
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              copyText(CHROME_LAUNCH_CMD, "Comando Chrome remote debugging", "local_agent_starter_kit_copied")
            }
          >
            <Terminal className="mr-1 h-3 w-3" /> Copia comando Chrome CDP
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              copyText(TERMINAL_INSTRUCTIONS_AGENT, "Comando agente --connect-cdp", "local_agent_starter_kit_copied")
            }
          >
            <Terminal className="mr-1 h-3 w-3" /> Copia comando agente
          </Button>
        </div>

        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 flex gap-2 items-start">
          <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-200 leading-relaxed">
            Non usare <code className="px-1 rounded bg-amber-500/20">--send</code> finche' non hai verificato il flusso
            almeno una volta a mano. Di default l'agente incolla soltanto.
          </div>
        </div>

        <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-3">
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">1. Installazione</div>
            <pre className="text-xs whitespace-pre-wrap leading-relaxed font-mono">{TERMINAL_INSTRUCTIONS_INSTALL}</pre>
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              2. Avvia Chrome reale con remote debugging
            </div>
            <pre className="text-xs whitespace-pre-wrap leading-relaxed font-mono">{CHROME_LAUNCH_CMD}</pre>
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              3. Login manuale a Lovable nella finestra Chrome aperta
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">4. Avvia agente (senza invio)</div>
            <pre className="text-xs whitespace-pre-wrap leading-relaxed font-mono">{TERMINAL_INSTRUCTIONS_AGENT}</pre>
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">5. (Opzionale) invio automatico</div>
            <pre className="text-xs whitespace-pre-wrap leading-relaxed font-mono">{TERMINAL_INSTRUCTIONS_AGENT_SEND}</pre>
          </div>
        </div>

        <div className="space-y-2">
          {FILES.map((f) => {
            const open = openFile === f.name;
            return (
              <div key={f.name} className="rounded-md border border-border/60">
                <div className="flex items-center justify-between gap-2 p-2 flex-wrap">
                  <button
                    type="button"
                    className="text-sm font-mono text-left flex-1 min-w-0 truncate hover:underline"
                    onClick={() => setOpenFile(open ? null : f.name)}
                  >
                    {f.name}
                  </button>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyText(f.content, f.name, "local_agent_starter_kit_copied")}
                    >
                      <Copy className="mr-1 h-3 w-3" /> Copia
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => downloadFile(f)}>
                      <Download className="mr-1 h-3 w-3" /> Scarica
                    </Button>
                  </div>
                </div>
                {open && (
                  <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap border-t border-border/60 bg-background/40 p-3 max-h-80 overflow-auto">
                    {f.content}
                  </pre>
                )}
              </div>
            );
          })}
        </div>

        <div className="text-[11px] text-muted-foreground leading-relaxed">
          Promemoria sicurezza: lo script non salva password Lovable, non salva token, non gestisce
          login automatico, non usa API private Lovable, non invia il prompt senza il flag esplicito
          <code className="mx-1 px-1 rounded bg-muted">--send</code>, e si blocca se il progetto
          aperto in Chrome non corrisponde all'URL del job.
        </div>
      </CardContent>
    </Card>
  );
}
