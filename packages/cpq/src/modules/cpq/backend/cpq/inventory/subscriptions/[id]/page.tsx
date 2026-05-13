"use client"
import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  formatStatusLabel,
  subscriptionStatusMap,
  type SubscriptionStatus,
} from '../../../../../components/statusMaps'

// XD-250 — ARC integration on subscription detail.
//   • header buttons (Amend / Renew / Cancel) call /from-subscription
//     and redirect to the new ARC quote
//   • "Change History" section reads /change-log

type SnapshotItem = {
  id: string
  name?: string
  mrcAmount?: number | string
  nrcAmount?: number | string
  quantity?: number
  status?: string
}

type SubscriptionSnapshot = {
  id?: string
  currencyCode?: string
  items?: SnapshotItem[]
} | null

type LineChangeEntry = {
  action: 'add' | 'modify' | 'cancel'
  itemId?: string
  quoteLineId?: string | null
  mrcDelta?: number
  mrcAmount?: number
  nrcAmount?: number
  quantity?: number
}

type ChangeLogRow = {
  id: string
  changeType: string
  sourceQuoteId: string | null
  sourceOrderId: string | null
  performedByUserId: string | null
  effectiveAt: string
  createdAt: string
  reasonCode: string | null
  reasonText: string | null
  etfAmount: string | null
  etfCurrency: string | null
  termChange: Record<string, unknown> | null
  lineChanges: LineChangeEntry[] | null
  beforeSnapshot: SubscriptionSnapshot
  afterSnapshot: SubscriptionSnapshot
  mergedIntoSubscriptionId: string | null
  mergedFromSubscriptionIds: string[] | null
}

const CHANGE_TYPE_LABELS: Record<string, string> = {
  amend: 'Amended',
  renew: 'Renewed',
  cancel: 'Cancelled',
  'merge-result': 'Created from merging contracts',
  'merge-source': 'Merged into a new contract',
}

const CHANGE_TYPE_COLORS: Record<string, string> = {
  amend: 'bg-blue-100 text-blue-800',
  renew: 'bg-green-100 text-green-800',
  cancel: 'bg-red-100 text-red-800',
  'merge-result': 'bg-purple-100 text-purple-800',
  'merge-source': 'bg-orange-100 text-orange-800',
}

type SubscriptionItem = {
  id: string
  subscriptionId: string
  parentItemId: string | null
  productId: string | null
  offeringId: string | null
  specId: string | null
  name: string
  status: string
  configuration: Record<string, unknown>
  charges: Array<Record<string, unknown>> | null
  mrcAmount: number
  nrcAmount: number
  currencyCode: string
  quantity: number
  capacityTotal: string | null
  capacityUsed: string | null
  capacityUnit: string | null
  sourceQuoteLineId: string | null
  metadata: Record<string, unknown> | null
  sortOrder: number
  createdAt: string
  updatedAt: string
  children?: SubscriptionItem[]
}

type LinkedAsset = {
  id: string
  code: string
  name: string
  status: string
  assetType: string
  currencyCode: string
  purchasePrice: number
  quantity: number
  subscriptionItemId: string | null
  createdAt: string
}

type SubscriptionDetail = {
  id: string
  customerId: string
  code: string
  name: string
  description: string | null
  status: string
  billingCycle: string
  currencyCode: string
  mrcAmount: number
  nrcAmount: number
  startDate: string | null
  currentTermEnd: string | null
  termMonths: number | null
  autoRenew: boolean
  activatedAt: string | null
  suspendedAt: string | null
  terminatedAt: string | null
  pricingSummary: Record<string, unknown> | null
  sourceQuoteId: string | null
  sourceOrderId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  items: SubscriptionItem[]
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending: ['active', 'terminated'],
  active: ['suspended', 'terminated', 'expired'],
  suspended: ['active', 'terminated'],
  terminated: [],
  expired: [],
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  active: 'Active',
  suspended: 'Suspended',
  terminated: 'Terminated',
  expired: 'Expired',
}

function fmt(amount: number | string, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount))
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Tag variant={subscriptionStatusMap[status as SubscriptionStatus] ?? 'neutral'} dot>
      {formatStatusLabel(status)}
    </Tag>
  )
}

export default function SubscriptionDetailPage(props: { params?: { id?: string } }) {
  const router = useRouter()
  const urlParams = useParams()
  const subId = (props.params?.id ?? urlParams?.id) as string

  const [sub, setSub] = React.useState<SubscriptionDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [customerName, setCustomerName] = React.useState<string | null>(null)
  const [assets, setAssets] = React.useState<LinkedAsset[]>([])
  const [expandedItems, setExpandedItems] = React.useState<Set<string>>(new Set())
  const [showStatusMenu, setShowStatusMenu] = React.useState(false)
  const [transitioning, setTransitioning] = React.useState(false)
  const statusMenuRef = React.useRef<HTMLDivElement>(null)
  // XD-250 ARC state
  const [arcInFlight, setArcInFlight] = React.useState<'amend' | 'renew' | 'cancel' | null>(null)
  const [changeLog, setChangeLog] = React.useState<ChangeLogRow[]>([])
  const [changeLogLoading, setChangeLogLoading] = React.useState(false)

  const startArcQuote = React.useCallback(
    async (type: 'amend' | 'renew' | 'cancel') => {
      if (!sub) return
      setArcInFlight(type)
      try {
        const res = await fetch('/api/cpq/quotes/from-subscription', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ subscriptionId: sub.id, type }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string; existingQuoteId?: string }
          // XD-250 spec § UI: when the subscription already has a non-terminal
          // ARC quote attached, the server returns 409 with `existingQuoteId`.
          // Offer to navigate to that quote instead of showing a dead alert.
          if (body.existingQuoteId) {
            const ok = window.confirm(
              `${body.error ?? 'Subscription has another ARC quote in progress.'}\n\n` +
                `Open the existing quote now?`,
            )
            if (ok) {
              router.push(`/backend/cpq/quotes/${body.existingQuoteId}`)
            }
            return
          }
          alert(`Failed to start ${type} quote: ${body.error ?? res.statusText}`)
          return
        }
        const data = await res.json()
        router.push(`/backend/cpq/quotes/${data.quoteId}`)
      } finally {
        setArcInFlight(null)
      }
    },
    [router, sub],
  )

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) setShowStatusMenu(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const transitionStatus = async (targetStatus: string) => {
    if (!sub) return
    try {
      setTransitioning(true)
      setError(null)
      setShowStatusMenu(false)
      const res = await fetch('/api/cpq/inventory/subscriptions/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sub.id, targetStatus }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Status transition failed')
      setSub((prev) => prev ? { ...prev, ...data } : prev)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setTransitioning(false)
    }
  }

  React.useEffect(() => {
    let cancelled = false
    async function loadLog() {
      setChangeLogLoading(true)
      try {
        const r = await fetch(`/api/cpq/inventory/subscriptions/${subId}/change-log?pageSize=50`)
        if (r.ok && !cancelled) {
          const data = await r.json()
          setChangeLog(data.items ?? [])
        }
      } finally {
        if (!cancelled) setChangeLogLoading(false)
      }
    }
    if (subId) void loadLog()
    return () => { cancelled = true }
  }, [subId])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/cpq/inventory/subscriptions?id=${subId}`)
        if (!res.ok) throw new Error('Subscription not found')
        const data = await res.json()
        if (!cancelled) {
          setSub(data)
          fetch(`/api/customers/companies?id=${data.customerId}&pageSize=1`)
            .then((r) => r.json())
            .then((result) => {
              const items = result.items ?? result ?? []
              const c = items[0]
              if (c && !cancelled) setCustomerName(c.display_name || c.displayName || c.name || null)
            })
            .catch(() => {})
          fetch(`/api/cpq/inventory/assets?subscriptionId=${subId}&pageSize=50`)
            .then((r) => r.json())
            .then((result) => {
              if (!cancelled) setAssets(result.items ?? [])
            })
            .catch(() => {})
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [subId])

  const toggleItem = (id: string) => {
    setExpandedItems((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 justify-center text-sm text-muted-foreground">
        <Spinner /> Loading…
      </div>
    )
  }

  if (!sub) {
    return (
      <div className="space-y-4">
        <button onClick={() => router.push('/backend/cpq/inventory')} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
        {error && <ErrorBanner message={error} />}
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">Subscription not found.</div>
      </div>
    )
  }

  const currency = sub.currencyCode || 'USD'
  const flatItems = flattenItems(sub.items)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/backend/cpq/inventory')} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
          <h1 className="text-2xl font-bold">{sub.name}</h1>
          <div className="relative" ref={statusMenuRef}>
            <button
              onClick={() => {
                const transitions = ALLOWED_TRANSITIONS[sub.status] ?? []
                if (transitions.length > 0) setShowStatusMenu((v) => !v)
              }}
              disabled={transitioning}
              className={`inline-flex items-center gap-1 disabled:opacity-50 ${(ALLOWED_TRANSITIONS[sub.status] ?? []).length > 0 ? 'cursor-pointer hover:ring-2 hover:ring-primary/30 rounded-full' : ''}`}
            >
              {transitioning && <Spinner />}
              <Tag variant={subscriptionStatusMap[sub.status as SubscriptionStatus] ?? 'neutral'} dot>
                {STATUS_LABELS[sub.status] ?? formatStatusLabel(sub.status)}
                {(ALLOWED_TRANSITIONS[sub.status] ?? []).length > 0 && (
                  <svg className={`h-3 w-3 transition-transform ${showStatusMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                )}
              </Tag>
            </button>
            {showStatusMenu && (
              <div className="absolute left-0 top-full mt-1 z-50 min-w-[180px] rounded-md border bg-card shadow-lg py-1">
                <p className="px-3 py-1.5 text-xs text-muted-foreground font-medium">Transition to:</p>
                {(ALLOWED_TRANSITIONS[sub.status] ?? []).map((status) => (
                  <button
                    key={status}
                    onClick={() => transitionStatus(status)}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
                  >
                    <Tag variant={subscriptionStatusMap[status as SubscriptionStatus] ?? 'neutral'} dot>
                      {STATUS_LABELS[status] ?? formatStatusLabel(status)}
                    </Tag>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="text-xs text-muted-foreground font-mono">{sub.code}</span>
        </div>
        {/* XD-250 ARC actions */}
        {(sub.status === 'active' || sub.status === 'suspended') && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={arcInFlight !== null}
              onClick={() => startArcQuote('amend')}
            >
              Amend
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={arcInFlight !== null}
              onClick={() => startArcQuote('renew')}
            >
              Renew
            </Button>
            <Button
              type="button"
              variant="destructive-outline"
              disabled={arcInFlight !== null}
              onClick={() => startArcQuote('cancel')}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Detail Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h3 className="text-sm font-medium">Subscription Details</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Field label="Status" value={sub.status} />
            <Field label="Billing Cycle" value={sub.billingCycle} />
            <Field label="Currency" value={currency} />
            <Field label="Auto-Renew" value={sub.autoRenew ? 'Yes' : 'No'} />
            {sub.termMonths != null && <Field label="Term" value={`${sub.termMonths} months`} />}
            {sub.startDate && <Field label="Start Date" value={new Date(sub.startDate).toLocaleDateString()} />}
            {sub.currentTermEnd && <Field label="Term End" value={new Date(sub.currentTermEnd).toLocaleDateString()} />}
            {sub.activatedAt && <Field label="Activated" value={new Date(sub.activatedAt).toLocaleString()} />}
            {sub.suspendedAt && <Field label="Suspended" value={new Date(sub.suspendedAt).toLocaleString()} />}
            {sub.terminatedAt && <Field label="Terminated" value={new Date(sub.terminatedAt).toLocaleString()} />}
          </div>
          {sub.description && (
            <div className="pt-1">
              <p className="text-xs text-muted-foreground">Description</p>
              <p className="text-sm">{sub.description}</p>
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h3 className="text-sm font-medium">Pricing & References</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Monthly Recurring (MRC)</p>
              <p className="text-lg font-semibold font-mono">{fmt(sub.mrcAmount, currency)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Non-Recurring (NRC)</p>
              <p className="text-lg font-semibold font-mono">{fmt(sub.nrcAmount, currency)}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-1">
            <Field label="Customer" value={customerName ?? sub.customerId.slice(0, 12) + '…'} />
            <Field label="Created" value={new Date(sub.createdAt).toLocaleString()} />
            {sub.sourceQuoteId && (
              <div>
                <p className="text-xs text-muted-foreground">Source Quote</p>
                <button onClick={() => router.push(`/backend/cpq/quotes/${sub.sourceQuoteId}`)} className="text-sm text-primary hover:underline">{sub.sourceQuoteId.slice(0, 8)}…</button>
              </div>
            )}
            {sub.sourceOrderId && (
              <div>
                <p className="text-xs text-muted-foreground">Source Order</p>
                <button onClick={() => router.push(`/backend/cpq/orders/${sub.sourceOrderId}`)} className="text-sm text-primary hover:underline">{sub.sourceOrderId.slice(0, 8)}…</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Metadata */}
      {sub.metadata && Object.keys(sub.metadata).length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-medium mb-2">Metadata</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
            {Object.entries(sub.metadata).map(([key, value]) => (
              <div key={key} className="text-xs">
                <span className="text-muted-foreground">{key}: </span>
                <span className="font-medium">{String(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subscription Items */}
      <div>
        <h3 className="text-sm font-medium mb-2 px-1">Subscription Items ({flatItems.length})</h3>
        {flatItems.length === 0 ? (
          <div className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">No items.</div>
        ) : (
          <div className="rounded-lg border bg-card divide-y">
            {flatItems.map((item) => {
              const isExpanded = expandedItems.has(item.id)
              const indent = item._depth ?? 0
              return (
                <div key={item.id}>
                  <div
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer"
                    style={{ paddingLeft: `${16 + indent * 24}px` }}
                    onClick={() => toggleItem(item.id)}
                  >
                    <button className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground">
                      <svg className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{item.name}</span>
                        {item.quantity > 1 && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">x{item.quantity}</span>}
                        <StatusBadge status={item.status} />
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs space-y-0.5">
                      {Number(item.mrcAmount) > 0 && <div><span className="text-muted-foreground">MRC </span><span className="font-mono font-medium">{fmt(item.mrcAmount, item.currencyCode || currency)}</span></div>}
                      {Number(item.nrcAmount) > 0 && <div><span className="text-muted-foreground">NRC </span><span className="font-mono font-medium">{fmt(item.nrcAmount, item.currencyCode || currency)}</span></div>}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t bg-muted/10 px-12 py-3 space-y-3" style={{ paddingLeft: `${40 + indent * 24}px` }}>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
                        {item.productId && <Field label="Product ID" value={item.productId.slice(0, 12) + '…'} mono />}
                        {item.offeringId && <Field label="Offering ID" value={item.offeringId.slice(0, 12) + '…'} mono />}
                        {item.specId && <Field label="Spec ID" value={item.specId.slice(0, 12) + '…'} mono />}
                        <Field label="Currency" value={item.currencyCode || currency} />
                        <Field label="Quantity" value={String(item.quantity)} />
                        {item.capacityTotal && <Field label="Capacity" value={`${item.capacityUsed ?? '0'} / ${item.capacityTotal} ${item.capacityUnit ?? ''}`} />}
                      </div>

                      {item.configuration && Object.keys(item.configuration).length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Configuration</p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
                            {Object.entries(item.configuration).map(([key, value]) => (
                              <div key={key} className="text-xs">
                                <span className="text-muted-foreground">{key}: </span>
                                <span className="font-medium">{String(value)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {item.charges && item.charges.length > 0 && (
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
                              {item.charges.map((c, i) => (
                                <tr key={i} className="border-t border-dashed border-border/50">
                                  <td className="py-1">{(c as any).chargeName ?? '—'}</td>
                                  <td className="py-1 uppercase">{(c as any).chargeType ?? '—'}</td>
                                  <td className="py-1 text-right font-mono">{(c as any).unitPrice != null ? fmt((c as any).unitPrice, currency) : '—'}</td>
                                  <td className="py-1 text-right font-mono">{(c as any).quantity ?? '—'}</td>
                                  <td className="py-1 text-right font-mono">{(c as any).totalPrice != null ? fmt((c as any).totalPrice, currency) : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {item.metadata && Object.keys(item.metadata).length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Metadata</p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
                            {Object.entries(item.metadata).map(([key, value]) => (
                              <div key={key} className="text-xs">
                                <span className="text-muted-foreground">{key}: </span>
                                <span className="font-medium">{String(value)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex gap-4 text-xs text-muted-foreground">
                        <span>Created: {new Date(item.createdAt).toLocaleString()}</span>
                        <span>Updated: {new Date(item.updatedAt).toLocaleString()}</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* XD-250 Change History */}
      <div>
        <h3 className="text-sm font-medium mb-2 px-1">Change History ({changeLog.length})</h3>
        {changeLogLoading ? (
          <div className="rounded-lg border bg-card py-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : changeLog.length === 0 ? (
          <div className="rounded-lg border bg-card py-6 text-center text-sm text-muted-foreground">No ARC changes yet.</div>
        ) : (
          <div className="rounded-lg border bg-card divide-y">
            {changeLog.map((row) => (
              <div key={row.id} className="px-4 py-3 space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      CHANGE_TYPE_COLORS[row.changeType] ?? 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {CHANGE_TYPE_LABELS[row.changeType] ?? row.changeType}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(row.effectiveAt).toLocaleString()}
                  </span>
                  {row.sourceQuoteId && (
                    <button
                      onClick={() => router.push(`/backend/cpq/quotes/${row.sourceQuoteId}`)}
                      className="text-xs text-primary hover:underline"
                    >
                      Quote {row.sourceQuoteId.slice(0, 8)}…
                    </button>
                  )}
                  {row.sourceOrderId && (
                    <button
                      onClick={() => router.push(`/backend/cpq/orders/${row.sourceOrderId}`)}
                      className="text-xs text-primary hover:underline"
                    >
                      Order {row.sourceOrderId.slice(0, 8)}…
                    </button>
                  )}
                </div>
                <ChangeLogLineDetails row={row} currency={currency} />
                {row.termChange && (
                  <div className="text-xs text-muted-foreground">
                    Term: {String(row.termChange.oldTermEnd ?? '—')} → {String(row.termChange.newTermEnd ?? '—')}
                  </div>
                )}
                {row.reasonCode && (
                  <div className="text-xs text-muted-foreground">
                    Reason: {row.reasonCode}{row.reasonText ? ` — ${row.reasonText}` : ''}
                  </div>
                )}
                {row.etfAmount && (
                  <div className="text-xs text-muted-foreground">
                    ETF: {row.etfAmount} {row.etfCurrency ?? ''}
                  </div>
                )}
                {row.mergedIntoSubscriptionId && (
                  <div className="text-xs text-muted-foreground">
                    Merged into{' '}
                    <button
                      onClick={() =>
                        router.push(`/backend/cpq/inventory/subscriptions/${row.mergedIntoSubscriptionId}`)
                      }
                      className="text-primary hover:underline"
                    >
                      subscription {row.mergedIntoSubscriptionId.slice(0, 8)}…
                    </button>
                  </div>
                )}
                {row.mergedFromSubscriptionIds && row.mergedFromSubscriptionIds.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Merged from {row.mergedFromSubscriptionIds.length} subscriptions
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Linked Assets */}
      <div>
        <h3 className="text-sm font-medium mb-2 px-1">Linked Assets ({assets.length})</h3>
        {assets.length === 0 ? (
          <div className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">No assets linked to this subscription.</div>
        ) : (
          <div className="rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Code</th>
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Type</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Price</th>
                  <th className="px-4 py-3 text-right font-medium">Qty</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id} onClick={() => router.push(`/backend/cpq/inventory/assets/${a.id}`)} className="border-b cursor-pointer hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground">{a.code}</td>
                    <td className="px-4 py-3 font-medium text-primary">{a.name}</td>
                    <td className="px-4 py-3">{a.assetType.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(a.purchasePrice, a.currencyCode || currency)}</td>
                    <td className="px-4 py-3 text-right font-mono">{a.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

type FlatItem = SubscriptionItem & { _depth: number }

function flattenItems(items: SubscriptionItem[], depth = 0): FlatItem[] {
  const result: FlatItem[] = []
  for (const item of items) {
    result.push({ ...item, _depth: depth })
    if (item.children && item.children.length > 0) {
      result.push(...flattenItems(item.children, depth + 1))
    }
  }
  return result
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm ${mono ? 'font-mono' : ''}`}>{value}</p>
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

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md bg-red-50 border border-red-200 p-3 flex items-start gap-2">
      <span className="text-sm text-red-700 flex-1">{message}</span>
    </div>
  )
}

// XD-250 — render the per-line summary of an ARC change, with inline product
// names and before/after MRC values. Falls back gracefully when snapshots are
// missing (older log rows) or when lineChanges is null (cancel / merge).
function ChangeLogLineDetails({ row, currency }: { row: ChangeLogRow; currency: string }) {
  const beforeItems = new Map<string, SnapshotItem>(
    (row.beforeSnapshot?.items ?? []).map((it) => [it.id, it]),
  )
  const afterItems = new Map<string, SnapshotItem>(
    (row.afterSnapshot?.items ?? []).map((it) => [it.id, it]),
  )

  type DerivedChange = {
    key: string
    action: 'add' | 'modify' | 'cancel'
    name: string
    beforeMrc: number | null
    afterMrc: number | null
    delta: number | null
  }

  const derived: DerivedChange[] = []

  if (row.lineChanges && row.lineChanges.length > 0) {
    for (let i = 0; i < row.lineChanges.length; i++) {
      const lc = row.lineChanges[i]
      const itemId = lc.itemId ?? ''
      const before = beforeItems.get(itemId)
      const after = afterItems.get(itemId)
      const item = after ?? before
      const beforeMrc = before ? Number(before.mrcAmount ?? 0) : null
      const afterMrc = after ? Number(after.mrcAmount ?? 0) : null
      const explicitDelta = lc.mrcDelta != null ? Number(lc.mrcDelta) : null
      const computedDelta =
        beforeMrc != null && afterMrc != null ? afterMrc - beforeMrc : null
      derived.push({
        key: `${itemId}-${i}`,
        action: lc.action,
        name: item?.name ?? (lc.action === 'add' ? 'New item' : 'Item'),
        beforeMrc,
        afterMrc:
          lc.action === 'add' && afterMrc == null && lc.mrcAmount != null
            ? Number(lc.mrcAmount)
            : afterMrc,
        delta: explicitDelta ?? computedDelta,
      })
    }
  } else if (row.changeType === 'cancel' && row.beforeSnapshot?.items) {
    // applyCancel writes lineChanges=null; surface the items that got terminated.
    for (const it of row.beforeSnapshot.items) {
      const mrc = Number(it.mrcAmount ?? 0)
      derived.push({
        key: it.id,
        action: 'cancel',
        name: it.name ?? 'Item',
        beforeMrc: mrc,
        afterMrc: 0,
        delta: -mrc,
      })
    }
  } else if (row.changeType === 'merge-result' && row.afterSnapshot?.items) {
    for (const it of row.afterSnapshot.items) {
      const mrc = Number(it.mrcAmount ?? 0)
      derived.push({
        key: it.id,
        action: 'add',
        name: it.name ?? 'Item',
        beforeMrc: null,
        afterMrc: mrc,
        delta: null,
      })
    }
  } else if (row.changeType === 'merge-source' && row.beforeSnapshot?.items) {
    for (const it of row.beforeSnapshot.items) {
      const mrc = Number(it.mrcAmount ?? 0)
      derived.push({
        key: it.id,
        action: 'cancel',
        name: it.name ?? 'Item',
        beforeMrc: mrc,
        afterMrc: 0,
        delta: -mrc,
      })
    }
  }

  if (derived.length === 0) {
    // Amend / renew without any actual line edits — service writes lineChanges=[]
    // because line 1641 of cpqInventoryService.applyLineChanges only records modify
    // entries with a real delta. Show an explicit note so the operator knows
    // the activation happened but nothing on items moved.
    if (row.changeType === 'amend' || row.changeType === 'renew') {
      return (
        <div className="mt-1.5 text-xs text-muted-foreground italic">
          No item-level changes recorded.
        </div>
      )
    }
    return null
  }

  return (
    <div className="mt-1.5 rounded border bg-muted/20 px-3 py-2 space-y-1">
      {derived.map((d) => (
        <ChangeLogLineRow key={d.key} change={d} currency={currency} />
      ))}
    </div>
  )
}

const ACTION_GLYPH: Record<'add' | 'modify' | 'cancel', { sign: string; color: string; label: string }> = {
  add: { sign: '+', color: 'text-green-700', label: 'added' },
  modify: { sign: '~', color: 'text-blue-700', label: 'modified' },
  cancel: { sign: '−', color: 'text-red-700', label: 'removed' },
}

function ChangeLogLineRow({
  change,
  currency,
}: {
  change: {
    action: 'add' | 'modify' | 'cancel'
    name: string
    beforeMrc: number | null
    afterMrc: number | null
    delta: number | null
  }
  currency: string
}) {
  const glyph = ACTION_GLYPH[change.action]
  const showPriceChange =
    change.action === 'modify' &&
    change.beforeMrc != null &&
    change.afterMrc != null &&
    change.beforeMrc !== change.afterMrc
  const showSinglePrice =
    !showPriceChange &&
    ((change.action === 'add' && change.afterMrc != null && change.afterMrc > 0) ||
      (change.action === 'cancel' && change.beforeMrc != null && change.beforeMrc > 0))
  const showDelta = change.delta != null && change.delta !== 0
  const isNoopModify =
    change.action === 'modify' && !showPriceChange && !showDelta

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      <span className={`font-bold w-3 text-center ${glyph.color}`} title={glyph.label}>
        {glyph.sign}
      </span>
      <span className="font-medium text-foreground">{change.name}</span>
      {showPriceChange && (
        <span className="font-mono text-muted-foreground">
          {fmt(change.beforeMrc!, currency)} → {fmt(change.afterMrc!, currency)}/mo
        </span>
      )}
      {showSinglePrice && change.action === 'add' && (
        <span className="font-mono text-muted-foreground">
          {fmt(change.afterMrc!, currency)}/mo
        </span>
      )}
      {showSinglePrice && change.action === 'cancel' && (
        <span className="font-mono text-muted-foreground">
          was {fmt(change.beforeMrc!, currency)}/mo
        </span>
      )}
      {showDelta && (
        <span
          className={`font-mono font-medium ${change.delta! > 0 ? 'text-green-700' : 'text-red-700'}`}
        >
          ({change.delta! > 0 ? '+' : ''}
          {fmt(change.delta!, currency)}/mo)
        </span>
      )}
      {isNoopModify && (
        <span className="text-muted-foreground italic">no price change</span>
      )}
    </div>
  )
}
