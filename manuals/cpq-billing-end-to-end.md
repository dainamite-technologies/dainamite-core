# CPQ ↔ Billing — od oferty do faktury (pełny proces)

Przewodnik krok po kroku przez **cały łańcuch**: od oferty w CPQ, przez
aktywację zamówienia, po fakturę cykliczną w module billing. Mówi, **co
kliknąć** i **gdzie jest styk** obu modułów.

> CPQ **sprzedaje** (oferta → zamówienie → subskrypcja). Billing
> **rozlicza cyklicznie** (konto → pozycje → przebieg → faktura).
> Łącznikiem jest pakiet **`@dainamite/cpq-billing-connector`** —
> nasłuchuje zdarzeń CPQ o subskrypcjach i przekłada je na operacje
> billingowe. Connector jest zarejestrowany w
> [`src/modules.ts`](../src/modules.ts) (po `cpq` i `billing`).

Ten manual jest **spinaczem** dwóch istniejących przewodników — nie
powiela ich:

- CPQ, szczegóły klikania: [`cpq-quote-to-order-conversion.md`](cpq-quote-to-order-conversion.md)
- Billing, szczegóły klikania: [`billing-ui-testing.md`](billing-ui-testing.md)

---

## Zanim zaczniesz

1. Aplikacja uruchomiona (`yarn dev`) — otwórz `http://localhost:3000`.
   Dev runtime musi mieć **uruchomione background services** (worker
   `events` i kolejka) — bez nich styk CPQ→billing nie zadziała.
2. Zaloguj się jako **super admin** i ustaw w prawym górnym rogu
   właściwy **tenant** (dane demo billingu są na tenancie **GIX**).
3. CPQ musi mieć skonfigurowane **oferty** (offerings/specs) na tym
   tenancie.

---

## Jak to działa — łącznik CPQ → Billing

Connector ma 6 subskrybentów zdarzeń CPQ — **wszystkie 6 działają
end-to-end**:

| Zdarzenie CPQ | Co robi connector |
|---|---|
| `cpq.subscription.activated` | zakłada konto billingowe + pozycje |
| `cpq.subscription.amended` | dodaje pozycje + proracja, kończy usunięte |
| `cpq.subscription.renewed` | przedłuża `bill end date`, dodaje nowe pozycje |
| `cpq.subscription.cancelled` | ustawia `bill end date` na pozycjach |
| `cpq.subscription.merged` | przepina pozycje na subskrypcję docelową |
| `cpq.subscription.superseded` | domyka pozycje pominięte przy scaleniu |

**Wniosek praktyczny:** cały handover CPQ → billing jest **automatyczny**.
Nowa sprzedaż zakłada konto + pozycje; zmiany ARC (amend/renew/cancel)
aktualizują pozycje same. Operator tylko **dokańcza dane konta**
(Część 2) i **uruchamia przebieg rozliczeniowy** (Część 3).

> **Proracja przy amend.** Cykl rozliczeniowy zna **billing**, nie CPQ —
> więc kwotę proporcjonalną za część cyklu (przy dodaniu pozycji w
> trakcie cyklu) wylicza **connector** na podstawie cyklu konta. CPQ
> wysyła tylko *co* i *kiedy* się zmieniło.

---

## Część 1 — CPQ: oferta → zamówienie → subskrypcja

Pełna wersja: [`cpq-quote-to-order-conversion.md`](cpq-quote-to-order-conversion.md).
W skrócie:

1. **CPQ → CPQ Quotes → „+ New Quote"** → wybierz klienta.
2. **„Add Offering"** → wybierz ofertę → ilość i konfiguracja →
   **„Add to Quote"**.
3. **„Recalculate"**.
4. Odznaka statusu: `new → Ready → With Customer → Accepted`.
5. **„Convert to Order"** → strona zamówienia (`draft`).
6. **„Activate Order"** → status `active`, link **„View Inventory →"**.
7. Aktywacja wysyła **`cpq.subscription.activated`** → connector
   **automatycznie** zakłada w billingu konto i pozycje.

---

## Część 2 — Dokończ konto rozliczeniowe *(po aktywacji)*

Connector zakłada konto **z danymi zastępczymi** (CPQ nie przekazuje
wszystkich pól fakturowych) — uzupełnij je przed pierwszą fakturą.

1. **Billing → Billing Accounts** — znajdź konto `Customer <id>`.
2. **„Edit"** → popraw: **Name**, **Invoice email**
   (`billing+<id>@invalid.local`), **Invoice address** (`TBD` / `XX`),
   w razie potrzeby **Bill cycle** i **Next bill date** (connector
   ustawia ją na „dziś + 1 miesiąc").
3. **Save changes**.
4. Sekcja **„Items"** — pozycje są już utworzone, z `Subscription ID`.

---

## Część 3 — Przebieg rozliczeniowy → faktura → księgowanie

Szczegóły UI: [`billing-ui-testing.md`](billing-ui-testing.md) sekcje 3–4.

1. **Uruchom przebieg** — w UI nie ma jeszcze przycisku; przez API:

   ```bash
   POST http://localhost:3000/api/billing/runs
   { "mode": "real", "asOfDate": "2026-05-20" }
   ```

2. **Billing → Bill Runs** — otwórz przebieg, sprawdź **outcomes**.
3. **Billing → Billing Invoices** — otwórz fakturę roboczą.
4. **„Post invoice"** — status `draft → posted`.

---

## Część 4 — Zmiany subskrypcji (Amend / Renew / Cancel) — automatycznie

Konto i pozycje już istnieją (Część 1–2), więc dalsze zmiany subskrypcji
płyną do billingu **same**:

1. W CPQ utwórz ofertę typu **Amend**, **Renew** lub **Cancel** dla
   istniejącej subskrypcji (flow ARC — patrz
   [`.ai/skills/cpq/arc/SKILL.md`](../.ai/skills/cpq/arc/SKILL.md)).
2. Zaakceptuj ją → **Convert to Order** → **Activate Order**.
3. Aktywacja zamówienia ARC emituje zdarzenie. Connector je łapie i:
   - **Amend** — tworzy pozycje billingowe dla dodanych opłat; dla
     każdej dodanej opłaty cyklicznej dolicza **pozycję proporcjonalną**
     (`one_time`) za część bieżącego cyklu; usuniętym pozycjom ustawia
     `bill end date = data efektywna − 1 dzień`.
   - **Renew** — przedłuża `bill end date` na pozycjach z terminem,
     dodaje pozycje nowego okresu od `newTermStart`.
   - **Cancel** — ustawia `bill end date` na wszystkich pozycjach
     subskrypcji.
   - **Merge** — przepina pozycje subskrypcji źródłowych na docelową;
     **Supersede** domyka ewentualne pozostałości.
4. Sprawdź w **Billing → Billing Items** (przefiltruj po koncie) —
   pozycje zaktualizowały się bez Twojej ingerencji.

> **Data efektywna.** Operacje ARC nie mają osobnego pola daty — biorą
> moment aktywacji zamówienia ARC jako datę efektywną zmiany.

---

## Co jest automatyczne, a co ręczne

| Etap | Stan |
|---|---|
| Oferta → zamówienie → aktywacja → subskrypcja (CPQ) | ✅ w CPQ |
| Nowa sprzedaż → konto + pozycje billingowe | ✅ **automatycznie** |
| Uzupełnienie danych fakturowych na koncie | ✍️ ręcznie (Część 2) |
| Amend / Renew / Cancel / Merge → aktualizacja billingu | ✅ **automatycznie** |
| Przebieg rozliczeniowy (bill run) | ⚙️ API / cron |
| Przegląd i zaksięgowanie faktury | ✅ w UI billingu |

---

## Rozwiązywanie problemów

- **Po aktywacji nie pojawiło się konto/pozycje (nowa sprzedaż lub ARC).**
  Sprawdź background services (`yarn dev` → worker `events` + kolejka) —
  connector działa na kolejce persystentnej; oraz czy oglądasz właściwy
  tenant.
- **Connector nie połączył klienta.** `Customer ID` na koncie
  billingowym musi być identyczny z ID klienta w CPQ — to jedyny klucz
  łączący.
- **ARC nie zaktualizował pozycji.** Pozycje muszą mieć `Subscription ID`
  zgodne z subskrypcją CPQ (connector ustawia je przy aktywacji).
- **Przebieg nie utworzył faktury.** Konto musi mieć `Next bill date`
  w przeszłości (lub równą `asOfDate`) i aktywną, należną pozycję.
