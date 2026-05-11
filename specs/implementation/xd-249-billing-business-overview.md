# Billing Module (xd-249) — Business Overview

**Typ dokumentu**: Product overview do review z cofounderem
**Data**: 2026-04-26 (revised 2026-05-11 — lightweight scope + full review)
**Status**: Draft do akceptacji

---

## TL;DR

`@dainamite/billing` to **lightweight silnik rozliczeniowy** dla aplikacji
opartych na Open Mercato. Trzyma listę pozycji do zafakturowania
(`Billing Items`), uruchamia `Bill Run` w zaplanowanym oknie (codziennie /
tygodniowo / miesięcznie), kalkuluje opłaty i produkuje **draft invoice**.
Człowiek weryfikuje draft i go zatwierdza ("post") — dopiero wtedy
faktura ląduje w księgowości.

Może działać **standalone** (klient podpina dowolne źródło Billing Items
przez REST API) albo **rozszerza CPQ** (subskrypcje CPQ generują Billing
Items przez pre-built integrację — osobny bridge package).

**Trzy zdania:**
- **Co**: Recurring billing + lightweight usage rating + draft invoice
  workflow z human approval.
- **Dla kogo**: B2B usługodawcy chcący trzymać rozliczenia we własnej
  infrastrukturze, z kontrolą nad fakturami przed wysłaniem.
- **Czemu nie Stripe/Chargebee**: natywna integracja z istniejącym ERP,
  suwerenność danych, dowolność podatkowa (EU/PL VAT), brak vendor lock-in,
  **human-in-the-loop na każdej fakturze**.

---

## Założenia projektowe *(non-negotiable)*

1. **Lightweight — brak własnego product catalog.** Billing Item ma tylko
   tekstowy opis i (opcjonalnie) referencję FK do produktu w innym module
   (np. CPQ). Billing nie wie co to "produkt", tylko co jest na fakturze.
2. **Standalone-first, ale przyjazne CPQ.** Pakiet `@dainamite/billing`
   nie zależy od `@dainamite/cpq`. Integracja CPQ↔Billing idzie przez
   osobny bridge package (`@dainamite/cpq-billing-bridge`) który mapuje
   eventy CPQ na operacje billing API.
3. **Kalkulacja podczas Bill Run dla pozycji proporcjonalnych do czasu
   lub usage.** Recurring items są mnożone przez liczbę dni w cyklu
   (lub całe okresy zgodnie z cycle), usage items przez sumaryczne
   `quantity` z Usage records, według aktualnej stawki w momencie runu.
   Pozwala to zmieniać pricing bez przepisywania historycznych itemów.
   **Pozycje z pre-calculated value** (one-time charges, proracje,
   credity) niosą gotową kwotę i Bill Run je tylko przepisuje na
   draft — bez kalkulacji.
4. **Draft invoices, human verifies, then post.** Bill Run nigdy nie
   wystawia "final" faktury automatycznie. Wszystko ląduje jako `draft`,
   operator finansowy ręcznie zatwierdza ("post") — dopiero wtedy
   numeracja sekwencyjna, eventy księgowe, etc.
5. **Proration TAK, ale lightweight.** Wspieramy prorata (np. amend w
   trakcie cyklu → dopłata proporcjonalna). **Bridge** (CPQ-billing
   lub custom integrator) **kalkuluje wartość proraty** — billing
   tylko zapisuje ją jako Billing Item typu `one_time` z opisem
   ("Proration: {item} from {date} to {date}"). **Nie** budujemy
   osobnych tabel z formułami / audytem proracji. Audit jest w opisie
   Itemu + logach bridge'a po stronie integratora.
6. **Lightweight usage handling.** External system uploaduje
   pre-aggregated usage do `Billing Account Usage` (np. "customer X
   used 753k input tokens between 2026-02-23 and 2026-02-25"). Bill
   Run czyta to przy następnym uruchomieniu i rate'uje zgodnie z
   cennikiem zdefiniowanym w Billing Item typu `usage`. **UoM matching
   jest exact** — `uom_code` w Usage record musi dosłownie matchować
   `uom_code` w Billing Item; brak konwersji jednostek w v1.
7. **Bill Run jest schedulable.** Cron-like trigger per tenant
   (codziennie / tygodniowo / miesięcznie). Plus manual trigger przez
   UI / API z opcjonalnym scope: pojedynczy account, pojedyncza data
   "as-of", dry-run mode.
8. **Bill Run self-heals.** Każde Billing Account jest niezależnym
   envelope'em w transakcji — fail na jednym nie blokuje pozostałych.
   Per-account outcome zapisany w summary z error message. Operator
   może **retry only failed accounts** (engine pomija sukcesy z
   poprzedniego runu) lub **restart cały run**.
9. **Idempotency-first.** Bill Run dla danego account + bill period
   nie tworzy duplikatów — jeśli istnieje już **otwarty draft** dla
   tego okresu, engine **skipuje** (z flagą w summary). Operator musi
   ręcznie zamknąć/usunąć draft żeby wymusić ponowną kalkulację.
10. **Korekty faktur (storno) — out of scope v1.** Po post faktury
    operator robi korektę manualnie przez `core/sales` (które już ma
    invoice CRUD). Dedicated credit note flow w billingu — przyszły
    moduł.
11. **Tenant scoping standardowy OM.** Każda encja w billingu nosi
    `tenant_id` + `organization_id` z OM. Multi-tenant izolacja jest
    free.

---

## Key objects

### Billing Account
Grupa pozycji do zafakturowania razem (typowo: jeden klient =
jedno konto). Definiuje:
- `tenant_id`, `organization_id` — OM standard scoping
- `customer_id` — string FK do `customers` modułu (lub external system
  ID dla standalone deployments). **No ORM relation** zgodnie z
  SPEC-001 hard rules.
- `name` — nazwa konta (display)
- `currency_code` — single-currency per account; wszystkie Items i
  Usage records muszą matchować
- `bill_cycle` — `monthly` / `quarterly` / `annually` / `weekly`
- `bill_cycle_anchor` — kotwica okresu:
  - dla `monthly`/`quarterly`/`annually`: dzień miesiąca 1-28
  - dla `weekly`: day-of-week (`mon`-`sun`)
- `invoice_data` (JSONB) — adres, tax id (NIP), email do wysyłki
  faktur, język faktury
- `next_bill_date` — data następnego Bill Runu który złapie ten
  account (auto-aktualizowana po każdym Run)
- `last_bill_date` — data ostatniego successful Bill Runu (nullable)
- `status` — `active` / `paused` / `closed`
  - `active` — Bill Run łapie zgodnie z `next_bill_date`
  - `paused` — Bill Run **pomija** (`next_bill_date` nie auto-advances)
  - `closed` — terminal state, no more billing
- `auto_post` — boolean, default `false`. **W v1 zawsze `false`** —
  flaga jest zaszyta na przyszłość (skoro spec wymaga draftów).
- standardowe `created_at`, `updated_at`, soft-delete

### Billing Item
Pojedyncza linia do zafakturowania. Sercem modułu.
- `tenant_id`, `organization_id`, `bill_account_id`
- `type` — `one_time` / `recurring` / `usage` / `credit`
  - `credit` jest aliasem dla `one_time` z ujemnym `amount` — wygodne
    dla operatora żeby filtrował kredytowe linie
- `bill_start_date` — od kiedy item kwalifikuje się na Bill Run
- `bill_end_date` — do kiedy (nullable = open-ended, recurring jedzie
  bez końca)
- `description` — tekstowy opis pojawiający się na fakturze
- `quantity` — liczba sztuk (np. 5 seats, 100 godzin); default `1`
- `rate_json` (JSONB) — **jedyna kolumna na pricing**, dwa formaty:
  - **simple** — `{"unit_price": 49.99}` (pomnożone przez `quantity`)
  - **tiered** — `{"tiers": [{"up_to": 10000, "unit_price": 0},
    {"up_to": null, "unit_price": 0.001}], "model": "volume"}`
  - Model: `volume` (flat per tier), `graduated` (per-unit per tier),
    `flat` (one flat price per tier)
- `amount` — nullable. Dla pre-calculated items (`one_time` z proraty,
  manualne credit) — kwota gotowa, ignoruje `rate_json` × `quantity`.
  Dla recurring/usage — `null`, kalkulowane w Bill Run.
- `uom_code` — wymagane dla `type=usage`, ignored dla pozostałych
- `subscription_id`, `subscription_item_id` — nullable string FK,
  pozwala bridge'owi CPQ tracować skąd item przyszedł (no ORM relation)
- `source_ref` — nullable string, idempotency key dla external creators
  (unique per tenant — pre-existing item z tym samym `source_ref`
  blokuje create, zwraca pre-existing ID)
- `status` — `active` / `paused` / `cancelled`
  - `active` — łapany przez Bill Run
  - `paused` — pomijany, ale nie usuwany
  - `cancelled` — terminal, nie wraca

> **CPQ integration note:** Jeśli CPQ subscription item ma jednocześnie
> one-time charge (np. aktywacja) i recurring charge (np. MRC),
> bridge tworzy **dwa osobne Billing Items** (`type=one_time` +
> `type=recurring`) wskazujące na ten sam `subscription_item_id`.

### Billing Account Usage
Bucket dla pre-aggregated usage. External system robi POST z
payloadem:
- `tenant_id`, `organization_id`, `bill_account_id`
- `uom_code` — co liczymy (musi dosłownie matchować Item-side `uom_code`)
- `quantity` — ile zużyto (number)
- `period_start`, `period_end` — w jakim oknie (timestamps)
- `source_ref` — string, idempotency per
  `(bill_account_id, source_ref)` — duplicate POST returns 200 z
  existing record, no double-count
- `rated_in_bill_run_id` — nullable FK, ustawiany przez Bill Run
  gdy ten zapis zostanie zużyty (zapobiega double-rate w retry)

Bill Run dla account + cycle bierze Usage records gdzie:
- `bill_account_id` matches
- `uom_code` matches Item-side
- `period_end <= bill_period_end`
- `rated_in_bill_run_id IS NULL` (jeszcze nie zużyty)

Po draftowaniu invoice, Bill Run oznacza te records jako rated.
**Edge case — usage bez pasującego Item:** Bill Run loguje warning
w outcome ("usage X without matching billing item"), pozostawia
record un-rated. Operator musi dodać missing Item i retry.

### Bill Run
Pojedyncze uruchomienie engine'u.
- `tenant_id`, `organization_id`
- `triggered_by` — `schedule` / `manual` / `api`
- `triggered_by_user_id` — nullable, dla manual/api
- `scope` (JSONB) — `{"as_of_date": "...", "account_ids": [...],
  "dry_run": false}` — dla manual triggerów; schedule ma zawsze
  `as_of_date=today`, wszystkie active accounts
- `started_at`, `finished_at`
- `status` — `running` / `completed` / `partial_failure` / `failed`
- `summary` (JSONB) — `{accounts_processed, drafts_created,
  drafts_skipped_existing, accounts_failed, usage_records_rated}`
- Per-account outcomes w osobnej tabeli (`bill_run_outcomes`):
  - `bill_account_id`, `bill_run_id`, `status`, `error_message`,
    `draft_invoice_id` (nullable)
- Operacje:
  - **Restart** — tworzy nowy Bill Run z tym samym scope
  - **Retry failed** — nowy Bill Run z `scope.account_ids` = failed z
    poprzedniego

### Invoice
Już istnieje w `@open-mercato/core/sales`. Billing nie wymyśla swojego —
tworzy draft invoice w sales i podlinkowuje Billing Items jako invoice
lines.

**Status flow:**
- `draft` (tworzone przez Bill Run) → operator edytuje / weryfikuje
- `posted` (klik "Post") → sequence number nadany, status final,
  event `billing.invoice.posted` leci
- `paid` (event z `payment_gateways`) → billing podsłuchuje, oznacza
- `void` (manualny operator) → korekta przez `core/sales` (nie billing)

**Co operator może na drafcie:**
- Dodać/usunąć/edytować linie (każda zmiana audit'owana — `who`,
  `when`, `what`)
- Zmienić quantity, description, unit price na linii
- Dodać linię z palca (rabat, jednorazowa korekta)
- **NIE może** zmienić sequence number, tax rate (tax service), waluty
- Po post — wszystko frozen

---

## Configurable elements

### Unit of Measure (UoM)
Konfigurowalny słownik z globalnymi defaultami:
- czas: `hour`, `day`, `week`, `month`
- volume: `gb`, `tb`, `mb`
- requesty/tokeny: `request`, `api_request`, `token`, `input_token`,
  `output_token`
- "seats": `seat`, `user`, `device`, `active_user`

Plus tenant-specific custom values (każdy tenant może dodać własne).
Zarządzany przez moduł `dictionaries` z core (już istnieje).

### Invoice Sequence Number
Per-tenant konfigurowalna sekwencja numeracji faktur.
- `pattern` — z placeholderami, np. `FV/{YEAR}/{MONTH}/{NNNN}` lub
  `INV-{YYYY}-{0000000}`
- `reset_cycle` — `yearly` / `monthly` / `never`
- `current_value` — numeryczne, atomowo inkrementowane przy post
- **Atomic upsert SQL** zapewnia brak przeskoków i brak duplicatów
  nawet przy concurrent post (wymóg Ustawy o VAT)

---

## Flow end-to-end

1. **Setup.** Operator tworzy Billing Account dla klienta (ręcznie w
   UI lub przez API z bridge'a). Definiuje cycle, billing day, dane do
   faktury, walutę.
2. **Pozycje wpadają.** Bridge CPQ→Billing (lub manualny POST) tworzy
   Billing Items: recurring MRC, opłaty aktywacyjne, charge'y proracji
   po amendzie. Każdy z opcjonalnym `source_ref` dla idempotency.
3. **External system pushuje usage** (jeśli relevant) do Billing
   Account Usage. Idempotency przez `source_ref`.
4. **Bill Run.** Cron triggeruje codziennie 02:00 (per tenant config).
   Engine znajduje Billing Accounts gdzie `status='active'` AND
   `next_bill_date <= today`, dla każdego:
   - Zbiera relevantne Billing Items (`status='active'`, range pasuje
     do bill period)
   - Zbiera relevantne Usage records (`rated_in_bill_run_id IS NULL`,
     period_end ≤ bill_period_end, UoM matches some Item)
   - Sprawdza czy nie ma już otwartego draftu dla tego okresu — **jeśli
     jest, skip** (zapisuje w summary jako `skipped_existing`)
   - Kalkuluje sumy, tworzy draft invoice w `core/sales`
   - Oznacza Usage records jako rated
   - Ustawia `last_bill_date` = today, `next_bill_date` = następny
     wg cycle
5. **Operator review.** Rano operator otwiera listę draftów. Widzi
   per-faktura: linie, sumy, klient, anomalie (oznaczone przez Bill
   Run, np. "usage without matching item", "rate changed since item
   creation"). Edytuje (z audit), odrzuca, lub posta.
6. **Post.** Klik "Post invoice" → sequence number, status `posted`,
   eventy lecą:
   - `billing.invoice.posted` (do księgowości, do mailingu)
   - `billing.invoice.line_posted` per linia (do analytics)
7. **Re-run.** Jeśli Bill Run wybuchł na jakimś koncie — operator
   widzi w summary, klika "Retry failed" — nowy Bill Run leci tylko
   po tych co failowały, używając tej samej `as_of_date`.

---

## Co billing **nie robi** (granice produktu)

- **Brak własnego product catalogu.** Billing Item ma tekstowy opis,
  ewentualnie FK do produktu w innym module (CPQ / catalog).
- **Brak automatycznego postowania faktur.** W v1 zawsze human review.
  Flaga `auto_post` w Account jest na przyszłość (post-v1).
- **Brak pełnego audit trail proracji.** Wartość proracji idzie jako
  Billing Item, formuła w opisie + logach bridge'a integratora.
- **Brak korekt (credit notes / storno) v1.** Po post — korekta przez
  `core/sales` ręcznie. Dedicated flow planowany jako add-on.
- **Brak dunning.** Faktura wyszła i koniec. Ponaglenia + zawieszanie
  usługi to osobny przyszły moduł.
- **Brak portalu klienta.** Klient nie loguje się żeby zobaczyć
  faktury. Faktura idzie mailem (przez event).
- **Brak pobierania płatności.** To moduł `payment_gateways` z OM
  (Stripe, Przelewy24). Billing **podsłuchuje** ich eventy żeby
  oznaczyć `paid` — nie zarządza płatnościami.
- **Brak liczenia podatków.** VAT/exempty załatwia tax service z
  `core/sales`. Billing przekazuje stawkę i kwotę.
- **Brak konwersji walut.** Każde Billing Account jest single-currency
  (`currency_code` na Account). Bridge może wysłać pre-calculated
  `amount` lub usage record z explicit `currency_code` mismatch — w
  takim wypadku API zwraca **200 z warning** i zapisuje pozycję z
  flagą `currency_mismatch: true`. Operator widzi tę flagę w UI na
  drafcie i decyduje czy edytować/odrzucić linię przed post. Brak
  konwersji = brak FX risk po naszej stronie, decyzja świadoma.
- **Brak konwersji UoM.** Usage record z `uom_code` nie matchującym
  exactly Item-side → un-rated, warning w outcome.
- **Brak trial periods jako odrębna feature.** Discounted okres →
  tworzysz Billing Item z `rate_json` i `bill_end_date`, potem drugi
  Item z normalnym `rate_json` od następnego dnia.
- **Brak pauzowania subskrypcji.** "Wstrzymaj rozliczenie" = ustaw
  `status='paused'` na Billing Items lub całym Billing Account.
- **Brak mid-Bill-Run resumption.** Jeśli Bill Run crashed w połowie
  (proces zabity), runner zostawia `status='running'` — operator
  ręcznie restartuje. Każde account jest atomowe (transakcja), więc
  no half-state per account.

---

## Persony i ACL

- **Finance operator** — codziennie weryfikuje draft invoices, postuje,
  retry-uje failed runs, edytuje Billing Items.
- **Auditor / księgowość** — read-only dostęp do faktur, Bill Run
  history, Billing Accounts. Nie postuje, nie edytuje.
- **Integrator techniczny** — pisze bridge: subscription event → POST
  /billing-items. Dostaje API key z ograniczonymi feature'ami.
- **External usage system** — autonomiczny push do Usage endpoint
  przez API key (najwężej skonfigurowany).

**ACL features** (dedykowane, nie generyczne `billing.*`):
- `billing.account.manage` — CRUD na Billing Account
- `billing.account.view` — read-only
- `billing.item.manage` — CRUD na Billing Item
- `billing.item.view` — read-only
- `billing.usage.ingest` — POST na Usage endpoint (typowo API key dla
  external systemu)
- `billing.usage.view` — read access
- `billing.run.trigger` — manual Bill Run / retry
- `billing.run.view` — read history
- `billing.invoice.post` — kliknięcie "Post invoice" na draft
- `billing.invoice.edit_draft` — edycja linii na drafcie
- `billing.invoice.view` — read-only

Default role mappings:
- `admin` — wszystko
- `billing.operator` — manage + view + run + post + edit_draft
- `billing.auditor` — wszystkie `.view` features (+ tylko view)
- `billing.usage_writer` — tylko `usage.ingest` (dla zewn. systemów)

---

## Trzy historie end-to-end

### Historia 1 — nowa subskrypcja z opłatą wstępną
Integrator (CPQ-bridge lub własny) woła billing API: tworzy Billing
Account dla klienta (`currency_code: EUR`, `bill_cycle: monthly`,
`bill_cycle_anchor: 1`) + dwa Billing Items dla subskrypcji:
`recurring` MRC 49.99 EUR/mc oraz `one_time` opłatę
aktywacyjną/setup fee z `amount: 99.00` (pre-calculated, brak
`rate_json`).

1 czerwca o 02:00 Bill Run znajduje to konto, kalkuluje recurring
(49.99 × 1 cykl), bierze one-time as-is (99.00), tworzy **draft
invoice** zawierający 49.99 + 99 = 148.99 EUR. Rano operator otwiera
draft, weryfikuje, klika "Post" — faktura dostaje numer
`FV/2026/06/0123`, status `posted`, event `billing.invoice.posted`
leci do system mailingowego.

### Historia 2 — klient dorzuca usługę w trakcie cyklu
15 maja klient kupuje dodatkowy pakiet (29 EUR/mc). Bridge robi POST:
1. Nowy Billing Item `recurring` z `rate_json: {"unit_price": 29}`,
   `bill_start_date: 2026-05-15`
2. Billing Item `one_time` z `amount: 15.90`, opis "Proration: Pakiet X
   from 2026-05-15 to 2026-05-31" — **bridge kalkuluje wartość
   proraty** (29 × 17/31), billing tylko zapisuje pozycję

1 czerwca Bill Run tworzy draft z: stary MRC 49.99 (recurring, full
cycle) + nowy pakiet za pełny czerwiec 29 (recurring, full cycle —
`bill_start_date` ≤ start okresu więc liczy się full) + proration
15.90 (one_time, pre-calculated). Razem 94.89 EUR. Operator posta.

### Historia 3 — usage-based billing
Klient ma plan: 49 EUR flat + 0.001 EUR za każdy API request ponad
10k. Tworzymy dwa Billing Items:
- `recurring` 49 EUR (`rate_json: {"unit_price": 49}`)
- `usage` z `uom_code: api_request`, `rate_json: {"tiers": [{"up_to":
  10000, "unit_price": 0}, {"up_to": null, "unit_price": 0.001}],
  "model": "graduated"}`

W ciągu maja external system robi codzienne POST-y do `Billing Account
Usage`: każdy z `uom_code: api_request`, własnym `source_ref` (np.
`metrics-2026-05-15`). 1 czerwca Bill Run sumuje Usage records gdzie
`period_end <= 2026-05-31` AND `rated_in_bill_run_id IS NULL`: 53k
requests. Rate'uje przez graduated tier: pierwsze 10k × 0 + kolejne
43k × 0.001 = 43 EUR. Draft invoice: 49 + 43 = 92 EUR. Oznacza Usage
records jako rated. Operator weryfikuje.

---

## Compliance & regulatory

- **Numeracja faktur unikalna, atomowa, bez przeskoków** — wymaganie
  Ustawy o VAT i Dyrektywy 2006/112/WE. Atomic upsert SQL, nigdy
  in-memory counter.
- **VAT pełnoprawny** — dziedziczony z `core/sales`.
- **Audit trail** — każdy Bill Run loguje per-account outcome. Każdy
  invoice post emituje persisted event. Edycja draftu audit'owana
  (`who`, `when`, `what`).
- **Data residency** — billing trzyma dane w bazie klienta. Atut dla
  sektora regulowanego.
- **GDPR-ready** — moduł nie loguje PII w eventach. Right to
  portability — endpoint `/billing/export/account/{id}` zwraca pełen
  dump JSON dla danego konta.
- **Idempotency-first API** — `source_ref` na Billing Items i Usage
  records zapobiega podwójnemu naliczeniu przy retry.

> **Retention policy** nie jest definiowana w v1 — moduł nie usuwa
> sam żadnych danych. Soft-delete (`deleted_at`) dostępne dla
> wszystkich encji, ale automated purge / TTL jest poza scope.

KSeF (2027), SAF-T / JPK_VAT — przez `core/sales` lub osobne pakiety,
billing nic nie psuje.

---

## Konkurencja (skrót)

| Cecha | `@dainamite/billing` | Stripe Billing | Chargebee |
|-------|----------------------|----------------|-----------|
| Recurring billing | ✅ | ✅ | ✅ |
| Lightweight usage rating | ✅ | ✅ | ✅ |
| Mid-cycle proration | ✅ (bridge-driven) | ✅ | ✅ |
| **Draft → human verify workflow** | ✅ | ❌ (full auto) | ❌ (full auto) |
| Credit notes / storno | ❌ v1 (manual) | ✅ | ✅ |
| Dunning | ❌ v1 | ✅ | ✅ |
| Customer portal | ❌ v1 | ✅ | ✅ |
| **Dane on-prem / sovereign** | ✅ | ❌ | ❌ |
| **Polish VAT (KSeF, JPK)** | ✅ (przez core/sales) | ⚠️ | ⚠️ |
| **Brak vendor lock-in** | ✅ | ❌ | ❌ |
| Cena | one-time license + maintenance | % od obrotu | % od obrotu |

**Gdzie wygrywamy:** klient z OM, klient z wymogiem human review przed
post (compliance / finance teams które chcą kontroli), klient regulowany
(data residency), klient PL/EU.

**Gdzie świadomie nie konkurujemy w v1:** B2C masowo z kartami, klienci
bez własnego IT, klienci usage-heavy z milionami eventów dziennie
(potrzebują dedykowanego metering systemu, nie lightweight bucket).

---

## Plan dostarczania

| Faza | Co dostarcza | Effort |
|------|--------------|--------|
| 0 | Schemat encji (Account, Item, Usage, Run, RunOutcome) + ACL features + scaffolding modułu. Brak logiki. | 1 tydzień |
| 1 | REST API: Billing Account CRUD, Billing Item CRUD, Usage ingest endpoint. UoM dictionary integration. Idempotency przez `source_ref`. | 2 tygodnie |
| 2 | Bill Run engine: schedulable, processes recurring + one_time + credit items, tworzy draft invoices w `core/sales`, idempotency (skip existing draft). Manual trigger + retry-failed. **Dry-run mode.** | 2-3 tygodnie |
| 3 | Usage handling: rate'owanie w Bill Run (simple + tiered), exact UoM matching, `rated_in_bill_run_id` marking. | 1-2 tygodnie |
| 4 | UI admina: draft invoice review + post + edit (audit), Bill Run history + retry, manual triggers, Billing Account/Item CRUD UI. Plus `manuals/cpq-billing-integration.md` z gotowym przykładem subscribera dla integratorów. **v1 release**. | 2-3 tygodnie |

**Łącznie:** ~8-11 tygodni solo. Pierwsze demo z draftowymi fakturami:
~koniec Phase 2 (5-6 tygodni od startu).

**Po v1 — osobne pakiety (nie w v1):**
- `@dainamite/cpq-billing-bridge` — formalna integracja CPQ ↔ Billing
- `@dainamite/billing-dunning` — overdue tracking, ponaglenia
- `@dainamite/billing-credit-notes` — korekty faktur / storno flow
- `@dainamite/billing-portal` — customer self-service

---

## Monetyzacja — open question

Cztery modele do dyskusji:
1. **One-time license + maintenance** — klasyka enterprise (~20-40k PLN
   license, 20%/rok maintenance)
2. **Annual subscription** — SaaS-style (~2-5k PLN/mc per tenant)
3. **% od obrotu** — jak Stripe (~0.3-0.5% od fakturowanej kwoty)
4. **Per-invoice fee** — jak Maxio (~0.50 PLN per posted invoice)

Preferencja: hybryda 1+2. Decyzja zależy od typowego customer profilu i
strategii growth vs bootstrap.

---

## Success metrics dla v1

**Tier 1 — produkt działa:**
- Pierwsze draft invoices generują się w Netii w ciągu 8-11 tygodni.
- Bill Run idempotentne: re-run nie generuje duplikatów (zweryfikowane
  przez integration test).
- Integration tests > 95% coverage na komendy + API endpoints.

**Tier 2 — produkt u klienta:**
- Pierwszy klient produkcyjnie używa go do ≥ 100 aktywnych Billing
  Accounts przez ≥ 30 dni.
- 0 ręcznych korekt z powodu błędu billingu (proration value
  dostarczany przez bridge — bug może być po jego stronie, nie
  billingu).
- Operator finansowy potwierdza pisemnie oszczędność czasu vs
  poprzedniego procesu.

**Tier 3 — skala:**
- 2-3 klienci produkcyjnie, w tym co najmniej 1 standalone (bez CPQ).
- Bridge `@dainamite/cpq-billing-bridge` wdrożony u ≥ 1 klienta.

**Anti-metrics:**
- > 1% draftów wymaga ręcznej korekty linii (przed post).
- > 5% Bill Account-ów kończy Bill Run statusem `failed`.
- > 1% usage records pozostaje un-rated po Bill Run (sygnał że UoM
  matching nie pasuje — broken integration).
- Czas onboardingu nowego klienta > 2 tygodnie.

---

## Decyzje przyjęte (2026-05-11 review)

- **Key objects** — 5 wystarczy (Account, Item, Usage, Run, Invoice ref);
  pomocnicze tabele (`bill_run_outcomes`) nie są "key objects".
- **Human-in-the-loop dla post** — must-have w v1, brak `auto_post`.
- **Korekty (credit notes / storno)** — out of scope v1, manual przez
  `core/sales`. Dedicated flow planowany jako add-on.
- **Currency mismatch** — warning + zapisany z flagą `currency_mismatch`,
  nie reject. Operator widzi w UI, decyduje.
- **Retention policy** — nie definiujemy w v1. Soft-delete dostępny,
  automated purge / TTL poza scope.
- **CPQ bridge — glue code w v1, ekstrakcja do pakietu później.**
  W v1 piszemy `manuals/cpq-billing-integration.md` z gotowym
  przykładem subscribera (~30-50 linijek). Klient (lub my przy
  pierwszym wdrożeniu CPQ+Billing) wkleja to do swojego
  `src/modules/@app/cpq-billing-bridge/`. Gdy pierwszy klient to
  napisze i działa — promujemy kod do osobnego pakietu
  `@dainamite/cpq-billing-bridge`. **Rule:** raz to glue code, drugi
  raz to pakiet (DRY refactor po realnej walidacji, nie premature
  abstraction).
- **Monetyzacja** — wciąż open, do dogrania osobno.

---

## Materiały referencyjne

- **`packages/cpq/MIGRATION.md`** — wzorzec ekstrakcji do
  `@dainamite/*` pakietu (XD-270).
- **`.ai/specs/SPEC-001-...`** — kontekst trzywarstwowej architektury.
- **`node_modules/@open-mercato/core/src/modules/sales/AGENTS.md`** —
  invoice + sequence number patterns z core.
- **`node_modules/@open-mercato/core/AGENTS.md`** — command pattern,
  `withAtomicFlush` (kluczowe dla Bill Run atomicity per account).
- **`node_modules/@open-mercato/queue/AGENTS.md`** — worker contract,
  idempotency, dla Bill Run scheduler.

---

*Doc do dyskusji. Wszystkie sekcje negocjowalne.*
