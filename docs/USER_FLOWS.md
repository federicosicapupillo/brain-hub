# User Flows — IdeaPilot IA

## Flusso utente pubblico

Questo è il percorso di un visitatore che arriva su IdeaPilot IA senza essere ancora registrato.

```
[Canale di acquisizione]
        ↓
[ Landing page ]
  ├─ Headline: "Dall'idea alla tua prima web app in giorni, non mesi"
  ├─ Video demo / GIF (da verificare se già prodotto)
  ├─ Social proof (da verificare: testimonianze, numero utenti, loghi)
  ├─ Chiaretta del valore: 3 step (Idea → Brief → App)
  └─ CTA primario: "Inizia gratis" / "Metti in lista d'attesa"
        ↓
[ Form pre-registrazione / waitlist ]
  ├─ Email
  ├─ Tipo di idea (dropdown: SaaS, Marketplace, Tool, Community, Altro)
  ├─ Hai già un'idea specifica? (sì/no + campo testo opzionale)
  └─ CTA: "Riservami un posto"
        ↓
[ Conferma ]
  ├─ Messaggio di ringraziamento
  ├─ Stima posizione in coda (da verificare)
  ├─ Invito a segire su social / newsletter
  └─ Link a risorse gratuite (da verificare se esistono)
```

**KPI da tracciare:**
- Tasso di conversione visitatore → email (target: da verificare)
- Tasso di completamento form (target: da verificare)
- Fonte di traffico più performante
- Costo per lead (CPL)

---

## Flusso creazione idea / app

Questo è il percorso core del prodotto: da un'idea grezza a un prodotto concreto.

### Fase 1 — Idea Capture

```
[ Utente autenticato accede a IdeaPilot IA ]
        ↓
[ Dashboard di progetto ]
  ├─ Progetti attivi
  ├─ "Nuova idea" → avvia wizard
        ↓
[ Wizard — Step 1: Descrivi la tua idea ]
  ├─ Campo testo libero: "Descrivi la tua idea in 2-3 frasi"
  ├─ Esempi di input (placeholder dinamico)
  └─ Bottone: "Analizza idea"
        ↓
[ Wizard — Step 2: Validazione rapida ]
  ├─ L'AI fa 3-5 domande di chiarimento
  ├─ Esempio: "Chi è il tuo utente target?", "Esiste già qualcosa di simile?"
  └─ Utente risponde (campi brevi)
        ↓
[ Wizard — Step 3: Brief generato ]
  ├─ Titolo prodotto proposto
  ├─ Descrizione one-liner
  ├─ Problema che risolve
  ├─ Soluzione chiave
  ├─ Utente target primario
  ├─ Metriche di successo suggerite
  └─ Utente può: Modificare / Approvare / Rigenerare
```

### Fase 2 — Scelta dello Stack

```
[ Dopo approvazione brief ]
        ↓
[ Wizard — Step 4: Stack consigliato ]
  ├─ Piattaforma di build: Lovable (default) — modificabile
  ├─ Backend: Supabase (default) — modificabile
  ├─ Auth: Supabase Auth (default)
  ├─ Pagamenti: Stripe (se previsti)
  ├─ AI / LLM: OpenAI / Claude (se previsti)
  ├─ Hosting: da verificare
  └─ Utente può: Accettare stack / Modificare / Vedere comparazione
        ↓
[ Wizard — Step 5: Template (opzionale) ]
  ├─ Lista template filtrabili per categoria
  ├─ Preview screenshot / descrizione
  └─ Scelta: Partire da template / Da zero
```

### Fase 3 — Generazione / Orchestrazione

```
[ Dopo conferma stack e template ]
        ↓
[ Stato: "Stiamo costruendo la tua app…" ]
  ├─ Progress indicator (da verificare la durata reale)
  ├─ Link a documentazione / guida nel frattempo
        ↓
[ Output: Prototipo pronto ]
  ├─ URL dell'app (su dominio temporaneo o custom)
  ├─ Link al progetto su Lovable (se orchestrato via Lovable)
  ├─ Credenziali di accesso demo (se previste)
  ├─ Brief salvato in Brain Hub
  └─ Task automatici generati in roadmap
        ↓
[ Azioni post-generazione ]
  ├─ "Personalizza" → link all'editor (Lovable o interno)
  ├─ "Condividi per feedback" → link pubblico / invita tester
  ├─ "Prepara il lancio" → marketing pack
  └─ "Collega dominio" → (funzione futura)
```

**Nota importante**: La generazione effettiva dell'app dipende dall'integrazione con strumenti esterni (principalmente Lovable). Se l'integrazione programmatica non è disponibile, il flusso attuale potrebbe prevedere:
- Esportazione del brief in formato compatibile
- Link diretto a Lovable con parametri pre-compilati
- Guida manuale step-by-step per replicare il brief su Lovable

*Da verificare quale dei due approcci è implementato o previsto.*

---

## Flusso analisi idea

Questo flusso riguarda la fase di validazione e analisi prima di procedere alla generazione.

```
[ Input: idea grezza dell'utente ]
        ↓
[ Analisi AI — Livello 1: Comprensione ]
  ├─ Estrazione entità (prodotto, utente, problema, mercato)
  ├─ Identificazione ambiguità → genera domande di chiarimento
  └─ Flag: idea troppo vaga / troppo ampia / già esistente?
        ↓
[ Analisi AI — Livello 2: Valutazione ]
  ├─ Similarità con prodotti esistenti (da verificare: Perplexity / web search?)
  ├─ Stima dimensione mercato (TAM/SAM/SOM) — da verificare se implementato
  ├─ Complessità tecnica stimata (bassa / media / alta)
  ├─ Tempo stimato per MVP
  └─ Rischi principali identificati
        ↓
[ Analisi AI — Livello 3: Structuring ]
  ├─ Trasformazione in brief standardizzato
  ├─ User story principali identificate
  ├─ Feature must-have vs nice-to-have
  └─ Milestone suggerite (MVP → V1 → Scaling)
        ↓
[ Output: Brief strutturato + Analisi di fattibilità ]
  ├─ Salvato in Brain Hub come "Appunto strategico"
  ├─ Collegato al progetto IdeaPilot IA
  └─ Accessibile per future revisioni
```

**KPI da tracciare:**
- Tempo medio per completare il wizard
- Tasso di completamento per step
- Percentuale di brief approvati vs rigenerati
- Qualità percepita del brief (feedback utente)

---

## Flusso eventuale pagamento / sblocco

Questo flusso è ancora da definire in dettaglio. Di seguito una proposta basata sullo stack tecnologico dichiarato.

### Modello di pricing ipotizzato (da verificare)

| Piano | Prezzo (indicativo) | Inclusioni |
|-------|---------------------|------------|
| **Free / Explorer** | Gratis | 1 idea, brief base, nessuna generazione app |
| **Builder** | €29/mese | 3 idee/mese, brief avanzato, generazione app, marketing pack |
| **Pro** | €79/mese | Illimitato, priorità coda, custom domain, supporto |
| **Agency** | €199/mese | Multi-cliente, white-label, API access | 

*I prezzi sono puramente indicativi e devono essere validati con test di mercato.*

### Flusso pagamento

```
[ Utente raggiunge limite piano gratuito o clicca "Upgrade" ]
        ↓
[ Pagina pricing ]
  ├─ Confronto piani (feature table)
  ├─ Toggle mensile / annuale (sconto 20%? da verificare)
  └─ CTA per piano scelto
        ↓
[ Checkout Stripe ]
  ├─ Form dati carta (Stripe Elements)
  ├─ Dati fatturazione (se richiesto)
  └─ Conferma pagamento
        ↓
[ Conferma upgrade ]
  ├─ Messaggio di benvenuto al nuovo piano
  ├─ Sblocco feature premium
  ├─ Invoice via email
  └─ Redirect alla dashboard
```

**KPI da tracciare:**
- Tasso di conversione free → paid (target: da verificare)
- ARPU (Average Revenue Per User)
- Churn rate mensile
- Piano più popolare

---

## Flusso dashboard utente

La dashboard utente è il centro operativo dopo l'onboarding iniziale.

```
[ Dashboard principale ]
  ├─ Progetti / Idee attive
  │   └─ Card per ogni idea con: titolo, stato, progresso, ultima modifica
  ├─ Bottone "Nuova idea" (avvia wizard)
  ├─ Roadmap personale
  │   └─ Kanban con item generati automaticamente + personali
  ├─ Task aperti
  │   └─ Lista task con scadenza e priorità
  ├─ Attività recenti
  │   └─ Log delle ultime azioni (brief creato, app generata, ecc.)
  └─ Quick links
      ├─ Vai a Brain Hub (sistema centrale)
      ├─ Esporta dati
      └─ Impostazioni
```

**Per ogni progetto / idea:**

```
[ Dettaglio progetto ]
  ├─ Tab "Brief" — brief generato, modificabile
  ├─ Tab "App" — link all'app / preview / editor
  ├─ Tab "Roadmap" — milestone e task collegati
  ├─ Tab "Prompt" — prompt storici usati per generare l'app
  ├─ Tab "File" — documenti, asset, upload collegati
  ├─ Tab "Collegamenti" — link esterni, repo GitHub, risorse
  └─ Tab "Marketing" — copy, immagini, video generati
```

**Nota**: L'esperienza dashboard descritta sopra è un target. Attualmente, l'utente gestisce i progetti tramite **Brain Hub** (iBrain), che fornisce già molte di queste funzionalità in forma generica. Il flusso target prevede un'interfaccia dedicata e semplificata per IdeaPilot IA.

---

## Flusso di supporto / guida

```
[ Utente ha un dubbio o un problema ]
        ↓
[ Sezione Guida (esistente in Brain Hub) ]
  ├─ Documentazione per funzione
  ├─ FAQ
  └─ Link a risorse esterne
        ↓
[ Se non trova risposta ]
  ├─ Form di contatto / supporto (da verificare se esiste)
  └─ Comunità / Discord / Slack (da verificare se esiste)
```

---

*I flussi descritti sono basati sul concept di IdeaPilot IA. Alcuni dettagli sono marcati come "da verificare" perché dipendono da decisioni di prodotto e implementazione ancora in corso.*

*Ultimo aggiornamento: 2026-06-08*
