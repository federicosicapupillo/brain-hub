# IdeaPilot IA

> Piattaforma che aiuta una persona a trasformare un'idea in una prima web app pronta da testare, presentare o vendere.

---

## Cos'è IdeaPilot IA

IdeaPilot IA è una piattaforma SaaS che guida un utente dal concepimento di un'idea alla realizzazione di una prima web app funzionante, pronta per essere testata con utenti reali, presentata a investitori o messa in vendita.

Il prodotto si colloca all'intersezione tra **AI-assisted development**, **no-code/low-code rapid prototyping** e **go-to-market accelerazione**.

## A cosa serve

- **Trasformare idee vaghe in prototipi concreti** in tempi ridotti rispetto allo sviluppo tradizionale.
- **Abbassare la barriera d'ingresso** per founders, creator e professionisti che hanno un'idea digitale ma non hanno competenze tecniche avanzate.
- **Fornire un percorso strutturato** dall'idea alla prima versione vendibile, con supporto AI in ogni fase.
- **Accelerare il time-to-market** di MVP (Minimum Viable Product) per testare la domanda reale.

## Target

| Segmento | Descrizione |
|----------|-------------|
| **Aspiring founders** | Persone con un'idea di startup ma senza team tecnico |
| **Creator economy** | Creator che vogliono monetizzare il proprio pubblico con tool digitali |
| **Professionisti indipendenti** | Consulenti, coach, esperti che vogliono digitalizzare il proprio metodo |
| **Micro-SaaS builders** | Sviluppatori solitari che vogliono lanciare rapidamente micro-prodotti |

## Funzioni principali

1. **Analisi idea / brief AI**: strutturazione dell'idea in brief tecnico e di prodotto tramite assistenza AI.
2. **Prototipazione guidata**: creazione della prima web app con strumenti no-code/AI-code (es. Lovable) orchestrati dalla piattaforma.
3. **Stack consigliato**: suggerimento automatico dello stack tecnologico in base al tipo di idea.
4. **Onboarding interattivo**: percorso di avvio che porta l'utente dalla registrazione al primo prototipo.
5. **Test & feedback loop**: strumenti per raccogliere feedback da beta-tester.
6. **Marketing pack**: generazione di asset di marketing (copy, immagini, video) per il lancio.
7. **Pricing & monetizzazione**: supporto alla definizione del modello di pricing e integrazione con gateway di pagamento.

## Stack tecnico

| Layer | Tecnologia / Strumento |
|-------|------------------------|
| **Frontend / App Builder** | Lovable (AI-assisted web app builder) — da verificare se integrato nativamente o usato come strumento esterno |
| **Backend & Database** | Supabase (PostgreSQL, Auth, Storage, Realtime) |
| **AI / LLM** | ChatGPT, Claude (OpenAI / Anthropic API) — da verificare quali modelli sono integrati direttamente |
| **Ricerca / Intelligence** | Perplexity API — da verificare |
| **Media / Generative AI** | Runway (video), ElevenLabs (voice), Midjourney / D-ID (immagini/avatar) — da verificare quali sono integrati |
| **Pagamenti** | Stripe |
| **Video / Social** | Klippify — da verificare il ruolo esatto |
| **Project Management** | Brain Hub (dashboard centrale interna per tracciare sviluppo, prompt, task, roadmap) |

## Stato attuale del progetto

- **Fase**: In sviluppo / test marketing
- **Priorità**: Alta (nel portfolio iBrain)
- **Prossima azione critica**: Definire onboarding e prima landing per test marketing
- **Repository / codice sorgente**: Il codice applicativo risiede all'interno del monorepo iBrain (Brain Hub), che funge da sistema centrale di knowledge management per tutti i progetti.

## Come avviare il progetto (sviluppo)

Il progetto IdeaPilot IA non ha un repository separato al momento. Lo sviluppo avviene all'interno dell'ecosistema **iBrain / Brain Hub**.

Per avviare l'ambiente di sviluppo locale del sistema centrale:

```bash
# 1. Clona il repository (se non già presente)
#    Il repository contiene Brain Hub + tutti i progetti gestiti

# 2. Installa le dipendenze
bun install

# 3. Configura le variabili d'ambiente
#    Copia .env e inserisci le chiavi necessarie:
#    - VITE_SUPABASE_URL
#    - VITE_SUPABASE_PUBLISHABLE_KEY
#    - Altre chiavi per servizi AI (da verificare quali sono attualmente richieste)

# 4. Avvia il server di sviluppo
bun run dev

# 5. Accedi via browser (di default http://localhost:5173)
#    e autenticati per accedere alla dashboard.
```

**Nota**: IdeaPilot IA è attualmente tracciato come progetto all'interno di Brain Hub. Per accedere alla documentazione, task, roadmap e asset collegati, naviga nella sezione **Progetti → IdeaPilot IA** dall'interno della dashboard.

## Note operative

- **Separazione codice**: Il codice del "motore" di IdeaPilot IA (onboarding, brief AI, generazione app) non è ancora estratto in un servizio dedicato. Fa parte del codebase condiviso di Brain Hub oppure è orchestrato tramite strumenti esterni (Lovable, Claude, ecc.). *Da verificare l'architettura target.*
- **Dipendenze**: Il progetto dipende fortemente dall'integrazione con API di terze parti (OpenAI, Stripe, Supabase). Assicurarsi che le chiavi siano configurate correttamente prima di testare i flussi di pagamento o AI.
- **Ambiente di staging**: Da verificare se esiste un ambiente di staging separato per i test marketing.
- **Analytics**: Da verificare quali strumenti di analytics sono collegati per i test di conversione della landing.
- **Conformità**: prima di raccogliere pagamenti, verificare conformità GDPR, terms of service e privacy policy.

---

*Ultimo aggiornamento: 2026-06-08*
