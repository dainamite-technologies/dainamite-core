"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'

type OrderConfig = {
  id: string
  orderId: string
  orderNumber: string | null
  customerId: string
  cpqStatus: string
  currencyCode: string
  pricingSummary: {
    nrcTotal?: number
    mrcTotal?: number
  } | null
  createdAt: string
  activatedAt: string | null
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-blue-100 text-blue-800',
  pending_activation: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  fulfilled: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-100 text-gray-800',
}

function fmt(amount: number | undefined, currency: string): string {
  if (amount == null || amount === 0) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

export default function CpqOrdersListPage() {
  const router = useRouter()
  const [items, setItems] = React.useState<OrderConfig[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/cpq/orders?pageSize=100')
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) setItems(data.items ?? [])
        }
      } catch (err) {
        console.error('Failed to load CPQ orders', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">CPQ Orders</h1>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-12 justify-center text-sm text-muted-foreground">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Loading orders…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          No CPQ orders found. Convert an accepted quote to create an order.
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Order</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Currency</th>
                <th className="px-4 py-3 text-right font-medium">NRC Total</th>
                <th className="px-4 py-3 text-right font-medium">MRC Total</th>
                <th className="px-4 py-3 text-left font-medium">Created</th>
                <th className="px-4 py-3 text-left font-medium">Activated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => router.push(`/backend/cpq/orders/${item.id}`)}
                  className="border-b cursor-pointer hover:bg-muted/30 transition-colors last:border-b-0"
                >
                  <td className="px-4 py-3">
                    <span className="text-sm font-medium text-primary">{item.orderNumber ?? item.orderId?.slice(0, 8) + '…'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[item.cpqStatus] ?? 'bg-gray-100 text-gray-800'}`}>
                      {item.cpqStatus.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{item.currencyCode}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {fmt(item.pricingSummary?.nrcTotal, item.currencyCode)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {fmt(item.pricingSummary?.mrcTotal, item.currencyCode)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {item.activatedAt ? new Date(item.activatedAt).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
