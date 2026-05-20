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
2. Wypełnij formularz: *Name*, *Customer ID*, *Currency* (np. `PLN`),
   *Bill cycle*, *Cycle anchor* (`1`), *Invoice email*, adres faktury
   (*Line 1* + *City* + *Postal code* + *Country*) oraz *Next bill date*.
3. Kliknij **Create account** (albo wciśnij `Ctrl/Cmd + Enter`).
4. Wracasz na listę — nowe konto jest na niej widoczne.

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
Ręczne uruchomienie przebiegu działa na razie przez API i harmonogram
(cron) — w UI nie ma jeszcze przycisku „uruchom". Dane testowe
zawierają gotowy, zakończony przebieg do przeglądania.

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
