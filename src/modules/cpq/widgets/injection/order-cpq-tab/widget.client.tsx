"use client"
import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useRouter } from 'next/navigation'

type CpqOrderSummary = {
  id: string
  orderId: string
  orderNumber?: string
  cpqStatus: string
  sourceQuoteId: string | null
  currencyCode: string
  pricingSummary: { nrcTotal: number; mrcTotal: number } | null
  activatedAt: string | null
  createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-blue-100 text-blue-800',
  pending_activation: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  fulfilled: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-100 text-gray-800',
}

function fmt(amount: number | undefined | null, currency: string): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

export default function OrderCpqTabWidget({ data }: InjectionWidgetComponentProps<any, any>) {
  const router = useRouter()
  const salesOrderId = data?.id as string | undefined
  const [cpqOrders, setCpqOrders] = React.useState<CpqOrderSummary[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!salesOrderId) { setLoading(false); return }
    let cancelled = false
    fetch(`/api/cpq/orders?salesOrderId=${salesOrderId}&pageSize=50`)
      .then((r) => r.json())
      .then((result) => {
        if (!cancelled) setCpqOrders(result.items ?? [])
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [salesOrderId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        Loading CPQ orders…
      </div>
    )
  }

  if (cpqOrders.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No CPQ orders linked to this sales order.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {cpqOrders.map((o) => (
        <div
          key={o.id}
          onClick={() => router.push(`/backend/cpq/orders/${o.id}`)}
          className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/30 cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[o.cpqStatus] ?? 'bg-gray-100 text-gray-800'}`}>
              {o.cpqStatus.replace(/_/g, ' ')}
            </span>
            <span className="text-sm font-medium">{o.currencyCode}</span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            {o.pricingSummary && (
              <>
                <span><span className="text-muted-foreground">NRC </span><span className="font-mono font-medium">{fmt(o.pricingSummary.nrcTotal, o.currencyCode)}</span></span>
                <span><span className="text-muted-foreground">MRC </span><span className="font-mono font-medium">{fmt(o.pricingSummary.mrcTotal, o.currencyCode)}</span></span>
              </>
            )}
            <span className="text-muted-foreground">{new Date(o.createdAt).toLocaleDateString()}</span>
            <span className="text-primary font-medium">Open →</span>
          </div>
        </div>
      ))}
    </div>
  )
}
