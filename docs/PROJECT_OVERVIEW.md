# Project Overview — Sica Industrial Radar

## Descrizione completa del progetto

Sica Industrial Radar è un sistema digitale pensato per supportare l'attività di **Sica Immobiliare** nella ricerca, analisi e gestione di opportunità immobiliari industriali.

Il nucleo del prodotto è un **"radar" intelligente** che raccoglie, filtra e valuta candidati immobiliari (capannoni, magazzini logistici, strutture artigianali, commerciali e navali) in base a parametri tecnici e commerciali rilevanti.

Il valore differenziale non è solo quello di un semplice database di annunci, ma di un **sistema di intelligence operativa**: l'agenzia non solo pubblica annunci, ma monitora proattivamente il mercato, qualifica le opportunità e costruisce un portafoglio strutturato di immobili industriali.

Sica Industrial Radar è inserito all'interno dell'ecosistema **iBrain**, un sistema centrale di knowledge management che traccia progetti, prompt, task, roadmap e connessioni tra idee. Brain Hub funge da "sistema nervoso" che alimenta e documenta lo sviluppo di Sica Industrial Radar stesso.

## Obiettivo

**Obiettivo a breve termine (0-3 mesi)**
- Definire lo schema dati per i capannoni e le fonti iniziali
- Realizzare un primo prototipo di ricerca con filtri base (mq, località, prezzo)
- Collegare il progetto a Sica Immobiliare Comunicazione per l'acquisizione lead

**Obiettivo a medio termine (3-12 mesi)**
- Costruire un database strutturato di capannoni con geolocalizzazione
- Implementare analisi comparativa automatica (comparables di zona)
- Lanciare gestione lead qualificati con pipeline commerciale

**Obiettivo a lungo termine (12+ mesi)**
- Scalare a piattaforma di intelligence immobiliare industriale con alert automatici
- Integrazione con portali immobiliari e API esterne
- Flusso completamente automatizzato: segnalazione → analisi → qualificazione → contatto cliente

## Target utente

### Persona primaria: "L'Agente Immobiliare Industriale"
- Opera nel settore immobiliare industriale e commerciale
- Ha bisogno di un sistema per tracciare opportunità, non solo pubblicare annunci
- Vuole posizionarsi come "specialista dei capannoni"
- Ha un portafoglio da gestire e lead da qualificare

### Persona secondaria: "Il Proprietario di Capannoni"
- Vuole vendere o affittare una struttura industriale
- Cerca un'agenzia specializzata, non un generico portale
- Ha bisogno di valutazione rapida e comparables di mercato

### Persona terziaria: "L'Investitore Industriale"
- Cerca strutture per attività produttive, logistica o artigianato
- Ha esigenze tecniche specifiche (altezza, carroponte, piazzale)
- Vuole essere avvisato quando escono opportunità pertinenti

## Problema che risolve

| Problema | Soluzione di Sica Industrial Radar |
|----------|-----------------------------------|
| "Troppi annunci sparsi su portali diversi, non so quali sono realmente opportunità" | Raccolta strutturata e filtri avanzati per qualificare subito i candidati |
| "Non ho uno storico delle opportunità che ho valutato" | Tracciamento completo di ogni candidato: salvato, scartato, da rivedere |
| "I clienti mi chiedono comparables e non ho dati strutturati" | Analisi comparativa automatica basata sul database interno |
| "Perdo tempo a cercare su più fonti" | Unificazione fonti e potenziale integrazione API |
| "Non so dove sono localizzati gli immobili di mio interesse" | Mappa interattiva con geolocalizzazione |

## Posizionamento

Sica Industrial Radar si posiziona come **"il radar dei capannoni"** per Sica Immobiliare.

Non è un semplice portale annunci (come Immobiliare.it o Casa.it in versione industriale), né un semplice CRM. È un **sistema di intelligence operativa** che aiuta l'agenzia a:
- Monitorare proattivamente il mercato
- Costruire un portafoglio qualificato di immobili industriali
- Servire clienti con dati e comparables strutturati

**Differenziazione rispetto a portali generici:**
- Focus esclusivo su immobili industriali, logistici e commerciali
- Parametri tecnici rilevanti: altezza, carroponte, piazzale, portoni
- Gestione pipeline interna dell'agenzia, non solo pubblicazione

**Differenziazione rispetto a CRM generici:**
- Dati immobiliari strutturati con campi specifici del settore industriale
- Integrazione con mappe e strumenti di ricerca geografica
- Collegamento con il progetto di comunicazione per l'acquisizione lead

## Stato attuale

| Area | Stato | Note |
|------|-------|------|
| **Concept & brief** | ✅ Definito | Documentato in Brain Hub |
| **Stack tecnico** | 🔄 Parzialmente definito | Alcune integrazioni da verificare (mappe, API esterne) |
| **Schema dati capannoni** | ⏳ Non iniziato | Prossima azione critica |
| **Ricerca e filtri** | ⏳ Non iniziato | Dipende dallo schema dati |
| **Mappa interattiva** | ⏳ Non iniziato | Da verificare quale libreria/API usare |
| **Gestione lead** | ⏳ Non iniziato | Dipende da schema dati e pipeline commerciale |
| **Analisi comparativa** | ⏳ Non iniziato | Da sviluppare in fase successiva |
| **Integrazione comunicazione** | 🔄 Da strutturare | Collegamento con Sica Immobiliare Comunicazione |

Legenda: ✅ Completato / 🔄 In corso / ⏳ Non iniziato

## Prossimi step

1. **Definire schema dati capannoni e fonti iniziali**
   - Priorità: CRITICA
   - Owner: da assegnare
   - Output: schema tabella `industrial_properties` o simile con campi tecnici (mq, altezza, piazzale, carroponte, portoni, località, prezzo, stato, fonte)

2. **Prototipare motore di ricerca con filtri base**
   - Priorità: Alta
   - Output: interfaccia di ricerca per mq, località e prezzo

3. **Collegare a Sica Immobiliare Comunicazione**
   - Priorità: Alta
   - Output: flusso di lead dalla comunicazione al radar

4. **Validare il flusso con 5 opportunità reali**
   - Priorità: Media
   - Metodo: inserimento manuale di 5 capannoni reali e test del processo di analisi

5. **Definire pipeline gestione lead**
   - Priorità: Media
   - Output: stati del lead (nuovo → qualificato → contattato → in trattativa → convertito / perso)

6. **Setup mappa interattiva**
   - Priorità: Media
   - Da verificare: libreria (Leaflet, Mapbox, Google Maps API) o integrazione con Google Earth

7. **Analisi comparativa automatica**
   - Priorità: Bassa-Media
   - Output: confronto tra immobili simili nella stessa zona

---

*Documento di riferimento per il progetto Sica Industrial Radar all'interno dell'ecosistema iBrain.*
