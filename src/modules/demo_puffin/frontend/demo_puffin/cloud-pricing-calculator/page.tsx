import * as React from 'react'
import type { Metadata } from 'next'
import { Inter_Tight, JetBrains_Mono } from 'next/font/google'
import { readPuffinPublicConfig } from '../../../lib/public-calculator/env'
import { getCachedCatalog, getStaleCatalogIfAny } from '../../../lib/public-calculator/catalog-cache'
import { CalculatorShell } from './components/CalculatorShell'
import { OpsBanner } from './components/layout/OpsBanner'
import type { PublicConfig } from './types'
import './styles.css'

const interTight = Inter_Tight({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-pf-ui',
  display: 'swap',
})

const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
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
