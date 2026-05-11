# Billing Module (xd-249) — Spec

**Czas czytania:** ~7 min

---

## TL;DR

`@dainamite/billing` to **lightweight silnik rozliczeniowy** dla
aplikacji Open Mercato. Robi jedno: zbiera pozycje do zafakturowania
(recurring / one-time / usage), uruchamia zaplanowany **Bill Run**,
tworzy **draft fakturę**, czeka na zatwierdzenie człowieka, a po
"Post" wystawia ostateczną fakturę z sekwencyjnym numerem.

Może działać standalone (każde źródło danych → REST API) albo
rozszerza CPQ (cienki glue code mapuje eventy CPQ na pozycje
billing'u).

**Czas dostarczenia v1:** 8-11 tygodni solo.
**Pierwsze demo z draftami:** ~5-6 tygodni od startu.

---

## Co kupujesz w v1 *(scope)*

### Funkcjonalnie

- **Recurring billing** — automat liczy miesięczne / kwartalne /
  roczne / tygodniowe opłaty z poziomu Bill Run, nie z góry przy
  zapisie pozycji (zmiana cennika nie wymaga przepisywania historii)
- **One-time charges** — opłaty aktywacyjne, sprzęt, korekty
  manualne, lecą na najbliższą fakturę
- **Lightweight usage rating** — external system pushuje
  pre-aggregated usage (np. "1245 API requests today"), Bill Run
  sumuje i kalkuluje wg tieredich stawek (`volume` / `graduated` /
  `flat`)
- **Proration support** — gdy klient amenduje subskrypcję w trakcie
  cyklu, bridge liczy wartość proporcjonalną (X% × days_remaining /
  days_in_period), billing zapisuje jako pozycję one-time
- **Draft → human verify → post workflow** — każda faktura wymaga
  zatwierdzenia człowieka; sequence number i eventy księgowe lecą
  dopiero po "Post"
- **Manualne triggerowanie Bill Run** — operator może uruchomić ad-hoc,
  dla pojedynczego konta, z dry-run mode (preview bez tworzenia
  draftów)
- **Retry-failed mode** — jak Bill Run wybuchł na jednym koncie,
  pozostałe leciały dalej; operator klika "Retry failed" i engine
  jedzie tylko po tych co padły
- **UI administracyjne** — review draftów (z audytem edycji), Bill
  Run history, CRUD na Account/Item, manual trigger, retry

### Technicznie

- **5 key objects:** Billing Account, Billing Item, Billing Account
  Usage, Bill Run, Invoice (reuse z `@open-mercato/core/sales`)
- **2 konfigurowalne słowniki:** UoM (jednostki miary, global defaults
  + tenant custom), Invoice Sequence Number (per-tenant pattern,
  atomic, bez przeskoków — wymóg ustawy o VAT)
- **11 dedicated ACL features** + 4 default role mappings (admin /
  operator / auditor / usage_writer)
- **Idempotency-first API** — duplicate POST z tym samym
  `source_ref` zwraca istniejący rekord, nie tworzy dubla
- **Multi-tenant native** — wbudowany w Open Mercato, bez wysiłku
  z naszej strony

### Compliance

- **Atomic sequence number** (zgodność z Ustawą o VAT i Dyrektywą
  2006/112/WE — żadnych przeskoków przy concurrent post)
- **VAT** — dziedziczony z `core/sales`
- **Data residency** — wszystkie dane u klienta, nic nie wycieka
- **Audit trail** — edycja draftów audyt'owana (kto / kiedy / co),
  Bill Run history z per-account outcomes
- **GDPR portability** — endpoint zwracający pełen JSON dump per
  klient
- **KSeF (2027)** — przez `core/sales` lub osobny adapter, billing
  nic nie psuje

---

## Czego v1 NIE robi *(out of scope, świadome wybory)*

| Czego brak | Czemu / Co zamiast |
|---|---|
| Własny product catalog | Billing Item ma tekstowy opis + FK string do produktu w innym module |
| Auto-post faktur | Wszystko czeka na human verify; auto-post planowany jako future feature |
| Pełny audit proracji (formuły, snapshots) | Wartość proraty jako Billing Item, formuła w opisie + logach bridge |
| Korekty faktur / storno (credit notes) | v1 = manual przez `core/sales`; dedicated flow jako `@dainamite/billing-credit-notes` add-on |
| Dunning (ponaglenia, zawieszanie usługi) | Osobny add-on `@dainamite/billing-dunning` |
| Portal klienta (klient pobiera fakturę) | Faktura → mail przez event; add-on `@dainamite/billing-portal` |
| Pobieranie płatności | Robi to `payment_gateways` z OM (Stripe, P24 itp.); billing podsłuchuje status |
| Liczenie podatków | `core/sales` ma tax service; billing tylko przekazuje stawki i kwoty |
| Konwersja walut | Każde konto = single-currency; FX poza scope |
| Konwersja UoM | Exact match required (np. `gb` ≠ `mb`); brak konwersji |
| Trial periods jako feature | Robisz przez 2 Billing Items z różnymi rate'ami i datami |
| Pauzowanie subskrypcji jako feature | Ustaw `status='paused'` na Item lub Account |
| Retention policy (auto-purge starych danych) | Soft-delete dostępny; auto-TTL poza scope v1 |
| Mid-run resumption | Atomic per account (transakcja); crash w połowie = operator manual restart |

---

## Decyzje już przyjęte *(nie do dyskusji, ustalone w review 2026-05-11)*

1. **Lightweight + brak własnego catalogu** — Billing Item tylko opis + opcjonalny FK string
2. **Standalone-first** — pakiet nie zależy od CPQ
3. **Kalkulacja w Bill Run** dla recurring/usage (nie z góry przy zapisie)
4. **Draft → human verify → post** dla każdej faktury
5. **Proration math po stronie bridge** (nie billingu)
6. **Lightweight usage** — pre-aggregated upload, exact UoM matching
7. **Bill Run schedulable + self-healing** (atomic per account, retry-failed)
8. **CPQ bridge w v1 = glue code** (manuals + przykład w specu), ekstrakcja do pakietu `@dainamite/cpq-billing-bridge` dopiero gdy pierwszy klient go faktycznie napisze (anty-premature-abstraction)
9. **Korekty out of scope v1** — manual via `core/sales`
10. **Currency mismatch = warning** (nie reject), operator widzi w UI
11. **Brak retention policy w v1** — soft-delete tylko

---

## Plan dostarczania

| Faza | Co | Czas | Demo / Kamień milowy |
|------|---|---|---|
| 0 | Schemat encji + ACL + scaffolding modułu | 1 tydz | Moduł zarejestrowany, baza wstała |
| 1 | REST API: Account/Item CRUD + Usage ingest + idempotency | 2 tyg | Curl walkthrough: register, push charges |
| 2 | Bill Run engine + draft invoices + dry-run | 2-3 tyg | **Pierwsze drafty automatyczne. "Shippable preview".** |
| 3 | Usage rating (simple + tiered) | 1-2 tyg | Klient pushuje usage, engine wycenia |
| 4 | UI admina + post/edit/audit + manuals/cpq-billing-integration.md | 2-3 tyg | **v1 release.** |

**Łącznie:** 8-11 tygodni solo. Pierwszy "to działa" moment po ~5-6 tygodniach (koniec Phase 2).

**Po v1 jako osobne pakiety** (sprzedawane jako add-ony):
- `@dainamite/cpq-billing-bridge` — ekstraktowane z glue code u pierwszego klienta
- `@dainamite/billing-dunning`
- `@dainamite/billing-credit-notes`
- `@dainamite/billing-portal`

---

## Otwarte pytania

### Monetyzacja *(jedyne otwarte pytanie, nie blokuje implementacji)*

Cztery modele do dyskusji:

1. **One-time license + maintenance** (~20-40k PLN license, 20%/rok
   maintenance) — klasyka enterprise
2. **Annual subscription** (~2-5k PLN/mc per tenant) — SaaS-style
3. **% od obrotu** (~0.3-0.5% od fakturowanej kwoty) — jak Stripe
4. **Per-invoice fee** (~0.50 PLN per posted invoice) — jak Maxio

**Moja preferencja:** hybryda 1+2 (license dla enterprise dla
predictable cash, subscription dla SMB dla niskiego progu wejścia).
Decyzja zależy od:
- Typowego customer profile w pierwszych 12 miesiącach
- Strategii: bootstrap-friendly (1) vs growth/MRR (2)
- Czasu inwestowanego w sales (license = długi cykl, subscription =
  krótszy)

**Open dla dyskusji.**

---

## Konkurencja w skrócie

| Cecha | `@dainamite/billing` | Stripe Billing | Chargebee |
|---|---|---|---|
| Recurring billing | ✅ | ✅ | ✅ |
| Lightweight usage | ✅ | ✅ | ✅ |
| Mid-cycle proration | ✅ (bridge) | ✅ | ✅ |
| **Draft → human verify** | ✅ | ❌ auto | ❌ auto |
| Dunning | ❌ v1 | ✅ | ✅ |
| Customer portal | ❌ v1 | ✅ | ✅ |
| **On-prem / sovereign** | ✅ | ❌ | ❌ |
| **Polish VAT (KSeF, JPK)** | ✅ via core/sales | ⚠️ | ⚠️ |
| **No vendor lock-in** | ✅ | ❌ | ❌ |
| Cennik | license + maintenance | % od obrotu | % od obrotu |

**Gdzie wygrywamy:** klient z istniejącą instalacją OM, compliance /
finance teams które chcą human review przed post, klient regulowany
(data residency), klient PL/EU z lokalnymi podatkami.

**Świadomie nie konkurujemy w v1:** B2C masowo z kartami, klienci
usage-heavy z milionami eventów dziennie (potrzebują dedykowanego
metering), klienci bez własnego IT.

---

## Co warto wiedzieć dla decyzji

- **Ryzyko techniczne:** niskie. Wszystkie pattern'y (Bill Run jako
  worker, atomic sequence, draft invoice w sales, idempotency)
  są standardowe w Open Mercato — nie wymyślamy koła.
- **Ryzyko produktowe:** średnie. Draft → human verify jest świadomą
  decyzją — klienci przyzwyczajeni do Stripe (full-auto) mogą
  zapytać "po co kliki?". Odpowiedź: compliance / finance teams
  cenią human-in-the-loop; klienci B2C dla których to overhead są
  poza naszym target market i tak.
- **Ryzyko market:** średnio-niskie. Polski / unijny B2B z
  subskrypcjami + on-prem requirement to wyraźna nisza; nie
  walczymy ze Stripem na ich terenie.

---

## Linki / referencje

- **Architektura modułów `@dainamite/*`:** [SPEC-001](../../.ai/specs/SPEC-001-2026-04-23-module-distribution-architecture.md)
- **Pierwszy pakiet w produkcji (`@dainamite/cpq`):** [packages/cpq/MIGRATION.md](../../packages/cpq/MIGRATION.md)

---

*Doc do dyskusji. Wszystko negocjowalne, w szczególności monetyzacja.*
