/**
 * Billing demo-data seeder (dev only — not published with the package).
 *
 * Populates the billing module with a small, realistic data set so the
 * admin UI has something to click through:
 *   - 5 billing accounts (PLN / EUR, monthly / quarterly / annually)
 *   - 10 billing items (recurring / one-time / usage)
 *   - 3 usage records on the metered Netia item
 *   - 1 test-mode Bill Run -> 3 draft invoices
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

const ACCOUNTS = [
  {
    customerId: 'cust-netia-001',
    name: 'Netia Biznes Sp. z o.o.',
    currencyCode: 'PLN',
    billCycle: 'monthly',
    billCycleAnchor: '1',
    invoiceEmail: 'faktury@netia-biznes.example',
    invoiceLanguage: 'pl',
    nextBillDate: '2026-05-01',
    invoiceAddress: { line1: 'ul. Poleczki 13', city: 'Warszawa', postal_code: '02-822', country: 'PL' },
    taxId: '5213017228',
    items: [
      { type: 'recurring', description: 'Łącze światłowodowe 1 Gb/s', rateJson: { unit_price: 199.0 } },
      { type: 'one_time', description: 'Opłata aktywacyjna', rateJson: { amount: 99.0 } },
      { type: 'usage', description: 'Transfer danych ponad limit', rateJson: { unit_price: 0.05 }, uomCode: 'gb' },
    ],
  },
  {
    customerId: 'cust-orange-002',
    name: 'Orange Polska S.A.',
    currencyCode: 'PLN',
    billCycle: 'monthly',
    billCycleAnchor: '15',
    invoiceEmail: 'rozliczenia@orange.example',
    invoiceLanguage: 'pl',
    nextBillDate: '2026-05-15',
    invoiceAddress: { line1: 'al. Jerozolimskie 160', city: 'Warszawa', postal_code: '02-326', country: 'PL' },
    taxId: '5260250995',
    items: [
      { type: 'recurring', description: 'Abonament Flota — 50 kart SIM', rateJson: { unit_price: 2499.0 } },
      { type: 'recurring', description: 'Pakiet roaming UE', rateJson: { unit_price: 149.0 } },
    ],
  },
  {
    customerId: 'cust-cloudflow-003',
    name: 'CloudFlow GmbH',
    currencyCode: 'EUR',
    billCycle: 'quarterly',
    billCycleAnchor: '1',
    invoiceEmail: 'billing@cloudflow.example',
    invoiceLanguage: 'en',
    nextBillDate: '2026-07-01',
    invoiceAddress: { line1: 'Friedrichstrasse 88', city: 'Berlin', postal_code: '10117', country: 'DE' },
    taxId: 'DE811907980',
    items: [
      { type: 'recurring', description: 'SaaS Platform — Enterprise plan', rateJson: { unit_price: 899.0 } },
      { type: 'usage', description: 'API calls', rateJson: { unit_price: 0.001 }, uomCode: 'api_request' },
    ],
  },
  {
    customerId: 'cust-datapeak-004',
    name: 'DataPeak Analytics Ltd.',
    currencyCode: 'EUR',
    billCycle: 'annually',
    billCycleAnchor: '1',
    invoiceEmail: 'ap@datapeak.example',
    invoiceLanguage: 'en',
    nextBillDate: '2026-06-01',
    invoiceAddress: { line1: '5 Old Street', city: 'London', postal_code: 'EC1V 9HL', country: 'GB' },
    items: [
      { type: 'recurring', description: 'Annual License — 100 seats', rateJson: { unit_price: 12000.0 } },
      { type: 'one_time', description: 'Onboarding & migration', rateJson: { amount: 2500.0 } },
    ],
  },
  {
    customerId: 'cust-pixel-005',
    name: 'Pixel Studio s.c.',
    currencyCode: 'PLN',
    billCycle: 'monthly',
    billCycleAnchor: '1',
    invoiceEmail: 'biuro@pixel-studio.example',
    invoiceLanguage: 'pl',
    nextBillDate: '2026-05-01',
    invoiceAddress: { line1: 'ul. Piękna 24', city: 'Kraków', postal_code: '31-000', country: 'PL' },
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
  const netia = created.find((c) => c.name.startsWith('Netia'))
  if (netia) {
    for (const qty of [620, 410, 533]) {
      await api(token, 'POST', '/api/billing/usage', {
        billAccountId: netia.accountId,
        uomCode: 'gb',
        quantity: qty,
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
        sourceRef: `seed:usage:netia:${qty}`,
      })
    }
    console.log('  + 3 usage records (Netia, gb)')
  }

  console.log('Triggering a test-mode Bill Run...')
  const run = await api(token, 'POST', '/api/billing/runs', { mode: 'test', asOfDate: '2026-05-20' })
  if (run.ok) console.log(`  + Bill Run ${run.json.billRunId} -> ${run.json.status}`)

  console.log('Seed complete.')
}

main().catch((e) => {
  console.error('SEED FAILED:', e)
  process.exit(1)
})
