# SPEC-001 — Module Distribution Architecture

**Date**: 2026-04-23
**Status**: Draft — do rozmowy ze wspólnikiem
**Owner**: Kamil

## TLDR

**Co budujemy:**
- Jedno **product monorepo** (nowe repo) z naszymi reużywalnymi modułami (CPQ, Catalog, Order Mgmt, Subscriptions, Billing, Address Inventory...) publikowane jako osobne paczki npm pod naszym namespace.
- Każdy **klient dostaje własne repo** (standalone Open Mercato app), które instaluje wybrane nasze paczki z npm + ma własny custom code w `src/modules/@app/`.

**Dlaczego:**
- Open Mercato natywnie wspiera ten model (`from: '<npm-pkg>'` w `src/modules.ts`, `yarn mercato module add`, `requires: []` dla dep-graph).
- Monorepo daje atomowe zmiany cross-package + wspólne tooling; osobne customer repos izolują IP klienta i deployment.
- Modularna publikacja (nie jeden big-package) pozwala sprzedawać poszczególne moduły niezależnie i komponować bundle per branża / per klient.

**Scope:**
- Struktura nowego product monorepo (packages, tooling, workflow)
- Reguły splitowania modułów na paczki (co = osobna paczka, co = wspólna)
- Wzorce customer repo + template do scaffoldowania
- Strategia wersjonowania i publikacji

## Open Questions *(do decyzji ze wspólnikiem)*

- **Q1**: Jaki namespace npm — `@yourco/*`, `@firmname/*`? Decyzja wpłynie na wszystkie future package names. : dainamite
- **Q2**: Jaki prywatny registry — **GitHub Packages (darmowe dla private packages na każdym planie GH, quota 500MB/1GB transfer na free)**, Verdaccio (self-host ~$5/mies VPS), czy npm Teams ($7/user/mies)? Rekomendacja: GitHub Packages. Github Packages
- **Q3**: Monorepo tooling — same yarn workspaces wystarczy, czy dokładamy Nx / Turborepo od dnia zero? 
- **Q4**: Czy obecny `open-mercato-cpq-v0` staje się (a) prototypem z którego ekstraktujemy CPQ do nowego repo, (b) pierwszym customer repo, (c) wyrzucamy i zaczynamy od zera? : Demo netia , dainamite-core
- **Q5**: Licencjonowanie/billing wobec klienta — per-package SKU czy per-seat / per-tenant? Wpływa na to jak strukturyzujemy meta-bundles. ; narazie nie
- **Q6**: Kto ma commit access do customer repos — tylko my, czy klient też? Konsekwencje dla CI/CD i sekretów.

---

## Architektura 3-warstwowa

```
┌─────────────────────────────────────────────────────────────┐
│ L1: Open Mercato Core (upstream, konsumujemy)               │
│     @open-mercato/core, @open-mercato/search, ...           │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ npm install
                              │
┌─────────────────────────────┴───────────────────────────────┐
│ L2: Product Modules (NASZE reużywalne moduły)               │
│     @yourco/cpq, @yourco/catalog, @yourco/billing,          │
│     @yourco/subscriptions, @yourco/cpq-address-inventory    │
│     ─── 1 monorepo, wiele paczek npm ───                    │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ npm install
                              │
┌─────────────────────────────┴───────────────────────────────┐
│ L3: Customer Apps (per klient, osobne repo)                 │
│     customer-acme-telco/, customer-beta-retail/, ...        │
│     ─── standalone Next.js app + custom @app/ modules ───   │
└─────────────────────────────────────────────────────────────┘
```

### L1 — Open Mercato Core

- Konsumujemy jako npm dependencies
- Używamy konwencji: `from: '@open-mercato/core'` w `modules.ts`
- Jeśli potrzebujemy zmienić zachowanie core modułu: `yarn mercato module eject <id>` → kopiuje do `src/modules/@app/<id>/` + rejestruje jako `from: '@app'`. **Eject robimy w customer repo, NIE w product monorepo.**

### L2 — Product Modules (nasze)

- **Jedno git repo** (`yourco-product/`), `yarn workspaces`
- **Każdy moduł = osobna paczka npm** (per default). Wyjątek: dwa moduły są inseparable (rzadkie).
- Każda paczka: własny `package.json`, własne migracje, własny `acl.ts`, własne encje
- Publikacja przez **changesets** do prywatnego registry

### L3 — Customer Apps

- **Osobne git repo per klient** (`customer-<name>/`)
- Struktura analogiczna do obecnego `open-mercato-cpq-v0`: standalone Next.js app
- `package.json` listuje tylko te `@yourco/*` paczki które klient kupił
- Customowy kod → `src/modules/@app/<klient>-<feature>/`
- Scaffoldowane z template repo (`customer-template/`)

---

## Struktura Product Monorepo

```
yourco-product/ (nowe repo)
├── package.json                    ← workspace root
│   "workspaces": ["packages/*"]
│
├── packages/
│   ├── cpq/                        → publikuje @yourco/cpq
│   │   ├── package.json            { "name": "@yourco/cpq", "version": "1.2.0" }
│   │   ├── src/modules/cpq/
│   │   │   ├── index.ts            metadata: { requires: ['catalog', 'sales'] }
│   │   │   ├── acl.ts              features: ['cpq.quote.manage', ...]
│   │   │   ├── data/entities.ts    Product, Offering, Quote, PricingTable, ...
│   │   │   ├── services/           (bundleService, pricingService, quotingService, ...)
│   │   │   ├── api/                (offerings, quotes, pricing-tables, ...)
│   │   │   ├── backend/            (UI)
│   │   │   ├── migrations/         własne migracje
│   │   │   └── setup.ts            seed data, tenant init
│   │   └── dist/                   (build output, nie commitowany)
│   │
│   ├── catalog/                    → @yourco/catalog
│   ├── order-management/           → @yourco/order-management
│   ├── subscriptions/              → @yourco/subscriptions
│   ├── billing/                    → @yourco/billing
│   │
│   ├── cpq-address-inventory/      → @yourco/cpq-address-inventory
│   │   ├── package.json            peerDependencies: { "@yourco/cpq": "^1" }
│   │   └── src/modules/address-inventory/
│   │       index.ts                metadata: { requires: ['cpq'] }
│   │
│   └── cpq-telco-bundle/           → @yourco/cpq-telco (meta)
│       └── package.json            dependencies: {
│                                     "@yourco/cpq": "^1",
│                                     "@yourco/cpq-address-inventory": "^1",
│                                     "@yourco/billing": "^2"
│                                   }
│                                   (bez src/modules/ — tylko deps)
│
├── tools/                          ← wspólny tooling
│   ├── tsconfig.base.json
│   ├── eslint-config/
│   └── build-scripts/
│
├── .changeset/                     ← changesets dla versioning
│   └── config.json
│
├── .github/workflows/
│   ├── ci.yml                      yarn test + typecheck + lint
│   └── release.yml                 changesets/action → publikacja
│
├── docs/
│   ├── ARCHITECTURE.md             (ten dokument przeniesiony)
│   ├── MODULE_AUTHORING.md         jak napisać nowy moduł
│   └── CUSTOMER_ONBOARDING.md      jak odpalić nowego klienta
│
├── .ai/                            (enforcement rules, lessons, skills)
└── README.md
```

### Reguły splitu na paczki

| Reguła | Opis |
|--------|------|
| **1 domena = 1 paczka** | CPQ w jednej paczce, Billing w drugiej. Nie łączymy bez powodu. |
| **Industry/vertical add-on = osobna paczka** | `cpq-address-inventory` (telco), przyszłe `cpq-retail-loyalty`, `cpq-healthcare-consent`. |
| **Meta-bundle = osobna paczka bez kodu** | Tylko `dependencies` na inne `@yourco/*`. Zero `src/modules/`. |
| **Customer-specific = NIE publikuje się** | Żyje w customer repo jako `src/modules/@app/*`. |
| **Wspólne utils = `@yourco/shared`** | Tylko jeśli naprawdę cross-package reuse. Uważaj na coupling. |

### Wzorce zależności

**Jak deklarujemy zależność między naszymi paczkami:**

```json
// packages/cpq-address-inventory/package.json
{
  "name": "@yourco/cpq-address-inventory",
  "peerDependencies": {
    "@yourco/cpq": "^1.0.0"
  }
}
```

- `peerDependencies` (NIE `dependencies`) — klient instaluje obie, ale yarn zapewnia tę samą instancję CPQ (nie duplikuje).
- Compatibility enforcement przez semver range.

**W kodzie modułu:**

```ts
// packages/cpq-address-inventory/src/modules/address-inventory/index.ts
export const metadata: ModuleInfo = {
  name: 'address-inventory',
  requires: ['cpq'],  // ← Open Mercato wyłapie jeśli cpq nie włączony
  version: '1.0.0',
}
```

### Cross-package data — ZASADA

**Żadnych ORM relations między paczkami.** Tylko FK jako string.

```ts
// ❌ ŹLE — relation między modułami
// packages/cpq-address-inventory/src/modules/address-inventory/data/entities.ts
@Entity()
export class ServiceAddress {
  @ManyToOne(() => Product)   // ← Product z @yourco/cpq — NIE WOLNO
  product!: Product
}

// ✅ DOBRZE — FK jako string
@Entity()
export class ServiceAddress {
  @Property() productId!: string   // ← FK bez ORM relation
}
```

**Dlaczego:** moduły mogą być włączane/wyłączane dynamicznie. ORM relation tworzy hard-link który się psuje gdy jeden z modułów nie jest aktywny. To fundamentalna reguła Open Mercato.

---

## Customer Repo — struktura

```
customer-acme-telco/ (osobne repo per klient)
├── package.json
│   "dependencies": {
│     "@open-mercato/core": "^0.4.10",
│     "@yourco/cpq": "^1.2.0",
│     "@yourco/cpq-address-inventory": "^1.0.0",   ← bo telco
│     "@yourco/billing": "^2.0.1",
│     "next": "^16.0.0"
│   }
│
├── src/
│   ├── modules.ts                  ← rejestracja paczek + custom
│   │   [
│   │     { id: 'auth', from: '@open-mercato/core' },
│   │     { id: 'customers', from: '@open-mercato/core' },
│   │     { id: 'catalog', from: '@yourco/catalog' },
│   │     { id: 'cpq', from: '@yourco/cpq' },
│   │     { id: 'address-inventory', from: '@yourco/cpq-address-inventory' },
│   │     { id: 'billing', from: '@yourco/billing' },
│   │     { id: 'acme-pricing-rules', from: '@app' }  ← custom
│   │   ]
│   │
│   ├── modules/@app/
│   │   └── acme-pricing-rules/     ← custom code TYLKO dla Acme
│   │       ├── index.ts
│   │       ├── data/entities.ts
│   │       ├── services/
│   │       └── migrations/
│   │
│   ├── di.ts                        app-level DI overrides
│   └── bootstrap.ts
│
├── .env.example
├── docker-compose.yml              Postgres, Redis, Meilisearch
├── Dockerfile
└── .github/workflows/deploy.yml
```

### Workflow onboardingu klienta

```bash
# 1. Scaffold z template
gh repo create customer-acme-telco --template yourco/customer-template --private

# 2. Dodaj moduły
cd customer-acme-telco
yarn mercato module add @yourco/cpq
yarn mercato module add @yourco/cpq-address-inventory    # bo telco
yarn mercato module add @yourco/billing

# 3. (Opcjonalnie) eject core module jeśli trzeba głębokich zmian
yarn mercato module eject catalog

# 4. Custom code
mkdir -p src/modules/@app/acme-pricing-rules
# ... piszemy kod

# 5. Migracje
yarn db:generate && yarn db:migrate

# 6. Deploy
```

---

## Versioning & Publishing

### Changesets workflow

```bash
# Developer w product monorepo po zmianie:
yarn changeset
# ← interaktywnie: które paczki zmienione, jaki bump (patch/minor/major), opis

# Przy merge do main:
yarn changeset version    # bumpuje wersje w package.json + generuje CHANGELOG
yarn changeset publish    # publikuje na npm
```

### Semver contract

- **Patch** (1.2.3 → 1.2.4): bugfix, no API change
- **Minor** (1.2.0 → 1.3.0): new features, backwards compatible (dodanie pola, nowy endpoint)
- **Major** (1.2.0 → 2.0.0): breaking change (usunięcie pola, zmiana schema migration wymagająca manual)

### Coordinated bumps

Zmiana API w `@yourco/cpq` która wymaga zmian w `@yourco/cpq-address-inventory` → **jeden PR, changeset bumpuje obie paczki**. Peer-dep range aktualizowany automatycznie.

---

## Migration Plan (z obecnego stanu)

### Obecny stan
- `open-mercato-cpq-v0/` — standalone app z `src/modules/cpq/` (wszystko razem)
- Brak podziału na paczki
- Brak separacji address-inventory

### Krok 1 — Setup nowego product monorepo
1. `gh repo create yourco-product --private`
2. Inicjalizacja: yarn workspaces + changesets + tsconfig base + ESLint
3. CI pipeline (test + typecheck + lint)
4. Placeholdery `packages/cpq/`, `packages/catalog/`, itd. z `package.json`

### Krok 2 — Ekstrakcja CPQ
1. Skopiuj `open-mercato-cpq-v0/src/modules/cpq/*` do `yourco-product/packages/cpq/src/modules/cpq/`
2. Skonfiguruj `package.json` z exports, deps
3. Uruchom testy, typecheck
4. Opublikuj `@yourco/cpq@0.1.0` na prywatny registry

### Krok 3 — Wydzielenie address-inventory
1. Audit: co w obecnym CPQ jest inventory-related (api/inventory/, services/cpqInventoryService.ts, backend/cpq/inventory/, entities)
2. Rozbij `data/entities.ts` — zostają w CPQ tylko encje core, inventory do nowej paczki
3. Przenieś inventory code do `packages/cpq-address-inventory/src/modules/address-inventory/`
4. Zastąp ORM relations (jeśli są) FK-stringami
5. `metadata.requires = ['cpq']`
6. Opublikuj `@yourco/cpq-address-inventory@0.1.0`

### Krok 4 — Customer repo z obecnego v0
1. `open-mercato-cpq-v0` staje się `customer-<first-client>` (rename) LUB tworzymy nowy od template
2. Usuń `src/modules/cpq/` (teraz z npm)
3. Dodaj do `package.json`: `@yourco/cpq`, `@yourco/cpq-address-inventory`
4. Update `src/modules.ts`: `from: '@yourco/cpq'` zamiast `from: '@app'`
5. Zweryfikuj że wszystko działa

### Krok 5 — Kolejne moduły
- Catalog, Order Mgmt, Subscriptions, Billing — ekstrakcja analogicznie
- Jeśli nie istnieją jeszcze → piszemy od razu w product monorepo

---

## Ryzyka

Co może pójść nie tak przy tej architekturze i jak się zabezpieczamy. Severity = waga problemu, Residual = ryzyko które zostaje po mitigation.

### 1. Za dużo małych paczek (Severity: Medium, Residual: Niski)

**Problem:** Rozbijemy CPQ na zbyt drobne kawałki — osobna paczka na pricing, osobna na quote workflow, osobna na konfigurator, itd. Skończymy z 30 paczkami zamiast 8.

**Dlaczego to boli:** każda zmiana wymaga bumpu i skoordynowania wersji w wielu paczkach. Klient patrzy na listę i nie wie co instalować. Developer dodając feature musi się zastanawiać "do której z 5 paczek to wrzucić".

**Jak chronimy:** trzymamy się reguły **"1 domena = 1 paczka"**. Osobną paczkę wydzielamy tylko gdy klient może **naprawdę** jej nie chcieć (np. address-inventory dla nie-telco). W wątpliwości — nie wydzielamy.

---

### 2. Sztywne powiązania encji między paczkami (Severity: High, Residual: Średni)

**Problem:** Ktoś napisze w module `address-inventory` encję `ServiceAddress` która ma `@ManyToOne(() => Product)` gdzie `Product` jest w `@yourco/cpq`. Powstaje twarde, ORM-owe powiązanie cross-package.

**Dlaczego to boli:** cała idea modułowości się wali — nie da się włączyć `address-inventory` bez CPQ, bo baza szuka tabeli `product`. Testy integracyjne modułu w izolacji nie działają. Update CPQ wymaga synchronicznego update wszystkich add-onów.

**Jak chronimy:**
- Reguła: **cross-package reference tylko jako FK string** (`productId: string`), nigdy jako ORM relation
- Lint rule blokująca import encji z innej paczki
- Code review checklist
- Test który próbuje wystartować moduł w izolacji

---

### 3. Konflikt wersji u klienta (Severity: Medium, Residual: Niski)

**Problem:** Klient ma `@yourco/cpq@1.2` i `@yourco/cpq-address-inventory@1.0`. Bumpujemy cpq do `2.0` (breaking change). Klient robi upgrade, ale address-inventory wymaga wersji `^1` → w `node_modules` lądują **dwie kopie CPQ** jednocześnie.

**Dlaczego to boli:** dwie instancje tego samego modułu = dwa DI containery = niekompatybilne encje. Runtime crash albo, gorzej, ciche bugi gdzie dane się rozjeżdżają między "kopiami" CPQ.

**Jak chronimy:**
- Używamy **`peerDependencies`** (nie `dependencies`) w add-on packages — wymusza jedną wspólną instancję
- **Changesets coordinated bumps** — major bump CPQ = w tym samym PR bumpujemy wszystkie add-ony które muszą zaakceptować nową wersję
- Wąskie peer ranges (`^1.0.0`) — auto-akceptuje patch/minor, odrzuca major

---

### 4. Friction z tokenami dostępu do paczek (Severity: Medium, Residual: Niski)

**Problem:** Paczki są prywatne (na GitHub Packages). Nowy developer klonuje customer repo, robi `yarn install` → błąd 401 bo nie ma tokena. Podobnie nowy CI pipeline zawiedzie bez skonfigurowanego sekretu.

**Dlaczego to boli:** każdy nowy dev lub nowe customer repo to friction. Ktoś zapomni dodać token do CI secrets i deployment zawali się w nieoczekiwanym momencie.

**Jak chronimy:**
- **Standardowy `.npmrc`** commitowany w każdym repo (customer + product)
- **README z instrukcją onboardingu** — jak wygenerować token, gdzie wkleić
- Osobne tokeny: read-only dla devs, write-only dla CI (tylko w product monorepo do publishu)

---

### 5. Customowy kod klienta rośnie bez kontroli (Severity: High, Residual: Średni)

**Problem:** Piszemy dla klienta Acme custom pricing rules. Potem custom quote workflow. Potem integrację z ich ERP. Po roku w `src/modules/@app/` Acme ma 10 modułów po 1000+ linii.

**Dlaczego to boli:**
- Każdy update `@yourco/cpq` wymaga zweryfikowania czy 10 custom modułów dalej działa
- Nic z tego nie jest reużywalne — drugi klient prosi o podobny feature, kopiujemy kod, powstaje drift
- Kod pisany tenant-specific trudno potem wyekstrahować do paczki produktowej

**Jak chronimy:**
- **Audit co pół roku** — przegląd `@app/` we wszystkich customer repos, wyłapanie powtórzeń
- **Reguła promocji:** jeśli ten sam feature pojawia się u 2+ klientów → natychmiastowo promujemy do product monorepo jako nowa paczka `@yourco/*`
- **Style code w `@app/`** — piszemy generycznie, konfigurowalnie, jakbyśmy mieli to zaraz promować. Żadnego hardcode'owania nazw klienta

---

### 6. Breaking change paczki wymaga migracji DB u klienta (Severity: High, Residual: Średni)

**Problem:** Wydajemy `@yourco/cpq@2.0.0` ze zmianą schematu bazy (np. rozbicie pola `price` na `net_price` + `tax_rate`). Klient robi `yarn upgrade`, odpala aplikację → crash, bo jego baza dalej ma starą strukturę.

**Dlaczego to boli:** production downtime. Klient nie wie jak zrobić upgrade bezpiecznie. Dane mogą zostać uszkodzone jeśli migracja pójdzie w połowie.

**Jak chronimy:**
- **Każda paczka dostarcza własne migracje** — `yarn db:migrate` po upgrade robi resztę
- **Dokumentacja upgrade path** dla każdego major bumpu — "co się zmienia, czy trzeba backup, kolejność kroków"
- **Testy upgrade** na realnej bazie (nie tylko fresh install) — symulujemy klienta z danymi z v1 i sprawdzamy czy v2 się zapina
- Komunikacja z klientami — breaking change = proaktywna notyfikacja, nie niespodzianka

---

### 7. Eject core modułu zamraża klienta na wersji (Severity: Medium, Residual: Średni)

**Problem:** Klient potrzebuje głębokiej customizacji jakiegoś Open Mercato core modułu (np. `catalog`). Robimy `yarn mercato module eject catalog` — kod core kopiuje się do `src/modules/@app/catalog/`. Od tego momentu klient już **nie dostaje update'ów upstream** tego modułu.

**Dlaczego to boli:**
- Bugfixy i security fixy z Open Mercato core nie trafią do klienta automatycznie
- Wymaga manualnego merge przy każdej wersji Open Mercato
- Z czasem kod `@app/catalog` driftuje od upstream — co dalej utrudnia merge

**Jak chronimy:**
- **Eject tylko gdy naprawdę nie ma innej drogi** — najpierw próbujemy Universal Module Extension System (UMES) do mniejszych zmian
- **Dokumentacja decyzyjna**: kiedy eject, kiedy extension, kiedy event-based hook
- **Tracking ejectowanych modułów** per klient — wiemy które customer repos mają ejecty i przy każdym majorze Open Mercato robimy im świadomy review

---

## Tooling decisions

| Obszar | Wybór domyślny | Alternatywa |
|--------|----------------|-------------|
| Package manager | **Yarn 4 (Berry) + workspaces** | pnpm workspaces |
| Monorepo orchestrator | **Yarn workspaces alone** (lightweight) | Nx / Turborepo (gdy >15 paczek) |
| Versioning | **Changesets** | Lerna (deprecated), Rush |
| Registry | **GitHub Packages** (private, darmowe) | Verdaccio self-host (free+hosting), npm Teams ($7/user/mies) |
| CI | **GitHub Actions** | GitLab CI |
| Node | **>= 24** (zgodnie z Open Mercato) | - |

---

## Decyzje do zatwierdzenia ze wspólnikiem

Przed otwarciem nowego repo musimy się zgodzić na:

1. ✅ **Model 3-warstwowy**: L1 core / L2 nasze paczki monorepo / L3 customer repos
2. ⏳ **Namespace npm**: `@yourco/*` → ?
3. ⏳ **Registry**: GitHub Packages / Verdaccio / inne
4. ⏳ **Monorepo tooling**: same workspaces czy od razu Nx/Turbo
5. ⏳ **Los obecnego `open-mercato-cpq-v0`**: ekstrakcja → 1. customer repo, czy wyrzucenie
6. ⏳ **Lista paczek v1**: CPQ, Catalog, Order Mgmt, Subscriptions, Billing + add-ons?
7. ⏳ **Licencjonowanie**: per-package czy per-tenant
8. ⏳ **Timeline**: kiedy kick-off, kto ekstraktuje, do kiedy MVP monorepo gotowe

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-23 | Initial spec draft based on architecture discussion |
