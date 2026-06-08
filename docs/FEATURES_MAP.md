# Features Map — IdeaPilot IA

## Funzioni presenti

Di seguito le funzionalità già operative o parzialmente implementate all'interno dell'ecosistema iBrain che supportano lo sviluppo di IdeaPilot IA.

### Gestione progetto & knowledge (via Brain Hub)

| Feature | Stato | Note |
|---------|-------|------|
| **Dashboard progetti** | ✅ Presente | Sezione "Progetti" in iBrain con card per IdeaPilot IA |
| **Task & todo list** | ✅ Presente | Tabella task con priorità e stati (todo / doing / review / done) |
| **Roadmap kanban** | ✅ Presente | Board 5 colonne: Idee → Da fare → In corso → Da validare → Completato |
| **Archivio contenuti** | ✅ Presente | Ricerca full-text, filtri per tipo, progetto, strumento, stato |
| **Import manuale** | ✅ Presente | Incolla prompt, note, link, task e collegali al progetto corretto |
| **Import massivo prompt** | ✅ Presente | Carica .zip o multipli .md/.txt di prompt storici |
| **Grafo conoscenza (2D/3D)** | ✅ Presente | Visualizzazione nodi e connessioni tra idee |
| **Esportazione** | ✅ Presente | Esporta in Markdown singolo, ZIP, CSV, JSON |
| **Fonti & file upload** | ✅ Presente | Upload con chunking automatico per semantic search |
| **Agenti AI** | ✅ Presente | Gestione agenti con status attivo/idle |
| **Log operativi** | ✅ Presente | Tracciamento azioni con timestamp e contesto |

### Strumenti di connessione (via Brain Hub)

| Feature | Stato | Note |
|---------|-------|------|
| **Mappa strumenti progetto** | ✅ Presente | Per ogni progetto, elenca tool usati e modalità (manuale / GitHub / API / da collegare) |
| **GitHub Sync manuale** | ✅ Presente | Collega repo GitHub e importa README / changelog manualmente |
| **Collegamenti progetto** | ✅ Presente | Collega contenuti tra progetti diversi |
| **Allineamento progetti** | ✅ Presente | Scansione incoerenze e suggerimenti di riorganizzazione |

### Infrastruttura

| Feature | Stato | Note |
|---------|-------|------|
| **Auth (email + Google OAuth)** | ✅ Presente | Login via Supabase Auth |
| **RLS (Row Level Security)** | ✅ Presente | Ogni utente vede solo i propri dati |
| **Storage privato** | ✅ Presente | Bucket `brain-uploads` con limiti di sicurezza (25 MB, whitelist MIME) |
| **Semantic search** | ✅ Presente | Ricerca semantica sui chunk di testo tramite pgvector |
| **Esportazione Obsidian** | ✅ Presente | Export in formato vault Obsidian |

## Funzioni da completare

Queste sono le funzionalità specifiche di IdeaPilot IA che mancano o sono incomplete.

| Feature | Priorità | Complessità | Dipendenze | Note |
|---------|----------|-------------|------------|------|
| **Landing page pubblica** | CRITICA | Media | Copy, design | Prossima azione. Serve per test marketing. |
| **Form pre-registrazione / waitlist** | CRITICA | Bassa | Landing page | Da verificare se già esiste in qualche forma |
| **Onboarding guidato (wizard)** | Alta | Media | Motore brief AI | Flusso step-by-step: idea → validazione → brief |
| **Motore brief AI** | Alta | Alta | API LLM | Trasforma descrizione naturale in brief tecnico strutturato |
| **Suggeritore stack tecnologico** | Alta | Media | Database template | In base alla tipologia di idea, suggerisce stack (Lovable + Supabase + Stripe vs altro) |
| **Catalogo template** | Media | Media | — | Raccolta di template pre-costruiti per categorie di app |
| **Generazione / orchestrazione app** | Media | Alta | Lovable API | Da verificare se Lovable espone API per creare progetti programmaticamente |
| **Marketing pack generator** | Media | Media | API Runway, ElevenLabs | Generazione copy, immagini, video demo automatici dal brief |
| **Pricing wizard** | Media | Bassa | Stripe | Wizard che guida alla scelta del modello di pricing |
| **Integrazione pagamenti** | Media | Media | Stripe | Collegamento account Stripe e configurazione piani |
| **Beta feedback loop** | Media | Bassa | — | Raccolta feedback da beta-tester |
| **Analytics dashboard** | Media | Bassa | Tool analytics | Tracciamento conversioni, utenti attivi, drop-off |

## Funzioni future

| Feature | Descrizione | Stima tempi |
|---------|-------------|-------------|
| **Marketplace componenti** | Catalogo di componenti / integrazioni riutilizzabili tra progetti | 6-12 mesi |
| **AI-assisted iteration** | L'utente descrive una modifica e l'AI propone il cambiamento nell'app | 6-12 mesi |
| **Multi-utente / team** | Collaborazione in team sullo stesso progetto | 6-12 mesi |
| **Deploy automatico** | Deploy su CDN / hosting direttamente dalla piattaforma | 6-12 mesi |
| **Custom domain** | Associazione dominio personalizzato alle app generate | 6-12 mesi |
| **A/B testing integrato** | Test di varianti di landing / onboarding | 12+ mesi |
| **Affiliate / referral program** | Programma di referral per utenti che portano nuovi clienti | 12+ mesi |
| **White-label** | Possibilità di vendere la piattaforma con branding personalizzato | 12+ mesi |
| **Mobile app generation** | Generazione di app native / PWA oltre a web app | 12+ mesi |
| **Integrazione e-commerce** | Moduli pre-built per e-commerce (Stripe Checkout, catalogo, ordini) | 9-12 mesi |

## Priorità riassuntiva

### Roadmap sprint (prossime 4-8 settimane)

```
Settimana 1-2:  Landing page + Form pre-registrazione
Settimana 3-4:  Onboarding wizard (solo fase 1: idea → brief)
Settimana 5-6:  Motore brief AI (MVP con GPT-4 / Claude)
Settimana 7-8:  Test con 5 utenti reali + raccolta feedback
```

### Milestone

| Milestone | Criterio di successo | Target date |
|-----------|----------------------|-------------|
| **M0 — Concept locked** | Documentazione completa e stack definito | ✅ Raggiunto |
| **M1 — Landing live** | Landing page online con form funzionante | Da definire |
| **M2 — First brief** | Primo utente esterno che completa il wizard e ottiene un brief | Da definire |
| **M3 — First prototype** | Primo prototipo funzionante generato dal brief | Da definire |
| **M4 — Beta launch** | 50 utenti nella beta, almeno 10 hanno generato un prototipo | Da definire |
| **M5 — First revenue** | Primo pagamento ricevuto | Da definire |
| **M6 — Product-market fit** | 100 utenti attivi, NPS > 40 | Da definire |

---

*Feature map soggetta a revisione in base ai risultati dei test di marketing.*
