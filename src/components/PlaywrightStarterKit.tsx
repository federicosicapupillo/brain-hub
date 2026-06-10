import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Download, Package, ShieldCheck, Terminal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buildZip, downloadBlob } from "@/lib/export-utils";
import type { LogEventType } from "@/lib/automation-run";

const PACKAGE_JSON = `{
  "name": "brainhub-lovable-agent",
  "version": "0.1.0",
  "description": "Local Playwright agent that opens Lovable and pastes a prompt from a Brain Hub agent-job.json. No credentials are stored. Manual supervision required.",
  "type": "module",
  "private": true,
  "scripts": {
    "start": "node brainhub-lovable-agent.js --job ./agent-job.json"
  },
  "dependencies": {
    "playwright": "^1.47.0"
  }
}
`;

const ENV_EXAMPLE = `# Optional configuration for the local agent.
# Nothing here is required. NEVER put Lovable passwords or tokens.

# Path to the persistent browser profile (default: ./browser-profile)
AGENT_PROFILE_DIR=./browser-profile

# Milliseconds to wait for Lovable UI before giving up (default: 45000)
AGENT_WAIT_MS=45000
`;

const AGENT_JS = `#!/usr/bin/env node
/**
 * brainhub-lovable-agent.js
 *
 * Local Playwright agent for Brain Hub Execution Packages.
 *
 * Usage:
 *   node brainhub-lovable-agent.js --job ./agent-job.json
 *   node brainhub-lovable-agent.js --job ./agent-job.json --send
 *
 * What it does:
 *   1. Reads a Brain Hub agent-job.json
 *   2. Validates required fields
 *   3. Opens Google Chrome (NON headless) with a persistent profile
 *   4. Navigates to the Lovable project URL
 *   5. Tries to locate the chat input and pastes the prompt
 *   6. Waits for the human to press ENTER manually (default)
 *      OR submits the prompt only if --send is passed
 *
 * What it does NOT do:
 *   - Store Lovable passwords or tokens
 *   - Handle automatic login
 *   - Use any private Lovable API
 *   - Bypass any security
 *   - Run multiple jobs in parallel
 *   - Send the prompt without the explicit --send flag
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
const sendMode = args.includes("--send");

if (!jobPath) {
  console.error("Missing --job <path-to-agent-job.json>");
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

const required = [
  "job_id",
  "execution_package_id",
  "run_id",
  "lovable_project_url",
  "prompt",
];
const missing = required.filter((k) => !job[k] || String(job[k]).trim() === "");
if (missing.length > 0) {
  console.error("Job file is missing required fields:", missing.join(", "));
  process.exit(1);
}

const profileDir = process.env.AGENT_PROFILE_DIR || "./browser-profile";
const waitMs = Number(process.env.AGENT_WAIT_MS || 45000);
const absProfileDir = path.resolve(process.cwd(), profileDir);

console.log("=== Brain Hub Lovable Agent ===");
console.log("Job ID:               ", job.job_id);
console.log("Execution Package ID: ", job.execution_package_id);
console.log("Run ID:               ", job.run_id);
console.log("Lovable Project URL:  ", job.lovable_project_url);
console.log("Profile directory:    ", absProfileDir);
console.log("Send mode:            ", sendMode ? "AUTO SEND (--send)" : "MANUAL (default)");
console.log();

(async () => {
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
      console.error("Google Chrome non trovato. Installa Chrome oppure modifica lo script per usare Chromium.");
    } else {
      console.error("Failed to launch browser:", msg);
    }
    process.exit(1);
  }

  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(job.lovable_project_url, { waitUntil: "domcontentloaded", timeout: waitMs });
  } catch (e) {
    console.error("Failed to open Lovable project URL:", e.message);
    console.error("If you are not logged in, log in manually in this browser window,");
    console.error("then close it and run the agent again.");
    return;
  }

  // Give Lovable time to load the editor and chat UI
  await page.waitForTimeout(4000);

  // Try a few selectors to locate the chat input. These are best-effort.
  const candidateSelectors = [
    'textarea[placeholder*="Ask Lovable" i]',
    'textarea[placeholder*="message" i]',
    'textarea[placeholder*="prompt" i]',
    'div[contenteditable="true"][role="textbox"]',
    'textarea',
  ];

  let input = null;
  for (const sel of candidateSelectors) {
    const el = await page.$(sel);
    if (el) {
      input = el;
      console.log("Chat input located with selector:", sel);
      break;
    }
  }

  if (!input) {
    console.error("Could not locate the Lovable chat input.");
    console.error("The browser will stay open so you can paste manually.");
    console.error("Prompt copied below for reference:");
    console.error("---");
    console.error(job.prompt);
    console.error("---");
    return;
  }

  try {
    await input.click();
    await input.fill("");
    await input.type(job.prompt, { delay: 0 });
  } catch (e) {
    console.error("Failed to type prompt into chat input:", e.message);
    return;
  }

  if (!sendMode) {
    console.log();
    console.log("Prompt incollato. Controlla Lovable e premi INVIO manualmente.");
    console.log("Il browser resta aperto per la tua supervisione.");
    return;
  }

  // --send mode: try Enter, fall back to a Submit button if present
  try {
    await input.press("Enter");
    console.log("Prompt inviato con --send (Enter).");
  } catch {
    const submit = await page.$('button[type="submit"], button[aria-label*="send" i]');
    if (submit) {
      await submit.click();
      console.log("Prompt inviato con --send (click submit).");
    } else {
      console.error("Impossibile inviare: nessun bottone submit trovato.");
    }
  }
})().catch((e) => {
  console.error("Agent failed:", e.message);
  process.exit(1);
});
`;

const README_MD = `# Brain Hub Lovable Local Agent

Agente Playwright locale che apre Lovable nel tuo Mac, incolla il prompt
dell'Execution Package preparato dal Brain Hub e ti lascia premere INVIO
manualmente. Pensato per uso personale e supervisionato.

## Prerequisito

Devi avere **Google Chrome** installato sul tuo Mac. Lo script usa
\`channel: "chrome"\` in modo che Playwright apra la tua installazione
locale di Chrome, evitando il messaggio di sicurezza di Google sui
browser non verificati.

## Cosa NON fa
- non salva password Lovable
- non salva token
- non gestisce login automatico
- non usa API private di Lovable
- non bypassa nessuna sicurezza
- non gira piu' job in parallelo
- non invia il prompt senza il flag esplicito \`--send\`

## Installazione (Mac)

\`\`\`bash
mkdir brainhub-lovable-agent
cd brainhub-lovable-agent
npm init -y
npm install playwright
\`\`\`

Non serve \`npx playwright install chromium\`: lo script usa direttamente
il tuo Google Chrome installato.

Poi copia in questa cartella i file dello starter kit:
- \`package.json\`
- \`brainhub-lovable-agent.js\`
- \`.env.example\` (rinomina in \`.env\` se vuoi configurare)
- \`README_AGENT.md\`

## Primo avvio e login manuale

1. Lancia l'agente una prima volta con un job valido (o anche un job
   fittizio) per aprire Chrome:

   \`\`\`bash
   node brainhub-lovable-agent.js --job ./agent-job.json
   \`\`\`

2. Nella finestra di Chrome che si apre, fai login a Lovable a mano una
   sola volta.
3. Chiudi tutto.

Da ora in poi il profilo \`./browser-profile\` conserva la tua sessione
Lovable. Il primo login deve essere fatto nella finestra aperta
dall'agente perché il profilo persistente sia quello corretto.

## Se Google blocca ancora il login

A volte Google mostra comunque un avviso. In questo caso:

1. Apri **Google Chrome normalmente** dal tuo Mac (non quello dell'agente).
2. Verifica che l'account Google sia attivo e senza blocchi di sicurezza.
3. Chiudi Chrome normale e riprova a lanciare l'agente.

## Uso senza invio automatico (default)

\`\`\`bash
node brainhub-lovable-agent.js --job ./agent-job.json
\`\`\`

L'agente apre Lovable, incolla il prompt e mostra:

\`Prompt incollato. Controlla Lovable e premi INVIO manualmente.\`

Tu controlli che tutto sia corretto e premi INVIO tu.

## Uso con invio automatico

\`\`\`bash
node brainhub-lovable-agent.js --job ./agent-job.json --send
\`\`\`

Solo con il flag \`--send\` l'agente prova a premere Enter o a cliccare il
bottone submit. Usalo solo quando ti fidi del contenuto del prompt.

## Dove mettere agent-job.json

Scaricalo dal Brain Hub (sezione Local Agent Bridge → "Scarica job JSON")
e mettilo nella cartella dell'agente come \`agent-job.json\`. Poi lancia il
comando sopra.

## Sicurezza
- Nessuna credenziale viene salvata dallo script.
- La sessione Lovable vive solo nel profilo \`./browser-profile\`
  sul tuo Mac. Non viene mai inviata da nessuna parte.
- Lo script NON invia nulla senza \`--send\`.
- Tieni il browser aperto durante l'esecuzione: sei tu il supervisore.
`;

const TERMINAL_INSTRUCTIONS = `mkdir brainhub-lovable-agent
cd brainhub-lovable-agent
npm init -y
npm install playwright
npx playwright install chromium
node brainhub-lovable-agent.js --job ./agent-job.json
`;

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
    downloadBlob(
      new Blob([file.content], { type: "text/plain;charset=utf-8" }),
      file.name,
    );
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
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 gap-1">
            <ShieldCheck className="h-3 w-3" /> Nessuna credenziale salvata
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          File base per eseguire localmente sul tuo Mac un job Playwright generato dal Brain Hub.
          Tutta l'esecuzione avviene sul tuo computer, sotto la tua supervisione.
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
              copyText(
                TERMINAL_INSTRUCTIONS,
                "Istruzioni terminale",
                "local_agent_starter_kit_copied",
              )
            }
          >
            <Terminal className="mr-1 h-3 w-3" /> Copia istruzioni terminale
          </Button>
        </div>

        <div className="rounded-md border border-border/60 bg-muted/30 p-3">
          <div className="text-xs font-medium text-muted-foreground mb-2">Istruzioni terminale</div>
          <pre className="text-xs whitespace-pre-wrap leading-relaxed font-mono">{TERMINAL_INSTRUCTIONS}</pre>
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
                      onClick={() =>
                        copyText(f.content, f.name, "local_agent_starter_kit_copied")
                      }
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
          <code className="mx-1 px-1 rounded bg-muted">--send</code>. Nessuna automazione browser
          viene eseguita dal Brain Hub.
        </div>
      </CardContent>
    </Card>
  );
}
