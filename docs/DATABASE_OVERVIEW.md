# Database Overview — Sica Industrial Radar

## Tabelle principali

Attualmente, Sica Industrial Radar **non dispone di tabelle dedicate** nel database Supabase. Il progetto è tracciato come entità all'interno del sistema iBrain / Brain Hub, che condivide l'infrastruttura database con tutti i progetti gestiti.

Di seguito le tabelle dell'ecosistema iBrain rilevanti per Sica Industrial Radar, e le tabelle future che dovrebbero essere create.

### Tabelle esistenti (ecosistema iBrain)

| Tabella | Scopo | Relazione con Sica Industrial Radar |
|---------|-------|-------------------------------------|
| `brains` | Registra i progetti / workspace | Sica Industrial Radar è registrato come brain con `name = "Sica Industrial Radar"` |
| `brain_nodes` | Nodi del grafo conoscenza | Potrebbe contenere nodi tipo "capannone", "lead", "zona" collegati al brain |
| `brain_edges` | Connessioni tra nodi | Collega nodi di tipo immobile, lead, zona tra loro |
| `knowledge_sources` | Fonti di conoscenza importate | Potrebbe contenere documenti, PDF, note su capannoni |
| `tasks` | Task e azioni | Task del progetto (es. "Definire schema dati capannoni") |
| `roadmap_items` | Elementi roadmap | Tappe del progetto inserite nella roadmap kanban |
| `project_links` | Collegamenti tra progetti | Collega Sica Industrial Radar a Sica Immobiliare Comunicazione |
| `project_tool_links` | Strumenti collegati al progetto | Registra GitHub, Mappe, Perplexity, ecc. |
| `agents` | Agenti AI | "Analista Immobiliare AI" è un agente collegato al brain del progetto |
| `app_logs` | Log operativi | Traccia azioni eseguite nel contesto del progetto |

### Tabelle future (da creare per Sica Industrial Radar)

Di seguito le tabelle che dovrebbero essere create per rendere operativo il sistema.

#### `industrial_properties` (capannoni e immobili industriali)

Campi chiave proposti:

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `id` | uuid | Chiave primaria |
| `user_id` | uuid | Riferimento all'utente proprietario (RLS) |
| `brain_id` | uuid | Riferimento al brain del progetto |
| `title` | text | Titolo / nome dell'immobile |
| `description` | text | Descrizione testuale |
| `property_type` | text | Tipo: capannone, magazzino, artigianale, commerciale, navale |
| `status` | text | Stato: segnalato, in_analisi, qualificato, scartato, convertito |
| `square_meters` | numeric | Metri quadri totali |
| `height_meters` | numeric | Altezza interna in metri |
| `yard_square_meters` | numeric | Mq piazzale esterno |
| `has_crane` | boolean | Presenza carroponte |
| `loading_docks` | int | Numero portoni di carico |
| `location` | text | Indirizzo o località |
| `latitude` | numeric | Latitudine per mappa |
| `longitude` | numeric | Longitudine per mappa |
| `price` | numeric | Prezzo di vendita o canone di affitto |
| `price_type` | text | Vendita o affitto |
| `source` | text | Fonte: manuale, portale, contatto, ricerca_proattiva |
| `source_url` | text | URL fonte esterna |
| `contact_name` | text | Nome referente |
| `contact_phone` | text | Telefono referente |
| `contact_email` | text | Email referente |
| `notes` | text | Note operative interne |
| `images` | jsonb | Array di URL immagini |
| `documents` | jsonb | Array di documenti allegati |
| `metadata` | jsonb | Campi aggiuntivi flessibili |
| `created_at` | timestamptz | Data creazione |
| `updated_at` | timestamptz | Data aggiornamento |

#### `property_leads` (lead collegati agli immobili)

Campi chiave proposti:

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `id` | uuid | Chiave primaria |
| `user_id` | uuid | Riferimento utente (RLS) |
| `brain_id` | uuid | Riferimento brain progetto |
| `property_id` | uuid | Riferimento a `industrial_properties` |
| `lead_name` | text | Nome lead |
| `lead_email` | text | Email lead |
| `lead_phone` | text | Telefono lead |
| `lead_type` | text | Tipo: acquirente, venditore, inquilino, investitore |
| `pipeline_status` | text | Nuovo, qualificato, contattato, in_trattativa, convertito, perso |
| `notes` | text | Note operative |
| `last_contact_at` | timestamptz | Ultimo contatto |
| `created_at` | timestamptz | Data creazione |
| `updated_at` | timestamptz | Data aggiornamento |

#### `property_comparables` (comparables di zona)

Campi chiave proposti:

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `id` | uuid | Chiave primaria |
| `user_id` | uuid | Riferimento utente (RLS) |
| `reference_property_id` | uuid | Immobile di riferimento |
| `comparable_property_id` | uuid | Immobile comparato |
| `similarity_score` | numeric | Punteggio di similarità (0-1) |
| `price_per_sqm` | numeric | Prezzo al mq del comparable |
| `notes` | text | Note sull'analisi |
| `created_at` | timestamptz | Data creazione |

## Dati gestiti

Attualmente, i dati gestiti per Sica Industrial Radar all'interno di iBrain sono:

- **Metadati progetto**: nome, descrizione, categoria, stato, priorità, colori (tabella `brains`)
- **Task**: azioni da svolgere (tabella `tasks`)
- **Roadmap**: tappe di sviluppo (tabella `roadmap_items`)
- **Nodi grafo**: nodi connessi al brain del progetto (tabella `brain_nodes`)
- **Collegamenti**: collegamenti a Sica Immobiliare Comunicazione (tabella `project_links`)
- **Strumenti**: GitHub, Google Earth, Mappe, Perplexity, ChatGPT (tabella `project_tool_links`)
- **Log**: azioni eseguite nel contesto del progetto (tabella `app_logs`)

I dati specifici dei capannoni (mq, altezza, prezzo, posizione) **non sono ancora strutturati** in tabelle dedicate.

## Relazioni

```
brains (Sica Industrial Radar)
  ├── brain_nodes (nodi del grafo: idee, documenti, note)
  ├── brain_edges (connessioni tra nodi)
  ├── knowledge_sources (fonti importate: PDF, note, link)
  ├── tasks (azioni da fare)
  ├── roadmap_items (tappe roadmap)
  ├── project_links → project_links (altri progetti collegati)
  ├── project_tool_links (strumenti esterni collegati)
  ├── agents (Analista Immobiliare AI)
  └── app_logs (log operativi)

Future relations:
industrial_properties
  ├── property_leads (1:N)
  └── property_comparables (N:M via reference_property_id / comparable_property_id)
```

## Campi chiave

### Campi chiave attuali (iBrain)

| Tabella | Campo chiave | Significato |
|---------|-------------|-------------|
| `brains` | `name` | Identificazione progetto ("Sica Industrial Radar") |
| `brains` | `id` | UUID del brain, usato come FK nelle altre tabelle |
| `brain_nodes` | `brain_id` + `label` | Nodi identificati per brain e etichetta |
| `tasks` | `brain_id` + `status` | Task filtrabili per progetto e stato |
| `project_links` | `source_brain_id` / `target_brain_id` | Collegamenti tra progetti |

### Campi chiave futuri (Sica Industrial Radar)

| Tabella | Campo chiave | Significato |
|---------|-------------|-------------|
| `industrial_properties` | `square_meters` + `location` + `price` | Filtri principali di ricerca |
| `industrial_properties` | `status` | Pipeline del candidato |
| `property_leads` | `pipeline_status` | Stato avanzamento lead |
| `property_leads` | `property_id` | Collegamento all'immobile di interesse |

## Stato Supabase

| Aspetto | Stato | Note |
|---------|-------|------|
| **Database** | ✅ Attivo | PostgreSQL su Supabase, progetto nlakwuinhveyjkeoeoiv |
| **Auth** | ✅ Attivo | Email + Google OAuth |
| **RLS** | ✅ Attivo | Ogni tabella ha RLS abilitato |
| **Storage** | ✅ Attivo | Bucket `brain-uploads` privato, 25 MB limite |
| **pgvector** | ✅ Attivo | Estensione per semantic search |
| **Realtime** | ✅ Disponibile | Da verificare se usato per Sica Industrial Radar |
| **Edge Functions** | ✅ Disponibili | Da verificare se necessarie per API esterne |

## Punti da verificare

1. **Schema dati capannoni**: confermare campi tecnici necessari (es. classe energetica, certificazione sismica, accesso mezzi pesanti, piano industriale).
2. **Fonti dati**: verificare quali portali immobiliari industriali offrono API o se si partirà da import manuale.
3. **Geolocalizzazione**: verificare quale servizio di mappe usare (Google Maps, Mapbox, Leaflet) e se è già configurata una API key.
4. **RLS future**: quando si creeranno `industrial_properties` e `property_leads`, verificare che le policy RLS siano coerenti con il resto dell'app.
5. **GRANT**: ogni nuova tabella in `public` dovrà avere `GRANT` a `authenticated` e `service_role` per funzionare con PostgREST.
6. **Indici**: valutare indici sui campi di ricerca frequente (`location`, `square_meters`, `price`, `status`).
7. **Backup**: verificare politica di backup per i dati immobiliari una volta in produzione.

---

*Documento di riferimento per l'architettura dati di Sica Industrial Radar.*
