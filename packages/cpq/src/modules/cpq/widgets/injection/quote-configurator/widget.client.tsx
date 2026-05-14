"use client"
import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useRouter } from 'next/navigation'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  formatStatusLabel,
  quoteCpqStatusMap,
  type QuoteCpqStatus,
} from '../../../components/statusMaps'

// ─── Types ───────────────────────────────────────────────────────

type ResolvedCharge = {
  chargeCode: string
  chargeName: string
  chargeType: 'nrc' | 'mrc' | 'usage'
  unitPrice: number
  quantity: number | null
  totalPrice: number | null
  currencyCode: string
  note?: string | null
}

type QuoteLine = {
  lineId: string
  offeringId: string | null
  offeringName: string
  quantity: number
  nrcTotal: number
  mrcTotal: number
  charges: ResolvedCharge[]
  isConfigured: boolean
  validationErrors: Array<{ message: string }> | null
}

type QuoteResult = {
  id: string
  quoteId: string
  quoteNumber: string
  customerId: string
  cpqStatus: string
  version: number
  currencyCode: string
  pricingSummary: {
    nrcTotal: number
    mrcTotal: number
    usageCharges: Array<{ chargeCode: string; chargeName: string; unitPrice: number; note: string | null }>
    usageTotalEstimated: number | null
    currencyCode: string
  }
  lines: QuoteLine[]
}

// ─── Helpers ─────────────────────────────────────────────────────

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

// ─── Main Widget (read-only) ─────────────────────────────────────

export default function QuoteConfiguratorWidget({ data }: InjectionWidgetComponentProps) {
  const router = useRouter()
  const record = data as Record<string, unknown> | null
  const quoteId = (record?.id as string) ?? null

  const [cpqQuote, setCpqQuote] = React.useState<QuoteResult | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [expandedLines, setExpandedLines] = React.useState<Set<string>>(new Set())

  React.useEffect(() => {
    if (!quoteId) { setLoading(false); return }
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/cpq/quotes/${quoteId}`)
        if (res.ok && !cancelled) setCpqQuote(await res.json())
      } catch { /* no CPQ config */ }
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [quoteId])

  if (!quoteId) return <div className="p-4 text-sm text-muted-foreground">No quote context available.</div>

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Spinner /> Loading CPQ configuration…
      </div>
    )
  }

  // ─── No CPQ config ─────────────────────────────────────────────

  if (!cpqQuote) {
    const custId = (record?.customerEntityId as string) ?? (record?.customer_entity_id as string) ?? ''
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="rounded-full bg-primary/10 p-3 mb-3">
          <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <p className="text-sm text-muted-foreground mb-4">This quote has no CPQ configuration yet.</p>
        <button
          onClick={() => router.push(`/backend/cpq/quotes/new?quoteId=${quoteId}&customerId=${custId}`)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Create CPQ Quote
        </button>
        {!custId && <p className="mt-2 text-xs text-status-warning-text">Assign a customer to this quote first.</p>}
      </div>
    )
  }

  // ─── Read-only summary ─────────────────────────────────────────

  const { pricingSummary: summary, currencyCode: currency } = cpqQuote
  const toggleLine = (id: string) => {
    setExpandedLines((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <Tag variant={quoteCpqStatusMap[cpqQuote.cpqStatus as QuoteCpqStatus] ?? 'neutral'} dot>
            {formatStatusLabel(cpqQuote.cpqStatus)}
          </Tag>
          <span className="text-xs text-muted-foreground">v{cpqQuote.version}</span>
          <span className="text-xs text-muted-foreground">{currency}</span>
        </div>
        <button
          onClick={() => router.push(`/backend/cpq/quotes/${cpqQuote.id}`)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
        >
          Open CPQ Configurator
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
        </button>
      </div>

      {/* Lines */}
      {cpqQuote.lines.length === 0 ? (
        <div className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">
          No items configured yet.
        </div>
      ) : (
        <div className="rounded-lg border bg-card divide-y">
          {cpqQuote.lines.map((line) => {
            const isExpanded = expandedLines.has(line.lineId)
            return (
              <div key={line.lineId}>
                <div
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => toggleLine(line.lineId)}
                >
                  <button className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground">
                    <svg className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{line.offeringName}</span>
                      {line.quantity > 1 && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">×{line.quantity}</span>}
                      {line.isConfigured ? (
                        <Tag variant="success" className="px-1.5 text-xs">configured</Tag>
                      ) : (
                        <Tag variant="warning" className="px-1.5 text-xs">incomplete</Tag>
                      )}
                    </div>
                    {line.validationErrors && line.validationErrors.length > 0 && (
                      <p className="text-xs text-destructive mt-0.5">{line.validationErrors[0].message}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-xs space-y-0.5">
                    {line.nrcTotal > 0 && <div><span className="text-muted-foreground">NRC </span><span className="font-mono font-medium">{fmt(line.nrcTotal, currency)}</span></div>}
                    {line.mrcTotal > 0 && <div><span className="text-muted-foreground">MRC </span><span className="font-mono font-medium">{fmt(line.mrcTotal, currency)}</span></div>}
                  </div>
                </div>

                {/* Charge breakdown */}
                {isExpanded && line.charges.length > 0 && (
                  <div className="border-t bg-muted/10 px-12 py-2">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground">
                          <th className="text-left py-1 font-medium">Charge</th>
                          <th className="text-left py-1 font-medium">Type</th>
                          <th className="text-right py-1 font-medium">Unit Price</th>
                          <th className="text-right py-1 font-medium">Qty</th>
                          <th className="text-right py-1 font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {line.charges.map((c, i) => (
                          <tr key={i} className="border-t border-dashed border-border/50">
                            <td className="py-1">{c.chargeName}</td>
                            <td className="py-1 uppercase">{c.chargeType}</td>
                            <td className="py-1 text-right font-mono">{fmt(c.unitPrice, currency)}</td>
                            <td className="py-1 text-right font-mono">{c.quantity ?? '—'}</td>
                            <td className="py-1 text-right font-mono">{c.totalPrice != null ? fmt(c.totalPrice, currency) : c.note ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Pricing Summary */}
      {cpqQuote.lines.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Non-Recurring (NRC)</p>
              <p className="text-lg font-semibold font-mono">{fmt(summary.nrcTotal, currency)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Monthly Recurring (MRC)</p>
              <p className="text-lg font-semibold font-mono">{fmt(summary.mrcTotal, currency)}</p>
            </div>
            {summary.usageCharges.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">Usage Charges</p>
                <div className="mt-1 space-y-0.5">
                  {summary.usageCharges.map((uc, i) => (
                    <p key={i} className="text-xs">{uc.chargeName}: {fmt(uc.unitPrice, currency)}/unit</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}
