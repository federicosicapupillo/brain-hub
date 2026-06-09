# User Flows — Sica Industrial Radar

## Flusso ricerca capannoni

### Attore
Agente immobiliare o utente autorizzato

### Passaggi

1. **Accesso alla sezione Ricerca**
   - L'utente naviga su **Progetti → Sica Industrial Radar → Ricerca**
   - Vede il form di ricerca con campi filtro

2. **Impostazione filtri**
   - Metri quadri (min / max)
   - Altezza interna (min)
   - Piazzale esterno (min)
   - Presenza carroponte (sì / no)
   - Numero portoni di carico
   - Località / zona geografica
   - Prezzo (min / max)
   - Tipo: vendita o affitto
   - Stato candidato: tutti, salvati, scartati, da rivedere

3. **Esecuzione ricerca**
   - L'utente clicca "Cerca"
   - Il sistema interroga il database e restituisce i risultati

4. **Visualizzazione risultati**
   - Lista schede candidato con dati sintetici
   - Possibilità di passare alla visualizzazione mappa
   - Ordinamento per rilevanza, prezzo, mq, data inserimento

5. **Selezione candidato**
   - L'utente clicca su una scheda per vedere il dettaglio
   - *Da verificare*: se la mappa mostra già i risultati in fase iniziale

### Output
Lista di capannoni filtrati, pronti per analisi o salvataggio.

---

## Flusso analisi opportunità

### Attore
Agente immobiliare

### Passaggi

1. **Apertura scheda candidato**
   - Dalla lista risultati, l'utente apre la scheda dettaglio di un capannone

2. **Revisione dati tecnici**
   - Metri quadri, altezza, piazzale, carroponte, portoni
   - Localizzazione con mappa
   - Immagini e documenti allegati
   - Note operative

3. **Confronto comparables**
   - Il sistema mostra immobili simili nella stessa zona
   - Prezzo al mq di riferimento
   - *Da verificare*: se l'analisi comparativa è già implementata o manuale

4. **Valutazione**
   - L'utente aggiunge note personali
   - Assegna un punteggio o etichetta (es. "ottima opportunità", "da verificare")

5. **Decisione**
   - Salva il candidato nel portafoglio
   - Scarta il candidato con motivazione
   - Lascia in stato "da rivedere"

### Output
Candidato con stato aggiornato e note analitiche.

---

## Flusso salvataggio candidato

### Attore
Agente immobiliare

### Passaggi

1. **Dalla ricerca o dalla scheda**
   - L'utente trova un capannone di interesse

2. **Clicca "Salva"**
   - Il sistema chiede conferma
   - Opzionale: categorizzazione (es. "per cliente X", "investimento", "da rivendere")

3. **Stato aggiornato**
   - Il candidato passa a stato "salvato" o "in portafoglio"
   - Appare nella lista "I miei candidati"

4. **Aggiunta note**
   - L'utente può aggiungere note operative
   - Allegare documenti o immagini

5. **Collegamento lead**
   - Se esiste un lead interessato, l'utente collega il candidato al lead
   - *Da verificare*: se il collegamento è già implementato

### Output
Candidato salvato nel portafoglio, con eventuale collegamento a lead.

---

## Flusso scarto / ripristino risultati

### Attore
Agente immobiliare

### Passaggi

1. **Scarto candidato**
   - Dalla scheda o dalla lista, l'utente clicca "Scarta"
   - Sistema chiede motivazione (opzionale): prezzo eccessivo, zona non idonea, dati incompleti, altro

2. **Stato aggiornato**
   - Il candidato passa a stato "scartato"
   - Scompare dalla lista principale
   - Rimane archiviato

3. **Visualizzazione scartati**
   - L'utente può filtrare per vedere i candidati scartati
   - Ricerca full-text anche tra gli scartati

4. **Ripristino**
   - L'utente trova un candidato scartato
   - Clicca "Ripristina"
   - Il candidato torna a stato "salvato" o "da rivedere"
   - Motivo del ripristino opzionale

### Output
Candidato scartato o ripristinato, con tracciamento storico.

---

## Flusso gestione lead

### Attore
Agente immobiliare

### Passaggi

1. **Accesso sezione Lead**
   - L'utente naviga su **Sica Industrial Radar → Lead**
   - Vede lista lead con stato pipeline

2. **Nuovo lead**
   - Inserimento manuale: nome, email, telefono, tipo (acquirente/venditore/inquilino/investitore)
   - Oppure: arrivo da Sica Immobiliare Comunicazione (da verificare flusso automatico)

3. **Qualifica lead**
   - L'utente aggiorna lo stato: nuovo → qualificato → contattato → in trattativa → convertito / perso
   - Aggiunge note ad ogni fase

4. **Collegamento opportunità**
   - Il lead mostra interesse per uno o più capannoni
   - L'utente collega il lead ai candidati salvati

5. **Follow-up**
   - Note sull'ultimo contatto
   - Promemoria per il prossimo contatto
   - *Da verificare*: se esiste un sistema di reminder

6. **Chiusura**
   - Lead convertito: registrazione affare
   - Lead perso: motivazione e archiviazione

### Output
Lead gestito con pipeline completa e storia delle interazioni.

---

## Flusso export o condivisione

### Attore
Agente immobiliare

### Passaggi

1. **Selezione dati**
   - Dalla lista candidati o lead, l'utente seleziona uno o più elementi
   - Oppure seleziona tutti i risultati di una ricerca

2. **Scelta formato**
   - Esporta in PDF (report)
   - Esporta in CSV (dati tabellari)
   - Esporta in Markdown (documento testuale)
   - Condividi via link (da verificare se implementato)

3. **Configurazione export**
   - Selezione campi da includere
   - Ordinamento
   - Eventuale intestazione personalizzata

4. **Generazione e download**
   - Il sistema genera il file
   - Download automatico o apertura in nuova scheda

5. **Condivisione**
   - *Da verificare*: se esiste condivisione via email o link pubblico
   - Oppure l'utente condivide manualmente il file generato

### Output
File esportato pronto per essere condiviso con clienti o collaboratori.

---

## Note sui flussi

- Alcuni flussi dipendono dalla creazione delle tabelle dedicate (`industrial_properties`, `property_leads`).
- I flussi sono descritti in modalità "target" — alcuni passaggi potrebbero non essere ancora implementati.
- I punti marcati con *"da verificare"* indicano funzionalità che devono essere confermate o progettate.

---

*Documento di riferimento per i flussi utente di Sica Industrial Radar.*
