'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { WizardStepProps } from '../types'

type ResolvedCharge = {
  chargeCode: string
  chargeName: string
  chargeType: string
  unitPrice: number
  totalPrice: number | null
  currencyCode: string
  adjustments?: Array<{
    ruleCode: string
    ruleName: string
    ruleType: string
    delta: number
  }> | null
}

type QuoteLine = {
  lineId: string
  offeringName: string
  quantity: number
  nrcTotal: number
  mrcTotal: number
  charges: ResolvedCharge[]
  isConfigured: boolean
}

type QuoteData = {
  id: string
  quoteNumber: string
  cpqStatus: string
  currencyCode: string
  pricingSummary: {
    nrcTotal: number
    mrcTotal: number
    discountTotal: number
    surchargeTotal: number
    currencyCode: string
  }
  lines: QuoteLine[]
}

function fmt(n: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n)
}

function chargeTypeLabel(t: TranslateFn, chargeType: string): string {
  switch (chargeType) {
    case 'nrc':
      return t('cpq.lines.chargeType.nrc', 'nrc')
    case 'mrc':
      return t('cpq.lines.chargeType.mrc', 'mrc')
    case 'usage':
      return t('cpq.lines.chargeType.usage', 'usage')
    default:
      return chargeType
  }
}

export function ReviewStep({ config, onComplete, onBack, completedSteps, quoteId }: WizardStepProps) {
  const t = useT()
  const [quote, setQuote] = useState<QuoteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const showChargeBreakdown = config.showChargeBreakdown !== false
  const showAdjustments = config.showAdjustments !== false
  const submitAction = (config.submitAction as string) ?? 'save'
  const submitLabel = (config.submitLabel as string) ?? t('cpq.wizard.steps.review.complete', 'Complete')

  const loadQuote = useCallback(async () => {
    if (!quoteId) { setLoading(false); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/cpq/quotes/${quoteId}`)
      if (res.ok) {
        setQuote(await res.json())
      }
    } finally {
      setLoading(false)
    }
  }, [quoteId])

  useEffect(() => { loadQuote() }, [loadQuote])

  const handleSubmit = useCallback(async () => {
    setSubmitting(true)
    try {
      if (quoteId && submitAction !== 'none') {
        const targetStatus =
          submitAction === 'submit_for_approval' ? 'in_approval'
          : submitAction === 'send_to_customer' ? 'with_customer'
          : undefined

        if (targetStatus) {
          await fetch(`/api/cpq/quotes/${quoteId}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetStatus }),
          })
        }
      }

      onComplete({
        quoteId,
        action: submitAction,
        nrcTotal: quote?.pricingSummary.nrcTotal ?? 0,
        mrcTotal: quote?.pricingSummary.mrcTotal ?? 0,
      })
    } finally {
      setSubmitting(false)
    }
  }, [quoteId, submitAction, quote, onComplete])

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t('cpq.wizard.steps.review.loading', 'Loading quote summary...')}</div>
  }

  if (!quote) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
        {t('cpq.wizard.steps.review.noData', 'No quote data available. Please go back and configure items.')}
      </div>
    )
  }

  const { pricingSummary, lines } = quote

  return (
    <div className="space-y-5">
      {/* Quote summary */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
        <h4 className="text-sm font-medium">{t('cpq.wizard.steps.review.summaryTitle', 'Quote Summary')}</h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-xs text-muted-foreground">{t('cpq.wizard.steps.review.nrcTotal', 'NRC Total')}</span>
            <p className="text-lg font-semibold">{fmt(pricingSummary.nrcTotal, pricingSummary.currencyCode)}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">{t('cpq.wizard.steps.review.mrcTotal', 'MRC Total')}</span>
            <p className="text-lg font-semibold">{fmt(pricingSummary.mrcTotal, pricingSummary.currencyCode)}</p>
          </div>
          {pricingSummary.discountTotal > 0 && (
            <div>
              <span className="text-xs text-muted-foreground">{t('cpq.wizard.steps.review.discounts', 'Discounts')}</span>
              <p className="text-sm">-{fmt(pricingSummary.discountTotal, pricingSummary.currencyCode)}</p>
            </div>
          )}
          {pricingSummary.surchargeTotal > 0 && (
            <div>
              <span className="text-xs text-muted-foreground">{t('cpq.wizard.steps.review.surcharges', 'Surcharges')}</span>
              <p className="text-sm">+{fmt(pricingSummary.surchargeTotal, pricingSummary.currencyCode)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Line items */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium">{t('cpq.wizard.steps.review.items', 'Items ({count})', { count: lines.length })}</h4>
        <div className="space-y-2">
          {lines.map((line) => (
            <div key={line.lineId} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <strong className="text-sm">{line.offeringName}</strong>
                <span className="text-sm">
                  {t('cpq.wizard.linePricing', '{nrc} NRC / {mrc} MRC', { nrc: fmt(line.nrcTotal, pricingSummary.currencyCode), mrc: fmt(line.mrcTotal, pricingSummary.currencyCode) })}
                </span>
              </div>
              {line.quantity > 1 && (
                <span className="text-xs text-muted-foreground">{t('cpq.wizard.steps.review.quantity', 'Quantity: {quantity}', { quantity: line.quantity })}</span>
              )}

              {showChargeBreakdown && line.charges?.length > 0 && (
                <div className="rounded border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-3 py-1.5 text-left font-medium">{t('cpq.wizard.steps.review.charges.charge', 'Charge')}</th>
                        <th className="px-3 py-1.5 text-left font-medium">{t('cpq.wizard.steps.review.charges.type', 'Type')}</th>
                        <th className="px-3 py-1.5 text-right font-medium">{t('cpq.wizard.steps.review.charges.price', 'Price')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {line.charges.map((charge) => (
                        <React.Fragment key={charge.chargeCode}>
                          <tr className="border-b last:border-0">
                            <td className="px-3 py-1.5">{charge.chargeName}</td>
                            <td className="px-3 py-1.5 uppercase">{chargeTypeLabel(t, charge.chargeType)}</td>
                            <td className="px-3 py-1.5 text-right">
                              {charge.totalPrice != null ? fmt(charge.totalPrice, charge.currencyCode) : t('cpq.lines.perUnit', '{price}/unit', { price: fmt(charge.unitPrice, charge.currencyCode) })}
                            </td>
                          </tr>
                          {showAdjustments && charge.adjustments?.map((adj) => (
                            <tr key={adj.ruleCode} className="text-[11px] text-muted-foreground">
                              <td colSpan={2} className="px-3 py-0.5 pl-6">{adj.ruleName}</td>
                              <td className="px-3 py-0.5 text-right">
                                {adj.delta < 0 ? '' : '+'}{fmt(adj.delta, charge.currencyCode)}
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-2">
        {completedSteps.length > 0 && (
          <button type="button" onClick={onBack} className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">
            {t('cpq.common.back', 'Back')}
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? t('cpq.wizard.steps.review.submitting', 'Submitting...') : submitLabel}
        </button>
      </div>
    </div>
  )
}
