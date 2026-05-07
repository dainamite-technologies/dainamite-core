'use client'

import * as React from 'react'
import { ArrowRight, ChevronRight } from 'lucide-react'
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
  const noEstimateUsage = usage.filter((u) => !usageEstimate.lines.some((l) => l.chargeCode === u.chargeCode))

  return (
    <aside data-testid="cart-drawer" className="pf-cart">
      <div className="pf-cart-card">
        <h3 className="pf-cart-title">
          <span>Your estimate</span>
          <span className="pf-cart-title-line" aria-hidden />
          {pricing.loading && (
            <span className="pf-cart-loading">
              <span className="pf-spinner" role="status" aria-label="Calculating" />
            </span>
          )}
        </h3>

        {cart.items.length === 0 ? (
          <p className="pf-cart-empty">Pick a bundle or add a product to see live pricing.</p>
        ) : (
          <>
            <ul className="pf-cart-lines">
              {cart.items.map((item) => {
                const meta = offeringsById.get(item.offeringId)
                const line = linesByKey.get(item.lineKey)
                return (
                  <li key={item.lineKey} className="pf-cart-line">
                    <div className="pf-cart-line-main">
                      <div className="pf-cart-line-name">{meta?.name ?? 'Unknown'}</div>
                      {meta?.specName && <div className="pf-cart-line-spec">{meta.specName}</div>}
                      {item.bundleSlotKey && <span className="pf-chip">{item.bundleSlotKey}</span>}
                      {item.quantity > 1 && (
                        <div className="pf-cart-line-spec">qty {item.quantity}</div>
                      )}
                    </div>
                    <div className="pf-cart-line-side">
                      <div className="pf-cart-line-price">
                        {line ? (
                          <>
                            <span className="pf-mono">
                              {formatCurrency(line.mrcTotal, catalog.currencyCode)}
                            </span>
                          </>
                        ) : pricing.loading ? (
                          <span className="pf-spinner" role="status" aria-label="Calculating" />
                        ) : (
                          <span className="pf-mono">—</span>
                        )}
                        <span className="pf-price-suffix">/ mo</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemove(item.lineKey)}
                        className="pf-link pf-link--sm"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>

            <div className="pf-cart-totals">
              <div className="pf-total-row pf-total-row--major">
                <span>Monthly recurring</span>
                <span className="pf-mono pf-mono--lg">
                  {formatCurrency(totalMonthly, catalog.currencyCode)}
                </span>
              </div>

              {usageEstimate.total > 0 && (
                <details className="pf-total-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <summary
                    className="pf-cart-usage-toggle"
                    style={{ display: 'flex', justifyContent: 'space-between', listStyle: 'none', cursor: 'pointer' }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <ChevronRight size={12} aria-hidden />
                      Estimated monthly usage
                    </span>
                    <span className="pf-mono">
                      {formatCurrency(usageEstimate.total, catalog.currencyCode)}
                    </span>
                  </summary>
                  <ul className="pf-cart-usage-list">
                    {usageEstimate.lines.map((u) => (
                      <li key={`${u.lineKey}:${u.chargeCode}`} className="pf-cart-usage-line">
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {u.offeringName} — {u.chargeName} · {u.quantity.toLocaleString('en-US')} ×{' '}
                          {formatCurrency(u.unitPrice, catalog.currencyCode)}
                        </span>
                        <span className="pf-mono">{formatCurrency(u.total, catalog.currencyCode)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {noEstimateUsage.length > 0 && (
                <details className="pf-total-row pf-total-row--dim" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <summary
                    className="pf-cart-usage-toggle"
                    style={{ listStyle: 'none', cursor: 'pointer' }}
                  >
                    + {noEstimateUsage.length} usage charge(s) without an estimate
                  </summary>
                  <ul className="pf-cart-usage-list">
                    {noEstimateUsage.map((u) => (
                      <li key={u.chargeCode} className="pf-cart-usage-line">
                        <span>{u.chargeName}</span>
                        {u.unitPrice != null && (
                          <span className="pf-mono">{formatCurrency(u.unitPrice, catalog.currencyCode)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {(usageEstimate.total > 0 || totalMonthly > 0) && (
                <div className="pf-total-row pf-total-row--major" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                  <span>Estimated monthly total</span>
                  <span className="pf-mono pf-mono--lg">
                    {formatCurrency(estimatedTotal, catalog.currencyCode)}
                  </span>
                </div>
              )}

              {totalOneTime > 0 && (
                <div
                  className="pf-total-row pf-total-row--major"
                  style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}
                >
                  <span>One-time setup</span>
                  <span className="pf-mono pf-mono--lg">
                    {formatCurrency(totalOneTime, catalog.currencyCode)}
                  </span>
                </div>
              )}
            </div>

            {pricing.error && (
              <p className="pf-cart-error">Pricing temporarily unavailable. Retrying…</p>
            )}

            <button type="button" onClick={onCheckout} className="pf-btn pf-btn--cta">
              Get a quote <ArrowRight size={14} aria-hidden />
            </button>
            <p className="pf-cart-foot">
              No commitment. We&apos;ll send your config to a sales engineer.
            </p>
          </>
        )}
      </div>
    </aside>
  )
}
