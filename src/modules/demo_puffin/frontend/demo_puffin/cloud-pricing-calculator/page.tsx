import * as React from 'react'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { readPuffinPublicConfig } from '../../../lib/public-calculator/env'
import { CalculatorShell } from './components/CalculatorShell'
import { OpsBanner } from './components/layout/OpsBanner'
import type { PublicCatalog, PublicConfig } from './types'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Puffin Cloud — Pricing Calculator',
  description: 'Build a custom Puffin Cloud configuration with live pricing.',
}

async function fetchInternal<T>(path: string): Promise<{ status: number; data: T | null }> {
  const baseUrl = process.env.PUFFIN_PUBLIC_BASE_URL?.replace(/\/+$/, '') ?? `http://localhost:${process.env.PORT ?? '3000'}`
  const url = `${baseUrl}${path}`
  // Forward any cookies / headers so the request is recognised as coming from
  // the same origin (the public proxy itself is anonymous, but other middleware
  // may rely on these for tracing).
  let inboundCookies = ''
  try {
    const h = await headers()
    inboundCookies = h.get('cookie') ?? ''
  } catch {
    // Headers unavailable in some test contexts; safe to ignore.
  }
  try {
    const res = await fetch(url, {
      headers: { Cookie: inboundCookies },
      next: { revalidate: 60 },
    })
    if (!res.ok) return { status: res.status, data: null }
    return { status: res.status, data: (await res.json()) as T }
  } catch {
    return { status: 502, data: null }
  }
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

  const [catalogResp, configResp] = await Promise.all([
    fetchInternal<PublicCatalog>('/api/demo_puffin/cloud-pricing-calculator/catalog'),
    fetchInternal<PublicConfig>('/api/demo_puffin/cloud-pricing-calculator/config'),
  ])

  if (!catalogResp.data || !configResp.data) {
    return (
      <OpsBanner
        message="Could not load the calculator catalog right now. Please try again in a moment."
      />
    )
  }

  return <CalculatorShell catalog={catalogResp.data} config={configResp.data} />
}
