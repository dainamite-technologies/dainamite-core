"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

// XD-250 — Expiring Subscriptions list (operator triage view).
//
// Replaces auto-renew automation with a manual review surface: shows active
// subscriptions whose currentTermEnd falls within the chosen window, sorted
// soonest-first. Row actions kick off an ARC quote via /from-subscription.

type ExpiringSubscription = {
  id: string
  code: string
  name: string
  status: string
  customerId: string
  mrcAmount: number
  currencyCode: string
  billingCycle: string
  currentTermEnd: string | null
  termMonths: number | null
}

type WindowPreset = 7 | 14 | 30 | 60 | 90

const WINDOW_PRESETS: WindowPreset[] = [7, 14, 30, 60, 90]

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

function relativeFromNow(iso: string | null): string {
  if (!iso) return '—'
  const target = new Date(iso).getTime()
  const now = Date.now()
  const diffDays = Math.round((target - now) / (24 * 60 * 60 * 1000))
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'tomorrow'
  return `in ${diffDays}d`
}

function diffChipColor(iso: string | null): string {
  if (!iso) return 'bg-gray-100 text-gray-700'
  const target = new Date(iso).getTime()
  const days = Math.round((target - Date.now()) / (24 * 60 * 60 * 1000))
  if (days < 0) return 'bg-red-100 text-red-800'
  if (days <= 7) return 'bg-orange-100 text-orange-800'
  if (days <= 30) return 'bg-yellow-100 text-yellow-800'
  return 'bg-blue-100 text-blue-800'
}

export default function ExpiringSubscriptionsPage() {
  const t = useT()
  const router = useRouter()

  const [withinDays, setWithinDays] = React.useState<WindowPreset>(30)
  const [billingCycle, setBillingCycle] = React.useState<string>('')
  const [items, setItems] = React.useState<ExpiringSubscription[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [actionInFlight, setActionInFlight] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ withinDays: String(withinDays) })
      if (billingCycle) params.set('billingCycle', billingCycle)
      const res = await fetch(`/api/cpq/inventory/subscriptions/expiring?${params.toString()}`)
      if (!res.ok) {
        setError(`Failed to load (HTTP ${res.status})`)
        setItems([])
      } else {
        const data = await res.json()
        setItems(
          (data.items ?? []).map((s: ExpiringSubscription) => ({
            ...s,
            mrcAmount: Number(s.mrcAmount),
          })),
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [withinDays, billingCycle])

  React.useEffect(() => {
    void load()
  }, [load])

  const startArcQuote = React.useCallback(
    async (subId: string, type: 'amend' | 'renew' | 'cancel') => {
      setActionInFlight(subId + ':' + type)
      try {
        const res = await fetch('/api/cpq/quotes/from-subscription', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ subscriptionId: subId, type }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string; existingQuoteId?: string }
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
        setActionInFlight(null)
      }
    },
    [router],
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {t('cpq.inventory.expiring.title', 'Expiring Subscriptions')}
        </h1>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-card p-4">
        <div>
          <p className="text-xs text-muted-foreground mb-1">
            {t('cpq.inventory.expiring.window', 'Window')}
          </p>
          <div className="flex gap-1">
            {WINDOW_PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setWithinDays(p)}
                className={`px-2.5 py-1 text-xs rounded-md border ${
                  withinDays === p
                    ? 'border-primary bg-primary/10 text-primary font-medium'
                    : 'border-border hover:bg-muted'
                }`}
              >
                {p}d
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">
            {t('cpq.inventory.expiring.billingCycle', 'Billing Cycle')}
          </p>
          <select
            value={billingCycle}
            onChange={(e) => setBillingCycle(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          >
            <option value="">All</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annually">Annually</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          {t(
            'cpq.inventory.expiring.empty',
            'No subscriptions expire within this window.',
          )}
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Code</th>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-right font-medium">MRC</th>
                <th className="px-4 py-3 text-left font-medium">Cycle</th>
                <th className="px-4 py-3 text-left font-medium">Term End</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr
                  key={s.id}
                  className="border-b hover:bg-muted/30 transition-colors"
                >
                  <td
                    className="px-4 py-3 text-muted-foreground cursor-pointer"
                    onClick={() =>
                      router.push(`/backend/cpq/inventory/subscriptions/${s.id}`)
                    }
                  >
                    {s.code}
                  </td>
                  <td
                    className="px-4 py-3 font-medium text-primary cursor-pointer"
                    onClick={() =>
                      router.push(`/backend/cpq/inventory/subscriptions/${s.id}`)
                    }
                  >
                    {s.name}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {fmt(s.mrcAmount, s.currencyCode || 'USD')}
                  </td>
                  <td className="px-4 py-3">{s.billingCycle}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span>
                        {s.currentTermEnd
                          ? new Date(s.currentTermEnd).toLocaleDateString()
                          : '—'}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${diffChipColor(
                          s.currentTermEnd,
                        )}`}
                      >
                        {relativeFromNow(s.currentTermEnd)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        disabled={actionInFlight === s.id + ':renew'}
                        onClick={() => startArcQuote(s.id, 'renew')}
                        className="rounded-md border border-blue-300 bg-blue-50 text-blue-700 px-2 py-1 text-xs hover:bg-blue-100 disabled:opacity-50"
                      >
                        {t('cpq.arc.renew', 'Renew')}
                      </button>
                      <button
                        disabled={actionInFlight === s.id + ':amend'}
                        onClick={() => startArcQuote(s.id, 'amend')}
                        className="rounded-md border border-green-300 bg-green-50 text-green-700 px-2 py-1 text-xs hover:bg-green-100 disabled:opacity-50"
                      >
                        {t('cpq.arc.modify', 'Modify')}
                      </button>
                    </div>
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
