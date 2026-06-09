# Features Map — Sica Industrial Radar

## Funzioni presenti

Di seguito le funzionalità già operative o parzialmente implementate all'interno dell'ecosistema iBrain che supportano lo sviluppo di Sica Industrial Radar.

### Gestione progetto & knowledge (via Brain Hub)

| Feature | Stato | Note |
|---------|-------|------|
| **Dashboard progetti** | ✅ Presente | Sezione "Progetti" in iBrain con card per Sica Industrial Radar |
| **Task & todo list** | ✅ Presente | Tabella task con priorità e stati (todo / doing / review / done) |
| **Roadmap kanban** | ✅ Presente | Board 5 colonne: Idee → Da fare → In corso → Da validare → Completato |
| **Archivio contenuti** | ✅ Presente | Ricerca full-text, filtri per tipo, progetto, strumento, stato |
| **Import manuale** | ✅ Presente | Incolla dati capannoni, note, link e collegali al progetto corretto |
| **Grafo conoscenza (2D/3D)** | ✅ Presente | Visualizzazione nodi e connessioni tra idee e dati |
| **Esportazione** | ✅ Presente | Esporta in Markdown singolo, ZIP, CSV, JSON |
| **Fonti & file upload** | ✅ Presente | Upload con chunking automatico per semantic search |
| **Agenti AI** | ✅ Presente | Gestione agenti con status attivo/idle (es. Analista Immobiliare AI) |
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

Queste sono le funzionalità specifiche di Sica Industrial Radar che mancano o sono incomplete.

| Feature | Priorità | Complessità | Dipendenze | Note |
|---------|----------|-------------|------------|------|
| **Schema dati capannoni** | CRITICA | Media | — | Prossima azione. Definire tabella con campi tecnici |
| **Ricerca capannoni con filtri** | CRITICA | Media | Schema dati | Filtri: mq, altezza, piazzale, carroponte, portoni, località, prezzo |
| **Scheda candidato** | Alta | Bassa | Schema dati | Visualizzazione dettagliata di ogni immobile |
| **Salvataggio / scarto risultati** | Alta | Bassa | Schema dati | Stati: salvato, scartato, da rivedere, ripristinabile |
| **Mappa interattiva** | Alta | Media | Schema dati + API mappe | Visualizzazione geografica dei candidati |
| **Gestione lead** | Alta | Media | Schema dati + pipeline | Tracciamento contatti, note, cronologia |
| **Analisi comparativa** | Media | Media | Database popolato | Comparables di zona basati sui dati interni |
| **Import dati da fonti esterne** | Media | Alta | API esterne | Da verificare quali portali offrono API |
| **Export dati** | Media | Bassa | Schema dati | PDF report, CSV, condivisione con clienti |
| **Alert nuove opportunità** | Media | Media | Fonti dati | Notifica quando esce un nuovo candidato pertinente |
| **Integrazione Sica Immobiliare Comunicazione** | Media | Media | Progetto collegato | Flusso lead da comunicazione a radar |

## Funzioni future

| Feature | Descrizione | Stima tempi |
|---------|-------------|-------------|
| **Scraping automatizzato** | Raccolta automatica dati da portali immobiliari | 6-9 mesi |
| **Valutazione automatica** | Stima del valore di mercato tramite AI su comparables | 6-12 mesi |
| **Alert geografici** | Notifica quando escono capannoni in una zona specifica | 3-6 mesi |
| **Portale pubblico** | Sezione pubblica dove investitori possono cercare autonomamente | 9-12 mesi |
| **Multi-utente / team** | Collaborazione in team all'interno dell'agenzia | 6-12 mesi |
| **Mobile app** | App per ispezioni sul campo con foto e note geolocalizzate | 9-12 mesi |
| **Integrazione catastale** | Collegamento a dati catastali e visure | 12+ mesi |
| **Report automatici** | Generazione automatica di report per clienti | 6-9 mesi |
| **White-label** | Possibilità di vendere la piattaforma ad altre agenzie | 12+ mesi |
| **API pubblica** | Esporre API per integrazioni di terze parti | 12+ mesi |

## Priorità riassuntiva

### Roadmap sprint (prossime 4-8 settimane)

```
Settimana 1-2:  Definire schema dati capannoni + creare tabella in Supabase
Settimana 3-4:  Prototipare ricerca con filtri base (mq, località, prezzo)
Settimana 5-6:  Implementare salvataggio/scarto + stati candidato
Settimana 7-8:  Collegare Sica Immobiliare Comunicazione per flusso lead
```

### Milestone

| Milestone | Criterio di successo | Target date |
|-----------|----------------------|-------------|
| **M0 — Concept locked** | Documentazione completa e stack definito | ✅ Raggiunto |
| **M1 — Schema dati** | Tabella capannoni creata con campi tecnici | Da definire |
| **M2 — Ricerca funzionante** | Primo prototipo di ricerca con filtri base | Da definire |
| **M3 — Prima opportunità inserita** | 5 capannoni reali inseriti e gestiti nel sistema | Da definire |
| **M4 — Pipeline lead** | Gestione lead completa con stati e note | Da definire |
| **M5 — Mappa live** | Mappa interattiva con almeno 10 candidati visualizzati | Da definire |
| **M6 — Integrazione comunicazione** | Flusso lead automatico da comunicazione a radar | Da definire |

---

*Feature map soggetta a revisione in base ai risultati delle prime fasi di sviluppo.*
