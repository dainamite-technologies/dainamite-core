"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'

type QuoteConfig = {
  id: string
  quoteId: string
  customerId: string
  cpqStatus: string
  version: number
  currencyCode: string
  pricingSummary: {
    nrcTotal?: number
    mrcTotal?: number
  } | null
  createdAt: string
  updatedAt: string
}

type Customer = {
  id: string
  display_name?: string
  displayName?: string
  name?: string
  companyName?: string
  primary_email?: string
  primaryEmail?: string
}

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800',
  incomplete: 'bg-yellow-100 text-yellow-800',
  ready: 'bg-green-100 text-green-800',
  in_approval: 'bg-purple-100 text-purple-800',
  approved: 'bg-green-100 text-green-800',
  with_customer: 'bg-sky-100 text-sky-800',
  accepted: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-800',
}

function fmt(amount: number | undefined, currency: string): string {
  if (amount == null || amount === 0) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

export default function CpqQuotesListPage() {
  const router = useRouter()
  const [items, setItems] = React.useState<QuoteConfig[]>([])
  const [loading, setLoading] = React.useState(true)

  const [showCustomerPicker, setShowCustomerPicker] = React.useState(false)
  const [customers, setCustomers] = React.useState<Customer[]>([])
  const [customersLoading, setCustomersLoading] = React.useState(false)
  const [customerSearch, setCustomerSearch] = React.useState('')
  const [creating, setCreating] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/cpq/quotes?pageSize=100')
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) setItems(data.items ?? [])
        }
      } catch (err) {
        console.error('Failed to load CPQ quotes', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const openCustomerPicker = async () => {
    setShowCustomerPicker(true)
    setCustomerSearch('')
    setCustomersLoading(true)
    try {
      const res = await fetch('/api/customers/companies?pageSize=100')
      if (res.ok) {
        const data = await res.json()
        setCustomers(data.items ?? data ?? [])
      }
    } catch { setCustomers([]) }
    finally { setCustomersLoading(false) }
  }

  const [createError, setCreateError] = React.useState<string | null>(null)

  const selectCustomer = async (customer: Customer) => {
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/cpq/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: customer.id }),
      })
      const data = await res.json()
      if (res.ok) {
        setShowCustomerPicker(false)
        router.push(`/backend/cpq/quotes/${data.id}`)
      } else {
        setCreateError(data.error ?? `Failed to create quote (${res.status})`)
      }
    } catch (err) {
      setCreateError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const getCustomerLabel = (c: Customer) => c.display_name || c.displayName || c.name || c.companyName || 'Unnamed'
  const getCustomerEmail = (c: Customer) => c.primary_email || c.primaryEmail || ''

  const filteredCustomers = customers.filter((c) => {
    if (!customerSearch.trim()) return true
    const q = customerSearch.toLowerCase()
    return getCustomerLabel(c).toLowerCase().includes(q) || getCustomerEmail(c).toLowerCase().includes(q) || c.id.toLowerCase().includes(q)
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">CPQ Quotes</h1>
        <button
          onClick={openCustomerPicker}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Quote
        </button>
      </div>

      {showCustomerPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !creating && setShowCustomerPicker(false)}>
          <div className="w-full max-w-lg rounded-lg border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-medium">Select Customer for New Quote</h3>
              <button onClick={() => setShowCustomerPicker(false)} disabled={creating} className="text-muted-foreground hover:text-foreground text-lg font-bold leading-none">&times;</button>
            </div>
            <div className="p-4 space-y-3">
              {createError && (
                <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{createError}</div>
              )}
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search customers…"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  autoFocus
                  className="w-full rounded-md border bg-background pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div className="max-h-72 overflow-y-auto space-y-1">
                {customersLoading ? (
                  <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    Loading customers…
                  </div>
                ) : filteredCustomers.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {customerSearch ? 'No customers match your search.' : 'No customers found.'}
                  </div>
                ) : (
                  filteredCustomers.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => selectCustomer(c)}
                      disabled={creating}
                      className="w-full rounded-md border px-3 py-2.5 text-left hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
                    >
                      <p className="text-sm font-medium">{getCustomerLabel(c)}</p>
                      {getCustomerEmail(c) && <p className="text-xs text-muted-foreground mt-0.5">{getCustomerEmail(c)}</p>}
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{c.id}</p>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-12 justify-center text-sm text-muted-foreground">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Loading quotes…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          No CPQ quotes found. Create a quote from the Sales module and initialize CPQ on it.
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Quote ID</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Version</th>
                <th className="px-4 py-3 text-left font-medium">Currency</th>
                <th className="px-4 py-3 text-right font-medium">NRC Total</th>
                <th className="px-4 py-3 text-right font-medium">MRC Total</th>
                <th className="px-4 py-3 text-left font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => router.push(`/backend/cpq/quotes/${item.id}`)}
                  className="border-b cursor-pointer hover:bg-muted/30 transition-colors last:border-b-0"
                >
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-primary">{item.quoteId?.slice(0, 8) ?? item.id.slice(0, 8)}…</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[item.cpqStatus] ?? 'bg-gray-100 text-gray-800'}`}>
                      {item.cpqStatus.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">v{item.version}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
