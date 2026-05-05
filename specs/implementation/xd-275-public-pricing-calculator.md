# XD-275: Public Pricing Calculator — Implementation Spec

## Summary

Deliver the **public-facing pricing calculator** described in the [Cloud Services Provider requirements](../sample-use-cases/cloud-services-provider-requirements.md) for the **Puffin Cloud** tenant seeded by [XD-276](./xd-276-cpq-data-seed.md). An anonymous visitor lands on `/demo_puffin/cloud-pricing-calculator`, picks either a **Predefined Solution** (use-case bundle) or builds a **Custom Solution** (product-by-product), sees live, accurate prices in under 250 ms per change, and converts into a real `CpqQuoteConfiguration` (status `with_customer`) by submitting a 3-field "Get a Quote" form.

The calculator MUST NOT hardcode any prices, attributes, or product data. Everything is rendered from the same database the backend uses, but **CPQ source code is not modified**. All public-facing logic, routes, and UI live inside `src/modules/demo_puffin/`. The module's server-side route handlers authenticate as **`admin@puffin.com`** (credentials in `.env.local`) against the existing **authenticated** CPQ endpoints, cache the resulting JWT, and proxy public requests through that admin session — filtering responses to the offerings flagged `metadata.listedInCalculator: true` by XD-276.

This spec also closes a small companion bug discovered while QA-testing the Puffin tenant: the **Sales-Led Quote** wizard's step 2 ("Contract Model") references an unregistered `context_select` step type and crashes the wizard runner. Section [§14 Companion Fix](#14-companion-fix--context_select-wizard-step) ships the new step type **inside `demo_puffin`** (registered at module load via CPQ's public `registerStepType` extension API), so CPQ remains untouched.

> **Domain parent**: Public Web Surface — Puffin Cloud demo
> **Blueprint ref**: SPEC-001 (Module Distribution Architecture). All XD-275 code is L3 (`@app/demo_puffin`) — this is a customer-specific demo. CPQ remains clean and packageable as `@dainamite/cpq`.
> **Dependencies**:
>   - **XD-276** (multi-tenant data seed — `puffin` tenant + admin user + offerings flagged `listedInCalculator: true`)
>   - **XD-201** (Quoting domain — `/api/cpq/quotes` + `quoteContext.fromBundle` expansion)
>   - **XD-187** (Calculate Price API — `/api/cpq/quotes/price`)
>   - **XD-186** (Pricing Tables) / **XD-188** (Price Rules) / **XD-223** (Bundled Offerings)
> **Out of scope**:
>   - Multi-currency FX conversion (USD only for the demo).
>   - Customer self-service portal beyond the magic-link quote acceptance.
>   - Real billing / provisioning integration.
>   - Promoting the calculator UI into a reusable `@dainamite/csp-calculator` package — that lands when a second CSP customer ships.
>   - Modifying CPQ code (the public surface lives entirely in `demo_puffin`; CPQ-side changes are explicitly forbidden by this spec).
>   - Onboarding / pricing CMS for ops to edit calculator copy from the backend.

---

## 1. Motivation

The XD-276 work landed a fully-seeded Puffin Cloud tenant with 15 product specifications, ~30 offerings, 4 pricing tables, 14 price rules, and 3 use-case bundles, all flagged `listedInCalculator: true`. There is currently **no consumer** of that data outside the authenticated backend at `/backend/cpq/*`.

The deliverable is a polished, conversion-oriented public calculator that:

1. Demonstrates the full Open Mercato CPQ pricing engine to anonymous prospects in real time.
2. Acts as the canonical L3 customer demo: a single repo + `yarn initialize` produces a multi-tenant app where one tenant (`puffin`) has a public storefront-style calculator, and the others (`acme`, `gix`) keep their authenticated-only experience.
3. Does **not** require any change to `@dainamite/cpq` — the public surface is implemented entirely in the L3 customer module, using the existing authenticated CPQ APIs through a **service-account-style admin proxy**.

### Current State

| Aspect | Today | After XD-275 |
|---|---|---|
| `/demo_puffin/cloud-pricing-calculator` page | 404 (does not exist) | Public, no-login calculator with two flows + bundles, served by `demo_puffin` |
| Public-facing API | None | `/api/demo_puffin/cloud-pricing-calculator/*` (in `demo_puffin/api/`) — proxies authenticated CPQ APIs as `admin@puffin.com` |
| CPQ source code | Untouched | Untouched |
| Admin credentials for proxy | Already seeded by XD-276 (`admin@puffin.com` / `secret`) | Reused from `.env.local` (`CPQ_DEMO_PUFFIN_ADMIN_EMAIL`, `..._PASSWORD`) |
| Lead capture | Manual sales rep follow-up | Captcha-gated `POST /api/puffin/pricing/leads` issues a 10-min `quote_session_token` (JWT) |
| Anonymous quote creation | Impossible (every CPQ quote endpoint requires auth + `cpq.quotes.manage`) | One-shot, token-bound `POST /api/puffin/pricing/quotes` server-side proxies the standard CPQ endpoint with the cached admin JWT |
| Offering visibility filter | Not enforced anywhere | The proxy filters every catalog/attribute/price response server-side to `metadata.listedInCalculator === true` AND `lifecycleStatus === 'active'` |
| Sales-led Puffin wizard | Crashes at step 2 ("Unknown step type: context_select") | New `context_select` step type registered by `demo_puffin` via CPQ's public `registerStepType` API |

---

## 2. Non-Goals

To keep scope tight against an aggressive demo cadence, the following are explicitly out:

- **Modifying CPQ.** This is the load-bearing constraint of this spec. If a feature looks like it needs a CPQ change, find a `demo_puffin`-only path or push the feature out.
- **Multi-tenant calculator instances at runtime.** Exactly one tenant (`puffin`) is served by `/demo_puffin/cloud-pricing-calculator`. A future `demo_finch/` would mount its own `/demo_finch/<calculator-slug>`.
- **Server-side rendering of price.** Price is computed only via the live `/api/demo_puffin/cloud-pricing-calculator/price` proxy. SSR is used only for the catalogue grid + chooser (so the page is crawlable and fast on first paint).
- **Saved baskets / accounts.** The cart lives in URL state + sessionStorage. We do not create user accounts before the lead form is submitted.
- **Card payments / checkout.** Submitting "Get a Quote" creates a `with_customer` quote. Sales follow up. No payment intent.
- **A/B testing infrastructure** beyond a single emitted analytics event.

---

## 3. Architecture

### 3.1 Where things live (everything inside `demo_puffin`)

```
src/modules/demo_puffin/
├── api/
│   └── cloud-pricing-calculator/                         ← all routes namespaced under demo_puffin
│       ├── catalog/route.ts          ← GET, public, edge-cached 60s; reads via admin proxy
│       ├── config/route.ts           ← GET, public; whitelist of frontend-safe config (regions, captcha key, currency)
│       ├── attributes/route.ts       ← POST, public; proxies CPQ attribute resolution
│       ├── price/route.ts            ← POST, public; proxies /api/cpq/quotes/price (the hot path)
│       ├── leads/route.ts            ← POST, captcha → JWT (signed by demo_puffin)
│       └── quotes/route.ts           ← POST, JWT-bound; proxies /api/cpq/quotes + items + status
├── frontend/
│   └── cloud-pricing-calculator/                         ← `/demo_puffin/cloud-pricing-calculator`
│       ├── page.tsx                  ← SSR shell, reads catalog from /api/demo_puffin/cloud-pricing-calculator/catalog
│       └── components/               ← chooser, configurator, cart, bundle cards (all client)
├── lib/
│   └── public-calculator/
│       ├── admin-session.ts          ← cached admin JWT (HTTP loopback to /api/auth/session)
│       ├── proxy-client.ts           ← thin wrapper: addAuth + fetch + JSON
│       ├── catalog-filter.ts         ← keeps only listedInCalculator + sanitizes metadata
│       ├── lead-token.ts             ← issue/verify the 10-min quote_session_token
│       ├── nonce-store.ts            ← in-memory single-use map (token jti → used)
│       ├── captcha.ts                ← pluggable verifier (disabled / recaptcha_v3)
│       └── env.ts                    ← reads + validates CPQ_DEMO_PUFFIN_* + new PUFFIN_PUBLIC_* vars
├── workflows/
│   └── steps/
│       └── ContextSelectStep.tsx     ← companion fix; lives in demo_puffin
├── setup.ts                          ← side-effect: imports registerStepType('context_select', ...)
└── index.ts                          ← unchanged
```

**No file under `src/modules/cpq/` is modified.** The only CPQ surface area touched is the public extension API: `registerStepType` (already exported by `cpq/workflows/registry.ts` and intended for exactly this kind of consumer).

### 3.2 Admin-proxy authentication model

The public visitor is anonymous. Their request hits `demo_puffin/api/cloud-pricing-calculator/<route>`. That handler:

1. Calls `getPuffinAdminToken()` (in `lib/public-calculator/admin-session.ts`).
2. The helper checks an in-memory cache. If a valid JWT exists (more than 10 minutes from expiry), it's returned immediately.
3. On cache miss, the helper POSTs to the existing `/api/auth/session` route with `email=$CPQ_DEMO_PUFFIN_ADMIN_EMAIL`, `password=$CPQ_DEMO_PUFFIN_ADMIN_PASSWORD` (env-resolved). The response carries an `auth_token` JWT plus a `refreshToken` (when `remember=true`). The JWT is cached with its expiry (`jwt-decode` to read `exp`); the refresh token is stored alongside.
4. With the JWT in hand, the handler forwards the visitor's request to the relevant authenticated CPQ endpoint:
   - `/api/cpq/quotes/price` for live pricing
   - `/api/cpq/offerings`, `/api/cpq/specifications`, `/api/cpq/product-attributes` (or whichever catalog endpoints exist; see §4.1 for fallbacks) for catalog
   - `/api/cpq/quotes` + `/items` + `/status` for quote conversion
5. The CPQ response is **filtered** in-process by `catalog-filter.ts` (offerings without `listedInCalculator: true` are dropped; internal metadata fields like cost, margin, vendor are stripped) and returned to the visitor.

```
┌────────────────────────┐
│ Anonymous visitor      │
│ POST /api/demo_puffin/cloud-pricing-calculator/price
└──────────┬─────────────┘
           ▼
┌────────────────────────┐     cached JWT? ────────────► return cached
│ demo_puffin handler    │
│  - getPuffinAdminToken │     cache miss
│  - filter response     │     │
└──────────┬─────────────┘     ▼
           │           ┌────────────────────────┐
           │           │ POST /api/auth/session │
           │           │ email/password from env│
           │           │  (loopback HTTP)       │
           │           └──────────┬─────────────┘
           │                      ▼
           │           ┌────────────────────────┐
           │           │ JWT cached for ~7h     │
           │           └────────────────────────┘
           │
           ▼
┌────────────────────────┐
│ POST /api/cpq/quotes/price
│ Authorization: Bearer  │  ← admin JWT
│ (existing CPQ route,   │
│  unchanged)            │
└──────────┬─────────────┘
           ▼
┌────────────────────────┐
│ Filter offerings by    │
│ listedInCalculator     │
│ Strip internal fields  │
└──────────┬─────────────┘
           ▼
   public visitor response
```

### 3.3 Why HTTP loopback, not in-process DI

We could resolve `cpqPricingService` directly via DI inside `demo_puffin/api/pricing/price/route.ts` and skip the loopback. We deliberately do **not**:

- The HTTP loopback exercises the **same code path** the authenticated UI uses, so the public calculator can never silently diverge (e.g. by skipping a route-level interceptor or feature check).
- It composes with the existing ACL system: if `admin@puffin.com` loses `cpq.quotes.view`, the calculator stops — the right safety property.
- The latency cost (one localhost round-trip per request, ~1–3 ms in dev, sub-ms in prod with HTTP/2 keep-alive) is negligible against the pricing service's own work.
- Token caching means `/api/auth/session` is hit at most once per ~7 hours, not once per visitor.

If profiling later shows the loopback is hot, we swap `proxy-client.ts`'s implementation for an in-process invoker without changing any other file.

### 3.4 What the calculator UI lives in `demo_puffin`, not a new `csp_calculator` module

SPEC-001's promotion rule is **"two customers before extracting"**. Until a second CSP customer ships, the UI lives in `demo_puffin`. Reasoning:

- `/pricing` is **branded Puffin** (hero copy, plan codenames "Puffling/Tufted/Atlantic…"). A reusable framework component would have to abstract the brand layer, which we should not do speculatively.
- Frontend route auto-discovery already supports `frontend/<path>/page.tsx` per any module — `demo_puffin/frontend/cloud-pricing-calculator/page.tsx` registers `/demo_puffin/cloud-pricing-calculator` with no manifest edit (the route slug mirrors the module id + page directory name, scoping the URL clearly to the demo).
- When a second CSP customer materialises, the agreed promotion path is to extract the *generic* React hooks (`useCalculatorCart`, `usePublicCatalog`, `usePublicPrice`) plus the admin-proxy library into `@dainamite/csp-calculator`, leaving brand layouts in each L3 module.

---

## 4. Public API (all under `/api/demo_puffin/cloud-pricing-calculator/*`, all in `demo_puffin/api/cloud-pricing-calculator/`)

Every route is anonymous (no `requireAuth` at the demo_puffin handler layer — Next.js Route Handlers in modules expose their own auth model). Every route exports `openApi` (per repo rule) and a Zod body/query schema.

### 4.1 `GET /api/demo_puffin/cloud-pricing-calculator/catalog`

Returns the offerings flagged `metadata.listedInCalculator === true && lifecycleStatus === 'active'` for the Puffin tenant. Edge-cached for **60 s** (`cache-control: public, max-age=60, s-maxage=60`).

**Server flow**:

1. `getPuffinAdminToken()` → admin JWT.
2. `proxyClient.get('/api/cpq/offerings?include=charges,attributes&pageSize=200', token)` (or whichever existing CPQ catalog endpoint serves this; if no aggregating endpoint exists, the handler issues 2-3 parallel CPQ calls — `/specifications`, `/offerings`, `/product-attributes` — and stitches them in-process. **No CPQ change required**: stitching is a `demo_puffin` concern.)
3. `catalogFilter(payload)` — keep only offerings with `metadata.listedInCalculator === true`; strip `metadata.cost*`, `metadata.margin*`, `metadata.vendor*`, any field starting with `_internal_`; compute `fromPriceMonthly` per spec.
4. Add `regions` (resolved from `puffinRegions` data) and `currencyCode: 'USD'`.

**Response shape**:

```jsonc
{
  "tenantSlug": "puffin",
  "currencyCode": "USD",
  "regions": [{ "code": "fra1", "label": "Frankfurt 1" }, { "code": "waw1", "label": "Warsaw 1" }],
  "specifications": [
    {
      "id": "...",
      "code": "SPEC-PUFFIN-VPS",
      "name": "Puffin VPS",
      "tagline": "Predictable flat-rate VPS.",
      "specType": "product",
      "uiPattern": "plan_grid",                 // derived from spec metadata
      "offerings": [
        {
          "id": "...",
          "code": "vps_nano",
          "marketingName": "Puffling",
          "fromPriceMonthly": 5,
          "designTimeValues": { "vcpu": 1, "ramGb": 1, "diskGb": 25, "bundledEgressTb": 1 },
          "attributes": [/* sanitized */],
          "charges": [/* sanitized */]
        }
      ]
    }
    /* bundles surface with specType: 'bundle', uiPattern: 'bundle_card' */
  ]
}
```

### 4.2 `GET /api/demo_puffin/cloud-pricing-calculator/config`

Tiny payload of frontend-safe config — no admin token used. Reads only env vars.

```jsonc
{
  "currencyCode": "USD",
  "defaultRegion": "fra1",
  "captcha": { "provider": "recaptcha_v3", "siteKey": "6Lc..." },
  "pricingDebounceMs": 250
}
```

### 4.3 `POST /api/demo_puffin/cloud-pricing-calculator/attributes`

Resolves dependent attribute options for a partial configuration. Server-side proxy to whichever CPQ attribute-resolution endpoint exists today (likely `/api/cpq/product-attributes/options`).

**Body**:
```jsonc
{ "offeringId": "uuid", "configuration": { "db_engine": "postgres", "ha_replicas": 1 } }
```

The handler validates `offeringId` is in the `listedInCalculator` set before forwarding (defence-in-depth).

Rate limit: 60 req/min/IP via the existing `rateLimiterService` from core bootstrap.

### 4.4 `POST /api/demo_puffin/cloud-pricing-calculator/price`

The hot path. Called on every cart mutation (debounced 250 ms client-side). Server-side proxy to `/api/cpq/quotes/price`.

**Body** (mirrors the authenticated `/api/cpq/quotes/price`):

```jsonc
{
  "currencyCode": "USD",
  "quoteContext": { "contract_model": "on_demand", "billing_cadence": "monthly" },
  "items": [
    {
      "lineKey": "client-uuid-1",
      "offeringId": "uuid",
      "configuration": { "region": "fra1", "os_image": "ubuntu-24.04", "backups": true },
      "parentLineKey": null,
      "quantity": 1
    }
  ]
}
```

**Server flow**:
1. Validate body via Zod (reject any `offeringId` not in the cached `listedInCalculator` set).
2. Force `quoteContext.public_calculator = true` (services may use this to gate logic).
3. `proxyClient.post('/api/cpq/quotes/price', body, adminToken)`.
4. Pass through the response unchanged (the price endpoint is already calculator-safe — no internal fields leak).
5. Emit a `puffin.calculator.priced` event with `{ items: count, totalMonthly, durationMs }`.

Rate limit: **120 req/min/IP**. Inline validation errors are surfaced as `validationErrors[]` rather than 4xx, so the cart still shows a partial price.

### 4.5 `POST /api/demo_puffin/cloud-pricing-calculator/leads`

Captcha-gated. Creates or finds a lead `CustomerEntity` via the admin proxy and issues a short-lived JWT signed by `demo_puffin` (separate from the admin JWT — different secret, different audience).

**Body**:
```jsonc
{ "name": "Jane Doe", "email": "jane@example.com", "company": "Doe Co", "captchaToken": "..." }
```

**Server flow**:
1. Verify captcha. In `disabled` mode (default in dev), accept any token and warn at startup.
2. `getPuffinAdminToken()`.
3. `proxyClient.post('/api/customers/companies', { name: company, primary_email: email, lifecycle_status: 'lead', metadata: { source: 'public_calculator', display_name: name } }, adminToken)`. If a customer with `(tenantId, email)` already exists, the standard customers endpoint upserts.
4. Sign and return a `quoteSessionToken` (`scope: 'puffin.public.quote'`, `customerId`, `jti`, `exp = now + 600s`) using `PUFFIN_PUBLIC_LEAD_JWT_SECRET`.

**Response**:
```jsonc
{ "quoteSessionToken": "eyJhbGciOi...", "expiresAt": "2026-05-05T11:30:00.000Z" }
```

Rate limit: **5 req/min/IP**.

### 4.6 `POST /api/demo_puffin/cloud-pricing-calculator/quotes`

Single-use, JWT-bound. Creates a real `CpqQuoteConfiguration` in `with_customer` status from the cart by chaining the existing CPQ endpoints through the admin proxy.

**Headers**: `Authorization: Bearer <quoteSessionToken>` (NOT the admin JWT — the visitor's lead token).

**Body**:
```jsonc
{
  "currencyCode": "USD",
  "quoteContext": { "contract_model": "on_demand", "billing_cadence": "monthly", "fromBundle": "<offeringId|null>" },
  "items": [/* same shape as /price */],
  "notes": "Submitted via public calculator"
}
```

**Server flow**:
1. Verify the lead JWT (signature, expiry, scope, audience). Extract `customerId`, `jti`.
2. Check the in-memory nonce store for `jti`. If used, return **409 Conflict**. Mark `jti` reserved (atomic).
3. `getPuffinAdminToken()`.
4. `proxyClient.post('/api/cpq/quotes', { customerId, currencyCode, quoteContext, ... }, adminToken)` → `quoteId`.
5. For each `items[]`: `proxyClient.post('/api/cpq/quotes/{quoteId}/items', item, adminToken)`.
6. `proxyClient.post('/api/cpq/quotes/{quoteId}/status', { status: 'with_customer' }, adminToken)`.
7. Mark `jti` as fully consumed.
8. Emit `puffin.calculator.quote_submitted` event.

If any step fails after the nonce is reserved but before consumption, the nonce is **released** (the visitor can retry with the same JWT until it expires). On full success, the nonce is permanently marked used.

**Response**:
```jsonc
{ "quoteId": "...", "quoteNumber": "Q-2026-00042", "status": "with_customer" }
```

Rate limit: **3 req/min/IP** (belt-and-braces; the JWT gates this anyway).

---

## 5. Configuration & Environment

### 5.1 Reused env vars (set by XD-276)

| Var | Source | Purpose |
|---|---|---|
| `CPQ_DEMO_PUFFIN_ADMIN_EMAIL` | XD-276 (`demo_puffin/setup.ts`) | Admin proxy login. Defaults to `admin@puffin.com`. |
| `CPQ_DEMO_PUFFIN_ADMIN_PASSWORD` | XD-276 (`demo_puffin/setup.ts`) | Admin proxy login. Defaults to `secret`. |

### 5.2 New env vars (added by XD-275, all `PUFFIN_PUBLIC_*` — clearly demo-scoped)

| Var | Required | Default | Purpose |
|---|---|---|---|
| `PUFFIN_PUBLIC_BASE_URL` | yes (in prod) | `http://localhost:3000` | Loopback base URL for the proxy client. |
| `PUFFIN_PUBLIC_LEAD_JWT_SECRET` | yes | — | HS256 secret for the visitor `quoteSessionToken`. ≥ 32 chars. Independent of the framework auth secret. |
| `PUFFIN_PUBLIC_LEAD_JWT_TTL_SECONDS` | no | `600` | |
| `PUFFIN_PUBLIC_DEFAULT_REGION` | no | `fra1` | |
| `PUFFIN_PUBLIC_CAPTCHA_PROVIDER` | no | `disabled` | `disabled` or `recaptcha_v3`. |
| `PUFFIN_PUBLIC_CAPTCHA_SITE_KEY` | when provider != disabled | — | Public site key. |
| `PUFFIN_PUBLIC_CAPTCHA_SECRET` | when provider != disabled | — | |
| `PUFFIN_PUBLIC_CAPTCHA_MIN_SCORE` | no | `0.5` | reCAPTCHA v3 threshold. |
| `PUFFIN_PUBLIC_RATE_PRICE` / `_ATTRIBUTES` / `_LEADS` / `_QUOTES` | no | `120` / `60` / `5` / `3` | Per-route per-IP per-minute budgets. |

### 5.3 Bootstrap UX

After `yarn initialize`, the operator pastes a single line into `.env.local`:

```
PUFFIN_PUBLIC_LEAD_JWT_SECRET=$(openssl rand -hex 32)
```

The init banner (extended in this spec) prints exactly this line with the secret already generated, plus a reminder that admin credentials are already configured by XD-276. No other manual steps.

If `PUFFIN_PUBLIC_LEAD_JWT_SECRET` is unset, every public route returns **503** with `{ error: 'public_calculator_not_configured' }` and the `/pricing` page renders an "Ops banner" component instead of the calculator. Don't crash the app for misconfigured deploys.

If admin login fails (wrong credentials, admin user missing), the proxy logs the failure once per minute and the public routes return **503** with a distinct error code (`public_calculator_admin_login_failed`).

---

## 6. Frontend Module — `/demo_puffin/cloud-pricing-calculator` in `demo_puffin`

### 6.1 Route registration

The standalone-app catch-all (`src/app/(frontend)/[...slug]/page.tsx`) auto-discovers any `frontend/<path>/page.tsx` from registered modules. Adding `src/modules/demo_puffin/frontend/cloud-pricing-calculator/page.tsx` makes `/demo_puffin/cloud-pricing-calculator` available with no manifest edit. The two-segment URL keeps the demo's surface clearly namespaced under its module id, matching the API path.

### 6.2 Shell composition

```tsx
// demo_puffin/frontend/cloud-pricing-calculator/page.tsx
export const dynamic = 'force-dynamic'  // env-driven; cannot pre-render at build time

export default async function PuffinCloudPricingCalculatorPage() {
  const cfg = readPuffinPublicConfig()       // throws → render <OpsBanner /> with the missing var(s)
  const catalog = await fetchInternal('/api/demo_puffin/cloud-pricing-calculator/catalog', { next: { revalidate: 60 } })
  return <CalculatorShell catalog={catalog} cfg={cfg} />
}
```

`CalculatorShell` is a Client Component tree under `demo_puffin/frontend/cloud-pricing-calculator/components/`. It owns the URL-state cart, the chooser, the configurator, the cart drawer, and the lead form.

### 6.3 Component layout

```
demo_puffin/frontend/cloud-pricing-calculator/components/
├── CalculatorShell.tsx              ← top-level state (cart, flow, region, term)
├── HeroBar.tsx                      ← region / currency / term switchers
├── chooser/
│   ├── ChooserScreen.tsx            ← Step 0 — two cards
│   └── ChooserCard.tsx
├── solutions/
│   ├── BundleGrid.tsx               ← Step 1A
│   ├── BundleCard.tsx               ← live preview, 3-state package toggle
│   └── PackageToggle.tsx
├── custom/
│   ├── ProductCatalogue.tsx         ← Step 1B left-pane grid
│   └── ProductCard.tsx
├── configurator/
│   ├── ConfiguratorScreen.tsx       ← Step 2 (shared by both flows)
│   └── line/
│       ├── VpsLine.tsx              ← plan-card grid pattern
│       ├── ComputeLine.tsx          ← family/size dropdowns + hours slider
│       ├── ManagedDbLine.tsx        ← attribute-rich panel (engine/version/HA/replicas/PITR…)
│       ├── WorkspaceLine.tsx        ← seat slider with volume-tier badges
│       ├── PremiumSupportLine.tsx   ← live composite breakdown
│       ├── TieredLine.tsx           ← CDN / Object Storage / Bandwidth (sliders + tier viz)
│       └── DdosLine.tsx             ← three-tier compare cards
├── cart/
│   ├── CartDrawer.tsx               ← sticky right rail / bottom sheet on mobile
│   ├── LineSummary.tsx
│   └── Totals.tsx                   ← `font-variant-numeric: tabular-nums`
├── lead/
│   ├── LeadFormSlideOver.tsx
│   └── ConfirmationScreen.tsx
└── hooks/
    ├── useCalculatorCart.ts         ← cart reducer + URL sync
    ├── usePublicPrice.ts            ← debounced POST /api/demo_puffin/cloud-pricing-calculator/price
    ├── usePublicAttributes.ts       ← dependent attribute resolver
    └── usePermalink.ts              ← cart ↔ base64-JSON URL state
```

### 6.4 URL state contract

| Query param | Shape | Purpose |
|---|---|---|
| `flow` | `'solutions' \| 'custom' \| undefined` | Persists which path the visitor is on. Absent = chooser. |
| `region` | `'fra1' \| 'waw1'` | Hero region switch; defaults to env-default. |
| `term` | `'on_demand' \| 'reserved_1y' \| 'reserved_3y'` | Hero term switch. |
| `cadence` | `'monthly' \| 'annual_prepay'` | Workspace + Premium Support apply this. |
| `cart` | base64-encoded JSON of `[{ offeringId, configuration, qty, parentLineKey }]` | Permalink. Capped at 8 KB; over that, store in `sessionStorage` and emit a `cart_id` query param resolved server-side via short-lived in-memory cache. |

### 6.5 Per-product UI patterns

| Product | UI pattern | Component |
|---|---|---|
| VPS | Plan-card grid (7 cards) | `VpsLine.tsx` |
| Compute | Family → size → hours slider | `ComputeLine.tsx` |
| Managed DB | Attribute-rich configurator with dependencies | `ManagedDbLine.tsx` |
| Workspace | Plan toggle + seat slider + add-on checkboxes | `WorkspaceLine.tsx` |
| Premium Support | Itemised live breakdown card | `PremiumSupportLine.tsx` |
| CDN / Object Storage / Bandwidth | Slider with tier visualisation | `TieredLine.tsx` |
| DDoS Shield | Three-tier comparison cards | `DdosLine.tsx` |

The `uiPattern` field on each `CpqProductSpecification` (computed read-time by `catalog-filter.ts` from spec code, **not stored in the DB**) tells the configurator which line component to mount.

---

## 7. Bundle Expansion

The existing quote service already understands `quoteContext.fromBundle` (used by `demo_puffin/seeds/seeders/examples.ts`). On the public side:

1. **Calculator click "Use this bundle"** → frontend calls `POST /api/demo_puffin/cloud-pricing-calculator/price` with a single item carrying `offeringId: <bundleOfferingId>`.
2. The handler forwards to `/api/cpq/quotes/price` with `quoteContext.fromBundle` set. The CPQ pricing route already expands bundles server-side.
3. The response items are returned to the frontend, which treats them as the new cart. Each item gets a `bundleSlotKey` so the UI can render a small "from bundle: Ship My App / Pro" pill.

This keeps "Use this bundle" implementable as a single round-trip, which matters for the < 250 ms acceptance bar. **No CPQ change needed** — `fromBundle` is already supported.

For quote creation, the same `quoteContext.fromBundle = '<bundleOfferingId>'` is passed in the `/quotes` body so the persisted quote records the bundle origin.

---

## 8. Lead → Quote One-Shot Token

### 8.1 JWT shape (signed by `demo_puffin`, NOT the framework auth secret)

```jsonc
{
  "iss": "puffin-public-calculator",
  "aud": "puffin-public-calculator",
  "sub": "<customerId>",
  "scope": "puffin.public.quote",
  "tenantSlug": "puffin",
  "jti": "<uuid>",
  "iat": 1714900000,
  "exp": 1714900600
}
```

Signed HS256 with `PUFFIN_PUBLIC_LEAD_JWT_SECRET`. Validated by `verifyLeadToken(token)` in `lib/public-calculator/lead-token.ts`. Independent of the framework auth keys — rotating one does not affect the other.

### 8.2 Single-use enforcement (in-memory)

```ts
// lib/public-calculator/nonce-store.ts
type NonceState = 'reserved' | 'used'
const store = new Map<string, { state: NonceState; expiresAt: number }>()
```

- `reserve(jti, exp)` — creates the entry with `'reserved'` if not present; throws on duplicate.
- `consume(jti)` — flips to `'used'`.
- `release(jti)` — deletes (called on rollback).
- A per-process `setInterval` evicts entries past `exp`.

**In-memory is sufficient** for single-instance demo deployments. For multi-instance prod, swap the implementation for Redis or Postgres without touching callers — the interface is small. Documented as a known limitation; the demo does not need horizontal scaling.

### 8.3 Why no DB nonce table?

Adding a Postgres table is a CPQ-side or framework-side change. We forbade those. An in-memory map kept in the `demo_puffin` process is the simplest possible thing that works.

If the demo eventually requires multi-instance correctness, the plug point is `nonce-store.ts` — swap to a `RedisNonceStore` reading `REDIS_URL`, no spec changes needed.

---

## 9. Auth, Captcha, Rate Limiting

### 9.1 Captcha

Pluggable. `CaptchaVerifier` interface with two implementations in `lib/public-calculator/captcha.ts`:

- `DisabledCaptchaVerifier` (default in `disabled` mode) — accepts any token, logs once at startup that captcha is off.
- `RecaptchaV3Verifier` — POSTs to Google's `siteverify`, requires `score >= PUFFIN_PUBLIC_CAPTCHA_MIN_SCORE` and `action === 'lead_submit'`.

Selection via `PUFFIN_PUBLIC_CAPTCHA_PROVIDER` at module load. The frontend reads the public site key via `GET /api/demo_puffin/cloud-pricing-calculator/config`.

### 9.2 Rate-limit budgets

| Route | Default | Why |
|---|---|---|
| `/catalog` | unlimited (cached 60s) | Edge cache absorbs storms. |
| `/config` | 60 / min / IP | Tiny payload. |
| `/attributes` | 60 / min / IP | Per-attribute interactive call. |
| `/price` | 120 / min / IP | Debounced cart edits at 250 ms cap at ~4/s; this is 2× cushion. |
| `/leads` | 5 / min / IP | Lead spam mitigation. |
| `/quotes` | 3 / min / IP | One-shot token already gates it; this is belt-and-braces. |

All configurable via `PUFFIN_PUBLIC_RATE_<route>=N`. The existing `rateLimiterService` middleware (already registered globally by core bootstrap) does the work — `demo_puffin` just declares budgets per route.

### 9.3 Admin token cache lifecycle

- TTL: cache for `min(jwt_exp - 10min, 7h)`.
- On 401 from CPQ: clear cache, re-login once, retry the original request once. If the second 401 comes back, return 503 to the visitor and emit `puffin.calculator.admin_login_failed`.
- On HTTP errors from `/api/auth/session`: exponential backoff (1s/2s/4s, capped at 30s), serve 503 in the meantime.

---

## 10. Data Model

**No new entities. No migrations. No CPQ schema changes.**

| Existing entity | What XD-275 reads/writes |
|---|---|
| `CpqProductOffering.metadata.listedInCalculator` | **Read-only**, set by XD-276. |
| `CustomerEntity` | **Created** as `lifecycle_status = 'lead'` + `metadata.source = 'public_calculator'` via the existing `/api/customers/companies` endpoint, proxied as admin. |
| `CpqQuoteConfiguration` | **Created** with `cpq_status = 'with_customer'` via the existing `/api/cpq/quotes` endpoint, proxied as admin. |
| `CpqQuoteLineConfiguration` | One row per cart line via `/api/cpq/quotes/{id}/items`. |

The lead-token nonce store is **process-memory only** (see §8.2). No DB table.

---

## 11. ACL / Feature Flags

No new feature flags. The XD-275 surface is gated by:

1. **Admin user existence + permissions** — `admin@puffin.com` must exist (XD-276 guarantees this) and must have `cpq.quotes.view` + `cpq.quotes.manage` + `customers.companies.manage` (granted by XD-276's `defaultRoleFeatures` for the `admin` role).
2. **Env vars** — `PUFFIN_PUBLIC_LEAD_JWT_SECRET` and admin credentials must be set. Unset → 503 + ops banner.

To "disable" the calculator, an operator:
- Removes/changes `PUFFIN_PUBLIC_LEAD_JWT_SECRET`, or
- Demotes the `admin@puffin.com` user (loses `cpq.quotes.*`), or
- Stops the app.

The `DEFAULT_PUBLIC_CALCULATOR_FEATURE = 'cpq.public.calculator'` constant exported from `demo_puffin/setup.ts` (added by XD-276 phase 5) is now **unused** — XD-275 doesn't need it because the flag concept is redundant when the surface is admin-proxied. We leave the export in place for one release cycle and remove it as a deprecation in a follow-up to avoid breaking any consumer that already imported it.

---

## 12. Telemetry & Observability

All emitted on the existing event bus. Topic prefix `puffin.calculator.*` (not `cpq.*` — these are demo_puffin-owned events).

- `puffin.calculator.priced` — `{ itemCount, totalMonthly, durationMs }` per `/price`.
- `puffin.calculator.quote_submitted` — `{ quoteId, quoteNumber, totalMonthly }` per `/quotes`.
- `puffin.calculator.lead_created` — `{ customerId }` per `/leads`.
- `puffin.calculator.captcha_failed` — `{ score, action }`.
- `puffin.calculator.admin_login_failed` — emitted once per minute on cache-refresh failure.
- `puffin.calculator.config_error` — emitted once per process when env vars are missing.

A single Grafana dashboard ships under `manuals/puffin-calculator-runbook.md`.

---

## 13. Implementation Plan

Phased, gated by tests + manual smoke at the end of each. All phases land in `src/modules/demo_puffin/` only (plus the trailing test/manual updates).

### Phase 1 — Companion fix: `context_select` wizard step

1. Add `src/modules/demo_puffin/workflows/steps/ContextSelectStep.tsx` (the renderer).
2. In `demo_puffin/setup.ts`, side-effect-import `registerStepType` from `../cpq/workflows/registry` and call `registerStepType({ type: 'context_select', component: ContextSelectStep, label: 'Context Select', description: 'Set a value on quoteContext.<field>' })`.
3. Update `demo_puffin/__tests__/canon-pricing.test.ts` (or new `wizard.test.ts`) asserting the registration runs at module import.
4. Manual smoke: `/backend/cpq/wizards/puffin-sales-led-quote` runs end-to-end through "Contract Model" → "Add Products" → "Review".

**Gate**: green tests + manual smoke. CPQ source code is **unchanged**.

### Phase 2 — Server foundations (admin proxy + public API skeleton)

1. Add `lib/public-calculator/env.ts` (validates + reads all env vars).
2. Add `lib/public-calculator/admin-session.ts` (cached admin JWT via HTTP loopback to `/api/auth/session`).
3. Add `lib/public-calculator/proxy-client.ts` (auth-injecting fetch wrapper).
4. Add `lib/public-calculator/catalog-filter.ts` (listedInCalculator filter + sanitize).
5. Add `lib/public-calculator/lead-token.ts` + `nonce-store.ts` + `captcha.ts`.
6. Add `api/cloud-pricing-calculator/config/route.ts` and `api/cloud-pricing-calculator/catalog/route.ts`.
7. Tests: unit-test the admin-session caching (hits `/api/auth/session` once across N concurrent calls; refresh on expiry; falls back on 401), the catalog filter (drops un-flagged offerings, strips internal metadata), the lead-token sign/verify roundtrip.

**Gate**: `curl http://localhost:3000/api/demo_puffin/cloud-pricing-calculator/catalog` returns the filtered Puffin catalog after `yarn dev`.

### Phase 3 — Pricing + attribute proxies

1. Add `api/cloud-pricing-calculator/attributes/route.ts` and `api/cloud-pricing-calculator/price/route.ts`.
2. Wire rate limits via the existing `rateLimiterService`.
3. Tests: route-handler tests asserting `/price` rejects un-flagged offerings, forwards `quoteContext.public_calculator = true`, forwards Bundle expansion via `fromBundle`.

**Gate**: `curl POST /api/demo_puffin/cloud-pricing-calculator/price` matches the canon prices from XD-275 for `vps_small`, `workspace_business` 150 seats annual, `premium_support` on $5,200 cart.

### Phase 4 — `/demo_puffin/cloud-pricing-calculator` skeleton + chooser

1. Add `frontend/cloud-pricing-calculator/page.tsx` (SSR shell, reads `/api/demo_puffin/cloud-pricing-calculator/catalog`).
2. Add `CalculatorShell.tsx` + `HeroBar.tsx` + `ChooserScreen.tsx`.
3. Wire URL state (`flow`, `region`, `term`).
4. Render Puffin brand colours + hero copy.

**Gate**: `/demo_puffin/cloud-pricing-calculator` renders the chooser; both cards navigate to `?flow=...`.

### Phase 5 — Custom Solution flow (configurator parts)

1. Build `ProductCatalogue.tsx` + `ProductCard.tsx` from the catalog response.
2. Build `usePublicPrice.ts` + `usePublicAttributes.ts` hooks (debounced 250 ms).
3. Implement `VpsLine.tsx`, `ComputeLine.tsx`, `TieredLine.tsx` (CDN/Object/Bandwidth), `DdosLine.tsx`.
4. Wire `CartDrawer.tsx` totals + region/term reactivity.
5. Add cart permalink (`?cart=...`).

**Gate**: A visitor can build a cart of [VPS Atlantic + CDN + DDoS Standard] in `fra1` on-demand and the totals match XD-275 within ±5%.

### Phase 6 — Managed DB + Workspace + Premium Support (showcase configurators)

1. `ManagedDbLine.tsx` with engine → version dependency, HA/PITR/replicas constraints.
2. `WorkspaceLine.tsx` with seat slider + volume-tier badges (26/101/501) + annual prepay toggle.
3. `PremiumSupportLine.tsx` with the live composite breakdown ($500 + uplift + TAM hours).

**Gate**: All XD-275 canon prices match exactly: 150 Workspace Business seats annual = $1,377.00; Premium Support on $5,200 cart = $812.

### Phase 7 — Predefined Solutions flow + bundle expansion

1. `BundleGrid.tsx` + `BundleCard.tsx` + `PackageToggle.tsx`.
2. `/price` proxy handles `fromBundle` (by passing it through; no demo_puffin-side expansion needed).
3. "Use this bundle" → cart populated; per-line edits work; bundle-origin pills.

**Gate**: All 3 bundles' 3 packages each price within ±5% of XD-275 indicative MRCs.

### Phase 8 — Lead → Quote conversion

1. `api/cloud-pricing-calculator/leads/route.ts` (captcha + create lead via admin proxy).
2. `api/cloud-pricing-calculator/quotes/route.ts` (verify lead JWT + chain `/quotes` + `/items` + `/status` via admin proxy).
3. `LeadFormSlideOver.tsx` (3 fields + captcha) + `ConfirmationScreen.tsx`.
4. Magic-link email scaffolding (delegated to `core/notifications`).

**Gate**: A submitted lead lands as a `with_customer` `CpqQuoteConfiguration` visible at `/backend/cpq/quotes` for `admin@puffin.com`.

### Phase 9 — Polish, tests, docs

1. Animated number transitions, skeleton loaders, mobile cart sheet.
2. Playwright integration spec under `.ai/qa/tests/` covering chooser → custom flow → configure → "get a quote" → backend visibility.
3. Add `manuals/puffin-public-pricing-calculator.md` covering env vars, captcha provider configuration, the admin-proxy model, and the "toggle offering listing" workflow.
4. Update `CLAUDE.md` Task→Context Map with a new "Modify the Puffin public pricing calculator" row pointing here.
5. Extend the init banner to print the suggested `PUFFIN_PUBLIC_LEAD_JWT_SECRET` line.

---

## 14. Companion Fix — `context_select` wizard step

### 14.1 Symptom

`src/modules/demo_puffin/seeds/seeders/wizards.ts:30` declares `type: 'context_select'` for the "Contract Model" step. The CPQ wizard runner (`src/modules/cpq/workflows/WizardRunner.tsx:15`) calls `getStepType('context_select')`, which returns `undefined` because no such type is registered in `src/modules/cpq/workflows/steps/index.ts` (only `customer_select`, `offering_select`, `product_configure`, `item_list`, `review`, `inventory_select`). The runner renders `Unknown step type: context_select. This step type is not registered. Register it via registerStepType().` (see screenshot in the task).

### 14.2 Fix — register the step type from `demo_puffin`, not from CPQ

CPQ's workflow registry (`cpq/workflows/registry.ts`) exports `registerStepType()` as a public extension point — exactly the kind of thing module consumers are meant to call. We use it from `demo_puffin/setup.ts` so **CPQ source code is not modified**:

```
src/modules/demo_puffin/
├── workflows/
│   └── steps/
│       └── ContextSelectStep.tsx           ← NEW (renderer)
└── setup.ts                                 ← side-effect: registerStepType(...)
```

`ContextSelectStep` props (matches `WizardStepProps`) and config:

```ts
type ContextSelectConfig = {
  contextField: string                       // e.g. 'contract_model'
  options: Array<{ value: string; label: string; description?: string }>
  required?: boolean                         // default true
  default?: string
}
```

Behaviour:
- Renders a vertical radio-card list (matches the design language of `OfferingSelectStep`'s grid).
- On select, calls `onComplete({ [contextField]: value })`.
- The parent wizard runner persists `step.data.<contextField>` into the wizard state and merges it into `quoteContext` before the next pricing call.

Validation: `required` config blocks `onComplete` until a selection exists. No external network calls.

### 14.3 Tests

- Unit test (in `demo_puffin/__tests__/`): rendering with three options, clicking the second calls `onComplete({ contract_model: 'reserved_1y' })`.
- Unit test: with `required: true` and no selection, the "Next" button is disabled.
- Unit test: importing `demo_puffin/setup` registers `'context_select'` in CPQ's registry (verified via `getStepType('context_select') !== undefined`).

### 14.4 Why it's safe to register from a downstream module

CPQ's `registerStepType` is the documented extension point; it's process-local module state. Multiple modules calling it is the intended pattern (mirrors how `registerCpqUseCase` works for seeds). Registration is idempotent — a second call with the same `type` either no-ops or warns; either is fine.

If `demo_puffin` is loaded but `cpq` is not, the import fails at module-load time, which is caught by the framework's module resolver and surfaces as a clear error. The existing module-load order (`cpq` registered before `demo_puffin` in `src/modules.ts`) guarantees CPQ is loaded first.

### 14.5 No data migration

The Puffin wizard already declares `type: 'context_select'` — landing the registered step type immediately fixes the runtime error with no DB change.

### 14.6 Documentation

Add a one-paragraph entry to `manuals/puffin-public-pricing-calculator.md` (created in Phase 9) noting that `demo_puffin` registers an additional CPQ wizard step type at module load, and that downstream customer modules can do the same to add their own wizard primitives without touching CPQ.

---

## 15. Idempotency, Safety, Backwards Compatibility

- **Catalog endpoint** is GET, idempotent, edge-cached. Tweaking offerings in the backend invalidates after 60 s.
- **Pricing** is stateless. Repeated `/price` calls with the same body return the same response.
- **Lead creation** is upsert by `(tenantId, email)` — repeating the form returns the same `customerId` and a fresh JWT.
- **Quote creation** is single-use (in-memory nonce). A failed retry uses the same JWT until the nonce is consumed; a successful retry is rejected with 409.
- **CPQ source code is unchanged.** The authenticated `/api/cpq/*` endpoints behave identically to today.
- **Existing tenants unaffected**. Acme and GIX continue to require auth; only the Puffin-specific `/pricing` page and `/api/puffin/pricing/*` routes expose anything publicly.
- **Admin JWT rotation**: changing `CPQ_DEMO_PUFFIN_ADMIN_PASSWORD` invalidates the cached admin token on next refresh; visitors mid-flow see a transient 503 until the refresh succeeds.
- **Lead JWT secret rotation**: changing `PUFFIN_PUBLIC_LEAD_JWT_SECRET` invalidates all in-flight visitor tokens (visitors mid-flow get a 401 and re-submit the lead form). Acceptable for a 10-minute TTL.

---

## 16. Acceptance Criteria

The XD-275 deliverable is done when:

- [ ] `yarn db:greenfield && yarn initialize` followed by setting `PUFFIN_PUBLIC_LEAD_JWT_SECRET` produces a running app where `/demo_puffin/cloud-pricing-calculator` renders without login.
- [ ] **No file under `src/modules/cpq/` is modified by this branch.** Verified by `git diff --stat main -- src/modules/cpq/` showing zero changes.
- [ ] **Step 0 chooser** is the default landing screen with no flow query param; choosing a card sets `?flow=solutions` or `?flow=custom`.
- [ ] **Predefined Solutions flow** lists the 3 use-case bundle cards with 3-state package toggles. Switching the toggle re-prices the card preview within 250 ms without a page reload.
- [ ] **"Use this bundle"** loads slot lines into the cart, lands the visitor on the configurator, and per-line tweaks (region, plan, seat count) work without losing the rest of the bundle.
- [ ] **Custom Solution flow** opens with an empty cart and the product catalogue. Adding products one at a time produces correct prices.
- [ ] **Flow switching is non-destructive**: a visitor with cart items can toggle between flows without losing state; loading a bundle on top of an existing cart prompts "Replace cart or merge?".
- [ ] **All product UI patterns** render per the table in §6.5.
- [ ] **Canon prices match exactly**:
  - Workspace 150 Business seats with annual prepay = `$1,377.00 / mo`.
  - Premium Support on a $5,200/mo cart = `$812 / mo`; on a $1,000/mo cart = `$500 / mo` (floor binds); on a $40,000/mo cart = `$2,400 / mo`.
  - VPS Atlantic in `fra1` on-demand = `$24.00 / mo` MRC + `$5.00` NRC.
- [ ] **Switching region, term, or any attribute updates the cart total in under 250 ms** (single round-trip to `/api/demo_puffin/cloud-pricing-calculator/price`, P95 measured locally).
- [ ] **Permalinks** (`/demo_puffin/cloud-pricing-calculator?flow=...&cart=...`) reproduce the cart state on a fresh browser.
- [ ] **No prices in the frontend bundle** — searching the built JS for `"5.00"`, `"24.00"`, `"$1,377"` returns zero hits.
- [ ] **Toggling `listedInCalculator: false`** on a Puffin offering hides it from `/demo_puffin/cloud-pricing-calculator` within 60 s without a redeploy.
- [ ] **Admin token caching** — a stress test (1,000 concurrent `/price` requests) issues exactly one (or at most two, due to refresh window) `/api/auth/session` calls, not 1,000.
- [ ] **Public endpoints rate-limit** at the documented budgets.
- [ ] **Submitting "Get a Quote"** creates a `lead` `CustomerEntity` and a `with_customer` `CpqQuoteConfiguration` visible at `/backend/cpq/quotes` for `admin@puffin.com`.
- [ ] **JWT replay returns 409** and the original quote is unaffected.
- [ ] **Rule violations** (e.g., DDoS Enterprise without a 12-month term, Block Storage without a parent VPS, ATP without Business+) surface as inline chips on the offending line and are rejected when the visitor clicks "Get a Quote".
- [ ] **Companion fix**: `puffin-sales-led-quote` wizard runs end-to-end without "Unknown step type" errors. New `context_select` step type is registered by `demo_puffin/setup.ts`, not by CPQ.
- [ ] **Authenticated CPQ endpoints unchanged**: `/api/cpq/quotes/price` still requires `cpq.quotes.view`; `/api/cpq/quotes` still requires `cpq.quotes.manage`. Verified by route-handler tests that pass before AND after this branch lands.
- [ ] **Disabling the calculator** by removing `PUFFIN_PUBLIC_LEAD_JWT_SECRET` returns 503 from every public route and renders an "ops banner" on `/demo_puffin/cloud-pricing-calculator`.
- [ ] **Demoting `admin@puffin.com`** (removing `cpq.quotes.view`) causes `/demo_puffin/cloud-pricing-calculator` to return 503 with `public_calculator_admin_login_failed`.
- [ ] **Playwright integration spec** under `.ai/qa/tests/` covers chooser → custom flow → 3 lines → "get a quote" → backend visibility.
- [ ] **Manual** added under `manuals/puffin-public-pricing-calculator.md` covering operator setup, env vars, captcha provider configuration, the admin-proxy model, and the "toggle offering listing" workflow.
- [ ] **CLAUDE.md** Task→Context Map updated with a "Modify the Puffin public pricing calculator" row pointing here.

---

## 17. Resolved Decisions

1. **All public-surface code lives in `demo_puffin`.** CPQ is not modified. The proxy authenticates as `admin@puffin.com` against the existing authenticated CPQ endpoints. (User directive on this branch.)
2. **Admin credentials reused from XD-276 env vars** (`CPQ_DEMO_PUFFIN_ADMIN_EMAIL`, `..._PASSWORD`). No new admin user needed.
3. **HTTP loopback over in-process DI.** Composes with the existing ACL/feature system — if admin@puffin.com loses `cpq.quotes.view`, the calculator stops. Token caching makes the cost negligible.
4. **JWT (HS256) for visitor lead-session token, in-memory nonce store.** Stateless verification + no DB changes. Single-instance demo deployment is fine; multi-instance prod swaps the nonce store.
5. **`context_select` step type registered from `demo_puffin`** via CPQ's public `registerStepType` API. CPQ source code unchanged.
6. **Captcha pluggable, default disabled** for local dev.
7. **Single currency (USD).** Multi-currency is documented as out of scope.
8. **Bundle expansion stays server-side** in CPQ — `quoteContext.fromBundle` is already supported by `/api/cpq/quotes/price`. The proxy passes it through.
9. **No customer accounts pre-conversion.** Cart in URL + sessionStorage; account creation is post-quote via the magic-link customer portal.
10. **`DEFAULT_PUBLIC_CALCULATOR_FEATURE` constant** exported from `demo_puffin/setup.ts` (added by XD-276 phase 5) is unused by XD-275 and slated for removal in a follow-up.

---

## 18. Open Questions

1. **CPQ catalog endpoint shape.** The proxy's `/catalog` route depends on which existing CPQ endpoints aggregate offerings + specifications + attributes. If no suitable endpoint exists, Phase 2 stitches several calls together inside `demo_puffin` — still no CPQ change. To be confirmed during Phase 2 implementation.
2. **Multi-instance nonce store.** In-memory is fine for a single-process demo; documented limitation. If we ever deploy `demo_puffin` horizontally, swap to Redis at `nonce-store.ts` with no spec change.
3. **Currency / VAT for EU visitors.** Out-of-scope for the demo.
4. **Embedded calculator widget.** Marketing has asked for a `<iframe>`-able variant. Not scoped here; `/demo_puffin/cloud-pricing-calculator` is `force-dynamic` so trivially embeddable later.

---

## Implementation Status

| Phase | Status | Date | Notes |
|---|---|---|---|
| Phase 1 — `context_select` wizard companion fix | Pending | — | — |
| Phase 2 — Server foundations (admin proxy + catalog/config) | Pending | — | — |
| Phase 3 — Pricing + attribute proxies | Pending | — | — |
| Phase 4 — `/pricing` skeleton + chooser | Pending | — | — |
| Phase 5 — Custom Solution flow | Pending | — | — |
| Phase 6 — Managed DB / Workspace / Premium Support | Pending | — | — |
| Phase 7 — Predefined Solutions + bundle expansion | Pending | — | — |
| Phase 8 — Lead → Quote conversion | Pending | — | — |
| Phase 9 — Polish, tests, docs | Pending | — | — |
