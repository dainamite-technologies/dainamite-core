'use client'

import * as React from 'react'
import type { Cart, PriceResponse, PublicCatalog } from '../../types'
import { displaySpecName } from '../../types'

type Props = {
  cart: Cart
  catalog: PublicCatalog
  pricing: { loading: boolean; data: PriceResponse | null; error: string | null }
  onRemove: (lineKey: string) => void
  onCheckout: () => void
}

function formatCurrency(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).format(amount)
  } catch {
    return `${currencyCode} ${amount.toFixed(2)}`
  }
}

type UsageEstimateLine = {
  lineKey: string
  offeringName: string
  chargeCode: string
  chargeName: string
  unitPrice: number
  quantity: number
  total: number
}

export function CartDrawer({ cart, catalog, pricing, onRemove, onCheckout }: Props) {
  const offeringsById = React.useMemo(() => {
    const map = new Map<string, { name: string; specName: string }>()
    for (const spec of catalog.specifications) {
      for (const offering of spec.offerings) {
        map.set(offering.id, { name: offering.marketingName, specName: displaySpecName(spec.name) })
      }
    }
    return map
  }, [catalog])

  // Lookup quantityAttributeCode by (offeringId, chargeCode) so we can map
  // each priced usage charge back to its quantity attribute on the cart line.
  // Only chargeType: 'usage' charges go through this path — flat MRC/NRC are
  // already summed into pricing.totals.
  const quantityAttrLookup = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const spec of catalog.specifications) {
      for (const offering of spec.offerings) {
        for (const charge of offering.charges ?? []) {
          if (charge.quantityAttributeCode) {
            map.set(`${offering.id}:${charge.code}`, charge.quantityAttributeCode)
          }
        }
      }
    }
    return map
  }, [catalog])

  const linesByKey = React.useMemo(() => {
    const map = new Map<string, PriceResponse['lines'][number]>()
    for (const line of pricing.data?.lines ?? []) map.set(line.lineKey, line)
    return map
  }, [pricing.data])

  const totalMonthly = pricing.data?.totals.mrcTotal ?? 0
  const totalOneTime = pricing.data?.totals.nrcTotal ?? 0

  // Per-line usage estimate: pull each line's usage charges, look up the
  // quantity attribute on the catalog charge, multiply by the value the
  // visitor (or bundle preset) supplied. Tiered usage gets the engine's
  // tier-effective unitPrice for a single tier — under-counts if the volume
  // crosses tier breakpoints, but is a sensible "what you'd pay roughly".
  const usageEstimate = React.useMemo(() => {
    const lines: UsageEstimateLine[] = []
    let total = 0
    for (const item of cart.items) {
      const priced = linesByKey.get(item.lineKey)
      if (!priced) continue
      const offeringMeta = offeringsById.get(item.offeringId)
      for (const u of priced.usageCharges ?? []) {
        if (u.unitPrice == null) continue
        const attrCode = quantityAttrLookup.get(`${item.offeringId}:${u.chargeCode}`)
        if (!attrCode) continue
        const rawQty = item.configuration?.[attrCode]
        const qty = typeof rawQty === 'number' ? rawQty : Number(rawQty)
        if (!Number.isFinite(qty) || qty <= 0) continue
        const lineTotal = u.unitPrice * qty
        total += lineTotal
        lines.push({
          lineKey: item.lineKey,
          offeringName: offeringMeta?.name ?? 'Unknown',
          chargeCode: u.chargeCode,
          chargeName: u.chargeName,
          unitPrice: u.unitPrice,
          quantity: qty,
          total: lineTotal,
        })
      }
    }
    return { total, lines }
  }, [cart.items, linesByKey, offeringsById, quantityAttrLookup])

  const usage = pricing.data?.totals.usageCharges ?? []
  const estimatedTotal = totalMonthly + usageEstimate.total

  return (
    <aside
      data-testid="cart-drawer"
      className="lg:sticky lg:top-20 lg:self-start rounded-xl border bg-card p-5 space-y-4"
    >
      <header className="flex items-center justify-between">
        <h2 className="font-semibold">Your estimate</h2>
        {pricing.loading && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              role="status"
              aria-label="Calculating"
              className="inline-block h-3 w-3 rounded-full border-2 border-muted-foreground/30 border-t-primary animate-spin"
            />
            Calculating…
          </span>
        )}
      </header>

      {cart.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Pick a bundle or add a product to see live pricing.
        </p>
      ) : (
        <>
          <ul className="space-y-3">
            {cart.items.map((item) => {
              const meta = offeringsById.get(item.offeringId)
              const line = linesByKey.get(item.lineKey)
              return (
                <li key={item.lineKey} className="flex items-start justify-between gap-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{meta?.name ?? 'Unknown'}</div>
                    {meta?.specName && (
                      <div className="text-xs text-muted-foreground truncate">{meta.specName}</div>
                    )}
                    {item.bundleSlotKey && (
                      <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] uppercase tracking-wider">
                        bundle: {item.bundleSlotKey}
                      </span>
                    )}
                    {item.quantity > 1 && (
                      <div className="text-xs text-muted-foreground">qty {item.quantity}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div
                      className="font-medium flex items-center justify-end gap-1.5"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {line ? (
                        formatCurrency(line.mrcTotal, catalog.currencyCode)
                      ) : pricing.loading ? (
                        <span
                          role="status"
                          aria-label="Calculating"
                          className="inline-block h-3 w-3 rounded-full border-2 border-muted-foreground/30 border-t-primary animate-spin"
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">/ mo</div>
                    <button
                      type="button"
                      onClick={() => onRemove(item.lineKey)}
                      className="text-[11px] text-muted-foreground hover:text-destructive mt-1 underline"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="border-t pt-3 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Monthly recurring</span>
              <span className="font-semibold flex items-center gap-2" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {pricing.loading && !pricing.data && (
                  <span
                    role="status"
                    aria-label="Calculating"
                    className="inline-block h-3 w-3 rounded-full border-2 border-muted-foreground/30 border-t-primary animate-spin"
                  />
                )}
                {formatCurrency(totalMonthly, catalog.currencyCode)}
              </span>
            </div>

            {usageEstimate.total > 0 && (
              <details className="group">
                <summary className="flex items-center justify-between text-sm cursor-pointer list-none">
                  <span className="text-muted-foreground inline-flex items-center gap-1">
                    <span aria-hidden className="inline-block transition-transform group-open:rotate-90">▸</span>
                    Estimated monthly usage
                  </span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatCurrency(usageEstimate.total, catalog.currencyCode)}
                  </span>
                </summary>
                <ul className="mt-1.5 space-y-1 pl-4 text-xs text-muted-foreground">
                  {usageEstimate.lines.map((u) => (
                    <li key={`${u.lineKey}:${u.chargeCode}`} className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        {u.offeringName} — {u.chargeName} · {u.quantity.toLocaleString('en-US')} ×{' '}
                        {formatCurrency(u.unitPrice, catalog.currencyCode)}
                      </span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatCurrency(u.total, catalog.currencyCode)}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {(usageEstimate.total > 0 || totalMonthly > 0) && (
              <div className="flex items-center justify-between text-sm border-t pt-1.5 mt-1.5">
                <span className="font-medium">Estimated total</span>
                <span className="font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatCurrency(estimatedTotal, catalog.currencyCode)}
                  <span className="text-xs font-normal text-muted-foreground"> / mo</span>
                </span>
              </div>
            )}

            {totalOneTime > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">One-time setup</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatCurrency(totalOneTime, catalog.currencyCode)}
                </span>
              </div>
            )}

            {/* Usage charges priced at $0 quantity (visitor hasn't filled in
                an estimate yet) still surface so the visitor knows they exist
                and what they'll cost per unit. */}
            {usage.length > usageEstimate.lines.length && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  + {usage.length - usageEstimate.lines.length} usage charge(s) without an estimate
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {usage
                    .filter((u) => !usageEstimate.lines.some((l) => l.chargeCode === u.chargeCode))
                    .map((u) => (
                      <li key={u.chargeCode}>
                        {u.chargeName}
                        {u.unitPrice != null ? ` — ${formatCurrency(u.unitPrice, catalog.currencyCode)}` : ''}
                      </li>
                    ))}
                </ul>
              </details>
            )}
          </div>

          {pricing.error && (
            <p className="text-xs text-destructive">Pricing temporarily unavailable. Retrying…</p>
          )}

          <button
            type="button"
            onClick={onCheckout}
            className="w-full inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Get a quote
          </button>
        </>
      )}
    </aside>
  )
}
