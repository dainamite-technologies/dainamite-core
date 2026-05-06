'use client'

import * as React from 'react'
import type { Cart, PublicCatalog } from '../../types'

type Props = {
  cart: Cart
  catalog: PublicCatalog
  onRegion: (region: string) => void
  onTerm: (term: Cart['term']) => void
  onCadence: (cadence: Cart['cadence']) => void
  onReset: () => void
}

const TERMS: Array<{ value: Cart['term']; label: string }> = [
  { value: 'on_demand', label: 'On-Demand' },
  { value: 'reserved_1y', label: '1-Year Reserved (−22%)' },
  { value: 'reserved_3y', label: '3-Year Reserved (−38%)' },
]

const CADENCES: Array<{ value: Cart['cadence']; label: string }> = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual_prepay', label: 'Annual Prepay' },
]

export function HeroBar({ cart, catalog, onRegion, onTerm, onCadence, onReset }: Props) {
  const hasState = cart.flow !== null || cart.items.length > 0
  return (
    <div className="border-b bg-background sticky top-0 z-30 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 font-semibold text-base text-primary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/examples/puffin-cloud-logo.svg" alt="Puffin Cloud" className="h-7 w-auto" />
          Puffin Cloud
        </div>
        <span className="text-xs text-muted-foreground">Pricing Calculator</span>

        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Region</span>
            <select
              className="rounded-md border bg-background px-2 py-1 text-sm"
              value={cart.region}
              onChange={(e) => onRegion(e.target.value)}
              aria-label="Region"
            >
              {catalog.regions.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-1 rounded-md border p-0.5" role="group" aria-label="Term">
            {TERMS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => onTerm(t.value)}
                className={`px-2 py-1 rounded text-xs transition-colors ${
                  cart.term === t.value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 rounded-md border p-0.5" role="group" aria-label="Billing cadence">
            {CADENCES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => onCadence(c.value)}
                className={`px-2 py-1 rounded text-xs transition-colors ${
                  cart.cadence === c.value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <span className="text-muted-foreground">{catalog.currencyCode}</span>

          {hasState && (
            <button
              type="button"
              onClick={onReset}
              data-testid="reset-calculator"
              title="Clear cart and start fresh"
              className="ml-1 inline-flex items-center gap-1 rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors"
            >
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
