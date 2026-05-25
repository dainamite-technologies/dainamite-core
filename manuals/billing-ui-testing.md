# Billing — manual testowania UI

Przewodnik krok po kroku: **co kliknąć**, żeby przejść przez cały moduł
billing w panelu admina. Każdy krok mówi, co kliknąć i co powinieneś
zobaczyć. Nie ma tu komend do wpisywania — po prostu klikasz po systemie.

> Billing to silnik rozliczeń cyklicznych: **konta** mają **pozycje**
> (jednorazowe / cykliczne / wg zużycia), **przebieg rozliczeniowy**
> zamienia należne pozycje na **faktury robocze**, a operator je
> sprawdza i **księguje**.

---

## Zanim zaczniesz

1. Aplikacja musi być uruchomiona — otwórz w przeglądarce
   `http://localhost:3000`.
2. Zaloguj się: e-mail **`admin@acme.com`**, hasło **`secret`**.
3. Dane testowe są już wgrane: **5 firm**, **10 pozycji**,
   **1 przebieg rozliczeniowy** i **3 faktury robocze**. Jeśli ich nie
   ma — patrz „Reset danych" na końcu.

## Jak wejść do billingu

W menu po lewej stronie przewiń w dół do grupy **Billing**. Są w niej
cztery pozycje:

| Pozycja menu | Co to |
|---|---|
| **Billing Accounts** | Konta rozliczeniowe (klienci) |
| **Billing Items** | Pozycje — usługi i opłaty na koncie |
| **Billing Invoices** | Faktury wygenerowane przez billing |
| **Bill Runs** | Przebiegi rozliczeniowe |

Gdyby grupy „Billing" nie było widać — odśwież stronę (menu jest
cache'owane).

---

## 1. Konta rozliczeniowe (Billing Accounts)

### 1a. Przeglądanie listy
1. Kliknij w menu **Billing → Billing Accounts**.
2. Zobaczysz **5 kont**: Acme Telecom, Globex Networks, Initech Cloud,
   Contoso Analytics, Northwind Studio.
3. Sprawdź, że kolumny są wypełnione — *Currency* (PLN / EUR),
   *Cycle* (np. `monthly · 1`), *Next bill*, *Status*.
4. W pole **Search** u góry wpisz `Acme` — lista zawęża się do jednego
   konta. Wyczyść pole, żeby wrócić do pełnej listy.
5. Kliknij **Filters** → ustaw *Currency* = `EUR` → kliknij **Apply**.
   Zostają 2 konta (Initech, Contoso). Wyczyść filtr.
6. Kliknij ikonę odświeżania (↻, prawy górny róg karty) — lista się
   przeładowuje.

### 1b. Tworzenie konta
1. Kliknij **New account** (prawy górny róg).
2. W polu *Customer* zacznij wpisywać nazwę klienta (np. `Acme`) — pod
   spodem pojawi się lista pasujących firm pobrana z modułu Customers.
   Wybierz właściwego klienta strzałkami / kliknięciem (Enter zatwierdza).
3. *Name* uzupełni się automatycznie nazwą wybranego klienta. Zostaw tak
   albo nadpisz, jeśli jeden klient ma kilka kont billingowych
   (np. „Acme — produkcja" / „Acme — testy").
4. Wypełnij pozostałe pola: *Currency* (np. `PLN`), *Bill cycle*,
   *Cycle anchor* (`1`), *Invoice email*, adres faktury (*Line 1* + *City*
   + *Postal code* + *Country*) oraz *Next bill date*.
5. Kliknij **Create account** (albo wciśnij `Ctrl/Cmd + Enter`).
6. Wracasz na listę — nowe konto jest na niej widoczne.

### 1c. Szczegóły, edycja, usuwanie
1. Kliknij wiersz konta **Acme Telecom** (albo link **Open** po prawej).
2. Otwiera się strona szczegółów — w nagłówku nazwa konta, niżej
   formularz wypełniony danymi konta.
3. Zmień np. *Invoice email* i kliknij **Save changes** — u dołu
   pojawia się zielony komunikat o zapisie.
4. Kliknij **View items** — przejdziesz do listy pozycji odfiltrowanej
   do tego konta.
5. Wróć (strzałka ← w nagłówku) i kliknij **Add item** — otworzy się
   formularz nowej pozycji z już wybranym kontem.
6. Wróć i kliknij **Soft delete** → potwierdź w oknie dialogowym →
   konto znika z listy (jego pozycje zostają w bazie do audytu).

## 2. Pozycje rozliczeniowe (Billing Items)

### 2a. Przeglądanie listy
1. Kliknij **Billing → Billing Items** — zobaczysz **10 pozycji**.
2. Kolumna *Type* pokazuje tag: `recurring`, `one_time` lub `usage`.
3. W pole **Search** wpisz fragment opisu, np. `Hosting` — lista
   filtruje po opisie.
4. Kliknij **Filters** → *Type* = `recurring` → **Apply**.

### 2b. Tworzenie pozycji
1. Kliknij **New item**.
2. Wybierz **Billing Account** z listy.
3. Wybierz **Type** — od tego zależą kolejne pola:
   - **One-time charge** → pole *Amount*.
   - **Recurring (per cycle)** → pole *Unit price per cycle*.
   - **Usage (metered)** → pole *UoM code* (np. `gb`, `api_request`)
     oraz *Rate model*: `Simple flat rate` (jedna stawka) lub
     `Tiered` (JSON progowy — volume / graduated / flat).
4. Wpisz *Description* i *Bill start date*.
5. Kliknij **Create item**.

### 2c. Szczegóły pozycji
1. Kliknij wiersz pozycji (lub **Open**) → strona szczegółów.
2. W nagłówku opis pozycji i tagi (typ, ewentualnie „Currency
   mismatch" albo „Billed through…").
3. Zmień stawkę lub opis i kliknij **Save changes**.

## 3. Faktury (Billing Invoices)

Na tej liście są **tylko faktury wygenerowane przez billing** (przez
przebieg rozliczeniowy) — zwykłe faktury sprzedaży się tu nie pokazują.

### 3a. Przeglądanie listy
1. Kliknij **Billing → Billing Invoices** — zobaczysz **3 faktury
   robocze** (status `draft`).
2. Kolumny: *Number*, *Status*, *Period*, *Total*, *Outstanding*,
   *Issued*.
3. Kliknij **Filters** → *Status* = `draft`.

### 3b. Szczegóły i edycja pozycji faktury
1. Kliknij wiersz faktury → strona szczegółów.
2. W nagłówku: numer faktury, status, okres rozliczeniowy oraz
   powiązany przebieg i konto.
3. Pod nagłówkiem kafelki kwot — *Subtotal net*, *Grand total*,
   *Paid*, *Outstanding*.
4. Sekcja **Lines** — pozycje faktury.
5. Kliknij **Add line** → wpisz opis, ilość i cenę → zatwierdź. Sumy
   przeliczają się automatycznie.
6. Najedź na pozycję w tabeli i kliknij ikonę ołówka (edycja) albo
   kosza (usunięcie). Każda zmiana trafia do dziennika audytu.

### 3c. Zaksięgowanie faktury
1. Na stronie szczegółów faktury roboczej kliknij **Post invoice**.
2. Status zmienia się z `draft` na `posted` i pojawia się komunikat
   potwierdzający.

## 4. Przebiegi rozliczeniowe (Bill Runs)

Przebieg skanuje konta, którym minął termin rozliczenia, i tworzy z ich
należnych pozycji faktury robocze.

### 4a. Lista i szczegóły
1. Kliknij **Billing → Bill Runs** — jest **1 przebieg** (status
   **Completed**).
2. Kliknij wiersz → strona szczegółów.
3. W nagłówku status przebiegu; niżej siatka pól (trigger, data,
   czasy) i kafelki podsumowania (konta, faktury, błędy…).
4. Tabela **Per-account outcomes** — 3 konta, status **success**,
   każde z numerem utworzonej faktury.
5. Gdyby któreś konto miało status **failed**, w nagłówku pojawia się
   przycisk **Retry failed accounts** — uruchamia nowy przebieg tylko
   dla nieudanych kont.

### 4b. Nowy przebieg
1. Na liście **Bill Runs** kliknij **New run** (prawy górny róg).
2. W dialogu wybierz **Mode**:
   - **Real** — tworzy faktury robocze (`draft`), normalny przebieg.
   - **Dry-run** — symulacja, nic nie zapisuje. Dobre do sprawdzenia
     „co by się zafakturowało".
   - **Test** — tworzy faktury oznaczone do późniejszego usunięcia
     (przydatne na środowisku QA/demo).
3. **As-of date** — domyślnie dzisiaj. Konta z `next_bill_date` ≤ tej
   daty zostaną wybrane.
4. **Run now** (albo `Ctrl/Cmd + Enter`) — po sukcesie przeskakujesz na
   stronę szczegółów nowo utworzonego przebiegu.

Harmonogram cron uruchamia analogiczny przebieg co noc w trybie
`real`. Przycisk **New run** to ten sam endpoint, tylko z trigger
`manual`.

## 5. Szybki scenariusz end-to-end (~5 minut)

1. **Billing Accounts** → otwórz **Acme Telecom** → sprawdź, że
   formularz jest wypełniony danymi.
2. **Billing Items** → przefiltruj *Type* = `usage` → otwórz pozycję
   „Transfer danych ponad limit".
3. **Bill Runs** → otwórz przebieg → zobacz 3 udane wyniki, każdy z
   numerem faktury.
4. **Billing Invoices** → otwórz fakturę → kliknij **Add line**, dodaj
   pozycję → zobacz przeliczone sumy → kliknij **Post invoice**.

---

## 6. Pełny scenariusz: CPQ Quote → Order → Subskrypcja → Billing (~10 minut)

Ten scenariusz pokazuje **co się dzieje w billingu, kiedy w CPQ
aktywujesz nowy order**.

> **Uwaga o nazewnictwie:** event który łączy CPQ z billingiem nazywa
> się `cpq.subscription.activated`, ale **nie jest** sygnałem „status
> subskrypcji zmienił się na *active*". To jest „onboarding nowego
> orderu" — odpala się raz, w momencie kliknięcia *Activate Order*
> w CPQ, **zanim** subskrypcja jeszcze ruszy. Sama subskrypcja powstaje
> w statusie **`pending`** i jej późniejsza tranzycja `pending → active`
> (z UI subskrypcji) **niczego po stronie billingu nie robi** — billing
> dostał już wszystko, co potrzeba, z activate-order.

Konektor `cpq-billing-connector` na ten event:

1. zakłada (lub odnajduje) **Billing Account** dla danego customera,
2. dla każdego *charge'a* na pozycjach subskrypcji tworzy odpowiedni
   **Billing Item** (`recurring` / `one_time` / `usage`),
3. nowo utworzone konto dostaje „shell" defaulty (placeholder e-mail,
   `next_bill_date` = dziś + 1 miesiąc), żeby Bill Run **nie** zafakturował
   go zanim operator nie dokończy konfiguracji.

### 6a. Część CPQ — quote → order → activate

Pełny przewodnik po stronie CPQ siedzi w
[`cpq-quote-to-order-conversion.md`](cpq-quote-to-order-conversion.md).
W skrócie:

1. **CPQ → CPQ Quotes → + New Quote** → wybierz dowolnego customera
   (zapisz sobie jego nazwę — zaraz znajdziesz go po stronie billingu).
2. **Add Offering** → wybierz produkt z MRC (np. *GIX Access Port
   Standard*), ustaw *Quantity* `1` i wypełnij konfigurację → **Add to
   Quote**.
3. Kliknij badge statusu quote'a i przeprowadź go przez: **Ready** →
   **With Customer** → **Accepted**.
4. **Convert to Order** → otworzy się strona orderu w statusie *draft*.
5. **Activate Order** (zielony przycisk). Status orderu zmieni się na
   *active* i pojawi się link **View Inventory →** — tu kończy się
   część CPQ.

W tym momencie konektor już wystrzelił `cpq.subscription.activated`,
mimo że jeśli klikniesz **View Inventory →**, sama **subskrypcja** jest
jeszcze w statusie **`pending`** (chip *Pending* przy nazwie). To jest OK
— billing dostaje swoje rzeczy z activate-order, nie z transition
subskrypcji. Subskrypcję możesz potem przełączyć na *active* z jej
strony szczegółów, ale po stronie billingu nic się od tego nie zmieni.

### 6b. Weryfikacja po stronie billingu

1. **Billing → Billing Accounts** — na górze listy powinno pojawić się
   nowe konto z nazwą wybranego customera (status *Active*, *Currency*
   z quote'a, *Cycle* domyślnie `monthly · 1`, *Invoice email* placeholder
   typu `billing+<uuid>@placeholder.invalid` — to znak, że to shell-konto).
2. Kliknij wiersz → strona szczegółów konta → przewiń do sekcji **Items**.
   Powinny tam być pozycje odpowiadające liniom orderu:
   - line z MRC → **Billing Item** typu `recurring` z *Unit price per cycle*,
   - line z NRC → **Billing Item** typu `one_time` z *Amount*,
   - line z metered → **Billing Item** typu `usage` z *UoM*.
3. Kliknij dowolny item → w nagłówku w polu *Source ref* zobaczysz
   deterministyczny klucz idempotencji w formacie
   `cpq-<subscriptionId>-<subscriptionItemId>-<chargeType>`. To jest
   sygnatura zdarzenia z CPQ — po niej konektor rozpoznaje duplikaty.

### 6c. Dokończ konfigurację konta i wyfakturuj

> **Dlaczego nie wystarczy „odpalić Bill Run dzisiaj":** billing jest
> w arrears (z dołu) — dla konta z `next_bill_date = dziś` engine
> wylicza okres `[dziś − 1 cykl → wczoraj]` i szuka itemów, które się
> w nim mieszczą. Twoje Billing Items utworzone przez konektor mają
> `bill_start_date = dziś` — wypadają **poza** ten okres, więc run
> przejdzie pomyślnie, ale **z zerową liczbą draftów**. Dopiero okres
> obejmujący `dziś` zafakturuje nowe pozycje.

Najprostsza ścieżka demo (rozliczamy pierwszy cykl „z góry"):

1. (Opcjonalnie) Na stronie szczegółów konta kliknij **Edit** i popraw
   *Invoice email* na realny — placeholder `billing+<uuid>@placeholder.invalid`
   rzuca się w oczy. *Next bill date* zostaw — connector ustawił go na
   `dziś + 1 miesiąc` i to jest właściwa wartość dla pierwszego cyklu.
2. **Billing → Bill Runs** → **New run** (prawy górny róg). W dialogu:
   - *Mode* = `Real`.
   - *As-of date* = **`next_bill_date` konta** (czyli dziś + 1 miesiąc;
     podejrzysz dokładną wartość w szczegółach konta).
   - **Run now** (`Ctrl/Cmd + Enter`).

   Konto zostanie wybrane (bo `next_bill_date ≤ as-of`), a wyliczony
   okres `[dziś → dziś + 1 miesiąc − 1]` obejmie `bill_start_date`
   itemów → engine wygeneruje draft.
3. Strona szczegółów przebiegu: status **Completed**, w **Per-account
   outcomes** twoje konto ze statusem **success** i klikalnym numerem
   utworzonej faktury.
4. **Billing Invoices** (lub klik w numer faktury z poprzedniego kroku)
   → sekcja **Lines** zawiera linie wygenerowane z Billing Items
   (recurring MRC za cały okres, NRC jednorazowo). Kliknij **Post
   invoice** — status przechodzi z `draft` na `posted` i kończy ścieżkę.

> **Wskazówka:** jeśli już raz odpaliłeś Bill Run dzisiaj z domyślnym
> *As-of date*, twoje konto przeleciało jako *success* ale bez draftu,
> a `next_bill_date` przeskoczył o cykl dalej. Po prostu odpal kolejny
> run z poprawionym *As-of date* — to ten sam zabieg co wyżej, engine
> nie zduplikuje niczego (idempotencja na poziomie okresu).

### 6d. (Opcjonalnie) Ponowna aktywacja — sprawdzenie idempotencji

Wróć do CPQ, otwórz ten sam quote i kliknij **Convert to Order** raz
jeszcze (CPQ pozwala na wiele orderów z jednego quote'a — patrz Step 11
w manualu CPQ), potem aktywuj go. **Billing Items** na koncie **nie**
powinny się zduplikować — konektor rozpoznaje `source_ref` i pomija
istniejące pozycje (`deduplicated: true` w odpowiedzi API).

---

## Reset danych testowych *(operacja techniczna — opcjonalna)*

Jeśli chcesz wyczyścić billing i wgrać dane od nowa, w terminalu:

```bash
# 1. wyczyść tabele billingu
docker exec dainamite-core-postgres-1 psql -U postgres -d open-mercato -c "
DELETE FROM sales_invoice_lines WHERE invoice_id IN (SELECT id FROM sales_invoices WHERE jsonb_exists(metadata,'bill_run_id'));
DELETE FROM sales_invoices WHERE jsonb_exists(metadata,'bill_run_id');
DELETE FROM billing_run_outcomes; DELETE FROM billing_runs;
DELETE FROM billing_account_usage; DELETE FROM billing_items; DELETE FROM billing_accounts;"

# 2. wgraj dane demo na nowo (aplikacja musi działać)
node packages/billing/scripts/seed-demo.mjs
```

Skrypt tworzy 5 firm, 10 pozycji, rekordy zużycia i jeden przebieg
rozliczeniowy z fakturami — wszystko przez REST API.
