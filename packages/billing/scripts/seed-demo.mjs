/**
 * Billing demo-data seeder (dev only — not published with the package).
 *
 * Populates the billing module with a small, realistic data set so the
 * admin UI has something to click through:
 *   - 5 billing accounts (PLN / EUR, monthly / quarterly / annually)
 *   - 10 billing items (recurring / one-time / usage)
 *   - 3 usage records on the metered Acme Telecom item
 *   - 1 Bill Run -> 3 draft invoices (ready to review + post)
 *
 * Every row goes through the REST API, so it exercises the real
 * command / event path (not a raw DB insert).
 *
 * Usage:
 *   1. Start the stack: `docker compose up -d postgres redis` then `yarn dev`
 *   2. Run: `node packages/billing/scripts/seed-demo.mjs`
 *
 * Env:
 *   BASE_URL         dev server URL (default http://localhost:3000)
 *   OM_SEED_EMAIL    admin login (default admin@acme.com)
 *   OM_SEED_PASSWORD admin password (default secret)
 *
 * Re-running appends more rows. To start clean, truncate the billing
 * tables first (see manuals/billing-ui-testing.md).
 */
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const EMAIL = process.env.OM_SEED_EMAIL || 'admin@acme.com'
const PASSWORD = process.env.OM_SEED_PASSWORD || 'secret'

async function login() {
  const body = new URLSearchParams({ email: EMAIL, password: PASSWORD })
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = await res.json()
  if (!json.token) throw new Error('login failed: ' + JSON.stringify(json))
  return json.token
}

async function api(token, method, path, payload) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { raw: text }
  }
  if (!res.ok) {
    console.error(`  ! ${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 200)}`)
    return { ok: false, status: res.status, json }
  }
  return { ok: true, status: res.status, json }
}

// Fully fictional companies / addresses / tax ids — no real-world data.
const ACCOUNTS = [
  {
    customerId: 'cust-acme-001',
    name: 'Acme Telecom Sp. z o.o.',
    currencyCode: 'PLN',
    billCycle: 'monthly',
    billCycleAnchor: '1',
    invoiceEmail: 'faktury@acme-telecom.example',
    invoiceLanguage: 'pl',
    nextBillDate: '2026-05-01',
    invoiceAddress: { line1: 'ul. Przykładowa 1', city: 'Warszawa', postal_code: '00-001', country: 'PL' },
    taxId: '1234567890',
    items: [
      { type: 'recurring', description: 'Łącze internetowe 1 Gb/s', rateJson: { unit_price: 199.0 } },
      { type: 'one_time', description: 'Opłata aktywacyjna', rateJson: { amount: 99.0 } },
      { type: 'usage', description: 'Transfer danych ponad limit', rateJson: { unit_price: 0.05 }, uomCode: 'gb' },
    ],
  },
  {
    customerId: 'cust-globex-002',
    name: 'Globex Networks Sp. z o.o.',
    currencyCode: 'PLN',
    billCycle: 'monthly',
    billCycleAnchor: '15',
    invoiceEmail: 'rozliczenia@globex-networks.example',
    invoiceLanguage: 'pl',
    nextBillDate: '2026-05-15',
    invoiceAddress: { line1: 'ul. Testowa 15', city: 'Kraków', postal_code: '30-001', country: 'PL' },
    taxId: '9876543210',
    items: [
      { type: 'recurring', description: 'Abonament flotowy — 50 kart SIM', rateJson: { unit_price: 2499.0 } },
      { type: 'recurring', description: 'Pakiet roamingowy', rateJson: { unit_price: 149.0 } },
    ],
  },
  {
    customerId: 'cust-initech-003',
    name: 'Initech Cloud GmbH',
    currencyCode: 'EUR',
    billCycle: 'quarterly',
    billCycleAnchor: '1',
    invoiceEmail: 'billing@initech-cloud.example',
    invoiceLanguage: 'en',
    nextBillDate: '2026-07-01',
    invoiceAddress: { line1: 'Musterstrasse 10', city: 'Berlin', postal_code: '10115', country: 'DE' },
    taxId: 'DE100000000',
    items: [
      { type: 'recurring', description: 'SaaS Platform — Enterprise plan', rateJson: { unit_price: 899.0 } },
      { type: 'usage', description: 'API calls', rateJson: { unit_price: 0.001 }, uomCode: 'api_request' },
    ],
  },
  {
    customerId: 'cust-contoso-004',
    name: 'Contoso Analytics Ltd.',
    currencyCode: 'EUR',
    billCycle: 'annually',
    billCycleAnchor: '1',
    invoiceEmail: 'ap@contoso-analytics.example',
    invoiceLanguage: 'en',
    nextBillDate: '2026-06-01',
    invoiceAddress: { line1: '1 Example Street', city: 'London', postal_code: 'EC1A 1AA', country: 'GB' },
    items: [
      { type: 'recurring', description: 'Annual License — 100 seats', rateJson: { unit_price: 12000.0 } },
      { type: 'one_time', description: 'Onboarding & migration', rateJson: { amount: 2500.0 } },
    ],
  },
  {
    customerId: 'cust-northwind-005',
    name: 'Northwind Studio s.c.',
    currencyCode: 'PLN',
    billCycle: 'monthly',
    billCycleAnchor: '1',
    invoiceEmail: 'biuro@northwind-studio.example',
    invoiceLanguage: 'pl',
    nextBillDate: '2026-05-01',
    invoiceAddress: { line1: 'ul. Demonstracyjna 7', city: 'Gdańsk', postal_code: '80-001', country: 'PL' },
    items: [
      { type: 'recurring', description: 'Hosting + domena (pakiet PRO)', rateJson: { unit_price: 79.0 } },
    ],
  },
]

async function main() {
  console.log(`Seeding billing demo data -> ${BASE}`)
  const token = await login()

  const created = []
  for (const acc of ACCOUNTS) {
    const { items, ...accountPayload } = acc
    const res = await api(token, 'POST', '/api/billing/accounts', accountPayload)
    if (!res.ok) continue
    const accountId = res.json.id
    console.log(`Account: ${acc.name}  (${accountId})`)

    const itemPayload = items.map((it) => ({
      billAccountId: accountId,
      type: it.type,
      billStartDate: '2026-04-01',
      description: it.description,
      rateJson: it.rateJson,
      ...(it.uomCode ? { uomCode: it.uomCode } : {}),
      sourceRef: `seed:${acc.customerId}:${it.description.slice(0, 16)}`,
    }))
    const bulk = await api(token, 'POST', '/api/billing/items/bulk', { items: itemPayload })
    if (bulk.ok) console.log(`  + ${bulk.json.created} items (${bulk.json.deduplicated} deduped)`)
    created.push({ accountId, name: acc.name })
  }

  console.log('Pushing usage records...')
  const metered = created.find((c) => c.name.startsWith('Acme'))
  if (metered) {
    for (const qty of [620, 410, 533]) {
      await api(token, 'POST', '/api/billing/usage', {
        billAccountId: metered.accountId,
        uomCode: 'gb',
        quantity: qty,
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
        sourceRef: `seed:usage:acme:${qty}`,
      })
    }
    console.log('  + 3 usage records (Acme Telecom, gb)')
  }

  console.log('Triggering a Bill Run...')
  const run = await api(token, 'POST', '/api/billing/runs', { mode: 'real', asOfDate: '2026-05-20' })
  if (run.ok) console.log(`  + Bill Run ${run.json.billRunId} -> ${run.json.status}`)

  console.log('Seed complete.')
}

main().catch((e) => {
  console.error('SEED FAILED:', e)
  process.exit(1)
})
