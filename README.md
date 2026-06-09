# Sica Industrial Radar

> Sistema per ricercare, filtrare e analizzare capannoni industriali, logistici, artigianali, commerciali e navali.

---

## Cos'è Sica Industrial Radar

Sica Industrial Radar è un sistema digitale pensato per supportare l'attività di **Sica Immobiliare** nella ricerca, analisi e gestione di opportunità immobiliari industriali.

Il prodotto si colloca nel settore **Real Estate Industriale**, con focus su capannoni, magazzini logistici, strutture artigianali e commerciali. L'obiettivo è fornire un "radar" intelligente che raccolga, filtri e valuti candidati immobiliari in base a parametri tecnici e commerciali rilevanti.

## A cosa serve

- **Ricerca strutturata di capannoni** con filtri su metri quadri, altezza, piazzale, carroponte, portoni e posizione geografica.
- **Analisi comparativa delle opportunità** per supportare decisioni di acquisizione o vendita.
- **Gestione lead qualificati** provenienti da fonti multiple (annunci, contatti diretti, ricerca proattiva).
- **Tracciamento stato avanzamento** di ogni candidato: da segnalato → in analisi → qualificato → scartato o convertito.
- **Supporto decisionale** per l'agenzia immobiliare nel posizionamento come "specialista dei capannoni".

## Target

| Segmento | Descrizione |
|----------|-------------|
| **Agenzia immobiliare (Sica Immobiliare)** | Operatore principale che usa il sistema per gestire il proprio portafoglio industriale |
| **Proprietari di capannoni** | Persone o aziende che vogliono vendere o affittare strutture industriali |
| **Investitori industriali** | Acquirenti che cercano strutture per attività produttive, logistica o artigianato |
| **Intermediari e broker** | Figure che collaborano con Sica Immobiliare e necessitano di condivisione dati strutturata |

## Funzioni principali

1. **Ricerca capannoni**: motore di ricerca con filtri avanzati (mq, altezza, piazzale, carroponte, portoni, località).
2. **Schede candidato**: scheda tecnica e commerciale per ogni immobile individuato.
3. **Analisi opportunità**: confronto tra candidati e stima rapida del valore tramite comparables di zona.
4. **Salvataggio e scarto**: gestione stato di ogni risultato (salvato, scartato, da rivedere, ripristinabile).
5. **Gestione lead**: tracciamento contatti, note operative e cronologia interazioni.
6. **Export e condivisione**: esportazione dati in formato utilizzabile per report o condivisione con clienti.
7. **Mappa interattiva**: visualizzazione geografica dei candidati su mappa (Google Earth / Mappe).

## Stack tecnico

| Layer | Tecnologia / Strumento |
|-------|------------------------|
| **Frontend / App Builder** | Lovable (AI-assisted web app builder) — da verificare se sarà il builder principale o usato come strumento esterno |
| **Backend & Database** | Supabase (PostgreSQL, Auth, Storage, Realtime) |
| **AI / Intelligence** | ChatGPT, Perplexity — da verificare quali sono integrati direttamente vs usati come strumenti esterni |
| **Mappe / Geolocalizzazione** | Google Earth, Mappe — da verificare quale API è attiva |
| **Project Management** | Brain Hub (dashboard centrale interna per tracciare sviluppo, prompt, task, roadmap) |
| **Comunicazione** | Sica Immobiliare Comunicazione (progetto collegato per marketing e lead acquisition) |

## Stato attuale del progetto

- **Fase**: Ideazione / sviluppo iniziale
- **Priorità**: Alta (nel portfolio iBrain)
- **Prossima azione critica**: Definire schema dati capannoni e fonti iniziali
- **Repository / codice sorgente**: Il codice applicativo risiede all'interno del monorepo iBrain (Brain Hub), che funge da sistema centrale di knowledge management per tutti i progetti.
- **Schema dati**: Da definire. Attualmente non esistono tabelle dedicate nel database per i capannoni o i lead industriali.

## Come avviare il progetto (sviluppo)

Il progetto Sica Industrial Radar non ha un repository separato al momento. Lo sviluppo avviene all'interno dell'ecosistema **iBrain / Brain Hub**.

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

**Nota**: Sica Industrial Radar è attualmente tracciato come progetto all'interno di Brain Hub. Per accedere alla documentazione, task, roadmap e asset collegati, naviga nella sezione **Progetti → Sica Industrial Radar** dall'interno della dashboard.

## Note operative

- **Separazione codice**: Il codice specifico del "motore" di Sica Industrial Radar (ricerca capannoni, analisi, scoring) non è ancora estratto in un servizio dedicato. Fa parte del codebase condiviso di Brain Hub oppure è orchestrato tramite strumenti esterni. *Da verificare l'architettura target.*
- **Dati immobiliari**: Al momento non esiste una tabella dedicata per i capannoni. I dati futuri potrebbero essere strutturati in una tabella `industrial_properties` o simile con campi per: metri quadri, altezza, piazzale, carroponte, portoni, località, prezzo, stato, fonte.
- **Fonti dati**: Da verificare se verranno usate API esterne (portali immobiliari, Google Earth, scraping) o import manuale.
- **Conformità**: prima di raccogliere dati personali di lead, verificare conformità GDPR e inserimento privacy policy.
- **Integrazione con Furia Immobiliare**: esiste un progetto collegato (Furia Immobiliare) per il residenziale. Valutare se condividere parte dell'infrastruttura tecnica.
- **Integrazione con Sica Immobiliare Comunicazione**: il marketing e l'acquisizione lead sono gestiti dal progetto collegato "Sica Immobiliare Comunicazione".

---

*Ultimo aggiornamento: 2026-06-09*
