"use client"
import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import {
  assetStatusMap,
  formatStatusLabel,
  type AssetStatus,
} from '../../../../../components/statusMaps'
import { StatusPath } from '../../../../../components/StatusPath'

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

export default function AssetDetailPage(props: { params?: { id?: string } }) {
  const router = useRouter()
  const urlParams = useParams()
  const assetId = (props.params?.id ?? urlParams?.id) as string

  const [asset, setAsset] = React.useState<AssetDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [customerName, setCustomerName] = React.useState<string | null>(null)
  const [subscriptionName, setSubscriptionName] = React.useState<string | null>(null)
  // Resolved names for the other ID references on the page.
  const [productName, setProductName] = React.useState<string | null>(null)
  const [offeringName, setOfferingName] = React.useState<string | null>(null)
  const [specName, setSpecName] = React.useState<string | null>(null)
  const [sourceQuoteNumber, setSourceQuoteNumber] = React.useState<string | null>(null)
  const [sourceOrderNumber, setSourceOrderNumber] = React.useState<string | null>(null)
  const [transitioning, setTransitioning] = React.useState(false)

  const transitionStatus = async (targetStatus: string) => {
    if (!asset) return
    try {
      setTransitioning(true)
      setError(null)
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
        const data: AssetDetail = await res.json()
        if (!cancelled) {
          setAsset(data)

          // Resolve names for every FK reference. Each lookup is fire-and-
          // forget; the UI falls back to a short UUID until the name lands.
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
          if (data.offeringId) {
            fetch(`/api/cpq/product-offerings?id=${data.offeringId}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((o) => {
                if (!o || cancelled) return
                if (o.name) setOfferingName(o.name)
                if (o.specification?.name) setSpecName(o.specification.name)
              })
              .catch(() => {})
          }
          if (data.specId) {
            fetch(`/api/cpq/product-specifications?id=${data.specId}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((s) => {
                if (s?.name && !cancelled) setSpecName(s.name)
              })
              .catch(() => {})
          }
          if (data.productId) {
            // Catalog products route is paginated; `?id=…` returns one row.
            fetch(`/api/catalog/products?id=${data.productId}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((res2) => {
                if (!res2 || cancelled) return
                const p = (res2.items ?? res2)[0] ?? res2
                const name = p?.title ?? p?.name ?? p?.handle ?? null
                if (name) setProductName(name)
              })
              .catch(() => {})
          }
          if (data.sourceQuoteId) {
            fetch(`/api/cpq/quotes/${data.sourceQuoteId}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((q) => {
                if (q?.quoteNumber && !cancelled) setSourceQuoteNumber(q.quoteNumber)
              })
              .catch(() => {})
          }
          if (data.sourceOrderId) {
            fetch(`/api/cpq/orders/${data.sourceOrderId}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((o) => {
                if (o?.orderNumber && !cancelled) setSourceOrderNumber(o.orderNumber)
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
  const statusTransitions = ALLOWED_TRANSITIONS[asset.status] ?? []

  return (
    <div className="space-y-6">
      {/* Header — standard FormHeader detail mode, matches the rest of the
          CPQ admin (quote / order / subscription). The asset code lives
          in the Asset Details card; here we show only the human name +
          status / type tags. */}
      <FormHeader
        mode="detail"
        backHref="/backend/cpq/inventory"
        backLabel="Back to Customer Inventory"
        entityTypeLabel="Asset"
        title={asset.name}
        statusBadge={
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Tag variant={assetStatusMap[asset.status as AssetStatus] ?? 'neutral'} dot>
              {STATUS_LABELS[asset.status] ?? formatStatusLabel(asset.status)}
            </Tag>
            <Tag variant="brand" className="capitalize">{asset.assetType.replace(/_/g, ' ')}</Tag>
            {transitioning && <Spinner />}
          </div>
        }
      />

      {/* Status path — interactive: clicking a non-current step in the
          breadcrumb invokes /api/cpq/inventory/assets/status. */}
      <div className="flex items-center gap-3 flex-wrap">
        <StatusPath
          current={asset.status}
          path={['pending', 'delivered', 'active', 'returned']}
          terminals={['cancelled']}
          statusMap={assetStatusMap}
          labels={STATUS_LABELS}
          onTransition={transitionStatus}
          allowedTransitions={statusTransitions}
          disabled={transitioning}
          ariaLabel="Asset status path"
        />
        {transitioning && <Spinner />}
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Detail Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h3 className="text-sm font-medium">Asset Details</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Field label="Code" value={asset.code} mono />
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
            <Field label="Customer" value={customerName ?? `${asset.customerId.slice(0, 12)}…`} />
            <Field label="Created" value={new Date(asset.createdAt).toLocaleString()} />
            {asset.subscriptionId && (
              <RefField
                label="Linked Subscription"
                name={subscriptionName ?? undefined}
                fallback={asset.subscriptionId}
                onClick={() => router.push(`/backend/cpq/inventory/subscriptions/${asset.subscriptionId}`)}
              />
            )}
            {asset.offeringId && (
              <RefField
                label="Offering"
                name={offeringName ?? undefined}
                fallback={asset.offeringId}
                onClick={() => router.push(`/backend/cpq/offerings/${asset.offeringId}`)}
              />
            )}
            {asset.specId && (
              <RefField
                label="Specification"
                name={specName ?? undefined}
                fallback={asset.specId}
                onClick={() => router.push(`/backend/cpq/specifications/${asset.specId}`)}
              />
            )}
            {asset.productId && (
              <RefField
                label="Product"
                name={productName ?? undefined}
                fallback={asset.productId}
                onClick={() => router.push(`/backend/catalog/products/${asset.productId}`)}
              />
            )}
            {asset.sourceQuoteId && (
              <RefField
                label="Source Quote"
                name={sourceQuoteNumber ?? undefined}
                fallback={asset.sourceQuoteId}
                onClick={() => router.push(`/backend/cpq/quotes/${asset.sourceQuoteId}`)}
              />
            )}
            {asset.sourceOrderId && (
              <RefField
                label="Source Order"
                name={sourceOrderNumber ?? undefined}
                fallback={asset.sourceOrderId}
                onClick={() => router.push(`/backend/cpq/orders/${asset.sourceOrderId}`)}
              />
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

function RefField({
  label,
  name,
  fallback,
  onClick,
}: {
  label: string
  name: string | undefined
  fallback: string
  onClick: () => void
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <button
        type="button"
        onClick={onClick}
        className="text-sm text-primary hover:underline text-left truncate max-w-full"
        title={name ?? fallback}
      >
        {name ?? `${fallback.slice(0, 12)}…`}
      </button>
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
