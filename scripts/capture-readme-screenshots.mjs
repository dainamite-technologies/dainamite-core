// One-off helper to capture admin-UI screenshots for the root README.
// Logs in via the same API flow the integration auth helper uses, sets the
// selected-tenant cookies from the JWT claims, then snapshots each page.
//
//   node scripts/capture-readme-screenshots.mjs
//
// Requires the dev server running on http://localhost:3000 and a seeded DB.
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const OUT = 'docs/screenshots'

function decodeJwtClaims(token) {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  } catch {
    return null
  }
}

const ACK_COOKIES = ['om_demo_notice_ack', 'om_cookie_notice_ack', 'om_feedback_suppress'].map((name) => ({
  name,
  value: name === 'om_feedback_suppress' ? '1' : 'ack',
  url: BASE,
  sameSite: 'Lax',
}))

async function loginContext(browser, email, password) {
  const context = await browser.newContext({ viewport: { width: 1480, height: 900 }, deviceScaleFactor: 2 })
  await context.addCookies(ACK_COOKIES)
  const res = await context.request.post(`${BASE}/api/auth/login`, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({ email, password }).toString(),
  })
  if (!res.ok()) throw new Error(`login failed for ${email}: ${res.status()}`)
  const body = await res.json()
  const claims = body?.token ? decodeJwtClaims(body.token) : null
  const cookies = []
  if (claims?.tenantId) cookies.push({ name: 'om_selected_tenant', value: claims.tenantId, url: BASE, sameSite: 'Lax' })
  if (claims?.orgId) cookies.push({ name: 'om_selected_org', value: claims.orgId, url: BASE, sameSite: 'Lax' })
  if (cookies.length) await context.addCookies(cookies)
  return context
}

async function shoot(context, path, file) {
  const page = await context.newPage()
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    // Let the table/data fetch settle, then give layout a beat.
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `${OUT}/${file}`, fullPage: false })
    console.log(`✓ ${file}  (${path})`)
  } catch (e) {
    console.log(`✗ ${file}  (${path}) — ${e.message}`)
  } finally {
    await page.close()
  }
}

const main = async () => {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()

  // GIX tenant — has CPQ catalog, subscriptions (inventory) AND billing data.
  const gix = await loginContext(browser, 'admin@gix.com', 'secret')
  await shoot(gix, '/backend/cpq/offerings', 'cpq-offerings.png')
  await shoot(gix, '/backend/cpq/specifications', 'cpq-specifications.png')
  await shoot(gix, '/backend/cpq/pricing', 'cpq-pricing.png')
  await shoot(gix, '/backend/cpq/quotes', 'cpq-quotes.png')
  await shoot(gix, '/backend/cpq/inventory', 'cpq-inventory.png')
  await shoot(gix, '/backend/billing/accounts', 'billing-accounts.png')
  await shoot(gix, '/backend/billing/items', 'billing-items.png')
  await shoot(gix, '/backend/billing/runs', 'billing-runs.png')
  await shoot(gix, '/backend/billing/invoices', 'billing-invoices.png')
  await gix.close()

  // Puffin tenant — richer CPQ catalog (bundles, multi-dim pricing tables).
  const puffin = await loginContext(browser, 'admin@puffin.com', 'secret')
  await shoot(puffin, '/backend/cpq/offerings', 'cpq-offerings-puffin.png')
  await shoot(puffin, '/backend/cpq/pricing', 'cpq-pricing-puffin.png')
  await puffin.close()

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
