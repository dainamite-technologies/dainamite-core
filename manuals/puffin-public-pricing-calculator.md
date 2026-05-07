# Puffin Public Pricing Calculator

The Puffin public pricing calculator is a no-login, conversion-oriented price
explorer for the Puffin Cloud demo tenant. Anonymous visitors land on
`/demo_puffin/cloud-pricing-calculator`, pick a use-case bundle or build a
custom configuration, see live prices in real time, and convert into a real
`CpqQuoteConfiguration` (in `with_customer` status) by filling in a 3-field
"Get a Quote" form.

This manual covers operator setup, the admin-proxy authentication model, and
the workflow for hiding/showing offerings on the public calculator. The full
specification for the feature is at
[`specs/implementation/xd-275-public-pricing-calculator.md`](../specs/implementation/xd-275-public-pricing-calculator.md).

## Architecture summary

The calculator is **fully implemented inside `src/modules/demo_puffin/`** and
**does not modify CPQ source code**. Public routes proxy requests to the
authenticated CPQ APIs as `admin@puffin.com`:

```
visitor → /api/demo_puffin/cloud-pricing-calculator/<route>
       → demo_puffin handler
       → cached admin JWT (loopback to /api/auth/login)
       → /api/cpq/<endpoint>           ← authenticated path, unchanged
       → response filtered by listedInCalculator
       → visitor
```

Under the hood:

| Public route | Forwards to | Notes |
|---|---|---|
| `GET /api/demo_puffin/cloud-pricing-calculator/catalog` | `GET /api/cpq/product-offerings`, `GET /api/cpq/product-specifications` (paged + per-id hydration) | Filtered to `metadata.listedInCalculator === true` and `lifecycleStatus === 'active'`. Edge-cached 60s. |
| `GET /api/demo_puffin/cloud-pricing-calculator/config` | — | Frontend-safe config (currency, default region, captcha provider/site key, debounce). |
| `POST /api/demo_puffin/cloud-pricing-calculator/attributes` | `GET /api/cpq/quotes/attributes` | Resolves run-time attribute options. Visitor's `offeringId` must be in the cached allowlist. |
| `POST /api/demo_puffin/cloud-pricing-calculator/price` | `POST /api/cpq/quotes/price` | Translates the public flat `items[]` into CPQ's `primaryItem` + `childItems[]`. Merges `quoteContext` + `public_calculator: true` into each item's configuration. |
| `POST /api/demo_puffin/cloud-pricing-calculator/leads` | `POST /api/customers/companies` | Captcha-gated. Creates a `lead` company, returns a 10-minute `quoteSessionToken` JWT. |
| `POST /api/demo_puffin/cloud-pricing-calculator/quotes` | `POST /api/cpq/quotes` → `/items` → `/status` (`new → ready → with_customer`) | Single-use. JWT is bound by `jti`; a replay returns 409. |

## Environment setup

After `yarn initialize` (which seeds the Puffin tenant and the
`admin@puffin.com` user via XD-276), add **one** line to `.env.local`:

```sh
PUFFIN_PUBLIC_LEAD_JWT_SECRET=$(openssl rand -hex 32)
```

If the secret is missing, every public route returns `503` with
`public_calculator_not_configured` and `/demo_puffin/cloud-pricing-calculator`
renders an Ops banner with the missing var name.

Optional environment variables (all default sensibly for local dev):

| Var | Default | Purpose |
|---|---|---|
| `PUFFIN_PUBLIC_BASE_URL` | `http://localhost:${PORT}` | Loopback base URL for the proxy. Set in production. |
| `PUFFIN_PUBLIC_LEAD_JWT_TTL_SECONDS` | `600` | TTL of the visitor session token. |
| `PUFFIN_PUBLIC_DEFAULT_REGION` | `fra1` | Region pre-selected on the hero. |
| `PUFFIN_PUBLIC_CAPTCHA_PROVIDER` | `disabled` | `disabled` (logs once at startup) or `recaptcha_v3`. |
| `PUFFIN_PUBLIC_CAPTCHA_SITE_KEY` | — | Required when provider is `recaptcha_v3`. |
| `PUFFIN_PUBLIC_CAPTCHA_SECRET` | — | Required when provider is `recaptcha_v3`. |
| `PUFFIN_PUBLIC_CAPTCHA_MIN_SCORE` | `0.5` | reCAPTCHA v3 score threshold. |
| `PUFFIN_PUBLIC_RATE_PRICE` / `_ATTRIBUTES` / `_LEADS` / `_QUOTES` | `120` / `60` / `5` / `3` | Per-route per-IP per-minute budgets. |

The admin credentials reused from XD-276:
- `CPQ_DEMO_PUFFIN_ADMIN_EMAIL` (default `admin@puffin.com`)
- `CPQ_DEMO_PUFFIN_ADMIN_PASSWORD` (default `secret`)

## Toggling an offering's calculator visibility

The calculator only renders offerings where the metadata flag
`listedInCalculator` is strictly `true`. To hide an offering from the public
calculator without retiring it from the catalog:

1. Open `/backend/cpq/product-offerings/<id>` (logged in as a Puffin admin).
2. Edit the offering's `metadata` field, set `"listedInCalculator": false`.
3. Save. The change propagates to the public surface within ~60 seconds (the
   server-side allowlist cache TTL).

To show a previously hidden offering, set the flag back to `true`. Same
60-second propagation.

There is **no** redeploy required; flagged offerings are picked up at the
next allowlist cache refresh. New offerings created via the seeders default
to `listedInCalculator: true`; see
[`src/modules/demo_puffin/seeds/data/products.ts`](../src/modules/demo_puffin/seeds/data/products.ts).

## CPQ wizard step type — `context_select`

The Puffin sales-led quote wizard
(`puffin-sales-led-quote`, seeded by demo_puffin) declares a step of type
`context_select` that sets a value on `quoteContext.<field>` from a list of
options. CPQ's built-in step registry doesn't ship this type — instead,
`demo_puffin` registers it from its own module:

- **Component**:
  [`src/modules/demo_puffin/workflows/steps/ContextSelectStep.tsx`](../src/modules/demo_puffin/workflows/steps/ContextSelectStep.tsx)
- **Server-side registration**: `setup.ts` calls `registerPuffinStepTypes()` at
  module load, hitting CPQ's process-local registry.
- **Client-side registration**: a side-effect import in
  `src/modules/demo_puffin/widgets/components.ts` (auto-loaded by the
  generated `ComponentOverridesBootstrap`) re-registers the step type on
  every client render before any wizard page mounts.

Downstream customer modules can register additional CPQ wizard step types
the same way — declare a `widgets/components.ts` (the generator picks it up
client-side) and `setup.ts` (server-side), and call CPQ's public
`registerStepType` from both.

## Security model

- The public surface authenticates as `admin@puffin.com` against existing
  authenticated CPQ endpoints. If that user loses any of `cpq.quotes.view`,
  `cpq.quotes.manage`, or `customers.companies.manage`, the calculator
  returns 503 with `public_calculator_admin_login_failed` until permissions
  are restored.
- Every visitor-provided `offeringId` is checked against the cached
  `listedInCalculator` allowlist before being forwarded — defence in depth
  so a crafted body cannot resolve charges on an unlisted offering even if
  the public-side filter is bypassed.
- The visitor lead JWT is signed with `PUFFIN_PUBLIC_LEAD_JWT_SECRET`,
  independent from the framework's `JWT_SECRET`. Rotating one cannot
  invalidate the other and a leaked lead token cannot be used to
  authenticate as a staff user.
- The lead JWT is single-use. The `/quotes` route reserves the `jti` before
  chaining the CPQ calls, then either consumes it on full success or
  releases it on rollback so the visitor can retry until the JWT expires.
  After consumption a replay returns 409.

## Operator runbook

| Symptom | Likely cause | Action |
|---|---|---|
| `/demo_puffin/cloud-pricing-calculator` shows the Ops banner | `PUFFIN_PUBLIC_LEAD_JWT_SECRET` missing or invalid | Set the env var, restart the app. |
| Public routes return 503 with `public_calculator_admin_login_failed` | `admin@puffin.com` missing, password changed, or admin lost CPQ permissions | Reset password (`yarn mercato users password reset`), or re-grant `cpq.quotes.*` + `customers.companies.manage`. |
| Public routes return 503 with `public_calculator_not_configured` | Env var validation failed at request time | Check the response body for `missing` and `invalid` lists, fix `.env.local`, restart. |
| New offering doesn't appear in calculator | Allowlist cache TTL not yet expired, or `metadata.listedInCalculator` not set | Wait 60s, then verify the metadata flag. Restarting the app forces an immediate refresh. |
| Lead form rejects every submission | Captcha provider misconfigured | Check `PUFFIN_PUBLIC_CAPTCHA_*` env vars; switch to `disabled` for local dev. |

## Tests

- Unit tests live under
  `src/modules/demo_puffin/__tests__/public-calculator-*.test.ts`. Run with
  `yarn test --testPathPatterns=public-calculator`.
- Integration spec:
  [`.ai/qa/tests/TC-PUFFIN-275-public-calculator.spec.ts`](../.ai/qa/tests/TC-PUFFIN-275-public-calculator.spec.ts).
  Run with
  `npx playwright test --config .ai/qa/tests/playwright.config.ts .ai/qa/tests/TC-PUFFIN-275-public-calculator.spec.ts --retries=0`.
