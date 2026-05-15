"use client"
import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowRight, ExternalLink, Play, X } from 'lucide-react'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import {
  formatStatusLabel,
  orderCpqStatusMap,
  type OrderCpqStatus,
} from '../../../../components/statusMaps'
import { StatusPath } from '../../../../components/StatusPath'

// ─── Types ───────────────────────────────────────────────────────

type ArcLineSource = {
  subscriptionItemId: string
  name: string
  mrcAmount: number
  nrcAmount: number
  quantity: number
}

type TierBreakdownEntry = { tier: number; from: number; to: number; pricePerUnit: number; quantity: number; subtotal: number }
type RuleAdjustment = { ruleCode: string; ruleName: string; ruleType: string; value: number; unitPriceBefore: number; unitPriceAfter: number; delta: number }

type ResolvedCharge = {
  chargeName?: string
  chargeType?: string
  pricingMethod?: 'flat' | 'tiered' | 'per_unit'
  unitPrice?: number
  quantity?: number | null
  totalPrice?: number | null
  note?: string | null
  breakdown?: { tiers: TierBreakdownEntry[] } | null
  adjustments?: RuleAdjustment[] | null
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
  charges: ResolvedCharge[]
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

const ARC_BADGE_VARIANTS: Record<string, 'brand' | 'success' | 'error'> = {
  amend: 'brand',
  renew: 'success',
  cancel: 'error',
}

const RULE_TYPE_LABELS: Record<string, string> = {
  discount_percent: '% discount',
  discount_absolute: 'fixed discount',
  surcharge_percent: '% surcharge',
  surcharge_absolute: 'fixed surcharge',
  price_override: 'override',
}

function fmtRuleValue(adj: RuleAdjustment, currency?: string): string {
  if (adj.ruleType === 'discount_percent' || adj.ruleType === 'surcharge_percent') return `${adj.value}%`
  if (currency) return fmt(adj.value, currency)
  return String(adj.value)
}

// ─── Constants ───────────────────────────────────────────────────

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
  const [pricingDetail, setPricingDetail] = React.useState<{ lineIdx: number; chargeIdx: number } | null>(null)
  const [customerName, setCustomerName] = React.useState<string | null>(null)
  const [linkedSubscriptions, setLinkedSubscriptions] = React.useState<Array<{
    id: string
    name: string
    code: string
    status: string
  }>>([])

  // Find every subscription this order touches. NEW orders write
  // `sourceOrderId` on the freshly-created subscription, so a
  // `?sourceOrderId=…` filter is enough there. ARC orders (amend /
  // renew / cancel) mutate existing subscriptions in place — the
  // subscription's `sourceOrderId` stays pinned to the original
  // order, so we also resolve targets via the source quote.
  const fetchLinkedSubscriptions = React.useCallback(
    async (orderConfigId: string, sourceQuoteId: string | null) => {
      const byOrderId = fetch(
        `/api/cpq/inventory/subscriptions?sourceOrderId=${orderConfigId}&pageSize=10`,
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (d?.items ?? (Array.isArray(d) ? d : [])) as Array<{ id: string; name: string; code: string; status: string }>)
        .catch(() => [])

      const byTargets = sourceQuoteId
        ? fetch(`/api/cpq/quotes/${sourceQuoteId}/target-subscriptions`)
            .then((r) => (r.ok ? r.json() : null))
            .then(async (d) => {
              const targets: Array<{ subscriptionId: string }> = d?.items ?? []
              const fetched = await Promise.all(
                targets.map((t) =>
                  fetch(`/api/cpq/inventory/subscriptions?id=${t.subscriptionId}`)
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                ),
              )
              return fetched.filter(Boolean) as Array<{ id: string; name: string; code: string; status: string }>
            })
            .catch(() => [] as Array<{ id: string; name: string; code: string; status: string }>)
        : Promise.resolve([] as Array<{ id: string; name: string; code: string; status: string }>)

      const [a, b] = await Promise.all([byOrderId, byTargets])
      // Dedupe by id — a single subscription may appear in both lists
      // (e.g. a NEW order that was later amended into the same sub).
      const seen = new Set<string>()
      const merged: Array<{ id: string; name: string; code: string; status: string }> = []
      for (const sub of [...a, ...b]) {
        if (!sub || seen.has(sub.id)) continue
        seen.add(sub.id)
        merged.push({ id: sub.id, name: sub.name, code: sub.code, status: sub.status })
      }
      setLinkedSubscriptions(merged)
    },
    [],
  )

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
            void fetchLinkedSubscriptions(result.id, result.sourceQuoteId)
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
  }, [cpqOrderId, fetchLinkedSubscriptions])

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
      void fetchLinkedSubscriptions(result.id, result.sourceQuoteId)
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

  const togglePricingDetail = (lineIdx: number, chargeIdx: number) => {
    setPricingDetail((prev) =>
      prev?.lineIdx === lineIdx && prev?.chargeIdx === chargeIdx ? null : { lineIdx, chargeIdx },
    )
  }

  return (
    <div className="space-y-6">
      {/* Header — standard FormHeader detail mode, mirrors the CPQ quote
          layout so order ↔ quote stays consistent. Title is just the order
          number; status / ARC / converted tags sit underneath; primary
          actions (Activate, then Cancel) live on the right next to the
          View Sales Order / Source Quote utility links. */}
      <FormHeader
        mode="detail"
        backHref="/backend/cpq/orders"
        backLabel="Back to CPQ Orders"
        entityTypeLabel="CPQ Order"
        title={order.orderNumber || order.orderId.slice(0, 8)}
        statusBadge={
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Tag variant={orderCpqStatusMap[order.cpqStatus as OrderCpqStatus] ?? 'neutral'} dot>
              {formatStatusLabel(order.cpqStatus)}
            </Tag>
            {order.quoteType && order.quoteType !== 'new' && (
              <Tag variant={ARC_BADGE_VARIANTS[order.quoteType] ?? 'neutral'} className="uppercase">
                {order.quoteType}
              </Tag>
            )}
          </div>
        }
        actionsContent={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/backend/sales/orders/${order.orderId}`)}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View Sales Order
            </Button>
            {order.sourceQuoteId && (
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(`/backend/cpq/quotes/${order.sourceQuoteId}`)}
              >
                Source Quote
              </Button>
            )}
            {canActivate && (
              <Button type="button" onClick={activateOrder} disabled={activating}>
                {activating ? <Spinner /> : <Play className="h-4 w-4" />}
                Activate
              </Button>
            )}
            {canCancel && (
              <Button type="button" variant="destructive-outline" onClick={cancelOrder}>
                <X className="h-4 w-4" />
                Cancel
              </Button>
            )}
          </>
        }
      />

      {/* Status path — visual progress only. Orders advance via the
          dedicated Activate / Cancel buttons because activation has
          backend side effects (subscription / asset creation). */}
      <div className="flex items-center gap-3 flex-wrap">
        <StatusPath
          // Order path is read-only — activation has backend side effects
          // (subscription / asset creation) so transitions go through the
          // dedicated Activate / Cancel buttons.
          current={order.cpqStatus}
          path={['draft', 'pending_activation', 'active', 'fulfilled']}
          terminals={['cancelled']}
          statusMap={orderCpqStatusMap}
          ariaLabel="Order status path"
        />
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Linked subscriptions — one card per subscription this order
          touches. NEW orders write one fresh subscription; ARC orders
          (amend / renew / cancel) reach one or more existing
          subscriptions through the source quote's target list. */}
      {linkedSubscriptions.length > 0 && (
        <div className="space-y-2">
          {linkedSubscriptions.map((sub) => (
            <div
              key={sub.id}
              className="rounded-lg border bg-card p-4 flex items-center gap-4"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Linked Subscription
                  </span>
                  <Tag
                    variant={sub.status === 'active' ? 'success' : 'info'}
                    dot
                    className="text-[10px] px-1.5"
                  >
                    {sub.status}
                  </Tag>
                </div>
                <div className="text-sm font-medium">
                  {sub.name}{' '}
                  <span className="text-muted-foreground font-mono text-xs">({sub.code})</span>
                </div>
                {order.activatedAt && (
                  <div className="text-xs text-muted-foreground">
                    Activated on {new Date(order.activatedAt).toLocaleString()}
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(`/backend/cpq/inventory/subscriptions/${sub.id}`)}
              >
                <ArrowRight className="h-3.5 w-3.5" />
                Open
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Meta cards — secondary reference info, matches the quote layout. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <MetaCard label="Customer">
          {customerName ? (
            <span className="font-medium">{customerName}</span>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">
              {order.customerId.slice(0, 8)}…
            </span>
          )}
        </MetaCard>
        <MetaCard label="Created">
          <span className="font-medium">{new Date(order.createdAt).toLocaleDateString()}</span>
        </MetaCard>
        <MetaCard label="Currency">
          <span className="font-medium">{currency}</span>
        </MetaCard>
      </div>

      {/* Pricing Summary Card */}
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-medium mb-3">Pricing Summary</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Non-Recurring (NRC)</p>
            <p className="text-lg font-semibold font-mono">{fmt(order.pricingSummary.nrcTotal, currency)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Monthly Recurring (MRC)</p>
            <p className="text-lg font-semibold font-mono">{fmt(order.pricingSummary.mrcTotal, currency)}</p>
          </div>
        </div>
      </div>

      {/* Order Lines */}
      <OrderLineTree
        lines={order.lines}
        currency={currency}
        expandedLines={expandedLines}
        pricingDetail={pricingDetail}
        onToggleLine={toggleLine}
        onTogglePricingDetail={togglePricingDetail}
      />
    </div>
  )
}

function MetaCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────

function OrderLineTree({
  lines,
  currency,
  expandedLines,
  pricingDetail,
  onToggleLine,
  onTogglePricingDetail,
}: {
  lines: OrderLineResult[]
  currency: string
  expandedLines: Set<string>
  pricingDetail: { lineIdx: number; chargeIdx: number } | null
  onToggleLine: (id: string) => void
  onTogglePricingDetail: (lineIdx: number, chargeIdx: number) => void
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

  // Stable index per visible line so the pricing-detail toggle can be
  // keyed by (lineIdx, chargeIdx) the same way the quote page does.
  const indexOf = new Map<string, number>()
  lines.forEach((l, i) => indexOf.set(l.lineId, i))

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
            const lineIdx = indexOf.get(line.lineId) ?? 0
            return (
              <div key={line.lineId}>
                <OrderLineRow
                  line={line}
                  lineIdx={lineIdx}
                  currency={currency}
                  isExpanded={isExpanded}
                  isBundle={isBundle}
                  childCount={children.length}
                  indent={0}
                  pricingDetail={pricingDetail}
                  onToggle={() => onToggleLine(line.lineId)}
                  onTogglePricingDetail={onTogglePricingDetail}
                />
                {isBundle && isExpanded && children.length > 0 && (
                  <div className="border-t border-dashed border-brand-violet/30 bg-brand-violet/5">
                    <div className="px-6 py-1.5">
                      <span className="text-[10px] font-medium text-brand-violet uppercase tracking-wider">Bundle Components ({children.length})</span>
                    </div>
                    {children.map((child) => {
                      const childIdx = indexOf.get(child.lineId) ?? 0
                      return (
                        <OrderLineRow
                          key={child.lineId}
                          line={child}
                          lineIdx={childIdx}
                          currency={currency}
                          isExpanded={expandedLines.has(child.lineId)}
                          isBundle={false}
                          childCount={0}
                          indent={1}
                          pricingDetail={pricingDetail}
                          onToggle={() => onToggleLine(child.lineId)}
                          onTogglePricingDetail={onTogglePricingDetail}
                        />
                      )
                    })}
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

function OrderLineRow({ line, lineIdx, currency, isExpanded, isBundle, childCount, indent, pricingDetail, onToggle, onTogglePricingDetail }: {
  line: OrderLineResult; lineIdx: number; currency: string; isExpanded: boolean; isBundle: boolean; childCount: number; indent: number
  pricingDetail: { lineIdx: number; chargeIdx: number } | null
  onToggle: () => void
  onTogglePricingDetail: (lineIdx: number, chargeIdx: number) => void
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
              <Tag variant="brand" className="px-1.5 text-xs">bundle</Tag>
            )}
            <span className="font-medium text-sm">{line.offeringName}</span>
            {line.quantity > 1 && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">×{line.quantity}</span>}
            <Tag variant="info" className="px-1.5 text-xs">{line.action}</Tag>
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
                    <ChargeBreakdown
                      line={line}
                      lineIdx={lineIdx}
                      currency={currency}
                      pricingDetail={pricingDetail}
                      onTogglePricingDetail={onTogglePricingDetail}
                    />
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

// Charge breakdown table with the waterfall ("show pricing details")
// toggle. Same shape as the quote page so a charge looks identical on
// both surfaces, including tier-by-tier subtotals and any price-rule
// adjustments that fired during calculation.
function ChargeBreakdown({ line, lineIdx, currency, pricingDetail, onTogglePricingDetail }: {
  line: OrderLineResult; lineIdx: number; currency: string
  pricingDetail: { lineIdx: number; chargeIdx: number } | null
  onTogglePricingDetail: (lineIdx: number, chargeIdx: number) => void
}) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted-foreground">
          <th className="text-left py-1 font-medium">Charge</th>
          <th className="text-left py-1 font-medium">Type</th>
          <th className="text-right py-1 font-medium">Unit Price</th>
          <th className="text-right py-1 font-medium">Qty</th>
          <th className="text-right py-1 font-medium">Total</th>
          <th className="w-8" />
        </tr>
      </thead>
      <tbody>
        {line.charges.map((c, i) => {
          const hasDetail = !!(c.breakdown?.tiers?.length || c.adjustments?.length)
          const isDetailOpen = pricingDetail?.lineIdx === lineIdx && pricingDetail?.chargeIdx === i
          return (
            <React.Fragment key={i}>
              <tr className="border-t border-dashed border-border/50">
                <td className="py-1">{c.chargeName ?? '—'}</td>
                <td className="py-1 uppercase">{c.chargeType ?? '—'}</td>
                <td className="py-1 text-right font-mono">{c.unitPrice != null ? fmt(c.unitPrice, currency) : '—'}</td>
                <td className="py-1 text-right font-mono">{c.quantity ?? '—'}</td>
                <td className="py-1 text-right font-mono">{c.totalPrice != null ? fmt(c.totalPrice, currency) : c.note ?? '—'}</td>
                <td className="py-1 text-center">
                  {hasDetail && (
                    <button
                      onClick={() => onTogglePricingDetail(lineIdx, i)}
                      className="inline-flex items-center justify-center rounded p-0.5 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                      title="Show pricing breakdown"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                      </svg>
                    </button>
                  )}
                </td>
              </tr>
              {isDetailOpen && (
                <tr>
                  <td colSpan={6} className="pb-3 pt-1">
                    <div className="rounded border bg-background p-3 space-y-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm">Pricing Details — {c.chargeName}</span>
                        <span className="text-muted-foreground">{c.pricingMethod ?? 'flat'}</span>
                      </div>

                      {c.breakdown?.tiers && c.breakdown.tiers.length > 0 && (
                        <div>
                          <div className="font-medium text-muted-foreground mb-1">Tier Breakdown</div>
                          <table className="w-full">
                            <thead>
                              <tr className="text-muted-foreground">
                                <th className="text-left py-0.5 font-medium">Tier</th>
                                <th className="text-right py-0.5 font-medium">Range</th>
                                <th className="text-right py-0.5 font-medium">Price/Unit</th>
                                <th className="text-right py-0.5 font-medium">Qty</th>
                                <th className="text-right py-0.5 font-medium">Subtotal</th>
                              </tr>
                            </thead>
                            <tbody>
                              {c.breakdown.tiers.map((t) => (
                                <tr key={t.tier} className="border-t border-border/30">
                                  <td className="py-0.5">{t.tier}</td>
                                  <td className="py-0.5 text-right font-mono">{t.from}–{t.to}</td>
                                  <td className="py-0.5 text-right font-mono">{fmt(t.pricePerUnit, currency)}</td>
                                  <td className="py-0.5 text-right font-mono">{t.quantity}</td>
                                  <td className="py-0.5 text-right font-mono">{fmt(t.subtotal, currency)}</td>
                                </tr>
                              ))}
                              <tr className="border-t font-medium">
                                <td colSpan={4} className="py-0.5 text-right">Tiered Total</td>
                                <td className="py-0.5 text-right font-mono">
                                  {fmt(c.breakdown.tiers.reduce((s, t) => s + t.subtotal, 0), currency)}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      )}

                      {c.adjustments && c.adjustments.length > 0 && (
                        <div>
                          <div className="font-medium text-muted-foreground mb-1">Applied Price Rules</div>
                          <table className="w-full">
                            <thead>
                              <tr className="text-muted-foreground">
                                <th className="text-left py-0.5 font-medium">Rule</th>
                                <th className="text-left py-0.5 font-medium">Type</th>
                                <th className="text-right py-0.5 font-medium">Value</th>
                                <th className="text-right py-0.5 font-medium">Before</th>
                                <th className="text-right py-0.5 font-medium">After</th>
                                <th className="text-right py-0.5 font-medium">Delta</th>
                              </tr>
                            </thead>
                            <tbody>
                              {c.adjustments.map((adj, ai) => (
                                <tr key={ai} className="border-t border-border/30">
                                  <td className="py-0.5">{adj.ruleName}</td>
                                  <td className="py-0.5">{RULE_TYPE_LABELS[adj.ruleType] ?? adj.ruleType}</td>
                                  <td className="py-0.5 text-right font-mono">{fmtRuleValue(adj, currency)}</td>
                                  <td className="py-0.5 text-right font-mono">{fmt(adj.unitPriceBefore, currency)}</td>
                                  <td className="py-0.5 text-right font-mono">{fmt(adj.unitPriceAfter, currency)}</td>
                                  <td className={`py-0.5 text-right font-mono ${adj.delta < 0 ? 'text-destructive' : adj.delta > 0 ? 'text-status-success-text' : ''}`}>
                                    {adj.delta > 0 ? '+' : ''}{fmt(adj.delta, currency)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-1 border-t text-sm font-semibold">
                        <span>Final Total</span>
                        <span className="font-mono">{c.totalPrice != null ? fmt(c.totalPrice, currency) : '—'}</span>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          )
        })}
      </tbody>
    </table>
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
    <Alert variant="destructive" className="flex items-start gap-2">
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-destructive/70 hover:text-destructive text-sm font-bold"
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </Alert>
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
        <p className="text-xs text-destructive mt-1 italic">
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
      <td className={`px-3 py-1 text-right font-mono font-medium ${showDelta ? (delta > 0 ? 'text-status-success-text' : 'text-destructive') : 'text-muted-foreground'}`}>
        {showDelta ? `${delta > 0 ? '+' : ''}${fmtVal(delta)}` : '—'}
      </td>
    </tr>
  )
}
