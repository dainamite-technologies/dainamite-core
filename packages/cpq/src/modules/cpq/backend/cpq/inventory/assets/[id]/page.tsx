"use client"
import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  assetStatusMap,
  formatStatusLabel,
  type AssetStatus,
} from '../../../../../components/statusMaps'

type AssetDetail = {
  id: string
  customerId: string
  subscriptionId: string | null
  subscriptionItemId: string | null
  productId: string | null
  offeringId: string | null
  specId: string | null
  code: string
  name: string
  description: string | null
  status: string
  assetType: string
  currencyCode: string
  purchasePrice: number
  quantity: number
  purchaseDate: string | null
  deliveryDate: string | null
  configuration: Record<string, unknown>
  charges: Array<Record<string, unknown>> | null
  sourceQuoteId: string | null
  sourceOrderId: string | null
  sourceQuoteLineId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending: ['delivered', 'active', 'cancelled'],
  delivered: ['active', 'returned'],
  active: ['returned'],
  returned: [],
  cancelled: [],
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  delivered: 'Delivered',
  active: 'Active',
  returned: 'Returned',
  cancelled: 'Cancelled',
}

function fmt(amount: number | string, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount))
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Tag variant={assetStatusMap[status as AssetStatus] ?? 'neutral'} dot>
      {formatStatusLabel(status)}
    </Tag>
  )
}

export default function AssetDetailPage(props: { params?: { id?: string } }) {
  const router = useRouter()
  const urlParams = useParams()
  const assetId = (props.params?.id ?? urlParams?.id) as string

  const [asset, setAsset] = React.useState<AssetDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [customerName, setCustomerName] = React.useState<string | null>(null)
  const [subscriptionName, setSubscriptionName] = React.useState<string | null>(null)
  const [showStatusMenu, setShowStatusMenu] = React.useState(false)
  const [transitioning, setTransitioning] = React.useState(false)
  const statusMenuRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) setShowStatusMenu(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const transitionStatus = async (targetStatus: string) => {
    if (!asset) return
    try {
      setTransitioning(true)
      setError(null)
      setShowStatusMenu(false)
      const res = await fetch('/api/cpq/inventory/assets/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: asset.id, targetStatus }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Status transition failed')
      setAsset((prev) => prev ? { ...prev, ...data } : prev)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setTransitioning(false)
    }
  }

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/cpq/inventory/assets?id=${assetId}`)
        if (!res.ok) throw new Error('Asset not found')
        const data = await res.json()
        if (!cancelled) {
          setAsset(data)
          fetch(`/api/customers/companies?id=${data.customerId}&pageSize=1`)
            .then((r) => r.json())
            .then((result) => {
              const items = result.items ?? result ?? []
              const c = items[0]
              if (c && !cancelled) setCustomerName(c.display_name || c.displayName || c.name || null)
            })
            .catch(() => {})

          if (data.subscriptionId) {
            fetch(`/api/cpq/inventory/subscriptions?id=${data.subscriptionId}`)
              .then((r) => r.json())
              .then((sub) => {
                if (sub && !cancelled) setSubscriptionName(sub.name || sub.code || null)
              })
              .catch(() => {})
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
  }, [assetId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 justify-center text-sm text-muted-foreground">
        <Spinner /> Loading…
      </div>
    )
  }

  if (!asset) {
    return (
      <div className="space-y-4">
        <button onClick={() => router.push('/backend/cpq/inventory')} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
        {error && <ErrorBanner message={error} />}
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">Asset not found.</div>
      </div>
    )
  }

  const currency = asset.currencyCode || 'USD'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/backend/cpq/inventory')} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
        <h1 className="text-2xl font-bold">{asset.name}</h1>
        <div className="relative" ref={statusMenuRef}>
          <button
            onClick={() => {
              const transitions = ALLOWED_TRANSITIONS[asset.status] ?? []
              if (transitions.length > 0) setShowStatusMenu((v) => !v)
            }}
            disabled={transitioning}
            className={`inline-flex items-center gap-1 disabled:opacity-50 ${(ALLOWED_TRANSITIONS[asset.status] ?? []).length > 0 ? 'cursor-pointer hover:ring-2 hover:ring-primary/30 rounded-full' : ''}`}
          >
            {transitioning && <Spinner />}
            <Tag variant={assetStatusMap[asset.status as AssetStatus] ?? 'neutral'} dot>
              {STATUS_LABELS[asset.status] ?? formatStatusLabel(asset.status)}
              {(ALLOWED_TRANSITIONS[asset.status] ?? []).length > 0 && (
                <svg className={`h-3 w-3 transition-transform ${showStatusMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              )}
            </Tag>
          </button>
          {showStatusMenu && (
            <div className="absolute left-0 top-full mt-1 z-50 min-w-[180px] rounded-md border bg-card shadow-lg py-1">
              <p className="px-3 py-1.5 text-xs text-muted-foreground font-medium">Transition to:</p>
              {(ALLOWED_TRANSITIONS[asset.status] ?? []).map((status) => (
                <button
                  key={status}
                  onClick={() => transitionStatus(status)}
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
                >
                  <Tag variant={assetStatusMap[status as AssetStatus] ?? 'neutral'} dot>
                    {STATUS_LABELS[status] ?? formatStatusLabel(status)}
                  </Tag>
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="text-xs text-muted-foreground font-mono">{asset.code}</span>
        <Tag variant="brand">{asset.assetType.replace(/_/g, ' ')}</Tag>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Detail Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h3 className="text-sm font-medium">Asset Details</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Field label="Status" value={asset.status} />
            <Field label="Asset Type" value={asset.assetType.replace(/_/g, ' ')} />
            <Field label="Currency" value={currency} />
            <Field label="Quantity" value={String(asset.quantity)} />
            {asset.purchaseDate && <Field label="Purchase Date" value={new Date(asset.purchaseDate).toLocaleDateString()} />}
            {asset.deliveryDate && <Field label="Delivery Date" value={new Date(asset.deliveryDate).toLocaleDateString()} />}
          </div>
          {asset.description && (
            <div className="pt-1">
              <p className="text-xs text-muted-foreground">Description</p>
              <p className="text-sm">{asset.description}</p>
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h3 className="text-sm font-medium">Pricing & References</h3>
          <div>
            <p className="text-xs text-muted-foreground">Purchase Price</p>
            <p className="text-lg font-semibold font-mono">{fmt(asset.purchasePrice, currency)}</p>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-1">
            <Field label="Customer" value={customerName ?? asset.customerId.slice(0, 12) + '…'} />
            <Field label="Created" value={new Date(asset.createdAt).toLocaleString()} />
            {asset.subscriptionId && (
              <div>
                <p className="text-xs text-muted-foreground">Linked Subscription</p>
                <button onClick={() => router.push(`/backend/cpq/inventory/subscriptions/${asset.subscriptionId}`)} className="text-sm text-primary hover:underline">
                  {subscriptionName ?? asset.subscriptionId.slice(0, 12) + '…'}
                </button>
              </div>
            )}
            {asset.productId && <Field label="Product ID" value={asset.productId.slice(0, 12) + '…'} mono />}
            {asset.offeringId && <Field label="Offering ID" value={asset.offeringId.slice(0, 12) + '…'} mono />}
            {asset.specId && <Field label="Spec ID" value={asset.specId.slice(0, 12) + '…'} mono />}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {asset.sourceQuoteId && (
              <div>
                <p className="text-xs text-muted-foreground">Source Quote</p>
                <button onClick={() => router.push(`/backend/cpq/quotes/${asset.sourceQuoteId}`)} className="text-sm text-primary hover:underline">{asset.sourceQuoteId.slice(0, 8)}…</button>
              </div>
            )}
            {asset.sourceOrderId && (
              <div>
                <p className="text-xs text-muted-foreground">Source Order</p>
                <button onClick={() => router.push(`/backend/cpq/orders/${asset.sourceOrderId}`)} className="text-sm text-primary hover:underline">{asset.sourceOrderId.slice(0, 8)}…</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Configuration */}
      {asset.configuration && Object.keys(asset.configuration).length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-medium mb-2">Configuration</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
            {Object.entries(asset.configuration).map(([key, value]) => (
              <div key={key} className="text-xs">
                <span className="text-muted-foreground">{key}: </span>
                <span className="font-medium">{String(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charges */}
      {asset.charges && asset.charges.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-medium mb-2">Charges</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-muted-foreground">
                <th className="text-left px-3 py-2 font-medium">Charge</th>
                <th className="text-left px-3 py-2 font-medium">Type</th>
                <th className="text-right px-3 py-2 font-medium">Unit Price</th>
                <th className="text-right px-3 py-2 font-medium">Qty</th>
                <th className="text-right px-3 py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {asset.charges.map((c, i) => (
                <tr key={i} className="border-b">
                  <td className="px-3 py-2">{(c as any).chargeName ?? '—'}</td>
                  <td className="px-3 py-2 uppercase">{(c as any).chargeType ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{(c as any).unitPrice != null ? fmt((c as any).unitPrice, currency) : '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{(c as any).quantity ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{(c as any).totalPrice != null ? fmt((c as any).totalPrice, currency) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Metadata */}
      {asset.metadata && Object.keys(asset.metadata).length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-medium mb-2">Metadata</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
            {Object.entries(asset.metadata).map(([key, value]) => (
              <div key={key} className="text-xs">
                <span className="text-muted-foreground">{key}: </span>
                <span className="font-medium">{String(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
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
  return <Alert variant="destructive">{message}</Alert>
}
