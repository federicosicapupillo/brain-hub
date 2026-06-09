# Roadmap Brain Hub — Automazione Prompt, Risposte e Integrazione Progetti

## Contesto
Partire dall'esistente iBrain (TanStack Start + Supabase) per evolverlo in un **Brain Hub** che gestisca in modo automatizzato: la ricezione dei prompt, l'elaborazione delle risposte, la correlazione con progetti esterni e l'archiviazione strutturata.

---

## Fase 1 — Analisi Requisiti e Modello Dati
**Obiettivo**: definire entità, stati e flusso dati necessari al Brain Hub.

### Milestone
- Modello concettuale condiviso e approvato.

### Deliverable
- Schema entità:
  - `prompt_logs` (prompt in ingresso, contesto, brain_id target, stato)
  - `response_queue` (risposte generate, revisioni umane, punteggio qualità)
  - `integration_hooks` (endpoint/proiettili per progetti esterni)
  - `brain_templates` (template di prompt ricorrenti per brain)
- Diagramma flusso: Prompt In → Valutazione Contesto → Generazione → Review → Archiviazione.
- Definizione stati: `pending`, `processing`, `review_needed`, `approved`, `rejected`, `archived`.

### Prossime Azioni
1. Workshop 30 min per convalidare entità e stati.
2. Scrivere migration Supabase per le nuove tabelle (con GRANT + RLS).
3. Aggiornare `health-check` per monitorare la nuova pipeline.

---

## Fase 2 — Automazione dei Flussi
**Obiettivo**: costruire la pipeline che riceve i prompt e li instrada correttamente.

### Milestone
- Pipeline operativa end-to-end in ambiente di sviluppo.

### Deliverable
- **Ingestion**: API/server-fn per ricevere prompt (da UI, da altri progetti via hook, da importazioni).
- **Routing intelligente**: logica per associare il prompt al `brain_id` corretto in base a contesto, tag o progetto.
- **Gestione stati**: macchina a stati per `prompt_logs` con transizioni controllate.
- **Notifiche e azioni proposte**: integrazione con il sistema esistente di Tasks e Roadmap per generare azioni di follow-up automatiche.
- **Queue interna**: gestione concorrenza e retry per la generazione risposte.

### Prossime Azioni
1. Implementare `receivePrompt` serverFn con validazione Zod.
2. Creare componente UI "Prompt Inbox" in iBrain (nuova voce sidebar o sezione in Live).
3. Collegare alla tabella `tasks` esistente per azioni derivate.

---

## Fase 3 — Integrazione Codex (AI Gateway)
**Obiettivo**: connettere la pipeline ai modelli AI per generazione e valutazione risposte.

### Milestone
- Generazione risposta attiva con fallback umano.

### Deliverable
- **Adattatore Codex**: modulo che incapsula le chiamate AI (Lovable AI Gateway), gestisce:
  - streaming risposte
  - timeout e retry
  - quota/crediti
- **Context assembly**: funzione che assembla il contesto da inviare al modello (brain_nodes, knowledge_sources, roadmap, tasks del progetto target).
- **Human-in-the-loop**: stato `review_needed` quando il punteggio di confidenza è basso o il contenuto è critico.
- **Feedback loop**: tracciare approvazioni/rifiuti per migliorare i prompt futuri.

### Prossime Azioni
1. Implementare `generateResponse` serverFn con assemblaggio contesto.
2. Aggiungere UI review (modalità "da validare") con tasti approva/rigenera/rifiuta.
3. Configurare metriche di qualità nella tabella `response_queue`.

---

## Fase 4 — Archiviazione Dati e Ricerca
**Obiettivo**: garantire che ogni prompt, risposta e azione sia storicizzata e ricercabile.

### Milestone
- Archivio completo consultabile e ricercabile semanticamente.

### Deliverable
- **Storicizzazione**: ogni prompt e risposta finale viene salvata in `prompt_logs` e `response_queue` con snapshot del contesto usato.
- **Link ai progetti**: riferimento incrociato con `project_tool_links`, `project_links` e `brain_nodes` per ricostruire la provenienza.
- **Ricerca semantica**: i chunk di prompt/risposta approvati entrano nel sistema esistente di `knowledge_chunks` ed embeddings.
- **Export**: possibilità di esportare conversazioni/roadmap in Markdown/Obsidian per progetti esterni.

### Prossime Azioni
1. Definire policy RLS per `prompt_logs` e `response_queue` (solo autenticato, per brain_id).
2. Integrare con `semantic-api.ts` esistente per indicizzare risposte approvate.
3. Aggiungere vista "Cronologia Prompt" per brain/progetto.

---

## Metriche di Successo
- Tempo medio dalla ricezione prompt a risposta approvata < 5 min per flussi automatici.
- % risposte in `review_needed` < 15% dopo 2 settimane di tuning.
- Copertura progetti attivi collegati al Brain Hub = 100% dei progetti in stato "attivo".

---

## Note e Dipendenze
- Nessuna dipendenza da API esterne oltre Lovable AI Gateway già integrato.
- Le tabelle nuove devono seguire le convenzioni esistenti (GRANT, RLS, naming).
- Non modificare auth/RLS esistenti se non per aggiungere policy sulle nuove tabelle.

---

## Prossimo Step Suggerito
Convalidare la Fase 1 (entità e stati) e avviare la migration per `prompt_logs`.