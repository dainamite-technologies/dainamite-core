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
2. W przełączniku *Customer type* wybierz **Company** (firma, B2B) albo
   **Person** (osoba prywatna, B2C). Od tego zależy, w której liście
   modułu Customers szukamy klienta.
3. W polu *Company* / *Person* zacznij wpisywać nazwę klienta (np. `Acme`
   albo `Kowalski`) — pod spodem pojawi się lista pasujących klientów.
   Wybierz właściwego strzałkami / kliknięciem (Enter zatwierdza).
4. Puste pola uzupełnią się z karty klienta: *Name* (nazwa klienta),
   *Invoice email* (główny e-mail) i adres faktury (adres główny klienta).
   Pola, które już wpisałeś, **nie są nadpisywane**. Zmiana klienta albo
   typu cofa tylko te uzupełnienia, których nie edytowałeś.
5. *Name* zostaw albo nadpisz, jeśli jeden klient ma kilka kont
   billingowych (np. „Acme — produkcja" / „Acme — testy").
6. *Invoice language* wybierz z listy (**English** / **Polski**) — to
   języki, w których potrafi drukować szablon faktury.
7. Uzupełnij resztę: *Currency* (np. `PLN`), *Bill cycle*, *Cycle anchor*
   (`1`), brakujące pola adresu oraz *Next bill date*. *Tax ID* jest
   opcjonalne (osoby prywatne zwykle go nie mają).
8. Kliknij **Create account** (albo `Ctrl/Cmd + Enter`; `Esc` anuluje).
9. Wracasz na listę — nowe konto jest widoczne, w kolumnie *Customer*
   nazwa klienta z ikoną budynku (firma) albo sylwetki (osoba). Filtr **Customer type**
   zawęża listę do firm albo osób.

### 1c. Szczegóły, edycja, usuwanie
1. Kliknij wiersz konta **Acme Telecom** (albo link **Open** po prawej).
2. Otwiera się strona szczegółów — w nagłówku nazwa konta, niżej
   formularz wypełniony danymi konta.
3. Zmień np. *Invoice email* i kliknij **Save changes** — u dołu
   pojawia się zielony komunikat o zapisie.
4. Kliknij **View items** — przejdziesz do listy pozycji odfiltrowanej
   do tego konta.
5. Wróć (strzałka ← w nagłówku) i kliknij **Add item** — otworzy się
   formularz nowej pozycji z już wybranym kontem. Po **Create item**
   (albo **Cancel**) wracasz **na stronę tego konta**, nie na listę pozycji.
6. Na stronie konta kliknij pozycję w tabeli *Items* — strzałka ← w
   nagłówku pozycji, a także usunięcie pozycji, prowadzą z powrotem
   **do konta**. W polu *Customer* nazwa klienta jest linkiem do jego
   karty w module Customers.
7. Wróć i kliknij **Soft delete** → potwierdź w oknie dialogowym →
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
   - **Recurring (per cycle)** → pole *Unit price per cycle*, a także
     *Charge timing* (**In advance** — w dniu rozliczenia naliczany jest
     nadchodzący okres, domyślnie; **In arrears** — okres, który właśnie
     minął) i przełącznik *Prorate partial periods* (domyślnie włączony:
     niepełny okres przy starcie / końcu pozycji liczony proporcjonalnie
     do dni; przy zakończeniu po naliczeniu z góry — korekta ujemna).
   - **Usage (metered)** → pole *UoM code* (np. `gb`, `api_request`)
     oraz *Rate model*: `Simple flat rate` (jedna stawka) lub
     `Tiered` (JSON progowy — volume / graduated / flat).
4. Obok pól ceny widać **walutę konta** (tylko do odczytu). Przełącznik
   **Net | Gross** nad sekcją *Rate* decyduje, czy wpisujesz cenę netto czy
   brutto; pod polem widać drugą stronę ceny (np. „Gross 60.27 PLN · VAT
   23 %"). Przełączenie przelicza wpisaną kwotę, więc cena się nie zmienia.
   Stawki progowe (*Tiered*) są zawsze netto. Na kontach prepaid z VAT
   naliczanym przy doładowaniu (sekcja 10d) stawka VAT i przełącznik są
   wyszarzone.
5. Wpisz *Description* i *Bill start date*.
6. Kliknij **Create item**.

### 2c. Szczegóły pozycji
1. Kliknij wiersz pozycji (lub **Open**) → strona szczegółów. Pozycja
   otwarta **z tej listy** wraca strzałką ← na listę pozycji; otwarta
   **ze strony konta** — wraca do konta.
2. W nagłówku opis pozycji i tagi (typ, ewentualnie „Currency
   mismatch" albo „Billed through…").
3. Zmień stawkę lub opis i kliknij **Save changes**.

## 3. Faktury (Billing Invoices)

Na tej liście są **tylko faktury wygenerowane przez billing** (przez
przebieg rozliczeniowy) — zwykłe faktury sprzedaży się tu nie pokazują.

### 3a. Przeglądanie listy
1. Kliknij **Billing → Billing Invoices** — zobaczysz **3 faktury
   robocze** (status `draft`).
2. Kolumny: *Number*, *Status*, *Account*, *Period*, *Total*, *Outstanding*,
   *Issued*, *Due*, *Days overdue*. Faktury robocze mają numer tymczasowy `DRAFT-…`; prawdziwy
   numer (np. `INV/2026/11/0001`) nadawany jest dopiero przy
   zaksięgowaniu, więc usunięta wersja robocza nie zostawia dziury w
   numeracji.
3. Kliknij **Filters** → *Status* = `draft`. Filtr *Document type* pozwala
   pokazać faktury albo paragony doładowań (prepaid). Filtr *Overdue* →
   *Only overdue* pokazuje faktury po terminie (zaksięgowane, z
   niezapłaconą kwotą, termin płatności minął) — z czerwoną liczbą dni.
4. Menu wiersza (`⋯`) → **Download PDF** (dla roboczych **Preview PDF**).
5. Faktury billingowe **nie pojawiają się** w module Sales — billing ma
   własne dokumenty.

### 3b. Szczegóły i edycja pozycji faktury
1. Kliknij wiersz faktury → strona szczegółów.
2. W nagłówku: numer faktury, status, okres rozliczeniowy oraz
   powiązany przebieg i konto.
3. Pod nagłówkiem kafelki kwot — *Subtotal net*, *Grand total*,
   *Paid*, *Outstanding*.
4. Sekcja **Lines** — pozycje faktury z kolumnami *VAT %*, *VAT* i *Gross*.
   Stawka pochodzi z pozycji rozliczeniowej (Billing Item).
5. Kliknij **Add line** → wpisz opis, ilość, cenę i opcjonalnie stawkę VAT
   (puste = domyślna stawka organizacji) → zatwierdź. Sumy netto, VAT i
   brutto przeliczają się automatycznie.
6. Najedź na pozycję w tabeli i kliknij ikonę ołówka (edycja) albo
   kosza (usunięcie). Każda zmiana trafia do dziennika audytu.

### 3c. Zaksięgowanie faktury
1. Na stronie szczegółów faktury roboczej kliknij **Post invoice**.
   Jeśli dane sprzedawcy nie są uzupełnione (zob. 3e), pojawi się błąd
   „Fill in the seller details…" — numer nie zostanie zużyty.
2. Status zmienia się z `draft` na `posted` i pojawia się komunikat
   potwierdzający. Faktura dostaje numer, datę wystawienia i **termin
   płatności** = data wystawienia + termin z konta (albo domyślny z
   ustawień). Pole *Draft number* pokazuje dawny numer `DRAFT-…`.

### 3d. Ustawienia rozliczeń (numeracja, prepaid)
1. Otwórz **Settings → Billing** — pozycja jest w menu ustawień w grupie
   *Module Configs* (`/backend/config/billing`); skrót **Billing settings**
   jest też w nagłówku list *Invoices* i *Bill Runs*.
2. *Document numbering* — maska numeru dla faktur, faktur korygujących i
   paragonów. Tokeny: `{YYYY}` `{YY}` `{MM}` `{DD}` oraz jeden licznik:
   `{SEQUENCE_NUM}` (nigdy się nie zeruje), `{SEQUENCE_NUM_YEAR}` (co rok),
   `{SEQUENCE_NUM_MONTH}` (co miesiąc); `:4` dopełnia zerami. Pod polem
   widać podgląd następnego numeru albo błąd (np. licznik miesięczny bez
   `{MM}`).
3. *Prepaid defaults* — próg niskiego salda, bufor limitu, **kiedy naliczać
   VAT** (*At top-up* / *At billing*, sekcja 10d), VAT na paragonach
   doładowań (tylko przy *At top-up*), dostawca płatności, generowanie
   zestawień.
4. **Save** (albo `Ctrl/Cmd + Enter`; `Esc` cofa zmiany).

### 3e. Dane sprzedawcy, płatności i logo (Spec B)
1. W **Settings → Billing** u góry widać żółty komunikat *Invoices cannot
   be posted yet*, dopóki brakuje nazwy, adresu, NIP-u lub IBAN-u.
2. Sekcja *Seller*: nazwa prawna, adres, NIP.
3. Sekcja *Payment and invoicing*: bank, **IBAN** (sprawdzana suma
   kontrolna — wpisz np. `PL61 1090 1014 0000 0712 1981 2874`; zmiana
   ostatniej cyfry da błąd), BIC, domyślny termin płatności (dni),
   **domyślna stawka VAT** (dla nowych pozycji), stopka faktury, logo
   (PNG/JPEG).
4. **Save** → komunikat znika. Dane demo (`seed`) wypełniają te pola
   automatycznie.

### 3f. VAT i terminy płatności
1. **Billing Items → Create** — pole *VAT rate (%)* jest wstępnie
   wypełnione stawką domyślną. Ustaw 23 dla jednej pozycji i 0 dla drugiej.
2. Na koncie rozliczeniowym (**Edit**) ustaw *Payment terms (days)* (puste =
   domyślny) i opcjonalnie *Email invoices automatically*.
3. Uruchom przebieg (sekcja 4) → faktura robocza ma VAT per pozycja.
4. Na stronie konta sekcja **Invoices**: kafelki *Open receivables*,
   *Overdue*, *Unapplied credit* oraz tabela faktur konta (kliknięcie
   wiersza → faktura, przycisk wstecz wraca na konto).

### 3g. PDF i wysyłka e-mail
1. Na fakturze roboczej kliknij **Preview PDF** — PDF z ukośnym napisem
   *DRAFT*, w języku konta (*Invoice language*: en / es / de / pl, znaki diakrytyczne).
2. Zaksięguj fakturę → **Download PDF** pobiera PDF zamrożony przy
   księgowaniu (zmiana ustawień sprzedawcy go już nie zmienia).
3. Kliknij **Send** → potwierdź adres → komunikat *Invoice sent* (albo
   *Sending failed* z powodem, np. brak skonfigurowanego dostawcy e-mail).
   Sekcja **Email deliveries** pokazuje każdą próbę; przycisk zmienia się
   na **Resend**.
4. Konto z adresem `…@invalid.local` (utworzone przez konektor CPQ) — wysyłka
   kończy się błędem 422: popraw adres na koncie i wyślij ponownie.
5. Konto z *Email invoices automatically* — faktura wysyła się sama po
   zaksięgowaniu (wpis *Automatic* w historii).

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
3. **As-of date** — domyślnie dzisiaj. Przebieg rozlicza **wszystkie
   zaległe cykle** do tej daty — **jedna faktura na każdą datę
   rozliczenia**. Konto z `next_bill_date` = 14.11 i datą 1.02 następnego
   roku dostaje 3 faktury (14.11–13.12, 14.12–13.01, 14.01–13.02).
   Tryby **Test** i **Dry-run** symulują te same cykle, nie zmieniając
   konta (Test zapisuje 3 faktury testowe, Dry-run tylko podgląd).
   Jeśli chcesz rozliczyć mniej — wybierz wcześniejszą datę.
4. **Run now** (albo `Ctrl/Cmd + Enter`) — po sukcesie przeskakujesz na
   stronę szczegółów nowo utworzonego przebiegu.
5. Na stronie szczegółów, pod *Per-account outcomes*, tabela **Cycles**
   pokazuje każdą datę rozliczenia osobno: okres usługi, status
   (*Invoiced* / *Preview* / *Nothing to bill* / *Skipped — draft
   exists*), liczbę pozycji, sumę netto i link do faktury. Tabela
   **Skipped items** wyjaśnia, czemu jakaś pozycja nie została naliczona
   (np. niepełny okres przy wyłączonej proporcji).

Harmonogram cron uruchamia analogiczny przebieg co noc w trybie
`real` — też rozlicza wszystkie zaległe cykle. Przycisk **New run** to
ten sam endpoint, tylko z trigger `manual`.

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

## 7. Prepaid — rozliczenie z salda (SPEC-002 / XD-304)

Tryb **prepaid** to alternatywa dla domyślnego **postpaid**: klient
**doładowuje saldo** (top-up), a zużycie jest **odejmowane z salda** w
czasie rzeczywistym. Konto prepaid dostaje na stronie szczegółów dodatkowy
panel **„Prepaid balance"**, a w grupie **Billing** pojawiają się trzy nowe
pozycje menu: **Transactions**, **Top-ups**, **Statements**.

> **Zanim zaczniesz (prepaid):**
> - Wymagana jest migracja prepaid — jeśli to świeża baza, uruchom raz
>   `yarn mercato db migrate` (dodaje kolumny `billing_mode` / `credit_limit`
>   i tabele salda/transakcji/doładowań/zestawień). Bez niej panel prepaid
>   się nie pojawi.
> - Operator musi mieć uprawnienia prepaid. Rola **admin** ma `billing.*`,
>   więc `admin@acme.com` widzi wszystko. Po dodaniu nowych ACL na istniejącą
>   bazę uruchom `yarn mercato auth sync-role-acls`.
> - **Uwaga praktyczna:** na dole strony bywa pasek **„Demo Environment"** /
>   baner cookies, który potrafi przykryć dolne przyciski formularzy. Jeśli
>   przycisk „nie klika się", odrzuć baner (**Dismiss** / **Accept cookies**)
>   i spróbuj ponownie.

### 7a. Utworzenie konta prepaid
1. **Billing → Billing Accounts**. Zwróć uwagę na kolumnę **Mode** —
   istniejące konta mają tag **Postpaid**.
2. Kliknij **New account**.
3. Wypełnij pola jak przy zwykłym koncie (Customer, Name, Currency `PLN`,
   Cycle anchor, Next bill date, Invoice email, Invoice language, adres).
4. Zjedź do sekcji **Billing mode & credit** → **Mode** → wybierz
   **Prepaid**.
5. Sprawdź, że **pojawia się dodatkowe pole „Low threshold"** — jest
   widoczne **tylko** dla trybu prepaid. Ustaw **Credit limit** = `100`,
   **Low threshold** = `20`.
6. Kliknij **Create account**.

✅ Flash „Billing account created", przekierowanie na szczegóły konta;
**Mode** pokazany jako tag **Prepaid**.

### 7b. Panel „Prepaid balance"
1. Otwórz szczegóły konta prepaid.
2. Pod kartą danych konta znajdź sekcję **„Prepaid balance"**.

✅ Widzisz: **Balance** (kwota + tag statusu **OK / Low / Exhausted**),
**Low threshold**, **Credit** (`użyte / limit` + tag `Within limit`),
**Last movement**, przyciski **Top up** i **Adjust**, oraz tabelę
**„Balance transactions"**.

> Świeże konto ma saldo `0.0000` ze statusem **Exhausted** (0 jest poniżej
> progu) i komunikat „No balance movements yet.".

### 7c. Manualna korekta salda (Adjust)
1. W panelu kliknij **Adjust**.
2. Pojawiają się dwa pola: **kwota** (ze znakiem) i **powód**.
3. Wpisz kwotę **`50`** (uznanie), powód „Korekta testowa", kliknij
   **Apply adjustment**.

   ✅ Flash „Balance adjusted"; **Balance** rośnie o 50, status zmienia się
   (np. `Exhausted` → `OK`); w tabeli **Balance transactions** pojawia się
   wiersz typu **Adjustment** z opisem, kwotą i nowym saldem.
4. Powtórz z kwotą **`-10`** (obciążenie) i powodem „Test obciążenia".

   ✅ Saldo maleje o 10; kolejny wiersz Adjustment z kwotą `-10.0000`.
5. **Walidacja:** Adjust z kwotą `0` → **Apply** → błąd „Enter a non-zero
   amount"; kwota bez powodu → błąd „Enter a reason".

### 7d. Transakcja → szczegóły + lista Transactions
1. W tabeli **Balance transactions** **kliknij dowolny wiersz**.

   ✅ Otwiera się strona **Transaction** (nie 404). Widzisz kwotę, tag typu,
   **Balance after**, **Description**, **Source ref**, linki **Top-up /
   Statement / Billing item**, **Usage record**, **User** (kto wykonał),
   **ID** oraz przycisk **View account** (wraca na konto).
2. **Billing → Transactions** (nowa pozycja menu) — globalna lista ruchów
   salda. Kolumny: **When / Type / Description / Amount / Balance /
   Account**.
3. Kliknij **Filters → Type → Adjustment → Apply** — lista zawęża się do
   korekt. Kliknięcie wiersza otwiera ten sam szczegół co w kroku 1.

### 7e. Doładowanie (Top up)
1. W panelu kliknij **Top up** → pojawia się pole **Amount** + **Start
   checkout** + **Cancel**.
2. Wpisz np. `30`, kliknij **Start checkout**.

⚠️ W środowisku **bez skonfigurowanej bramki płatności** (domyślny dev)
pojawi się **błąd** — to poprawne: afordancja działa, ale faktyczna sesja
płatności wymaga providera (np. Stripe). Realne doładowanie kredytuje saldo
dopiero po przechwyceniu płatności (capture), które tworzy wpis na liście
**Top-ups** i transakcję typu **topup** na saldzie.

### 7f. Edycja konta — tryb jest niezmienny
1. Na szczegółach konta prepaid kliknij **Edit**, zjedź do **Billing mode &
   credit**.

✅ **Mode** jest **zablokowany** z adnotacją „Immutable — frozen at account
create time."; **Credit limit** i **Low threshold** pozostają edytowalne.
2. Zmień **Credit limit** na `200` → **Save changes**. Po odświeżeniu panel
   Credit pokazuje `… / 200`.

### 7g. Test negatywny — postpaid nie ma panelu prepaid
1. Otwórz dowolne konto **postpaid** (Mode = Postpaid).

✅ **Brak** sekcji „Prepaid balance" i przycisków Top up / Adjust — logika
prepaid nie dotyka kont postpaid.

### 7h. Top-ups i Statements (listy + szczegóły)
1. **Billing → Top-ups** — lista doładowań; kolumny **Created / Amount /
   Provider / Status / Account**, z filtrem po statusie. Kliknięcie wiersza
   otwiera szczegół: Amount, Provider, Payment ID, Gateway transaction,
   Balance transaction, **VAT receipt**, ID + **View account**.
2. **Billing → Statements** — zestawienia okresowe; kolumny **Period /
   Opening / Top-ups / Usage / Adjustments / Charges (taken on bill date) /
   Closing / Status**. W każdym wierszu: Opening + Top-ups + Adjustments −
   Usage − Charges = Closing. Szczegół pokazuje to samo rozbicie oraz tabelę
   „Period-close charges" z okresem usługi każdej opłaty i podpowiedzią, że
   opłaty pobierane są w dniu rozliczenia (dzień po końcu okresu) — opłata
   z góry dotyczy więc następnego okresu.
   ✅ Pierwsze zestawienie nigdy nie zaczyna się przed startem konta (najwcześniejszą
   datą startu pozycji). Gdy pierwsza data rozliczenia = data startu, pierwszy
   przebieg pobiera tylko opłatę z góry, bez zestawienia; pierwsze zestawienie
   obejmuje okres od daty startu.

> Top-upy i zestawienia powstają w pełnym cyklu (przechwycenie płatności /
> zamknięcie okresu przez Bill Run). Bez bramki / przebiegu listy bywają
> puste — to oczekiwane.

### 7i. Szybki scenariusz prepaid end-to-end (~3 minuty)
1. Utwórz konto prepaid z limitem `100` i progiem `20` (**7a**).
2. **Adjust** +`50` → saldo `50`, status **OK**, transakcja na liście (**7c**).
3. Kliknij transakcję → otwiera się szczegół (**7d**).
4. **Adjust** -`40` → saldo `10`, status **Low** (dodatnie, ale poniżej
   progu `20`).
5. Wejdź na **Billing → Transactions** → obie korekty na globalnej liście.

### 7j. Przykład z realnymi danymi: „Brightside Solar" (od zera)
Pełny przebieg z konkretnymi wartościami — firma *Brightside Solar* przechodzi
na prepaid.

**Krok 1 — utwórz konto.** **Billing → Billing Accounts → New account**:
- **Customer:** wybierz z listy **Brightside Solar**
- **Name:** `Brightside Solar — Subskrypcja SaaS`
- **Currency:** `PLN`, **Cycle anchor:** `1`, **Next bill date:** `2026-07-01`
- **Invoice email:** `faktury@brightsidesolar.pl`, **Invoice language:** `pl`
- **Address:** `ul. Słoneczna 12`, `Warszawa`, `00-950`, `PL`
- **Mode → Prepaid**, **Credit limit:** `500`, **Low threshold:** `100`
- **Create account**

✅ Konto prepaid, saldo `0,0000 PLN`, status **Exhausted**.

**Krok 2 — wpłata startowa 1 500 zł.** W panelu **Adjust** → kwota `1500`,
powód `Wpłata startowa — przelew 06/2026` → **Apply adjustment**.

✅ Saldo `1 500,0000 PLN`, status **OK**, wiersz **Adjustment +1500**.

**Krok 3 — miesięczne zużycie −1 420 zł.** **Adjust** → kwota `-1420`, powód
`Zużycie API — czerwiec 2026` → **Apply adjustment**.

✅ Saldo `80,0000 PLN`, status **Low** (poniżej progu `100`).

**Krok 4 — prześledź ruch.** Kliknij wiersz `Zużycie API — czerwiec 2026` w
tabeli → szczegół transakcji (kwota, Balance after `80`, User, powód) →
**View account** wraca na konto.

**Krok 5 — globalna lista.** **Billing → Transactions** → **Filters → Type →
Adjustment → Apply**. W kolumnie **Account** widzisz `Brightside Solar —
Subskrypcja SaaS` (nazwa, nie UUID).

**Krok 6 — doładowanie kartą.** Na koncie **Top up** → `500` → **Start
checkout**. Tworzy się doładowanie ze statusem **Pending** (widoczne na
**Billing → Top-ups**); pełne zaksięgowanie na saldzie następuje po opłaceniu
w bramce płatności.

**Krok 7 — tryb zabetonowany.** **Edit** → **Mode** zablokowany; zmień
**Credit limit** na `1000` → **Save changes**.

**Efekt:** konto Brightside Solar prepaid, saldo 80 zł (Low), 2 transakcje w
historii, 1 doładowanie Pending, limit kredytu 1000.

---

## 8. Płatności (Spec C)

Billing ma własny rejestr płatności: wyciąg z banku (CSV) jest dopasowywany do
faktur po **numerze faktury w tytule przelewu**.

### 8a. Przygotowanie
1. Uzupełnij dane sprzedawcy (3e), uruchom przebieg i **zaksięguj** kilka faktur
   (najlepiej dwie dla jednego konta).
2. W terminalu: `yarn mercato billing payments-sample` — powstaje plik
   `payments-sample.csv` z wierszami dla każdego przypadku (pełna kwota, połowa,
   nadpłata, dwie faktury w jednym tytule, brak tytułu, doładowanie prepaid,
   inna waluta, duplikat).

### 8b. Import wyciągu
1. **Billing → Payments → Upload CSV** → wybierz plik → **Upload**
   (`Ctrl/Cmd + Enter`).
2. Okno podsumowania: *Allocated*, *Partially allocated*, *Matched (credit)*,
   *Unmatched*, *Duplicates*, *Rejected rows* (z numerem wiersza i powodem).
3. Lista płatności: status, nierozliczona kwota, konto, tytuł. Filtr *Status*.
4. Wgraj ten sam plik ponownie → wszystkie wiersze to *Duplicates*.

### 8c. Faktury po imporcie
1. Faktura opłacona w całości → status `paid`; w połowie → `partially_paid`
   (pole *Outstanding* maleje).
2. Nadpłata trafia jako **nadpłata (credit)** na najstarszą otwartą fakturę
   konta; na koncie kafelek *Unapplied credit* pokazuje resztę.
3. Szczegóły faktury → sekcja **Payments** z płatnościami, które ją rozliczyły.

### 8d. Ręczna obsługa płatności
1. Płatność *Unmatched* (np. bez tytułu) → **Assign to account** → wybierz konto →
   kwota rozlicza najstarsze otwarte faktury.
2. Płatność *Matched* z nierozliczoną kwotą → **Allocate** → wpisz kwoty przy
   fakturach → **Allocate**.
3. W tabeli *Allocations* menu wiersza → **Un-allocate** (faktura znów nieopłacona).
4. **Ignore** / **Restore** — dla opłat bankowych i błędnych przelewów.
5. Płatność dla konta prepaid (*Prepaid account — convert to a top-up*) →
   **Convert to top-up** → saldo konta prepaid rośnie, powstaje paragon.
6. **Record payment** (lista lub konto) — ręczne wprowadzenie wpłaty.

## 9. Korekty: faktury korygujące i noty obciążeniowe (Spec D)

Zaksięgowanej faktury nie da się edytować ani anulować — poprawia się ją
dokumentem korygującym z odwołaniem do oryginału.

### 9a. Faktura korygująca (credit memo)
1. Otwórz zaksięgowaną fakturę → **Create credit memo**.
2. W oknie zaznacz pozycje, popraw ilość / cenę netto (stawka VAT zostaje z
   oryginału) albo kliknij **Full credit**; wpisz **przyczynę** (drukowana na
   dokumencie). Na dole widać kwotę korekty.
3. **Create draft** (`Ctrl/Cmd + Enter`) → otwiera się projekt `DRAFT-…` z odznaką
   *Credit memo*, polem *Corrects* (link do oryginału) i *Reason*. Projekt można
   edytować albo usunąć (**Delete draft**).
4. **Post invoice** → numer z serii `CN/…`, PDF „Faktura korygująca” z
   „Koryguje … z dnia …”, przyczyną i blokiem *Rozliczenie*.
5. Oryginał: kwota *Outstanding* maleje o korektę (status `partially_paid`, a przy
   korekcie do zera `credited`); sekcja **Corrections** i **Payments** pokazują
   korektę.
6. Korekta opłaconej faktury → kwota trafia jako nadpłata na konto (kafelek
   *Unapplied credit*) i rozlicza najstarszą otwartą fakturę.
7. Próba skorygowania więcej, niż zostało → komunikat „The credit is more than…”.

### 9b. Nota obciążeniowa (debit memo)
1. Na zaksięgowanej fakturze → **Create debit memo** → przyczyna → projekt.
2. **Add line** (np. zapomniana opłata) → **Post invoice** → numer z serii faktur,
   termin płatności, kwota do zapłaty.
3. Nota jest opłacana jak faktura: przelew z jej numerem w tytule zostanie
   dopasowany przy imporcie CSV (sekcja 8; `payments-sample` dodaje taki wiersz).

### 9c. Lista faktur
Filtr *Document type* ma *Credit memo* i *Debit memo*; kolumna *Type*; sumy
faktur korygujących są pokazywane ze znakiem minus.

## 10. Uwagi operatora — runda 1 (Spec F)

> Wymaga migracji `Migration20261119000000_billing_operator_feedback`
> (`yarn mercato db migrate`) i odświeżenia uprawnień
> (`yarn mercato auth sync-role-acls` — nowe `billing.run.delete`).

### 10a. Usuwanie przebiegów testowych
1. **Bill Runs** → uruchom przebieg w trybie **Test**.
2. Na stronie przebiegu: **Wipe test invoices** usuwa faktury testowe
   (przebieg zostaje), **Delete run** usuwa przebieg razem z wynikami i
   fakturami testowymi (okno potwierdzenia podaje liczbę faktur).
3. Na liście przebiegów to samo jest w menu wiersza (**Delete run**) dla
   przebiegów *Test* i *Dry-run*. Filtr **Mode** zawęża listę; domyślnie
   pokazane są wszystkie.
4. Przebiegów *Real* nie da się usunąć (brak akcji; API zwraca 422).
5. Faktura testowa nie ma już przycisku *Wipe* — znacznik **Test run**
   prowadzi do jej przebiegu.

### 10b. Konto jako przestrzeń robocza
1. Otwórz konto — u góry kafelki: *Balance due*, *Overdue*, *Unapplied
   credit* (postpaid) albo *Balance* ze statusem i *Credit limit* (prepaid),
   oraz *Next bill* i ostatnia faktura / zestawienie.
2. Zakładki: *Overview*, *Items*, *Usage*, *Invoices*, *Payments*
   (postpaid) lub *Balance & top-ups* i *Statements* (prepaid), *Bill runs*.
   Adres zawiera `?tab=…`, więc link otwiera właściwą zakładkę; powrót z
   pozycji / faktury wraca na zakładkę, z której przyszedłeś.
3. Obok *Active* w nagłówku jest drugi znacznik: **Postpaid** / **Prepaid**.
4. Zakładka *Items*: stawka z walutą i podstawą (Net / Gross), okres
   pozycji, *Billed through* i status rozliczenia względem dzisiejszej daty —
   *Starts …*, *Not billed yet*, *Billed through …* (opłacona z góry),
   *Due since …* (następny przebieg ją naliczy), *Billed*, *Fully billed*.
5. **Run billing** w nagłówku: tryb (domyślnie *Test*) i data → **Run
   billing**; okno się zamyka, komunikat podaje liczbę dat z opłatami, a
   strona przechodzi na zakładkę *Bill runs*. Tam każdy przebieg ma kolumny
   *Mode* (Real / Test / Dry-run) i *As-of date*; menu wiersza przebiegu
   testowego ma *Wipe test invoices* i *Delete run*.
6. Lista kont: kolumny **Balance due** i **Overdue** (na czerwono) oraz
   filtr **Has overdue**.

### 10c. Prepaid — z góry / z dołu, wiele cykli naraz
1. Konto prepaid z *Next bill date* `2026-11-14`, pozycje: jednorazowa 99 i
   abonament 49 (*In advance*), obie od `2026-11-14`.
2. **Run billing** → *Real*, data `2026-12-14` → dwa cykle *Charged to
   balance*: 14.11 (99 + 49 za 14.11–13.12) i 14.12 (49 za 14.12–13.01);
   *Next bill* = `2027-01-14`. Transakcje pokazują okres usługi.
3. Ta sama konfiguracja z *In arrears*: 14.11 pobiera tylko 99, 14.12 —
   49 za 14.11–13.12.
4. Pozycja zaczynająca się w środku okresu jest liczona proporcjonalnie
   (np. 20.11–13.12 = 24/30 × 49 = 39,20); z wyłączonym *Prorate* — pominięta
   i widoczna w tabeli *Skipped items* przebiegu.
5. *Test* i *Dry-run* pokazują wszystkie należne cykle (*Preview*), nie
   zmieniając salda ani konta.
6. Zestawienie dla daty rozliczenia D obejmuje ruchy od dnia po
   poprzedniej dacie rozliczenia **do D włącznie** — opłaty pobierane w dniu
   D i doładowanie wykonane tego samego dnia trafiają do jednego zestawienia.
   Przykład: rozliczenie 15.11, doładowanie 300 tego dnia, opłaty z 15.11 →
   pierwsze zestawienie: otwarcie 0, doładowania 300, zamknięcie dodatnie;
   kolejne zaczyna się od tego salda (nie od wartości ujemnej).

### 10d. Prepaid — kiedy naliczany jest VAT
**At top-up** (domyślnie): paragon doładowania 123 przy VAT 23 % pokazuje
100 + 23; saldo rośnie o 123; abonament 49 pobiera 49 (VAT pozycji nie
ma zastosowania — pole jest wyszarzone z notką).

**At billing**: paragon doładowania 100 bez VAT; saldo +100; abonament
10 netto przy 23 % pobiera **12,30**; zestawienie pokazuje kolumny Net / VAT i
tabelę *VAT summary*. Zmiana ustawienia dotyczy tylko nowych doładowań i
opłat (ostrzeżenie na stronie ustawień). *At billing* wymaga akceptacji
księgowego — zestawienie nie jest dokumentem fiskalnym.

## Reset danych testowych *(operacja techniczna — opcjonalna)*

Jeśli chcesz wyczyścić billing i wgrać dane od nowa, w terminalu:

```bash
# 1. wyczyść tabele billingu
docker exec dainamite-core-postgres-1 psql -U postgres -d open-mercato -c "
DELETE FROM billing_invoice_lines; DELETE FROM billing_invoices; DELETE FROM billing_document_sequences;
DELETE FROM billing_run_outcomes; DELETE FROM billing_runs;
DELETE FROM billing_account_usage; DELETE FROM billing_items; DELETE FROM billing_accounts;"

# 2. wgraj dane demo na nowo (aplikacja musi działać)
node packages/billing/scripts/seed-demo.mjs
```

Skrypt tworzy 5 firm, 10 pozycji, rekordy zużycia i jeden przebieg
rozliczeniowy z fakturami — wszystko przez REST API.
