"use client"
import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'

// ─── Types ───────────────────────────────────────────────────────

type ArcLineSource = {
  subscriptionItemId: string
  name: string
  mrcAmount: number
  nrcAmount: number
  quantity: number
}

type OrderLineResult = {
  lineId: string
  offeringId: string | null
  offeringName: string
  offeringType: string | null
  productId: string | null
  specId: string | null
  action: string
  parentLineId: string | null
  quantity: number
  configuration: Record<string, unknown>
  startDate: string | null
  termMonths: number | null
  endDate: string | null
  nrcTotal: number
  mrcTotal: number
  charges: Array<{ chargeName?: string; chargeType?: string; unitPrice?: number; quantity?: number; totalPrice?: number }>
  sourceQuoteLineId: string | null
  arcSource: ArcLineSource | null
}

type OrderResult = {
  id: string
  orderId: string
  orderNumber: string
  customerId: string
  cpqStatus: string
  sourceQuoteId: string | null
  quoteType: string
  currencyCode: string
  pricingSummary: {
    nrcTotal: number
    mrcTotal: number
    currencyCode: string
  }
  activatedAt: string | null
  createdAt: string
  lines: OrderLineResult[]
}

const ARC_BADGE_STYLES: Record<string, string> = {
  amend: 'bg-purple-100 text-purple-800 border-purple-200',
  renew: 'bg-green-100 text-green-800 border-green-200',
  cancel: 'bg-red-100 text-red-800 border-red-200',
}

// ─── Constants ───────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-blue-100 text-blue-800',
  pending_activation: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  fulfilled: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-100 text-gray-800',
}

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`)
  return json as T
}

// ─── Main Page ───────────────────────────────────────────────────

export default function CpqOrderDetailPage(props: { params?: { id?: string } }) {
  const router = useRouter()
  const urlParams = useParams()
  const cpqOrderId = (props.params?.id ?? urlParams?.id) as string

  const [order, setOrder] = React.useState<OrderResult | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [activating, setActivating] = React.useState(false)
  const [expandedLines, setExpandedLines] = React.useState<Set<string>>(new Set())
  const [customerName, setCustomerName] = React.useState<string | null>(null)
  const [subscription, setSubscription] = React.useState<{ id: string; name: string; code: string; status: string } | null>(null)

  function fetchSubscription(cpqConfigId: string, cancelled?: boolean) {
    fetch(`/api/cpq/inventory/subscriptions?sourceOrderId=${cpqConfigId}&pageSize=1`)
      .then((r) => r.json())
      .then((data) => {
        const items = data?.items ?? (Array.isArray(data) ? data : [])
        if (items.length > 0 && !cancelled) {
          const sub = items[0]
          setSubscription({ id: sub.id, name: sub.name, code: sub.code, status: sub.status })
        }
      })
      .catch(() => {})
  }

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const result = await apiJson<OrderResult>(`/api/cpq/orders/${cpqOrderId}`)
        if (!cancelled) {
          setOrder(result)
          fetch(`/api/customers/companies?id=${result.customerId}&pageSize=1`)
            .then((r) => r.json())
            .then((data) => {
              const items = data.items ?? data ?? []
              const c = items[0]
              if (c && !cancelled) setCustomerName(c.display_name || c.displayName || c.name || null)
            })
            .catch(() => {})
          if (result.cpqStatus === 'active' || result.cpqStatus === 'fulfilled') {
            fetchSubscription(result.id, cancelled)
          }
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [cpqOrderId])

  const activateOrder = async () => {
    if (!order) return
    try {
      setActivating(true)
      setError(null)
      const result = await apiJson<OrderResult>(`/api/cpq/orders/${order.id}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      setOrder(result)
      fetchSubscription(result.id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setActivating(false)
    }
  }

  const cancelOrder = async () => {
    if (!order) return
    try {
      setError(null)
      const result = await apiJson<OrderResult>(`/api/cpq/orders/${order.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetStatus: 'cancelled' }),
      })
      setOrder(result)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const toggleLine = (id: string) => {
    setExpandedLines((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // ─── Render: loading / error ─────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 justify-center text-sm text-muted-foreground">
        <Spinner /> Loading…
      </div>
    )
  }

  if (!order) {
    return (
      <div className="space-y-4">
        <button onClick={() => router.push('/backend/cpq/orders')} className="text-sm text-muted-foreground hover:text-foreground">← Back to Orders</button>
        {error && <ErrorBanner message={error} />}
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">Order not found.</div>
      </div>
    )
  }

  // ─── Render: detail ──────────────────────────────────────────

  const canActivate = order.cpqStatus === 'draft' || order.cpqStatus === 'pending_activation'
  const canCancel = order.cpqStatus === 'draft' || order.cpqStatus === 'pending_activation' || order.cpqStatus === 'active'
  const currency = order.currencyCode

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/backend/cpq/orders')} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
          <h1 className="text-2xl font-bold">Order {order.orderNumber || order.orderId.slice(0, 8)}</h1>
          {order.quoteType && order.quoteType !== 'new' && (
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${
                ARC_BADGE_STYLES[order.quoteType] ?? 'bg-gray-100 text-gray-800 border-gray-200'
              }`}
              title={`ARC ${order.quoteType} order — derived from a Customer Inventory subscription change`}
            >
              {order.quoteType}
            </span>
          )}
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[order.cpqStatus] ?? 'bg-gray-100 text-gray-800'}`}>
            {order.cpqStatus.replace(/_/g, ' ')}
          </span>
          <span className="text-xs text-muted-foreground">{currency}</span>
          <button
            onClick={() => router.push(`/backend/sales/orders/${order.orderId}`)}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline ml-2"
          >
            View Sales Order
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </button>
          {order.sourceQuoteId && (
            <button
              onClick={() => router.push(`/backend/cpq/quotes/${order.sourceQuoteId}`)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              Source Quote
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canCancel && (
            <button
              onClick={cancelOrder}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors"
            >
              Cancel Order
            </button>
          )}
          {canActivate && (
            <button
              onClick={activateOrder}
              disabled={activating}
              className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              {activating && <Spinner />}
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
              </svg>
              Activate Order
            </button>
          )}
        </div>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Success banner after activation */}
      {order.cpqStatus === 'active' && order.activatedAt && (
        <div className="rounded-md bg-green-50 border border-green-200 p-3 flex items-center gap-2">
          <svg className="h-5 w-5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm text-green-700">
            Order activated on {new Date(order.activatedAt).toLocaleString()}.
            {subscription ? ' Subscription created.' : ' Inventory items have been created.'}
          </span>
          <div className="ml-auto flex items-center gap-3">
            {subscription && (
              <button
                onClick={() => router.push(`/backend/cpq/inventory/subscriptions/${subscription.id}`)}
                className="text-xs text-green-700 hover:underline font-medium"
              >
                View Subscription →
              </button>
            )}
            <button
              onClick={() => router.push('/backend/cpq/inventory')}
              className="text-xs text-green-700 hover:underline font-medium"
            >
              View Inventory →
            </button>
          </div>
        </div>
      )}

      {/* Linked subscription */}
      {subscription && (
        <div className="rounded-md bg-indigo-50 border border-indigo-200 p-3 flex items-center gap-3">
          <svg className="h-5 w-5 text-indigo-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.183" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-indigo-900">Linked Subscription</p>
            <p className="text-xs text-indigo-600">{subscription.name} ({subscription.code})</p>
          </div>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            subscription.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-indigo-100 text-indigo-800'
          }`}>
            {subscription.status}
          </span>
          <button
            onClick={() => router.push(`/backend/cpq/inventory/subscriptions/${subscription.id}`)}
            className="inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:text-indigo-900 hover:underline"
          >
            Open
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </button>
        </div>
      )}

      {/* Pricing Summary Card */}
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-medium mb-3">Pricing Summary</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Non-Recurring (NRC)</p>
            <p className="text-lg font-semibold font-mono">{fmt(order.pricingSummary.nrcTotal, currency)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Monthly Recurring (MRC)</p>
            <p className="text-lg font-semibold font-mono">{fmt(order.pricingSummary.mrcTotal, currency)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Created</p>
            <p className="text-sm font-medium">{new Date(order.createdAt).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Customer</p>
            <p className="text-sm font-medium">{customerName ?? order.customerId.slice(0, 12) + '…'}</p>
          </div>
        </div>
      </div>

      {/* Order Lines */}
      <OrderLineTree lines={order.lines} currency={currency} expandedLines={expandedLines} onToggleLine={toggleLine} />
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────

function OrderLineTree({ lines, currency, expandedLines, onToggleLine }: {
  lines: OrderLineResult[]; currency: string; expandedLines: Set<string>; onToggleLine: (id: string) => void
}) {
  const rootLines = lines.filter((l) => !l.parentLineId)
  const childrenByParent = new Map<string, OrderLineResult[]>()
  for (const line of lines) {
    if (line.parentLineId) {
      const arr = childrenByParent.get(line.parentLineId) ?? []
      arr.push(line)
      childrenByParent.set(line.parentLineId, arr)
    }
  }

  return (
    <div>
      <h3 className="text-sm font-medium mb-2 px-1">Line Items ({lines.length})</h3>
      {lines.length === 0 ? (
        <div className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">
          No line items.
        </div>
      ) : (
        <div className="rounded-lg border bg-card divide-y">
          {rootLines.map((line) => {
            const isBundle = line.offeringType === 'bundle'
            const children = childrenByParent.get(line.lineId) ?? []
            const isExpanded = expandedLines.has(line.lineId)
            return (
              <div key={line.lineId}>
                <OrderLineRow line={line} currency={currency} isExpanded={isExpanded} isBundle={isBundle} childCount={children.length} indent={0} onToggle={() => onToggleLine(line.lineId)} />
                {isBundle && isExpanded && children.length > 0 && (
                  <div className="border-t border-dashed border-indigo-200/50 bg-indigo-50/20">
                    <div className="px-6 py-1.5">
                      <span className="text-[10px] font-medium text-indigo-500 uppercase tracking-wider">Bundle Components ({children.length})</span>
                    </div>
                    {children.map((child) => (
                      <OrderLineRow key={child.lineId} line={child} currency={currency} isExpanded={expandedLines.has(child.lineId)} isBundle={false} childCount={0} indent={1} onToggle={() => onToggleLine(child.lineId)} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function OrderLineRow({ line, currency, isExpanded, isBundle, childCount, indent, onToggle }: {
  line: OrderLineResult; currency: string; isExpanded: boolean; isBundle: boolean; childCount: number; indent: number; onToggle: () => void
}) {
  const paddingLeft = indent > 0 ? `${indent * 2 + 1}rem` : undefined

  return (
    <div>
      <div
        className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer"
        style={paddingLeft ? { paddingLeft } : undefined}
        onClick={onToggle}
      >
        <button className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground">
          <svg className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {indent > 0 && <span className="text-muted-foreground text-xs">└</span>}
            {isBundle && (
              <span className="inline-flex items-center rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700">bundle</span>
            )}
            <span className="font-medium text-sm">{line.offeringName}</span>
            {line.quantity > 1 && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">×{line.quantity}</span>}
            <span className="inline-flex items-center rounded-full bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">{line.action}</span>
            {isBundle && <span className="text-xs text-muted-foreground">{childCount} component{childCount !== 1 ? 's' : ''}</span>}
          </div>
        </div>

        <div className="shrink-0 text-right text-xs space-y-0.5">
          {line.nrcTotal > 0 && <div><span className="text-muted-foreground">NRC </span><span className="font-mono font-medium">{fmt(line.nrcTotal, currency)}</span></div>}
          {line.mrcTotal > 0 && <div><span className="text-muted-foreground">MRC </span><span className="font-mono font-medium">{fmt(line.mrcTotal, currency)}</span></div>}
        </div>
      </div>

      {isExpanded && (() => {
        const internalKeys = new Set(['_arcMirroredName', '_arcMirroredFromItemId', 'offeringName'])
        const visibleConfigEntries = Object.entries(line.configuration).filter(
          ([key]) => !internalKeys.has(key),
        )
        const hasConfig = visibleConfigEntries.length > 0
        const hasCharges = line.charges.length > 0
        const hasTerm = !!(line.startDate || line.termMonths || line.endDate)
        const hasArcDiff = !!line.arcSource
        const mirroredFromItemId = (line.configuration?._arcMirroredFromItemId as string | undefined) ?? null
        const isEmpty = !hasConfig && !hasCharges && !hasTerm && !hasArcDiff

        return (
          <div
            className="border-t bg-muted/10 px-12 py-3 space-y-3"
            style={paddingLeft ? { paddingLeft: `calc(${paddingLeft} + 2rem)` } : undefined}
          >
            {hasArcDiff && (
              <ArcLineDiff line={line} currency={currency} />
            )}
            {isEmpty ? (
              <div className="text-xs text-muted-foreground space-y-1">
                <div>
                  No detailed breakdown for this line.
                  {mirroredFromItemId && ' Mirrored from existing subscription item.'}
                </div>
                {(line.nrcTotal > 0 || line.mrcTotal > 0) && (
                  <div className="flex gap-4">
                    {line.nrcTotal > 0 && (
                      <span>NRC <span className="font-mono font-medium text-foreground">{fmt(line.nrcTotal, currency)}</span></span>
                    )}
                    {line.mrcTotal > 0 && (
                      <span>MRC <span className="font-mono font-medium text-foreground">{fmt(line.mrcTotal, currency)}</span></span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <>
                {hasConfig && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Configuration</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
                      {visibleConfigEntries.map(([key, value]) => (
                        <div key={key} className="text-xs">
                          <span className="text-muted-foreground">{key}: </span>
                          <span className="font-medium">{String(value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {hasCharges && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Charges</p>
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
                            <td className="py-1">{c.chargeName ?? '—'}</td>
                            <td className="py-1 uppercase">{c.chargeType ?? '—'}</td>
                            <td className="py-1 text-right font-mono">{c.unitPrice != null ? fmt(c.unitPrice, currency) : '—'}</td>
                            <td className="py-1 text-right font-mono">{c.quantity ?? '—'}</td>
                            <td className="py-1 text-right font-mono">{c.totalPrice != null ? fmt(c.totalPrice, currency) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {hasTerm && (
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    {line.startDate && <span>Start: {new Date(line.startDate).toLocaleDateString()}</span>}
                    {line.termMonths && <span>Term: {line.termMonths}mo</span>}
                    {line.endDate && <span>End: {new Date(line.endDate).toLocaleDateString()}</span>}
                  </div>
                )}
              </>
            )}
          </div>
        )
      })()}
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

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div className="rounded-md bg-red-50 border border-red-200 p-3 flex items-start gap-2">
      <span className="text-sm text-red-700 flex-1">{message}</span>
      {onDismiss && <button onClick={onDismiss} className="text-red-400 hover:text-red-600 text-sm font-bold">×</button>}
    </div>
  )
}

// XD-250 ARC: side-by-side "Before / After" snapshot for a quote / order line
// that mirrors an existing subscription item. "Before" comes from the live
// CpqInventorySubscriptionItem at render time; "After" is what the line will
// apply on activation. For 'cancel' lines the after column is greyed out.
function ArcLineDiff({ line, currency }: { line: OrderLineResult; currency: string }) {
  const src = line.arcSource
  if (!src) return null
  const isCancel = line.action === 'cancel'

  const beforeMrc = src.mrcAmount
  const beforeNrc = src.nrcAmount
  const beforeQty = src.quantity
  const afterMrc = isCancel ? 0 : line.mrcTotal
  const afterNrc = isCancel ? 0 : line.nrcTotal
  const afterQty = isCancel ? 0 : line.quantity
  const mrcDelta = afterMrc - beforeMrc
  const nrcDelta = afterNrc - beforeNrc
  const qtyDelta = afterQty - beforeQty

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1.5">Change Preview</p>
      <div className="rounded border bg-background overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr className="text-muted-foreground">
              <th className="text-left px-3 py-1.5 font-medium" />
              <th className="text-right px-3 py-1.5 font-medium">Before</th>
              <th className="text-right px-3 py-1.5 font-medium">After</th>
              <th className="text-right px-3 py-1.5 font-medium">Δ</th>
            </tr>
          </thead>
          <tbody>
            <ArcDiffRow label="Quantity" before={beforeQty} after={afterQty} delta={qtyDelta} currency={null} dimAfter={isCancel} />
            <ArcDiffRow label="MRC" before={beforeMrc} after={afterMrc} delta={mrcDelta} currency={currency} dimAfter={isCancel} />
            <ArcDiffRow label="NRC" before={beforeNrc} after={afterNrc} delta={nrcDelta} currency={currency} dimAfter={isCancel} />
          </tbody>
        </table>
      </div>
      {isCancel && (
        <p className="text-xs text-red-700 mt-1 italic">
          Cancellation — item will be terminated on activation.
        </p>
      )}
    </div>
  )
}

function ArcDiffRow({
  label,
  before,
  after,
  delta,
  currency,
  dimAfter,
}: {
  label: string
  before: number
  after: number
  delta: number
  currency: string | null
  dimAfter: boolean
}) {
  const fmtVal = (v: number) => (currency ? fmt(v, currency) : String(v))
  const showDelta = delta !== 0
  return (
    <tr className="border-t border-dashed border-border/40">
      <td className="px-3 py-1 text-muted-foreground">{label}</td>
      <td className="px-3 py-1 text-right font-mono">{fmtVal(before)}</td>
      <td className={`px-3 py-1 text-right font-mono ${dimAfter ? 'text-muted-foreground line-through' : ''}`}>
        {fmtVal(after)}
      </td>
      <td className={`px-3 py-1 text-right font-mono font-medium ${showDelta ? (delta > 0 ? 'text-green-700' : 'text-red-700') : 'text-muted-foreground'}`}>
        {showDelta ? `${delta > 0 ? '+' : ''}${fmtVal(delta)}` : '—'}
      </td>
    </tr>
  )
}
