# Billing Module (xd-249) — Business Overview

**Typ dokumentu**: Product overview do review z cofounderem
**Data**: 2026-04-26
**Status**: Draft do akceptacji
**Companion do**: technical spec `specs/implementation/xd-249-billing-module.md` (1518 linii, v3 — zatwierdzony do implementacji)

---

## TL;DR

`@dainamite/billing` to **silnik rozliczeniowy do subskrypcji** dla aplikacji opartych na Open Mercato. Codziennie automatycznie wystawia faktury cykliczne, obsługuje zmiany w trakcie cyklu (proration), okresy próbne i wysyła webhooki do systemów zewnętrznych. Sprzedawalny jako niezależny moduł — klient kupuje go bez `@dainamite/cpq` i podpina dowolne źródło subskrypcji przez REST API.

**W trzech zdaniach:**
- **Co**: Recurring billing + invoice automation, plug-and-play do dowolnej aplikacji OM.
- **Dla kogo**: B2B usługodawcy (telco, SaaS, MSP) którzy chcą trzymać rozliczenia we własnej infrastrukturze, a nie wynosić ich do Stripe'a / Chargebee.
- **Czemu nie Stripe/Chargebee**: natywna integracja z istniejącym ERP, suwerenność danych, dowolność podatkowa (EU/PL VAT bez kompromisów), brak vendor lock-in.

**Stan:** spec techniczny zatwierdzony, gotowy do startu Phase 0. Estymata: **~8 tygodni roboty solo** dla pełnego v1 (5 faz, milestone-based).

---

## Problem, który rozwiązujemy

Każdy B2B usługodawca z subskrypcjami stoi przed dylematem rozliczeniowym:

1. **Zbudować własny silnik billingu od zera.** Drogo, długo, podatne na błędy w matematyce proracji, podatkach, numeracji faktur. Kilka osobomiesięcy minimum.
2. **Wziąć Stripe Billing / Chargebee.** Szybkie, ale: dane wychodzą do trzeciej strony, integracja z istniejącym ERP wymaga sklejania dwóch źródeł prawdy, polskie i unijne wymagania VAT są ich słabą stroną, kart kredytowych nie zawsze chcesz (B2B płaci przelewami).
3. **Użyć modułu sales w Odoo / SAP / Dynamics.** Ciężkie, drogie, sztywne, integracja z nowoczesnym CPQ wymaga konsultantów.

Wszystkie trzy ścieżki są dla klientów którzy chcą **trzymać rozliczenia u siebie + szybko wystartować + bez kompromisów podatkowych** są niezadowalające.

`@dainamite/billing` jest czwartą opcją: gotowy moduł zainstalowany w aplikacji klienta, działający lokalnie z jego bazy danych, integrujący się z dowolnym źródłem subskrypcji przez API.

---

## Co system będzie umieć — z perspektywy operatora finansowego

**Codzienne fakturowanie bez nadzoru.** Każdej nocy o ustalonej godzinie billing przegląda aktywne subskrypcje, znajduje te z zakończonym okresem rozliczeniowym, generuje fakturę, zapisuje ją do tabeli faktur Open Mercato, oznacza opłaty jako rozliczone. Operator rano widzi w panelu: ile faktur poszło, na jaką kwotę łącznie, czy któreś z subskrypcji się wywaliły z błędem. **Błąd na jednej subskrypcji nie blokuje pozostałych** — każda jest niezależnym envelope'em.

**Subskrypcje cykliczne**: monthly / quarterly / annually, w trybie z góry (advance) lub z dołu (arrears, default dla telco/B2B). Klient sam wybiera dzień miesiąca jako kotwicę okresu rozliczeniowego (1–28). Każda subskrypcja ma własną walutę i może składać się z wielu pozycji (różne produkty, różne stawki VAT).

**Okresy próbne** (free lub discounted). Subskrypcja może mieć datę końca trialu i obniżony MRC w jego trakcie — system fakturuje obniżoną kwotę przez okres trialu, automatycznie przełącza na pełny MRC po wygaśnięciu i emituje event który można podpiąć pod mailing. Jeśli okres rozliczeniowy "wjeżdża" w środek trialu, system rozdziela go na dwie pozycje na fakturze (część w trialu, część po) — proporcjonalnie do dni.

**Zmiany w trakcie cyklu** (amend) — klient np. dodaje nowy produkt 15. dnia miesiąca: system liczy proporcjonalną dopłatę za pozostałe 16 dni, zapisuje audit trail z całą formułą (kto kazał, jaka polityka, ile dni, jaka cena), wystawia osobny charge który dolatuje na najbliższą fakturę. Klient usuwa pozycję — kredyt na koncie, zjada się na następnym rozliczeniu. Trzy polityki proracji do wyboru per-subskrypcję: dzienna (uczciwa), brak (zmiana od następnego okresu), pełnoperiodowa (cały okres mimo połówki).

**Cancellation z dwoma trybami**: `immediate` (kończymy teraz, ostatnia faktura zawiera proration + opcjonalnie ETF) lub `end_of_term` (kończymy z końcem opłaconego okresu, bez proration, bez nadzwyczajnej faktury). Integrator może dorzucić "final charges" na ostatnią fakturę — typowo Early Termination Fee policzony przez upstream system.

**Opłaty jednorazowe** (NRC) — aktywacja, sprzęt, professional services, ręczna korekta. Trafiają na następną cykliczną fakturę, ALBO operator może powiedzieć "wystaw to teraz osobno" i dostaje izolowaną fakturę zawierającą tylko tę pozycję.

**Webhooki produkcyjnej jakości** — operator wpisuje w panelu URL endpointa, zaznacza jakie eventy chce dostawać (`invoice.issued`, `subscription.terminated`, `trial_ended`, etc.). Każda wiadomość jest podpisana HMAC, retry'owana 3× z exponential backoff, a po N kolejnych failach billing flaguje endpoint jako "unhealthy" i woła operatora przez notyfikację. Per endpoint: kiedy ostatnio się udało, kiedy ostatnio padło, ile razy z rzędu padło. Zero zgadywania w produkcji.

**Pełny audit trail.** Każda proration ma snapshot formuły (jaka polityka, ile dni, jakie quantity_before/after), każdy run ma per-subskrypcję outcome line z błędem jeśli był, każda faktura ma traceability charge → invoice_line. Spór z klientem rozwiązujesz w 5 minut.

---

## Persony, które dotykają systemu

- **Finance operator** (rola `admin` lub `billing.*` w OM) — ogląda runs, ogląda subskrypcje, ręcznie triggeruje run lub dry-run gdy coś trzeba poprawić, edytuje ustawienia, wpina webhooki, czyta faktury w panelu.
- **Integrator techniczny** (developer u klienta, plus my przy Netii) — pisze cienki "bridge package" który wywołuje billing API w odpowiedzi na zdarzenia w jego źródłowym systemie (CPQ, CRM, import CSV). Bridge dostaje API key na zarządzanie subskrypcjami.
- **Zewnętrzne systemy konsumujące eventy** — księgowość, hurtownia danych, system mailingowy — odbierają webhooki i robią swoje.
- **Klient końcowy** — w v1 **nie ma własnego portalu**. Faktura dociera mailem (notyfikacja na evencie `billing.invoice.issued`), płatność realizuje przez bramkę (poza scope billingu).

---

## Trzy historie end-to-end na kanwie pierwszego klienta (Netia / CPQ)

### Historia 1 — nowy klient kupuje internet 100/100

W CPQ klient akceptuje quote, CPQ konwertuje go w order, aktywuje subskrypcję. Bridge wykrywa aktywację, woła billing API z parametrami: MRC = 49.99 EUR, billing cycle = monthly, start date = 2026-05-01. Bridge dorzuca jeszcze opłatę aktywacyjną 99 EUR jako NRC. Pierwszego czerwca o 02:00 nocy billing run znajduje tę subskrypcję, generuje fakturę zawierającą 49.99 (MRC za maj) + 99 (NRC) = 148.99 EUR brutto (po VAT z core/sales), wpisuje do tabeli faktur, woła webhook do system mailingowego. Finance operator następnego ranka widzi w panelu: 1 faktura, 148.99 EUR, sukces.

### Historia 2 — klient dorzuca usługę w trakcie miesiąca

15 maja klient kupuje w CPQ dodatkowy pakiet TV (29 EUR/mc). CPQ → bridge → billing amend API z `effective_date: 2026-05-15`. Billing liczy proporcjonalnie: zostało 17 dni z 31 → dopłata 29 × 17/31 = 15.90 EUR. Tworzy event proracji z pełną formułą do audytu, tworzy charge 15.90 EUR. Pierwszego czerwca faktura zawiera: stary fiber 49.99 + nowy TV za pełny czerwiec 29 + proration za pół maja 15.90 = 94.89 EUR. Klient widzi czyste linie na fakturze.

### Historia 3 — klient rezygnuje przed terminem

Klient ma kontrakt 24-miesięczny, podpisany 6 miesięcy temu. Rezygnuje 20 maja. CPQ liczy ETF według polityki Netii (np. min(remaining_months × MRC × 0.5, 3 × MRC)) → 149.97 EUR. CPQ → bridge → billing terminate API z `policy: immediate` i ETF jako final charge. Billing liczy proration credit za niewykorzystane 11 dni maja (-49.99 × 11/31 = -17.74), dodaje ETF 149.97, wystawia od razu fakturę: -17.74 + 149.97 = 132.23 EUR. Subskrypcja przechodzi w stan "terminated", nie pojawi się w żadnym przyszłym runie.

---

## Czego billing **nie robi** (granice produktu, świadome decyzje)

- **Nie liczy zużycia.** Klient pyta "ile minut/GB/wywołań było w tym miesiącu" — nie tutaj. To osobna ekspansja `@dainamite/billing-usage` (planowany add-on po v1).
- **Nie pilnuje płatności.** Faktura wyszła i koniec; nie wysyła ponagleń, nie zawiesza usługi po N dniach niezapłacenia. To dunning, planowany na Phase 5.
- **Nie pobiera płatności.** Kartę / przelew obsługuje moduł payment_gateways z OM ze swoimi adapterami (Stripe, Przelewy24, etc.). Billing tylko **widzi** status zapłacenia faktury — nie wymyśla swojego.
- **Nie liczy podatków.** VAT i exempt'y załatwia tax service z core/sales — billing przekazuje stawkę i kwotę, dostaje policzoną fakturę.
- **Nie konwertuje walut.** Multi-currency obsługuje moduł currencies. Każda subskrypcja jest single-currency; mieszane runy są zabronione (clean reporting).
- **Nie ma portalu klienta.** Klient końcowy nie loguje się żeby pobrać fakturę. To planowana ekspansja po v1.
- **Nie eksportuje do księgowości.** Brak GL exportu, brak deferred revenue. Osobny moduł konsumujący eventy w przyszłości.
- **Nie pauzuje subskrypcji.** "Wstrzymaj rozliczenie na 2 miesiące" nie istnieje w v1. Idzie razem z dunningiem (Phase 5).

---

## Compliance & regulatory advantages *(nowa sekcja)*

Co dostajemy w v1 zgodnie z wymaganiami EU/PL bez dodatkowej pracy:

- **Numeracja faktur unikalna per tenant, atomowa, bez przeskoków** — wymaganie polskiej Ustawy o VAT i unijnej Dyrektywy 2006/112/WE. Realizacja przez upsert SQL, nie counter w pamięci → niemożliwa kolizja przy współbieżnych wystawieniach.
- **VAT pełnoprawny** — dziedziczony z core/sales który ma dedykowany tax service. Stawki, exempty, reverse charge B2B-EU wszystko już obsłużone.
- **Audit trail** — każda zmiana w subskrypcji (amend, cancel, terminate) ma persisted event z formułą i timestampem. Spór z urzędem skarbowym lub kontrahentem rozstrzygalny z bazy.
- **Data residency** — billing trzyma dane w bazie klienta (jego VPS, jego cloud, jego serwerownia). Nigdzie nie wycieka do trzeciej strony. Atut dla sektora regulowanego (telco, fintech, healthcare).
- **GDPR-ready** — moduł szyfruje wrażliwe pola (webhook secret) przez TenantDataEncryptionService, nie loguje PII w eventach (rule explicit w speceu).
- **Idempotency-first API** — retry'e nie powodują podwójnego naliczenia. Standard w nowoczesnym fintech, Stripe ma identyczny mechanizm.

Czego v1 **nie zapewnia samodzielnie** (ale framework je daje):
- KSeF (Krajowy System e-Faktur) — to wymóg na 2027 dla PL — adapter do KSeF zostanie dopisany na poziomie core/sales (gdy OM go doda) lub jako osobny pakiet `@dainamite/billing-ksef`. Billing nic nie psuje.
- SAF-T / JPK_VAT — generowanie deklaracji nie jest billingu, jest księgowości. Billing dostarcza dane (z faktur w sales_invoices).

---

## Konkurencja — szczegółowa tabela *(rozszerzona z spec'u)*

| Cecha | `@dainamite/billing` | Stripe Billing | Chargebee | Recurly | Maxio (Chargify) | Odoo Subscription |
|-------|----------------------|----------------|-----------|---------|------------------|---------------------|
| Recurring billing | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Mid-cycle proration | ✅ (3 polityki) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Trials (free + discounted) | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ basic |
| Usage-based billing | ❌ v1 (planowane addon) | ✅ | ✅ | ✅ | ✅ | ⚠️ basic |
| Dunning workflow | ❌ v1 (Phase 5) | ✅ | ✅ | ✅ | ✅ | ⚠️ basic |
| Customer portal | ❌ v1 | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Dane on-prem / sovereign** | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Polish VAT (KSeF, JPK)** | ✅ (przez core/sales) | ⚠️ | ⚠️ | ❌ | ❌ | ✅ |
| **Open source / extensible** | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **API-first integration** | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **Natywna integracja z ERP/CPQ** | ✅ (OM) | ❌ | ⚠️ via Zapier | ⚠️ | ⚠️ | ✅ |
| **Multi-tenant SaaS-ready** | ✅ (RBAC z OM) | ❌ (1 konto = 1 firma) | ⚠️ | ⚠️ | ⚠️ | ✅ |
| **Brak vendor lock-in** | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Cena dla klienta końcowego** | one-time license + maintenance | % od obrotu | % od obrotu + flat | % od obrotu | % od obrotu | one-time ERP licencja |

**Gdzie wygrywamy:**
- klient z istniejącą instalacją OM (nie dokłada drugiego SaaS-a)
- klient regulowany (telco, fintech, healthcare) z wymaganiami data residency
- klient PL/EU z poważnym zaangażowaniem w lokalne podatki
- klient B2B z dużym wolumenem przelewów (% od obrotu Stripe'a boli)
- klient który chce mieć kontrolę nad customizacją

**Gdzie przegrywamy (świadomie, w v1):**
- klient B2C masowo akceptujący karty (gateway Stripe is gateway Stripe)
- klient bez własnej infrastruktury IT (hosting, devopsy)
- klient w usage-heavy domenie (mobile carrier, cloud, IoT)
- klient bez zaplecza technicznego do wdrożenia OM

---

## Customer acquisition — kto kupuje *(nowa sekcja)*

Moja teza, do walidacji:

**Pierwsze 3 transakcje** najprawdopodobniej pochodzą z:

1. **Netia (lub podobna telco średniej wielkości)** — pierwszy klient walidacyjny, repo `open-mercato-cpq-v0` jest "Demo Netia". Sprzedaż: dorzucamy billing do propozycji CPQ jako pakiet. Cena: część kontraktu CPQ.
2. **Drugi klient z sieci kontaktów founders** — partnerski układ, 50% ceny, zwykle B2B SaaS lub usługodawca telco/utility. Wybór klienta walidującego "billing bez CPQ" — żeby przewalidować standalone hipotezę.
3. **Klient z marketingu inboundowego** (~6-12 miesięcy po pierwszych dwóch) — landing page, case studies z Netii i drugiego klienta, content o "ERP na Open Mercato", spotkania na konferencjach (E-commerce Berlin, GitNation).

**Targetowy persona klienta:**
- CTO / Head of Engineering w firmie 50-500 pracowników
- B2B usługodawca z subskrypcjami (telco, SaaS, MSP, utility)
- Ma już lub buduje własny ERP/CRM/CPQ — czyli ma zespół który ogarnie integrację
- Sygnały frustracji: "płacimy Stripe'owi 2.5% od każdej faktury B2B", "nasz SAP nie potrafi w nowoczesny billing", "konsultanci od Salesforce wycenili to na 800k PLN", "wymóg KSeF spada nam w 2027"

**Kanały dotarcia:**
- Direct sales (founders + advisor network)
- Partnerships z firmami wdrożeniowymi OM
- Content marketing (blog techniczny, case studies)
- Speaking gigs (E-commerce Berlin, MeetMagento, lokalne konferencje PL/DE)

---

## Plan dostarczania — pięć faz

| Faza | Co dostarcza biznesowo | Demo | Estymata effort |
|------|------------------------|------|-----------------|
| 0 | Silnik proracji jako pure function + testy. ~200 LOC. | CLI: zmiana 15. dnia → kwota X. Brak DB, brak UI. | 2-3 dni |
| 1 | Moduł zarejestrowany w aplikacji OM, bazy stworzone, ACL widoczne w panelu. | Nowy tenant dostaje wpis w `billing_settings`. Brak funkcji jeszcze. | 1 tydzień |
| 2 | API do rejestrowania subskrypcji i wrzucania charge'y. Bez generowania faktur jeszcze. | Curl walkthrough: register subscription, push charge, list. | 2 tygodnie |
| 3 | **Pierwsze faktury wychodzą.** Codzienny scheduler działa, run zapisuje do tabeli faktur. | E2E: rejestracja → następny dzień → automatyczna faktura w panelu sales. **Moment "shippable preview" produktu.** | 2-3 tygodnie |
| 4 | Mid-cycle changes + UI admina + webhooki + manual trigger. **Pełny lifecycle.** | Demo dla potencjalnego klienta. **`@dainamite/billing` v1.0 release candidate.** | 2-3 tygodnie |

**Łączna estymata:** ~8 tygodni roboty solo (1 deweloper full-time). Z buforem na nieprzewidziane: 10 tygodni. Dla porównania: konkurencyjne wdrożenie billingu w SAP-ie to 6-12 miesięcy.

**Co po Phase 4:**
- Phase 5 (~4-6 tygodni): dunning workflow + portal klienta — idą razem bo dzielą koncepty (overdue states, customer-facing UX).
- Add-on `@dainamite/billing-usage` (~3-4 tygodnie): metering/usage billing.
- Add-on `@dainamite/cpq-billing-bridge` (~1-2 tygodnie): formalny pakiet integrujący CPQ z billingiem (dziś bridge jest ad-hoc po stronie Netia repo).

Pierwsze sprzedażowe demo: **po ~8 tygodniach od dziś**, czyli ~koniec czerwca 2026.

---

## Monetyzacja — open question *(nowa sekcja, do dyskusji z cofounderem)*

Spec techniczny tego nie rozstrzyga. Cztery realne modele:

1. **One-time license + roczny maintenance** (klasyka enterprise). Cena np. 20-40k PLN za license + 20% rocznie maintenance. Płatne na własność + support. Najlepiej rozumiane przez większe firmy.
2. **Annual subscription** (SaaS-style). Cena np. 2-5k PLN/miesiąc per tenant, all-inclusive. Niższy próg wejścia, ciągły przepływ. Wymaga od nas SLA i ciągłego supportu.
3. **% od obrotu** (jak Stripe). Cena np. 0.3-0.5% od kwoty fakturowanej przez billing. Skaluje się z klientem, ale wymaga raportowania i ufania klientowi że pokazuje prawdziwe liczby.
4. **Per-invoice fee** (jak Maxio/Chargify). Cena np. 0.50 PLN per wystawiona faktura. Przewidywalne, łatwe do liczenia, ale klient z dużym wolumenem może próbować negocjować.

**Moja preferencja**: hybryda 1+2. License na własność dla enterprise (klient ma bezpieczeństwo, my mamy dużą gotówkę z góry), subscription dla SMB (niski próg, MRR predictable). Decyzja zależy od:
- jaki jest typowy customer profile w pierwszych 12 miesiącach
- czy chcemy budować recurring revenue book (predictable revenue dla VC) czy duże transakcje (bootstrap-friendly)
- ile czasu chcemy poświęcać na sales process (license = długi cykl, subscription = krótszy)

**Open dla dyskusji.**

---

## Success metrics dla v1 *(nowa sekcja)*

Jak poznamy że v1 działa biznesowo:

**Tier 1 — produkt działa technicznie** (must-have do shipowania):
- Pierwsza automatyczna faktura wychodzi w środowisku Netii w ciągu 8 tygodni.
- Test: 30 dni nieprzerwanej pracy schedulera w środowisku staging. Zero missed runs, zero double-billings.
- Integration test suite > 95% coverage na komendy + API endpoints.

**Tier 2 — produkt działa u pierwszego klienta** (must-have do drugiej sprzedaży):
- Netia używa go produkcyjnie do ≥ 100 aktywnych subskrypcji przez ≥ 30 dni bez incydentu.
- 0 ręcznych korekt w fakturach z powodu błędu billingu (proration, numeracja, walutowanie).
- Operator finansowy Netii potwierdza pisemnie że oszczędzili X godzin/miesiąc vs poprzedniego procesu.

**Tier 3 — produkt można skalować** (must-have do pivotu od bootstrap do growth):
- 2-3 klienci poza Netią używają billing standalone (bez CPQ) przez ≥ 60 dni.
- Bridge package `@dainamite/cpq-billing-bridge` jest sformalizowany i wdrożony u co najmniej 1 klienta poza Netią.
- Customer churn = 0 w pierwszych 6 miesiącach (klienci nie odpinają billingu).

**Anti-metrics** (jeśli to się zdarza, mamy problem):
- > 1% faktur wymaga ręcznej korekty
- > 5% subskrypcji w runie kończy się statusem `failed` (i nie jest to problem klientowych danych)
- Czas onboardingu nowego klienta (od decyzji do działającej pierwszej faktury) > 2 tygodnie
- Bridge'e dla różnych klientów dramatycznie się różnią — sygnał, że API jest nieelastyczne

---

## Co to znaczy dla pierwszego klienta (Netia / "Demo Netia")

W repo `open-mercato-cpq-v0` (które staje się "Demo Netia") billing instaluje się jako moduł lokalny. Bridge CPQ→Billing pisze się raz, jako osobny moduł lub osobny pakiet, i jest mapowaniem zdarzeń CPQ (aktywacja ordera, amend, cancel) na wywołania API billingu. Dla Netii: klient telco z subskrypcjami fiber/TV/mobile, ARC według ich polityki, faktura miesięczna w stylu telco — całe to UX siadają na billingu bez przeróbek.

Po ekstrakcji do `dainamite-core` monorepo (osobne planowane zadanie), dokładnie ten sam moduł billing jest sprzedawany kolejnym klientom — z innym CPQ, ręcznym pushowaniem subskrypcji, albo z importera CSV. Każdy z nich pisze swój bridge, billing pozostaje niezmieniony.

**Wartość dla Netii konkretnie:**
- zastąpienie ich obecnego procesu rozliczeniowego (jaki by nie był) jednym automatycznym pipeline'em
- pełna integracja z CPQ, którego od nas i tak biorą
- audytowalność transakcji (procesy compliance i KSeF nadchodzą)
- wbudowany webhook dispatcher → łatwa integracja z ich CRM/ksiegowością

---

## Co warto potwierdzić zanim ruszymy z Phase 0

1. **Wariant architektoniczny A jest finalny** — nie planujemy w bliskiej perspektywie ekstrakcji `@dainamite/billing-core` do produktu standalone-from-OM. Jeśli tak, spec jest gotowy. Jeśli nie — dyskutujemy zanim zaczniemy implementację. (Status: zatwierdzone, DD-BIL-9 w specu.)
2. **Pierwszy klient walidacyjny to Netia/CPQ** — czyli historie z Phase 4 demo będą napędzane CPQ events, a bridge piszemy my. Jeśli mamy drugiego klienta, który chce billing **bez CPQ**, dobrze byłoby już teraz mieć od niego use case żeby przewalidować API.
3. **Phase 4 = v1 release** — wszystkie 5 faz idą jako jeden ciągły strumień, bez wydania pośredniego. Implikacja: do momentu domknięcia Fazy 4 nie sprzedajemy. 8-10 tygodni roboty.
4. **Model monetyzacji** — do dogrania (sekcja powyżej). Decyzja wpłynie na to, jakie dodatkowe fichery są krytyczne (np. usage-tracking jeśli idziemy w % od obrotu) i jakie SLA musimy zobowiązać się utrzymać.
5. **Czy aktywnie szukamy drugiego klienta walidacyjnego już teraz, czy czekamy na Netię** — wpływa na to jak ostro promujemy "API-first standalone" w spec'u i UX.

---

## Materiały referencyjne

- **Pełny spec techniczny**: `specs/implementation/xd-249-billing-module.md` (1518 linii) — dla developerów wdrażających.
- **Spec architektury produktu**: `.ai/specs/SPEC-001-2026-04-23-module-distribution-architecture.md` — kontekst trzywarstwowej architektury (L1 OM / L2 dainamite / L3 customer apps).
- **Open Mercato docs**: `node_modules/@open-mercato/*/AGENTS.md` — framework pod którym leżymy.

---

*Doc do dyskusji. Wszystkie sekcje są negocjowalne, w szczególności: monetyzacja, customer acquisition strategy, success metrics targets.*
