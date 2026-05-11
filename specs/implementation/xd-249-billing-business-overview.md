# Billing Module (xd-249) — Business Overview

**Typ dokumentu**: Product overview do review z cofounderem
**Data**: 2026-04-26 (revised 2026-05-11 — lightweight scope)
**Status**: Draft do akceptacji

---

## TL;DR

`@dainamite/billing` to **lightweight silnik rozliczeniowy** dla aplikacji
opartych na Open Mercato. Trzyma listę pozycji do zafakturowania
(`Billing Items`), uruchamia `Bill Run` w zaplanowanym oknie (codziennie /
tygodniowo / miesięcznie), kalkuluje opłaty i produkuje **draft invoice**.
Człowiek weryfikuje draft i go zatwierdza ("post") — dopiero wtedy
faktura ląduje w księgowości.

Może działać **standalone** (klient podpina dowolne źródło subskrypcji
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
3. **Charges calculate during bill run, NOT on item creation.** Tworząc
   Billing Item dla przyszłych okresów **nie liczymy** ceny z góry.
   Bill Run czyta aktualne stawki w momencie wystawienia faktury — to
   pozwala zmieniać pricing bez przepisywania historycznych itemów.
4. **Draft invoices, human verifies, then post.** Bill Run nigdy nie
   wystawia "final" faktury automatycznie. Wszystko ląduje jako `draft`,
   operator finansowy ręcznie zatwierdza ("post") — dopiero wtedy
   numeracja sekwencyjna, eventy księgowe, etc.
5. **Proration TAK, ale lightweight.** Wspieramy prorata (np. amend w
   trakcie cyklu → dopłata proporcjonalna). **Nie** budujemy osobnych
   tabel z formułami / audytem proracji. Wartość proracji ląduje
   bezpośrednio jako Billing Item z odpowiednim opisem ("Proration:
   {item} from {date} to {date}"). Detaliczny audit można odczytać z
   logów Bill Runu.
6. **Lightweight usage handling.** External system uploaduje
   pre-aggregated usage do `Billing Account Usage` (np. "customer X
   used 753k input tokens between 2026-02-23 and 2026-02-25"). Bill
   Run czyta to przy następnym uruchomieniu i rate'uje zgodnie z
   cennikiem zdefiniowanym w Billing Item typu `usage`.
7. **Bill Run jest schedulable.** Cron-like trigger (codziennie /
   tygodniowo / miesięcznie). Plus manual trigger przez UI / API.
8. **Bill Run self-heals.** Jeśli wybuchnie na jednym Billing Account
   — pozostałe lecą dalej. Można re-run cały Bill Run lub tylko
   failed items.

---

## Key objects

### Billing Account
Grupa pozycji do zafakturowania razem (typowo: jeden klient =
jedno konto). Definiuje:
- `bill_cycle` — monthly / quarterly / annually / weekly
- `bill_cycle_day` — kotwica okresu (1-28 lub day-of-week)
- `invoice_data` — adres, tax id (NIP), waluta domyślna, język
- `next_bill_date` — kiedy następny Bill Run zafakturuje to konto
- Status: `active` / `paused` / `closed`

### Billing Item
Pojedyncza linia do zafakturowania. Sercem modułu.
- `bill_account_id` — do którego konta
- `type` — `one_time` / `recurring` / `usage`
- `bill_start_date`, `bill_end_date` (nullable — open-ended)
- `description` — tekstowy opis pojawiający się na fakturze
- `rate` lub `rate_json` — prosta cena LUB JSON dla skomplikowanych
  stawek (tiered, volume, graduated)
- `uom_code` (tylko dla `usage`) — code z UoM dictionary
- `subscription_id`, `subscription_item_id` — nullable FK string,
  pozwala bridge'owi CPQ tracować skąd item przyszedł

> **CPQ integration note:** Jeśli CPQ subscription item ma jednocześnie
> one-time charge (np. aktywacja) i recurring charge (np. MRC),
> bridge tworzy **dwa osobne Billing Items** (`type=one_time` +
> `type=recurring`) wskazujące na ten sam `subscription_item_id`.

### Billing Account Usage
Bucket dla pre-aggregated usage. External system robi POST z
payloadem:
- `bill_account_id`
- `uom_code` — co liczymy
- `quantity` — ile zużyto
- `period_start`, `period_end` — w jakim oknie
- `source_ref` — własny ID po stronie external (idempotency)

Bill Run łączy ten zapis z Billing Item typu `usage` o pasującym
`uom_code` i zakresie dat → tworzy linię na fakturze.

### Bill Run
Pojedyncze uruchomienie engine'u. Trzyma:
- `triggered_by` — schedule / manual / api
- `started_at`, `finished_at`
- `summary` — # processed accounts, # invoices drafted, # failures
- Per-account outcomes (`success` / `failed` z error message)
- Może być **restarted** (cały) lub **retried** (tylko failed items)

### Invoice
Już istnieje w `@open-mercato/core/sales`. Billing nie wymyśla swojego —
tworzy draft invoice w sales i podlinkowuje Billing Items jako invoice
lines. Status `draft` → operator klika "post" w UI → status `posted`,
sequence number nadany.

---

## Configurable elements

### Unit of Measure (UoM)
Konfigurowalny słownik z globalnymi defaultami (`hour`, `day`,
`gb`, `request`, `token`, `seat`, `device`) plus tenant-specific
custom values (każdy tenant może dodać własne, np. `input_token`,
`active_user`). Zarządzany przez moduł `dictionaries` z core.

### Invoice Sequence Number
Per-tenant konfigurowalna sekwencja numeracji faktur. Pattern z
placeholderami (np. `FV/{YEAR}/{MONTH}/{NNNN}`), reset cycle
(yearly / monthly / never). Atomic increment przez upsert SQL, brak
przeskoków (wymóg ustawy o VAT).

---

## Flow end-to-end

1. **Setup.** Operator tworzy Billing Account dla klienta (ręcznie w
   UI lub przez API z bridge'a). Definiuje cycle, billing day, dane do
   faktury.
2. **Pozycje wpadają.** Bridge CPQ→Billing (lub manualny POST) tworzy
   Billing Items: recurring MRC, opłaty aktywacyjne, charge'y proracji
   po amendzie.
3. **External system pushuje usage** (jeśli relevant) do Billing
   Account Usage.
4. **Bill Run.** Cron triggeruje codziennie 02:00. Engine znajduje
   Billing Accounts gdzie `next_bill_date <= today`, dla każdego
   zbiera relevantne Billing Items + usage records, kalkuluje sumy,
   tworzy **draft invoice**, ustawia kolejny `next_bill_date`.
5. **Operator review.** Rano operator otwiera listę draftów. Widzi
   per-faktura: linie, sumy, klient, anomalie. Może edytować
   ręcznie (drop linii, zmienić quantity) lub odrzucić cały draft.
6. **Post.** Klik "Post invoice" → sequence number, status `posted`,
   eventy lecą (do księgowości, do mailingu).
7. **Re-run.** Jeśli Bill Run wybuchł na jakimś koncie — operator
   widzi w summary, klika "Retry failed" — engine leci tylko po
   tych co failowały.

---

## Co billing **nie robi** (granice produktu)

- **Brak własnego product catalogu.** Billing Item ma tekstowy opis,
  ewentualnie FK do produktu w innym module (CPQ / catalog).
- **Brak automatycznego postowania faktur.** Wszystko czeka na
  human review. *(Może być przyszłą feature — `auto_post: true` per
  Billing Account dla tenants z dużym wolumenem zaufanych
  pozycji. Nie v1.)*
- **Brak pełnego audit trail proracji.** Wartość proracji idzie jako
  Billing Item, formuła w logach Bill Runu. Bez dedykowanej tabeli
  proration events.
- **Brak dunning.** Faktura wyszła i koniec. Pilnowanie zapłaty +
  ponaglenia + zawieszanie usługi to osobny przyszły moduł.
- **Brak portalu klienta.** Klient nie loguje się żeby zobaczyć
  faktury. Faktura idzie mailem (przez event).
- **Brak pobierania płatności.** To moduł `payment_gateways` z OM
  (Stripe, Przelewy24). Billing widzi status zapłaty, nie zarządza.
- **Brak liczenia podatków.** VAT/exempty załatwia tax service z
  `core/sales`.
- **Brak konwersji walut.** Każde Billing Account jest single-currency.
- **Brak trial periods jako odrębna feature.** Jeśli chcesz discounted
  okres → tworzysz Billing Item z odpowiednim `rate` i `bill_end_date`,
  potem drugi Item z normalnym rate'em od następnego dnia.
- **Brak pauzowania subskrypcji.** "Wstrzymaj rozliczenie" = ręcznie
  ustaw `bill_end_date` na Billing Items.

---

## Persony

- **Finance operator** (rola `admin` lub `billing.*` w OM) — codziennie
  rano weryfikuje draft invoices, postuje, retry-uje failed runs,
  edytuje Billing Items gdy coś trzeba poprawić.
- **Integrator techniczny** (developer u klienta lub my przy CPQ
  bridge) — pisze cienki bridge: subscription event → POST /billing-items.
- **External usage system** — autonomiczny push usage data do
  `Billing Account Usage` endpoint przez API key.

---

## Trzy historie end-to-end (Netia / CPQ bridge)

### Historia 1 — nowy klient kupuje internet 100/100
W CPQ klient akceptuje quote, CPQ aktywuje subskrypcję. Bridge wykrywa
aktywację, woła billing API: tworzy Billing Account dla klienta (jeśli
nie istnieje) + dwa Billing Items dla subskrypcji: `recurring` MRC
49.99 EUR/mc oraz `one_time` opłatę aktywacyjną 99 EUR.

1 czerwca o 02:00 Bill Run znajduje to konto, tworzy **draft invoice**
zawierający 49.99 + 99 = 148.99 EUR. Rano operator otwiera draft,
weryfikuje, klika "Post" — faktura dostaje numer `FV/2026/06/0123`,
status `posted`, event leci do system mailingowego.

### Historia 2 — klient dorzuca usługę w trakcie miesiąca
15 maja klient kupuje pakiet TV (29 EUR/mc) w CPQ. Bridge robi POST:
nowy Billing Item `recurring` z `bill_start_date: 2026-05-15` plus
Billing Item `one_time` z opisem "Proration: TV from 2026-05-15 to
2026-05-31" i wartością 29 × 17/31 = 15.90 EUR (bridge kalkuluje
prorata, billing tylko zapisuje pozycję).

1 czerwca Bill Run tworzy draft z: stary MRC 49.99 + nowe TV za pełny
czerwiec 29 + proration 15.90 = 94.89 EUR. Operator weryfikuje i
posta.

### Historia 3 — usage-based billing
Klient ma SaaS-owy plan: 49 EUR flat + 0.001 EUR za każdy API request
ponad 10k. Tworzymy dwa Billing Items: `recurring` 49 EUR oraz `usage`
z rate'em definiującym tiering (`rate_json`) i `uom_code: api_request`.

W ciągu miesiąca external system robi codzienne POST-y do `Billing
Account Usage` (np. "yesterday: 1245 requests"). 1 czerwca Bill Run
sumuje usage z maja: 53k requests. Rate'uje: pierwsze 10k free, kolejne
43k × 0.001 = 43 EUR. Draft invoice: 49 + 43 = 92 EUR. Operator
weryfikuje.

---

## Compliance & regulatory

- **Numeracja faktur unikalna, atomowa, bez przeskoków** — wymaganie
  Ustawy o VAT i Dyrektywy 2006/112/WE.
- **VAT pełnoprawny** — dziedziczony z `core/sales`.
- **Audit trail** — każdy Bill Run loguje per-account outcome.
  Każdy invoice post emituje persisted event. Spory rozstrzygalne z
  bazy.
- **Data residency** — billing trzyma dane w bazie klienta. Atut dla
  sektora regulowanego.
- **GDPR-ready** — moduł nie loguje PII w eventach.
- **Idempotency-first API** — `source_ref` na Billing Items i Usage
  records zapobiega podwójnemu naliczeniu przy retry.

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
| 0 | Schemat encji + ACL + scaffolding modułu. Brak logiki. | 1 tydzień |
| 1 | REST API: Billing Account, Billing Item CRUD. UoM dictionary. | 1-2 tygodnie |
| 2 | Bill Run engine: schedulable, processes recurring + one-time items, tworzy draft invoices. | 2-3 tygodnie |
| 3 | Usage handling: ingestion endpoint + rate'owanie w Bill Run. | 1-2 tygodnie |
| 4 | UI admina: draft invoice review + post, Bill Run history, retry failed, manual triggers. **v1 release**. | 2 tygodnie |

**Łącznie:** ~7-10 tygodni solo. Pierwsze demo z draftowymi fakturami:
~koniec Phase 2 (4-5 tygodni od startu).

**Po v1:** osobne pakiety jako add-ony (nie w v1):
- `@dainamite/cpq-billing-bridge` — formalna integracja CPQ ↔ Billing
- `@dainamite/billing-dunning` — overdue tracking, ponaglenia
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
- Pierwsze draft invoices generują się w Netii w ciągu 8-10 tygodni.
- Bill Run idempotentne: re-run nie generuje duplikatów.
- Integration tests > 95% coverage.

**Tier 2 — produkt u klienta:**
- Netia używa go produkcyjnie do ≥ 100 aktywnych Billing Accounts
  przez ≥ 30 dni.
- 0 ręcznych korekt z powodu błędu billingu.
- Operator finansowy potwierdza pisemnie oszczędność czasu vs
  poprzedniego procesu.

**Tier 3 — skala:**
- 2-3 klienci poza Netią używają standalone (bez CPQ).
- Bridge `@dainamite/cpq-billing-bridge` wdrożony u ≥ 1 klienta poza
  Netią.

**Anti-metrics:**
- > 1% draftów wymaga ręcznej korekty linii.
- > 5% Bill Account-ów kończy Bill Run statusem `failed`.
- Czas onboardingu nowego klienta > 2 tygodnie.

---

## Co potwierdzić przed Phase 0

1. **Lightweight scope** — czy te key objects (Account, Item, Usage,
   Run, Invoice ref) wystarczają? Czy czegoś brakuje?
2. **Draft → post flow** — czy human-in-the-loop na każdej fakturze
   jest must-have, czy chcemy `auto_post: true` per Billing Account w
   v1?
3. **CPQ integration** — czy osobny `cpq-billing-bridge` package w
   v1, czy tylko documented patterns dla integratora?
4. **Pierwszy klient walidacyjny** — Netia/CPQ jak w XD-270, czy
   szukamy drugiego klienta dla standalone validation już teraz?
5. **Monetyzacja** — do dogrania.

---

## Materiały referencyjne

- **`packages/cpq/MIGRATION.md`** — wzorzec ekstrakcji do
  `@dainamite/*` pakietu (XD-270).
- **`.ai/specs/SPEC-001-...`** — kontekst trzywarstwowej architektury.
- **`node_modules/@open-mercato/core/src/modules/sales/AGENTS.md`** —
  invoice + sequence number patterns z core.

---

*Doc do dyskusji. Wszystkie sekcje negocjowalne.*
