import * as React from 'react'
import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { readPuffinPublicConfig } from '../../../lib/public-calculator/env'
import { getCachedCatalog, getStaleCatalogIfAny } from '../../../lib/public-calculator/catalog-cache'
import { CalculatorShell } from './components/CalculatorShell'
import { OpsBanner } from './components/layout/OpsBanner'
import type { PublicConfig } from './types'
import './styles.css'

// Self-hosted (variable woff2, latin subset, from Fontsource; SIL OFL 1.1 —
// see assets/fonts/OFL.txt) instead of `next/font/google`, which downloads
// the fonts from Google at build time. That made `next build` depend on the
// network and failed CI's Turbopack build ("next/font/google queries have
// exactly one entry") on the Inter Tight stylesheet.
const interTight = localFont({
  src: './assets/fonts/InterTight-latin-wght.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-pf-ui',
  display: 'swap',
})

const jetBrainsMono = localFont({
  src: './assets/fonts/JetBrainsMono-latin-wght.woff2',
  weight: '100 800',
  style: 'normal',
  variable: '--font-pf-mono',
  display: 'swap',
})

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Puffin Cloud — Pricing Calculator',
  description: 'Build a custom Puffin Cloud configuration with live pricing.',
}

export default async function PuffinCloudPricingCalculatorPage() {
  const cfgResult = readPuffinPublicConfig()
  if (!cfgResult.ok) {
    return (
      <OpsBanner
        message="The Puffin pricing calculator hasn't been configured for this environment yet."
        missing={[...cfgResult.error.missing, ...cfgResult.error.invalid]}
      />
    )
  }
  const { config: pubConfig } = cfgResult

  // Compute the same payload the /config and /catalog HTTP routes return,
  // but in-process. The HTTP routes still exist for client-side hooks; SSR
  // doesn't need to loopback through them and burn the public rate-limit
  // budget on every refresh.
  const config: PublicConfig = {
    currencyCode: 'USD',
    defaultRegion: pubConfig.defaultRegion,
    pricingDebounceMs: 250,
    captcha:
      pubConfig.captcha.provider === 'recaptcha_v3'
        ? { provider: 'recaptcha_v3', siteKey: pubConfig.captcha.siteKey }
        : { provider: 'disabled' },
  }

  let catalog: Awaited<ReturnType<typeof getCachedCatalog>> | null = null
  try {
    catalog = await getCachedCatalog(pubConfig)
  } catch (err) {
    // Cold rebuild failed — fall back to any stale snapshot we have.
    catalog = getStaleCatalogIfAny()
    if (!catalog) {
      console.error('[puffin-public-calculator] SSR catalog load failed:', err)
    }
  }

  if (!catalog) {
    return (
      <OpsBanner
        message="Could not load the calculator catalog right now. Please try again in a moment."
      />
    )
  }

  return (
    <div className={`${interTight.variable} ${jetBrainsMono.variable}`}>
      <CalculatorShell catalog={catalog} config={config} />
    </div>
  )
}
